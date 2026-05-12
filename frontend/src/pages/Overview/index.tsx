import { useState, useEffect } from "react"
import {
  DollarSign, PackageCheck, TrendingUp, TrendingDown, BarChart3, Package,
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
  getOrcadoLiberacao, getOrcadoFaturamento, getProjecaoFaturamento,
  getProjecaoLiberacoes, getEstoqueMensal, getDisponibilidadeMensal,
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

const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]

interface ProjFat { total_real: number; total_forecast: number; total_projetado: number; total_orcado: number; pct_atingimento: number; delta_caixas: number; ultimo_mes_fechado: number }
interface ProjLib { total_real: number; total_previsto: number; total_projetado: number; total_orcado: number; pct_atingimento: number; delta_caixas: number; ultimo_mes_fechado: number }
interface EstoqueMes { mes: number; qtd_caixas: number }
interface GrupoItem { grupo: string; qtd_caixas: number; pct?: number }
interface DisponibilidadeMes { mes: number; entradas_real_mes_atual?: number | null; entradas_previstas_mtd?: number | null; entradas_previstas_mtd_por_grupo?: GrupoItem[] | null; entradas_real_mes_atual_por_grupo?: GrupoItem[] | null }
interface DisponibilidadePayload { mes_atual: number; entradas_previstas_mtd: number; entradas_previstas_mtd_por_grupo: GrupoItem[]; meses: DisponibilidadeMes[] }
interface PrevistoHojeItem { grupo: string; previsto_ate_hoje: number; realizado_mtd: number }

export function OverviewPage() {
  const [modalLib, setModalLib]               = useState(false)
  const [modalFatOrc, setModalFatOrc]         = useState(false)
  const [modalFatProj, setModalFatProj]       = useState(false)
  const [modalLibProj, setModalLibProj]       = useState(false)
  const [modalPrevistoHoje, setModalPrevistoHoje] = useState(false)

  const [orcadoLib, setOrcadoLib]             = useState<{ total_caixas: number; total_tubetes: number } | null>(null)
  const [orcadoFat, setOrcadoFat]             = useState<{ total_caixas: number } | null>(null)
  const [projFat, setProjFat]                 = useState<ProjFat | null>(null)
  const [projLib, setProjLib]                 = useState<ProjLib | null>(null)
  const [estoqueJan, setEstoqueJan]           = useState(0)
  const [previstoHoje, setPrevistoHoje]       = useState(0)
  const [realMtd, setRealMtd]                 = useState(0)
  const [detalhePrevistoHoje, setDetalhePrevistoHoje] = useState<PrevistoHojeItem[]>([])

  useEffect(() => {
    getOrcadoLiberacao().then((d: unknown) => setOrcadoLib(d as any)).catch(() => {})
    getOrcadoFaturamento().then((d: unknown) => setOrcadoFat(d as any)).catch(() => {})
    getProjecaoFaturamento().then((d: unknown) => setProjFat(d as ProjFat)).catch(() => {})
    getProjecaoLiberacoes().then((d: unknown) => setProjLib(d as ProjLib)).catch(() => {})
    getEstoqueMensal().then((d: unknown) => {
      const meses = d as EstoqueMes[]
      const jan = meses.find((m) => Number(m.mes) === 1)
      setEstoqueJan(Number(jan?.qtd_caixas || 0))
    }).catch(() => setEstoqueJan(0))

    getDisponibilidadeMensal().then((d: unknown) => {
      const data = d as DisponibilidadePayload
      const mesAtual = data.meses?.find((m) => Number(m.mes) === Number(data.mes_atual))
      const previsto = Number(data.entradas_previstas_mtd || mesAtual?.entradas_previstas_mtd || 0)
      const realizado = Number(mesAtual?.entradas_real_mes_atual || 0)
      setPrevistoHoje(previsto)
      setRealMtd(realizado)
      const previstoGrupos = data.entradas_previstas_mtd_por_grupo || mesAtual?.entradas_previstas_mtd_por_grupo || []
      const realGrupos = mesAtual?.entradas_real_mes_atual_por_grupo || []
      const realMap = new Map<string, number>()
      realGrupos.forEach((g) => realMap.set(g.grupo, Number(g.qtd_caixas || 0)))
      setDetalhePrevistoHoje(previstoGrupos.map((g) => ({
        grupo: g.grupo,
        previsto_ate_hoje: Number(g.qtd_caixas || 0),
        realizado_mtd: Number(realMap.get(g.grupo) || 0),
      })))
    }).catch(() => { setPrevistoHoje(0); setRealMtd(0); setDetalhePrevistoHoje([]) })
  }, [])

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
      <div className="fade-in">
        <h1 className="text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>Overview 2026</h1>
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
            <DemandaDisponibilidadeChart />
          </div>
        </div>
        <div className="mt-6">
          <GrupoDisponibilidadeTableV2 />
        </div>
        <div className="mt-6">
          <RastreamentoLotes />
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
