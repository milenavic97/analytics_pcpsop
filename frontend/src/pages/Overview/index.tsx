import { useState, useEffect, useMemo } from "react"
import {
  DollarSign, PackageCheck, TrendingUp, TrendingDown, BarChart3, Package, CalendarDays, ChevronDown, ChevronUp,
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

  const dataFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data)

  const horaFmt = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(data)

  return `${dataFmt} às ${horaFmt}`
}

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

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

    Object.keys(window.sessionStorage)
      .filter(deveRemover)
      .forEach((key) => window.sessionStorage.removeItem(key))

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

function limparCacheMemoriaOverview() {
  overviewPageMemoryCache = null
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
  // Cache só em memória do app: rápido ao navegar e seguro entre computadores.
  overviewPageMemoryCache = {
    ...snapshot,
    savedAt: Date.now(),
  }
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
    } else if (numeroMes === mesAtual) {
      // Mês atual oficial = SD3 MTD total vindo da conciliação do Rastreamento.
      totalReal += Number(mes.entradas_real_mes_atual ?? entrada ?? 0)
    } else {
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

export function OverviewPage() {
  const [cacheInicial] = useState<OverviewPageSnapshot | null>(() => readOverviewPageCache())

  const [modalLib, setModalLib]               = useState(false)
  const [modalFatOrc, setModalFatOrc]         = useState(false)
  const [modalFatProj, setModalFatProj]       = useState(false)
  const [modalLibProj, setModalLibProj]       = useState(false)
  const [modalPrevistoHoje, setModalPrevistoHoje] = useState(false)
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
        // não refaz nenhuma chamada pesada. Como cache local foi desativado, a referência
        // de completude agora é o próprio estado da tela, não localStorage.
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

        if (precisaRecalcular) {
          setAtualizandoAutomatico(true)
          setCarregarDetalhes(false)
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

  return (
    <div className="min-h-screen space-y-6 p-3 md:space-y-8 md:p-6">

      {/* Título */}
      <div className="fade-in flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl" style={{ color: "var(--text-primary)" }}>
            Overview - Anestésicos Injetáveis
          </h1>

          <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
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
        </div>
      </div>

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
    </div>
  )
}
