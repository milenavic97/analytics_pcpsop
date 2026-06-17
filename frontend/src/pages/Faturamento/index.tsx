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
  UploadCloud,
  X,
  Database,
  AlertCircle,
  Package,
  RefreshCw,
  Search,
  Target,
  Users,
} from "lucide-react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts"

import { getResumoFaturamento } from "../../services/api"

type Cards = {
  faturamento_total?: number
  quantidade_total?: number
  clientes_ativos?: number
  produtos_ativos?: number
  ticket_medio_cliente?: number
  preco_medio?: number
  registros?: number
  top_cliente_nome?: string
  top_cliente_participacao_pct?: number
}

type Mes = {
  mes?: number
  mes_nome?: string
  faturamento?: number
  quantidade?: number
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
  tipos_clientes: TipoCliente[]
  meta?: {
    join_clientes?: string
    qtd_clientes_dimensao?: number
    observacao?: string
  }
}

const AZUL = "#17375E"
const AZUL_CLARO = "#7EA6C8"

const ESCOPOS = [
  { value: "TODOS", label: "Todos" },
  { value: "ANESTESICOS", label: "Anestésicos Injetáveis" },
  { value: "PPS", label: "PPS" },
  { value: "BRAVI", label: "Bravi" },
]

const API_BASE = String(import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev").replace(/\/$/, "")
const BASE_CLIENTES = "d_clientes"

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


type AbcResumoItem = {
  classe: "A" | "B" | "C"
  clientes: number
  participacao: number
  valor: number
}

const ABC_CORES: Record<string, string> = {
  A: "#17375E",
  B: "#2F6F8F",
  C: "#CBD5E1",
}

function montarResumoAbc(clientes: Cliente[], modo: "valor" | "quantidade"): AbcResumoItem[] {
  const campoClasse: keyof Cliente = modo === "valor" ? "abc_valor" : "abc_qtd"
  const campoParticipacao: keyof Cliente = modo === "valor" ? "participacao_valor_pct" : "participacao_qtd_pct"
  const campoValor: keyof Cliente = modo === "valor" ? "faturamento" : "quantidade"

  const totalValor = clientes.reduce((acc, item) => acc + Number(item[campoValor] ?? 0), 0)

  return (["A", "B", "C"] as const).map((classe) => {
    const itens = clientes.filter((item) => String(item[campoClasse] || "C").toUpperCase() === classe)
    const valor = itens.reduce((acc, item) => acc + Number(item[campoValor] ?? 0), 0)
    const participacaoBackend = itens.reduce((acc, item) => acc + Number(item[campoParticipacao] ?? 0), 0)
    const participacaoCalculada = totalValor > 0 ? (valor / totalValor) * 100 : 0

    return {
      classe,
      clientes: itens.length,
      participacao: participacaoBackend > 0 ? participacaoBackend : participacaoCalculada,
      valor,
    }
  })
}

function AbcConcentracaoPanel({
  title,
  subtitle,
  itens,
  modo,
}: {
  title: string
  subtitle: string
  itens: AbcResumoItem[]
  modo: "valor" | "quantidade"
}) {
  const totalClientes = itens.reduce((acc, item) => acc + item.clientes, 0)
  const totalValor = itens.reduce((acc, item) => acc + item.valor, 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-3">
        {itens.map((item) => (
          <div key={item.classe} className="border-b border-slate-100 p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Classe {item.classe}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{fmtNumero(item.clientes)}</p>
            <p className="text-xs text-slate-500">clientes · {fmtPct(item.participacao)}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Participação em clientes</span>
            <span>{fmtNumero(totalClientes)} clientes</span>
          </div>
          <div className="flex h-8 overflow-hidden rounded-xl bg-slate-200">
            {itens.map((item) => {
              const width = totalClientes > 0 ? (item.clientes / totalClientes) * 100 : 0
              return (
                <div
                  key={item.classe}
                  className="flex items-center justify-center text-[11px] font-bold text-white"
                  style={{ width: `${width}%`, backgroundColor: ABC_CORES[item.classe] }}
                  title={`Classe ${item.classe}: ${fmtNumero(item.clientes)} clientes`}
                >
                  {width >= 14 ? `${fmtNumero(item.clientes)}` : ""}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{modo === "valor" ? "Participação no faturamento" : "Participação na quantidade"}</span>
            <span>{modo === "valor" ? fmtMoney(totalValor) : fmtNumero(totalValor)}</span>
          </div>
          <div className="flex h-8 overflow-hidden rounded-xl bg-slate-200">
            {itens.map((item) => (
              <div
                key={item.classe}
                className="flex items-center justify-center text-[11px] font-bold text-white"
                style={{ width: `${Math.max(item.participacao, 0)}%`, backgroundColor: ABC_CORES[item.classe] }}
                title={`Classe ${item.classe}: ${fmtPct(item.participacao)} · ${modo === "valor" ? fmtMoney(item.valor) : fmtNumero(item.valor)}`}
              >
                {item.participacao >= 12 ? fmtPct(item.participacao) : ""}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          {itens.map((item) => (
            <span key={item.classe} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ABC_CORES[item.classe] }} />
              Classe {item.classe}
            </span>
          ))}
        </div>
      </div>

      {modalClientesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de dados</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Carregue a dimensão de clientes para liberar UF, município, região, tipo de cliente e nomes comerciais.
                </p>
              </div>
              <button
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status atual</p>
                <p className="mt-1 text-sm text-slate-700">
                  {ultimaAtualizacaoClientes
                    ? `Última atualização: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}`
                    : "Ainda não há carga de dClientes registrada com sucesso."}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Arquivo dClientes</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17375E] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Selecionado: <span className="font-semibold text-slate-700">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {uploadingClientes ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  Enviar dClientes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DimensaoPendenteCard({ tipo }: { tipo: "uf" | "tipo" }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white p-2 text-slate-500 shadow-sm">
          <AlertCircle size={16} />
        </div>
        <div>
          <p className="font-semibold text-slate-800">
            {tipo === "uf" ? "UF ainda sem dimensão de clientes" : "Tipo de cliente ainda sem dimensão"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Suba a base dClientes para cruzar o código da SD2 com UF, município, região e tipo de cliente.
          </p>
        </div>
      </div>

      {modalClientesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de dados</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Carregue a dimensão de clientes para liberar UF, município, região, tipo de cliente e nomes comerciais.
                </p>
              </div>
              <button
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status atual</p>
                <p className="mt-1 text-sm text-slate-700">
                  {ultimaAtualizacaoClientes
                    ? `Última atualização: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}`
                    : "Ainda não há carga de dClientes registrada com sucesso."}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Arquivo dClientes</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17375E] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Selecionado: <span className="font-semibold text-slate-700">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {uploadingClientes ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  Enviar dClientes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string
  value: string
  subtitle?: string
  icon: any
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-bold leading-tight text-slate-900 tabular-nums">{value}</p>
          {subtitle && <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-xl bg-slate-100 p-2.5 text-[#17375E]">
          <Icon size={18} />
        </div>
      </div>

      {modalClientesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de dados</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Carregue a dimensão de clientes para liberar UF, município, região, tipo de cliente e nomes comerciais.
                </p>
              </div>
              <button
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status atual</p>
                <p className="mt-1 text-sm text-slate-700">
                  {ultimaAtualizacaoClientes
                    ? `Última atualização: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}`
                    : "Ainda não há carga de dClientes registrada com sucesso."}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Arquivo dClientes</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17375E] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Selecionado: <span className="font-semibold text-slate-700">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {uploadingClientes ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  Enviar dClientes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>

      {modalClientesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de dados</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Carregue a dimensão de clientes para liberar UF, município, região, tipo de cliente e nomes comerciais.
                </p>
              </div>
              <button
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status atual</p>
                <p className="mt-1 text-sm text-slate-700">
                  {ultimaAtualizacaoClientes
                    ? `Última atualização: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}`
                    : "Ainda não há carga de dClientes registrada com sucesso."}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Arquivo dClientes</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17375E] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Selecionado: <span className="font-semibold text-slate-700">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {uploadingClientes ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  Enviar dClientes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FaturamentoPage() {
  const [dados, setDados] = useState<ResumoFaturamento | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [ano, setAno] = useState(2026)
  const [bloco, setBloco] = useState("TODOS")
  const [buscaCliente, setBuscaCliente] = useState("")
  const [buscaProduto, setBuscaProduto] = useState("")
  const [abcModo, setAbcModo] = useState<"valor" | "quantidade">("valor")
  const [sortCliente, setSortCliente] = useState<"faturamento" | "quantidade" | "participacao_valor_pct">("faturamento")
  const [sortAsc, setSortAsc] = useState(false)

  const [modalClientesAberto, setModalClientesAberto] = useState(false)
  const [arquivoClientes, setArquivoClientes] = useState<File | null>(null)
  const [uploadingClientes, setUploadingClientes] = useState(false)
  const [statusUploadClientes, setStatusUploadClientes] = useState<string | null>(null)
  const [ultimaAtualizacaoClientes, setUltimaAtualizacaoClientes] = useState<string | null>(null)

  async function carregarResumo() {
    try {
      setLoading(true)
      setErro(null)
      const response = await getResumoFaturamento({ ano, bloco })
      setDados(response as ResumoFaturamento)
    } catch (error) {
      console.error(error)
      setErro("Não foi possível carregar o faturamento agora. Atualize a página ou tente novamente em alguns instantes.")
    } finally {
      setLoading(false)
    }
  }


  async function carregarUltimaAtualizacaoClientes() {
    try {
      const response = await fetch(`${API_BASE}/upload/ultima-atualizacao/${BASE_CLIENTES}?_t=${Date.now()}`)
      if (!response.ok) return
      const json = await response.json()
      setUltimaAtualizacaoClientes(json?.ultima_atualizacao ?? null)
    } catch (error) {
      console.warn("Não foi possível consultar a última atualização de dClientes.", error)
    }
  }

  async function enviarBaseClientes() {
    if (!arquivoClientes) {
      setStatusUploadClientes("Selecione o arquivo dClientes antes de enviar.")
      return
    }

    try {
      setUploadingClientes(true)
      setStatusUploadClientes(null)

      const formData = new FormData()
      formData.append("file", arquivoClientes)

      const response = await fetch(`${API_BASE}/upload/${BASE_CLIENTES}`, {
        method: "POST",
        body: formData,
      })

      const json = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(json?.detail || "Erro ao processar a base dClientes.")
      }

      const total = json?.total_inserido ?? 0
      const erros = Array.isArray(json?.erros) ? json.erros.filter(Boolean) : []

      if (erros.length) {
        setStatusUploadClientes(`Base processada com avisos. Registros: ${fmtNumero(total)}. ${erros[0]}`)
      } else {
        setStatusUploadClientes(`Base dClientes carregada com sucesso. Registros: ${fmtNumero(total)}.`)
      }

      setArquivoClientes(null)
      await carregarUltimaAtualizacaoClientes()
      await carregarResumo()
    } catch (error: any) {
      setStatusUploadClientes(error?.message || "Erro ao subir a base dClientes.")
    } finally {
      setUploadingClientes(false)
    }
  }

  useEffect(() => {
    carregarResumo()
  }, [ano, bloco])

  useEffect(() => {
    carregarUltimaAtualizacaoClientes()
  }, [])

  const mesesGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((item) => ({
      mes: item.mes_nome ?? String(item.mes ?? ""),
      Faturamento: item.faturamento ?? 0,
      Quantidade: item.quantidade ?? 0,
      Clientes: item.clientes ?? 0,
    }))
  }, [dados])

  const linhasGrafico = useMemo(() => {
    return (dados?.linhas ?? []).slice(0, 8).map((item) => ({
      linha: abreviar(item.linha, 18),
      Faturamento: item.faturamento ?? 0,
      Participacao: item.participacao_valor_pct ?? 0,
    }))
  }, [dados])

  const clientesMesGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((item) => ({
      mes: item.mes_nome ?? String(item.mes ?? ""),
      Clientes: item.clientes ?? 0,
      Produtos: item.produtos ?? 0,
    }))
  }, [dados])

  const abcValorResumo = useMemo(() => montarResumoAbc(dados?.clientes ?? [], "valor"), [dados])
  const abcQtdResumo = useMemo(() => montarResumoAbc(dados?.clientes ?? [], "quantidade"), [dados])

  const temDimensaoClientes = Boolean((dados?.meta?.qtd_clientes_dimensao ?? 0) > 0 && dados?.meta?.join_clientes !== "sem dimensão de clientes")
  const temUfInformada = temDimensaoClientes && (dados?.estados ?? []).some((item) => {
    const uf = String(item.estado || "").trim().toUpperCase()
    return uf && uf !== "NÃO INFORMADO" && uf !== "NAO INFORMADO" && uf !== "-"
  })
  const temTipoClienteInformado = temDimensaoClientes && (dados?.tipos_clientes ?? []).some((item) => {
    const tipo = String(item.tipo_cliente || "").trim().toUpperCase()
    return tipo && tipo !== "NÃO INFORMADO" && tipo !== "NAO INFORMADO" && tipo !== "-"
  })

  const maiorMesFaturamento = useMemo(() => {
    const meses = dados?.meses ?? []
    return [...meses].sort((a, b) => Number(b.faturamento ?? 0) - Number(a.faturamento ?? 0))[0]
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

    return lista
  }, [dados, buscaProduto])

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

  const cards = dados?.cards ?? {}
  const escopoLabel = dados?.escopo_label ?? ESCOPOS.find((e) => e.value === bloco)?.label ?? "Todos"

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Comercial · Faturamento</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dashboard de Faturamento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Visão executiva por cliente, produto, linha, UF e curva ABC com base na SD2 processada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={ano}
            onChange={(event) => setAno(Number(event.target.value))}
            className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
            <option value={2024}>2024</option>
          </select>

          <select
            value={bloco}
            onChange={(event) => setBloco(event.target.value)}
            className="h-10 min-w-[210px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            {ESCOPOS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>

          <button
            onClick={() => setModalClientesAberto(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Database size={16} />
            Base de clientes
          </button>

          <button
            onClick={carregarResumo}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {erro}
        </div>
      )}

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Escopo selecionado</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{escopoLabel}</p>
            <p className="mt-1 text-xs text-slate-500">
              A dimensão de clientes cruza o código da SD2 com UF, município, região e tipo. Fonte cliente: {dados?.meta?.join_clientes ?? "carregando"}.
              {ultimaAtualizacaoClientes ? ` Última dClientes: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}.` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-semibold text-slate-700">Ano</p>
              <p>{ano}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-semibold text-slate-700">Registros</p>
              <p>{fmtNumero(cards.registros)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-semibold text-slate-700">Clientes dim.</p>
              <p>{fmtNumero(dados?.meta?.qtd_clientes_dimensao)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-semibold text-slate-700">Top cliente</p>
              <p>{fmtPct(cards.top_cliente_participacao_pct)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Faturamento" value={fmtMoney(cards.faturamento_total)} subtitle="Valor total SD2" icon={DollarSign} />
        <KpiCard title="Quantidade" value={fmtNumero(cards.quantidade_total)} subtitle="Volume faturado" icon={BarChart3} />
        <KpiCard title="Clientes ativos" value={fmtNumero(cards.clientes_ativos)} subtitle="Com venda no período" icon={Users} />
        <KpiCard title="Produtos ativos" value={fmtNumero(cards.produtos_ativos)} subtitle="SKUs faturados" icon={Package} />
        <KpiCard title="Ticket/cliente" value={fmtMoney(cards.ticket_medio_cliente)} subtitle="Faturamento médio" icon={Building2} />
        <KpiCard title="Preço médio" value={fmtMoney(cards.preco_medio)} subtitle="Valor / quantidade" icon={Target} />
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Principais leituras</p>
            <p className="mt-1 text-sm text-slate-600">
              {maiorMesFaturamento?.mes_nome ? `${maiorMesFaturamento.mes_nome} concentra o maior faturamento do período (${fmtMoney(maiorMesFaturamento.faturamento)}). ` : ""}
              O top cliente representa {fmtPct(cards.top_cliente_participacao_pct)} do faturamento e a base tem {fmtNumero(cards.clientes_ativos)} clientes ativos.
            </p>
          </div>
          {!temDimensaoClientes && (
            <button
              onClick={() => setModalClientesAberto(true)}
              className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              <UploadCloud size={15} />
              Subir dClientes para liberar UF/tipo
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title="Evolução mensal do faturamento e volume"
            subtitle="Faturamento em valor e quantidade faturada por mês. Clientes ativos ficam em visão separada."
          >
            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mesesGrafico}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => fmtNumero(Number(v))} />
                    <Tooltip
                      formatter={(value: any, name: any) => {
                        if (name === "Faturamento") return [fmtMoneyFull(Number(value)), name]
                        return [fmtNumero(Number(value)), name]
                      }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="Faturamento" fill={AZUL} radius={[7, 7, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="Quantidade" stroke={AZUL_CLARO} strokeWidth={3} dot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <h3 className="text-sm font-bold text-slate-900">Clientes ativos por mês</h3>
                <p className="mt-1 text-xs text-slate-500">Ajuda a ver concentração versus ampliação da base ativa.</p>
                <div className="mt-3 h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={clientesMesGrafico}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: any, name: any) => [fmtNumero(Number(value)), name]} />
                      <Bar dataKey="Clientes" fill="#2F6F8F" radius={[6, 6, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Composição do faturamento por linha"
          subtitle="Participação do faturamento por linha de negócio."
        >
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={linhasGrafico} layout="vertical" margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                <YAxis type="category" dataKey="linha" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtPct(Number(value)), name]} />
                <Bar dataKey="Faturamento" fill={AZUL} radius={[0, 7, 7, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title="ABC de clientes"
            subtitle="Concentração por cliente, comparando quantidade de clientes versus participação em faturamento e volume."
          >
            <div className="mb-5 grid gap-4 lg:grid-cols-2">
              <AbcConcentracaoPanel
                title="ABC por valor"
                subtitle="Quanto cada classe de clientes concentra do faturamento."
                itens={abcValorResumo}
                modo="valor"
              />
              <AbcConcentracaoPanel
                title="ABC por quantidade"
                subtitle="Quanto cada classe de clientes concentra do volume faturado."
                itens={abcQtdResumo}
                modo="quantidade"
              />
            </div>

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

            <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#17375E] text-white">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold">ABC</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">Cliente</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">Tipo</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold">UF</th>
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
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{fmtMoney(item.faturamento)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.quantidade)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtPct(participacao)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtPct(acumulado)}</td>
                      </tr>
                    )
                  })}
                  {!loading && clientesFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum cliente encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Top UFs" subtitle="Distribuição geográfica do faturamento.">
            {temUfInformada ? (
              <div className="space-y-3">
                {(dados?.estados ?? []).slice(0, 10).map((item) => (
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
              <DimensaoPendenteCard tipo="uf" />
            )}
          </SectionCard>

          <SectionCard title="Tipo de cliente" subtitle="Faturamento por classificação comercial.">
            {temTipoClienteInformado ? (
              <div className="space-y-3">
                {(dados?.tipos_clientes ?? []).slice(0, 8).map((item) => (
                  <div key={item.tipo_cliente} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-800">{item.tipo_cliente || "Não informado"}</p>
                      <p className="text-xs font-bold text-slate-500">{fmtPct(item.participacao_valor_pct)}</p>
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-slate-500">
                      <span>{fmtMoney(item.faturamento)}</span>
                      <span>{fmtNumero(item.clientes)} clientes</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DimensaoPendenteCard tipo="tipo" />
            )}
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Top produtos"
          subtitle="Produtos ordenados por faturamento. Busca por código, descrição, grupo ou linha."
        >
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Award size={15} className="text-slate-400" />
              <span>Mostrando até 200 produtos de maior faturamento.</span>
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
                    <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(item.preco_medio)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtNumero(item.clientes)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmtPct(item.participacao_valor_pct)}</td>
                  </tr>
                ))}
                {!loading && produtosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum produto encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {modalClientesAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de dados</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Carregue a dimensão de clientes para liberar UF, município, região, tipo de cliente e nomes comerciais.
                </p>
              </div>
              <button
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status atual</p>
                <p className="mt-1 text-sm text-slate-700">
                  {ultimaAtualizacaoClientes
                    ? `Última atualização: ${new Date(ultimaAtualizacaoClientes).toLocaleString("pt-BR")}`
                    : "Ainda não há carga de dClientes registrada com sucesso."}
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Arquivo dClientes</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17375E] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Selecionado: <span className="font-semibold text-slate-700">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {uploadingClientes ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                  Enviar dClientes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
