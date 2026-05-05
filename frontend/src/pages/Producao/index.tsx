import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, Factory, Gauge, Timer } from "lucide-react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
} from "recharts"
import { getProducaoResumoMensal } from "@/services/api"

type MesProducao = {
  mes: number
  mes_label: string
  l1_tubetes: number
  l2_tubetes: number
  l1_caixas: number
  l2_caixas: number
  l1_horas_produtivas: number
  l2_horas_produtivas: number
  l1_horas_apontadas: number
  l2_horas_apontadas: number
  l1_tubetes_hora: number
  l2_tubetes_hora: number
  total_tubetes: number
  total_caixas: number
}

type LinhaResumo = {
  producao_tubetes: number
  producao_caixas: number
  horas_produtivas: number
  horas_apontadas: number
  aproveitamento_operacional: number
  produtividade_tubetes_hora: number
  mix_pct: number
}

type ProducaoResumo = {
  ano: number
  total_producao_tubetes: number
  total_producao_caixas: number
  horas_produtivas: number
  horas_apontadas: number
  aproveitamento_operacional: number
  produtividade_tubetes_hora: number
  l1: LinhaResumo
  l2: LinhaResumo
  meses: MesProducao[]
}

const COR_L1 = "#27336D"
const COR_L2 = "#6A7FC0"
const COR_GRID = "#E5E7EB"
const COR_TEXTO = "#6B7280"

function fmt(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n || 0)))
}

function fmt1(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(n || 0))
}

function fmtHoras(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(n || 0))
}

function KpiMiniCard({
  label,
  value,
  sub,
  icon,
  delay,
}: {
  label: string
  value: string
  sub?: string
  icon: ReactNode
  delay?: number
}) {
  return (
    <div className="card p-5 fade-in" style={{ animationDelay: `${delay || 0}ms` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p className="card-label" style={{ marginBottom: 8 }}>{label}</p>
          <p className="card-value">{value}</p>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#EFF6FF",
            color: "#27336D",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

function LinhaCards({
  titulo,
  linha,
  cor,
  delayBase,
}: {
  titulo: string
  linha: LinhaResumo
  cor: string
  delayBase: number
}) {
  return (
    <section>
      <p className="card-label mb-3 fade-in" style={{ color: cor }}>
        {titulo}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiMiniCard
          label="Produção"
          value={`${fmt(linha.producao_tubetes)} tb`}
          sub={`${fmt(linha.producao_caixas)} cx · ${fmt1(linha.mix_pct)}% do total`}
          icon={<Factory size={18} />}
          delay={delayBase}
        />
        <KpiMiniCard
          label="Horas produtivas"
          value={`${fmtHoras(linha.horas_produtivas)} h`}
          sub={`Apontadas: ${fmtHoras(linha.horas_apontadas)} h`}
          icon={<Timer size={18} />}
          delay={delayBase + 60}
        />
        <KpiMiniCard
          label="Aproveitamento"
          value={`${fmt1(linha.aproveitamento_operacional)}%`}
          sub="Horas produção / horas apontadas"
          icon={<Gauge size={18} />}
          delay={delayBase + 120}
        />
        <KpiMiniCard
          label="Produtividade"
          value={`${fmt(linha.produtividade_tubetes_hora)} tb/h`}
          sub="Tubetes por hora produtiva"
          icon={<Activity size={18} />}
          delay={delayBase + 180}
        />
      </div>
    </section>
  )
}

const BarLabel = (color: string) => (props: any) => {
  const { x, y, width, value } = props
  if (!value || Number(value) <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill={color}
    >
      {fmt(value)}
    </text>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload as MesProducao

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 10px 26px rgba(0,0,0,0.12)",
        fontSize: 12,
        minWidth: 250,
      }}
    >
      <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 10 }}>
        {label}/26
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L1 produzido</span>
          <strong style={{ color: COR_L1 }}>{fmt(row.l1_tubetes)} tb</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L1 caixas</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmt(row.l1_caixas)} cx</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L1 horas produtivas</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmtHoras(row.l1_horas_produtivas)} h</strong>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />

        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L2 produzido</span>
          <strong style={{ color: COR_L2 }}>{fmt(row.l2_tubetes)} tb</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L2 caixas</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmt(row.l2_caixas)} cx</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "var(--text-secondary)" }}>L2 horas produtivas</span>
          <strong style={{ color: "var(--text-primary)" }}>{fmtHoras(row.l2_horas_produtivas)} h</strong>
        </div>
      </div>
    </div>
  )
}

function ProducaoMensalChart({ data }: { data: MesProducao[] }) {
  return (
    <div className="card p-6 fade-in fade-in-2">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
        <div>
          <p className="card-label" style={{ marginBottom: 4 }}>Produção mensal por linha</p>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
            Envasadoras L1 e L2
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 12, borderRadius: 3, background: COR_L1 }} />
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>L1</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 12, borderRadius: 3, background: COR_L2 }} />
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>L2</span>
          </div>
        </div>
      </div>

      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 34, right: 26, left: 10, bottom: 20 }}
            barCategoryGap={28}
            barGap={8}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />

            <XAxis
              dataKey="mes_label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: COR_TEXTO }}
              interval={0}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: COR_TEXTO }}
              tickFormatter={(value) => fmt(Number(value))}
              width={72}
              domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.18)]}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(39,51,109,0.04)" }} />

            <Bar
              dataKey="l1_tubetes"
              name="L1"
              fill={COR_L1}
              radius={[6, 6, 0, 0]}
              barSize={36}
              isAnimationActive={false}
            >
              <LabelList content={BarLabel(COR_L1)} />
            </Bar>

            <Bar
              dataKey="l2_tubetes"
              name="L2"
              fill={COR_L2}
              radius={[6, 6, 0, 0]}
              barSize={36}
              isAnimationActive={false}
            >
              <LabelList content={BarLabel(COR_L2)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--text-secondary)",
          background: "var(--bg-primary)",
        }}
      >
        Produção em tubetes. L1 considera MÁQ 1 ENVASADORA + MÁQ 2 ENVASADORA. L2 considera L2 ENVASADORA.
      </div>
    </div>
  )
}

export function ProducaoPage() {
  const [data, setData] = useState<ProducaoResumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    getProducaoResumoMensal()
      .then((response: unknown) => {
        if (!mounted) return
        setData(response as ProducaoResumo)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar produção")
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const chartData = useMemo(() => data?.meses || [], [data])

  return (
    <div className="p-6 space-y-8 min-h-screen">
      <div className="fade-in">
        <p className="text-[10px] font-medium uppercase tracking-widest mb-1" style={{ color: "var(--text-secondary)" }}>
          Análise · Causa Raiz
        </p>
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
          Produção 2026
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Primeiro bloco: produção real mensal das envasadoras por linha.
        </p>
      </div>

      {loading ? (
        <div className="card p-10 flex flex-col items-center justify-center gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <Factory size={32} style={{ opacity: 0.3 }} />
          <p>Carregando produção...</p>
        </div>
      ) : error || !data ? (
        <div className="card p-10 flex flex-col items-center justify-center gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <Factory size={32} style={{ opacity: 0.3 }} />
          <p>{error || "Produção disponível após carga da base de produção."}</p>
        </div>
      ) : (
        <>
          <section>
            <p className="card-label mb-3 fade-in fade-in-1">Resumo geral das envasadoras</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <KpiMiniCard
                label="Produção total"
                value={`${fmt(data.total_producao_tubetes)} tb`}
                sub={`${fmt(data.total_producao_caixas)} cx`}
                icon={<Factory size={18} />}
                delay={80}
              />
              <KpiMiniCard
                label="Horas produtivas"
                value={`${fmtHoras(data.horas_produtivas)} h`}
                sub={`Apontadas: ${fmtHoras(data.horas_apontadas)} h`}
                icon={<Timer size={18} />}
                delay={140}
              />
              <KpiMiniCard
                label="Aproveitamento operacional"
                value={`${fmt1(data.aproveitamento_operacional)}%`}
                sub="Horas de produção / horas apontadas"
                icon={<Gauge size={18} />}
                delay={200}
              />
              <KpiMiniCard
                label="Produtividade geral"
                value={`${fmt(data.produtividade_tubetes_hora)} tb/h`}
                sub="Tubetes por hora produtiva"
                icon={<Activity size={18} />}
                delay={260}
              />
            </div>
          </section>

          <LinhaCards
            titulo="Linha 1 · MÁQ 1 + MÁQ 2 ENVASADORA"
            linha={data.l1}
            cor={COR_L1}
            delayBase={120}
          />

          <LinhaCards
            titulo="Linha 2 · L2 ENVASADORA"
            linha={data.l2}
            cor={COR_L2}
            delayBase={180}
          />

          <section>
            <ProducaoMensalChart data={chartData} />
          </section>
        </>
      )}
    </div>
  )
}