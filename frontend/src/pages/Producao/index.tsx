import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Factory,
  Layers,
  RefreshCw,
  Target,
} from "lucide-react"

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://dfl-sop-api.fly.dev"

const COLORS = {
  navy: "#17375E",
  darkBlue: "#2F3B7C",
  softBlue: "#D6DCE8",
  orange: "#F97316",
  green: "#16A34A",
  red: "#EF4444",
  slate: "#94A3B8",
}

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
  orcado_cx?: number
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
  debug?: {
    planejados_rows?: number
    realizados_rows?: number
    observacao_v1?: string
  }
}

type ToggleKey =
  | "planejado"
  | "realizado"
  | "v1"
  | "orcado"
  | "atingimento"

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(value || 0))
}

function formatPercent(value?: number) {
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value || 0)}%`
}

function Card({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = "blue",
  onClick,
}: {
  title: string
  value: string
  subtitle?: string
  icon: any
  accent?: "blue" | "green" | "orange" | "red" | "purple"
  onClick?: () => void
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600",
  }

  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {title}
          </p>

          <h3 className="mt-5 text-3xl font-bold text-slate-900">
            {value}
          </h3>

          {subtitle && (
            <p className="mt-2 text-sm text-slate-500">
              {subtitle}
            </p>
          )}
        </div>

        <div className={`rounded-xl p-3 ${styles[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </button>
  )
}

function Toggle({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean
  label: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-slate-100 text-slate-700"
          : "bg-white text-slate-400 opacity-60"
      }`}
    >
      <span
        className="h-3 w-3 rounded"
        style={{ backgroundColor: active ? color : "#CBD5E1" }}
      />
      {label}
    </button>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{label}</p>

      {payload.map((item: any) => (
        <div
          key={item.dataKey}
          className="flex items-center justify-between gap-6 py-0.5"
        >
          <span className="flex items-center gap-2 text-slate-500">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.name}
          </span>

          <span className="font-bold text-slate-900">
            {item.dataKey === "aderencia_pct"
              ? formatPercent(item.value)
              : formatNumber(item.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ProducaoPage() {
  const [loading, setLoading] = useState(true)
  const [linha, setLinha] = useState("TODAS")
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [data, setData] = useState<ResponseData | null>(null)
  const [erro, setErro] = useState("")
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    planejado: true,
    realizado: true,
    v1: true,
    orcado: true,
    atingimento: true,
  })

  async function loadData() {
    try {
      setLoading(true)
      setErro("")

      const response = await fetch(
        `${API_URL}/overview-producao/resumo?ano=2026&mes=${mes}&linha=${linha}`
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Erro ao carregar produção")
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

  const chartData = useMemo(() => {
    return (data?.meses || []).map((item) => ({
      ...item,
      orcado_cx:
        item.orcado_cx ??
        item.planejado_atual_cx,
    }))
  }, [data])

  const aderenciaColor =
    (resumo?.aderencia_pct || 0) >= 95
      ? "text-green-600"
      : (resumo?.aderencia_pct || 0) >= 80
        ? "text-orange-500"
        : "text-red-500"

  function toggle(key: ToggleKey) {
    setToggles((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  return (
    <div className="space-y-6 p-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Produção
          </p>

          <h1 className="text-3xl font-bold text-slate-900">
            Overview Produção
          </h1>

          <p className="mt-2 text-slate-500">
            Planejado de produção vs. realizado do Cogtive por mês e linha.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            {[
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
            ].map((label, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {label}/2026
              </option>
            ))}
          </select>

          <select
            value={linha}
            onChange={(e) => setLinha(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            <option value="TODAS">Todas as linhas</option>
            <option value="L1">Linha 1</option>
            <option value="L2">Linha 2</option>
          </select>

          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          Carregando produção...
        </div>
      )}

      {!loading && erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600 shadow-sm">
          {erro}
        </div>
      )}

      {!loading && !erro && data && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card
              title="Planejado V1"
              value={formatNumber(resumo?.planejado_v1_cx)}
              subtitle="baseline da rodada"
              icon={CalendarDays}
              accent="blue"
            />

            <Card
              title="Planejado Atual"
              value={formatNumber(resumo?.planejado_atual_cx)}
              subtitle="última versão do Gantt"
              icon={Layers}
              accent="purple"
            />

            <Card
              title="Produção Realizada"
              value={formatNumber(resumo?.realizado_cx)}
              subtitle="apontamentos Cogtive"
              icon={Factory}
              accent="green"
            />

            <Card
              title="Gap"
              value={formatNumber(resumo?.gap_cx)}
              subtitle="realizado - planejado"
              icon={BarChart3}
              accent={(resumo?.gap_cx || 0) >= 0 ? "green" : "red"}
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Aderência
                  </p>

                  <h3 className={`mt-5 text-3xl font-bold ${aderenciaColor}`}>
                    {formatPercent(resumo?.aderencia_pct)}
                  </h3>

                  <p className="mt-2 text-sm text-slate-500">
                    realizado vs. planejado
                  </p>
                </div>

                <div className="rounded-xl bg-orange-50 p-3 text-orange-600">
                  <Target className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#17375E]"
                  style={{
                    width: `${Math.min(resumo?.aderencia_pct || 0, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Evolução mensal em caixas
                </p>

                <h2 className="text-xl font-bold text-slate-900">
                  Realizado vs. Planejado vs. Orçado
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Visão mensal da produção, separando baseline, planejamento atual e realizado.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Toggle
                  active={toggles.planejado}
                  label="Planejado"
                  color={COLORS.softBlue}
                  onClick={() => toggle("planejado")}
                />

                <Toggle
                  active={toggles.realizado}
                  label="Realizado"
                  color={COLORS.darkBlue}
                  onClick={() => toggle("realizado")}
                />

                <Toggle
                  active={toggles.v1}
                  label="V1 do mês"
                  color={COLORS.slate}
                  onClick={() => toggle("v1")}
                />

                <Toggle
                  active={toggles.orcado}
                  label="Orçado"
                  color={COLORS.orange}
                  onClick={() => toggle("orcado")}
                />

                <Toggle
                  active={toggles.atingimento}
                  label="% Ating."
                  color={COLORS.green}
                  onClick={() => toggle("atingimento")}
                />
              </div>
            </div>

            <div className="h-[430px] rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />

                  <XAxis
                    dataKey="mes_label"
                    tick={{ fill: "#64748B", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <YAxis
                    yAxisId="left"
                    tick={{ fill: "#64748B", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 120]}
                    tick={{ fill: "#64748B", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    hide={!toggles.atingimento}
                  />

                  <Tooltip content={<CustomTooltip />} />

                  <Legend />

                  {toggles.planejado && (
                    <Bar
                      yAxisId="left"
                      dataKey="planejado_atual_cx"
                      name="Planejado - última versão"
                      fill={COLORS.softBlue}
                      radius={[8, 8, 0, 0]}
                      barSize={34}
                    />
                  )}

                  {toggles.realizado && (
                    <Bar
                      yAxisId="left"
                      dataKey="realizado_cx"
                      name="Realizado"
                      fill={COLORS.darkBlue}
                      radius={[8, 8, 0, 0]}
                      barSize={28}
                    />
                  )}

                  {toggles.v1 && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="planejado_v1_cx"
                      name="V1 do mês"
                      stroke={COLORS.slate}
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  )}

                  {toggles.orcado && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="orcado_cx"
                      name="Orçado"
                      stroke={COLORS.orange}
                      strokeWidth={3}
                      dot={false}
                    />
                  )}

                  {toggles.atingimento && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="aderencia_pct"
                      name="% Ating. Real vs. Planejado"
                      stroke={COLORS.green}
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Produção por linha
                </p>

                <h2 className="text-xl font-bold text-slate-900">
                  L1 x L2
                </h2>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.por_linha}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />

                    <XAxis
                      dataKey="linha"
                      tick={{ fill: "#64748B", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />

                    <YAxis
                      tick={{ fill: "#64748B", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />

                    <Tooltip content={<CustomTooltip />} />
                    <Legend />

                    <Bar
                      dataKey="planejado_atual_cx"
                      name="Planejado"
                      fill={COLORS.softBlue}
                      radius={[8, 8, 0, 0]}
                    />

                    <Bar
                      dataKey="realizado_cx"
                      name="Realizado"
                      radius={[8, 8, 0, 0]}
                    >
                      {data.por_linha.map((_, idx) => (
                        <Cell key={idx} fill={COLORS.darkBlue} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Grupos
                  </p>

                  <h2 className="text-xl font-bold text-slate-900">
                    Planejado x Realizado
                  </h2>
                </div>

                <div className="rounded-xl bg-green-50 p-3 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </div>

              <div className="max-h-[320px] overflow-auto rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Grupo</th>
                      <th className="px-4 py-3 text-right">Planejado</th>
                      <th className="px-4 py-3 text-right">Realizado</th>
                      <th className="px-4 py-3 text-right">Gap</th>
                      <th className="px-4 py-3 text-right">Aderência</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.por_grupo.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center text-slate-400"
                        >
                          Nenhum grupo encontrado.
                        </td>
                      </tr>
                    )}

                    {data.por_grupo.map((item, idx) => (
                      <tr
                        key={`${item.grupo}-${idx}`}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {item.grupo}
                        </td>

                        <td className="px-4 py-3 text-right text-slate-600">
                          {formatNumber(item.planejado_atual_cx)}
                        </td>

                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatNumber(item.realizado_cx)}
                        </td>

                        <td
                          className={`px-4 py-3 text-right font-bold ${
                            item.gap_cx >= 0
                              ? "text-green-600"
                              : "text-red-500"
                          }`}
                        >
                          {formatNumber(item.gap_cx)}
                        </td>

                        <td className="px-4 py-3 text-right font-bold text-slate-800">
                          {formatPercent(item.aderencia_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {data.debug && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Planejados: {data.debug.planejados_rows ?? 0}
                </span>

                <span>
                  Realizados: {data.debug.realizados_rows ?? 0}
                </span>

                <span>
                  {data.debug.observacao_v1}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default ProducaoPage
