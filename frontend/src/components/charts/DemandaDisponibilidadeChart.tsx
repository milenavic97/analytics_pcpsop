import { useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  Cell,
} from "recharts"
import { getDisponibilidadeMensal } from "@/services/api"

type EstoqueGrupo = {
  grupo: string
  qtd_caixas: number
  pct: number
}

type MesDisponibilidade = {
  mes: number
  mes_label: string
  estoque_inicio: number
  estoque_inicio_tipo: "real" | "projetado"
  estoque_inicio_por_grupo: EstoqueGrupo[]
  entradas: number
  entradas_tipo: "real" | "previsto"
  saidas: number
  saidas_tipo: "real" | "forecast"
  disponibilidade_total: number
  saldo_final: number
}

type DisponibilidadeResponse = {
  ano: number
  mes_atual: number
  ultimo_mes_fechado: number
  meses: MesDisponibilidade[]
}

type ChartPoint = MesDisponibilidade & {
  saidas_real: number | null
  saidas_forecast: number | null
  saidas_forecast_label: number | null
}

const COR_ESTOQUE = "#27336D"
const COR_ESTOQUE_PROJETADO = "#34477F"
const COR_ENTRADA_REAL = "#9CCFE6"
const COR_ENTRADA_PREVISTA = "#D1D5DB"
const COR_SAIDA_REAL = "#4F8F75"
const COR_FORECAST = "#EF5A5A"
const COR_GRID = "#E5E7EB"
const COR_TEXTO = "#6B7280"

function fmt(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n || 0)))
}

function toChartData(data: DisponibilidadeResponse | null): ChartPoint[] {
  if (!data?.meses?.length) return []

  return data.meses.map((row, index, arr) => {
    const isForecast = row.saidas_tipo === "forecast"
    const prev = arr[index - 1]

    return {
      ...row,
      saidas_real: row.saidas_tipo === "real" ? row.saidas : null,
      saidas_forecast:
        isForecast
          ? row.saidas
          : prev?.saidas_tipo === "real" && row.mes === data.mes_atual
            ? row.saidas
            : null,
      saidas_forecast_label: isForecast ? row.saidas : null,
    }
  })
}

const EstoqueLabel = ({ x, y, width, height, value }: any) => {
  if (value === null || value === undefined || Number(value) <= 0) return null
  if (height < 18) return null

  return (
    <text
      x={x + width / 2}
      y={y + height / 2 + 4}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill="#FFFFFF"
    >
      {fmt(value)}
    </text>
  )
}

const EntradaSegmentLabel = ({ x, y, width, height, value }: any) => {
  const entradas = Number(value || 0)

  if (entradas <= 0) return null

  const inside = height >= 22

  return (
    <text
      x={x + width / 2}
      y={inside ? y + height / 2 + 4 : y - 8}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill="#4B5563"
    >
      {fmt(entradas)}
    </text>
  )
}

const DisponibilidadeTotalLabel = ({ x, y, width, value }: any) => {
  const total = Number(value || 0)

  if (total <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={y - 10}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill="#5B6472"
    >
      {fmt(total)}
    </text>
  )
}

const LineLabel =
  (color: string, onlyCurrentDataKey?: string) =>
  (props: any) => {
    const { x, y, value, payload } = props

    if (!value || Number(value) <= 0) return null
    if (onlyCurrentDataKey && payload?.[onlyCurrentDataKey] === null) return null

    const text = fmt(value)
    const width = Math.max(44, text.length * 7 + 14)

    return (
      <g>
        <rect
          x={x - width / 2}
          y={y - 28}
          width={width}
          height={22}
          rx={5}
          fill={color}
        />
        <text
          x={x}
          y={y - 13}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill="#FFFFFF"
        >
          {text}
        </text>
      </g>
    )
  }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload as ChartPoint
  if (!row) return null

  const grupos = row.estoque_inicio_por_grupo || []
  const totalGrupos = grupos.reduce((sum, item) => sum + Number(item.qtd_caixas || 0), 0)

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 10px 26px rgba(0,0,0,0.12)",
        fontSize: 12,
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 10 }}>
        {label}/26
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>
            Estoque início ({row.estoque_inicio_tipo})
          </span>
          <strong style={{ color: "var(--text-primary)" }}>{fmt(row.estoque_inicio)} cx</strong>
        </div>

        {grupos.length > 0 ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
              display: "grid",
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Composição do estoque inicial
            </div>

            {grupos.slice(0, 8).map((item) => (
              <div
                key={item.grupo}
                style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
              >
                <span style={{ color: "var(--text-secondary)" }}>{item.grupo}</span>
                <strong style={{ color: "var(--text-primary)" }}>
                  {fmt(item.qtd_caixas)} cx · {item.pct.toFixed(1).replace(".", ",")}%
                </strong>
              </div>
            ))}

            {grupos.length > 8 && (
              <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                + {grupos.length - 8} grupos restantes
              </div>
            )}

            {Math.round(totalGrupos) !== Math.round(row.estoque_inicio) && (
              <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                Composição parcial por diferença de arredondamento/cadastro.
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              marginTop: 4,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: 11,
            }}
          >
            Composição por grupo indisponível para estoque projetado.
          </div>
        )}

        <div
          style={{
            marginTop: 6,
            paddingTop: 8,
            borderTop: "1px solid var(--border)",
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>
              Entradas ({row.entradas_tipo})
            </span>
            <strong style={{ color: "var(--text-primary)" }}>{fmt(row.entradas)} cx</strong>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>
              Saídas ({row.saidas_tipo})
            </span>
            <strong style={{ color: row.saidas_tipo === "real" ? COR_SAIDA_REAL : COR_FORECAST }}>
              {fmt(row.saidas)} cx
            </strong>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Disponibilidade total</span>
            <strong style={{ color: "var(--text-primary)" }}>
              {fmt(row.disponibilidade_total)} cx
            </strong>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Saldo final projetado</span>
            <strong
              style={{ color: row.saldo_final < 0 ? COR_FORECAST : "var(--text-primary)" }}
            >
              {fmt(row.saldo_final)} cx
            </strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendItem({
  color,
  label,
  line = false,
}: {
  color: string
  label: string
  line?: boolean
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {line ? (
        <svg width="28" height="10">
          <line
            x1="2"
            y1="5"
            x2="26"
            y2="5"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <span style={{ width: 14, height: 12, borderRadius: 3, background: color }} />
      )}
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
    </div>
  )
}

export function DemandaDisponibilidadeChart() {
  const [data, setData] = useState<DisponibilidadeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    getDisponibilidadeMensal()
      .then((response: unknown) => {
        if (!mounted) return
        setData(response as DisponibilidadeResponse)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar disponibilidade")
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const chartData = useMemo(() => toChartData(data), [data])

  if (loading) {
    return (
      <div
        className="card p-6 flex items-center justify-center h-72 text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        Carregando disponibilidade...
      </div>
    )
  }

  if (error || !chartData.length) {
    return (
      <div
        className="card p-6 flex items-center justify-center h-72 text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {error || "Disponível após carga das bases de estoque, entradas e forecast"}
      </div>
    )
  }

  return (
    <div className="card p-6">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          Demanda vs. Disponibilidade <strong>mensal</strong>
        </h3>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 18,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <LegendItem color={COR_ESTOQUE} label="Estoque início do mês" />
        <LegendItem color={COR_ENTRADA_REAL} label="Entradas reais" />
        <LegendItem color={COR_ENTRADA_PREVISTA} label="Entradas projetadas" />
        <LegendItem color={COR_SAIDA_REAL} label="Saídas reais" line />
        <LegendItem color={COR_FORECAST} label="Forecast S&OP" line />
      </div>

      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 34, right: 28, left: 10, bottom: 24 }}
            barCategoryGap={30}
            barGap={0}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />

            <XAxis
              dataKey="mes_label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO }}
              interval={0}
              label={{
                value: "Mês",
                position: "insideBottom",
                offset: -10,
                fill: "#4B5563",
                fontSize: 14,
                fontWeight: 700,
              }}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: COR_TEXTO }}
              tickFormatter={(value) => fmt(Number(value))}
              width={64}
              domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.16)]}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(39,51,109,0.04)" }} />

            <Bar
              dataKey="estoque_inicio"
              name="Estoque início do mês"
              stackId="disponibilidade"
              radius={[0, 0, 6, 6]}
              barSize={46}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell
                  key={`estoque-${entry.mes}`}
                  fill={entry.estoque_inicio_tipo === "real" ? COR_ESTOQUE : COR_ESTOQUE_PROJETADO}
                />
              ))}
              <LabelList dataKey="estoque_inicio" content={EstoqueLabel} />
            </Bar>

            <Bar
              dataKey="entradas"
              name="Entradas"
              stackId="disponibilidade"
              radius={[6, 6, 0, 0]}
              barSize={46}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell
                  key={`entrada-${entry.mes}`}
                  fill={entry.entradas_tipo === "real" ? COR_ENTRADA_REAL : COR_ENTRADA_PREVISTA}
                />
              ))}
              <LabelList dataKey="entradas" content={EntradaSegmentLabel} />
              <LabelList dataKey="disponibilidade_total" content={DisponibilidadeTotalLabel} />
            </Bar>

            <Line
              type="monotone"
              dataKey="saidas_real"
              stroke={COR_SAIDA_REAL}
              strokeWidth={3}
              dot={{ r: 4, fill: COR_SAIDA_REAL, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            >
              <LabelList content={LineLabel(COR_SAIDA_REAL)} />
            </Line>

            <Line
              type="monotone"
              dataKey="saidas_forecast"
              stroke={COR_FORECAST}
              strokeWidth={3}
              dot={{ r: 4, fill: COR_FORECAST, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            >
              <LabelList content={LineLabel(COR_FORECAST, "saidas_forecast_label")} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}