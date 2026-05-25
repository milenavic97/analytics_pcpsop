import { useEffect, useMemo, useState } from "react"
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Search,
  Loader2,
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

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(value ?? 0)
}

function formatPercent(value?: number) {
  return `${(value ?? 0).toFixed(1)}%`
}

function CardKpi({
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>

        <div className="rounded-xl bg-slate-100 p-3">
          <Icon size={20} color={AZUL} />
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

  async function carregarResumo() {
    try {
      setLoading(true)
      setErro(null)

      const response = await getResumoFaturamento({
        ano,
        bloco,
      })

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

  const skusFiltrados = useMemo(() => {
    const termo = buscaSku.trim().toLowerCase()

    if (!termo) return dados?.skus ?? []

    return (dados?.skus ?? []).filter((item) => {
      return (
        String(item.sku ?? "").toLowerCase().includes(termo) ||
        String(item.descricao ?? "").toLowerCase().includes(termo) ||
        String(item.grupo ?? "").toLowerCase().includes(termo)
      )
    })
  }, [dados, buscaSku])

  const mesesGrafico = useMemo(() => {
    return (dados?.meses ?? []).map((m) => ({
      mes: m.mes_nome ?? String(m.mes ?? ""),
      Real: m.real ?? 0,
      Forecast: m.forecast ?? 0,
      Orçado: m.orcado ?? 0,
      FA: m.fa ?? 0,
    }))
  }, [dados])

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Faturamento
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Realizado SD2, Forecast S&amp;OP, Orçado, WMAPE e Forecast Accuracy.
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <CardKpi title="Realizado SD2 YTD" value={formatNumber(dados?.cards?.real_ytd)} icon={DollarSign} />
        <CardKpi title="Forecast S&OP" value={formatNumber(dados?.cards?.forecast_total)} icon={TrendingUp} />
        <CardKpi title="Orçado" value={formatNumber(dados?.cards?.orcado_total)} icon={Target} />
        <CardKpi title="Gap vs Forecast" value={formatNumber(dados?.cards?.gap_vs_forecast)} icon={BarChart3} />
        <CardKpi title="WMAPE" value={formatPercent(dados?.cards?.wmape)} subtitle="Erro ponderado" icon={BarChart3} />
        <CardKpi title="Forecast Accuracy" value={formatPercent(dados?.cards?.fa)} subtitle="1 - WMAPE" icon={Target} />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Visão mensal</h2>
          <p className="text-sm text-slate-500">
            Comparativo entre realizado, forecast, orçamento e FA.
          </p>
        </div>

        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mesesGrafico}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                formatter={(value: any, name: any) => {
                  if (name === "FA") return [`${Number(value).toFixed(1)}%`, name]
                  return [formatNumber(Number(value)), name]
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="Real" fill="#17375E" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="left" dataKey="Forecast" fill="#7EA6C8" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="left" dataKey="Orçado" fill="#CBD5E1" radius={[6, 6, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="FA" stroke="#0F172A" strokeWidth={3} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Visão por grupo
          </h2>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#17375E] text-white">
                  <th className="px-4 py-3 text-left font-medium">Grupo</th>
                  <th className="px-4 py-3 text-right font-medium">Real</th>
                  <th className="px-4 py-3 text-right font-medium">Forecast</th>
                  <th className="px-4 py-3 text-right font-medium">Orçado</th>
                  <th className="px-4 py-3 text-right font-medium">WMAPE</th>
                  <th className="px-4 py-3 text-right font-medium">FA</th>
                </tr>
              </thead>

              <tbody>
                {(dados?.grupos ?? []).map((item, index) => (
                  <tr key={`${item.grupo}-${index}`} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{item.grupo ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(item.real)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(item.forecast)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(item.orcado)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatPercent(item.wmape)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatPercent(item.fa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Visão por SKU
              </h2>
              <p className="text-sm text-slate-500">
                Erro calculado no nível SKU x mês.
              </p>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={buscaSku}
                onChange={(e) => setBuscaSku(e.target.value)}
                placeholder="Buscar SKU, descrição ou grupo"
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#17375E] md:w-72"
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
                  <th className="px-4 py-3 text-right font-medium">Real</th>
                  <th className="px-4 py-3 text-right font-medium">Forecast</th>
                  <th className="px-4 py-3 text-right font-medium">FA</th>
                </tr>
              </thead>

              <tbody>
                {skusFiltrados.map((item, index) => (
                  <tr key={`${item.sku}-${index}`} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{item.sku ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{item.descricao ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{item.grupo ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(item.real)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(item.forecast)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatPercent(item.fa)}</td>
                  </tr>
                ))}

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
