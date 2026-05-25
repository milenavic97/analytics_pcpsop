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

import { getProjecaoFaturamento } from "../../services/api"

type LinhaMes = {
  mes: number
  real: number | null
  real_mes_atual?: number | null
  forecast: number | null
  orcado: number | null
}

type ResumoResponse = {
  total_real: number
  total_real_mes_atual?: number
  total_forecast: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  ultimo_mes_fechado?: number
  mes_atual?: number
  meses: LinhaMes[]
}

type GraficoMes = LinhaMes & {
  mes_label: string
  real_grafico: number | null
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
  const [erro, setErro] = useState<string | null>(null)
  const [dados, setDados] = useState<ResumoResponse | null>(null)

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)
      setErro(null)

      const response = await getProjecaoFaturamento()
      setDados(response as ResumoResponse)
    } catch (err) {
      console.error(err)
      setErro(
        err instanceof Error
          ? err.message
          : "Erro ao carregar faturamento."
      )
    } finally {
      setLoading(false)
    }
  }

  const graficoData = useMemo<GraficoMes[]>(() => {
    if (!dados?.meses) return []

    return dados.meses.map((m) => ({
      ...m,
      mes_label: mesesLabel[m.mes - 1] || String(m.mes),
      real_grafico: m.real ?? m.real_mes_atual ?? null,
    }))
  }, [dados])

  const wmape = useMemo(() => {
    if (!graficoData.length) return 0

    let somaErro = 0
    let somaReal = 0

    graficoData.forEach((m) => {
      const real = m.real_grafico
      const forecast = m.forecast

      if (real != null && forecast != null && real > 0) {
        somaErro += Math.abs(real - forecast)
        somaReal += real
      }
    })

    if (!somaReal) return 0

    return (somaErro / somaReal) * 100
  }, [graficoData])

  const fa = useMemo(() => {
    return Math.max(0, 100 - wmape)
  }, [wmape])

  if (loading) {
    return (
      <div className="p-6 text-white">
        Carregando faturamento...
      </div>
    )
  }

  if (erro) {
    return (
      <div className="p-6 space-y-4 text-white">
        <div>
          <h1 className="text-3xl font-bold">Faturamento</h1>
          <p className="text-red-300 mt-2">{erro}</p>
        </div>

        <button
          type="button"
          onClick={carregar}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 bg-[#0f172a] min-h-screen text-white">
      <div>
        <h1 className="text-3xl font-bold">Faturamento</h1>
        <p className="text-slate-400 mt-1">
          Real x Forecast x Orçado
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card titulo="Realizado YTD" valor={dados?.total_real || 0} />
        <Card titulo="Forecast Futuro" valor={dados?.total_forecast || 0} />
        <Card titulo="Projetado Ano" valor={dados?.total_projetado || 0} />
        <Card titulo="WMAPE" valor={`${wmape.toFixed(1)}%`} />
        <Card titulo="Forecast Accuracy" valor={`${fa.toFixed(1)}%`} />
      </div>

      <div className="bg-[#111c44] rounded-2xl p-5 border border-slate-800">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Evolução Mensal</h2>
          <p className="text-slate-400 text-sm">
            Realizado x Forecast x Orçado
          </p>
        </div>

        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={graficoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes_label" stroke="#cbd5e1" />
              <YAxis stroke="#cbd5e1" />
              <Tooltip
                formatter={(value) => formatNumber(Number(value))}
                labelFormatter={(label) => `Mês: ${label}`}
              />
              <Legend />

              <Line
                type="monotone"
                dataKey="real_grafico"
                name="Real"
                stroke="#38bdf8"
                strokeWidth={3}
                connectNulls={false}
              />

              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="#22c55e"
                strokeWidth={3}
                connectNulls={false}
              />

              <Line
                type="monotone"
                dataKey="orcado"
                name="Orçado"
                stroke="#f59e0b"
                strokeWidth={3}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-[#111c44] rounded-2xl p-5 border border-slate-800 overflow-auto">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Detalhamento Mensal</h2>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-300">
              <th className="text-left py-3">Mês</th>
              <th className="text-right py-3">Real</th>
              <th className="text-right py-3">Forecast</th>
              <th className="text-right py-3">Orçado</th>
              <th className="text-right py-3">Gap Real x Forecast</th>
            </tr>
          </thead>

          <tbody>
            {graficoData.map((row) => {
              const real = row.real_grafico
              const forecast = row.forecast
              const gap =
                real != null && forecast != null
                  ? real - forecast
                  : null

              return (
                <tr key={row.mes} className="border-b border-slate-800">
                  <td className="py-3">{row.mes_label}</td>
                  <td className="text-right">{formatNumber(real)}</td>
                  <td className="text-right">{formatNumber(forecast)}</td>
                  <td className="text-right">{formatNumber(row.orcado)}</td>
                  <td
                    className={`text-right font-semibold ${
                      gap == null
                        ? "text-slate-400"
                        : gap >= 0
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
      <div className="text-sm text-slate-400">{titulo}</div>
      <div className="text-3xl font-bold mt-2">
        {typeof valor === "number" ? formatNumber(valor) : valor}
      </div>
    </div>
  )
}

function formatNumber(valor: number | null | undefined) {
  if (valor == null || Number.isNaN(valor)) return "-"

  return new Intl.NumberFormat("pt-BR").format(Number(valor))
}
