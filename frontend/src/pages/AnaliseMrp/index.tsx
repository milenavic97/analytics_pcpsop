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
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  UploadCloud,
  X,
} from "lucide-react"
import {
  Bar,
  BarChart,
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
  getAgingItens,
  getAgingResumo,
  uploadBase,
} from "@/services/api"

const PAGE_SIZE = 100

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
  TRANSFERENCIA_BRAVI: "Transferência Bravi",
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

type NumericColumnKind = "number" | "currency" | "days" | "months" | "percent"

const NUMERIC_COLUMNS: { key: SortKey; label: string; kind?: NumericColumnKind; digits?: number }[] = [
  { key: "custo_unitario", label: "Custo unitário", kind: "currency", digits: 4 },
  { key: "lead_time_dias", label: "Lead time", kind: "days" },
  { key: "qtd_minima", label: "Qtd. mínima por pedido" },
  { key: "saldo", label: "Estoque atual (volume)" },
  { key: "estoque_atual_valor", label: "Estoque atual (R$)", kind: "currency" },
  { key: "qtd_pedidos_abertos", label: "Pedido de compras (volume)" },
  { key: "pedidos_abertos_valor", label: "Pedido de compras (R$)", kind: "currency" },
  { key: "estoque_mais_pedidos", label: "Estoque + entradas (volume)" },
  { key: "estoque_mais_pedidos_valor", label: "Estoque + entradas (R$)", kind: "currency" },
  { key: "maior_media", label: "Média 3/6/9 (volume)" },
  { key: "maior_media_valor", label: "Média 3/6/9 (R$)", kind: "currency" },
  { key: "estoque_ideal", label: "Estoque ideal (volume)" },
  { key: "estoque_ideal_valor", label: "Estoque ideal (R$)", kind: "currency" },
  { key: "dias_em_estoque", label: "Dias em estoque", kind: "days" },
  { key: "cobertura_meses_atual", label: "Cobertura meses estoque atual", kind: "months", digits: 1 },
  { key: "cobertura_meses_futura", label: "Cobertura meses estoque + trânsito", kind: "months", digits: 1 },
  { key: "cobertura_consumo_lt", label: "Cobertura estoque atual / consumo + LT", kind: "months", digits: 1 },
  { key: "demanda_mes_atual", label: "Previsão demanda mês atual" },
  { key: "consumo_mes_atual", label: "Consumido mês atual" },
  { key: "previsto_vs_consumido_pct", label: "Previsão vs consumo mês atual", kind: "percent", digits: 0 },
]


const ORIGEM_LABEL: Record<string, string> = {
  DIMENSAO: "Cadastro",
  BOM: "BOM",
  NAO_CLASSIFICADO: "Não classificado",
}

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
  page: number
  page_size: number
  total: number
  total_pages: number
  itens: AgingEstoqueItem[]
}

interface AgingEstoqueItemDetalhe extends AgingEstoqueItem {
  historico_sb8_diario?: { data: string; saldo: number }[]
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
    saldo_projetado?: number | null
  }[]
  historico_consumo?: { ano: number; mes: number; periodo: string; consumo: number }[]
  forecast?: { ano: number; mes: number; periodo: string; forecast: number }[]
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

function getNum(item: AgingEstoqueItem, key: string) {
  return Number((item as AgingEstoqueItem & Record<string, unknown>)[key] || 0)
}

function fmtTableValue(item: AgingEstoqueItem, col: { key: SortKey; kind?: NumericColumnKind; digits?: number }) {
  const value = getNum(item, col.key)
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

function fmtDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10).split("-").reverse().join("/")
  return d.toLocaleDateString("pt-BR")
}

function fmtDateTime(value?: string | null) {
  if (!value) return "—"

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) {
    const texto = String(value)
    const data = texto.slice(0, 10).split("-").reverse().join("/")
    const horaMatch = texto.match(/T(\d{2}:\d{2})|\s(\d{2}:\d{2})/)
    const hora = horaMatch?.[1] || horaMatch?.[2]
    return hora ? `${data} às ${hora}` : data
  }

  const data = d.toLocaleDateString("pt-BR")
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

  return `${data} às ${hora}`
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
        estoque_atual: Number(item.saldo || 0),
        estoque_mais_pedidos: Number(item.estoque_mais_pedidos || 0),
        saldo_projetado: null,
      })
    }
    return mapa.get(key)
  }

  for (let d = new Date(inicio); d <= fim; d.setMonth(d.getMonth() + 1)) {
    ensure(d.getFullYear(), d.getMonth() + 1)
  }

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
  }

  let saldoProjetado = Number(item.saldo || 0)

  return Array.from(mapa.values())
    .sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
    .map((p) => {
      const key = monthKey(p.ano, p.mes)

      if (key >= chaveAtual) {
        saldoProjetado = saldoProjetado + Number(p.entradas_previstas || 0) - Number(p.demanda || 0)
        p.saldo_projetado = saldoProjetado
      } else {
        p.saldo_projetado = null
      }

      return p
    })
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
    <th className="px-4 py-3 text-right">
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center justify-end gap-1 rounded-md text-right font-bold text-white/95 transition hover:text-white" title={`Ordenar por ${label}`}>
        <span>{label}</span>
        <span className={active ? "text-white" : "text-white/55"}>{arrow}</span>
      </button>
    </th>
  )
}

function KpiCard({ label, value, helper, icon, tone = "default" }: { label: string; value: string; helper?: string; icon: ReactNode; tone?: "default" | "danger" | "warning" | "success" | "blue" }) {
  const tones = {
    default: { bg: "rgba(15,23,42,0.04)", color: "var(--text-primary)" },
    danger: { bg: "rgba(220,38,38,0.08)", color: "#B91C1C" },
    warning: { bg: "rgba(245,158,11,0.10)", color: "#B45309" },
    success: { bg: "rgba(22,163,74,0.08)", color: "#15803D" },
    blue: { bg: "rgba(37,99,235,0.08)", color: "#1D4ED8" },
  }
  return (
    <div className="card p-4">
      <div className="flex min-h-[82px] items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</p>
          <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
          {helper && <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{helper}</p>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: tones[tone].bg, color: tones[tone].color }}>{icon}</div>
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
    item?.forecast_metodo === "direto"
      ? "Forecast direto do código"
      : item?.forecast_metodo === "bom_explodida"
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
                </div>
              </div>
              <button className="rounded-xl p-2 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
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
              <KpiSmall label="Tipo negócio" value={item.tipo_negocio || "—"} />
              <KpiSmall label="Grupo gerencial" value={item.grupo_gerencial || "—"} />
              <KpiSmall label="Modelo" value={item.modelo_fornecimento || "—"} />
              <KpiSmall label="Demanda mês" value={fmtCompact((item as AgingEstoqueItem & Record<string, unknown>).demanda_mes_atual as number)} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5">
              <ChartBox title="SB8 diário do mês atual" subtitle="Evolução diária do saldo disponível pelo histórico de uploads da SB8.">
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
                              ? "Saldo armazém do tipo"
                              : name === "saldo_quarentena"
                                ? "Saldo quarentena 98"
                                : String(name),
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          dataKey="saldo_normal"
                          name="Saldo armazém do tipo"
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
                          name="Saldo quarentena 98"
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
  const linhaTempo = buildLinhaTempoFallback(item, horizonteFuturo)
  const pedidos = item?.pedidos || []
  const anoAtual = new Date().getFullYear()
  const consumoAnoAtual = linhaTempo
    .filter((p) => Number(p.ano) === anoAtual)
    .reduce((acc, p) => acc + Number(p.consumo || 0), 0)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b px-5 py-4 md:flex-row md:items-start" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Linha do tempo</p>
          <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {item ? `${item.codigo} · ${item.produto || "Item selecionado"}` : "Selecione um item na tabela"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Consumo histórico, demanda via forecast/BOM, compras previstas, estoque atual e saldo projetado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item && <StatusBadge status={item.status_estoque || item.status} />}
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <KpiSmall label="Saldo atual" value={fmtCompact(item.saldo)} />
            <KpiSmall label="Pedidos" value={fmtCompact(item.qtd_pedidos_abertos)} />
            <KpiSmall label="Estoque + pedidos" value={fmtCompact(item.estoque_mais_pedidos)} />
            <KpiSmall label="Maior média" value={fmtCompact(item.maior_media)} />
            <KpiSmall label={`Consumo ${anoAtual}`} value={fmtCompact(consumoAnoAtual)} />
            <KpiSmall label="Gap" value={fmtCompact(item.gap_volume)} />
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Evolução mensal</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Histórico desde 2025 e projeção de {horizonteFuturo} meses à frente. Consumo aparece só até o último mês realizado; demanda e entradas aparecem só no horizonte futuro.
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
                  <ComposedChart data={linhaTempo} margin={{ top: 8, right: 22, left: 0, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="periodo" angle={-35} textAnchor="end" height={68} interval={0} tick={{ fontSize: 10, fill: "#64748B" }} />
                    <YAxis
                      yAxisId="estoque"
                      orientation="left"
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      width={78}
                      label={{ value: "Estoque / saldo", angle: -90, position: "insideLeft", style: { fill: "#64748B", fontSize: 11 } }}
                    />
                    <YAxis
                      yAxisId="fluxo"
                      orientation="right"
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      width={78}
                      label={{ value: "Consumo / demanda", angle: 90, position: "insideRight", style: { fill: "#64748B", fontSize: 11 } }}
                    />
                    <Tooltip
                      formatter={(value: any, name: any) => [value == null ? "—" : fmtNumber(Number(value), 0), name]}
                      labelFormatter={(value) => `Período: ${value}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="fluxo" type="linear" dataKey="consumo" name="Consumo histórico" stroke="#DC2626" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                    <Line yAxisId="fluxo" type="linear" dataKey="demanda" name="Demanda forecast/BOM" stroke="#16A34A" strokeWidth={3} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
                    <Line yAxisId="fluxo" type="linear" dataKey="entradas_previstas" name="Entradas previstas" stroke="#F59E0B" strokeWidth={2.5} strokeDasharray="3 4" dot={{ r: 3 }} connectNulls />
                    <Line yAxisId="estoque" type="linear" dataKey="estoque_atual" name="Estoque atual" stroke="#163B63" strokeWidth={2.5} dot={false} connectNulls />
                    <Line yAxisId="estoque" type="linear" dataKey="estoque_mais_pedidos" name="Estoque + pedidos" stroke="#2563EB" strokeWidth={2.5} dot={false} connectNulls />
                    <Line yAxisId="estoque" type="linear" dataKey="saldo_projetado" name="Saldo projetado" stroke="#7C3AED" strokeWidth={2.8} dot={{ r: 2 }} connectNulls />
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
    let mounted = true
    setLoadingResumo(true)
    setError("")
    getAgingResumo({ classificacao_cadastro: "TODOS" })
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
  }, [refreshTick])


  useEffect(() => {
    let mounted = true
    setLoadingItens(true)
    setError("")
    getAgingItens({
        page,
        page_size: PAGE_SIZE,
        sort_key: sortKey || undefined,
        sort_direction: sortDirection,
        classificacao_cadastro: "TODOS",
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
  }, [page, sortKey, sortDirection, refreshTick])

  const itens = itensResp?.itens || []
  const totalPages = Math.max(1, itensResp?.total_pages || 1)

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
    setSelected(item as AgingEstoqueItemDetalhe)
  }

  useEffect(() => {
    const codigo = selected?.codigo
    if (!codigo) return

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
  }, [selected?.codigo, horizonteFuturo, refreshTick])

  // O backend ordena a base inteira; esta ordenação local garante resposta visual imediata na página carregada.
  const itensOrdenados = useMemo(() => {
    if (!sortKey) return itens

    const direction = sortDirection === "asc" ? 1 : -1

    return [...itens].sort((a, b) => {
      const aValue = getNum(a, sortKey)
      const bValue = getNum(b, sortKey)

      if (aValue === bValue) {
        return String(a.codigo || "").localeCompare(String(b.codigo || ""))
      }

      return (aValue - bValue) * direction
    })
  }, [itens, sortKey, sortDirection])

  const saudeNegocios = useMemo(() => resumo?.saude_negocios || [], [resumo])

  const exportCsv = () => {
    const header = [
      "codigo", "produto", "curva_a", "tipo", "unid", "segmento", "mercado",
      "custo_unitario", "lead_time_dias", "qtd_minima", "saldo", "estoque_atual_valor",
      "qtd_pedidos_abertos", "pedidos_abertos_valor", "estoque_mais_pedidos", "estoque_mais_pedidos_valor",
      "maior_media", "maior_media_valor", "estoque_ideal", "estoque_ideal_valor", "dias_em_estoque",
      "cobertura_meses_atual", "cobertura_meses_futura", "cobertura_consumo_lt",
      "demanda_mes_atual", "consumo_mes_atual", "previsto_vs_consumido_pct",
    ]
    const csv = [header.join(";"), ...itens.map((r) => header.map((h) => String((r as any)[h] ?? "").replace(/;/g, ",")).join(";"))].join("\n")
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
          <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>Suprimentos · Estoque</p>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Gestão de Estoque</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Saldo atual, pedidos em aberto, cobertura e estoque ideal por material.</p>
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
          <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} disabled={!itens.length}>
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {error && <div className="card p-5 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Itens" value={fmtNumber(resumo?.resumo?.total_itens || 0)} helper={`Snapshot: ${fmtDate(resumo?.data_snapshot_consumo)}`} icon={<Boxes size={20} />} />
        <KpiCard label="Ruptura" value={fmtNumber(resumo?.resumo?.ruptura || 0)} helper="Saldo zerado com consumo" icon={<AlertTriangle size={20} />} tone="danger" />
        <KpiCard label="Críticos" value={fmtNumber(resumo?.resumo?.critico || 0)} helper="Abaixo do ideal/LT" icon={<ArrowDownRight size={20} />} tone="warning" />
        <KpiCard label="Excesso" value={fmtNumber(resumo?.resumo?.excesso || 0)} helper="Acima da política" icon={<ArrowUpRight size={20} />} tone="blue" />
        <KpiCard label="Descont. c/ saldo" value={fmtNumber(resumo?.resumo?.descontinuado_com_saldo || 0)} helper="portfólio descontinuado" icon={<PackageSearch size={20} />} tone="danger" />
        <KpiCard label="Bravi" value={fmtNumber(resumo?.resumo?.transferencia_bravi || 0)} helper="itens em transferência" icon={<ShoppingCart size={20} />} tone="blue" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {saudeNegocios.map((negocio) => (
          <div
            key={negocio.tipo_negocio}
            className="card p-4 text-left"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex min-h-[82px] items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Saúde da linha</p>
                <h3 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>{negocio.tipo_negocio}</h3>
              </div>
              <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "rgba(37,99,235,0.08)", color: "#1D4ED8" }}>{fmtNumber(negocio.itens)} itens</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <KpiSmall label="Críticos" value={fmtNumber(negocio.criticos)} />
              <KpiSmall label="Excesso" value={fmtNumber(negocio.excesso)} />
              <KpiSmall label="Saldo" value={fmtCompact(negocio.saldo_total)} />
              <KpiSmall label="Cob. futura" value={`${fmtNumber(negocio.cobertura_futura_media_dias, 0)} d`} />
            </div>
            {(negocio.descontinuado_com_saldo > 0 || negocio.transferencia_bravi > 0) && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                {negocio.descontinuado_com_saldo > 0 ? `${fmtNumber(negocio.descontinuado_com_saldo)} descontinuado(s) com saldo. ` : ""}
                {negocio.transferencia_bravi > 0 ? `${fmtNumber(negocio.transferencia_bravi)} item(ns) Bravi.` : ""}
              </p>
            )}
          </div>
        ))}
      </div>


      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Base analítica</p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--text-primary)" }}>Materiais por cobertura e estoque ideal</h2>
          </div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Página {page} de {totalPages}</p>
        </div>

        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
          <table className="w-full min-w-[3100px] text-sm">
            <thead className="sticky top-0 z-20 text-left text-[11px] uppercase tracking-wide text-white shadow-sm" style={{ background: "#163B63" }}>
              <tr>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Curva A</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">UM</th>
                <th className="px-4 py-3">Segmento</th>
                <th className="px-4 py-3">Mercado</th>
                {NUMERIC_COLUMNS.map((col) => <SortableTh key={col.key} label={col.label} column={col.key} sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />)}
              </tr>
            </thead>
            <tbody>
              {itensOrdenados.map((item) => {
                const itemEx = item as AgingEstoqueItem & Record<string, unknown>
                const alertaPrevisao = getNum(item, "previsao_consumo_alerta") > 0

                return (
                  <tr
                    key={`${item.codigo}-${item.tipo}-${item.grupo_gerencial}`}
                    className="cursor-pointer border-t transition hover:bg-slate-50"
                    style={{
                      borderColor: "var(--border)",
                      background: selected?.codigo === item.codigo ? "rgba(37,99,235,0.06)" : undefined,
                    }}
                    onClick={() => abrirDetalhe(item)}
                  >
                    <td className="px-4 py-3 font-bold" style={{ color: "var(--text-primary)" }}>{item.codigo}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-[320px] truncate font-medium" style={{ color: "var(--text-primary)" }}>{item.produto || "—"}</div>
                    </td>
                    <td className="px-4 py-3">{String(itemEx.curva_a || item.abc_ytm || "—")}</td>
                    <td className="px-4 py-3">{item.tipo || item.tipo_produto_erp || "—"}</td>
                    <td className="px-4 py-3">{item.unid || "—"}</td>
                    <td className="px-4 py-3">{item.segmento || "—"}</td>
                    <td className="px-4 py-3">{item.mercado || "—"}</td>
                    {NUMERIC_COLUMNS.map((col) => {
                      const isGap = col.key === "estoque_ideal" || col.key === "estoque_ideal_valor" || col.key === "cobertura_consumo_lt" || col.key === "previsto_vs_consumido_pct"
                      const color = col.key === "previsto_vs_consumido_pct" && alertaPrevisao
                        ? "#DC2626"
                        : "var(--text-primary)"

                      return (
                        <td key={col.key} className={`px-4 py-3 text-right ${isGap ? "font-semibold" : ""}`} style={{ color }}>
                          {fmtTableValue(item, col)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loadingItens && !itens.length && <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum item encontrado na base atual.</div>}
          {loadingItens && <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Carregando itens...</div>}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Exibindo {fmtNumber(itens.length)} de {fmtNumber(itensResp?.total || 0)} itens</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Anterior</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingItens} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Próxima</button>
          </div>
        </div>
      </div>

      <TimelinePrincipal
        item={selected}
        loading={loadingDetalhe}
        horizonteFuturo={horizonteFuturo}
        onHorizonteChange={setHorizonteFuturo}
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
      {false && <ItemDrawer item={selected} loading={loadingDetalhe} onClose={() => setSelected(null)} />}
    </div>
  )
}
