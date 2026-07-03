import { useEffect, useState } from "react"
import type { ChangeEvent, ElementType, MouseEvent } from "react"
import {
  BarChart3,
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
      modal?: any
      observacao?: string
      statusCalculo?: string
    }
  | {
      id: string
      label: string
      kind: "delta"
      value: number
      tone: Tone
      clickable?: boolean
      lotes?: number
      modal?: any
      calculo?: any
      observacao?: string
      statusCalculo?: string
      lotesTipo?: string
    }

type MonthlyLossesItem = {
  mes: string
  baseline: string
  v1: number
  reorg: number
  atraso: number
  reprovacao: number
  saldo?: number

  // Nova regra do gráfico mensal:
  planoRefCx?: number
  liberadoBrutoCx?: number
  reprovadoCx?: number
  liberadoValidoCx?: number
  perdaCx?: number
  ganhoCx?: number

  status?: "fechado" | "mtd" | "futuro"
  simulado?: boolean
}

type SimulationMode = "media" | "custom"

type LiberacaoExecutivaPayload = {
  erro?: string
  mensagem?: string
  atualizadoLabel?: string
  atualizado_label?: string
  dados?: Partial<{
    orcadoFaturamentoCx: number
    faturamentoProjetadoCx: number
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

const OVERVIEW_PAGE_CACHE_KEY = "dfl-overview-page-cache-v2"

const MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
const fmtDecimal = (value: number, digits = 1) => Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })

// Plano 1 confirmado na própria ferramenta:
// MPS revisão Janeiro / V3 = 220.534 cx.
// O backend deve buscar este valor em f_mps_liberacoes; estes valores entram
// só como fallback operacional para a tela não cair no orçado da Overview.
const PLANO1_JANEIRO_V3_CX_2026 = 220_534
const ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026 = 1_016

function plano1JaneiroV3Fallback(ano: number, estoqueAtual?: number) {
  if (ano !== 2026) return null

  const estoqueInicialJanCx = Math.round(
    numero(estoqueAtual || ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026),
  )

  return {
    plano1LiberacaoCx: PLANO1_JANEIRO_V3_CX_2026,
    estoqueInicialJanCx,
    plano1BaseCx: PLANO1_JANEIRO_V3_CX_2026 + estoqueInicialJanCx,
    fonte: "fallback_operacional_mps_janeiro_v3_2026",
  }
}

function numero(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getOverviewLocalCache(): any | null {
  try {
    if (typeof window === "undefined") return null
    const raw = window.localStorage.getItem(OVERVIEW_PAGE_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function fetchJsonComTimeout(url: string, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function formatarAtualizacao(value: unknown) {
  if (!value) return undefined

  const texto = String(value)
  const dt = new Date(texto)

  if (Number.isNaN(dt.getTime())) return texto

  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", " às")
}

function estoqueJanDoPayload(payload: any) {
  const estoqueMensal = Array.isArray(payload?.estoque_mensal) ? payload.estoque_mensal : []
  const jan = estoqueMensal.find((item: any) => Number(item?.mes) === 1)
  return numero(jan?.qtd_caixas)
}

function countLotesPorCausa(rastreamento: any) {
  const lotes = Array.isArray(rastreamento?.lotes) ? rastreamento.lotes : []

  const atraso = new Set<string>()
  const reprovacao = new Set<string>()
  const rendimento = new Set<string>()
  const ganho = new Set<string>()

  lotes.forEach((item: any) => {
    const lote = String(item?.lote || item?.lote_op || item?.numero_lote || item?.op || "").trim()
    if (!lote) return

    const status = String(item?.status_gap || "").trim()

    if (item?.atraso_producao || item?.reprogramado || status === "Atraso de produção") {
      atraso.add(lote)
    }

    if (item?.desvio_reprovacao || status === "Reprovação/desvio") {
      reprovacao.add(lote)
    }

    if (item?.perda_rendimento || status === "Perda por rendimento" || numero(item?.qtd_perda_rendimento_cx) > 0) {
      rendimento.add(lote)
    }

    const previsto = numero(item?.qtd_prevista_cx)
    const liberado = numero(item?.qtd_liberada_cx)
    if (previsto > 0 && liberado > previsto) {
      ganho.add(lote)
    }
  })

  return {
    atraso: atraso.size,
    reprovacao: reprovacao.size,
    perdaRendimento: rendimento.size,
    ganhoRendimento: ganho.size,
  }
}

function withLotes(step: WaterfallStep, lotes?: number): WaterfallStep {
  if (lotes && lotes > 0) return { ...step, lotes }
  return step
}

type LoteReprovadoDetalhe = {
  lote: string
  grupo?: string
  produto?: string
  qtdPrevistaCx: number
  qtdLiberadaCx: number
  qtdPerdaCx: number
  motivo?: string
  setor?: string
  destino?: string
  estado?: string
  diasDesvio?: number
}

function listarLotesReprovados(rastreamento: any): LoteReprovadoDetalhe[] {
  const lotes = Array.isArray(rastreamento?.lotes) ? rastreamento.lotes : []
  const vistos = new Set<string>()
  const resultado: LoteReprovadoDetalhe[] = []

  lotes.forEach((item: any) => {
    const lote = String(item?.lote || item?.lote_op || item?.numero_lote || item?.op || "").trim()
    if (!lote) return

    const status = String(item?.status_gap || "").trim()
    const ehReprovado = Boolean(item?.desvio_reprovacao) || status === "Reprovação/desvio"
    if (!ehReprovado) return
    if (vistos.has(lote)) return
    vistos.add(lote)

    const qtdPrevistaCx = numero(item?.qtd_prevista_cx)
    const qtdLiberadaCx = numero(item?.qtd_liberada_cx)

    resultado.push({
      lote,
      grupo: item?.grupo || undefined,
      produto: item?.sku_pa || undefined,
      qtdPrevistaCx,
      qtdLiberadaCx,
      qtdPerdaCx: Math.max(qtdPrevistaCx - qtdLiberadaCx, 0),
      motivo: item?.desvio_titulo || item?.motivo_gap || undefined,
      setor: item?.desvio_setor || undefined,
      destino: item?.desvio_destino_consolidado || item?.desvio_destino || undefined,
      estado: item?.desvio_estado || undefined,
      diasDesvio: item?.desvio_dias != null ? numero(item.desvio_dias) : undefined,
    })
  })

  return resultado.sort((a, b) => b.qtdPerdaCx - a.qtdPerdaCx)
}

function montarWaterfallAnual(dados: Required<NonNullable<LiberacaoExecutivaPayload["dados"]>>, rastreamento: any): WaterfallStep[] {
  const plano1BaseCx = dados.plano1LiberacaoCx + dados.estoqueInicialJanCx
  const disponibilidadeAtualCx = dados.planoAtualLiberacaoCx + dados.estoqueInicialJanCx
  const causasMes = rastreamento?.mes_perdas_vs_v1_por_causa || {}
  const lotes = countLotesPorCausa(rastreamento)

  const reorg = Math.max(0, Math.round(numero(rastreamento?.mes_cx_acrescimo_plano_atual)))
  const atraso = Math.abs(Math.round(numero(causasMes?.atraso_producao)))
  const reprovacao = Math.abs(Math.round(numero(causasMes?.reprovacao_desvio)))
  const perdaRendimento = Math.abs(Math.round(numero(causasMes?.rendimento)))
  const ganhoRendimento = Math.abs(Math.round(numero(causasMes?.ganho_rendimento)))

  const gap = disponibilidadeAtualCx - plano1BaseCx
  const conhecido = reorg - atraso - reprovacao - perdaRendimento + ganhoRendimento
  const residuo = Math.round(gap - conhecido)

  const steps: WaterfallStep[] = [
    {
      id: "plano1",
      label: "Disp. anual orçada",
      kind: "total",
      value: plano1BaseCx,
      tone: "navy",
    },
  ]

  if (Math.abs(reorg) > 0) {
    steps.push({
      id: "reorganizacao",
      label: "Reorg.",
      kind: "delta",
      value: reorg,
      tone: "slate",
      clickable: true,
    })
  }

  if (Math.abs(atraso) > 0) {
    steps.push(withLotes({
      id: "atraso",
      label: "Atraso prod.",
      kind: "delta",
      value: -atraso,
      tone: "red",
    }, lotes.atraso))
  }

  if (Math.abs(reprovacao) > 0) {
    steps.push(withLotes({
      id: "reprovacao",
      label: "Reprov. lote",
      kind: "delta",
      value: -reprovacao,
      tone: "orange",
      clickable: true,
      modal: {
        titulo: "Lotes reprovados / em desvio",
        descricao: "Lotes do mês atual classificados como Reprovação/desvio, com motivo, setor e destino informados pela base de Desvios.",
        delta_cx: -reprovacao,
        lotesReprovados: listarLotesReprovados(rastreamento),
      },
    }, lotes.reprovacao))
  }

  if (Math.abs(perdaRendimento) > 0) {
    steps.push(withLotes({
      id: "rendimento",
      label: "Perda rend.",
      kind: "delta",
      value: -perdaRendimento,
      tone: "gray",
    }, lotes.perdaRendimento))
  }

  if (Math.abs(ganhoRendimento) > 0) {
    steps.push(withLotes({
      id: "ganho",
      label: "Ganho rend.",
      kind: "delta",
      value: ganhoRendimento,
      tone: "green",
    }, lotes.ganhoRendimento))
  }

  // Não jogar diferença não classificada em "Atraso prod.".
  // Se ainda não existe abertura operacional suficiente, mostra como saldo a abrir.
  if (Math.abs(residuo) > 0) {
    steps.push({
      id: "saldo-sem-abertura",
      label: "Saldo a abrir",
      kind: "delta",
      value: residuo,
      tone: residuo < 0 ? "red" : "green",
    })
  }

  steps.push({
    id: "disponibilidade",
    label: "Disp. atual",
    kind: "total",
    value: disponibilidadeAtualCx,
    tone: "teal",
  })

  return steps
}

function resumoMensalProjLib(projLib: any, mesAtual: number) {
  const linhas = Array.isArray(projLib?.linhas) ? projLib.linhas : []
  const meses = Array.isArray(projLib?.meses) ? projLib.meses : []
  const resultado: Record<number, { v1: number; atual: number }> = {}

  for (let mes = 1; mes <= 12; mes += 1) {
    const linhasMes = linhas.filter((linha: any) => Number(linha?.mes) === mes)
    const mesPayload = meses.find((item: any) => Number(item?.mes) === mes) || {}

    const v1PorLinha = linhasMes.reduce(
      (acc: number, linha: any) => acc + numero(linha?.planejado_v1),
      0,
    )

    let atualPorLinha = 0
    if (mes < mesAtual) {
      atualPorLinha = linhasMes.reduce(
        (acc: number, linha: any) => acc + numero(linha?.realizado),
        0,
      )
    } else {
      atualPorLinha = linhasMes.reduce(
        (acc: number, linha: any) => acc + numero(linha?.previsto ?? linha?.planejado),
        0,
      )
    }

    const v1 = Math.round(v1PorLinha || numero(mesPayload?.orcado))
    const atual = Math.round(
      atualPorLinha
      || numero(mesPayload?.real)
      || numero(mesPayload?.real_mes_atual)
      || numero(mesPayload?.previsto),
    )

    resultado[mes] = { v1, atual }
  }

  return resultado
}

function valorCausaMensal(causas: any, campos: string[]) {
  for (const campo of campos) {
    const n = Number(causas?.[campo])
    if (Number.isFinite(n) && Math.abs(n) > 0) return Math.abs(Math.round(n))
  }
  return 0
}

function montarPerdasMensais(
  rastreamentos: Record<number, any>,
  mesAtual: number,
  projLib?: any,
): MonthlyLossesItem[] {
  const resumoProjLib = resumoMensalProjLib(projLib, mesAtual)

  return MES_LABELS.map((mesLabel, index) => {
    const mes = index + 1
    const r = rastreamentos[mes] || {}
    const causas = r?.mes_perdas_vs_v1_por_causa || {}
    const resumoMes = resumoProjLib[mes] || { v1: 0, atual: 0 }

    const planoRefCx = Math.round(numero(r?.mes_cx_previsto_v1) || resumoMes.v1)
    const liberadoBrutoCx = Math.round(
      numero(r?.mes_cx_plano_atual_tendencia)
      || numero(r?.mes_cx_plano_atual_puro)
      || resumoMes.atual,
    )

    // Regra de negócio: não cobrir delta automaticamente.
    // O gráfico mensal só mostra causas que vierem classificadas pelo backend.
    // Assim a tela não transforma diferença residual em atraso/reorg “fake”.
    const atrasoCx = valorCausaMensal(causas, [
      "atraso_producao",
      "atraso_producao_cx",
      "atraso",
    ])

    const reorgCx = valorCausaMensal(causas, [
      "reorganizacao_plano",
      "reorganizacao_plano_cx",
      "reorg_plano",
      "reorg_plano_cx",
      "reorg",
      "reorg_cx",
      "resultado_reorg_plano_cx",
    ])

    const reprovadoCx = valorCausaMensal(causas, [
      "reprovacao_desvio",
      "reprovacao_desvio_cx",
      "reprovacao_cx",
      "reprovacao",
    ])

    const liberadoValidoCx = Math.max(0, liberadoBrutoCx - reprovadoCx)
    const perdaCx = atrasoCx + reorgCx + reprovadoCx
    const ganhoCx = Math.max(0, liberadoValidoCx - planoRefCx)

    return {
      mes: mesLabel,
      baseline: mes === 1 ? "Jan/V3" : `${mesLabel}/V1`,
      v1: planoRefCx,

      // Ordem do gráfico: Atraso produção -> Reorg. -> Reprovação.
      atraso: atrasoCx,
      reorg: reorgCx,
      reprovacao: reprovadoCx,
      saldo: 0,

      planoRefCx,
      liberadoBrutoCx,
      reprovadoCx,
      liberadoValidoCx,
      perdaCx,
      ganhoCx,
      status: mes > mesAtual ? "futuro" : (mes === mesAtual ? "mtd" : "fechado"),
    }
  })
}

function mensalPlanoRefCx(item: MonthlyLossesItem) {
  const anyItem = item as any
  return Math.round(
    numero(anyItem?.planoRefCx)
    || numero(anyItem?.plano_ref_cx)
    || numero(anyItem?.plano_ref)
    || numero(item?.v1),
  )
}

function mensalReprovadoCx(item: MonthlyLossesItem) {
  const anyItem = item as any
  return Math.max(0, Math.round(
    numero(anyItem?.reprovadoCx)
    || numero(anyItem?.reprovado_cx)
    || numero(anyItem?.reprovado)
    || numero(item?.reprovacao),
  ))
}

function mensalLiberadoValidoCx(item: MonthlyLossesItem) {
  const anyItem = item as any
  const direto = Math.round(
    numero(anyItem?.liberadoValidoCx)
    || numero(anyItem?.liberado_valido_cx)
    || numero(anyItem?.liberado_valido),
  )

  if (direto > 0) return direto

  const bruto = Math.round(
    numero(anyItem?.liberadoBrutoCx)
    || numero(anyItem?.liberado_bruto_cx)
    || numero(anyItem?.liberado_bruto)
    || numero(anyItem?.atual)
    || numero(anyItem?.planoAtualCx)
    || numero(anyItem?.plano_atual_cx),
  )

  if (bruto > 0) return Math.max(0, bruto - mensalReprovadoCx(item))

  const plano = mensalPlanoRefCx(item)
  return Math.max(0, plano - mensalPerdaCx(item) + mensalGanhoCx(item))
}

function mensalPerdaCx(item: MonthlyLossesItem) {
  const anyItem = item as any
  const direto = Math.round(
    numero(anyItem?.perdaCx)
    || numero(anyItem?.perda_cx)
    || numero(anyItem?.perda)
    || numero(anyItem?.perdaVsPlanoCx)
    || numero(anyItem?.perda_vs_plano_cx),
  )
  if (direto > 0) return direto

  const causasLegadas =
    numero(item?.atraso)
    + numero(item?.reorg)
    + numero(item?.reprovacao)
    + numero(item?.saldo)

  return Math.max(0, Math.round(causasLegadas))
}

function mensalGanhoCx(item: MonthlyLossesItem) {
  const anyItem = item as any
  const direto = Math.round(
    numero(anyItem?.ganhoCx)
    || numero(anyItem?.ganho_cx)
    || numero(anyItem?.ganho)
    || numero(anyItem?.ganhoVsPlanoCx)
    || numero(anyItem?.ganho_vs_plano_cx),
  )
  return Math.max(0, direto)
}

function mensalPctVsPlano(valorCx: number, item: MonthlyLossesItem) {
  const plano = mensalPlanoRefCx(item)
  return plano > 0 ? (valorCx / plano) * 100 : 0
}

function montarApiDataDaOverviewCache(cache: any, rastreamentos: Record<number, any> = {}): LiberacaoExecutivaPayload {
  const ano = new Date().getFullYear()
  const mesAtual = new Date().getMonth() + 1
  const rastAtual = rastreamentos[mesAtual] || {}
  const estoqueJan = Math.round(numero(cache?.estoqueJan))
  const plano1Fallback = plano1JaneiroV3Fallback(ano, estoqueJan)

  const dados = {
    orcadoFaturamentoCx: Math.round(numero(cache?.orcadoFat?.total_caixas)),
    faturamentoProjetadoCx: Math.round(numero(cache?.projFat?.total_projetado)),
    plano1LiberacaoCx: Math.round(numero(plano1Fallback?.plano1LiberacaoCx ?? cache?.orcadoLib?.total_caixas ?? cache?.projLib?.total_orcado)),
    planoAtualLiberacaoCx: Math.round(numero(cache?.projLib?.total_projetado)),
    estoqueInicialJanCx: Math.round(numero(plano1Fallback?.estoqueInicialJanCx ?? estoqueJan)),
    reorganizacaoPlanoCx: Math.max(0, Math.round(numero(rastAtual?.mes_cx_acrescimo_plano_atual))),
    atrasoProducaoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.atraso_producao))),
    perdaReprovacaoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.reprovacao_desvio))),
    perdaRendimentoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.rendimento))),
    ganhoRendimentoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.ganho_rendimento))),
  }

  return {
    atualizadoLabel: formatarAtualizacao(cache?.ultimaAtualizacao) || "—",
    dados,
    waterfallSteps: montarWaterfallAnual(dados, rastAtual),
    perdasMensais: montarPerdasMensais(rastreamentos, mesAtual, cache?.projLib),
    ponteVersoesSteps: [],
    itensReorganizacao: [],
  }
}

function montarApiDataDaOverviewResumo(resumo: any, rastreamentos: Record<number, any> = {}): LiberacaoExecutivaPayload {
  const payload = resumo?.payload || {}
  const ano = Number(resumo?.ano || payload?.ano || new Date().getFullYear())
  const mesAtual = Number(resumo?.mes_atual || payload?.mes_atual || new Date().getMonth() + 1)
  const rastAtual = rastreamentos[mesAtual] || {}

  const orcadoFat = payload?.orcado_faturamento || {}
  const projFat = payload?.projecao_faturamento || {}
  const projLib = payload?.projecao_liberacoes || {}
  const orcadoLib = payload?.orcado_liberacao || {}
  const estoqueJan = estoqueJanDoPayload(payload)
  const plano1Fallback = plano1JaneiroV3Fallback(ano, estoqueJan)

  const dados = {
    orcadoFaturamentoCx: Math.round(numero(orcadoFat?.total_caixas)),
    faturamentoProjetadoCx: Math.round(numero(projFat?.total_projetado)),
    plano1LiberacaoCx: Math.round(numero(plano1Fallback?.plano1LiberacaoCx ?? orcadoLib?.total_caixas ?? projLib?.total_orcado)),
    planoAtualLiberacaoCx: Math.round(numero(projLib?.total_projetado)),
    estoqueInicialJanCx: Math.round(numero(plano1Fallback?.estoqueInicialJanCx ?? estoqueJan)),
    reorganizacaoPlanoCx: Math.max(0, Math.round(numero(rastAtual?.mes_cx_acrescimo_plano_atual))),
    atrasoProducaoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.atraso_producao))),
    perdaReprovacaoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.reprovacao_desvio))),
    perdaRendimentoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.rendimento))),
    ganhoRendimentoCx: Math.abs(Math.round(numero(rastAtual?.mes_perdas_vs_v1_por_causa?.ganho_rendimento))),
  }

  return {
    atualizadoLabel: formatarAtualizacao(resumo?.ultima_atualizacao || payload?.ultima_atualizacao) || "—",
    dados,
    waterfallSteps: montarWaterfallAnual(dados, rastAtual),
    perdasMensais: montarPerdasMensais(rastreamentos, mesAtual, projLib),
    ponteVersoesSteps: [],
    itensReorganizacao: [],
  }
}

async function carregarRastreamentosDoCache(ano: number, mesAtual: number) {
  const pares = await Promise.all(
    Array.from({ length: mesAtual }, async (_, index) => {
      const mes = index + 1

      try {
        const json = await fetchJsonComTimeout(
          `${API_BASE}/overview/rastreamento-lotes-cache?mes=${mes}&ano=${ano}&allow_stale=true&_t=${Date.now()}`,
          8000,
        )

        return [mes, json?.payload || json] as const
      } catch {
        return [mes, {}] as const
      }
    }),
  )

  return Object.fromEntries(pares) as Record<number, any>
}

async function carregarPlano1Leve(ano: number, estoqueAtual?: number) {
  const fallback = plano1JaneiroV3Fallback(ano, estoqueAtual)

  try {
    const json = await fetchJsonComTimeout(
      `${API_BASE}/liberacao-executiva/plano1?ano=${ano}&_t=${Date.now()}`,
      8000,
    )

    const fonte = String(json?.fonte || "")
    const valor = Math.round(numero(json?.plano1LiberacaoCx))

    // Se o backend caiu no fallback da Overview, não usa, porque essa tela precisa
    // de Janeiro/V3 do MPS.
    if (valor > 0 && !fonte.includes("overview_cache")) {
      return json
    }

    return fallback
  } catch {
    return fallback
  }
}

async function carregarPonteVersoesMps(ano: number, mes: number) {
  try {
    return await fetchJsonComTimeout(
      `${API_BASE}/liberacao-executiva/ponte-versoes?ano=${ano}&mes=${mes}&_t=${Date.now()}`,
      10000,
    )
  } catch {
    return null
  }
}

async function carregarCausasAnuaisReais(ano: number) {
  try {
    return await fetchJsonComTimeout(
      `${API_BASE}/liberacao-executiva/causas-anuais?ano=${ano}&_t=${Date.now()}`,
      60000,
    )
  } catch {
    return null
  }
}

async function carregarLotesReprovadosDesvios(ano: number) {
  try {
    const json = await fetchJsonComTimeout(
      `${API_BASE}/desvios/historico-anual?ano=${ano}&_t=${Date.now()}`,
      15000,
    )

    const historico = Array.isArray(json?.data) ? json.data : []
    const lotes = new Set<string>()

    historico.forEach((desvio: any) => {
      const destino = String(desvio?.destino || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toUpperCase()

      const ehReprovadoOuDescarte = destino.includes("REPROVADO") || destino.includes("DESCART")
      if (!ehReprovadoOuDescarte) return

      String(desvio?.lotes_texto || "")
        .split(/[,;]/)
        .map((lote) => lote.trim().toUpperCase().replace(/\s+/g, ""))
        .filter(Boolean)
        .forEach((lote) => lotes.add(lote.endsWith(".0") ? lote.slice(0, -2) : lote))

      if (Array.isArray(desvio?.lotes)) {
        desvio.lotes.forEach((item: any) => {
          const lote = String(item?.lote || "").trim().toUpperCase().replace(/\s+/g, "")
          if (lote) lotes.add(lote.endsWith(".0") ? lote.slice(0, -2) : lote)
        })
      }
    })

    return lotes.size
  } catch {
    return null
  }
}

function aplicarCausasAnuais<T extends LiberacaoExecutivaPayload>(
  payload: T,
  causasAnuais: any,
  lotesReprovadosAno?: number | null,
): T {
  if (!causasAnuais || !Array.isArray(causasAnuais.steps) || causasAnuais.steps.length < 2) {
    return payload
  }

  const steps = causasAnuais.steps.map((step: any) => {
    if (
      step?.id === "reprovacao" &&
      lotesReprovadosAno != null &&
      Number.isFinite(Number(lotesReprovadosAno)) &&
      Number(lotesReprovadosAno) > 0
    ) {
      return {
        ...step,
        lotes: Math.round(Number(lotesReprovadosAno)),
      }
    }

    return step
  })

  return {
    ...payload,
    dados: {
      ...(payload.dados || {}),
      ...(causasAnuais.dados || {}),
    },
    waterfallSteps: steps,
  }
}

function temCausaClassificada(causasAnuais: any) {
  const steps = Array.isArray(causasAnuais?.steps) ? causasAnuais.steps : []

  return steps.some((step: any) => {
    const id = String(step?.id || "")
    const kind = String(step?.kind || "")
    const value = Math.abs(Number(step?.value || 0))

    if (kind !== "delta" || value < 1) return false

    // Saldo é só diferença não aberta. Não pode ser tratado como causa carregada.
    if (id.includes("saldo")) return false

    return true
  })
}

function semCausasAnuais<T extends LiberacaoExecutivaPayload>(payload: T): T {
  return {
    ...payload,
    waterfallSteps: [],
  }
}

function aplicarPonteVersoes<T extends LiberacaoExecutivaPayload>(
  payload: T,
  ponte: any,
): T {
  if (!Array.isArray(ponte?.steps) || ponte.steps.length === 0) {
    return {
      ...payload,
      ponteVersoesSteps: [],
    }
  }

  return {
    ...payload,
    ponteVersoesSteps: ponte.steps,
  }
}

function aplicarPlano1Override<T extends LiberacaoExecutivaPayload>(
  payload: T,
  plano1: any,
): T {
  if (!plano1?.plano1LiberacaoCx) return payload

  return {
    ...payload,
    dados: {
      ...(payload.dados || {}),
      plano1LiberacaoCx: Math.round(numero(plano1.plano1LiberacaoCx)),
      estoqueInicialJanCx: Math.round(numero(plano1.estoqueInicialJanCx ?? payload.dados?.estoqueInicialJanCx)),
    },
  }
}

function recalcularWaterfallComDados(payload: LiberacaoExecutivaPayload, rastreamento: any): LiberacaoExecutivaPayload {
  if (!payload.dados) return payload

  const dados = {
    orcadoFaturamentoCx: numero(payload.dados.orcadoFaturamentoCx),
    faturamentoProjetadoCx: numero(payload.dados.faturamentoProjetadoCx),
    plano1LiberacaoCx: numero(payload.dados.plano1LiberacaoCx),
    planoAtualLiberacaoCx: numero(payload.dados.planoAtualLiberacaoCx),
    estoqueInicialJanCx: numero(payload.dados.estoqueInicialJanCx),
    reorganizacaoPlanoCx: numero(payload.dados.reorganizacaoPlanoCx),
    atrasoProducaoCx: numero(payload.dados.atrasoProducaoCx),
    perdaReprovacaoCx: numero(payload.dados.perdaReprovacaoCx),
    perdaRendimentoCx: numero(payload.dados.perdaRendimentoCx),
    ganhoRendimentoCx: numero(payload.dados.ganhoRendimentoCx),
  }

  return {
    ...payload,
    waterfallSteps: montarWaterfallAnual(dados, rastreamento),
  }
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
  onClickReorganizacao: (step: WaterfallStep) => void
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

          const stepClickable = Boolean(bar.id === "reorg-plano" || bar.id.startsWith("reorganizacao") || bar.id === "reprovacao")

          return (
            <g
              key={bar.id}
              onClick={stepClickable ? () => onClickReorganizacao(bar) : undefined}
              style={{ cursor: stepClickable ? "pointer" : "default" }}
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

              {stepClickable && (
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


function formatarModalValue(value: any): string {
  if (value == null || value === "") return "—"
  if (typeof value === "number") return fmt(value)
  if (typeof value === "boolean") return value ? "Sim" : "Não"
  if (Array.isArray(value)) return value.length ? `${value.length} itens` : "—"
  if (typeof value === "object") return "ver detalhes"
  return String(value)
}

function labelCalculo(campo: string): string {
  const labels: Record<string, string> = {
    delta_total_cx: "Delta total",
    atraso_producao_cx: "Atraso produção",
    reprovacao_cx: "Reprov. lote",
    perda_rendimento_cx: "Perda rendimento",
    ganho_rendimento_cx: "Ganho rendimento",
    resultado_reorg_plano_cx: "Resultado Reorg. plano",
    plano1_liberacao_cx: "Plano 1 Jan/V3",
    plano_atual_mrp_liberacao_cx: "Plano atual MRP/Gantt",
    resultado_cx: "Resultado",
    estoque_inicial_jan_cx: "Estoque inicial Jan",
  }
  return labels[campo] || campo.replace(/_/g, " ")
}

function firstFiniteNumber(...values: any[]): number | null {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function numeroResumoCalendario(resumo: any, campos: string[]): number | null {
  if (!resumo || typeof resumo !== "object") return null

  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(resumo, campo)) {
      const n = Number(resumo[campo])
      if (Number.isFinite(n)) return n
    }
  }

  return null
}

function fmtHoras(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  return `${fmtDecimal(Number(value), digits)} h`
}

function fmtSignedHoras(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  const n = Number(value)
  return `${n >= 0 ? "+" : "-"}${fmtDecimal(Math.abs(n), digits)} h`
}

function fmtSignedCx(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—"
  const n = Number(value)
  return `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n))} cx`
}

type LinhaResumoHorasDisponiveis = {
  linha: string
  horasV1: number | null
  horasAtual: number | null
  deltaHoras: number
  taxaTubetesHora: number | null
  impactoCx: number
}

function montarResumoLinhasCalendario(resumo: any, detalhes: any[]): LinhaResumoHorasDisponiveis[] {
  const fonte = resumo?.por_linha || resumo?.linhas || resumo?.resumo_por_linha

  if (Array.isArray(fonte)) {
    return fonte.map((item: any) => {
      const horasV1 = firstFiniteNumber(
        item?.horas_disponiveis_v1,
        item?.horas_v1,
        item?.horas_plano1,
        item?.horasPlano1,
      )
      const horasAtual = firstFiniteNumber(
        item?.horas_disponiveis_atual,
        item?.horas_atual,
        item?.horasAtual,
      )
      const deltaHoras = firstFiniteNumber(
        item?.delta_horas_disponiveis,
        item?.variacao_horas,
        item?.delta_horas,
        horasV1 != null && horasAtual != null ? horasAtual - horasV1 : null,
        0,
      ) || 0
      const impactoCx = firstFiniteNumber(item?.impacto_cx, item?.impactoCx, item?.delta_cx, 0) || 0
      const taxaTubetesHora = firstFiniteNumber(item?.cap_ooe_tubetes_hora, item?.taxa_tubetes_hora, item?.tubetes_hora)
      return {
        linha: String(item?.linha || item?.recurso || "—"),
        horasV1,
        horasAtual,
        deltaHoras,
        taxaTubetesHora,
        impactoCx,
      }
    }).filter((item) => Math.abs(item.deltaHoras) >= 0.05 || Math.abs(item.impactoCx) >= 0.5)
  }

  if (fonte && typeof fonte === "object") {
    return Object.entries(fonte).map(([linha, item]: [string, any]) => {
      const horasV1 = firstFiniteNumber(item?.horas_disponiveis_v1, item?.horas_v1, item?.horas_plano1)
      const horasAtual = firstFiniteNumber(item?.horas_disponiveis_atual, item?.horas_atual)
      const deltaHoras = firstFiniteNumber(
        item?.delta_horas_disponiveis,
        item?.variacao_horas,
        item?.delta_horas,
        horasV1 != null && horasAtual != null ? horasAtual - horasV1 : null,
        0,
      ) || 0
      const impactoCx = firstFiniteNumber(item?.impacto_cx, item?.impactoCx, item?.delta_cx, 0) || 0
      const taxaTubetesHora = firstFiniteNumber(item?.cap_ooe_tubetes_hora, item?.taxa_tubetes_hora, item?.tubetes_hora)
      return { linha, horasV1, horasAtual, deltaHoras, taxaTubetesHora, impactoCx }
    }).filter((item) => Math.abs(item.deltaHoras) >= 0.05 || Math.abs(item.impactoCx) >= 0.5)
  }

  const porLinha: Record<string, LinhaResumoHorasDisponiveis> = {}
  detalhes.forEach((item: any) => {
    const linha = String(item?.linha || "—")
    const atual = porLinha[linha] || {
      linha,
      horasV1: null,
      horasAtual: null,
      deltaHoras: 0,
      taxaTubetesHora: null,
      impactoCx: 0,
    }
    atual.deltaHoras += Number(item?.horas_impacto || 0)
    atual.impactoCx += Number(item?.impacto_cx || 0)
    porLinha[linha] = atual
  })

  return Object.values(porLinha)
    .filter((item) => Math.abs(item.deltaHoras) >= 0.05 || Math.abs(item.impactoCx) >= 0.5)
    .sort((a, b) => a.linha.localeCompare(b.linha))
}

function WaterfallStepModal({
  step,
  onClose,
}: {
  step: WaterfallStep | null
  onClose: () => void
}) {
  if (!step) return null

  if (step.id === "reprovacao") {
    const modalReprovacao = (step as any).modal || {}
    const lotesReprovados: LoteReprovadoDetalhe[] = modalReprovacao.lotesReprovados || []
    const totalPerdaDetalheCx = lotesReprovados.reduce((acc, item) => acc + item.qtdPerdaCx, 0)
    const totalPerdaCx = totalPerdaDetalheCx > 0
      ? totalPerdaDetalheCx
      : Math.abs(Number(modalReprovacao.delta_cx ?? step.value ?? 0))
    const qtdLotesReprovados = lotesReprovados.length || Math.max(0, Math.round(Number((step as any).lotes || modalReprovacao.qtd_lotes || 0)))

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(15,23,42,0.45)" }}
        onClick={onClose}
      >
        <div
          className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
          style={{ borderColor: "var(--border)" }}
          onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
                Detalhe da cascata anual
              </p>
              <h2 className="mt-1 text-xl font-black" style={{ color: "var(--text-primary)" }}>
                {modalReprovacao.titulo || "Lotes reprovados / em desvio"}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {modalReprovacao.descricao || "Abertura dos lotes que compõem a causa Reprov. lote na cascata anual."}
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MiniResumo
                label="Impacto na disponibilidade"
                value={`-${fmt(Math.abs(Number(modalReprovacao.delta_cx || 0)))} cx`}
                sub={`-${fmtTubetes(Math.abs(Number(modalReprovacao.delta_cx || 0)))}`}
                color="#DC2626"
                bg="#FEF2F2"
              />
              <MiniResumo
                label="Lotes reprovados"
                value={fmtLotesQtd(qtdLotesReprovados)}
                sub={`${fmt(totalPerdaCx)} cx · ${fmtTubetes(totalPerdaCx)}`}
                color="#334155"
                bg="#F8FAFC"
              />
              <MiniResumo
                label="Caixas perdidas (soma dos lotes)"
                value={`${fmt(totalPerdaCx)} cx`}
                sub={fmtTubetes(totalPerdaCx)}
                color="#DC2626"
                bg="#FEF2F2"
              />
            </div>

            {lotesReprovados.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[920px] text-xs">
                    <thead style={{ background: "#F8FAFC", color: "var(--text-secondary)" }}>
                      <tr>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Lote</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Produto</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Previsto</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Liberado</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Perda cx</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Motivo do desvio</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Setor</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Destino</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Estado</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Dias em desvio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotesReprovados.map((item) => (
                        <tr key={item.lote} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                          <td className="px-3 py-3 font-black" style={{ color: "var(--text-primary)" }}>{item.lote}</td>
                          <td className="px-3 py-3 font-semibold" style={{ color: "var(--text-secondary)" }}>{item.produto || item.grupo || "—"}</td>
                          <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmt(item.qtdPrevistaCx)} cx</td>
                          <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmt(item.qtdLiberadaCx)} cx</td>
                          <td className="px-3 py-3 text-right font-black" style={{ color: "#DC2626" }}>{fmt(item.qtdPerdaCx)} cx</td>
                          <td className="px-3 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>{item.motivo || "—"}</td>
                          <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>{item.setor || "—"}</td>
                          <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>{item.destino || "—"}</td>
                          <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>{item.estado || "—"}</td>
                          <td className="px-3 py-3 text-right" style={{ color: "var(--text-secondary)" }}>{item.diasDesvio != null ? fmt(item.diasDesvio) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                Nenhum lote com detalhe de desvio disponível para o período.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const modal = (step as any).modal || {}
  const calculo = modal.calculo || (step as any).calculo || {}
  const isReorgPlano = step.id === "reorg-plano"
  const titulo = isReorgPlano ? "Variação de horas disponíveis" : (modal.titulo || step.label)
  const descricao = isReorgPlano
    ? "Comparação Jan/V3 × Plano atual por data + linha. A leitura é feita em horas disponíveis de produção, não em horas indisponíveis."
    : (modal.descricao || (step as any).observacao || "Abertura do cálculo da causa selecionada na cascata anual.")
  const deltaModal = modal.delta_cx ?? modal.delta_disponibilidade_cx ?? step.value
  const formula = calculo.formula || modal.regra
  const calculoLinhas = Object.entries(calculo).filter(([key]) => key !== "formula")
  const positivo = Number(deltaModal || 0) >= 0
  const detalhesCalendario = (Array.isArray(modal.detalhes_calendario) ? modal.detalhes_calendario : []).filter((item: any) => {
    const impacto = Number(item?.impacto_cx || 0)
    const horas = Number(item?.horas_impacto || 0)
    return Math.abs(impacto) >= 0.5 || Math.abs(horas) >= 0.05
  })
  const resumoCalendario = modal.resumo_calendario || {}
  const impactoCalendario = firstFiniteNumber(
    resumoCalendario.impacto_calendario_cx,
    resumoCalendario.impacto_liquido_calendario_cx,
    resumoCalendario.impacto_bruto_calendario_cx,
    resumoCalendario.delta_cx,
    deltaModal,
    0,
  ) || 0

  const horasDisponiveisV1 = numeroResumoCalendario(resumoCalendario, [
    "horas_disponiveis_v1_total",
    "horas_disponíveis_v1_total",
    "horas_v1_total",
    "total_horas_v1",
    "horas_plano1_total",
    "horas_disponiveis_plano1_total",
  ])
  const horasDisponiveisAtual = numeroResumoCalendario(resumoCalendario, [
    "horas_disponiveis_atual_total",
    "horas_disponíveis_atual_total",
    "horas_atual_total",
    "total_horas_atual",
    "horas_plano_atual_total",
    "horas_disponiveis_v_atual_total",
  ])
  const deltaHorasDisponiveis = firstFiniteNumber(
    numeroResumoCalendario(resumoCalendario, [
      "delta_horas_disponiveis",
      "delta_horas_disponíveis",
      "variacao_horas_disponiveis",
      "var_horas_disponiveis",
      "horas_liquidas",
    ]),
    horasDisponiveisV1 != null && horasDisponiveisAtual != null ? horasDisponiveisAtual - horasDisponiveisV1 : null,
    null,
  )
  const horasGanhas = numeroResumoCalendario(resumoCalendario, ["horas_liberadas", "horas_ganhas", "horas_capacidade_liberada"])
  const horasPerdidas = numeroResumoCalendario(resumoCalendario, ["horas_consumidas", "horas_perdidas", "horas_capacidade_consumida"])
  const eventosComVariacao = firstFiniteNumber(
    resumoCalendario.qtd_detalhes_total,
    resumoCalendario.eventos_com_variacao,
    detalhesCalendario.length,
    0,
  ) || 0
  const linhasResumo = montarResumoLinhasCalendario(resumoCalendario, detalhesCalendario)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: "var(--border)" }}
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Detalhe da cascata anual
            </p>
            <h2 className="mt-1 text-xl font-black" style={{ color: "var(--text-primary)" }}>
              {titulo}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {descricao}
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
          {isReorgPlano ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <MiniResumo
                label="Horas disponíveis V1"
                value={fmtHoras(horasDisponiveisV1)}
                sub="Plano 1 Jan/V3"
                color="#334155"
                bg="#F8FAFC"
              />
              <MiniResumo
                label="Horas disponíveis atual"
                value={fmtHoras(horasDisponiveisAtual)}
                sub="Plano atual"
                color="#334155"
                bg="#F8FAFC"
              />
              <MiniResumo
                label="Variação líquida"
                value={fmtSignedHoras(deltaHorasDisponiveis)}
                sub="Atual - V1"
                color={(deltaHorasDisponiveis || 0) >= 0 ? "#16A34A" : "#DC2626"}
                bg={(deltaHorasDisponiveis || 0) >= 0 ? "#F0FDF4" : "#FEF2F2"}
              />
              <MiniResumo
                label="Impacto calendário"
                value={fmtSignedCx(impactoCalendario)}
                sub={`${impactoCalendario >= 0 ? "+" : "-"}${fmtTubetes(Math.abs(impactoCalendario))}`}
                color={impactoCalendario >= 0 ? "#16A34A" : "#DC2626"}
                bg={impactoCalendario >= 0 ? "#F0FDF4" : "#FEF2F2"}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MiniResumo
                label="Impacto na disponibilidade"
                value={`${positivo ? "+" : "-"}${fmt(Math.abs(Number(deltaModal || 0)))} cx`}
                sub={`${positivo ? "+" : "-"}${fmtTubetes(Math.abs(Number(deltaModal || 0)))}`}
                color={positivo ? "#16A34A" : "#DC2626"}
                bg={positivo ? "#F0FDF4" : "#FEF2F2"}
              />

              <MiniResumo
                label="Status do cálculo"
                value={String((step as any).statusCalculo || "auditável")}
                sub="informado pelo backend"
                color="#334155"
                bg="#F8FAFC"
              />

              <MiniResumo
                label="Lotes"
                value={step.lotes != null ? fmtLotesQtd(step.lotes) : "—"}
                sub={(step as any).lotesTipo ? `tipo: ${(step as any).lotesTipo}` : "quando aplicável"}
                color="#334155"
                bg="#F8FAFC"
              />
            </div>
          )}

          {formula && !isReorgPlano && (
            <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                Fórmula
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {String(formula)}
              </p>
            </div>
          )}

          {calculoLinhas.length > 0 && !isReorgPlano && (
            <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <tbody>
                  {calculoLinhas.map(([key, value]) => (
                    <tr key={key} className="border-t first:border-t-0" style={{ borderColor: "var(--border)" }}>
                      <td className="w-1/2 px-4 py-3 font-bold" style={{ color: "var(--text-secondary)" }}>
                        {labelCalculo(key)}
                      </td>
                      <td className="px-4 py-3 text-right font-black" style={{ color: "var(--text-primary)" }}>
                        {formatarModalValue(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isReorgPlano && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <MiniResumo
                  label="Horas ganhas"
                  value={fmtHoras(horasGanhas)}
                  sub={`${fmt(Number(resumoCalendario.eventos_capacidade_liberada || 0))} eventos`}
                  color="#16A34A"
                  bg="#F0FDF4"
                />
                <MiniResumo
                  label="Horas perdidas"
                  value={fmtHoras(horasPerdidas)}
                  sub={`${fmt(Number(resumoCalendario.eventos_capacidade_consumida || 0))} eventos`}
                  color="#DC2626"
                  bg="#FEF2F2"
                />
                <MiniResumo
                  label="Eventos com variação"
                  value={`${fmt(eventosComVariacao)} eventos`}
                  sub="linhas com impacto em horas ou caixas"
                  color="#334155"
                  bg="#F8FAFC"
                />
              </div>

              {linhasResumo.length > 0 && (
                <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
                  <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                      Resumo por linha
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      O impacto é calculado por variação de horas disponíveis × Cap. OEE da linha.
                    </p>
                  </div>
                  <table className="w-full text-xs">
                    <thead style={{ background: "#F8FAFC", color: "var(--text-secondary)" }}>
                      <tr>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Linha</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas V1</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas atual</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Variação h</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Cap. OEE</th>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Impacto cx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasResumo.map((item) => {
                        const positivoLinha = item.impactoCx >= 0
                        return (
                          <tr key={item.linha} className="border-t" style={{ borderColor: "var(--border)" }}>
                            <td className="px-3 py-3 font-black" style={{ color: "var(--text-primary)" }}>{item.linha}</td>
                            <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmtHoras(item.horasV1)}</td>
                            <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmtHoras(item.horasAtual)}</td>
                            <td className="px-3 py-3 text-right font-black" style={{ color: item.deltaHoras >= 0 ? "#16A34A" : "#DC2626" }}>{fmtSignedHoras(item.deltaHoras)}</td>
                            <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>
                              {item.taxaTubetesHora != null ? `${fmt(item.taxaTubetesHora)} tub/h` : "—"}
                            </td>
                            <td className="px-3 py-3 text-right font-black" style={{ color: positivoLinha ? "#16A34A" : "#DC2626" }}>{fmtSignedCx(item.impactoCx)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {detalhesCalendario.length > 0 && (
                <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
                  <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)", background: "#F8FAFC" }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>
                      Linhas com perda/ganho de capacidade
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      Detalhe por data + linha. Variação de horas = Plano atual - V1.
                    </p>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="w-full min-w-[1120px] text-xs">
                      <thead style={{ background: "#F8FAFC", color: "var(--text-secondary)" }}>
                        <tr>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Movimento</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Data</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Linha</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas V1</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Horas atual</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Variação h</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-wider">Impacto cx</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Motivo V1</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Motivo atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhesCalendario.map((item: any, index: number) => {
                          const impacto = Number(item.impacto_cx || 0)
                          const horas = Number(item.horas_impacto || 0)
                          const ganho = impacto >= 0 || horas >= 0
                          const dataTexto = String(item.data || "—")
                          return (
                            <tr key={String(item.id || index)} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                              <td className="px-3 py-3">
                                <span
                                  className="inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider"
                                  style={{
                                    background: ganho ? "#DCFCE7" : "#FEE2E2",
                                    color: ganho ? "#166534" : "#991B1B",
                                  }}
                                >
                                  {ganho ? "Capacidade liberada" : "Capacidade consumida"}
                                </span>
                              </td>
                              <td className="px-3 py-3 font-bold" style={{ color: "var(--text-primary)" }}>{dataTexto}</td>
                              <td className="px-3 py-3 font-bold" style={{ color: "var(--text-primary)" }}>{String(item.linha || "—")}</td>
                              <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmtHoras(Number(item.horas_plano1 || 0))}</td>
                              <td className="px-3 py-3 text-right font-semibold" style={{ color: "var(--text-secondary)" }}>{fmtHoras(Number(item.horas_atual || 0))}</td>
                              <td className="px-3 py-3 text-right font-black" style={{ color: horas >= 0 ? "#16A34A" : "#DC2626" }}>
                                {fmtSignedHoras(horas)}
                              </td>
                              <td className="px-3 py-3 text-right font-black" style={{ color: impacto >= 0 ? "#16A34A" : "#DC2626" }}>
                                {fmtSignedCx(impacto)}
                                <div className="text-[10px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                                  {impacto >= 0 ? "+" : "-"}{fmtTubetes(Math.abs(impacto))}
                                </div>
                              </td>
                              <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>
                                <div className="max-w-[230px] whitespace-pre-line leading-relaxed">{String(item.motivo_plano1 || "—")}</div>
                              </td>
                              <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>
                                <div className="max-w-[230px] whitespace-pre-line leading-relaxed">{String(item.motivo_atual || "—")}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {isReorgPlano && detalhesCalendario.length === 0 && (
            <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "#FCD34D", background: "#FFFBEB" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "#92400E" }}>
                Detalhe de calendário não carregado
              </p>
              <p className="mt-1 text-sm font-semibold" style={{ color: "#92400E" }}>
                O backend precisa retornar modal.detalhes_calendario e modal.resumo_calendario com horas disponíveis V1, horas disponíveis atuais, variação e impacto por linha.
              </p>
            </div>
          )}

          {modal.leitura && (
            <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "#FFF7ED" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "#9A3412" }}>
                Leitura de negócio
              </p>
              <p className="mt-1 text-sm font-semibold leading-relaxed" style={{ color: "#7C2D12" }}>
                {String(modal.leitura)}
              </p>
            </div>
          )}
        </div>
      </div>
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
  const height = 286
  const margin = { top: 42, right: 34, bottom: 62, left: 46 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = 162
  const barWidth = 62

  const buildSegments = (item: MonthlyLossesItem) => {
    if (item.simulado) {
      const simuladoCx = mensalPerdaCx(item)
      return simuladoCx > 0
        ? [{ id: "simulado", label: "Simulado", value: simuladoCx, color: "#DC2626", soft: "#FEE2E2" }]
        : []
    }

    return [
      { id: "atraso", label: "Atraso", value: Math.max(0, Math.round(numero(item.atraso))), color: "#F97316", soft: "#FFEDD5" },
      { id: "reorg", label: "Reorg.", value: Math.max(0, Math.round(numero(item.reorg))), color: "#2563EB", soft: "#DBEAFE" },
      { id: "reprovacao", label: "Reprov.", value: Math.max(0, Math.round(numero(item.reprovacao))), color: "#DC2626", soft: "#FEE2E2" },
    ].filter((segment) => segment.value > 0)
  }

  const pontos = data.map((item) => {
    const segments = buildSegments(item)
    const totalCx = segments.reduce((acc, segment) => acc + segment.value, 0)
    const planoRefCx = mensalPlanoRefCx(item)
    const liberadoValidoCx = mensalLiberadoValidoCx(item)

    return {
      item,
      segments,
      totalCx,
      planoRefCx,
      liberadoValidoCx,
    }
  })

  const maxTotal = Math.max(...pontos.map((ponto) => ponto.totalCx), 1)
  const maxValue = Math.ceil((maxTotal * 1.24) / 1000) * 1000

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

          {pontos.map((ponto, index) => {
            const { item, segments, totalCx, planoRefCx, liberadoValidoCx } = ponto
            const hasValue = totalCx > 0
            const currentX = x(index)
            let acumulado = 0
            const pctTotal = mensalPctVsPlano(totalCx, item)

            return (
              <g key={item.mes}>
                {segments.map((segment) => {
                  const bottomValue = acumulado
                  const topValue = acumulado + segment.value
                  acumulado = topValue

                  const segmentY = y(topValue)
                  const segmentBottomY = y(bottomValue)
                  const segmentHeight = Math.max(0, segmentBottomY - segmentY)
                  const pctVsPlano = mensalPctVsPlano(segment.value, item)
                  const smallSegment = segmentHeight < 30

                  return (
                    <g key={`${item.mes}-${segment.id}`}>
                      <rect
                        x={currentX - barWidth / 2}
                        y={segmentY}
                        width={barWidth}
                        height={segmentHeight}
                        rx={segment.id === segments[segments.length - 1]?.id ? 7 : 2}
                        fill={item.simulado ? segment.soft : segment.color}
                        stroke={item.simulado ? segment.color : "none"}
                        strokeWidth={item.simulado ? 1.6 : 0}
                        strokeDasharray={item.simulado ? "4 3" : undefined}
                        opacity={0.98}
                      />

                      {!smallSegment ? (
                        <>
                          <text
                            x={currentX}
                            y={segmentY + segmentHeight / 2 - 4}
                            textAnchor="middle"
                            fontSize="7.1"
                            fontWeight="900"
                            fill={item.simulado ? "#991B1B" : "#FFFFFF"}
                          >
                            {fmt(segment.value)} cx
                          </text>
                          <text
                            x={currentX}
                            y={segmentY + segmentHeight / 2 + 8}
                            textAnchor="middle"
                            fontSize="6.3"
                            fontWeight="800"
                            fill={item.simulado ? "#991B1B" : "#F8FAFC"}
                          >
                            {fmtPct(pctVsPlano)}% ref.
                          </text>
                        </>
                      ) : (
                        <text
                          x={currentX + barWidth / 2 + 5}
                          y={segmentY + Math.max(8, segmentHeight / 2 + 2)}
                          textAnchor="start"
                          fontSize="6.8"
                          fontWeight="800"
                          fill="#64748B"
                        >
                          {segment.label}: {fmt(segment.value)} cx
                        </text>
                      )}
                    </g>
                  )
                })}

                {hasValue && (
                  <>
                    <text
                      x={currentX}
                      y={Math.max(18, y(totalCx) - 18)}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="900"
                      fill="#0F172A"
                    >
                      -{fmt(totalCx)} cx
                    </text>

                    <text
                      x={currentX}
                      y={Math.max(30, y(totalCx) - 6)}
                      textAnchor="middle"
                      fontSize="7.1"
                      fontWeight="800"
                      fill="#64748B"
                    >
                      {`${fmtPct(pctTotal)}% da ref.`}
                    </text>
                  </>
                )}

                {!hasValue && (
                  <line
                    x1={currentX - barWidth / 2}
                    x2={currentX + barWidth / 2}
                    y1={baselineY}
                    y2={baselineY}
                    stroke="#CBD5E1"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}

                <text
                  x={currentX}
                  y={baselineY + 21}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="900"
                  fill="#0F172A"
                >
                  {item.mes}
                </text>

                <text
                  x={currentX}
                  y={baselineY + 35}
                  textAnchor="middle"
                  fontSize="6.7"
                  fontWeight="800"
                  fill="#64748B"
                >
                  {item.baseline || (item.mes === "Jan" ? "Jan/V3" : `${item.mes}/V1`)}
                </text>

                <title>
                  {`${item.mes} (${item.baseline || "ref."})
Plano ref.: ${fmt(planoRefCx)} cx
Liberado válido: ${fmt(liberadoValidoCx)} cx
Atraso produção: ${fmt(Math.max(0, numero(item.atraso)))} cx
Reorg.: ${fmt(Math.max(0, numero(item.reorg)))} cx
Reprovação: ${fmt(Math.max(0, numero(item.reprovacao)))} cx
Total de perdas classificadas: ${fmt(totalCx)} cx`}
                </title>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "#F97316" }} />
          <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
            Atraso produção
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "#2563EB" }} />
          <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
            Reorg.
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "#DC2626" }} />
          <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
            Reprovação
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed" style={{ borderColor: "#DC2626", background: "#FEE2E2" }} />
          <span className="text-[10.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
            Simulado
          </span>
        </div>
      </div>
    </section>
  )
}

function VersionBridgeSection({
  steps,
  onClickReorganizacao,
}: {
  steps: WaterfallStep[]
  onClickReorganizacao: (step: WaterfallStep) => void
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
            Reorg. plano e Reprov. lote abrem detalhe
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
                  (step.id === "reorg-plano" || step.id.startsWith("reorganizacao"))
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
                        onClick={(step.id === "reorg-plano" || step.id.startsWith("reorganizacao") || step.id === "reprovacao") ? () => onClickReorganizacao(step) : undefined}
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
          Math.max(0, Math.round((mensalLiberadoValidoCx(month) || mensalPlanoRefCx(month)) * (averageLossPct / 100))),
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
        ? Math.max(0, Math.round(mensalPlanoRefCx(month) * (Number(averagePctInput || 0) / 100)))
        : Math.max(0, Number(customLosses[month.mes] || 0))

    const planoAtualCx = mensalLiberadoValidoCx(month) || mensalPlanoRefCx(month)

    return {
      ...month,
      v1: planoAtualCx,
      planoRefCx: planoAtualCx,
      planoAtualCx,
      perdaCx,
      ganhoCx: 0,
      disponibilidadeProjetadaCx: Math.max(0, planoAtualCx - perdaCx),
    }
  })

  const perdaProjetadaTotalCx = projectedLosses.reduce((acc, month) => acc + month.perdaCx, 0)
  const disponibilidadeSimuladaCx = Math.max(0, disponibilidadeAtualCx - perdaProjetadaTotalCx)
  const atingimentoAtual = orcadoCx > 0 ? (disponibilidadeAtualCx / orcadoCx) * 100 : 0
  const atingimentoSimulado = orcadoCx > 0 ? (disponibilidadeSimuladaCx / orcadoCx) * 100 : 0
  const maxPlanoMes = Math.max(...projectedLosses.map((month: any) => Number(month.planoAtualCx || mensalLiberadoValidoCx(month) || mensalPlanoRefCx(month))), 1)
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
              Aplica perdas simuladas nos meses futuros e recalcula a disponibilidade mensal contra o plano de referência.
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
                  const planoRefMes = Number((month as any).planoAtualCx || mensalLiberadoValidoCx(month) || mensalPlanoRefCx(month))
                  const planoY = y(planoRefMes)
                  const planoHeight = baselineY - planoY
                  const projetadoY = y(month.disponibilidadeProjetadaCx)
                  const projetadoHeight = baselineY - projetadoY
                  const pctMes = planoRefMes > 0 ? (month.disponibilidadeProjetadaCx / planoRefMes) * 100 : 0
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
                        {fmt(planoRefMes)} cx
                      </text>

                      <text
                        x={currentX}
                        y={Math.max(27, Math.min(planoY, projetadoY) - 6)}
                        textAnchor="middle"
                        fontSize="7.3"
                        fontWeight="800"
                        fill="#64748B"
                      >
                        plano atual
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
                      A simulação aplica esse percentual sobre o plano atual de cada mês futuro.
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
                    const planoRefMes = mensalPlanoRefCx(month)
                    const disponibilidadeProjetadaMes = Math.max(0, planoRefMes - perdaMes)

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
                              Plano atual {fmt(planoRefMes)} cx
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
                    <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-wider">Lotes</th>
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
  const [modalWaterfallStep, setModalWaterfallStep] = useState<WaterfallStep | null>(null)
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
  const [statusCausasAnuais, setStatusCausasAnuais] = useState<"carregando" | "ok" | "parcial" | "erro">("carregando")
  const [mensagemCausasAnuais, setMensagemCausasAnuais] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    async function carregarDados() {
      try {
        setCarregandoDados(true)
        setErroCarga(null)
        setStatusCausasAnuais("carregando")
        setMensagemCausasAnuais("Calculando Reorg./Atraso pelo Gantt e Desvios/Rendimento pelo Rastreamento.")

        const cacheLocal = getOverviewLocalCache()
        if (cacheLocal && ativo) {
          setApiData(semCausasAnuais(montarApiDataDaOverviewCache(cacheLocal)))
          setCarregandoDados(false)
        }

        const resumo = await fetchJson(`${API_BASE}/overview/resumo?allow_stale=true&_t=${Date.now()}`)
        const payload = resumo?.payload || {}
        const ano = Number(resumo?.ano || payload?.ano || new Date().getFullYear())
        const mesAtual = Number(resumo?.mes_atual || payload?.mes_atual || new Date().getMonth() + 1)

        const plano1 = await carregarPlano1Leve(ano, estoqueJanDoPayload(payload))
        const ponteVersoes = await carregarPonteVersoesMps(ano, mesAtual)

        if (ativo) {
          const parcial = semCausasAnuais(
            aplicarPonteVersoes(
              aplicarPlano1Override(montarApiDataDaOverviewResumo(resumo), plano1),
              ponteVersoes,
            ),
          )

          setApiData(parcial)
          setCarregandoDados(false)
        }

        // Importante: a cascata anual NÃO pode esperar todos os rastreamentos mensais.
        // O endpoint /causas-anuais já traz a abertura anual pronta. Antes, a tela
        // ficava presa em "Calculando..." porque o Promise.all aguardava também
        // carregarRastreamentosDoCache(12 meses), que é bem mais pesado.
        const [causasAnuais, lotesReprovadosDesvios] = await Promise.all([
          carregarCausasAnuaisReais(ano),
          carregarLotesReprovadosDesvios(ano),
        ])

        if (!ativo) return

        const baseSemRastreamentos = aplicarPonteVersoes(
          aplicarPlano1Override(montarApiDataDaOverviewResumo(resumo), plano1),
          ponteVersoes,
        )

        if (causasAnuais && Array.isArray(causasAnuais.steps) && causasAnuais.steps.length >= 2) {
          if (temCausaClassificada(causasAnuais)) {
            setStatusCausasAnuais("ok")
            setMensagemCausasAnuais(null)
            setApiData(aplicarCausasAnuais(baseSemRastreamentos, causasAnuais, lotesReprovadosDesvios))
          } else {
            setStatusCausasAnuais("parcial")
            setMensagemCausasAnuais(
              "O backend retornou apenas saldo a abrir. Isso significa que a diferença ainda não foi quebrada em Reorg., Atraso, Desvios ou Rendimento.",
            )
            setApiData(semCausasAnuais(baseSemRastreamentos))
          }
        } else {
          setStatusCausasAnuais("erro")
          setMensagemCausasAnuais("A abertura real das causas ainda não retornou. O gráfico anual foi ocultado para não classificar o saldo como atraso.")
          setApiData(semCausasAnuais(baseSemRastreamentos))
        }

        // Depois que a cascata anual já apareceu, carrega os rastreamentos mensais
        // para refinar o gráfico inferior. Se demorar/falhar, não derruba a tela.
        try {
          const rastreamentos = await carregarRastreamentosDoCache(ano, mesAtual)

          if (!ativo) return

          const baseCompleta = aplicarPonteVersoes(
            aplicarPlano1Override(montarApiDataDaOverviewResumo(resumo, rastreamentos), plano1),
            ponteVersoes,
          )

          if (causasAnuais && temCausaClassificada(causasAnuais)) {
            setApiData(aplicarCausasAnuais(baseCompleta, causasAnuais, lotesReprovadosDesvios))
          } else {
            setApiData(semCausasAnuais(baseCompleta))
          }
        } catch (rastError) {
          console.warn("Não foi possível carregar rastreamentos mensais da Liberação Executiva.", rastError)
        }
      } catch (error) {
        console.warn("Não foi possível carregar a Liberação Executiva.", error)

        if (ativo) {
          const cacheLocal = getOverviewLocalCache()

          if (cacheLocal) {
            setApiData(semCausasAnuais(montarApiDataDaOverviewCache(cacheLocal)))
            setStatusCausasAnuais("erro")
            setMensagemCausasAnuais("A abertura real das causas ainda não retornou.")
          } else {
            setErroCarga(error instanceof Error ? error.message : "Erro ao carregar dados")
          }
        }
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
                ? "A página está usando a mesma base da Overview."
                : `O backend não retornou os dados da Liberação Executiva. Erro: ${erroCarga || "desconhecido"}`}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const dadosFallback = {
    orcadoFaturamentoCx: 0,
    faturamentoProjetadoCx: 0,
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
  const waterfallSteps: WaterfallStep[] = (apiData?.waterfallSteps || []).filter(
    (step) => step.kind === "total" || Math.abs(Number(step.value || 0)) >= 1,
  )
  const causasAnuaisProntas = statusCausasAnuais === "ok" && waterfallSteps.length > 0
  const tituloStatusCausas =
    statusCausasAnuais === "erro"
      ? "Causas anuais não carregadas"
      : statusCausasAnuais === "parcial"
        ? "Abertura parcial"
        : "Abrindo causas reais"
  const corStatusCausas =
    statusCausasAnuais === "erro"
      ? "#B91C1C"
      : statusCausasAnuais === "parcial"
        ? "#B45309"
        : "var(--text-secondary)"
  const fundoStatusCausas =
    statusCausasAnuais === "erro"
      ? "#FEF2F2"
      : statusCausasAnuais === "parcial"
        ? "#FFFBEB"
        : "#F8FAFC"

  const perdasMensais: MonthlyLossesItem[] = apiData?.perdasMensais || []

  const mesesFuturos = perdasMensais.filter((item) => item.status === "futuro")
  const perdasRealizadas = perdasMensais.filter((item) => item.status !== "futuro")
  const mapaCustomVazio = Object.fromEntries(mesesFuturos.map((item) => [item.mes, 0])) as Record<string, number>

  const perdaRealizadaTotalCx = perdasRealizadas.reduce(
    (acc, item) => acc + mensalPerdaCx(item),
    0,
  )
  const baseRealizadaTotalCx = perdasRealizadas.reduce((acc, item) => acc + mensalPlanoRefCx(item), 0)
  const percentualMedioPerdaAtual = baseRealizadaTotalCx > 0
    ? (perdaRealizadaTotalCx / baseRealizadaTotalCx) * 100
    : 0

  const simulacaoCustomAtual =
    simulacaoAplicada?.custom && Object.keys(simulacaoAplicada.custom).length > 0
      ? simulacaoAplicada.custom
      : mapaCustomVazio

  const perdasMensaisPlotadas: MonthlyLossesItem[] = perdasMensais.map((item) => {
    if (item.status !== "futuro" || !simulacaoAplicada) return item

    const planoRefCx = mensalPlanoRefCx(item)
    const perdaTotalCx =
      simulacaoAplicada.modo === "media"
        ? Math.max(0, Math.round(planoRefCx * (simulacaoAplicada.percentual / 100)))
        : Math.max(0, Number(simulacaoCustomAtual[item.mes] || 0))

    if (perdaTotalCx <= 0) return item

    const liberadoValidoCx = Math.max(0, planoRefCx - perdaTotalCx)

    return {
      ...item,
      v1: planoRefCx,
      planoRefCx,
      liberadoValidoCx,
      perdaCx: perdaTotalCx,
      ganhoCx: 0,

      // Compatibilidade com versões antigas do componente: a perda mensal fica
      // em uma barra única, sem distribuir por causa.
      atraso: perdaTotalCx,
      reorg: 0,
      reprovacao: 0,
      saldo: 0,
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

  const abrirModalWaterfall = (step: WaterfallStep) => {
    if (step.id === "reorg-plano" || step.id === "reprovacao") {
      setModalWaterfallStep(step)
      return
    }

    if (step.id.startsWith("reorganizacao")) {
      setModalReorganizacaoAberto(true)
    }
  }

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

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              title="Orçado faturamento"
              value={`${fmt(dados.orcadoFaturamentoCx)} cx`}
              sub={fmtTubetes(dados.orcadoFaturamentoCx)}
              tone="blue"
              icon={Target}
            />

            <KpiCard
              title="Faturamento real + S&OP"
              value={`${fmt(dados.faturamentoProjetadoCx)} cx`}
              sub={fmtTubetes(dados.faturamentoProjetadoCx)}
              tone="green"
              icon={BarChart3}
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

          {causasAnuaisProntas ? (
            <WaterfallChart
              steps={waterfallSteps}
              orcadoFaturamentoCx={dados.orcadoFaturamentoCx}
              onClickReorganizacao={abrirModalWaterfall}
            />
          ) : (
            <div className="px-6 pb-5 pt-4">
              <div
                className="flex items-start justify-between gap-4 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: "var(--border)",
                  background: fundoStatusCausas,
                }}
              >
                <div className="min-w-0">
                  <p
                    className="text-[11px] font-black uppercase tracking-[0.18em]"
                    style={{ color: corStatusCausas }}
                  >
                    {tituloStatusCausas}
                  </p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {mensagemCausasAnuais || "Varrendo versões do Gantt/MPS, Desvios e SD3."}
                  </p>
                  <p className="mt-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    A cascata só aparece quando houver causa real classificada. Saldo sozinho não vira atraso.
                  </p>
                </div>

                {statusCausasAnuais === "carregando" && (
                  <div className="mt-1 h-2 w-28 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-1/2 rounded-full bg-slate-400" />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <MonthlyLossesStackedChart
          data={perdasMensaisPlotadas}
          onOpenSimulator={abrirSimuladorPerdas}
          simulacaoAtiva={!!simulacaoAplicada}
        />

        {ponteVersoesSteps.length > 0 && (
          <VersionBridgeSection
            steps={ponteVersoesSteps}
            onClickReorganizacao={abrirModalWaterfall}
          />
        )}
      </div>

      <WaterfallStepModal
        step={modalWaterfallStep}
        onClose={() => setModalWaterfallStep(null)}
      />

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
