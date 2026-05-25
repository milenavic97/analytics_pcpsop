import { useEffect, useMemo, useState } from "react"
import {
  DollarSign,
  TrendingUp,
  Target,
  AlertTriangle,
  RefreshCcw,
} from "lucide-react"

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LabelList,
} from "recharts"

import { getResumoFaturamento } from "../../services/api"

type LinhaMensal = {
  mes: number
  real: number
  forecast: number
  orcado: number
}

type GrupoFA = {
  grupo: string
  real: number
  forecast: number
  wmape: number
  fa: number
}

type SkuFA = {
  sku: string
  grupo: string
  mes: number
  real: number
  forecast: number
  erro: number
  fa: number
}

type Resumo = {
  wmape: number
  forecast_accuracy: number
  total_real: number
  total_forecast: number
  total_orcado: number
  mensal: LinhaMensal[]
  grupos: GrupoFA[]
  skus: SkuFA[]
}

const meses = [
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

export default function FaturamentoPage() {
  const [loading, setLoading] = useState(false)

  const [ano, setAno] = useState(2026)

  const [bloco, setBloco] =
    useState("ANESTESICOS")

  const [dados, setDados] =
    useState<Resumo | null>(null)

  const carregar = async () => {
    try {
      setLoading(true)

      const response =
        await getResumoFaturamento({
          ano,
          bloco,
        })

      setDados(response)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [ano, bloco])

  const grafico = useMemo(() => {
    if (!dados) return []

    return dados.mensal.map((m) => ({
      mes: meses[m.mes - 1],
      Real: m.real,
      Forecast: m.forecast,
      Orçado: m.orcado,
    }))
  }, [dados])

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
            Comercial · Demanda
          </p>

          <h1 className="text-4xl font-bold text-slate-900">
            Faturamento
          </h1>

          <p className="text-slate-500 mt-2">
            Realizado SD2 vs Forecast
            S&OP.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <p className="text-xs text-slate-400 mb-1 uppercase font-semibold">
              Ano
            </p>

            <select
              value={ano}
              onChange={(e) =>
                setAno(Number(e.target.value))
              }
              className="h-11 rounded-xl border border-slate-200 px-4 bg-white"
            >
              <option value={2026}>
                2026
              </option>
            </select>
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-1 uppercase font-semibold">
              Bloco
            </p>

            <select
              value={bloco}
              onChange={(e) =>
                setBloco(e.target.value)
              }
              className="h-11 rounded-xl border border-slate-200 px-4 bg-white"
            >
              <option value="ANESTESICOS">
                Anestésicos
              </option>

              <option value="PPS">
                PPS
              </option>

              <option value="TODOS">
                Todos
              </option>
            </select>
          </div>

          <button
            onClick={carregar}
            className="h-11 px-4 rounded-xl bg-[#17375E] text-white flex items-center gap-2"
          >
            <RefreshCcw size={16} />
            Atualizar
          </button>
        </div>
      </div>

      {/* CARDS */}

      <div className="grid grid-cols-5 gap-4">
        <Card
          title="Realizado YTD"
          value={`${dados?.total_real?.toLocaleString(
            "pt-BR"
          ) || 0} cx`}
          subtitle="Vendas realizadas"
          icon={
            <DollarSign
              className="text-blue-600"
              size={20}
            />
          }
        />

        <Card
          title="Forecast"
          value={`${dados?.total_forecast?.toLocaleString(
            "pt-BR"
          ) || 0} cx`}
          subtitle="Plano S&OP"
          icon={
            <TrendingUp
              className="text-emerald-600"
              size={20}
            />
          }
        />

        <Card
          title="Orçado"
          value={`${dados?.total_orcado?.toLocaleString(
            "pt-BR"
          ) || 0} cx`}
          subtitle="Meta comercial"
          icon={
            <Target
              className="text-orange-600"
              size={20}
            />
          }
        />

        <Card
          title="WMAPE"
          value={`${dados?.wmape || 0}%`}
          subtitle="Erro ponderado"
          icon={
            <AlertTriangle
              className="text-red-500"
              size={20}
            />
          }
        />

        <Card
          title="Forecast Accuracy"
          value={`${
            dados?.forecast_accuracy || 0
          }%`}
          subtitle="FA SKU mês"
          icon={
            <Target
              className="text-pink-600"
              size={20}
            />
          }
        />
      </div>

      {/* GRAFICO */}

      <div className="bg-white border border-slate-200 rounded-3xl p-5">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
            Evolução mensal
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Real x Forecast x
            Orçado
          </h2>
        </div>

        <div style={{ height: 420 }}>
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <LineChart data={grafico}>
              <CartesianGrid
                strokeDasharray="0"
                vertical={false}
                stroke="#F1F5F9"
              />

              <XAxis dataKey="mes" />

              <YAxis />

              <Tooltip />

              <Legend />

              <Line
                type="monotone"
                dataKey="Real"
                stroke="#17375E"
                strokeWidth={4}
              >
                <LabelList
                  dataKey="Real"
                  position="top"
                />
              </Line>

              <Line
                type="monotone"
                dataKey="Forecast"
                stroke="#16A34A"
                strokeWidth={3}
              >
                <LabelList
                  dataKey="Forecast"
                  position="top"
                />
              </Line>

              <Line
                type="monotone"
                dataKey="Orçado"
                stroke="#94A3B8"
                strokeWidth={3}
              >
                <LabelList
                  dataKey="Orçado"
                  position="top"
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TABELAS */}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
          <div className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
              Forecast Accuracy
            </p>

            <h2 className="text-2xl font-bold text-slate-900">
              Por Grupo
            </h2>
          </div>

          <table className="w-full">
            <thead className="bg-[#17375E] text-white">
              <tr>
                <th className="px-4 py-3 text-left">
                  Grupo
                </th>

                <th className="px-4 py-3 text-right">
                  Real
                </th>

                <th className="px-4 py-3 text-right">
                  Forecast
                </th>

                <th className="px-4 py-3 text-right">
                  FA
                </th>
              </tr>
            </thead>

            <tbody>
              {dados?.grupos?.map((g) => (
                <tr
                  key={g.grupo}
                  className="border-b border-slate-100"
                >
                  <td className="px-4 py-3">
                    {g.grupo}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {g.real.toLocaleString(
                      "pt-BR"
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {g.forecast.toLocaleString(
                      "pt-BR"
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-semibold">
                    {g.fa}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
          <div className="p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
              Forecast Accuracy
            </p>

            <h2 className="text-2xl font-bold text-slate-900">
              Piores SKUs
            </h2>
          </div>

          <table className="w-full">
            <thead className="bg-[#17375E] text-white">
              <tr>
                <th className="px-4 py-3 text-left">
                  SKU
                </th>

                <th className="px-4 py-3 text-left">
                  Grupo
                </th>

                <th className="px-4 py-3 text-right">
                  FA
                </th>
              </tr>
            </thead>

            <tbody>
              {dados?.skus
                ?.slice(0, 12)
                ?.map((s, i) => (
                  <tr
                    key={`${s.sku}-${i}`}
                    className="border-b border-slate-100"
                  >
                    <td className="px-4 py-3">
                      {s.sku}
                    </td>

                    <td className="px-4 py-3">
                      {s.grupo}
                    </td>

                    <td className="px-4 py-3 text-right font-semibold text-red-500">
                      {s.fa}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {loading && (
        <div className="text-center text-slate-400">
          Carregando...
        </div>
      )}
    </div>
  )
}

function Card({
  title,
  value,
  subtitle,
  icon,
}: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
            {title}
          </p>

          <h2 className="text-4xl font-bold text-slate-900 mt-3">
            {value}
          </h2>

          <p className="text-slate-500 mt-3">
            {subtitle}
          </p>
        </div>

        <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center">
          {icon}
        </div>
      </div>
    </div>
  )
}
