import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { getDisponibilidadeMensal } from "@/services/api"

interface GrupoItem {
  grupo: string
  qtd_caixas: number
  pct?: number
}

interface MesData {
  mes: number
  mes_label: string
  entradas: number
  entradas_tipo: "real" | "previsto"
  entradas_real_mes_atual?: number | null
  entradas_real_mes_atual_por_grupo?: GrupoItem[] | null
  entradas_previstas_por_grupo_mes_atual?: GrupoItem[] | null
  estoque_inicio_por_grupo: GrupoItem[]
  entradas_por_grupo: GrupoItem[]
  saidas_por_grupo: GrupoItem[]
}

interface SkuData {
  cod_produto: string
  descricao: string
  estoque_inicial: number
  lib_l1: number
  lib_l2: number
  lib_prevista: number
  lib_real: number
  vs_pct: number | null
  demanda: number
}

function fmt(n?: number | null) {
  if (n === null || n === undefined || n === 0) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function VsBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: "var(--text-secondary)" }}>—</span>
  const color = pct >= 100 ? "#16A34A" : pct >= 60 ? "#F59E0B" : "#DC2626"
  return <span style={{ color, fontWeight: 700 }}>{pct}%</span>
}

export function GrupoDisponibilidadeTable() {
  const [mesAtual, setMesAtual] = useState<MesData | null>(null)
  const [mesAtualNum, setMesAtualNum] = useState<number>(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [skuData, setSkuData] = useState<Record<string, SkuData[]>>({})
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuCarregado, setSkuCarregado] = useState(false)

  useEffect(() => {
    getDisponibilidadeMensal()
      .then((res: any) => {
        const mesAtualNumero = res.mes_atual
        setMesAtualNum(mesAtualNumero)
        const mes = res.meses.find((m: any) => Number(m.mes) === Number(mesAtualNumero))
        setMesAtual(mes || null)
      })
      .catch(() => {})
  }, [])

  const carregarSkus = async () => {
    if (skuCarregado) return
    setSkuLoading(true)
    try {
      const { getAtendimentoSku } = await import("@/services/api")
      const data = await getAtendimentoSku() as { grupos: { grupo: string; skus: SkuData[] }[] }
      const mapa: Record<string, SkuData[]> = {}
      for (const g of data.grupos ?? []) {
        mapa[g.grupo] = g.skus
      }
      setSkuData(mapa)
      setSkuCarregado(true)
    } catch (_) {
    } finally {
      setSkuLoading(false)
    }
  }

  const handleExpand = (grupo: string) => {
    const open = expanded === grupo
    setExpanded(open ? null : grupo)
    if (!open && !skuCarregado) carregarSkus()
  }

  const totalPrevisto = mesAtual?.entradas ?? 0
  const totalReal = mesAtual?.entradas_real_mes_atual ?? 0
  const vsPct = totalPrevisto > 0 ? Math.round((totalReal / totalPrevisto) * 100) : null
  const vsColor = vsPct === null ? "var(--text-secondary)"
    : vsPct >= 100 ? "#16A34A" : vsPct >= 60 ? "#F59E0B" : "#DC2626"

  const grupos = useMemo(() => {
    if (!mesAtual) return []
    const mapa = new Map<string, { estoque: number; demanda: number; lib_prevista: number; lib_real: number }>()

    mesAtual.estoque_inicio_por_grupo?.forEach((g) => {
      mapa.set(g.grupo, { estoque: g.qtd_caixas, demanda: 0, lib_prevista: 0, lib_real: 0 })
    })
    mesAtual.saidas_por_grupo?.forEach((g) => {
      const a = mapa.get(g.grupo) || { estoque: 0, demanda: 0, lib_prevista: 0, lib_real: 0 }
      a.demanda = g.qtd_caixas; mapa.set(g.grupo, a)
    })
    mesAtual.entradas_previstas_por_grupo_mes_atual?.forEach((g) => {
      const a = mapa.get(g.grupo) || { estoque: 0, demanda: 0, lib_prevista: 0, lib_real: 0 }
      a.lib_prevista = g.qtd_caixas; mapa.set(g.grupo, a)
    })
    mesAtual.entradas_real_mes_atual_por_grupo?.forEach((g) => {
      const a = mapa.get(g.grupo) || { estoque: 0, demanda: 0, lib_prevista: 0, lib_real: 0 }
      a.lib_real = g.qtd_caixas; mapa.set(g.grupo, a)
    })

    return Array.from(mapa.entries())
      .map(([grupo, v]) => ({
        grupo,
        estoque: v.estoque,
        lib_prevista: v.lib_prevista,
        lib_real: v.lib_real,
        vs_pct: v.lib_prevista > 0 ? Math.round((v.lib_real / v.lib_prevista) * 100) : null,
        demanda: v.demanda,
        saldo: v.estoque + v.lib_prevista - v.demanda,
      }))
      .filter(g => g.estoque > 0 || g.demanda > 0 || g.lib_prevista > 0)
      .sort((a, b) => b.demanda - a.demanda)
  }, [mesAtual])

  const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  const mesLabel = mesAtualNum > 0 ? MES_LABELS[mesAtualNum - 1] : ""

  const thBase = "px-4 py-3 text-xs font-semibold text-right whitespace-nowrap"
  const thLeft = "px-4 py-3 text-xs font-semibold text-left"

  return (
    <div className="card p-0 overflow-hidden">
      <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          Atendimento projetado — mês atual {mesLabel ? `(${mesLabel})` : ""}
        </h3>
      </div>

      {/* Banner totais */}
      {mesAtual && (
        <div className="grid grid-cols-3 gap-px border-b" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
          <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
            <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Lib. Prevista MPS (cx)</p>
            <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{fmt(totalPrevisto)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>última versão do MPS</p>
          </div>
          <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
            <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Lib. Real MTD (cx)</p>
            <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{fmt(totalReal)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>acumulado no mês</p>
          </div>
          <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
            <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Atingimento</p>
            <div className="flex items-center gap-3">
              <p className="text-xl font-bold" style={{ color: vsColor }}>{vsPct !== null ? `${vsPct}%` : "—"}</p>
              {vsPct !== null && (
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(vsPct, 100)}%`, background: vsColor }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
              <th className={thLeft}>Grupo</th>
              <th className={thBase}>Est. Inicial (cx)</th>
              <th className={thBase}>Lib. Prevista (cx)</th>
              <th className={thBase}>Lib. Real MTD (cx)</th>
              <th className={thBase}>Demanda SOP (cx)</th>
              <th className={thBase}>Saldo (cx)</th>
            </tr>
          </thead>

          <tbody>
            {grupos.map((g) => {
              const open = expanded === g.grupo
              const gVsColor = g.vs_pct === null ? "var(--text-secondary)"
                : g.vs_pct >= 100 ? "#16A34A" : g.vs_pct >= 60 ? "#F59E0B" : "#DC2626"
              const skus = skuData[g.grupo] ?? []

              return (
                <>
                  <tr
                    key={g.grupo}
                    className="border-b transition-colors cursor-pointer"
                    style={{ borderColor: "var(--border)", background: open ? "var(--bg-primary)" : "var(--bg-secondary)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-primary)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = open ? "var(--bg-primary)" : "var(--bg-secondary)"}
                    onClick={() => handleExpand(g.grupo)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {open ? <ChevronDown size={15} style={{ color: "var(--text-secondary)" }} />
                               : <ChevronRight size={15} style={{ color: "var(--text-secondary)" }} />}
                        <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{g.grupo}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-primary)" }}>{fmt(g.estoque)}</td>
                    <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-secondary)" }}>{fmt(g.lib_prevista)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(g.lib_real)}</td>
                    <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-primary)" }}>{fmt(g.demanda)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: g.saldo >= 0 ? "#16A34A" : "#DC2626" }}>
                      {fmt(g.saldo)}
                    </td>
                  </tr>

                  {/* Expansão SKUs */}
                  {open && (
                    <tr key={`${g.grupo}-expand`}>
                      <td colSpan={6} style={{ background: "var(--bg-primary)", borderBottom: `1px solid var(--border)`, padding: 0 }}>
                        {skuLoading ? (
                          <div className="px-12 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>Carregando SKUs...</div>
                        ) : skus.length === 0 ? (
                          <div className="px-12 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                            Nenhum SKU com liberação prevista para este grupo no mês atual.
                          </div>
                        ) : (
                          <table className="w-full" style={{ fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "rgba(30,58,95,0.06)", borderBottom: `1px solid var(--border)` }}>
                                {["Código · Descrição", "Est. Inicial", "L1 (cx)", "L2 (cx)", "Lib. Prevista", "Lib. Real MTD", "Demanda", "Saldo", ""].map((h, i) => (
                                  <th key={h} className={`py-2 text-[10px] font-bold uppercase tracking-widest ${i === 0 ? "text-left" : "text-right"} px-4`}
                                    style={{ color: "var(--text-secondary)", paddingLeft: i === 0 ? 32 : undefined }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {skus.map((sku, idx) => (
                                <tr key={sku.cod_produto} style={{ borderBottom: `1px solid var(--border)`, background: idx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                                  <td className="py-2.5" style={{ paddingLeft: 32, paddingRight: 16 }}>
                                    <span className="font-mono text-[11px] mr-2 px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)", background: "var(--border)" }}>{sku.cod_produto}</span>
                                    <span style={{ color: "var(--text-primary)" }}>{sku.descricao}</span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-primary)" }}>{fmt(sku.estoque_inicial)}</td>
                                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(sku.lib_l1)}</td>
                                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(sku.lib_l2)}</td>
                                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(sku.lib_prevista)}</td>
                                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(sku.lib_real)}</td>
                                  <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-primary)" }}>{fmt(sku.demanda)}</td>
                                  {(() => {
                                    const saldo = (sku.estoque_inicial ?? 0) + (sku.lib_prevista ?? 0) - (sku.demanda ?? 0)
                                    return (
                                      <td className="px-4 py-2.5 text-right font-semibold"
                                        style={{ color: saldo >= 0 ? "#16A34A" : "#DC2626" }}>
                                        {fmt(saldo)}
                                      </td>
                                    )
                                  })()}
                                  {(() => {
                                    const saldo = (sku.estoque_inicial ?? 0) + (sku.lib_prevista ?? 0) - (sku.demanda ?? 0)
                                    const ok = saldo >= 0
                                    return (
                                      <td className="px-4 py-2.5 text-center">
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                                          style={{
                                            background: ok ? "#F0FDF4" : "#FEF2F2",
                                            color: ok ? "#16A34A" : "#DC2626",
                                            border: `1px solid ${ok ? "#BBF7D0" : "#FECACA"}`,
                                          }}>
                                          {ok ? "✓ OK" : "✗ Falta"}
                                        </span>
                                      </td>
                                    )
                                  })()}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}

            {/* Total */}
            {grupos.length > 0 && (() => {
              const totEst   = grupos.reduce((a, g) => a + g.estoque, 0)
              const totPrev  = grupos.reduce((a, g) => a + g.lib_prevista, 0)
              const totReal  = grupos.reduce((a, g) => a + g.lib_real, 0)
              const totDem   = grupos.reduce((a, g) => a + g.demanda, 0)
              const totSaldo = grupos.reduce((a, g) => a + g.saldo, 0)
              const totVs    = totPrev > 0 ? Math.round((totReal / totPrev) * 100) : null
              const totVsColor = totVs === null ? "var(--text-secondary)" : totVs >= 100 ? "#16A34A" : totVs >= 60 ? "#F59E0B" : "#DC2626"
              return (
                <tr style={{ background: "var(--bg-primary)", borderTop: `2px solid var(--border)` }}>
                  <td className="px-4 py-3 font-bold text-sm" style={{ color: "var(--text-primary)" }}>TOTAL</td>
                  <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>{fmt(totEst)}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-secondary)" }}>{fmt(totPrev)}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>{fmt(totReal)}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>{fmt(totDem)}</td>
                  <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: totSaldo >= 0 ? "#16A34A" : "#DC2626" }}>{fmt(totSaldo)}</td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
