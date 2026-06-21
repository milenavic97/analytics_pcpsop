import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Factory,
  Layers,
  RefreshCw,
  Search,
  Target,
  TimerReset,
} from "lucide-react"

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  ""
).replace(/\/$/, "")

const COLORS = {
  navy: "#17375E",
  softBlue: "#D6DCE8",
  darkBlue: "#2F3B7C",
  orange: "#F97316",
  green: "#16A34A",
  red: "#EF4444",
  slate: "#94A3B8",
  purple: "#7C3AED",
}

const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
]

type TabKey = "dashboard" | "acompanhamento" | "perdas"
type LinhaFiltro = "TODAS" | "L1" | "L2"

interface PrincipalOfensor {
  motivo: string
  horas: number
  ocorrencias: number
  linhas: string
}

interface DashboardResumo {
  planejado_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
  horas_paradas: number
  lotes_envasados: number
  principal_ofensor?: PrincipalOfensor | null
}

interface MesProducao {
  mes: number
  mes_label: string
  planejado_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
  orcado_cx?: number
  orcado_producao_cx?: number
  orcado_liberacao_cx?: number
  orcado_caixas?: number
  orcado?: number
}

interface LinhaMensalProducao {
  linha: string
  nome: string
  meses: MesProducao[]
}

interface LinhaProducao {
  linha: string
  nome: string
  planejado_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
  horas_paradas: number
  lotes: number
  principal_ofensor?: PrincipalOfensor | null
  planejado_ytd_cx?: number
  realizado_ytd_cx?: number
  gap_ytd_cx?: number
  aderencia_ytd_pct?: number
  orcado_cx?: number
}

interface GrupoProducao {
  grupo: string
  realizado_cx: number
  lotes: number
}

interface OfensorPorLinha extends PrincipalOfensor {
  linha: string
  linha_nome: string
}

interface DashboardResponse {
  ano: number
  mes_final: number
  periodo_label: string
  linha: string
  resumo: DashboardResumo
  por_mes: MesProducao[]
  por_mes_linha?: LinhaMensalProducao[]
  por_linha: LinhaProducao[]
  top_ofensores: PrincipalOfensor[]
  top_ofensores_por_linha: OfensorPorLinha[]
  por_grupo: GrupoProducao[]
  debug?: Record<string, unknown>
}

interface AcompanhamentoCard {
  linha: string
  nome: string
  ultimo_lote: string
  ultima_data?: string | null
  total_caixas: number
  total_tubetes: number
  lotes: number
  planejado_mtd_tubetes?: number | null
  planejado_mtd_caixas?: number | null
  realizado_mtd_tubetes?: number | null
  realizado_mtd_caixas?: number | null
  atingimento_mtd_pct?: number | null
}

interface AcompanhamentoLinha {
  data: string
  dia: number
  lote: string
  op: string
  codigo: string
  produto: string
  grupo: string
  equipamentos: string
  qtd_tubetes: number
  qtd_caixas: number
  qtd_planejada_tubetes?: number | null
  qtd_planejada_caixas?: number | null
  primeiro_apontamento: string
  ultimo_apontamento: string
  registros: number
  status: string
  mes_liberacao?: string | null
}

interface AcompanhamentoSecao {
  linha: string
  nome: string
  tipo: string
  total_caixas: number
  total_tubetes: number
  lotes: number
  planejado_mtd_tubetes?: number | null
  planejado_mtd_caixas?: number | null
  realizado_mtd_tubetes?: number | null
  realizado_mtd_caixas?: number | null
  atingimento_mtd_pct?: number | null
  linhas: AcompanhamentoLinha[]
}

interface AcompanhamentoResponse {
  ano: number
  mes: number
  mes_label: string
  linha: string
  busca?: string | null
  cards: AcompanhamentoCard[]
  secoes: AcompanhamentoSecao[]
  debug?: Record<string, unknown>
}


interface PerdasCards {
  horas_paradas: number
  ocorrencias: number
  dias_com_parada: number
  media_min: number
  caixas_potenciais: number
  gap_ytd: number
  pct_gap_explicado: number
}

interface PerdasParetoMacro {
  macro_categoria: string
  horas: number
  ocorrencias: number
  dias: number
  media_min: number
  mediana_min: number
  p90_min: number
  min_por_dia: number
  caixas_potenciais: number
  pct_gap_explicado: number
}

interface PerdasParetoMaquina {
  linha: string
  maquina: string
  horas: number
  ocorrencias: number
  dias: number
  media_min: number
  mediana_min: number
  p90_min: number
  min_por_dia: number
  caixas_potenciais: number
  pct_gap_explicado: number
}

interface PerdasDistribuicao {
  macro_categoria: string
  faixa_duracao: string
  horas: number
  ocorrencias: number
}

interface PerdasCausa {
  macro_categoria: string
  motivo: string
  linha: string
  maquina: string
  equipamento: string
  horas: number
  ocorrencias: number
  dias: number
  media_min: number
  mediana_min: number
  p90_min: number
  min_por_dia: number
  caixas_potenciais: number
  pct_gap_explicado: number
}

interface PerdasResponse {
  ano: number
  mes_final: number
  periodo_label: string
  linha: string
  cards: PerdasCards
  pareto_macro: PerdasParetoMacro[]
  pareto_maquina: PerdasParetoMaquina[]
  distribuicao_duracao: PerdasDistribuicao[]
  tabela_causas: PerdasCausa[]
  debug?: Record<string, unknown>
}


function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(value || 0)))
}

function formatDecimal(value?: number, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function formatCx(value?: number) {
  return `${formatNumber(value)} cx`
}

function formatTubetes(value?: number) {
  return `${formatNumber(value)} tubetes`
}

function formatTubetesFromCx(value?: number) {
  return formatTubetes(Number(value || 0) * 500)
}

function formatHoras(value?: number) {
  return `${formatDecimal(value, 1)} h`
}

function formatPercent(value?: number) {
  return `${formatDecimal(value, 1)}%`
}

function formatDateBR(value?: string | null) {
  if (!value) return "—"
  const parts = String(value).slice(0, 10).split("-")
  if (parts.length !== 3) return value
  return `${parts[2]}/${parts[1]}`
}

function getYtdMonth(ano: number) {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()

  if (Number(ano) < anoAtual) return 12
  if (Number(ano) > anoAtual) return 1

  return Math.min(12, Math.max(1, hoje.getMonth() + 1))
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—"
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return String(value)
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt)
}

function aderenciaClass(value?: number) {
  const v = Number(value || 0)
  if (v >= 95) return "text-green-600"
  if (v >= 80) return "text-orange-500"
  return "text-red-500"
}

function gapClass(value?: number) {
  const v = Number(value || 0)
  if (v >= 0) return "text-green-600"
  return "text-red-500"
}

function linhaLabel(linha: LinhaFiltro) {
  if (linha === "L1") return "Envase — Linha 1"
  if (linha === "L2") return "Envase — Linha 2"
  return "Todas as linhas"
}

const PRODUCAO_CACHE_TTL_MS = 15 * 60 * 1000
const PRODUCAO_STORAGE_PREFIX = "dfl-producao-cache-v1:"

type ProducaoCacheEntry<T = unknown> = {
  timestamp: number
  data?: T
  promise?: Promise<T>
}

const producaoCache = new Map<string, ProducaoCacheEntry>()

function getProducaoStorage() {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

function readProducaoCache<T>(key: string): T | null {
  const memory = producaoCache.get(key) as ProducaoCacheEntry<T> | undefined

  if (memory?.data !== undefined && Date.now() - memory.timestamp < PRODUCAO_CACHE_TTL_MS) {
    return memory.data
  }

  const storage = getProducaoStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(`${PRODUCAO_STORAGE_PREFIX}${key}`)
    if (!raw) return null

    const parsed = JSON.parse(raw) as { timestamp: number; data: T }

    if (!parsed || typeof parsed.timestamp !== "number" || Date.now() - parsed.timestamp > PRODUCAO_CACHE_TTL_MS) {
      storage.removeItem(`${PRODUCAO_STORAGE_PREFIX}${key}`)
      return null
    }

    producaoCache.set(key, { timestamp: parsed.timestamp, data: parsed.data })
    return parsed.data
  } catch {
    storage.removeItem(`${PRODUCAO_STORAGE_PREFIX}${key}`)
    return null
  }
}

function writeProducaoCache<T>(key: string, data: T) {
  const timestamp = Date.now()
  producaoCache.set(key, { timestamp, data })

  const storage = getProducaoStorage()
  if (!storage) return

  try {
    storage.setItem(`${PRODUCAO_STORAGE_PREFIX}${key}`, JSON.stringify({ timestamp, data }))
  } catch {
    // Mantém somente em memória quando o navegador bloquear localStorage.
  }
}

function clearProducaoCache() {
  producaoCache.clear()

  const storage = getProducaoStorage()
  if (!storage) return

  try {
    const keys: string[] = []

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key?.startsWith(PRODUCAO_STORAGE_PREFIX)) keys.push(key)
    }

    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // Não bloqueia a tela se o storage falhar.
  }
}

async function buscarVersaoProducao() {
  const bases = ["apontamentos", "programacao_ops", "mps"]

  const versoes = await Promise.all(
    bases.map(async (baseId) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/upload/ultima-atualizacao/${baseId}?_t=${Date.now()}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
            },
          },
        )

        if (!response.ok) return `${baseId}:sem-status`
        const payload = (await response.json()) as { ultima_atualizacao?: string | null }
        return `${baseId}:${payload?.ultima_atualizacao || "sem-atualizacao"}`
      } catch {
        return `${baseId}:sem-status`
      }
    }),
  )

  return versoes.join("|")
}

async function apiGet<T>(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
  options?: { force?: boolean },
) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  const cacheKey = url.toString()

  if (!options?.force) {
    const cached = readProducaoCache<T>(cacheKey)
    if (cached) return cached

    const pending = producaoCache.get(cacheKey)?.promise as Promise<T> | undefined
    if (pending) return pending
  }

  const requestPromise = (async () => {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "default",
    })

    if (!response.ok) {
      let detail = "Erro ao carregar dados de produção."
      try {
        const payload = await response.json()
        detail = payload?.detail || detail
      } catch {
        // mantém mensagem padrão
      }

      throw new Error(detail)
    }

    const json = (await response.json()) as T
    writeProducaoCache(cacheKey, json)
    return json
  })()

  producaoCache.set(cacheKey, { timestamp: Date.now(), promise: requestPromise })

  requestPromise.catch(() => {
    producaoCache.delete(cacheKey)
  })

  return requestPromise
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const filtered = payload.filter((item: any) => Number(item.value || 0) !== 0)

  return (
    <div className="min-w-[230px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{label}</p>
      {filtered.length === 0 && <p className="text-slate-400">Sem movimento</p>}
      {filtered.map((item: any) => {
        const dataKey = String(item.dataKey || "")
        const isAderenciaVisual = dataKey === "aderencia_visual"
        const isPct = dataKey.includes("pct") || isAderenciaVisual
        const isHora = dataKey.includes("horas")
        const tooltipValue = isAderenciaVisual
          ? Number(item.payload?.aderencia_ytd_pct ?? item.payload?.aderencia_pct ?? 0)
          : Number(item.value || 0)
        const value = isPct
          ? formatPercent(tooltipValue)
          : isHora
            ? formatHoras(tooltipValue)
            : formatCx(tooltipValue)

        return (
          <div key={item.dataKey} className="flex items-center justify-between gap-6 py-0.5">
            <span className="flex items-center gap-2 text-slate-500">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: item.color || item.fill }}
              />
              {item.name}
            </span>
            <span className="font-bold text-slate-900">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TopLabel(props: any) {
  const { x, y, width, value, fill = "#64748B" } = props
  if (!value || Number(value) === 0) return null
  return (
    <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill={fill}>
      {formatNumber(Number(value))}
    </text>
  )
}

function PageHeader({
  tab,
  onTabChange,
  mes,
  ano,
  linha,
  onMesChange,
  onAnoChange,
  onLinhaChange,
  onRefresh,
  loading,
}: {
  tab: TabKey
  onTabChange: (tab: TabKey) => void
  mes: number
  ano: number
  linha: LinhaFiltro
  onMesChange: (value: number) => void
  onAnoChange: (value: number) => void
  onLinhaChange: (value: LinhaFiltro) => void
  onRefresh: () => void
  loading: boolean
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Produção
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard de Produção</h1>
          <p className="mt-2 text-slate-500">
            Visão anual de envase: planejado pela Programação Mensal + MPS x realizado Cogtive, por linha e por mês.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {tab !== "dashboard" && (
            <select
              value={mes}
              onChange={(event) => onMesChange(Number(event.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
            >
              {MESES.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {`${label}/${ano}`}
                </option>
              ))}
            </select>
          )}

          {tab === "dashboard" && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
              Ano fechado: Jan–Dez
            </div>
          )}

          {tab === "perdas" && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
              Perdas YTD: Jan até o mês selecionado
            </div>
          )}

          <select
            value={ano}
            onChange={(event) => onAnoChange(Number(event.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            {[2024, 2025, 2026, 2027].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={linha}
            onChange={(event) => onLinhaChange(event.target.value as LinhaFiltro)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            <option value="TODAS">Todas as linhas</option>
            <option value="L1">Envase — Linha 1</option>
            <option value="L2">Envase — Linha 2</option>
          </select>

          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          onClick={() => onTabChange("dashboard")}
          className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
            tab === "dashboard"
              ? "bg-[#17375E] text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => onTabChange("acompanhamento")}
          className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
            tab === "acompanhamento"
              ? "bg-[#17375E] text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Acompanhamento do Mês
        </button>
        <button
          onClick={() => onTabChange("perdas")}
          className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
            tab === "perdas"
              ? "bg-[#17375E] text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Análise de Paradas
        </button>
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  detail,
  icon: Icon,
  accent = "blue",
}: {
  title: string
  value: string
  subtitle?: string
  detail?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any
  accent?: "blue" | "green" | "orange" | "red" | "purple" | "slate"
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
          <h3 className="mt-4 text-3xl font-bold text-slate-900">{value}</h3>
          {detail && (
            <p className="mt-1 text-sm font-bold text-slate-700">{detail}</p>
          )}
          {subtitle && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className={`rounded-xl p-3 ${styles[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function PercentPointLabel(props: any) {
  const { x, y, value, payload } = props
  const raw = Number(payload?.aderencia_ytd_pct ?? payload?.aderencia_pct ?? value ?? 0)

  if (!x || !y || !raw) return null

  const fill = raw >= 95 ? COLORS.green : raw >= 80 ? "#4F6FAE" : COLORS.red

  return (
    <text
      x={x}
      y={y - 24}
      textAnchor="middle"
      fontSize={10}
      fontWeight={800}
      fill={fill}
    >
      {`${formatDecimal(raw, 0)}%`}
    </text>
  )
}

function LineValueLabel(props: any) {
  const { x, y, value, fill = COLORS.orange } = props
  const v = Number(value || 0)

  if (!x || !y || !v) return null

  return (
    <text
      x={x}
      y={y - 8}
      textAnchor="middle"
      fontSize={10}
      fontWeight={800}
      fill={fill}
    >
      {formatNumber(v)}
    </text>
  )
}

function OrcadoMarkerDot(props: any) {
  const { cx, cy, payload } = props
  const value = Number(payload?.orcado_plot_cx || 0)

  if (!cx || !cy || !value) return null

  return (
    <line
      x1={cx - 20}
      x2={cx + 20}
      y1={cy}
      y2={cy}
      stroke={COLORS.orange}
      strokeWidth={3}
      strokeLinecap="round"
    />
  )
}

type MonthlySeriesKey = "planejado" | "realizado" | "orcado" | "aderencia"

type MonthlySeriesState = Record<MonthlySeriesKey, boolean>

function getOrcadoCx(item: MesProducao) {
  return Number(
    item.orcado_cx ??
      item.orcado_producao_cx ??
      item.orcado_liberacao_cx ??
      item.orcado_caixas ??
      item.orcado ??
      0,
  )
}

function ToggleLegend({
  series,
  onToggle,
  showOrcado,
}: {
  series: MonthlySeriesState
  onToggle: (key: MonthlySeriesKey) => void
  showOrcado: boolean
}) {
  const items: Array<{
    key: MonthlySeriesKey
    label: string
    color: string
    type: "bar" | "line"
    enabled: boolean
  }> = [
    {
      key: "planejado",
      label: "Planejado",
      color: COLORS.softBlue,
      type: "bar",
      enabled: true,
    },
    {
      key: "realizado",
      label: "Realizado envase",
      color: COLORS.darkBlue,
      type: "bar",
      enabled: true,
    },
    {
      key: "orcado",
      label: "Orçado",
      color: COLORS.orange,
      type: "line",
      enabled: showOrcado,
    },
    {
      key: "aderencia",
      label: "% atingido YTD",
      color: COLORS.slate,
      type: "line",
      enabled: true,
    },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.filter((item) => item.enabled).map((item) => {
        const active = series[item.key]

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              active
                ? "border-slate-200 bg-white text-slate-700 shadow-sm"
                : "border-slate-200 bg-slate-50 text-slate-400 opacity-60"
            }`}
            title={active ? `Ocultar ${item.label}` : `Mostrar ${item.label}`}
          >
            {item.type === "bar" ? (
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
            ) : (
              <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: item.color }} />
            )}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function MonthlyLineChartCard({
  title,
  subtitle,
  meses,
  ano,
}: {
  title: string
  subtitle: string
  meses: MesProducao[]
  ano: number
}) {
  const [series, setSeries] = useState<MonthlySeriesState>({
    planejado: true,
    realizado: true,
    orcado: true,
    aderencia: true,
  })

  const chartData = useMemo(() => {
    const ytdMonth = getYtdMonth(ano)
    let planejadoAcum = 0
    let realizadoAcum = 0

    return (meses || []).map((item) => {
      const orcadoCx = getOrcadoCx(item)
      const planejadoCx = Number(item.planejado_cx || 0)
      const realizadoCx = Number(item.realizado_cx || 0)

      let aderenciaYtdPct: number | null = null

      if (Number(item.mes || 0) <= ytdMonth) {
        planejadoAcum += planejadoCx
        realizadoAcum += realizadoCx
        aderenciaYtdPct = planejadoAcum > 0 ? (realizadoAcum / planejadoAcum) * 100 : null
      }

      return {
        ...item,
        planejado_plot_cx: planejadoCx > 0 ? planejadoCx : null,
        realizado_plot_cx: realizadoCx > 0 ? realizadoCx : null,
        orcado_plot_cx: orcadoCx > 0 ? orcadoCx : null,
        aderencia_ytd_pct: aderenciaYtdPct,
        // Mantém o rótulo real em aderencia_ytd_pct, mas plota a linha comprimida no topo.
        aderencia_visual:
          aderenciaYtdPct !== null
            ? 126 + (Math.min(110, Math.max(0, aderenciaYtdPct)) / 110) * 3
            : null,
        aderencia_plot_pct: aderenciaYtdPct,
      }
    })
  }, [ano, meses])

  const aderenciaAxisMax = 130
  const aderenciaTicks = [0, 50, 80, 100, 130]

  const showOrcado = useMemo(() => {
    return chartData.some((item) => Number(item.orcado_plot_cx || 0) > 0)
  }, [chartData])

  function toggleSeries(key: MonthlySeriesKey) {
    setSeries((current) => ({ ...current, [key]: !current[key] }))
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Evolução mensal
          </p>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>

        <ToggleLegend series={series} onToggle={toggleSeries} showOrcado={showOrcado} />
      </div>

      <div className="h-[430px] rounded-2xl border border-slate-200 bg-white p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            barCategoryGap="30%"
            barGap={8}
            margin={{ top: 58, right: 14, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="#EEF2F7" strokeDasharray="3 3" />
            <XAxis
              dataKey="mes_label"
              tick={{ fill: "#64748B", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              hide
              domain={[0, "dataMax + 3000"]}
              axisLine={false}
              tickLine={false}
              width={0}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, aderenciaAxisMax]}
              ticks={aderenciaTicks}
              hide
              axisLine={false}
              tickLine={false}
              width={0}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.03)" }} />

            {series.planejado && (
              <Bar
                yAxisId="left"
                dataKey="planejado_plot_cx"
                name="Planejado"
                fill={COLORS.softBlue}
                radius={[7, 7, 0, 0]}
                barSize={28}
                isAnimationActive={false}
              >
                <LabelList dataKey="planejado_cx" content={<TopLabel fill="#64748B" dx={-7} />} />
              </Bar>
            )}

            {series.realizado && (
              <Bar
                yAxisId="left"
                dataKey="realizado_plot_cx"
                name="Realizado envase"
                fill={COLORS.darkBlue}
                radius={[7, 7, 0, 0]}
                barSize={28}
                isAnimationActive={false}
              >
                <LabelList dataKey="realizado_cx" content={<TopLabel fill="#2F3B7C" dx={7} />} />
              </Bar>
            )}

            {showOrcado && series.orcado && (
              <Line
                yAxisId="left"
                type="linear"
                dataKey="orcado_plot_cx"
                name="Orçado"
                stroke="rgba(249, 115, 22, 0)"
                strokeWidth={0}
                dot={<OrcadoMarkerDot />}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              >
                <LabelList dataKey="orcado_plot_cx" content={<LineValueLabel fill={COLORS.orange} />} />
              </Line>
            )}

            {series.aderencia && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="aderencia_visual"
                name="% atingido YTD"
                stroke="#9AAAC0"
                strokeWidth={1.5}
                dot={{ r: 2, fill: "#9AAAC0", stroke: "#9AAAC0" }}
                activeDot={{ r: 4, fill: "#9AAAC0", stroke: "#9AAAC0" }}
                connectNulls={false}
                isAnimationActive={false}
              >
                <LabelList dataKey="aderencia_pct" content={<PercentPointLabel />} />
              </Line>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}


function resumoLinhaPorMeses(
  linhaMensal: LinhaMensalProducao,
  linhasBackend: LinhaProducao[] = [],
  ano: number,
): LinhaProducao {
  const backend = linhasBackend.find((item) => item.linha === linhaMensal.linha)
  const ytdMonth = getYtdMonth(ano)

  const planejado = (linhaMensal.meses || []).reduce(
    (acc, mes) => acc + Number(mes.planejado_cx || 0),
    0,
  )

  const orcado = (linhaMensal.meses || []).reduce(
    (acc, mes) => acc + getOrcadoCx(mes),
    0,
  )

  const planejadoYtd = (linhaMensal.meses || []).reduce(
    (acc, mes) => Number(mes.mes || 0) <= ytdMonth ? acc + Number(mes.planejado_cx || 0) : acc,
    0,
  )

  const realizadoYtd = (linhaMensal.meses || []).reduce(
    (acc, mes) => Number(mes.mes || 0) <= ytdMonth ? acc + Number(mes.realizado_cx || 0) : acc,
    0,
  )

  const gapYtd = realizadoYtd - planejadoYtd
  const aderenciaYtd = planejadoYtd > 0 ? (realizadoYtd / planejadoYtd) * 100 : 0

  return {
    linha: linhaMensal.linha,
    nome: linhaMensal.nome,
    planejado_cx: planejado,
    realizado_cx: realizadoYtd,
    gap_cx: gapYtd,
    aderencia_pct: aderenciaYtd,
    planejado_ytd_cx: planejadoYtd,
    realizado_ytd_cx: realizadoYtd,
    gap_ytd_cx: gapYtd,
    aderencia_ytd_pct: aderenciaYtd,
    orcado_cx: orcado,
    horas_paradas: Number(backend?.horas_paradas || 0),
    lotes: Number(backend?.lotes || 0),
    principal_ofensor: backend?.principal_ofensor || null,
  }
}

function LinhaResumoCards({
  resumo,
  periodoLabel,
}: {
  resumo: LinhaProducao
  periodoLabel: string
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
      <MetricCard
        title="Planejado ano"
        value={formatCx(resumo.planejado_cx)}
        detail={formatTubetesFromCx(resumo.planejado_cx)}
        subtitle={`Programação + MPS · ${periodoLabel}`}
        icon={Layers}
        accent="purple"
      />
      <MetricCard
        title="Orçado ano"
        value={formatCx(resumo.orcado_cx)}
        detail={formatTubetesFromCx(resumo.orcado_cx)}
        subtitle="Orçado de produção"
        icon={Target}
        accent="orange"
      />
      <MetricCard
        title="Realizado YTD"
        value={formatCx(resumo.realizado_cx)}
        detail={formatTubetesFromCx(resumo.realizado_cx)}
        subtitle={`${formatNumber(resumo.lotes)} lotes envasados`}
        icon={Factory}
        accent="green"
      />
      <MetricCard
        title="% atingido YTD"
        value={formatPercent(resumo.aderencia_pct)}
        subtitle="Realizado / planejado YTD"
        icon={Target}
        accent={resumo.aderencia_pct >= 95 ? "green" : resumo.aderencia_pct >= 80 ? "orange" : "red"}
      />
      <MetricCard
        title="Gap YTD"
        value={formatCx(resumo.gap_cx)}
        detail={formatTubetesFromCx(resumo.gap_cx)}
        subtitle={resumo.gap_cx >= 0 ? "Acima do planejado" : "Abaixo do planejado"}
        icon={BarChart3}
        accent={resumo.gap_cx >= 0 ? "green" : "red"}
      />
      <MetricCard
        title="Horas paradas YTD"
        value={formatHoras(resumo.horas_paradas)}
        subtitle="Somente esta linha"
        icon={TimerReset}
        accent="orange"
      />
    </div>
  )
}


function DashboardTab({ data }: { data: DashboardResponse }) {
  const resumo = data.resumo

  const linhasMensais = useMemo(() => {
    const base = data.por_mes_linha?.length
      ? data.por_mes_linha
      : [{ linha: data.linha, nome: linhaLabel(data.linha as LinhaFiltro), meses: data.por_mes || [] }]

    return base.filter((item) => data.linha === "TODAS" || item.linha === data.linha)
  }, [data])

  return (
    <div className="space-y-6">
      {linhasMensais.map((linha) => {
        const resumoLinha = resumoLinhaPorMeses(linha, data.por_linha, data.ano)

        return (
          <section key={linha.linha} className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  {linha.nome}
                </p>
                <h2 className="text-xl font-bold text-slate-900">
                  Resumo da {linha.nome}
                </h2>
              </div>
            </div>

            <LinhaResumoCards resumo={resumoLinha} periodoLabel={data.periodo_label} />

            <MonthlyLineChartCard
              title={`${linha.nome} — planejado x realizado`}
              subtitle={`Ano fechado ${data.periodo_label}. Planejado pela Programação Mensal + MPS; realizado pelos apontamentos de envase; % acumulado YTD.`}
              meses={linha.meses}
              ano={data.ano}
            />
          </section>
        )
      })}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Principais ofensores
            </p>
            <h2 className="text-xl font-bold text-slate-900">Horas paradas no ano</h2>
            <p className="mt-1 text-sm text-slate-500">
              Maiores motivos de parada/setup/manutenção em envase no período.
            </p>
          </div>
          <div className="rounded-xl bg-orange-50 px-4 py-2 text-sm font-bold text-orange-600">
            {formatHoras(resumo.horas_paradas)} no período
          </div>
        </div>

        {data.top_ofensores.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
            Nenhuma parada encontrada no período.
          </div>
        ) : (
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.top_ofensores}
                layout="vertical"
                margin={{ top: 8, right: 28, left: 10, bottom: 8 }}
              >
                <CartesianGrid horizontal={false} stroke="#EEF2F7" />
                <XAxis
                  type="number"
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="motivo"
                  width={180}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.03)" }} />
                <Bar dataKey="horas" name="Horas" fill={COLORS.orange} radius={[0, 8, 8, 0]} barSize={22}>
                  <LabelList dataKey="horas" position="right" formatter={(value: number) => formatHoras(value)} fill="#64748B" fontSize={11} fontWeight={700} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Aderência por linha
            </p>
            <h2 className="text-xl font-bold text-slate-900">Linha 1 e Linha 2</h2>
            <p className="mt-1 text-sm text-slate-500">
              Linha 1 considera MAQ 1 e MAQ 2 envasadora. Linha 2 considera L2 envasadora.
            </p>
          </div>

          <div className="space-y-3">
            {data.por_linha.map((item) => (
              <div key={item.linha} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{item.nome}</p>
                    <p className="text-sm text-slate-500">
                      Realizado {formatCx(item.realizado_cx)} de {formatCx(item.planejado_cx)} planejadas
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-black ${aderenciaClass(item.aderencia_pct)}`}>
                      {formatPercent(item.aderencia_pct)}
                    </p>
                    <p className={`text-sm font-bold ${gapClass(item.gap_cx)}`}>
                      Gap {formatCx(item.gap_cx)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[#17375E]"
                    style={{ width: `${Math.min(Math.max(item.aderencia_pct || 0, 0), 100)}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                  <span>{formatHoras(item.horas_paradas)} paradas</span>
                  <span>{formatNumber(item.lotes)} lotes</span>
                  <span>Ofensor: {item.principal_ofensor?.motivo || "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Produção por grupo
              </p>
              <h2 className="text-xl font-bold text-slate-900">Realizado em envase</h2>
              <p className="mt-1 text-sm text-slate-500">
                Volume envasado agrupado por família/produto no período.
              </p>
            </div>
            <div className="rounded-xl bg-green-50 p-3 text-green-600">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>

          <div className="max-h-[430px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Grupo</th>
                  <th className="px-4 py-3 text-right">Realizado</th>
                  <th className="px-4 py-3 text-right">Lotes</th>
                </tr>
              </thead>
              <tbody>
                {data.por_grupo.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                      Nenhum grupo encontrado.
                    </td>
                  </tr>
                )}
                {data.por_grupo.map((item) => (
                  <tr key={item.grupo} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{item.grupo}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCx(item.realizado_cx)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatNumber(item.lotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function AcompanhamentoCardView({ item }: { item: AcompanhamentoCard }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{item.nome}</p>
          <h3 className="mt-3 text-2xl font-black text-slate-900">{item.ultimo_lote || "—"}</h3>
          <p className="mt-1 text-sm text-slate-500">Último lote envasado • {formatDateBR(item.ultima_data)}</p>
        </div>
        <div className="rounded-xl bg-green-50 p-3 text-green-600">
          <Factory className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div>
          <p className="text-xs font-bold uppercase text-slate-400">Total</p>
          <p className="font-bold text-slate-900">{formatCx(item.total_caixas)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-slate-400">Lotes</p>
          <p className="font-bold text-slate-900">{formatNumber(item.lotes)}</p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === "Envasado"
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {status}
    </span>
  )
}

function AcompanhamentoSecaoView({ secao }: { secao: AcompanhamentoSecao }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-green-50 p-3 text-green-600">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{secao.tipo}</p>
              <h2 className="text-xl font-bold text-slate-900">{secao.nome}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {formatCx(secao.total_caixas)} • {formatNumber(secao.lotes)} lotes no mês
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600">
            {formatTubetes(secao.total_tubetes)}
          </div>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Lote / OP</th>
              <th className="px-4 py-3 text-left">Produto</th>
              <th className="px-4 py-3 text-left">Equipamento</th>
              <th className="px-4 py-3 text-right">Tubetes</th>
              <th className="px-4 py-3 text-right">Caixas</th>
              <th className="px-4 py-3 text-left">Último apontamento</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {secao.linhas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  Nenhum apontamento de envase encontrado para esta linha.
                </td>
              </tr>
            )}

            {secao.linhas.map((row, idx) => (
              <tr key={`${row.data}-${row.lote}-${row.op}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-4 py-4 align-top font-bold text-[#A34713]">{formatDateBR(row.data)}</td>
                <td className="px-4 py-4 align-top">
                  <p className="font-black text-slate-900">{row.lote || "—"}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">OP {row.op || "—"}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="max-w-[300px] truncate font-semibold text-slate-700">{row.produto || "—"}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{row.grupo || row.codigo || "—"}</p>
                </td>
                <td className="px-4 py-4 align-top text-slate-600">{row.equipamentos || "—"}</td>
                <td className="px-4 py-4 align-top text-right text-slate-600">{formatNumber(row.qtd_tubetes)}</td>
                <td className="px-4 py-4 align-top text-right font-black text-slate-900">{formatNumber(row.qtd_caixas)}</td>
                <td className="px-4 py-4 align-top text-slate-600">{formatDateTimeBR(row.ultimo_apontamento)}</td>
                <td className="px-4 py-4 align-top"><StatusBadge status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}



function MiniMtdCard({
  title,
  value,
  subtitle,
  accent = "slate",
  status,
  icon,
}: {
  title: string
  value: string
  subtitle?: string
  status?: string
  icon?: any
  accent?: "slate" | "green" | "orange" | "red" | "blue"
}) {
  const Icon = icon || Layers

  const styles = {
    slate: {
      value: "text-slate-900",
      iconWrap: "bg-slate-100 text-slate-500",
      status: "text-slate-500",
    },
    blue: {
      value: "text-[#17375E]",
      iconWrap: "bg-blue-50 text-[#17375E]",
      status: "text-[#17375E]",
    },
    green: {
      value: "text-green-700",
      iconWrap: "bg-green-50 text-green-600",
      status: "text-green-700",
    },
    orange: {
      value: "text-orange-700",
      iconWrap: "bg-orange-50 text-orange-600",
      status: "text-orange-700",
    },
    red: {
      value: "text-red-600",
      iconWrap: "bg-red-50 text-red-500",
      status: "text-red-600",
    },
  }[accent]

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
            {title}
          </p>
          <p className={`mt-2 text-[28px] font-black leading-none ${styles.value}`}>{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${styles.iconWrap}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {subtitle ? <p className="text-[11px] font-bold text-slate-500">{subtitle}</p> : <span />}
        {status ? <p className={`text-[10px] font-black uppercase tracking-wide ${styles.status}`}>{status}</p> : null}
      </div>
    </div>
  )
}

function atingimentoAccent(value?: number | null): "green" | "orange" | "red" | "slate" {
  const v = Number(value || 0)
  if (!v) return "slate"
  if (v >= 95) return "green"
  if (v >= 80) return "orange"
  return "red"
}

function atingimentoStatus(value?: number | null) {
  const v = Number(value || 0)
  if (!v) return "sem plano"
  if (v >= 95) return "no ritmo"
  if (v >= 80) return "atenção"
  return "abaixo"
}


function AcompanhamentoPainelCompacto({
  secao,
  card,
}: {
  secao: AcompanhamentoSecao
  card?: AcompanhamentoCard
}) {
  const linhas = secao.linhas || []
  const ultimoLote = card?.ultimo_lote || "—"
  const ultimaData = formatDateBR(card?.ultima_data)
  const totalTubetes = Number(card?.total_tubetes ?? secao.total_tubetes ?? 0)
  const totalCaixas = Number(card?.total_caixas ?? secao.total_caixas ?? 0)
  const totalLotes = Number(card?.lotes ?? secao.lotes ?? 0)
  const planejadoMtdTb = Number(card?.planejado_mtd_tubetes ?? secao.planejado_mtd_tubetes ?? 0)
  const planejadoMtdCx = Number(card?.planejado_mtd_caixas ?? secao.planejado_mtd_caixas ?? 0)
  const realizadoMtdTb = Number(card?.realizado_mtd_tubetes ?? secao.realizado_mtd_tubetes ?? totalTubetes)
  const realizadoMtdCx = Number(card?.realizado_mtd_caixas ?? secao.realizado_mtd_caixas ?? totalCaixas)
  const atingimentoMtd = Number(card?.atingimento_mtd_pct ?? secao.atingimento_mtd_pct ?? 0)
  const Icon = secao.linha === "FABRIMA" ? Layers : Factory

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-[#17375E] px-4 py-3 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white/10 p-2 text-white ring-1 ring-white/10">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-100">
                {secao.tipo}
              </p>
              <h3 className="mt-1 text-lg font-black">{secao.nome}</h3>
              <p className="mt-0.5 text-xs font-semibold text-blue-100/80">
                Acompanhamento MTD até {ultimaData}
              </p>
            </div>
          </div>

          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black ring-1 ring-white/10">
            {formatNumber(totalTubetes)} tubetes
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 border-b border-slate-200 bg-white p-3 sm:grid-cols-3">
        <MiniMtdCard
          title="Planejado MTD"
          value={planejadoMtdTb > 0 ? formatNumber(planejadoMtdTb) : "—"}
          subtitle={planejadoMtdCx > 0 ? `${formatCx(planejadoMtdCx)} · meta até hoje` : "meta até hoje"}
          accent="blue"
          icon={Layers}
        />
        <MiniMtdCard
          title="Realizado MTD"
          value={formatNumber(realizadoMtdTb)}
          subtitle={`${formatCx(realizadoMtdCx)} · apontado`}
          accent="green"
          icon={BarChart3}
        />
        <MiniMtdCard
          title="Atingimento"
          value={planejadoMtdTb > 0 ? formatPercent(atingimentoMtd) : "—"}
          subtitle="realizado / planejado MTD"
          accent={atingimentoAccent(atingimentoMtd)}
          status={atingimentoStatus(atingimentoMtd)}
          icon={Target}
        />
      </div>

      <div className="grid grid-cols-3 gap-0 border-b border-slate-200 bg-slate-50/80">
        <div className="px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
            Último lote
          </p>
          <p className="mt-1 truncate text-sm font-black text-slate-900">{ultimoLote}</p>
        </div>
        <div className="border-l border-slate-200 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
            Última data
          </p>
          <p className="mt-1 text-sm font-black text-slate-900">{ultimaData}</p>
        </div>
        <div className="border-l border-slate-200 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
            Total mês
          </p>
          <p className="mt-1 text-sm font-black text-slate-900">
            {formatCx(totalCaixas)}
          </p>
        </div>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-blue-50 text-[11px] uppercase tracking-wide text-[#17375E]">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Lote / OP</th>
              <th className="px-3 py-2 text-left">Mês liberação</th>
              <th className="px-3 py-2 text-right">Qtd. planejada</th>
              <th className="px-3 py-2 text-right">Qtd. produzida</th>
            </tr>
          </thead>

          <tbody>
            {linhas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">
                  Nenhum apontamento encontrado.
                </td>
              </tr>
            )}

            {linhas.map((row, idx) => (
              <tr
                key={`${secao.linha}-${row.data}-${row.lote}-${row.op}-${idx}`}
                className="border-t border-slate-100 hover:bg-slate-50/80"
              >
                <td className="whitespace-nowrap px-3 py-2 align-top font-black text-[#A34713]">
                  {formatDateBR(row.data)}
                </td>
                <td className="px-3 py-2 align-top">
                  <p className="truncate font-black text-slate-900">{row.lote || "—"}</p>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
                    OP {row.op || "—"}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top">
                  <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">
                    {row.mes_liberacao || "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                  {Number(row.qtd_planejada_tubetes || 0) > 0 ? (
                    <>
                      <p className="font-black text-slate-700">{formatNumber(row.qtd_planejada_tubetes || 0)}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                        {formatCx(row.qtd_planejada_caixas || 0)}
                      </p>
                    </>
                  ) : (
                    <span className="font-black text-slate-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                  <p className="font-black text-slate-900">{formatNumber(row.qtd_tubetes)}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                    {formatCx(row.qtd_caixas)}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div>
          <span className="font-bold text-slate-400">Lotes: </span>
          <span className="font-black text-slate-800">{formatNumber(totalLotes)}</span>
        </div>
        <div className="text-right">
          <span className="font-bold text-slate-400">Registros: </span>
          <span className="font-black text-slate-800">{formatNumber(linhas.length)}</span>
        </div>
      </div>
    </div>
  )
}

function AcompanhamentoTab({
  data,
  busca,
  onBuscaChange,
}: {
  data: AcompanhamentoResponse
  busca: string
  onBuscaChange: (value: string) => void
}) {
  const secoesOrdenadas = useMemo(() => {
    const ordem = ["L1", "L2", "FABRIMA"]
    const mapa = new Map((data.secoes || []).map((secao) => [secao.linha, secao]))

    const ordenadas = ordem
      .map((linha) => mapa.get(linha))
      .filter(Boolean) as AcompanhamentoSecao[]

    const extras = (data.secoes || []).filter((secao) => !ordem.includes(secao.linha))

    return [...ordenadas, ...extras]
  }, [data.secoes])

  function cardDaSecao(secao: AcompanhamentoSecao) {
    return (data.cards || []).find((card) => card.linha === secao.linha)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Acompanhamento do mês
              </p>
              <h2 className="text-xl font-bold text-slate-900">
                Operação rápida — {data.mes_label}/{data.ano}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Visão paralela para bater rapidamente Linha 1, Linha 2 e Fabrima.
              </p>
            </div>
          </div>

          <div className="relative w-full lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(event) => onBuscaChange(event.target.value)}
              placeholder="Buscar lote, OP, produto ou equipamento"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-[#17375E]"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {secoesOrdenadas.map((secao) => (
          <AcompanhamentoPainelCompacto
            key={secao.linha}
            secao={secao}
            card={cardDaSecao(secao)}
          />
        ))}
      </div>
    </div>
  )
}





function macroColor(macro?: string) {
  const value = String(macro || "")

  if (value.includes("Micro")) return "#2563EB"
  if (value.includes("Setup")) return "#F97316"
  if (value.includes("Manutenção")) return "#7C3AED"
  if (value.includes("Qualidade")) return "#16A34A"
  if (value.includes("Falta")) return "#DC2626"
  if (value.includes("Limpeza")) return "#0F766E"
  if (value.includes("Programadas")) return "#64748B"
  if (value.includes("Não classificado")) return "#94A3B8"

  return "#17375E"
}

function macroLabelCurto(macro?: string) {
  const value = String(macro || "")

  if (value.includes("Micro")) return "Microparadas"
  if (value.includes("Setup")) return "Setup"
  if (value.includes("Manutenção")) return "Manutenção"
  if (value.includes("Qualidade")) return "Qualidade"
  if (value.includes("Falta")) return "Falta/espera"
  if (value.includes("Limpeza")) return "Limpeza"
  if (value.includes("Programadas")) return "Programadas"
  if (value.includes("Não classificado")) return "Não classif."

  return value.split(" / ")[0] || "Causa"
}

function percentWidth(value: number, max: number, min = 4) {
  if (!max || max <= 0 || !value) return 0
  return Math.max(min, Math.min(100, (value / max) * 100))
}

function causasResumo(item: PerdasParetoMacro) {
  const ocorrPorDia = item.dias > 0 ? item.ocorrencias / item.dias : 0

  return {
    ocorrPorDia,
    ocorrPorDiaLabel: `${formatDecimal(ocorrPorDia, 1)}x/dia`,
    mediaLabel: `${formatDecimal(item.media_min, 1)} min/ocorr.`,
    p90Label: `P90 ${formatDecimal(item.p90_min, 1)} min`,
  }
}

function leituraQuadrante(item: PerdasParetoMacro, maxOcorrDia: number, maxMediaMin: number) {
  const ocorrDia = item.dias > 0 ? item.ocorrencias / item.dias : 0
  const altaFreq = ocorrDia >= maxOcorrDia * 0.45
  const altaDuracao = Number(item.media_min || 0) >= maxMediaMin * 0.45

  if (altaFreq && altaDuracao) return "crítico estrutural"
  if (altaFreq) return "crônico / repetitivo"
  if (altaDuracao) return "pontual grave"

  return "monitorar"
}

function macroLabelLayout(macro?: string) {
  const value = String(macro || "")

  if (value.includes("Micro")) return { dx: 72, dy: 56, width: 120 }
  if (value.includes("Manutenção")) return { dx: 52, dy: 74, width: 120 }
  if (value.includes("Setup")) return { dx: -4, dy: 74, width: 104 }
  if (value.includes("Falta")) return { dx: -22, dy: 50, width: 102 }
  if (value.includes("Qualidade")) return { dx: -8, dy: 62, width: 94 }
  if (value.includes("Limpeza")) return { dx: 12, dy: 78, width: 94 }
  if (value.includes("Não classificado")) return { dx: 28, dy: 68, width: 108 }
  if (value.includes("Programadas")) return { dx: 18, dy: 58, width: 104 }

  return { dx: 24, dy: 64, width: 110 }
}

function PerdasTab({ data }: { data: PerdasResponse }) {
  const cards = data.cards
  const topMacros = (data.pareto_macro || []).slice(0, 8)
  const buckets = ["0–2 min", "2–5 min", "5–15 min", "15–60 min", ">60 min"]
  const maxHorasMacro = Math.max(1, ...topMacros.map((item) => Number(item.horas || 0)))

  const distMap = useMemo(() => {
    const map = new Map<string, PerdasDistribuicao>()

    ;(data.distribuicao_duracao || []).forEach((item) => {
      map.set(`${item.macro_categoria}__${item.faixa_duracao}`, item)
    })

    return map
  }, [data.distribuicao_duracao])

  const maxHorasBucket = Math.max(
    1,
    ...(data.distribuicao_duracao || []).map((item) => Number(item.horas || 0)),
  )

  const maquinas = useMemo(() => {
    const map = new Map<
      string,
      {
        maquina: string
        linha: string
        horas: number
        ocorrencias: number
        macros: Record<string, number>
        principal: string
      }
    >()

    ;(data.tabela_causas || []).forEach((row) => {
      const key = row.maquina || row.linha || "Sem máquina"

      if (!map.has(key)) {
        map.set(key, {
          maquina: key,
          linha: row.linha,
          horas: 0,
          ocorrencias: 0,
          macros: {},
          principal: "",
        })
      }

      const atual = map.get(key)!
      atual.horas += Number(row.horas || 0)
      atual.ocorrencias += Number(row.ocorrencias || 0)
      atual.macros[row.macro_categoria] =
        Number(atual.macros[row.macro_categoria] || 0) + Number(row.horas || 0)
    })

    return Array.from(map.values())
      .map((item) => {
        const principal = Object.entries(item.macros).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"
        return { ...item, principal }
      })
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8)
  }, [data.tabela_causas])

  const maxHorasMaquina = Math.max(1, ...maquinas.map((item) => item.horas))
  const maxOcorrDia = Math.max(
    1,
    ...topMacros.map((item) => (item.dias > 0 ? item.ocorrencias / item.dias : 0)),
  )
  const maxMediaMin = Math.max(1, ...topMacros.map((item) => Number(item.media_min || 0)))
  const topCausa = topMacros[0]
  const topMaquina = maquinas[0]

  const microparada = topMacros.find((item) => item.macro_categoria.includes("Micro"))
  const manutencao = topMacros.find((item) => item.macro_categoria.includes("Manutenção"))
  const setup = topMacros.find((item) => item.macro_categoria.includes("Setup"))

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Excelência operacional
        </p>
        <h2 className="text-xl font-bold text-slate-900">
          Análise de paradas — {data.periodo_label}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Leitura visual das causas: frequência, duração, máquina afetada e perfil da parada.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Horas paradas"
          value={formatHoras(cards.horas_paradas)}
          subtitle="Tempo total apontado"
          icon={TimerReset}
          accent="orange"
        />
        <MetricCard
          title="Ocorrências"
          value={formatNumber(cards.ocorrencias)}
          subtitle={`${formatDecimal(cards.ocorrencias / Math.max(1, cards.dias_com_parada), 1)}x por dia`}
          icon={BarChart3}
          accent="slate"
        />
        <MetricCard
          title="Duração média"
          value={`${formatDecimal(cards.media_min, 1)} min`}
          subtitle="Por ocorrência"
          icon={Target}
          accent="purple"
        />
        <MetricCard
          title="Dias com parada"
          value={formatNumber(cards.dias_com_parada)}
          subtitle="No período"
          icon={CalendarDays}
          accent="blue"
        />
        <MetricCard
          title="Principal causa"
          value={topCausa ? formatHoras(topCausa.horas) : "—"}
          subtitle={topCausa?.macro_categoria || "Sem causa"}
          icon={AlertTriangle}
          accent="red"
        />
        <MetricCard
          title="Principal máquina"
          value={topMaquina ? formatHoras(topMaquina.horas) : "—"}
          subtitle={topMaquina?.maquina || "Sem máquina"}
          icon={Factory}
          accent="green"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.75fr_0.85fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Matriz principal
              </p>
              <h3 className="text-xl font-black text-slate-900">Frequência x duração</h3>
              <p className="mt-1 text-sm text-slate-500">
                Direita = acontece mais vezes por dia. Alto = dura mais quando acontece. Tamanho da bolha = horas totais.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-blue-50 px-3 py-1 font-black text-blue-700">
                frequência
              </span>
              <span className="rounded-full bg-purple-50 px-3 py-1 font-black text-purple-700">
                duração
              </span>
              <span className="rounded-full bg-orange-50 px-3 py-1 font-black text-orange-700">
                impacto
              </span>
            </div>
          </div>

          <div className="mt-1 flex gap-3">
            <div className="hidden w-10 items-center justify-center md:flex">
              <p className="-rotate-90 whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-slate-400">
                duração média por ocorrência
              </p>
            </div>

            <div className="flex-1">
              <div className="relative h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                  <div className="border-b border-r border-dashed border-slate-300 bg-purple-50/30" />
                  <div className="border-b border-dashed border-slate-300 bg-red-50/30" />
                  <div className="border-r border-dashed border-slate-300 bg-slate-50" />
                  <div className="bg-blue-50/40" />
                </div>

                <div className="absolute left-5 top-5 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-purple-700 shadow-sm ring-1 ring-slate-200">
                  pontual grave
                </div>
                <div className="absolute right-5 top-5 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-red-700 shadow-sm ring-1 ring-slate-200">
                  crítico estrutural
                </div>
                <div className="absolute bottom-5 left-5 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm ring-1 ring-slate-200">
                  monitorar
                </div>
                <div className="absolute bottom-5 right-5 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-blue-700 shadow-sm ring-1 ring-slate-200">
                  crônico / repetitivo
                </div>

                {topMacros.map((macro) => {
                  const resumo = causasResumo(macro)
                  const ocorrDia = resumo.ocorrPorDia
                  const x = 9 + (ocorrDia / maxOcorrDia) * 78
                  const y = 84 - (Number(macro.media_min || 0) / maxMediaMin) * 72
                  const size = 42 + (Number(macro.horas || 0) / maxHorasMacro) * 74
                  const color = macroColor(macro.macro_categoria)
                  const leitura = leituraQuadrante(macro, maxOcorrDia, maxMediaMin)
                  const layout = macroLabelLayout(macro.macro_categoria)
                  const lineLength = Math.max(18, Math.sqrt(layout.dx * layout.dx + layout.dy * layout.dy) - size / 2)
                  const lineAngle = Math.atan2(layout.dy, layout.dx) * (180 / Math.PI)

                  return (
                    <div
                      key={`bubble-${macro.macro_categoria}`}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${x}%`, top: `${y}%` }}
                      title={`${macro.macro_categoria}: ${formatHoras(macro.horas)} · ${resumo.ocorrPorDiaLabel} · ${resumo.mediaLabel}`}
                    >
                      <div
                        className="absolute left-1/2 top-1/2 h-[2px] origin-left rounded-full bg-slate-300"
                        style={{
                          width: `${lineLength}px`,
                          transform: `translate(0, -50%) rotate(${lineAngle}deg)`,
                        }}
                      />

                      <div
                        className="absolute rounded-xl bg-white/95 px-2.5 py-1.5 text-center shadow-sm ring-1 ring-slate-200"
                        style={{
                          left: `calc(50% + ${layout.dx}px)`,
                          top: `calc(50% + ${layout.dy}px)`,
                          width: `${layout.width}px`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      >
                        <p className="text-[11px] font-black text-slate-900">{macroLabelCurto(macro.macro_categoria)}</p>
                        <p className="text-[10px] font-bold text-slate-500">{leitura}</p>
                      </div>

                      <div
                        className="relative z-10 flex items-center justify-center rounded-full border-[5px] border-white font-black text-white shadow-xl"
                        style={{
                          width: size,
                          height: size,
                          backgroundColor: color,
                          opacity: 0.94,
                        }}
                      >
                        <span className="text-[12px]">{formatDecimal(ocorrDia, 1)}x</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="pt-3 text-center text-[11px] font-black uppercase tracking-widest text-slate-400">
                ocorrências por dia
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Leitura rápida
          </p>
          <h3 className="text-lg font-black text-slate-900">O que a matriz está dizendo?</h3>

          <div className="mt-5 space-y-3">
            {microparada && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                <p className="text-sm font-black text-blue-900">Microparadas</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-blue-800">
                  Alta frequência: {causasResumo(microparada).ocorrPorDiaLabel}. Média de {formatDecimal(microparada.media_min, 1)} min por ocorrência.
                </p>
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-blue-700">
                  indica instabilidade recorrente
                </p>
              </div>
            )}

            {manutencao && (
              <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4">
                <p className="text-sm font-black text-purple-900">Manutenção / falha</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-purple-800">
                  Maior tempo acumulado: {formatHoras(manutencao.horas)}. Duração média de {formatDecimal(manutencao.media_min, 1)} min.
                </p>
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-purple-700">
                  investigar eventos longos
                </p>
              </div>
            )}

            {setup && (
              <div className="rounded-2xl border border-orange-100 bg-orange-50/60 p-4">
                <p className="text-sm font-black text-orange-900">Setup e troca</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-orange-800">
                  {formatHoras(setup.horas)} no período, com P90 de {formatDecimal(setup.p90_min, 1)} min.
                </p>
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-orange-700">
                  oportunidade de padronização
                </p>
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Como ler</p>
            <div className="mt-3 space-y-2 text-xs font-semibold text-slate-600">
              <p><strong className="text-slate-900">Direita:</strong> muita repetição no dia.</p>
              <p><strong className="text-slate-900">Alto:</strong> evento demora quando acontece.</p>
              <p><strong className="text-slate-900">Bolha grande:</strong> muito tempo perdido no acumulado.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Causas de parada
            </p>
            <h3 className="text-lg font-bold text-slate-900">
              Tempo, frequência e duração por macro causa
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              A barra mostra horas totais. Os chips mostram frequência e duração típica da causa.
            </p>
          </div>

          <div className="space-y-3">
            {topMacros.map((macro) => {
              const resumo = causasResumo(macro)
              const color = macroColor(macro.macro_categoria)
              const width = percentWidth(Number(macro.horas || 0), maxHorasMacro)

              return (
                <div key={macro.macro_categoria} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                        <p className="truncate text-sm font-black text-slate-900">{macro.macro_categoria}</p>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {formatNumber(macro.ocorrencias)} ocorrências · {formatNumber(macro.dias)} dias com ocorrência
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-white px-3 py-1 font-black text-slate-700 ring-1 ring-slate-200">
                        {formatHoras(macro.horas)}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 font-black text-slate-700 ring-1 ring-slate-200">
                        {resumo.ocorrPorDiaLabel}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 font-black text-slate-700 ring-1 ring-slate-200">
                        {resumo.mediaLabel}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 font-black text-slate-700 ring-1 ring-slate-200">
                        {resumo.p90Label}
                      </span>
                    </div>
                  </div>

                  <div className="h-3 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Máquinas
            </p>
            <h3 className="text-lg font-bold text-slate-900">Composição por máquina</h3>
            <p className="mt-1 text-sm text-slate-500">
              Cada barra mostra o total da máquina, dividido pelas principais macro causas.
            </p>
          </div>

          <div className="space-y-4">
            {maquinas.map((maquina) => {
              const widthTotal = percentWidth(maquina.horas, maxHorasMaquina, 12)
              const segmentos = Object.entries(maquina.macros).sort((a, b) => b[1] - a[1])

              return (
                <div key={maquina.maquina} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{maquina.maquina}</p>
                      <p className="text-xs font-semibold text-slate-500">
                        Principal causa: {maquina.principal}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                      {formatHoras(maquina.horas)}
                    </span>
                  </div>

                  <div className="h-4 overflow-hidden rounded-full bg-white ring-1 ring-slate-200" style={{ width: `${widthTotal}%` }}>
                    <div className="flex h-full w-full">
                      {segmentos.map(([macro, horas]) => (
                        <div
                          key={`${maquina.maquina}-${macro}`}
                          title={`${macro}: ${formatHoras(horas)}`}
                          style={{
                            width: `${Math.max(3, (horas / maquina.horas) * 100)}%`,
                            backgroundColor: macroColor(macro),
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {segmentos.slice(0, 3).map(([macro, horas]) => (
                      <span key={macro} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: macroColor(macro) }} />
                        {macro.split(" / ")[0]} · {formatHoras(horas)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Perfil de duração
          </p>
          <h3 className="text-lg font-bold text-slate-900">Mapa de calor por duração</h3>
          <p className="mt-1 text-sm text-slate-500">
            Mostra se cada causa é formada por muitas paradas curtas ou por eventos longos.
          </p>
        </div>

        <div className="overflow-auto">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[220px_repeat(5,1fr)] gap-2">
              <div />
              {buckets.map((bucket) => (
                <div key={bucket} className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-black text-slate-500">
                  {bucket}
                </div>
              ))}

              {topMacros.map((macro) => (
                <div key={`row-${macro.macro_categoria}`} className="contents">
                  <div className="flex items-center rounded-xl bg-slate-50 px-3 py-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{macro.macro_categoria}</p>
                      <p className="text-xs font-semibold text-slate-500">{formatHoras(macro.horas)} no total</p>
                    </div>
                  </div>

                  {buckets.map((bucket) => {
                    const item = distMap.get(`${macro.macro_categoria}__${bucket}`)
                    const horas = Number(item?.horas || 0)
                    const ocorr = Number(item?.ocorrencias || 0)
                    const intensity = Math.max(0.06, Math.min(0.92, horas / maxHorasBucket))
                    const color = macroColor(macro.macro_categoria)
                    const alpha = Math.round(intensity * 255).toString(16).padStart(2, "0")
                    const strong = horas > maxHorasBucket * 0.35

                    return (
                      <div
                        key={`${macro.macro_categoria}-${bucket}`}
                        className="rounded-xl border border-slate-100 px-3 py-3 text-center"
                        style={{ backgroundColor: horas > 0 ? `${color}${alpha}` : "#F8FAFC" }}
                      >
                        <p className={`text-sm font-black ${strong ? "text-white" : "text-slate-900"}`}>
                          {horas > 0 ? formatHoras(horas) : "—"}
                        </p>
                        <p className={`mt-1 text-[11px] font-bold ${strong ? "text-white/80" : "text-slate-500"}`}>
                          {ocorr > 0 ? `${formatNumber(ocorr)}x` : ""}
                        </p>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Detalhe
          </p>
          <h3 className="text-lg font-bold text-slate-900">Top causas para investigação</h3>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] text-xs">
            <thead className="bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 text-left">Macro</th>
                <th className="px-3 py-3 text-left">Motivo</th>
                <th className="px-3 py-3 text-left">Máquina</th>
                <th className="px-3 py-3 text-right">Horas</th>
                <th className="px-3 py-3 text-right">Ocorr.</th>
                <th className="px-3 py-3 text-right">Dias</th>
                <th className="px-3 py-3 text-right">Média</th>
                <th className="px-3 py-3 text-right">P90</th>
                <th className="px-3 py-3 text-right">Min/dia</th>
              </tr>
            </thead>
            <tbody>
              {(data.tabela_causas || []).slice(0, 18).map((row, idx) => (
                <tr key={`${row.macro_categoria}-${row.motivo}-${row.maquina}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-3 align-top font-bold text-slate-800">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: macroColor(row.macro_categoria) }} />
                    {row.macro_categoria}
                  </td>
                  <td className="px-3 py-3 align-top text-slate-600">{row.motivo || "—"}</td>
                  <td className="px-3 py-3 align-top text-slate-600">{row.maquina}</td>
                  <td className="px-3 py-3 text-right align-top font-black text-slate-900">{formatHoras(row.horas)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatNumber(row.ocorrencias)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatNumber(row.dias)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatDecimal(row.media_min, 1)} min</td>
                  <td className="px-3 py-3 text-right align-top">{formatDecimal(row.p90_min, 1)} min</td>
                  <td className="px-3 py-3 text-right align-top">{formatDecimal(row.min_por_dia, 1)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function ProducaoPage() {
  const today = new Date()
  const [tab, setTab] = useState<TabKey>("dashboard")
  const [ano, setAno] = useState(today.getFullYear())
  const [mes, setMes] = useState(today.getMonth() + 1)
  const [linha, setLinha] = useState<LinhaFiltro>("TODAS")
  const [busca, setBusca] = useState("")

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [acompanhamento, setAcompanhamento] = useState<AcompanhamentoResponse | null>(null)
  const [perdas, setPerdas] = useState<PerdasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")
  const [cacheVersion, setCacheVersion] = useState<string | null>(null)

  async function loadDashboard(force = false) {
    if (!cacheVersion) return
    const json = await apiGet<DashboardResponse>(
      "/producao/dashboard",
      { ano, mes, linha, cache_version: cacheVersion },
      { force },
    )
    setDashboard(json)
  }

  async function loadAcompanhamento(force = false) {
    if (!cacheVersion) return
    const json = await apiGet<AcompanhamentoResponse>(
      "/producao/acompanhamento",
      {
        ano,
        mes,
        linha,
        busca,
        cache_version: cacheVersion,
      },
      { force },
    )
    setAcompanhamento(json)
  }

  async function loadPerdas(force = false) {
    if (!cacheVersion) return
    const json = await apiGet<PerdasResponse>(
      "/producao/perdas",
      {
        ano,
        mes_final: mes,
        linha,
        cache_version: cacheVersion,
      },
      { force },
    )
    setPerdas(json)
  }

  async function loadData(force = false) {
    if (!cacheVersion) return

    try {
      setLoading(true)
      setErro("")

      if (force) {
        clearProducaoCache()
      }

      if (tab === "dashboard") {
        await loadDashboard(force)
      } else if (tab === "acompanhamento") {
        await loadAcompanhamento(force)
      } else {
        await loadPerdas(force)
      }
    } catch (err) {
      console.error(err)
      setErro(err instanceof Error ? err.message : "Erro ao carregar produção")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true

    async function loadVersao() {
      const versao = await buscarVersaoProducao()
      if (!alive) return

      setCacheVersion((atual) => {
        if (atual && atual !== versao) {
          clearProducaoCache()
        }
        return versao
      })
    }

    void loadVersao()
    const id = window.setInterval(() => {
      void loadVersao()
    }, 60_000)

    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ano, mes, linha, cacheVersion])

  useEffect(() => {
    if (!cacheVersion) return
    if (tab !== "dashboard") return

    const id = window.setTimeout(() => {
      void (async () => {
        try {
          await loadPerdas()
          await loadAcompanhamento()
        } catch {
          // Prefetch é apenas aquecimento de cache; não deve quebrar a tela principal.
        }
      })()
    }, 1500)

    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, ano, mes, linha])

  useEffect(() => {
    if (tab !== "acompanhamento") return
    const id = window.setTimeout(() => {
      void loadData()
    }, 350)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        tab={tab}
        onTabChange={setTab}
        mes={mes}
        ano={ano}
        linha={linha}
        onMesChange={setMes}
        onAnoChange={setAno}
        onLinhaChange={setLinha}
        onRefresh={() => void loadData(true)}
        loading={loading}
      />

      {loading && !dashboard && !acompanhamento && !perdas && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-semibold text-blue-700 shadow-sm">
          Carregando dados de produção...
        </div>
      )}

      {loading && (dashboard || acompanhamento || perdas) && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Atualizando produção em segundo plano...
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Não foi possível carregar a Produção.</p>
            <p className="mt-1">{erro}</p>
          </div>
        </div>
      )}

      {tab === "dashboard" && dashboard && <DashboardTab data={dashboard} />}

      {tab === "acompanhamento" && acompanhamento && (
        <AcompanhamentoTab data={acompanhamento} busca={busca} onBuscaChange={setBusca} />
      )}

      {tab === "perdas" && perdas && <PerdasTab data={perdas} />}

      {!loading && !erro && tab === "dashboard" && !dashboard && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">
          Nenhum dado de dashboard encontrado.
        </div>
      )}

      {!loading && !erro && tab === "acompanhamento" && !acompanhamento && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">
          Nenhum apontamento encontrado.
        </div>
      )}

      {!loading && !erro && tab === "perdas" && !perdas && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">
          Nenhuma perda encontrada.
        </div>
      )}
    </div>
  )
}

export default ProducaoPage
