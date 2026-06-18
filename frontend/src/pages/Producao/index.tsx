import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Factory,
  Layers,
  PackageCheck,
  RefreshCw,
  Search,
  Target,
  TimerReset,
} from "lucide-react"

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  ""
).replace(/\/$/, "")

const COLORS = {
  navy: "#17375E",
  softBlue: "#D6DCE8",
  darkBlue: "#2F3B7C",
  orange: "#F97316",
  green: "#16A34A",
  red: "#EF4444",
  slate: "#94A3B8",
  purple: "#7C3AED",
}

const MESES = [
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

type TabKey = "dashboard" | "acompanhamento"
type LinhaFiltro = "TODAS" | "L1" | "L2" | "FABRIMA"

interface PrincipalOfensor {
  motivo: string
  horas: number
  ocorrencias: number
  celulas: string
}

interface DashboardResumo {
  planejado_cx: number
  planejado_v1_cx: number
  envasado_cx: number
  embalado_cx: number
  gap_envase_cx: number
  aderencia_envase_pct: number
  aderencia_embalagem_pct: number
  horas_paradas: number
  lotes_envasados: number
  lotes_embalados: number
  principal_ofensor?: PrincipalOfensor | null
}

interface DiaProducao {
  data: string
  dia: number
  label: string
  planejado_v1_cx: number
  planejado_atual_cx: number
  envasado_cx: number
  embalado_cx: number
  aderencia_pct: number
  gap_cx: number
}

interface CelulaProducao {
  celula: string
  nome: string
  planejado_cx: number
  realizado_cx: number
  gap_cx: number
  aderencia_pct: number
  horas_paradas: number
  lotes: number
}

interface GrupoProducao {
  grupo: string
  envasado_cx: number
  embalado_cx: number
  lotes: number
}

interface DashboardResponse {
  ano: number
  mes: number
  mes_label: string
  linha: string
  resumo: DashboardResumo
  por_dia: DiaProducao[]
  por_celula: CelulaProducao[]
  top_ofensores: PrincipalOfensor[]
  por_grupo: GrupoProducao[]
  debug?: Record<string, unknown>
}

interface AcompanhamentoCard {
  celula: string
  nome: string
  ultimo_lote: string
  ultima_data?: string | null
  total_caixas: number
  total_tubetes: number
  lotes: number
}

interface AcompanhamentoLinha {
  data: string
  dia: number
  lote: string
  op: string
  codigo: string
  produto: string
  grupo: string
  equipamentos: string
  qtd_tubetes: number
  qtd_caixas: number
  primeiro_apontamento: string
  ultimo_apontamento: string
  registros: number
  status: string
}

interface AcompanhamentoSecao {
  celula: string
  nome: string
  tipo: string
  total_caixas: number
  total_tubetes: number
  lotes: number
  linhas: AcompanhamentoLinha[]
}

interface AcompanhamentoResponse {
  ano: number
  mes: number
  mes_label: string
  linha: string
  busca?: string | null
  cards: AcompanhamentoCard[]
  secoes: AcompanhamentoSecao[]
  debug?: Record<string, unknown>
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(value || 0)))
}

function formatDecimal(value?: number, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function formatCx(value?: number) {
  return `${formatNumber(value)} cx`
}

function formatTubetes(value?: number) {
  return `${formatNumber(value)} tubetes`
}

function formatHoras(value?: number) {
  return `${formatDecimal(value, 1)} h`
}

function formatPercent(value?: number) {
  return `${formatDecimal(value, 1)}%`
}

function formatDateBR(value?: string | null) {
  if (!value) return "—"
  const parts = String(value).slice(0, 10).split("-")
  if (parts.length !== 3) return value
  return `${parts[2]}/${parts[1]}`
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return "—"
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return String(value)
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt)
}

function aderenciaClass(value?: number) {
  const v = Number(value || 0)
  if (v >= 95) return "text-green-600"
  if (v >= 80) return "text-orange-500"
  return "text-red-500"
}

function gapClass(value?: number) {
  const v = Number(value || 0)
  if (v >= 0) return "text-green-600"
  return "text-red-500"
}

async function apiGet<T>(path: string, params: Record<string, string | number | undefined | null> = {}) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  })

  // Evita número antigo quando a página já ficou aberta.
  url.searchParams.set("t", String(Date.now()))

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  })

  if (!response.ok) {
    let detail = "Erro ao carregar dados de produção."
    try {
      const json = await response.json()
      detail = json?.detail || detail
    } catch {
      // mantém mensagem padrão
    }
    throw new Error(detail)
  }

  return response.json() as Promise<T>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const filtered = payload.filter((item: any) => Number(item.value || 0) !== 0)

  return (
    <div className="min-w-[230px] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">
      <p className="mb-2 font-bold text-slate-800">{label}</p>
      {filtered.length === 0 && <p className="text-slate-400">Sem movimento</p>}
      {filtered.map((item: any) => {
        const isPct = String(item.dataKey || "").includes("pct")
        const isHora = String(item.dataKey || "").includes("horas")
        const value = isPct
          ? formatPercent(item.value)
          : isHora
            ? formatHoras(item.value)
            : formatCx(item.value)

        return (
          <div key={item.dataKey} className="flex items-center justify-between gap-6 py-0.5">
            <span className="flex items-center gap-2 text-slate-500">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: item.color || item.fill }}
              />
              {item.name}
            </span>
            <span className="font-bold text-slate-900">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TopLabel(props: any) {
  const { x, y, width, value, fill = "#64748B" } = props
  if (!value || Number(value) === 0) return null
  return (
    <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill={fill}>
      {formatNumber(Number(value))}
    </text>
  )
}

function PageHeader({
  tab,
  onTabChange,
  mes,
  ano,
  linha,
  onMesChange,
  onAnoChange,
  onLinhaChange,
  onRefresh,
  loading,
}: {
  tab: TabKey
  onTabChange: (tab: TabKey) => void
  mes: number
  ano: number
  linha: LinhaFiltro
  onMesChange: (value: number) => void
  onAnoChange: (value: number) => void
  onLinhaChange: (value: LinhaFiltro) => void
  onRefresh: () => void
  loading: boolean
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Produção
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard de Produção</h1>
          <p className="mt-2 text-slate-500">
            Indicadores de aderência e acompanhamento mensal por envase e embalagem.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={mes}
            onChange={(event) => onMesChange(Number(event.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            {MESES.map((label, idx) => (
              <option key={label} value={idx + 1}>
                {label}/{ano}
              </option>
            ))}
          </select>

          <select
            value={ano}
            onChange={(event) => onAnoChange(Number(event.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            {[2024, 2025, 2026, 2027].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={linha}
            onChange={(event) => onLinhaChange(event.target.value as LinhaFiltro)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
          >
            <option value="TODAS">Todas as células</option>
            <option value="L1">Envase — Linha 1</option>
            <option value="L2">Envase — Linha 2</option>
            <option value="FABRIMA">Embalagem — Fabrima</option>
          </select>

          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          onClick={() => onTabChange("dashboard")}
          className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
            tab === "dashboard"
              ? "bg-[#17375E] text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => onTabChange("acompanhamento")}
          className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
            tab === "acompanhamento"
              ? "bg-[#17375E] text-white shadow-sm"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          Acompanhamento do Mês
        </button>
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = "blue",
}: {
  title: string
  value: string
  subtitle?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any
  accent?: "blue" | "green" | "orange" | "red" | "purple" | "slate"
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</p>
          <h3 className="mt-4 text-3xl font-bold text-slate-900">{value}</h3>
          {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className={`rounded-xl p-3 ${styles[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function DashboardTab({ data }: { data: DashboardResponse }) {
  const resumo = data.resumo

  const dailyData = useMemo(() => {
    return (data.por_dia || []).map((item) => ({
      ...item,
      aderencia_plot_pct: item.aderencia_pct > 0 ? Math.min(item.aderencia_pct, 120) : null,
    }))
  }, [data])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Planejado"
          value={formatCx(resumo.planejado_cx)}
          subtitle={`V1: ${formatCx(resumo.planejado_v1_cx)}`}
          icon={Layers}
          accent="purple"
        />
        <MetricCard
          title="Envasado"
          value={formatCx(resumo.envasado_cx)}
          subtitle={`${formatNumber(resumo.lotes_envasados)} lotes com envase`}
          icon={Factory}
          accent="green"
        />
        <MetricCard
          title="Embalado"
          value={formatCx(resumo.embalado_cx)}
          subtitle={`${formatNumber(resumo.lotes_embalados)} lotes embalados`}
          icon={PackageCheck}
          accent="blue"
        />
        <MetricCard
          title="Aderência Envase"
          value={formatPercent(resumo.aderencia_envase_pct)}
          subtitle={`Gap ${formatCx(resumo.gap_envase_cx)}`}
          icon={Target}
          accent={resumo.aderencia_envase_pct >= 95 ? "green" : resumo.aderencia_envase_pct >= 80 ? "orange" : "red"}
        />
        <MetricCard
          title="Aderência Embalagem"
          value={formatPercent(resumo.aderencia_embalagem_pct)}
          subtitle="Embalado vs. envasado"
          icon={CheckCircle2}
          accent={resumo.aderencia_embalagem_pct >= 95 ? "green" : resumo.aderencia_embalagem_pct >= 80 ? "orange" : "red"}
        />
        <MetricCard
          title="Horas Paradas"
          value={formatHoras(resumo.horas_paradas)}
          subtitle={resumo.principal_ofensor?.motivo || "Sem ofensor no período"}
          icon={TimerReset}
          accent="orange"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Evolução diária
              </p>
              <h2 className="text-xl font-bold text-slate-900">
                Planejado x envasado x embalado — {data.mes_label}/{data.ano}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Planejado vem do MPS/Gantt. Realizado vem dos apontamentos de produção.
              </p>
            </div>
          </div>

          <div className="h-[420px] rounded-2xl border border-slate-200 bg-white p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={dailyData}
                barCategoryGap="28%"
                barGap={-20}
                margin={{ top: 34, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#EEF2F7" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => formatNumber(Number(value))}
                  width={62}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 120]}
                  ticks={[0, 30, 60, 90, 120]}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `${value}%`}
                  width={46}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.03)" }} />
                <Legend />

                <Bar
                  yAxisId="left"
                  dataKey="planejado_atual_cx"
                  name="Planejado"
                  fill={COLORS.softBlue}
                  radius={[7, 7, 0, 0]}
                  barSize={30}
                >
                  <LabelList dataKey="planejado_atual_cx" content={<TopLabel fill="#64748B" />} />
                </Bar>
                <Bar
                  yAxisId="left"
                  dataKey="envasado_cx"
                  name="Envasado"
                  fill={COLORS.darkBlue}
                  radius={[7, 7, 0, 0]}
                  barSize={22}
                />
                <Bar
                  yAxisId="left"
                  dataKey="embalado_cx"
                  name="Embalado"
                  fill={COLORS.green}
                  radius={[7, 7, 0, 0]}
                  barSize={14}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="aderencia_plot_pct"
                  name="% aderência envase"
                  stroke={COLORS.orange}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: COLORS.orange, stroke: COLORS.orange }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Principais ofensores
            </p>
            <h2 className="text-xl font-bold text-slate-900">Horas paradas por motivo</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mostra os maiores motivos de parada/setup/manutenção do mês.
            </p>
          </div>

          {data.top_ofensores.length === 0 ? (
            <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
              Nenhuma parada encontrada no período.
            </div>
          ) : (
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.top_ofensores}
                  layout="vertical"
                  margin={{ top: 8, right: 20, left: 10, bottom: 8 }}
                >
                  <CartesianGrid horizontal={false} stroke="#EEF2F7" />
                  <XAxis
                    type="number"
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="motivo"
                    width={150}
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.03)" }} />
                  <Bar dataKey="horas" name="Horas" fill={COLORS.orange} radius={[0, 8, 8, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Aderência por célula
            </p>
            <h2 className="text-xl font-bold text-slate-900">L1, L2 e Fabrima</h2>
          </div>

          <div className="space-y-3">
            {data.por_celula.map((item) => (
              <div key={item.celula} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{item.nome}</p>
                    <p className="text-sm text-slate-500">
                      Realizado {formatCx(item.realizado_cx)} de {formatCx(item.planejado_cx)} planejadas
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-black ${aderenciaClass(item.aderencia_pct)}`}>
                      {formatPercent(item.aderencia_pct)}
                    </p>
                    <p className={`text-sm font-bold ${gapClass(item.gap_cx)}`}>
                      Gap {formatCx(item.gap_cx)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[#17375E]"
                    style={{ width: `${Math.min(Math.max(item.aderencia_pct || 0, 0), 100)}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                  <span>{formatHoras(item.horas_paradas)} paradas</span>
                  <span>{formatNumber(item.lotes)} lotes</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Produção por grupo
              </p>
              <h2 className="text-xl font-bold text-slate-900">Envasado x embalado</h2>
            </div>
            <div className="rounded-xl bg-green-50 p-3 text-green-600">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>

          <div className="max-h-[430px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Grupo</th>
                  <th className="px-4 py-3 text-right">Envasado</th>
                  <th className="px-4 py-3 text-right">Embalado</th>
                  <th className="px-4 py-3 text-right">Lotes</th>
                </tr>
              </thead>
              <tbody>
                {data.por_grupo.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                      Nenhum grupo encontrado.
                    </td>
                  </tr>
                )}
                {data.por_grupo.map((item) => (
                  <tr key={item.grupo} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{item.grupo}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCx(item.envasado_cx)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCx(item.embalado_cx)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatNumber(item.lotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function AcompanhamentoCardView({ item }: { item: AcompanhamentoCard }) {
  const isFabrima = item.celula === "FABRIMA"
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {item.nome}
          </p>
          <h3 className="mt-4 text-2xl font-black text-slate-900">
            {item.ultimo_lote || "—"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Último lote {isFabrima ? "embalado" : "envasado"} • {formatDateBR(item.ultima_data)}
          </p>
        </div>
        <div className={`rounded-xl p-3 ${isFabrima ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"}`}>
          {isFabrima ? <PackageCheck className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div>
          <p className="text-xs font-bold uppercase text-slate-400">Total</p>
          <p className="font-bold text-slate-900">{formatCx(item.total_caixas)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-slate-400">Lotes</p>
          <p className="font-bold text-slate-900">{formatNumber(item.lotes)}</p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === "Apontado"
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {status}
    </span>
  )
}

function AcompanhamentoSecaoView({ secao }: { secao: AcompanhamentoSecao }) {
  const isFabrima = secao.celula === "FABRIMA"

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-3 ${isFabrima ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"}`}>
              {isFabrima ? <PackageCheck className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{secao.tipo}</p>
              <h2 className="text-xl font-bold text-slate-900">{secao.nome}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {formatCx(secao.total_caixas)} • {formatNumber(secao.lotes)} lotes no mês
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600">
            {formatTubetes(secao.total_tubetes)}
          </div>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Lote / OP</th>
              <th className="px-4 py-3 text-left">Produto</th>
              <th className="px-4 py-3 text-left">Equipamento</th>
              <th className="px-4 py-3 text-right">Tubetes</th>
              <th className="px-4 py-3 text-right">Caixas</th>
              <th className="px-4 py-3 text-left">Último apontamento</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {secao.linhas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  Nenhum apontamento encontrado para esta célula.
                </td>
              </tr>
            )}

            {secao.linhas.map((row, idx) => (
              <tr key={`${row.data}-${row.lote}-${row.op}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-4 py-4 align-top font-bold text-[#A34713]">{formatDateBR(row.data)}</td>
                <td className="px-4 py-4 align-top">
                  <p className="font-black text-slate-900">{row.lote || "—"}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">OP {row.op || "—"}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="max-w-[300px] truncate font-semibold text-slate-700">{row.produto || "—"}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{row.grupo || row.codigo || "—"}</p>
                </td>
                <td className="px-4 py-4 align-top text-slate-600">{row.equipamentos || "—"}</td>
                <td className="px-4 py-4 align-top text-right text-slate-600">{formatNumber(row.qtd_tubetes)}</td>
                <td className="px-4 py-4 align-top text-right font-black text-slate-900">{formatNumber(row.qtd_caixas)}</td>
                <td className="px-4 py-4 align-top text-slate-600">{formatDateTimeBR(row.ultimo_apontamento)}</td>
                <td className="px-4 py-4 align-top"><StatusBadge status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AcompanhamentoTab({
  data,
  busca,
  onBuscaChange,
}: {
  data: AcompanhamentoResponse
  busca: string
  onBuscaChange: (value: string) => void
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Acompanhamento do mês
              </p>
              <h2 className="text-xl font-bold text-slate-900">
                Execução operacional — {data.mes_label}/{data.ano}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Visão rápida para bater o mês: até qual lote envasou, embalou e qual equipamento apontou.
              </p>
            </div>
          </div>

          <div className="relative w-full lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(event) => onBuscaChange(event.target.value)}
              placeholder="Buscar lote, OP, produto ou equipamento"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-[#17375E]"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {data.cards.map((item) => (
          <AcompanhamentoCardView key={item.celula} item={item} />
        ))}
      </div>

      <div className="space-y-6">
        {data.secoes.map((secao) => (
          <AcompanhamentoSecaoView key={secao.celula} secao={secao} />
        ))}
      </div>
    </div>
  )
}

export function ProducaoPage() {
  const today = new Date()
  const [tab, setTab] = useState<TabKey>("dashboard")
  const [ano, setAno] = useState(today.getFullYear())
  const [mes, setMes] = useState(today.getMonth() + 1)
  const [linha, setLinha] = useState<LinhaFiltro>("TODAS")
  const [busca, setBusca] = useState("")

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [acompanhamento, setAcompanhamento] = useState<AcompanhamentoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")

  async function loadDashboard() {
    const json = await apiGet<DashboardResponse>("/producao/dashboard", { ano, mes, linha })
    setDashboard(json)
  }

  async function loadAcompanhamento() {
    const json = await apiGet<AcompanhamentoResponse>("/producao/acompanhamento", {
      ano,
      mes,
      linha,
      busca,
    })
    setAcompanhamento(json)
  }

  async function loadData() {
    try {
      setLoading(true)
      setErro("")

      if (tab === "dashboard") {
        await loadDashboard()
      } else {
        await loadAcompanhamento()
      }
    } catch (err) {
      console.error(err)
      setErro(err instanceof Error ? err.message : "Erro ao carregar produção")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ano, mes, linha])

  useEffect(() => {
    if (tab !== "acompanhamento") return
    const id = window.setTimeout(() => {
      void loadData()
    }, 350)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        tab={tab}
        onTabChange={setTab}
        mes={mes}
        ano={ano}
        linha={linha}
        onMesChange={setMes}
        onAnoChange={setAno}
        onLinhaChange={setLinha}
        onRefresh={() => void loadData()}
        loading={loading}
      />

      {loading && !dashboard && !acompanhamento && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-semibold text-blue-700 shadow-sm">
          Carregando dados de produção...
        </div>
      )}

      {loading && (dashboard || acompanhamento) && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Atualizando produção em segundo plano...
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Não foi possível carregar a Produção.</p>
            <p className="mt-1">{erro}</p>
          </div>
        </div>
      )}

      {tab === "dashboard" && dashboard && <DashboardTab data={dashboard} />}

      {tab === "acompanhamento" && acompanhamento && (
        <AcompanhamentoTab data={acompanhamento} busca={busca} onBuscaChange={setBusca} />
      )}

      {!loading && !erro && tab === "dashboard" && !dashboard && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">
          Nenhum dado de dashboard encontrado.
        </div>
      )}

      {!loading && !erro && tab === "acompanhamento" && !acompanhamento && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">
          Nenhum apontamento encontrado.
        </div>
      )}
    </div>
  )
}

export default ProducaoPage
