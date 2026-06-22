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


interface ExcelenciaCards {
  horas_producao: number
  horas_programadas: number
  horas_nao_programadas: number
  horas_sem_programacao: number
  horas_total: number
  ocorrencias_total: number
  ocorrencias_nao_programadas: number
  dias: number
  pct_produtivo_sobre_apontado: number
  pct_nao_programada_sobre_apontado: number
  top_equipamento_perda?: string | null
  top_equipamento_horas_nao_programadas?: number | null
  top_causa_perda?: string | null
  top_causa_horas?: number | null
}

interface ExcelenciaResumoArea {
  area: string
  horas_producao: number
  horas_programadas: number
  horas_nao_programadas: number
  horas_sem_programacao: number
  horas_total: number
  ocorrencias_total: number
  ocorrencias_nao_programadas: number
  dias: number
  pct_produtivo_sobre_apontado: number
  pct_nao_programada_sobre_apontado: number
}

interface ExcelenciaRankingEquipamento {
  equipamento: string
  area: string
  linha: string
  linha_nome: string
  tipo_equipamento: string
  etapa: string
  ordem_equipamento: number
  horas_producao: number
  horas_programadas: number
  horas_nao_programadas: number
  horas_sem_programacao: number
  horas_total: number
  ocorrencias_total: number
  ocorrencias_nao_programadas: number
  dias: number
  pct_produtivo_sobre_apontado: number
  pct_nao_programada_sobre_apontado: number
}

interface ExcelenciaMatrizItem {
  macro_causa: string
  horas: number
  ocorrencias: number
  dias: number
  ocorrencias_por_dia: number
  media_min: number
  mediana_min?: number
  p90_min?: number
  quadrante?: string
}

interface ExcelenciaParetoCausa {
  macro_causa: string
  evento: string
  equipamento: string
  area: string
  linha: string
  horas: number
  ocorrencias: number
  dias: number
  ocorrencias_por_dia: number
  media_min: number
  mediana_min: number
  p90_min: number
}

interface ExcelenciaDiarioEquipamento {
  data: string
  dia: number
  equipamento: string
  area: string
  linha: string
  linha_nome: string
  tipo_equipamento: string
  ordem_equipamento: number
  horas_producao: number
  horas_programadas: number
  horas_nao_programadas: number
  horas_sem_programacao: number
  horas_total: number
  ocorrencias_total: number
  ocorrencias_nao_programadas: number
  pct_produtivo_sobre_apontado: number
  pct_nao_programada_sobre_apontado: number
}

interface ExcelenciaResponse {
  versao: string
  ano: number
  mes: number
  periodo: string
  periodo_label: string
  data_inicio: string
  data_fim_exclusivo: string
  cards: ExcelenciaCards
  resumo_area: ExcelenciaResumoArea[]
  ranking_equipamentos: ExcelenciaRankingEquipamento[]
  matriz_nao_programadas: ExcelenciaMatrizItem[]
  pareto_causas_nao_programadas: ExcelenciaParetoCausa[]
  diario_equipamento: ExcelenciaDiarioEquipamento[]
  debug?: Record<string, any>
  from_cache?: boolean
}

type PerdasResponse = ExcelenciaResponse


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

const PRODUCAO_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const PRODUCAO_STORAGE_PREFIX = "dfl-producao-cache-v100-excelencia-operacional:"
const PRODUCAO_STORAGE_BUILD_KEY = "dfl-producao-cache-build"
const PRODUCAO_STORAGE_BUILD_VALUE = "v100-excelencia-operacional"
const PRODUCAO_LAST_STATE_KEY = "dfl-producao-last-state-v94"

type ProducaoLastState = {
  tab?: TabKey
  ano?: number
  mes?: number
  linha?: LinhaFiltro
}

function lerUltimoEstadoProducao(): ProducaoLastState {
  try {
    if (typeof window === "undefined") return {}
    const raw = window.localStorage.getItem(PRODUCAO_LAST_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProducaoLastState

    const tab: TabKey =
      parsed.tab === "dashboard" || parsed.tab === "acompanhamento" || parsed.tab === "perdas"
        ? parsed.tab
        : "dashboard"

    const linha: LinhaFiltro =
      parsed.linha === "L1" || parsed.linha === "L2" || parsed.linha === "TODAS"
        ? parsed.linha
        : "TODAS"

    return {
      tab,
      ano: Number.isFinite(Number(parsed.ano)) ? Number(parsed.ano) : undefined,
      mes: Number.isFinite(Number(parsed.mes)) ? Number(parsed.mes) : undefined,
      linha,
    }
  } catch {
    return {}
  }
}

function salvarUltimoEstadoProducao(state: ProducaoLastState) {
  try {
    if (typeof window === "undefined") return
    window.localStorage.setItem(PRODUCAO_LAST_STATE_KEY, JSON.stringify(state))
  } catch {
    // Não bloqueia a tela se o storage estiver indisponível.
  }
}

function limparCachesAntigosProducaoUmaVez() {
  try {
    if (typeof window === "undefined") return

    const buildAtual = window.localStorage.getItem(PRODUCAO_STORAGE_BUILD_KEY)

    if (buildAtual === PRODUCAO_STORAGE_BUILD_VALUE) {
      return
    }

    const keysParaRemover: string[] = []

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)

      if (!key) continue

      if (
        (key.startsWith("dfl-producao-cache-") && key !== PRODUCAO_LAST_STATE_KEY && key !== PRODUCAO_STORAGE_BUILD_KEY) ||
        key.startsWith("pcp-producao-cache-") ||
        key.includes("/producao/cache") ||
        key.includes("/producao/dashboard") ||
        key.includes("/producao/acompanhamento") ||
        key.includes("/producao/perdas")
      ) {
        keysParaRemover.push(key)
      }
    }

    keysParaRemover.forEach((key) => window.localStorage.removeItem(key))
    window.localStorage.setItem(PRODUCAO_STORAGE_BUILD_KEY, PRODUCAO_STORAGE_BUILD_VALUE)
  } catch {
    // Não bloqueia a tela se o storage estiver indisponível.
  }
}

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
  const bases = ["apontamentos", "programacao_ops", "mps_liberacoes", "mps_producao", "orcado_liberacao", "d_produtos"]

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

type ProducaoApiRequest = {
  path: string
  params: Record<string, string | number | undefined | null | boolean>
  unwrapPayload: boolean
}

function normalizeProducaoApiRequest(
  path: string,
  params: Record<string, string | number | undefined | null | boolean> = {},
): ProducaoApiRequest {
  if (path === "/producao/dashboard") {
    return {
      path: "/producao/cache",
      params: {
        tipo: "dashboard",
        ano: params.ano,
        mes: params.mes,
        linha: params.linha,
      },
      unwrapPayload: true,
    }
  }

  if (path === "/producao/acompanhamento") {
    return {
      path: "/producao/cache",
      params: {
        tipo: "acompanhamento",
        ano: params.ano,
        mes: params.mes,
        linha: params.linha,
        busca: params.busca,
      },
      unwrapPayload: true,
    }
  }

  if (path === "/producao/perdas") {
    return {
      path: "/producao/cache",
      params: {
        tipo: "perdas",
        ano: params.ano,
        mes: (params.mes_final ?? params.mes) as number | string | undefined,
        linha: params.linha,
      },
      unwrapPayload: true,
    }
  }

  return { path, params, unwrapPayload: false }
}

function buildRawApiUrl(
  path: string,
  params: Record<string, string | number | undefined | null | boolean> = {},
) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  return url
}

function buildApiUrl(
  path: string,
  params: Record<string, string | number | undefined | null | boolean> = {},
) {
  const request = normalizeProducaoApiRequest(path, params)
  return buildRawApiUrl(request.path, request.params)
}

function peekApiCache<T>(
  path: string,
  params: Record<string, string | number | undefined | null | boolean> = {},
) {
  // Precisa usar a mesma chave normalizada do apiGet.
  // Ex.: /producao/perdas vira /producao/cache?tipo=perdas...
  // Antes o cache era salvo em /producao/cache, mas procurado em /producao/perdas,
  // então ao voltar para a página/aba ele não encontrava o dado já carregado.
  const request = normalizeProducaoApiRequest(path, params)
  const cacheKey = buildRawApiUrl(request.path, request.params).toString()
  return readProducaoCache<T>(cacheKey)
}

async function apiGet<T>(
  path: string,
  params: Record<string, string | number | undefined | null | boolean> = {},
  options?: { force?: boolean },
) {
  const request = normalizeProducaoApiRequest(path, params)
  const requestParams = {
    ...request.params,
    ...(options?.force && request.unwrapPayload ? { force: true, _t: Date.now() } : {}),
  }

  const url = buildRawApiUrl(request.path, requestParams)

  // Chave normalizada: mesmo quando busca com force=true/_t,
  // salva o resultado no cache da consulta padrão.
  // Assim uma atualização em segundo plano substitui o dado velho da tela.
  const cacheKey = buildRawApiUrl(request.path, request.params).toString()

  if (!options?.force) {
    const cached = readProducaoCache<T>(cacheKey)
    if (cached) return cached

    const pending = producaoCache.get(cacheKey)?.promise as Promise<T> | undefined
    if (pending) return pending
  }

  const requestPromise = (async () => {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: options?.force ? "no-store" : "default",
      headers: options?.force
        ? {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          }
        : undefined,
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

    const json = await response.json()
    const data = (request.unwrapPayload ? json?.payload : json) as T
    writeProducaoCache(cacheKey, data)
    return data
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
              Excelência: mês selecionado
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
          Excelência operacional
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

type AreaExcelenciaFiltro = "TODAS" | "Envase" | "Lavagem" | "Embalagem"

function horasNumber(value?: number) {
  return Number(value || 0)
}

function equipamentoLabelCurto(value?: string) {
  const text = String(value || "")
  if (text.includes("MÁQ 1")) return "Maq 1"
  if (text.includes("MÁQ 2")) return "Maq 2"
  if (text.includes("L1 LAVADORA")) return "Lavadora L1"
  if (text.includes("L2 LAVADORA")) return "Lavadora L2"
  if (text.includes("BAUSCH")) return "Bausch"
  if (text.includes("FABRIMA")) return "Fabrima"
  return text || "Equipamento"
}

function naturezaColor(key: "producao" | "programada" | "naoProgramada" | "semProgramacao") {
  if (key === "producao") return COLORS.green
  if (key === "programada") return COLORS.purple
  if (key === "naoProgramada") return COLORS.red
  return COLORS.slate
}

function filtrarLinhaExcelencia<T extends { linha?: string; area?: string; equipamento?: string }>(
  rows: T[],
  linha: LinhaFiltro,
  area: AreaExcelenciaFiltro,
  equipamento: string,
) {
  return rows.filter((row) => {
    const matchLinha = linha === "TODAS" || row.linha === linha
    const matchArea = area === "TODAS" || row.area === area
    const matchEquip = equipamento === "TODOS" || row.equipamento === equipamento
    return matchLinha && matchArea && matchEquip
  })
}

function calcularQuadranteExcelencia(item: ExcelenciaMatrizItem, maxOcorrDia: number, maxMediaMin: number) {
  const ocorrDia = Number(item.ocorrencias_por_dia || 0)
  const mediaMin = Number(item.media_min || 0)
  const altaFreq = ocorrDia >= maxOcorrDia * 0.45
  const altaDuracao = mediaMin >= maxMediaMin * 0.45

  if (altaFreq && altaDuracao) return "crítico estrutural"
  if (altaFreq) return "crônico / repetitivo"
  if (altaDuracao) return "pontual grave"
  return "monitorar"
}

function montarMatrizFiltrada(causas: ExcelenciaParetoCausa[]) {
  const map = new Map<string, ExcelenciaMatrizItem>()

  causas.forEach((row) => {
    const key = row.macro_causa || "Não classificado"
    const atual = map.get(key) || {
      macro_causa: key,
      horas: 0,
      ocorrencias: 0,
      dias: 0,
      ocorrencias_por_dia: 0,
      media_min: 0,
      mediana_min: 0,
      p90_min: 0,
      quadrante: "monitorar",
    }

    atual.horas += horasNumber(row.horas)
    atual.ocorrencias += Number(row.ocorrencias || 0)
    atual.dias = Math.max(atual.dias, Number(row.dias || 0))
    atual.p90_min = Math.max(Number(atual.p90_min || 0), Number(row.p90_min || 0))
    map.set(key, atual)
  })

  return Array.from(map.values())
    .map((item) => {
      const dias = Math.max(1, Number(item.dias || 0))
      const ocorrencias = Math.max(0, Number(item.ocorrencias || 0))
      const horas = Math.max(0, Number(item.horas || 0))
      return {
        ...item,
        ocorrencias_por_dia: ocorrencias / dias,
        media_min: ocorrencias > 0 ? (horas * 60) / ocorrencias : 0,
      }
    })
    .sort((a, b) => b.horas - a.horas)
}

function agregarCardsExcelencia(rows: ExcelenciaDiarioEquipamento[], ranking: ExcelenciaRankingEquipamento[], causas: ExcelenciaParetoCausa[]) {
  const horasProducao = rows.reduce((acc, row) => acc + horasNumber(row.horas_producao), 0)
  const horasProgramadas = rows.reduce((acc, row) => acc + horasNumber(row.horas_programadas), 0)
  const horasNaoProgramadas = rows.reduce((acc, row) => acc + horasNumber(row.horas_nao_programadas), 0)
  const horasSemProgramacao = rows.reduce((acc, row) => acc + horasNumber(row.horas_sem_programacao), 0)
  const horasTotal = rows.reduce((acc, row) => acc + horasNumber(row.horas_total), 0)
  const ocorrenciasTotal = rows.reduce((acc, row) => acc + Number(row.ocorrencias_total || 0), 0)
  const ocorrenciasNaoProgramadas = rows.reduce((acc, row) => acc + Number(row.ocorrencias_nao_programadas || 0), 0)
  const dias = new Set(rows.map((row) => row.data)).size
  const topEquipamento = [...ranking].sort((a, b) => horasNumber(b.horas_nao_programadas) - horasNumber(a.horas_nao_programadas))[0]
  const topCausa = [...causas].sort((a, b) => horasNumber(b.horas) - horasNumber(a.horas))[0]

  return {
    horas_producao: horasProducao,
    horas_programadas: horasProgramadas,
    horas_nao_programadas: horasNaoProgramadas,
    horas_sem_programacao: horasSemProgramacao,
    horas_total: horasTotal,
    ocorrencias_total: ocorrenciasTotal,
    ocorrencias_nao_programadas: ocorrenciasNaoProgramadas,
    dias,
    pct_produtivo_sobre_apontado: horasTotal > 0 ? (horasProducao / horasTotal) * 100 : 0,
    pct_nao_programada_sobre_apontado: horasTotal > 0 ? (horasNaoProgramadas / horasTotal) * 100 : 0,
    top_equipamento_perda: topEquipamento?.equipamento || null,
    top_equipamento_horas_nao_programadas: topEquipamento?.horas_nao_programadas || 0,
    top_causa_perda: topCausa?.macro_causa || null,
    top_causa_horas: topCausa?.horas || 0,
  }
}

function ExcelenciaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const filtered = payload.filter((item: any) => Number(item.value || 0) !== 0)

  return (
    <div className="min-w-[240px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{label}</p>
      {filtered.length === 0 && <p className="text-slate-400">Sem apontamento</p>}
      {filtered.map((item: any) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-2 text-slate-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color || item.fill }} />
            {item.name}
          </span>
          <span className="font-bold text-slate-900">{formatHoras(Number(item.value || 0))}</span>
        </div>
      ))}
    </div>
  )
}

function PerdasTab({ data, linha }: { data: PerdasResponse; linha: LinhaFiltro }) {
  const [areaFiltro, setAreaFiltro] = useState<AreaExcelenciaFiltro>("TODAS")
  const [equipamentoFiltro, setEquipamentoFiltro] = useState("TODOS")
  const [capacidadeHora, setCapacidadeHora] = useState(13500)
  const [reducaoPct, setReducaoPct] = useState(20)

  const rankingBase = useMemo(() => {
    return (data.ranking_equipamentos || []).filter((row) => linha === "TODAS" || row.linha === linha)
  }, [data.ranking_equipamentos, linha])

  const areasDisponiveis = useMemo(() => {
    return Array.from(new Set(rankingBase.map((row) => row.area).filter((area): area is string => Boolean(area))))
  }, [rankingBase])

  const equipamentosDisponiveis = useMemo(() => {
    return rankingBase
      .filter((row) => areaFiltro === "TODAS" || row.area === areaFiltro)
      .map((row) => row.equipamento)
      .filter((equipamento): equipamento is string => Boolean(equipamento))
  }, [rankingBase, areaFiltro])

  useEffect(() => {
    if (equipamentoFiltro !== "TODOS" && !equipamentosDisponiveis.includes(equipamentoFiltro)) {
      setEquipamentoFiltro("TODOS")
    }
  }, [equipamentoFiltro, equipamentosDisponiveis])

  const diarioFiltrado = useMemo(
    () => filtrarLinhaExcelencia(data.diario_equipamento || [], linha, areaFiltro, equipamentoFiltro),
    [data.diario_equipamento, linha, areaFiltro, equipamentoFiltro],
  )

  const rankingFiltrado = useMemo(
    () => filtrarLinhaExcelencia(data.ranking_equipamentos || [], linha, areaFiltro, equipamentoFiltro),
    [data.ranking_equipamentos, linha, areaFiltro, equipamentoFiltro],
  )

  const causasFiltradas = useMemo(
    () => filtrarLinhaExcelencia(data.pareto_causas_nao_programadas || [], linha, areaFiltro, equipamentoFiltro),
    [data.pareto_causas_nao_programadas, linha, areaFiltro, equipamentoFiltro],
  )

  const cards = useMemo(
    () => agregarCardsExcelencia(diarioFiltrado, rankingFiltrado, causasFiltradas),
    [diarioFiltrado, rankingFiltrado, causasFiltradas],
  )

  const diario = useMemo(() => {
    const map = new Map<string, {
      data: string
      label: string
      horas_producao: number
      horas_programadas: number
      horas_nao_programadas: number
      horas_sem_programacao: number
      horas_total: number
    }>()

    diarioFiltrado.forEach((row) => {
      const key = row.data
      if (!map.has(key)) {
        map.set(key, {
          data: key,
          label: formatDateBR(key),
          horas_producao: 0,
          horas_programadas: 0,
          horas_nao_programadas: 0,
          horas_sem_programacao: 0,
          horas_total: 0,
        })
      }

      const atual = map.get(key)!
      atual.horas_producao += horasNumber(row.horas_producao)
      atual.horas_programadas += horasNumber(row.horas_programadas)
      atual.horas_nao_programadas += horasNumber(row.horas_nao_programadas)
      atual.horas_sem_programacao += horasNumber(row.horas_sem_programacao)
      atual.horas_total += horasNumber(row.horas_total)
    })

    return Array.from(map.values()).sort((a, b) => a.data.localeCompare(b.data))
  }, [diarioFiltrado])

  const matriz = useMemo(() => montarMatrizFiltrada(causasFiltradas), [causasFiltradas])
  const topMacros = matriz.slice(0, 6)
  const causasTop = causasFiltradas.slice(0, 18)
  const rankingTop = [...rankingFiltrado]
    .sort((a, b) => horasNumber(b.horas_nao_programadas) - horasNumber(a.horas_nao_programadas))
    .slice(0, 8)

  const maxHorasEquipamento = Math.max(1, ...rankingTop.map((row) => horasNumber(row.horas_nao_programadas)))
  const maxHorasMacro = Math.max(1, ...topMacros.map((row) => horasNumber(row.horas)))
  const maxOcorrDia = Math.max(1, ...topMacros.map((item) => horasNumber(item.ocorrencias_por_dia)))
  const maxMediaMin = Math.max(1, ...topMacros.map((item) => horasNumber(item.media_min)))
  const maxChartHoras = Math.max(1, ...diario.map((row) => horasNumber(row.horas_total)))

  const horasRecuperadas = horasNumber(cards.horas_nao_programadas) * (Math.max(0, Math.min(100, reducaoPct)) / 100)
  const ganhoTubetes = horasRecuperadas * Math.max(0, Number(capacidadeHora || 0))
  const ganhoCaixas = ganhoTubetes / 500
  const filtroLabel = [linhaLabel(linha), areaFiltro !== "TODAS" ? areaFiltro : "Todas as áreas", equipamentoFiltro !== "TODOS" ? equipamentoLabelCurto(equipamentoFiltro) : "Todos os equipamentos"].join(" · ")

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Excelência operacional
            </p>
            <h2 className="text-xl font-bold text-slate-900">
              Paradas por equipamento — {data.periodo_label}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Base por equipamento físico: envasadoras, lavadoras, Bausch/rotuladora e Fabrima/embaladora. Programadas ficam separadas da criticidade.
            </p>
            <p className="mt-2 text-xs font-bold text-slate-400">{filtroLabel}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <select
              value={areaFiltro}
              onChange={(event) => setAreaFiltro(event.target.value as AreaExcelenciaFiltro)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <option value="TODAS">Todas as áreas</option>
              {areasDisponiveis.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>

            <select
              value={equipamentoFiltro}
              onChange={(event) => setEquipamentoFiltro(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <option value="TODOS">Todos os equipamentos</option>
              {equipamentosDisponiveis.map((equipamento) => (
                <option key={equipamento} value={equipamento}>{equipamentoLabelCurto(equipamento)}</option>
              ))}
            </select>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
              {formatNumber(cards.ocorrencias_nao_programadas)} ocorrências não programadas
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Produção"
          value={formatHoras(cards.horas_producao)}
          subtitle={`${formatPercent(cards.pct_produtivo_sobre_apontado)} do apontado`}
          icon={Factory}
          accent="green"
        />
        <MetricCard
          title="Programadas"
          value={formatHoras(cards.horas_programadas)}
          subtitle="Setup, validação, preventiva e calendário planejado"
          icon={CalendarDays}
          accent="purple"
        />
        <MetricCard
          title="Não programadas"
          value={formatHoras(cards.horas_nao_programadas)}
          subtitle={`${formatPercent(cards.pct_nao_programada_sobre_apontado)} do apontado`}
          icon={AlertTriangle}
          accent="red"
        />
        <MetricCard
          title="Sem programação"
          value={formatHoras(cards.horas_sem_programacao)}
          subtitle="Capacidade sem carga/calendário"
          icon={Layers}
          accent="slate"
        />
        <MetricCard
          title="Top equipamento"
          value={formatHoras(cards.top_equipamento_horas_nao_programadas || 0)}
          subtitle={equipamentoLabelCurto(cards.top_equipamento_perda || "")}
          icon={BarChart3}
          accent="orange"
        />
        <MetricCard
          title="Top causa"
          value={formatHoras(cards.top_causa_horas || 0)}
          subtitle={cards.top_causa_perda || "—"}
          icon={Target}
          accent="blue"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.45fr_0.75fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Calendário operacional</p>
              <h3 className="text-lg font-bold text-slate-900">Composição diária por equipamento</h3>
              <p className="mt-1 text-sm text-slate-500">
                Verde = produção, roxo = programada, vermelho = não programada, cinza = sem programação.
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              Pico da seleção: {formatHoras(maxChartHoras)} no dia
            </div>
          </div>

          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={diario} margin={{ top: 20, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                <Tooltip content={<ExcelenciaTooltip />} />
                <Bar dataKey="horas_producao" name="Produção" stackId="a" fill={naturezaColor("producao")} radius={[0, 0, 0, 0]} />
                <Bar dataKey="horas_programadas" name="Programada" stackId="a" fill={naturezaColor("programada")} radius={[0, 0, 0, 0]} />
                <Bar dataKey="horas_nao_programadas" name="Não programada" stackId="a" fill={naturezaColor("naoProgramada")} radius={[0, 0, 0, 0]} />
                <Bar dataKey="horas_sem_programacao" name="Sem programação" stackId="a" fill={naturezaColor("semProgramacao")} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Painel de parâmetros</p>
          <h3 className="text-lg font-bold text-slate-900">Simulador rápido de ganho</h3>
          <p className="mt-1 text-sm text-slate-500">
            Usa somente paradas não programadas da seleção. Depois conectamos com OEE/capacidade por linha.
          </p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Capacidade real por hora</span>
              <input
                type="number"
                value={capacidadeHora}
                onChange={(event) => setCapacidadeHora(Number(event.target.value || 0))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm"
              />
              <span className="mt-1 block text-xs font-semibold text-slate-400">tubetes/hora</span>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Redução simulada da perda</span>
              <input
                type="number"
                value={reducaoPct}
                onChange={(event) => setReducaoPct(Number(event.target.value || 0))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm"
              />
              <span className="mt-1 block text-xs font-semibold text-slate-400">% das horas não programadas</span>
            </label>

            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Resultado potencial</p>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-500">Horas recuperadas</p>
                  <p className="text-2xl font-black text-slate-900">{formatHoras(horasRecuperadas)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500">Ganho estimado</p>
                  <p className="text-2xl font-black text-green-700">{formatTubetes(ganhoTubetes)}</p>
                  <p className="text-xs font-bold text-slate-500">{formatCx(ganhoCaixas)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Equipamentos</p>
            <h3 className="text-lg font-bold text-slate-900">Ranking de perdas não programadas</h3>
            <p className="mt-1 text-sm text-slate-500">Ordenado pelo tempo de parada não programada. Programadas e sem programação ficam fora do ranking de perda.</p>
          </div>

          <div className="space-y-3">
            {rankingTop.map((item) => {
              const width = percentWidth(horasNumber(item.horas_nao_programadas), maxHorasEquipamento, 8)
              return (
                <div key={item.equipamento} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{equipamentoLabelCurto(item.equipamento)}</p>
                      <p className="text-xs font-semibold text-slate-500">{item.area} · {item.tipo_equipamento} · {item.linha_nome}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-red-600 ring-1 ring-slate-200">
                      {formatHoras(item.horas_nao_programadas)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${width}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-bold text-slate-500">
                    <span>Produção: {formatHoras(item.horas_producao)}</span>
                    <span>Programada: {formatHoras(item.horas_programadas)}</span>
                    <span>Ocorr.: {formatNumber(item.ocorrencias_nao_programadas)}</span>
                  </div>
                </div>
              )
            })}

            {rankingTop.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-400">
                Sem perda não programada para a seleção.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Causas</p>
            <h3 className="text-lg font-bold text-slate-900">Pareto de macro causas</h3>
            <p className="mt-1 text-sm text-slate-500">Somente paradas não programadas.</p>
          </div>

          <div className="space-y-3">
            {topMacros.map((macro) => {
              const color = macroColor(macro.macro_causa)
              const width = percentWidth(horasNumber(macro.horas), maxHorasMacro, 8)
              const quadrante = calcularQuadranteExcelencia(macro, maxOcorrDia, maxMediaMin)
              return (
                <div key={macro.macro_causa} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                        <p className="text-sm font-black text-slate-900">{macro.macro_causa}</p>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{quadrante} · {formatDecimal(macro.ocorrencias_por_dia, 1)}x/dia · média {formatDecimal(macro.media_min, 1)} min</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                      {formatHoras(macro.horas)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                    <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Matriz de criticidade</p>
            <h3 className="text-lg font-bold text-slate-900">Frequência x duração</h3>
            <p className="mt-1 text-sm text-slate-500">A matriz usa somente paradas não programadas. Programadas não entram como grave.</p>
          </div>

          <div className="relative h-[440px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
              <div className="border-b border-r border-dashed border-slate-300 bg-purple-50/30" />
              <div className="border-b border-dashed border-slate-300 bg-red-50/30" />
              <div className="border-r border-dashed border-slate-300 bg-slate-50" />
              <div className="bg-blue-50/40" />
            </div>
            <div className="absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-purple-700 shadow-sm ring-1 ring-slate-200">pontual grave</div>
            <div className="absolute right-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-red-700 shadow-sm ring-1 ring-slate-200">crítico estrutural</div>
            <div className="absolute bottom-4 left-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm ring-1 ring-slate-200">monitorar</div>
            <div className="absolute bottom-4 right-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-black text-blue-700 shadow-sm ring-1 ring-slate-200">crônico/repetitivo</div>

            {topMacros.map((macro) => {
              const x = 10 + (horasNumber(macro.ocorrencias_por_dia) / maxOcorrDia) * 78
              const y = 84 - (horasNumber(macro.media_min) / maxMediaMin) * 72
              const size = 42 + (horasNumber(macro.horas) / maxHorasMacro) * 72
              const color = macroColor(macro.macro_causa)
              return (
                <div
                  key={`matriz-${macro.macro_causa}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  title={`${macro.macro_causa}: ${formatHoras(macro.horas)} · ${formatDecimal(macro.ocorrencias_por_dia, 1)}x/dia · ${formatDecimal(macro.media_min, 1)} min`}
                >
                  <div
                    className="flex items-center justify-center rounded-full border-[5px] border-white text-center text-[11px] font-black text-white shadow-xl"
                    style={{ width: size, height: size, backgroundColor: color }}
                  >
                    {macroLabelCurto(macro.macro_causa)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Leitura executiva</p>
          <h3 className="text-lg font-bold text-slate-900">Principais sinais</h3>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
              <p className="text-sm font-black text-red-900">Perda atacável</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-red-800">
                A seleção tem {formatHoras(cards.horas_nao_programadas)} de paradas não programadas. Esse é o foco do plano de ação.
              </p>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
              <p className="text-sm font-black text-violet-900">Programadas separadas</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-violet-800">
                {formatHoras(cards.horas_programadas)} estão classificadas como programadas e não entram na criticidade.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-900">Capacidade sem carga</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-600">
                {formatHoras(cards.horas_sem_programacao)} aparecem como sem programação. Isso deve ser lido como calendário/carga, não como falha de equipamento.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Detalhe</p>
          <h3 className="text-lg font-bold text-slate-900">Top causas não programadas</h3>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] text-xs">
            <thead className="bg-slate-50 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 text-left">Macro</th>
                <th className="px-3 py-3 text-left">Evento</th>
                <th className="px-3 py-3 text-left">Equipamento</th>
                <th className="px-3 py-3 text-left">Área</th>
                <th className="px-3 py-3 text-right">Horas</th>
                <th className="px-3 py-3 text-right">Ocorr.</th>
                <th className="px-3 py-3 text-right">Dias</th>
                <th className="px-3 py-3 text-right">Média</th>
                <th className="px-3 py-3 text-right">P90</th>
              </tr>
            </thead>
            <tbody>
              {causasTop.map((row, idx) => (
                <tr key={`${row.macro_causa}-${row.evento}-${row.equipamento}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-3 align-top font-bold text-slate-800">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: macroColor(row.macro_causa) }} />
                    {row.macro_causa}
                  </td>
                  <td className="px-3 py-3 align-top text-slate-600">{row.evento || "—"}</td>
                  <td className="px-3 py-3 align-top text-slate-600">{equipamentoLabelCurto(row.equipamento)}</td>
                  <td className="px-3 py-3 align-top text-slate-600">{row.area}</td>
                  <td className="px-3 py-3 text-right align-top font-black text-slate-900">{formatHoras(row.horas)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatNumber(row.ocorrencias)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatNumber(row.dias)}</td>
                  <td className="px-3 py-3 text-right align-top">{formatDecimal(row.media_min, 1)} min</td>
                  <td className="px-3 py-3 text-right align-top">{formatDecimal(row.p90_min, 1)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


function getInitialProducaoDashboard(ano: number, mes: number, linha: LinhaFiltro) {
  return peekApiCache<DashboardResponse>("/producao/dashboard", { ano, mes, linha })
}

function getInitialProducaoAcompanhamento(ano: number, mes: number, linha: LinhaFiltro) {
  return peekApiCache<AcompanhamentoResponse>("/producao/acompanhamento", {
    ano,
    mes,
    linha,
    busca: "",
  })
}

function getInitialProducaoPerdas(ano: number, mes: number, linha: LinhaFiltro) {
  return peekApiCache<PerdasResponse>("/producao/excelencia-operacional", {
    ano,
    mes,
    periodo: "mes",
  })
}

export function ProducaoPage() {
  useMemo(() => limparCachesAntigosProducaoUmaVez(), [])

  const today = new Date()
  const estadoInicial = useMemo(() => lerUltimoEstadoProducao(), [])

  const anoInicial = estadoInicial.ano || today.getFullYear()
  const mesInicial = estadoInicial.mes || today.getMonth() + 1
  const linhaInicial: LinhaFiltro = estadoInicial.linha || "TODAS"
  const tabInicial: TabKey = estadoInicial.tab || "dashboard"

  const dashboardInicial = getInitialProducaoDashboard(anoInicial, mesInicial, linhaInicial)
  const acompanhamentoInicial = getInitialProducaoAcompanhamento(anoInicial, mesInicial, linhaInicial)
  const perdasInicial = getInitialProducaoPerdas(anoInicial, mesInicial, linhaInicial)

  const dadoInicialDaAba =
    tabInicial === "dashboard"
      ? dashboardInicial
      : tabInicial === "acompanhamento"
        ? acompanhamentoInicial
        : perdasInicial

  const [tab, setTab] = useState<TabKey>(tabInicial)
  const [ano, setAno] = useState(anoInicial)
  const [mes, setMes] = useState(mesInicial)
  const [linha, setLinha] = useState<LinhaFiltro>(linhaInicial)
  const [busca, setBusca] = useState("")

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(dashboardInicial)
  const [acompanhamento, setAcompanhamento] = useState<AcompanhamentoResponse | null>(acompanhamentoInicial)
  const [perdas, setPerdas] = useState<PerdasResponse | null>(perdasInicial)
  const [loading, setLoading] = useState(!dadoInicialDaAba)
  const [erro, setErro] = useState("")
  const [cacheVersion, setCacheVersion] = useState<string | null>(null)

  function dashboardParams() {
    return { ano, mes, linha }
  }

  function acompanhamentoParams() {
    return {
      ano,
      mes,
      linha,
      busca,
    }
  }

  function perdasParams() {
    return {
      ano,
      mes,
      periodo: "mes",
    }
  }

  function aplicarCacheDaAbaAtual() {
    if (tab === "dashboard") {
      const cached = peekApiCache<DashboardResponse>("/producao/dashboard", dashboardParams())
      if (!cached) return false
      setDashboard(cached)
      return true
    }

    if (tab === "acompanhamento") {
      const cached = peekApiCache<AcompanhamentoResponse>("/producao/acompanhamento", acompanhamentoParams())
      if (!cached) return false
      setAcompanhamento(cached)
      return true
    }

    const cached = peekApiCache<PerdasResponse>("/producao/excelencia-operacional", perdasParams())
    if (!cached) return false
    setPerdas(cached)
    return true
  }

  async function loadDashboard(force = false) {
    const json = await apiGet<DashboardResponse>(
      "/producao/dashboard",
      dashboardParams(),
      { force },
    )
    setDashboard(json)
  }

  async function loadAcompanhamento(force = false) {
    const json = await apiGet<AcompanhamentoResponse>(
      "/producao/acompanhamento",
      acompanhamentoParams(),
      { force },
    )
    setAcompanhamento(json)
  }

  async function loadPerdas(force = false) {
    const json = await apiGet<PerdasResponse>(
      "/producao/excelencia-operacional",
      perdasParams(),
      { force },
    )
    setPerdas(json)
  }

  async function revalidarAbaAtualEmSegundoPlano() {
    try {
      if (tab === "dashboard") {
        await loadDashboard(true)
      } else if (tab === "acompanhamento") {
        await loadAcompanhamento(true)
      } else {
        await loadPerdas(true)
      }
    } catch (err) {
      console.warn("Não foi possível revalidar Produção em segundo plano", err)
    }
  }

  async function loadData(force = false) {
    const encontrouCache = !force && aplicarCacheDaAbaAtual()
    const temAlgoNaTela =
      (tab === "dashboard" && Boolean(dashboard)) ||
      (tab === "acompanhamento" && Boolean(acompanhamento)) ||
      (tab === "perdas" && Boolean(perdas)) ||
      encontrouCache

    try {
      setErro("")

      if (force) {
        clearProducaoCache()
      }

      // Se já tem dado em memória/localStorage, renderiza na hora.
      // Depois revalida em segundo plano e substitui se o backend mudou.
      setLoading(!temAlgoNaTela || force)

      if (encontrouCache && !force) {
        setLoading(false)
        void revalidarAbaAtualEmSegundoPlano()
        return
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

  async function prefetchAbasProducao() {
    await Promise.allSettled([
      loadDashboard(false),
      loadAcompanhamento(false),
      loadPerdas(false),
    ])
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
    }, 15_000)

    function checarAoVoltarParaAba() {
      if (document.visibilityState === "visible") {
        void loadVersao()
      }
    }

    document.addEventListener("visibilitychange", checarAoVoltarParaAba)
    window.addEventListener("focus", checarAoVoltarParaAba)

    return () => {
      alive = false
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", checarAoVoltarParaAba)
      window.removeEventListener("focus", checarAoVoltarParaAba)
    }
  }, [])

  useEffect(() => {
    salvarUltimoEstadoProducao({ tab, ano, mes, linha })
  }, [tab, ano, mes, linha])

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ano, mes, linha, cacheVersion])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void prefetchAbasProducao()
    }, 350)

    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes, linha])

  useEffect(() => {
    if (tab !== "acompanhamento") return
    const id = window.setTimeout(() => {
      void loadData()
    }, 350)
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

      {loading &&
        ((tab === "dashboard" && !dashboard) ||
          (tab === "acompanhamento" && !acompanhamento) ||
          (tab === "perdas" && !perdas)) && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-semibold text-blue-700 shadow-sm">
            Carregando dados de produção...
          </div>
        )}

      {loading &&
        ((tab === "dashboard" && dashboard) ||
          (tab === "acompanhamento" && acompanhamento) ||
          (tab === "perdas" && perdas)) && (
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

      {tab === "perdas" && perdas && <PerdasTab data={perdas} linha={linha} />}

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
          Nenhuma informação de excelência operacional encontrada.
        </div>
      )}
    </div>
  )
}

export default ProducaoPage
