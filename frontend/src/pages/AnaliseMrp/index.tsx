import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Clock,
  Download,
  Search,
  ShoppingCart,
} from "lucide-react"
import {
  AgingEstoqueItem,
  getAgingResumo,
  getAgingItens,
  getAgingEstoqueItem,
} from "@/services/api"

const PAGE_SIZE = 100

const STATUS_LABEL: Record<string, string> = {
  RUPTURA: "Ruptura",
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  SAUDAVEL: "Saudável",
  EXCESSO: "Excesso",
  SEM_GIRO: "Sem giro",
  SEM_CONSUMO: "Sem consumo",
}

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  RUPTURA: { bg: "rgba(220,38,38,0.09)", color: "#B91C1C", border: "rgba(220,38,38,0.24)" },
  CRITICO: { bg: "rgba(234,88,12,0.10)", color: "#C2410C", border: "rgba(234,88,12,0.24)" },
  ATENCAO: { bg: "rgba(245,158,11,0.12)", color: "#B45309", border: "rgba(245,158,11,0.28)" },
  SAUDAVEL: { bg: "rgba(22,163,74,0.09)", color: "#15803D", border: "rgba(22,163,74,0.24)" },
  EXCESSO: { bg: "rgba(37,99,235,0.09)", color: "#1D4ED8", border: "rgba(37,99,235,0.24)" },
  SEM_GIRO: { bg: "rgba(100,116,139,0.10)", color: "#475569", border: "rgba(100,116,139,0.24)" },
  SEM_CONSUMO: { bg: "rgba(100,116,139,0.10)", color: "#475569", border: "rgba(100,116,139,0.24)" },
}

type AgingResumoPayload = {
  data_snapshot_consumo?: string | null
  data_snapshot_mrp?: string | null
  resumo: {
    total_itens: number
    ruptura: number
    critico: number
    atencao: number
    saudavel: number
    excesso: number
    sem_giro?: number
    saldo_total: number
    pedidos_total: number
    gap_total: number
    cobertura_media_dias?: number
    cobertura_futura_media_dias?: number
  }
  top_excesso?: AgingEstoqueItem[]
  top_criticos?: AgingEstoqueItem[]
}

type AgingItensPayload = {
  page: number
  page_size: number
  total: number
  total_pages: number
  itens: AgingEstoqueItem[]
}

function fmtNumber(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function fmtCompact(value: number | null | undefined) {
  const n = Number(value || 0)
  if (Math.abs(n) >= 1_000_000) return `${fmtNumber(n / 1_000_000, 1)} mi`
  if (Math.abs(n) >= 1_000) return `${fmtNumber(n / 1_000, 1)} mil`
  return fmtNumber(n, 0)
}

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10).split("-").reverse().join("/")
  return d.toLocaleDateString("pt-BR")
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.SEM_GIRO
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function KpiCard({
  label,
  value,
  helper,
  icon,
  tone = "default",
}: {
  label: string
  value: string
  helper?: string
  icon: React.ReactNode
  tone?: "default" | "danger" | "warning" | "success" | "blue"
}) {
  const tones = {
    default: { bg: "rgba(15,23,42,0.04)", color: "var(--text-primary)" },
    danger: { bg: "rgba(220,38,38,0.08)", color: "#B91C1C" },
    warning: { bg: "rgba(245,158,11,0.10)", color: "#B45309" },
    success: { bg: "rgba(22,163,74,0.08)", color: "#15803D" },
    blue: { bg: "rgba(37,99,235,0.08)", color: "#1D4ED8" },
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {value}
          </p>
          {helper && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              {helper}
            </p>
          )}
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-2xl"
          style={{ background: tones[tone].bg, color: tones[tone].color }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

function KpiSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  )
}

function ItemDrawer({
  item,
  loading,
  onClose,
}: {
  item: AgingEstoqueItem | null
  loading: boolean
  onClose: () => void
}) {
  if (!item && !loading) return null

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="h-full w-full max-w-[720px] overflow-y-auto border-l bg-white p-6 shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
              Detalhe do item
            </p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {loading ? "Carregando..." : `${item?.codigo} · ${item?.produto || "Sem descrição"}`}
            </h2>
            {item && (
              <div className="mt-3">
                <StatusBadge status={item.status} />
              </div>
            )}
          </div>
          <button className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-slate-100" onClick={onClose}>
            Fechar
          </button>
        </div>

        {loading || !item ? (
          <div className="mt-8 text-sm" style={{ color: "var(--text-secondary)" }}>
            Buscando detalhe completo...
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiSmall label="Saldo" value={fmtCompact(item.saldo)} />
              <KpiSmall label="Pedidos" value={fmtCompact(item.qtd_pedidos_abertos)} />
              <KpiSmall label="Estoque + pedidos" value={fmtCompact(item.estoque_mais_pedidos)} />
              <KpiSmall label="Cobertura futura" value={`${fmtNumber(item.cobertura_futura_dias, 0)} d`} />
              <KpiSmall label="Maior média" value={fmtCompact(item.maior_media)} />
              <KpiSmall label="Lead time" value={`${fmtNumber(item.lead_time_dias, 0)} d`} />
              <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
              <KpiSmall label="Estoque ideal" value={fmtCompact(item.estoque_ideal)} />
            </div>

            <div className="mt-6 card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Racional do estoque ideal
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>
                Estoque ideal = maior entre consumo durante o lead time e quantidade mínima.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiSmall label="Consumo durante LT" value={fmtCompact(item.consumo_durante_lt)} />
                <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
                <KpiSmall label="Gap vs ideal" value={fmtCompact(item.gap_volume)} />
              </div>
            </div>

            <div className="mt-6 card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Pedidos em aberto
              </p>
              {!item.pedidos?.length ? (
                <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                  Nenhum pedido aberto encontrado para este item.
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Pedido/SC</th>
                        <th className="px-3 py-2 text-right">Qtd.</th>
                        <th className="px-3 py-2">Entrega</th>
                        <th className="px-3 py-2">Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.pedidos.map((p, idx) => (
                        <tr key={`${p.pedido_numero}-${p.sc_numero}-${idx}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="px-3 py-2">{p.pedido_numero || p.sc_numero || "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtNumber(p.quantidade_pendente, 0)}</td>
                          <td className="px-3 py-2">{fmtDate(p.data_prevista_entrega)}</td>
                          <td className="px-3 py-2">{p.fornecedor || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AgingEstoquePage() {
  const [resumo, setResumo] = useState<AgingResumoPayload | null>(null)
  const [itensPayload, setItensPayload] = useState<AgingItensPayload | null>(null)

  const [loadingResumo, setLoadingResumo] = useState(true)
  const [loadingItens, setLoadingItens] = useState(true)
  const [error, setError] = useState("")

  const [status, setStatus] = useState("TODOS")
  const [tipo, setTipo] = useState("TODOS")
  const [busca, setBusca] = useState("")
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<AgingEstoqueItem | null>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoadingResumo(true)
    setError("")

    getAgingResumo()
      .then((res) => {
        if (mounted) setResumo(res as AgingResumoPayload)
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : "Erro ao carregar resumo")
      })
      .finally(() => {
        if (mounted) setLoadingResumo(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [status, tipo, busca])

  useEffect(() => {
    let mounted = true
    setLoadingItens(true)
    setError("")

    getAgingItens({
      page,
      page_size: PAGE_SIZE,
      status,
      tipo,
      busca,
    })
      .then((res) => {
        if (mounted) setItensPayload(res as AgingItensPayload)
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : "Erro ao carregar itens")
      })
      .finally(() => {
        if (mounted) setLoadingItens(false)
      })

    return () => {
      mounted = false
    }
  }, [page, status, tipo, busca])

  const tipos = useMemo(() => {
    const lista = new Set<string>()

    resumo?.top_excesso?.forEach((item) => lista.add(String(item.tipo || "Sem tipo")))
    resumo?.top_criticos?.forEach((item) => lista.add(String(item.tipo || "Sem tipo")))
    itensPayload?.itens?.forEach((item) => lista.add(String(item.tipo || "Sem tipo")))

    return ["TODOS", ...Array.from(lista).sort()]
  }, [resumo, itensPayload])

  const abrirDetalhe = (item: AgingEstoqueItem) => {
    setSelected(item)
    setSelectedLoading(true)

    getAgingEstoqueItem(item.codigo)
      .then((detalhe) => setSelected(detalhe))
      .catch(() => setSelected(item))
      .finally(() => setSelectedLoading(false))
  }

  const exportCsv = () => {
    const rows = itensPayload?.itens || []
    const header = [
      "codigo",
      "produto",
      "tipo",
      "saldo",
      "qtd_pedidos_abertos",
      "estoque_mais_pedidos",
      "maior_media",
      "lead_time_dias",
      "qtd_minima",
      "estoque_ideal",
      "cobertura_dias",
      "cobertura_futura_dias",
      "gap_volume",
      "status",
    ]

    const csv = [
      header.join(";"),
      ...rows.map((r) => header.map((h) => String((r as any)[h] ?? "").replace(/;/g, ",")).join(";")),
    ].join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "gestao_estoque_pagina_atual.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = itensPayload?.total_pages || 1

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            Suprimentos · Estoque
          </p>
          <h1 className="mb-1 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Gestão de Estoque
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Estoque atual, pedidos em aberto, cobertura e estoque ideal por material.
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          disabled={!itensPayload?.itens?.length}
        >
          <Download size={16} />
          Exportar página
        </button>
      </div>

      {error && <div className="card p-5 text-sm text-red-600">{error}</div>}

      {loadingResumo ? (
        <div className="card p-10 text-sm" style={{ color: "var(--text-secondary)" }}>
          Carregando resumo...
        </div>
      ) : resumo ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              label="Itens"
              value={fmtNumber(resumo.resumo?.total_itens || 0)}
              helper={`Snapshot: ${fmtDate(resumo.data_snapshot_consumo)}`}
              icon={<Boxes size={20} />}
            />
            <KpiCard
              label="Ruptura"
              value={fmtNumber(resumo.resumo?.ruptura || 0)}
              helper="Saldo zerado com consumo"
              icon={<AlertTriangle size={20} />}
              tone="danger"
            />
            <KpiCard
              label="Críticos"
              value={fmtNumber(resumo.resumo?.critico || 0)}
              helper="Abaixo do ideal/LT"
              icon={<ArrowDownRight size={20} />}
              tone="warning"
            />
            <KpiCard
              label="Excesso"
              value={fmtNumber(resumo.resumo?.excesso || 0)}
              helper="Acima da política"
              icon={<ArrowUpRight size={20} />}
              tone="blue"
            />
            <KpiCard
              label="Cobertura média"
              value={`${fmtNumber(resumo.resumo?.cobertura_media_dias || 0, 0)} d`}
              helper="Itens com consumo"
              icon={<Clock size={20} />}
            />
            <KpiCard
              label="Cobertura futura"
              value={`${fmtNumber(resumo.resumo?.cobertura_futura_media_dias || 0, 0)} d`}
              helper="Com pedidos abertos"
              icon={<ShoppingCart size={20} />}
              tone="success"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="card p-5">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Maiores excessos
              </p>
              <div className="mt-4 space-y-3">
                {(resumo.top_excesso || []).slice(0, 6).map((item) => (
                  <button
                    key={item.codigo}
                    className="w-full rounded-xl border p-3 text-left transition hover:bg-slate-50"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => abrirDetalhe(item)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.codigo} · {item.produto}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Gap {fmtCompact(item.gap_volume)} · Saldo {fmtCompact(item.saldo)}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Itens críticos
              </p>
              <div className="mt-4 space-y-3">
                {(resumo.top_criticos || []).slice(0, 6).map((item) => (
                  <button
                    key={item.codigo}
                    className="w-full rounded-xl border p-3 text-left transition hover:bg-slate-50"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => abrirDetalhe(item)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.codigo} · {item.produto}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Cob. futura {fmtNumber(item.cobertura_futura_dias, 0)} d · Gap {fmtCompact(item.gap_volume)}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="card p-5">
        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
              Base analítica
            </p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Materiais por cobertura e estoque ideal
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Mostrando {fmtNumber(itensPayload?.itens?.length || 0)} de {fmtNumber(itensPayload?.total || 0)} itens filtrados.
            </p>
          </div>

          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar código ou produto"
                className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm outline-none md:w-[260px]"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </div>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-10 rounded-xl border bg-white px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <option value="TODOS">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="h-10 rounded-xl border bg-white px-3 text-sm outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t === "TODOS" ? "Todos os tipos" : t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingItens ? (
          <div className="rounded-2xl border p-10 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            Carregando itens...
          </div>
        ) : (
          <>
            <div className="overflow-auto rounded-2xl border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-right">Pedidos</th>
                    <th className="px-4 py-3 text-right">Estoque + pedidos</th>
                    <th className="px-4 py-3 text-right">Maior média</th>
                    <th className="px-4 py-3 text-right">LT</th>
                    <th className="px-4 py-3 text-right">Qtd. mínima</th>
                    <th className="px-4 py-3 text-right">Estoque ideal</th>
                    <th className="px-4 py-3 text-right">Cobertura</th>
                    <th className="px-4 py-3 text-right">Cob. futura</th>
                    <th className="px-4 py-3 text-right">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {(itensPayload?.itens || []).map((item) => (
                    <tr
                      key={`${item.codigo}-${item.tipo}`}
                      className="cursor-pointer border-t transition hover:bg-slate-50"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => abrirDetalhe(item)}
                    >
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 font-bold" style={{ color: "var(--text-primary)" }}>
                        {item.codigo}
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[320px] truncate font-medium" style={{ color: "var(--text-primary)" }}>
                          {item.produto || "—"}
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          {item.grupo_descricao || item.nome_2 || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">{item.tipo || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmtNumber(item.saldo, 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.qtd_pedidos_abertos, 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmtNumber(item.estoque_mais_pedidos, 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.maior_media, 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.lead_time_dias, 0)} d</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.qtd_minima, 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmtNumber(item.estoque_ideal, 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.cobertura_dias, 0)} d</td>
                      <td className="px-4 py-3 text-right">{fmtNumber(item.cobertura_futura_dias, 0)} d</td>
                      <td className="px-4 py-3 text-right font-bold" style={{ color: item.gap_volume < 0 ? "#DC2626" : "#1D4ED8" }}>
                        {fmtNumber(item.gap_volume, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!itensPayload?.itens?.length && (
                <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                  Nenhum item encontrado para os filtros selecionados.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col items-center justify-between gap-3 md:flex-row">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Página {fmtNumber(page)} de {fmtNumber(totalPages)} · {fmtNumber(itensPayload?.total || 0)} itens
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ItemDrawer item={selected} loading={selectedLoading} onClose={() => setSelected(null)} />
    </div>
  )
}
