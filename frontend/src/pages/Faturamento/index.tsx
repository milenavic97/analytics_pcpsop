import { useEffect, useMemo, useState } from "react"
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Search,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
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
  real_ytd?: number
  forecast_total?: number
  orcado_total?: number
  gap_vs_forecast?: number
  wmape?: number
  fa?: number
}

type Mes = {
  mes?: number
  mes_nome?: string
  real?: number
  forecast?: number
  orcado?: number
  wmape?: number
  fa?: number
}

type Grupo = {
  grupo?: string
  real?: number
  forecast?: number
  orcado?: number
  wmape?: number
  fa?: number
}

type Sku = {
  sku?: string
  descricao?: string
  grupo?: string
  mes?: number
  real?: number
  forecast?: number
  orcado?: number
  wmape?: number
  fa?: number
}

type Resumo = {
  ano: number
  bloco: string
  cards: Cards
  meses: Mes[]
  grupos: Grupo[]
  skus: Sku[]
}

const AZUL = "#17375E"
const MESES_LABEL: Record<number, string> = {
  1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
  7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
}

function fmt(value?: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value ?? 0)
}

function fmtPct(value?: number) {
  return `${(value ?? 0).toFixed(1)}%`
}

function faColor(fa?: number) {
  if (!fa) return "text-slate-400"
  if (fa >= 85) return "text-emerald-600"
  if (fa >= 70) return "text-amber-500"
  return "text-red-500"
}

function CardKpi({
  title,
  value,
  subtitle,
  icon: Icon,
  delta,
  deltaPositive,
}: {
  title: string
  value: string
  subtitle?: string
  icon: any
  delta?: string
  deltaPositive?: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          {delta && (
            <p className={`mt-1 text-xs font-semibold ${deltaPositive ? "text-emerald-600" : "text-red-500"}`}>
              {delta}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 rounded-xl bg-slate-100 p-2.5">
          <Icon size={18} color={AZUL} />
        </div>
      </div>
    </div>
  )
}

export default function FaturamentoPage() {
  const [dados, setDados] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [ano, setAno] = useState(2026)
  const [bloco, setBloco] = useState("ANESTESICOS")
  const [buscaSku, setBuscaSku] = useState("")

  // SKU selecionado para drill-down no gráfico
  const [skuSelecionado, setSkuSelecionado] = useState<string | null>(null)
  const [skuDescricao, setSkuDescricao] = useState<string>("")

  // Ordenação da tabela SKU
  const [sortCol, setSortCol] = useState<"real" | "forecast" | "fa" | null>("fa")
  const [sortAsc, setSortAsc] = useState(true)

  async function carregarResumo() {
    try {
      setLoading(true)
      setErro(null)
      setSkuSelecionado(null)
      const response = await getResumoFaturamento({ ano, bloco })
      setDados(response as Resumo)
    } catch (error) {
      console.error(error)
      setErro("Não foi possível carregar os dados de faturamento.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarResumo()
  }, [ano, bloco])

  // Dados do gráfico — visão mensal ou drill-down por SKU
  const mesesGrafico = useMemo(() => {
    if (skuSelecionado && dados?.skus) {
      // Drill-down: agrupa os dados do SKU selecionado por mês
      const porMes: Record<number, { real: number; forecast: number }> = {}
      for (let m = 1; m <= 12; m++) porMes[m] = { real: 0, forecast: 0 }

      dados.skus
        .filter((s) => s.sku === skuSelecionado)
        .forEach((s) => {
          const m = s.mes ?? 0
          if (m >= 1 && m <= 12) {
            porMes[m].real += s.real ?? 0
            porMes[m].forecast += s.forecast ?? 0
          }
        })

      return Object.entries(porMes).map(([mes, vals]) => ({
        mes: MESES_LABEL[Number(mes)],
        Real: vals.real,
        Forecast: vals.forecast,
        FA: 0,
      }))
    }

    return (dados?.meses ?? []).map((m) => ({
      mes: m.mes_nome ?? String(m.mes ?? ""),
      Real: m.real ?? 0,
      Forecast: m.forecast ?? 0,
      FA: m.fa ?? 0,
    }))
  }, [dados, skuSelecionado])

  // SKUs filtrados + ordenados
  const skusFiltrados = useMemo(() => {
    const termo = buscaSku.trim().toLowerCase()
    let lista = (dados?.skus ?? []).filter((item) => {
      if (!termo) return true
      return (
        String(item.sku ?? "").toLowerCase().includes(termo) ||
        String(item.descricao ?? "").toLowerCase().includes(termo) ||
        String(item.grupo ?? "").toLowerCase().includes(termo)
      )
    })

    // Agrupa por SKU (soma meses) para exibição na tabela
    const porSku: Record<string, Sku & { totalReal: number; totalForecast: number; totalErro: number; totalBase: number }> = {}
    lista.forEach((item) => {
      const key = item.sku ?? ""
      if (!porSku[key]) {
        porSku[key] = {
          ...item,
          totalReal: 0,
          totalForecast: 0,
          totalErro: 0,
          totalBase: 0,
        }
      }
      const r = item.real ?? 0
      const f = item.forecast ?? 0
      porSku[key].totalReal += r
      porSku[key].totalForecast += f
      if (r > 0 && f > 0) {
        porSku[key].totalErro += Math.min(Math.abs(r - f), r)
        porSku[key].totalBase += r
      }
    })

    let agregados = Object.values(porSku).map((s) => {
      const wmape = s.totalBase > 0 ? s.totalErro / s.totalBase : 0
      const fa = Math.max(0, 1 - wmape) * 100
      return {
        sku: s.sku,
        descricao: s.descricao,
        grupo: s.grupo,
        real: s.totalReal,
        forecast: s.totalForecast,
        fa: Math.round(fa * 10) / 10,
      }
    })

    // Ordenação
    if (sortCol) {
      agregados = agregados.sort((a, b) => {
        const va = (a as any)[sortCol] ?? 0
        const vb = (b as any)[sortCol] ?? 0
        return sortAsc ? va - vb : vb - va
      })
    }

    return agregados
  }, [dados, buscaSku, sortCol, sortAsc])

  function toggleSort(col: "real" | "forecast" | "fa") {
    if (sortCol === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(col)
      setSortAsc(false)
    }
  }

  function SortIcon({ col }: { col: "real" | "forecast" | "fa" }) {
    if (sortCol !== col) return <ChevronsUpDown size={11} className="opacity-40" />
    return sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  function selecionarSku(sku: string, descricao: string) {
    if (skuSelecionado === sku) {
      setSkuSelecionado(null)
      setSkuDescricao("")
    } else {
      setSkuSelecionado(sku)
      setSkuDescricao(descricao)
    }
  }

  const gap = dados?.cards?.gap_vs_forecast ?? 0

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Faturamento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Realizado SD2, Forecast S&amp;OP, WMAPE e Forecast Accuracy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            <option value={2026}>2026</option>
          </select>

          <select
            value={bloco}
            onChange={(e) => setBloco(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-[#17375E]"
          >
            <option value="ANESTESICOS">ANESTÉSICOS</option>
            <option value="PPS">PPS</option>
            <option value="TODOS">TODOS</option>
          </select>

          <button
            onClick={carregarResumo}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#17375E] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
            Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <CardKpi
          title="Realizado SD2 YTD"
          value={fmt(dados?.cards?.real_ytd)}
          icon={DollarSign}
        />
        <CardKpi
          title="Forecast S&OP"
          value={fmt(dados?.cards?.forecast_total)}
          icon={TrendingUp}
        />
        <CardKpi
          title="Gap vs Forecast"
          value={fmt(gap)}
          icon={BarChart3}
          delta={gap >= 0 ? `+${fmt(gap)} cx acima` : `${fmt(gap)} cx abaixo`}
          deltaPositive={gap >= 0}
        />
        <CardKpi
          title="WMAPE"
          value={fmtPct(dados?.cards?.wmape)}
          subtitle="Erro ponderado"
          icon={BarChart3}
        />
        <CardKpi
          title="Forecast Accuracy"
          value={fmtPct(dados?.cards?.fa)}
          subtitle="1 − WMAPE"
          icon={Target}
        />
      </div>

      {/* Gráfico */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {skuSelecionado ? `SKU ${skuSelecionado} — ${skuDescricao}` : "Visão mensal"}
            </h2>
            <p className="text-sm text-slate-500">
              {skuSelecionado
                ? "Histórico real e forecast do SKU selecionado. Clique novamente para voltar."
                : "Comparativo entre realizado e forecast por mês."}
            </p>
          </div>
          {skuSelecionado && (
            <button
              onClick={() => { setSkuSelecionado(null); setSkuDescricao("") }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <X size={12} /> Voltar visão geral
            </button>
          )}
        </div>

        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mesesGrafico}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              {!skuSelecionado && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
              )}
              <Tooltip
                formatter={(value: any, name: any) => {
                  if (name === "FA") return [`${Number(value).toFixed(1)}%`, name]
                  return [fmt(Number(value)), name]
                }}
              />
              <Legend />
              {skuSelecionado ? (
                <>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Real"
                    stroke="#17375E"
                    strokeWidth={3}
                    dot={{ r: 5, fill: "#17375E" }}
                    label={{ position: "top", fontSize: 11, fill: "#17375E", formatter: (v: number) => v > 0 ? fmt(v) : "" }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Forecast"
                    stroke="#7EA6C8"
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    dot={{ r: 4, fill: "#7EA6C8" }}
                    label={{ position: "top", fontSize: 11, fill: "#7EA6C8", formatter: (v: number) => v > 0 ? fmt(v) : "" }}
                  />
                </>
              ) : (
                <>
                  <Bar yAxisId="left" dataKey="Real" fill="#17375E" radius={[6, 6, 0, 0]} />
                  <Bar yAxisId="left" dataKey="Forecast" fill="#7EA6C8" radius={[6, 6, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="FA"
                    stroke="#0F172A"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabelas */}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* Visão por grupo */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Visão por grupo</h2>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#17375E] text-white">
                  <th className="px-4 py-3 text-left font-medium">Grupo</th>
                  <th className="px-4 py-3 text-right font-medium">Real</th>
                  <th className="px-4 py-3 text-right font-medium">Forecast</th>
                  <th className="px-4 py-3 text-right font-medium">WMAPE</th>
                  <th className="px-4 py-3 text-right font-medium">FA</th>
                </tr>
              </thead>
              <tbody>
                {(dados?.grupos ?? []).map((item, index) => (
                  <tr key={`${item.grupo}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-700">{item.grupo ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(item.real)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(item.forecast)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fmtPct(item.wmape)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${faColor(item.fa)}`}>
                      {fmtPct(item.fa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Visão por SKU */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Visão por SKU</h2>
              <p className="text-sm text-slate-500">Clique num SKU para ver no gráfico.</p>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={buscaSku}
                onChange={(e) => setBuscaSku(e.target.value)}
                placeholder="Buscar SKU, descrição ou grupo"
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#17375E] md:w-64"
              />
            </div>
          </div>

          <div className="max-h-[460px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-[#17375E] text-white">
                  <th className="px-4 py-3 text-left font-medium">SKU</th>
                  <th className="px-4 py-3 text-left font-medium">Descrição</th>
                  <th className="px-4 py-3 text-left font-medium">Grupo</th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right font-medium"
                    onClick={() => toggleSort("real")}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      Real <SortIcon col="real" />
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right font-medium"
                    onClick={() => toggleSort("forecast")}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      Forecast <SortIcon col="forecast" />
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-right font-medium"
                    onClick={() => toggleSort("fa")}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      FA <SortIcon col="fa" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {skusFiltrados.map((item) => {
                  const selecionado = skuSelecionado === item.sku
                  return (
                    <tr
                      key={item.sku}
                      onClick={() => selecionarSku(item.sku ?? "", item.descricao ?? "")}
                      className={`cursor-pointer border-b border-slate-100 transition-colors ${
                        selecionado
                          ? "bg-blue-50 hover:bg-blue-100"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-3 font-mono font-medium text-slate-900">
                        {item.sku ?? "-"}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-slate-600" title={item.descricao}>
                        {item.descricao ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{item.grupo ?? "-"}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(item.real)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmt(item.forecast)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${faColor(item.fa)}`}>
                        {fmtPct(item.fa)}
                      </td>
                    </tr>
                  )
                })}
                {!loading && skusFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum SKU encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
