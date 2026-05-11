import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { getOrcadoLiberacao } from "@/services/api"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from "recharts"

interface Props { open: boolean; onClose: () => void }

interface MesData {
  mes: number
  L1: number
  L2: number
  L1_heranca?: number
  L2_heranca?: number
}

interface OrcadoData {
  meses: MesData[]
  total_l1_caixas: number
  total_l2_caixas: number
  total_caixas: number
  total_l1_tubetes: number
  total_l2_tubetes: number
  total_tubetes: number
  heranca_2025_caixas: number
  heranca_2025_tubetes: number
  producao_2026_caixas: number
}

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
const COR_L1     = "#1B3A5C"
const COR_L2     = "#4A7FB5"
const COR_ORIG25 = "#CBD5E1"

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function fmtFull(n: number) {
  if (!n || n === 0) return ""
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

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
      fill="#6B7280"
    >
      {fmtFull(value)}
    </text>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const filtered = payload.filter((p: { value: number }) => p.value > 0)
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

export function DisponibilidadeModal({ open, onClose }: Props) {
  const [data, setData] = useState<OrcadoData | null>(null)

  useEffect(() => {
    if (open && !data) {
      getOrcadoLiberacao()
        .then((d: unknown) => setData(d as OrcadoData))
        .catch(console.error)
    }
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  if (!open) return null

  const chartData = data ? MES_LABELS.map((label, idx) => {
    const mes = data.meses.find(m => m.mes === idx + 1)
    if (!mes) return {
      mes: label,
      "L1 Prod. 2026": 0, "L2 Prod. 2026": 0,
      "Orig. 2025 L1": 0, "Orig. 2025 L2": 0,
      labelL1: 0, labelL2: 0,
    }
    const h1 = mes.L1_heranca ?? 0
    const h2 = mes.L2_heranca ?? 0
    const p1 = Math.round((mes.L1 - h1) / 500)
    const p2 = Math.round((mes.L2 - h2) / 500)
    const o1 = Math.round(h1 / 500)
    const o2 = Math.round(h2 / 500)
    return {
      mes: label,
      "L1 Prod. 2026": p1,
      "L2 Prod. 2026": p2,
      "Orig. 2025 L1": o1,
      "Orig. 2025 L2": o2,
      labelL1: p1 + o1,
      labelL2: p2 + o2,
    }
  }) : []

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
              Orçado de Liberações 2026
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Liberações previstas em caixas — Linha 1 e Linha 2
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Total Linha 1", cx: data.total_l1_caixas, tb: data.total_l1_tubetes, cor: COR_L1 },
                  { label: "Total Linha 2", cx: data.total_l2_caixas, tb: data.total_l2_tubetes, cor: COR_L2 },
                  { label: "Total Geral",   cx: data.total_caixas,    tb: data.total_tubetes,    cor: "#111827" },
                ].map(k => (
                  <div key={k.label} style={{ background: "var(--bg-primary)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 8px" }}>{k.label}</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: k.cor, margin: 0, lineHeight: 1 }}>
                      {fmt(k.cx)} <span style={{ fontSize: 13, fontWeight: 400 }}>cx</span>
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0", fontFamily: "monospace" }}>{fmt(k.tb)} tb</p>
                  </div>
                ))}
              </div>

              {/* Origem */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                {[
                  { label: "Produção 2025 liberada em 2026", cx: data.heranca_2025_caixas, tb: data.heranca_2025_tubetes, cor: COR_ORIG25 },
                  { label: "Produção 2026", cx: data.producao_2026_caixas, tb: data.total_tubetes - data.heranca_2025_tubetes, cor: COR_L1 },
                ].map(k => (
                  <div key={k.label} style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: k.cor, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 2px" }}>{k.label}</p>
                      <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                        {fmt(k.cx)} cx{" "}
                        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-secondary)", fontFamily: "monospace" }}>({fmt(k.tb)} tb)</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Legenda */}
              <div style={{ display: "flex", gap: 20, marginBottom: 10, flexWrap: "wrap" }}>
                {[
                  { cor: COR_L1,     label: "L1 — Produção 2026" },
                  { cor: COR_L2,     label: "L2 — Produção 2026" },
                  { cor: COR_ORIG25, label: "Produção 2025 (jan)" },
                ].map(l => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: l.cor }} />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{l.label}</span>
                  </div>
                ))}
              </div>

              {/* Gráfico */}
              <div style={{ height: 340 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    barCategoryGap="6%"
                    barGap={2}
                    margin={{ top: 36, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} width={60} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />

                    <Bar dataKey="L1 Prod. 2026" stackId="L1" fill={COR_L1} radius={[4,4,4,4]} maxBarSize={72} />
                    <Bar dataKey="Orig. 2025 L1" stackId="L1" fill={COR_ORIG25} radius={[4,4,0,0]} maxBarSize={72}>
                      <LabelList dataKey="labelL1" content={RenderTopLabel} />
                    </Bar>

                    <Bar dataKey="L2 Prod. 2026" stackId="L2" fill={COR_L2} radius={[4,4,4,4]} maxBarSize={72} />
                    <Bar dataKey="Orig. 2025 L2" stackId="L2" fill={COR_ORIG25} radius={[4,4,0,0]} maxBarSize={72}>
                      <LabelList dataKey="labelL2" content={RenderTopLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
