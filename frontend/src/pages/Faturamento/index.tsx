import { useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts"

import { api } from "../../services/api"

type LinhaMes = {
  mes: number
  real: number | null
  forecast: number | null
  orcado: number | null
}

type ResumoResponse = {
  total_real: number
  total_forecast: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  meses: LinhaMes[]
}

const mesesLabel = [
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
  const [loading, setLoading] = useState(true)
  const [dados, setDados] = useState<ResumoResponse | null>(null)

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)

      const response = await api.get("/overview/projecao-faturamento")

      setDados(response.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const wmape = useMemo(() => {
    if (!dados?.meses?.length) return 0

    let somaErro = 0
    let somaReal = 0

    dados.meses.forEach((m) => {
      if (m.real != null && m.forecast != null) {
        somaErro += Math.abs(m.real - m.forecast)
        somaReal += m.real
      }
    })

    if (!somaReal) return 0

    return (somaErro / somaReal) * 100
  }, [dados])

  const fa = useMemo(() => {
    return Math.max(0, 100 - wmape)
  }, [wmape])

  const graficoData = useMemo(() => {
    if (!dados?.meses) return []

    return dados.meses.map((m) => ({
      ...m,
      mes_label: mesesLabel[m.mes - 1],
    }))
  }, [dados])

  if (loading) {
    return (
      <div className="p-6 text-white">
        Carregando faturamento...
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 bg-[#0f172a] min-h-screen text-white">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold">
          Faturamento
        </h1>

        <p className="text-slate-400 mt-1">
          Real x Forecast x Orçado
        </p>
      </div>

      {/* CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card
          titulo="Realizado YTD"
          valor={dados?.total_real || 0}
        />

        <Card
          titulo="Forecast Futuro"
          valor={dados?.total_forecast || 0}
        />

        <Card
          titulo="Projetado Ano"
          valor={dados?.total_projetado || 0}
        />

        <Card
          titulo="WMAPE"
          valor={`${wmape.toFixed(1)}%`}
        />

        <Card
          titulo="Forecast Accuracy"
          valor={`${fa.toFixed(1)}%`}
        />
      </div>

      {/* GRÁFICO */}
      <div className="bg-[#111c44] rounded-2xl p-5 border border-slate-800">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">
            Evolução Mensal
          </h2>

          <p className="text-slate-400 text-sm">
            Realizado x Forecast x Orçado
          </p>
        </div>

        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={graficoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />

              <XAxis
                dataKey="mes_label"
                stroke="#cbd5e1"
              />

              <YAxis stroke="#cbd5e1" />

              <Tooltip />

              <Legend />

              <Line
                type="monotone"
                dataKey="real"
                name="Real"
                stroke="#38bdf8"
                strokeWidth={3}
              />

              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="#22c55e"
                strokeWidth={3}
              />

              <Line
                type="monotone"
                dataKey="orcado"
                name="Orçado"
                stroke="#f59e0b"
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-[#111c44] rounded-2xl p-5 border border-slate-800 overflow-auto">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">
            Detalhamento Mensal
          </h2>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-300">
              <th className="text-left py-3">Mês</th>
              <th className="text-right py-3">Real</th>
              <th className="text-right py-3">Forecast</th>
              <th className="text-right py-3">Orçado</th>
              <th className="text-right py-3">Gap</th>
            </tr>
          </thead>

          <tbody>
            {graficoData.map((row) => {
              const gap =
                (row.real || 0) - (row.forecast || 0)

              return (
                <tr
                  key={row.mes}
                  className="border-b border-slate-800"
                >
                  <td className="py-3">
                    {row.mes_label}
                  </td>

                  <td className="text-right">
                    {formatNumber(row.real)}
                  </td>

                  <td className="text-right">
                    {formatNumber(row.forecast)}
                  </td>

                  <td className="text-right">
                    {formatNumber(row.orcado)}
                  </td>

                  <td
                    className={`text-right font-semibold ${
                      gap >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {formatNumber(gap)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type CardProps = {
  titulo: string
  valor: number | string
}

function Card({ titulo, valor }: CardProps) {
  return (
    <div className="bg-[#111c44] border border-slate-800 rounded-2xl p-5">
      <div className="text-sm text-slate-400">
        {titulo}
      </div>

      <div className="text-3xl font-bold mt-2">
        {typeof valor === "number"
          ? formatNumber(valor)
          : valor}
      </div>
    </div>
  )
}

function formatNumber(valor: number | null | undefined) {
  if (valor == null) return "-"

  return new Intl.NumberFormat("pt-BR").format(
    Number(valor)
  )
}
