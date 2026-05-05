import { useEffect, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { getProjecaoLiberacoes } from "@/services/api"
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
} from "recharts"

interface Props {
  open: boolean
  onClose: () => void
}

interface MesResumo {
  mes: number
  real: number | null
  previsto: number | null
  orcado: number
}

interface LinhaResumo {
  mes: number
  linha: "L1" | "L2"
  realizado: number | null
  planejado: number
  previsto: number | null
  orcado: number
  atingimento: number | null
}

interface ProjecaoLiberacoesResponse {
  total_real: number
  total_previsto: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  ultimo_mes_fechado: number
  meses: MesResumo[]
  linhas?: LinhaResumo[]
}

interface ChartPoint {
  mes: number
  mesLabel: string
  linha: "L1" | "L2"
  planejado: number
  realizado: number | null
  orcado: number
  atingimento: number | null
}

const MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

const TUBETES_POR_CAIXA = 500

const COR_REAL = "#27336D"
const COR_PLANEJADO = "#D7DCE7"
const COR_ORCADO = "#E56A1C"
const COR_ATINGIMENTO = "#8FA0B8"
const COR_VERDE = "#2E7D32"
const COR_AMARELO = "#CA8A04"
const COR_VERMELHO = "#C62828"

const CHART_LEFT = 8
const CHART_RIGHT = 24
const Y_AXIS_WIDTH = 58

function fmt(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n || 0)))
}

function fmtPct(n: number | null | undefined) {
  return (
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Number(n || 0)) + "%"
  )
}

function corPct(n: number | null | undefined) {
  const value = Number(n || 0)

  if (value >= 95) return COR_VERDE
  if (value >= 90) return COR_AMARELO
  return COR_VERMELHO
}

function buildLinhaData(data: ProjecaoLiberacoesResponse, linha: "L1" | "L2"): ChartPoint[] {
  const linhasMap = new Map<number, LinhaResumo>()

  for (const row of data.linhas || []) {
    if (row.linha === linha) {
      linhasMap.set(row.mes, row)
    }
  }

  const result: ChartPoint[] = []

  for (let mes = 1; mes <= 12; mes++) {
    const row = linhasMap.get(mes)

    result.push({
      mes,
      mesLabel: MES_LABELS[mes - 1],
      linha,
      planejado: Number(row?.planejado || 0),
      realizado: row?.realizado ?? null,
      orcado: Number(row?.orcado || 0),
      atingimento: row?.atingimento ?? null,
    })
  }

  return result
}

function getPctMax(data: ChartPoint[]) {
  const values = data
    .map((item) => Number(item.atingimento))
    .filter((item) => !Number.isNaN(item) && item > 0)

  if (!values.length) return 110

  const max = Math.max(...values)
  return Math.max(110, Math.ceil(max / 10) * 10 + 10)
}

const PlannedLabel = (props: any) => {
  const { x, y, width, value } = props

  if (!value || Number(value) <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fontSize={10}
      fontWeight={600}
      fill="#6B7280"
    >
      {fmt(value)}
    </text>
  )
}

const RealizedLabel = (props: any) => {
  const { x, y, width, height, value } = props

  if (value === null || value === undefined || Number(value) <= 0) return null

  const inside = height >= 22

  return (
    <text
      x={x + width / 2}
      y={inside ? y + Math.min(height / 2 + 4, 20) : y - 8}
      textAnchor="middle"
      fontSize={10}
      fontWeight={700}
      fill={inside ? "#FFFFFF" : COR_REAL}
    >
      {fmt(value)}
    </text>
  )
}

const MetaMarker = (props: any) => {
  const { cx, cy, payload, showOrcado } = props

  if (!showOrcado) return null
  if (!payload || payload.orcado === null || payload.orcado === undefined) return null
  if (Number(payload.orcado) <= 0) return null

  const mes = Number(payload?.mes)

  let labelX = cx + 30
  let labelY = cy + 4
  let textAnchor: "start" | "end" = "start"

  if (mes >= 11) {
    labelX = cx - 30
    textAnchor = "end"
  }

  if (mes === 9) {
    labelX = cx - 30
    labelY = cy - 6
    textAnchor = "end"
  }

  if (mes === 10) {
    labelX = cx + 30
    labelY = cy + 14
    textAnchor = "start"
  }

  return (
    <g>
      <line
        x1={cx - 24}
        y1={cy}
        x2={cx + 24}
        y2={cy}
        stroke={COR_ORCADO}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        fontSize={10}
        fontWeight={700}
        fill={COR_ORCADO}
      >
        {fmt(payload.orcado)}
      </text>
    </g>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null

  const row = payload[0]?.payload as ChartPoint

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: "0 8px 20px rgba(0,0,0,0.10)",
        fontSize: 12,
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: 8,
        }}
      >
        {label} · {row?.linha}
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>Planejado</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmt(row?.planejado)} cx</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>Realizado</span>
          <strong style={{ color: "var(--text-primary)" }}>
            {row?.realizado !== null ? `${fmt(row?.realizado)} cx` : "-"}
          </strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>Orçado</span>
          <strong style={{ color: COR_ORCADO }}>{fmt(row?.orcado)} cx</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>% Atingimento</span>
          <strong style={{ color: corPct(row?.atingimento) }}>
            {row?.atingimento !== null ? fmtPct(row?.atingimento) : "-"}
          </strong>
        </div>
      </div>
    </div>
  )
}

function PercentBand({ data }: { data: ChartPoint[] }) {
  const pctMax = getPctMax(data)

  const points = data
    .map((item, index) => {
      if (item.atingimento === null || item.atingimento === undefined) return null

      const x = (index + 0.5) * 100
      const pct = Math.min(Number(item.atingimento), pctMax)
      const y = 38 - (pct / pctMax) * 20

      return {
        x,
        y,
        value: item.atingimento,
      }
    })
    .filter(Boolean) as { x: number; y: number; value: number }[]

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ")

  return (
    <div
      style={{
        height: 48,
        marginLeft: Y_AXIS_WIDTH + CHART_LEFT,
        marginRight: CHART_RIGHT,
        position: "relative",
      }}
    >
      <svg
        viewBox="0 0 1200 48"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {points.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke={COR_ATINGIMENTO}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={4}
            fill={COR_ATINGIMENTO}
          />
        ))}
      </svg>

      {points.map((point, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: `${point.x / 12}%`,
            top: point.y - 22,
            transform: "translateX(-50%)",
            fontSize: 11,
            fontWeight: 700,
            color: corPct(point.value),
            whiteSpace: "nowrap",
          }}
        >
          {fmtPct(point.value)}
        </div>
      ))}
    </div>
  )
}

function LinhaChart({
  titulo,
  data,
  showOrcado,
}: {
  titulo: string
  data: ChartPoint[]
  showOrcado: boolean
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 18px 8px",
        background: "var(--bg-primary)",
        minWidth: 0,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.25,
            fontWeight: 700,
            color: COR_REAL,
          }}
        >
          {titulo}
        </p>

        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.25,
            fontWeight: 600,
            color: COR_REAL,
          }}
        >
          Volume em Caixas
        </p>
      </div>

      <PercentBand data={data} />

      <div style={{ height: 245 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 18, right: CHART_RIGHT, left: CHART_LEFT, bottom: 10 }}
            barCategoryGap={18}
            barGap={-42}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

            <XAxis
              dataKey="mesLabel"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6B7280" }}
              interval={0}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#6B7280" }}
              tickFormatter={(value) => fmt(Number(value))}
              width={Y_AXIS_WIDTH}
              domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.28)]}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(39,51,109,0.04)" }} />

            <Bar
              dataKey="planejado"
              fill={COR_PLANEJADO}
              radius={[6, 6, 0, 0]}
              barSize={50}
              isAnimationActive={false}
            >
              <LabelList content={PlannedLabel} />
            </Bar>

            <Bar
              dataKey="realizado"
              fill={COR_REAL}
              radius={[6, 6, 0, 0]}
              barSize={38}
              isAnimationActive={false}
            >
              <LabelList content={RealizedLabel} />
            </Bar>

            <Line
              type="linear"
              dataKey="orcado"
              stroke="transparent"
              dot={<MetaMarker showOrcado={showOrcado} />}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LegendToggleItem({
  active,
  onClick,
  children,
  marker,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  marker: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        opacity: active ? 1 : 0.45,
      }}
      title={active ? "Clique para ocultar" : "Clique para mostrar"}
    >
      {marker}
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {children}
      </span>
    </button>
  )
}

export function ProjecaoLiberacoesModal({ open, onClose }: Props) {
  const [data, setData] = useState<ProjecaoLiberacoesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [showOrcado, setShowOrcado] = useState(true)

  useEffect(() => {
    if (!open) return

    setLoading(true)

    getProjecaoLiberacoes()
      .then((response: unknown) => {
        setData(response as ProjecaoLiberacoesResponse)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }

    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  const linha1Data = useMemo(() => {
    if (!data?.linhas?.length) return []
    return buildLinhaData(data, "L1")
  }, [data])

  const linha2Data = useMemo(() => {
    if (!data?.linhas?.length) return []
    return buildLinhaData(data, "L2")
  }, [data])

  if (!open) return null

  const totalRealTb = data ? data.total_real * TUBETES_POR_CAIXA : 0
  const totalPrevistoTb = data ? data.total_previsto * TUBETES_POR_CAIXA : 0
  const totalProjetadoTb = data ? data.total_projetado * TUBETES_POR_CAIXA : 0

  return createPortal(
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(4px)",
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <div
        className="fade-in"
        style={{
          width: "100%",
          maxWidth: 1460,
          maxHeight: "95vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "20px 28px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Liberações Reais + Previstas 2026
            </h2>

            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Comparativo por linha: planejado, realizado, orçado e atingimento mensal.
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              padding: 4,
              display: "flex",
              borderRadius: 6,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 220,
                color: "var(--text-secondary)",
                fontSize: 14,
              }}
            >
              Carregando...
            </div>
          ) : !data ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 220,
                color: "var(--text-secondary)",
                fontSize: 14,
              }}
            >
              Não foi possível carregar os dados.
            </div>
          ) : !data.linhas?.length ? (
            <div
              style={{
                padding: 16,
                borderRadius: 10,
                border: "1px solid #F2C94C",
                background: "#FFF8E1",
                color: "#B45309",
                fontSize: 14,
              }}
            >
              O endpoint /overview/projecao-liberacoes ainda não está retornando a quebra por linhas.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>
                    Realizado
                  </p>

                  <p style={{ fontSize: 22, fontWeight: 700, color: COR_REAL, margin: 0, lineHeight: 1 }}>
                    {fmt(data.total_real)} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                  </p>

                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {fmt(totalRealTb)} tb
                  </p>
                </div>

                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>
                    Previsto
                  </p>

                  <p style={{ fontSize: 22, fontWeight: 700, color: "#4E67A7", margin: 0, lineHeight: 1 }}>
                    {fmt(data.total_previsto)} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                  </p>

                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {fmt(totalPrevistoTb)} tb
                  </p>
                </div>

                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>
                    Projeção
                  </p>

                  <p style={{ fontSize: 22, fontWeight: 700, color: corPct(data.pct_atingimento), margin: 0, lineHeight: 1 }}>
                    {fmt(data.total_projetado)} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                  </p>

                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {fmt(totalProjetadoTb)} tb · {fmtPct(data.pct_atingimento)} do orçado
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <p className="card-label" style={{ marginBottom: 12, display: "block" }}>
                  Evolução mensal por linha em caixas
                </p>

                <div style={{ display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 12, borderRadius: 3, background: COR_PLANEJADO }} />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Planejado
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 12, borderRadius: 3, background: COR_REAL }} />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Realizado
                    </span>
                  </div>

                  <LegendToggleItem
                    active={showOrcado}
                    onClick={() => setShowOrcado((prev) => !prev)}
                    marker={
                      <svg width="24" height="8">
                        <line
                          x1="2"
                          y1="4"
                          x2="22"
                          y2="4"
                          stroke={COR_ORCADO}
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                    }
                  >
                    Orçado
                  </LegendToggleItem>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <svg width="26" height="10">
                      <line
                        x1="2"
                        y1="5"
                        x2="24"
                        y2="5"
                        stroke={COR_ATINGIMENTO}
                        strokeWidth="2"
                      />
                      <circle cx="13" cy="5" r="3.5" fill={COR_ATINGIMENTO} />
                    </svg>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      % Ating. Real vs. Planejado
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                  <LinhaChart
                    titulo="Linha 1 — Realizado vs. Planejado vs. Orçado"
                    data={linha1Data}
                    showOrcado={showOrcado}
                  />
                  <LinhaChart
                    titulo="Linha 2 — Realizado vs. Planejado vs. Orçado"
                    data={linha2Data}
                    showOrcado={showOrcado}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  background: "var(--bg-primary)",
                }}
              >
                Valores principais em caixas. Referência: 1 caixa contém 500 tubetes.
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}