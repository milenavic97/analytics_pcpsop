import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Database,
  Download,
  Filter,
  PackageSearch,
  RefreshCw,
  Settings2,
  ShoppingCart,
  UploadCloud,
  X,
} from "lucide-react"
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"
import {
  AgingEstoqueItem,
  buscarUltimaAtualizacao,
  getAgingEstoqueItem,
  uploadBase,
} from "@/services/api"

const PAGE_SIZE = 10
const EXPORT_PAGE_SIZE = 5000

const API_BASE = String(import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev").replace(/\/$/, "")

type GranularidadeSerie = "mensal" | "semanal" | "diaria"
type EscopoEstoque = "produtos" | "insumos" | "todos"
type SemaforoEstoque = "VERMELHO" | "AMARELO" | "VERDE" | "CINZA"
type VisaoEstoque = "dashboard" | "gestao"

const ESCOPO_ESTOQUE_OPTIONS: { key: EscopoEstoque; label: string; helper: string }[] = [
  {
    key: "produtos",
    label: "PA / MR",
    helper: "Produto acabado, revenda, PPS, Bravi e faturamento.",
  },
  {
    key: "insumos",
    label: "Insumos",
    helper: "MP, ME, MI e materiais com demanda explodida pela BOM.",
  },
  {
    key: "todos",
    label: "Todos",
    helper: "Visão consolidada para conferência geral.",
  },
]

const ESCOPO_TITULO: Record<EscopoEstoque, string> = {
  produtos: "Produtos acabados / Revenda",
  insumos: "Insumos de produção",
  todos: "Todos os materiais",
}

const ESCOPO_DESCRICAO: Record<EscopoEstoque, string> = {
  produtos: "Visão de estoque para venda, faturamento, transferência Bravi e itens de portfólio.",
  insumos: "Visão de estoque para produção, consumo histórico, cobertura, lead time, MOQ e demanda via BOM.",
  todos: "Visão consolidada com produtos e insumos para conferência da base.",
}


function classificacaoPadraoPorEscopo(escopo: EscopoEstoque): string {
  // Para PA/MR precisamos mostrar todos os produtos do cadastro/dimensão,
  // inclusive linhas sintéticas da d_produtos que não aparecem no Aging.
  // Para insumos mantemos o padrão mapeado para não poluir a visão com itens administrativos.
  return escopo === "produtos" ? "TODOS" : "MAPEADOS"
}

type BraviSeriePonto = {
  key: string
  ordem?: string
  periodo: string
  periodo_completo?: string
  data_inicio?: string
  data_fim?: string
  ano?: number
  mes?: number
  estoque?: number | null
  estoque_medio?: number | null
  estoque_projetado?: number | null
  estoque_quarentena?: number | null
  quarentena?: number | null
  saldo_quarentena?: number | null
  entradas_previstas?: number | null
  faturamento_qtd?: number | null
  faturamento_valor?: number | null
  consumo?: number | null
  demanda?: number | null
  forecast?: number | null
  pedidos_detalhe?: {
    pedido_numero?: string | null
    sc_numero?: string | null
    quantidade?: number | null
    quantidade_pendente?: number | null
    data_prevista_entrega?: string | null
    fornecedor?: string | null
  }[]
  faturamento_detalhe?: {
    data?: string | null
    codigo?: string | null
    quantidade?: number | null
    valor?: number | null
  }[]
}

type BraviSerieResponse = {
  granularidade: GranularidadeSerie
  data_snapshot_consumo?: string | null
  total_itens_produtos?: number
  codigos_produtos?: string[]
  total_itens_bravi: number
  codigos_bravi: string[]
  resumo?: {
    estoque_atual?: number | null
    pedidos_abertos?: number | null
    faturamento_ytd_qtd?: number | null
    faturamento_ytd_valor?: number | null
    criticos?: number | null
    excesso?: number | null
  }
  serie: BraviSeriePonto[]
  item?: {
    codigo?: string | null
    produto?: string | null
    tipo?: string | null
  }
  debug?: Record<string, unknown>
  backend_versao?: string
}

async function getBraviSerie(granularidade: GranularidadeSerie, codigo?: string): Promise<BraviSerieResponse> {
  // V32: a série geral PA/MR e a série por item entram no cache local de 12h.
  // Ao selecionar item, o front mostra fallback rápido e troca pela série real quando o backend/cache responder.
  const params: Record<string, string> = { granularidade }
  if (codigo) params.codigo = codigo

  return fetchJsonComCache<BraviSerieResponse>("/aging-estoque/produtos/serie", params)
}

async function fetchJson<T>(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    searchParams.set(key, String(value))
  })

  // Não adiciona _t automaticamente. O cache local + no-store já evitam cache do navegador.
  // _t/force_refresh só entram em refresh manual/upload para não forçar rebuild pesado no backend.
  const forceRefreshParam = params.force_refresh === true || String(params.force_refresh || "").toLowerCase() === "true"
  if (forceRefreshParam && !searchParams.has("_t")) {
    searchParams.set("_t", String(Date.now()))
  }

  const query = searchParams.toString()
  const response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`, {
    method: "GET",
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Erro ${response.status} ao buscar ${path}`)
  }

  return response.json() as Promise<T>
}

const GESTAO_ESTOQUE_CACHE_PREFIX = "pcp_gestao_estoque_cache_v5_12h_sem_refresh_automatico"
const GESTAO_ESTOQUE_CACHE_TTL_MS = 12 * 60 * 60 * 1000

type CacheGestaoEstoquePayload<T> = {
  savedAt: number
  path: string
  params: Record<string, string | number | boolean | null | undefined>
  payload: T
}

function normalizarCacheParams(params: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)])
  )
}

function cacheKeyGestaoEstoque(path: string, params: Record<string, string | number | boolean | null | undefined>) {
  const normalized = normalizarCacheParams(params)
  return `${GESTAO_ESTOQUE_CACHE_PREFIX}:${path}:${JSON.stringify(normalized)}`
}

function lerCacheGestaoEstoque<T>(path: string, params: Record<string, string | number | boolean | null | undefined>): T | null {
  try {
    if (typeof window === "undefined") return null

    const key = cacheKeyGestaoEstoque(path, params)
    const raw = window.localStorage.getItem(key)

    if (!raw) return null

    const parsed = JSON.parse(raw) as CacheGestaoEstoquePayload<T>
    const savedAt = Number(parsed.savedAt || 0)
    const expirado = !savedAt || Date.now() - savedAt > GESTAO_ESTOQUE_CACHE_TTL_MS

    if (expirado || !parsed.payload) {
      window.localStorage.removeItem(key)
      return null
    }

    return parsed.payload
  } catch {
    return null
  }
}

function salvarCacheGestaoEstoque<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  payload: T
) {
  try {
    if (typeof window === "undefined") return

    const key = cacheKeyGestaoEstoque(path, params)
    const value: CacheGestaoEstoquePayload<T> = {
      savedAt: Date.now(),
      path,
      params: normalizarCacheParams(params),
      payload,
    }

    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Se o storage estiver cheio/bloqueado, a tela continua funcionando sem cache.
  }
}

function limparCacheGestaoEstoqueLocal() {
  try {
    if (typeof window === "undefined") return

    const keysToRemove: string[] = []

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key) continue

      if (
        key.startsWith(GESTAO_ESTOQUE_CACHE_PREFIX) ||
        key.includes("/aging-estoque/resumo") ||
        key.includes("/aging-estoque/itens") ||
        key.includes("/aging-estoque/produtos/serie") ||
        key.includes("dfl-api-cache")
      ) {
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Não bloqueia a tela se o navegador impedir acesso ao storage.
  }
}

async function fetchJsonComCache<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
): Promise<T> {
  const cached = lerCacheGestaoEstoque<T>(path, params)

  if (cached) {
    return cached
  }

  const payload = await fetchJson<T>(path, params)
  salvarCacheGestaoEstoque(path, params, payload)
  return payload
}

function getAgingResumoDireto(params: { escopo: EscopoEstoque; classificacao_cadastro?: string; force_refresh?: boolean; _t?: string | number }): Promise<AgingResumoResponse> {
  return fetchJsonComCache<AgingResumoResponse>("/aging-estoque/resumo", {
    escopo: params.escopo,
    classificacao_cadastro: params.classificacao_cadastro,
    force_refresh: params.force_refresh,
    _t: params._t,
  })
}

function getAgingItensDireto(params: {
  escopo: EscopoEstoque
  page: number
  page_size: number
  sort_key?: string
  sort_direction?: string
  busca?: string
  status?: string
  tipo_negocio?: string
  status_portfolio?: string
  transferencia_bravi?: string
  classificacao_cadastro?: string
  semaforo?: SemaforoEstoque
  force_refresh?: boolean
  _t?: string | number
}): Promise<AgingItensResponse> {
  return fetchJsonComCache<AgingItensResponse>("/aging-estoque/itens", {
    escopo: params.escopo,
    page: params.page,
    page_size: params.page_size,
    sort_key: params.sort_key,
    sort_direction: params.sort_direction || "desc",
    busca: params.busca,
    status: params.status,
    tipo_negocio: params.tipo_negocio,
    status_portfolio: params.status_portfolio,
    transferencia_bravi: params.transferencia_bravi,
    classificacao_cadastro: params.classificacao_cadastro,
    semaforo: params.semaforo,
    force_refresh: params.force_refresh,
    _t: params._t,
  })
}


async function getAgingEstoqueItemComCache(
  codigo: string,
  horizonteFuturo: number
): Promise<AgingEstoqueItemDetalhe> {
  // V32: o detalhe de insumos é pesado porque traz histórico de consumo, demanda MPS/BOM,
  // pedidos e histórico diário. Guardamos o detalhe por 12h para sair/voltar ou trocar de item
  // sem recalcular tudo de novo no backend.
  const params = {
    codigo,
    horizonte_futuro: Math.max(1, Number(horizonteFuturo || 6)),
  }

  const cached = lerCacheGestaoEstoque<AgingEstoqueItemDetalhe>(
    "__service__/aging-estoque/item",
    params
  )

  if (cached) return cached

  const detalhe = await getAgingEstoqueItem(codigo, params.horizonte_futuro) as AgingEstoqueItemDetalhe
  salvarCacheGestaoEstoque("__service__/aging-estoque/item", params, detalhe)
  return detalhe
}

type BaseGestaoEstoque = {
  id: string
  titulo: string
  descricao: string
  uso: string
  compartilhada?: string
  obrigatoria?: boolean
}

const BASES_GESTAO_ESTOQUE: BaseGestaoEstoque[] = [
  {
    id: "consumo_materiais",
    titulo: "Posição de Estoque / Consumo",
    descricao: "Base principal do aging: saldo atual, consumo mensal, médias, giro e cobertura.",
    uso: "Alimenta estoque atual, maior média, cobertura e gap de estoque.",
    obrigatoria: true,
  },
  {
    id: "compras_abertas",
    titulo: "Compras em Aberto",
    descricao: "Pedidos e solicitações pendentes do Protheus.",
    uso: "Soma entradas futuras, estoque + pedidos e menor data prevista de entrega.",
    compartilhada: "Também atualiza a página de Ordens.",
    obrigatoria: true,
  },
  {
    id: "forecast_sop",
    titulo: "Forecast S&OP",
    descricao: "Demanda futura por produto acabado ou material de revenda.",
    uso: "Para PA/MR usa o forecast direto; para insumos, a demanda é explodida pela BOM.",
    compartilhada: "Também alimenta Overview e Faturamento.",
    obrigatoria: true,
  },
  {
    id: "bom_estrutura",
    titulo: "Estrutura / BOM",
    descricao: "Relação produto pai x componente x quantidade necessária.",
    uso: "Explode forecast de PA em necessidade de insumos e classifica insumos pelo produto pai.",
    compartilhada: "Também atualiza a página de Ordens.",
    obrigatoria: true,
  },
  {
    id: "d_produtos",
    titulo: "Dimensão Produtos",
    descricao: "Cadastro gerencial de produtos: negócio, portfólio, Bravi e grupo gerencial.",
    uso: "Classifica Anestésicos Injetáveis, Benzotop, PPS, descontinuados e transferência Bravi.",
    compartilhada: "Base corporativa usada por várias páginas.",
    obrigatoria: true,
  },
  {
    id: "parametros_estoque",
    titulo: "Lead Time e MOQ",
    descricao: "Prazo de reposição e quantidade mínima de compra por código.",
    uso: "Calcula consumo durante o lead time e compõe o estoque ideal: maior entre consumo no LT e pedido mínimo/MOQ.",
    obrigatoria: true,
  },
  {
    id: "custo_unitario",
    titulo: "Custo Unitário",
    descricao: "Custo unitário em reais por código.",
    uso: "Permite replicar as colunas financeiras do aging em R$.",
    obrigatoria: false,
  },
]

const STATUS_LABEL: Record<string, string> = {
  TODOS: "Todos os status",
  RUPTURA: "Ruptura",
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  SAUDAVEL: "Saudável",
  EXCESSO: "Excesso",
  SEM_GIRO: "Sem consumo",
  SEM_CONSUMO: "Sem consumo",
  DESCONTINUADO_COM_SALDO: "Descontinuado c/ saldo",
  TRANSFERENCIA_BRAVI: "PA / MR",
}

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  RUPTURA: { bg: "rgba(220,38,38,0.09)", color: "#B91C1C", border: "rgba(220,38,38,0.24)" },
  CRITICO: { bg: "rgba(234,88,12,0.10)", color: "#C2410C", border: "rgba(234,88,12,0.24)" },
  ATENCAO: { bg: "rgba(245,158,11,0.12)", color: "#B45309", border: "rgba(245,158,11,0.28)" },
  SAUDAVEL: { bg: "rgba(22,163,74,0.09)", color: "#15803D", border: "rgba(22,163,74,0.24)" },
  EXCESSO: { bg: "rgba(37,99,235,0.09)", color: "#1D4ED8", border: "rgba(37,99,235,0.24)" },
  SEM_GIRO: { bg: "rgba(100,116,139,0.10)", color: "#475569", border: "rgba(100,116,139,0.24)" },
  SEM_CONSUMO: { bg: "rgba(100,116,139,0.10)", color: "#475569", border: "rgba(100,116,139,0.24)" },
  DESCONTINUADO_COM_SALDO: { bg: "rgba(185,28,28,0.10)", color: "#991B1B", border: "rgba(185,28,28,0.28)" },
  TRANSFERENCIA_BRAVI: { bg: "rgba(124,58,237,0.10)", color: "#6D28D9", border: "rgba(124,58,237,0.28)" },
}

type SortDirection = "asc" | "desc"
type SortKey =
  | "custo_unitario"
  | "lead_time_dias"
  | "qtd_minima"
  | "saldo"
  | "saldo_quarentena"
  | "saldo_sb8_bruto"
  | "empenho_lote"
  | "estoque_atual_valor"
  | "qtd_pedidos_abertos"
  | "pedidos_abertos_valor"
  | "estoque_mais_pedidos"
  | "estoque_mais_pedidos_valor"
  | "maior_media"
  | "maior_media_valor"
  | "estoque_ideal"
  | "estoque_ideal_valor"
  | "dias_em_estoque"
  | "cobertura_meses_atual"
  | "cobertura_meses_futura"
  | "cobertura_consumo_lt"
  | "demanda_mes_atual"
  | "consumo_mes_atual"
  | "previsto_vs_consumido_pct"
  | "perc_mes_decorrido"
  | "desvio_ritmo_pct"
  | "gap_volume"
  | "consumo_durante_lt"

type NumericColumnKind = "number" | "currency" | "days" | "months" | "percent"

const NUMERIC_COLUMNS: { key: SortKey; label: string; kind?: NumericColumnKind; digits?: number; group?: "estoque" | "politica" | "risco" | "financeiro" }[] = [
  { key: "saldo", label: "Estoque atual", group: "estoque" },
  { key: "saldo_quarentena", label: "Quarentena 98", group: "estoque" },
  { key: "saldo_sb8_bruto", label: "Saldo bruto SB8", group: "estoque" },
  { key: "empenho_lote", label: "Empenho lote", group: "estoque" },
  { key: "qtd_pedidos_abertos", label: "Pedido compra", group: "estoque" },
  { key: "estoque_mais_pedidos", label: "Estoque + entradas", group: "estoque" },
  { key: "maior_media", label: "Maior média 3/6/9", group: "politica" },
  { key: "lead_time_dias", label: "Lead time", kind: "days", group: "politica" },
  { key: "qtd_minima", label: "MOQ / qtd. mínima", group: "politica" },
  { key: "consumo_durante_lt", label: "Ponto pedido / Consumo LT", group: "politica" },
  { key: "estoque_ideal", label: "Estoque ideal", group: "politica" },
  { key: "gap_volume", label: "Gap", group: "risco" },
  { key: "dias_em_estoque", label: "Dias estoque", kind: "days", group: "risco" },
  { key: "cobertura_meses_atual", label: "Cob. atual", kind: "months", digits: 1, group: "risco" },
  { key: "cobertura_meses_futura", label: "Cob. futura", kind: "months", digits: 1, group: "risco" },
  { key: "cobertura_consumo_lt", label: "Cob. LT", kind: "months", digits: 1, group: "risco" },
  { key: "demanda_mes_atual", label: "Demanda mês", group: "risco" },
  { key: "consumo_mes_atual", label: "Consumido mês", group: "risco" },
  { key: "previsto_vs_consumido_pct", label: "Consumo vs previsão", kind: "percent", digits: 0, group: "risco" },
  { key: "custo_unitario", label: "Custo unitário", kind: "currency", digits: 4, group: "financeiro" },
  { key: "estoque_atual_valor", label: "Estoque R$", kind: "currency", group: "financeiro" },
  { key: "pedidos_abertos_valor", label: "Pedidos R$", kind: "currency", group: "financeiro" },
  { key: "estoque_mais_pedidos_valor", label: "Estoque + entradas R$", kind: "currency", group: "financeiro" },
  { key: "maior_media_valor", label: "Média R$", kind: "currency", group: "financeiro" },
  { key: "estoque_ideal_valor", label: "Ideal R$", kind: "currency", group: "financeiro" },
]

const COLUNAS_PADRAO_PA_MR = [
  "status",
  "curva_a",
  "tipo",
  "unid",
  "segmento",
  "mercado",
  "saldo",
  "saldo_quarentena",
  "qtd_pedidos_abertos",
  "estoque_mais_pedidos",
  "demanda_mes_atual",
  "cobertura_meses_atual",
  "cobertura_meses_futura",
  "dias_em_estoque",
  "estoque_atual_valor",
  "pedidos_abertos_valor",
  "estoque_mais_pedidos_valor",
]

const COLUNAS_INSUMOS_OPCOES: { key: string; label: string; align?: "left" | "center" | "right"; width?: string }[] = [
  { key: "status", label: "Status", width: "w-[110px]" },
  { key: "tipo", label: "Tipo", width: "w-[80px]" },
  { key: "unid", label: "UM", align: "center", width: "w-[70px]" },
  { key: "saldo", label: "Estoque atual", align: "right", width: "w-[120px]" },
  { key: "saldo_quarentena", label: "Quarentena 98", align: "right", width: "w-[120px]" },
  { key: "qtd_pedidos_abertos", label: "Pedidos", align: "right", width: "w-[110px]" },
  { key: "estoque_mais_pedidos", label: "Estoque + entradas", align: "right", width: "w-[135px]" },
  { key: "consumo_mes_atual", label: "Consumo mês", align: "right", width: "w-[120px]" },
  { key: "demanda_mes_atual", label: "Previsão mês", align: "right", width: "w-[120px]" },
  { key: "previsto_vs_consumido_pct", label: "% previsão consumida", align: "right", width: "w-[140px]" },
  { key: "pct_mes_decorrido", label: "% mês decorrido", align: "right", width: "w-[125px]" },
  { key: "desvio_ritmo_pct", label: "Desvio ritmo", align: "right", width: "w-[120px]" },
  { key: "dias_em_estoque", label: "Dias estoque", align: "right", width: "w-[110px]" },
  { key: "cobertura_meses_atual", label: "Cob. atual", align: "right", width: "w-[110px]" },
  { key: "cobertura_meses_futura", label: "Cob. futura", align: "right", width: "w-[110px]" },
  { key: "maior_media", label: "Maior média", align: "right", width: "w-[110px]" },
  { key: "lead_time_dias", label: "Lead time", align: "right", width: "w-[100px]" },
  { key: "qtd_minima", label: "MOQ", align: "right", width: "w-[110px]" },
  { key: "consumo_durante_lt", label: "Ponto pedido", align: "right", width: "w-[120px]" },
  { key: "estoque_ideal", label: "Estoque ideal", align: "right", width: "w-[120px]" },
  { key: "gap_volume", label: "Gap", align: "right", width: "w-[110px]" },
  { key: "saldo_sb8_bruto", label: "Saldo bruto SB8", align: "right", width: "w-[120px]" },
  { key: "empenho_lote", label: "Empenho lote", align: "right", width: "w-[120px]" },
  { key: "custo_unitario", label: "Custo unitário", align: "right", width: "w-[120px]" },
  { key: "estoque_atual_valor", label: "Estoque R$", align: "right", width: "w-[120px]" },
  { key: "pedidos_abertos_valor", label: "Pedidos R$", align: "right", width: "w-[120px]" },
  { key: "estoque_mais_pedidos_valor", label: "Estoque + entradas R$", align: "right", width: "w-[140px]" },
]

const COLUNAS_PADRAO_INSUMOS = [
  "status",
  "tipo",
  "unid",
  "saldo",
  "saldo_quarentena",
  "qtd_pedidos_abertos",
  "estoque_mais_pedidos",
  "consumo_mes_atual",
  "demanda_mes_atual",
  "pct_consumo_previsto",
  "pct_mes_decorrido",
  "desvio_ritmo_pct",
  "dias_em_estoque",
  "lead_time_dias",
  "qtd_minima",
  "consumo_durante_lt",
  "estoque_ideal",
  "gap_volume",
]



type FiltroTabelaEstoque = {
  label: string
  busca?: string
  status?: string
  tipo_negocio?: string
  status_portfolio?: string
  transferencia_bravi?: string
  classificacao_cadastro?: string
  semaforo?: SemaforoEstoque
}

const filtroKey = (filtro: FiltroTabelaEstoque | null) => {
  if (!filtro) return "TODOS"
  return [
    filtro.label,
    filtro.busca || "",
    filtro.status || "",
    filtro.tipo_negocio || "",
    filtro.status_portfolio || "",
    filtro.transferencia_bravi || "",
    filtro.classificacao_cadastro || "",
    filtro.semaforo || "",
  ].join("|")
}

const isFiltroAtivo = (filtro: FiltroTabelaEstoque | null, parcial: Partial<FiltroTabelaEstoque>) => {
  if (!filtro) return false
  return Object.entries(parcial).every(([key, value]) => (filtro as Record<string, unknown>)[key] === value)
}

const ORIGEM_LABEL: Record<string, string> = {
  DIMENSAO: "Cadastro",
  BOM: "BOM",
  NAO_CLASSIFICADO: "Não classificado",
}

interface AgingResumoResponse {
  escopo?: EscopoEstoque
  escopos_disponiveis?: EscopoEstoque[]
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
    descontinuado_com_saldo?: number
    transferencia_bravi?: number
    saldo_total?: number
    pedidos_total?: number
    entradas_previstas_total?: number
    liberacoes_previstas_total?: number
    pedidos_compra_total?: number
    estoque_ideal_total?: number
    gap_total?: number
    estoque_atual_valor_total?: number
    pedidos_abertos_valor_total?: number
    estoque_mais_pedidos_valor_total?: number
    estoque_ideal_valor_total?: number
    gap_valor_total?: number
    demanda_mes_atual_total?: number
    consumo_mes_atual_total?: number
    faturamento_ytd_qtd?: number
    faturamento_ytd_valor?: number
    cobertura_media_dias?: number
    cobertura_futura_media_dias?: number
  }
  faixas_cobertura?: { faixa: string; itens: number }[]
  por_tipo?: { tipo: string; itens: number; criticos: number; excesso: number; saldo: number }[]
  opcoes?: {
    tipo_negocio?: string[]
    tipo?: string[]
    status_portfolio?: string[]
    transferencia_bravi?: string[]
    modelo_fornecimento?: string[]
    grupo_gerencial?: string[]
    classificacao_cadastro?: string[]
  }
  top_excesso?: AgingEstoqueItem[]
  top_criticos?: AgingEstoqueItem[]
  top_descontinuados?: AgingEstoqueItem[]
  top_transferencia_bravi?: AgingEstoqueItem[]
  saude_negocios?: {
    tipo_negocio: string
    itens: number
    criticos: number
    excesso: number
    sem_giro: number
    descontinuado_com_saldo: number
    transferencia_bravi: number
    saldo_total: number
    pedidos_total: number
    faturamento_ytd_qtd?: number
    faturamento_ytd_valor?: number
    cobertura_futura_media_dias: number
  }[]
}

interface AgingItensResponse {
  escopo?: EscopoEstoque
  escopos_disponiveis?: EscopoEstoque[]
  page: number
  page_size: number
  total: number
  total_pages: number
  itens: AgingEstoqueItem[]
  opcoes?: {
    tipo_negocio?: string[]
    tipo?: string[]
    status_portfolio?: string[]
    transferencia_bravi?: string[]
    modelo_fornecimento?: string[]
    grupo_gerencial?: string[]
    classificacao_cadastro?: string[]
  }
}

type AgingEstoqueItemDetalhe = Omit<AgingEstoqueItem, "linha_tempo_estoque" | "pedidos"> & {
  historico_sb8_diario?: {
    data: string
    saldo: number
    saldo_normal?: number | null
    saldo_bruto?: number | null
    empenho_lote?: number | null
    saldo_quarentena?: number | null
    quarentena?: number | null
    saldo_quarentena_bruto?: number | null
    empenho_quarentena?: number | null
    saldo_total_com_quarentena?: number | null
    armazens_normais?: string[]
    armazem_quarentena?: string | null
  }[]
  comparativo_mensal?: { ano: number; mes: number; periodo: string; estoque_medio: number; consumo: number; forecast: number }[]
  linha_tempo_estoque?: {
    ano: number
    mes: number
    periodo: string
    consumo: number | null
    demanda: number | null
    forecast?: number | null
    entradas_previstas: number | null
    estoque_atual: number | null
    estoque_mais_pedidos: number | null
    estoque_quarentena?: number | null
    quarentena?: number | null
    saldo_projetado?: number | null
  }[]
  historico_consumo?: { ano: number; mes: number; periodo: string; consumo: number }[]
  forecast?: { ano: number; mes: number; periodo: string; forecast: number }[]
  faturamento_sd2?: BraviSeriePonto[]
  serie_operacional?: BraviSeriePonto[]
  pedidos?: {
    pedido_numero?: string | null
    sc_numero?: string | null
    quantidade_pendente?: number
    data_prevista_entrega?: string | null
    fornecedor?: string | null
    comprador?: string | null
    status_entrega?: string | null
  }[]
  forecast_metodo?: "direto" | "bom_explodida" | string
  saldo_quarentena?: number | null
  quarentena?: number | null
  saldo_sb8_bruto?: number | null
  empenho_lote?: number | null
  saldo_origem?: string | null
  data_saldo_origem?: string | null
  saldo_quarentena_bruto?: number | null
  empenho_quarentena?: number | null
  armazens_saldo_origem?: string[]
  armazem_quarentena?: string | null
  tem_posicao_aging?: boolean | null
  origem_linha_estoque?: string | null
}

function fmtNumber(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0))
}

function fmtCurrency(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function toNumberSafe(value: unknown, defaultValue = 0) {
  if (value === null || value === undefined || value === "") return defaultValue
  if (typeof value === "number") return Number.isFinite(value) ? value : defaultValue

  const textoOriginal = String(value).trim()
  if (!textoOriginal) return defaultValue

  let texto = textoOriginal.replace(/\s/g, "")

  // Formato brasileiro: 1.030,50 ou 1.030
  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".")
  }

  const numero = Number(texto)
  return Number.isFinite(numero) ? numero : defaultValue
}

function getNum(item: AgingEstoqueItem, key: string) {
  return toNumberSafe((item as AgingEstoqueItem & Record<string, unknown>)[key], 0)
}

function getEstoqueAtualReal(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  const raw = item as unknown as Record<string, unknown>

  // Para a tela executiva, o estoque atual correto é o mesmo valor exibido na tabela.
  // Em alguns casos o saldo_sb8_bruto vem diferente do saldo disponível, como SUGCLEAN:
  // tabela = 1.030, saldo_sb8_bruto/série = 1.052. Por isso, "saldo" tem prioridade.
  const candidatos = [
    raw.saldo,
    raw.estoque_atual_real,
    raw.estoque_atual,
    raw.saldo_sb8,
    raw.saldo_sb8_bruto,
  ]

  for (const candidato of candidatos) {
    const valor = toNumberSafe(candidato, Number.NaN)
    if (Number.isFinite(valor)) {
      return Math.max(0, valor)
    }
  }

  return 0
}

function getQuarentenaAtualReal(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  const raw = item as unknown as Record<string, unknown>
  const candidatos = [
    raw.saldo_quarentena,
    raw.quarentena,
    raw.quarentena_98,
    raw.saldo_quarentena_98,
    raw.saldo_quarentena_bruto,
    raw.quarentena_bruta,
    raw.estoque_quarentena,
  ]

  let maior = 0
  for (const candidato of candidatos) {
    const valor = toNumberSafe(candidato, Number.NaN)
    if (Number.isFinite(valor) && valor > maior) maior = valor
  }

  return Math.max(0, maior)
}

function getPedidosAbertos(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  const raw = item as unknown as Record<string, unknown>
  return Math.max(
    0,
    toNumberSafe(
      raw.qtd_pedidos_abertos ??
      raw.entradas_previstas ??
      raw.qtd_entradas_previstas ??
      0
    )
  )
}


function getEntradasMesAtualDashboard(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  const raw = item as unknown as Record<string, any>
  const backend = toNumberSafe(raw.entradas_mes_atual ?? raw.qtd_entradas_mes_atual ?? raw.entradas_previstas_mes_atual, Number.NaN)
  if (Number.isFinite(backend)) return Math.max(0, backend)

  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth() + 1
  const series = [raw.entradas_previstas_serie, raw.pedidos_futuros_por_mes, raw.entradas_previstas_periodo]

  let total = 0
  for (const serie of series) {
    if (!Array.isArray(serie)) continue

    for (const ponto of serie) {
      let ano = Number(ponto?.ano || 0)
      let mes = Number(ponto?.mes || 0)

      if ((!ano || !mes) && ponto?.data_inicio) {
        const data = new Date(String(ponto.data_inicio))
        if (!Number.isNaN(data.getTime())) {
          ano = data.getFullYear()
          mes = data.getMonth() + 1
        }
      }

      if (ano === anoAtual && mes === mesAtual) {
        total += Math.max(0, toNumberSafe(ponto?.entradas_previstas ?? ponto?.qtd_entradas_previstas ?? ponto?.quantidade_pendente ?? ponto?.quantidade ?? 0, 0))
      }
    }

    if (total > 0) return total
  }

  return 0
}

function getDemandaMesAtualStatusDashboard(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0
  const raw = item as unknown as Record<string, unknown>
  return Math.max(
    0,
    toNumberSafe(raw.demanda_mes_atual, 0),
    toNumberSafe(raw.previsao_mes_atual, 0),
    toNumberSafe(raw.demanda_bom_mes_atual, 0),
    toNumberSafe(raw.demanda_direta_mes_atual, 0),
    toNumberSafe(raw.forecast_mes, 0),
  )
}

function getMovimentoSeisMesesStatusDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return 0
  const raw = item as unknown as Record<string, unknown>
  const backend = toNumberSafe(raw.movimento_6m_status ?? raw.total_6m ?? raw.venda_consumo_6m, Number.NaN)
  if (Number.isFinite(backend)) return Math.max(0, backend)
  return getTotalSeisMesesDashboard(item)
}

function getDemandaStatusDashboard(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const demandaMes = getDemandaMesAtualStatusDashboard(item)
  if (demandaMes > 0) return demandaMes

  const movimento6m = getMovimentoSeisMesesStatusDashboard(item as AgingEstoqueItem)
  if (movimento6m > 0) return movimento6m / 6

  return 0
}

function getCoberturaStatusDashboard(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  const raw = item as unknown as Record<string, unknown>
  const backend = toNumberSafe(raw.cobertura_meses_status ?? raw.cobertura_status_meses, Number.NaN)
  if (Number.isFinite(backend)) return Math.max(0, backend)

  const demanda = getDemandaStatusDashboard(item)
  if (demanda <= 0) return 0

  return (getEstoqueAtualReal(item) + getEntradasMesAtualDashboard(item)) / demanda
}

function getCampoNumericoSeExiste(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined, key: string) {
  if (!item) return null
  const raw = item as unknown as Record<string, unknown>
  if (!(key in raw)) return null
  const valor = toNumberSafe(raw[key], Number.NaN)
  return Number.isFinite(valor) ? Math.max(0, valor) : null
}

function getCoberturaBaseProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  // Fallback usado só quando o backend ainda não devolveu a cobertura por forecast acumulado.
  const chavesBase = [
    "demanda_mes_atual",
    "demanda_mes",
    "previsao_mes_atual",
    "previsao_mes",
    "forecast_mes",
    "maior_media",
    "media_consumo",
  ]

  for (const chave of chavesBase) {
    const valor = getNum(item as AgingEstoqueItem, chave)
    if (valor > 0) return valor
  }

  return 0
}

function getCoberturaAtualProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const backendStatus = getCampoNumericoSeExiste(item, "cobertura_meses_status")
  if (backendStatus !== null) return backendStatus

  const backend = getCampoNumericoSeExiste(item, "cobertura_meses_atual")
  if (backend !== null) return backend

  return getCoberturaStatusDashboard(item)
}

function getCoberturaFuturaProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const backend = getCampoNumericoSeExiste(item, "cobertura_meses_futura")
  if (backend !== null) return backend

  const base = getCoberturaBaseProduto(item)
  if (base <= 0) return 0
  return (getEstoqueAtualReal(item) + getPedidosAbertos(item)) / base
}

function getDiasEstoqueProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const backend = getCampoNumericoSeExiste(item, "cobertura_dias")
  if (backend !== null) return backend
  return getCoberturaAtualProduto(item) * 30
}

function getEstoqueMaisEntradasProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  return getEstoqueAtualReal(item) + getPedidosAbertos(item)
}

function normalizarCoberturaPaMrItem<T extends AgingEstoqueItem | AgingEstoqueItemDetalhe>(item: T): T {
  const estoqueAtual = getEstoqueAtualReal(item)
  const estoqueMaisEntradas = getEstoqueMaisEntradasProduto(item)

  // A partir da correção de regra, a cobertura oficial vem do backend,
  // calculada por forecast/demanda futura acumulada mês a mês.
  // O front não deve mais sobrescrever esses campos com demanda de um único mês.
  return {
    ...(item as Record<string, unknown>),
    saldo: estoqueAtual,
    estoque_mais_pedidos: estoqueMaisEntradas,
    estoque_mais_entradas: estoqueMaisEntradas,
    __cobertura_pa_mr_preservada_backend: true,
  } as unknown as T
}

function normalizarCoberturaPaMrResponse(res: AgingItensResponse, escopo: EscopoEstoque): AgingItensResponse {
  if (escopo === "insumos") return res

  return {
    ...res,
    itens: (res.itens || []).map((item) => normalizarCoberturaPaMrItem(item)),
  }
}


function getValorNumericoTabela(item: AgingEstoqueItem, key: SortKey, isTabelaProdutos = false) {
  if (isTabelaProdutos) {
    if (key === "saldo") return getEstoqueAtualReal(item)
    if (key === "estoque_mais_pedidos") return getEstoqueMaisEntradasProduto(item)
    if (key === "dias_em_estoque") return getDiasEstoqueProduto(item)
    if (key === "cobertura_meses_atual") return getCoberturaAtualProduto(item)
    if (key === "cobertura_meses_futura") return getCoberturaFuturaProduto(item)
  }

  return getNum(item, key)
}

function getPrevisaoMesAtual(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0
  const raw = item as unknown as Record<string, unknown>
  return Math.max(0, Number(raw.previsao_mes_atual ?? raw.demanda_mes_atual ?? 0))
}

function getConsumoMesAtual(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0
  const raw = item as unknown as Record<string, unknown>
  return Math.max(0, Number(raw.consumo_mes_atual ?? 0))
}

function getPercentualMesDecorrido() {
  const hoje = new Date()
  const totalDias = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() || 30
  return Math.min(100, Math.max(0, (hoje.getDate() / totalDias) * 100))
}

function getPercentualConsumoPrevisto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const previsao = getPrevisaoMesAtual(item)
  const consumo = getConsumoMesAtual(item)
  if (previsao <= 0) return consumo > 0 ? 999 : 0
  return (consumo / previsao) * 100
}

function getDesvioRitmoPct(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  return getPercentualConsumoPrevisto(item) - getPercentualMesDecorrido()
}

function calcularSemaforoConsumoInsumo(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined): SemaforoEstoque {
  const previsao = getPrevisaoMesAtual(item)
  const consumo = getConsumoMesAtual(item)

  // Sem previsão e sem consumo: não há risco operacional para acompanhar agora.
  // Então fica OK, não "Sem referência".
  if (previsao <= 0 && consumo <= 0) return "VERDE"
  if (previsao <= 0 && consumo > 0) return "AMARELO"

  const pctConsumo = getPercentualConsumoPrevisto(item)
  const pctMes = getPercentualMesDecorrido()
  const desvio = pctConsumo - pctMes

  if ((pctConsumo >= 100 && pctMes < 98) || desvio > 25) return "VERMELHO"
  if (desvio > 10) return "AMARELO"

  return "VERDE"
}

function renderValorColunaInsumo(item: AgingEstoqueItem, key: string): ReactNode {
  switch (key) {
    case "status":
      return <SemaforoBadge item={item} />
    case "tipo":
      return item.tipo || item.tipo_produto_erp || "—"
    case "unid":
      return item.unid || "—"
    case "saldo":
      return fmtNumber(getEstoqueAtualReal(item), 0)
    case "saldo_quarentena":
      return fmtNumber(getAnyNumber(item as unknown as Record<string, unknown>, "saldo_quarentena"), 0)
    case "qtd_pedidos_abertos":
      return fmtNumber(getPedidosAbertos(item), 0)
    case "estoque_mais_pedidos":
      return fmtNumber(getEstoqueAtualReal(item) + getPedidosAbertos(item), 0)
    case "consumo_mes_atual":
      return fmtNumber(getConsumoMesAtual(item), 0)
    case "demanda_mes_atual":
      return fmtNumber(getPrevisaoMesAtual(item), 0)
    case "previsto_vs_consumido_pct": {
      const previsao = getPrevisaoMesAtual(item)
      const consumo = getConsumoMesAtual(item)
      if (previsao <= 0 && consumo <= 0) return "—"
      if (previsao <= 0 && consumo > 0) return "Sem previsão"
      return `${fmtNumber(getPercentualConsumoPrevisto(item), 0)}%`
    }
    case "pct_mes_decorrido":
      return `${fmtNumber(getPercentualMesDecorrido(), 0)}%`
    case "desvio_ritmo_pct": {
      const previsao = getPrevisaoMesAtual(item)
      const consumo = getConsumoMesAtual(item)
      if (previsao <= 0 && consumo <= 0) return "—"
      if (previsao <= 0 && consumo > 0) return "Sem previsão"
      return `${getDesvioRitmoPct(item) > 0 ? "+" : ""}${fmtNumber(getDesvioRitmoPct(item), 0)} p.p.`
    }
    case "dias_em_estoque":
      return `${fmtNumber(getNum(item, "dias_em_estoque"), 0)} d`
    case "cobertura_meses_atual":
      return fmtNumber(getNum(item, "cobertura_meses_atual"), 1)
    case "cobertura_meses_futura":
      return fmtNumber(getNum(item, "cobertura_meses_futura"), 1)
    case "maior_media":
      return fmtNumber(getNum(item, "maior_media"), 0)
    case "lead_time_dias":
      return `${fmtNumber(getNum(item, "lead_time_dias"), 0)} d`
    case "qtd_minima":
      return fmtNumber(getNum(item, "qtd_minima"), 0)
    case "consumo_durante_lt":
      return fmtNumber(getNum(item, "consumo_durante_lt"), 0)
    case "estoque_ideal":
      return fmtNumber(getNum(item, "estoque_ideal"), 0)
    case "gap_volume":
      return fmtNumber(getNum(item, "gap_volume"), 0)
    case "saldo_sb8_bruto":
      return fmtNumber(getNum(item, "saldo_sb8_bruto"), 0)
    case "empenho_lote":
      return fmtNumber(getNum(item, "empenho_lote"), 0)
    case "custo_unitario":
      return fmtCurrency(getNum(item, "custo_unitario"), 4)
    case "estoque_atual_valor":
      return fmtCurrency(getNum(item, "estoque_atual_valor"), 2)
    case "pedidos_abertos_valor":
      return fmtCurrency(getNum(item, "pedidos_abertos_valor"), 2)
    case "estoque_mais_pedidos_valor":
      return fmtCurrency(getNum(item, "estoque_mais_pedidos_valor"), 2)
    default:
      return "—"
  }
}

function fmtTableValue(item: AgingEstoqueItem, col: { key: SortKey; kind?: NumericColumnKind; digits?: number }, isTabelaProdutos = false) {
  const value = getValorNumericoTabela(item, col.key, isTabelaProdutos)

  if (col.kind === "currency") return fmtCurrency(value, col.digits ?? 2)
  if (col.kind === "days") return `${fmtNumber(value, col.digits ?? 0)} d`
  if (col.kind === "months") return fmtNumber(value, col.digits ?? 1)
  if (col.kind === "percent") return `${fmtNumber(value, col.digits ?? 0)}%`
  return fmtNumber(value, col.digits ?? 0)
}

function fmtCompact(value: number | null | undefined) {
  const n = Number(value || 0)
  if (Math.abs(n) >= 1_000_000) return `${fmtNumber(n / 1_000_000, 1)} mi`
  if (Math.abs(n) >= 1_000) return `${fmtNumber(n / 1_000, 1)} mil`
  return fmtNumber(n, 0)
}

function fmtQtdEstoque(value: number | null | undefined) {
  const n = Number(value || 0)
  const digits = Math.abs(n - Math.round(n)) > 0.0001 ? 1 : 0
  return fmtNumber(n, digits)
}

function fmtQtdInteira(value: number | null | undefined) {
  return fmtNumber(value, 0)
}

function arredondarEixoMaximo(value: number) {
  const n = Math.max(0, Number(value || 0))
  if (!Number.isFinite(n) || n <= 0) return 1

  const potencia = Math.pow(10, Math.floor(Math.log10(n)))
  const normalizado = n / potencia

  const fator =
    normalizado <= 1 ? 1 :
    normalizado <= 1.25 ? 1.25 :
    normalizado <= 1.5 ? 1.5 :
    normalizado <= 2 ? 2 :
    normalizado <= 2.5 ? 2.5 :
    normalizado <= 3 ? 3 :
    normalizado <= 4 ? 4 :
    normalizado <= 5 ? 5 :
    normalizado <= 7.5 ? 7.5 :
    10

  return fator * potencia
}

function fmtDate(value?: string | null) {
  if (!value) return "—"

  const texto = String(value).trim()
  const isoDate = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const [, ano, mes, dia] = isoDate
    return `${dia}/${mes}/${ano}`
  }

  const brDate = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brDate) {
    const [, dia, mes, ano] = brDate
    return `${dia}/${mes}/${ano}`
  }

  const d = new Date(texto)
  if (Number.isNaN(d.getTime())) return texto.slice(0, 10)

  return d.toLocaleDateString("pt-BR")
}

function fmtDateTime(value?: string | null) {
  if (!value) return "—"

  const texto = String(value).trim()

  // Data pura não deve sofrer conversão de fuso, senão pode virar o dia anterior.
  const isoDateOnly = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateOnly) {
    const [, ano, mes, dia] = isoDateOnly
    return `${dia}/${mes}/${ano}`
  }

  const brDateOnly = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brDateOnly) {
    const [, dia, mes, ano] = brDateOnly
    return `${dia}/${mes}/${ano}`
  }

  // Datas com hora vindas do Supabase/Fly costumam chegar em UTC.
  // O front deve exibir sempre no horário do Brasil para não mostrar +3h.
  let valorParse = texto
  const pareceIsoComHora = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(valorParse)
  const temTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(valorParse)

  if (pareceIsoComHora) {
    valorParse = valorParse.replace(" ", "T")
    if (!temTimezone) valorParse = `${valorParse}Z`
  }

  const d = new Date(valorParse)
  if (Number.isNaN(d.getTime())) {
    const brDateTime = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s*)?(\d{2}:\d{2}))?/i)
    if (brDateTime) {
      const [, dia, mes, ano, hora] = brDateTime
      return hora ? `${dia}/${mes}/${ano} às ${hora}` : `${dia}/${mes}/${ano}`
    }

    return texto.slice(0, 16)
  }

  const dataHora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)

  return dataHora.replace(",", " às")
}

function getAnyNumber(item: Record<string, unknown> | null | undefined, key: string) {
  return Number(item?.[key] || 0)
}

function getSaldoOrigemLabel(item: Record<string, unknown> | null | undefined) {
  const origem = String(item?.["saldo_origem"] || item?.["origem_linha_estoque"] || "").toLowerCase()

  if (origem.includes("sb8") && origem.includes("04") && origem.includes("07")) {
    return "SB8 04/07 - empenho"
  }

  if (origem.includes("sb8")) {
    return "SB8"
  }

  if (origem.includes("d_produtos")) {
    return "Cadastro d_produtos"
  }

  if (item && item["tem_posicao_aging"] === false) {
    return "Sem posição Aging"
  }

  return "Posição estoque"
}

function getSaldoOrigemTitle(item: Record<string, unknown> | null | undefined) {
  const armazens = Array.isArray(item?.["armazens_saldo_origem"]) ? (item?.["armazens_saldo_origem"] as unknown[]).join(", ") : "04, 07"
  const quarentena = String(item?.["armazem_quarentena"] || "98")
  const data = item?.["data_saldo_origem"] ? fmtDate(String(item["data_saldo_origem"])) : "—"
  const origem = getSaldoOrigemLabel(item)

  return `${origem} | Data: ${data} | Armazéns saldo: ${armazens} | Quarentena: ${quarentena}`
}


function addMonths(year: number, month: number, delta: number) {
  const d = new Date(year, month - 1 + delta, 1)
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

function monthKey(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`
}

function monthLabel(ano: number, mes: number) {
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  return `${nomes[mes - 1] || String(mes).padStart(2, "0")}/${String(ano).slice(-2)}`
}

function buildLinhaTempoFallback(item: AgingEstoqueItemDetalhe | null, horizonteFuturo: number) {
  if (!item) return []

  const hoje = new Date()
  const inicio = new Date(2025, 5, 1)
  const fimInfo = addMonths(hoje.getFullYear(), hoje.getMonth() + 1, Math.max(1, horizonteFuturo || 6))
  const fim = new Date(fimInfo.ano, fimInfo.mes - 1, 1)
  const chaveAtual = monthKey(hoje.getFullYear(), hoje.getMonth() + 1)

  const mapa = new Map<string, any>()

  const ensure = (ano: number, mes: number) => {
    const key = monthKey(ano, mes)
    if (!mapa.has(key)) {
      mapa.set(key, {
        ano,
        mes,
        periodo: monthLabel(ano, mes),
        // Não usar 0 como padrão: quando a série não existe naquele período,
        // fica null para o gráfico não desenhar uma linha falsa no zero.
        consumo: null,
        demanda: null,
        forecast: null,
        entradas_previstas: null,
        entradas_detalhe: [],
        faturamento_qtd: null,
        faturamento_valor: null,
        faturamento_detalhe: [],
        estoque_atual: null,
        estoque_mais_pedidos: null,
        estoque_quarentena: null,
        quarentena: null,
        saldo_grafico: null,
        ponto_pedido: null,
        saldo_projetado: null,
        estoque_projetado: null,
      })
    }
    return mapa.get(key)
  }

  for (let d = new Date(inicio); d <= fim; d.setMonth(d.getMonth() + 1)) {
    ensure(d.getFullYear(), d.getMonth() + 1)
  }

  // Estoque atual é uma foto do momento atual.
  // Para PA/MR, ele não pode ficar negativo por projeção.
  // Projeção de saldo só entra nos meses futuros.
  const estoqueAtualReal = getEstoqueAtualReal(item)
  const pedidosAbertos = getPedidosAbertos(item)
  const pontoAtual = ensure(hoje.getFullYear(), hoje.getMonth() + 1)
  pontoAtual.estoque_atual = estoqueAtualReal
  pontoAtual.estoque_mais_pedidos = estoqueAtualReal + pedidosAbertos
  pontoAtual.estoque_quarentena = getAnyNumber(item as Record<string, unknown>, "saldo_quarentena") || getAnyNumber(item as Record<string, unknown>, "quarentena")
  pontoAtual.quarentena = pontoAtual.estoque_quarentena
  pontoAtual.saldo_grafico = estoqueAtualReal
  pontoAtual.ponto_pedido = Number(item.consumo_durante_lt || 0) || null

  // Saldo é uma foto atual. No gráfico mensal, ele só deve aparecer do mês atual para frente.
  // Não usamos estoque médio/fechamento histórico aqui para não dar a impressão de que o saldo atual existia nos meses fechados.

  // Consumo histórico: só aparece nos meses que existem no histórico.
  // Não projetamos consumo para frente com zero, porque isso achata/distorce o gráfico.
  for (const p of item.historico_consumo || []) {
    const ano = Number(p.ano || 0)
    const mes = Number(p.mes || 0)
    if (!ano || !mes) continue
    const keyDate = new Date(ano, mes - 1, 1)
    if (keyDate < inicio || keyDate > fim) continue
    const ponto = ensure(ano, mes)
    ponto.consumo = Number(ponto.consumo || 0) + Number(p.consumo || 0)
  }

  // Demanda/forecast: só faz sentido do mês atual para frente.
  // Se não houver forecast/BOM para o item, a série fica null e não aparece como zero falso.
  for (const p of item.forecast || []) {
    const ano = Number(p.ano || 0)
    const mes = Number(p.mes || 0)
    if (!ano || !mes) continue
    const key = monthKey(ano, mes)
    const keyDate = new Date(ano, mes - 1, 1)
    if (key < chaveAtual || keyDate < inicio || keyDate > fim) continue
    const demanda = Number(p.forecast || 0)
    if (demanda <= 0) continue
    const ponto = ensure(ano, mes)
    ponto.demanda = Number(ponto.demanda || 0) + demanda
    ponto.forecast = Number(ponto.forecast || 0) + demanda
  }

  // Entradas previstas: só aparecem do mês atual para frente e apenas quando houver pedido.
  for (const pedido of item.pedidos || []) {
    const raw = pedido.data_prevista_entrega
    if (!raw) continue
    const d = new Date(String(raw).slice(0, 10) + "T00:00:00")
    if (Number.isNaN(d.getTime()) || d < inicio || d > fim) continue
    const ano = d.getFullYear()
    const mes = d.getMonth() + 1
    const key = monthKey(ano, mes)
    if (key < chaveAtual) continue
    const qtd = Number(pedido.quantidade_pendente || 0)
    if (qtd <= 0) continue
    const ponto = ensure(ano, mes)
    ponto.entradas_previstas = Number(ponto.entradas_previstas || 0) + qtd
    ponto.entradas_detalhe = Array.isArray(ponto.entradas_detalhe) ? ponto.entradas_detalhe : []
    ponto.entradas_detalhe.push({
      quantidade: qtd,
      data_prevista_entrega: pedido.data_prevista_entrega,
      pedido_numero: pedido.pedido_numero,
      sc_numero: pedido.sc_numero,
      fornecedor: pedido.fornecedor,
      comprador: pedido.comprador,
      status_entrega: pedido.status_entrega,
    })
  }

  // Faturamento SD2: sempre linha no gráfico, para PA/MR/PPS quando houver venda.
  const faturamentoSerie = item.faturamento_sd2 || item.serie_operacional || []
  for (const fat of faturamentoSerie) {
    const ano = Number(fat.ano || 0)
    const mes = Number(fat.mes || 0)
    if (!ano || !mes) continue

    const keyDate = new Date(ano, mes - 1, 1)
    if (keyDate < inicio || keyDate > fim) continue

    const qtd = Number(fat.faturamento_qtd || 0)
    const valor = Number(fat.faturamento_valor || 0)

    if (qtd <= 0 && valor <= 0) continue

    const ponto = ensure(ano, mes)
    ponto.faturamento_qtd = Number(ponto.faturamento_qtd || 0) + qtd
    ponto.faturamento_valor = Number(ponto.faturamento_valor || 0) + valor
    ponto.faturamento_detalhe = Array.isArray(ponto.faturamento_detalhe) ? ponto.faturamento_detalhe : []

    if (Array.isArray(fat.faturamento_detalhe) && fat.faturamento_detalhe.length > 0) {
      ponto.faturamento_detalhe.push(...fat.faturamento_detalhe)
    } else {
      ponto.faturamento_detalhe.push({
        data: fat.data_inicio || fat.periodo_completo || fat.periodo,
        codigo: item.codigo,
        quantidade: qtd,
        valor,
      })
    }
  }

  let saldoProjetado = estoqueAtualReal

  return Array.from(mapa.values())
    .sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
    .map((p) => {
      const key = monthKey(p.ano, p.mes)

      if (key > chaveAtual) {
        const demanda = Number(p.demanda || 0)
        p.ponto_pedido = calcularPontoPedidoMensal(item, p.ano, p.mes, demanda)
        saldoProjetado = saldoProjetado + Number(p.entradas_previstas || 0) - demanda
        p.saldo_projetado = saldoProjetado
        p.saldo_grafico = Math.max(0, saldoProjetado)
      } else if (key === chaveAtual) {
        const demanda = Number(p.demanda || 0)
        p.ponto_pedido = calcularPontoPedidoMensal(item, p.ano, p.mes, demanda)
        p.saldo_projetado = null
        p.saldo_grafico = p.saldo_grafico ?? estoqueAtualReal
      } else {
        p.ponto_pedido = (p.ponto_pedido ?? Number(item.consumo_durante_lt || 0)) || null
        p.saldo_projetado = null
      }

      return p
    })
}


function buildSerieOperacionalItemSelecionado(item: AgingEstoqueItemDetalhe | null): BraviSeriePonto[] {
  if (!item) return []

  return buildLinhaTempoFallback(item, 12)
    .map((p: any) => ({
      key: monthKey(Number(p.ano || 0), Number(p.mes || 0)),
      ordem: monthKey(Number(p.ano || 0), Number(p.mes || 0)),
      periodo: p.periodo,
      periodo_completo: p.periodo,
      ano: p.ano,
      mes: p.mes,
      estoque: p.estoque_atual !== null && p.estoque_atual !== undefined ? Math.max(0, Number(p.estoque_atual || 0)) : null,
      estoque_medio: p.estoque_atual !== null && p.estoque_atual !== undefined ? Math.max(0, Number(p.estoque_atual || 0)) : null,
      estoque_projetado: p.saldo_projetado !== null && p.saldo_projetado !== undefined ? Math.max(0, Number(p.saldo_projetado || 0)) : null,
      estoque_quarentena: p.estoque_quarentena ?? p.quarentena ?? null,
      quarentena: p.quarentena ?? p.estoque_quarentena ?? null,
      saldo_quarentena: p.quarentena ?? p.estoque_quarentena ?? null,
      entradas_previstas: p.entradas_previstas ?? null,
      faturamento_qtd: p.faturamento_qtd ?? null,
      faturamento_valor: p.faturamento_valor ?? null,
      consumo: p.consumo ?? null,
      demanda: p.demanda ?? p.forecast ?? null,
      forecast: p.forecast ?? p.demanda ?? null,
      pedidos_detalhe: p.entradas_detalhe || [],
      faturamento_detalhe: p.faturamento_detalhe || [],
    }))
    .filter((p) =>
      p.estoque !== null ||
      p.estoque_projetado !== null ||
      p.estoque_quarentena !== null ||
      p.entradas_previstas !== null ||
      p.faturamento_qtd !== null ||
      p.faturamento_valor !== null ||
      p.consumo !== null ||
      p.demanda !== null
    )
}



const SEMAFORO_LABEL: Record<SemaforoEstoque, string> = {
  VERMELHO: "Crítico",
  AMARELO: "Atenção",
  VERDE: "Ok",
  CINZA: "Sem referência",
}

const SEMAFORO_STYLE: Record<SemaforoEstoque, { bg: string; color: string; border: string; dot: string }> = {
  VERMELHO: { bg: "rgba(220,38,38,0.08)", color: "#B91C1C", border: "rgba(220,38,38,0.24)", dot: "#DC2626" },
  AMARELO: { bg: "rgba(245,158,11,0.12)", color: "#B45309", border: "rgba(245,158,11,0.28)", dot: "#F59E0B" },
  VERDE: { bg: "rgba(22,163,74,0.08)", color: "#15803D", border: "rgba(22,163,74,0.24)", dot: "#16A34A" },
  CINZA: { bg: "rgba(100,116,139,0.10)", color: "#475569", border: "rgba(100,116,139,0.24)", dot: "#94A3B8" },
}

function calcularSemaforoEstoque(item: AgingEstoqueItem | null | undefined): SemaforoEstoque {
  if (!item) return "CINZA"

  const raw = item as AgingEstoqueItem & Record<string, unknown>
  const tipo = String(item.tipo || raw.tipo_produto_erp || "").toUpperCase()

  if (tipo !== "PA" && tipo !== "MR") {
    return calcularSemaforoConsumoInsumo(item)
  }

  const statusVisualBackend = String(raw.status_visual || "").toUpperCase()
  if (["VERMELHO", "AMARELO", "VERDE", "CINZA"].includes(statusVisualBackend)) {
    return statusVisualBackend as SemaforoEstoque
  }

  const status = String(raw.status_estoque || item.status || "").toUpperCase()
  const saldoReal = getEstoqueAtualReal(item)
  const entradasMes = getEntradasMesAtualDashboard(item)
  const estoqueComEntradas = saldoReal + entradasMes
  const demanda = getDemandaStatusDashboard(item)

  if (demanda <= 0 || status === "SEM_CONSUMO" || status === "SEM_GIRO") return "CINZA"
  if (estoqueComEntradas <= 0 || status === "RUPTURA" || status === "CRITICO") return "VERMELHO"
  if (estoqueComEntradas < demanda) return "VERMELHO"
  if (status === "ATENCAO") return "AMARELO"
  if (status === "EXCESSO" || status === "SAUDAVEL") return "VERDE"

  return "VERDE"
}

function SemaforoBadge({ item }: { item: AgingEstoqueItem }) {
  const semaforo = calcularSemaforoEstoque(item)
  const style = SEMAFORO_STYLE[semaforo]
  const saldoReal = getEstoqueAtualReal(item)
  const estoqueComEntradas = saldoReal + getEntradasMesAtualDashboard(item)
  const previsaoMes = getPrevisaoMesAtual(item)
  const consumoMes = getConsumoMesAtual(item)
  const tipo = String(item.tipo || (item as AgingEstoqueItem & Record<string, unknown>).tipo_produto_erp || "").toUpperCase()
  const title = tipo !== "PA" && tipo !== "MR"
    ? `Status: ${SEMAFORO_LABEL[semaforo]} | Consumo mês: ${fmtNumber(consumoMes, 0)} | Previsão mês: ${fmtNumber(previsaoMes, 0)} | Consumo previsto: ${fmtNumber(getPercentualConsumoPrevisto(item), 0)}% | Mês decorrido: ${fmtNumber(getPercentualMesDecorrido(), 0)}%`
    : `Status: ${SEMAFORO_LABEL[semaforo]} | Estoque real: ${fmtNumber(saldoReal, 0)} | Estoque + entradas mês: ${fmtNumber(estoqueComEntradas, 0)} | Demanda ref.: ${fmtNumber(previsaoMes, 0)}`

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
      style={{ background: style.bg, color: style.color, borderColor: style.border }}
      title={title}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: style.dot }} />
      {SEMAFORO_LABEL[semaforo]}
    </span>
  )
}

function daysInMonth(ano: number, mes: number) {
  if (!ano || !mes) return 30
  return new Date(ano, mes, 0).getDate()
}

function calcularPontoPedidoMensal(item: AgingEstoqueItemDetalhe | null, _ano: number, _mes: number, _demanda: number | null | undefined) {
  // Ponto de pedido operacional fixo:
  // quando o saldo disponível/projetado cair abaixo do consumo durante o lead time,
  // a compra deve ser acionada.
  const consumoLt = Number(item?.consumo_durante_lt || 0)
  return consumoLt > 0 ? consumoLt : null
}

function normalizarSaldoDiario(
  ponto: Record<string, unknown>,
  item?: AgingEstoqueItemDetalhe | null,
  usarSaldoOficial = false
) {
  // O saldo oficial da tela é o mesmo da tabela/card.
  // Para histórico diário, usamos o saldo diário quando existir; no último ponto, forçamos o saldo oficial para não divergir do card.
  const saldoHistorico = Number(
    ponto.saldo_normal ??
    ponto.saldo_disponivel ??
    ponto.saldo_atual ??
    ponto.saldo ??
    0
  )

  const saldoOficial = Number(item?.saldo || 0)
  const saldoNormal = usarSaldoOficial && saldoOficial > 0 ? saldoOficial : saldoHistorico

  // Não usar o campo genérico "quarentena", porque em algumas bases ele não representa apenas o armazém 98.
  // Só consideramos quarentena diária quando vier explicitamente como 98.
  const quarentenaHistorica98 = Number(
    ponto.saldo_quarentena_98 ??
    ponto.quarentena_98 ??
    ponto.saldo_98 ??
    ponto.armazem_98 ??
    0
  )

  const quarentenaOficial = Number(
    (item as unknown as Record<string, unknown>)?.saldo_quarentena ??
    (item as unknown as Record<string, unknown>)?.quarentena_98 ??
    0
  )

  const quarentena = usarSaldoOficial ? quarentenaOficial : quarentenaHistorica98

  return { saldoNormal, quarentena }
}

function weekStart(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function buildLinhaTempoDiaria(item: AgingEstoqueItemDetalhe | null) {
  const base = item?.historico_sb8_diario || []
  if (!item || !base.length) return []
  const pontoPedido = Number(item.consumo_durante_lt || 0) || null
  const baseOrdenada = [...base].sort((a, b) => String(a.data).localeCompare(String(b.data)))
  const ultimaData = String(baseOrdenada[baseOrdenada.length - 1]?.data || "").slice(0, 10)

  return baseOrdenada.map((p) => {
    const dataPonto = String(p.data || "").slice(0, 10)
    const usarSaldoOficial = dataPonto === ultimaData
    const { saldoNormal, quarentena } = normalizarSaldoDiario(
      p as unknown as Record<string, unknown>,
      item,
      usarSaldoOficial
    )

    return {
      ano: Number(String(p.data).slice(0, 4)),
      mes: Number(String(p.data).slice(5, 7)),
      periodo: String(p.data).slice(8, 10) + "/" + String(p.data).slice(5, 7),
      periodo_completo: usarSaldoOficial ? `${fmtDate(p.data)} · saldo oficial da tela` : fmtDate(p.data),
      saldo_grafico: saldoNormal,
      estoque_atual: saldoNormal,
      estoque_quarentena: quarentena,
      quarentena,
      entradas_previstas: null,
      consumo: null,
      demanda: null,
      ponto_pedido: pontoPedido,
      saldo_projetado: null,
    }
  })
}

function buildLinhaTempoSemanal(item: AgingEstoqueItemDetalhe | null) {
  const base = item?.historico_sb8_diario || []
  if (!item || !base.length) return []
  const grupos = new Map<string, any>()
  const pontoPedido = Number(item.consumo_durante_lt || 0) || null
  const baseOrdenada = [...base].sort((a, b) => String(a.data).localeCompare(String(b.data)))
  const ultimaData = String(baseOrdenada[baseOrdenada.length - 1]?.data || "").slice(0, 10)

  for (const p of baseOrdenada) {
    const dataPonto = String(p.data || "").slice(0, 10)
    const d = new Date(`${dataPonto}T00:00:00`)
    if (Number.isNaN(d.getTime())) continue
    const inicio = weekStart(d)
    const key = inicio.toISOString().slice(0, 10)
    const usarSaldoOficial = dataPonto === ultimaData
    const { saldoNormal, quarentena } = normalizarSaldoDiario(
      p as unknown as Record<string, unknown>,
      item,
      usarSaldoOficial
    )

    grupos.set(key, {
      ano: inicio.getFullYear(),
      mes: inicio.getMonth() + 1,
      periodo: `Sem. ${String(inicio.getDate()).padStart(2, "0")}/${String(inicio.getMonth() + 1).padStart(2, "0")}`,
      periodo_completo: usarSaldoOficial ? `Semana de ${fmtDate(key)} · saldo oficial da tela` : `Semana de ${fmtDate(key)}`,
      saldo_grafico: saldoNormal,
      estoque_atual: saldoNormal,
      estoque_quarentena: quarentena,
      quarentena,
      entradas_previstas: null,
      consumo: null,
      demanda: null,
      ponto_pedido: pontoPedido,
      saldo_projetado: null,
    })
  }

  return Array.from(grupos.values()).sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes) || String(a.periodo).localeCompare(String(b.periodo)))
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.SEM_GIRO
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function SortableTh({ label, column, sortKey, sortDirection, onSort }: { label: string; column: SortKey; sortKey: SortKey | null; sortDirection: SortDirection; onSort: (column: SortKey) => void }) {
  const active = sortKey === column
  const arrow = active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"
  return (
    <th className="min-w-[82px] px-2 py-2 text-right align-middle">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex w-full items-center justify-end gap-1 rounded-md text-right text-[10px] font-bold leading-tight text-white/95 transition hover:text-white"
        title={`Ordenar por ${label}`}
      >
        <span className="max-w-[72px] whitespace-normal">{label}</span>
        <span className={active ? "text-white" : "text-white/55"}>{arrow}</span>
      </button>
    </th>
  )
}

function KpiCard({
  label,
  value,
  helper,
  details,
  icon,
  tone = "default",
  onClick,
  active = false,
}: {
  label: string
  value: string
  helper?: string
  details?: { label: string; value: string; tone?: "default" | "danger" | "warning" | "success" | "blue" }[]
  icon: ReactNode
  tone?: "default" | "danger" | "warning" | "success" | "blue"
  onClick?: () => void
  active?: boolean
}) {
  const tones = {
    default: { bg: "rgba(15,23,42,0.04)", color: "var(--text-primary)" },
    danger: { bg: "rgba(220,38,38,0.08)", color: "#B91C1C" },
    warning: { bg: "rgba(245,158,11,0.10)", color: "#B45309" },
    success: { bg: "rgba(22,163,74,0.08)", color: "#15803D" },
    blue: { bg: "rgba(37,99,235,0.08)", color: "#1D4ED8" },
  }

  const content = (
    <div className="flex min-h-[82px] items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
        {helper && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{helper}</p>}
        {details?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {details.map((detail) => {
              const detailTone = detail.tone || "default"
              return (
                <span
                  key={`${detail.label}-${detail.value}`}
                  className="rounded-full px-2 py-1 text-[11px] font-bold"
                  style={{ background: tones[detailTone].bg, color: tones[detailTone].color }}
                >
                  {detail.label}: {detail.value}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: tones[tone].bg, color: tones[tone].color }}>{icon}</div>
    </div>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${active ? "ring-2" : ""}`}
        style={{ boxShadow: active ? "0 0 0 2px #163B63" : undefined }}
      >
        {content}
      </button>
    )
  }

  return <div className="card p-4">{content}</div>
}

function KpiSmall({
  label,
  value,
  onClick,
  active = false,
}: {
  label: string
  value: string
  onClick?: () => void
  active?: boolean
}) {
  const content = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </>
  )

  const style = {
    borderColor: active ? "#163B63" : "var(--border)",
    background: active ? "rgba(22,59,99,0.06)" : "var(--bg-primary)",
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm"
        style={style}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border p-3" style={style}>
      {content}
    </div>
  )
}


function VisaoEstoqueTabs({
  value,
  onChange,
}: {
  value: VisaoEstoque
  onChange: (value: VisaoEstoque) => void
}) {
  const tabs: { key: VisaoEstoque; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "gestao", label: "Gestão de Estoque" },
  ]

  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl border bg-white p-1 shadow-sm" style={{ borderColor: "var(--border)" }}>
      {tabs.map((tab) => {
        const active = value === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="rounded-xl px-4 py-2 text-sm font-bold transition"
            style={{
              background: active ? "#163B63" : "transparent",
              color: active ? "#FFFFFF" : "var(--text-secondary)",
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function statusLabelDashboard(label: string) {
  const texto = String(label || "A classificar").trim()
  if (!texto) return "A classificar"
  if (texto.length <= 26) return texto
  return `${texto.slice(0, 24)}...`
}

function normalizarFaixaCobertura(label: string) {
  const texto = String(label || "").trim()
  const mapa: Record<string, string> = {
    "0-30 dias": "0 a 1 mês",
    "31-45 dias": "1 a 1,5 mês",
    "31-60 dias": "1 a 1,5 mês",
    "46-90 dias": "1,5 a 3 meses",
    "61-90 dias": "1,5 a 3 meses",
    ">90 dias": "Excesso > 3 meses",
    "> 3 meses": "Excesso > 3 meses",
    "Sem consumo": "Sem consumo",
  }
  return mapa[texto] || texto || "Sem faixa"
}


type QuadranteMatrizKey = "EXCESSO_PARADO" | "EXCESSO_COM_GIRO" | "BAIXO_GIRO_CONTROLADO" | "RISCO_FALTA"

type MatrixPoint = {
  codigo: string
  produto: string
  linha: string
  tipo?: string | null
  x: number
  y: number
  z: number
  giro: number
  cobertura: number
  estoque: number
  valor: number
  entradas: number
  demanda: number
  semaforo: SemaforoEstoque
  quadrante: QuadranteMatrizKey
  raw: AgingEstoqueItem
}

const MATRIZ_QUADRANTES: Record<QuadranteMatrizKey, { titulo: string; subtitulo: string; acao: string; color: string; bg: string; border: string }> = {
  EXCESSO_PARADO: {
    titulo: "Excesso parado",
    subtitulo: "Estoque real alto com baixo giro",
    acao: "Evitar compra, avaliar validade, troca, devolução ou descontinuação.",
    color: "#B91C1C",
    bg: "rgba(220,38,38,0.06)",
    border: "rgba(220,38,38,0.22)",
  },
  EXCESSO_COM_GIRO: {
    titulo: "Excesso com giro",
    subtitulo: "Estoque real alto, apesar de venda/consumo",
    acao: "Reduzir próxima compra, revisar MOQ e negociar entrega parcelada.",
    color: "#D97706",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.28)",
  },
  BAIXO_GIRO_CONTROLADO: {
    titulo: "Baixo giro controlado",
    subtitulo: "Baixa demanda e cobertura controlada",
    acao: "Monitorar e evitar reposição automática sem demanda confirmada.",
    color: "#64748B",
    bg: "rgba(100,116,139,0.08)",
    border: "rgba(100,116,139,0.22)",
  },
  RISCO_FALTA: {
    titulo: "Risco de falta",
    subtitulo: "Alto giro e baixa cobertura",
    acao: "Priorizar compra, liberação, transferência ou acompanhamento de lead time.",
    color: "#0F5E7C",
    bg: "rgba(14,116,144,0.08)",
    border: "rgba(14,116,144,0.24)",
  },
}

function percentile(values: number[], p: number) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return 0
  const idx = Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * p)))
  return nums[idx]
}

function getGiroMatriz(item: AgingEstoqueItem) {
  // Giro/demanda da matriz precisa seguir a mesma régua do status:
  // demanda do mês atual; se zerada, média de venda/consumo real dos últimos 6 meses.
  return Math.max(0, getDemandaStatusDashboard(item))
}

function getCoberturaMatriz(item: AgingEstoqueItem) {
  const candidatos = [
    getNum(item, "cobertura_meses_status"),
    getNum(item, "cobertura_meses_atual"),
    getNum(item, "cobertura_status_dias") / 30,
    getNum(item, "cobertura_dias") / 30,
    getNum(item, "dias_em_estoque") / 30,
  ]

  for (const valor of candidatos) {
    if (Number.isFinite(valor) && valor > 0) return valor
  }

  return getCoberturaStatusDashboard(item)
}

function getDemandaTotalOperacionalDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return 0

  // Para status, matriz e faixas, a referência é operacional do mês atual:
  // demanda/forecast do mês; se zerado, média de venda/consumo real dos últimos 6 meses.
  return getDemandaStatusDashboard(item)
}

function itemTemConsumoOuDemandaDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return false

  // Sem consumo só quando demanda do mês atual = 0 E venda/consumo dos últimos 6 meses = 0.
  return getDemandaMesAtualStatusDashboard(item) > 0.0001 || getMovimentoSeisMesesStatusDashboard(item) > 0.0001
}

function getFaixaCoberturaOperacionalDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item || !itemTemConsumoOuDemandaDashboard(item)) return "Sem consumo"

  const cobertura = getCoberturaMatriz(item)
  if (cobertura < 1) return "0 a 1 mês"
  if (cobertura < 1.5) return "1 a 1,5 mês"
  if (cobertura <= 3) return "1,5 a 3 meses"
  return "Excesso > 3 meses"
}

function getValorEstoqueMatriz(item: AgingEstoqueItem) {
  return Math.max(
    getNum(item, "estoque_atual_valor"),
    getNum(item, "estoque_mais_pedidos_valor"),
    getEstoqueAtualReal(item) * getNum(item, "custo_unitario"),
  )
}
function getTipoDashboardItem(item: AgingEstoqueItem | null | undefined) {
  if (!item) return ""
  return String((item as any).tipo || (item as any).tipo_produto_erp || "").trim().toUpperCase()
}

function getLinhaDashboardItem(item: AgingEstoqueItem | null | undefined) {
  if (!item) return "A classificar"
  return String((item as any).tipo_negocio || (item as any).grupo_gerencial || "A classificar").trim() || "A classificar"
}

function itemEhProdutoDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return false

  const raw = item as any
  const tipo = getTipoDashboardItem(item)

  // Se o código aparece como componente da BOM, ele deve cair como insumo,
  // mesmo quando herda uma linha gerencial de PA pela classificação.
  if (raw.eh_componente_bom === true) return false

  if (["PA", "MR", "PPS", "PV", "PA/MR"].includes(tipo)) return true
  if (["MP", "ME", "MI", "PI", "MP/ME"].includes(tipo)) return false

  const origemLinha = String(raw.origem_linha_estoque || "").trim()
  const origemClassificacao = String(raw.origem_classificacao || "").trim()
  const transferenciaBravi = String(raw.transferencia_bravi || "").trim() === "Sim"

  if (origemLinha === "d_produtos_sem_snapshot_aging") return true
  if (transferenciaBravi) return true

  const tipoNegocio = String(raw.tipo_negocio || "").trim()
  const macroNegocio = String(raw.macro_negocio || "").trim()
  const grupoGerencial = String(raw.grupo_gerencial || "").trim()
  const linhasComerciais = new Set(["Anestésicos Injetáveis", "Benzotop", "PPS"])

  if (origemClassificacao === "DIMENSAO") {
    if (linhasComerciais.has(tipoNegocio) || linhasComerciais.has(macroNegocio)) return true
    if ([
      "Anestésicos Injetáveis",
      "Benzotop",
      "PPS - Ativo terceirizado/revenda",
      "PPS - Descontinuado",
      "PPS - Transferência Bravi",
    ].includes(grupoGerencial)) return true
    if (getNum(item, "demanda_direta_mes_atual") > 0) return true
    if (getNum(item, "faturamento_ytd_qtd") > 0) return true
  }

  return false
}

function itemEhInsumoDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return false

  const raw = item as any
  const tipo = getTipoDashboardItem(item)

  if (raw.eh_componente_bom === true) return true
  if (itemEhProdutoDashboard(item)) return false
  if (["MP", "ME", "MI", "PI", "MP/ME"].includes(tipo)) return true
  if (String(raw.origem_classificacao || "").trim() === "BOM") return true
  if (getNum(item, "demanda_bom_mes_atual") > 0) return true

  // Fallback conservador para linha real do Aging sem sinal comercial direto.
  if (raw.tem_posicao_aging && String(raw.origem_classificacao || "").trim() !== "DIMENSAO") return true

  return false
}

function filtrarItensPorEscopoDashboard(itens: AgingEstoqueItem[], escopo: EscopoEstoque) {
  if (escopo === "produtos") return (itens || []).filter(itemEhProdutoDashboard)
  if (escopo === "insumos") return (itens || []).filter(itemEhInsumoDashboard)
  return itens || []
}


function montarPontosMatrizEstoque(itens: AgingEstoqueItem[]) {
  const base = (itens || []).filter((item) => String(item?.codigo || "").trim())
  const giros = base.map(getGiroMatriz).filter((v) => v > 0)
  const corteGiro = Math.max(1, percentile(giros, 0.65))
  const corteCobertura = 3

  const maxGiroBruto = Math.max(corteGiro * 1.8, percentile(giros, 0.95), 1)
  const coberturas = base.map(getCoberturaMatriz).filter((v) => v > 0)
  const maxCoberturaBruto = Math.max(corteCobertura * 1.5, percentile(coberturas, 0.95), 1)
  const valores = base.map(getValorEstoqueMatriz).filter((v) => v > 0)
  const maxValor = Math.max(percentile(valores, 0.95), Math.max(...valores, 0), 1)

  const maxGiroVisual = Math.max(corteGiro * 1.25, percentile(giros, 0.9), 1)
  const maxCoberturaVisual = Math.max(corteCobertura * 2.5, percentile(coberturas, 0.9), 6)

  const pontos: MatrixPoint[] = base.map((item) => {
    const giro = getGiroMatriz(item)
    const cobertura = getCoberturaMatriz(item)
    const valor = getValorEstoqueMatriz(item)
    const estoque = getEstoqueAtualReal(item)
    const entradas = getEntradasMesAtualDashboard(item)
    const demanda = getDemandaTotalOperacionalDashboard(item)
    const linha = String((item as any).tipo_negocio || (item as any).grupo_gerencial || "A classificar")
    const semaforo = calcularSemaforoEstoque(item)
    const faixaCobertura = getFaixaCoberturaOperacionalDashboard(item)

    let quadrante: QuadranteMatrizKey = "BAIXO_GIRO_CONTROLADO"

    if (faixaCobertura === "Excesso > 3 meses") {
      quadrante = giro >= corteGiro ? "EXCESSO_COM_GIRO" : "EXCESSO_PARADO"
    } else if (faixaCobertura !== "Sem consumo" && giro >= corteGiro && cobertura < corteCobertura) {
      quadrante = "RISCO_FALTA"
    }

    const x = Math.min(giro, maxGiroBruto)
    const y = Math.min(cobertura, maxCoberturaBruto)
    const z = Math.max(20, Math.min(520, 24 + (valor / maxValor) * 496))

    return {
      codigo: String(item.codigo || ""),
      produto: String((item as any).produto || (item as any).descricao || ""),
      linha,
      tipo: String((item as any).tipo || (item as any).tipo_produto_erp || ""),
      x,
      y,
      z,
      giro,
      cobertura,
      estoque,
      valor,
      entradas,
      demanda,
      semaforo,
      quadrante,
      raw: item,
    }
  })

  const resumo = (Object.keys(MATRIZ_QUADRANTES) as QuadranteMatrizKey[]).reduce((acc, key) => {
    const subset = pontos.filter((ponto) => ponto.quadrante === key)
    acc[key] = {
      skus: subset.length,
      estoque: subset.reduce((sum, ponto) => sum + ponto.estoque, 0),
      valor: subset.reduce((sum, ponto) => sum + ponto.valor, 0),
      entradas: subset.reduce((sum, ponto) => sum + ponto.entradas, 0),
      demanda: subset.reduce((sum, ponto) => sum + ponto.demanda, 0),
    }
    return acc
  }, {} as Record<QuadranteMatrizKey, { skus: number; estoque: number; valor: number; entradas: number; demanda: number }>)

  return {
    pontos,
    resumo,
    corteGiro,
    corteCobertura,
    maxGiro: maxGiroVisual,
    maxCobertura: maxCoberturaVisual,
  }
}

function MatrixTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const ponto = payload[0]?.payload as MatrixPoint | undefined
  if (!ponto) return null
  const quadrante = MATRIZ_QUADRANTES[ponto.quadrante]

  return (
    <div className="max-w-[360px] rounded-2xl border bg-white p-3 text-xs shadow-xl" style={{ borderColor: "var(--border)" }}>
      <p className="font-bold" style={{ color: "var(--text-primary)" }}>{ponto.codigo} · {ponto.produto || "Item"}</p>
      <p className="mt-1" style={{ color: "var(--text-secondary)" }}>{ponto.linha} · {quadrante.titulo}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div><span style={{ color: "var(--text-secondary)" }}>Giro/demanda</span><p className="font-bold">{fmtNumber(ponto.giro, 0)}</p></div>
        <div><span style={{ color: "var(--text-secondary)" }}>Cobertura</span><p className="font-bold">{fmtNumber(ponto.cobertura, 1)} m</p></div>
        <div><span style={{ color: "var(--text-secondary)" }}>Estoque</span><p className="font-bold">{fmtNumber(ponto.estoque, 0)}</p></div>
        <div><span style={{ color: "var(--text-secondary)" }}>Valor</span><p className="font-bold">{fmtCurrency(ponto.valor, 0)}</p></div>
      </div>
      <p className="mt-3 rounded-xl px-2 py-1.5 font-semibold" style={{ background: quadrante.bg, color: quadrante.color }}>{quadrante.acao}</p>
    </div>
  )
}


type CategoriaStatusDashboard = "criticos" | "excesso" | "semGiro" | "atencao" | "ok"

type DashboardDrilldownState = {
  titulo: string
  subtitulo?: string
  acao?: string
  itens: AgingEstoqueItem[]
  accentColor?: string
}

function itemEhBraviDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return false
  const raw = item as any
  const status = String(raw.status_estoque || raw.status || "").trim().toUpperCase()
  return String(raw.transferencia_bravi || "").trim() === "Sim" || status === "TRANSFERENCIA_BRAVI"
}

function itemEhDescontinuadoDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return false
  const raw = item as any
  const status = String(raw.status_estoque || raw.status || "").trim().toUpperCase()
  const statusPortfolio = String(raw.status_portfolio || "").trim().toUpperCase()
  return status === "DESCONTINUADO_COM_SALDO" || statusPortfolio.includes("DESCONT")
}

function itemPertenceLinhaDashboard(item: AgingEstoqueItem | null | undefined, linhaOriginal?: string) {
  if (!item || !linhaOriginal || linhaOriginal === "TODAS") return true
  if (linhaOriginal === "Bravi") return itemEhBraviDashboard(item)
  return getLinhaDashboardItem(item) === linhaOriginal
}

function itemSemGiroOperacionalDashboard(item: AgingEstoqueItem | null | undefined) {
  return !itemTemConsumoOuDemandaDashboard(item)
}

function getCategoriaStatusDashboard(item: AgingEstoqueItem | null | undefined): CategoriaStatusDashboard {
  if (!item) return "ok"

  const raw = item as any
  const status = String(raw.status_estoque || raw.status || "").trim().toUpperCase()
  const semaforo = calcularSemaforoEstoque(item)
  const faixaCobertura = getFaixaCoberturaOperacionalDashboard(item)
  const ehSemConsumo = faixaCobertura === "Sem consumo"
  const ehExcesso = faixaCobertura === "Excesso > 3 meses"
  const ehCritico = !ehSemConsumo && !ehExcesso && (semaforo === "VERMELHO" || status === "RUPTURA" || status === "CRITICO")
  const ehAtencao = !ehSemConsumo && !ehCritico && !ehExcesso && (semaforo === "AMARELO" || status === "ATENCAO")

  if (ehCritico) return "criticos"
  if (ehExcesso) return "excesso"
  if (ehSemConsumo) return "semGiro"
  if (ehAtencao) return "atencao"
  return "ok"
}


const STATUS_DASHBOARD_META: Record<CategoriaStatusDashboard, { label: string; color: string; bg: string }> = {
  criticos: { label: "Críticos", color: "#DC2626", bg: "rgba(220,38,38,0.10)" },
  excesso: { label: "Excesso", color: "#2563EB", bg: "rgba(37,99,235,0.10)" },
  semGiro: { label: "Sem consumo", color: "#64748B", bg: "rgba(148,163,184,0.18)" },
  atencao: { label: "Atenção", color: "#D97706", bg: "rgba(217,119,6,0.10)" },
  ok: { label: "Ok/outros", color: "#15803D", bg: "rgba(21,128,61,0.10)" },
}

function StatusLinhaDashboardTooltip({
  active,
  payload,
  itensBase,
}: {
  active?: boolean
  payload?: any[]
  itensBase: AgingEstoqueItem[]
}) {
  if (!active || !payload?.length) return null

  const ponto = payload[0]?.payload as any
  if (!ponto) return null

  const linhaOriginal = String(ponto.linhaOriginal || ponto.linha || "A classificar")
  const categoriaHover = String(payload[0]?.dataKey || "").trim() as CategoriaStatusDashboard | ""
  const categoriaValida = ["criticos", "excesso", "semGiro", "atencao", "ok"].includes(categoriaHover)
    ? (categoriaHover as CategoriaStatusDashboard)
    : null

  const itensLinha = (itensBase || []).filter((item) => itemPertenceLinhaDashboard(item, linhaOriginal))
  const itensTooltip = categoriaValida
    ? itensLinha.filter((item) => getCategoriaStatusDashboard(item) === categoriaValida)
    : itensLinha

  const meta = categoriaValida ? STATUS_DASHBOARD_META[categoriaValida] : null
  const itensOrdenados = [...itensTooltip].sort((a, b) => {
    const statusDiff = getCategoriaStatusDashboard(a).localeCompare(getCategoriaStatusDashboard(b))
    if (statusDiff !== 0 && categoriaValida === null) return statusDiff
    const demandaDiff = getTotalForecastDashboard(b) - getTotalForecastDashboard(a)
    if (Math.abs(demandaDiff) > 0.0001) return demandaDiff
    const estoqueDiff = getEstoqueAtualReal(b) - getEstoqueAtualReal(a)
    if (Math.abs(estoqueDiff) > 0.0001) return estoqueDiff
    return String((a as any).produto || "").localeCompare(String((b as any).produto || ""), "pt-BR")
  })
  const preview = itensOrdenados.slice(0, 3)
  const totalEstoque = itensTooltip.reduce((sum, item) => sum + getEstoqueAtualReal(item), 0)
  const totalEntradas = itensTooltip.reduce((sum, item) => sum + getEntradasMesAtualDashboard(item), 0)
  const total6m = itensTooltip.reduce((sum, item) => sum + getTotalSeisMesesDashboard(item), 0)
  const totalForecast = itensTooltip.reduce((sum, item) => sum + getDemandaTotalOperacionalDashboard(item), 0)
  const coberturaAgregada = totalForecast > 0 ? (totalEstoque + totalEntradas) / totalForecast : 0

  return (
    <div className="max-h-[78vh] w-[min(1040px,92vw)] overflow-y-auto rounded-3xl border bg-white p-5 shadow-2xl" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Prévia do recorte</p>
          <p className="mt-1 text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {categoriaValida ? `${linhaOriginal} · ${meta?.label}` : linhaOriginal}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {fmtNumber(itensTooltip.length)} SKU(s). Clique na barra para abrir a análise completa em tela grande.
          </p>
        </div>
        {meta && (
          <span className="rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: meta.bg, color: meta.color }}>
            {meta.label}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>SKUs</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNumber(itensTooltip.length)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Estoque</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtQtdEstoque(totalEstoque)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Entradas mês</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtQtdEstoque(totalEntradas)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Venda/cons. 6M</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtQtdInteira(total6m)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Forecast/demanda</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtQtdInteira(totalForecast)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Cobertura</p>
          <p className="mt-1 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{totalForecast > 0 ? `${fmtNumber(coberturaAgregada, 1)} m` : 'Sem consumo'}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'rgba(124,58,237,0.24)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: '#6D28D9' }}>Bravi</p>
          <p className="mt-1 text-lg font-bold" style={{ color: '#6D28D9' }}>{fmtNumber(itensTooltip.filter(itemEhBraviDashboard).length)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-3" style={{ borderColor: 'rgba(217,119,6,0.24)' }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: '#B45309' }}>Descont.</p>
          <p className="mt-1 text-lg font-bold" style={{ color: '#B45309' }}>{fmtNumber(itensTooltip.filter(itemEhDescontinuadoDashboard).length)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3">
        {preview.map((item) => {
          const raw = item as any
          const codigo = String(raw.codigo || raw.cod_produto || '')
          const descricao = String(raw.produto || raw.descricao || raw.desc_produto || 'Item')
          const categoriaItem = getCategoriaStatusDashboard(item)
          const metaItem = STATUS_DASHBOARD_META[categoriaItem]
          const estoque = getEstoqueAtualReal(item)
          const entradas = getEntradasMesAtualDashboard(item)
          const quarentena = getQuarentenaAtualReal(item)
          const demandaAtual = getDemandaTotalOperacionalDashboard(item)
          const cobertura = getCoberturaMatriz(item)
          const historico = getHistoricoSeisMesesDashboard(item)
          const forecast = getForecastSeisMesesDashboard(item)

          return (
            <div key={`${codigo}-${descricao}`} className="rounded-3xl border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{codigo || '—'} · {descricao}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{getLinhaDashboardItem(item)} · {String(raw.tipo || raw.tipo_produto_erp || '')}</p>
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: metaItem.bg, color: metaItem.color }}>{metaItem.label}</span>
              </div>

              <div className="mt-3 grid grid-cols-5 gap-2">
                <div className="rounded-2xl border p-2" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Estoque</p>
                  <p className="mt-1 text-xs font-bold">{fmtQtdEstoque(estoque)}</p>
                </div>
                <div className="rounded-2xl border p-2" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Entr. mês</p>
                  <p className="mt-1 text-xs font-bold">{fmtQtdEstoque(entradas)}</p>
                </div>
                <div className="rounded-2xl border p-2" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Quar.</p>
                  <p className="mt-1 text-xs font-bold">{fmtQtdEstoque(quarentena)}</p>
                </div>
                <div className="rounded-2xl border p-2" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Demanda</p>
                  <p className="mt-1 text-xs font-bold">{fmtQtdInteira(demandaAtual)}</p>
                </div>
                <div className="rounded-2xl border p-2" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Cob.</p>
                  <p className="mt-1 text-xs font-bold">{itemTemConsumoOuDemandaDashboard(item) ? `${fmtNumber(cobertura, 1)} m` : 'Sem consumo'}</p>
                </div>
              </div>

              <div className="mt-3">
                <MiniSerieEstoqueConsumoForecastDashboard item={item} />
              </div>

              <div className="mt-3 rounded-2xl border px-3 py-2" style={{ borderColor: metaItem.color, background: metaItem.bg }}>
                <p className="text-[11px] font-bold" style={{ color: metaItem.color }}>Motivo</p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-primary)' }}>{getMotivoStatusDashboard(item)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {itensOrdenados.length > preview.length && (
        <p className="mt-3 rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'rgba(248,250,252,0.9)' }}>
          Mostrando os 3 primeiros SKUs. Clique na barra para abrir todos os {fmtNumber(itensOrdenados.length)} SKUs em tela grande.
        </p>
      )}
    </div>
  )
}

function getDemandaReferenciaCobertura(item: AgingEstoqueItem | null | undefined) {
  if (!item) return 0
  const raw = item as any

  const serie = Array.isArray(raw.forecast_futuro)
    ? raw.forecast_futuro
    : Array.isArray(raw.forecast)
      ? raw.forecast
      : []

  const pontos = serie
    .map((ponto: any) => ({
      ano: Number(ponto?.ano || 0),
      mes: Number(ponto?.mes || 0),
      valor: toNumberSafe(ponto?.forecast ?? ponto?.demanda ?? ponto?.qtd_forecast ?? 0, 0),
    }))
    .filter((ponto: { ano: number; mes: number; valor: number }) => ponto.ano > 0 && ponto.mes > 0 && ponto.valor > 0)
    .sort((a: { ano: number; mes: number }, b: { ano: number; mes: number }) => a.ano - b.ano || a.mes - b.mes)

  if (pontos.length) return pontos[0].valor

  return Math.max(
    getNum(item, "demanda_mes_atual"),
    getNum(item, "previsao_mes_atual"),
    getNum(item, "demanda_bom_mes_atual"),
    getNum(item, "demanda_direta_mes_atual"),
    getNum(item, "maior_media"),
  )
}

function CoberturaFaixaTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null

  const ponto = payload[0]?.payload as any
  if (!ponto) return null

  const itens = Array.isArray(ponto.itens_lista) ? ponto.itens_lista as AgingEstoqueItem[] : []
  const preview = itens.slice(0, 8)

  return (
    <div className="w-[min(560px,92vw)] rounded-2xl border bg-white p-4 shadow-2xl" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Faixa de cobertura</p>
          <p className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>{ponto.faixa || "Sem faixa"}</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: "rgba(22,59,99,0.08)", color: "#163B63" }}>
          {fmtNumber(Number(ponto.itens || 0))} SKU(s)
        </span>
      </div>

      {preview.length > 0 ? (
        <div className="mt-3 space-y-2">
          {preview.map((item) => {
            const raw = item as any
            const codigo = String(raw.codigo || raw.cod_produto || "")
            const produto = String(raw.produto || raw.desc_produto || raw.descricao || "Item")
            const estoque = getEstoqueAtualReal(item)
            const entradas = getPedidosAbertos(item)
            const demanda = getDemandaReferenciaCobertura(item)
            const cobertura = getCoberturaMatriz(item)
            const metodo = String(raw.metodo_cobertura || "").replace(/_/g, " ")

            return (
              <div key={`${codigo}-${produto}`} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)", background: "rgba(248,250,252,0.9)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold" style={{ color: "var(--text-primary)" }}>{codigo || "—"} · {produto}</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-secondary)" }}>{metodo || "forecast acumulado"}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold" style={{ color: "#163B63" }}>{cobertura > 0 ? `${fmtNumber(cobertura, 1)} m` : "0 m"}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  <div><span style={{ color: "var(--text-secondary)" }}>Estoque</span><p className="font-bold">{fmtQtdEstoque(estoque)}</p></div>
                  <div><span style={{ color: "var(--text-secondary)" }}>Entradas</span><p className="font-bold">{fmtQtdEstoque(entradas)}</p></div>
                  <div><span style={{ color: "var(--text-secondary)" }}>Forecast base</span><p className="font-bold">{fmtQtdInteira(demanda)}</p></div>
                </div>
              </div>
            )
          })}
          {itens.length > preview.length && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Mostrando 8 de {fmtNumber(itens.length)} SKU(s). Clique na barra para abrir a lista completa.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "rgba(248,250,252,0.9)" }}>
          Sem itens carregados para detalhar nesta faixa.
        </p>
      )}
    </div>
  )
}

function getUltimosMesesDashboard(qtdMeses = 6) {
  const hoje = new Date()
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const meses: { ano: number; mes: number; label: string; key: string }[] = []

  for (let i = qtdMeses - 1; i >= 0; i -= 1) {
    const data = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const ano = data.getFullYear()
    const mes = data.getMonth() + 1
    meses.push({ ano, mes, label: monthLabel(ano, mes).split("/")[0].toUpperCase(), key: monthKey(ano, mes) })
  }

  return meses
}

function getHistoricoSeisMesesDashboard(item: AgingEstoqueItem | null | undefined) {
  const meses = getUltimosMesesDashboard(6)
  const mapa = new Map<string, number>(meses.map((mes) => [mes.key, 0]))
  const raw = (item || {}) as any

  const serieFaturamento = Array.isArray(raw.historico_6m)
    ? raw.historico_6m
    : Array.isArray(raw.faturamento_sd2)
      ? raw.faturamento_sd2
      : Array.isArray(raw.serie_operacional)
        ? raw.serie_operacional
        : []

  if (serieFaturamento.length) {
    for (const ponto of serieFaturamento) {
      const ano = Number(ponto?.ano || 0)
      const mes = Number(ponto?.mes || 0)
      if (!ano || !mes) continue
      const key = monthKey(ano, mes)
      if (!mapa.has(key)) continue
      const qtd = Number(ponto?.faturamento_qtd ?? ponto?.consumo ?? ponto?.demanda ?? 0)
      mapa.set(key, (mapa.get(key) || 0) + (Number.isFinite(qtd) ? qtd : 0))
    }
  }

  const historicoConsumo = Array.isArray(raw.historico_consumo) ? raw.historico_consumo : []
  if (!serieFaturamento.length && historicoConsumo.length) {
    for (const ponto of historicoConsumo) {
      const ano = Number(ponto?.ano || 0)
      const mes = Number(ponto?.mes || 0)
      if (!ano || !mes) continue
      const key = monthKey(ano, mes)
      if (!mapa.has(key)) continue
      const qtd = Number(ponto?.consumo || 0)
      mapa.set(key, (mapa.get(key) || 0) + (Number.isFinite(qtd) ? qtd : 0))
    }
  }

  const linhaTempo = Array.isArray(raw.linha_tempo_estoque) ? raw.linha_tempo_estoque : []
  if (!serieFaturamento.length && !historicoConsumo.length && linhaTempo.length) {
    for (const ponto of linhaTempo) {
      const ano = Number(ponto?.ano || 0)
      const mes = Number(ponto?.mes || 0)
      if (!ano || !mes) continue
      const key = monthKey(ano, mes)
      if (!mapa.has(key)) continue
      const qtd = Number(ponto?.consumo ?? ponto?.faturamento_qtd ?? ponto?.demanda ?? ponto?.forecast ?? 0)
      mapa.set(key, (mapa.get(key) || 0) + (Number.isFinite(qtd) ? qtd : 0))
    }
  }

  return meses.map((mes) => ({ ...mes, valor: mapa.get(mes.key) || 0 }))
}

function getTotalSeisMesesDashboard(item: AgingEstoqueItem | null | undefined) {
  return getHistoricoSeisMesesDashboard(item).reduce((sum, ponto) => sum + Number(ponto.valor || 0), 0)
}

function MiniHistoricoDashboard({ item }: { item: AgingEstoqueItem }) {
  const historico = getHistoricoSeisMesesDashboard(item)
  const max = Math.max(...historico.map((ponto) => Number(ponto.valor || 0)), 1)

  return (
    <div className="min-w-[250px] rounded-xl border bg-slate-50 px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <div className="flex h-[72px] items-end gap-2">
        {historico.map((ponto) => {
          const valor = Number(ponto.valor || 0)
          const altura = valor > 0 ? Math.max(8, (valor / max) * 42) : 2
          return (
            <div key={ponto.key} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{valor > 0 ? fmtCompact(valor) : "0"}</span>
              <span className="w-full max-w-[22px] rounded-t-md" style={{ height: `${altura}px`, background: valor > 0 ? "#1F5C7A" : "#CBD5E1" }} />
              <span className="text-[9px] font-semibold" style={{ color: "var(--text-secondary)" }}>{ponto.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function getProximosMesesDashboard(qtdMeses = 6) {
  const hoje = new Date()
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const meses: { ano: number; mes: number; label: string; key: string }[] = []

  for (let i = 0; i < qtdMeses; i += 1) {
    const data = new Date(base.getFullYear(), base.getMonth() + i, 1)
    const ano = data.getFullYear()
    const mes = data.getMonth() + 1
    meses.push({ ano, mes, label: monthLabel(ano, mes).split("/")[0].toUpperCase(), key: monthKey(ano, mes) })
  }

  return meses
}

function getForecastSeisMesesDashboard(item: AgingEstoqueItem | null | undefined) {
  const raw = (item || {}) as any
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth() + 1
  const keyAtual = monthKey(anoAtual, mesAtual)
  const valoresPorMes = new Map<string, { ano: number; mes: number; valor: number }>()

  const aplicarPontos = (pontos: any[], camposValor: string[]) => {
    for (const ponto of pontos || []) {
      const ano = Number(ponto?.ano || 0)
      const mes = Number(ponto?.mes || 0)
      if (!ano || !mes) continue

      const key = monthKey(ano, mes)
      if (key < keyAtual) continue

      let valor = 0
      for (const campo of camposValor) {
        valor = toNumberSafe(ponto?.[campo], 0)
        if (valor > 0) break
      }

      if (valor <= 0) {
        valoresPorMes.set(key, valoresPorMes.get(key) || { ano, mes, valor: 0 })
        continue
      }

      const atual = valoresPorMes.get(key) || { ano, mes, valor: 0 }
      atual.valor += valor
      valoresPorMes.set(key, atual)
    }
  }

  if (Array.isArray(raw.forecast)) aplicarPontos(raw.forecast, ["forecast", "demanda", "qtd_forecast"])
  if (Array.isArray(raw.linha_tempo_estoque)) aplicarPontos(raw.linha_tempo_estoque, ["demanda", "forecast"])
  if (Array.isArray(raw.comparativo_mensal)) aplicarPontos(raw.comparativo_mensal, ["forecast", "demanda"])

  const demandaAtual = Math.max(
    getNum((item || {}) as AgingEstoqueItem, "demanda_mes_atual"),
    getNum((item || {}) as AgingEstoqueItem, "previsao_mes_atual"),
    getNum((item || {}) as AgingEstoqueItem, "demanda_bom_mes_atual"),
    getNum((item || {}) as AgingEstoqueItem, "demanda_direta_mes_atual"),
  )

  if (demandaAtual > 0) {
    const atual = valoresPorMes.get(keyAtual) || { ano: anoAtual, mes: mesAtual, valor: 0 }
    if (atual.valor <= 0) atual.valor = demandaAtual
    valoresPorMes.set(keyAtual, atual)
  }

  const keysComDados = Array.from(valoresPorMes.keys()).sort()
  const ultimoKey = keysComDados.length ? keysComDados[keysComDados.length - 1] : monthKey(new Date(anoAtual, mesAtual - 1 + 6, 1).getFullYear(), new Date(anoAtual, mesAtual - 1 + 6, 1).getMonth() + 1)

  const meses: { ano: number; mes: number; label: string; key: string }[] = []
  const cursor = new Date(anoAtual, mesAtual - 1, 1)
  let guard = 0

  while (guard < 18) {
    const ano = cursor.getFullYear()
    const mes = cursor.getMonth() + 1
    const key = monthKey(ano, mes)
    meses.push({ ano, mes, label: monthLabel(ano, mes).split("/")[0].toUpperCase(), key })
    if (key >= ultimoKey) break
    cursor.setMonth(cursor.getMonth() + 1)
    guard += 1
  }

  return meses.map((mes) => ({ ...mes, valor: valoresPorMes.get(mes.key)?.valor || 0 }))
}
function getTotalForecastDashboard(item: AgingEstoqueItem | null | undefined) {
  return getForecastSeisMesesDashboard(item).reduce((sum, ponto) => sum + Number(ponto.valor || 0), 0)
}

function getMotivoStatusDashboard(item: AgingEstoqueItem | null | undefined) {
  if (!item) return "Sem item para análise."

  const categoria = getCategoriaStatusDashboard(item)
  const estoque = getEstoqueAtualReal(item)
  const entradas = getEntradasMesAtualDashboard(item)
  const demanda = getDemandaStatusDashboard(item)
  const consumoMes = getConsumoMesAtual(item)
  const total6m = getTotalSeisMesesDashboard(item)
  const cobertura = getCoberturaMatriz(item)
  const estoqueComEntradas = estoque + entradas
  const desvioRitmo = getDesvioRitmoPct(item)

  if (categoria === "criticos") {
    if (demanda > 0 && estoqueComEntradas <= 0) {
      return `Ruptura: não há estoque nem entrada prevista no mês para uma necessidade de ${fmtQtdInteira(demanda)}.`
    }
    if (demanda > 0 && estoqueComEntradas < demanda) {
      return `Estoque + entradas do mês (${fmtQtdEstoque(estoqueComEntradas)}) não cobre a necessidade do mês (${fmtQtdInteira(demanda)}).`
    }
    if (demanda > 0 && cobertura > 0 && cobertura < 1) {
      return `Cobertura baixa: ${fmtNumber(cobertura, 1)} mês para uma necessidade de ${fmtQtdInteira(demanda)}.`
    }
    if (consumoMes > 0 && desvioRitmo > 25) {
      return `Consumo acima do ritmo esperado: ${fmtNumber(desvioRitmo, 0)} p.p. acima do mês decorrido.`
    }
    return "Semáforo vermelho ou status crítico/ruptura no recorte atual."
  }

  if (categoria === "excesso") {
    if (cobertura >= 12) return `Cobertura muito alta: ${fmtNumber(cobertura, 1)} meses.`
    return "Estoque acima da política/estoque ideal calculado."
  }

  if (categoria === "semGiro") {
    if (total6m <= 0 && demanda <= 0) return "Sem venda/consumo nos últimos 6 meses e sem necessidade clara no plano atual."
    if (total6m <= 0) return "Sem venda/consumo nos últimos 6 meses."
    return "Sem consumo operacional calculado para o recorte atual."
  }

  if (categoria === "atencao") {
    if (demanda > 0 && cobertura >= 1 && cobertura < 1.5) return `Cobre o mês atual, mas com pouca folga: ${fmtNumber(cobertura, 1)} mês de cobertura.`
    if (consumoMes > 0 && desvioRitmo > 10) return `Consumo acima do ritmo esperado: ${fmtNumber(desvioRitmo, 0)} p.p. acima do mês decorrido.`
    return "Item em acompanhamento: ainda não é crítico, mas merece monitoramento de consumo/cobertura."
  }

  return "Sem alerta operacional aparente neste recorte."
}

function MiniSerieBarrasDashboard({
  titulo,
  serie,
  color,
}: {
  titulo: string
  serie: { key: string; label: string; valor: number }[]
  color: string
}) {
  const max = Math.max(...(serie || []).map((ponto) => Number(ponto.valor || 0)), 1)

  return (
    <div className="rounded-2xl border bg-slate-50 px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{titulo}</p>
      <div className="mt-2 flex h-[92px] items-end gap-2">
        {(serie || []).map((ponto) => {
          const valor = Number(ponto.valor || 0)
          const altura = valor > 0 ? Math.max(10, (valor / max) * 48) : 3
          return (
            <div key={ponto.key} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{valor > 0 ? fmtCompact(valor) : "0"}</span>
              <span className="w-full max-w-[24px] rounded-t-md" style={{ height: `${altura}px`, background: valor > 0 ? color : "#CBD5E1" }} />
              <span className="text-[9px] font-semibold" style={{ color: "var(--text-secondary)" }}>{ponto.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}



type SerieCompostaSkuDashboardPonto = {
  key: string
  label: string
  consumo: number | null
  forecast: number | null
  estoque: number | null
  entradas: number | null
  quarentena: number | null
  atual?: boolean
}

function getMesesHistoricoAteAnteriorDashboard(qtdMeses = 6) {
  const hoje = new Date()
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const meses: { ano: number; mes: number; label: string; key: string }[] = []

  for (let i = qtdMeses; i >= 1; i -= 1) {
    const data = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const ano = data.getFullYear()
    const mes = data.getMonth() + 1
    meses.push({ ano, mes, label: monthLabel(ano, mes).split("/")[0].toUpperCase(), key: monthKey(ano, mes) })
  }

  return meses
}

function getEntradasProximosMesesDashboard(item: AgingEstoqueItem | null | undefined) {
  const meses = getProximosMesesDashboard(6)
  const mapa = new Map<string, number>(meses.map((mes) => [mes.key, 0]))
  const raw = (item || {}) as any

  const aplicarPontos = (pontos: any[]) => {
    for (const ponto of pontos || []) {
      const ano = Number(ponto?.ano || 0)
      const mes = Number(ponto?.mes || 0)
      if (!ano || !mes) continue
      const key = monthKey(ano, mes)
      if (!mapa.has(key)) continue

      const valor = Math.max(
        toNumberSafe(ponto?.entradas_previstas, 0),
        toNumberSafe(ponto?.entradas, 0),
        toNumberSafe(ponto?.qtd_entradas_previstas, 0),
        toNumberSafe(ponto?.pedidos, 0),
      )

      if (valor > 0) {
        mapa.set(key, (mapa.get(key) || 0) + valor)
      }
    }
  }

  const aplicarPedidosComData = (pedidos: any[]) => {
    for (const pedido of pedidos || []) {
      const dataRaw = pedido?.data_prevista_entrega || pedido?.data_previsao_necessidade
      if (!dataRaw) continue

      const texto = String(dataRaw).slice(0, 10)
      let data: Date | null = null

      if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        data = new Date(`${texto}T00:00:00`)
      } else {
        const matchBr = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (matchBr) {
          const [, dia, mes, ano] = matchBr
          data = new Date(Number(ano), Number(mes) - 1, Number(dia))
        }
      }

      if (!data || Number.isNaN(data.getTime())) continue

      const key = monthKey(data.getFullYear(), data.getMonth() + 1)
      if (!mapa.has(key)) continue

      const valor = Math.max(
        toNumberSafe(pedido?.quantidade_pendente, 0),
        toNumberSafe(pedido?.quantidade, 0),
        toNumberSafe(pedido?.qtd, 0),
      )

      if (valor > 0) {
        mapa.set(key, (mapa.get(key) || 0) + valor)
      }
    }
  }

  // Prioridade: séries mensais já calculadas pelo backend com data prevista.
  // Não usar qtd_pedidos_abertos agregado como fallback no mês atual, porque isso
  // joga pedidos de agosto/dezembro dentro de junho e distorce a validação.
  if (Array.isArray(raw.entradas_previstas_serie)) {
    aplicarPontos(raw.entradas_previstas_serie)
  } else if (Array.isArray(raw.pedidos_futuros_por_mes)) {
    aplicarPontos(raw.pedidos_futuros_por_mes)
  } else if (Array.isArray(raw.entradas_previstas_periodo)) {
    aplicarPontos(raw.entradas_previstas_periodo)
  } else {
    if (Array.isArray(raw.linha_tempo_estoque)) aplicarPontos(raw.linha_tempo_estoque)
    if (Array.isArray(raw.serie_operacional)) aplicarPontos(raw.serie_operacional)
    if (Array.isArray(raw.pedidos)) aplicarPedidosComData(raw.pedidos)
  }

  return meses.map((mes) => ({ ...mes, valor: mapa.get(mes.key) || 0 }))
}

function getSerieCompostaSkuDashboard(item: AgingEstoqueItem | null | undefined): SerieCompostaSkuDashboardPonto[] {
  const historico = getMesesHistoricoAteAnteriorDashboard(6)
  const forecastBase = getForecastSeisMesesDashboard(item)
  const futuro = forecastBase.map((ponto) => ({ ano: ponto.ano, mes: ponto.mes, label: ponto.label, key: ponto.key }))
  const meses = [...historico, ...futuro]
  const historicoBase = getHistoricoSeisMesesDashboard(item)
  const entradasBase = getEntradasProximosMesesDashboard(item)
  const mapaHistorico = new Map(historicoBase.map((ponto) => [ponto.key, Number(ponto.valor || 0)]))
  const mapaForecast = new Map(forecastBase.map((ponto) => [ponto.key, Number(ponto.valor || 0)]))
  const mapaEntradas = new Map(entradasBase.map((ponto) => [ponto.key, Number(ponto.valor || 0)]))
  const estoqueAtual = getEstoqueAtualReal((item || {}) as AgingEstoqueItem)
  const keyAtual = futuro[0]?.key

  return meses.map((mes) => {
    const isHistorico = historico.some((h) => h.key === mes.key)
    const isFuturo = futuro.some((f) => f.key === mes.key)
    const consumo = isHistorico ? (mapaHistorico.get(mes.key) || 0) : null
    const forecast = isFuturo ? (mapaForecast.get(mes.key) || 0) : null
    const entradas = isFuturo ? (mapaEntradas.get(mes.key) || 0) : null

    return {
      ...mes,
      consumo: consumo !== null && consumo > 0 ? consumo : null,
      forecast: forecast !== null && forecast > 0 ? forecast : null,
      entradas: entradas !== null && entradas > 0 ? entradas : null,
      estoque: mes.key === keyAtual && estoqueAtual > 0 ? estoqueAtual : null,
      quarentena: null,
      atual: mes.key === keyAtual,
    }
  })
}

function SerieCompostaSkuTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const valores = payload
    .filter((p: any) => p?.value !== null && p?.value !== undefined)
    .map((p: any) => ({ nome: p.name, valor: Number(p.value || 0), color: p.color }))

  if (!valores.length) return null

  return (
    <div className="rounded-2xl border bg-white p-3 text-xs shadow-xl" style={{ borderColor: "var(--border)" }}>
      <p className="mb-2 font-bold" style={{ color: "var(--text-primary)" }}>{label}</p>
      <div className="space-y-1.5">
        {valores.map((item: any) => (
          <div key={item.nome} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.nome}
            </span>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>{String(item.nome || "").includes("Venda") || String(item.nome || "").includes("Forecast") ? fmtQtdInteira(item.valor) : fmtQtdEstoque(item.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniSerieEstoqueConsumoForecastDashboard({ item }: { item: AgingEstoqueItem }) {
  const serie = getSerieCompostaSkuDashboard(item)
  const temDados = serie.some((ponto) => Number(ponto.consumo || 0) > 0 || Number(ponto.forecast || 0) > 0 || Number(ponto.estoque || 0) > 0 || Number(ponto.entradas || 0) > 0)

  return (
    <div className="rounded-2xl border bg-slate-50 px-3 py-3" style={{ borderColor: "var(--border)" }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          Estoque disponível, entradas previstas, venda/consumo e forecast
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[#163B63]" /> Estoque</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm border border-dashed border-[#0F5E7C] bg-white" /> Entradas</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-[#16A34A]" /> Venda/consumo</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-[#F97316]" /> Forecast</span>
        </div>
      </div>

      {temDados ? (
        <div className="h-[190px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 26, right: 18, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
              <XAxis dataKey="label" interval={0} tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip content={<SerieCompostaSkuTooltip />} />
              <Bar dataKey="estoque" name="Estoque disponível" fill="#163B63" radius={[5, 5, 0, 0]} barSize={18}>
                <LabelList dataKey="estoque" position="top" fontSize={10} fill="#163B63" formatter={(value: number) => Number(value || 0) > 0 ? fmtQtdEstoque(Number(value || 0)) : ""} />
              </Bar>
              <Bar dataKey="entradas" name="Entradas previstas" fill="rgba(15,94,124,0.10)" stroke="#0F5E7C" strokeDasharray="4 3" radius={[5, 5, 0, 0]} barSize={18}>
                <LabelList dataKey="entradas" position="top" fontSize={10} fill="#0F5E7C" formatter={(value: number) => Number(value || 0) > 0 ? fmtQtdEstoque(Number(value || 0)) : ""} />
              </Bar>
              <Line type="monotone" dataKey="consumo" name="Venda/consumo" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false}>
                <LabelList dataKey="consumo" position="top" fontSize={10} fill="#16A34A" formatter={(value: number) => Number(value || 0) > 0 ? fmtQtdInteira(Number(value || 0)) : ""} />
              </Line>
              <Line type="monotone" dataKey="forecast" name="Forecast/demanda" stroke="#F97316" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false}>
                <LabelList dataKey="forecast" position="top" fontSize={10} fill="#EA580C" formatter={(value: number) => Number(value || 0) > 0 ? fmtQtdInteira(Number(value || 0)) : ""} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          <p className="text-xs">Sem série disponível para este SKU.</p>
        </div>
      )}
    </div>
  )
}
function DashboardSkuDetailModal({
  state,
  onClose,
}: {
  state: DashboardDrilldownState | null
  onClose: () => void
}) {
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const [codigoSelecionado, setCodigoSelecionado] = useState<string | null>(null)

  useEffect(() => {
    if (state) {
      setMostrarTodos(false)
      setCodigoSelecionado(null)
    }
  }, [state?.titulo, state?.itens?.length])

  const itensOrdenados = useMemo(() => {
    const ordemStatus: Record<CategoriaStatusDashboard, number> = {
      criticos: 0,
      excesso: 1,
      atencao: 2,
      semGiro: 3,
      ok: 4,
    }

    return [...(state?.itens || [])].sort((a, b) => {
      const statusDiff = ordemStatus[getCategoriaStatusDashboard(a)] - ordemStatus[getCategoriaStatusDashboard(b)]
      if (statusDiff !== 0) return statusDiff
      const coberturaDiff = getCoberturaMatriz(b) - getCoberturaMatriz(a)
      if (Math.abs(coberturaDiff) > 0.0001) return coberturaDiff
      const demandaDiff = getDemandaTotalOperacionalDashboard(b) - getDemandaTotalOperacionalDashboard(a)
      if (Math.abs(demandaDiff) > 0.0001) return demandaDiff
      const estoqueDiff = getEstoqueAtualReal(b) - getEstoqueAtualReal(a)
      if (Math.abs(estoqueDiff) > 0.0001) return estoqueDiff
      return String((a as any).produto || "").localeCompare(String((b as any).produto || ""), "pt-BR")
    })
  }, [state])

  const itemSelecionado = useMemo(() => {
    if (!codigoSelecionado) return null
    return itensOrdenados.find((item) => String((item as any).codigo || (item as any).cod_produto || "") === codigoSelecionado) || null
  }, [itensOrdenados, codigoSelecionado])

  if (!state) return null

  const itensVisiveis = mostrarTodos ? itensOrdenados : itensOrdenados.slice(0, 80)
  const totalEstoque = itensOrdenados.reduce((sum, item) => sum + getEstoqueAtualReal(item), 0)
  const totalEntradas = itensOrdenados.reduce((sum, item) => sum + getEntradasMesAtualDashboard(item), 0)
  const total6m = itensOrdenados.reduce((sum, item) => sum + getTotalSeisMesesDashboard(item), 0)
  const totalForecast = itensOrdenados.reduce((sum, item) => sum + getDemandaTotalOperacionalDashboard(item), 0)
  const coberturaAgregada = totalForecast > 0 ? (totalEstoque + totalEntradas) / totalForecast : 0
  const accent = state.accentColor || "#163B63"

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm">
      <div className="max-h-[94vh] w-[min(1760px,98vw)] overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Análise dos SKUs do recorte</p>
            <h3 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>{state.titulo}</h3>
            {state.subtitulo && <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{state.subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border p-2 transition hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(94vh-82px)] overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>SKUs</p><p className="mt-1 text-lg font-bold">{fmtNumber(itensOrdenados.length)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Estoque</p><p className="mt-1 text-lg font-bold">{fmtQtdEstoque(totalEstoque)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Entradas mês</p><p className="mt-1 text-lg font-bold">{fmtQtdEstoque(totalEntradas)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Venda/cons. 6M</p><p className="mt-1 text-lg font-bold">{fmtQtdInteira(total6m)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Forecast/demanda</p><p className="mt-1 text-lg font-bold">{fmtQtdInteira(totalForecast)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Cobertura</p><p className="mt-1 text-lg font-bold">{totalForecast > 0 ? `${fmtNumber(coberturaAgregada, 1)} m` : "Sem consumo"}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "rgba(124,58,237,0.24)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "#6D28D9" }}>Bravi</p><p className="mt-1 text-lg font-bold" style={{ color: "#6D28D9" }}>{fmtNumber(itensOrdenados.filter(itemEhBraviDashboard).length)}</p></div>
            <div className="rounded-2xl border bg-white p-3" style={{ borderColor: "rgba(217,119,6,0.24)" }}><p className="text-[10px] font-bold uppercase" style={{ color: "#B45309" }}>Descont.</p><p className="mt-1 text-lg font-bold" style={{ color: "#B45309" }}>{fmtNumber(itensOrdenados.filter(itemEhDescontinuadoDashboard).length)}</p></div>
          </div>

          {state.acao && (
            <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: accent, background: "rgba(248,250,252,0.92)", color: "var(--text-primary)" }}>
              <span className="font-bold" style={{ color: accent }}>Ação sugerida: </span>{state.acao}
            </div>
          )}

          <div className="mt-4 rounded-3xl border bg-white" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-col justify-between gap-3 border-b px-4 py-3 md:flex-row md:items-center" style={{ borderColor: "var(--border)" }}>
              <div>
                <h4 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Lista rápida de SKUs</h4>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>Clique em um SKU para abrir o gráfico abaixo sem perder a visão da lista.</p>
              </div>
              {itensOrdenados.length > 80 && (
                <button
                  type="button"
                  onClick={() => setMostrarTodos((atual) => !atual)}
                  className="rounded-xl border bg-white px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  {mostrarTodos ? "Mostrar menos" : `Ver todos os ${fmtNumber(itensOrdenados.length)} SKUs`}
                </button>
              )}
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1280px] text-xs">
                <thead style={{ background: "#F8FAFC", color: "#475569" }}>
                  <tr className="text-left uppercase tracking-wide">
                    <th className="px-3 py-3">SKU</th>
                    <th className="px-3 py-3">Descrição</th>
                    <th className="px-3 py-3">Linha</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Estoque</th>
                    <th className="px-3 py-3 text-right">Entradas mês</th>
                    <th className="px-3 py-3 text-right">Forecast/demanda</th>
                    <th className="px-3 py-3 text-right">Cobertura</th>
                    <th className="px-3 py-3 text-right">Venda/cons. 6M</th>
                    <th className="px-3 py-3 text-right">Valor</th>
                    <th className="px-3 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {itensVisiveis.map((item) => {
                    const raw = item as any
                    const codigo = String(raw.codigo || raw.cod_produto || "")
                    const descricao = String(raw.produto || raw.descricao || raw.desc_produto || "—")
                    const categoria = getCategoriaStatusDashboard(item)
                    const meta = STATUS_DASHBOARD_META[categoria]
                    const selecionado = codigoSelecionado === codigo
                    return (
                      <tr key={`${codigo}-${descricao}`} className="border-b last:border-0" style={{ borderColor: "var(--border)", background: selecionado ? "rgba(22,59,99,0.04)" : "#FFFFFF" }}>
                        <td className="px-3 py-3 align-middle"><span className="rounded-xl bg-slate-100 px-2 py-1 font-bold" style={{ color: "var(--text-primary)" }}>{codigo || "—"}</span></td>
                        <td className="px-3 py-3 align-middle"><p className="max-w-[360px] truncate font-bold" style={{ color: "var(--text-primary)" }}>{descricao}</p><p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>{String(raw.tipo || raw.tipo_produto_erp || "")}</p></td>
                        <td className="px-3 py-3 align-middle" style={{ color: "var(--text-secondary)" }}>{getLinhaDashboardItem(item)}</td>
                        <td className="px-3 py-3 align-middle"><span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span></td>
                        <td className="px-3 py-3 text-right align-middle font-bold">{fmtQtdEstoque(getEstoqueAtualReal(item))}</td>
                        <td className="px-3 py-3 text-right align-middle">{fmtQtdEstoque(getEntradasMesAtualDashboard(item))}</td>
                        <td className="px-3 py-3 text-right align-middle">{fmtQtdInteira(getDemandaTotalOperacionalDashboard(item))}</td>
                        <td className="px-3 py-3 text-right align-middle font-bold">{getFaixaCoberturaOperacionalDashboard(item) === "Sem consumo" ? "Sem consumo" : `${fmtNumber(getCoberturaMatriz(item), 1)} m`}</td>
                        <td className="px-3 py-3 text-right align-middle">{fmtQtdInteira(getTotalSeisMesesDashboard(item))}</td>
                        <td className="px-3 py-3 text-right align-middle font-bold">{fmtCurrency(getValorEstoqueMatriz(item), 0)}</td>
                        <td className="px-3 py-3 text-right align-middle">
                          <button
                            type="button"
                            onClick={() => setCodigoSelecionado(selecionado ? null : codigo)}
                            className="rounded-xl border bg-white px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
                            style={{ borderColor: selecionado ? accent : "var(--border)", color: selecionado ? accent : "var(--text-primary)" }}
                          >
                            {selecionado ? "Fechar gráfico" : "Ver gráfico"}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!itensVisiveis.length && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum SKU encontrado neste recorte.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {itemSelecionado && (
            <div className="mt-4 rounded-3xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Gráfico do SKU selecionado</p>
                  <h4 className="mt-1 text-base font-bold" style={{ color: "var(--text-primary)" }}>
                    {String((itemSelecionado as any).codigo || "—")} · {String((itemSelecionado as any).produto || (itemSelecionado as any).descricao || "Item")}
                  </h4>
                </div>
                <button type="button" onClick={() => setCodigoSelecionado(null)} className="rounded-xl border bg-white px-3 py-2 text-xs font-bold transition hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Fechar</button>
              </div>
              <MiniSerieEstoqueConsumoForecastDashboard item={itemSelecionado} />
              <div className="mt-3 rounded-2xl border px-3 py-2" style={{ borderColor: STATUS_DASHBOARD_META[getCategoriaStatusDashboard(itemSelecionado)].color, background: STATUS_DASHBOARD_META[getCategoriaStatusDashboard(itemSelecionado)].bg }}>
                <p className="text-xs font-bold" style={{ color: STATUS_DASHBOARD_META[getCategoriaStatusDashboard(itemSelecionado)].color }}>Motivo do status</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-primary)" }}>{getMotivoStatusDashboard(itemSelecionado)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ItensDrilldownDashboardTable({
  titulo,
  subtitulo,
  acao,
  itens,
  accentColor = "#163B63",
  preserveOrder = false,
  vazio = "Nenhum item encontrado para este recorte.",
}: {
  titulo: string
  subtitulo?: string
  acao?: string
  itens: AgingEstoqueItem[]
  accentColor?: string
  preserveOrder?: boolean
  vazio?: string
}) {
  const [mostrarTodos, setMostrarTodos] = useState(false)

  useEffect(() => {
    setMostrarTodos(false)
  }, [titulo, itens.length])

  const itensOrdenados = useMemo(() => {
    const base = [...(itens || [])]
    if (preserveOrder) return base
    return base.sort((a, b) => {
      const valorDiff = getValorEstoqueMatriz(b) - getValorEstoqueMatriz(a)
      if (valorDiff !== 0) return valorDiff
      const estoqueDiff = getEstoqueAtualReal(b) - getEstoqueAtualReal(a)
      if (estoqueDiff !== 0) return estoqueDiff
      return getTotalSeisMesesDashboard(b) - getTotalSeisMesesDashboard(a)
    })
  }, [itens, preserveOrder])

  const itensVisiveis = mostrarTodos ? itensOrdenados : itensOrdenados.slice(0, 40)

  return (
    <div className="rounded-2xl border bg-white" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-col justify-between gap-3 border-b p-4 md:flex-row md:items-start" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: accentColor }} />
            <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{titulo}</h3>
          </div>
          {subtitulo && <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{subtitulo}</p>}
          {acao && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{acao}</p>}
        </div>
        {itensOrdenados.length > 40 && (
          <button
            type="button"
            onClick={() => setMostrarTodos((atual) => !atual)}
            className="rounded-xl border bg-white px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {mostrarTodos ? "Ver menos" : "Ver todos"}
          </button>
        )}
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1180px] text-xs">
          <thead style={{ background: "#1F5C7A", color: "#FFFFFF" }}>
            <tr className="text-left uppercase tracking-wide">
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">Descrição</th>
              <th className="px-3 py-3">Linha</th>
              <th className="px-3 py-3 text-right">Estoque</th>
              <th className="px-3 py-3 text-right">Total 6M</th>
              <th className="px-3 py-3">Histórico 6M</th>
              <th className="px-3 py-3 text-right">Cobertura</th>
              <th className="px-3 py-3 text-right">Entradas mês</th>
              <th className="px-3 py-3 text-right">Valor estoque</th>
            </tr>
          </thead>
          <tbody>
            {itensVisiveis.map((item) => {
              const raw = item as any
              const codigo = String(raw.codigo || raw.cod_produto || "")
              const descricao = String(raw.produto || raw.descricao || raw.desc_produto || "—")
              const linha = getLinhaDashboardItem(item)
              const estoque = getEstoqueAtualReal(item)
              const entradas = getEntradasMesAtualDashboard(item)
              const total6m = getTotalSeisMesesDashboard(item)
              const cobertura = getCoberturaMatriz(item)
              const valor = getValorEstoqueMatriz(item)

              return (
                <tr key={`${codigo}-${descricao}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-3 align-middle">
                    <span className="rounded-xl bg-slate-100 px-2 py-1 font-bold" style={{ color: "var(--text-primary)" }}>{codigo || "—"}</span>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <p className="max-w-[360px] truncate font-bold" style={{ color: "var(--text-primary)" }}>{descricao}</p>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>{String(raw.status_portfolio || raw.tipo || raw.tipo_produto_erp || "")}</p>
                  </td>
                  <td className="px-3 py-3 align-middle" style={{ color: "var(--text-secondary)" }}>{linha}</td>
                  <td className="px-3 py-3 text-right align-middle font-bold" style={{ color: "var(--text-primary)" }}>{fmtQtdEstoque(estoque)}</td>
                  <td className="px-3 py-3 text-right align-middle font-bold" style={{ color: "var(--text-primary)" }}>{fmtNumber(total6m, 0)}</td>
                  <td className="px-3 py-3 align-middle"><MiniHistoricoDashboard item={item} /></td>
                  <td className="px-3 py-3 text-right align-middle">{itemTemConsumoOuDemandaDashboard(item) ? `${fmtNumber(cobertura, 1)} m` : "Sem consumo"}</td>
                  <td className="px-3 py-3 text-right align-middle">{fmtQtdEstoque(entradas)}</td>
                  <td className="px-3 py-3 text-right align-middle font-bold">{fmtCurrency(valor, 0)}</td>
                </tr>
              )
            })}
            {!itensVisiveis.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>{vazio}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!mostrarTodos && itensOrdenados.length > 40 && (
        <div className="border-t px-4 py-3 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          Mostrando os 40 primeiros itens do recorte. Use “Ver todos” para abrir a lista completa.
        </div>
      )}
    </div>
  )
}

function MatrizEstoqueGiroPanel({
  itens,
  loading,
  onApplyFilter,
}: {
  itens: AgingEstoqueItem[]
  loading?: boolean
  onApplyFilter: (filtro: FiltroTabelaEstoque | null, escopo?: EscopoEstoque) => void
}) {
  const matriz = useMemo(() => montarPontosMatrizEstoque(itens || []), [itens])
  const [quadranteSelecionado, setQuadranteSelecionado] = useState<QuadranteMatrizKey>("RISCO_FALTA")

  const pontosQuadrante = useMemo(() => {
    return matriz.pontos
      .filter((ponto) => ponto.quadrante === quadranteSelecionado)
      .sort((a, b) => b.valor - a.valor || b.giro - a.giro)
  }, [matriz.pontos, quadranteSelecionado])

  const quadranteAtual = MATRIZ_QUADRANTES[quadranteSelecionado]

  if (!itens?.length && loading) {
    return (
      <div className="card p-5">
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Carregando matriz Estoque x Giro...</p>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Matriz Estoque x Giro</p>
          <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Prioridade de ação por SKU</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            O eixo horizontal mostra giro/demanda; o vertical mostra cobertura em meses. O tamanho da bolha representa valor em estoque.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>Corte giro: {fmtNumber(matriz.corteGiro, 0)}</span>
          <span className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>Corte cobertura: {fmtNumber(matriz.corteCobertura, 0)} meses</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(MATRIZ_QUADRANTES) as QuadranteMatrizKey[]).map((key) => {
          const info = MATRIZ_QUADRANTES[key]
          const resumo = matriz.resumo[key]
          const active = quadranteSelecionado === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setQuadranteSelecionado(key)}
              className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm"
              style={{
                borderColor: active ? info.color : "var(--border)",
                background: active ? info.bg : "#FFFFFF",
                boxShadow: active ? `0 0 0 1px ${info.color}` : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{info.titulo}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{info.subtitulo}</p>
                </div>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: info.color }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>SKUs</p><p className="text-lg font-bold">{fmtNumber(resumo?.skus || 0)}</p></div>
                <div><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Estoque</p><p className="text-lg font-bold">{fmtCompact(resumo?.estoque || 0)}</p></div>
                <div><p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Valor</p><p className="text-lg font-bold">{fmtCurrency(resumo?.valor || 0, 0)}</p></div>
              </div>
              <p className="mt-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>{info.acao}</p>
            </button>
          )
        })}
      </div>

      <div className="relative mt-5 h-[440px] rounded-2xl border p-3" style={{ borderColor: "var(--border)" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 28, right: 36, left: 16, bottom: 38 }}>
            <XAxis
              type="number"
              dataKey="x"
              name="Giro / demanda"
              domain={[0, Math.max(matriz.maxGiro, matriz.corteGiro * 1.15)]}
              tickFormatter={(value) => fmtCompact(Number(value))}
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={{ stroke: "#CBD5E1" }}
              tickLine={false}
              label={{ value: "Giro / demanda", position: "bottom", offset: 18, fontSize: 12, fill: "#64748B" }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Cobertura"
              domain={[0, Math.max(matriz.maxCobertura, matriz.corteCobertura * 1.15)]}
              tickFormatter={(value) => fmtCompact(Number(value))}
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={{ stroke: "#CBD5E1" }}
              tickLine={false}
              label={{ value: "Cobertura em meses", angle: -90, position: "insideLeft", fontSize: 12, fill: "#64748B" }}
            />
            <ZAxis type="number" dataKey="z" range={[26, 520]} />
            <ReferenceLine
              x={matriz.corteGiro}
              stroke="#94A3B8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              label={{ value: `Corte giro ${fmtNumber(matriz.corteGiro, 0)}`, position: "insideBottomRight", fill: "#64748B", fontSize: 11 }}
            />
            <ReferenceLine
              y={matriz.corteCobertura}
              stroke="#94A3B8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              label={{ value: `Corte cobertura ${fmtNumber(matriz.corteCobertura, 0)} m`, position: "insideTopLeft", fill: "#64748B", fontSize: 11 }}
            />
            <Tooltip content={<MatrixTooltip />} cursor={{ stroke: "#94A3B8", strokeDasharray: "3 3" }} />
            <Scatter
              name="SKUs"
              data={matriz.pontos}
              onClick={(entry: any) => {
                const ponto = entry as MatrixPoint
                if (!ponto?.quadrante) return
                setQuadranteSelecionado(ponto.quadrante)
              }}
            >
              {matriz.pontos.map((ponto) => (
                <Cell key={`${ponto.codigo}-${ponto.quadrante}`} fill={MATRIZ_QUADRANTES[ponto.quadrante].color} fillOpacity={0.82} stroke="#FFFFFF" strokeWidth={1} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0">
          {([
            { key: "EXCESSO_PARADO", className: "left-4 top-4" },
            { key: "EXCESSO_COM_GIRO", className: "right-4 top-4" },
            { key: "BAIXO_GIRO_CONTROLADO", className: "left-4 bottom-4" },
            { key: "RISCO_FALTA", className: "right-4 bottom-4" },
          ] as const).map(({ key, className }) => {
            const info = MATRIZ_QUADRANTES[key]
            const resumo = matriz.resumo[key]
            return (
              <div
                key={key}
                className={`absolute rounded-xl border bg-white/90 px-3 py-2 text-xs shadow-sm ${className}`}
                style={{ borderColor: info.border }}
              >
                <p className="font-bold" style={{ color: info.color }}>{info.titulo}</p>
                <p style={{ color: "var(--text-secondary)" }}>{fmtNumber(resumo?.skus || 0)} SKUs</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4">
        <ItensDrilldownDashboardTable
          titulo={quadranteAtual.titulo}
          subtitulo={quadranteAtual.subtitulo}
          acao={quadranteAtual.acao}
          itens={pontosQuadrante.map((ponto) => ponto.raw)}
          accentColor={quadranteAtual.color}
          preserveOrder
          vazio="Nenhum item neste quadrante com a base carregada."
        />
      </div>
    </div>
  )
}

function DashboardEstoquePanel({
  data,
  itensMatriz,
  dataPorEscopo,
  itensPorEscopo,
  loading,
  loadingMatriz,
  onApplyFilter,
  onOpenGestao,
}: {
  data: AgingResumoResponse | null
  itensMatriz: AgingEstoqueItem[]
  dataPorEscopo?: Partial<Record<EscopoEstoque, AgingResumoResponse>>
  itensPorEscopo?: Partial<Record<EscopoEstoque, AgingItensResponse>>
  loading?: boolean
  loadingMatriz?: boolean
  onApplyFilter: (filtro: FiltroTabelaEstoque | null, escopo?: EscopoEstoque) => void
  onOpenGestao: (escopo?: EscopoEstoque) => void
}) {
  const [escopoSelecionadoDashboard, setEscopoSelecionadoDashboard] = useState<EscopoEstoque>("produtos")
  const [linhaSelecionadaDashboard, setLinhaSelecionadaDashboard] = useState<string>("TODAS")
  const [drilldownDashboard, setDrilldownDashboard] = useState<DashboardDrilldownState | null>(null)

  const dashboardRespAtual = dataPorEscopo?.[escopoSelecionadoDashboard] || data
  const dashboardItensRespAtual = itensPorEscopo?.[escopoSelecionadoDashboard]
  const resumoBackend = dashboardRespAtual?.resumo || {}
  const itensOriginaisDashboard = dashboardItensRespAtual?.itens || (escopoSelecionadoDashboard === "todos" ? itensMatriz : []) || []

  const itensBaseDashboard = useMemo(() => {
    const itens = itensOriginaisDashboard || []

    // Proteção de consistência do Dashboard:
    // no escopo Insumos, o total precisa bater com a aba Gestão de Estoque.
    // A regra validada é: insumo = componente da BOM dos PAs/PIs oficiais.
    // Portanto, se alguma resposta antiga/cacheada vier com material solto do Aging,
    // ela é descartada aqui e não polui os cards/gráficos do Dashboard.
    if (escopoSelecionadoDashboard === "insumos") {
      return itens.filter((item) => {
        const raw = item as any
        return (
          raw.eh_componente_bom === true ||
          Number(raw.qtd_pais_bom || 0) > 0 ||
          String(raw.origem_linha_estoque || "").includes("bom_pa_pi") ||
          String(raw.origem_classificacao || "").trim() === "BOM"
        )
      })
    }

    return itens
  }, [itensOriginaisDashboard, escopoSelecionadoDashboard])

  const linhasDashboard = useMemo(() => {
    const linhas = new Set<string>()
    for (const item of itensBaseDashboard) {
      linhas.add(getLinhaDashboardItem(item))
      if (itemEhBraviDashboard(item)) linhas.add("Bravi")
    }
    return Array.from(linhas).sort((a, b) => a.localeCompare(b, "pt-BR"))
  }, [itensBaseDashboard])

  useEffect(() => {
    if (linhaSelecionadaDashboard === "TODAS") return
    if (!linhasDashboard.includes(linhaSelecionadaDashboard)) {
      setLinhaSelecionadaDashboard("TODAS")
    }
  }, [linhaSelecionadaDashboard, linhasDashboard])

  const itensFiltradosDashboard = useMemo(() => {
    if (linhaSelecionadaDashboard === "TODAS") return itensBaseDashboard
    return itensBaseDashboard.filter((item) => itemPertenceLinhaDashboard(item, linhaSelecionadaDashboard))
  }, [itensBaseDashboard, linhaSelecionadaDashboard])

  useEffect(() => {
    setDrilldownDashboard(null)
  }, [escopoSelecionadoDashboard, linhaSelecionadaDashboard])

  const filtroLinhaAtual = linhaSelecionadaDashboard === "TODAS"
    ? null
    : { label: `Linha · ${linhaSelecionadaDashboard}`, tipo_negocio: linhaSelecionadaDashboard, classificacao_cadastro: "TODOS" }

  const aplicarFiltroComLinha = (filtro: FiltroTabelaEstoque | null, escopo: EscopoEstoque = escopoSelecionadoDashboard) => {
    if (linhaSelecionadaDashboard === "TODAS") {
      onApplyFilter(filtro, escopo)
      return
    }

    onApplyFilter({
      ...(filtro || { label: `Linha · ${linhaSelecionadaDashboard}` }),
      label: filtro?.label ? `${filtro.label} · ${linhaSelecionadaDashboard}` : `Linha · ${linhaSelecionadaDashboard}`,
      tipo_negocio: linhaSelecionadaDashboard,
      classificacao_cadastro: filtro?.classificacao_cadastro || "TODOS",
    }, escopo)
  }

  const abrirGestaoComLinha = () => {
    if (filtroLinhaAtual) {
      onApplyFilter(filtroLinhaAtual, escopoSelecionadoDashboard)
      return
    }
    onOpenGestao(escopoSelecionadoDashboard)
  }

  const abrirListaDashboard = (titulo: string, subtitulo: string, itens: AgingEstoqueItem[], accentColor = "#163B63", acao?: string) => {
    setDrilldownDashboard({ titulo, subtitulo, itens, accentColor, acao })
  }

  const itensPorCategoriaDashboard = (categoria: CategoriaStatusDashboard, linhaOriginal?: string) => {
    return itensFiltradosDashboard.filter((item) => {
      if (linhaOriginal && !itemPertenceLinhaDashboard(item, linhaOriginal)) return false
      return getCategoriaStatusDashboard(item) === categoria
    })
  }

  const itensSemEstoqueDashboard = itensFiltradosDashboard.filter((item) => getEstoqueAtualReal(item) <= 0)
  const itensAtencaoDashboard = itensFiltradosDashboard.filter((item) => {
    const status = String((item as any).status_estoque || (item as any).status || "").toUpperCase()
    return calcularSemaforoEstoque(item) === "AMARELO" || status === "ATENCAO"
  })
  const itensSemGiroDashboard = itensFiltradosDashboard.filter((item) => getCategoriaStatusDashboard(item) === "semGiro")
  const itensExcessoDashboard = itensFiltradosDashboard.filter((item) => {
    const status = String((item as any).status_estoque || (item as any).status || "").toUpperCase()
    return status === "EXCESSO"
  })

  const metricasDashboard = useMemo(() => {
    const itens = itensFiltradosDashboard
    const total = itens.length
    let criticos = 0
    let semEstoque = 0
    let atencao = 0
    let excesso = 0
    let semGiro = 0
    let saldoTotal = 0
    let valorEstoque = 0
    let entradas = 0
    let demanda = 0

    for (const item of itens) {
      const saldo = getEstoqueAtualReal(item)
      const categoria = getCategoriaStatusDashboard(item)

      if (saldo <= 0) semEstoque += 1
      if (categoria === "criticos") criticos += 1
      if (categoria === "atencao") atencao += 1
      if (categoria === "excesso") excesso += 1
      if (categoria === "semGiro") semGiro += 1

      saldoTotal += saldo
      valorEstoque += getValorEstoqueMatriz(item)
      entradas += getEntradasMesAtualDashboard(item)
      demanda += getDemandaTotalOperacionalDashboard(item)
    }

    return {
      total,
      criticos,
      semEstoque,
      atencao,
      excesso,
      semGiro,
      saldoTotal,
      valorEstoque,
      entradas,
      demanda,
    }
  }, [itensFiltradosDashboard])

  const statusPorLinha = useMemo(() => {
    type LinhaStatusDashboard = {
      linha: string
      linhaOriginal: string
      criticos: number
      excesso: number
      semGiro: number
      atencao: number
      ok: number
      total: number
      bravi: number
      descontinuado: number
    }

    const grupos = new Map<string, LinhaStatusDashboard>()

    const adicionarItemNaLinha = (linhaOriginal: string, item: AgingEstoqueItem) => {
      const key = linhaOriginal
      const atual = grupos.get(key) || {
        linha: statusLabelDashboard(linhaOriginal),
        linhaOriginal,
        criticos: 0,
        excesso: 0,
        semGiro: 0,
        atencao: 0,
        ok: 0,
        total: 0,
        bravi: 0,
        descontinuado: 0,
      }

      const categoria = getCategoriaStatusDashboard(item)
      atual.total += 1
      atual.bravi += itemEhBraviDashboard(item) ? 1 : 0
      atual.descontinuado += itemEhDescontinuadoDashboard(item) ? 1 : 0

      if (categoria === "criticos") atual.criticos += 1
      else if (categoria === "excesso") atual.excesso += 1
      else if (categoria === "semGiro") atual.semGiro += 1
      else if (categoria === "atencao") atual.atencao += 1
      else atual.ok += 1

      grupos.set(key, atual)
    }

    for (const item of itensFiltradosDashboard) {
      adicionarItemNaLinha(getLinhaDashboardItem(item), item)

      // Bravi é uma classificação especial, não um status.
      // Por isso aparece como uma linha própria, mantendo seus SKUs distribuídos
      // entre crítico, excesso, sem consumo, atenção e ok.
      if (itemEhBraviDashboard(item)) {
        adicionarItemNaLinha("Bravi", item)
      }
    }

    return Array.from(grupos.values()).sort((a, b) => b.total - a.total || a.linha.localeCompare(b.linha, "pt-BR"))
  }, [itensFiltradosDashboard])

  const coberturaData = useMemo(() => {
    const ordem = ["0 a 1 mês", "1 a 1,5 mês", "1,5 a 3 meses", "Excesso > 3 meses", "Sem consumo"]
    const mapa = new Map<string, AgingEstoqueItem[]>(ordem.map((faixa) => [faixa, []]))

    for (const item of itensFiltradosDashboard) {
      const faixa = getFaixaCoberturaOperacionalDashboard(item)
      mapa.set(faixa, [...(mapa.get(faixa) || []), item])
    }

    if (!itensFiltradosDashboard.length && data?.faixas_cobertura?.length) {
      return data.faixas_cobertura.map((item: any) => ({
        faixa: normalizarFaixaCobertura(item.faixa),
        itens: Number(item.itens || 0),
        itens_lista: Array.isArray(item.amostra_itens) ? item.amostra_itens : [],
      }))
    }

    return ordem.map((faixa) => {
      const itensLista = [...(mapa.get(faixa) || [])].sort((a, b) => {
        if (faixa === "Excesso > 3 meses") {
          const giroA = getGiroMatriz(a)
          const giroB = getGiroMatriz(b)
          if (Math.abs(giroB - giroA) > 0.0001) return giroB - giroA
        }
        const coberturaDiff = getCoberturaMatriz(a) - getCoberturaMatriz(b)
        if (Math.abs(coberturaDiff) > 0.0001) return coberturaDiff
        return getDemandaTotalOperacionalDashboard(b) - getDemandaTotalOperacionalDashboard(a)
      })

      return {
        faixa,
        itens: itensLista.length,
        itens_lista: itensLista,
      }
    })
  }, [itensFiltradosDashboard, data?.faixas_cobertura])

  const topCriticos = useMemo(() => {
    return itensFiltradosDashboard
      .filter((item) => {
        const status = String((item as any).status_estoque || (item as any).status || "").toUpperCase()
        return calcularSemaforoEstoque(item) === "VERMELHO" || status === "RUPTURA" || status === "CRITICO"
      })
      .sort((a, b) => {
        const faltaA = Math.max(0, getNum(a, "demanda_mes_atual") - getEstoqueAtualReal(a) - getPedidosAbertos(a))
        const faltaB = Math.max(0, getNum(b, "demanda_mes_atual") - getEstoqueAtualReal(b) - getPedidosAbertos(b))
        return faltaB - faltaA || getNum(b, "demanda_mes_atual") - getNum(a, "demanda_mes_atual")
      })
  }, [itensFiltradosDashboard])

  const topExcesso = useMemo(() => {
    return itensFiltradosDashboard
      .filter((item) => {
        const status = String((item as any).status_estoque || (item as any).status || "").toUpperCase()
        return status === "EXCESSO" || (getDemandaReferenciaCobertura(item) > 0 && getCoberturaMatriz(item) > 3)
      })
      .sort((a, b) => getEstoqueAtualReal(b) - getEstoqueAtualReal(a) || getValorEstoqueMatriz(b) - getValorEstoqueMatriz(a))
  }, [itensFiltradosDashboard])

  const totalCriticos = metricasDashboard.criticos
  const totalItens = metricasDashboard.total
  const pctCritico = totalItens > 0 ? (totalCriticos / totalItens) * 100 : 0
  const pctSemEstoque = totalItens > 0 ? (metricasDashboard.semEstoque / totalItens) * 100 : 0

  return (
    <div className="space-y-5">
      {loading && (
        <div className="rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "#BFDBFE", background: "#EFF6FF", color: "#1D4ED8" }}>
          Carregando indicadores do dashboard...
        </div>
      )}

      <div className="card px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(22,59,99,0.08)", color: "#163B63" }}><Filter size={16} /></span>
            <div>
              <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Filtro do dashboard</p>
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Filtra cards, gráficos, matriz e rankings por escopo e linha de negócio.</p>
            </div>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:min-w-[520px] sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Escopo</label>
              <select
                value={escopoSelecionadoDashboard}
                onChange={(event) => setEscopoSelecionadoDashboard(event.target.value as EscopoEstoque)}
                className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <option value="produtos">PA/MR</option>
                <option value="insumos">Insumos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Linha</label>
              <select
                value={linhaSelecionadaDashboard}
                onChange={(event) => setLinhaSelecionadaDashboard(event.target.value)}
                className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <option value="TODAS">Todas as linhas</option>
                {linhasDashboard.map((linha) => <option key={linha} value={linha}>{linha}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
        <KpiCard label="Total itens" value={fmtNumber(totalItens)} helper={`${escopoSelecionadoDashboard === "produtos" ? "PA/MR" : escopoSelecionadoDashboard === "insumos" ? "Insumos" : "Todos"}${linhaSelecionadaDashboard === "TODAS" ? "" : ` · ${linhaSelecionadaDashboard}`}`} icon={<Boxes size={20} />} tone="default" onClick={() => abrirListaDashboard("Total de itens", "Lista completa do recorte selecionado no dashboard.", itensFiltradosDashboard, "#163B63")} />
        <KpiCard label="Itens críticos" value={fmtNumber(totalCriticos)} helper={`${fmtNumber(pctCritico, 1)}% do escopo`} icon={<AlertTriangle size={20} />} tone="danger" onClick={() => abrirListaDashboard("Itens críticos", "Itens com ruptura, criticidade ou semáforo vermelho no recorte atual.", itensPorCategoriaDashboard("criticos"), "#DC2626")} />
        <KpiCard label="Sem estoque" value={fmtNumber(metricasDashboard.semEstoque)} helper={`${fmtNumber(pctSemEstoque, 1)}% com saldo atual zerado`} icon={<ArrowDownRight size={20} />} tone="danger" onClick={() => abrirListaDashboard("Itens sem estoque", "Itens com saldo atual igual a zero no recorte selecionado.", itensSemEstoqueDashboard, "#DC2626")} />
        <KpiCard label="Atenção" value={fmtNumber(metricasDashboard.atencao)} helper="monitorar cobertura" icon={<AlertTriangle size={20} />} tone="warning" onClick={() => abrirListaDashboard("Itens em atenção", "Itens com semáforo amarelo ou status de atenção.", itensAtencaoDashboard, "#D97706")} />
        <KpiCard label="Excesso" value={fmtNumber(metricasDashboard.excesso)} helper="cobertura do mês > 3m" icon={<ArrowUpRight size={20} />} tone="blue" onClick={() => abrirListaDashboard("Itens em excesso", "Itens classificados pelo backend como excesso pela política atual.", itensExcessoDashboard, "#2563EB")} />
        <KpiCard label="Sem consumo" value={fmtNumber(metricasDashboard.semGiro)} helper="sem referência de venda/consumo" icon={<PackageSearch size={20} />} tone="default" onClick={() => abrirListaDashboard("Itens sem consumo", "Itens sem venda, consumo ou demanda.", itensSemGiroDashboard, "#94A3B8")} />
        <KpiCard label="Estoque total" value={fmtCompact(metricasDashboard.saldoTotal)} helper={`Valor: ${fmtCurrency(metricasDashboard.valorEstoque, 0)}`} icon={<Boxes size={20} />} tone="success" onClick={() => abrirListaDashboard("Itens com estoque no recorte", "Lista do recorte atual ordenada por valor e volume em estoque.", itensFiltradosDashboard.filter((item) => getEstoqueAtualReal(item) > 0), "#15803D")} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Status por linha de negócio</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Distribuição dos itens por linha de negócio</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>Mostra o status operacional por linha. Bravi aparece como classificação especial, sem deixar de ser crítico, excesso, sem consumo, atenção ou ok.</p>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusPorLinha} layout="vertical" margin={{ top: 10, right: 70, left: 18, bottom: 10 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="linha" type="category" width={132} tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} shared={false} content={<StatusLinhaDashboardTooltip itensBase={itensFiltradosDashboard} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="criticos" name="Críticos" stackId="status" fill="#DC2626" radius={[7, 0, 0, 7]} onClick={(row) => abrirListaDashboard(`Críticos · ${row.linhaOriginal}`, "Itens críticos nesta linha/classificação.", itensPorCategoriaDashboard("criticos", row.linhaOriginal), "#DC2626")}>
                  <LabelList dataKey="criticos" position="inside" fill="#FFFFFF" fontSize={11} formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                </Bar>
                <Bar dataKey="excesso" name="Excesso" stackId="status" fill="#2563EB" onClick={(row) => abrirListaDashboard(`Excesso · ${row.linhaOriginal}`, "Itens em excesso nesta linha/classificação.", itensPorCategoriaDashboard("excesso", row.linhaOriginal), "#2563EB")}>
                  <LabelList dataKey="excesso" position="inside" fill="#FFFFFF" fontSize={11} formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                </Bar>
                <Bar dataKey="semGiro" name="Sem consumo" stackId="status" fill="#94A3B8" onClick={(row) => abrirListaDashboard(`Sem consumo · ${row.linhaOriginal}`, "Itens sem venda/consumo recente e sem necessidade clara no plano atual.", itensPorCategoriaDashboard("semGiro", row.linhaOriginal), "#94A3B8")}>
                  <LabelList dataKey="semGiro" position="inside" fill="#FFFFFF" fontSize={11} formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                </Bar>
                <Bar dataKey="atencao" name="Atenção" stackId="status" fill="#D97706" onClick={(row) => abrirListaDashboard(`Atenção · ${row.linhaOriginal}`, "Itens em atenção nesta linha/classificação.", itensPorCategoriaDashboard("atencao", row.linhaOriginal), "#D97706")}>
                  <LabelList dataKey="atencao" position="inside" fill="#FFFFFF" fontSize={11} formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                </Bar>
                <Bar dataKey="ok" name="Ok/outros" stackId="status" fill="#15803D" radius={[0, 7, 7, 0]} onClick={(row) => abrirListaDashboard(`Ok/outros · ${row.linhaOriginal}`, "Itens sem prioridade operacional aparente nesta linha/classificação.", itensPorCategoriaDashboard("ok", row.linhaOriginal), "#15803D")}>
                  <LabelList dataKey="ok" position="inside" fill="#FFFFFF" fontSize={11} formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                  <LabelList dataKey="total" position="right" fill="#0F172A" fontSize={12} fontWeight={700} formatter={(value: number) => value > 0 ? `${fmtNumber(value)} SKUs` : ""} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Cobertura por faixa</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Distribuição dos itens por cobertura</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>Ajuda a separar risco de falta, excesso e itens sem consumo pela cobertura do mês atual.</p>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coberturaData} margin={{ top: 18, right: 18, left: 4, bottom: 32 }}>
                <XAxis dataKey="faixa" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<CoberturaFaixaTooltip />} />
                <Bar dataKey="itens" name="Itens" fill="#163B63" radius={[8, 8, 0, 0]} onClick={(row) => abrirListaDashboard(`Cobertura · ${row.faixa}`, "Itens agrupados pela cobertura do mês atual: estoque disponível + entradas do mês atual sobre demanda/forecast atual.", row.itens_lista || [], "#163B63")}>
                  <LabelList dataKey="itens" position="top" fontSize={12} fill="#163B63" formatter={(value: number) => value > 0 ? fmtNumber(value) : ""} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <DashboardSkuDetailModal state={drilldownDashboard} onClose={() => setDrilldownDashboard(null)} />

      <MatrizEstoqueGiroPanel itens={itensFiltradosDashboard} loading={loadingMatriz} onApplyFilter={(filtro) => aplicarFiltroComLinha(filtro)} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Itens críticos</p>
              <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Fila de ação</h2>
            </div>
            <button type="button" onClick={() => abrirListaDashboard("Itens críticos", "Lista completa dos itens críticos do recorte atual.", topCriticos, "#DC2626")} className="rounded-xl border px-3 py-2 text-xs font-bold transition hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Ver todos</button>
          </div>
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#163B63", color: "#FFFFFF" }}>
                <tr className="text-left text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-2">Código</th><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Linha</th><th className="px-3 py-2 text-right">Estoque</th><th className="px-3 py-2 text-right">Entradas mês</th><th className="px-3 py-2 text-right">Demanda</th>
                </tr>
              </thead>
              <tbody>
                {topCriticos.slice(0, 8).map((item) => (
                  <tr key={`${item.codigo}-${item.produto}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2 font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{(item as any).produto || "—"}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{(item as any).tipo_negocio || (item as any).grupo_gerencial || "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(getEstoqueAtualReal(item), 0)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(getEntradasMesAtualDashboard(item), 0)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(getDemandaTotalOperacionalDashboard(item), 0)}</td>
                  </tr>
                ))}
                {!topCriticos.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Sem itens críticos para o filtro selecionado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Excesso e capital parado</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Top excesso</h2>
          </div>
          <div className="space-y-3">
            {topExcesso.slice(0, 6).map((item) => (
              <button key={`${item.codigo}-excesso`} type="button" onClick={() => abrirListaDashboard(String((item as any).produto || item.codigo), "Detalhe do item selecionado no ranking de excesso.", [item], "#2563EB")} className="w-full rounded-2xl border p-3 text-left transition hover:bg-slate-50" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo} · {(item as any).produto}</p><p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>{(item as any).tipo_negocio || (item as any).grupo_gerencial || "Sem linha"}</p></div>
                  <span className="shrink-0 rounded-full px-2 py-1 text-[11px] font-bold" style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>{fmtCompact(getEstoqueAtualReal(item))}</span>
                </div>
              </button>
            ))}
            {!topExcesso.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Sem ranking de excesso para o filtro selecionado.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChartBox({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{title}</p>
        {subtitle && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}


function renderChartLabel(props: any) {
  const { x, y, width, height, value } = props
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0 || x == null || y == null) return null

  const hasBarBox = typeof width === "number" && typeof height === "number"

  if (hasBarBox) {
    const cx = Number(x) + Number(width) / 2
    const cy = Number(y) + Number(height) / 2
    const isNegative = n < 0

    return (
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={10}
        fontWeight={700}
        fill={isNegative ? "#991B1B" : "#334155"}
      >
        {fmtCompact(n)}
      </text>
    )
  }

  return (
    <text x={x} y={y - 8} textAnchor="middle" fontSize={10} fontWeight={700} fill="#334155">
      {fmtCompact(n)}
    </text>
  )
}

function renderChartLabelAberto(props: any) {
  const { x, y, width, height, value } = props
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0 || x == null || y == null) return null

  const texto = fmtNumber(n, 0)
  const hasBarBox = typeof width === "number" && typeof height === "number"

  if (hasBarBox) {
    const cx = Number(x) + Number(width) / 2
    const cy = Number(y) + Number(height) / 2
    const isNegative = n < 0

    return (
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={10}
        fontWeight={700}
        fill={isNegative ? "#991B1B" : "#334155"}
      >
        {texto}
      </text>
    )
  }

  return (
    <text x={x} y={y - 8} textAnchor="middle" fontSize={10} fontWeight={700} fill="#334155">
      {texto}
    </text>
  )
}

function renderChartLabelFinanceiro(props: any) {
  const { x, y, value } = props
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0 || x == null || y == null) return null

  return (
    <text x={x} y={y - 8} textAnchor="middle" fontSize={10} fontWeight={700} fill="#6D28D9">
      {fmtCurrency(n, 0)}
    </text>
  )
}

function LinhaTempoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const ponto = payload[0]?.payload || {}
  const entradas = Array.isArray(ponto.entradas_detalhe) ? ponto.entradas_detalhe : []

  const itensValidos = payload.filter((entry: any) => entry?.value !== null && entry?.value !== undefined)

  return (
    <div className="max-w-[380px] rounded-2xl border bg-white p-3 text-xs shadow-xl" style={{ borderColor: "var(--border)" }}>
      <p className="mb-2 font-bold" style={{ color: "var(--text-primary)" }}>Período: {label}</p>
      <div className="space-y-1">
        {itensValidos.map((entry: any) => {
          const isValor = entry.dataKey === "faturamento_valor"
          return (
            <div key={`${entry.dataKey}-${entry.name}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                {entry.name}
              </span>
              <span className="font-bold" style={{ color: "var(--text-primary)" }}>{isValor ? fmtCurrency(Number(entry.value), 0) : fmtNumber(Number(entry.value), 0)}</span>
            </div>
          )
        })}
      </div>


      {entradas.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <p className="mb-1 font-bold" style={{ color: "var(--text-primary)" }}>Entregas previstas</p>
          <div className="space-y-2">
            {entradas.slice(0, 5).map((pedido: any, idx: number) => (
              <div key={`${pedido.pedido_numero}-${pedido.sc_numero}-${idx}`} className="rounded-xl bg-slate-50 p-2">
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{pedido.pedido_numero || pedido.sc_numero || "Pedido sem número"}</span>
                  <span className="font-bold" style={{ color: "var(--text-primary)" }}>{fmtNumber(pedido.quantidade, 0)}</span>
                </div>
                <p className="mt-1" style={{ color: "var(--text-secondary)" }}>Entrega: {fmtDate(pedido.data_prevista_entrega)}</p>
                {pedido.fornecedor && <p className="mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>Fornecedor: {pedido.fornecedor}</p>}
              </div>
            ))}
            {entradas.length > 5 && <p style={{ color: "var(--text-secondary)" }}>+ {fmtNumber(entradas.length - 5)} entrega(s)</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function BraviSerieTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const ponto = payload[0]?.payload || {}
  const faturamento = Array.isArray(ponto.faturamento_detalhe) ? ponto.faturamento_detalhe : []
  const pedidos = Array.isArray(ponto.pedidos_detalhe) ? ponto.pedidos_detalhe : []
  const itensValidos = payload.filter((entry: any) => entry?.value !== null && entry?.value !== undefined)

  return (
    <div className="max-w-[380px] rounded-2xl border bg-white p-3 text-xs shadow-xl" style={{ borderColor: "var(--border)" }}>
      <p className="mb-2 font-bold" style={{ color: "var(--text-primary)" }}>Período: {ponto.periodo_completo || label}</p>
      <div className="space-y-1">
        {itensValidos.map((entry: any) => {
          const isValor = entry.dataKey === "faturamento_valor"
          return (
            <div key={`${entry.dataKey}-${entry.name}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                {entry.name}
              </span>
              <span className="font-bold" style={{ color: "var(--text-primary)" }}>{isValor ? fmtCurrency(Number(entry.value), 0) : fmtNumber(Number(entry.value), 0)}</span>
            </div>
          )
        })}
      </div>

      {faturamento.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <p className="mb-1 font-bold" style={{ color: "var(--text-primary)" }}>Faturamento SD2</p>
          <div className="max-h-[180px] space-y-1 overflow-auto pr-1">
            {faturamento.slice(0, 8).map((linha: any, idx: number) => (
              <div key={`${linha.codigo}-${linha.data}-${idx}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-2 py-1.5">
                <span style={{ color: "var(--text-secondary)" }}>{linha.codigo || "—"}</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmtNumber(Number(linha.quantidade || 0), 0)}</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmtCurrency(Number(linha.valor || 0), 0)}</span>
              </div>
            ))}
            {faturamento.length > 8 && <p style={{ color: "var(--text-secondary)" }}>+ {fmtNumber(faturamento.length - 8)} linha(s) de faturamento</p>}
          </div>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <p className="mb-1 font-bold" style={{ color: "var(--text-primary)" }}>Entradas previstas</p>
          <div className="space-y-2">
            {pedidos.slice(0, 5).map((pedido: any, idx: number) => (
              <div key={`${pedido.pedido_numero}-${pedido.sc_numero}-${idx}`} className="rounded-xl bg-slate-50 p-2">
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{pedido.pedido_numero || pedido.sc_numero || "Pedido sem número"}</span>
                  <span className="font-bold" style={{ color: "var(--text-primary)" }}>{fmtNumber(Number(pedido.quantidade || pedido.quantidade_pendente || 0), 0)}</span>
                </div>
                <p className="mt-1" style={{ color: "var(--text-secondary)" }}>Entrega: {fmtDate(pedido.data_prevista_entrega)}</p>
                {pedido.fornecedor && <p className="mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>Fornecedor: {pedido.fornecedor}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function seriePontoKey(ponto: any) {
  const ano = Number(ponto?.ano || 0)
  const mes = Number(ponto?.mes || 0)
  if (ano > 0 && mes > 0) return monthKey(ano, mes)
  return String(ponto?.ordem || ponto?.key || ponto?.periodo || "")
}

function periodoSerieEhDepoisInicio(ponto: any, inicioKey = "2025-06") {
  const key = seriePontoKey(ponto)
  if (!key) return false
  if (/^\d{4}-\d{2}/.test(key)) return key >= inicioKey

  const ano = Number(ponto?.ano || 0)
  const mes = Number(ponto?.mes || 0)
  if (ano > 0 && mes > 0) return monthKey(ano, mes) >= inicioKey

  return true
}

function filtrarSerieInicioGraficoPaMr(serie: any[], inicioKey = "2025-06") {
  return (serie || []).filter((ponto) => periodoSerieEhDepoisInicio(ponto, inicioKey))
}

function mesclarSerieBackendComFallback(serieBackend: any[], serieFallback: any[]) {
  const mapa = new Map<string, any>()

  for (const ponto of serieFallback || []) {
    const key = seriePontoKey(ponto)
    if (!key) continue
    mapa.set(key, { ...ponto })
  }

  for (const ponto of serieBackend || []) {
    const key = seriePontoKey(ponto)
    if (!key) continue
    const base = mapa.get(key) || {}
    const mesclado: any = { ...base, ...ponto }

    // Mantém forecast/demanda futuro do fallback quando a série real do backend
    // veio só com estoque/entrada/faturamento. Isso evita o gráfico perder a
    // visão futura após o cache real carregar.
    for (const campo of ["demanda", "forecast", "entradas_previstas", "estoque_projetado", "saldo_projetado"]) {
      if ((mesclado[campo] === null || mesclado[campo] === undefined || mesclado[campo] === 0) && base[campo] !== null && base[campo] !== undefined) {
        mesclado[campo] = base[campo]
      }
    }

    mapa.set(key, mesclado)
  }

  return Array.from(mapa.values()).sort((a, b) => String(seriePontoKey(a)).localeCompare(String(seriePontoKey(b))))
}


function BraviSeriePanel({
  active,
  refreshTick,
  selectedItem,
  onClearSelected,
  loadingSelected = false,
}: {
  active: boolean
  refreshTick: number
  selectedItem?: AgingEstoqueItemDetalhe | null
  onClearSelected?: () => void
  loadingSelected?: boolean
}) {
  const [granularidade, setGranularidade] = useState<GranularidadeSerie>("mensal")
  const [data, setData] = useState<BraviSerieResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [seriesOcultas, setSeriesOcultas] = useState<Set<string>>(new Set())

  const codigoSelecionado = selectedItem?.codigo || ""
  const itemSelecionado = selectedItem?.codigo ? selectedItem : null

  useEffect(() => {
    if (!active) return

    const codigoEsperado = codigoSelecionado

    // V32: mantém a troca de linha rápida, mas não abre mão da série real.
    // Primeiro monta um fallback instantâneo com a linha da tabela; depois busca a série do backend em segundo plano.
    // Como getBraviSerie usa cache local de 12h, a segunda vez que o item for aberto fica praticamente imediata.
    if (granularidade !== "mensal") {
      setGranularidade("mensal")
      return
    }

    if (itemSelecionado) {
      let mounted = true
      const itemNormalizado = normalizarCoberturaPaMrItem(itemSelecionado)
      const serieLocal = buildSerieOperacionalItemSelecionado(itemNormalizado)
      const statusItem = String((itemNormalizado as any).status || (itemNormalizado as any).status_estoque || "").toUpperCase()

      const fallbackItem: BraviSerieResponse = {
        granularidade: "mensal",
        total_itens_produtos: 1,
        total_itens_bravi: 1,
        codigos_produtos: codigoEsperado ? [codigoEsperado] : [],
        codigos_bravi: codigoEsperado ? [codigoEsperado] : [],
        item: {
          codigo: codigoEsperado,
          produto: String((itemNormalizado as any).produto || (itemNormalizado as any).descricao || "Item selecionado"),
          tipo: String((itemNormalizado as any).tipo || ""),
        },
        resumo: {
          estoque_atual: getEstoqueAtualReal(itemNormalizado),
          pedidos_abertos: getPedidosAbertos(itemNormalizado),
          faturamento_ytd_qtd: Number((itemNormalizado as any).faturamento_ytd_qtd || 0),
          faturamento_ytd_valor: Number((itemNormalizado as any).faturamento_ytd_valor || 0),
          criticos: ["RUPTURA", "CRITICO"].includes(statusItem) ? 1 : 0,
        },
        serie: serieLocal,
        debug: { modo: "item_pa_mr_fallback_tabela_v32" },
        backend_versao: "front_v32_fallback",
      }

      setData(fallbackItem)
      setError("")
      setLoading(true)

      getBraviSerie("mensal", codigoEsperado)
        .then((res) => {
          if (!mounted) return

          const codigoResposta = String(res?.item?.codigo || res?.codigos_produtos?.[0] || res?.codigos_bravi?.[0] || "")
          if (codigoResposta && codigoResposta !== codigoEsperado) return

          const serieBackend = Array.isArray(res?.serie) ? res.serie : []

          // Se por algum motivo o backend não devolver pontos, mantém o fallback da tabela
          // para não deixar o gráfico vazio.
          if (serieBackend.length === 0) {
            setData(fallbackItem)
            return
          }

          setData({
            ...res,
            granularidade: "mensal",
            total_itens_produtos: 1,
            total_itens_bravi: 1,
            codigos_produtos: codigoEsperado ? [codigoEsperado] : [],
            codigos_bravi: codigoEsperado ? [codigoEsperado] : [],
            item: {
              ...(res.item || {}),
              codigo: codigoEsperado,
              produto: String((itemNormalizado as any).produto || (itemNormalizado as any).descricao || res.item?.produto || "Item selecionado"),
              tipo: String((itemNormalizado as any).tipo || res.item?.tipo || ""),
            },
            resumo: {
              ...(res.resumo || {}),
              estoque_atual: getEstoqueAtualReal(itemNormalizado),
              pedidos_abertos: getPedidosAbertos(itemNormalizado),
              faturamento_ytd_qtd: Number((res.resumo?.faturamento_ytd_qtd ?? (itemNormalizado as any).faturamento_ytd_qtd) || 0),
              faturamento_ytd_valor: Number((res.resumo?.faturamento_ytd_valor ?? (itemNormalizado as any).faturamento_ytd_valor) || 0),
              criticos: ["RUPTURA", "CRITICO"].includes(statusItem) ? 1 : Number(res.resumo?.criticos || 0),
            },
            serie: serieBackend,
            debug: { ...(res.debug || {}), modo_front: "item_pa_mr_backend_cache_v32" },
          })
        })
        .catch((err: unknown) => {
          if (!mounted) return
          console.warn("Não foi possível carregar série real do item PA/MR; mantendo fallback da tabela", err)
          setError("")
          setData(fallbackItem)
        })
        .finally(() => {
          if (mounted) setLoading(false)
        })

      return () => { mounted = false }
    }

    let mounted = true
    setLoading(true)
    setError("")

    getBraviSerie("mensal")
      .then((res) => {
        if (!mounted) return
        setData(res)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar série PA/MR")
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => { mounted = false }
  }, [active, granularidade, refreshTick, codigoSelecionado, itemSelecionado])

  const toggleSerie = (dataKey?: string) => {
    if (!dataKey) return
    setSeriesOcultas((current) => {
      const next = new Set(current)
      if (next.has(dataKey)) next.delete(dataKey)
      else next.add(dataKey)
      return next
    })
  }

  const serieOculta = (dataKey: string) => seriesOcultas.has(dataKey)
  const dataEhDoItemSelecionado = !codigoSelecionado || String(data?.item?.codigo || data?.codigos_produtos?.[0] || data?.codigos_bravi?.[0] || "") === codigoSelecionado
  const serieOriginal = dataEhDoItemSelecionado ? (data?.serie || []) : []
  const resumoBase = dataEhDoItemSelecionado && data?.resumo
    ? data.resumo
    : itemSelecionado
      ? {
          estoque_atual: getEstoqueAtualReal(itemSelecionado),
          pedidos_abertos: getPedidosAbertos(itemSelecionado),
          faturamento_ytd_qtd: Number(itemSelecionado.faturamento_ytd_qtd || 0),
          faturamento_ytd_valor: Number(itemSelecionado.faturamento_ytd_valor || 0),
          criticos: ["RUPTURA", "CRITICO"].includes(String(itemSelecionado.status || itemSelecionado.status_estoque || "").toUpperCase()) ? 1 : 0,
        }
      : {}

  // Mesmo quando o backend da série retorna resumo, estoque/pedidos do item selecionado
  // precisam seguir a linha da tabela para não mostrar saldo bruto/série incorreta.
  const resumo = itemSelecionado
    ? {
        ...resumoBase,
        estoque_atual: getEstoqueAtualReal(itemSelecionado),
        pedidos_abertos: getPedidosAbertos(itemSelecionado),
      }
    : resumoBase

  const serie = useMemo(() => {
    const serieInicioKey = "2025-06"

    if (!itemSelecionado) {
      return filtrarSerieInicioGraficoPaMr(serieOriginal, serieInicioKey)
    }

    const fallbackSelecionado = buildSerieOperacionalItemSelecionado(normalizarCoberturaPaMrItem(itemSelecionado))
    const serieEntrada = filtrarSerieInicioGraficoPaMr(
      mesclarSerieBackendComFallback(serieOriginal, fallbackSelecionado),
      serieInicioKey,
    )

    const hoje = new Date()
    const anoAtual = hoje.getFullYear()
    const mesAtual = hoje.getMonth() + 1
    const diaAtual = hoje.toISOString().slice(0, 10)
    const ordemMensalAtual = `${anoAtual}-${String(mesAtual).padStart(2, "0")}`

    // Para o gráfico por item PA/MR, o estoque precisa vir da mesma linha da tabela.
    // O resumo do endpoint de série pode trazer valor de série/posição diferente e estava gerando 1.052 no SUGCLEAN.
    const estoqueTabela = getEstoqueAtualReal(itemSelecionado)
    const estoqueAtual = Number(Number.isFinite(estoqueTabela) ? estoqueTabela : (resumo.estoque_atual ?? 0))
    const pontos = serieEntrada.map((ponto: any) => {
      const ordem = String(ponto?.ordem || ponto?.key || "")
      const dataInicio = String(ponto?.data_inicio || ordem || "")
      const dataFim = String(ponto?.data_fim || dataInicio || "")

      const isAtual = granularidade === "mensal"
        ? ordem === ordemMensalAtual
        : granularidade === "semanal"
          ? dataInicio <= diaAtual && diaAtual <= dataFim
          : ordem === diaAtual || dataInicio === diaAtual

      const isFuturo = granularidade === "mensal"
        ? ordem > ordemMensalAtual
        : dataInicio > diaAtual

      const pontoSaida: any = {
        ...ponto,
        estoque: null,
        estoque_medio: null,
        estoque_projetado: null,
        estoque_quarentena: null,
        quarentena: null,
        saldo_quarentena: null,
      }

      if (isAtual) {
        pontoSaida.estoque = estoqueAtual > 0 ? estoqueAtual : null
        pontoSaida.estoque_medio = estoqueAtual > 0 ? estoqueAtual : null
        pontoSaida.estoque_quarentena = null
        pontoSaida.quarentena = null
        pontoSaida.saldo_quarentena = null
        pontoSaida.tipo_estoque = "atual"
      } else if (isFuturo) {
        // Estoque real continua sendo apenas o PA disponível em 04/07.
        // A linha projetada considera entradas previstas/PI Bravi e subtrai forecast futuro,
        // sem transformar PI do armazém 10 em estoque real.
        pontoSaida.estoque = null
        pontoSaida.estoque_medio = null
        pontoSaida.tipo_estoque = "projetado"
      }

      return pontoSaida
    })

    let saldoProjetado = Math.max(0, estoqueAtual)

    const pontosOrdenados = [...pontos].sort((a: any, b: any) => {
      const ordemA = String(a?.ordem || a?.key || "")
      const ordemB = String(b?.ordem || b?.key || "")
      return ordemA.localeCompare(ordemB)
    })

    for (const ponto of pontosOrdenados) {
      const ordem = String(ponto?.ordem || ponto?.key || "")
      const dataInicio = String(ponto?.data_inicio || ordem || "")
      const isAtual = granularidade === "mensal"
        ? ordem === ordemMensalAtual
        : ordem === diaAtual || dataInicio === diaAtual
      const isFuturo = granularidade === "mensal"
        ? ordem > ordemMensalAtual
        : dataInicio > diaAtual

      const entradas = Math.max(0, Number(ponto.entradas_previstas || 0))
      const demanda = Math.max(0, Number(ponto.demanda || ponto.forecast || 0))

      if (isAtual) {
        // Regra visual: entradas do mês atual viram base para o saldo projetado futuro.
        // Não descontamos o forecast do mês corrente para evitar misturar realizado parcial com previsão mensal.
        saldoProjetado = Math.max(0, saldoProjetado + entradas)
        ponto.saldo_projetado = null
        ponto.estoque_projetado = null
        continue
      }

      if (isFuturo) {
        saldoProjetado = Math.max(0, saldoProjetado + entradas - demanda)
        ponto.saldo_projetado = saldoProjetado
        ponto.estoque_projetado = saldoProjetado > 0 ? saldoProjetado : null
      }
    }

    return pontos
  }, [serieOriginal, itemSelecionado, resumo.estoque_atual, granularidade])
  const tituloSerie = itemSelecionado
    ? `${itemSelecionado.codigo} · ${itemSelecionado.produto || "Item selecionado"}${loading ? " · atualizando série" : ""}`
    : loading
      ? "Visão geral PA / MR · carregando consolidado..."
      : "Visão geral PA / MR"
  const descricaoSerie = itemSelecionado
    ? "Ao clicar no item, a tela mostra uma visão rápida pela linha da tabela e carrega a série real em segundo plano com cache local de 12 horas. Para voltar ao consolidado, clique em Ver todo."
    : "Consolidado mensal de todos os PA/MR. O primeiro carregamento pode demorar, mas depois fica salvo em cache local por 12 horas."

  const eixoMaxComum = useMemo(() => {
    const maiorValor = serie.reduce((max, ponto: any) => {
      const estoqueDisponivel = serieOculta("estoque") ? 0 : Math.max(0, Number(ponto.estoque || 0))
      const estoqueProjetado = serieOculta("estoque_projetado") ? 0 : Math.max(0, Number(ponto.estoque_projetado || ponto.saldo_projetado || 0))
      const entradasPrevistas = serieOculta("entradas_previstas") ? 0 : Math.max(0, Number(ponto.entradas_previstas || 0))
      const faturamento = serieOculta("faturamento_qtd") ? 0 : Math.max(0, Number(ponto.faturamento_qtd || 0))
      const forecast = serieOculta("demanda") ? 0 : Math.max(0, Number(ponto.demanda || ponto.forecast || 0))
      const disponibilidade = estoqueDisponivel + entradasPrevistas

      return Math.max(max, disponibilidade, estoqueProjetado, faturamento, forecast)
    }, 0)

    return arredondarEixoMaximo(maiorValor)
  }, [serie, seriesOcultas])

  if (!active) return null

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b px-5 py-4 lg:flex-row lg:items-start" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Acompanhamento PA / MR</p>
          <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>{tituloSerie}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {descricaoSerie}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {itemSelecionado && (
            <button
              type="button"
              onClick={onClearSelected}
              className="rounded-xl border px-3 py-2 text-sm font-bold transition hover:bg-slate-50"
              style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)", color: "#B91C1C" }}
            >
              Ver todo
            </button>
          )}
          {([
            ["mensal", "Mensal"],
            ["semanal", "Semanal"],
            ["diaria", "Diária"],
          ] as [GranularidadeSerie, string][]).map(([key, label]) => {
            const disabled = key !== "mensal"
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setGranularidade(key)}
                title={disabled ? "Nesta visão PA/MR, o gráfico fica mensal para manter performance e troca rápida de item." : undefined}
                className="rounded-xl border px-3 py-2 text-sm font-bold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  borderColor: granularidade === key ? "#163B63" : "var(--border)",
                  background: granularidade === key ? "rgba(22,59,99,0.08)" : "#FFFFFF",
                  color: granularidade === key ? "#163B63" : "var(--text-primary)",
                }}
              >
                {label}
              </button>
            )
          })}
          {loading && (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>
              <RefreshCw size={13} className="animate-spin" /> Atualizando
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {error && <div className="rounded-2xl border px-4 py-3 text-sm text-red-600" style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>{error}</div>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <KpiSmall label={itemSelecionado ? "Item selecionado" : "Itens PA/MR"} value={itemSelecionado ? "1" : fmtNumber(data?.total_itens_produtos || data?.total_itens_bravi || 0)} />
          <KpiSmall label="Estoque atual" value={fmtCompact(resumo.estoque_atual)} />
          <KpiSmall label="Pedidos" value={fmtCompact(resumo.pedidos_abertos)} />
          <KpiSmall label="Fat. 2026 qtd" value={fmtCompact(resumo.faturamento_ytd_qtd)} />
          <KpiSmall label="Fat. 2026 R$" value={fmtCurrency(Number(resumo.faturamento_ytd_valor || 0), 0)} />
          <KpiSmall label="Críticos" value={fmtNumber(resumo.criticos || 0)} />
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Série PA / MR</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Histórico a partir de Jun/25, forecast futuro e entradas previstas por MPS/compras.
              </p>
            </div>
            <span className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: "rgba(124,58,237,0.28)", color: "#6D28D9", background: "rgba(124,58,237,0.08)" }}>
              {loading ? (itemSelecionado ? "Atualizando série" : "Carregando visão geral") : itemSelecionado ? "Item selecionado" : "Visão geral"}
            </span>
          </div>

          <div className="h-[500px]">
            {serie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 30, right: 26, left: 0, bottom: 34 }}>
                  {/* Grade removida para deixar o gráfico mais limpo. */}
                  <XAxis
                    dataKey="periodo"
                    angle={-35}
                    textAnchor="end"
                    height={72}
                    interval={granularidade === "diaria" ? "preserveStartEnd" : 0}
                    tick={{ fontSize: 10, fill: "#64748B" }}
                  />
                  <YAxis
                    yAxisId="estoque"
                    orientation="left"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    width={80}
                    domain={[0, eixoMaxComum]}
                    allowDataOverflow={false}
                    tickFormatter={(value) => fmtNumber(Number(value), 0)}
                    label={{ value: "Estoque + entradas", angle: -90, position: "insideLeft", style: { fill: "#64748B", fontSize: 11 } }}
                  />
                  <YAxis
                    yAxisId="fluxo"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    width={80}
                    domain={[0, eixoMaxComum]}
                    allowDataOverflow={false}
                    tickFormatter={(value) => fmtNumber(Number(value), 0)}
                    label={{ value: "Faturamento / forecast", angle: 90, position: "insideRight", style: { fill: "#64748B", fontSize: 11 } }}
                  />
                  <YAxis yAxisId="valor" hide />
                  <Tooltip content={<BraviSerieTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                    onClick={(entry: any) => toggleSerie(String(entry?.dataKey || ""))}
                  />

                  <Bar
                    yAxisId="estoque"
                    stackId="disponibilidade"
                    dataKey="estoque"
                    name="Estoque disponível"
                    fill="#163B63"
                    fillOpacity={0.82}
                    radius={[6, 6, 0, 0]}
                    hide={serieOculta("estoque")}
                  >
                    <LabelList dataKey="estoque" content={renderChartLabelAberto} />
                  </Bar>

                  <Bar
                    yAxisId="estoque"
                    dataKey="estoque_projetado"
                    name="Estoque projetado"
                    fill="#BFDBFE"
                    fillOpacity={0.45}
                    stroke="#60A5FA"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    radius={[6, 6, 0, 0]}
                    hide={!itemSelecionado || serieOculta("estoque_projetado")}
                  >
                    <LabelList dataKey="estoque_projetado" content={renderChartLabelAberto} />
                  </Bar>

                  <Bar
                    yAxisId="estoque"
                    stackId="disponibilidade"
                    dataKey="entradas_previstas"
                    name="Entradas previstas"
                    fill="#F59E0B"
                    fillOpacity={0.18}
                    stroke="#B45309"
                    strokeDasharray="4 3"
                    radius={[6, 6, 0, 0]}
                    hide={serieOculta("entradas_previstas")}
                  >
                    <LabelList dataKey="entradas_previstas" content={renderChartLabelAberto} />
                  </Bar>

                  <Line
                    yAxisId="fluxo"
                    type="monotone"
                    dataKey="faturamento_qtd"
                    name="Faturamento SD2 (qtd)"
                    stroke="#0F766E"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    hide={serieOculta("faturamento_qtd")}
                  >
                    <LabelList dataKey="faturamento_qtd" content={renderChartLabelAberto} />
                  </Line>

                  <Line
                    yAxisId="fluxo"
                    type="monotone"
                    dataKey="demanda"
                    name="Forecast / demanda"
                    stroke="#DC2626"
                    strokeWidth={2.8}
                    strokeDasharray="5 4"
                    dot={{ r: 2 }}
                    connectNulls={false}
                    hide={serieOculta("demanda")}
                  >
                    <LabelList dataKey="demanda" content={renderChartLabelAberto} />
                  </Line>

                  <Line
                    yAxisId="valor"
                    type="monotone"
                    dataKey="faturamento_valor"
                    name="Faturamento SD2 (R$)"
                    stroke="#9333EA"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={{ r: 2 }}
                    connectNulls={false}
                    hide={serieOculta("faturamento_valor")}
                  >
                    <LabelList dataKey="faturamento_valor" content={renderChartLabelFinanceiro} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-secondary)" }}>
                {loading ? (codigoSelecionado ? "Montando visão rápida e buscando série real..." : "Carregando visão geral PA/MR...") : codigoSelecionado ? "Sem série disponível para este item." : "Sem série consolidada disponível para PA/MR."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


function FiltrosEstoquePanel({
  filtro,
  opcoes,
  escopo,
  onChange,
  onClear,
}: {
  filtro: FiltroTabelaEstoque | null
  opcoes?: AgingResumoResponse["opcoes"]
  escopo: EscopoEstoque
  onChange: (campo: keyof FiltroTabelaEstoque, value?: string) => void
  onClear: () => void
}) {
  const statusOptions = [
    "TODOS",
    "RUPTURA",
    "CRITICO",
    "ATENCAO",
    "SAUDAVEL",
    "EXCESSO",
    "SEM_GIRO",
    "SEM_CONSUMO",
    "DESCONTINUADO_COM_SALDO",
  ]

  const tipoNegocioOptions = ["TODOS", ...(opcoes?.tipo_negocio || [])]
  const statusPortfolioOptions = ["TODOS", ...(opcoes?.status_portfolio || [])]
  const braviOptions = ["TODOS", "Sim", "Não"]
  const classificacaoOptions = ["TODOS", "MAPEADOS", "DIMENSAO", "BOM", "NAO_CLASSIFICADOS"]
  const semaforoOptions: ("TODOS" | SemaforoEstoque)[] = ["TODOS", "VERMELHO", "AMARELO", "VERDE", "CINZA"]

  const selectClass = "h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-[#163B63]/20"
  const labelClass = "mb-1 block text-[10px] font-bold uppercase tracking-wide"
  const [buscaDraft, setBuscaDraft] = useState(filtro?.busca || "")

  useEffect(() => {
    setBuscaDraft(filtro?.busca || "")
  }, [filtro?.busca])

  const aplicarBuscaRapida = () => {
    onChange("busca", buscaDraft.trim() || undefined)
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter size={18} style={{ color: "var(--text-secondary)" }} />
          <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            Filtros
          </h2>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition hover:bg-slate-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          <X size={15} /> Limpar filtros
        </button>
      </div>

      <div
        className="grid grid-cols-1 items-end gap-3 border-t pt-4 md:grid-cols-2 xl:grid-cols-[minmax(300px,2.1fr)_minmax(120px,0.8fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(100px,0.7fr)_minmax(140px,0.85fr)]"
        style={{ borderColor: "var(--border)" }}
      >
        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Código ou produto</span>
          <div className="flex gap-2">
            <input
              value={buscaDraft}
              onChange={(e) => setBuscaDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") aplicarBuscaRapida()
              }}
              placeholder="Buscar código, nome, família, segmento..."
              className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-[#163B63]/20"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
            <button
              type="button"
              onClick={aplicarBuscaRapida}
              className="h-10 rounded-xl border px-3 text-sm font-bold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Buscar
            </button>
          </div>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Linha</span>
          <select
            value={filtro?.tipo_negocio || "TODOS"}
            onChange={(e) => onChange("tipo_negocio", e.target.value === "TODOS" ? undefined : e.target.value)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {tipoNegocioOptions.map((opcao) => <option key={opcao} value={opcao}>{opcao === "TODOS" ? "Todas" : opcao}</option>)}
          </select>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Status estoque</span>
          <select
            value={filtro?.status || "TODOS"}
            onChange={(e) => onChange("status", e.target.value === "TODOS" ? undefined : e.target.value)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {statusOptions.map((opcao) => <option key={opcao} value={opcao}>{STATUS_LABEL[opcao] || opcao}</option>)}
          </select>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Status visual</span>
          <select
            value={filtro?.semaforo || "TODOS"}
            onChange={(e) => onChange("semaforo", e.target.value === "TODOS" ? undefined : e.target.value as SemaforoEstoque)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {semaforoOptions.map((opcao) => <option key={opcao} value={opcao}>{opcao === "TODOS" ? "Todos" : SEMAFORO_LABEL[opcao]}</option>)}
          </select>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Status portfólio</span>
          <select
            value={filtro?.status_portfolio || "TODOS"}
            onChange={(e) => onChange("status_portfolio", e.target.value === "TODOS" ? undefined : e.target.value)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {statusPortfolioOptions.map((opcao) => <option key={opcao} value={opcao}>{opcao === "TODOS" ? "Todos" : opcao}</option>)}
          </select>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Bravi</span>
          <select
            value={filtro?.transferencia_bravi || "TODOS"}
            onChange={(e) => onChange("transferencia_bravi", e.target.value === "TODOS" ? undefined : e.target.value)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {braviOptions.map((opcao) => <option key={opcao} value={opcao}>{opcao === "TODOS" ? "Todos" : opcao}</option>)}
          </select>
        </label>

        <label>
          <span className={labelClass} style={{ color: "var(--text-secondary)" }}>Classificação</span>
          <select
            value={filtro?.classificacao_cadastro || "TODOS"}
            onChange={(e) => onChange("classificacao_cadastro", e.target.value === "TODOS" ? undefined : e.target.value)}
            className={selectClass}
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {classificacaoOptions.map((opcao) => (
              <option key={opcao} value={opcao}>
                {opcao === "TODOS" ? "Todos" : opcao === "MAPEADOS" ? "Mapeados" : opcao === "NAO_CLASSIFICADOS" ? "Não classificados" : opcao}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function BasesModal({
  open,
  onClose,
  ultimasAtualizacoes,
  loadingAtualizacoes,
  uploadingBaseId,
  uploadMessage,
  onUpload,
  onRefresh,
}: {
  open: boolean
  onClose: () => void
  ultimasAtualizacoes: Record<string, string | null | undefined>
  loadingAtualizacoes: boolean
  uploadingBaseId: string | null
  uploadMessage: string
  onUpload: (baseId: string, file: File) => void
  onRefresh: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-[min(96vw,1440px)] flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Bases da análise</p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>Gestão de Estoque</h2>
            <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--text-secondary)" }}>
              Use este painel para atualizar somente as bases necessárias para o aging. Bases compartilhadas atualizam automaticamente as outras páginas que usam a mesma tabela.
            </p>
          </div>
          <button className="rounded-xl p-2 hover:bg-slate-100" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {uploadMessage && (
            <div className="mb-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "rgba(37,99,235,0.06)" }}>
              {uploadMessage}
            </div>
          )}

          <div className="mb-4 flex flex-col justify-between gap-3 rounded-2xl border p-4 md:flex-row md:items-center" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Racional das bases</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Posição de estoque é a base principal. Forecast S&OP + BOM geram demanda de insumos. Lead Time e MOQ completam a política de estoque; custo unitário completa o aging do Excel.
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loadingAtualizacoes}
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition hover:bg-white disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <RefreshCw size={14} className={loadingAtualizacoes ? "animate-spin" : ""} />
              Atualizar status
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {BASES_GESTAO_ESTOQUE.map((base) => {
              const ultima = ultimasAtualizacoes[base.id]
              const carregando = loadingAtualizacoes && ultima === undefined
              const uploading = uploadingBaseId === base.id
              const inputId = `upload-${base.id}`

              return (
                <div key={base.id} className="flex min-h-[330px] flex-col rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
                  <div className="flex min-h-[82px] items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{base.titulo}</h3>
                        {base.obrigatoria && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}>Obrigatória</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{base.descricao}</p>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl" style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>
                      <Database size={17} />
                    </div>
                  </div>

                  <div className="mt-3 min-h-[116px] rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Uso na tela</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-primary)" }}>{base.uso}</p>
                    {base.compartilhada && <p className="mt-2 text-[11px] font-semibold" style={{ color: "#1D4ED8" }}>{base.compartilhada}</p>}
                  </div>

                  <div className="mt-auto pt-4">
                    <div className="mb-4 flex min-h-[34px] items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <CheckCircle2 size={14} className={ultima ? "text-emerald-600" : "text-slate-400"} />
                      <span>
                        {carregando
                          ? "Consultando última atualização..."
                          : ultima
                            ? `Atualizado em ${fmtDateTime(ultima)}`
                            : "Ainda sem carga registrada"}
                      </span>
                    </div>

                    <input
                      id={inputId}
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls,.xlsm"
                      disabled={uploadingBaseId !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        if (file) onUpload(base.id, file)
                      }}
                    />
                    <label
                      htmlFor={inputId}
                      className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition ${uploadingBaseId !== null ? "pointer-events-none opacity-60" : "hover:brightness-95"}`}
                      style={{ background: "#163B63" }}
                    >
                      {uploading ? <RefreshCw size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                      {uploading ? "Carregando..." : "Subir arquivo"}
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function ItemDrawer({ item, loading, onClose }: { item: AgingEstoqueItemDetalhe | null; loading: boolean; onClose: () => void }) {
  if (!item && !loading) return null

  const sb8Diario = item?.historico_sb8_diario || []
  const linhaTempoEstoque = item?.linha_tempo_estoque || []
  const pedidos = item?.pedidos || []
  const forecastMetodo =
    String(item?.forecast_metodo || "").includes("direto")
      ? "Forecast direto do código"
      : String(item?.forecast_metodo || "").includes("bom")
        ? "Forecast explodido via BOM"
        : "Forecast não identificado"

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div className="h-full w-full max-w-[980px] overflow-y-auto border-l bg-white p-6 shadow-2xl" style={{ borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
        {loading || !item ? (
          <div className="card p-8 text-sm" style={{ color: "var(--text-secondary)" }}>Carregando detalhe do item...</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Detalhe do item</p>
                <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo} · {item.produto || "Sem descrição"}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status_estoque || item.status} />
                  {item.tipo_negocio && <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>{item.tipo_negocio}</span>}
                  {item.status_portfolio && <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>{item.status_portfolio}</span>}
                  {item.transferencia_bravi === "Sim" && <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "rgba(124,58,237,0.28)", color: "#6D28D9", background: "rgba(124,58,237,0.08)" }}>Bravi</span>}
                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>{forecastMetodo}</span>
                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }} title={getSaldoOrigemTitle(item as unknown as Record<string, unknown>)}>{getSaldoOrigemLabel(item as unknown as Record<string, unknown>)}</span>
                </div>
              </div>
              <button className="rounded-xl p-2 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiSmall label="Saldo disponível" value={fmtCompact(item.saldo)} />
              <KpiSmall label="Saldo bruto SB8" value={fmtCompact(getAnyNumber(item as unknown as Record<string, unknown>, "saldo_sb8_bruto"))} />
              <KpiSmall label="Empenho lote" value={fmtCompact(getAnyNumber(item as unknown as Record<string, unknown>, "empenho_lote"))} />
              <KpiSmall label="Origem saldo" value={getSaldoOrigemLabel(item as unknown as Record<string, unknown>)} />
              <KpiSmall label="Pedidos" value={fmtCompact(item.qtd_pedidos_abertos)} />
              <KpiSmall label="Estoque + pedidos" value={fmtCompact(item.estoque_mais_pedidos)} />
              <KpiSmall label="Cobertura futura" value={`${fmtNumber(item.cobertura_futura_dias, 0)} d`} />
              <KpiSmall label="Maior média" value={fmtCompact(item.maior_media)} />
              <KpiSmall label="Lead time" value={`${fmtNumber(item.lead_time_dias, 0)} d`} />
              <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
              <KpiSmall label="Estoque ideal" value={fmtCompact(item.estoque_ideal)} />
              <KpiSmall label="Tipo negócio" value={item.tipo_negocio || "—"} />
              <KpiSmall label="Grupo gerencial" value={item.grupo_gerencial || "—"} />
              <KpiSmall label="Modelo" value={item.modelo_fornecimento || "—"} />
              <KpiSmall label="Demanda mês" value={fmtCompact((item as AgingEstoqueItem & Record<string, unknown>).demanda_mes_atual as number)} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5">
              <ChartBox title="SB8 diário do mês atual" subtitle="Saldo disponível considera somente armazéns 04/07 descontando empenho.">
                <div className="h-[260px]">
                  {sb8Diario.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={sb8Diario}
                        margin={{ top: 28, right: 18, left: 0, bottom: 24 }}
                        barCategoryGap="45%"
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis
                          dataKey="data"
                          tickFormatter={(value) => String(value).slice(8, 10)}
                          tick={{ fontSize: 11, fill: "#64748B" }}
                        />
                        <YAxis tick={{ fontSize: 11, fill: "#64748B" }} width={64} />
                        <Tooltip
                          labelFormatter={(value) => fmtDate(String(value))}
                          formatter={(value: any, name: any) => [
                            fmtNumber(Number(value), 0),
                            name === "saldo_normal"
                              ? "Saldo disponível 04/07"
                              : name === "saldo_bruto"
                                  ? "Saldo bruto SB8"
                                  : name === "empenho_lote"
                                    ? "Empenho lote"
                                    : String(name),
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          dataKey="saldo_normal"
                          name="Saldo disponível 04/07"
                          stackId="sb8"
                          fill="#163B63"
                          barSize={46}
                          radius={[0, 0, 6, 6]}
                        >
                          <LabelList
                            dataKey="saldo_normal"
                            position="insideTop"
                            formatter={(value: any) => fmtCompact(Number(value))}
                            style={{ fontSize: 11, fontWeight: 700, fill: "#FFFFFF" }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-secondary)" }}>Sem histórico SB8 no mês atual para este item.</div>
                  )}
                </div>
              </ChartBox>

              <ChartBox title="Linha do tempo do item" subtitle="Consumo histórico, demanda via forecast/BOM, estoque atual, estoque com pedidos e saldo projetado simplificado.">
                <div className="h-[340px]">
                  {linhaTempoEstoque.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={linhaTempoEstoque} margin={{ top: 8, right: 22, left: 0, bottom: 42 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="periodo" angle={-35} textAnchor="end" height={58} interval={0} tick={{ fontSize: 10, fill: "#64748B" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#64748B" }} width={70} />
                        <Tooltip
                          formatter={(value: any, name: any) => [value == null ? "—" : fmtNumber(Number(value), 0), name]}
                          labelFormatter={(value) => `Período: ${value}`}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="consumo" name="Consumo histórico" stroke="#DC2626" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="demanda" name="Demanda forecast/BOM" stroke="#16A34A" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="entradas_previstas" name="Entradas previstas" stroke="#F59E0B" strokeWidth={2} strokeDasharray="3 4" dot={{ r: 2 }} connectNulls />
                        <Line type="monotone" dataKey="estoque_atual" name="Estoque atual" stroke="#163B63" strokeWidth={2.5} dot={false} connectNulls />
                        <Line type="monotone" dataKey="estoque_mais_pedidos" name="Estoque + pedidos" stroke="#2563EB" strokeWidth={2.5} dot={false} connectNulls />
                        <Line type="monotone" dataKey="saldo_projetado" name="Saldo projetado" stroke="#7C3AED" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-secondary)" }}>Sem série mensal disponível para este item.</div>
                  )}
                </div>
              </ChartBox>
            </div>

            <div className="mt-6 card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Racional do estoque ideal</p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>Estoque ideal = maior entre consumo durante o lead time e pedido mínimo/MOQ.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiSmall label="Consumo durante LT" value={fmtCompact(item.consumo_durante_lt)} />
                <KpiSmall label="Qtd. mínima" value={fmtCompact(item.qtd_minima)} />
                <KpiSmall label="Gap vs ideal" value={fmtCompact(item.gap_volume)} />
              </div>
            </div>

            <div className="mt-6 card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Pedidos em aberto</p>
              {!pedidos.length ? (
                <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum pedido aberto encontrado para este item.</p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-white" style={{ background: "#163B63" }}>
                      <tr>
                        <th className="px-3 py-2">Pedido/SC</th>
                        <th className="px-3 py-2 text-right">Qtd.</th>
                        <th className="px-3 py-2">Entrega</th>
                        <th className="px-3 py-2">Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidos.map((p, idx) => (
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

function TimelinePrincipal({
  item,
  loading,
  horizonteFuturo,
  onHorizonteChange,
}: {
  item: AgingEstoqueItemDetalhe | null
  loading: boolean
  horizonteFuturo: number
  onHorizonteChange: (value: number) => void
}) {
  // Monta a série visual diretamente a partir do detalhe do item.
  // Motivo: alguns backends antigos devolvem linha_tempo_estoque sem consumo,
  // enquanto historico_consumo vem correto. Para o gráfico operacional,
  // a fonte mais confiável do consumo mensal é sempre historico_consumo.
  const linhaTempoMensal = buildLinhaTempoFallback(item, horizonteFuturo)
  const [granularidadeTimeline, setGranularidadeTimeline] = useState<GranularidadeSerie>("mensal")
  const linhaTempo = granularidadeTimeline === "diaria"
    ? buildLinhaTempoDiaria(item)
    : granularidadeTimeline === "semanal"
      ? buildLinhaTempoSemanal(item)
      : linhaTempoMensal
  const pedidos = item?.pedidos || []
  const [seriesOcultas, setSeriesOcultas] = useState<Set<string>>(new Set())
  const toggleSerie = (dataKey?: string) => {
    if (!dataKey) return
    setSeriesOcultas((current) => {
      const next = new Set(current)
      if (next.has(dataKey)) next.delete(dataKey)
      else next.add(dataKey)
      return next
    })
  }
  const serieOculta = (dataKey: string) => seriesOcultas.has(dataKey)
  const anoAtual = new Date().getFullYear()
  const consumoAnoAtual = linhaTempoMensal
    .filter((p) => Number(p.ano) === anoAtual)
    .reduce((acc, p) => acc + Number(p.consumo || 0), 0)
  const pontoPedidoAtual = Number(item?.consumo_durante_lt || 0) || 0

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b px-5 py-4 md:flex-row md:items-start" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Linha do tempo</p>
          <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {item ? `${item.codigo} · ${item.produto || "Item selecionado"}` : "Selecione um item na tabela"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Consumo histórico, demanda MPS/BOM, entradas previstas, estoque disponível e ponto de pedido.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item && <StatusBadge status={item.status_estoque || item.status} />}
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Visão
            <select
              value={granularidadeTimeline}
              onChange={(event) => setGranularidadeTimeline(event.target.value as GranularidadeSerie)}
              className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold normal-case tracking-normal"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <option value="mensal">Mensal</option>
              <option value="semanal">Semanal</option>
              <option value="diaria">Diária</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Horizonte futuro
            <select
              value={horizonteFuturo}
              onChange={(event) => onHorizonteChange(Number(event.target.value))}
              className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold normal-case tracking-normal"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <option value={3}>3 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
          </label>
        </div>
      </div>

      {!item ? (
        <div className="flex min-h-[320px] items-center justify-center px-5 py-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          Clique em uma linha da tabela para visualizar a evolução do item e a projeção dos próximos meses.
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
            <KpiSmall label="Saldo atual" value={fmtCompact(item.saldo)} />
            <KpiSmall label="Empenho lote" value={fmtCompact(getAnyNumber(item as unknown as Record<string, unknown>, "empenho_lote"))} />
            <KpiSmall label="Pedidos" value={fmtCompact(item.qtd_pedidos_abertos)} />
            <KpiSmall label="Estoque + pedidos" value={fmtCompact(item.estoque_mais_pedidos)} />
            <KpiSmall label="Maior média" value={fmtCompact(item.maior_media)} />
            <KpiSmall label="Ponto pedido" value={fmtCompact(pontoPedidoAtual)} />
            <KpiSmall label={`Consumo ${anoAtual}`} value={fmtCompact(consumoAnoAtual)} />
            <KpiSmall label="Gap" value={fmtCompact(item.gap_volume)} />
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{granularidadeTimeline === "mensal" ? "Evolução mensal" : granularidadeTimeline === "semanal" ? "Evolução semanal" : "Evolução diária"}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Na visão mensal, a demanda vem do MPS V1 / L1 + L2 explodido via BOM. Na visão semanal/diária, o foco é acompanhar o saldo disponível do insumo.
                </p>
              </div>
              {loading && (
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>
                  <RefreshCw size={13} className="animate-spin" /> Atualizando histórico / demanda
                </span>
              )}
            </div>

            <div className="h-[380px]">
              {linhaTempo.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={linhaTempo} margin={{ top: 24, right: 16, left: 0, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="periodo" angle={-35} textAnchor="end" height={68} interval={0} tick={{ fontSize: 10, fill: "#64748B" }} />
                    <YAxis
                      yAxisId="estoque"
                      orientation="left"
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      width={78}
                      label={{ value: "Quantidade / saldo", angle: -90, position: "insideLeft", style: { fill: "#64748B", fontSize: 11 } }}
                    />
                    <YAxis yAxisId="valor" hide />
                    <Tooltip content={<LinhaTempoTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                      onClick={(entry: any) => toggleSerie(String(entry?.dataKey || ""))}
                    />

                    <Bar
                      yAxisId="estoque"
                      dataKey="saldo_grafico"
                      name="Saldo disponível/projetado"
                      stackId="estoque"
                      radius={[6, 6, 0, 0]}
                      hide={serieOculta("saldo_grafico")}
                    >
                      {linhaTempo.map((entry, idx) => {
                        const saldo = Number(entry?.saldo_grafico || 0)
                        const negativo = saldo < 0
                        return (
                          <Cell
                            key={`saldo-${idx}`}
                            fill={negativo ? "rgba(248, 113, 113, 0.28)" : "rgba(22, 59, 99, 0.22)"}
                            stroke={negativo ? "#FCA5A5" : "#163B63"}
                            strokeOpacity={negativo ? 1 : 0.45}
                          />
                        )
                      })}
                      <LabelList dataKey="saldo_grafico" content={renderChartLabel} />
                    </Bar>
                    <Bar
                      yAxisId="estoque"
                      dataKey="entradas_previstas"
                      name="Entradas previstas"
                      stackId="estoque"
                      fill="#F97316"
                      fillOpacity={0.24}
                      stroke="#C2410C"
                      strokeDasharray="4 3"
                      radius={[6, 6, 0, 0]}
                      hide={serieOculta("entradas_previstas")}
                    >
                      <LabelList dataKey="entradas_previstas" content={renderChartLabel} />
                    </Bar>

                    <Line yAxisId="estoque" type="monotone" dataKey="consumo" name="Consumo histórico" stroke="#DC2626" strokeWidth={3} dot={{ r: 3 }} connectNulls hide={serieOculta("consumo")}>
                      <LabelList dataKey="consumo" content={renderChartLabel} />
                    </Line>
                    <Line yAxisId="estoque" type="monotone" dataKey="demanda" name="Demanda MPS/BOM" stroke="#16A34A" strokeWidth={3} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls hide={serieOculta("demanda")}>
                      <LabelList dataKey="demanda" content={renderChartLabel} />
                    </Line>
                    <Line yAxisId="estoque" type="monotone" dataKey="ponto_pedido" name="Ponto de pedido" stroke="#D97706" strokeWidth={2.4} strokeDasharray="3 5" dot={false} connectNulls hide={serieOculta("ponto_pedido")}>
                      <LabelList dataKey="ponto_pedido" content={renderChartLabel} />
                    </Line>
                    {/* Insumos não têm leitura operacional por faturamento.
                        Faturamento SD2 fica apenas na visão PA/MR. */}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-secondary)" }}>
                  Sem série mensal disponível para este item.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Racional do estoque ideal</p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>Estoque ideal = maior entre consumo durante o lead time e pedido mínimo/MOQ.</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <KpiSmall label="Consumo LT" value={fmtCompact(item.consumo_durante_lt)} />
                <KpiSmall label="MOQ" value={fmtCompact(item.qtd_minima)} />
                <KpiSmall label="Ideal" value={fmtCompact(item.estoque_ideal)} />
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Pedidos em aberto</p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                {pedidos.length
                  ? `${fmtNumber(pedidos.length)} pedido(s) aberto(s) encontrado(s) para este item.`
                  : "Nenhum pedido aberto encontrado para este item."}
              </p>
              {pedidos.length > 0 && (
                <div className="mt-3 max-h-[160px] overflow-auto rounded-xl border" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 text-left uppercase tracking-wide text-white" style={{ background: "#163B63" }}>
                      <tr>
                        <th className="px-3 py-2">Pedido/SC</th>
                        <th className="px-3 py-2 text-right">Qtd.</th>
                        <th className="px-3 py-2">Entrega</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidos.slice(0, 8).map((pedido, idx) => (
                        <tr key={`${pedido.pedido_numero}-${pedido.sc_numero}-${idx}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="px-3 py-2">{pedido.pedido_numero || pedido.sc_numero || "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtNumber(pedido.quantidade_pendente, 0)}</td>
                          <td className="px-3 py-2">{fmtDate(pedido.data_prevista_entrega)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



function limparValorFiltro(value?: string) {
  const texto = String(value || "").trim()
  if (!texto || texto === "TODOS") return undefined
  return texto
}

function filtroVazio(filtro: FiltroTabelaEstoque | null) {
  if (!filtro) return true
  return !filtro.busca && !filtro.status && !filtro.tipo_negocio && !filtro.status_portfolio && !filtro.transferencia_bravi && !filtro.classificacao_cadastro && !filtro.semaforo
}

function labelFiltroTabela(filtro: FiltroTabelaEstoque | null) {
  if (!filtro || filtroVazio(filtro)) return "Todos os itens"

  const partes: string[] = []
  if (filtro.label && filtro.label !== "Filtro personalizado") partes.push(filtro.label)
  if (filtro.busca) partes.push(`Busca: ${filtro.busca}`)
  if (filtro.tipo_negocio) partes.push(`Linha: ${filtro.tipo_negocio}`)
  if (filtro.status) partes.push(STATUS_LABEL[filtro.status] || filtro.status)
  if (filtro.status_portfolio) partes.push(`Portfólio: ${filtro.status_portfolio}`)
  if (filtro.transferencia_bravi) partes.push(`Bravi: ${filtro.transferencia_bravi}`)
  if (filtro.classificacao_cadastro === "NAO_CLASSIFICADOS") partes.push("Não classificados")
  else if (filtro.classificacao_cadastro === "MAPEADOS") partes.push("Mapeados")
  else if (filtro.classificacao_cadastro) partes.push(`Classificação: ${filtro.classificacao_cadastro}`)
  if (filtro.semaforo) partes.push(`Semáforo: ${SEMAFORO_LABEL[filtro.semaforo] || filtro.semaforo}`)

  return partes.length ? partes.join(" · ") : "Filtro personalizado"
}

export default function AgingEstoquePage() {
  const [resumo, setResumo] = useState<AgingResumoResponse | null>(null)
  const [itensResp, setItensResp] = useState<AgingItensResponse | null>(null)
  const [, setLoadingResumo] = useState(true)
  const [loadingItens, setLoadingItens] = useState(true)
  const [loadingDetalhe, setLoadingDetalhe] = useState(false)
  const [error, setError] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AgingEstoqueItemDetalhe | null>(null)
  const [horizonteFuturo, setHorizonteFuturo] = useState(6)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [basesModalOpen, setBasesModalOpen] = useState(false)
  const [ultimasAtualizacoesBases, setUltimasAtualizacoesBases] = useState<Record<string, string | null | undefined>>({})
  const [loadingAtualizacoesBases, setLoadingAtualizacoesBases] = useState(false)
  const [uploadingBaseId, setUploadingBaseId] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState("")
  const [refreshTick, setRefreshTick] = useState(0)
  const [activeFilter, setActiveFilter] = useState<FiltroTabelaEstoque | null>(null)
  const [escopoEstoque, setEscopoEstoque] = useState<EscopoEstoque>("produtos")
  const [visaoEstoque, setVisaoEstoque] = useState<VisaoEstoque>("dashboard")
  const [dashboardResp, setDashboardResp] = useState<AgingResumoResponse | null>(null)
  const [dashboardItensResp, setDashboardItensResp] = useState<AgingItensResponse | null>(null)
  const [dashboardResumoPorEscopo, setDashboardResumoPorEscopo] = useState<Partial<Record<EscopoEstoque, AgingResumoResponse>>>({})
  const [dashboardItensPorEscopo, setDashboardItensPorEscopo] = useState<Partial<Record<EscopoEstoque, AgingItensResponse>>>({})
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [loadingDashboardItens, setLoadingDashboardItens] = useState(false)
  const [tableFilterOpen, setTableFilterOpen] = useState<keyof FiltroTabelaEstoque | null>(null)
  const [tableSearchDraft, setTableSearchDraft] = useState("")
  const [columnSelectorOpen, setColumnSelectorOpen] = useState(false)
  const [colunasVisiveisPorEscopo, setColunasVisiveisPorEscopo] = useState<Partial<Record<EscopoEstoque, string[]>>>({})
  const [mostrarSaudeLinhas, setMostrarSaudeLinhas] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)

  const carregarAtualizacoesBases = async () => {
    setLoadingAtualizacoesBases(true)
    try {
      const resultados = await Promise.all(
        BASES_GESTAO_ESTOQUE.map(async (base) => {
          try {
            const res = await buscarUltimaAtualizacao(base.id)
            return [base.id, res.ultima_atualizacao ?? null] as const
          } catch {
            return [base.id, null] as const
          }
        })
      )

      setUltimasAtualizacoesBases(Object.fromEntries(resultados))
    } finally {
      setLoadingAtualizacoesBases(false)
    }
  }

  const handleUploadBase = async (baseId: string, file: File) => {
    setUploadingBaseId(baseId)
    setUploadMessage("")

    const base = BASES_GESTAO_ESTOQUE.find((b) => b.id === baseId)
    const nomeBase = base?.titulo || baseId

    try {
      const res = await uploadBase(baseId, file)
      limparCacheGestaoEstoqueLocal()
      const total = res.total_inserido ?? 0
      const erros = res.erros || []

      setUploadMessage(
        erros.length
          ? `${nomeBase}: carga concluída com ${fmtNumber(total)} registros e ${fmtNumber(erros.length)} aviso(s). ${erros.slice(0, 2).join(" | ")}`
          : `${nomeBase}: carga concluída com ${fmtNumber(total)} registros.`
      )

      await carregarAtualizacoesBases()
      setRefreshTick((current) => current + 1)
    } catch (err) {
      setUploadMessage(err instanceof Error ? err.message : `Erro ao carregar ${nomeBase}.`)
    } finally {
      setUploadingBaseId(null)
    }
  }

  useEffect(() => {
    if (basesModalOpen) {
      void carregarAtualizacoesBases()
    }
  }, [basesModalOpen])

  useEffect(() => {
    setTableSearchDraft(activeFilter?.busca || "")
  }, [activeFilter?.busca])

  const alterarEscopoEstoque = (novoEscopo: EscopoEstoque) => {
    if (novoEscopo === escopoEstoque) return
    setEscopoEstoque(novoEscopo)
    setPage(1)
    setSelected(null)
    setActiveFilter(null)
    setResumo(null)
    setItensResp(null)
    setMostrarSaudeLinhas(false)
  }

  const abrirGestaoPeloDashboard = (escopo: EscopoEstoque = "todos") => {
    setVisaoEstoque("gestao")
    setEscopoEstoque(escopo)
    setPage(1)
    setSelected(null)
    setActiveFilter(null)
  }

  const aplicarFiltroDashboard = (filtro: FiltroTabelaEstoque | null, escopo: EscopoEstoque = "todos") => {
    setVisaoEstoque("gestao")
    setEscopoEstoque(escopo)
    setPage(1)
    setSelected(null)
    setActiveFilter(filtro)
  }

  useEffect(() => {
    let mounted = true
    const escoposDashboard: EscopoEstoque[] = ["todos", "insumos", "produtos"]

    setLoadingDashboard(true)
    setLoadingDashboardItens(true)

    const forceRefreshDashboard = refreshTick > 0
    const cacheBustDashboard = forceRefreshDashboard ? `${refreshTick}-${Date.now()}` : undefined

    Promise.all(
      escoposDashboard.map(async (escopo) => {
        const classificacao = classificacaoPadraoPorEscopo(escopo)

        const [resumo, itens] = await Promise.all([
          getAgingResumoDireto({
            escopo,
            classificacao_cadastro: classificacao,
            force_refresh: forceRefreshDashboard || undefined,
            _t: cacheBustDashboard,
          }),
          getAgingItensDireto({
            escopo,
            page: 1,
            page_size: 5000,
            sort_direction: "desc",
            classificacao_cadastro: classificacao,
            force_refresh: forceRefreshDashboard || undefined,
            _t: cacheBustDashboard,
          }),
        ])

        return {
          escopo,
          resumo,
          itens: normalizarCoberturaPaMrResponse(itens, escopo),
        }
      })
    )
      .then((resultados) => {
        if (!mounted) return

        const resumos: Partial<Record<EscopoEstoque, AgingResumoResponse>> = {}
        const itensPorEscopo: Partial<Record<EscopoEstoque, AgingItensResponse>> = {}

        for (const resultado of resultados) {
          resumos[resultado.escopo] = resultado.resumo
          itensPorEscopo[resultado.escopo] = resultado.itens
        }

        setDashboardResumoPorEscopo(resumos)
        setDashboardItensPorEscopo(itensPorEscopo)
        setDashboardResp(resumos.todos || null)
        setDashboardItensResp(itensPorEscopo.todos || null)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar dashboard")
      })
      .finally(() => {
        if (!mounted) return
        setLoadingDashboard(false)
        setLoadingDashboardItens(false)
      })
    return () => { mounted = false }
  }, [refreshTick])

  useEffect(() => {
    let mounted = true
    setLoadingResumo(true)
    setError("")
    getAgingResumoDireto({
      escopo: escopoEstoque,
      classificacao_cadastro: activeFilter?.classificacao_cadastro || classificacaoPadraoPorEscopo(escopoEstoque),
      _t: refreshTick ? refreshTick : undefined,
    })
      .then((res) => {
        if (!mounted) return
        if (res?.escopo && res.escopo !== escopoEstoque) return
        setResumo(res)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar resumo")
      })
      .finally(() => {
        if (mounted) setLoadingResumo(false)
      })
    return () => { mounted = false }
  }, [refreshTick, escopoEstoque, activeFilter?.classificacao_cadastro])


  useEffect(() => {
    let mounted = true
    setLoadingItens(true)
    setError("")
    getAgingItensDireto({
        escopo: escopoEstoque,
        page,
        page_size: PAGE_SIZE,
        sort_key: sortKey || undefined,
        sort_direction: sortDirection,
        busca: activeFilter?.busca,
        status: activeFilter?.status,
        tipo_negocio: activeFilter?.tipo_negocio,
        status_portfolio: activeFilter?.status_portfolio,
        transferencia_bravi: activeFilter?.transferencia_bravi,
        classificacao_cadastro: activeFilter?.classificacao_cadastro || classificacaoPadraoPorEscopo(escopoEstoque),
        semaforo: activeFilter?.semaforo,
        _t: refreshTick ? refreshTick : undefined,
      })
      .then((res) => {
        if (!mounted) return
        if (res?.escopo && res.escopo !== escopoEstoque) return
        setItensResp(normalizarCoberturaPaMrResponse(res, escopoEstoque))
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar itens")
      })
      .finally(() => {
        if (mounted) setLoadingItens(false)
      })
    return () => { mounted = false }
  }, [page, sortKey, sortDirection, refreshTick, activeFilter, escopoEstoque])

  const itens = itensResp?.itens || []
  const totalPages = Math.max(1, itensResp?.total_pages || 1)

  const aplicarFiltro = (filtro: FiltroTabelaEstoque | null) => {
    setPage(1)
    setSelected(null)
    setActiveFilter((current) => (filtroKey(current) === filtroKey(filtro) ? null : filtro))
  }

  const atualizarFiltroCampo = (campo: keyof FiltroTabelaEstoque, value?: string) => {
    setLoadingItens(true)
    setPage(1)
    setSelected(null)
    setActiveFilter((current) => {
      const next: FiltroTabelaEstoque = { ...(current || { label: "Filtro personalizado" }) }
      const valorLimpo = campo === "busca" ? String(value || "").trim() : limparValorFiltro(value)

      if (valorLimpo) {
        ;(next as Record<string, string>)[campo] = valorLimpo
      } else {
        delete (next as Record<string, string | undefined>)[campo]
      }

      next.label = "Filtro personalizado"
      return filtroVazio(next) ? null : next
    })
  }

  const handleSort = (column: SortKey) => {
    setPage(1)
    if (sortKey === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(column)
    setSortDirection("desc")
  }

  const abrirDetalhe = (item: AgingEstoqueItem) => {
    if (visaoEstoque === "gestao" && escopoEstoque === "insumos") {
      const codigo = String(item.codigo || "").trim()
      const detalheEmCache = codigo
        ? lerCacheGestaoEstoque<AgingEstoqueItemDetalhe>(
            "__service__/aging-estoque/item",
            { codigo, horizonte_futuro: Math.max(1, Number(horizonteFuturo || 6)) }
          )
        : null

      // Se o detalhe já foi aberto antes, mostra a série completa na hora.
      // Se ainda não tem cache, mostra a linha da tabela e carrega o detalhe completo em segundo plano.
      setSelected((detalheEmCache || item) as AgingEstoqueItemDetalhe)
      return
    }

    setSelected(normalizarCoberturaPaMrItem(item) as AgingEstoqueItemDetalhe)
  }

  useEffect(() => {
    const codigo = selected?.codigo

    // Detalhe completo só é necessário para a linha do tempo de Insumos.
    // Em PA/MR, a série por item usa o endpoint leve /produtos/serie com o código do item.
    if (!codigo || escopoEstoque !== "insumos") {
      setLoadingDetalhe(false)
      return
    }

    let mounted = true
    setLoadingDetalhe(true)

    getAgingEstoqueItemComCache(codigo, horizonteFuturo)
      .then((detalhe) => {
        if (!mounted) return
        setSelected(detalhe as AgingEstoqueItemDetalhe)
      })
      .catch((err: unknown) => {
        console.error(err)
      })
      .finally(() => {
        if (mounted) setLoadingDetalhe(false)
      })

    return () => { mounted = false }
  }, [selected?.codigo, horizonteFuturo, refreshTick, escopoEstoque])

  // O backend ordena a base inteira; esta ordenação local garante resposta visual imediata na página carregada.
  const itensOrdenados = useMemo(() => {
    const base = activeFilter?.semaforo
      ? itens.filter((item) => calcularSemaforoEstoque(item) === activeFilter.semaforo)
      : itens

    if (!sortKey) return base

    const direction = sortDirection === "asc" ? 1 : -1
    const tabelaProdutosOrdenacao = escopoEstoque !== "insumos"

    return [...base].sort((a, b) => {
      const aValue = getValorNumericoTabela(a, sortKey, tabelaProdutosOrdenacao)
      const bValue = getValorNumericoTabela(b, sortKey, tabelaProdutosOrdenacao)

      if (aValue === bValue) {
        return String(a.codigo || "").localeCompare(String(b.codigo || ""))
      }

      return (aValue - bValue) * direction
    })
  }, [itens, sortKey, sortDirection, activeFilter?.semaforo, escopoEstoque])

  const saudeNegocios = useMemo(() => resumo?.saude_negocios || [], [resumo])
  const negociosClassificados = useMemo(
    () => saudeNegocios.filter((negocio) => String(negocio.tipo_negocio || "").trim().toUpperCase() !== "A CLASSIFICAR"),
    [saudeNegocios]
  )
  const negocioAClassificar = useMemo(
    () => saudeNegocios.find((negocio) => String(negocio.tipo_negocio || "").trim().toUpperCase() === "A CLASSIFICAR"),
    [saudeNegocios]
  )

  const opcoesFiltros = useMemo(() => resumo?.opcoes || itensResp?.opcoes || {}, [resumo, itensResp])
  const getValorFiltroTabela = (campo: keyof FiltroTabelaEstoque) => {
    const valor = (activeFilter as Record<string, string | undefined> | null)?.[campo]
    return String(valor || "")
  }

  const renderFiltroDescricao = () => {
    const campo: keyof FiltroTabelaEstoque = "busca"
    const aberto = tableFilterOpen === campo
    const valor = getValorFiltroTabela(campo)
    const ativo = Boolean(valor)

    const aplicarBuscaTabela = () => {
      atualizarFiltroCampo(campo, tableSearchDraft.trim() || undefined)
      setTableFilterOpen(null)
    }

    const limparBuscaTabela = () => {
      setTableSearchDraft("")
      atualizarFiltroCampo(campo, undefined)
      setTableFilterOpen(null)
    }

    return (
      <span className="relative inline-flex w-full items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setTableSearchDraft(valor)
            setTableFilterOpen(aberto ? null : campo)
          }}
          className="inline-flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left font-bold text-white/95 transition hover:bg-white/10"
          title="Filtrar por código ou descrição"
        >
          <span>Descrição</span>
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
            style={{
              borderColor: ativo ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
              background: ativo ? "rgba(255,255,255,0.18)" : "transparent",
            }}
          >
            <Filter size={11} />
          </span>
        </button>

        {aberto && (
          <div
            className="absolute left-0 top-7 z-[80] w-[280px] rounded-xl border bg-white p-3 text-left normal-case tracking-normal shadow-2xl"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Buscar na tabela
              </span>
              <button
                type="button"
                onClick={() => setTableFilterOpen(null)}
                className="rounded-md p-1 hover:bg-slate-100"
                style={{ color: "var(--text-secondary)" }}
              >
                <X size={13} />
              </button>
            </div>

            <input
              autoFocus
              value={tableSearchDraft}
              onChange={(e) => setTableSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") aplicarBuscaTabela()
                if (e.key === "Escape") setTableFilterOpen(null)
              }}
              placeholder="Digite código ou produto. Ex.: SUGCLEAN"
              className="h-9 w-full rounded-lg border bg-white px-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#163B63]/20"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            />

            <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Pressione Enter ou clique em Aplicar.
            </p>

            <div className="mt-3 flex justify-between gap-2">
              <button
                type="button"
                onClick={limparBuscaTabela}
                className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={aplicarBuscaTabela}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition"
                style={{ background: "#163B63" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </span>
    )
  }

  const qtdAClassificar = Number(negocioAClassificar?.itens || 0)
  const totalItensResumo = Number(resumo?.resumo?.total_itens || 0)
  const totalDescontinuadoSaldo = Number(resumo?.resumo?.descontinuado_com_saldo || 0)
  const totalBravi = Number(resumo?.resumo?.transferencia_bravi || 0)
  const totalAtivosOutros = Math.max(0, totalItensResumo - totalDescontinuadoSaldo - totalBravi - qtdAClassificar)
  const escopoTitulo = ESCOPO_TITULO[escopoEstoque]
  const escopoDescricao = ESCOPO_DESCRICAO[escopoEstoque]
  const mostrarCardsPortfolio = escopoEstoque !== "insumos"
  const isTabelaProdutos = escopoEstoque !== "insumos"

  const colunasBaseTabela = useMemo(() => {
    const base = [
      { key: "status", label: "Status" },
      { key: "curva_a", label: "Curva A" },
      { key: "tipo", label: "Tipo" },
      { key: "unid", label: "UM" },
      { key: "segmento", label: "Segmento" },
      { key: "mercado", label: "Mercado" },
    ]

    if (!isTabelaProdutos) {
      base.push(
        { key: "saldo_origem", label: "Origem saldo" },
        { key: "data_saldo_origem", label: "Data saldo" }
      )
    }

    return base
  }, [isTabelaProdutos])

  const colunasOpcoesTabela = useMemo(
    () => [
      ...colunasBaseTabela,
      ...NUMERIC_COLUMNS.map((col) => ({ key: col.key, label: col.label })),
    ],
    [colunasBaseTabela]
  )

  const colunasPadraoTabela = useMemo(() => {
    if (isTabelaProdutos) return COLUNAS_PADRAO_PA_MR

    return colunasOpcoesTabela.map((col) => col.key)
  }, [isTabelaProdutos, colunasOpcoesTabela])

  const colunasVisiveisAtuais = colunasVisiveisPorEscopo[escopoEstoque] || colunasPadraoTabela
  const isColunaVisivel = (key: string) => colunasVisiveisAtuais.includes(key)
  const colunasTabela = NUMERIC_COLUMNS.filter((col) => isColunaVisivel(col.key))
  const larguraMinimaTabela = Math.max(isTabelaProdutos ? 1200 : 1800, 560 + colunasVisiveisAtuais.length * 92)

  const toggleColunaTabela = (key: string) => {
    setColunasVisiveisPorEscopo((current) => {
      const atuais = current[escopoEstoque] || colunasPadraoTabela
      const next = atuais.includes(key)
        ? atuais.filter((col) => col !== key)
        : [...atuais, key]

      return {
        ...current,
        [escopoEstoque]: next,
      }
    })
  }

  const resetColunasTabela = () => {
    setColunasVisiveisPorEscopo((current) => ({
      ...current,
      [escopoEstoque]: colunasPadraoTabela,
    }))
  }

  const mostrarTodasColunasTabela = () => {
    setColunasVisiveisPorEscopo((current) => ({
      ...current,
      [escopoEstoque]: colunasOpcoesTabela.map((col) => col.key),
    }))
  }

  const colunasInsumosOrdenaveis = new Set<string>([
    "saldo",
    "saldo_quarentena",
    "qtd_pedidos_abertos",
    "estoque_mais_pedidos",
    "consumo_mes_atual",
    "demanda_mes_atual",
    "previsto_vs_consumido_pct",
    "perc_mes_decorrido",
    "desvio_ritmo_pct",
    "dias_em_estoque",
    "cobertura_meses_atual",
    "cobertura_meses_futura",
    "maior_media",
    "lead_time_dias",
    "qtd_minima",
    "consumo_durante_lt",
    "estoque_ideal",
    "gap_volume",
    "saldo_sb8_bruto",
    "empenho_lote",
    "custo_unitario",
    "estoque_atual_valor",
    "pedidos_abertos_valor",
    "estoque_mais_pedidos_valor",
  ])

  const colunasInsumosVisiveis = colunasVisiveisPorEscopo.insumos || COLUNAS_PADRAO_INSUMOS
  const colunasInsumosTabela = COLUNAS_INSUMOS_OPCOES.filter((col) => colunasInsumosVisiveis.includes(col.key))
  const isColunaInsumoVisivel = (key: string) => colunasInsumosVisiveis.includes(key)
  const larguraMinimaTabelaInsumos = Math.max(1500, 320 + colunasInsumosTabela.length * 110)

  const toggleColunaInsumo = (key: string) => {
    setColunasVisiveisPorEscopo((current) => {
      const atuais = current.insumos || COLUNAS_PADRAO_INSUMOS
      const next = atuais.includes(key)
        ? atuais.filter((col) => col !== key)
        : [...atuais, key]

      return {
        ...current,
        insumos: next,
      }
    })
  }

  const resetColunasInsumos = () => {
    setColunasVisiveisPorEscopo((current) => ({
      ...current,
      insumos: COLUNAS_PADRAO_INSUMOS,
    }))
  }

  const mostrarTodasColunasInsumos = () => {
    setColunasVisiveisPorEscopo((current) => ({
      ...current,
      insumos: COLUNAS_INSUMOS_OPCOES.map((col) => col.key),
    }))
  }


  const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return ""

    let texto = ""

    if (Array.isArray(value)) {
      texto = value.join(", ")
    } else if (typeof value === "object") {
      texto = JSON.stringify(value)
    } else {
      texto = String(value)
    }

    texto = texto.replace(/\r?\n/g, " ").trim()

    if (texto.includes(";") || texto.includes('"') || texto.includes("\n")) {
      return `"${texto.replace(/"/g, '""')}"`
    }

    return texto
  }

  const exportCsv = async () => {
    setExportingCsv(true)
    setError("")

    try {
      const filtrosExportacao = {
        escopo: escopoEstoque,
        page: 1,
        page_size: EXPORT_PAGE_SIZE,
        sort_key: sortKey || undefined,
        sort_direction: sortDirection,
        busca: activeFilter?.busca,
        status: activeFilter?.status,
        tipo_negocio: activeFilter?.tipo_negocio,
        status_portfolio: activeFilter?.status_portfolio,
        transferencia_bravi: activeFilter?.transferencia_bravi,
        classificacao_cadastro: activeFilter?.classificacao_cadastro || classificacaoPadraoPorEscopo(escopoEstoque),
        semaforo: activeFilter?.semaforo,
      }

      const primeiraPagina = normalizarCoberturaPaMrResponse(
        await getAgingItensDireto(filtrosExportacao),
        escopoEstoque
      )

      let itensExportacao: AgingEstoqueItem[] = [...(primeiraPagina.itens || [])]
      const totalPagesExport = Math.max(1, Number(primeiraPagina.total_pages || 1))

      if (totalPagesExport > 1) {
        const demaisPaginas = await Promise.all(
          Array.from({ length: totalPagesExport - 1 }, (_, index) =>
            getAgingItensDireto({
              ...filtrosExportacao,
              page: index + 2,
            }).then((res) => normalizarCoberturaPaMrResponse(res, escopoEstoque))
          )
        )

        itensExportacao = [
          ...itensExportacao,
          ...demaisPaginas.flatMap((paginaExport) => paginaExport.itens || []),
        ]
      }

      const header = [
        "codigo",
        "produto",
        "escopo_exportado",
        "status_label",
        "status",
        "status_estoque",
        "status_visual",
        "tipo",
        "tipo_produto_erp",
        "unid",
        "segmento",
        "mercado",
        "macro_negocio",
        "tipo_negocio",
        "familia",
        "grupo",
        "grupo_descricao",
        "grupo_gerencial",
        "modelo_fornecimento",
        "status_portfolio",
        "transferencia_bravi",
        "fornecedor_terceiro",
        "origem_classificacao",
        "origem_linha_estoque",
        "tem_posicao_aging",
        "item_mapeado",
        "ativo_analise",
        "saldo_origem",
        "data_saldo_origem",
        "data_quarentena_origem",
        "saldo",
        "saldo_quarentena",
        "quarentena",
        "saldo_sb8_bruto",
        "empenho_lote",
        "saldo_quarentena_bruto",
        "empenho_quarentena",
        "qtd_pedidos_abertos",
        "entradas_previstas",
        "qtd_entradas_previstas",
        "qtd_liberacoes_previstas",
        "qtd_pedidos_compra",
        "qtd_pi_transferencia",
        "codigos_pi_bravi",
        "codigo_pi_principal",
        "fonte_entradas_previstas",
        "label_entradas_previstas",
        "estoque_mais_pedidos",
        "estoque_mais_entradas",
        "media_3m",
        "media_6m",
        "media_9m",
        "maior_media",
        "lead_time_dias",
        "qtd_minima",
        "consumo_durante_lt",
        "estoque_ideal",
        "dias_em_estoque",
        "cobertura_dias",
        "cobertura_meses_atual",
        "cobertura_futura_dias",
        "cobertura_meses_futura",
        "cobertura_consumo_lt",
        "gap_volume",
        "giro_estoque",
        "maior_media_50",
        "saldo_menos_maior_media_50",
        "demanda_mes_atual",
        "demanda_direta_mes_atual",
        "demanda_bom_mes_atual",
        "metodo_demanda",
        "origem_demanda_bom",
        "consumo_mes_atual",
        "previsao_mes_atual",
        "previsto_vs_consumido_pct",
        "perc_mes_decorrido",
        "desvio_ritmo_pct",
        "faturamento_ytd_qtd",
        "faturamento_ytd_valor",
        "custo_unitario",
        "estoque_atual_valor",
        "pedidos_abertos_valor",
        "estoque_mais_pedidos_valor",
        "estoque_ideal_valor",
        "gap_valor",
        "menor_data_entrega",
        "eh_componente_bom",
        "qtd_pais_bom",
        "tipo_componente_bom",
        "pais_bom",
        "observacao",
      ]

      const csv = [
        header.join(";"),
        ...itensExportacao.map((r) =>
          header
            .map((h) => {
              if (h === "escopo_exportado") return csvEscape(ESCOPO_TITULO[escopoEstoque])
              if (h === "status_label") return csvEscape(SEMAFORO_LABEL[calcularSemaforoEstoque(r)])
              return csvEscape((r as unknown as Record<string, unknown>)[h])
            })
            .join(";")
        ),
      ].join("\n")

      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `gestao_estoque_${escopoEstoque}_base_completa.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar base completa.")
    } finally {
      setExportingCsv(false)
    }
  }




  if (visaoEstoque === "dashboard") {
    return (
      <div className="min-h-screen p-6 space-y-5">
        <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>Suprimentos · Estoque</p>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Dashboard de Estoque</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Indicadores executivos, matriz estoque x giro e prioridades por linha de negócio.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setBasesModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
              style={{ background: "#163B63" }}
            >
              <Database size={16} /> Bases
            </button>
            <button
              onClick={() => { limparCacheGestaoEstoqueLocal(); setRefreshTick((x) => x + 1) }}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <RefreshCw size={16} /> Atualizar
            </button>
          </div>
        </div>

        <VisaoEstoqueTabs value={visaoEstoque} onChange={setVisaoEstoque} />

        {error && (
          <div className="rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)", color: "#B91C1C" }}>
            {error}
          </div>
        )}

        <DashboardEstoquePanel
          data={dashboardResp}
          itensMatriz={dashboardItensResp?.itens || []}
          dataPorEscopo={dashboardResumoPorEscopo}
          itensPorEscopo={dashboardItensPorEscopo}
          loading={loadingDashboard}
          loadingMatriz={loadingDashboardItens}
          onApplyFilter={aplicarFiltroDashboard}
          onOpenGestao={abrirGestaoPeloDashboard}
        />

        <BasesModal
          open={basesModalOpen}
          onClose={() => setBasesModalOpen(false)}
          ultimasAtualizacoes={ultimasAtualizacoesBases}
          loadingAtualizacoes={loadingAtualizacoesBases}
          uploadingBaseId={uploadingBaseId}
          uploadMessage={uploadMessage}
          onUpload={handleUploadBase}
          onRefresh={carregarAtualizacoesBases}
        />
      </div>
    )
  }

  if (escopoEstoque === "insumos") {
    return (
      <div className="min-h-screen p-6 space-y-5">
        <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>Suprimentos · Estoque</p>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Gestão de Estoque</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Visão de estoque para produção, consumo histórico, cobertura e demanda via BOM.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setBasesModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
              style={{ background: "#163B63" }}
            >
              <Database size={16} /> Bases
            </button>
            <button
              onClick={() => { limparCacheGestaoEstoqueLocal(); setRefreshTick((x) => x + 1) }}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <RefreshCw size={16} /> Atualizar
            </button>
            <button
              onClick={exportCsv}
              disabled={exportingCsv || !itensResp?.total}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <Download size={16} /> {exportingCsv ? "Exportando..." : "Exportar CSV"}
            </button>
          </div>
        </div>

        <VisaoEstoqueTabs value={visaoEstoque} onChange={setVisaoEstoque} />

        <div className="card p-4">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Visão da gestão de estoque</p>
              <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Insumos de produção</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>MP, ME, MI e materiais com demanda explodida pela BOM.</p>
            </div>

            <div className="w-full max-w-[260px]">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Escopo da análise
              </label>
              <select
                value={escopoEstoque}
                onChange={(event) => alterarEscopoEstoque(event.target.value as EscopoEstoque)}
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-semibold outline-none transition focus:ring-2"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {ESCOPO_ESTOQUE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)", color: "#B91C1C" }}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            label="Itens"
            value={fmtNumber(resumo?.resumo?.total_itens || 0)}
            helper={`Insumos de produção · Snapshot: ${resumo?.data_snapshot_consumo ? fmtDate(resumo.data_snapshot_consumo) : "—"}`}
            icon={<Boxes size={20} />}
            active={!activeFilter}
          />
          <KpiCard
            label="Ruptura"
            value={fmtNumber(resumo?.resumo?.ruptura || 0)}
            helper="Saldo zerado com demanda"
            icon={<AlertTriangle size={20} />}
            tone="danger"
            onClick={() => aplicarFiltro({ label: "Ruptura", status: "RUPTURA" })}
            active={isFiltroAtivo(activeFilter, { status: "RUPTURA" })}
          />
          <KpiCard
            label="Críticos"
            value={fmtNumber(resumo?.resumo?.critico || 0)}
            helper="Abaixo da necessidade"
            icon={<ArrowDownRight size={20} />}
            tone="warning"
            onClick={() => aplicarFiltro({ label: "Críticos", semaforo: "VERMELHO" })}
            active={isFiltroAtivo(activeFilter, { semaforo: "VERMELHO" }) && !activeFilter?.tipo_negocio}
          />
          <KpiCard
            label="Excesso"
            value={fmtNumber(resumo?.resumo?.excesso || 0)}
            helper="cobertura > 3 meses"
            icon={<ArrowUpRight size={20} />}
            tone="blue"
            onClick={() => aplicarFiltro({ label: "Excesso", status: "EXCESSO" })}
            active={isFiltroAtivo(activeFilter, { status: "EXCESSO" }) && !activeFilter?.tipo_negocio}
          />
          <KpiCard
            label="Sem consumo"
            value={fmtNumber(resumo?.resumo?.sem_giro || 0)}
            helper="sem consumo histórico relevante"
            icon={<PackageSearch size={20} />}
            tone="default"
            onClick={() => aplicarFiltro({ label: "Sem consumo", status: "SEM_GIRO" })}
            active={isFiltroAtivo(activeFilter, { status: "SEM_GIRO" })}
          />
          <KpiCard
            label="Pedidos abertos"
            value={fmtCompact(resumo?.resumo?.pedidos_total || 0)}
            helper="volume em compras abertas"
            icon={<ShoppingCart size={20} />}
            tone="blue"
          />
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Filter size={18} style={{ color: "var(--text-secondary)" }} />
              <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Filtros</h2>
            </div>
            <button
              type="button"
              onClick={() => aplicarFiltro(null)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <X size={15} /> Limpar filtros
            </button>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 border-t pt-4 md:grid-cols-4" style={{ borderColor: "var(--border)" }}>
            <label className="md:col-span-2">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Código ou produto</span>
              <div className="flex gap-2">
                <input
                  value={tableSearchDraft}
                  onChange={(e) => setTableSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") atualizarFiltroCampo("busca", tableSearchDraft.trim() || undefined)
                  }}
                  placeholder="Buscar código, nome, família, segmento..."
                  className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-[#163B63]/20"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
                <button
                  type="button"
                  onClick={() => atualizarFiltroCampo("busca", tableSearchDraft.trim() || undefined)}
                  className="h-10 rounded-xl border px-3 text-sm font-bold transition hover:bg-slate-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  Buscar
                </button>
              </div>
            </label>

            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Status visual</span>
              <select
                value={activeFilter?.semaforo || "TODOS"}
                onChange={(e) => atualizarFiltroCampo("semaforo", e.target.value === "TODOS" ? undefined : e.target.value as SemaforoEstoque)}
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-[#163B63]/20"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <option value="TODOS">Todos</option>
                <option value="VERMELHO">Crítico</option>
                <option value="AMARELO">Atenção</option>
                <option value="VERDE">Ok</option>
                <option value="CINZA">Sem referência</option>
              </select>
            </label>

            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Status estoque</span>
              <select
                value={activeFilter?.status || "TODOS"}
                onChange={(e) => atualizarFiltroCampo("status", e.target.value === "TODOS" ? undefined : e.target.value)}
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium outline-none transition focus:ring-2 focus:ring-[#163B63]/20"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <option value="TODOS">Todos</option>
                <option value="RUPTURA">Ruptura</option>
                <option value="CRITICO">Crítico</option>
                <option value="ATENCAO">Atenção</option>
                <option value="SAUDAVEL">Saudável</option>
                <option value="EXCESSO">Excesso</option>
                <option value="SEM_GIRO">Sem consumo</option>
                <option value="SEM_CONSUMO">Sem consumo</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Base analítica</p>
              <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Insumos por consumo vs previsão e cobertura</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Status compara consumo acumulado do mês com a previsão proporcional ao dia atual.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setColumnSelectorOpen((current) => !current)}
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition hover:bg-slate-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: columnSelectorOpen ? "rgba(22,59,99,0.06)" : "#FFFFFF" }}
                  title="Selecionar colunas"
                >
                  <Settings2 size={14} /> Colunas
                </button>

                {columnSelectorOpen && (
                  <div
                    className="absolute right-0 top-10 z-[90] w-[330px] rounded-2xl border bg-white p-3 text-left shadow-2xl"
                    style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                          Selecionar colunas
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                          Código e descrição ficam fixos.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setColumnSelectorOpen(false)}
                        className="rounded-md p-1 hover:bg-slate-100"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={resetColunasInsumos}
                        className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Padrão
                      </button>
                      <button
                        type="button"
                        onClick={mostrarTodasColunasInsumos}
                        className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Mostrar todas
                      </button>
                    </div>

                    <div className="max-h-[360px] space-y-1 overflow-auto pr-1">
                      {COLUNAS_INSUMOS_OPCOES.map((col) => (
                        <label
                          key={col.key}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={isColunaInsumoVisivel(col.key)}
                            onChange={() => toggleColunaInsumo(col.key)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Página {page} de {totalPages} · {fmtNumber(itensResp?.total || 0)} itens no escopo</p>
            </div>
          </div>

          {loadingItens && (
            <div className="flex items-center gap-2 border-b px-5 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>
              <RefreshCw size={14} className="animate-spin" /> Buscando itens da tabela...
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: larguraMinimaTabelaInsumos }}>
              <thead>
                <tr className="text-left text-white" style={{ background: "#163B63" }}>
                  <th className="w-[90px] px-3 py-3">Código</th>
                  <th className="w-[240px] px-3 py-3">Descrição</th>
                  {colunasInsumosTabela.map((col) => {
                    const ordenavel = colunasInsumosOrdenaveis.has(col.key)
                    const ativo = sortKey === col.key
                    const seta = ativo ? (sortDirection === "asc" ? "↑" : "↓") : "↕"

                    return (
                      <th
                        key={col.key}
                        className={`${col.width || "w-[110px]"} px-3 py-3 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                      >
                        {ordenavel ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.key as SortKey)}
                            className={`inline-flex w-full items-center gap-1 rounded-md text-[11px] font-bold leading-tight text-white/95 transition hover:text-white ${col.align === "right" ? "justify-end text-right" : col.align === "center" ? "justify-center text-center" : "justify-start text-left"}`}
                            title={`Ordenar por ${col.label}`}
                          >
                            <span className="whitespace-normal">{col.label}</span>
                            <span className={ativo ? "text-white" : "text-white/55"}>{seta}</span>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {itensOrdenados.map((item) => (
                  <tr
                    key={item.codigo}
                    className="cursor-pointer border-b transition hover:bg-slate-100"
                    style={{ borderColor: "var(--border)", background: selected?.codigo === item.codigo ? "rgba(22,59,99,0.07)" : undefined }}
                    onClick={() => abrirDetalhe(item)}
                  >
                    <td className="px-3 py-2 font-bold">{item.codigo}</td>
                    <td className="truncate px-3 py-2" title={item.produto || ""}>{item.produto || "—"}</td>
                    {colunasInsumosTabela.map((col) => (
                      <td
                        key={`${item.codigo}-${col.key}`}
                        className={`px-3 py-2 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                      >
                        {renderValorColunaInsumo(item, col.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {!loadingItens && itensOrdenados.length === 0 && (
              <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum item encontrado na base atual.</div>
            )}
          </div>

          <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {loadingItens ? "Atualizando resultados..." : `Exibindo ${fmtNumber(itensOrdenados.length)} de ${fmtNumber(itensResp?.total || 0)} itens`}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Anterior</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Próxima</button>
            </div>
          </div>
        </div>

        {selected && (
          <TimelinePrincipal
            item={selected}
            loading={loadingDetalhe}
            horizonteFuturo={horizonteFuturo}
            onHorizonteChange={setHorizonteFuturo}
          />
        )}

        <BasesModal
          open={basesModalOpen}
          onClose={() => setBasesModalOpen(false)}
          ultimasAtualizacoes={ultimasAtualizacoesBases}
          loadingAtualizacoes={loadingAtualizacoesBases}
          uploadingBaseId={uploadingBaseId}
          uploadMessage={uploadMessage}
          onUpload={handleUploadBase}
          onRefresh={carregarAtualizacoesBases}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 space-y-5">
      <div className="fade-in flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>Suprimentos · Estoque</p>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Gestão de Estoque</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{escopoDescricao}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBasesModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
            style={{ background: "#163B63" }}
          >
            <Database size={16} /> Bases
          </button>
          <button
            type="button"
            onClick={() => { limparCacheGestaoEstoqueLocal(); setRefreshTick((current) => current + 1) }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} disabled={exportingCsv || !itensResp?.total}>
            <Download size={16} /> {exportingCsv ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
      </div>

      <VisaoEstoqueTabs value={visaoEstoque} onChange={setVisaoEstoque} />

      <div className="card p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Visão da gestão de estoque</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>{escopoTitulo}</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              {ESCOPO_ESTOQUE_OPTIONS.find((option) => option.key === escopoEstoque)?.helper || "Alterne o escopo para separar a lógica comercial da lógica produtiva."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:max-w-[520px] sm:flex-row sm:items-end sm:justify-end">
            <div className="w-full sm:max-w-[260px]">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                Escopo da análise
              </label>
              <select
                value={escopoEstoque}
                onChange={(event) => alterarEscopoEstoque(event.target.value as EscopoEstoque)}
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm font-semibold outline-none transition focus:ring-2"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                }}
              >
                {ESCOPO_ESTOQUE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setMostrarSaudeLinhas((current) => !current)}
              className="h-10 rounded-xl border px-3 text-sm font-bold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: mostrarSaudeLinhas ? "rgba(22,59,99,0.06)" : "#FFFFFF" }}
            >
              {mostrarSaudeLinhas ? "Ocultar saúde" : "Mostrar saúde"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="card p-5 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Itens"
          value={fmtNumber(resumo?.resumo?.total_itens || 0)}
          helper={`${escopoTitulo} · Snapshot: ${fmtDate(resumo?.data_snapshot_consumo)}`}
          details={[
            { label: "Ativos/outros", value: fmtNumber(totalAtivosOutros), tone: "success" },
            ...(totalDescontinuadoSaldo > 0 ? [{ label: "Desc. c/ saldo", value: fmtNumber(totalDescontinuadoSaldo), tone: "danger" as const }] : []),
            ...(totalBravi > 0 ? [{ label: "Bravi", value: fmtNumber(totalBravi), tone: "blue" as const }] : []),
            ...(qtdAClassificar ? [{ label: "A classificar", value: fmtNumber(qtdAClassificar), tone: "warning" as const }] : []),
          ]}
          icon={<Boxes size={20} />}
          onClick={() => aplicarFiltro(null)}
          active={!activeFilter}
        />
        <KpiCard
          label="Ruptura"
          value={fmtNumber(resumo?.resumo?.ruptura || 0)}
          helper={escopoEstoque === "produtos" ? "Sem estoque disponível" : "Saldo zerado com consumo"}
          icon={<AlertTriangle size={20} />}
          tone="danger"
          onClick={() => aplicarFiltro({ label: "Ruptura", status: "RUPTURA" })}
          active={isFiltroAtivo(activeFilter, { status: "RUPTURA" })}
        />
        <KpiCard
          label="Críticos"
          value={fmtNumber(resumo?.resumo?.critico || 0)}
          helper={escopoEstoque === "produtos" ? "Disponibilidade abaixo do necessário" : "Abaixo do ideal/LT"}
          icon={<ArrowDownRight size={20} />}
          tone="warning"
          onClick={() => aplicarFiltro({ label: "Críticos", semaforo: "VERMELHO" })}
          active={isFiltroAtivo(activeFilter, { semaforo: "VERMELHO" }) && !activeFilter?.tipo_negocio}
        />
        <KpiCard
          label="Excesso"
          value={fmtNumber(resumo?.resumo?.excesso || 0)}
          helper="cobertura > 3 meses"
          icon={<ArrowUpRight size={20} />}
          tone="blue"
          onClick={() => aplicarFiltro({ label: "Excesso", status: "EXCESSO" })}
          active={isFiltroAtivo(activeFilter, { status: "EXCESSO" }) && !activeFilter?.tipo_negocio}
        />
        {mostrarCardsPortfolio ? (
          <>
            <KpiCard
              label="Descont. c/ saldo"
              value={fmtNumber(resumo?.resumo?.descontinuado_com_saldo || 0)}
              helper="portfólio descontinuado"
              icon={<PackageSearch size={20} />}
              tone="danger"
              onClick={() => aplicarFiltro({ label: "Descontinuados com saldo", status: "DESCONTINUADO_COM_SALDO" })}
              active={isFiltroAtivo(activeFilter, { status: "DESCONTINUADO_COM_SALDO" })}
            />
            <KpiCard
              label="Bravi"
              value={fmtNumber(resumo?.resumo?.transferencia_bravi || 0)}
              helper="itens em transferência"
              icon={<ShoppingCart size={20} />}
              tone="blue"
              onClick={() => aplicarFiltro({ label: "Bravi", transferencia_bravi: "Sim" })}
              active={isFiltroAtivo(activeFilter, { transferencia_bravi: "Sim" })}
            />
          </>
        ) : (
          <>
            <KpiCard
              label="Sem consumo"
              value={fmtNumber(resumo?.resumo?.sem_giro || 0)}
              helper="sem consumo histórico relevante"
              icon={<PackageSearch size={20} />}
              tone="default"
              onClick={() => aplicarFiltro({ label: "Sem consumo", status: "SEM_GIRO" })}
              active={isFiltroAtivo(activeFilter, { status: "SEM_GIRO" })}
            />
            <KpiCard
              label="Pedidos abertos"
              value={fmtCompact(resumo?.resumo?.pedidos_total || 0)}
              helper="volume em compras abertas"
              icon={<ShoppingCart size={20} />}
              tone="blue"
            />
          </>
        )}
      </div>

      {mostrarSaudeLinhas && (
        <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {negociosClassificados.map((negocio) => (
                <div
                  key={negocio.tipo_negocio}
                  className="rounded-2xl border p-4 text-left"
                  style={{ borderColor: "var(--border)", background: "#FFFFFF" }}
                >
                  <div className="min-h-[104px]">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => aplicarFiltro({ label: negocio.tipo_negocio, tipo_negocio: negocio.tipo_negocio })}
                    >
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>"Saúde da linha"</p>
                      <h3 className="mt-1 text-lg font-bold hover:underline" style={{ color: "var(--text-primary)" }}>{negocio.tipo_negocio}</h3>
                    </button>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => aplicarFiltro({ label: negocio.tipo_negocio, tipo_negocio: negocio.tipo_negocio })}
                        className="rounded-full px-2.5 py-1 text-xs font-bold transition hover:brightness-95"
                        style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}
                      >
                        {fmtNumber(negocio.itens)} SKUs
                      </button>
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-bold"
                        style={{ background: "rgba(22,163,74,0.08)", color: "#15803D" }}
                      >
                        Ativos/outros: {fmtNumber(Math.max(0, negocio.itens - negocio.descontinuado_com_saldo - negocio.transferencia_bravi))}
                      </span>
                      {negocio.descontinuado_com_saldo > 0 && (
                        <button
                          type="button"
                          onClick={() => aplicarFiltro({ label: `Descontinuados · ${negocio.tipo_negocio}`, tipo_negocio: negocio.tipo_negocio, status: "DESCONTINUADO_COM_SALDO" })}
                          className="rounded-full px-2.5 py-1 text-xs font-bold transition hover:brightness-95"
                          style={{ background: "rgba(185,28,28,0.10)", color: "#991B1B" }}
                        >
                          Desc. c/ saldo: {fmtNumber(negocio.descontinuado_com_saldo)}
                        </button>
                      )}
                      {negocio.transferencia_bravi > 0 && (
                        <button
                          type="button"
                          onClick={() => aplicarFiltro({ label: `Bravi · ${negocio.tipo_negocio}`, tipo_negocio: negocio.tipo_negocio, transferencia_bravi: "Sim" })}
                          className="rounded-full px-2.5 py-1 text-xs font-bold transition hover:brightness-95"
                          style={{ background: "rgba(124,58,237,0.10)", color: "#6D28D9" }}
                        >
                          Bravi: {fmtNumber(negocio.transferencia_bravi)}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <KpiSmall
                      label="Críticos"
                      value={fmtNumber(negocio.criticos)}
                      onClick={() => aplicarFiltro({ label: `Críticos · ${negocio.tipo_negocio}`, tipo_negocio: negocio.tipo_negocio, semaforo: "VERMELHO" })}
                      active={isFiltroAtivo(activeFilter, { tipo_negocio: negocio.tipo_negocio, semaforo: "VERMELHO" })}
                    />
                    <KpiSmall
                      label="Excesso"
                      value={fmtNumber(negocio.excesso)}
                      onClick={() => aplicarFiltro({ label: `Excesso · ${negocio.tipo_negocio}`, tipo_negocio: negocio.tipo_negocio, status: "EXCESSO" })}
                      active={isFiltroAtivo(activeFilter, { tipo_negocio: negocio.tipo_negocio, status: "EXCESSO" })}
                    />
                    <KpiSmall
                      label="Saldo"
                      value={fmtCompact(negocio.saldo_total)}
                      onClick={() => aplicarFiltro({ label: negocio.tipo_negocio, tipo_negocio: negocio.tipo_negocio })}
                      active={isFiltroAtivo(activeFilter, { tipo_negocio: negocio.tipo_negocio }) && !activeFilter?.status}
                    />
                    <KpiSmall
                      label="Cob. futura"
                      value={`${fmtNumber(negocio.cobertura_futura_media_dias, 0)} d`}
                      onClick={() => aplicarFiltro({ label: negocio.tipo_negocio, tipo_negocio: negocio.tipo_negocio })}
                    />
                  </div>
                </div>
              ))}
      </div>

        {negocioAClassificar && negocioAClassificar.itens > 0 && (
          <button
            type="button"
            onClick={() => aplicarFiltro({ label: "Itens a classificar", classificacao_cadastro: "NAO_CLASSIFICADOS" })}
            className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: activeFilter?.classificacao_cadastro === "NAO_CLASSIFICADOS" ? "rgba(22,59,99,0.06)" : "#FFFFFF" }}
              >
            <PackageSearch size={16} />
            {fmtNumber(negocioAClassificar.itens)} itens a classificar
          </button>
        )}
        </div>
      )}

      <FiltrosEstoquePanel
        filtro={activeFilter}
        opcoes={opcoesFiltros}
        escopo={escopoEstoque}
        onChange={atualizarFiltroCampo}
        onClear={() => aplicarFiltro(null)}
      />


      <BraviSeriePanel
        active={mostrarCardsPortfolio && escopoEstoque === "produtos"}
        refreshTick={refreshTick}
        selectedItem={selected}
        loadingSelected={false}
        onClearSelected={() => setSelected(null)}
      />

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Base analítica</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              {isTabelaProdutos ? `${escopoTitulo} por disponibilidade e faturamento` : `${escopoTitulo} por cobertura e estoque ideal`}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {loadingItens && (
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" }}>
                <RefreshCw size={13} className="animate-spin" /> Atualizando tabela
              </span>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setColumnSelectorOpen((current) => !current)}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition hover:bg-slate-50"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: columnSelectorOpen ? "rgba(22,59,99,0.06)" : "#FFFFFF" }}
                title="Selecionar colunas"
              >
                <Settings2 size={14} /> Colunas
              </button>

              {columnSelectorOpen && (
                <div
                  className="absolute right-0 top-10 z-[90] w-[320px] rounded-2xl border bg-white p-3 text-left shadow-2xl"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                        Selecionar colunas
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                        Código e descrição ficam fixos.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setColumnSelectorOpen(false)}
                      className="rounded-md p-1 hover:bg-slate-100"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={resetColunasTabela}
                      className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                    >
                      Padrão
                    </button>
                    <button
                      type="button"
                      onClick={mostrarTodasColunasTabela}
                      className="rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                    >
                      Mostrar todas
                    </button>
                  </div>

                  <div className="max-h-[360px] space-y-1 overflow-auto pr-1">
                    {colunasOpcoesTabela.map((col) => (
                      <label
                        key={col.key}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={isColunaVisivel(col.key)}
                          onChange={() => toggleColunaTabela(col.key)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Página {page} de {totalPages} · {fmtNumber(itensResp?.total || 0)} itens no escopo</p>
          </div>
        </div>

        <div className="relative overflow-auto scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-slate-100" style={{ maxHeight: "calc(100vh - 300px)", scrollbarGutter: "stable" }}>
          {loadingItens && (
            <div className="sticky left-0 top-0 z-[90] flex items-center gap-2 border-b px-4 py-2 text-xs font-bold shadow-sm" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" }}>
              <RefreshCw size={14} className="animate-spin" />
              Buscando itens da tabela...
            </div>
          )}
          <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: larguraMinimaTabela }}>
            <thead className="sticky top-0 z-20 text-left text-[11px] uppercase tracking-wide text-white shadow-sm" style={{ background: "#163B63" }}>
              <tr>
                <th className="sticky left-0 z-30 w-[82px] min-w-[82px] px-3 py-2" style={{ background: "#163B63" }}>Código</th>
                <th className="sticky left-[82px] z-30 w-[220px] min-w-[220px] px-3 py-2" style={{ background: "#163B63" }}>
                  {renderFiltroDescricao()}
                </th>
                {isColunaVisivel("status") && <th className="px-2 py-2">Status</th>}
                {isColunaVisivel("curva_a") && <th className="px-2 py-2">Curva A</th>}
                {isColunaVisivel("tipo") && <th className="px-2 py-2">Tipo</th>}
                {isColunaVisivel("unid") && <th className="px-2 py-2">UM</th>}
                {isColunaVisivel("segmento") && <th className="px-2 py-2">Segmento</th>}
                {isColunaVisivel("mercado") && <th className="px-2 py-2">Mercado</th>}
                {isColunaVisivel("saldo_origem") && <th className="px-2 py-2">Origem saldo</th>}
                {isColunaVisivel("data_saldo_origem") && <th className="px-2 py-2">Data saldo</th>}
                {colunasTabela.map((col) => <SortableTh key={col.key} label={col.label} column={col.key} sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />)}
              </tr>
            </thead>
            <tbody>
              {itensOrdenados.map((item) => {
                const itemEx = item as AgingEstoqueItem & Record<string, unknown>
                const alertaPrevisao = getNum(item, "previsao_consumo_alerta") > 0

                return (
                  <tr
                    key={`${item.codigo}-${item.tipo}-${item.grupo_gerencial}`}
                    className="cursor-pointer border-t text-xs transition hover:bg-slate-50"
                    style={{
                      borderColor: "var(--border)",
                      background: selected?.codigo === item.codigo ? "rgba(37,99,235,0.06)" : undefined,
                    }}
                    onClick={() => abrirDetalhe(item)}
                  >
                    <td
                      className="sticky left-0 z-10 w-[82px] min-w-[82px] whitespace-nowrap border-r px-3 py-2 text-xs font-bold"
                      style={{ color: "var(--text-primary)", borderColor: "var(--border)", background: selected?.codigo === item.codigo ? "#EFF6FF" : "#FFFFFF" }}
                    >
                      {item.codigo}
                    </td>
                    <td
                      className="sticky left-[82px] z-10 w-[220px] min-w-[220px] border-r px-3 py-2 text-xs"
                      style={{ borderColor: "var(--border)", background: selected?.codigo === item.codigo ? "#EFF6FF" : "#FFFFFF" }}
                    >
                      <div className="max-w-[190px] truncate font-medium" style={{ color: "var(--text-primary)" }} title={item.produto || ""}>{item.produto || "—"}</div>
                    </td>
                    {isColunaVisivel("status") && <td className="px-2 py-2"><SemaforoBadge item={item} /></td>}
                    {isColunaVisivel("curva_a") && <td className="px-2 py-2 text-center whitespace-nowrap">{String(itemEx.curva_a || item.abc_ytm || "—")}</td>}
                    {isColunaVisivel("tipo") && <td className="px-2 py-2 max-w-[70px] truncate whitespace-nowrap" title={String(item.tipo || item.tipo_produto_erp || "—")}>{item.tipo || item.tipo_produto_erp || "—"}</td>}
                    {isColunaVisivel("unid") && <td className="px-2 py-2 text-center whitespace-nowrap">{item.unid || "—"}</td>}
                    {isColunaVisivel("segmento") && <td className="px-2 py-2 max-w-[92px] truncate whitespace-nowrap" title={String(item.segmento || "—")}>{item.segmento || "—"}</td>}
                    {isColunaVisivel("mercado") && <td className="px-2 py-2 max-w-[82px] truncate whitespace-nowrap" title={String(item.mercado || "—")}>{item.mercado || "—"}</td>}
                    {isColunaVisivel("saldo_origem") && (
                      <td className="px-2 py-2">
                        <span className="inline-flex max-w-[82px] truncate rounded-full border px-2 py-1 text-[10px] font-bold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "rgba(15,23,42,0.03)" }} title={getSaldoOrigemTitle(itemEx)}>
                          {getSaldoOrigemLabel(itemEx)}
                        </span>
                      </td>
                    )}
                    {isColunaVisivel("data_saldo_origem") && <td className="px-2 py-2 whitespace-nowrap">{itemEx.data_saldo_origem ? fmtDate(String(itemEx.data_saldo_origem)) : "—"}</td>}
                    {colunasTabela.map((col) => {
                      const isGap = col.key === "estoque_ideal" || col.key === "estoque_ideal_valor" || col.key === "cobertura_consumo_lt" || col.key === "previsto_vs_consumido_pct"
                      const color = col.key === "previsto_vs_consumido_pct" && alertaPrevisao
                        ? "#DC2626"
                        : "var(--text-primary)"

                      return (
                        <td key={col.key} className={`px-2 py-2 text-right whitespace-nowrap ${isGap ? "font-semibold" : ""}`} style={{ color }}>
                          {fmtTableValue(item, col, isTabelaProdutos)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loadingItens && !itensOrdenados.length && <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum item encontrado na base atual.</div>}
          {loadingItens && !itensOrdenados.length && <div className="p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Carregando itens...</div>}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {loadingItens ? "Atualizando resultados..." : `Exibindo ${fmtNumber(itensOrdenados.length)} de ${fmtNumber(itensResp?.total || 0)} itens`}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Anterior</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Próxima</button>
          </div>
        </div>
      </div>

      <BasesModal
        open={basesModalOpen}
        onClose={() => setBasesModalOpen(false)}
        ultimasAtualizacoes={ultimasAtualizacoesBases}
        loadingAtualizacoes={loadingAtualizacoesBases}
        uploadingBaseId={uploadingBaseId}
        uploadMessage={uploadMessage}
        onUpload={handleUploadBase}
        onRefresh={carregarAtualizacoesBases}
      />
      {false && <ItemDrawer item={selected} loading={loadingDetalhe} onClose={() => setSelected(null)} />}
    </div>
  )
}
