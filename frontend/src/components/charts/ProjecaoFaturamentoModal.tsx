import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { getProjecaoFaturamento } from "@/services/api"
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from "recharts"

interface Props { open: boolean; onClose: () => void }

interface MesData {
  mes: number
  real: number | null
  forecast: number | null
  orcado: number
}

interface ProjecaoData {
  meses: MesData[]
  total_real: number
  total_forecast: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  ultimo_mes_fechado: number
}

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

const COR_REAL     = "#27336D"
const COR_PREVISTO = "#5B6FAE"
const COR_ORCADO   = "#DC632E"
const COR_VERDE    = "#2E7C31"
const COR_AMARELO  = "#CA8A04"
const COR_VERMELHO = "#C3272A"

function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function fmtPct(n: number) {
  return n.toFixed(1).replace(".", ",") + "%"
}

interface ChartPoint {
  mes: string
  real: number | null
  previsto: number | null
  orcado: number
  _junction: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const seen = new Set<string>()
  const items = payload.filter((p: { dataKey: string; value: number | null }) => {
    if (p.value === null || p.value === undefined) return false
    if (seen.has(p.dataKey)) return false
    seen.add(p.dataKey)
    return true
  })
  return (
    <div style={{
      background: "var(--bg-secondary)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "10px 14px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontSize: 12, minWidth: 200,
    }}>
      <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{label}</p>
      {items.map((p: { name: string; value: number; color?: string; stroke?: string }, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color || p.stroke || "#000", flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)", flex: 1 }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{fmt(p.value)} cx</span>
        </div>
      ))}
    </div>
  )
}

export function ProjecaoFaturamentoModal({ open, onClose }: Props) {
  const [data, setData]           = useState<ProjecaoData | null>(null)
  const [showOrcado, setShowOrcado] = useState(true)

  useEffect(() => {
    if (open && !data) {
      getProjecaoFaturamento()
        .then((d: unknown) => setData(d as ProjecaoData))
        .catch(console.error)
    }
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  if (!open) return null

  // Monta chartData marcando o ponto de junção (último mês real que recebe valor de previsto pra continuidade da linha)
  const chartData: ChartPoint[] = data ? data.meses.map((m, idx) => {
    const proximo = data.meses[idx + 1]
    const isJunction = m.real !== null && proximo?.forecast !== null && m.forecast === null
    return {
      mes:      MES_LABELS[m.mes - 1],
      real:     m.real,
      previsto: isJunction ? m.real : m.forecast,
      orcado:   m.orcado,
      _junction: isJunction,
    }
  }) : []

  const pct      = data?.pct_atingimento ?? 0
  const delta    = data?.delta_caixas ?? 0
  const atingCor = pct >= 100 ? COR_VERDE : pct >= 95 ? COR_AMARELO : pct > 0 ? COR_VERMELHO : "#111827"
  const maxRef   = data ? Math.max(data.total_orcado, data.total_projetado) : 1
  const ultimoMesFechado = data?.ultimo_mes_fechado ?? 0

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, backdropFilter: "blur(4px)", background: "rgba(0,0,0,0.4)",
      }}
    >
      <div
        className="fade-in"
        style={{
          width: "100%", maxWidth: 1080, maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "20px 28px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Faturamento Real + S&OP 2026
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Vendas reais (SD2) até o mês fechado · Forecast S&OP do mês corrente em diante
            </p>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-secondary)", padding: 4, display: "flex", borderRadius: 6,
          }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {!data ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--text-secondary)", fontSize: 14 }}>
              Carregando...
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                {[
                  {
                    label: "Real (SD2)",
                    value: fmt(data.total_real),
                    sub: ultimoMesFechado > 0
                      ? `jan – ${MES_LABELS[ultimoMesFechado - 1]} (fechado)`
                      : "sem mês fechado",
                    cor: COR_REAL,
                  },
                  {
                    label: "Previsto (S&OP)",
                    value: fmt(data.total_forecast),
                    sub: ultimoMesFechado < 12
                      ? `${MES_LABELS[ultimoMesFechado]} – Dez (forecast)`
                      : "ano completo realizado",
                    cor: COR_PREVISTO,
                  },
                  {
                    label: "Total projetado",
                    value: fmt(data.total_projetado),
                    sub: `${fmtPct(pct)} do orçado · ${delta >= 0 ? "+" : ""}${fmt(delta)} cx`,
                    cor: atingCor,
                  },
                ].map(k => (
                  <div key={k.label} style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>{k.label}</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: k.cor, margin: 0, lineHeight: 1 }}>
                      {k.value} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Comparativo horizontal */}
              <div style={{ marginBottom: 24 }}>
                <p className="card-label" style={{ marginBottom: 12, display: "block" }}>Orçado vs. Projeção</p>
                {[
                  { label: "Orçado", total: data.total_orcado, segmentos: [{ valor: data.total_orcado, cor: COR_ORCADO }] },
                  { label: "Projeção", total: data.total_projetado, segmentos: [{ valor: data.total_real, cor: COR_REAL }, { valor: data.total_forecast, cor: COR_PREVISTO }] },
                ].map(b => (
                  <div key={b.label} style={{ display: "grid", gridTemplateColumns: "120px 1fr 130px", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", textAlign: "right" }}>{b.label}</span>
                    <div style={{ background: "var(--bg-primary)", borderRadius: 6, height: 24, overflow: "hidden", display: "flex" }}>
                      {b.segmentos.map((s, i) => (
                        <div key={i} style={{
                          width: `${(s.valor / maxRef) * 100}%`,
                          height: "100%", background: s.cor,
                          borderRadius: i === 0 ? "6px 0 0 6px" : 0,
                          transition: "width 0.4s ease",
                        }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{fmt(b.total)}</span> cx
                      {b.label === "Projeção" && <span style={{ marginLeft: 4, color: atingCor, fontWeight: 600 }}>{fmtPct(pct)}</span>}
                    </span>
                  </div>
                ))}
              </div>

              {/* Gráfico mensal */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <p className="card-label" style={{ display: "block", margin: 0 }}>Evolução mensal</p>
                  <button
                    onClick={() => setShowOrcado(v => !v)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: "var(--bg-primary)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 500,
                      color: "var(--text-secondary)", cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 14, height: 2, background: COR_ORCADO, borderRadius: 1, opacity: showOrcado ? 1 : 0.3 }} />
                    {showOrcado ? "Ocultar orçado" : "Mostrar orçado"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" }}>
                  {[
                    { cor: COR_REAL,     label: "Real (SD2)",        tipo: "bar"  },
                    { cor: COR_PREVISTO, label: "Previsto (S&OP)",   tipo: "line" },
                    ...(showOrcado ? [{ cor: COR_ORCADO, label: "Orçado (referência)", tipo: "dash" }] : []),
                  ].map(l => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {l.tipo === "bar"  && <span style={{ width: 14, height: 12, borderRadius: 3, background: l.cor }} />}
                      {l.tipo === "line" && <span style={{ width: 14, height: 2, background: l.cor, borderRadius: 1 }} />}
                      {l.tipo === "dash" && (
                        <svg width="18" height="6">
                          <line x1="0" y1="3" x2="18" y2="3" stroke={l.cor} strokeWidth="2" strokeDasharray="4 3" />
                        </svg>
                      )}
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{l.label}</span>
                    </div>
                  ))}
                </div>

                <div style={{ height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 32, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} width={60} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(39,51,109,0.04)" }} />

                      <Bar dataKey="real" name="Real" fill={COR_REAL} radius={[4,4,0,0]} maxBarSize={52}>
                        <LabelList
                          dataKey="real"
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          content={(props: any) => {
                            const { x, y, width, value } = props
                            if (!value) return null
                            return (
                              <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill={COR_REAL}>
                                {fmt(value)}
                              </text>
                            )
                          }}
                        />
                      </Bar>

                      {showOrcado && (
                        <Line type="monotone" dataKey="orcado" name="Orçado" stroke={COR_ORCADO}
                          strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={false} />
                      )}

                      <Line type="monotone" dataKey="previsto" name="Previsto" stroke={COR_PREVISTO}
                        strokeWidth={3} connectNulls dot={{ fill: COR_PREVISTO, r: 4 }} activeDot={{ r: 6 }}>
                        <LabelList
                          dataKey="previsto"
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          content={(props: any) => {
                            const { x, y, value, index } = props
                            if (!value) return null
                            if (chartData[index]?._junction) return null  // omite no ponto de junção (real tem prioridade)
                            return (
                              <text x={x} y={y - 12} textAnchor="middle" fontSize={11} fontWeight={700} fill={COR_PREVISTO}>
                                {fmt(value)}
                              </text>
                            )
                          }}
                        />
                      </Line>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}