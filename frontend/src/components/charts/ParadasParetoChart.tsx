import { useMemo, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts"
import { ChartLegend } from "@/components/charts/ChartLegend"
import { ChartTooltip } from "@/components/charts/ChartTooltip"
import { useChartLegend } from "@/hooks/useChartLegend"
import { chartTheme } from "@/styles/chartTheme"

export type ParadaParetoItem = {
  motivo: string
  tipo_evento?: string | null
  evento?: string | null
  linha?: "Todas" | "L1" | "L2" | string | null
  horas: number
  ocorrencias: number
  pct_total: number
  pct_acumulado: number
  l1_horas: number
  l2_horas: number
  l1_ocorrencias: number
  l2_ocorrencias: number
}

type Props = {
  data: ParadaParetoItem[]
  dataTipoEvento?: ParadaParetoItem[]
  dataL1?: ParadaParetoItem[]
  dataL2?: ParadaParetoItem[]
}

type AgrupamentoFiltro = "evento" | "tipo_evento"

function fmtHoras(value: number | string) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0))} h`
}

function fmtPct(value: number | string) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0))}%`
}

function fmtNumero(value: number | string) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0))
}

function cortaTexto(value: string, max = 16) {
  if (!value) return ""
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function itemLabel(item: ParadaParetoItem, agrupamento: AgrupamentoFiltro) {
  if (agrupamento === "tipo_evento") {
    return item.tipo_evento || item.motivo || "Sem tipo"
  }

  return item.evento || item.motivo || "Sem evento"
}

function recalcularPareto(items: ParadaParetoItem[]) {
  const sorted = [...items].sort((a, b) => Number(b.horas || 0) - Number(a.horas || 0))
  const total = sorted.reduce((acc, item) => acc + Number(item.horas || 0), 0)

  let acumulado = 0

  return sorted.map((item) => {
    const pctTotal = total > 0 ? (Number(item.horas || 0) / total) * 100 : 0
    acumulado += pctTotal

    return {
      ...item,
      pct_total: pctTotal,
      pct_acumulado: acumulado,
    }
  })
}

function agruparPorTipoEvento(items: ParadaParetoItem[]) {
  const agrupado: Record<string, ParadaParetoItem> = {}

  for (const item of items) {
    const tipo = item.tipo_evento || item.motivo || "Sem tipo"

    if (!agrupado[tipo]) {
      agrupado[tipo] = {
        motivo: tipo,
        tipo_evento: tipo,
        evento: null,
        linha: item.linha,
        horas: 0,
        ocorrencias: 0,
        pct_total: 0,
        pct_acumulado: 0,
        l1_horas: 0,
        l2_horas: 0,
        l1_ocorrencias: 0,
        l2_ocorrencias: 0,
      }
    }

    agrupado[tipo].horas += Number(item.horas || 0)
    agrupado[tipo].ocorrencias += Number(item.ocorrencias || 0)
    agrupado[tipo].l1_horas += Number(item.l1_horas || 0)
    agrupado[tipo].l2_horas += Number(item.l2_horas || 0)
    agrupado[tipo].l1_ocorrencias += Number(item.l1_ocorrencias || 0)
    agrupado[tipo].l2_ocorrencias += Number(item.l2_ocorrencias || 0)
  }

  return Object.values(agrupado)
}

function BotaoFiltro({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-all"
      style={{
        borderColor: active ? chartTheme.blueDark : "var(--border)",
        background: active ? chartTheme.blueDark : "var(--bg-primary)",
        color: active ? "#FFFFFF" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  )
}

function FiltroExclusaoLinha({
  label,
  options,
  excluidos,
  onAdd,
  onRemove,
  onClear,
}: {
  label: string
  options: string[]
  excluidos: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  onClear: () => void
}) {
  const disponiveis = options.filter((item) => !excluidos.includes(item))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span
          className="min-w-[42px] text-xs font-semibold"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </span>

        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value)
          }}
          className="h-10 w-full rounded-lg border px-3 text-xs font-semibold outline-none sm:min-w-[260px]"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Excluir evento...</option>

          {disponiveis.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        {excluidos.length > 0 && (
          <button
            onClick={onClear}
            className="h-10 rounded-lg border px-3 text-xs font-semibold"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-secondary)",
            }}
          >
            Limpar
          </button>
        )}
      </div>

      {excluidos.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-0 sm:pl-[42px]">
          {excluidos.map((item) => (
            <button
              key={item}
              onClick={() => onRemove(item)}
              className="rounded-full border px-3 py-1 text-[11px] font-semibold"
              style={{
                borderColor: "#FCA5A5",
                background: "#FEF2F2",
                color: chartTheme.red,
              }}
              title="Clique para remover o filtro"
            >
              {cortaTexto(item, 26)} ×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LabelHoras = (props: any) => {
  const { x, y, width, value } = props

  if (!value || Number(value) <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fontSize={9}
      fontWeight={700}
      fill={chartTheme.textStrong}
    >
      {fmtHoras(value)}
    </text>
  )
}

const LabelPct = (props: any) => {
  const { x, y, value } = props

  if (!value || Number(value) <= 0) return null

  return (
    <text
      x={x}
      y={y - 10}
      textAnchor="middle"
      fontSize={9}
      fontWeight={800}
      fill={chartTheme.blue}
    >
      {fmtPct(value)}
    </text>
  )
}

function ParetoResumoCards({ data }: { data: ParadaParetoItem[] }) {
  const totalHoras = data.reduce((acc, item) => acc + Number(item.horas || 0), 0)
  const totalOcorrencias = data.reduce((acc, item) => acc + Number(item.ocorrencias || 0), 0)
  const maiorMotivo = data[0]

  const top3Horas = data
    .slice(0, 3)
    .reduce((acc, item) => acc + Number(item.horas || 0), 0)

  const top3Pct = totalHoras > 0 ? (top3Horas / totalHoras) * 100 : 0

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      <div
        className="rounded-xl border px-3 py-3 md:px-4"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-primary)",
        }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-widest md:text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Horas paradas
        </p>

        <p className="mt-1 text-base font-bold md:text-xl" style={{ color: "var(--text-primary)" }}>
          {fmtHoras(totalHoras)}
        </p>
      </div>

      <div
        className="rounded-xl border px-3 py-3 md:px-4"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-primary)",
        }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-widest md:text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Ocorrências
        </p>

        <p className="mt-1 text-base font-bold md:text-xl" style={{ color: "var(--text-primary)" }}>
          {fmtNumero(totalOcorrencias)}
        </p>
      </div>

      <div
        className="rounded-xl border px-3 py-3 md:px-4"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-primary)",
        }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-widest md:text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Top 3
        </p>

        <p className="mt-1 text-base font-bold md:text-xl" style={{ color: chartTheme.blueDark }}>
          {fmtPct(top3Pct)}
        </p>
      </div>

      <div
        className="rounded-xl border px-3 py-3 md:px-4"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-primary)",
        }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-widest md:text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Maior perda
        </p>

        <p
          className="mt-1 truncate text-base font-bold md:text-xl"
          style={{ color: "var(--text-primary)" }}
          title={maiorMotivo?.motivo || "-"}
        >
          {maiorMotivo?.motivo || "-"}
        </p>
      </div>
    </div>
  )
}

function ParetoLinha({
  titulo,
  subtitulo,
  data,
  isVisible,
  agrupamento,
}: {
  titulo: string
  subtitulo: string
  data: ParadaParetoItem[]
  isVisible: (key: string) => boolean
  agrupamento: AgrupamentoFiltro
}) {
  const topData = data.slice(0, 8)

  const chartData = topData.map((item) => ({
    ...item,
    motivo_curto: cortaTexto(itemLabel(item, agrupamento)),
  }))

  return (
    <div
      className="rounded-2xl border p-4 md:p-5"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-secondary)",
      }}
    >
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-bold md:text-base" style={{ color: "var(--text-primary)" }}>
            {titulo}
          </h3>

          <p className="text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
            {subtitulo}
          </p>
        </div>

        <span
          className="w-fit rounded-full border px-3 py-1 text-[10px] font-semibold md:text-[11px]"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            background: "var(--bg-primary)",
          }}
        >
          Regra: maior duração do dia
        </span>
      </div>

      <div className="mb-4">
        <ParetoResumoCards data={data} />
      </div>

      {chartData.length === 0 ? (
        <div
          className="rounded-xl border p-6 text-sm md:p-8"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            background: "var(--bg-primary)",
          }}
        >
          Nenhuma parada encontrada para o filtro selecionado.
        </div>
      ) : (
        <div className="h-[300px] md:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 32, right: 20, left: 0, bottom: 22 }}
              barCategoryGap={20}
            >
              <CartesianGrid
                stroke={chartTheme.grid}
                strokeDasharray="2 6"
                strokeOpacity={0.55}
                vertical={false}
              />

              <XAxis
                dataKey="motivo_curto"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fontSize: 9, fill: chartTheme.textStrong }}
              />

              <YAxis
                yAxisId="horas"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: chartTheme.text }}
                tickFormatter={(value) => fmtHoras(Number(value)).replace(" h", "")}
                width={54}
              />

              <YAxis
                yAxisId="pct"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: chartTheme.text }}
                tickFormatter={(value) => `${value}%`}
                domain={[0, 100]}
                width={38}
              />

              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(value, name) => {
                      if (name === "Horas paradas") return fmtHoras(value)
                      if (name === "% acumulado") return fmtPct(value)
                      return String(value)
                    }}
                  />
                }
              />

              {isVisible("horas") && (
                <Bar
                  yAxisId="horas"
                  dataKey="horas"
                  name="Horas paradas"
                  fill={chartTheme.blueDark}
                  radius={[8, 8, 0, 0]}
                  barSize={26}
                  isAnimationActive={false}
                >
                  <LabelList content={LabelHoras} />
                </Bar>
              )}

              {isVisible("pct_acumulado") && (
                <Line
                  yAxisId="pct"
                  dataKey="pct_acumulado"
                  name="% acumulado"
                  type="monotone"
                  stroke={chartTheme.blue}
                  strokeWidth={2.2}
                  dot={{
                    r: 3,
                    fill: chartTheme.blue,
                    stroke: chartTheme.blue,
                  }}
                  activeDot={{
                    r: 5,
                    fill: chartTheme.blueDark,
                    stroke: chartTheme.blueDark,
                  }}
                  isAnimationActive={false}
                >
                  <LabelList content={LabelPct} />
                </Line>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function ParadasParetoChart({
  data,
  dataTipoEvento = [],
  dataL1 = [],
  dataL2 = [],
}: Props) {
  const [agrupamento, setAgrupamento] = useState<AgrupamentoFiltro>("evento")
  const [excluidosL1, setExcluidosL1] = useState<string[]>([])
  const [excluidosL2, setExcluidosL2] = useState<string[]>([])

  const { hiddenKeys, toggleKey, isVisible } = useChartLegend([
    "horas",
    "pct_acumulado",
  ])

  const baseL1 = useMemo(() => {
    return agrupamento === "tipo_evento" ? agruparPorTipoEvento(dataL1) : dataL1
  }, [agrupamento, dataL1])

  const baseL2 = useMemo(() => {
    return agrupamento === "tipo_evento" ? agruparPorTipoEvento(dataL2) : dataL2
  }, [agrupamento, dataL2])

  const opcoesL1 = useMemo(() => {
    return recalcularPareto(baseL1).map((item) => itemLabel(item, agrupamento))
  }, [baseL1, agrupamento])

  const opcoesL2 = useMemo(() => {
    return recalcularPareto(baseL2).map((item) => itemLabel(item, agrupamento))
  }, [baseL2, agrupamento])

  const paretoL1 = useMemo(() => {
    return recalcularPareto(
      baseL1.filter((item) => !excluidosL1.includes(itemLabel(item, agrupamento)))
    )
  }, [baseL1, excluidosL1, agrupamento])

  const paretoL2 = useMemo(() => {
    return recalcularPareto(
      baseL2.filter((item) => !excluidosL2.includes(itemLabel(item, agrupamento)))
    )
  }, [baseL2, excluidosL2, agrupamento])

  function addExcluidoL1(value: string) {
    setExcluidosL1((prev) => (prev.includes(value) ? prev : [...prev, value]))
  }

  function addExcluidoL2(value: string) {
    setExcluidosL2((prev) => (prev.includes(value) ? prev : [...prev, value]))
  }

  return (
    <div className="card p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="card-label mb-1">Performance operacional</p>

          <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
            Pareto de paradas por linha
          </h2>

          <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            L1 e L2 em blocos separados, com filtros independentes por linha.
          </p>
        </div>

        <ChartLegend
          items={[
            {
              key: "horas",
              label: "Horas paradas",
              color: chartTheme.blueDark,
            },
            {
              key: "pct_acumulado",
              label: "% acumulado",
              color: chartTheme.blue,
            },
          ]}
          hiddenKeys={hiddenKeys}
          onToggle={toggleKey}
        />
      </div>

      <div
        className="mb-5 flex flex-col gap-4 rounded-2xl border p-3 md:p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Agrupar por
          </span>

          <BotaoFiltro
            active={agrupamento === "evento"}
            onClick={() => {
              setAgrupamento("evento")
              setExcluidosL1([])
              setExcluidosL2([])
            }}
          >
            Evento
          </BotaoFiltro>

          <BotaoFiltro
            active={agrupamento === "tipo_evento"}
            onClick={() => {
              setAgrupamento("tipo_evento")
              setExcluidosL1([])
              setExcluidosL2([])
            }}
          >
            Tipo de evento
          </BotaoFiltro>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <FiltroExclusaoLinha
            label="L1"
            options={opcoesL1}
            excluidos={excluidosL1}
            onAdd={addExcluidoL1}
            onRemove={(value) => setExcluidosL1((prev) => prev.filter((item) => item !== value))}
            onClear={() => setExcluidosL1([])}
          />

          <FiltroExclusaoLinha
            label="L2"
            options={opcoesL2}
            excluidos={excluidosL2}
            onAdd={addExcluidoL2}
            onRemove={(value) => setExcluidosL2((prev) => prev.filter((item) => item !== value))}
            onClear={() => setExcluidosL2([])}
          />
        </div>
      </div>

      <div className="space-y-5">
        <ParetoLinha
          titulo="L1 — Linha 1"
          subtitulo="Base pela maior duração entre equipamentos paralelos da L1 no mesmo dia/evento."
          data={paretoL1}
          isVisible={isVisible}
          agrupamento={agrupamento}
        />

        <ParetoLinha
          titulo="L2 — Linha 2"
          subtitulo="Base pela maior duração entre equipamentos paralelos da L2 no mesmo dia/evento."
          data={paretoL2}
          isVisible={isVisible}
          agrupamento={agrupamento}
        />
      </div>

      <div
        className="mt-5 rounded-xl border px-4 py-3 text-xs leading-5"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-primary)",
          color: "var(--text-secondary)",
        }}
      >
        Horas calculadas pela maior duração entre equipamentos da linha no mesmo dia para o mesmo tipo de evento e evento.
      </div>
    </div>
  )
}
