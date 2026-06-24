import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  DollarSign,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
  UploadCloud,
  Users,
} from "lucide-react"
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
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
  faturamento_ano_anterior?: number
  quantidade_ano_anterior?: number
  delta_faturamento_ano_anterior?: number
  delta_forecast?: number
  delta_orcado?: number
  atingimento_forecast_pct?: number
  atingimento_orcado_pct?: number
  clientes?: number
  produtos?: number
  preco_medio?: number
}

type AnoHistorico = {
  ano?: number
  ano_label?: string
  faturamento?: number
  quantidade?: number
  clientes?: number
  produtos?: number
  registros?: number
  ultimo_mes?: number
  periodo?: string
  is_ytd?: boolean
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

type AbcResumo = {
  classe?: string
  qtd?: number
  faturamento?: number
  quantidade?: number
  participacao_qtd_pct?: number
  participacao_faturamento_pct?: number
  exemplos?: string[]
}

type MixLinhaAnoLinha = {
  linha?: string
  faturamento?: number
  quantidade?: number
  participacao_valor_pct?: number
  clientes?: number
  produtos?: number
}

type MixLinhaAno = {
  ano?: number
  ano_label?: string
  periodo?: string
  total_faturamento?: number
  linhas?: MixLinhaAnoLinha[]
}

type MixPaisAnoPais = {
  pais?: string
  faturamento?: number
  quantidade?: number
  participacao_valor_pct?: number
  clientes?: number
  produtos?: number
  confianca_baixa?: number
}

type MixPaisAno = {
  ano?: number
  ano_label?: string
  periodo?: string
  total_faturamento?: number
  paises?: MixPaisAnoPais[]
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
  anos?: AnoHistorico[]
  clientes: Cliente[]
  produtos: Produto[]
  linhas: Linha[]
  estados: Estado[]
  paises?: Pais[]
  tipos_clientes: TipoCliente[]
  abc_clientes_valor?: AbcResumo[]
  abc_produtos_valor?: AbcResumo[]
  mix_linha_ano?: MixLinhaAno[]
  mix_pais_ano?: MixPaisAno[]
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
const AZUL_MUITO_CLARO = "#E8F1F8"
const VERDE = "#0F766E"
const LARANJA = "#D97706"
const VERMELHO = "#DC2626"
const CINZA = "#64748B"
const CINZA_CLARO = "#E2E8F0"

const APP_FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const CHART_TICK_11 = { fontSize: 11, fontFamily: APP_FONT_FAMILY, fill: CINZA }
const CHART_TICK_12 = { fontSize: 12, fontFamily: APP_FONT_FAMILY, fill: CINZA }

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
    subtitulo: "Base auxiliar",
    usoNaTela: "Apoia a conferência da entrada de pré-pedidos enquanto a regra histórica é validada.",
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

function fmtPct(value?: number) {
  return `${fmtNumero(value ?? 0, 1)}%`
}

function fmtDataHora(value?: string | null) {
  if (!value) return "Não carregada"
  const texto = String(value)
  const normalizado = /Z$|[+-]\d{2}:?\d{2}$/.test(texto) ? texto : `${texto}Z`
  const data = new Date(normalizado)
  if (Number.isNaN(data.getTime())) return "Não carregada"
  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
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

function labelMoney(value: unknown) {
  const numero = Number(value || 0)
  if (!numero) return ""
  return fmtMoney(numero)
}

function badgeAbc(classe?: string) {
  const c = String(classe || "C").toUpperCase()
  if (c === "A") return "bg-emerald-50 text-emerald-700 ring-emerald-200"
  if (c === "B") return "bg-amber-50 text-amber-700 ring-amber-200"
  return "bg-slate-100 text-slate-600 ring-slate-200"
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = "blue",
}: {
  title: string
  value: string
  subtitle?: string
  icon: any
  tone?: "blue" | "green" | "amber" | "red" | "slate"
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</p>
          <p className="mt-3 text-2xl font-bold leading-tight text-slate-900 tabular-nums">{value}</p>
          {subtitle && <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className={`rounded-xl p-2.5 ${styles[tone]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
  compact = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  compact?: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className={compact ? "p-4" : "p-5"}>{children}</div>
    </div>
  )
}

function InsightLine({
  label,
  value,
  helper,
  tone = "blue",
}: {
  label: string
  value: string
  helper?: string
  tone?: "blue" | "amber" | "red" | "green" | "slate"
}) {
  const color = {
    blue: "text-[#17375E]",
    amber: "text-amber-700",
    red: "text-red-700",
    green: "text-emerald-700",
    slate: "text-slate-700",
  }[tone]

  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
          {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
        </div>
        <p className={`shrink-0 text-lg font-bold tabular-nums ${color}`}>{value}</p>
      </div>
    </div>
  )
}

function HorizontalProgress({
  label,
  value,
  detail,
  pct,
  color = AZUL,
}: {
  label: string
  value: string
  detail?: string
  pct?: number
  color?: string
}) {
  const width = Math.max(0, Math.min(pct ?? 0, 100))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-semibold text-slate-800">{label}</span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{fmtPct(pct)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500">
        <span>{value}</span>
        {detail && <span className="truncate text-right">{detail}</span>}
      </div>
    </div>
  )
}

function corAbc(classe?: string) {
  const c = String(classe || "C").toUpperCase()
  if (c === "A") return AZUL
  if (c === "B") return VERDE
  return "#CBD5E1"
}

function interpolateHexColor(colorA: string, colorB: string, t: number) {
  const clamp = Math.max(0, Math.min(1, t))
  const a = colorA.replace("#", "")
  const b = colorB.replace("#", "")
  const ar = parseInt(a.slice(0, 2), 16)
  const ag = parseInt(a.slice(2, 4), 16)
  const ab = parseInt(a.slice(4, 6), 16)
  const br = parseInt(b.slice(0, 2), 16)
  const bg = parseInt(b.slice(2, 4), 16)
  const bb = parseInt(b.slice(4, 6), 16)

  const rr = Math.round(ar + (br - ar) * clamp)
  const rg = Math.round(ag + (bg - ag) * clamp)
  const rb = Math.round(ab + (bb - ab) * clamp)

  return `#${rr.toString(16).padStart(2, "0")}${rg.toString(16).padStart(2, "0")}${rb.toString(16).padStart(2, "0")}`
}

function heatmapColor(pct?: number) {
  const valor = Math.max(0, Math.min(pct ?? 0, 100))
  if (valor <= 50) return interpolateHexColor("#F87171", "#FACC15", valor / 50)
  return interpolateHexColor("#FACC15", VERDE, (valor - 50) / 50)
}

function heatmapTextColor(pct?: number) {
  const valor = Math.max(0, Math.min(pct ?? 0, 100))
  return valor >= 58 ? "#FFFFFF" : "#0F172A"
}

function AbcDualBarsCard({
  titulo,
  entidadeLabel,
  data,
}: {
  titulo: string
  entidadeLabel: string
  data?: AbcResumo[]
}) {
  const itens = ["A", "B", "C"].map((classe) => {
    const base = (data || []).find((item) => String(item.classe || "").toUpperCase() === classe)
    return {
      classe,
      qtd: base?.qtd ?? 0,
      faturamento: base?.faturamento ?? 0,
      pctBase: base?.participacao_qtd_pct ?? 0,
      pctFaturamento: base?.participacao_faturamento_pct ?? 0,
      color: corAbc(classe),
    }
  })

  const classeA = itens.find((item) => item.classe === "A")

  function BarDistribuicao({
    tituloBarra,
    subtituloBarra,
    pctKey,
    rawFormatter,
    footer,
  }: {
    tituloBarra: string
    subtituloBarra: string
    pctKey: "pctBase" | "pctFaturamento"
    rawFormatter: (item: (typeof itens)[number]) => string
    footer: string
  }) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-center text-sm font-bold text-slate-800">{tituloBarra}</p>
        <p className="mt-1 text-center text-xs text-slate-500">{subtituloBarra}</p>

        <div className="mt-4 flex items-center justify-center">
          <div className="flex h-[240px] w-[120px] flex-col-reverse overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-inner">
            {itens.map((item) => {
              const pct = Number(item[pctKey] || 0)
              const raw = rawFormatter(item)
              const mostrarPct = pct >= 7
              const mostrarRaw = pct >= 14
              return (
                <div
                  key={`${pctKey}-${item.classe}`}
                  className="flex min-h-[18px] flex-col items-center justify-center px-1 text-center"
                  style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: item.color, color: pct >= 7 ? "white" : "transparent" }}
                  title={`Classe ${item.classe} · ${fmtPct(pct)} · ${raw}`}
                >
                  {mostrarPct && <span className="text-[10px] font-bold leading-tight">{fmtPct(pct)}</span>}
                  {mostrarRaw && <span className="mt-0.5 text-[9px] leading-tight opacity-90">{raw}</span>}
                </div>
              )
            })}
          </div>
        </div>

        <p className="mt-3 text-center text-xs font-semibold text-slate-500">{footer}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold text-slate-900">{titulo}</p>
        <p className="mt-1 text-sm text-slate-500">
          <span className="font-semibold text-slate-800">{fmtPct(classeA?.pctBase)}</span> dos {entidadeLabel} representam <span className="font-semibold text-slate-800">{fmtPct(classeA?.pctFaturamento)}</span> do faturamento.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BarDistribuicao
          tituloBarra="Distribuição da base"
          subtituloBarra={`% dos ${entidadeLabel}`}
          pctKey="pctBase"
          rawFormatter={(item) => `${fmtNumero(item.qtd)} ${entidadeLabel}`}
          footer="100% da base"
        />
        <BarDistribuicao
          tituloBarra="Distribuição do faturamento"
          subtituloBarra="% do faturamento em R$"
          pctKey="pctFaturamento"
          rawFormatter={(item) => fmtMoney(item.faturamento)}
          footer="100% do faturamento"
        />
      </div>

      <div className="mt-5 space-y-2.5">
        {itens.map((item) => (
          <div key={item.classe} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="font-semibold text-slate-800">Classe {item.classe}</span>
              <span className="truncate text-xs text-slate-500">{fmtNumero(item.qtd)} {entidadeLabel} · {fmtPct(item.pctBase)} da base</span>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-bold text-slate-900">{fmtMoney(item.faturamento)}</p>
              <p className="text-xs text-slate-500">{fmtPct(item.pctFaturamento)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HeatmapMixLinhaAno({ dados }: { dados?: MixLinhaAno[] }) {
  const linhas = Array.from(
    new Set((dados || []).flatMap((ano) => (ano.linhas || []).map((linha) => linha.linha || "Não classificado"))),
  )

  if (!dados?.length || !linhas.length) {
    return <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ainda não há histórico suficiente para montar o mix por ano.</div>
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.1em] text-slate-400">Ano</th>
            {linhas.map((linha) => (
              <th key={linha} className="min-w-[155px] px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.1em] text-slate-400">{linha}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.map((ano) => (
            <tr key={ano.ano_label || ano.ano}>
              <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-3 py-3 align-middle">
                <p className="font-bold text-slate-900">{ano.ano_label || ano.ano}</p>
                <p className="text-xs text-slate-400">{fmtMoney(ano.total_faturamento)}</p>
              </td>
              {linhas.map((linhaNome) => {
                const item = (ano.linhas || []).find((linha) => (linha.linha || "Não classificado") === linhaNome)
                const pct = item?.participacao_valor_pct ?? 0
                return (
                  <td key={`${ano.ano}-${linhaNome}`} className="border-t border-slate-100 px-3 py-2">
                    <div
                      className="rounded-lg px-2.5 py-2"
                      style={{ backgroundColor: heatmapColor(pct), color: heatmapTextColor(pct) }}
                      title={`${linhaNome} · ${fmtPct(pct)} · ${fmtMoney(item?.faturamento)}`}
                    >
                      <p className="text-sm font-bold tabular-nums">{fmtPct(pct)}</p>
                      <p className="mt-0.5 text-xs opacity-90">{fmtMoney(item?.faturamento)}</p>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


function HeatmapMixPaisAno({ dados }: { dados?: MixPaisAno[] }) {
  const paises = Array.from(
    new Set((dados || []).flatMap((ano) => (ano.paises || []).map((pais) => pais.pais || "Não informado"))),
  )

  if (!dados?.length || !paises.length) {
    return <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ainda não há histórico suficiente para montar a evolução por país.</div>
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.1em] text-slate-400">Ano</th>
            {paises.map((pais) => (
              <th key={pais} className="min-w-[155px] px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.1em] text-slate-400">{pais}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.map((ano) => (
            <tr key={ano.ano_label || ano.ano}>
              <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-3 py-3 align-middle">
                <p className="font-bold text-slate-900">{ano.ano_label || ano.ano}</p>
                <p className="text-xs text-slate-400">{fmtMoney(ano.total_faturamento)}</p>
              </td>
              {paises.map((paisNome) => {
                const item = (ano.paises || []).find((pais) => (pais.pais || "Não informado") === paisNome)
                const pct = item?.participacao_valor_pct ?? 0
                return (
                  <td key={`${ano.ano}-${paisNome}`} className="border-t border-slate-100 px-3 py-2">
                    <div
                      className="rounded-lg px-2.5 py-2"
                      style={{ backgroundColor: heatmapColor(pct), color: heatmapTextColor(pct) }}
                      title={`${paisNome} · ${fmtPct(pct)} · ${fmtMoney(item?.faturamento)} · ${fmtNumero(item?.clientes)} clientes`}
                    >
                      <p className="text-sm font-bold tabular-nums">{fmtPct(pct)}</p>
                      <p className="mt-0.5 whitespace-nowrap text-[11px] opacity-90">{fmtMoney(item?.faturamento)} · {fmtNumero(item?.clientes)} clientes</p>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type FaturamentoCacheEntry = {
  savedAt: number
  version: string | null
  ultimaAtualizacao?: string | null
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
const FATURAMENTO_CACHE_PREFIX = "dfl-faturamento-cache-v100:"
const faturamentoRuntimeCache = new Map<string, FaturamentoCacheEntry>()

function faturamentoCacheKey(ano: number, bloco: string, produtoFiltro: string) {
  return `${ano}|${bloco || "TODOS"}|${produtoFiltro.trim().toLowerCase()}`
}

function readFaturamentoCache(ano: number, bloco: string, produtoFiltro: string): FaturamentoCacheEntry | null {
  const key = faturamentoCacheKey(ano, bloco, produtoFiltro)
  const runtime = faturamentoRuntimeCache.get(key)

  if (runtime?.data && Date.now() - runtime.savedAt <= FATURAMENTO_CACHE_TTL_MS) return runtime
  if (runtime) faturamentoRuntimeCache.delete(key)

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
  ultimaAtualizacao?: string | null,
) {
  const key = faturamentoCacheKey(ano, bloco, produtoFiltro)
  const entry: FaturamentoCacheEntry = { savedAt: Date.now(), version, ultimaAtualizacao, data }

  faturamentoRuntimeCache.set(key, entry)

  try {
    window.localStorage.setItem(`${FATURAMENTO_CACHE_PREFIX}${key}`, JSON.stringify(entry))
  } catch {
    // localStorage pode estar indisponível; runtime cache continua funcionando enquanto app estiver aberto.
  }
}

function buildFaturamentoParams(ano: number, bloco: string, produtoFiltro: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ ano: String(ano), bloco: bloco || "TODOS" })

  if (produtoFiltro.trim()) params.set("produto", produtoFiltro.trim())
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value)
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

  if (!response.ok) throw new Error("Erro ao consultar versão do faturamento.")
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

  if (!response.ok) throw new Error("Erro ao carregar cache de faturamento.")
  return (await response.json()) as FaturamentoCacheResponse
}

function getInitialFaturamentoCache(ano: number, bloco: string, produtoFiltro: string) {
  return readFaturamentoCache(ano, bloco, produtoFiltro)
}


function LegendToggle({
  items,
  visibleMap,
  onToggle,
}: {
  items: { key: string; label: string; color: string; dashed?: boolean }[]
  visibleMap: Record<string, boolean>
  onToggle: (key: string) => void
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {items.map((item) => {
        const ativo = visibleMap[item.key] !== false
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              ativo ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-50 text-slate-400"
            }`}
            title={ativo ? `Ocultar ${item.label}` : `Mostrar ${item.label}`}
          >
            <span className="relative inline-block h-0 w-5 shrink-0">
              <span
                className="absolute left-0 right-0 top-1/2 block h-0.5 -translate-y-1/2"
                style={{
                  backgroundColor: item.dashed ? 'transparent' : item.color,
                  borderTop: item.dashed ? `2px dashed ${item.color}` : 'none',
                  opacity: ativo ? 1 : 0.45,
                }}
              />
            </span>
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function FaturamentoPage() {
  const anoInicial = 2026
  const blocoInicial = "TODOS"
  const produtoFiltroInicial = ""
  const cacheInicial = getInitialFaturamentoCache(anoInicial, blocoInicial, produtoFiltroInicial)

  const [dados, setDados] = useState<ResumoFaturamento | null>(cacheInicial?.data ?? null)
  const [loading, setLoading] = useState(!cacheInicial?.data)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [versaoCarregada, setVersaoCarregada] = useState<string | null>(cacheInicial?.version ?? null)
  const [ultimaAtualizacaoDados, setUltimaAtualizacaoDados] = useState<string | null>(cacheInicial?.ultimaAtualizacao ?? null)

  const [ano, setAno] = useState(anoInicial)
  const [bloco, setBloco] = useState(blocoInicial)
  const [produtoBuscaInput, setProdutoBuscaInput] = useState("")
  const [produtoFiltro, setProdutoFiltro] = useState(produtoFiltroInicial)
  const [aba, setAba] = useState<"resumo" | "atendimento" | "clientes">("resumo")

  const [buscaCliente, setBuscaCliente] = useState("")
  const [buscaProduto, setBuscaProduto] = useState("")
  const [produtoRankingModo, setProdutoRankingModo] = useState<"valor" | "quantidade">("valor")
  const [abcModo, setAbcModo] = useState<"valor" | "quantidade">("valor")
  const [sortCliente, setSortCliente] = useState<"faturamento" | "quantidade" | "participacao_valor_pct">("faturamento")
  const [sortAsc, setSortAsc] = useState(false)
  const [annualVisible, setAnnualVisible] = useState<Record<string, boolean>>({ Faturamento: true, Quantidade: true })
  const [monthlyVisible, setMonthlyVisible] = useState<Record<string, boolean>>({
    Faturamento: true,
    "Ano anterior": true,
    Quantidade: true,
    Forecast: true,
    "Orçado": true,
  })

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
        setUltimaAtualizacaoDados(cached.ultimaAtualizacao ?? null)
        setLoading(false)
      }

      if (!cached && !dados) setLoading(true)
      else if (manterDadosAtuais) setRefreshing(true)

      if (!force && cached?.version) {
        try {
          const versao = await getFaturamentoVersao(ano, bloco, produtoFiltro)
          if (versao.versao_base === cached.version) {
            setVersaoCarregada(versao.versao_base)
            setUltimaAtualizacaoDados(versao.ultima_atualizacao || versao.cache_atualizado_em || cached.ultimaAtualizacao || null)
            return
          }
        } catch {
          return
        }
      }

      const response = await getFaturamentoCache(ano, bloco, produtoFiltro, force)
      const payload = response.payload
      const ultima = response.ultima_atualizacao || response.atualizado_em || null

      setDados(payload)
      setVersaoCarregada(response.versao_base)
      setUltimaAtualizacaoDados(ultima)
      writeFaturamentoCache(ano, bloco, produtoFiltro, payload, response.versao_base, ultima)
    } catch (error) {
      console.error(error)
      if (!dados) setErro("Não foi possível carregar o faturamento agora. Atualize a página ou tente novamente em alguns instantes.")
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
    setArquivosBases((atual) => ({ ...atual, [baseId]: arquivo }))
    setStatusUploadBases((atual) => ({ ...atual, [baseId]: null }))
  }

  async function enviarBaseFaturamento(base: BaseFaturamentoUpload) {
    const arquivo = arquivosBases[base.id]

    if (!arquivo) {
      setStatusUploadBases((atual) => ({ ...atual, [base.id]: `Selecione o arquivo de ${base.titulo} antes de enviar.` }))
      return
    }

    try {
      setUploadingBaseId(base.id)
      setStatusUploadBases((atual) => ({ ...atual, [base.id]: null }))

      const formData = new FormData()
      formData.append("file", arquivo)

      const response = await fetch(`${API_BASE}/upload/${base.id}`, { method: "POST", body: formData })
      const json = await response.json().catch(() => ({}))

      if (!response.ok) throw new Error(json?.detail || `Erro ao processar a base ${base.titulo}.`)

      const total = json?.total_inserido ?? 0
      const erros = Array.isArray(json?.erros) ? json.erros.filter(Boolean) : []

      setStatusUploadBases((atual) => ({
        ...atual,
        [base.id]: erros.length
          ? `Base processada com avisos. Registros: ${fmtNumero(total)}. ${erros[0]}`
          : `${base.titulo} carregada com sucesso. Registros: ${fmtNumero(total)}.`,
      }))

      setArquivosBases((atual) => ({ ...atual, [base.id]: null }))
      await carregarUltimasAtualizacoesBases()
      await carregarResumo(true, true)
    } catch (error: any) {
      setStatusUploadBases((atual) => ({ ...atual, [base.id]: error?.message || `Erro ao subir a base ${base.titulo}.` }))
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
      if (document.visibilityState === "visible") carregarResumo(false, true)
    }, 60 * 1000)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, bloco, produtoFiltro, versaoCarregada])

  const cards = dados?.cards ?? {}
  const escopoLabel = dados?.escopo_label ?? ESCOPOS.find((e) => e.value === bloco)?.label ?? "Todos"
  const dimensaoClientesCarregada = (dados?.meta?.qtd_clientes_dimensao ?? 0) > 0

  const anosGrafico = useMemo(() => {
    const lista = dados?.anos?.length ? dados.anos : []
    return lista.map((item) => ({
      ano: item.ano_label ?? String(item.ano ?? ""),
      Faturamento: item.faturamento ?? 0,
      Quantidade: (item.quantidade ?? 0) > 0 ? item.quantidade ?? 0 : null,
      periodo: item.periodo ?? "",
    }))
  }, [dados])

  const mesesGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((item) => {
      const quantidadeReal = item.quantidade ?? 0
      const valorAnoAnterior = item.faturamento_ano_anterior ?? 0
      return {
        mes: item.mes_nome ?? String(item.mes ?? ""),
        Faturamento: item.faturamento ?? 0,
        "Ano anterior": valorAnoAnterior > 0 ? valorAnoAnterior : null,
        Quantidade: quantidadeReal > 0 ? quantidadeReal : null,
        Forecast: item.forecast ?? 0,
        Orçado: item.orcado ?? 0,
      }
    })
  }, [dados])

  const linhasGrafico = useMemo(() => {
    return [...(dados?.linhas ?? [])]
      .sort((a, b) => (b.faturamento ?? 0) - (a.faturamento ?? 0))
      .slice(0, 6)
      .map((item) => ({
        linha: item.linha || "Não classificado",
        Faturamento: item.faturamento ?? 0,
        Participacao: item.participacao_valor_pct ?? 0,
      }))
  }, [dados])

  const abcClientesValor = useMemo(() => dados?.abc_clientes_valor ?? [], [dados])
  const abcProdutosValor = useMemo(() => dados?.abc_produtos_valor ?? [], [dados])
  const mixLinhaAno = useMemo(() => dados?.mix_linha_ano ?? [], [dados])
  const mixPaisAno = useMemo(() => dados?.mix_pais_ano ?? [], [dados])

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
          String(item.pais_estimado ?? "").toLowerCase().includes(termo) ||
          String(item.tipo_cliente ?? "").toLowerCase().includes(termo)
        )
      })
    }

    lista.sort((a, b) => {
      if (abcModo === "quantidade") return (b.quantidade ?? 0) - (a.quantidade ?? 0)
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
      if (produtoRankingModo === "quantidade") return (b.quantidade ?? 0) - (a.quantidade ?? 0)
      return (b.faturamento ?? 0) - (a.faturamento ?? 0)
    })

    return lista
  }, [dados, buscaProduto, produtoRankingModo])

  const topProdutosValor = useMemo(() => {
    return [...(dados?.produtos ?? [])].sort((a, b) => (b.faturamento ?? 0) - (a.faturamento ?? 0)).slice(0, 5)
  }, [dados])

  const topProdutosQuantidade = useMemo(() => {
    return [...(dados?.produtos ?? [])].sort((a, b) => (b.quantidade ?? 0) - (a.quantidade ?? 0)).slice(0, 5)
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
    return (dados?.meses ?? []).map((item) => ({ mes: item.mes_nome ?? String(item.mes ?? ""), Clientes: item.clientes ?? 0 }))
  }, [dados])

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

  const pendentesStatusLista = useMemo(() => dados?.pendentes_status ?? [], [dados])
  const pendentesStatusGrafico = useMemo(() => {
    return pendentesStatusLista.slice(0, 6).map((item) => ({
      status: abreviar(item.status, 18),
      Valor: item.valor ?? 0,
      Quantidade: item.quantidade ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
    }))
  }, [pendentesStatusLista])

  const pendentesAgingLista = useMemo(() => dados?.pendentes_aging ?? [], [dados])
  const pendentesClientesTop = useMemo(() => (dados?.pendentes_clientes ?? []).slice(0, 6), [dados])
  const pendentesProdutosTop = useMemo(() => (dados?.pendentes_produtos ?? []).slice(0, 6), [dados])

  function toggleSort(col: "faturamento" | "quantidade" | "participacao_valor_pct") {
    if (sortCliente === col) setSortAsc(!sortAsc)
    else {
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

  function aplicarFiltroProduto() {
    setProdutoFiltro(produtoBuscaInput.trim())
  }

  function limparFiltroProduto() {
    setProdutoBuscaInput("")
    setProdutoFiltro("")
  }

  const tabs = [
    { id: "resumo", label: "Resumo executivo" },
    { id: "atendimento", label: "Atendimento de pedidos" },
    { id: "clientes", label: "Clientes e geografia" },
  ] as const

  return (
    <div className="min-h-screen bg-slate-50/40 p-5 font-sans antialiased">
      <div className="mx-auto max-w-[1640px] space-y-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Dashboard de Faturamento</h1>
              {ultimaAtualizacaoDados && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Dados atualizados em: {fmtDataHora(ultimaAtualizacaoDados)}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-500">
              Visão executiva do faturamento, carteira pendente e ciclo pedido → faturamento. Fonte principal: {dados?.meta?.fonte_faturamento || "base carregada"}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ano}
              onChange={(event) => setAno(Number(event.target.value))}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
            >
              <option value={2026}>2026</option>
              <option value={2025}>2025</option>
              <option value={2024}>2024</option>
            </select>

            <select
              value={bloco}
              onChange={(event) => setBloco(event.target.value)}
              className="h-10 min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
            >
              {ESCOPOS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>

            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={produtoBuscaInput}
                onChange={(event) => setProdutoBuscaInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") aplicarFiltroProduto()
                }}
                placeholder="Código, produto, grupo ou linha"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
              />
            </div>

            <button
              type="button"
              onClick={aplicarFiltroProduto}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              Filtrar
            </button>

            {produtoFiltro && (
              <button
                type="button"
                onClick={limparFiltroProduto}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 shadow-sm transition hover:bg-slate-50"
              >
                Limpar
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setModalBasesAberto(true)
                carregarUltimasAtualizacoesBases()
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <UploadCloud size={15} />
              Bases
            </button>

            <button
              onClick={() => carregarResumo(true, true)}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102B4A] disabled:opacity-60"
            >
              {loading || refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {refreshing && dados ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        {erro && !dados && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{erro}</div>
        )}

        {loading && !dados && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">Carregando faturamento...</div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Escopo selecionado</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{escopoLabel}</p>
              <p className="mt-1 text-sm text-slate-500">
                Cliente: {dimensaoClientesCarregada ? "dClientes vinculada" : "aguardando dClientes"}. Faturamento: <span className="font-semibold text-slate-700">{dados?.meta?.fonte_faturamento || "base principal"}</span>
                {produtoFiltro && <span className="ml-2 font-semibold text-blue-700">Produto filtrado: {produtoFiltro}</span>}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-500 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-700">Ano</p><p>{ano}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-700">Registros</p><p>{fmtNumero(cards.registros)}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-700">Clientes dim.</p><p>{fmtNumero(dados?.meta?.qtd_clientes_dimensao)}</p></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-700">Top cliente</p><p>{fmtPct(cards.top_cliente_participacao_pct)}</p></div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard title="Faturamento" value={fmtMoney(cards.faturamento_total)} subtitle="Valor faturado" icon={DollarSign} tone="blue" />
          <MetricCard title="Volume" value={fmtNumero(cards.quantidade_total)} subtitle="Quantidade faturada" icon={BarChart3} tone="slate" />
          <MetricCard title="Ating. Forecast" value={fmtPct(cards.atingimento_forecast_pct)} subtitle={`${fmtNumero(cards.quantidade_total)} / ${fmtNumero(cards.forecast_total)} un.`} icon={TrendingUp} tone="green" />
          <MetricCard title="Carteira pendente" value={fmtMoney(cards.carteira_pendente_valor)} subtitle={`${fmtNumero(cards.prepedidos_pendentes)} pré-pedidos`} icon={Package} tone="amber" />
          <MetricCard title="Entrega vencida" value={fmtMoney(cards.carteira_vencida_valor)} subtitle={`${fmtPct(cards.pct_carteira_vencida_valor)} da carteira`} icon={AlertTriangle} tone="red" />
          <MetricCard title="Clientes ativos" value={fmtNumero(cards.clientes_ativos)} subtitle="Com venda no período" icon={Users} tone="blue" />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setAba(item.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${aba === item.id ? "bg-[#17375E] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {aba === "resumo" && (
          <div className="space-y-5">
            <SectionCard
              title="Evolução anual: faturamento e volume"
              subtitle="Linha do tempo por ano. Anos anteriores fechados; ano corrente em YTD conforme a base carregada."
            >
              <LegendToggle
                items={[
                  { key: "Faturamento", label: "Faturamento", color: AZUL },
                  { key: "Quantidade", label: "Quantidade", color: AZUL_CLARO },
                ]}
                visibleMap={annualVisible}
                onToggle={(key) => setAnnualVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
              />
              <div className="h-[330px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={anosGrafico} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_CLARO} />
                    <XAxis dataKey="ano" tick={CHART_TICK_12} />
                    <YAxis yAxisId="valor" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                    <YAxis yAxisId="qtd" orientation="right" tick={CHART_TICK_11} tickFormatter={(v) => fmtNumero(Number(v))} />
                    <Tooltip
                      formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtNumero(Number(value)), name]}
                      labelStyle={{ color: AZUL, fontWeight: 700 }}
                    />
                    {annualVisible.Faturamento !== false && (
                      <Bar yAxisId="valor" dataKey="Faturamento" fill={AZUL} radius={[7, 7, 0, 0]} maxBarSize={54}>
                        <LabelList dataKey="Faturamento" position="top" formatter={labelMoney} style={{ fill: AZUL, fontSize: 10, fontWeight: 700 }} />
                      </Bar>
                    )}
                    {annualVisible.Quantidade !== false && (
                      <Line yAxisId="qtd" type="monotone" dataKey="Quantidade" stroke={AZUL_CLARO} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard
              title="Evolução mensal: atual x ano anterior e plano"
              subtitle="Barras comparam faturamento mensal contra o mesmo mês do ano anterior. Linhas mantêm quantidade real, Forecast S&OP e Orçado."
            >
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mesesGrafico} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_CLARO} />
                    <XAxis dataKey="mes" tick={CHART_TICK_12} />
                    <YAxis yAxisId="valor" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                    <YAxis yAxisId="qtd" orientation="right" tick={CHART_TICK_11} tickFormatter={(v) => fmtNumero(Number(v))} />
                    <Tooltip
                      formatter={(value: any, name: any) => {
                        const nome = String(name)
                        return [nome === "Quantidade" || nome === "Forecast" || nome === "Orçado" ? fmtNumero(Number(value)) : fmtMoneyFull(Number(value)), nome]
                      }}
                      labelStyle={{ color: AZUL, fontWeight: 700 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="valor" dataKey="Ano anterior" fill={AZUL_CLARO} radius={[7, 7, 0, 0]} maxBarSize={34} />
                    <Bar yAxisId="valor" dataKey="Faturamento" fill={AZUL} radius={[7, 7, 0, 0]} maxBarSize={38}>
                      <LabelList dataKey="Faturamento" position="top" formatter={labelMoney} style={{ fill: AZUL, fontSize: 10, fontWeight: 700 }} />
                    </Bar>
                    <Line yAxisId="qtd" type="monotone" dataKey="Quantidade" stroke={AZUL_CLARO} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                    <Line yAxisId="qtd" type="monotone" dataKey="Forecast" stroke={LARANJA} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} />
                    <Line yAxisId="qtd" type="monotone" dataKey="Orçado" stroke={VERDE} strokeWidth={2} strokeDasharray="2 3" dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>


            <div className="grid gap-5 xl:grid-cols-3">
              <SectionCard title="Ranking por linha" subtitle="Faturamento por linha de negócio, com participação no valor total." compact>
                <div className="space-y-4">
                  {linhasGrafico.map((item) => {
                    const maxValor = Math.max(...linhasGrafico.map((linha) => linha.Faturamento || 0), 1)
                    const width = Math.max(6, ((item.Faturamento || 0) / maxValor) * 100)
                    return (
                      <div key={item.linha} className="space-y-1.5">
                        <div className="flex items-end justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-800">{item.linha}</p>
                          <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(item.Faturamento)} <span className="font-medium text-slate-500">· {fmtPct(item.Participacao)}</span></p>
                        </div>
                        <div className="h-4 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-4 rounded-full" style={{ width: `${width}%`, backgroundColor: AZUL }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>

              <SectionCard title="ABC de clientes" subtitle="Concentração do faturamento vendido até agora." compact>
                <AbcDualBarsCard titulo="Clientes por faturamento" entidadeLabel="clientes" data={abcClientesValor} />
              </SectionCard>

              <SectionCard title="ABC de itens" subtitle="Concentração do faturamento por produto vendido." compact>
                <AbcDualBarsCard titulo="Itens por faturamento" entidadeLabel="itens" data={abcProdutosValor} />
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard
                title="Mix de linha de negócio por ano"
                subtitle="Participação de cada linha no faturamento anual. O ano corrente aparece em YTD conforme a base carregada."
              >
                <HeatmapMixLinhaAno dados={mixLinhaAno} />
              </SectionCard>

              <SectionCard
                title="Mix geográfico por país"
                subtitle="Evolução do faturamento por país estimado a partir do cadastro de clientes. Útil para visualizar expansão internacional."
              >
                <HeatmapMixPaisAno dados={mixPaisAno} />
              </SectionCard>
            </div>
          </div>
        )}

        {aba === "atendimento" && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Mediana ciclo" value={`${fmtNumero(cards.mediana_dias_preped_faturamento, 1)} dias`} subtitle="Pré-pedido até faturar" icon={CalendarDays} tone="blue" />
              <MetricCard title="Até 7 dias" value={fmtPct(cards.pct_faturado_ate_7_dias)} subtitle="Faturamento com ciclo curto" icon={TrendingUp} tone="green" />
              <MetricCard title="Acima de 30 dias" value={fmtPct(cards.pct_faturado_acima_30_dias)} subtitle="Faturamento que ficou em carteira" icon={AlertTriangle} tone="amber" />
              <MetricCard title="Fim do mês" value={fmtPct(cards.pct_faturamento_prepedido_fim_mes)} subtitle="Pré-pedido emitido após dia 21" icon={CalendarDays} tone="amber" />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Aging pré-pedido → faturamento" subtitle="Mostra quanto do faturamento veio de pré-pedidos recentes ou antigos.">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cicloAgingGrafico} margin={{ top: 12, right: 24, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_CLARO} />
                      <XAxis dataKey="faixa" tick={CHART_TICK_11} />
                      <YAxis tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                      <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtNumero(Number(value)), name]} />
                      <Bar dataKey="Faturamento" fill={AZUL_CLARO} radius={[7, 7, 0, 0]} maxBarSize={52}>
                        <LabelList dataKey="Faturamento" position="top" formatter={labelMoney} style={{ fill: AZUL, fontSize: 10, fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Origem do faturamento" subtitle="Separa o que entrou no mês do faturamento versus carteira anterior.">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cicloOrigemGrafico} layout="vertical" margin={{ top: 12, right: 34, left: 34, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_CLARO} />
                      <XAxis type="number" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                      <YAxis type="category" dataKey="origem" tick={CHART_TICK_11} width={135} />
                      <Tooltip formatter={(value: any) => [fmtMoneyFull(Number(value)), "Faturamento"]} />
                      <Bar dataKey="Faturamento" fill={AZUL} radius={[0, 7, 7, 0]}>
                        <LabelList dataKey="Faturamento" position="right" formatter={labelMoney} style={{ fill: AZUL, fontSize: 10, fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <SectionCard title="Carteira pendente por status" subtitle="Snapshot operacional do que ainda não foi atendido.">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pendentesStatusGrafico} layout="vertical" margin={{ top: 8, right: 24, left: 30, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CINZA_CLARO} />
                      <XAxis type="number" tick={CHART_TICK_11} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                      <YAxis type="category" dataKey="status" tick={CHART_TICK_11} width={110} />
                      <Tooltip formatter={(value: any) => [fmtMoneyFull(Number(value)), "Valor"]} />
                      <Bar dataKey="Valor" fill={LARANJA} radius={[0, 7, 7, 0]}>
                        <LabelList dataKey="Valor" position="right" formatter={labelMoney} style={{ fill: LARANJA, fontSize: 10, fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Aging da carteira pendente" subtitle="Valor e quantidade de pré-pedidos em aberto por faixa de idade.">
                <div className="space-y-4">
                  {pendentesAgingLista.map((item) => (
                    <HorizontalProgress
                      key={item.faixa}
                      label={item.faixa || "-"}
                      value={fmtMoney(item.valor)}
                      detail={`${fmtNumero(item.prepedidos)} pré-pedidos`}
                      pct={item.participacao_valor_pct}
                      color={LARANJA}
                    />
                  ))}
                  {pendentesAgingLista.length === 0 && (
                    <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Sem carteira pendente carregada.</div>
                  )}
                </div>
              </SectionCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SectionCard title="Top clientes pendentes" subtitle="Clientes com maior valor em carteira aberta.">
                <div className="space-y-2">
                  {pendentesClientesTop.map((item, index) => (
                    <div key={`${item.cliente}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-slate-900">{item.nome || item.cliente || "-"}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{item.estado || "-"} · {item.pais_estimado || "-"} · {fmtNumero(item.prepedidos)} pré-pedidos</p>
                        </div>
                        <p className="shrink-0 font-bold text-[#17375E]">{fmtMoney(item.valor)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Top produtos pendentes" subtitle="Produtos com maior valor ainda não atendido.">
                <div className="space-y-2">
                  {pendentesProdutosTop.map((item, index) => (
                    <div key={`${item.produto}-${index}`} className="rounded-xl bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-slate-900" title={item.descricao}>{item.descricao || item.produto || "-"}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{item.produto || "-"} · {item.linha || item.grupo || "Sem linha"} · {fmtNumero(item.quantidade)} un.</p>
                        </div>
                        <p className="shrink-0 font-bold text-[#17375E]">{fmtMoney(item.valor)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </div>
        )}

        {aba === "clientes" && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <SectionCard title="ABC de clientes" subtitle="Curva ABC por valor ou por quantidade.">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1">
                    <button onClick={() => setAbcModo("valor")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${abcModo === "valor" ? "bg-[#17375E] text-white" : "text-slate-600"}`}>ABC valor</button>
                    <button onClick={() => setAbcModo("quantidade")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${abcModo === "quantidade" ? "bg-[#17375E] text-white" : "text-slate-600"}`}>ABC quantidade</button>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={buscaCliente}
                      onChange={(event) => setBuscaCliente(event.target.value)}
                      placeholder="Buscar cliente, UF, país ou tipo"
                      className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#17375E]"
                    />
                  </div>
                </div>

                <div className="mb-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">Concentração por valor</p>
                    <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {resumoAbcValor.map((item) => (
                        <div key={item.classe} className="p-3 text-center">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Classe {item.classe}</p>
                          <p className="mt-1 text-lg font-bold text-slate-900">{fmtNumero(item.clientes)}</p>
                          <p className="text-xs text-slate-500">{fmtPct(item.pctValor)} do valor</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">Concentração por quantidade</p>
                    <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {resumoAbcQuantidade.map((item) => (
                        <div key={item.classe} className="p-3 text-center">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Classe {item.classe}</p>
                          <p className="mt-1 text-lg font-bold text-slate-900">{fmtNumero(item.clientes)}</p>
                          <p className="text-xs text-slate-500">{fmtPct(item.pctQuantidade)} do volume</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="max-h-[500px] overflow-auto rounded-xl border border-slate-100">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-semibold">ABC</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold">Cliente</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold">UF</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold">País</th>
                        <th className="cursor-pointer px-3 py-3 text-right text-xs font-semibold" onClick={() => toggleSort("faturamento")}><span className="inline-flex items-center gap-1">Valor <SortIcon col="faturamento" /></span></th>
                        <th className="cursor-pointer px-3 py-3 text-right text-xs font-semibold" onClick={() => toggleSort("quantidade")}><span className="inline-flex items-center gap-1">Qtd <SortIcon col="quantidade" /></span></th>
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
                            <td className="px-3 py-3"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold ring-1 ${badgeAbc(classe)}`}>{classe ?? "C"}</span></td>
                            <td className="max-w-[320px] px-3 py-3">
                              <p className="truncate font-semibold text-slate-900" title={item.nome_fantasia || item.nome}>{item.nome_fantasia || item.nome || "-"}</p>
                              <p className="text-xs text-slate-400">{item.cliente} · {item.municipio || "-"}</p>
                            </td>
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
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum cliente encontrado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <div className="space-y-5">
                <SectionCard title="País estimado" subtitle="Brasil x exportação inferido pela dClientes." compact>
                  <div className="space-y-3">
                    {paisesComInformacao.slice(0, 10).map((item) => (
                      <HorizontalProgress key={item.pais} label={item.pais || "-"} value={fmtMoney(item.faturamento)} detail={`${fmtNumero(item.clientes)} clientes`} pct={item.participacao_valor_pct} color={VERDE} />
                    ))}
                    {paisesComInformacao.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ainda não há dados suficientes para país estimado.</div>}
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">País estimado a partir do cadastro para clientes com UF EX/exportação. Itens sem match aparecem como Exterior - revisar.</p>
                  </div>
                </SectionCard>

                <SectionCard title="Top UFs" subtitle="Distribuição geográfica do faturamento." compact>
                  {dimensaoClientesCarregada && estadosComInformacao.length > 0 ? (
                    <div className="space-y-3">
                      {estadosComInformacao.slice(0, 10).map((item) => (
                        <HorizontalProgress key={item.estado} label={item.estado || "-"} value={fmtMoney(item.faturamento)} detail={`${fmtNumero(item.clientes)} clientes`} pct={item.participacao_valor_pct} color={AZUL} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">Suba a base dClientes para liberar a visão por UF, município e região.</div>
                  )}
                </SectionCard>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
              <SectionCard title="Clientes ativos por mês" subtitle="Quantidade de clientes com faturamento no mês.">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clientesMensalGrafico} margin={{ top: 12, right: 16, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CINZA_CLARO} />
                      <XAxis dataKey="mes" tick={CHART_TICK_11} />
                      <YAxis tick={CHART_TICK_11} />
                      <Tooltip formatter={(value: any) => [fmtNumero(Number(value)), "Clientes"]} />
                      <Bar dataKey="Clientes" fill={AZUL_CLARO} radius={[7, 7, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Top produtos" subtitle="Ranking rápido dos itens que mais vendem em valor e em quantidade.">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 flex items-center gap-2"><span className="rounded-full bg-[#E8F1F8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17375E]">Valor</span><p className="text-xs text-slate-500">Maior faturamento</p></div>
                    <div className="space-y-2">
                      {topProdutosValor.map((item, index) => (
                        <div key={`valor-${item.produto}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800" title={item.descricao}>{item.descricao || item.produto || "-"}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.produto || "-"} · {item.linha || item.grupo || "Sem linha"}</p></div>
                            <p className="shrink-0 text-sm font-bold text-[#17375E]">{fmtMoney(item.faturamento)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2"><span className="rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#B45309]">Qtd</span><p className="text-xs text-slate-500">Maior volume</p></div>
                    <div className="space-y-2">
                      {topProdutosQuantidade.map((item, index) => (
                        <div key={`qtd-${item.produto}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800" title={item.descricao}>{item.descricao || item.produto || "-"}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.produto || "-"} · {item.linha || item.grupo || "Sem linha"}</p></div>
                            <p className="shrink-0 text-sm font-bold text-[#D97706]">{fmtNumero(item.quantidade)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Ranking de produtos" subtitle={produtoRankingModo === "valor" ? "Produtos ordenados por faturamento." : "Produtos ordenados por quantidade faturada."}>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  <button type="button" onClick={() => setProdutoRankingModo("valor")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${produtoRankingModo === "valor" ? "bg-[#17375E] text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}>Valor</button>
                  <button type="button" onClick={() => setProdutoRankingModo("quantidade")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${produtoRankingModo === "quantidade" ? "bg-[#D97706] text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}>Quantidade</button>
                </div>
                <div className="relative w-full md:w-96">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={buscaProduto} onChange={(event) => setBuscaProduto(event.target.value)} placeholder="Buscar produto, descrição, grupo ou linha" className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#17375E]" />
                </div>
              </div>

              <div className="max-h-[500px] overflow-auto rounded-xl border border-slate-100">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
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
                        <td className="max-w-[360px] px-3 py-3"><p className="truncate font-medium text-slate-800" title={item.descricao}>{item.descricao || "-"}</p><p className="text-xs text-slate-400">Grupo {item.grupo || "-"}</p></td>
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
                      <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum produto encontrado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      {modalBasesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Bases da análise</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Faturamento</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">Use este painel para atualizar somente as bases necessárias para a análise comercial. Bases compartilhadas atualizam automaticamente as outras páginas que usam a mesma tabela.</p>
              </div>
              <button type="button" onClick={() => setModalBasesAberto(false)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Fechar</button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">Racional das bases</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">Faturados é a base principal da análise. Pré-pedidos pendentes mostra a carteira ainda não atendida. Pré-pedidos emitidos fica como base auxiliar de conferência. dClientes complementa nomes, UF, região e localização.</p>
                  <p className="mt-1 text-xs font-semibold text-blue-700">dClientes é compartilhada com outras páginas da ferramenta.</p>
                </div>
                <button type="button" onClick={carregarUltimasAtualizacoesBases} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
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
                        <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><UploadCloud size={16} /></div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {base.obrigatoria && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Obrigatória</span>}
                        {base.compartilhada && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">Compartilhada</span>}
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
                        <input key={`${base.id}-${arquivo?.name || "sem-arquivo"}`} type="file" accept={base.aceita || ".xlsx,.xls,.csv"} className="hidden" onChange={(event) => selecionarArquivoBase(base.id, event.target.files?.[0] ?? null)} />
                      </label>

                      {status && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">{status}</div>}

                      <button type="button" onClick={() => enviarBaseFaturamento(base)} disabled={Boolean(uploadingBaseId) || !arquivo} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102B4A] disabled:opacity-50">
                        {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                        {uploading ? "Enviando..." : "Subir arquivo"}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">Essas atualizações substituem a base correspondente usada na análise de Faturamento. Após o upload, a tela recalcula automaticamente. Se uma base também alimentar outra página, a data de atualização será refletida lá pelo mesmo upload_log.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
