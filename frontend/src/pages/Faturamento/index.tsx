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
  Target,
  UploadCloud,
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
const VERDE = "#0F766E"
const LARANJA = "#D97706"
const CINZA_AZULADO = "#CBD5E1"

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
  const tiposClientesComInformacao = (dados?.tipos_clientes ?? []).filter((item) => {
    const tipo = String(item.tipo_cliente || "").trim().toUpperCase()
    return tipo && !["NÃO INFORMADO", "NAO INFORMADO", "SEM TIPO", "-"].includes(tipo)
  })

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
            type="button"
            onClick={() => {
              setModalClientesAberto(true)
              carregarUltimaAtualizacaoClientes()
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <UploadCloud size={16} />
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
              A dimensão de clientes é cruzada por código da SD2. Fonte cliente: {dimensaoClientesCarregada ? "dClientes vinculada" : "aguardando dClientes"}.
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

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title="Evolução mensal"
            subtitle="Faturamento em valor, quantidade faturada e clientes ativos por mês."
          >
            <div className="h-[340px]">
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
                  <Line yAxisId="right" type="monotone" dataKey="Clientes" stroke="#0F172A" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
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
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(Number(v)).replace("R$ ", "")} />
                <YAxis type="category" dataKey="linha" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any, name: any) => [name === "Faturamento" ? fmtMoneyFull(Number(value)) : fmtPct(Number(value)), name]} />
                <Bar dataKey="Faturamento" fill={AZUL} radius={[0, 7, 7, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Clientes ativos por mês"
          subtitle="Quantidade de clientes com faturamento no mês. Separado para não poluir a leitura de faturamento e volume."
        >
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={clientesMensalGrafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => fmtNumero(Number(v))} />
                <Tooltip formatter={(value: any) => [fmtNumero(Number(value)), "Clientes ativos"]} />
                <Bar dataKey="Clientes" fill={AZUL_CLARO} radius={[7, 7, 0, 0]} />
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
                    <p className="text-sm font-bold text-slate-900">Concentração ABC por valor</p>
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
                        <p className="mt-1 text-xl font-black" style={{ color: item.classe === "C" ? "#64748B" : cor }}>
                          {fmtNumero(item.clientes)} clientes
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{fmtPct(item.pctValor)} do faturamento</p>
                        <p className="text-[11px] text-slate-400">{fmtPct(item.pctClientes)} da base</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Concentração ABC por quantidade</p>
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
                        <p className="mt-1 text-xl font-black" style={{ color: item.classe === "C" ? "#64748B" : cor }}>
                          {fmtNumero(item.clientes)} clientes
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{fmtPct(item.pctQuantidade)} do volume</p>
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

          <SectionCard title="Tipo de cliente" subtitle="Faturamento por classificação comercial.">
            {dimensaoClientesCarregada && tiposClientesComInformacao.length > 0 ? (
              <div className="space-y-3">
                {tiposClientesComInformacao.slice(0, 8).map((item) => (
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
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">Tipo de cliente aguardando dClientes</p>
                <p className="mt-1 text-xs leading-relaxed">Após o upload, este bloco passa a mostrar o faturamento por classificação comercial.</p>
              </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Base de clientes</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Upload dClientes</h2>
                <p className="mt-1 text-xs text-slate-500">Atualiza UF, município, região, tipo de cliente e nomes para cruzar com a SD2.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalClientesAberto(false)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Última atualização</p>
                <p className="mt-1">{fmtDataHora(ultimaAtualizacaoClientes)}</p>
              </div>

              <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:bg-slate-100">
                <UploadCloud className="mx-auto text-slate-400" size={28} />
                <p className="mt-2 text-sm font-semibold text-slate-800">Selecionar arquivo dClientes</p>
                <p className="mt-1 text-xs text-slate-500">Aceita XLSX/XLS exportado do cadastro de clientes.</p>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => setArquivoClientes(event.target.files?.[0] ?? null)}
                />
              </label>

              {arquivoClientes && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  Arquivo selecionado: <span className="font-semibold">{arquivoClientes.name}</span>
                </div>
              )}

              {statusUploadClientes && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {statusUploadClientes}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalClientesAberto(false)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={enviarBaseClientes}
                  disabled={uploadingClientes || !arquivoClientes}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17375E] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
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
