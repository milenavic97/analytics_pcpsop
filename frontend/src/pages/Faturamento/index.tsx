import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  RefreshCw,
  Target,
  TrendingUp,
} from "lucide-react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LabelList,
} from "recharts"

import { getProjecaoFaturamento } from "../../services/api"

type LinhaMes = {
  mes: number
  real: number | null
  real_mes_atual?: number | null
  forecast: number | null
  orcado: number | null
}

type LinhaGrupo = {
  grupo: string
  real: number
  forecast: number
  erro_abs?: number
  wmape?: number
  fa?: number
}

type LinhaSku = {
  cod_produto: string
  descricao?: string | null
  grupo?: string | null
  real: number
  forecast: number
  erro_abs?: number
  wmape?: number
  fa?: number
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
  por_grupo?: LinhaGrupo[]
  por_sku?: LinhaSku[]
}

type GraficoMes = LinhaMes & {
  mes_label: string
  real_grafico: number | null
  gap_real_forecast: number | null
}

const MESES_LABEL = [
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

const ANO_ATUAL = new Date().getFullYear()

export default function FaturamentoPage() {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [dados, setDados] = useState<ResumoResponse | null>(null)
  const [ano, setAno] = useState(String(ANO_ATUAL))
  const [bloco, setBloco] = useState("ANESTESICOS")

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

    return dados.meses.map((m) => {
      const real = m.real ?? m.real_mes_atual ?? null
      const forecast = m.forecast ?? null

      return {
        ...m,
        mes_label: MESES_LABEL[m.mes - 1] || String(m.mes),
        real_grafico: real,
        gap_real_forecast:
          real != null && forecast != null ? real - forecast : null,
      }
    })
  }, [dados])

  const indicadores = useMemo(() => {
    const linhasSku = dados?.por_sku || []

    // Quando o backend passar por_sku, usa o método correto:
    // erro absoluto SKU/mês → soma ponderada pelo real → agrega.
    if (linhasSku.length) {
      const somaErro = linhasSku.reduce(
        (acc, item) => acc + Math.abs((item.real || 0) - (item.forecast || 0)),
        0
      )
      const somaReal = linhasSku.reduce((acc, item) => acc + Math.max(item.real || 0, 0), 0)
      const wmape = somaReal > 0 ? (somaErro / somaReal) * 100 : 0
      const fa = Math.max(0, 100 - wmape)

      return { wmape, fa, criterio: "SKU" as const }
    }

    // Fallback temporário enquanto o endpoint retorna apenas a série mensal consolidada.
    const mesesComRealForecast = graficoData.filter(
      (m) => m.real_grafico != null && m.forecast != null && (m.real_grafico || 0) > 0
    )

    const somaErro = mesesComRealForecast.reduce(
      (acc, m) => acc + Math.abs((m.real_grafico || 0) - (m.forecast || 0)),
      0
    )
    const somaReal = mesesComRealForecast.reduce(
      (acc, m) => acc + (m.real_grafico || 0),
      0
    )
    const wmape = somaReal > 0 ? (somaErro / somaReal) * 100 : 0
    const fa = Math.max(0, 100 - wmape)

    return { wmape, fa, criterio: "MENSAL" as const }
  }, [dados?.por_sku, graficoData])

  const porGrupo = useMemo<LinhaGrupo[]>(() => {
    if (dados?.por_grupo?.length) {
      return dados.por_grupo.map((g) => normalizarMetricasGrupo(g))
    }

    return []
  }, [dados?.por_grupo])

  const porSku = useMemo<LinhaSku[]>(() => {
    if (!dados?.por_sku?.length) return []

    return dados.por_sku
      .map((s) => normalizarMetricasSku(s))
      .sort((a, b) => (a.fa || 0) - (b.fa || 0))
      .slice(0, 20)
  }, [dados?.por_sku])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 text-slate-600">
        Carregando faturamento...
      </div>
    )
  }

  if (erro) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Faturamento</h1>
          <p className="mt-2 text-sm text-red-600">{erro}</p>
          <button
            type="button"
            onClick={carregar}
            className="mt-4 rounded-xl bg-[#173b5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f2f4d]"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            Comercial · Demanda
          </div>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">Faturamento</h1>
          <p className="mt-1 text-sm text-slate-500">
            Realizado SD2 vs. Forecast S&amp;OP. V1 focada em anestésicos.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ano">
            <select
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-[#173b5f]"
            >
              <option value="2026">2026</option>
            </select>
          </Field>

          <Field label="Bloco">
            <select
              value={bloco}
              onChange={(e) => setBloco(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-[#173b5f]"
            >
              <option value="ANESTESICOS">Anestésicos</option>
              <option value="TODOS" disabled>
                Todos em breve
              </option>
              <option value="PPS" disabled>
                PPS em breve
              </option>
            </select>
          </Field>

          <button
            type="button"
            onClick={carregar}
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Realizado YTD"
          value={`${formatNumber(dados?.total_real)} cx`}
          subtitle="Vendas realizadas até o mês atual"
          icon={<DollarSign className="h-5 w-5" />}
          tone="blue"
        />
        <KpiCard
          title="Forecast futuro"
          value={`${formatNumber(dados?.total_forecast)} cx`}
          subtitle="Plano de demanda dos próximos meses"
          icon={<TrendingUp className="h-5 w-5" />}
          tone="green"
        />
        <KpiCard
          title="Gap vs. orçado"
          value={`${formatSignal(dados?.delta_caixas || 0)} cx`}
          subtitle={`${formatPct(dados?.pct_atingimento || 0)} de atingimento projetado`}
          icon={<BarChart3 className="h-5 w-5" />}
          tone={(dados?.delta_caixas || 0) >= 0 ? "green" : "orange"}
        />
        <KpiCard
          title="WMAPE"
          value={`${formatPct(indicadores.wmape)}`}
          subtitle={
            indicadores.criterio === "SKU"
              ? "Calculado no nível SKU e agregado"
              : "Temporário: cálculo mensal consolidado"
          }
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="orange"
        />
        <KpiCard
          title="Forecast Accuracy"
          value={`${formatPct(indicadores.fa)}`}
          subtitle="FA = 1 - WMAPE"
          icon={<Target className="h-5 w-5" />}
          tone={indicadores.fa >= 85 ? "green" : indicadores.fa >= 70 ? "orange" : "red"}
        />
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              Evolução mensal em caixas
            </div>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Realizado vs. Forecast vs. Orçado</h2>
            <p className="mt-1 text-sm text-slate-500">
              Linhas mensais com rótulos visíveis para facilitar leitura executiva.
            </p>
          </div>
        </div>

        <div className="h-[390px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={graficoData}
              margin={{ top: 30, right: 24, left: 8, bottom: 10 }}
            >
              <XAxis
                dataKey="mes_label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12 }}
                dy={8}
              />
              <YAxis hide domain={[0, "dataMax + 3000"]} />
              <Tooltip
                formatter={(value) => `${formatNumber(Number(value))} cx`}
                labelFormatter={(label) => `Mês: ${label}`}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ paddingTop: 18, fontSize: 12 }}
              />

              <Line
                type="monotone"
                dataKey="orcado"
                name="Orçado"
                stroke="#94a3b8"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              >
                <LabelList
                  dataKey="orcado"
                  position="top"
                  formatter={labelNumber}
                  className="fill-slate-500 text-[11px] font-semibold"
                />
              </Line>

              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="#16a34a"
                strokeWidth={3}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              >
                <LabelList
                  dataKey="forecast"
                  position="top"
                  formatter={labelNumber}
                  className="fill-green-700 text-[11px] font-bold"
                />
              </Line>

              <Line
                type="monotone"
                dataKey="real_grafico"
                name="Realizado"
                stroke="#173b5f"
                strokeWidth={3.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              >
                <LabelList
                  dataKey="real_grafico"
                  position="bottom"
                  formatter={labelNumber}
                  className="fill-[#173b5f] text-[11px] font-bold"
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TabelaMensal rows={graficoData} />
        <TabelaGrupos rows={porGrupo} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            Ranking por SKU
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Piores acuracidades</h2>
          <p className="mt-1 text-sm text-slate-500">
            Quando o backend retornar a visão SKU, esta tabela mostrará o FA calculado por SKU e agregado por volume.
          </p>
        </div>
        <TabelaSkus rows={porSku} />
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </span>
      {children}
    </label>
  )
}

type KpiTone = "blue" | "green" | "orange" | "red"

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone,
}: {
  title: string
  value: string
  subtitle: string
  icon: ReactNode
  tone: KpiTone
}) {
  const toneMap: Record<KpiTone, string> = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    orange: "bg-orange-50 text-orange-700",
    red: "bg-red-50 text-red-700",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            {title}
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-950">{value}</div>
          <div className="mt-2 text-sm text-slate-500">{subtitle}</div>
        </div>
        <div className={`rounded-xl p-3 ${toneMap[tone]}`}>{icon}</div>
      </div>
    </div>
  )
}

function TabelaMensal({ rows }: { rows: GraficoMes[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
          Detalhamento mensal
        </div>
        <h2 className="mt-1 text-lg font-bold text-slate-950">Real x Forecast</h2>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#173b5f] text-white">
            <tr>
              <Th>Mês</Th>
              <Th align="right">Real</Th>
              <Th align="right">Forecast</Th>
              <Th align="right">Orçado</Th>
              <Th align="right">Gap</Th>
              <Th align="right">FA</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const real = row.real_grafico
              const forecast = row.forecast
              const gap = real != null && forecast != null ? real - forecast : null
              const fa = calcularFa(real, forecast)

              return (
                <tr key={row.mes} className="border-b border-slate-100 last:border-0">
                  <Td>{row.mes_label}</Td>
                  <Td align="right">{formatNumber(real)}</Td>
                  <Td align="right">{formatNumber(forecast)}</Td>
                  <Td align="right">{formatNumber(row.orcado)}</Td>
                  <Td align="right" className={gapClass(gap)}>
                    {formatSignal(gap)}
                  </Td>
                  <Td align="right">
                    <BadgeFa value={fa} />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaGrupos({ rows }: { rows: LinhaGrupo[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
          Visão por grupo
        </div>
        <h2 className="mt-1 text-lg font-bold text-slate-950">Forecast Accuracy por grupo</h2>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#173b5f] text-white">
            <tr>
              <Th>Grupo</Th>
              <Th align="right">Real</Th>
              <Th align="right">Forecast</Th>
              <Th align="right">WMAPE</Th>
              <Th align="right">FA</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  A visão por grupo será preenchida quando o endpoint retornar o cálculo por SKU/grupo.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.grupo} className="border-b border-slate-100 last:border-0">
                  <Td>{row.grupo}</Td>
                  <Td align="right">{formatNumber(row.real)}</Td>
                  <Td align="right">{formatNumber(row.forecast)}</Td>
                  <Td align="right">{formatPct(row.wmape || 0)}</Td>
                  <Td align="right">
                    <BadgeFa value={row.fa || 0} />
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaSkus({ rows }: { rows: LinhaSku[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-[#173b5f] text-white">
          <tr>
            <Th>Código</Th>
            <Th>Produto</Th>
            <Th>Grupo</Th>
            <Th align="right">Real</Th>
            <Th align="right">Forecast</Th>
            <Th align="right">WMAPE</Th>
            <Th align="right">FA</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                Próximo passo: endpoint analítico com Real e Forecast por SKU/mês para calcular FA no nível SKU.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.cod_produto} className="border-b border-slate-100 last:border-0">
                <Td className="font-mono text-xs">{row.cod_produto}</Td>
                <Td>{row.descricao || "-"}</Td>
                <Td>{row.grupo || "-"}</Td>
                <Td align="right">{formatNumber(row.real)}</Td>
                <Td align="right">{formatNumber(row.forecast)}</Td>
                <Td align="right">{formatPct(row.wmape || 0)}</Td>
                <Td align="right">
                  <BadgeFa value={row.fa || 0} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode
  align?: "left" | "right"
}) {
  return (
    <th className={`px-4 py-3 text-${align} text-xs font-bold uppercase tracking-[0.08em]`}>
      {children}
    </th>
  )
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode
  align?: "left" | "right"
  className?: string
}) {
  return (
    <td className={`px-4 py-3 text-${align} text-slate-700 ${className}`}>
      {children}
    </td>
  )
}

function BadgeFa({ value }: { value: number | null | undefined }) {
  if (value == null || Number.isNaN(value)) {
    return <span className="text-slate-400">-</span>
  }

  const cls =
    value >= 85
      ? "bg-emerald-50 text-emerald-700"
      : value >= 70
        ? "bg-orange-50 text-orange-700"
        : "bg-red-50 text-red-700"

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${cls}`}>
      {formatPct(value)}
    </span>
  )
}

function normalizarMetricasGrupo(row: LinhaGrupo): LinhaGrupo {
  const erroAbs = row.erro_abs ?? Math.abs((row.real || 0) - (row.forecast || 0))
  const wmape = row.wmape ?? ((row.real || 0) > 0 ? (erroAbs / row.real) * 100 : 0)
  const fa = row.fa ?? Math.max(0, 100 - wmape)

  return { ...row, erro_abs: erroAbs, wmape, fa }
}

function normalizarMetricasSku(row: LinhaSku): LinhaSku {
  const erroAbs = row.erro_abs ?? Math.abs((row.real || 0) - (row.forecast || 0))
  const wmape = row.wmape ?? ((row.real || 0) > 0 ? (erroAbs / row.real) * 100 : 0)
  const fa = row.fa ?? Math.max(0, 100 - wmape)

  return { ...row, erro_abs: erroAbs, wmape, fa }
}

function calcularFa(real: number | null | undefined, forecast: number | null | undefined) {
  if (real == null || forecast == null || real <= 0) return null
  const wmape = Math.abs(real - forecast) / real
  return Math.max(0, (1 - wmape) * 100)
}

function gapClass(value: number | null | undefined) {
  if (value == null) return "font-semibold text-slate-400"
  return value >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"
}

function formatNumber(valor: number | null | undefined) {
  if (valor == null || Number.isNaN(valor)) return "-"
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(valor))
}

function formatPct(valor: number | null | undefined) {
  if (valor == null || Number.isNaN(valor)) return "-"
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(valor))}%`
}

function formatSignal(valor: number | null | undefined) {
  if (valor == null || Number.isNaN(valor)) return "-"
  const sinal = valor > 0 ? "+" : ""
  return `${sinal}${formatNumber(valor)}`
}

function labelNumber(value: unknown) {
  if (value == null || value === "") return ""
  const num = Number(value)
  if (Number.isNaN(num) || num === 0) return ""
  return formatNumber(num)
}
