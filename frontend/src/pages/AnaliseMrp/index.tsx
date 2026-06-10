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
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AgingEstoqueItem,
  buscarUltimaAtualizacao,
  getAgingEstoqueItem,
  uploadBase,
} from "@/services/api"

const PAGE_SIZE = 10

const API_BASE = String(import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev").replace(/\/$/, "")

type GranularidadeSerie = "mensal" | "semanal" | "diaria"
type EscopoEstoque = "produtos" | "insumos" | "todos"
type SemaforoEstoque = "VERMELHO" | "AMARELO" | "VERDE" | "CINZA"

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
  const params = new URLSearchParams()
  params.set("granularidade", granularidade)
  if (codigo) params.set("codigo", codigo)
  params.set("_", String(Date.now()))

  const response = await fetch(`${API_BASE}/aging-estoque/produtos/serie?${params.toString()}`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Erro ao buscar série PA/MR: ${response.status}`)
  }
  return response.json()
}

async function fetchJson<T>(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    searchParams.set(key, String(value))
  })

  // Evita que o navegador reutilize um resumo antigo quando muda o escopo ou sobe base nova.
  searchParams.set("_t", String(Date.now()))

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

function getAgingResumoDireto(params: { escopo: EscopoEstoque; classificacao_cadastro?: string }): Promise<AgingResumoResponse> {
  return fetchJson<AgingResumoResponse>("/aging-estoque/resumo", {
    escopo: params.escopo,
    classificacao_cadastro: params.classificacao_cadastro,
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
}): Promise<AgingItensResponse> {
  return fetchJson<AgingItensResponse>("/aging-estoque/itens", {
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
  })
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
  SEM_GIRO: "Sem giro",
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
    gap_total?: number
    faturamento_ytd_qtd?: number
    faturamento_ytd_valor?: number
    cobertura_media_dias?: number
    cobertura_futura_media_dias?: number
  }
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

function getCoberturaBaseProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  if (!item) return 0

  // Para PA/MR, a melhor base de cobertura é a demanda/previsão do mês.
  // Se não existir, cai para maior média para manter compatibilidade com itens sem forecast.
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
  const base = getCoberturaBaseProduto(item)
  if (base <= 0) return 0
  return getEstoqueAtualReal(item) / base
}

function getCoberturaFuturaProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  const base = getCoberturaBaseProduto(item)
  if (base <= 0) return 0
  return (getEstoqueAtualReal(item) + getPedidosAbertos(item)) / base
}

function getDiasEstoqueProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  return getCoberturaAtualProduto(item) * 30
}

function getEstoqueMaisEntradasProduto(item: AgingEstoqueItem | AgingEstoqueItemDetalhe | null | undefined) {
  return getEstoqueAtualReal(item) + getPedidosAbertos(item)
}

function normalizarCoberturaPaMrItem<T extends AgingEstoqueItem | AgingEstoqueItemDetalhe>(item: T): T {
  const demandaMes = getCoberturaBaseProduto(item)
  const estoqueAtual = getEstoqueAtualReal(item)
  const estoqueMaisEntradas = getEstoqueMaisEntradasProduto(item)

  const coberturaAtual = demandaMes > 0 ? estoqueAtual / demandaMes : 0
  const coberturaFutura = demandaMes > 0 ? estoqueMaisEntradas / demandaMes : 0
  const diasEstoque = coberturaAtual * 30

  return {
    ...(item as Record<string, unknown>),
    saldo: estoqueAtual,
    estoque_mais_pedidos: estoqueMaisEntradas,
    estoque_mais_entradas: estoqueMaisEntradas,
    dias_em_estoque: diasEstoque,
    cobertura_dias: diasEstoque,
    cobertura_meses_atual: coberturaAtual,
    cobertura_meses_futura: coberturaFutura,
    cobertura_futura_dias: coberturaFutura * 30,
    __cobertura_pa_mr_recalculada_front: true,
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

function arredondarEixoMaximo(value: number) {
  const n = Math.max(0, Number(value || 0))
  if (!Number.isFinite(n) || n <= 0) return 1

  const potencia = Math.pow(10, Math.floor(Math.log10(n)))
  const normalizado = n / potencia

  const fator =
    normalizado <= 1 ? 1 :
    normalizado <= 2 ? 2 :
    normalizado <= 5 ? 5 :
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
  const horaMatch = texto.match(/T(\d{2}:\d{2})|\s(\d{2}:\d{2})/)
  const hora = horaMatch?.[1] || horaMatch?.[2]

  const isoDate = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const [, ano, mes, dia] = isoDate
    const data = `${dia}/${mes}/${ano}`
    return hora ? `${data} às ${hora}` : data
  }

  const brDate = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brDate) {
    const [, dia, mes, ano] = brDate
    const data = `${dia}/${mes}/${ano}`
    return hora ? `${data} às ${hora}` : data
  }

  const d = new Date(texto)
  if (Number.isNaN(d.getTime())) return texto.slice(0, 10)

  const data = d.toLocaleDateString("pt-BR")
  const horaLocal = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

  return `${data} às ${horaLocal}`
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
  const inicio = new Date(2025, 0, 1)
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
      estoque: p.estoque_atual !== null && p.estoque_atual !== undefined ? Math.max(0, Number(p.estoque_atual || 0)) : (p.saldo_grafico !== null && p.saldo_grafico !== undefined ? Math.max(0, Number(p.saldo_grafico || 0)) : null),
      estoque_medio: p.estoque_atual !== null && p.estoque_atual !== undefined ? Math.max(0, Number(p.estoque_atual || 0)) : (p.saldo_grafico !== null && p.saldo_grafico !== undefined ? Math.max(0, Number(p.saldo_grafico || 0)) : null),
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
  const estoqueComEntradas = saldoReal + getPedidosAbertos(item)
  const demanda = getNum(item, "demanda_mes_atual")

  if (demanda <= 0) return "CINZA"
  if (status === "RUPTURA" || status === "CRITICO") return "VERMELHO"
  if (saldoReal <= 0) return "VERMELHO"
  if (demanda > 0 && estoqueComEntradas < demanda) return "VERMELHO"

  if (status === "EXCESSO" || status === "SAUDAVEL") return "VERDE"

  return "VERDE"
}

function SemaforoBadge({ item }: { item: AgingEstoqueItem }) {
  const semaforo = calcularSemaforoEstoque(item)
  const style = SEMAFORO_STYLE[semaforo]
  const saldoReal = getEstoqueAtualReal(item)
  const estoqueComEntradas = saldoReal + getPedidosAbertos(item)
  const previsaoMes = getPrevisaoMesAtual(item)
  const consumoMes = getConsumoMesAtual(item)
  const tipo = String(item.tipo || (item as AgingEstoqueItem & Record<string, unknown>).tipo_produto_erp || "").toUpperCase()
  const title = tipo !== "PA" && tipo !== "MR"
    ? `Status: ${SEMAFORO_LABEL[semaforo]} | Consumo mês: ${fmtNumber(consumoMes, 0)} | Previsão mês: ${fmtNumber(previsaoMes, 0)} | Consumo previsto: ${fmtNumber(getPercentualConsumoPrevisto(item), 0)}% | Mês decorrido: ${fmtNumber(getPercentualMesDecorrido(), 0)}%`
    : `Status: ${SEMAFORO_LABEL[semaforo]} | Estoque real: ${fmtNumber(saldoReal, 0)} | Estoque + entradas: ${fmtNumber(estoqueComEntradas, 0)} | Demanda ref.: ${fmtNumber(previsaoMes, 0)}`

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

function LinhaTempoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const ponto = payload[0]?.payload || {}
  const entradas = Array.isArray(ponto.entradas_detalhe) ? ponto.entradas_detalhe : []
  const faturamento = Array.isArray(ponto.faturamento_detalhe) ? ponto.faturamento_detalhe : []

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

      {faturamento.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <p className="mb-1 font-bold" style={{ color: "var(--text-primary)" }}>Faturamento SD2</p>
          <div className="max-h-[160px] space-y-1 overflow-auto pr-1">
            {faturamento.slice(0, 6).map((linha: any, idx: number) => (
              <div key={`${linha.codigo}-${linha.data}-${idx}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-2 py-1.5">
                <span style={{ color: "var(--text-secondary)" }}>{linha.codigo || "—"}</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmtNumber(Number(linha.quantidade || 0), 0)}</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmtCurrency(Number(linha.valor || 0), 0)}</span>
              </div>
            ))}
            {faturamento.length > 6 && <p style={{ color: "var(--text-secondary)" }}>+ {fmtNumber(faturamento.length - 6)} linha(s) de faturamento</p>}
          </div>
        </div>
      )}

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
    let mounted = true
    setLoading(true)
    setError("")
    setData(null)

    getBraviSerie(granularidade, codigoEsperado || undefined)
      .then((res) => {
        if (!mounted) return

        if (codigoEsperado) {
          const codigoRetornado = String(res?.item?.codigo || res?.codigos_produtos?.[0] || res?.codigos_bravi?.[0] || "")
          const modo = String(res?.debug?.modo || "")
          const qtdCodigos = Number(res?.codigos_produtos?.length ?? res?.codigos_bravi?.length ?? 0)

          if (codigoRetornado !== codigoEsperado || (qtdCodigos && qtdCodigos !== 1) || (modo && modo !== "item_pa_mr_rapido")) {
            setData(null)
            setError(`A série retornada não está filtrada pelo item ${codigoEsperado}. Confirme se o backend está na versão v8.`)
            return
          }
        }

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
  }, [active, granularidade, refreshTick, codigoSelecionado])

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
    if (!itemSelecionado) return serieOriginal

    const hoje = new Date()
    const anoAtual = hoje.getFullYear()
    const mesAtual = hoje.getMonth() + 1
    const diaAtual = hoje.toISOString().slice(0, 10)
    const ordemMensalAtual = `${anoAtual}-${String(mesAtual).padStart(2, "0")}`

    // Para o gráfico por item PA/MR, o estoque precisa vir da mesma linha da tabela.
    // O resumo do endpoint de série pode trazer valor de série/posição diferente e estava gerando 1.052 no SUGCLEAN.
    const estoqueTabela = getEstoqueAtualReal(itemSelecionado)
    const estoqueAtual = Number(Number.isFinite(estoqueTabela) ? estoqueTabela : (resumo.estoque_atual ?? 0))
    const quarentenaAtual = Number((itemSelecionado as any).saldo_quarentena ?? (itemSelecionado as any).quarentena_98 ?? 0)

    return serieOriginal.map((ponto: any) => {
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
        estoque_quarentena: null,
        quarentena: null,
        saldo_quarentena: null,
      }

      if (isAtual) {
        pontoSaida.estoque = estoqueAtual > 0 ? estoqueAtual : null
        pontoSaida.estoque_medio = estoqueAtual > 0 ? estoqueAtual : null
        pontoSaida.estoque_quarentena = quarentenaAtual > 0 ? quarentenaAtual : null
        pontoSaida.quarentena = quarentenaAtual > 0 ? quarentenaAtual : null
        pontoSaida.saldo_quarentena = quarentenaAtual > 0 ? quarentenaAtual : null
        pontoSaida.tipo_estoque = "atual"
        return pontoSaida
      }

      if (isFuturo) {
        // V23: por decisão de negócio, não projetamos saldo de estoque no gráfico PA/MR.
        // Mantemos somente entradas previstas e forecast/demanda para não confundir
        // disponibilidade real com uma projeção simplificada.
        pontoSaida.estoque = null
        pontoSaida.estoque_medio = null
        pontoSaida.saldo_projetado = null
        pontoSaida.tipo_estoque = "sem_projecao"
      }

      return pontoSaida
    })
  }, [serieOriginal, itemSelecionado, resumo.estoque_atual, granularidade])
  const tituloSerie = itemSelecionado
    ? `${itemSelecionado.codigo} · ${loading ? "carregando série do item..." : (itemSelecionado.produto || "Item selecionado")}`
    : "Estoque e faturamento dos PA / MR"
  const descricaoSerie = itemSelecionado
    ? "Visão filtrada pelo item selecionado na tabela. Para voltar ao consolidado, clique em limpar seleção."
    : "Visão consolidada dos produtos PA/MR da tela, com Bravi apenas como tag/filtro. O estoque é exibido somente nos períodos com snapshot real; não é repetido artificialmente em todos os meses."

  const eixoMaxComum = useMemo(() => {
    const maiorValor = serie.reduce((max, ponto: any) => {
      const estoqueDisponivel = Math.max(0, Number(ponto.estoque || 0))
      const entradasPrevistas = Math.max(0, Number(ponto.entradas_previstas || 0))
      const quarentena = Math.max(0, Number(ponto.estoque_quarentena || ponto.quarentena || 0))
      const faturamento = Math.max(0, Number(ponto.faturamento_qtd || 0))
      const forecast = Math.max(0, Number(ponto.demanda || ponto.forecast || 0))
      const disponibilidade = estoqueDisponivel + entradasPrevistas + quarentena

      return Math.max(max, disponibilidade, faturamento, forecast)
    }, 0)

    return arredondarEixoMaximo(maiorValor)
  }, [serie])

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
              Limpar seleção
            </button>
          )}
          {([
            ["mensal", "Mensal"],
            ["semanal", "Semanal"],
            ["diaria", "Diária"],
          ] as [GranularidadeSerie, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setGranularidade(key)}
              className="rounded-xl border px-3 py-2 text-sm font-bold transition hover:bg-slate-50"
              style={{
                borderColor: granularidade === key ? "#163B63" : "var(--border)",
                background: granularidade === key ? "rgba(22,59,99,0.08)" : "#FFFFFF",
                color: granularidade === key ? "#163B63" : "var(--text-primary)",
              }}
            >
              {label}
            </button>
          ))}
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
                V23: cobertura PA/MR recalculada no front. Sem projeção de saldo no gráfico; estoque aparece como foto atual e entradas previstas ficam separadas.
              </p>
            </div>
            <span className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: "rgba(124,58,237,0.28)", color: "#6D28D9", background: "rgba(124,58,237,0.08)" }}>
              {loading && itemSelecionado ? "Carregando item" : itemSelecionado ? "Item selecionado" : "PA / MR"}
            </span>
          </div>

          <div className="h-[380px]">
            {serie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 24, right: 26, left: 0, bottom: 54 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
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
                    yAxisId="estoque"
                    type="monotone"
                    dataKey="estoque_quarentena"
                    name="Quarentena 98"
                    stroke="#F59E0B"
                    strokeWidth={2.5}
                    strokeDasharray="4 3"
                    dot={{ r: 2 }}
                    connectNulls={false}
                    hide={serieOculta("estoque_quarentena")}
                  />

                  <Line
                    yAxisId="valor"
                    type="monotone"
                    dataKey="faturamento_valor"
                    name="Faturamento SD2 (R$)"
                    stroke="#9333EA"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls={false}
                    hide={serieOculta("faturamento_valor")}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-secondary)" }}>
                {loading ? "Carregando série do item selecionado..." : codigoSelecionado ? "Sem série disponível para este item." : "Sem série disponível para os PA/MR."}
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
              <KpiSmall label="Quarentena 98" value={fmtCompact(getAnyNumber(item as unknown as Record<string, unknown>, "saldo_quarentena") || getAnyNumber(item as unknown as Record<string, unknown>, "quarentena"))} />
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
              <ChartBox title="SB8 diário do mês atual" subtitle="Saldo disponível considera somente armazéns 04/07 descontando empenho. Quarentena do armazém 98 aparece separada.">
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
                              : name === "saldo_quarentena"
                                ? "Quarentena 98"
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
                        <Bar
                          dataKey="saldo_quarentena"
                          name="Quarentena 98"
                          stackId="sb8"
                          fill="#F59E0B"
                          barSize={46}
                          radius={[6, 6, 0, 0]}
                        >
                          <LabelList
                            dataKey="saldo_quarentena"
                            position="top"
                            formatter={(value: any) => Number(value || 0) > 0 ? fmtCompact(Number(value)) : ""}
                            style={{ fontSize: 11, fontWeight: 700, fill: "#92400E" }}
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
            Consumo histórico, demanda MPS/BOM, faturamento SD2, compras previstas, estoque disponível, quarentena e ponto de pedido.
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-8">
            <KpiSmall label="Saldo atual" value={fmtCompact(item.saldo)} />
            <KpiSmall label="Quarentena 98" value={fmtCompact(getAnyNumber(item as unknown as Record<string, unknown>, "saldo_quarentena") || getAnyNumber(item as unknown as Record<string, unknown>, "quarentena"))} />
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
                  <RefreshCw size={13} className="animate-spin" /> Atualizando
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
                      dataKey="estoque_quarentena"
                      name="Quarentena 98"
                      stackId="estoque"
                      fill="#F59E0B"
                      fillOpacity={0.12}
                      stroke="#B45309"
                      strokeDasharray="4 3"
                      radius={[6, 6, 0, 0]}
                      hide={serieOculta("estoque_quarentena")}
                    />
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
                    <Line yAxisId="estoque" type="monotone" dataKey="faturamento_qtd" name="Faturamento SD2 (qtd)" stroke="#0F766E" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} hide={serieOculta("faturamento_qtd")}>
                      <LabelList dataKey="faturamento_qtd" content={renderChartLabel} />
                    </Line>
                    <Line yAxisId="valor" type="monotone" dataKey="faturamento_valor" name="Faturamento SD2 (R$)" stroke="#9333EA" strokeWidth={2.5} strokeDasharray="6 4" dot={false} connectNulls={false} hide={serieOculta("faturamento_valor")} />
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
  const [tableFilterOpen, setTableFilterOpen] = useState<keyof FiltroTabelaEstoque | null>(null)
  const [tableSearchDraft, setTableSearchDraft] = useState("")
  const [columnSelectorOpen, setColumnSelectorOpen] = useState(false)
  const [colunasVisiveisPorEscopo, setColunasVisiveisPorEscopo] = useState<Partial<Record<EscopoEstoque, string[]>>>({})
  const [mostrarSaudeLinhas, setMostrarSaudeLinhas] = useState(false)

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

  useEffect(() => {
    let mounted = true
    setLoadingResumo(true)
    setError("")
    getAgingResumoDireto({
      escopo: escopoEstoque,
      classificacao_cadastro: activeFilter?.classificacao_cadastro || classificacaoPadraoPorEscopo(escopoEstoque),
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
    const itemSelecionado = escopoEstoque === "insumos"
      ? item
      : normalizarCoberturaPaMrItem(item)

    setSelected(itemSelecionado as AgingEstoqueItemDetalhe)
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

    getAgingEstoqueItem(codigo, horizonteFuturo)
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


  const exportCsv = () => {
    const header = [
      "codigo",
      "produto",
      ...colunasBaseTabela.filter((col) => isColunaVisivel(col.key)).map((col) => col.key),
      ...colunasTabela.map((col) => col.key),
    ]
    const csv = [
      header.join(";"),
      ...itensOrdenados.map((r) =>
        header
          .map((h) => {
            const colunaNumerica = NUMERIC_COLUMNS.find((col) => col.key === h)
            const valor = h === "status"
              ? SEMAFORO_LABEL[calcularSemaforoEstoque(r)]
              : colunaNumerica
                ? getValorNumericoTabela(r, colunaNumerica.key, isTabelaProdutos)
                : ((r as any)[h] ?? "")

            return String(valor).replace(/;/g, ",")
          })
          .join(";")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gestao_estoque_${escopoEstoque}_pagina.csv`
    a.click()
    URL.revokeObjectURL(url)
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
              onClick={() => setRefreshTick((x) => x + 1)}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <RefreshCw size={16} /> Atualizar
            </button>
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <Download size={16} /> Exportar CSV
            </button>
          </div>
        </div>

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
            helper="Acima da política"
            icon={<ArrowUpRight size={20} />}
            tone="blue"
            onClick={() => aplicarFiltro({ label: "Excesso", status: "EXCESSO" })}
            active={isFiltroAtivo(activeFilter, { status: "EXCESSO" }) && !activeFilter?.tipo_negocio}
          />
          <KpiCard
            label="Sem giro"
            value={fmtNumber(resumo?.resumo?.sem_giro || 0)}
            helper="sem consumo histórico relevante"
            icon={<PackageSearch size={20} />}
            tone="default"
            onClick={() => aplicarFiltro({ label: "Sem giro", status: "SEM_GIRO" })}
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
                <option value="SEM_GIRO">Sem giro</option>
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
                    onClick={() => setSelected(item as AgingEstoqueItemDetalhe)}
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
            onClick={() => setRefreshTick((current) => current + 1)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} disabled={!itensOrdenados.length}>
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

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
          helper="Acima da política"
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
              label="Sem giro"
              value={fmtNumber(resumo?.resumo?.sem_giro || 0)}
              helper="sem consumo histórico relevante"
              icon={<PackageSearch size={20} />}
              tone="default"
              onClick={() => aplicarFiltro({ label: "Sem giro", status: "SEM_GIRO" })}
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
