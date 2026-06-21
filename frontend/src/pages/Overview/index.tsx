import { useState, useEffect } from "react"
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
interface PrevistoHojeItem { grupo: string; previsto_ate_hoje: number; realizado_mtd: number }
interface UltimaAtualizacaoPayload { base_id: string; ultima_atualizacao: string | null }

const OVERVIEW_PAGE_CACHE_KEY = "dfl-overview-page-cache-v1"
const OVERVIEW_PAGE_CACHE_TTL_MS = 12 * 60 * 60 * 1000

type OverviewPageSnapshot = {
  savedAt: number
  version: string | null
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

function readOverviewPageCache(): OverviewPageSnapshot | null {
  try {
    if (typeof window === "undefined") return null

    const raw = window.localStorage.getItem(OVERVIEW_PAGE_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as OverviewPageSnapshot

    if (!parsed || typeof parsed.savedAt !== "number") {
      window.localStorage.removeItem(OVERVIEW_PAGE_CACHE_KEY)
      return null
    }

    if (Date.now() - parsed.savedAt > OVERVIEW_PAGE_CACHE_TTL_MS) {
      window.localStorage.removeItem(OVERVIEW_PAGE_CACHE_KEY)
      return null
    }

    if (!isOverviewSnapshotCompleto(parsed)) {
      window.localStorage.removeItem(OVERVIEW_PAGE_CACHE_KEY)
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function writeOverviewPageCache(snapshot: Omit<OverviewPageSnapshot, "savedAt">) {
  try {
    if (typeof window === "undefined") return

    window.localStorage.setItem(
      OVERVIEW_PAGE_CACHE_KEY,
      JSON.stringify({
        ...snapshot,
        savedAt: Date.now(),
      })
    )
  } catch {
    // Cache local é apenas acelerador de tela.
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

  function aplicarResumo(resumo: OverviewResumoResponse) {
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

    setVersaoCarregada(resumo.versao_base)
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

        // Se a versão do banco é a mesma que já está na tela,
        // não refaz nenhuma chamada pesada.
        if (
          versaoCarregada === versao.versao_base &&
          isOverviewSnapshotCompleto(readOverviewPageCache())
        ) {
          if (!carregarDetalhes) {
            window.setTimeout(() => {
              if (alive) setCarregarDetalhes(true)
            }, 500)
          }
          return
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

    return () => {
      alive = false
      if (intervalId) window.clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoCarregada])



  const pctFat = projFat?.pct_atingimento ?? 0
  const pctLib = projLib?.pct_atingimento ?? 0
  const ultimoMesFat = projFat ? MES_LABELS[(projFat.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""
  const ultimoMesLib = projLib ? MES_LABELS[(projLib.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""
  const corPctFat = pctFat >= 100 ? "#16A34A" : pctFat >= 95 ? "#F59E0B" : pctFat > 0 ? "#DC2626" : "var(--text-primary)"
  const corPctLib = pctLib >= 100 ? "#16A34A" : pctLib >= 95 ? "#F59E0B" : pctLib > 0 ? "#DC2626" : "var(--text-primary)"
  const disponibilidadeAnual = projLib ? projLib.total_projetado + estoqueJan : 0
  const pctDispVsFat = projLib && orcadoFat && orcadoFat.total_caixas > 0 ? (disponibilidadeAnual / orcadoFat.total_caixas) * 100 : 0
  const gapDispVsFatCaixas = projLib && orcadoFat ? disponibilidadeAnual - orcadoFat.total_caixas : 0
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
          <KpiCard label="Orçado de liberações anual" value={orcadoLib ? `${fmt(orcadoLib.total_caixas)} cx` : "Carregando..."} sub={orcadoLib ? `${fmt(tubetes(orcadoLib.total_caixas))} tubetes` : undefined} Icon={PackageCheck} iconBg="#F5F3FF" iconColor="#7C3AED" onClick={() => setModalLib(true)} delay={260} />
          <KpiCard label="Liberações reais + previstas" value={projLib ? `${fmt(projLib.total_projetado)} cx` : "—"} sub={projLib ? `${fmt(tubetes(projLib.total_projetado))} tubetes` : "aguardando base"} Icon={Package} iconBg="#F0FDF4" iconColor="#16A34A" onClick={projLib ? () => setModalLibProj(true) : undefined} delay={320} />
          <KpiCard label="% Liberações vs orçado" value={projLib && pctLib > 0 ? `${pctLib.toFixed(1).replace(".", ",")}%` : "—"} sub={projLib && ultimoMesLib ? `fechado até ${ultimoMesLib}/26` : undefined} delta={projLib && projLib.delta_caixas !== 0 ? `${fmt(projLib.delta_caixas)} cx / ${fmt(tubetes(projLib.delta_caixas))} tubetes vs orçado` : undefined} positive={projLib ? projLib.delta_caixas >= 0 : undefined} neutral={pctLib >= 95 && pctLib < 100} valueColor={corPctLib} Icon={TrendingUp} iconBg="#FFF7ED" iconColor="#EA580C" delay={380} />
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
              { label: "Disponibilidade anual", value: projLib ? `${fmt(disponibilidadeAnual)} cx` : "—", sub: projLib ? `${fmt(tubetes(disponibilidadeAnual))} tubetes` : "—", w: 700 },
              { label: "Liberações", value: projLib ? `${fmt(projLib.total_projetado)} cx` : "—", sub: projLib ? `${fmt(tubetes(projLib.total_projetado))} tubetes` : "—", w: 600 },
              { label: "Estoque inicial Jan", value: `${fmt(estoqueJan)} cx`, sub: `${fmt(tubetes(estoqueJan))} tubetes`, w: 600 },
              { label: "Orçado faturamento", value: orcadoFat ? `${fmt(orcadoFat.total_caixas)} cx` : "—", sub: orcadoFat ? `${fmt(tubetes(orcadoFat.total_caixas))} tubetes` : "—", w: 600 },
              { label: "Gap", value: projLib && orcadoFat ? `${fmt(gapDispVsFatCaixas)} cx` : "—", sub: projLib && orcadoFat ? `${fmt(tubetes(gapDispVsFatCaixas))} tubetes` : "—", w: 600, gap: true },
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
              <DemandaDisponibilidadeChart initialData={disponibilidadeMensal} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm font-medium text-slate-400">
                Preparando gráfico...
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          {carregarDetalhes ? (
            <RastreamentoLotes onMtdLoad={(p, l) => {
              setMtdCxPrevisto(p)
              setMtdCxLiberado(l)

              const snapshot = readOverviewPageCache()
              if (snapshot) {
                writeOverviewPageCache({
                  ...snapshot,
                  mtdCxPrevisto: p,
                  mtdCxLiberado: l,
                })
              }
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
