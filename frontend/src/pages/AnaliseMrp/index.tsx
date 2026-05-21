import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  PackageSearch,
  Search,
  ShoppingCart,
  TrendingUp,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AgingDashboard,
  AgingEstoqueItem,
  getAgingEstoqueDashboard,
} from "@/services/api"

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
  RUPTURA: {
    bg: "rgba(220,38,38,0.09)",
    color: "#B91C1C",
    border: "rgba(220,38,38,0.24)",
  },
  CRITICO: {
    bg: "rgba(234,88,12,0.10)",
    color: "#C2410C",
    border: "rgba(234,88,12,0.24)",
  },
  ATENCAO: {
    bg: "rgba(245,158,11,0.12)",
    color: "#B45309",
    border: "rgba(245,158,11,0.28)",
  },
  SAUDAVEL: {
    bg: "rgba(22,163,74,0.09)",
    color: "#15803D",
    border: "rgba(22,163,74,0.24)",
  },
  EXCESSO: {
    bg: "rgba(37,99,235,0.09)",
    color: "#1D4ED8",
    border: "rgba(37,99,235,0.24)",
  },
  SEM_GIRO: {
    bg: "rgba(100,116,139,0.10)",
    color: "#475569",
    border: "rgba(100,116,139,0.24)",
  },
  SEM_CONSUMO: {
    bg: "rgba(100,116,139,0.10)",
    color: "#475569",
    border: "rgba(100,116,139,0.24)",
  },
}

function fmtNumber(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function fmtCompact(value: number | null | undefined) {
  const n = Number(value || 0)

  if (Math.abs(n) >= 1_000_000) {
    return `${fmtNumber(n / 1_000_000, 1)} mi`
  }

  if (Math.abs(n) >= 1_000) {
    return `${fmtNumber(n / 1_000, 1)} mil`
  }

  return fmtNumber(n, 0)
}

function fmtDate(value?: string | null) {
  if (!value) return "—"

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) {
    return String(value).slice(0, 10).split("-").reverse().join("/")
  }

  return d.toLocaleDateString("pt-BR")
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.SEM_GIRO

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
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

function MiniBar({ value, max, tone = "blue" }: { value: number; max: number; tone?: "blue" | "orange" | "red" | "green" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const colors = {
    blue: "#2563EB",
    orange: "#F59E0B",
    red: "#DC2626",
    green: "#16A34A",
  }

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70">
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: colors[tone],
        }}
      />
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          {title}
        </p>
        {subtitle && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function ItemDrawer({
  item,
  onClose,
}: {
  item: AgingEstoqueItem | null
  onClose: () => void
}) {
  if (!item) return null

  const historico = [...(item.historico_consumo || [])].reverse()

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
              {item.codigo} · {item.produto || "Sem descrição"}
            </h2>
            <div className="mt-3">
              <StatusBadge status={item.status} />
            </div>
          </div>

          <button
            className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-slate-100"
            onClick={onClose}
          >
            Fechar
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
            <KpiSmall label="Consumo durante LT" value={fmtCompact(item.consumo_durante_lt)} />
            <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
            <KpiSmall label="Gap vs ideal" value={fmtCompact(item.gap_volume)} />
          </div>
        </div>

        <div className="mt-6 card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Histórico de consumo
          </p>
          <div className="mt-4 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historico.slice(-18)} margin={{ top: 8, right: 10, left: 0, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis
                  dataKey="periodo"
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={52}
                  tick={{ fontSize: 10, fill: "#64748B" }}
                />
                <YAxis tick={{ fontSize: 10, fill: "#64748B" }} width={48} />
                <Tooltip formatter={(v: any) => [fmtNumber(Number(v), 0), "Consumo"]} />
                <Bar dataKey="consumo" radius={[6, 6, 0, 0]} fill="#27336D" />
              </BarChart>
            </ResponsiveContainer>
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
                      <td className="px-3 py-2">
                        {p.pedido_numero || p.sc_numero || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmtNumber(p.quantidade_pendente, 0)}
                      </td>
                      <td className="px-3 py-2">{fmtDate(p.data_prevista_entrega)}</td>
                      <td className="px-3 py-2">{p.fornecedor || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

export default function AgingEstoquePage() {
  const [data, setData] = useState<AgingDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("TODOS")
  const [tipo, setTipo] = useState("TODOS")
  const [busca, setBusca] = useState("")
  const [selected, setSelected] = useState<AgingEstoqueItem | null>(null)

  useEffect(() => {
    let mounted = true

    setLoading(true)
    setError("")

    getAgingEstoqueDashboard({
      status,
      tipo,
      busca,
    })
      .then((res) => {
        if (!mounted) return
        setData(res)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar Aging de Estoque")
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [status, tipo, busca])

  const tipos = useMemo(() => {
    const lista = new Set<string>()

    data?.itens?.forEach((item) => {
      lista.add(String(item.tipo || "Sem tipo"))
    })

    return ["TODOS", ...Array.from(lista).sort()]
  }, [data])

  const maxGap = useMemo(() => {
    return Math.max(1, ...(data?.top_excesso || []).map((i) => i.gap_volume))
  }, [data])

  const exportCsv = () => {
    const rows = data?.itens || []
    const header = [
      "codigo",
      "produto",
      "tipo",
      "saldo",
      "pedidos_abertos",
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
      ...rows.map((r) =>
        header
          .map((h) => String((r as any)[h] ?? "").replaceAll(";", ","))
          .join(";")
      ),
    ].join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "aging_estoque.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>
            Suprimentos · Estoque
          </p>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            Aging e Cobertura de Estoque
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Estoque atual, pedidos em aberto, cobertura e estoque ideal por material.
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          disabled={!data?.itens?.length}
        >
          <Download size={16} />
          Exportar CSV
        </button>
      </div>

      {loading ? (
        <div className="card p-10 text-sm" style={{ color: "var(--text-secondary)" }}>
          Carregando aging de estoque...
        </div>
      ) : error ? (
        <div className="card p-10 text-sm text-red-600">
          {error}
        </div>
      ) : !data ? (
        <div className="card p-10 text-sm" style={{ color: "var(--text-secondary)" }}>
          Nenhum dado encontrado.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              label="Itens"
              value={fmtNumber(data.resumo?.total_itens || 0)}
              helper={`Snapshot: ${fmtDate(data.data_snapshot_consumo)}`}
              icon={<Boxes size={20} />}
              tone="default"
            />
            <KpiCard
              label="Ruptura"
              value={fmtNumber(data.resumo?.ruptura || 0)}
              helper="Saldo zerado com consumo"
              icon={<AlertTriangle size={20} />}
              tone="danger"
            />
            <KpiCard
              label="Críticos"
              value={fmtNumber(data.resumo?.critico || 0)}
              helper="Abaixo do ideal/LT"
              icon={<ArrowDownRight size={20} />}
              tone="warning"
            />
            <KpiCard
              label="Excesso"
              value={fmtNumber(data.resumo?.excesso || 0)}
              helper="Acima da política"
              icon={<ArrowUpRight size={20} />}
              tone="blue"
            />
            <KpiCard
              label="Cobertura média"
              value={`${fmtNumber(data.resumo?.cobertura_media_dias || 0, 0)} d`}
              helper="Somente itens com consumo"
              icon={<Clock size={20} />}
              tone="default"
            />
            <KpiCard
              label="Cobertura futura"
              value={`${fmtNumber(data.resumo?.cobertura_futura_media_dias || 0, 0)} d`}
              helper="Com pedidos abertos"
              icon={<ShoppingCart size={20} />}
              tone="success"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <ChartCard
              title="Distribuição por cobertura futura"
              subtitle="Estoque + pedidos dividido pela maior média"
            >
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.faixas_cobertura || []} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="faixa" tick={{ fontSize: 11, fill: "#64748B" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748B" }} width={42} />
                    <Tooltip formatter={(v: any) => [fmtNumber(Number(v), 0), "Itens"]} />
                    <Bar dataKey="itens" radius={[8, 8, 0, 0]}>
                      {(data.faixas_cobertura || []).map((_, idx) => (
                        <Cell key={idx} fill={idx === 0 ? "#DC2626" : idx === 1 ? "#F59E0B" : "#27336D"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Críticos por tipo"
              subtitle="Itens em ruptura/crítico por tipo de material"
            >
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.por_tipo || []} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="tipo" tick={{ fontSize: 11, fill: "#64748B" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748B" }} width={42} />
                    <Tooltip formatter={(v: any, name: any) => [fmtNumber(Number(v), 0), name === "criticos" ? "Críticos" : "Excesso"]} />
                    <Bar dataKey="criticos" radius={[8, 8, 0, 0]} fill="#DC2626" />
                    <Bar dataKey="excesso" radius={[8, 8, 0, 0]} fill="#2563EB" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Maiores excessos"
              subtitle="Gap positivo vs estoque ideal"
            >
              <div className="space-y-3">
                {(data.top_excesso || []).slice(0, 7).map((item) => (
                  <button
                    key={item.codigo}
                    className="w-full rounded-xl border p-3 text-left transition hover:bg-slate-50"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => setSelected(item)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.codigo} · {item.produto}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Gap {fmtCompact(item.gap_volume)}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-blue-700">
                        {fmtCompact(item.saldo)}
                      </span>
                    </div>
                    <div className="mt-2">
                      <MiniBar value={item.gap_volume} max={maxGap} tone="blue" />
                    </div>
                  </button>
                ))}
              </div>
            </ChartCard>
          </div>

          <div className="card p-5">
            <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  Base analítica
                </p>
                <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                  Materiais por cobertura e estoque ideal
                </h2>
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
                    <option key={key} value={key}>{label}</option>
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
                  {(data.itens || []).map((item) => (
                    <tr
                      key={`${item.codigo}-${item.armaz}`}
                      className="cursor-pointer border-t transition hover:bg-slate-50"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => setSelected(item)}
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
                      <td
                        className="px-4 py-3 text-right font-bold"
                        style={{ color: item.gap_volume < 0 ? "#DC2626" : "#1D4ED8" }}
                      >
                        {fmtNumber(item.gap_volume, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!data.itens?.length && (
                <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                  Nenhum item encontrado para os filtros selecionados.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <ItemDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
