import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Download,
  Filter,
  PackageSearch,
  Search,
  ShoppingCart,
  X,
} from "lucide-react"
import {
  AgingEstoqueItem,
  getAgingItens,
  getAgingResumo,
} from "@/services/api"

const PAGE_SIZE = 100

const TIPOS_FIXOS = ["TODOS", "MC", "ME", "MI", "MP", "PA"]

const STATUS_LABEL: Record<string, string> = {
  TODOS: "Todos os status",
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


type SortDirection = "asc" | "desc"
type SortKey =
  | "saldo"
  | "qtd_pedidos_abertos"
  | "estoque_mais_pedidos"
  | "maior_media"
  | "lead_time_dias"
  | "qtd_minima"
  | "estoque_ideal"
  | "cobertura_dias"
  | "cobertura_futura_dias"
  | "gap_volume"

const NUMERIC_COLUMNS: { key: SortKey; label: string; suffix?: string }[] = [
  { key: "saldo", label: "Saldo" },
  { key: "qtd_pedidos_abertos", label: "Pedidos" },
  { key: "estoque_mais_pedidos", label: "Estoque + pedidos" },
  { key: "maior_media", label: "Maior média" },
  { key: "lead_time_dias", label: "LT", suffix: "d" },
  { key: "qtd_minima", label: "Qtd. mínima" },
  { key: "estoque_ideal", label: "Estoque ideal" },
  { key: "cobertura_dias", label: "Cobertura", suffix: "d" },
  { key: "cobertura_futura_dias", label: "Cob. futura", suffix: "d" },
  { key: "gap_volume", label: "Gap" },
]

interface AgingResumoResponse {
  data_snapshot_consumo?: string | null
  data_snapshot_mrp?: string | null
  resumo?: {
    total_itens?: number
    ruptura?: number
    critico?: number
    atencao?: number
    saudavel?: number
    excesso?: number
    sem_giro?: number
    saldo_total?: number
    pedidos_total?: number
    gap_total?: number
    cobertura_media_dias?: number
    cobertura_futura_media_dias?: number
  }
  top_excesso?: AgingEstoqueItem[]
  top_criticos?: AgingEstoqueItem[]
}

interface AgingItensResponse {
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

function SortableTh({
  label,
  column,
  sortKey,
  sortDirection,
  onSort,
}: {
  label: string
  column: SortKey
  sortKey: SortKey | null
  sortDirection: SortDirection
  onSort: (column: SortKey) => void
}) {
  const active = sortKey === column
  const arrow = active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"

  return (
    <th className="px-4 py-3 text-right">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center justify-end gap-1 rounded-md text-right font-bold text-white/95 transition hover:text-white"
        title={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <span className={active ? "text-white" : "text-white/55"}>{arrow}</span>
      </button>
    </th>
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
          {helper && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{helper}</p>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: tones[tone].bg, color: tones[tone].color }}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function KpiSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  )
}

function ItemDrawer({ item, onClose }: { item: AgingEstoqueItem | null; onClose: () => void }) {
  if (!item) return null

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="h-full w-full max-w-[760px] overflow-y-auto border-l bg-white p-6 shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Detalhe do item</p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {item.codigo} · {item.produto || "Sem descrição"}
            </h2>
            <div className="mt-3"><StatusBadge status={item.status} /></div>
          </div>
          <button className="rounded-xl p-2 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

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
            <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
            <KpiSmall label="Estoque ideal" value={fmtCompact(item.estoque_ideal)} />
            <KpiSmall label="Gap vs ideal" value={fmtCompact(item.gap_volume)} />
          </div>
        </div>

        <div className="mt-6 card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Histórico SB8 do mês atual
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Boa ideia incluir aqui. Como a SB8 agora vai guardar snapshots, o próximo passo é criar um endpoint por código para mostrar a evolução diária de saldo, empenho e saldo disponível no mês atual.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AgingEstoquePage() {
  const [resumo, setResumo] = useState<AgingResumoResponse | null>(null)
  const [itensResp, setItensResp] = useState<AgingItensResponse | null>(null)
  const [loadingResumo, setLoadingResumo] = useState(true)
  const [loadingItens, setLoadingItens] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("TODOS")
  const [tipo, setTipo] = useState("TODOS")
  const [busca, setBusca] = useState("")
  const [buscaAplicada, setBuscaAplicada] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AgingEstoqueItem | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  useEffect(() => {
    let mounted = true
    setLoadingResumo(true)
    setError("")

    getAgingResumo()
      .then((res) => {
        if (!mounted) return
        setResumo(res as AgingResumoResponse)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar resumo")
      })
      .finally(() => {
        if (mounted) setLoadingResumo(false)
      })

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setBuscaAplicada(busca.trim())
    }, 400)

    return () => window.clearTimeout(timer)
  }, [busca])

  useEffect(() => {
    setPage(1)
  }, [status, tipo])

  useEffect(() => {
    let mounted = true
    setLoadingItens(true)
    setError("")

    getAgingItens({
      page,
      page_size: PAGE_SIZE,
      status,
      tipo,
      busca: buscaAplicada,
    })
      .then((res) => {
        if (!mounted) return
        setItensResp(res as AgingItensResponse)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar itens")
      })
      .finally(() => {
        if (mounted) setLoadingItens(false)
      })

    return () => { mounted = false }
  }, [page, status, tipo, buscaAplicada])

  const itens = itensResp?.itens || []
  const totalPages = Math.max(1, itensResp?.total_pages || 1)

  const handleSort = (column: SortKey) => {
    if (sortKey === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }

    setSortKey(column)
    setSortDirection("desc")
  }

  const itensOrdenados = useMemo(() => {
    if (!sortKey) return itens

    return [...itens].sort((a, b) => {
      const aValue = Number((a as any)[sortKey] || 0)
      const bValue = Number((b as any)[sortKey] || 0)

      if (aValue === bValue) return 0

      return sortDirection === "asc" ? aValue - bValue : bValue - aValue
    })
  }, [itens, sortKey, sortDirection])

  const topExcesso = useMemo(() => resumo?.top_excesso || [], [resumo])
  const topCriticos = useMemo(() => resumo?.top_criticos || [], [resumo])

  const exportCsv = () => {
    const header = [
      "codigo", "produto", "tipo", "saldo", "qtd_pedidos_abertos", "estoque_mais_pedidos",
      "maior_media", "lead_time_dias", "qtd_minima", "estoque_ideal", "cobertura_dias",
      "cobertura_futura_dias", "gap_volume", "status",
    ]

    const csv = [
      header.join(";"),
      ...itens.map((r) => header.map((h) => String((r as any)[h] ?? "").replace(/;/g, ",")).join(";")),
    ].join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "gestao_estoque_pagina.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen p-6 space-y-5">
      <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>
            Suprimentos · Estoque
          </p>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            Gestão de Estoque
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Saldo atual, pedidos em aberto, cobertura e estoque ideal por material.
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          disabled={!itens.length}
        >
          <Download size={16} />
          Exportar CSV
        </button>
      </div>

      {error && <div className="card p-5 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Itens" value={fmtNumber(resumo?.resumo?.total_itens || 0)} helper={`Snapshot: ${fmtDate(resumo?.data_snapshot_consumo)}`} icon={<Boxes size={20} />} />
        <KpiCard label="Ruptura" value={fmtNumber(resumo?.resumo?.ruptura || 0)} helper="Saldo zerado com consumo" icon={<AlertTriangle size={20} />} tone="danger" />
        <KpiCard label="Críticos" value={fmtNumber(resumo?.resumo?.critico || 0)} helper="Abaixo do ideal/LT" icon={<ArrowDownRight size={20} />} tone="warning" />
        <KpiCard label="Excesso" value={fmtNumber(resumo?.resumo?.excesso || 0)} helper="Acima da política" icon={<ArrowUpRight size={20} />} tone="blue" />
        <KpiCard label="Saldo total" value={fmtCompact(resumo?.resumo?.saldo_total || 0)} helper="posição de estoque" icon={<PackageSearch size={20} />} />
        <KpiCard label="Pedidos" value={fmtCompact(resumo?.resumo?.pedidos_total || 0)} helper="compras em aberto" icon={<ShoppingCart size={20} />} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Maiores excessos</p>
          <div className="mt-4 space-y-2">
            {topExcesso.slice(0, 6).map((item) => (
              <button key={item.codigo} className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:bg-slate-50" style={{ borderColor: "var(--border)" }} onClick={() => setSelected(item)}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo} · {item.produto}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Gap {fmtCompact(item.gap_volume)} · Saldo {fmtCompact(item.saldo)}</p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
            {loadingResumo && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Carregando...</p>}
          </div>
        </div>

        <div className="card p-5">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Itens críticos</p>
          <div className="mt-4 space-y-2">
            {topCriticos.slice(0, 6).map((item) => (
              <button key={item.codigo} className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:bg-slate-50" style={{ borderColor: "var(--border)" }} onClick={() => setSelected(item)}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo} · {item.produto}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Cobertura futura {fmtNumber(item.cobertura_futura_dias, 0)} d</p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            ))}
            {loadingResumo && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Carregando...</p>}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-5 flex items-center gap-2">
          <Filter size={16} style={{ color: "var(--text-secondary)" }} />
          <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Filtros</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Busca</p>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Código ou produto"
                className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Status</p>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Tipo</p>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              {TIPOS_FIXOS.map((t) => <option key={t} value={t}>{t === "TODOS" ? "Todos os tipos" : t}</option>)}
            </select>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Resultado</p>
            <div className="flex h-10 items-center rounded-xl border px-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
              {fmtNumber(itensResp?.total || 0)} itens encontrados
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Base analítica</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Materiais por cobertura e estoque ideal</h2>
          </div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Página {page} de {totalPages}
          </p>
        </div>

        <div
          className="overflow-auto"
          style={{ maxHeight: "calc(100vh - 360px)" }}
        >
          <table className="w-full min-w-[1420px] text-sm">
            <thead className="sticky top-0 z-20 text-left text-[11px] uppercase tracking-wide text-white shadow-sm" style={{ background: "#163B63" }}>
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Tipo</th>
                {NUMERIC_COLUMNS.map((col) => (
                  <SortableTh
                    key={col.key}
                    label={col.label}
                    column={col.key}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>

            <tbody>
              {itensOrdenados.map((item) => (
                <tr key={`${item.codigo}-${item.tipo}`} className="cursor-pointer border-t transition hover:bg-slate-50" style={{ borderColor: "var(--border)" }} onClick={() => setSelected(item)}>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-3 font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo}</td>
                  <td className="px-4 py-3">
                    <div className="max-w-[340px] truncate font-medium" style={{ color: "var(--text-primary)" }}>{item.produto || "—"}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{item.grupo_descricao || "—"}</div>
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

          {!loadingItens && !itens.length && (
            <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              Nenhum item encontrado para os filtros selecionados.
            </div>
          )}

          {loadingItens && (
            <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              Carregando itens...
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Exibindo {fmtNumber(itens.length)} de {fmtNumber(itensResp?.total || 0)} itens
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loadingItens}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loadingItens}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      <ItemDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
