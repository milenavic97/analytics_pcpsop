import { useState, useEffect } from "react"
import {
  DollarSign, PackageCheck, TrendingUp, TrendingDown, BarChart3, Package
} from "lucide-react"
import { DisponibilidadeModal } from "@/components/charts/DisponibilidadeModal"
import { OrcadoFaturamentoModal } from "@/components/charts/OrcadoFaturamentoModal"
import { ProjecaoFaturamentoModal } from "@/components/charts/ProjecaoFaturamentoModal"
import { ProjecaoLiberacoesModal } from "@/components/charts/ProjecaoLiberacoesModal"
import { DemandaDisponibilidadeChart } from "@/components/charts/DemandaDisponibilidadeChart"
import {
  getOrcadoLiberacao,
  getOrcadoFaturamento,
  getProjecaoFaturamento,
  getProjecaoLiberacoes,
} from "@/services/api"

const TUBETES_POR_CAIXA = 500

interface KpiProps {
  label: string
  value: string
  sub?: string
  delta?: string
  positive?: boolean
  neutral?: boolean
  onClick?: () => void
  delay?: number
  iconBg?: string
  iconColor?: string
  Icon?: React.ElementType
  valueColor?: string
}

function KpiCard({ label, value, sub, delta, positive, neutral, onClick, delay = 0, iconBg, iconColor, Icon, valueColor }: KpiProps) {
  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${delay}ms`, cursor: onClick ? "pointer" : "default" }}
      className="card p-5 flex flex-col gap-3 fade-in"
    >
      <div className="flex items-start justify-between">
        <span className="card-label">{label}</span>
        {Icon && (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: iconBg || "#EFF6FF" }}
          >
            <Icon size={18} style={{ color: iconColor || "#2563EB" }} />
          </div>
        )}
      </div>
      <div>
        <p className="card-value" style={{ color: valueColor || "var(--text-primary)" }}>{value}</p>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {delta && (
        <div
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: neutral ? "#F59E0B" : positive ? "#16A34A" : "#DC2626" }}
        >
          {!neutral && (positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />)}
          <span>{delta}</span>
        </div>
      )}
      {onClick && (
        <p className="text-[10px] mt-auto" style={{ color: "var(--text-secondary)" }}>
          Clique para detalhes
        </p>
      )}
    </div>
  )
}

function fmt(n: number) {
  if (isNaN(n) || n == null) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

const MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

interface ProjFat {
  total_real: number
  total_forecast: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  ultimo_mes_fechado: number
}

interface ProjLib {
  total_real: number
  total_previsto: number
  total_projetado: number
  total_orcado: number
  pct_atingimento: number
  delta_caixas: number
  ultimo_mes_fechado: number
}

export function OverviewPage() {
  const [modalLib, setModalLib] = useState(false)
  const [modalFatOrc, setModalFatOrc] = useState(false)
  const [modalFatProj, setModalFatProj] = useState(false)
  const [modalLibProj, setModalLibProj] = useState(false)

  const [orcadoLib, setOrcadoLib] = useState<{ total_caixas: number; total_tubetes: number } | null>(null)
  const [orcadoFat, setOrcadoFat] = useState<{ total_caixas: number } | null>(null)
  const [projFat, setProjFat] = useState<ProjFat | null>(null)
  const [projLib, setProjLib] = useState<ProjLib | null>(null)

  useEffect(() => {
    getOrcadoLiberacao()
      .then((d: unknown) => setOrcadoLib(d as { total_caixas: number; total_tubetes: number }))
      .catch(() => {})

    getOrcadoFaturamento()
      .then((d: unknown) => setOrcadoFat(d as { total_caixas: number }))
      .catch(() => {})

    getProjecaoFaturamento()
      .then((d: unknown) => setProjFat(d as ProjFat))
      .catch(() => {})

    getProjecaoLiberacoes()
      .then((d: unknown) => setProjLib(d as ProjLib))
      .catch(() => {})
  }, [])

  const pctFat = projFat?.pct_atingimento ?? 0
  const pctLib = projLib?.pct_atingimento ?? 0

  const corPctFat = pctFat >= 100 ? "#16A34A" : pctFat >= 95 ? "#F59E0B" : pctFat > 0 ? "#DC2626" : "var(--text-primary)"
  const corPctLib = pctLib >= 100 ? "#16A34A" : pctLib >= 95 ? "#F59E0B" : pctLib > 0 ? "#DC2626" : "var(--text-primary)"

  const ultimoMesFat = projFat ? MES_LABELS[(projFat.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""
  const ultimoMesLib = projLib ? MES_LABELS[(projLib.ultimo_mes_fechado ?? 1) - 1] ?? "" : ""

  const orcadoLibTubetes = orcadoLib ? orcadoLib.total_caixas * TUBETES_POR_CAIXA : 0
  const projLibTubetes = projLib ? projLib.total_projetado * TUBETES_POR_CAIXA : 0
  const projLibRealTubetes = projLib ? projLib.total_real * TUBETES_POR_CAIXA : 0
  const projLibPrevTubetes = projLib ? projLib.total_previsto * TUBETES_POR_CAIXA : 0
  const deltaLibTubetes = projLib ? projLib.delta_caixas * TUBETES_POR_CAIXA : 0

  return (
    <div className="p-6 space-y-8 min-h-screen">
      <div className="fade-in">
        <p
          className="text-[10px] font-medium uppercase tracking-widest mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          S&OP · Visão Geral
        </p>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Overview 2026</h1>
      </div>

      <section>
        <p className="card-label mb-3 fade-in fade-in-1">Faturamento</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Orçado anual"
            value={orcadoFat ? `${fmt(orcadoFat.total_caixas)} cx` : "Carregando..."}
            Icon={DollarSign}
            iconBg="#EFF6FF"
            iconColor="#2563EB"
            onClick={() => setModalFatOrc(true)}
            delay={80}
          />
          <KpiCard
            label="Faturamento real + S&OP"
            value={projFat ? `${fmt(projFat.total_projetado)} cx` : "—"}
            sub={projFat ? `Real ${fmt(projFat.total_real)} + S&OP ${fmt(projFat.total_forecast)} cx` : "aguardando base"}
            Icon={BarChart3}
            iconBg="#F0FDF4"
            iconColor="#16A34A"
            onClick={projFat ? () => setModalFatProj(true) : undefined}
            delay={140}
          />
          <KpiCard
            label="% Atingimento"
            value={projFat && pctFat > 0 ? `${pctFat.toFixed(1).replace(".", ",")}%` : "—"}
            sub={projFat && ultimoMesFat ? `fechado até ${ultimoMesFat}/26` : undefined}
            delta={projFat && projFat.delta_caixas !== 0 ? `${fmt(projFat.delta_caixas)} cx vs orçado` : undefined}
            positive={projFat ? projFat.delta_caixas >= 0 : undefined}
            neutral={pctFat >= 95 && pctFat < 100}
            valueColor={corPctFat}
            Icon={TrendingUp}
            iconBg="#FFF7ED"
            iconColor="#EA580C"
            delay={200}
          />
        </div>
      </section>

      <section>
        <p className="card-label mb-3 fade-in fade-in-2">Liberações</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Orçado de liberações anual"
            value={orcadoLib ? `${fmt(orcadoLib.total_caixas)} cx` : "Carregando..."}
            sub={orcadoLib ? `${fmt(orcadoLibTubetes)} tb` : undefined}
            Icon={PackageCheck}
            iconBg="#F5F3FF"
            iconColor="#7C3AED"
            onClick={() => setModalLib(true)}
            delay={260}
          />
          <KpiCard
            label="Liberações reais + previstas"
            value={projLib ? `${fmt(projLib.total_projetado)} cx` : "—"}
            sub={projLib ? `Real ${fmt(projLib.total_real)} + Prev. ${fmt(projLib.total_previsto)} cx · ${fmt(projLibTubetes)} tb` : "aguardando base"}
            Icon={Package}
            iconBg="#F0FDF4"
            iconColor="#16A34A"
            onClick={projLib ? () => setModalLibProj(true) : undefined}
            delay={320}
          />
          <KpiCard
            label="% Liberações vs orçado"
            value={projLib && pctLib > 0 ? `${pctLib.toFixed(1).replace(".", ",")}%` : "—"}
            sub={projLib && ultimoMesLib ? `fechado até ${ultimoMesLib}/26` : undefined}
            delta={projLib && projLib.delta_caixas !== 0 ? `${fmt(projLib.delta_caixas)} cx / ${fmt(deltaLibTubetes)} tb vs orçado` : undefined}
            positive={projLib ? projLib.delta_caixas >= 0 : undefined}
            neutral={pctLib >= 95 && pctLib < 100}
            valueColor={corPctLib}
            Icon={TrendingUp}
            iconBg="#FFF7ED"
            iconColor="#EA580C"
            delay={380}
          />
        </div>
      </section>

      <section className="fade-in fade-in-4">
        <p className="card-label mb-3">Demanda vs. Disponibilidade mensal</p>
        <DemandaDisponibilidadeChart />
      </section>

      <DisponibilidadeModal open={modalLib} onClose={() => setModalLib(false)} />
      <OrcadoFaturamentoModal open={modalFatOrc} onClose={() => setModalFatOrc(false)} />
      <ProjecaoFaturamentoModal open={modalFatProj} onClose={() => setModalFatProj(false)} />
      <ProjecaoLiberacoesModal open={modalLibProj} onClose={() => setModalLibProj(false)} />
    </div>
  )
}
