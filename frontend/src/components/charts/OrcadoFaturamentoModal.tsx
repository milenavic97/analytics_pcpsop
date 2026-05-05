import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { getOrcadoFaturamentoDetalhe } from "@/services/api"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from "recharts"

interface Props { open: boolean; onClose: () => void }

interface RankingItem {
  grupo: string
  qtd_caixas: number
  pct: number
}

interface MesData {
  mes: number
  [grupo: string]: number
}

interface DetalheData {
  total_caixas: number
  qtd_grupos: number
  top_grupo: RankingItem | null
  ranking_grupos: RankingItem[]
  meses: MesData[]
  grupos: string[]
}

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

// Paleta do dashboard — navy, azul, aço, laranja, âmbar e neutros
const PALETA = ["#27336D", "#4E67A7", "#8FA0B8", "#E56A1C", "#D08A00", "#6B7280", "#D7DCE7"]

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function fmtPct(n: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n) + "%"
}

// Rótulo no topo da barra empilhada — usa o total acumulado
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RenderTopLabel = (props: any) => {
  const { x, y, width, value } = props
  if (!value || value === 0) return null
  return (
    <text
      x={x + width / 2}
      y={y - 6}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      fill="#374151"
    >
      {fmt(value)}
    </text>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  // ignora o item "_total" (campo auxiliar do label) — não deve aparecer no tooltip
  const filtered = payload.filter((p: { value: number; dataKey: string }) => p.value > 0 && p.dataKey !== "_total")
  const total = filtered.reduce((s: number, p: { value: number }) => s + p.value, 0)
  return (
    <div style={{
      background: "var(--bg-secondary)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "10px 14px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontSize: 12, minWidth: 200,
    }}>
      <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{label}</p>
      {filtered.map((p: { name: string; value: number; fill: string }, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: p.fill, flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)", flex: 1 }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{fmt(p.value)} cx</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-secondary)" }}>Total:</span>
        <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)} cx</span>
      </div>
    </div>
  )
}

export function OrcadoFaturamentoModal({ open, onClose }: Props) {
  const [data, setData] = useState<DetalheData | null>(null)

  useEffect(() => {
    if (open && !data) {
      getOrcadoFaturamentoDetalhe()
        .then((d: unknown) => setData(d as DetalheData))
        .catch(console.error)
    }
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  if (!open) return null

  // Mapa grupo -> cor (mesma ordem do ranking)
  const corPorGrupo: Record<string, string> = {}
  if (data) {
    data.grupos.forEach((g, i) => {
      corPorGrupo[g] = PALETA[i % PALETA.length]
    })
  }

  // Dados do gráfico mensal: cada item tem mes (label), cada grupo como key,
  // e _total que é a soma usada no rótulo do topo
  const chartData = data
    ? data.meses.map((m) => {
        const obj: Record<string, number | string> = { mes: MES_LABELS[m.mes - 1] }
        let total = 0
        data.grupos.forEach((g) => {
          const v = m[g] || 0
          obj[g] = v
          total += v
        })
        obj["_total"] = total
        return obj
      })
    : []

  // Maior valor do ranking (pra calcular largura das barras horizontais)
  const maxRanking = data?.ranking_grupos[0]?.qtd_caixas ?? 1

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
          width: "100%", maxWidth: 1020, maxHeight: "92vh",
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
              Orçado de Faturamento 2026
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Vendas previstas em caixas — distribuição por grupo e mês
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
                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Total Geral</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0, lineHeight: 1 }}>
                    {fmt(data.total_caixas)} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    distribuídos em 12 meses
                  </p>
                </div>

                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Top Grupo</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: corPorGrupo[data.top_grupo?.grupo ?? ""] ?? "#111827", margin: 0, lineHeight: 1 }}>
                    {data.top_grupo?.grupo ?? "—"}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {data.top_grupo ? `${fmt(data.top_grupo.qtd_caixas)} cx · ${fmtPct(data.top_grupo.pct)} do total` : ""}
                  </p>
                </div>

                <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>Grupos Ativos</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0, lineHeight: 1 }}>
                    {data.qtd_grupos}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    com volume orçado em 2026
                  </p>
                </div>
              </div>

              {/* Ranking de grupos (barras horizontais) */}
              <div style={{ marginBottom: 24 }}>
                <p className="card-label" style={{ marginBottom: 12, display: "block" }}>Ranking anual por grupo</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.ranking_grupos.map((r) => {
                    const widthPct = (r.qtd_caixas / maxRanking) * 100
                    return (
                      <div key={r.grupo} style={{ display: "grid", gridTemplateColumns: "140px 1fr 110px", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", textAlign: "right" }}>
                          {r.grupo}
                        </span>
                        <div style={{ background: "var(--bg-primary)", borderRadius: 6, height: 24, position: "relative", overflow: "hidden" }}>
                          <div style={{
                            width: `${widthPct}%`,
                            height: "100%",
                            background: corPorGrupo[r.grupo],
                            borderRadius: 6,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{fmt(r.qtd_caixas)}</span> cx · {fmtPct(r.pct)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Distribuição mensal (barras empilhadas) */}
              <div>
                <p className="card-label" style={{ marginBottom: 12, display: "block" }}>Distribuição mensal por grupo</p>

                {/* Legenda */}
                <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                  {data.grupos.map((g) => (
                    <div key={g} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: corPorGrupo[g] }} />
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{g}</span>
                    </div>
                  ))}
                </div>

                {/* Gráfico */}
                <div style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      barCategoryGap="20%"
                      margin={{ top: 28, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} width={60} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                      {data.grupos.map((g, i) => {
                        const isTop = i === data.grupos.length - 1
                        return (
                          <Bar
                            key={g}
                            dataKey={g}
                            stackId="grupos"
                            fill={corPorGrupo[g]}
                            radius={isTop ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                            maxBarSize={56}
                          >
                            {isTop && <LabelList dataKey="_total" content={RenderTopLabel} />}
                          </Bar>
                        )
                      })}
                    </BarChart>
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