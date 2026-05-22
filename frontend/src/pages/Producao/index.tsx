import { useEffect, useMemo, useState } from "react"

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts"

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://dfl-sop-api.fly.dev"

interface Resumo {
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
}

interface LinhaMes {
  mes: number
  mes_label: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
}

interface LinhaResumo {
  linha: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
}

interface GrupoResumo {
  grupo: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
}

interface ResponseData {
  ano: number
  mes: number
  mes_label: string
  linha: string
  resumo: Resumo
  meses: LinhaMes[]
  por_linha: LinhaResumo[]
  por_grupo: GrupoResumo[]
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(value || 0)
}

function Card({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string
  subtitle?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {title}
      </p>

      <h3 className="mt-2 text-3xl font-bold text-slate-900">
        {value}
      </h3>

      {subtitle && (
        <p className="mt-2 text-sm text-slate-500">
          {subtitle}
        </p>
      )}
    </div>
  )
}

export function ProducaoPage() {
  const [loading, setLoading] = useState(true)
  const [linha, setLinha] = useState("TODAS")
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [data, setData] = useState<ResponseData | null>(null)
  const [erro, setErro] = useState("")

  async function loadData() {
    try {
      setLoading(true)
      setErro("")

      const response = await fetch(
        `${API_URL}/overview-producao/resumo?ano=2026&mes=${mes}&linha=${linha}`
      )

      if (!response.ok) {
        throw new Error("Erro ao carregar produção")
      }

      const json = await response.json()

      setData(json)
    } catch (err) {
      console.error(err)

      setErro(
        err instanceof Error
          ? err.message
          : "Erro ao carregar produção"
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [mes, linha])

  const resumo = data?.resumo

  const aderenciaColor = useMemo(() => {
    const pct = resumo?.aderencia_pct || 0

    if (pct >= 95) return "text-green-600"
    if (pct >= 80) return "text-yellow-600"

    return "text-red-500"
  }, [resumo])

  return (
    <div className="space-y-6 p-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Produção
          </p>

          <h1 className="text-4xl font-bold text-slate-900">
            Overview Produção
          </h1>

          <p className="mt-2 text-slate-500">
            Comparativo entre planejamento do Gantt e realizado do Cognitive.
          </p>
        </div>

        <div className="flex gap-3">

          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
          >
            {Array.from({ length: 12 }).map((_, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {idx + 1}
              </option>
            ))}
          </select>

          <select
            value={linha}
            onChange={(e) => setLinha(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
          >
            <option value="TODAS">Todas as linhas</option>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
          </select>

        </div>

      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          Carregando produção...
        </div>
      )}

      {!loading && erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {erro}
        </div>
      )}

      {!loading && !erro && data && (
        <>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">

            <Card
              title="Planejado V1"
              value={formatNumber(resumo?.planejado_v1_cx)}
              subtitle="planejamento baseline"
            />

            <Card
              title="Planejado Atual"
              value={formatNumber(resumo?.planejado_atual_cx)}
              subtitle="última versão do Gantt"
            />

            <Card
              title="Produção Realizada"
              value={formatNumber(resumo?.realizado_cx)}
              subtitle="apontamentos Cognitive"
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

              <p className="text-xs uppercase tracking-wide text-slate-500">
                Aderência
              </p>

              <h3 className={`mt-2 text-3xl font-bold ${aderenciaColor}`}>
                {resumo?.aderencia_pct || 0}%
              </h3>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#17375E]"
                  style={{
                    width: `${Math.min(
                      resumo?.aderencia_pct || 0,
                      100
                    )}%`,
                  }}
                />
              </div>

            </div>

          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <div className="mb-5">
              <p className="text-xs uppercase tracking-widest text-slate-400">
                Evolução mensal
              </p>

              <h2 className="text-2xl font-bold text-slate-900">
                Planejado x Realizado
              </h2>
            </div>

            <div className="h-[420px]">

              <ResponsiveContainer width="100%" height="100%">

                <LineChart data={data.meses}>

                  <CartesianGrid strokeDasharray="3 3" />

                  <XAxis dataKey="mes_label" />

                  <YAxis />

                  <Tooltip />

                  <Legend />

                  <Line
                    type="monotone"
                    dataKey="planejado_v1_cx"
                    name="Planejado V1"
                    stroke="#94A3B8"
                    strokeWidth={3}
                  />

                  <Line
                    type="monotone"
                    dataKey="planejado_atual_cx"
                    name="Planejado Atual"
                    stroke="#17375E"
                    strokeWidth={4}
                  />

                  <Line
                    type="monotone"
                    dataKey="realizado_cx"
                    name="Realizado"
                    stroke="#16A34A"
                    strokeWidth={4}
                  />

                </LineChart>

              </ResponsiveContainer>

            </div>

          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <div className="mb-5">
                <p className="text-xs uppercase tracking-widest text-slate-400">
                  Produção por linha
                </p>

                <h2 className="text-2xl font-bold text-slate-900">
                  L1 x L2
                </h2>
              </div>

              <div className="h-[320px]">

                <ResponsiveContainer width="100%" height="100%">

                  <BarChart data={data.por_linha}>

                    <CartesianGrid strokeDasharray="3 3" />

                    <XAxis dataKey="linha" />

                    <YAxis />

                    <Tooltip />

                    <Legend />

                    <Bar
                      dataKey="planejado_atual_cx"
                      name="Planejado"
                      fill="#17375E"
                      radius={[8, 8, 0, 0]}
                    />

                    <Bar
                      dataKey="realizado_cx"
                      name="Realizado"
                      fill="#16A34A"
                      radius={[8, 8, 0, 0]}
                    />

                  </BarChart>

                </ResponsiveContainer>

              </div>

            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-auto">

              <div className="mb-5">
                <p className="text-xs uppercase tracking-widest text-slate-400">
                  Grupos
                </p>

                <h2 className="text-2xl font-bold text-slate-900">
                  Planejado x Realizado
                </h2>
              </div>

              <table className="w-full text-sm">

                <thead className="bg-slate-100 text-slate-600 uppercase text-xs">

                  <tr>
                    <th className="px-3 py-3 text-left">Grupo</th>
                    <th className="px-3 py-3 text-right">Planejado</th>
                    <th className="px-3 py-3 text-right">Realizado</th>
                    <th className="px-3 py-3 text-right">Gap</th>
                    <th className="px-3 py-3 text-right">Aderência</th>
                  </tr>

                </thead>

                <tbody>

                  {data.por_grupo.map((item, idx) => (

                    <tr
                      key={`${item.grupo}-${idx}`}
                      className="border-t border-slate-100"
                    >

                      <td className="px-3 py-3 font-semibold text-slate-800">
                        {item.grupo}
                      </td>

                      <td className="px-3 py-3 text-right">
                        {formatNumber(item.planejado_atual_cx)}
                      </td>

                      <td className="px-3 py-3 text-right font-semibold">
                        {formatNumber(item.realizado_cx)}
                      </td>

                      <td
                        className={`px-3 py-3 text-right font-bold ${
                          item.gap_cx >= 0
                            ? "text-green-600"
                            : "text-red-500"
                        }`}
                      >
                        {formatNumber(item.gap_cx)}
                      </td>

                      <td className="px-3 py-3 text-right font-bold">
                        {item.aderencia_pct}%
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          </div>

        </>
      )}

    </div>
  )
}
