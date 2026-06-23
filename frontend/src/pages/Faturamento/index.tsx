import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  Award,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  DollarSign,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
  UploadCloud,
  Users,
} from "lucide-react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts"


type Cards = {
  faturamento_total?: number
  quantidade_total?: number
  clientes_ativos?: number
  produtos_ativos?: number
  ticket_medio_cliente?: number
  preco_medio?: number
  forecast_total?: number
  orcado_total?: number
  delta_forecast?: number
  delta_orcado?: number
  atingimento_forecast_pct?: number
  atingimento_orcado_pct?: number
  registros?: number
  top_cliente_nome?: string
  top_cliente_participacao_pct?: number
  media_dias_preped_faturamento?: number
  mediana_dias_preped_faturamento?: number
  media_dias_pedido_faturamento?: number
  mediana_dias_pedido_faturamento?: number
  pct_faturado_ate_7_dias?: number
  pct_faturado_acima_30_dias?: number
  faturamento_com_prepedido?: number
  faturamento_prepedido_mesmo_mes?: number
  faturamento_prepedido_mes_anterior?: number
  faturamento_prepedido_fim_mes?: number
  pct_faturamento_prepedido_fim_mes?: number
  carteira_pendente_valor?: number
  carteira_pendente_quantidade?: number
  prepedidos_pendentes?: number
  clientes_pendentes?: number
  produtos_pendentes?: number
  carteira_vencida_valor?: number
  carteira_vencida_quantidade?: number
  pct_carteira_vencida_valor?: number
  registros_faturados_base?: number
  registros_prepedidos_pendentes_base?: number
  registros_prepedidos_emitidos_base?: number
}

type Mes = {
  mes?: number
  mes_nome?: string
  faturamento?: number
  quantidade?: number
  forecast?: number
  orcado?: number
  delta_forecast?: number
  delta_orcado?: number
  atingimento_forecast_pct?: number
  atingimento_orcado_pct?: number
  clientes?: number
  produtos?: number
  preco_medio?: number
}

type Cliente = {
  rank_valor?: number
  rank_qtd?: number
  cliente?: string
  nome?: string
  nome_fantasia?: string
  tipo_cliente?: string
  estado?: string
  municipio?: string
  regiao?: string
  desc_regiao?: string
  pais_estimado?: string
  confianca_pais?: string
  faturamento?: number
  quantidade?: number
  preco_medio?: number
  produtos?: number
  registros?: number
  participacao_valor_pct?: number
  participacao_qtd_pct?: number
  acumulado_valor_pct?: number
  acumulado_qtd_pct?: number
  abc_valor?: string
  abc_qtd?: string
}

type Produto = {
  produto?: string
  descricao?: string
  grupo?: string
  linha?: string
  faturamento?: number
  quantidade?: number
  forecast?: number
  orcado?: number
  delta_forecast?: number
  delta_orcado?: number
  atingimento_forecast_pct?: number
  atingimento_orcado_pct?: number
  preco_medio?: number
  clientes?: number
  participacao_valor_pct?: number
}

type Linha = {
  linha?: string
  faturamento?: number
  quantidade?: number
  clientes?: number
  produtos?: number
  participacao_valor_pct?: number
}

type Estado = {
  estado?: string
  faturamento?: number
  quantidade?: number
  clientes?: number
  participacao_valor_pct?: number
}

type TipoCliente = {
  tipo_cliente?: string
  faturamento?: number
  quantidade?: number
  clientes?: number
  participacao_valor_pct?: number
}


type Pais = {
  pais?: string
  faturamento?: number
  quantidade?: number
  clientes?: number
  participacao_valor_pct?: number
  confianca_baixa?: number
}

type CicloAging = {
  faixa?: string
  registros?: number
  faturamento?: number
  quantidade?: number
  participacao_valor_pct?: number
}

type CicloOrigem = {
  origem?: string
  registros?: number
  faturamento?: number
  quantidade?: number
  participacao_valor_pct?: number
}

type PendenteResumo = {
  status?: string
  faixa?: string
  valor?: number
  quantidade?: number
  prepedidos?: number
  clientes?: number
  participacao_valor_pct?: number
}

type PendenteCliente = {
  cliente?: string
  nome?: string
  estado?: string
  pais_estimado?: string
  valor?: number
  quantidade?: number
  prepedidos?: number
  produtos?: number
  participacao_valor_pct?: number
}

type PendenteProduto = {
  produto?: string
  descricao?: string
  linha?: string
  grupo?: string
  valor?: number
  quantidade?: number
  prepedidos?: number
  clientes?: number
  participacao_valor_pct?: number
}

type ResumoFaturamento = {
  ano: number
  bloco: string
  escopo_label?: string
  cards: Cards
  meses: Mes[]
  clientes: Cliente[]
  produtos: Produto[]
  linhas: Linha[]
  estados: Estado[]
  paises?: Pais[]
  tipos_clientes: TipoCliente[]
  ciclo_aging?: CicloAging[]
  ciclo_origem?: CicloOrigem[]
  pendentes_status?: PendenteResumo[]
  pendentes_aging?: PendenteResumo[]
  pendentes_entrega?: PendenteResumo[]
  pendentes_clientes?: PendenteCliente[]
  pendentes_produtos?: PendenteProduto[]
  meta?: {
    join_clientes?: string
    qtd_clientes_dimensao?: number
    observacao?: string
    produto_filtro?: string
    fonte_faturamento?: string
    fonte_pedidos?: string
    fonte_carteira_pendente?: string
  }
}

const AZUL = "#17375E"
const AZUL_CLARO = "#7EA6C8"
const VERDE = "#0F766E"
const LARANJA = "#D97706"
const ROXO_SUAVE = "#7C3AED"
const VERMELHO_SUAVE = "#DC2626"
const CINZA_AZULADO = "#CBD5E1"
const PALETA_LINHAS = [AZUL, AZUL_CLARO, VERDE, LARANJA, ROXO_SUAVE, "#64748B", "#0EA5E9", "#A16207"]

const APP_FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const CHART_TICK_11 = { fontSize: 11, fontFamily: APP_FONT_FAMILY, fill: "#64748B" }
const CHART_TICK_12 = { fontSize: 12, fontFamily: APP_FONT_FAMILY, fill: "#64748B" }
const chartLabelStyle = (fill: string, fontSize = 11) => ({
  fill,
  fontSize,
  fontWeight: 700,
  fontFamily: APP_FONT_FAMILY,
})

const ESCOPOS = [
  { value: "TODOS", label: "Todos" },
  { value: "ANESTESICOS", label: "Anestésicos Injetáveis" },
  { value: "PPS", label: "PPS" },
  { value: "BRAVI", label: "Bravi" },
]

const API_BASE = String(import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev").replace(/\/$/, "")
const BASE_CLIENTES = "d_clientes"

type BaseFaturamentoUpload = {
  id: string
  titulo: string
  subtitulo: string
  usoNaTela: string
  aceita?: string
  obrigatoria?: boolean
  compartilhada?: boolean
}

const BASES_FATURAMENTO_UPLOAD: BaseFaturamentoUpload[] = [
  {
    id: BASE_CLIENTES,
    titulo: "dClientes",
    subtitulo: "Cadastro de clientes",
    usoNaTela: "Atualiza nomes, UF, município, região, tipo de cliente e dados usados para ranking geográfico.",
    aceita: ".xlsx,.xls,.csv",
    obrigatoria: true,
    compartilhada: true,
  },
  {
    id: "faturados",
    titulo: "Faturados",
    subtitulo: "Base comercial de faturamento",
    usoNaTela: "Conecta documento, pedido, pré-pedido, cliente, produto, quantidade, valor e datas do ciclo até o faturamento.",
    aceita: ".xlsx,.xls",
    obrigatoria: true,
  },
  {
    id: "prepedidos_pendentes",
    titulo: "Pré-pedidos pendentes",
    subtitulo: "Carteira em aberto",
    usoNaTela: "Mostra volume ainda não atendido, status, saldo, data de entrega e aging da carteira pendente.",
    aceita: ".xlsx,.xls",
  },
  {
    id: "prepedidos_emitidos",
    titulo: "Pré-pedidos emitidos",
    subtitulo: "Visão operacional de pré-pedidos",
    usoNaTela: "Base auxiliar para conferência da entrada de pré-pedidos. Usar como apoio enquanto a regra da visão histórica é validada.",
    aceita: ".xlsx,.xls",
  },
]

function fmtNumero(value?: number, digits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value ?? 0)
}

function fmtMoney(value?: number) {
  const numero = value ?? 0
  const abs = Math.abs(numero)
  if (abs >= 1_000_000) return `R$ ${fmtNumero(numero / 1_000_000, 1)} mi`
  if (abs >= 1_000) return `R$ ${fmtNumero(numero / 1_000, 1)} mil`
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(numero)
}

function fmtMoneyFull(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value ?? 0)
}

function labelMoney(value: any) {
  const numero = Number(value || 0)
  if (!numero) return ""
  return fmtMoney(numero)
}

function labelQtd(value: any) {
  const numero = Number(value || 0)
  if (!numero) return ""
  return fmtNumero(numero)
}

function labelPct(value: any) {
  const numero = Number(value || 0)
  if (!numero) return ""
  return fmtPct(numero)
}

function fmtPct(value?: number) {
  return `${fmtNumero(value ?? 0, 1)}%`
}

function fmtDataHora(value?: string | null) {
  if (!value) return "Não carregada"
  const data = new Date(value)
  if (Number.isNaN(data.getTime())) return "Não carregada"
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function abreviar(texto?: string, max = 22) {
  const valor = String(texto || "-").trim()
  if (valor.length <= max) return valor
  return `${valor.slice(0, max - 1)}…`
}

function badgeAbc(classe?: string) {
  const c = String(classe || "C").toUpperCase()
  if (c === "A") return "bg-emerald-50 text-emerald-700 ring-emerald-200"
  if (c === "B") return "bg-amber-50 text-amber-700 ring-amber-200"
  return "bg-slate-100 text-slate-600 ring-slate-200"
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg = "#F1F5F9",
  iconColor = AZUL,
}: {
  title: string
  value: string
  subtitle?: string
  icon: any
  iconBg?: string
  iconColor?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
          <p className="mt-5 text-3xl font-bold leading-tight text-slate-900 tabular-nums">{value}</p>
          {subtitle && <p className="mt-2 truncate text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-xl p-3" style={{ backgroundColor: iconBg, color: iconColor }}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}


type FaturamentoCacheEntry = {
  savedAt: number
  version: string | null
  data: ResumoFaturamento
}

type FaturamentoCacheResponse = {
  chave: string
  ano: number
  bloco: string
  produto?: string | null
  versao_base: string
  from_cache?: boolean
  atualizado_em?: string | null
  ultima_atualizacao?: string | null
  payload: ResumoFaturamento
}

type FaturamentoVersaoResponse = {
  chave: string
  ano: number
  bloco: string
  produto?: string | null
  versao_base: string
  cache_disponivel: boolean
  cache_versao?: string | null
  cache_atualizado_em?: string | null
  ultima_atualizacao?: string | null
  bases?: Record<string, string | null>
}

const FATURAMENTO_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const FATURAMENTO_CACHE_PREFIX = "dfl-faturamento-cache-v70:"
const faturamentoRuntimeCache = new Map<string, FaturamentoCacheEntry>()

function faturamentoCacheKey(ano: number, bloco: string, produtoFiltro: string) {
  return `${ano}|${bloco || "TODOS"}|${produtoFiltro.trim().toLowerCase()}`
}

function readFaturamentoCache(ano: number, bloco: string, produtoFiltro: string): FaturamentoCacheEntry | null {
  const key = faturamentoCacheKey(ano, bloco, produtoFiltro)
  const runtime = faturamentoRuntimeCache.get(key)

  if (runtime?.data && Date.now() - runtime.savedAt <= FATURAMENTO_CACHE_TTL_MS) {
    return runtime
  }

  if (runtime) {
    faturamentoRuntimeCache.delete(key)
  }

  try {
    const raw = window.localStorage.getItem(`${FATURAMENTO_CACHE_PREFIX}${key}`)
    if (!raw) return null

    const parsed = JSON.parse(raw) as FaturamentoCacheEntry
    if (!parsed?.data || !parsed.savedAt || Date.now() - parsed.savedAt > FATURAMENTO_CACHE_TTL_MS) {
      window.localStorage.removeItem(`${FATURAMENTO_CACHE_PREFIX}${key}`)
      return null
    }

    faturamentoRuntimeCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeFaturamentoCache(
  ano: number,
  bloco: string,
  produtoFiltro: string,
  data: ResumoFaturamento,
  version: string | null,
) {
  const key = faturamentoCacheKey(ano, bloco, produtoFiltro)
  const entry: FaturamentoCacheEntry = {
    savedAt: Date.now(),
    version,
    data,
  }

  faturamentoRuntimeCache.set(key, entry)

  try {
    window.localStorage.setItem(`${FATURAMENTO_CACHE_PREFIX}${key}`, JSON.stringify(entry))
  } catch {
    // localStorage pode estar indisponível; runtime cache continua funcionando enquanto app estiver aberto.
  }
}

function buildFaturamentoParams(ano: number, bloco: string, produtoFiltro: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({
    ano: String(ano),
    bloco: bloco || "TODOS",
  })

  if (produtoFiltro.trim()) {
    params.set("produto", produtoFiltro.trim())
  }

  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value)
    }
  })

  return params
}

async function getFaturamentoVersao(ano: number, bloco: string, produtoFiltro: string) {
  const params = buildFaturamentoParams(ano, bloco, produtoFiltro)
  const response = await fetch(`${API_BASE}/faturamento/cache/versao?${params.toString()}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
  })

  if (!response.ok) {
    throw new Error("Erro ao consultar versão do faturamento.")
  }

  return (await response.json()) as FaturamentoVersaoResponse
}

async function getFaturamentoCache(ano: number, bloco: string, produtoFiltro: string, force = false) {
  const params = buildFaturamentoParams(
    ano,
    bloco,
    produtoFiltro,
    force ? { force: "true", _t: String(Date.now()) } : undefined,
  )

  const response = await fetch(`${API_BASE}/faturamento/cache?${params.toString()}`, {
    cache: force ? "no-store" : "default",
    headers: force
      ? {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        }
      : undefined,
  })

  if (!response.ok) {
    throw new Error("Erro ao carregar cache de faturamento.")
  }

  return (await response.json()) as FaturamentoCacheResponse
}

function getInitialFaturamentoData(ano: number, bloco: string, produtoFiltro: string) {
  return readFaturamentoCache(ano, bloco, produtoFiltro)?.data ?? null
}

export default function FaturamentoPage() {
  const anoInicial = 2026
  const blocoInicial = "TODOS"
  const produtoFiltroInicial = ""
  const dadosIniciais = getInitialFaturamentoData(anoInicial, blocoInicial, produtoFiltroInicial)

  const [dados, setDados] = useState<ResumoFaturamento | null>(dadosIniciais)
  const [loading, setLoading] = useState(!dadosIniciais)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [versaoCarregada, setVersaoCarregada] = useState<string | null>(
    readFaturamentoCache(anoInicial, blocoInicial, produtoFiltroInicial)?.version ?? null,
  )

  const [ano, setAno] = useState(anoInicial)
  const [bloco, setBloco] = useState(blocoInicial)
  const [produtoBuscaInput, setProdutoBuscaInput] = useState("")
  const [produtoFiltro, setProdutoFiltro] = useState(produtoFiltroInicial)
  const [seriesVisiveis, setSeriesVisiveis] = useState({
    faturamento: true,
    quantidade: true,
    forecast: true,
    orcado: true,
  })
  const [buscaCliente, setBuscaCliente] = useState("")
  const [buscaProduto, setBuscaProduto] = useState("")
  const [produtoRankingModo, setProdutoRankingModo] = useState<"valor" | "quantidade">("valor")
  const [abcModo, setAbcModo] = useState<"valor" | "quantidade">("valor")
  const [sortCliente, setSortCliente] = useState<"faturamento" | "quantidade" | "participacao_valor_pct">("faturamento")
  const [sortAsc, setSortAsc] = useState(false)
  const [modalBasesAberto, setModalBasesAberto] = useState(false)
  const [arquivosBases, setArquivosBases] = useState<Record<string, File | null>>({})
  const [uploadingBaseId, setUploadingBaseId] = useState<string | null>(null)
  const [statusUploadBases, setStatusUploadBases] = useState<Record<string, string | null>>({})
  const [ultimaAtualizacaoBases, setUltimaAtualizacaoBases] = useState<Record<string, string | null>>({})

  async function carregarResumo(force = false, manterDadosAtuais = true) {
    try {
      setErro(null)

      const cached = !force ? readFaturamentoCache(ano, bloco, produtoFiltro) : null

      if (cached?.data) {
        setDados(cached.data)
        setVersaoCarregada(cached.version ?? null)
        setLoading(false)
      }

      if (!cached && !dados) {
        setLoading(true)
      } else if (manterDadosAtuais) {
        setRefreshing(true)
      }

      if (!force && cached?.version) {
        try {
          const versao = await getFaturamentoVersao(ano, bloco, produtoFiltro)

          if (versao.versao_base === cached.version) {
            setVersaoCarregada(versao.versao_base)
            return
          }
        } catch {
          // Se a checagem leve falhar, mantém o cache local visível.
          return
        }
      }

      const response = await getFaturamentoCache(ano, bloco, produtoFiltro, force)
      const payload = response.payload

      setDados(payload)
      setVersaoCarregada(response.versao_base)
      writeFaturamentoCache(ano, bloco, produtoFiltro, payload, response.versao_base)
    } catch (error) {
      console.error(error)
      if (!dados) {
        setErro("Não foi possível carregar o faturamento agora. Atualize a página ou tente novamente em alguns instantes.")
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function carregarUltimasAtualizacoesBases() {
    try {
      const resultados = await Promise.all(
        BASES_FATURAMENTO_UPLOAD.map(async (base) => {
          try {
            const response = await fetch(`${API_BASE}/upload/ultima-atualizacao/${base.id}?_t=${Date.now()}`)
            if (!response.ok) return [base.id, null] as const
            const json = await response.json()
            return [base.id, json?.ultima_atualizacao ?? null] as const
          } catch {
            return [base.id, null] as const
          }
        }),
      )

      setUltimaAtualizacaoBases(Object.fromEntries(resultados))
    } catch (error) {
      console.warn("Não foi possível consultar a última atualização das bases de faturamento.", error)
    }
  }

  function selecionarArquivoBase(baseId: string, arquivo: File | null) {
    setArquivosBases((atual) => ({
      ...atual,
      [baseId]: arquivo,
    }))
    setStatusUploadBases((atual) => ({
      ...atual,
      [baseId]: null,
    }))
  }

  async function enviarBaseFaturamento(base: BaseFaturamentoUpload) {
    const arquivo = arquivosBases[base.id]

    if (!arquivo) {
      setStatusUploadBases((atual) => ({
        ...atual,
        [base.id]: `Selecione o arquivo de ${base.titulo} antes de enviar.`,
      }))
      return
    }

    try {
      setUploadingBaseId(base.id)
      setStatusUploadBases((atual) => ({
        ...atual,
        [base.id]: null,
      }))

      const formData = new FormData()
      formData.append("file", arquivo)

      const response = await fetch(`${API_BASE}/upload/${base.id}`, {
        method: "POST",
        body: formData,
      })

      const json = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(json?.detail || `Erro ao processar a base ${base.titulo}.`)
      }

      const total = json?.total_inserido ?? 0
      const erros = Array.isArray(json?.erros) ? json.erros.filter(Boolean) : []

      setStatusUploadBases((atual) => ({
        ...atual,
        [base.id]: erros.length
          ? `Base processada com avisos. Registros: ${fmtNumero(total)}. ${erros[0]}`
          : `${base.titulo} carregada com sucesso. Registros: ${fmtNumero(total)}.`,
      }))

      setArquivosBases((atual) => ({
        ...atual,
        [base.id]: null,
      }))

      await carregarUltimasAtualizacoesBases()
      await carregarResumo(true, true)
    } catch (error: any) {
      setStatusUploadBases((atual) => ({
        ...atual,
        [base.id]: error?.message || `Erro ao subir a base ${base.titulo}.`,
      }))
    } finally {
      setUploadingBaseId(null)
    }
  }

  useEffect(() => {
    carregarResumo(false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, bloco, produtoFiltro])

  useEffect(() => {
    carregarUltimasAtualizacoesBases()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        carregarResumo(false, true)
      }
    }, 60 * 1000)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, bloco, produtoFiltro, versaoCarregada])

  const mesesGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((item) => {
      const quantidadeReal = item.quantidade ?? 0

      return {
        mes: item.mes_nome ?? String(item.mes ?? ""),
        Faturamento: item.faturamento ?? 0,
        // Não desenha a linha de quantidade nos meses futuros/sem realizado.
        // Assim ela se comporta como o faturamento: mostra só mês com dado real.
        Quantidade: quantidadeReal > 0 ? quantidadeReal : null,
        Forecast: item.forecast ?? 0,
        Orçado: item.orcado ?? 0,
      }
    })
  }, [dados])

  const linhasGrafico = useMemo(() => {
    return (dados?.linhas ?? []).slice(0, 8).map((item) => ({
      linha: abreviar(item.linha, 18),
      Faturamento: item.faturamento ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
    }))
  }, [dados])

  const clientesFiltrados = useMemo(() => {
    const termo = buscaCliente.trim().toLowerCase()
    let lista = [...(dados?.clientes ?? [])]

    if (termo) {
      lista = lista.filter((item) => {
        return (
          String(item.cliente ?? "").toLowerCase().includes(termo) ||
          String(item.nome ?? "").toLowerCase().includes(termo) ||
          String(item.nome_fantasia ?? "").toLowerCase().includes(termo) ||
          String(item.estado ?? "").toLowerCase().includes(termo) ||
          String(item.tipo_cliente ?? "").toLowerCase().includes(termo)
        )
      })
    }

    lista.sort((a, b) => {
      if (abcModo === "quantidade") {
        const va = a.quantidade ?? 0
        const vb = b.quantidade ?? 0
        return vb - va
      }
      const va = a[sortCliente] ?? 0
      const vb = b[sortCliente] ?? 0
      return sortAsc ? va - vb : vb - va
    })

    return lista
  }, [dados, buscaCliente, abcModo, sortCliente, sortAsc])

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase()
    let lista = [...(dados?.produtos ?? [])]

    if (termo) {
      lista = lista.filter((item) => {
        return (
          String(item.produto ?? "").toLowerCase().includes(termo) ||
          String(item.descricao ?? "").toLowerCase().includes(termo) ||
          String(item.linha ?? "").toLowerCase().includes(termo) ||
          String(item.grupo ?? "").toLowerCase().includes(termo)
        )
      })
    }

    lista.sort((a, b) => {
      if (produtoRankingModo === "quantidade") {
        return (b.quantidade ?? 0) - (a.quantidade ?? 0)
      }
      return (b.faturamento ?? 0) - (a.faturamento ?? 0)
    })

    return lista
  }, [dados, buscaProduto, produtoRankingModo])

  const topProdutosValor = useMemo(() => {
    return [...(dados?.produtos ?? [])]
      .sort((a, b) => (b.faturamento ?? 0) - (a.faturamento ?? 0))
      .slice(0, 6)
  }, [dados])

  const topProdutosQuantidade = useMemo(() => {
    return [...(dados?.produtos ?? [])]
      .sort((a, b) => (b.quantidade ?? 0) - (a.quantidade ?? 0))
      .slice(0, 6)
  }, [dados])

  const resumoAbcValor = useMemo(() => {
    const clientes = dados?.clientes ?? []
    const totalValor = clientes.reduce((acc, item) => acc + (item.faturamento ?? 0), 0)
    const totalClientes = clientes.length
    return ["A", "B", "C"].map((classe) => {
      const itens = clientes.filter((item) => String(item.abc_valor || "C").toUpperCase() === classe)
      const valor = itens.reduce((acc, item) => acc + (item.faturamento ?? 0), 0)
      return {
        classe,
        clientes: itens.length,
        valor,
        pctValor: totalValor ? (valor / totalValor) * 100 : 0,
        pctClientes: totalClientes ? (itens.length / totalClientes) * 100 : 0,
      }
    })
  }, [dados])

  const resumoAbcQuantidade = useMemo(() => {
    const clientes = dados?.clientes ?? []
    const totalQtd = clientes.reduce((acc, item) => acc + (item.quantidade ?? 0), 0)
    const totalClientes = clientes.length
    return ["A", "B", "C"].map((classe) => {
      const itens = clientes.filter((item) => String(item.abc_qtd || "C").toUpperCase() === classe)
      const quantidade = itens.reduce((acc, item) => acc + (item.quantidade ?? 0), 0)
      return {
        classe,
        clientes: itens.length,
        quantidade,
        pctQuantidade: totalQtd ? (quantidade / totalQtd) * 100 : 0,
        pctClientes: totalClientes ? (itens.length / totalClientes) * 100 : 0,
      }
    })
  }, [dados])

  const clientesMensalGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((item) => ({
      mes: item.mes_nome ?? String(item.mes ?? ""),
      Clientes: item.clientes ?? 0,
    }))
  }, [dados])

  const dimensaoClientesCarregada = (dados?.meta?.qtd_clientes_dimensao ?? 0) > 0
  const estadosComInformacao = (dados?.estados ?? []).filter((item) => {
    const uf = String(item.estado || "").trim().toUpperCase()
    return uf && !["NÃO INFORMADO", "NAO INFORMADO", "SEM UF", "-"].includes(uf)
  })

  const paisesComInformacao = (dados?.paises ?? []).filter((item) => {
    const pais = String(item.pais || "").trim().toUpperCase()
    return pais && !["NÃO INFORMADO", "NAO INFORMADO", "-"].includes(pais)
  })

  const cicloAgingGrafico = useMemo(() => {
    return (dados?.ciclo_aging ?? []).map((item) => ({
      faixa: item.faixa || "-",
      Faturamento: item.faturamento ?? 0,
      Registros: item.registros ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
    }))
  }, [dados])

  const cicloOrigemGrafico = useMemo(() => {
    return (dados?.ciclo_origem ?? []).map((item) => ({
      origem: abreviar(item.origem, 28),
      Faturamento: item.faturamento ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
      Registros: item.registros ?? 0,
    }))
  }, [dados])

  const pendentesStatusGrafico = useMemo(() => {
    return (dados?.pendentes_status ?? []).slice(0, 8).map((item) => ({
      status: abreviar(item.status, 20),
      Valor: item.valor ?? 0,
      Quantidade: item.quantidade ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
    }))
  }, [dados])

  const pendentesAgingLista = useMemo(() => dados?.pendentes_aging ?? [], [dados])
  const pendentesClientesTop = useMemo(() => (dados?.pendentes_clientes ?? []).slice(0, 8), [dados])
  const pendentesProdutosTop = useMemo(() => (dados?.pendentes_produtos ?? []).slice(0, 8), [dados])
  function toggleSort(col: "faturamento" | "quantidade" | "participacao_valor_pct") {
    if (sortCliente === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCliente(col)
      setSortAsc(false)
    }
    if (col === "quantidade") setAbcModo("quantidade")
    if (col === "faturamento") setAbcModo("valor")
  }

  function SortIcon({ col }: { col: "faturamento" | "quantidade" | "participacao_valor_pct" }) {
    if (sortCliente !== col || abcModo === "quantidade") return <ChevronsUpDown size={11} className="opacity-40" />
    return sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  function toggleSerie(chave: keyof typeof seriesVisiveis) {
    setSeriesVisiveis((atual) => ({
      ...atual,
      [chave]: !atual[chave],
    }))
  }

  function aplicarFiltroProduto() {
    setProdutoFiltro(produtoBuscaInput.trim())
  }

  function limparFiltroProduto() {
    setProdutoBuscaInput("")
    setProdutoFiltro("")
  }

  const cards = dados?.cards ?? {}
  const escopoLabel = dados?.escopo_label ?? ESCOPOS.find((e) => e.value === bloco)?.label ?? "Todos"

  return (
    <div className="space-y-6 p-6 font-sans antialiased">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard de Faturamento</h1>
          <p className="mt-2 text-slate-500">
            Visão executiva por cliente, produto, linha, UF, país estimado, ciclo de pedido e carteira pendente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={ano}
            onChange={(event) => setAno(Number(event.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
            <option value={2024}>2024</option>
          </select>

          <select
            value={bloco}
            onChange={(event) => setBloco(event.target.value)}
            className="min-w-[210px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            {ESCOPOS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>

          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={produtoBuscaInput}
              onChange={(event) => setProdutoBuscaInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") aplicarFiltroProduto()
              }}
              placeholder="Código, produto, grupo ou linha"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
            />
          </div>

          <button
            type="button"
            onClick={aplicarFiltroProduto}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
          >
            Filtrar produto
          </button>

          {produtoFiltro && (
            <button
              type="button"
              onClick={limparFiltroProduto}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500 shadow-sm transition hover:bg-slate-50"
            >
              Limpar produto
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setModalBasesAberto(true)
              carregarUltimasAtualizacoesBases()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <UploadCloud size={16} />
            Bases
          </button>

          <button
            onClick={() => carregarResumo(true, true)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#17375E] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102B4A] disabled:opacity-60"
          >
            {loading || refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {refreshing && dados ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {erro && !dados && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {erro}
        </div>
      )}

      {loading && !dados && (
        <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
          Carregando faturamento...
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Escopo selecionado</p>
            <p className="mt-2 text-xl font-bold text-slate-900">{escopoLabel}</p>
            <p className="mt-1 text-sm text-slate-500">
              A dimensão de clientes é cruzada por código. Fonte cliente: {dimensaoClientesCarregada ? "dClientes vinculada" : "aguardando dClientes"}.
              <span className="ml-2 font-semibold text-slate-600">Faturamento: {dados?.meta?.fonte_faturamento || "base principal"}</span>
              {produtoFiltro && <span className="ml-2 font-semibold text-blue-700">Produto filtrado: {produtoFiltro}</span>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-slate-500 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-bold text-slate-700">Ano</p>
              <p>{ano}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-bold text-slate-700">Registros</p>
              <p>{fmtNumero(cards.registros)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-bold text-slate-700">Clientes dim.</p>
              <p>{fmtNumero(dados?.meta?.qtd_clientes_dimensao)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-bold text-slate-700">Top cliente</p>
              <p>{fmtPct(cards.top_cliente_participacao_pct)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Faturamento" value={fmtMoney(cards.faturamento_total)} subtitle={dados?.meta?.fonte_faturamento === "f_faturados" ? "Valor total faturados" : "Valor total SD2"} icon={DollarSign} iconBg="#E0F2FE" iconColor={AZUL} />
        <KpiCard title="Quantidade" value={fmtNumero(cards.quantidade_total)} subtitle="Volume faturado" icon={BarChart3} iconBg="#DBEAFE" iconColor="#2563EB" />
        <KpiCard title="Clientes ativos" value={fmtNumero(cards.clientes_ativos)} subtitle="Com venda no período" icon={Users} iconBg="#F3E8FF" iconColor={ROXO_SUAVE} />
        <KpiCard title="Produtos ativos" value={fmtNumero(cards.produtos_ativos)} subtitle="SKUs faturados" icon={Package} iconBg="#F1F5F9" iconColor="#475569" />
        <KpiCard title="Ticket/cliente" value={fmtMoney(cards.ticket_medio_cliente)} subtitle="Faturamento médio" icon={Building2} iconBg="#ECFDF5" iconColor={VERDE} />
        <KpiCard title="Preço médio" value={fmtMoney(cards.preco_medio)} subtitle="Valor / quantidade" icon={Award} iconBg="#FFF7ED" iconColor={LARANJA} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Carteira pendente" value={fmtMoney(cards.carteira_pendente_valor)} subtitle={`${fmtNumero(cards.prepedidos_pendentes)} pré-pedidos em aberto`} icon={Package} iconBg="#FEF3C7" iconColor={LARANJA} />
        <KpiCard title="Qtd. pendente" value={fmtNumero(cards.carteira_pendente_quantidade)} subtitle="Volume ainda não atendido" icon={BarChart3} iconBg="#FFF7ED" iconColor={LARANJA} />
        <KpiCard title="Clientes pendentes" value={fmtNumero(cards.clientes_pendentes)} subtitle="Com carteira em aberto" icon={Users} iconBg="#F3E8FF" iconColor={ROXO_SUAVE} />
        <KpiCard title="Entrega vencida" value={fmtMoney(cards.carteira_vencida_valor)} subtitle={`${fmtPct(cards.pct_carteira_vencida_valor)} da carteira`} icon={Award} iconBg="#FEE2E2" iconColor={VERMELHO_SUAVE} />
        <KpiCard title="Mediana ciclo" value={`${fmtNumero(cards.mediana_dias_preped_faturamento, 1)} dias`} subtitle="Pré-pedido até faturar" icon={RefreshCw} iconBg="#E0F2FE" iconColor={AZUL} />
        <KpiCard title="Pedido fim do mês" value={fmtPct(cards.pct_faturamento_prepedido_fim_mes)} subtitle="Faturado com pré-pedido após dia 21" icon={Award} iconBg="#ECFDF5" iconColor={VERDE} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Entrada do pedido x faturamento"
          subtitle="Analisa se o volume faturado entrou como pré-pedido no próprio mês, no fim do mês ou se já estava em carteira."
        >
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Até 7 dias</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{fmtPct(cards.pct_faturado_ate_7_dias)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Acima de 30 dias</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{fmtPct(cards.pct_faturado_acima_30_dias)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Mesmo mês</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{fmtMoney(cards.faturamento_prepedido_mesmo_mes)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Meses anteriores</p>
              <p className="mt-1 text-xl font-bold text-slate-900">{fmtMoney(cards.faturamento_prepedido_mes_anterior)}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[260px] rounded-2xl border border-slate-100 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">Aging pré-pedido → faturamento</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cicloAgingGrafico} margin={{ top: 12, right: 16, left: 0, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="faixa" tick={CHART_TICK_11} />
                  <YAxis tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                  <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtNumero(Number(value)), name]} />
                  <Bar dataKey="Faturamento" fill={AZUL_CLARO} radius={[7, 7, 0, 0]}>
                    <LabelList dataKey="Faturamento" position="top" formatter={labelMoney} style={chartLabelStyle(AZUL, 10)} />
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="h-[260px] rounded-2xl border border-slate-100 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">Origem do faturamento</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cicloOrigemGrafico} layout="vertical" margin={{ left: 12, right: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis type="number" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                  <YAxis type="category" dataKey="origem" width={140} tick={CHART_TICK_11} />
                  <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtNumero(Number(value)), name]} />
                  <Bar dataKey="Faturamento" fill={AZUL} radius={[0, 7, 7, 0]}>
                    <LabelList dataKey="Faturamento" position="right" formatter={labelMoney} style={chartLabelStyle(AZUL, 10)} />
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Carteira pendente / não atendido"
          subtitle="Snapshot dos pré-pedidos pendentes, com status, aging e itens mais relevantes em aberto."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[260px] rounded-2xl border border-slate-100 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">Pendente por status</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pendentesStatusGrafico} layout="vertical" margin={{ left: 12, right: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis type="number" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                  <YAxis type="category" dataKey="status" width={115} tick={CHART_TICK_11} />
                  <Tooltip formatter={(value: any, name: any) => [name === "Valor" ? fmtMoneyFull(Number(value)) : fmtNumero(Number(value)), name]} />
                  <Bar dataKey="Valor" fill={LARANJA} radius={[0, 7, 7, 0]}>
                    <LabelList dataKey="Valor" position="right" formatter={labelMoney} style={chartLabelStyle(LARANJA, 10)} />
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-100 p-3">
              <p className="text-sm font-bold text-slate-800">Aging da carteira</p>
              {pendentesAgingLista.length > 0 ? pendentesAgingLista.map((item) => (
                <div key={item.faixa || "sem-faixa"}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-800">{item.faixa || "-"}</span>
                    <span className="text-xs font-semibold text-slate-500">{fmtPct(item.participacao_valor_pct)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-[#D97706]" style={{ width: `${Math.min(item.participacao_valor_pct ?? 0, 100)}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>{fmtMoney(item.valor)}</span>
                    <span>{fmtNumero(item.prepedidos)} pré-pedidos</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Suba a base de pré-pedidos pendentes para preencher esta visão.</div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">Top clientes pendentes</p>
              <div className="space-y-2">
                {pendentesClientesTop.map((item) => (
                  <div key={item.cliente} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-800" title={item.nome}>{item.nome || item.cliente}</p>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(item.valor)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.estado || "-"} · {item.pais_estimado || "-"} · {fmtNumero(item.prepedidos)} pré-pedidos</p>
                  </div>
                ))}
                {pendentesClientesTop.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Sem carteira pendente carregada.</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 p-3">
              <p className="mb-2 text-sm font-bold text-slate-800">Top produtos pendentes</p>
              <div className="space-y-2">
                {pendentesProdutosTop.map((item) => (
                  <div key={item.produto} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-800" title={item.descricao}>{item.descricao || item.produto}</p>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(item.valor)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.produto || "-"} · {item.linha || "-"} · {fmtNumero(item.quantidade)} un.</p>
                  </div>
                ))}
                {pendentesProdutosTop.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Sem produtos pendentes carregados.</p>}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title="Evolução mensal do faturamento, volume e plano"
            subtitle="Barras mostram faturamento; linhas comparam quantidade real, Forecast S&OP e Orçado. Clique nos botões para mostrar ou ocultar séries."
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                { key: "faturamento", label: "Faturamento", color: AZUL },
                { key: "quantidade", label: "Quantidade", color: AZUL_CLARO },
                { key: "forecast", label: "Forecast S&OP", color: LARANJA },
                { key: "orcado", label: "Orçado", color: VERDE },
              ].map((serie) => (
                <button
                  key={serie.key}
                  type="button"
                  onClick={() => toggleSerie(serie.key as keyof typeof seriesVisiveis)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    seriesVisiveis[serie.key as keyof typeof seriesVisiveis]
                      ? "border-slate-200 bg-white text-slate-700 shadow-sm"
                      : "border-slate-200 bg-slate-100 text-slate-400"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: serie.color }} />
                  {serie.label}
                </button>
              ))}
            </div>

            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={mesesGrafico} margin={{ top: 24, right: 20, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="mes" tick={CHART_TICK_12} />
                  <YAxis yAxisId="left" tick={CHART_TICK_12} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                  <YAxis yAxisId="right" orientation="right" tick={CHART_TICK_12} tickFormatter={(v) => fmtNumero(Number(v))} />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (name === "Faturamento") return [fmtMoneyFull(Number(value)), name]
                      return [fmtNumero(Number(value)), name]
                    }}
                  />
                  <Legend />
                  {seriesVisiveis.faturamento && (
                    <Bar yAxisId="left" dataKey="Faturamento" name="Faturamento" fill={AZUL} radius={[7, 7, 0, 0]}>
                      <LabelList dataKey="Faturamento" position="top" formatter={labelMoney} style={chartLabelStyle(AZUL, 11)} />
                    </Bar>
                  )}
                  {seriesVisiveis.quantidade && (
                    <Line yAxisId="right" type="monotone" dataKey="Quantidade" name="Quantidade" stroke={AZUL_CLARO} strokeWidth={3} dot={{ r: 4 }}>
                      <LabelList dataKey="Quantidade" position="top" formatter={labelQtd} style={chartLabelStyle(AZUL_CLARO, 10)} />
                    </Line>
                  )}
                  {seriesVisiveis.forecast && (
                    <Line yAxisId="right" type="monotone" dataKey="Forecast" name="Forecast S&OP" stroke={LARANJA} strokeWidth={3} strokeDasharray="6 4" dot={{ r: 4 }}>
                      <LabelList dataKey="Forecast" position="bottom" formatter={labelQtd} style={chartLabelStyle(LARANJA, 10)} />
                    </Line>
                  )}
                  {seriesVisiveis.orcado && (
                    <Line yAxisId="right" type="monotone" dataKey="Orçado" name="Orçado" stroke={VERDE} strokeWidth={2.5} strokeDasharray="3 3" dot={{ r: 4 }}>
                      <LabelList dataKey="Orçado" position="top" formatter={labelQtd} style={chartLabelStyle(VERDE, 10)} />
                    </Line>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Mix por linha"
          subtitle="Participação do faturamento por linha de negócio."
        >
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={linhasGrafico} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                <YAxis type="category" dataKey="linha" width={110} tick={CHART_TICK_11} />
                <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtPct(Number(value)), name]} />
                <Bar dataKey="Faturamento" radius={[0, 7, 7, 0]}>
                  {linhasGrafico.map((_, index) => (
                    <Cell key={`linha-${index}`} fill={PALETA_LINHAS[index % PALETA_LINHAS.length]} />
                  ))}
                  <LabelList dataKey="Faturamento" position="right" formatter={labelMoney} style={chartLabelStyle(AZUL, 11)} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Clientes ativos por mês"
          subtitle="Quantidade de clientes com faturamento no mês, em visão separada para facilitar a leitura."
        >
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={clientesMensalGrafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="mes" tick={CHART_TICK_12} />
                <YAxis tick={CHART_TICK_12} tickFormatter={(v) => fmtNumero(Number(v))} />
                <Tooltip formatter={(value: any) => [fmtNumero(Number(value)), "Clientes ativos"]} />
                <Bar dataKey="Clientes" fill={AZUL_CLARO} radius={[7, 7, 0, 0]}>
                  <LabelList dataKey="Clientes" position="top" formatter={labelQtd} style={chartLabelStyle(AZUL, 11)} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title="ABC de clientes"
            subtitle="Curva ABC por valor ou por quantidade. Use a busca para encontrar cliente, UF ou tipo."
          >
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => setAbcModo("valor")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${abcModo === "valor" ? "bg-[#17375E] text-white" : "text-slate-600"}`}
                >
                  ABC valor
                </button>
                <button
                  onClick={() => setAbcModo("quantidade")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${abcModo === "quantidade" ? "bg-[#17375E] text-white" : "text-slate-600"}`}
                >
                  ABC quantidade
                </button>
              </div>

              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={buscaCliente}
                  onChange={(event) => setBuscaCliente(event.target.value)}
                  placeholder="Buscar cliente, UF ou tipo"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#17375E]"
                />
              </div>
            </div>

            <div className="mb-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">Concentração ABC por valor</p>
                    <p className="text-xs text-slate-500">Participação dos clientes no faturamento.</p>
                  </div>
                  <DollarSign size={17} className="text-slate-400" />
                </div>
                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {resumoAbcValor.map((item) => {
                    const cor = item.classe === "A" ? VERDE : item.classe === "B" ? "#2563EB" : CINZA_AZULADO
                    return (
                      <div key={item.classe} className="p-3 text-center" style={{ backgroundColor: `${cor}18` }}>
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Classe {item.classe}</p>
                        <p className="mt-1 text-xl font-bold" style={{ color: item.classe === "C" ? "#64748B" : cor }}>
                          {fmtNumero(item.clientes)} clientes
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{fmtPct(item.pctValor)} do faturamento</p>
                        <p className="text-[11px] text-slate-400">{fmtPct(item.pctClientes)} da base</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">Concentração ABC por quantidade</p>
                    <p className="text-xs text-slate-500">Participação dos clientes no volume faturado.</p>
                  </div>
                  <BarChart3 size={17} className="text-slate-400" />
                </div>
                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {resumoAbcQuantidade.map((item) => {
                    const cor = item.classe === "A" ? VERDE : item.classe === "B" ? LARANJA : CINZA_AZULADO
                    return (
                      <div key={item.classe} className="p-3 text-center" style={{ backgroundColor: `${cor}18` }}>
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Classe {item.classe}</p>
                        <p className="mt-1 text-xl font-bold" style={{ color: item.classe === "C" ? "#64748B" : cor }}>
                          {fmtNumero(item.clientes)} clientes
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{fmtPct(item.pctQuantidade)} do volume</p>
                        <p className="text-[11px] text-slate-400">{fmtPct(item.pctClientes)} da base</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#17375E] text-white">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold">ABC</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">Cliente</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">Tipo</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">UF</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">País</th>
                    <th className="cursor-pointer px-3 py-3 text-right text-xs font-semibold" onClick={() => toggleSort("faturamento")}>
                      <span className="inline-flex items-center gap-1">Valor <SortIcon col="faturamento" /></span>
                    </th>
                    <th className="cursor-pointer px-3 py-3 text-right text-xs font-semibold" onClick={() => toggleSort("quantidade")}>
                      <span className="inline-flex items-center gap-1">Qtd <SortIcon col="quantidade" /></span>
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold">Part.</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold">Acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {clientesFiltrados.slice(0, 200).map((item, index) => {
                    const classe = abcModo === "valor" ? item.abc_valor : item.abc_qtd
                    const acumulado = abcModo === "valor" ? item.acumulado_valor_pct : item.acumulado_qtd_pct
                    const participacao = abcModo === "valor" ? item.participacao_valor_pct : item.participacao_qtd_pct
                    return (
                      <tr key={`${item.cliente}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold ring-1 ${badgeAbc(classe)}`}>
                            {classe ?? "C"}
                          </span>
                        </td>
                        <td className="max-w-[280px] px-3 py-3">
                          <p className="truncate font-semibold text-slate-900" title={item.nome_fantasia || item.nome}>{item.nome_fantasia || item.nome || "-"}</p>
                          <p className="text-xs text-slate-400">{item.cliente} · {item.municipio || "-"}</p>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">{item.tipo_cliente || "-"}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{item.estado || "-"}</td>
                        <td className="px-3 py-3 text-xs text-slate-600">{item.pais_estimado || "-"}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{fmtMoney(item.faturamento)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.quantidade)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtPct(participacao)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtPct(acumulado)}</td>
                      </tr>
                    )
                  })}
                  {!loading && clientesFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum cliente encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Top países estimados" subtitle="Brasil x exportação por país inferido a partir da dClientes.">
            {paisesComInformacao.length > 0 ? (
              <div className="space-y-3">
                {paisesComInformacao.slice(0, 10).map((item) => (
                  <div key={item.pais}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <MapPin size={14} className="text-slate-400" />
                        <span className="truncate font-semibold text-slate-800">{item.pais || "-"}</span>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">{fmtPct(item.participacao_valor_pct)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-[#0F766E]" style={{ width: `${Math.min(item.participacao_valor_pct ?? 0, 100)}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-slate-500">
                      <span>{fmtMoney(item.faturamento)}</span>
                      <span>{fmtNumero(item.clientes)} clientes</span>
                    </div>
                  </div>
                ))}
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  País estimado a partir do cadastro para clientes com UF EX/exportação. Itens sem match aparecem como Exterior - revisar.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ainda não há dados suficientes para ranking por país.</div>
            )}
          </SectionCard>

          <SectionCard title="Top UFs" subtitle="Distribuição geográfica do faturamento.">
            {dimensaoClientesCarregada && estadosComInformacao.length > 0 ? (
              <div className="space-y-3">
                {estadosComInformacao.slice(0, 10).map((item) => (
                  <div key={item.estado}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <MapPin size={14} className="text-slate-400" />
                        <span className="font-semibold text-slate-800">{item.estado || "-"}</span>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">{fmtPct(item.participacao_valor_pct)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-[#17375E]" style={{ width: `${Math.min(item.participacao_valor_pct ?? 0, 100)}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-slate-400">
                      <span>{fmtMoney(item.faturamento)}</span>
                      <span>{fmtNumero(item.clientes)} clientes</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">Dimensão de clientes ainda não vinculada</p>
                <p className="mt-1 text-xs leading-relaxed">Suba a base dClientes para liberar a visão por UF, município e região.</p>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Top produtos" subtitle="Ranking rápido dos itens que mais vendem em valor e em quantidade.">
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-[#E8F1F8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17375E]">Valor</span>
                  <p className="text-xs text-slate-500">Maior faturamento</p>
                </div>
                <div className="space-y-2">
                  {topProdutosValor.map((item, index) => (
                    <div key={`valor-${item.produto}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800" title={item.descricao}>{item.descricao || item.produto || "-"}</p>
                          <p className="mt-0.5 text-[11px] text-slate-400">{item.produto || "-"} · {item.linha || item.grupo || "Sem linha"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-bold text-[#17375E]">{fmtMoney(item.faturamento)}</p>
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500">
                        <span>{fmtNumero(item.quantidade)} un.</span>
                        <span>{fmtPct(item.participacao_valor_pct)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#B45309]">Qtd</span>
                  <p className="text-xs text-slate-500">Maior volume faturado</p>
                </div>
                <div className="space-y-2">
                  {topProdutosQuantidade.map((item, index) => (
                    <div key={`qtd-${item.produto}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800" title={item.descricao}>{item.descricao || item.produto || "-"}</p>
                          <p className="mt-0.5 text-[11px] text-slate-400">{item.produto || "-"} · {item.linha || item.grupo || "Sem linha"}</p>
                        </div>
                        <p className="shrink-0 text-sm font-bold text-[#D97706]">{fmtNumero(item.quantidade)}</p>
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500">
                        <span>{fmtMoney(item.faturamento)}</span>
                        <span>{fmtMoney(item.preco_medio)} médio</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Ranking de produtos"
          subtitle={produtoRankingModo === "valor" ? "Produtos ordenados por faturamento." : "Produtos ordenados por quantidade faturada."}
        >
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Award size={15} className="text-slate-400" />
                <span>Use os botões para alternar entre maior faturamento e maior volume.</span>
              </div>
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setProdutoRankingModo("valor")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${produtoRankingModo === "valor" ? "bg-[#17375E] text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}
                >
                  Valor
                </button>
                <button
                  type="button"
                  onClick={() => setProdutoRankingModo("quantidade")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${produtoRankingModo === "quantidade" ? "bg-[#D97706] text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}
                >
                  Quantidade
                </button>
              </div>
            </div>
            <div className="relative w-full md:w-96">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={buscaProduto}
                onChange={(event) => setBuscaProduto(event.target.value)}
                placeholder="Buscar produto, descrição, grupo ou linha"
                className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#17375E]"
              />
            </div>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#17375E] text-white">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold">Produto</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold">Descrição</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold">Linha</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Faturamento</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Quantidade</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Forecast</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Ating. FC</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Orçado</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Ating. Orç.</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Preço médio</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Clientes</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold">Part.</th>
                </tr>
              </thead>
              <tbody>
                {produtosFiltrados.map((item, index) => (
                  <tr key={`${item.produto}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-3 font-mono text-xs font-bold text-slate-900">{item.produto || "-"}</td>
                    <td className="max-w-[360px] px-3 py-3">
                      <p className="truncate font-medium text-slate-800" title={item.descricao}>{item.descricao || "-"}</p>
                      <p className="text-xs text-slate-400">Grupo {item.grupo || "-"}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{item.linha || "-"}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900">{fmtMoney(item.faturamento)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.quantidade)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.forecast)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-orange-700">{fmtPct(item.atingimento_forecast_pct)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.orcado)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-700">{fmtPct(item.atingimento_orcado_pct)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(item.preco_medio)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.clientes)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtPct(item.participacao_valor_pct)}</td>
                  </tr>
                ))}
                {!loading && produtosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum produto encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      {modalBasesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Bases da análise</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Faturamento</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Use este painel para atualizar somente as bases necessárias para a análise comercial. Bases compartilhadas atualizam automaticamente as outras páginas que usam a mesma tabela.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalBasesAberto(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">Racional das bases</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Faturados é a base principal da análise. Pré-pedidos pendentes mostra a carteira ainda não atendida. Pré-pedidos emitidos fica como base auxiliar de conferência. dClientes complementa nomes, UF, região e localização.
                  </p>
                  <p className="mt-1 text-xs font-semibold text-blue-700">
                    dClientes é compartilhada com outras páginas da ferramenta.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={carregarUltimasAtualizacoesBases}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <RefreshCw size={14} />
                  Atualizar status
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {BASES_FATURAMENTO_UPLOAD.map((base) => {
                  const arquivo = arquivosBases[base.id]
                  const uploading = uploadingBaseId === base.id
                  const status = statusUploadBases[base.id]
                  const ultimaAtualizacao = ultimaAtualizacaoBases[base.id]

                  return (
                    <div key={base.id} className="flex min-h-[285px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{base.titulo}</p>
                          <p className="mt-1 text-xs text-slate-500">{base.subtitulo}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 p-2 text-blue-700">
                          <UploadCloud size={16} />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {base.obrigatoria && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Obrigatória</span>
                        )}
                        {base.compartilhada && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Compartilhada</span>
                        )}
                      </div>

                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <p className="font-bold uppercase tracking-wide text-slate-500">Uso na tela</p>
                        <p className="mt-1 leading-relaxed">{base.usoNaTela}</p>
                      </div>

                      <div className="mt-3 text-xs text-slate-500">
                        <p className="font-semibold text-slate-700">Última atualização</p>
                        <p className="mt-1">{fmtDataHora(ultimaAtualizacao)}</p>
                      </div>

                      <label className="mt-3 block rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-center hover:bg-slate-100">
                        <UploadCloud className="mx-auto text-slate-400" size={22} />
                        <p className="mt-1 text-xs font-bold text-slate-800">Selecionar arquivo</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{arquivo?.name || "XLSX/XLS exportado do sistema"}</p>
                        <input
                          key={`${base.id}-${arquivo?.name || "sem-arquivo"}`}
                          type="file"
                          accept={base.aceita || ".xlsx,.xls,.csv"}
                          className="hidden"
                          onChange={(event) => selecionarArquivoBase(base.id, event.target.files?.[0] ?? null)}
                        />
                      </label>

                      {status && (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                          {status}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => enviarBaseFaturamento(base)}
                        disabled={Boolean(uploadingBaseId) || !arquivo}
                        className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102B4A] disabled:opacity-50"
                      >
                        {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                        {uploading ? "Enviando..." : "Subir arquivo"}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                Essas atualizações substituem a base correspondente usada na análise de Faturamento. Após o upload, a tela recalcula automaticamente. Se uma base também alimentar outra página, a data de atualização será refletida lá pelo mesmo upload_log.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
