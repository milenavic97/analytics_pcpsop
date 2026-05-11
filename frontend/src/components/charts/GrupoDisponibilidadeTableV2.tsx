import { useEffect, useMemo, useState } from "react"
import { ChevronRight, ChevronDown, X } from "lucide-react"
import { getDisponibilidadeMensal, getAtendimentoSku } from "@/services/api"
import { createPortal } from "react-dom"
import PrevistoAteHojeModal from "./PrevistoAteHojeModal"

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
  entradas_previstas_mtd?: number | null
  entradas_previstas_mtd_por_grupo?: GrupoItem[] | null
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

interface GrupoRow {
  grupo: string
  estoque: number
  lib_prevista: number
  lib_prevista_mtd: number
  lib_real: number
  vs_pct: number | null
  demanda: number
  saldo: number
}

function fmt(n?: number | null) {
  if (n === null || n === undefined || n === 0) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function fmtSaldo(n?: number | null) {
  if (n === null || n === undefined) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function alocarEstoqueInicial(skus: SkuData[], estoqueGrupo: number) {
  let saldoEstoque = estoqueGrupo ?? 0

  return skus.map((sku) => {
    const demanda = sku.demanda ?? 0
    const estoqueAlocado = Math.min(saldoEstoque, demanda)

    saldoEstoque -= estoqueAlocado

    return {
      ...sku,
      estoque_inicial: estoqueAlocado,
    }
  })
}

function SkuTable({ skus, loading }: { skus: SkuData[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm" style={{ color: "var(--text-secondary)" }}>
        Carregando SKUs...
      </div>
    )
  }

  if (skus.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm" style={{ color: "var(--text-secondary)" }}>
        Nenhum SKU encontrado para este grupo no mês atual.
      </div>
    )
  }

  return (
    <table className="w-full" style={{ fontSize: 12 }}>
      <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
        <tr style={{ background: "rgba(30,58,95,0.07)", borderBottom: "2px solid var(--border)" }}>
          {["Código · Descrição", "Est. Inicial", "L1 (cx)", "L2 (cx)", "Lib. Prevista", "Lib. Real MTD", "Demanda", "Saldo", ""].map((h, i) => (
            <th
              key={i}
              className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest ${i === 0 ? "text-left" : "text-right"}`}
              style={{ color: "var(--text-secondary)" }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {skus.map((sku, idx) => {
          const estoqueInicial = sku.estoque_inicial ?? 0
          const libPrevista = sku.lib_prevista ?? 0
          const demanda = sku.demanda ?? 0
          const saldo = estoqueInicial + libPrevista - demanda
          const ok = saldo >= 0

          return (
            <tr
              key={`${sku.cod_produto}-${idx}`}
              style={{
                borderBottom: "1px solid var(--border)",
                background: idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)",
              }}
            >
              <td className="px-4 py-2.5 text-left">
                <span
                  className="font-mono text-[11px] mr-2 px-1.5 py-0.5 rounded"
                  style={{ color: "var(--text-secondary)", background: "var(--border)" }}
                >
                  {sku.cod_produto}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{sku.descricao}</span>
              </td>

              <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-primary)" }}>
                {fmt(estoqueInicial)}
              </td>

              <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                {fmt(sku.lib_l1)}
              </td>

              <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                {fmt(sku.lib_l2)}
              </td>

              <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                {fmt(libPrevista)}
              </td>

              <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                {fmt(sku.lib_real)}
              </td>

              <td className="px-4 py-2.5 text-right" style={{ color: "var(--text-primary)" }}>
                {fmt(demanda)}
              </td>

              <td className="px-4 py-2.5 text-right font-semibold" style={{ color: ok ? "#16A34A" : "#DC2626" }}>
                {fmtSaldo(saldo)}
              </td>

              <td className="px-4 py-2.5 text-center">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    background: ok ? "#F0FDF4" : "#FEF2F2",
                    color: ok ? "#16A34A" : "#DC2626",
                    border: `1px solid ${ok ? "#BBF7D0" : "#FECACA"}`,
                  }}
                >
                  {ok ? "✓ OK" : "✗ Falta"}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SkuModal({
  grupo,
  skus,
  loading,
  grupoRow,
  onClose,
}: {
  grupo: string
  skus: SkuData[]
  loading: boolean
  grupoRow: GrupoRow
  onClose: () => void
}) {
  const skusComEstoque = useMemo(() => {
    return alocarEstoqueInicial(skus, grupoRow.estoque)
  }, [skus, grupoRow.estoque])

  return createPortal(
    <div
      className="fixed inset-0 z-[990] flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-2xl shadow-2xl overflow-hidden fade-in"
        style={{
          maxWidth: 960,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>
              Liberações — Mês Atual
            </p>
            <h3 className="text-lg font-bold text-white">{grupo}</h3>
          </div>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-5 gap-px flex-shrink-0" style={{ background: "var(--border)" }}>
          {[
            { label: "Est. Inicial", value: fmt(grupoRow.estoque), color: "var(--text-primary)" },
            { label: "Lib. Prevista Mês", value: fmt(grupoRow.lib_prevista), color: "var(--text-secondary)" },
            { label: "Prev. Até Hoje", value: fmt(grupoRow.lib_prevista_mtd), color: "var(--text-primary)" },
            { label: "Lib. Real MTD", value: fmt(grupoRow.lib_real), color: "var(--text-primary)" },
            { label: "Saldo", value: fmtSaldo(grupoRow.saldo), color: grupoRow.saldo >= 0 ? "#16A34A" : "#DC2626" },
          ].map((k) => (
            <div key={k.label} className="px-5 py-3" style={{ background: "var(--bg-primary)" }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                {k.label}
              </p>
              <p className="text-xl font-bold" style={{ color: k.color }}>
                {k.value}
              </p>
            </div>
          ))}
        </div>

        <div className="overflow-auto flex-1">
          <SkuTable skus={skusComEstoque} loading={loading} />
        </div>
      </div>
    </div>,
    document.body
  )
}

export function GrupoDisponibilidadeTableV2() {
  const [mesAtual, setMesAtual] = useState<MesData | null>(null)
  const [mesAtualNum, setMesAtualNum] = useState<number>(0)
  const [entradasPrevistasMtd, setEntradasPrevistasMtd] = useState<number>(0)
  const [skuData, setSkuData] = useState<Record<string, SkuData[]>>({})
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuCarregado, setSkuCarregado] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modalGrupo, setModalGrupo] = useState<string | null>(null)
  const [modalPrevistoHoje, setModalPrevistoHoje] = useState(false)

  useEffect(() => {
    getDisponibilidadeMensal()
      .then((res: any) => {
        const n = res.mes_atual
        setMesAtualNum(n)
        const mes = res.meses.find((m: any) => Number(m.mes) === Number(n))
        setMesAtual(mes || null)
        setEntradasPrevistasMtd(Number(res.entradas_previstas_mtd ?? mes?.entradas_previstas_mtd ?? 0))
      })
      .catch(() => {})
  }, [])

  const carregarSkus = async () => {
    if (skuCarregado) return

    setSkuLoading(true)

    try {
      const data = (await getAtendimentoSku()) as {
        grupos: { grupo: string; skus: SkuData[] }[]
      }

      const mapa: Record<string, SkuData[]> = {}

      for (const g of data.grupos ?? []) {
        mapa[g.grupo] = g.skus ?? []
      }

      setSkuData(mapa)
      setSkuCarregado(true)
    } catch (_) {
    } finally {
      setSkuLoading(false)
    }
  }

  const handleToggleExpand = (e: React.MouseEvent, grupo: string) => {
    e.stopPropagation()

    const isOpen = expanded === grupo
    setExpanded(isOpen ? null : grupo)

    if (!isOpen && !skuCarregado) {
      carregarSkus()
    }
  }

  const handleOpenModal = (grupo: string) => {
    setModalGrupo(grupo)

    if (!skuCarregado) {
      carregarSkus()
    }
  }

  const totalPrevistoMes = mesAtual?.entradas ?? 0
  const totalPrevistoMtd = entradasPrevistasMtd
  const totalReal = mesAtual?.entradas_real_mes_atual ?? 0

  const vsPct = totalPrevistoMtd > 0 ? Math.round((totalReal / totalPrevistoMtd) * 100) : null

  const vsColor =
    vsPct === null
      ? "var(--text-secondary)"
      : vsPct >= 100
        ? "#16A34A"
        : vsPct >= 60
          ? "#F59E0B"
          : "#DC2626"

  const grupos: GrupoRow[] = useMemo(() => {
    if (!mesAtual) return []

    const previstoMtdMap = new Map<string, number>()

    mesAtual.entradas_previstas_mtd_por_grupo?.forEach((g) => {
      previstoMtdMap.set(g.grupo, Number(g.qtd_caixas || 0))
    })

    const mapa = new Map<
      string,
      {
        estoque: number
        demanda: number
        lib_prevista: number
        lib_prevista_mtd: number
        lib_real: number
      }
    >()

    mesAtual.estoque_inicio_por_grupo?.forEach((g) => {
      mapa.set(g.grupo, {
        estoque: g.qtd_caixas,
        demanda: 0,
        lib_prevista: 0,
        lib_prevista_mtd: previstoMtdMap.get(g.grupo) || 0,
        lib_real: 0,
      })
    })

    mesAtual.saidas_por_grupo?.forEach((g) => {
      const a = mapa.get(g.grupo) || {
        estoque: 0,
        demanda: 0,
        lib_prevista: 0,
        lib_prevista_mtd: previstoMtdMap.get(g.grupo) || 0,
        lib_real: 0,
      }

      a.demanda = g.qtd_caixas
      mapa.set(g.grupo, a)
    })

    mesAtual.entradas_previstas_por_grupo_mes_atual?.forEach((g) => {
      const a = mapa.get(g.grupo) || {
        estoque: 0,
        demanda: 0,
        lib_prevista: 0,
        lib_prevista_mtd: previstoMtdMap.get(g.grupo) || 0,
        lib_real: 0,
      }

      a.lib_prevista = g.qtd_caixas
      a.lib_prevista_mtd = previstoMtdMap.get(g.grupo) || a.lib_prevista_mtd || 0
      mapa.set(g.grupo, a)
    })

    mesAtual.entradas_previstas_mtd_por_grupo?.forEach((g) => {
      const a = mapa.get(g.grupo) || {
        estoque: 0,
        demanda: 0,
        lib_prevista: 0,
        lib_prevista_mtd: 0,
        lib_real: 0,
      }

      a.lib_prevista_mtd = g.qtd_caixas
      mapa.set(g.grupo, a)
    })

    mesAtual.entradas_real_mes_atual_por_grupo?.forEach((g) => {
      const a = mapa.get(g.grupo) || {
        estoque: 0,
        demanda: 0,
        lib_prevista: 0,
        lib_prevista_mtd: previstoMtdMap.get(g.grupo) || 0,
        lib_real: 0,
      }

      a.lib_real = g.qtd_caixas
      mapa.set(g.grupo, a)
    })

    return Array.from(mapa.entries())
      .map(([grupo, v]) => ({
        grupo,
        estoque: v.estoque,
        lib_prevista: v.lib_prevista,
        lib_prevista_mtd: v.lib_prevista_mtd,
        lib_real: v.lib_real,
        vs_pct: v.lib_prevista_mtd > 0 ? Math.round((v.lib_real / v.lib_prevista_mtd) * 100) : null,
        demanda: v.demanda,
        saldo: v.estoque + v.lib_prevista - v.demanda,
      }))
      .filter((g) => g.estoque > 0 || g.demanda > 0 || g.lib_prevista > 0 || g.lib_prevista_mtd > 0 || g.lib_real > 0)
      .sort((a, b) => b.demanda - a.demanda)
  }, [mesAtual])

  const MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  const mesLabel = mesAtualNum > 0 ? MES_LABELS[mesAtualNum - 1] : ""
  const grupoAberto = grupos.find((g) => g.grupo === modalGrupo)

  const thBase = "px-4 py-3 text-xs font-semibold text-right whitespace-nowrap"
  const thLeft = "px-4 py-3 text-xs font-semibold text-left"

  const detalhePrevistoHoje = grupos.map((g) => ({
    grupo: g.grupo,
    previsto_ate_hoje: g.lib_prevista_mtd,
    realizado_mtd: g.lib_real,
  }))

  return (
    <>
      <div className="card p-0 overflow-hidden">
        <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Atendimento projetado — mês atual {mesLabel ? `(${mesLabel})` : ""}
          </h3>
        </div>

        {mesAtual && (
          <div className="grid grid-cols-4 gap-px border-b" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
            <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                Lib. Prevista MPS (cx)
              </p>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {fmt(totalPrevistoMes)}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                plano total do mês
              </p>
            </div>

            <div
              className="px-5 py-3 cursor-pointer transition hover:bg-black/5"
              style={{ background: "var(--bg-secondary)" }}
              onClick={() => setModalPrevistoHoje(true)}
            >
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                Previsto até Hoje (cx)
              </p>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {fmt(totalPrevistoMtd)}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                acumulado planejado MTD
              </p>
              <p className="text-[10px] mt-1 opacity-60" style={{ color: "var(--text-secondary)" }}>
                clique para detalhes
              </p>
            </div>

            <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                Lib. Real MTD (cx)
              </p>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {fmt(totalReal)}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                acumulado realizado no mês
              </p>
            </div>

            <div className="px-5 py-3" style={{ background: "var(--bg-secondary)" }}>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                Aderência MTD
              </p>

              <div className="flex items-center gap-3">
                <p className="text-xl font-bold" style={{ color: vsColor }}>
                  {vsPct !== null ? `${vsPct}%` : "—"}
                </p>

                {vsPct !== null && (
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(vsPct, 100)}%`,
                        background: vsColor,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="overflow-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
                <th className={thLeft}>Grupo</th>
                <th className={thBase}>Est. Inicial (cx)</th>
                <th className={thBase}>Lib. Prevista Mês (cx)</th>
                <th className={thBase}>Prev. Até Hoje (cx)</th>
                <th className={thBase}>Lib. Real MTD (cx)</th>
                <th className={thBase}>Demanda SOP (cx)</th>
                <th className={thBase}>Saldo (cx)</th>
              </tr>
            </thead>

            <tbody>
              {grupos.map((g) => {
                const isOpen = expanded === g.grupo
                const skusComEstoque = alocarEstoqueInicial(skuData[g.grupo] ?? [], g.estoque)

                return (
                  <>
                    <tr
                      key={g.grupo}
                      className="border-b transition-colors cursor-pointer group"
                      style={{
                        borderColor: "var(--border)",
                        background: isOpen ? "var(--bg-primary)" : "var(--bg-secondary)",
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = "var(--bg-primary)"
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = isOpen ? "var(--bg-primary)" : "var(--bg-secondary)"
                      }}
                      onClick={() => handleOpenModal(g.grupo)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => handleToggleExpand(e, g.grupo)}
                            className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-black/10"
                            title={isOpen ? "Recolher" : "Expandir SKUs"}
                          >
                            {isOpen ? (
                              <ChevronDown size={15} style={{ color: "var(--text-secondary)" }} />
                            ) : (
                              <ChevronRight size={15} style={{ color: "var(--text-secondary)" }} />
                            )}
                          </button>

                          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                            {g.grupo}
                          </span>

                          <span
                            className="text-[10px] opacity-0 group-hover:opacity-60 transition-opacity"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            clique p/ modal
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(g.estoque)}
                      </td>

                      <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-secondary)" }}>
                        {fmt(g.lib_prevista)}
                      </td>

                      <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {fmt(g.lib_prevista_mtd)}
                      </td>

                      <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {fmt(g.lib_real)}
                      </td>

                      <td className="px-4 py-3 text-right text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(g.demanda)}
                      </td>

                      <td
                        className="px-4 py-3 text-right text-sm font-semibold"
                        style={{ color: g.saldo >= 0 ? "#16A34A" : "#DC2626" }}
                      >
                        {fmtSaldo(g.saldo)}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr key={`${g.grupo}-expand`}>
                        <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid var(--border)` }}>
                          <SkuTable skus={skusComEstoque} loading={skuLoading && !skuCarregado} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}

              {grupos.length > 0 &&
                (() => {
                  const totEst = grupos.reduce((a, g) => a + g.estoque, 0)
                  const totPrev = grupos.reduce((a, g) => a + g.lib_prevista, 0)
                  const totPrevMtd = grupos.reduce((a, g) => a + g.lib_prevista_mtd, 0)
                  const totReal = grupos.reduce((a, g) => a + g.lib_real, 0)
                  const totDem = grupos.reduce((a, g) => a + g.demanda, 0)
                  const totSaldo = grupos.reduce((a, g) => a + g.saldo, 0)

                  return (
                    <tr style={{ background: "var(--bg-primary)", borderTop: `2px solid var(--border)` }}>
                      <td className="px-4 py-3 font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                        TOTAL
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(totEst)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-secondary)" }}>
                        {fmt(totPrev)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(totPrevMtd)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(totReal)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                        {fmt(totDem)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold text-sm" style={{ color: totSaldo >= 0 ? "#16A34A" : "#DC2626" }}>
                        {fmtSaldo(totSaldo)}
                      </td>
                    </tr>
                  )
                })()}
            </tbody>
          </table>
        </div>
      </div>

      {modalGrupo && grupoAberto && (
        <SkuModal
          grupo={modalGrupo}
          skus={skuData[modalGrupo] ?? []}
          loading={skuLoading && !skuCarregado}
          grupoRow={grupoAberto}
          onClose={() => setModalGrupo(null)}
        />
      )}

      <PrevistoAteHojeModal
        open={modalPrevistoHoje}
        onClose={() => setModalPrevistoHoje(false)}
        data={detalhePrevistoHoje}
      />
    </>
  )
}
