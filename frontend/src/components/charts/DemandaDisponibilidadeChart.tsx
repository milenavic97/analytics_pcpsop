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
  entradas_linhas?: { L1?: number; L2?: number } | null
  entradas_real_mes_atual?: number | null
  entradas_real_mes_atual_linhas?: { L1?: number; L2?: number } | null
  saidas: number
  saidas_tipo: "real" | "forecast"
  saidas_real_mes_atual?: number | null
  saidas_real_mes_atual_por_grupo?: EstoqueGrupo[] | null
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
  entradas_real: number | null
  entradas_real_l1: number | null
  entradas_real_l2: number | null
  entradas_real_mes_atual_plot: number | null
  entradas_real_mes_atual_l1: number | null
  entradas_real_mes_atual_l2: number | null
  entradas_previstas: number | null
  entradas_previstas_l1: number | null
  entradas_previstas_l2: number | null
  saidas_real: number | null
  saidas_real_mes_atual_plot: number | null
  saidas_forecast: number | null
  saidas_forecast_label: number | null
}

type LegendKey =
  | "estoque_inicio"
  | "entradas_real"
  | "entradas_real_mes_atual"
  | "entradas_previstas"
  | "disponibilidade_total"
  | "saidas_real"
  | "saidas_real_mes_atual"
  | "saidas_forecast"

const COR_ESTOQUE = "#27336D"
const COR_ESTOQUE_PROJETADO = "#34477F"
const COR_ENTRADA_REAL = "#7CB8D4"
const COR_ENTRADA_REAL_L2 = "#B9D9E8"
const COR_ENTRADA_REAL_MES_ATUAL = "#5BAEDB"
const COR_ENTRADA_REAL_MES_ATUAL_L2 = "#A7D3EA"
const COR_ENTRADA_PREVISTA = "#BFC5CD"
const COR_ENTRADA_PREVISTA_L2 = "#D8DCE2"
const COR_SAIDA_REAL = "#4F8F75"
const COR_SAIDA_REAL_MES_ATUAL = "#2F7D5F"
const COR_FORECAST = "#EF5A5A"
const COR_GRID = "#E5E7EB"
const COR_TEXTO = "#6B7280"

const BAR_SIZE = 52

function fmt(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n || 0)))
}

function positiveOrNull(value: number) {
  return value > 0 ? value : null
}

function toChartData(data: DisponibilidadeResponse | null): ChartPoint[] {
  if (!data?.meses?.length) return []

  return data.meses.map((row) => {
    const isForecast = row.saidas_tipo === "forecast"

    const entradaRealMesAtual = Number(row.entradas_real_mes_atual || 0)
    const entradaRealMesAtualL1 = Number(row.entradas_real_mes_atual_linhas?.L1 || 0)
    const entradaRealMesAtualL2 = Number(row.entradas_real_mes_atual_linhas?.L2 || 0)

    const entradaL1 = Number(row.entradas_linhas?.L1 || 0)
    const entradaL2 = Number(row.entradas_linhas?.L2 || 0)

    const saidaRealMesAtual = Number(row.saidas_real_mes_atual || 0)

    return {
      ...row,
      entradas_real: row.entradas_tipo === "real" ? row.entradas : null,
      entradas_real_l1: row.entradas_tipo === "real" ? positiveOrNull(entradaL1) : null,
      entradas_real_l2: row.entradas_tipo === "real" ? positiveOrNull(entradaL2) : null,
      entradas_real_mes_atual_plot: entradaRealMesAtual > 0 ? entradaRealMesAtual : null,
      entradas_real_mes_atual_l1: positiveOrNull(entradaRealMesAtualL1),
      entradas_real_mes_atual_l2: positiveOrNull(entradaRealMesAtualL2),
      entradas_previstas: row.entradas_tipo === "previsto" ? row.entradas : null,
      entradas_previstas_l1: row.entradas_tipo === "previsto" ? positiveOrNull(entradaL1) : null,
      entradas_previstas_l2: row.entradas_tipo === "previsto" ? positiveOrNull(entradaL2) : null,
      saidas_real: row.saidas_tipo === "real" ? row.saidas : null,
      saidas_real_mes_atual_plot: saidaRealMesAtual > 0 ? saidaRealMesAtual : null,
      saidas_forecast: isForecast ? row.saidas : null,
      saidas_forecast_label: isForecast ? row.saidas : null,
    }
  })
}

const EstoqueLabel = ({ x, y, width, height, value }: any) => {
  if (value === null || value === undefined || Number(value) <= 0) return null
  if (height < 18) return null
  return (
    <text x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#FFFFFF">
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
      textAnchor="middle" fontSize={10} fontWeight={700} fill="#4B5563"
    >
      {fmt(entradas)}
    </text>
  )
}

const EntradaRealMesAtualLabel = ({ x, y, width, height, value }: any) => {
  const entradas = Number(value || 0)
  if (entradas <= 0) return null
  const inside = height >= 20
  return (
    <text
      x={x + width / 2}
      y={inside ? y + height / 2 + 4 : y - 8}
      textAnchor="middle" fontSize={10} fontWeight={800}
      fill={inside ? "#FFFFFF" : COR_ENTRADA_REAL_MES_ATUAL}
    >
      {fmt(entradas)}
    </text>
  )
}

const DisponibilidadeTotalLabel = ({ x, y, width, value }: any) => {
  const total = Number(value || 0)
  if (total <= 0) return null
  return (
    <text x={x + width / 2} y={y - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill="#5B6472">
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
    const width = Math.max(42, text.length * 7 + 12)
    return (
      <g>
        <rect x={x - width / 2} y={y - 28} width={width} height={22} rx={5} fill={color} />
        <text x={x} y={y - 13} textAnchor="middle" fontSize={10} fontWeight={700} fill="#FFFFFF">
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

  const entradaRealMesAtual = Number(row.entradas_real_mes_atual || 0)
  const entradasL1 = Number(row.entradas_linhas?.L1 || 0)
  const entradasL2 = Number(row.entradas_linhas?.L2 || 0)
  const entradasAtualL1 = Number(row.entradas_real_mes_atual_linhas?.L1 || 0)
  const entradasAtualL2 = Number(row.entradas_real_mes_atual_linhas?.L2 || 0)

  const saidaRealMesAtual = Number(row.saidas_real_mes_atual || 0)

  return (
    <div style={{
      background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12,
      padding: "12px 14px", boxShadow: "0 10px 26px rgba(0,0,0,0.12)", fontSize: 12,
      width: "min(360px, calc(100vw - 40px))",
    }}>
      <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 10 }}>{label}/26</div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>Estoque início ({row.estoque_inicio_tipo})</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmt(row.estoque_inicio)} cx</strong>
        </div>

        {grupos.length > 0 ? (
          <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", display: "grid", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Composição do estoque inicial
            </div>
            {grupos.slice(0, 8).map((item) => (
              <div key={item.grupo} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ color: "var(--text-secondary)" }}>{item.grupo}</span>
                <strong style={{ color: "var(--text-primary)" }}>
                  {fmt(item.qtd_caixas)} cx · {item.pct.toFixed(1).replace(".", ",")}%
                </strong>
              </div>
            ))}
            {grupos.length > 8 && (
              <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>+ {grupos.length - 8} grupos restantes</div>
            )}
            {Math.round(totalGrupos) !== Math.round(row.estoque_inicio) && (
              <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                Composição parcial por diferença de arredondamento/cadastro.
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 11 }}>
            Composição por grupo indisponível para estoque projetado.
          </div>
        )}

        <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border)", display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Entradas ({row.entradas_tipo})</span>
            <strong style={{ color: "var(--text-primary)" }}>{fmt(row.entradas)} cx</strong>
          </div>

          {(entradasL1 > 0 || entradasL2 > 0) && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11, color: "var(--text-secondary)" }}>
              <span>Abertura por linha</span>
              <strong style={{ color: "var(--text-primary)" }}>L1 {fmt(entradasL1)} cx · L2 {fmt(entradasL2)} cx</strong>
            </div>
          )}

          {entradaRealMesAtual > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ color: "var(--text-secondary)" }}>Entradas realizadas no mês atual</span>
                <strong style={{ color: COR_ENTRADA_REAL_MES_ATUAL }}>{fmt(entradaRealMesAtual)} cx</strong>
              </div>
              {(entradasAtualL1 > 0 || entradasAtualL2 > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11, color: "var(--text-secondary)" }}>
                  <span>Realizado atual por linha</span>
                  <strong style={{ color: COR_ENTRADA_REAL_MES_ATUAL }}>
                    L1 {fmt(entradasAtualL1)} cx · L2 {fmt(entradasAtualL2)} cx
                  </strong>
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Saídas ({row.saidas_tipo})</span>
            <strong style={{ color: row.saidas_tipo === "real" ? COR_SAIDA_REAL : COR_FORECAST }}>{fmt(row.saidas)} cx</strong>
          </div>

          {saidaRealMesAtual > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span style={{ color: "var(--text-secondary)" }}>Saídas realizadas no mês atual</span>
              <strong style={{ color: COR_SAIDA_REAL_MES_ATUAL }}>{fmt(saidaRealMesAtual)} cx</strong>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Disponibilidade total</span>
            <strong style={{ color: "var(--text-primary)" }}>{fmt(row.disponibilidade_total)} cx</strong>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "var(--text-secondary)" }}>Saldo final projetado</span>
            <strong style={{ color: row.saldo_final < 0 ? COR_FORECAST : "var(--text-primary)" }}>{fmt(row.saldo_final)} cx</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label, hidden, line = false, dashed = false, onClick }: {
  color: string; label: string; hidden: boolean; line?: boolean; dashed?: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} title={hidden ? `Mostrar ${label}` : `Ocultar ${label}`}
      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-all md:text-xs"
      style={{
        borderColor: hidden ? "var(--border)" : "rgba(39,51,109,0.18)",
        background: hidden ? "var(--bg-primary)" : "rgba(39,51,109,0.035)",
        opacity: hidden ? 0.42 : 1,
        textDecoration: hidden ? "line-through" : "none",
      }}
    >
      {line ? (
        <svg width="24" height="10">
          <line
            x1="2"
            y1="5"
            x2="22"
            y2="5"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={dashed ? "5 4" : undefined}
          />
        </svg>
      ) : (
        <span style={{ width: 12, height: 11, borderRadius: 3, background: color }} />
      )}
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
    </button>
  )
}

export function DemandaDisponibilidadeChart() {
  const [data, setData] = useState<DisponibilidadeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [separarEntradasPorLinha, setSepararEntradasPorLinha] = useState(false)
  const [hidden, setHidden] = useState<Record<LegendKey, boolean>>({
    estoque_inicio: false,
    entradas_real: false,
    entradas_real_mes_atual: false,
    entradas_previstas: false,
    disponibilidade_total: false,
    saidas_real: false,
    saidas_real_mes_atual: false,
    saidas_forecast: false,
  })

  function toggleLegend(key: LegendKey) {
    setHidden((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const chartData = useMemo(() => toChartData(data), [data])

  if (loading) {
    return (
      <div className="card flex h-64 items-center justify-center p-6 text-sm md:h-72" style={{ color: "var(--text-secondary)" }}>
        Carregando disponibilidade...
      </div>
    )
  }

  if (error || !chartData.length) {
    return (
      <div className="card flex h-64 items-center justify-center p-6 text-center text-sm md:h-72" style={{ color: "var(--text-secondary)" }}>
        {error || "Disponível após carga das bases de estoque, entradas e forecast"}
      </div>
    )
  }

  return (
    <div className="card p-4 md:p-6">
      <div className="mb-4 text-center">
        <h3 className="text-base font-medium md:text-xl" style={{ margin: 0, color: "var(--text-secondary)" }}>
          Demanda vs. Disponibilidade <strong>mensal</strong>
        </h3>
      </div>

      <div className="mb-4 flex flex-wrap justify-center gap-2 md:gap-3">
        <LegendItem color={COR_ESTOQUE} label="Estoque início" hidden={hidden.estoque_inicio} onClick={() => toggleLegend("estoque_inicio")} />
        <LegendItem color={COR_ENTRADA_REAL} label="Entradas reais" hidden={hidden.entradas_real} onClick={() => toggleLegend("entradas_real")} />
        <LegendItem color={COR_ENTRADA_REAL_MES_ATUAL} label="Mês atual" hidden={hidden.entradas_real_mes_atual} onClick={() => toggleLegend("entradas_real_mes_atual")} />
        <LegendItem color={COR_ENTRADA_PREVISTA} label="Projetadas" hidden={hidden.entradas_previstas} onClick={() => toggleLegend("entradas_previstas")} />
        <LegendItem color="#5B6472" label="Disponibilidade" hidden={hidden.disponibilidade_total} onClick={() => toggleLegend("disponibilidade_total")} />
        <LegendItem color={COR_SAIDA_REAL} label="Saídas reais" hidden={hidden.saidas_real} line onClick={() => toggleLegend("saidas_real")} />
        <LegendItem color={COR_SAIDA_REAL_MES_ATUAL} label="Saídas mês atual" hidden={hidden.saidas_real_mes_atual} line dashed onClick={() => toggleLegend("saidas_real_mes_atual")} />
        <LegendItem color={COR_FORECAST} label="Forecast" hidden={hidden.saidas_forecast} line onClick={() => toggleLegend("saidas_forecast")} />
      </div>

      <div className="mb-3 flex justify-center">
        <button type="button" onClick={() => setSepararEntradasPorLinha((prev) => !prev)}
          className="rounded-full border px-3 py-1.5 text-xs font-bold"
          style={{
            borderColor: "var(--border)",
            background: separarEntradasPorLinha ? "rgba(39,51,109,0.08)" : "var(--bg-secondary)",
            color: separarEntradasPorLinha ? COR_ESTOQUE : "var(--text-secondary)",
          }}
        >
          {separarEntradasPorLinha ? "✓ Entradas por linha" : "Separar entradas por linha"}
        </button>
      </div>

      {separarEntradasPorLinha && (
        <div className="mb-4 grid justify-center gap-2 text-[11px] md:text-xs">
          <div className="flex flex-wrap justify-center gap-3 md:gap-5">
            <div className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 12, borderRadius: 3, background: COR_ENTRADA_REAL }} />
              <span style={{ color: "var(--text-secondary)" }}>Reais · L1</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 12, borderRadius: 3, background: COR_ENTRADA_REAL_L2, border: "1px solid rgba(107,114,128,0.14)" }} />
              <span style={{ color: "var(--text-secondary)" }}>Reais · L2</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 12, borderRadius: 3, background: COR_ENTRADA_PREVISTA }} />
              <span style={{ color: "var(--text-secondary)" }}>Projetadas · L1</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 12, borderRadius: 3, background: COR_ENTRADA_PREVISTA_L2, border: "1px solid rgba(107,114,128,0.18)" }} />
              <span style={{ color: "var(--text-secondary)" }}>Projetadas · L2</span>
            </div>
          </div>
        </div>
      )}

      <div className="h-[320px] md:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 34, right: 24, left: 4, bottom: 20 }}
            barCategoryGap={22}
            barGap={-52}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
            <XAxis dataKey="mes_label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: COR_TEXTO }} interval={0} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: COR_TEXTO }}
              tickFormatter={(value) => fmt(Number(value))} width={58}
              domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.16)]} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(39,51,109,0.04)" }} />

            {!hidden.estoque_inicio && (
              <Bar dataKey="estoque_inicio" name="Estoque início do mês" stackId="disponibilidade"
                radius={[0, 0, 4, 4]} barSize={BAR_SIZE} isAnimationActive={false}>
                {chartData.map((entry) => (
                  <Cell key={`estoque-${entry.mes}`} fill={entry.estoque_inicio_tipo === "real" ? COR_ESTOQUE : COR_ESTOQUE_PROJETADO} />
                ))}
                <LabelList dataKey="estoque_inicio" content={EstoqueLabel} />
              </Bar>
            )}

            {!hidden.entradas_real && !separarEntradasPorLinha && (
              <Bar dataKey="entradas_real" name="Entradas reais" stackId="disponibilidade"
                radius={[6, 6, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_REAL} isAnimationActive={false}>
                <LabelList dataKey="entradas_real" content={EntradaSegmentLabel} />
                {!hidden.disponibilidade_total && (
                  <LabelList dataKey="disponibilidade_total" content={DisponibilidadeTotalLabel} />
                )}
              </Bar>
            )}

            {!hidden.entradas_real && separarEntradasPorLinha && (
              <Bar dataKey="entradas_real_l1" name="Entradas reais L1" stackId="disponibilidade"
                radius={[0, 0, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_REAL} isAnimationActive={false}>
                <LabelList dataKey="entradas_real_l1" content={EntradaSegmentLabel} />
              </Bar>
            )}

            {!hidden.entradas_real && separarEntradasPorLinha && (
              <Bar dataKey="entradas_real_l2" name="Entradas reais L2" stackId="disponibilidade"
                radius={[6, 6, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_REAL_L2} isAnimationActive={false}>
                <LabelList dataKey="entradas_real_l2" content={EntradaSegmentLabel} />
                {!hidden.disponibilidade_total && (
                  <LabelList dataKey="disponibilidade_total" content={DisponibilidadeTotalLabel} />
                )}
              </Bar>
            )}

            {!hidden.entradas_previstas && !separarEntradasPorLinha && (
              <Bar dataKey="entradas_previstas" name="Entradas projetadas" stackId="disponibilidade"
                radius={[6, 6, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_PREVISTA} isAnimationActive={false}>
                <LabelList dataKey="entradas_previstas" content={EntradaSegmentLabel} />
                {!hidden.disponibilidade_total && (
                  <LabelList dataKey="disponibilidade_total" content={DisponibilidadeTotalLabel} />
                )}
              </Bar>
            )}

            {!hidden.entradas_previstas && separarEntradasPorLinha && (
              <Bar dataKey="entradas_previstas_l1" name="Entradas projetadas L1" stackId="disponibilidade"
                radius={[0, 0, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_PREVISTA} isAnimationActive={false}>
                <LabelList dataKey="entradas_previstas_l1" content={EntradaSegmentLabel} />
              </Bar>
            )}

            {!hidden.entradas_previstas && separarEntradasPorLinha && (
              <Bar dataKey="entradas_previstas_l2" name="Entradas projetadas L2" stackId="disponibilidade"
                radius={[6, 6, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_PREVISTA_L2} isAnimationActive={false}>
                <LabelList dataKey="entradas_previstas_l2" content={EntradaSegmentLabel} />
                {!hidden.disponibilidade_total && (
                  <LabelList dataKey="disponibilidade_total" content={DisponibilidadeTotalLabel} />
                )}
              </Bar>
            )}

            {!hidden.entradas_real_mes_atual && !separarEntradasPorLinha && (
              <Bar dataKey="entradas_real_mes_atual_plot" name="Entradas realizadas no mês atual"
                radius={[6, 6, 0, 0]} barSize={BAR_SIZE} fill={COR_ENTRADA_REAL_MES_ATUAL} isAnimationActive={false}>
                <LabelList dataKey="entradas_real_mes_atual_plot" content={EntradaRealMesAtualLabel} />
              </Bar>
            )}

            {!hidden.entradas_real_mes_atual && separarEntradasPorLinha && (
              <Bar dataKey="entradas_real_mes_atual_l1" name="Entradas realizadas no mês atual L1"
                stackId="real-mes-atual" radius={[0, 0, 0, 0]} barSize={BAR_SIZE}
                fill={COR_ENTRADA_REAL_MES_ATUAL} isAnimationActive={false}>
                <LabelList dataKey="entradas_real_mes_atual_l1" content={EntradaRealMesAtualLabel} />
              </Bar>
            )}

            {!hidden.entradas_real_mes_atual && separarEntradasPorLinha && (
              <Bar dataKey="entradas_real_mes_atual_l2" name="Entradas realizadas no mês atual L2"
                stackId="real-mes-atual" radius={[6, 6, 0, 0]} barSize={BAR_SIZE}
                fill={COR_ENTRADA_REAL_MES_ATUAL_L2} isAnimationActive={false}>
                <LabelList dataKey="entradas_real_mes_atual_l2" content={EntradaRealMesAtualLabel} />
              </Bar>
            )}

            {!hidden.saidas_real && (
              <Line type="monotone" dataKey="saidas_real" stroke={COR_SAIDA_REAL} strokeWidth={3}
                dot={{ r: 4, fill: COR_SAIDA_REAL, strokeWidth: 0 }} activeDot={{ r: 5 }}
                connectNulls={false} isAnimationActive={false}>
                <LabelList content={LineLabel(COR_SAIDA_REAL)} />
              </Line>
            )}

            {!hidden.saidas_real_mes_atual && (
              <Line type="monotone" dataKey="saidas_real_mes_atual_plot" stroke={COR_SAIDA_REAL_MES_ATUAL} strokeWidth={3}
                strokeDasharray="6 5"
                dot={{ r: 5, fill: COR_SAIDA_REAL_MES_ATUAL, strokeWidth: 0 }} activeDot={{ r: 6 }}
                connectNulls={false} isAnimationActive={false}>
                <LabelList content={LineLabel(COR_SAIDA_REAL_MES_ATUAL)} />
              </Line>
            )}

            {!hidden.saidas_forecast && (
              <Line type="monotone" dataKey="saidas_forecast" stroke={COR_FORECAST} strokeWidth={3}
                dot={{ r: 4, fill: COR_FORECAST, strokeWidth: 0 }} activeDot={{ r: 5 }}
                connectNulls={false} isAnimationActive={false}>
                <LabelList content={LineLabel(COR_FORECAST, "saidas_forecast_label")} />
              </Line>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
