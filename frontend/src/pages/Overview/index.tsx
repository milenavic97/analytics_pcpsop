import { useState, useEffect, useMemo, useRef } from "react"
import {
  DollarSign, PackageCheck, TrendingUp, TrendingDown, BarChart3, Package, CalendarDays, ChevronDown, ChevronUp,
  Gauge, Sparkles, ArrowLeft, AlertTriangle,
} from "lucide-react"

import { DisponibilidadeModal } from "@/components/charts/DisponibilidadeModal"
import { OrcadoFaturamentoModal } from "@/components/charts/OrcadoFaturamentoModal"
import { ProjecaoFaturamentoModal } from "@/components/charts/ProjecaoFaturamentoModal"
import { ProjecaoLiberacoesModal } from "@/components/charts/ProjecaoLiberacoesModal"
import { DemandaDisponibilidadeChart } from "@/components/charts/DemandaDisponibilidadeChart"
import { GrupoDisponibilidadeTableV2 } from "@/components/charts/GrupoDisponibilidadeTableV2"
import { RastreamentoLotes } from "@/components/charts/RastreamentoLotes"
import PrevistoAteHojeModal from "@/components/charts/PrevistoAteHojeModal"

import {
  getOverviewResumo,
  getOverviewResumoVersao,
  type OverviewResumoResponse,
} from "@/services/api"
import { getAuthHeaders } from "../../lib/authHeaders"

const API_BASE = String(
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "https://dfl-sop-api.fly.dev",
).replace(/\/$/, "")

const TUBETES_POR_CAIXA = 500

interface KpiProps {
  label: string; value: string; sub?: string; delta?: string
  positive?: boolean; neutral?: boolean; onClick?: () => void; delay?: number
  iconBg?: string; iconColor?: string; Icon?: React.ElementType; valueColor?: string
}

function KpiCard({ label, value, sub, delta, positive, neutral, onClick, delay = 0, iconBg, iconColor, Icon, valueColor }: KpiProps) {
  return (
    <div onClick={onClick} style={{ animationDelay: `${delay}ms`, cursor: onClick ? "pointer" : "default" }}
      className="card flex flex-col gap-3 p-4 fade-in md:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="card-label leading-5">{label}</span>
        {Icon && (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl md:h-10 md:w-10"
            style={{ background: iconBg || "#EFF6FF" }}>
            <Icon size={17} style={{ color: iconColor || "#2563EB" }} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight md:text-2xl" style={{ color: valueColor || "var(--text-primary)" }}>{value}</p>
        {sub && <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
      {delta && (
        <div className="flex items-start gap-1 text-xs font-medium leading-5"
          style={{ color: neutral ? "#F59E0B" : positive ? "#16A34A" : "#DC2626" }}>
          {!neutral && (positive ? <TrendingUp size={13} className="mt-0.5 flex-shrink-0" /> : <TrendingDown size={13} className="mt-0.5 flex-shrink-0" />)}
          <span>{delta}</span>
        </div>
      )}
      {onClick && <p className="mt-auto text-[10px]" style={{ color: "var(--text-secondary)" }}>Clique para detalhes</p>}
    </div>
  )
}

function fmt(n: number) {
  if (isNaN(n) || n == null) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function tubetes(caixas: number) { return caixas * TUBETES_POR_CAIXA }

function formatarDataHoraAtualizacao(value?: string | null) {
  if (!value) return null

  const data = new Date(value)

  if (Number.isNaN(data.getTime())) return null

  const opcoesDataHoraBase = {
    timeZone: "America/Sao_Paulo",
  } as const

  const dataFmt = new Intl.DateTimeFormat("pt-BR", {
    ...opcoesDataHoraBase,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data)

  const horaFmt = new Intl.DateTimeFormat("pt-BR", {
    ...opcoesDataHoraBase,
    hour: "2-digit",
    minute: "2-digit",
  }).format(data)

  return `${dataFmt} às ${horaFmt}`
}

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

// --- Cascata "Causas da Variação Anual" (versão Executivo) ---------------
// O DESENHO (WaterfallChart/getToneStyles/topRoundedRectPath) foi adaptado do
// componente puramente visual da Liberação Executiva (recebe steps prontos,
// não busca dado nenhum sozinho). Os NÚMEROS, porém, NUNCA vêm de lá -- vêm
// do mesmo endpoint estável já corrigido hoje (/overview/rastreamento-lotes-cache),
// somando o causas-por-mês (mes_perdas_vs_v1_por_causa) de cada mês já
// fechado do ano, em vez de tratar só o mês atual como se fosse o ano inteiro.
type Tone = "blue" | "navy" | "purple" | "teal" | "red" | "orange" | "gray" | "green" | "slate"

type WaterfallStep = {
  id: string
  label: string
  kind: "total" | "delta"
  value: number
  tone: Tone
  lotes?: number
}

function fmtLotesQtd(lotes?: number) {
  if (lotes == null || Number.isNaN(Number(lotes))) return ""
  const valor = Math.round(Math.abs(Number(lotes || 0)))
  return `${fmt(valor)} ${valor === 1 ? "lote" : "lotes"}`
}

function getToneStyles(tone: Tone) {
  const tones: Record<Tone, { iconBg: string; iconColor: string; valueColor: string; barColor: string }> = {
    blue: { iconBg: "#EEF4FF", iconColor: "#2563EB", valueColor: "#1D4ED8", barColor: "#2563EB" },
    navy: { iconBg: "#EAF1F8", iconColor: "#1F4164", valueColor: "#1F4164", barColor: "#1F4164" },
    purple: { iconBg: "#F3E8FF", iconColor: "#7C3AED", valueColor: "#7C3AED", barColor: "#7C3AED" },
    teal: { iconBg: "#E6FFFB", iconColor: "#0F766E", valueColor: "#0F766E", barColor: "#0F766E" },
    red: { iconBg: "#FEF2F2", iconColor: "#DC2626", valueColor: "#DC2626", barColor: "#DC2626" },
    orange: { iconBg: "#FFF7ED", iconColor: "#C2410C", valueColor: "#C2410C", barColor: "#C2410C" },
    gray: { iconBg: "#F3F4F6", iconColor: "#64748B", valueColor: "#475569", barColor: "#64748B" },
    green: { iconBg: "#ECFDF5", iconColor: "#16A34A", valueColor: "#16A34A", barColor: "#16A34A" },
    slate: { iconBg: "#F1F5F9", iconColor: "#334155", valueColor: "#334155", barColor: "#334155" },
  }
  return tones[tone]
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
    "Z",
  ].join(" ")
}

// Versão somente-leitura do WaterfallChart -- sem clique/modal por enquanto
// (a Liberação Executiva abre detalhe de lote ao clicar; aqui ainda não
// temos esse detalhe reaproveitado, então os steps não são clicáveis).
function WaterfallChart({ steps, maxReference, onStepClick }: { steps: WaterfallStep[]; maxReference: number; onStepClick?: (id: string) => void }) {
  const width = 1080
  const height = 236
  const margin = { top: 30, right: 34, bottom: 54, left: 74 }
  const plotHeight = 134
  const plotWidth = width - margin.left - margin.right

  const totalBarWidth = 36
  const stepWidth = 28
  const minDeltaVisualHeight = 1.2

  type ProcessedStep = WaterfallStep & { index: number; before: number; after: number; displayValue: number }

  let running = 0
  const bars: ProcessedStep[] = steps.map((step, index) => {
    if (step.kind === "total") {
      const after = Number(step.value || 0)
      running = after
      return { ...step, index, before: 0, after, displayValue: after }
    }
    const before = running
    const delta = Number(step.value || 0)
    const after = running + delta
    running = after
    return { ...step, index, before, after, displayValue: delta }
  })

  const maxLevel = Math.max(...bars.flatMap((bar) => [bar.before, bar.after]), maxReference, 1)
  const maxValue = Math.ceil((maxLevel * 1.06) / 5000) * 5000
  const y = (value: number) => margin.top + ((maxValue - value) / maxValue) * plotHeight
  const baselineY = y(0)
  const x = (index: number) => margin.left + (index * plotWidth) / Math.max(bars.length - 1, 1)

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
            const connectorX1 = currentX + totalBarWidth / 2
            const connectorX2 = getConnectorTargetX(index)

            return (
              <g key={bar.id}>
                <path d={topRoundedRectPath(xx, yTop, totalBarWidth, barHeight, 4)} fill={styles.barColor} opacity="0.92" />
                {next && (
                  <line x1={connectorX1} x2={connectorX2} y1={yTop} y2={yTop} stroke="#CBD5E1" strokeWidth="1.4" strokeDasharray="4 5" />
                )}
                {bar.lotes != null && (
                  <text x={currentX} y={yTop - 18} textAnchor="middle" fontSize="8" fontWeight="700" fill="#64748B">
                    {fmtLotesQtd(bar.lotes)}
                  </text>
                )}
                <text x={currentX} y={yTop - 7} textAnchor="middle" fontSize="10.5" fontWeight="900" fill={styles.valueColor}>
                  {valueLabel}
                </text>
                <text x={currentX} y={height - 19} textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#0F172A">
                  {bar.label}
                </text>
              </g>
            )
          }

          const beforeY = y(bar.before)
          const afterY = y(bar.after)
          const rawDeltaHeight = Math.abs(beforeY - afterY)
          const deltaHeight = Math.max(minDeltaVisualHeight, rawDeltaHeight)
          const top = rawDeltaHeight < minDeltaVisualHeight ? (beforeY + afterY) / 2 - deltaHeight / 2 : Math.min(beforeY, afterY)
          const xx = currentX - stepWidth / 2
          const connectorX1 = currentX + stepWidth / 2
          const connectorX2 = getConnectorTargetX(index)

          const clicavel = Boolean(onStepClick) && (bar.id === "reprovacao" || bar.id === "rendimento")

          return (
            <g
              key={bar.id}
              onClick={clicavel ? () => onStepClick?.(bar.id) : undefined}
              style={{ cursor: clicavel ? "pointer" : "default" }}
            >
              <line x1={currentX} x2={currentX} y1={beforeY} y2={afterY} stroke={styles.barColor} strokeWidth="1.1" strokeDasharray="3 4" opacity="0.18" />
              <path d={topRoundedRectPath(xx, top, stepWidth, deltaHeight, 2.5)} fill={styles.barColor} opacity="0.96" />
              {next && (
                <line x1={connectorX1} x2={connectorX2} y1={afterY} y2={afterY} stroke="#CBD5E1" strokeWidth="1.4" strokeDasharray="4 5" />
              )}
              {bar.lotes != null && (
                <text x={currentX} y={isNegativeDelta ? top + deltaHeight + 13 : top - 4} textAnchor="middle" fontSize="8" fontWeight="700" fill="#64748B">
                  {fmtLotesQtd(bar.lotes)}
                </text>
              )}
              <text
                x={currentX}
                y={isNegativeDelta ? top + deltaHeight + 25 : top - 15}
                textAnchor="middle"
                fontSize="9.5"
                fontWeight="900"
                fill={isPositiveDelta ? "#16A34A" : isNegativeDelta ? "#DC2626" : styles.valueColor}
              >
                {valueLabel}
              </text>
              <text x={currentX} y={height - 19} textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#0F172A">
                {bar.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ModalCascataDetalhe({
  tipo,
  onClose,
  lotesReprovacao,
  lotesRendimento,
}: {
  tipo: "reprovacao" | "rendimento" | null
  onClose: () => void
  lotesReprovacao: LoteReprovacaoAnual[]
  lotesRendimento: LoteRendimentoAnual[]
}) {
  if (!tipo) return null

  const isReprovacao = tipo === "reprovacao"
  const totalPerda = lotesReprovacao.reduce((acc, l) => acc + Number(l.qtd_perda_cx || 0), 0)
  const lotesGanho = lotesRendimento.filter((l) => l.tipo === "ganho")
  const lotesPerda = lotesRendimento.filter((l) => l.tipo === "perda")
  const totalGanho = lotesGanho.reduce((acc, l) => acc + Number(l.delta_cx || 0), 0)
  const totalPerdaRend = lotesPerda.reduce((acc, l) => acc + Math.abs(Number(l.delta_cx || 0)), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Detalhe da cascata anual
            </p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {isReprovacao ? "Lotes reprovados / em desvio" : "Ganho e perda de rendimento"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-lg transition hover:bg-black/5" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="overflow-auto p-5">
          {isReprovacao ? (
            <>
              <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                {lotesReprovacao.length} lote{lotesReprovacao.length === 1 ? "" : "s"}, {fmt(totalPerda)} cx no total (ano até o mês atual).
              </p>
              <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-sm">
                  <thead style={{ background: "#F8FAFC" }}>
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>NC</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Lote</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Motivo</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Caixas</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Destino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotesReprovacao.length === 0 && (
                      <tr><td className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)" }} colSpan={5}>Nenhum lote reprovado/desvio no período.</td></tr>
                    )}
                    {lotesReprovacao.map((l) => (
                      <tr key={l.lote} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{l.nc || "—"}</td>
                        <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{l.lote}</td>
                        <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{l.motivo || "—"}</td>
                        <td className="px-3 py-2 text-right font-bold" style={{ color: "#DC2626" }}>{fmt(l.qtd_perda_cx)} cx</td>
                        <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{l.destino || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
                  <p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Ganho ({lotesGanho.length} lotes)</p>
                  <p className="text-lg font-bold" style={{ color: "#16A34A" }}>+{fmt(totalGanho)} cx</p>
                </div>
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "#F9FAFB" }}>
                  <p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Perda ({lotesPerda.length} lotes)</p>
                  <p className="text-lg font-bold" style={{ color: "#6B7280" }}>-{fmt(totalPerdaRend)} cx</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-sm">
                  <thead style={{ background: "#F8FAFC" }}>
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Lote</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Previsto (Gantt)</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Liberado (SD3)</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotesRendimento.length === 0 && (
                      <tr><td className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)" }} colSpan={4}>Nenhum ganho/perda de rendimento no período.</td></tr>
                    )}
                    {lotesRendimento.map((l) => (
                      <tr key={`${l.lote}-${l.tipo}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{l.lote}</td>
                        <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(l.qtd_prevista_cx)} cx</td>
                        <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(l.qtd_liberada_cx)} cx</td>
                        <td className="px-3 py-2 text-right font-bold" style={{ color: l.delta_cx >= 0 ? "#16A34A" : "#6B7280" }}>
                          {l.delta_cx >= 0 ? "+" : ""}{fmt(l.delta_cx)} cx
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Orçado oficial de liberações = Plano 1 do ano (MPS Jan/2026 V3), sem estoque inicial.
// Mantém o card da Overview alinhado com a Liberação Executiva.
const ORCADO_LIBERACAO_ANUAL_PLANO1_JAN_V3_CX = 220534

interface ProjFat { total_real: number; total_forecast: number; total_projetado: number; total_orcado: number; pct_atingimento: number; delta_caixas: number; ultimo_mes_fechado: number }
interface ProjLib { total_real: number; total_previsto: number; total_projetado: number; total_orcado: number; pct_atingimento: number; delta_caixas: number; ultimo_mes_fechado: number }
interface EstoqueMes { mes: number; qtd_caixas: number }
interface GrupoItem { grupo: string; qtd_caixas: number; pct: number }
interface DisponibilidadeMes {
  mes: number
  mes_label: string
  estoque_inicio: number
  estoque_inicio_tipo: "real" | "projetado"
  estoque_inicio_por_grupo: GrupoItem[]
  entradas: number
  entradas_tipo: "real" | "previsto"
  entradas_linhas?: { L1?: number; L2?: number } | null
  entradas_real_mes_atual?: number | null
  entradas_previstas_mtd?: number | null
  entradas_previstas_mtd_por_grupo?: GrupoItem[] | null
  entradas_real_mes_atual_linhas?: { L1?: number; L2?: number } | null
  entradas_real_mes_atual_por_grupo?: GrupoItem[] | null
  entradas_previstas_por_grupo_mes_atual?: GrupoItem[] | null
  entradas_por_grupo?: GrupoItem[] | null
  saidas: number
  saidas_tipo: "real" | "forecast"
  saidas_por_grupo?: GrupoItem[] | null
  saidas_real_mes_atual?: number | null
  saidas_real_mes_atual_por_grupo?: GrupoItem[] | null
  disponibilidade_total: number
  saldo_final: number
}
interface DisponibilidadePayload {
  ano: number
  mes_atual: number
  ultimo_mes_fechado: number
  entradas_previstas_mtd: number
  entradas_previstas_mtd_por_grupo: GrupoItem[]
  meses: DisponibilidadeMes[]
}
interface RastreamentoMtdLoadPayload {
  previstoAteHoje: number
  liberadoSd3MtdTotal: number
  liberadoVinculadoLotesPrevistos: number
  liberadoSd3ForaGanttMesAtual: number
  fonte: "mtd_resumo_liberacao" | "fallback"
}

// Formato de cada item de /overview/lotes-descartados-ano -- lista oficial
// validada pelo PCP (mesma fonte rápida e correta já usada na Liberação
// Executiva pra essa parte específica) + quantidade da SD3.
interface ItemDesvioAno {
  lote: string
  nc?: string | null
  motivo?: string | null
  destino?: string | null
  qtd_cx: number
}

// Formato de cada item de /overview/rendimento-ano -- planejado (Gantt/MPS)
// vs liberado (SD3), lote a lote, ano inteiro. delta_cx > 0 = ganho, < 0 = perda.
interface ItemRendimentoAno {
  lote: string
  qtd_planejada_cx: number
  qtd_liberada_cx: number
  delta_cx: number
}

interface PrevistoHojeItem { grupo: string; previsto_ate_hoje: number; realizado_mtd: number }
interface UltimaAtualizacaoPayload { base_id: string; ultima_atualizacao: string | null }

const OVERVIEW_PAGE_CACHE_KEY = "dfl-overview-page-cache-v4-memory-versioned"
// Importante: a Overview não pode usar snapshot persistido no navegador.
// Número operacional precisa ser igual em aba normal, aba anônima e outros PCs.
// Para navegação dentro da própria sessão, usamos cache APENAS em memória do app.
// Isso evita recarregar tudo ao sair/voltar da página sem prender outro computador em dado velho.

type OverviewPageSnapshot = {
  savedAt: number
  version: string | null
  cacheAtualizadoEm?: string | null
  orcadoLib: { total_caixas: number; total_tubetes: number } | null
  orcadoFat: { total_caixas: number } | null
  projFat: ProjFat | null
  projLib: ProjLib | null
  estoqueJan: number
  previstoHoje: number
  realMtd: number
  detalhePrevistoHoje: PrevistoHojeItem[]
  disponibilidadeMensal?: DisponibilidadePayload | null
  ultimaAtualizacao: string | null
  mtdCxPrevisto: number
  mtdCxLiberado: number
}

function isOverviewSnapshotCompleto(snapshot: OverviewPageSnapshot | null): snapshot is OverviewPageSnapshot {
  return Boolean(
    snapshot &&
    snapshot.version &&
    snapshot.orcadoLib &&
    snapshot.orcadoFat &&
    snapshot.projFat &&
    snapshot.projLib
  )
}

function limparCachesOperacionaisLocais() {
  try {
    if (typeof window === "undefined") return

    const termos = [
      "overview",
      "resumo",
      "rastreamento",
      "lotes",
      "liberacao",
      "liberação",
      "disponibilidade",
      "mps",
      "mrp",
      "gantt",
    ]

    const deveRemover = (key: string) => {
      const k = key.toLowerCase()
      return key === OVERVIEW_PAGE_CACHE_KEY || termos.some((termo) => k.includes(termo))
    }

    Object.keys(window.localStorage)
      .filter(deveRemover)
      .forEach((key) => window.localStorage.removeItem(key))

    // Não limpamos sessionStorage aqui: a v71 usa um cache de sessão
    // versionado e validado pelo backend para voltar rápido à Overview.
    // Caches antigos persistentes continuam sendo removidos do localStorage.

    if ("caches" in window) {
      window.caches
        .keys()
        .then((keys) => keys.forEach((key) => window.caches.delete(key)))
        .catch(() => undefined)
    }
  } catch {
    // Cache local é só acelerador. Se falhar, não bloqueia a tela.
  }
}

let overviewPageMemoryCache: OverviewPageSnapshot | null = null
let overviewLocalStorageLimpo = false
const OVERVIEW_MEMORY_CACHE_MAX_AGE_MS = 15 * 60 * 1000
const OVERVIEW_SESSION_CACHE_KEY = "dfl-ovw-page-session-v72-tz-br"
const OVERVIEW_SESSION_CACHE_MAX_AGE_MS = 30 * 60 * 1000

function limparCacheMemoriaOverview() {
  overviewPageMemoryCache = null
}

function readOverviewSessionCache(): OverviewPageSnapshot | null {
  try {
    if (typeof window === "undefined") return null
    const raw = window.sessionStorage.getItem(OVERVIEW_SESSION_CACHE_KEY)
    if (!raw) return null

    const snapshot = JSON.parse(raw) as OverviewPageSnapshot
    if (!isOverviewSnapshotCompleto(snapshot)) return null

    const idade = Date.now() - Number(snapshot.savedAt || 0)
    if (idade > OVERVIEW_SESSION_CACHE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(OVERVIEW_SESSION_CACHE_KEY)
      return null
    }

    return snapshot
  } catch {
    return null
  }
}

function writeOverviewSessionCache(snapshot: OverviewPageSnapshot) {
  try {
    if (typeof window === "undefined") return
    window.sessionStorage.setItem(OVERVIEW_SESSION_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // sessionStorage é acelerador validado por versão; se falhar, não bloqueia.
  }
}

function limparCachesOperacionaisLocaisUmaVez() {
  if (overviewLocalStorageLimpo) return
  overviewLocalStorageLimpo = true
  limparCachesOperacionaisLocais()
}

function readOverviewPageCache(): OverviewPageSnapshot | null {
  // Não usar localStorage/sessionStorage para número operacional.
  // Só limpa legado uma vez e reaproveita snapshot em memória da sessão atual.
  limparCachesOperacionaisLocaisUmaVez()

  if (!isOverviewSnapshotCompleto(overviewPageMemoryCache)) return null

  const idade = Date.now() - Number(overviewPageMemoryCache.savedAt || 0)
  if (idade > OVERVIEW_MEMORY_CACHE_MAX_AGE_MS) {
    limparCacheMemoriaOverview()
    return null
  }

  return overviewPageMemoryCache
}

function writeOverviewPageCache(snapshot: Omit<OverviewPageSnapshot, "savedAt">) {
  // Cache em memória do app: rápido ao navegar sem recarregar.
  // Cache em sessionStorage: rápido mesmo se o roteamento fizer reload da página,
  // mas só será aplicado depois de validar a versão oficial no backend.
  overviewPageMemoryCache = {
    ...snapshot,
    savedAt: Date.now(),
  }
  writeOverviewSessionCache(overviewPageMemoryCache)
}



function clonarLinhas(linhas?: { L1?: number; L2?: number } | null) {
  return {
    L1: Number(linhas?.L1 || 0),
    L2: Number(linhas?.L2 || 0),
  }
}

function ajustarLinhasParaTotal(
  totalOficial: number,
  linhas?: { L1?: number; L2?: number } | null,
) {
  const atuais = clonarLinhas(linhas)
  const somaAtual = atuais.L1 + atuais.L2

  if (totalOficial <= 0) return { L1: 0, L2: 0 }
  if (somaAtual <= 0) return { L1: totalOficial, L2: 0 }

  const fator = totalOficial / somaAtual
  const l1 = Math.round(atuais.L1 * fator)
  const l2 = totalOficial - l1

  return { L1: l1, L2: l2 }
}

function aplicarSd3MtdOficialNaDisponibilidade(
  disponibilidade: DisponibilidadePayload | null,
  liberadoSd3MtdTotal: number,
): DisponibilidadePayload | null {
  if (!disponibilidade?.meses?.length || liberadoSd3MtdTotal <= 0) return disponibilidade

  const mesAtual = Number(disponibilidade.mes_atual || new Date().getMonth() + 1)
  let deltaMesAtual = 0
  let encontrouMesAtual = false

  const meses = disponibilidade.meses.map((mes) => {
    const numeroMes = Number(mes.mes)
    const clone: DisponibilidadeMes = {
      ...mes,
      estoque_inicio_por_grupo: [...(mes.estoque_inicio_por_grupo || [])],
      entradas_linhas: mes.entradas_linhas ? { ...mes.entradas_linhas } : mes.entradas_linhas,
      entradas_real_mes_atual_linhas: mes.entradas_real_mes_atual_linhas
        ? { ...mes.entradas_real_mes_atual_linhas }
        : mes.entradas_real_mes_atual_linhas,
      entradas_previstas_mtd_por_grupo: mes.entradas_previstas_mtd_por_grupo
        ? [...mes.entradas_previstas_mtd_por_grupo]
        : mes.entradas_previstas_mtd_por_grupo,
      entradas_real_mes_atual_por_grupo: mes.entradas_real_mes_atual_por_grupo
        ? [...mes.entradas_real_mes_atual_por_grupo]
        : mes.entradas_real_mes_atual_por_grupo,
      entradas_previstas_por_grupo_mes_atual: mes.entradas_previstas_por_grupo_mes_atual
        ? [...mes.entradas_previstas_por_grupo_mes_atual]
        : mes.entradas_previstas_por_grupo_mes_atual,
      entradas_por_grupo: mes.entradas_por_grupo ? [...mes.entradas_por_grupo] : mes.entradas_por_grupo,
      saidas_por_grupo: mes.saidas_por_grupo ? [...mes.saidas_por_grupo] : mes.saidas_por_grupo,
      saidas_real_mes_atual_por_grupo: mes.saidas_real_mes_atual_por_grupo
        ? [...mes.saidas_real_mes_atual_por_grupo]
        : mes.saidas_real_mes_atual_por_grupo,
    }

    if (numeroMes === mesAtual) {
      encontrouMesAtual = true
      const entradaAnterior = Number(
        clone.entradas_real_mes_atual ??
          (clone.entradas_tipo === "real" ? clone.entradas : 0) ??
          0,
      )
      deltaMesAtual = liberadoSd3MtdTotal - entradaAnterior

      // Não sobrescrever `entradas`/`entradas_tipo` aqui para não duplicar barra no gráfico.
      // O mês atual é exibido pela série específica `entradas_real_mes_atual_plot`.
      clone.entradas_real_mes_atual = liberadoSd3MtdTotal
      clone.entradas_real_mes_atual_linhas = ajustarLinhasParaTotal(
        liberadoSd3MtdTotal,
        clone.entradas_real_mes_atual_linhas || clone.entradas_linhas,
      )
      clone.disponibilidade_total = Number(clone.disponibilidade_total || 0) + deltaMesAtual
      clone.saldo_final = Number(clone.saldo_final || 0) + deltaMesAtual
    } else if (encontrouMesAtual && numeroMes > mesAtual && deltaMesAtual !== 0) {
      clone.estoque_inicio = Number(clone.estoque_inicio || 0) + deltaMesAtual
      clone.disponibilidade_total = Number(clone.disponibilidade_total || 0) + deltaMesAtual
      clone.saldo_final = Number(clone.saldo_final || 0) + deltaMesAtual
    }

    return clone
  })

  return {
    ...disponibilidade,
    meses,
  }
}

function calcularProjecaoLiberacoesOficial(
  projLib: ProjLib | null,
  disponibilidade: DisponibilidadePayload | null,
): ProjLib | null {
  if (!projLib || !disponibilidade?.meses?.length) return projLib

  const mesAtual = Number(disponibilidade.mes_atual || new Date().getMonth() + 1)
  let totalReal = 0
  let totalPrevisto = 0

  disponibilidade.meses.forEach((mes) => {
    const numeroMes = Number(mes.mes)
    const entrada = Number(mes.entradas || 0)

    if (numeroMes < mesAtual) {
      totalReal += entrada
    } else {
      // Mês atual (em andamento) e meses futuros entram como previsto pelo
      // plano do mês inteiro -- antes, o mês atual usava só a fração já
      // realizada (entradas_real_mes_atual), o que descartava o "resto do
      // mês" da conta e deixava esse card ~15 mil cx menor do que o modal
      // "Liberações Reais + Previstas", que sempre contou o mês atual
      // inteiro como previsto.
      totalPrevisto += entrada
    }
  })

  const totalProjetado = totalReal + totalPrevisto
  const totalOrcado = Number(projLib.total_orcado || 0)

  return {
    ...projLib,
    total_real: totalReal,
    total_previsto: totalPrevisto,
    total_projetado: totalProjetado,
    pct_atingimento: totalOrcado > 0 ? (totalProjetado / totalOrcado) * 100 : projLib.pct_atingimento,
    delta_caixas: totalOrcado > 0 ? totalProjetado - totalOrcado : projLib.delta_caixas,
    ultimo_mes_fechado: mesAtual,
  }
}

// Soma o causas-por-mês (já corrigido hoje, arredondamento em float) do ano
// inteiro numa chamada só, via /overview/causas-anuais -- endpoint novo que
// soma tudo no servidor (mesmo dado/lógica já validado hoje no Rastreamento
// de Lotes). Antes eram 7 idas e voltas do navegador, uma por mês; agora é 1.
// NUNCA usa nada de liberacao_executiva.py, que é a página instável.
type LoteReprovacaoAnual = {
  lote: string
  grupo?: string | null
  produto?: string | null
  qtd_prevista_cx: number
  qtd_perda_cx: number
  nc?: string | null
  motivo?: string | null
  setor?: string | null
  destino?: string | null
  estado?: string | null
  dias_desvio?: number | null
}

type LoteRendimentoAnual = {
  lote: string
  tipo: "ganho" | "perda"
  grupo?: string | null
  produto?: string | null
  qtd_prevista_cx: number
  qtd_liberada_cx: number
  delta_cx: number
}

type CausasAnuaisResumo = {
  atraso: number
  reprovacao: number
  perdaRendimento: number
  ganhoRendimento: number
  mesesSomados: number
  lotesReprovacao: LoteReprovacaoAnual[]
  lotesRendimento: LoteRendimentoAnual[]
}

async function fetchCausasAnuaisReais(ano: number, mesAtual: number): Promise<CausasAnuaisResumo> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 45000)

  try {
    const authHeaders = await getAuthHeaders()
    const response = await fetch(
      `${API_BASE}/overview/causas-anuais?ano=${ano}&mes_atual=${mesAtual}&_t=${Date.now()}`,
      { headers: { ...authHeaders }, signal: controller.signal },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()

    return {
      atraso: 0, // calculado como residual na tela (V1 - atual - reprovação - perda + ganho)
      reprovacao: Math.round(Number(json?.reprovacao_desvio_cx || 0)),
      perdaRendimento: Math.round(Number(json?.perda_rendimento_cx || 0)),
      ganhoRendimento: Math.round(Number(json?.ganho_rendimento_cx || 0)),
      mesesSomados: Number(json?.meses_somados || 0),
      lotesReprovacao: Array.isArray(json?.lotes_reprovacao) ? json.lotes_reprovacao : [],
      lotesRendimento: Array.isArray(json?.lotes_rendimento) ? json.lotes_rendimento : [],
    }
  } catch {
    return {
      atraso: 0,
      reprovacao: 0,
      perdaRendimento: 0,
      ganhoRendimento: 0,
      mesesSomados: 0,
      lotesReprovacao: [],
      lotesRendimento: [],
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function ModalPerdasDesvioAno({
  open,
  onClose,
  itens,
  totalCx,
}: {
  open: boolean
  onClose: () => void
  itens: ItemDesvioAno[]
  totalCx: number | null
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Perdas por desvio (ano)
            </p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              Lotes descartados/reprovados — Jan até hoje
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {itens.length} NC{itens.length === 1 ? "" : "s"}, {fmt(totalCx || 0)} cx no total. Mesma fonte da página de Desvios.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-lg transition hover:bg-black/5" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="overflow-auto p-5">
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#F8FAFC" }}>
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>NC</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Lote</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Motivo</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Caixas</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Destino</th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && (
                  <tr><td className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)" }} colSpan={5}>Nenhum lote descartado/reprovado no período.</td></tr>
                )}
                {itens.map((item) => (
                  <tr key={item.lote} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{item.nc || "—"}</td>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{item.lote}</td>
                    <td className="max-w-[360px] px-3 py-2" style={{ color: "var(--text-secondary)" }}>{item.motivo || "—"}</td>
                    <td className="px-3 py-2 text-right font-bold whitespace-nowrap" style={{ color: "#DC2626" }}>{fmt(item.qtd_cx)} cx</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{item.destino || "—"}</td>
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

function ModalRendimentoAno({
  open,
  onClose,
  itens,
  ganhoCx,
  perdaCx,
}: {
  open: boolean
  onClose: () => void
  itens: ItemRendimentoAno[]
  ganhoCx: number | null
  perdaCx: number | null
}) {
  if (!open) return null

  const lotesGanho = itens.filter((i) => i.delta_cx > 0)
  const lotesPerda = itens.filter((i) => i.delta_cx < 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Detalhe da cascata anual
            </p>
            <h2 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              Ganho e perda de rendimento
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Planejado no Gantt/MPS vs liberado na SD3, lote a lote (ano até hoje).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-lg transition hover:bg-black/5" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="overflow-auto p-5">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "#F0FDF4" }}>
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Ganho ({lotesGanho.length} lotes)</p>
              <p className="text-lg font-bold" style={{ color: "#16A34A" }}>+{fmt(ganhoCx || 0)} cx</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "#F9FAFB" }}>
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Perda ({lotesPerda.length} lotes)</p>
              <p className="text-lg font-bold" style={{ color: "#6B7280" }}>-{fmt(perdaCx || 0)} cx</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead style={{ background: "#F8FAFC" }}>
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Lote</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Previsto (Gantt)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Liberado (SD3)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: "var(--text-secondary)" }}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && (
                  <tr><td className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)" }} colSpan={4}>Nenhum ganho/perda de rendimento no período.</td></tr>
                )}
                {itens.map((item) => (
                  <tr key={item.lote} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{item.lote}</td>
                    <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(item.qtd_planejada_cx)} cx</td>
                    <td className="px-3 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{fmt(item.qtd_liberada_cx)} cx</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: item.delta_cx >= 0 ? "#16A34A" : "#6B7280" }}>
                      {item.delta_cx >= 0 ? "+" : ""}{fmt(item.delta_cx)} cx
                    </td>
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

export function OverviewPage() {
  const [cacheInicial] = useState<OverviewPageSnapshot | null>(() => readOverviewPageCache())

  // Seletor Clássico/Executivo -- em teste, não comunicado ainda ao time.
  // Default sempre "classico": ninguém deve ver a versão nova sem escolher.
  // Não persiste entre sessões de propósito (cada abertura começa no Clássico).
  const [versaoOverview, setVersaoOverview] = useState<"classico" | "executivo">("classico")

  const [modalLib, setModalLib]               = useState(false)
  const [modalFatOrc, setModalFatOrc]         = useState(false)
  const [modalFatProj, setModalFatProj]       = useState(false)
  const [modalLibProj, setModalLibProj]       = useState(false)
  const [modalPrevistoHoje, setModalPrevistoHoje] = useState(false)
  // Perdas por desvio (ano) -- card só informativo (sem modal), buscando
  // direto do endpoint da própria página de Desvios, que já é rápido (uma
  // consulta simples agrupada por NC, sem recalcular rastreamento de 12
  // meses como a tentativa anterior fazia).
  const [perdasDesvioAnoCx, setPerdasDesvioAnoCx] = useState<number | null>(null)
  const [perdasDesvioAnoLotes, setPerdasDesvioAnoLotes] = useState<number | null>(null)
  const [carregandoPerdasDesvioAno, setCarregandoPerdasDesvioAno] = useState(false)
  const [perdasDesvioAnoItens, setPerdasDesvioAnoItens] = useState<ItemDesvioAno[]>([])
  const [modalPerdasDesvioAno, setModalPerdasDesvioAno] = useState(false)
  const [atendimentoAberto, setAtendimentoAberto] = useState(false)
  const [carregarDetalhes, setCarregarDetalhes] = useState(Boolean(cacheInicial))
  const [versaoCarregada, setVersaoCarregada] = useState<string | null>(cacheInicial?.version ?? null)
  const [cacheAtualizadoEmCarregado, setCacheAtualizadoEmCarregado] = useState<string | null>(cacheInicial?.cacheAtualizadoEm ?? null)
  const [atualizandoAutomatico, setAtualizandoAutomatico] = useState(false)

  const [orcadoLib, setOrcadoLib]             = useState<{ total_caixas: number; total_tubetes: number } | null>(cacheInicial?.orcadoLib ?? null)
  const [orcadoFat, setOrcadoFat]             = useState<{ total_caixas: number } | null>(cacheInicial?.orcadoFat ?? null)
  const [projFat, setProjFat]                 = useState<ProjFat | null>(cacheInicial?.projFat ?? null)
  const [projLib, setProjLib]                 = useState<ProjLib | null>(cacheInicial?.projLib ?? null)
  const [estoqueJan, setEstoqueJan]           = useState(cacheInicial?.estoqueJan ?? 0)
  const [previstoHoje, setPrevistoHoje]       = useState(cacheInicial?.previstoHoje ?? 0)
  const [realMtd, setRealMtd]                 = useState(cacheInicial?.realMtd ?? 0)
  const [detalhePrevistoHoje, setDetalhePrevistoHoje] = useState<PrevistoHojeItem[]>(cacheInicial?.detalhePrevistoHoje ?? [])
  const [disponibilidadeMensal, setDisponibilidadeMensal] = useState<DisponibilidadePayload | null>((cacheInicial as any)?.disponibilidadeMensal ?? null)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(cacheInicial?.ultimaAtualizacao ?? null)
  const [mtdCxPrevisto, setMtdCxPrevisto] = useState<number>(cacheInicial?.mtdCxPrevisto ?? 0)
  const [mtdCxLiberado, setMtdCxLiberado] = useState<number>(cacheInicial?.mtdCxLiberado ?? 0)
  const [mtdLiberacaoOficial, setMtdLiberacaoOficial] = useState<RastreamentoMtdLoadPayload | null>(null)

  const jaBuscouPerdasDesvioAnoRef = useRef(false)

  useEffect(() => {
    // Reescrito do zero pra eliminar de vez a race condition anterior:
    // sem "ativo"/cleanup cancelando a busca, sem estado de loading na
    // lista de dependências. Um ref garante que só dispara uma vez, e um
    // timeout de 15s garante que NUNCA fica preso em "Carregando..." pra
    // sempre, não importa o que aconteça (erro de rede, auth travado etc.).
    if (versaoOverview !== "executivo") return
    if (jaBuscouPerdasDesvioAnoRef.current) return
    jaBuscouPerdasDesvioAnoRef.current = true

    const ano = new Date().getFullYear()
    setCarregandoPerdasDesvioAno(true)

    const buscaComTimeout = Promise.race([
      (async () => {
        const authHeaders = await getAuthHeaders()
        const response = await fetch(
          `${API_BASE}/overview/lotes-descartados-ano?ano=${ano}&_t=${Date.now()}`,
          { headers: { ...authHeaders } },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout de 15s")), 15000)),
    ])

    buscaComTimeout
      .then((json: any) => {
        const itens = Array.isArray(json?.itens) ? json.itens : []
        setPerdasDesvioAnoCx(Math.round(Number(json?.total_cx || 0)))
        setPerdasDesvioAnoLotes(Math.round(Number(json?.qtd_lotes || itens.length || 0)))
        setPerdasDesvioAnoItens(itens)
      })
      .catch((erro: unknown) => {
        console.error("Falha ao buscar Perdas por desvio (ano):", erro)
        setPerdasDesvioAnoCx(0)
        setPerdasDesvioAnoLotes(0)
      })
      .finally(() => {
        setCarregandoPerdasDesvioAno(false)
      })
  }, [versaoOverview])

  const [rendimentoGanhoCx, setRendimentoGanhoCx] = useState<number | null>(null)
  const [rendimentoPerdaCx, setRendimentoPerdaCx] = useState<number | null>(null)
  const [rendimentoItens, setRendimentoItens] = useState<ItemRendimentoAno[]>([])
  const [carregandoRendimentoAno, setCarregandoRendimentoAno] = useState(false)
  const [modalRendimentoAno, setModalRendimentoAno] = useState(false)
  const jaBuscouRendimentoAnoRef = useRef(false)

  useEffect(() => {
    // Mesmo padrão à prova de falhas do card de desvios: ref pra disparar
    // só uma vez, timeout garantido, sem estado de loading nas dependências.
    if (versaoOverview !== "executivo") return
    if (jaBuscouRendimentoAnoRef.current) return
    jaBuscouRendimentoAnoRef.current = true

    const ano = new Date().getFullYear()
    setCarregandoRendimentoAno(true)

    const buscaComTimeout = Promise.race([
      (async () => {
        const authHeaders = await getAuthHeaders()
        const response = await fetch(
          `${API_BASE}/overview/rendimento-ano?ano=${ano}&_t=${Date.now()}`,
          { headers: { ...authHeaders } },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout de 15s")), 15000)),
    ])

    buscaComTimeout
      .then((json: any) => {
        const itens = Array.isArray(json?.itens) ? json.itens : []
        setRendimentoGanhoCx(Math.round(Number(json?.ganho_cx || 0)))
        setRendimentoPerdaCx(Math.round(Number(json?.perda_cx || 0)))
        setRendimentoItens(itens)
      })
      .catch((erro: unknown) => {
        console.error("Falha ao buscar Rendimento (ano):", erro)
        setRendimentoGanhoCx(0)
        setRendimentoPerdaCx(0)
      })
      .finally(() => {
        setCarregandoRendimentoAno(false)
      })
  }, [versaoOverview])

  useEffect(() => {
    limparCachesOperacionaisLocaisUmaVez()
  }, [])

  function aplicarResumo(resumo: OverviewResumoResponse) {
    const resumoAny = resumo as OverviewResumoResponse & { stale?: boolean; cache_atual?: boolean; cache_versao?: string | null }

    // Segurança executiva: a Overview nunca deve aplicar snapshot antigo.
    // Se algum backend antigo ainda devolver stale=true, não pinta a tela com número velho
    // (ex.: estoque inicial Jul/26 1.569 projetado em vez do oficial recalculado).
    if (resumoAny.stale || resumoAny.cache_atual === false) {
      setAtualizandoAutomatico(true)
      setCarregarDetalhes(false)
      return
    }

    const payload = resumo.payload || {}

    const orcadoLibPayload = (payload.orcado_liberacao || null) as { total_caixas: number; total_tubetes: number } | null
    const orcadoFatPayload = (payload.orcado_faturamento || null) as { total_caixas: number } | null
    const projFatPayload = (payload.projecao_faturamento || null) as ProjFat | null
    const projLibPayload = (payload.projecao_liberacoes || null) as ProjLib | null
    const estoqueMensal = (payload.estoque_mensal || []) as EstoqueMes[]
    const disponibilidadePayload = (payload.disponibilidade_mensal || null) as DisponibilidadePayload | null

    const jan = estoqueMensal.find((m) => Number(m.mes) === 1)
    const novoEstoqueJan = Number(jan?.qtd_caixas || 0)

    let novoRealMtd = 0
    let novoPrevistoHoje = 0
    let novoDetalhePrevistoHoje: PrevistoHojeItem[] = []

    setDisponibilidadeMensal(disponibilidadePayload)

    if (disponibilidadePayload) {
      const mesAtual = disponibilidadePayload.meses?.find((m) => Number(m.mes) === Number(disponibilidadePayload.mes_atual))
      novoRealMtd = Number(mesAtual?.entradas_real_mes_atual || 0)
      novoPrevistoHoje = Number(disponibilidadePayload.entradas_previstas_mtd || 0)

      const previstoGrupos = disponibilidadePayload.entradas_previstas_mtd_por_grupo || mesAtual?.entradas_previstas_mtd_por_grupo || []
      const realGrupos = mesAtual?.entradas_real_mes_atual_por_grupo || []
      const realMap = new Map<string, number>()
      realGrupos.forEach((g) => realMap.set(g.grupo, Number(g.qtd_caixas || 0)))

      novoDetalhePrevistoHoje = previstoGrupos.map((g) => ({
        grupo: g.grupo,
        previsto_ate_hoje: Number(g.qtd_caixas || 0),
        realizado_mtd: Number(realMap.get(g.grupo) || 0),
      }))
    }

    const ultima = resumo.ultima_atualizacao || payload.ultima_atualizacao || null
    const cacheAtualizadoEm = (resumo as any).atualizado_em || null

    setVersaoCarregada(resumo.versao_base)
    setCacheAtualizadoEmCarregado(cacheAtualizadoEm)
    setOrcadoLib(orcadoLibPayload)
    setOrcadoFat(orcadoFatPayload)
    setProjFat(projFatPayload)
    setProjLib(projLibPayload)
    setEstoqueJan(novoEstoqueJan)
    setPrevistoHoje(novoPrevistoHoje)
    setRealMtd(novoRealMtd)
    setDetalhePrevistoHoje(novoDetalhePrevistoHoje)
    setUltimaAtualizacao(ultima)

    writeOverviewPageCache({
      version: resumo.versao_base,
      cacheAtualizadoEm,
      orcadoLib: orcadoLibPayload,
      orcadoFat: orcadoFatPayload,
      projFat: projFatPayload,
      projLib: projLibPayload,
      estoqueJan: novoEstoqueJan,
      previstoHoje: novoPrevistoHoje,
      realMtd: novoRealMtd,
      detalhePrevistoHoje: novoDetalhePrevistoHoje,
      disponibilidadeMensal: disponibilidadePayload,
      ultimaAtualizacao: ultima,
      mtdCxPrevisto,
      mtdCxLiberado,
    })

    window.setTimeout(() => setCarregarDetalhes(true), 150)
  }

  function aplicarSnapshotSessao(snapshot: OverviewPageSnapshot) {
    setVersaoCarregada(snapshot.version)
    setCacheAtualizadoEmCarregado(snapshot.cacheAtualizadoEm ?? null)
    setOrcadoLib(snapshot.orcadoLib)
    setOrcadoFat(snapshot.orcadoFat)
    setProjFat(snapshot.projFat)
    setProjLib(snapshot.projLib)
    setEstoqueJan(Number(snapshot.estoqueJan || 0))
    setPrevistoHoje(Number(snapshot.previstoHoje || 0))
    setRealMtd(Number(snapshot.realMtd || 0))
    setDetalhePrevistoHoje(snapshot.detalhePrevistoHoje || [])
    setDisponibilidadeMensal(snapshot.disponibilidadeMensal ?? null)
    setUltimaAtualizacao(snapshot.ultimaAtualizacao ?? null)
    setMtdCxPrevisto(Number(snapshot.mtdCxPrevisto || 0))
    setMtdCxLiberado(Number(snapshot.mtdCxLiberado || 0))
    setCarregarDetalhes(true)
  }

  useEffect(() => {
    let alive = true
    let intervalId: number | null = null

    async function verificarEAtualizar(silencioso = false) {
      try {
        if (silencioso) {
          setAtualizandoAutomatico(true)
        }

        const versao = await getOverviewResumoVersao()

        if (!alive) return

        const ultima = versao.ultima_atualizacao || null
        setUltimaAtualizacao(ultima)

        const cacheAtualizadoEmBackend = (versao as any).cache_atualizado_em || null
        const precisaRecalcular = Boolean((versao as any).precisa_recalcular || (versao as any).cache_desatualizado)
        const telaAtualCompleta = Boolean(orcadoLib && orcadoFat && projFat && projLib)

        // Se a versão e o timestamp do snapshot são os mesmos que já estão na tela,
        // não refaz nenhuma chamada pesada.
        if (
          !precisaRecalcular &&
          versaoCarregada === versao.versao_base &&
          cacheAtualizadoEmCarregado === cacheAtualizadoEmBackend &&
          telaAtualCompleta
        ) {
          if (!carregarDetalhes) {
            window.setTimeout(() => {
              if (alive) setCarregarDetalhes(true)
            }, 500)
          }
          return
        }

        // Se a página sofreu reload ao trocar de rota, recupera o snapshot da aba
        // SOMENTE depois de validar versão/timestamp contra o backend.
        // Assim volta rápido sem mostrar dado antigo de outro upload/base.
        const cacheSessao = readOverviewSessionCache()
        if (
          !precisaRecalcular &&
          isOverviewSnapshotCompleto(cacheSessao) &&
          cacheSessao.version === versao.versao_base &&
          (cacheSessao.cacheAtualizadoEm ?? null) === cacheAtualizadoEmBackend
        ) {
          aplicarSnapshotSessao(cacheSessao)
          return
        }

        if (precisaRecalcular) {
          // Verificações silenciosas (a cada 60s, ou ao voltar o foco na aba)
          // nunca devem esconder o gráfico/Rastreamento que já está na tela.
          // Só a carga inicial (silencioso = false) pode partir de um estado
          // "Preparando gráfico...". Sem essa checagem, toda vez que alguém
          // em outro PC atualizava uma base, o gráfico sumia e reaparecia
          // sozinho pra quem já estava com a tela aberta.
          if (!silencioso) {
            setCarregarDetalhes(false)
          }
          setAtualizandoAutomatico(true)
        }

        const resumo = await getOverviewResumo(versao.versao_base)

        if (!alive) return

        aplicarResumo(resumo)
      } catch {
        // Mantém os dados atuais/cache local visíveis se a checagem falhar.
        if (alive && !carregarDetalhes) {
          window.setTimeout(() => setCarregarDetalhes(true), 150)
        }
      } finally {
        if (alive) {
          setAtualizandoAutomatico(false)
        }
      }
    }

    void verificarEAtualizar(false)

    // Atualização automática entre PCs:
    // a cada 60s consulta só /overview/resumo/versao, que é leve.
    // Só busca /overview/resumo quando a versão da base mudou.
    intervalId = window.setInterval(() => {
      void verificarEAtualizar(true)
    }, 60 * 1000)

    const atualizarAoVoltarParaAba = () => {
      if (!document.hidden) {
        void verificarEAtualizar(true)
      }
    }

    window.addEventListener("focus", atualizarAoVoltarParaAba)
    document.addEventListener("visibilitychange", atualizarAoVoltarParaAba)

    return () => {
      alive = false
      if (intervalId) window.clearInterval(intervalId)
      window.removeEventListener("focus", atualizarAoVoltarParaAba)
      document.removeEventListener("visibilitychange", atualizarAoVoltarParaAba)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoCarregada, cacheAtualizadoEmCarregado, orcadoLib, orcadoFat, projFat, projLib, carregarDetalhes])



  const disponibilidadeMensalOficial = useMemo(
    () => aplicarSd3MtdOficialNaDisponibilidade(disponibilidadeMensal, mtdLiberacaoOficial?.liberadoSd3MtdTotal ?? mtdCxLiberado),
    [disponibilidadeMensal, mtdLiberacaoOficial?.liberadoSd3MtdTotal, mtdCxLiberado],
  )

  const projLibBase = useMemo(
    () => calcularProjecaoLiberacoesOficial(projLib, disponibilidadeMensalOficial),
    [projLib, disponibilidadeMensalOficial],
  )

  const orcadoLibPlano1JanV3 = useMemo(
    () => ({
      total_caixas: ORCADO_LIBERACAO_ANUAL_PLANO1_JAN_V3_CX,
      total_tubetes: tubetes(ORCADO_LIBERACAO_ANUAL_PLANO1_JAN_V3_CX),
    }),
    [],
  )

  const projLibOficial = useMemo(() => {
    if (!projLibBase) return null

    const totalOrcado = orcadoLibPlano1JanV3.total_caixas

    return {
      ...projLibBase,
      total_orcado: totalOrcado,
      pct_atingimento: totalOrcado > 0 ? (projLibBase.total_projetado / totalOrcado) * 100 : projLibBase.pct_atingimento,
      delta_caixas: totalOrcado > 0 ? projLibBase.total_projetado - totalOrcado : projLibBase.delta_caixas,
    }
  }, [projLibBase, orcadoLibPlano1JanV3.total_caixas])

  const pctFat = projFat?.pct_atingimento ?? 0
  const pctLib = projLibOficial?.pct_atingimento ?? 0
  const ultimoMesFat = projFat ? MES_LABELS[(projFat.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""
  const ultimoMesLib = projLibOficial ? MES_LABELS[(projLibOficial.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""
  const corPctFat = pctFat >= 100 ? "#16A34A" : pctFat >= 95 ? "#F59E0B" : pctFat > 0 ? "#DC2626" : "var(--text-primary)"
  const corPctLib = pctLib >= 100 ? "#16A34A" : pctLib >= 95 ? "#F59E0B" : pctLib > 0 ? "#DC2626" : "var(--text-primary)"
  const disponibilidadeAnual = projLibOficial ? projLibOficial.total_projetado + estoqueJan : 0
  const pctDispVsFat = projLibOficial && orcadoFat && orcadoFat.total_caixas > 0 ? (disponibilidadeAnual / orcadoFat.total_caixas) * 100 : 0
  const gapDispVsFatCaixas = projLibOficial && orcadoFat ? disponibilidadeAnual - orcadoFat.total_caixas : 0
  const corDispVsFat = pctDispVsFat >= 100 ? "#16A34A" : pctDispVsFat >= 95 ? "#F59E0B" : pctDispVsFat > 0 ? "#DC2626" : "var(--text-primary)"

  // Cascata anual (Executivo): reconstruída com o padrão robusto (ref +
  // timeout) validado no card de desvios. Reprovação vem do mesmo fetch do
  // card "Perdas por desvio (ano)" (não busca de novo); Rendimento vem de
  // /overview/rendimento-ano (Gantt vs SD3, rápido); Atraso de produção /
  // Ajuste de plano é o residual -- abertura fina disso (cruzar com Cogtive)
  // continua pendente pra uma próxima entrega, como combinado.
  const plano1BaseAnualCx = orcadoLibPlano1JanV3.total_caixas + estoqueJan
  const diferencaDispVsOrcadaCx = disponibilidadeAnual - plano1BaseAnualCx

  const waterfallSteps: WaterfallStep[] = useMemo(() => {
    if (perdasDesvioAnoCx == null || rendimentoGanhoCx == null || rendimentoPerdaCx == null || !projLibOficial) {
      return []
    }

    const diferencaAnualCx = plano1BaseAnualCx - disponibilidadeAnual
    const rendimentoLiquidoCx = rendimentoGanhoCx - rendimentoPerdaCx
    const atrasoAjustePlanoCx = diferencaAnualCx - perdasDesvioAnoCx - rendimentoPerdaCx + rendimentoGanhoCx

    const steps: WaterfallStep[] = [
      { id: "plano1", label: "Disp. anual orçada", kind: "total", value: plano1BaseAnualCx, tone: "navy" },
    ]

    if (perdasDesvioAnoCx > 0) {
      steps.push({
        id: "reprovacao",
        label: "Reprov. lote",
        kind: "delta",
        value: -perdasDesvioAnoCx,
        tone: "orange",
        lotes: perdasDesvioAnoLotes || undefined,
      })
    }

    if (rendimentoLiquidoCx !== 0) {
      steps.push({
        id: "rendimento",
        label: rendimentoLiquidoCx >= 0 ? "Ganho rend." : "Perda rend.",
        kind: "delta",
        value: rendimentoLiquidoCx,
        tone: rendimentoLiquidoCx >= 0 ? "green" : "gray",
      })
    }

    if (Math.abs(atrasoAjustePlanoCx) > 0) {
      steps.push({
        id: "atraso-ajuste-plano",
        label: "Atraso produção / Ajuste de plano",
        kind: "delta",
        value: -atrasoAjustePlanoCx,
        tone: atrasoAjustePlanoCx > 0 ? "red" : "green",
      })
    }

    steps.push({ id: "atual", label: "Disp. atual", kind: "total", value: disponibilidadeAnual, tone: "teal" })

    return steps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perdasDesvioAnoCx, perdasDesvioAnoLotes, rendimentoGanhoCx, rendimentoPerdaCx, plano1BaseAnualCx, disponibilidadeAnual, projLibOficial])

  return (
    <div className="min-h-screen space-y-6 p-3 md:space-y-8 md:p-6">

      {/* Título */}
      <div className="fade-in flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl" style={{ color: "var(--text-primary)" }}>
            Overview - Anestésicos Injetáveis
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <CalendarDays className="h-4 w-4 text-slate-500" />

              <span className="text-sm font-medium text-slate-700">
                Dados atualizados em:
              </span>

              <span className="text-sm text-slate-500">
{ultimaAtualizacao ? formatarDataHoraAtualizacao(ultimaAtualizacao) : "--"}
              </span>

              {atualizandoAutomatico && (
                <span className="ml-2 text-xs font-semibold text-blue-500">
                  verificando atualização...
                </span>
              )}
            </div>

            {/* Botão único, muda de texto conforme a versão atual -- convida a
                experimentar em vez de listar duas opções lado a lado.
                Alterna só o layout dos cards e do gráfico de Demanda vs
                Disponibilidade; Rastreamento de Lotes e os modais continuam
                exatamente os mesmos nas duas versões. */}
            <button
              type="button"
              onClick={() => setVersaoOverview((v) => (v === "classico" ? "executivo" : "classico"))}
              title="Clique para testar a nova versão"
              className="inline-flex items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-xs font-bold shadow-sm transition"
              style={
                versaoOverview === "classico"
                  ? { borderColor: "#BFDBFE", background: "#EFF6FF", color: "#1D4ED8" }
                  : { borderColor: "var(--border)", background: "#FFFFFF", color: "var(--text-secondary)" }
              }
            >
              {versaoOverview === "classico" ? (
                <>
                  <Sparkles size={13} strokeWidth={2.25} />
                  Nova versão disponível
                  <span
                    className="ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ background: "#FEF3C7", color: "#92400E" }}
                  >
                    Beta
                  </span>
                </>
              ) : (
                <>
                  <ArrowLeft size={13} strokeWidth={2.25} />
                  Voltar para versão anterior
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {versaoOverview === "classico" && (
        <>
      {/* Faturamento */}
      <section>
        <p className="card-label mb-3 fade-in fade-in-1">Faturamento</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <KpiCard label="Orçado anual" value={orcadoFat ? `${fmt(orcadoFat.total_caixas)} cx` : "Carregando..."} sub={orcadoFat ? `${fmt(tubetes(orcadoFat.total_caixas))} tubetes` : undefined} Icon={DollarSign} iconBg="#EFF6FF" iconColor="#2563EB" onClick={() => setModalFatOrc(true)} delay={80} />
          <KpiCard label="Faturamento real + S&OP" value={projFat ? `${fmt(projFat.total_projetado)} cx` : "—"} sub={projFat ? `${fmt(tubetes(projFat.total_projetado))} tubetes` : "aguardando base"} Icon={BarChart3} iconBg="#F0FDF4" iconColor="#16A34A" onClick={projFat ? () => setModalFatProj(true) : undefined} delay={140} />
          <KpiCard label="% Atingimento" value={projFat && pctFat > 0 ? `${pctFat.toFixed(1).replace(".", ",")}%` : "—"} sub={projFat && ultimoMesFat ? `fechado até ${ultimoMesFat}/26` : undefined} delta={projFat && projFat.delta_caixas !== 0 ? `${fmt(projFat.delta_caixas)} cx / ${fmt(tubetes(projFat.delta_caixas))} tubetes vs orçado` : undefined} positive={projFat ? projFat.delta_caixas >= 0 : undefined} neutral={pctFat >= 95 && pctFat < 100} valueColor={corPctFat} Icon={TrendingUp} iconBg="#FFF7ED" iconColor="#EA580C" delay={200} />
        </div>
      </section>

      {/* Liberações */}
      <section>
        <p className="card-label mb-3 fade-in fade-in-2">Liberações</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <KpiCard label="Orçado de liberações anual" value={`${fmt(orcadoLibPlano1JanV3.total_caixas)} cx`} sub={`${fmt(orcadoLibPlano1JanV3.total_tubetes)} tubetes`} Icon={PackageCheck} iconBg="#F5F3FF" iconColor="#7C3AED" onClick={() => setModalLib(true)} delay={260} />
          <KpiCard label="Liberações reais + previstas" value={projLibOficial ? `${fmt(projLibOficial.total_projetado)} cx` : "—"} sub={projLibOficial ? `${fmt(tubetes(projLibOficial.total_projetado))} tubetes` : "aguardando base"} Icon={Package} iconBg="#F0FDF4" iconColor="#16A34A" onClick={projLibOficial ? () => setModalLibProj(true) : undefined} delay={320} />
          <KpiCard label="% Liberações vs orçado" value={projLibOficial && pctLib > 0 ? `${pctLib.toFixed(1).replace(".", ",")}%` : "—"} sub={projLibOficial && ultimoMesLib ? `fechado até ${ultimoMesLib}/26` : undefined} delta={projLibOficial && projLibOficial.delta_caixas !== 0 ? `${fmt(projLibOficial.delta_caixas)} cx / ${fmt(tubetes(projLibOficial.delta_caixas))} tubetes vs orçado` : undefined} positive={projLibOficial ? projLibOficial.delta_caixas >= 0 : undefined} neutral={pctLib >= 95 && pctLib < 100} valueColor={corPctLib} Icon={TrendingUp} iconBg="#FFF7ED" iconColor="#EA580C" delay={380} />
        </div>
      </section>

      {/* Atingimento ao orçado */}
      <section className="fade-in fade-in-3">
        <p className="card-label mb-3">Atingimento ao orçado</p>
        <div className="card flex flex-col gap-5 p-4 md:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="card-label mb-1">Disponibilidade anual / Orçado faturamento</p>
            <p className="text-2xl font-bold md:text-3xl" style={{ color: corDispVsFat }}>
              {pctDispVsFat > 0 ? `${pctDispVsFat.toFixed(1).replace(".", ",")}%` : "—"}
            </p>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>Liberações reais + previstas + estoque inicial de Jan</p>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:min-w-[980px] xl:grid-cols-5 xl:gap-4">
            {[
              { label: "Disponibilidade anual", value: projLibOficial ? `${fmt(disponibilidadeAnual)} cx` : "—", sub: projLibOficial ? `${fmt(tubetes(disponibilidadeAnual))} tubetes` : "—", w: 700 },
              { label: "Liberações", value: projLibOficial ? `${fmt(projLibOficial.total_projetado)} cx` : "—", sub: projLibOficial ? `${fmt(tubetes(projLibOficial.total_projetado))} tubetes` : "—", w: 600 },
              { label: "Estoque inicial Jan", value: `${fmt(estoqueJan)} cx`, sub: `${fmt(tubetes(estoqueJan))} tubetes`, w: 600 },
              { label: "Orçado faturamento", value: orcadoFat ? `${fmt(orcadoFat.total_caixas)} cx` : "—", sub: orcadoFat ? `${fmt(tubetes(orcadoFat.total_caixas))} tubetes` : "—", w: 600 },
              { label: "Gap", value: projLibOficial && orcadoFat ? `${fmt(gapDispVsFatCaixas)} cx` : "—", sub: projLibOficial && orcadoFat ? `${fmt(tubetes(gapDispVsFatCaixas))} tubetes` : "—", w: 600, gap: true },
            ].map(k => (
              <div key={k.label}>
                <p className="card-label mb-1">{k.label}</p>
                <p style={{ color: k.gap ? (gapDispVsFatCaixas >= 0 ? "#16A34A" : "#DC2626") : "var(--text-primary)", fontWeight: k.w }}>{k.value}</p>
                <p style={{ color: k.gap ? (gapDispVsFatCaixas >= 0 ? "#16A34A" : "#DC2626") : "var(--text-secondary)" }}>{k.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
        </>
      )}

      {versaoOverview === "executivo" && (
        <section className="fade-in">
          <p className="card-label mb-3">Indicadores — visão executiva</p>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            }}
          >
            {[
              {
                label: "Orçado faturamento",
                value: orcadoFat ? `${fmt(orcadoFat.total_caixas)} cx` : "—",
                sub: orcadoFat ? `${fmt(tubetes(orcadoFat.total_caixas))} tubetes` : "—",
                icon: DollarSign,
                color: "#2563EB",
                onClick: () => setModalFatOrc(true),
              },
              {
                label: "Faturamento real + S&OP",
                value: projFat ? `${fmt(projFat.total_projetado)} cx` : "—",
                sub: projFat ? `${fmt(tubetes(projFat.total_projetado))} tubetes` : "aguardando base",
                icon: BarChart3,
                color: "#16A34A",
                onClick: projFat ? () => setModalFatProj(true) : undefined,
              },
              {
                label: "Disponibilidade anual orçada",
                value: `${fmt(plano1BaseAnualCx)} cx`,
                sub: `${fmt(tubetes(plano1BaseAnualCx))} tubetes`,
                icon: PackageCheck,
                color: "#7C3AED",
                onClick: () => setModalLib(true),
              },
              {
                label: "Disponibilidade atual",
                value: projLibOficial ? `${fmt(disponibilidadeAnual)} cx` : "—",
                sub: projLibOficial ? `${fmt(tubetes(disponibilidadeAnual))} tubetes` : "aguardando base",
                icon: Package,
                color: "#0F766E",
                onClick: projLibOficial ? () => setModalLibProj(true) : undefined,
              },
              {
                label: "Diferença vs. disp. orçada",
                value: projLibOficial ? `${diferencaDispVsOrcadaCx >= 0 ? "+" : "-"}${fmt(Math.abs(diferencaDispVsOrcadaCx))} cx` : "—",
                sub: projLibOficial ? `${diferencaDispVsOrcadaCx >= 0 ? "+" : "-"}${fmt(tubetes(Math.abs(diferencaDispVsOrcadaCx)))} tubetes` : "—",
                icon: TrendingDown,
                color: diferencaDispVsOrcadaCx >= 0 ? "#16A34A" : "#DC2626",
                onClick: undefined,
              },
              {
                label: "% Atingimento ao orçado",
                value: pctDispVsFat > 0 ? `${pctDispVsFat.toFixed(1).replace(".", ",")}%` : "—",
                sub: "Disponibilidade / orçado",
                icon: Gauge,
                color: corDispVsFat === "var(--text-primary)" ? "#6B7280" : corDispVsFat,
                onClick: undefined,
                destaque: true,
              },
              {
                label: "Perdas por desvio (ano)",
                value: perdasDesvioAnoCx != null ? `${fmt(perdasDesvioAnoCx)} cx` : (carregandoPerdasDesvioAno ? "Carregando..." : "—"),
                sub: perdasDesvioAnoLotes != null ? `${perdasDesvioAnoLotes} lote${perdasDesvioAnoLotes === 1 ? "" : "s"} descartado${perdasDesvioAnoLotes === 1 ? "" : "s"}` : "Jan até hoje",
                icon: AlertTriangle,
                color: "#DC2626",
                onClick: perdasDesvioAnoCx != null ? () => setModalPerdasDesvioAno(true) : undefined,
              },
            ].map((k, idx) => (
              <button
                key={k.label}
                type="button"
                disabled={!k.onClick}
                onClick={k.onClick}
                className="relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md"
                style={
                  (k as any).destaque
                    ? { borderColor: k.color, borderWidth: 1.5, background: `${k.color}0D`, cursor: k.onClick ? "pointer" : "default" }
                    : { borderColor: "var(--border)", background: "#FFFFFF", cursor: k.onClick ? "pointer" : "default" }
                }
              >
                <k.icon
                  size={56}
                  strokeWidth={1.5}
                  style={{ position: "absolute", right: -8, bottom: -12, color: k.color, opacity: 0.06, pointerEvents: "none" }}
                />
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl"
                    style={{ background: `${k.color}17`, animationDelay: `${idx * 60}ms` }}
                  >
                    <k.icon size={20} strokeWidth={2.25} style={{ color: k.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      {k.label}
                    </p>
                    <p className="truncate text-lg font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
                      {k.value}
                    </p>
                    <p className="truncate text-[11px] font-medium" style={{ color: "var(--text-muted, var(--text-secondary))" }}>
                      {k.sub}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border bg-white shadow-sm" style={{ borderColor: "var(--border)" }}>
            <div className="px-5 pt-4 text-center">
              <p className="text-[13px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
                Causas da variação anual
              </p>
            </div>

            {waterfallSteps.length > 0 ? (
              <WaterfallChart
                steps={waterfallSteps}
                maxReference={orcadoFat?.total_caixas || 0}
                onStepClick={(id) => {
                  if (id === "reprovacao") setModalPerdasDesvioAno(true)
                  if (id === "rendimento") setModalRendimentoAno(true)
                }}
              />
            ) : (
              <div className="px-6 pb-5 pt-4">
                <div
                  className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                  style={{ borderColor: "var(--border)", background: "#F8FAFC" }}
                >
                  <div className="h-2 w-2 shrink-0 rounded-full bg-slate-300" style={{ animation: (carregandoPerdasDesvioAno || carregandoRendimentoAno) ? "pulse 1.5s ease-in-out infinite" : undefined }} />
                  <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {(carregandoPerdasDesvioAno || carregandoRendimentoAno)
                      ? "Buscando as causas do ano..."
                      : "Sem causas classificadas o suficiente para montar a cascata ainda."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Demanda vs Disponibilidade */}
      <section className="fade-in fade-in-4">
        <p className="card-label mb-3">Demanda vs. Disponibilidade mensal</p>
        <div className="overflow-x-auto rounded-2xl">
          <div className="min-w-[860px] md:min-w-0">
            {carregarDetalhes ? (
              <DemandaDisponibilidadeChart initialData={disponibilidadeMensalOficial} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm font-medium text-slate-400">
                Preparando gráfico...
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          {carregarDetalhes ? (
            <RastreamentoLotes onMtdLoad={(p: number, l: number, detalhes?: RastreamentoMtdLoadPayload) => {
              const liberadoOficial = Number(detalhes?.liberadoSd3MtdTotal ?? l ?? 0)

              setMtdCxPrevisto(Number(detalhes?.previstoAteHoje ?? p ?? 0))
              setMtdCxLiberado(liberadoOficial)
              setMtdLiberacaoOficial(detalhes ?? {
                previstoAteHoje: Number(p ?? 0),
                liberadoSd3MtdTotal: liberadoOficial,
                liberadoVinculadoLotesPrevistos: Number(l ?? 0),
                liberadoSd3ForaGanttMesAtual: 0,
                fonte: "fallback",
              })

              // Não persistir MTD no navegador. O valor oficial precisa vir sempre do SD3 total.
            }} />
          ) : null}
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setAtendimentoAberto((v) => !v)}
            className="flex w-full items-center justify-between gap-4 bg-[#183C62] px-5 py-4 text-left text-white transition hover:bg-[#153655]"
          >
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">Acompanhamento projetado</p>
              <p className="mt-1 text-base font-bold leading-tight">Atendimento projetado — mês atual</p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-3">
              <div className="hidden rounded-xl bg-white/10 px-3 py-2 text-right sm:block">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Previsto MTD</p>
                <p className="text-sm font-bold">{mtdCxPrevisto > 0 ? `${fmt(mtdCxPrevisto)} cx` : "—"}</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-3 py-2 text-xs font-bold uppercase tracking-wide">
                {atendimentoAberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {atendimentoAberto ? "Fechar" : "Abrir"}
              </span>
            </div>
          </button>

          {atendimentoAberto && (
            <div className="border-t border-slate-200 bg-white p-3 md:p-4">
              <GrupoDisponibilidadeTableV2 mtdCxPrevisto={mtdCxPrevisto} />
            </div>
          )}
        </div>
      </section>

      <DisponibilidadeModal open={modalLib} onClose={() => setModalLib(false)} />
      <OrcadoFaturamentoModal open={modalFatOrc} onClose={() => setModalFatOrc(false)} />
      <ProjecaoFaturamentoModal open={modalFatProj} onClose={() => setModalFatProj(false)} />
      <ProjecaoLiberacoesModal open={modalLibProj} onClose={() => setModalLibProj(false)} />
      <PrevistoAteHojeModal open={modalPrevistoHoje} onClose={() => setModalPrevistoHoje(false)} data={detalhePrevistoHoje} />
      <ModalPerdasDesvioAno
        open={modalPerdasDesvioAno}
        onClose={() => setModalPerdasDesvioAno(false)}
        itens={perdasDesvioAnoItens}
        totalCx={perdasDesvioAnoCx}
      />
      <ModalRendimentoAno
        open={modalRendimentoAno}
        onClose={() => setModalRendimentoAno(false)}
        itens={rendimentoItens}
        ganhoCx={rendimentoGanhoCx}
        perdaCx={rendimentoPerdaCx}
      />
    </div>
  )
}