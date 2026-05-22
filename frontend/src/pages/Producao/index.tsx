import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  LabelList,
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
  v1: "#8FA2BF",
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
  gap_vs_v1_cx?: number
  aderencia_pct: number
  aderencia_vs_v1_pct?: number
  planejado_v1_tb?: number
  planejado_atual_tb?: number
  realizado_tb?: number
  planejado_v1_horas?: number
  planejado_atual_horas?: number
  realizado_horas?: number
  gap_horas?: number
  aderencia_horas_pct?: number
}

interface LinhaMes {
  mes: number
  mes_label: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx?: number
  gap_vs_atual_cx?: number
  aderencia_pct: number
  aderencia_vs_v1_pct?: number
  planejado_v1_horas?: number
  planejado_atual_horas?: number
  realizado_horas?: number
  aderencia_horas_pct?: number
  orcado_cx?: number
}

interface LinhaResumo {
  linha: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
  planejado_v1_horas?: number
  planejado_atual_horas?: number
  realizado_horas?: number
  gap_horas?: number
  aderencia_horas_pct?: number
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
    planejado_v1_volume_rows?: number
    planejado_atual_volume_rows?: number
    horas_v1_rows?: number
    horas_atual_rows?: number
    realizados_rows?: number
    criterio_volume_v1?: string
    criterio_volume_atual?: string
    criterio_horas?: string
    criterio_realizado?: string
    observacao_orcado?: string
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

function formatDecimal(value?: number, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0)
}

function formatPercent(value?: number) {
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value || 0)}%`
}

function formatCx(value?: number) {
  return `${formatNumber(value)} cx`
}

function formatHoras(value?: number) {
  return `${formatDecimal(value, 1)} h`
}

function tooltipValue(dataKey: string, value: number) {
  if (
    dataKey.includes("pct") ||
    dataKey.includes("aderencia") ||
    dataKey === "aderencia_plot"
  ) {
    return formatPercent(value)
  }

  if (dataKey.includes("horas")) {
    return formatHoras(value)
  }

  return formatCx(value)
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


function BarTopLabel({ x, y, width, value, fill = "#64748B" }: any) {
  const numero = Number(value || 0)

  if (!numero) return null

  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 8}
      textAnchor="middle"
      fill={fill}
      fontSize={11}
      fontWeight={700}
    >
      {formatNumber(numero)}
    </text>
  )
}

function BarInsideLabel({ x, y, width, value }: any) {
  const numero = Number(value || 0)

  if (!numero) return null

  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) + 18}
      textAnchor="middle"
      fill="#FFFFFF"
      fontSize={11}
      fontWeight={800}
    >
      {formatNumber(numero)}
    </text>
  )
}

function PercentLabel({ x, y, value }: any) {
  const numero = Number(value || 0)

  if (!numero) return null

  return (
    <text
      x={Number(x)}
      y={Number(y) - 10}
      textAnchor="middle"
      fill={numero >= 95 ? COLORS.green : numero >= 80 ? COLORS.orange : COLORS.red}
      fontSize={11}
      fontWeight={800}
    >
      {formatPercent(numero)}
    </text>
  )
}

function MarkerLabel({ x, y, value, fill = COLORS.v1 }: any) {
  const numero = Number(value || 0)

  if (!numero) return null

  return (
    <text
      x={Number(x)}
      y={Number(y) - 8}
      textAnchor="middle"
      fill={fill}
      fontSize={11}
      fontWeight={800}
    >
      {formatNumber(numero)}
    </text>
  )
}

function HorizontalTick({ cx, cy, stroke = COLORS.v1 }: any) {
  if (cx == null || cy == null) return null

  return (
    <line
      x1={Number(cx) - 18}
      x2={Number(cx) + 18}
      y1={Number(cy)}
      y2={Number(cy)}
      stroke={stroke}
      strokeWidth={3}
      strokeLinecap="round"
    />
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const filtered = payload.filter((item: any) => Number(item.value || 0) !== 0)

  return (
    <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{label}</p>

      {filtered.map((item: any) => (
        <div
          key={item.dataKey}
          className="flex items-center justify-between gap-6 py-0.5"
        >
          <span className="flex items-center gap-2 text-slate-500">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: item.color || item.fill }}
            />
            {item.name}
          </span>

          <span className="font-bold text-slate-900">
            {tooltipValue(item.dataKey, Number(item.value || 0))}
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
    orcado: false,
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
    return (data?.meses || []).map((item) => {
      const aderencia = Number(item.aderencia_pct || 0)
      const orcado = Number(item.orcado_cx || 0)

      return {
        ...item,
        gap_cx: item.gap_cx ?? item.gap_vs_atual_cx ?? 0,
        orcado_cx: orcado,
        orcado_marker: orcado > 0 ? orcado : null,
        v1_marker: Number(item.planejado_v1_cx || 0) > 0 ? item.planejado_v1_cx : null,
        aderencia_plot: aderencia > 0 ? aderencia : null,
      }
    })
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
            Volumes em caixas (tubetes / 500).
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
              value={formatCx(resumo?.planejado_v1_cx)}
              subtitle={`Baseline da rodada • ${formatNumber(resumo?.planejado_v1_tb)} tb`}
              icon={CalendarDays}
              accent="blue"
            />

            <Card
              title="Planejado Atual"
              value={formatCx(resumo?.planejado_atual_cx)}
              subtitle={`Última versão do Gantt • ${formatNumber(resumo?.planejado_atual_tb)} tb`}
              icon={Layers}
              accent="purple"
            />

            <Card
              title="Produção Realizada"
              value={formatCx(resumo?.realizado_cx)}
              subtitle={`Apontamentos Cogtive • ${formatNumber(resumo?.realizado_tb)} tb`}
              icon={Factory}
              accent="green"
            />

            <Card
              title="Gap"
              value={formatCx(resumo?.gap_cx)}
              subtitle="Realizado - planejado atual"
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
                    Realizado vs. planejado atual
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Horas planejadas
              </p>
              <h3 className="mt-4 text-2xl font-bold text-slate-900">
                {formatHoras(resumo?.planejado_atual_horas)}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Disponíveis no MPS
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Horas realizadas
              </p>
              <h3 className="mt-4 text-2xl font-bold text-slate-900">
                {formatHoras(resumo?.realizado_horas)}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Duração registrada no Cogtive
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Aderência de horas
              </p>
              <h3 className="mt-4 text-2xl font-bold text-slate-900">
                {formatPercent(resumo?.aderencia_horas_pct)}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Horas realizadas vs. disponíveis
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Evolução mensal em caixas
                </p>

                <h2 className="text-xl font-bold text-slate-900">
                  Realizado vs. Planejado
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Barras sobrepostas no padrão do Overview. V1 e orçado aparecem como marcas discretas.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Toggle
                  active={toggles.planejado}
                  label="Planejado Atual"
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
                  label="V1"
                  color={COLORS.v1}
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

            <div className="h-[430px] rounded-2xl border border-slate-200 bg-white p-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  barCategoryGap="34%"
                  barGap={-34}
                  margin={{ top: 46, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#EEF2F7"
                    opacity={0.22}
                  />

                  <XAxis
                    dataKey="mes_label"
                    tick={{ fill: "#64748B", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <YAxis
                    yAxisId="left"
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => formatNumber(Number(value))}
                    width={64}
                  />

                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 120]}
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value}%`}
                    hide={!toggles.atingimento}
                    width={46}
                  />

                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "rgba(15, 23, 42, 0.025)" }}
                  />

                  {toggles.planejado && (
                    <Bar
                      yAxisId="left"
                      dataKey="planejado_atual_cx"
                      name="Planejado Atual"
                      fill={COLORS.softBlue}
                      radius={[7, 7, 0, 0]}
                      barSize={34}
                      maxBarSize={56}
                    >
                      <LabelList
                        dataKey="planejado_atual_cx"
                        content={(props) => (
                          <BarTopLabel {...props} fill="#64748B" />
                        )}
                      />
                    </Bar>
                  )}

                  {toggles.realizado && (
                    <Bar
                      yAxisId="left"
                      dataKey="realizado_cx"
                      name="Realizado"
                      fill={COLORS.darkBlue}
                      radius={[7, 7, 0, 0]}
                      barSize={24}
                      maxBarSize={42}
                    >
                      <LabelList
                        dataKey="realizado_cx"
                        content={(props) => <BarInsideLabel {...props} />}
                      />
                    </Bar>
                  )}

                  {toggles.v1 && (
                    <Line
                      yAxisId="left"
                      type="linear"
                      dataKey="v1_marker"
                      name="V1"
                      stroke="transparent"
                      dot={<HorizontalTick stroke={COLORS.v1} />}
                      activeDot={false}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="v1_marker"
                        content={(props) => (
                          <MarkerLabel {...props} fill={COLORS.v1} />
                        )}
                      />
                    </Line>
                  )}

                  {toggles.orcado && (
                    <Line
                      yAxisId="left"
                      type="linear"
                      dataKey="orcado_marker"
                      name="Orçado"
                      stroke="transparent"
                      dot={<HorizontalTick stroke={COLORS.orange} />}
                      activeDot={false}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="orcado_marker"
                        content={(props) => (
                          <MarkerLabel {...props} fill={COLORS.orange} />
                        )}
                      />
                    </Line>
                  )}

                  {toggles.atingimento && (
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey="aderencia_plot"
                      name="% Ating. Real vs. Planejado"
                      stroke={COLORS.green}
                      strokeWidth={2.5}
                      dot={{
                        r: 4,
                        fill: COLORS.green,
                        stroke: "#FFFFFF",
                        strokeWidth: 2,
                      }}
                      connectNulls={false}
                    >
                      <LabelList
                        dataKey="aderencia_plot"
                        content={(props) => <PercentLabel {...props} />}
                      />
                    </Line>
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
                  L1 x L2 — {data.mes_label}/2026
                </h2>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.por_linha}
                    barCategoryGap="32%"
                    barGap={-22}
                    margin={{ top: 24, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="#EEF2F7" opacity={0.35} />

                    <XAxis
                      dataKey="linha"
                      tick={{ fill: "#64748B", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />

                    <YAxis
                      tick={{ fill: "#64748B", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatNumber(Number(value))}
                    />

                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.03)" }} />
                    <Legend />

                    <Bar
                      dataKey="planejado_atual_cx"
                      name="Planejado Atual"
                      fill={COLORS.softBlue}
                      radius={[6, 6, 0, 0]}
                      barSize={40}
                    />

                    <Bar
                      dataKey="realizado_cx"
                      name="Realizado"
                      radius={[6, 6, 0, 0]}
                      barSize={26}
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
                      <th className="px-4 py-3 text-right">Planejado (cx)</th>
                      <th className="px-4 py-3 text-right">Realizado (cx)</th>
                      <th className="px-4 py-3 text-right">Gap (cx)</th>
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
                  V1: {data.debug.planejado_v1_volume_rows ?? 0} linhas
                </span>

                <span>
                  Atual: {data.debug.planejado_atual_volume_rows ?? 0} linhas
                </span>

                <span>
                  Realizados: {data.debug.realizados_rows ?? 0}
                </span>

                <span>
                  {data.debug.observacao_orcado}
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
