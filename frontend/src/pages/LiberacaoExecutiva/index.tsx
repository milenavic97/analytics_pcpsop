import { useEffect, useState } from "react"
import type { ChangeEvent, ElementType, MouseEvent } from "react"
import {
  Boxes,
  CalendarDays,
  PackageCheck,
  Target,
  TrendingDown,
  X,
} from "lucide-react"

const API_BASE = String(
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "https://dfl-sop-api.fly.dev",
).replace(/\/$/, "")

function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n || 0)))
}

function fmtPct(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(n || 0))
}

function fmtTubetes(cx: number) {
  return `${fmt(Number(cx || 0) * 500)} tubetes`
}

function fmtLotesQtd(lotes?: number) {
  if (lotes == null || Number.isNaN(Number(lotes))) return ""
  const valor = Math.round(Math.abs(Number(lotes || 0)))
  return `${fmt(valor)} ${valor === 1 ? "lote" : "lotes"}`
}

type Tone = "blue" | "navy" | "purple" | "teal" | "red" | "orange" | "gray" | "green" | "slate"

type KpiCardProps = {
  title: string
  value: string
  sub: string
  tone: Tone
  icon: ElementType
}

type MixLote = {
  lote: string
  produto: string
  caixas: number
}

type ReorganizacaoItem = {
  id: string
  tipo: "ganho" | "perda"
  categoria: string
  descricao: string
  caixas: number
  plano1Resumo: string
  planoAtualResumo: string
  horasAntes?: number
  horasDepois?: number
  horasImpacto?: number
  lotesAntes?: MixLote[]
  lotesDepois?: MixLote[]
}

type WaterfallStep =
  | {
      id: string
      label: string
      kind: "total"
      value: number
      tone: Tone
      lotes?: number
    }
  | {
      id: string
      label: string
      kind: "delta"
      value: number
      tone: Tone
      clickable?: boolean
      lotes?: number
    }

type MonthlyLossesItem = {
  mes: string
  baseline: string
  v1: number
  reorg: number
  atraso: number
  reprovacao: number
  status?: "fechado" | "mtd" | "futuro"
  simulado?: boolean
}

type SimulationMode = "media" | "custom"

type LiberacaoExecutivaPayload = {
  atualizadoLabel?: string
  atualizado_label?: string
  dados?: Partial<{
    orcadoFaturamentoCx: number
    plano1LiberacaoCx: number
    planoAtualLiberacaoCx: number
    estoqueInicialJanCx: number
    reorganizacaoPlanoCx: number
    atrasoProducaoCx: number
    perdaReprovacaoCx: number
    perdaRendimentoCx: number
    ganhoRendimentoCx: number
  }>
  waterfallSteps?: WaterfallStep[]
  perdasMensais?: MonthlyLossesItem[]
  ponteVersoesSteps?: WaterfallStep[]
  itensReorganizacao?: ReorganizacaoItem[]
}

function getToneStyles(tone: Tone) {
  const tones = {
    blue: {
      iconBg: "#EEF4FF",
      iconColor: "#2563EB",
      valueColor: "#1D4ED8",
      barColor: "#2563EB",
    },
    navy: {
      iconBg: "#EAF1F8",
      iconColor: "#1F4164",
      valueColor: "#1F4164",
      barColor: "#1F4164",
    },
    purple: {
      iconBg: "#F3E8FF",
      iconColor: "#7C3AED",
      valueColor: "#7C3AED",
      barColor: "#7C3AED",
    },
    teal: {
      iconBg: "#E6FFFB",
      iconColor: "#0F766E",
      valueColor: "#0F766E",
      barColor: "#0F766E",
    },
    red: {
      iconBg: "#FEF2F2",
      iconColor: "#DC2626",
      valueColor: "#DC2626",
      barColor: "#DC2626",
    },
    orange: {
      iconBg: "#FFF7ED",
      iconColor: "#C2410C",
      valueColor: "#C2410C",
      barColor: "#C2410C",
    },
    gray: {
      iconBg: "#F3F4F6",
      iconColor: "#64748B",
      valueColor: "#475569",
      barColor: "#64748B",
    },
    green: {
      iconBg: "#ECFDF5",
      iconColor: "#16A34A",
      valueColor: "#16A34A",
      barColor: "#16A34A",
    },
    slate: {
      iconBg: "#F1F5F9",
      iconColor: "#334155",
      valueColor: "#334155",
      barColor: "#334155",
    },
  }

  return tones[tone]
}

function KpiCard({ title, value, sub, tone, icon: Icon }: KpiCardProps) {
  const styles = getToneStyles(tone)

  return (
    <div
      className="h-[92px] rounded-xl border bg-white px-3.5 py-3 shadow-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p
          className="truncate text-[8.5px] font-black uppercase tracking-[0.15em]"
          style={{ color: "var(--text-secondary)" }}
          title={title}
        >
          {title}
        </p>

        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: styles.iconBg,
            color: styles.iconColor,
          }}
        >
          <Icon size={13.5} />
        </div>
      </div>

      <p className="text-[17px] font-black leading-none" style={{ color: styles.valueColor }}>
        {value}
      </p>

      <p className="mt-1 truncate text-[10px] font-medium" style={{ color: "var(--text-secondary)" }} title={sub}>
        {sub}
      </p>
    </div>
  )
}

function GaugeCard({
  pct,
  sub,
}: {
  pct: number
  sub: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const color = pct >= 98 ? "#16A34A" : pct >= 95 ? "#F59E0B" : "#DC2626"

  return (
    <div
      className="h-[92px] rounded-xl border bg-white px-3.5 py-3 shadow-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex h-full items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className="truncate text-[8.5px] font-black uppercase tracking-[0.15em]"
            style={{ color: "var(--text-secondary)" }}
          >
            % atingimento ao orçado
          </p>

          <p className="mt-2 text-[20px] font-black leading-none" style={{ color }}>
            {fmtPct(pct)}%
          </p>

          <p className="mt-1 truncate text-[10px] font-medium" style={{ color: "var(--text-secondary)" }} title={sub}>
            {sub}
          </p>
        </div>

        <div className="relative h-[70px] w-[86px] shrink-0">
          <svg viewBox="0 0 160 105" className="h-[70px] w-[86px]">
            <path
              d="M 24 82 A 56 56 0 0 1 136 82"
              pathLength={100}
              fill="none"
              stroke="#E5E7EB"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M 24 82 A 56 56 0 0 1 136 82"
              pathLength={100}
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${clamped} ${100 - clamped}`}
            />
            <circle cx="80" cy="82" r="4.5" fill={color} />
            <line
              x1="80"
              y1="82"
              x2={80 + 42 * Math.cos(Math.PI - (Math.PI * clamped) / 100)}
              y2={82 - 42 * Math.sin(Math.PI - (Math.PI * clamped) / 100)}
              stroke={color}
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>

        </div>
      </div>
    </div>
  )
}

function MiniResumo({
  label,
  value,
  sub,
  color,
  bg,
}: {
  label: string
  value: string
  sub: string
  color: string
  bg: string
}) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: bg }}>
      <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-black" style={{ color }}>
        {value}
      </p>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {sub}
      </p>
    </div>
  )
}

function formatarLotes(lotes?: MixLote[]) {
  if (!lotes || lotes.length === 0) return "—"

  return lotes
    .map((item) => `${item.lote} (${item.produto}) · ${fmt(item.caixas)} cx`)
    .join("\n")
}

function totalLotes(lotes?: MixLote[]) {
  return (lotes || []).reduce((acc, item) => acc + item.caixas, 0)
}

function topRoundedRectPath(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ')
}

function WaterfallChart({
  steps,
  orcadoFaturamentoCx: _orcadoFaturamentoCx,
  onClickReorganizacao,
}: {
  steps: WaterfallStep[]
  orcadoFaturamentoCx: number
  onClickReorganizacao: () => void
}) {
  const width = 1080
  const height = 236
  const margin = { top: 30, right: 34, bottom: 54, left: 74 }
  const plotHeight = 134
  const plotWidth = width - margin.left - margin.right

  const totalBarWidth = 36
  const stepWidth = 28
  const minDeltaVisualHeight = 1.2

  type ProcessedWaterfallStep = WaterfallStep & {
    index: number
    before: number
    after: number
    displayValue: number
  }

  let running = 0

  const bars: ProcessedWaterfallStep[] = steps.map((step, index) => {
    if (step.kind === "total") {
      const after = Number(step.value || 0)
      running = after

      return {
        ...step,
        index,
        before: 0,
        after,
        displayValue: after,
      }
    }

    const before = running
    const delta = Number(step.value || 0)
    const after = running + delta
    running = after

    return {
      ...step,
      index,
      before,
      after,
      displayValue: delta,
    }
  })

  const maxLevel = Math.max(
    ...bars.flatMap((bar) => [bar.before, bar.after]),
    _orcadoFaturamentoCx,
    1,
  )

  const maxValue = Math.ceil((maxLevel * 1.06) / 5000) * 5000
  const y = (value: number) => margin.top + ((maxValue - value) / maxValue) * plotHeight
  const baselineY = y(0)

  const x = (index: number) =>
    margin.left + (index * plotWidth) / Math.max(bars.length - 1, 1)

  const getConnectorTargetX = (index: number) => {
    const next = bars[index + 1]
    if (!next) return x(index)

    return x(index + 1) - (next.kind === "total" ? totalBarWidth : stepWidth) / 2
  }

  return (
    <div className="overflow-x-auto px-4 pb-4 pt-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[1080px]">
        <rect x="0" y="0" width={width} height={height} rx="18" fill="#FFFFFF" />

        {bars.map((bar, index) => {
          const isTotal = bar.kind === "total"
          const isPositiveDelta = !isTotal && bar.displayValue > 0
          const isNegativeDelta = !isTotal && bar.displayValue < 0
          const styles = getToneStyles(bar.tone)

          const next = bars[index + 1]
          const currentX = x(index)
          const valueLabel = isTotal
            ? `${fmt(bar.after)} cx`
            : `${isPositiveDelta ? "+" : "-"}${fmt(Math.abs(bar.displayValue))} cx`

          if (isTotal) {
            const yTop = y(bar.after)
            const barHeight = baselineY - yTop
            const xx = currentX - totalBarWidth / 2
            const connectorY = yTop
            const connectorX1 = currentX + totalBarWidth / 2
            const connectorX2 = getConnectorTargetX(index)

            return (
              <g key={bar.id}>
                <path
                  d={topRoundedRectPath(xx, yTop, totalBarWidth, barHeight, 4)}
                  fill={styles.barColor}
                  opacity="0.92"
                />

                {next && (
                  <line
                    x1={connectorX1}
                    x2={connectorX2}
                    y1={connectorY}
                    y2={connectorY}
                    stroke="#CBD5E1"
                    strokeWidth="1.4"
                    strokeDasharray="4 5"
                  />
                )}

                {bar.lotes != null && (
                  <text
                    x={currentX}
                    y={yTop - 18}
                    textAnchor="middle"
                    fontSize="8"
                    fontWeight="700"
                    fill="#64748B"
                  >
                    {fmtLotesQtd(bar.lotes)}
                  </text>
                )}

                <text
                  x={currentX}
                  y={yTop - 7}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="900"
                  fill={styles.valueColor}
                >
                  {valueLabel}
                </text>

                <text
                  x={currentX}
                  y={height - 19}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="900"
                  fill="#0F172A"
                >
                  {bar.label}
                </text>
              </g>
            )
          }

          const beforeY = y(bar.before)
          const afterY = y(bar.after)
          const rawDeltaHeight = Math.abs(beforeY - afterY)
          const deltaHeight = Math.max(minDeltaVisualHeight, rawDeltaHeight)
          const top =
            rawDeltaHeight < minDeltaVisualHeight
              ? (beforeY + afterY) / 2 - deltaHeight / 2
              : Math.min(beforeY, afterY)

          const xx = currentX - stepWidth / 2
          const connectorX1 = currentX + stepWidth / 2
          const connectorX2 = getConnectorTargetX(index)

          return (
            <g
              key={bar.id}
              onClick={bar.id.startsWith("reorganizacao") ? onClickReorganizacao : undefined}
              style={{ cursor: bar.id.startsWith("reorganizacao") ? "pointer" : "default" }}
            >
              <line
                x1={currentX}
                x2={currentX}
                y1={beforeY}
                y2={afterY}
                stroke={styles.barColor}
                strokeWidth="1.1"
                strokeDasharray="3 4"
                opacity="0.18"
              />

              <path
                d={topRoundedRectPath(xx, top, stepWidth, deltaHeight, 2.5)}
                fill={styles.barColor}
                opacity="0.96"
              />

              {next && (
                <line
                  x1={connectorX1}
                  x2={connectorX2}
                  y1={afterY}
                  y2={afterY}
                  stroke="#CBD5E1"
                  strokeWidth="1.4"
                  strokeDasharray="4 5"
                />
              )}

              {bar.lotes != null && (
                <text
                  x={currentX}
                  y={isNegativeDelta ? top + deltaHeight + 13 : top - 4}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="700"
                  fill="#64748B"
                >
                  {fmtLotesQtd(bar.lotes)}
                </text>
              )}

              <text
                x={currentX}
                y={isNegativeDelta ? top + deltaHeight + 25 : top - 15}
                textAnchor="middle"
                fontSize="9.5"
                fontWeight="900"
                fill={
                  isPositiveDelta
                    ? "#16A34A"
                    : isNegativeDelta
                      ? "#DC2626"
                      : styles.valueColor
                }
              >
                {valueLabel}
              </text>

              <text
                x={currentX}
                y={height - 19}
                textAnchor="middle"
                fontSize="9.5"
                fontWeight="900"
                fill="#0F172A"
              >
                {bar.label}
              </text>

              {bar.id.startsWith("reorganizacao") && (
                <text
                  x={currentX}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="700"
                  fill="#64748B"
                >
                  clique para detalhar
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}


function MonthlyLossesStackedChart({
  data,
  onOpenSimulator,
  simulacaoAtiva,
}: {
  data: MonthlyLossesItem[]
  onOpenSimulator: () => void
  simulacaoAtiva: boolean
}) {
  const width = 1080
  const height = 248
  const margin = { top: 24, right: 34, bottom: 42, left: 46 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = 160
  const barWidth = 62

  const causas = [
    { key: "atraso", label: "Atraso prod.", color: "#2F3E7A", subColor: "#E5ECFF" },
    { key: "reorg", label: "Reorg.", color: "#6B7FC8", subColor: "#F0F3FF" },
    { key: "reprovacao", label: "Reprov. prod.", color: "#E46A1A", subColor: "#FFF1E8" },
  ] as const

  const totals = data.map((item) => item.reorg + item.atraso + item.reprovacao)
  const maxTotal = Math.max(...totals, 1)
  const maxValue = Math.ceil((maxTotal * 1.22) / 1000) * 1000

  const y = (value: number) => margin.top + ((maxValue - value) / maxValue) * plotHeight
  const baselineY = y(0)

  const x = (index: number) =>
    margin.left + (index * plotWidth) / Math.max(data.length - 1, 1)

  return (
    <section
      className="rounded-2xl border bg-white px-4 pb-4 pt-4 shadow-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="w-[140px]" />

        <div className="flex-1 px-1 text-center">
          <p
            className="text-[12px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--text-secondary)" }}
          >
            Causas das perdas mensais
          </p>

          {simulacaoAtiva && (
            <p className="mt-1 text-[10.5px] font-semibold" style={{ color: "#64748B" }}>
              Simulação aplicada nos meses futuros
            </p>
          )}
        </div>

        <div className="flex w-[140px] justify-end">
          <button
            type="button"
            onClick={onOpenSimulator}
            className="rounded-xl border bg-white px-3 py-1.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Simulador de perdas
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[1080px]">
          <rect x="0" y="0" width={width} height={height} rx="16" fill="#FFFFFF" />

          {data.map((item, index) => {
            const total = item.reorg + item.atraso + item.reprovacao
            const hasLoss = total > 0
            const currentX = x(index)
            const clipId = `monthly-loss-stack-${index}`
            let acumulado = 0

            return (
              <g key={item.mes}>
                {hasLoss && (
                  <defs>
                    <clipPath id={clipId}>
                      <rect
                        x={currentX - barWidth / 2}
                        y={y(total)}
                        width={barWidth}
                        height={baselineY - y(total)}
                        rx={6}
                      />
                    </clipPath>
                  </defs>
                )}

                {hasLoss && (
                  <g clipPath={`url(#${clipId})`}>
                    {causas.map((causa) => {
                      const value = item[causa.key]

                      if (value <= 0) return null

                      const yTop = y(acumulado + value)
                      const yBottom = y(acumulado)
                      const segmentHeight = Math.max(0, yBottom - yTop)
                      const pctVsV1 = item.v1 > 0 ? (value / item.v1) * 100 : 0
                      const labelY = yTop + segmentHeight / 2
                      const showFullLabel = !item.simulado && segmentHeight >= 26
                      const showCompactLabel = !item.simulado && segmentHeight >= 11 && segmentHeight < 26

                      acumulado += value

                      return (
                        <g key={causa.key}>
                          <rect
                            x={currentX - barWidth / 2}
                            y={yTop}
                            width={barWidth}
                            height={segmentHeight}
                            fill={causa.color}
                            opacity={item.simulado ? 0.16 : 0.98}
                            stroke={item.simulado ? causa.color : "none"}
                            strokeWidth={item.simulado ? 1.4 : 0}
                            strokeDasharray={item.simulado ? "4 3" : undefined}
                          />

                          {showFullLabel && (
                            <>
                              <text
                                x={currentX}
                                y={labelY - 3}
                                textAnchor="middle"
                                fontSize="6.7"
                                fontWeight="900"
                                fill="#FFFFFF"
                              >
                                {fmt(value)} cx
                              </text>
                              <text
                                x={currentX}
                                y={labelY + 8}
                                textAnchor="middle"
                                fontSize="6.4"
                                fontWeight="800"
                                fill={causa.subColor}
                              >
                                {`${fmtPct(pctVsV1)}% V1`}
                              </text>
                            </>
                          )}

                          {showCompactLabel && (
                            <text
                              x={currentX}
                              y={labelY + 2}
                              textAnchor="middle"
                              fontSize="5.8"
                              fontWeight="900"
                              fill="#FFFFFF"
                            >
                              {`${fmt(value)} · ${fmtPct(pctVsV1)}%`}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                )}

                {hasLoss && (
                  <>
                    <text
                      x={currentX}
                      y={Math.max(18, y(total) - 16)}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="900"
                      fill="#0F172A"
                    >
                      {fmt(total)} cx
                    </text>

                    <text
                      x={currentX}
                      y={Math.max(28, y(total) - 4)}
                      textAnchor="middle"
                      fontSize="7.2"
                      fontWeight="800"
                      fill="#64748B"
                    >
                      {`${fmtPct(item.v1 > 0 ? (total / item.v1) * 100 : 0)}% da V1`}
                    </text>

                    {item.simulado && (
                      <text
                        x={currentX}
                        y={Math.max(40, y(total) + 8)}
                        textAnchor="middle"
                        fontSize="6.8"
                        fontWeight="800"
                        fill="#64748B"
                      >
                        simulado
                      </text>
                    )}
                  </>
                )}

                <text
                  x={currentX}
                  y={baselineY + 22}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="900"
                  fill="#0F172A"
                >
                  {item.mes}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-4">
        {causas.map((causa) => (
          <div key={causa.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: causa.color }} />
            <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
              {causa.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function VersionBridgeSection({
  steps,
  onClickReorganizacao,
}: {
  steps: WaterfallStep[]
  onClickReorganizacao: () => void
}) {
  const primeiro = steps[0]
  const ultimo = steps[steps.length - 1]
  const baseAnteriorCx = Number(primeiro?.value || 0)
  const versaoAtualCx = Number(ultimo?.value || 0)
  const variacaoCx = versaoAtualCx - baseAnteriorCx
  const lotesImpactados = steps
    .filter((step) => step.kind === "delta")
    .reduce((acc, step) => acc + Math.abs(Number(step.lotes || 0)), 0)

  const causas = steps.filter((step) => step.kind === "delta")

  return (
    <section
      className="rounded-2xl border bg-white shadow-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div className="text-center">
          <p
            className="text-[12px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--text-secondary)" }}
          >
            Variação entre versões - mês atual
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px bg-slate-100 md:grid-cols-4">
        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
            Disponibilidade V1
          </p>
          <p className="mt-1 text-xl font-black" style={{ color: "#1F4164" }}>
            {fmt(baseAnteriorCx)} cx
          </p>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            V1
          </p>
        </div>

        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
            Disponibilidade atual
          </p>
          <p className="mt-1 text-xl font-black" style={{ color: "#0F766E" }}>
            {fmt(versaoAtualCx)} cx
          </p>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            V3 atual
          </p>
        </div>

        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
            Variação
          </p>
          <p className="mt-1 text-xl font-black" style={{ color: variacaoCx >= 0 ? "#16A34A" : "#DC2626" }}>
            {variacaoCx >= 0 ? "+" : "-"}{fmt(Math.abs(variacaoCx))} cx
          </p>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {variacaoCx >= 0 ? "+" : "-"}{fmtTubetes(Math.abs(variacaoCx))}
          </p>
        </div>

        <div className="bg-white px-5 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
            Lotes impactados
          </p>
          <p className="mt-1 text-xl font-black" style={{ color: "#334155" }}>
            {fmt(lotesImpactados)}
          </p>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            entre V1 e V3
          </p>
        </div>
      </div>

      <div className="px-1 pt-2">
        <WaterfallChart
          steps={steps}
          orcadoFaturamentoCx={0}
          onClickReorganizacao={onClickReorganizacao}
        />
      </div>

      <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p
            className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color: "var(--text-secondary)" }}
          >
            Abertura das mudanças
          </p>

          <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            Clique em Reorg. para ver a abertura de parada/mix
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead style={{ background: "#F8FAFC", color: "var(--text-secondary)" }}>
              <tr>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wider">
                  Causa
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-wider">
                  Impacto
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-wider">
                  Lotes
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wider">
                  Leitura
                </th>
              </tr>
            </thead>

            <tbody>
              {causas.map((step) => {
                const positivo = step.value >= 0
                const styles = getToneStyles(step.tone)

                const leitura =
                  step.id.startsWith("reorganizacao")
                    ? "Mudança planejada de calendário, parada ou mix."
                    : step.id === "atraso"
                      ? "Lotes postergados ou retirados da janela da versão."
                      : step.id === "reprovacao"
                        ? "Lotes com destino reprovado/descartado vinculados ao Gantt."
                        : step.id === "rendimento"
                          ? "Diferença entre previsto do lote e liberação real."
                          : step.id === "ganho"
                            ? "Liberação acima do previsto ajustado."
                            : "Variação entre versões."

                return (
                  <tr key={step.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={step.id.startsWith("reorganizacao") ? onClickReorganizacao : undefined}
                        className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-left transition hover:bg-slate-50"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: styles.barColor }} />
                        <span className="font-black">{step.label}</span>
                      </button>
                    </td>

                    <td className="px-3 py-2.5 text-right font-black" style={{ color: positivo ? "#16A34A" : "#DC2626" }}>
                      {positivo ? "+" : "-"}{fmt(Math.abs(step.value))} cx
                    </td>

                    <td className="px-3 py-2.5 text-right font-bold" style={{ color: "var(--text-secondary)" }}>
                      {step.lotes != null ? fmtLotesQtd(step.lotes) : "—"}
                    </td>

                    <td className="px-3 py-2.5 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      {leitura}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}


function LossSimulationModal({
  open,
  onClose,
  futureMonths,
  averageLossPct,
  orcadoCx,
  disponibilidadeAtualCx,
  mode,
  setMode,
  averagePctInput,
  setAveragePctInput,
  customLosses,
  setCustomLosses,
  onApply,
  onClear,
}: {
  open: boolean
  onClose: () => void
  futureMonths: MonthlyLossesItem[]
  averageLossPct: number
  orcadoCx: number
  disponibilidadeAtualCx: number
  mode: SimulationMode
  setMode: (value: SimulationMode) => void
  averagePctInput: number
  setAveragePctInput: (value: number) => void
  customLosses: Record<string, number>
  setCustomLosses: (value: Record<string, number>) => void
  onApply: () => void
  onClear: () => void
}) {
  if (!open) return null

  const distribuirIgualmente = (totalCx: number) => {
    const totalSeguro = Math.max(0, Math.round(Number(totalCx || 0)))
    const qtdMeses = Math.max(futureMonths.length, 1)
    const base = Math.floor(totalSeguro / qtdMeses)
    const sobra = totalSeguro - base * qtdMeses

    setCustomLosses(
      Object.fromEntries(
        futureMonths.map((month, index) => [
          month.mes,
          base + (index === futureMonths.length - 1 ? sobra : 0),
        ]),
      ),
    )
  }

  const repetirMediaAtualPorMes = () => {
    setCustomLosses(
      Object.fromEntries(
        futureMonths.map((month) => [
          month.mes,
          Math.max(0, Math.round(month.v1 * (averageLossPct / 100))),
        ]),
      ),
    )
  }

  const zerarMeses = () => {
    setCustomLosses(Object.fromEntries(futureMonths.map((month) => [month.mes, 0])))
  }

  const projectedLosses = futureMonths.map((month) => {
    const perdaCx =
      mode === "media"
        ? Math.max(0, Math.round(month.v1 * (Number(averagePctInput || 0) / 100)))
        : Math.max(0, Number(customLosses[month.mes] || 0))

    return {
      ...month,
      perdaCx,
      disponibilidadeProjetadaCx: Math.max(0, month.v1 - perdaCx),
    }
  })

  const perdaProjetadaTotalCx = projectedLosses.reduce((acc, month) => acc + month.perdaCx, 0)
  const disponibilidadeSimuladaCx = Math.max(0, disponibilidadeAtualCx - perdaProjetadaTotalCx)
  const atingimentoAtual = orcadoCx > 0 ? (disponibilidadeAtualCx / orcadoCx) * 100 : 0
  const atingimentoSimulado = orcadoCx > 0 ? (disponibilidadeSimuladaCx / orcadoCx) * 100 : 0
  const maxPlanoMes = Math.max(...projectedLosses.map((month) => month.v1), 1)
  const maxValue = Math.ceil((maxPlanoMes * 1.12) / 1000) * 1000
  const perdaCustomTotalCx = futureMonths.reduce((acc, month) => acc + Math.max(0, Number(customLosses[month.mes] || 0)), 0)

  const chartWidth = 980
  const chartHeight = 278
  const margin = { top: 38, right: 28, bottom: 54, left: 40 }
  const plotWidth = chartWidth - margin.left - margin.right
  const plotHeight = 160
  const baselineY = margin.top + plotHeight
  const groupWidth = 58
  const singleBarWidth = 22
  const gapBetweenBars = 10

  const y = (value: number) =>
    margin.top + ((maxValue - value) / maxValue) * plotHeight

  const x = (index: number) =>
    margin.left + (index * plotWidth) / Math.max(projectedLosses.length - 1, 1)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Simulador de perdas
            </p>
            <h3 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>
              Projeção de disponibilidade até o fim do ano
            </h3>
            <p className="mt-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Aplica perdas simuladas nos meses futuros e recalcula a disponibilidade mensal contra o plano mais atual do Gantt/MPS.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border p-2 transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                Disponibilidade atual
              </p>
              <p className="mt-2 text-xl font-black" style={{ color: "#0F766E" }}>
                {fmt(disponibilidadeAtualCx)} cx
              </p>
              <p className="mt-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                antes da simulação
              </p>
            </div>

            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#EEF4FF" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                Projeção
              </p>
              <p className="mt-2 text-xl font-black" style={{ color: "#1F4164" }}>
                {fmt(disponibilidadeSimuladaCx)} cx
              </p>
              <p className="mt-1 text-xs font-semibold" style={{ color: "#C2410C" }}>
                -{fmt(perdaProjetadaTotalCx)} cx em perdas futuras
              </p>
            </div>

            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                % atingimento atual
              </p>
              <p className="mt-2 text-xl font-black" style={{ color: "#F59E0B" }}>
                {fmtPct(atingimentoAtual)}%
              </p>
              <p className="mt-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                disponibilidade / orçado
              </p>
            </div>

            <div
              className="rounded-2xl border px-4 py-3"
              style={{
                borderColor: "var(--border)",
                background: atingimentoSimulado >= atingimentoAtual ? "#F0FDF4" : "#FEF2F2",
              }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                % atingimento projetado
              </p>
              <p className="mt-2 text-xl font-black" style={{ color: atingimentoSimulado >= atingimentoAtual ? "#16A34A" : "#DC2626" }}>
                {fmtPct(atingimentoSimulado)}%
              </p>
              <p className="mt-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                após perdas simuladas
              </p>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                  Plano atual vs. disponibilidade projetada
                </p>
                <p className="mt-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Barras lado a lado: plano atual vs. disponibilidade projetada após a perda simulada.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "#D6DEE9" }} />
                  <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>Plano atual</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] border" style={{ borderColor: "#1F4164", background: "#EEF4FF" }} />
                  <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>Projetado</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[980px]">
                <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="16" fill="#FFFFFF" />

                {projectedLosses.map((month, index) => {
                  const currentX = x(index)
                  const planoY = y(month.v1)
                  const planoHeight = baselineY - planoY
                  const projetadoY = y(month.disponibilidadeProjetadaCx)
                  const projetadoHeight = baselineY - projetadoY
                  const pctMes = month.v1 > 0 ? (month.disponibilidadeProjetadaCx / month.v1) * 100 : 0
                  const planoX = currentX - (gapBetweenBars / 2) - singleBarWidth
                  const projetadoX = currentX + gapBetweenBars / 2

                  return (
                    <g key={month.mes}>
                      <rect
                        x={planoX}
                        y={planoY}
                        width={singleBarWidth}
                        height={planoHeight}
                        rx={4}
                        fill="#D6DEE9"
                      />

                      <rect
                        x={projetadoX}
                        y={projetadoY}
                        width={singleBarWidth}
                        height={projetadoHeight}
                        rx={4}
                        fill="#EEF4FF"
                        stroke="#1F4164"
                        strokeWidth="1.8"
                        strokeDasharray="4 3"
                      />

                      <text
                        x={currentX}
                        y={Math.max(16, Math.min(planoY, projetadoY) - 18)}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontWeight="900"
                        fill="#64748B"
                      >
                        {fmt(month.v1)} cx
                      </text>

                      <text
                        x={currentX}
                        y={Math.max(27, Math.min(planoY, projetadoY) - 6)}
                        textAnchor="middle"
                        fontSize="7.3"
                        fontWeight="800"
                        fill="#64748B"
                      >
                        plano
                      </text>

                      <text
                        x={currentX}
                        y={baselineY + 20}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="900"
                        fill="#0F172A"
                      >
                        {month.mes}
                      </text>

                      <text
                        x={currentX}
                        y={baselineY + 34}
                        textAnchor="middle"
                        fontSize="7.5"
                        fontWeight="800"
                        fill="#64748B"
                      >
                        {fmtPct(pctMes)}%
                      </text>

                      <text
                        x={currentX}
                        y={baselineY + 46}
                        textAnchor="middle"
                        fontSize="7"
                        fontWeight="800"
                        fill="#1F4164"
                      >
                        proj. {fmt(month.disponibilidadeProjetadaCx)} cx
                      </text>

                      {month.perdaCx > 0 && (
                        <text
                          x={currentX}
                          y={Math.max(18, projetadoY - 6)}
                          textAnchor="middle"
                          fontSize="7"
                          fontWeight="800"
                          fill="#C2410C"
                        >
                          -{fmt(month.perdaCx)} cx
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                  Cenário para os próximos meses
                </p>
                <p className="mt-1 max-w-2xl text-xs font-medium leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Ajuste uma hipótese simples de perda futura para ver o efeito na disponibilidade do ano.
                </p>
              </div>

              <div className="inline-flex rounded-xl border bg-slate-50 p-1" style={{ borderColor: "var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setMode("media")}
                  className="rounded-lg px-3 py-1.5 text-xs font-black transition"
                  style={{
                    background: mode === "media" ? "#FFFFFF" : "transparent",
                    color: mode === "media" ? "#1F4164" : "var(--text-secondary)",
                    boxShadow: mode === "media" ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
                  }}
                >
                  Usar média atual
                </button>

                <button
                  type="button"
                  onClick={() => setMode("custom")}
                  className="rounded-lg px-3 py-1.5 text-xs font-black transition"
                  style={{
                    background: mode === "custom" ? "#FFFFFF" : "transparent",
                    color: mode === "custom" ? "#1F4164" : "var(--text-secondary)",
                    boxShadow: mode === "custom" ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
                  }}
                >
                  Ajustar mês a mês
                </button>
              </div>
            </div>

            {mode === "media" ? (
              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_1fr] lg:items-center">
                  <div className="rounded-xl border bg-white px-4 py-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                      Média observada
                    </p>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="text-2xl font-black leading-none" style={{ color: "#1F4164" }}>
                        {fmtPct(averageLossPct)}%
                      </span>
                      <span className="pb-0.5 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                        Jan–Jun
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      Perda média sobre o plano dos meses já acompanhados.
                    </p>
                  </div>

                  <div className="rounded-xl border bg-white px-4 py-3" style={{ borderColor: "var(--border)" }}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                          Perda a aplicar nos meses futuros
                        </label>
                        <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                          Use a média ou ajuste um percentual para Julho–Dezembro.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setAveragePctInput(Number(averageLossPct.toFixed(1)))}
                        className="rounded-xl border px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
                        style={{ borderColor: "var(--border)", color: "#1F4164" }}
                      >
                        voltar para média
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px] md:items-center">
                      <input
                        type="range"
                        min={0}
                        max={30}
                        step={0.1}
                        value={Number(averagePctInput || 0)}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setAveragePctInput(Math.max(0, Number(event.target.value || 0)))}
                        className="h-2 w-full cursor-pointer accent-[#1F4164]"
                      />

                      <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2" style={{ borderColor: "var(--border)" }}>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={Number(averagePctInput || 0)}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => setAveragePctInput(Math.max(0, Number(event.target.value || 0)))}
                          className="w-full bg-transparent text-right text-sm font-black outline-none"
                          style={{ color: "var(--text-primary)" }}
                        />
                        <span className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>
                          %
                        </span>
                      </div>
                    </div>

                    <p className="mt-3 text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                      A simulação aplica esse percentual sobre o plano de cada mês futuro.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                        Ajuste manual
                      </p>
                      <p className="mt-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        Informe uma perda estimada para cada mês futuro, em caixas.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={repetirMediaAtualPorMes}
                        className="rounded-xl border px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
                        style={{ borderColor: "var(--border)", color: "#1F4164" }}
                      >
                        preencher com média
                      </button>

                      <button
                        type="button"
                        onClick={zerarMeses}
                        className="rounded-xl border px-3 py-2 text-xs font-bold transition hover:bg-slate-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                      >
                        zerar
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-slate-50 px-3 py-3" style={{ borderColor: "var(--border)" }}>
                    <label className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                      Distribuir uma perda total nos meses futuros
                    </label>

                    <div className="mt-2 flex max-w-[360px] items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={perdaCustomTotalCx}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => distribuirIgualmente(Number(event.target.value || 0))}
                        className="h-10 w-full rounded-xl border bg-white px-3 text-right text-sm font-black outline-none"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      />
                      <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                        cx
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {futureMonths.map((month) => {
                    const perdaMes = Math.max(0, Number(customLosses[month.mes] || 0))
                    const disponibilidadeProjetadaMes = Math.max(0, month.v1 - perdaMes)

                    return (
                      <div
                        key={month.mes}
                        className="rounded-xl border bg-white px-3 py-3"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-black" style={{ color: "var(--text-primary)" }}>
                              {month.mes}
                            </p>
                            <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                              Plano {fmt(month.v1)} cx
                            </p>
                          </div>

                          <p className="text-right text-[11px] font-semibold" style={{ color: "#1F4164" }}>
                            Proj. {fmt(disponibilidadeProjetadaMes)} cx
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={50}
                            value={perdaMes}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setCustomLosses({
                                ...customLosses,
                                [month.mes]: Math.max(0, Number(event.target.value || 0)),
                              })
                            }
                            className="h-9 w-full rounded-xl border bg-white px-3 text-right text-sm font-black outline-none"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          />
                          <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                            cx
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={onClear}
            className="rounded-xl border px-4 py-2 text-sm font-bold transition hover:bg-slate-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Limpar cenário
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-4 py-2 text-sm font-bold transition hover:bg-slate-50"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={onApply}
              className="rounded-xl px-4 py-2 text-sm font-bold text-white transition hover:opacity-95"
              style={{ background: "#1F4164" }}
            >
              Aplicar cenário
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReorganizacaoModal({
  open,
  onClose,
  itens,
}: {
  open: boolean
  onClose: () => void
  itens: ReorganizacaoItem[]
}) {
  if (!open) return null

  const ganhos = itens
    .filter((item) => item.tipo === "ganho")
    .reduce((acc, item) => acc + Math.abs(item.caixas), 0)

  const perdas = itens
    .filter((item) => item.tipo === "perda")
    .reduce((acc, item) => acc + Math.abs(item.caixas), 0)

  const liquido = ganhos - perdas

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <p
              className="text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-secondary)" }}
            >
              Abertura do card
            </p>
            <h2 className="mt-1 text-xl font-black" style={{ color: "var(--text-primary)" }}>
              Reorganização do plano
            </h2>
            <p className="mt-1 max-w-4xl text-sm" style={{ color: "var(--text-secondary)" }}>
              Comparação detalhada entre Plano 1 e Plano Atual com paradas, horas disponíveis e alterações de mix/lotes.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 transition hover:bg-black/5"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto p-5">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <MiniResumo
              label="Ganhos de plano"
              value={`+${fmt(ganhos)} cx`}
              sub={`+${fmtTubetes(ganhos)}`}
              color="#16A34A"
              bg="#F0FDF4"
            />

            <MiniResumo
              label="Perdas de plano"
              value={`-${fmt(perdas)} cx`}
              sub={`-${fmtTubetes(perdas)}`}
              color="#DC2626"
              bg="#FEF2F2"
            />

            <MiniResumo
              label="Saldo líquido"
              value={`${liquido >= 0 ? "+" : "-"}${fmt(Math.abs(liquido))} cx`}
              sub={`${liquido >= 0 ? "+" : "-"}${fmtTubetes(Math.abs(liquido))}`}
              color={liquido >= 0 ? "#16A34A" : "#DC2626"}
              bg="#F8FAFC"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
            <div className="overflow-auto">
              <table className="w-full min-w-[1350px] text-sm">
                <thead style={{ background: "#F8FAFC", color: "var(--text-secondary)" }}>
                  <tr>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Tipo</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Categoria</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Descrição</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Plano 1</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Plano Atual</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas P1</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas Atual</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Impacto h</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Impacto cx</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Lotes / Mix</th>
                  </tr>
                </thead>

                <tbody>
                  {itens.map((item) => {
                    const ganho = item.tipo === "ganho"
                    const lotesAntesTexto = formatarLotes(item.lotesAntes)
                    const lotesDepoisTexto = formatarLotes(item.lotesDepois)
                    const totalAntes = totalLotes(item.lotesAntes)
                    const totalDepois = totalLotes(item.lotesDepois)

                    return (
                      <tr key={item.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-3">
                          <span
                            className="inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider"
                            style={{
                              background: ganho ? "#DCFCE7" : "#FEE2E2",
                              color: ganho ? "#166534" : "#991B1B",
                            }}
                          >
                            {ganho ? "Ganho" : "Perda"}
                          </span>
                        </td>

                        <td className="px-3 py-3 font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.categoria}
                        </td>

                        <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                          <div className="max-w-[230px] whitespace-pre-line leading-relaxed">
                            {item.descricao}
                          </div>
                        </td>

                        <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                          <div className="max-w-[220px] whitespace-pre-line leading-relaxed">
                            {item.plano1Resumo}
                          </div>
                        </td>

                        <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                          <div className="max-w-[220px] whitespace-pre-line leading-relaxed">
                            {item.planoAtualResumo}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.horasAntes != null ? `${fmt(item.horasAntes)} h` : "—"}
                        </td>

                        <td className="px-3 py-3 text-right font-bold" style={{ color: "var(--text-primary)" }}>
                          {item.horasDepois != null ? `${fmt(item.horasDepois)} h` : "—"}
                        </td>

                        <td className="px-3 py-3 text-right font-black" style={{ color: ganho ? "#16A34A" : "#DC2626" }}>
                          {item.horasImpacto != null
                            ? `${item.horasImpacto >= 0 ? "+" : "-"}${fmt(Math.abs(item.horasImpacto))} h`
                            : "—"}
                        </td>

                        <td className="px-3 py-3 text-right font-black" style={{ color: ganho ? "#16A34A" : "#DC2626" }}>
                          {ganho ? "+" : "-"}{fmt(Math.abs(item.caixas))} cx
                          <div className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                            {ganho ? "+" : "-"}{fmtTubetes(Math.abs(item.caixas))}
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          {item.lotesAntes || item.lotesDepois ? (
                            <div className="space-y-2 text-[11px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                              <div>
                                <p className="font-black" style={{ color: "var(--text-secondary)" }}>Antes</p>
                                <div className="whitespace-pre-line">{lotesAntesTexto}</div>
                                <p className="mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                                  Total antes: {fmt(totalAntes)} cx{totalAntes ? ` · ${fmtTubetes(totalAntes)}` : ""}
                                </p>
                              </div>
                              <div>
                                <p className="font-black" style={{ color: "var(--text-secondary)" }}>Depois</p>
                                <div className="whitespace-pre-line">{lotesDepoisTexto}</div>
                                <p className="mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                                  Total depois: {fmt(totalDepois)} cx{totalDepois ? ` · ${fmtTubetes(totalDepois)}` : ""}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-secondary)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              No backend real, essa tabela pode ser montada comparando Plano 1 vs Plano Atual no Gantt:
              comentários de parada, horas disponíveis por dia/plano, calendários e substituição de lotes/mix.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LiberacaoExecutiva() {
  const [modalReorganizacaoAberto, setModalReorganizacaoAberto] = useState(false)
  const [modalSimuladorPerdasAberto, setModalSimuladorPerdasAberto] = useState(false)
  const [simulacaoAplicada, setSimulacaoAplicada] = useState<{
    modo: SimulationMode
    percentual: number
    custom: Record<string, number>
  } | null>(null)
  const [simulacaoDraftModo, setSimulacaoDraftModo] = useState<SimulationMode>("media")
  const [simulacaoDraftPercentual, setSimulacaoDraftPercentual] = useState(0)
  const [simulacaoDraftCustom, setSimulacaoDraftCustom] = useState<Record<string, number>>({})
  const [apiData, setApiData] = useState<LiberacaoExecutivaPayload | null>(null)
  const [carregandoDados, setCarregandoDados] = useState(true)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    async function carregarDados() {
      try {
        setCarregandoDados(true)
        setErroCarga(null)

        const response = await fetch(`${API_BASE}/liberacao-executiva/resumo?force=true&_t=${Date.now()}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const json = await response.json()
        if (ativo) setApiData(json)
      } catch (error) {
        console.warn("Não foi possível carregar a Liberação Executiva.", error)
        if (ativo) setErroCarga(error instanceof Error ? error.message : "Erro ao carregar dados")
      } finally {
        if (ativo) setCarregandoDados(false)
      }
    }

    void carregarDados()

    return () => {
      ativo = false
    }
  }, [])

  if (!apiData) {
    return (
      <div className="px-6 py-5 lg:px-8">
        <div className="w-full space-y-5">
          <div>
            <h1
              className="text-2xl font-black tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              Overview disponibilidade
            </h1>

            <div
              className="mt-3 inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 shadow-sm"
              style={{ borderColor: "var(--border)" }}
            >
              <CalendarDays size={13} style={{ color: "var(--text-secondary)" }} />
              <span
                className="text-[11px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Dados atualizados em:
              </span>
              <span
                className="text-[11px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                —
              </span>
            </div>
          </div>

          <div
            className="rounded-2xl border bg-white p-6 shadow-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <p
              className="text-[12px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-secondary)" }}
            >
              {carregandoDados ? "Carregando dados reais" : "Não foi possível carregar os dados"}
            </p>

            <p className="mt-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              {carregandoDados
                ? "A página está buscando a mesma base usada na Overview e no MPS/Gantt."
                : `O backend não retornou os dados da Liberação Executiva. Erro: ${erroCarga || "desconhecido"}`}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const dadosFallback = {
    orcadoFaturamentoCx: 0,
    plano1LiberacaoCx: 0,
    planoAtualLiberacaoCx: 0,
    estoqueInicialJanCx: 0,
    reorganizacaoPlanoCx: 0,
    atrasoProducaoCx: 0,
    perdaReprovacaoCx: 0,
    perdaRendimentoCx: 0,
    ganhoRendimentoCx: 0,
  }

  const dados = {
    ...dadosFallback,
    ...(apiData?.dados || {}),
  }

  const atualizadoLabel = apiData?.atualizadoLabel || apiData?.atualizado_label || "—"

  const plano1BaseAnualCx = dados.plano1LiberacaoCx + dados.estoqueInicialJanCx
  const disponibilidadeAtualCx = dados.planoAtualLiberacaoCx + dados.estoqueInicialJanCx
  const diferencaVsPlano1Cx = disponibilidadeAtualCx - plano1BaseAnualCx
  const atingimentoOrcado = dados.orcadoFaturamentoCx > 0
    ? (disponibilidadeAtualCx / dados.orcadoFaturamentoCx) * 100
    : 0

  // Sem fallback visual: esta página não deve exibir número mockado.
  const waterfallSteps: WaterfallStep[] = apiData?.waterfallSteps || []

  const perdasMensais: MonthlyLossesItem[] = apiData?.perdasMensais || []

  const mesesFuturos = perdasMensais.filter((item) => item.status === "futuro")
  const perdasRealizadas = perdasMensais.filter((item) => item.status !== "futuro")
  const mapaCustomVazio = Object.fromEntries(mesesFuturos.map((item) => [item.mes, 0])) as Record<string, number>

  const perdaRealizadaTotalCx = perdasRealizadas.reduce(
    (acc, item) => acc + item.atraso + item.reorg + item.reprovacao,
    0,
  )
  const baseRealizadaTotalCx = perdasRealizadas.reduce((acc, item) => acc + item.v1, 0)
  const percentualMedioPerdaAtual = baseRealizadaTotalCx > 0
    ? (perdaRealizadaTotalCx / baseRealizadaTotalCx) * 100
    : 0

  const somaAtrasoAtual = perdasRealizadas.reduce((acc, item) => acc + item.atraso, 0)
  const somaReorgAtual = perdasRealizadas.reduce((acc, item) => acc + item.reorg, 0)
  const somaReprovacaoAtual = perdasRealizadas.reduce((acc, item) => acc + item.reprovacao, 0)
  const somaCausasAtual = somaAtrasoAtual + somaReorgAtual + somaReprovacaoAtual || 1

  const shareAtraso = somaAtrasoAtual / somaCausasAtual
  const shareReorg = somaReorgAtual / somaCausasAtual

  const simulacaoCustomAtual =
    simulacaoAplicada?.custom && Object.keys(simulacaoAplicada.custom).length > 0
      ? simulacaoAplicada.custom
      : mapaCustomVazio

  const perdasMensaisPlotadas: MonthlyLossesItem[] = perdasMensais.map((item) => {
    if (item.status !== "futuro" || !simulacaoAplicada) return item

    const perdaTotalCx =
      simulacaoAplicada.modo === "media"
        ? Math.max(0, Math.round(item.v1 * (simulacaoAplicada.percentual / 100)))
        : Math.max(0, Number(simulacaoCustomAtual[item.mes] || 0))

    if (perdaTotalCx <= 0) return item

    const atraso = Math.round(perdaTotalCx * shareAtraso)
    const reorg = Math.round(perdaTotalCx * shareReorg)
    const reprovacao = Math.max(0, perdaTotalCx - atraso - reorg)

    return {
      ...item,
      atraso,
      reorg,
      reprovacao,
      simulado: true,
    }
  })

  const ponteVersoesSteps: WaterfallStep[] = apiData?.ponteVersoesSteps || []

  const abrirSimuladorPerdas = () => {
    setSimulacaoDraftModo(simulacaoAplicada?.modo ?? "media")
    setSimulacaoDraftPercentual(
      simulacaoAplicada?.percentual ?? Number(percentualMedioPerdaAtual.toFixed(1)),
    )
    setSimulacaoDraftCustom(
      simulacaoAplicada?.custom && Object.keys(simulacaoAplicada.custom).length > 0
        ? simulacaoAplicada.custom
        : mapaCustomVazio,
    )
    setModalSimuladorPerdasAberto(true)
  }

  const aplicarSimulacaoPerdas = () => {
    setSimulacaoAplicada({
      modo: simulacaoDraftModo,
      percentual: Math.max(0, Number(simulacaoDraftPercentual || 0)),
      custom:
        simulacaoDraftModo === "custom"
          ? Object.fromEntries(
              mesesFuturos.map((item) => [item.mes, Math.max(0, Number(simulacaoDraftCustom[item.mes] || 0))]),
            )
          : mapaCustomVazio,
    })
    setModalSimuladorPerdasAberto(false)
  }

  const limparSimulacaoPerdas = () => {
    setSimulacaoAplicada(null)
    setSimulacaoDraftModo("media")
    setSimulacaoDraftPercentual(Number(percentualMedioPerdaAtual.toFixed(1)))
    setSimulacaoDraftCustom(mapaCustomVazio)
    setModalSimuladorPerdasAberto(false)
  }

  const itensReorganizacaoFallback: ReorganizacaoItem[] = [
    {
      id: "parada-removida",
      tipo: "ganho",
      categoria: "Parada removida",
      descricao: "Retirada de parada planejada no Plano 1.",
      caixas: 4000,
      plano1Resumo: "Parada programada de manutenção na Linha 1 em Jul/26.",
      planoAtualResumo: "Parada removida do calendário. Horas voltaram para disponibilidade produtiva.",
      horasAntes: 21,
      horasDepois: 0,
      horasImpacto: 21,
    },
    {
      id: "parada-adicionada",
      tipo: "perda",
      categoria: "Parada adicionada",
      descricao: "Inclusão de nova parada programada no Plano Atual.",
      caixas: -1100,
      plano1Resumo: "Sem parada prevista para a janela analisada.",
      planoAtualResumo: "Parada programada adicionada no calendário da Linha 2.",
      horasAntes: 0,
      horasDepois: 6,
      horasImpacto: -6,
    },
    {
      id: "alteracao-mix",
      tipo: "perda",
      categoria: "Alteração de mix",
      descricao: "Troca de famílias/lotes reduziu o volume equivalente do plano.",
      caixas: -600,
      plano1Resumo: "Mix original com lotes de maior volume equivalente.",
      planoAtualResumo: "Mix revisado com menor volume equivalente na mesma janela.",
      lotesAntes: [
        { lote: "2607A1001", produto: "Lidostesim 2% 1:100", caixas: 2400 },
        { lote: "2607A1002", produto: "Articaine 4% 1:100", caixas: 1900 },
        { lote: "2607A1003", produto: "Mepiadre 2%", caixas: 1300 },
      ],
      lotesDepois: [
        { lote: "2607B2001", produto: "Articaine 4% 1:200", caixas: 2100 },
        { lote: "2607B2002", produto: "Lidostesim 2% 1:50", caixas: 1700 },
        { lote: "2607B2003", produto: "Mepiadre 3%", caixas: 1200 },
      ],
    },
  ]

  const itensReorganizacao: ReorganizacaoItem[] = apiData?.itensReorganizacao || []

  return (
    <div className="px-6 py-5 lg:px-8">
      <div className="w-full space-y-5">
        <div>
          <h1
            className="text-2xl font-black tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Overview disponibilidade
          </h1>

          <div
            className="mt-3 inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 shadow-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <CalendarDays size={13} style={{ color: "var(--text-secondary)" }} />
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              Dados atualizados em:
            </span>
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              {atualizadoLabel}
            </span>
          </div>
        </div>

        <section>
          <p
            className="mb-3 text-[10px] font-black uppercase tracking-[0.20em]"
            style={{ color: "var(--text-secondary)" }}
          >
            Indicadores · 2026
          </p>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="Orçado faturamento"
              value={`${fmt(dados.orcadoFaturamentoCx)} cx`}
              sub={fmtTubetes(dados.orcadoFaturamentoCx)}
              tone="blue"
              icon={Target}
            />

            <KpiCard
              title="Disponibilidade anual orçada"
              value={`${fmt(plano1BaseAnualCx)} cx`}
              sub={fmtTubetes(plano1BaseAnualCx)}
              tone="navy"
              icon={Boxes}
            />

            <KpiCard
              title="Disponibilidade atual"
              value={`${fmt(disponibilidadeAtualCx)} cx`}
              sub={fmtTubetes(disponibilidadeAtualCx)}
              tone="teal"
              icon={PackageCheck}
            />

            <KpiCard
              title="Diferença vs. disp. orçada"
              value={`${diferencaVsPlano1Cx >= 0 ? "+" : "-"}${fmt(Math.abs(diferencaVsPlano1Cx))} cx`}
              sub={`${diferencaVsPlano1Cx >= 0 ? "+" : "-"}${fmtTubetes(Math.abs(diferencaVsPlano1Cx))}`}
              tone={diferencaVsPlano1Cx >= 0 ? "green" : "red"}
              icon={TrendingDown}
            />

            <GaugeCard
              pct={atingimentoOrcado}
              sub="Disponibilidade / orçado"
            />
          </div>
        </section>

        <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: "var(--border)" }}>
          <div className="px-5 pt-4 text-center">
            <p
              className="text-[12px] font-black uppercase tracking-[0.18em]"
              style={{ color: "var(--text-secondary)" }}
            >
              Causas da variação anual
            </p>
          </div>

          <WaterfallChart
            steps={waterfallSteps}
            orcadoFaturamentoCx={dados.orcadoFaturamentoCx}
            onClickReorganizacao={() => setModalReorganizacaoAberto(true)}
          />
        </section>

        <MonthlyLossesStackedChart
          data={perdasMensaisPlotadas}
          onOpenSimulator={abrirSimuladorPerdas}
          simulacaoAtiva={!!simulacaoAplicada}
        />

        <VersionBridgeSection
          steps={ponteVersoesSteps}
          onClickReorganizacao={() => setModalReorganizacaoAberto(true)}
        />
      </div>

      <ReorganizacaoModal
        open={modalReorganizacaoAberto}
        onClose={() => setModalReorganizacaoAberto(false)}
        itens={itensReorganizacao}
      />

      <LossSimulationModal
        open={modalSimuladorPerdasAberto}
        onClose={() => setModalSimuladorPerdasAberto(false)}
        futureMonths={mesesFuturos}
        averageLossPct={percentualMedioPerdaAtual}
        orcadoCx={dados.orcadoFaturamentoCx}
        disponibilidadeAtualCx={disponibilidadeAtualCx}
        mode={simulacaoDraftModo}
        setMode={setSimulacaoDraftModo}
        averagePctInput={simulacaoDraftPercentual}
        setAveragePctInput={setSimulacaoDraftPercentual}
        customLosses={simulacaoDraftCustom}
        setCustomLosses={setSimulacaoDraftCustom}
        onApply={aplicarSimulacaoPerdas}
        onClear={limparSimulacaoPerdas}
      />
    </div>
  )
}
