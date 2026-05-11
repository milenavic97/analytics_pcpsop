import { useEffect, useState } from "react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  Legend,
} from "recharts"

import {
  getMpsResumoMensal,
  getMpsComparativoRealPlanejado,
  getConfigProducao,
  updateConfigProducao,
  getParadasPareto,
} from "@/services/api"

import {
  ParadasParetoChart,
  type ParadaParetoItem,
} from "@/components/charts/ParadasParetoChart"

import { Settings2, X, Save } from "lucide-react"

type MpsMes = {
  mes: number
  mes_label: string
  versao?: string
  l1_horas: number
  l2_horas: number
  total_horas: number
}

type LinhaConfig = {
  id: string
  ano: number
  linha: "L1" | "L2"
  periodo_tipo: "mes" | "trimestre" | "semestre"
  periodo_numero: number
  cap_nominal_tb_h: number
  oee_pct: number
  cap_planejada_tb_h: number
  horas_produtivas_dia: number
  observacao?: string
}

type ConfigProducaoResponse = {
  ano: number
  configs: LinhaConfig[]
}

type ParadasParetoResponse = {
  ano: number
  total_horas: number
  total_motivos: number
  items: ParadaParetoItem[]
}

type ComparativoRealPlanejado = {
  mes: number
  mes_label: string
  versao_planejada?: string
  l1_planejado: number
  l1_real: number
  l2_planejado: number
  l2_real: number
}

type ComparativoChartRow = {
  mes: number
  mes_label: string
  linha: "L1" | "L2" | "GAP"
  grupo: string
  planejado: number | null
  realizado: number | null
}

const COR_L1 = "#27336D"
const COR_L2 = "#6A7FC0"
const COR_PLANEJADO = "#CBD5E1"
const COR_REAL = "#27336D"
const COR_GRID = "#E5E7EB"
const COR_TEXTO = "#6B7280"

const BAR_SIZE = 46
const BAR_REALIZADO = 38

function fmtHoras(n: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(n || 0))
}

function periodoLabel(config: LinhaConfig) {
  if (config.periodo_tipo === "semestre") return `${config.periodo_numero}º semestre`
  if (config.periodo_tipo === "trimestre") return `${config.periodo_numero}º trimestre`
  return `${config.periodo_numero}º mês`
}

function inputNumberValue(value: number | string) {
  if (value === "") return 0
  const parsed = Number(String(value).replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

const LabelHoras = (color: string) => (props: any) => {
  const { x, y, width, value } = props
  if (!value || Number(value) <= 0) return null
  return (
    <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={10} fontWeight={700} fill={color}>
      {fmtHoras(value)}
    </text>
  )
}

function makeCustomLinhaMesTick(tickWidth: number) {
  return function CustomLinhaMesTick(props: any) {
    const { x, y, payload } = props
    const value = String(payload?.value || "")

    if (value.startsWith("sep-")) return <g />

    const [mesLabel, linha] = value.split("-")

    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={10} textAnchor="middle" fontSize={11} fontWeight={800}
          fill={linha === "L1" ? COR_L1 : COR_L2}>
          {linha}
        </text>
        {linha === "L1" && (
          <text x={tickWidth} y={31} textAnchor="middle" fontSize={12} fontWeight={600} fill={COR_TEXTO}>
            {mesLabel}
          </text>
        )}
      </g>
    )
  }
}

function ConfigProducaoModal({
  open,
  configs,
  onClose,
  onSaved,
}: {
  open: boolean
  configs: LinhaConfig[]
  onClose: () => void
  onSaved: (configs: LinhaConfig[]) => void
}) {
  const [drafts, setDrafts] = useState<LinhaConfig[]>([])
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState("")

  useEffect(() => {
    if (open) {
      setDrafts(configs.map((c) => ({ ...c })))
      setErro("")
    }
  }, [open, configs])

  if (!open) return null

  function updateDraft(id: string, field: keyof LinhaConfig, value: string | number) {
    setDrafts((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, [field]: field === "observacao" ? String(value) : inputNumberValue(value) }
          : item
      )
    )
  }

  async function handleSalvar() {
    setSaving(true)
    setErro("")
    try {
      for (const item of drafts) {
        await updateConfigProducao(item.id, {
          cap_nominal_tb_h: Number(item.cap_nominal_tb_h),
          oee_pct: Number(item.oee_pct),
          cap_planejada_tb_h: Number(item.cap_planejada_tb_h),
          horas_produtivas_dia: Number(item.horas_produtivas_dia),
          observacao: item.observacao || null,
        })
      }
      const refreshed = (await getConfigProducao()) as ConfigProducaoResponse
      onSaved(refreshed.configs)
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar configurações")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 md:p-6" style={{ background: "rgba(15,23,42,0.45)" }}>
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl shadow-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-4 py-4 md:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="card-label mb-1">Setup operacional</p>
            <h2 className="text-lg font-bold md:text-xl" style={{ color: "var(--text-primary)" }}>Configurações de capacidade</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2" disabled={saving}><X size={18} /></button>
        </div>
        <div className="overflow-x-auto p-4 md:p-6">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {["Linha", "Período", "Nominal tb/h", "OEE %", "Cap. planejada tb/h", "Horas prod./dia", "Observação"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs uppercase tracking-wider" style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drafts.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3 font-bold" style={{ color: item.linha === "L1" ? COR_L1 : COR_L2 }}>{item.linha}</td>
                  <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>{periodoLabel(item)}</td>
                  <td className="px-3 py-3"><input type="number" value={item.cap_nominal_tb_h} onChange={(e) => updateDraft(item.id, "cap_nominal_tb_h", e.target.value)} className="w-28 rounded-lg border px-2 py-1.5 outline-none" /></td>
                  <td className="px-3 py-3"><input type="number" step="0.01" value={item.oee_pct} onChange={(e) => updateDraft(item.id, "oee_pct", e.target.value)} className="w-24 rounded-lg border px-2 py-1.5 outline-none" /></td>
                  <td className="px-3 py-3"><input type="number" value={item.cap_planejada_tb_h} onChange={(e) => updateDraft(item.id, "cap_planejada_tb_h", e.target.value)} className="w-32 rounded-lg border px-2 py-1.5 outline-none" /></td>
                  <td className="px-3 py-3"><input type="number" step="0.01" value={item.horas_produtivas_dia} onChange={(e) => updateDraft(item.id, "horas_produtivas_dia", e.target.value)} className="w-28 rounded-lg border px-2 py-1.5 outline-none" /></td>
                  <td className="px-3 py-3"><input type="text" value={item.observacao || ""} onChange={(e) => updateDraft(item.id, "observacao", e.target.value)} className="w-64 rounded-lg border px-2 py-1.5 outline-none" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {erro && <div className="mt-4 text-sm" style={{ color: "#DC2626" }}>{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-3 px-4 py-4 md:px-6" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancelar</button>
          <button onClick={handleSalvar} disabled={saving} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "#2563EB", color: "#FFFFFF" }}>
            <Save size={15} />{saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  )
}

function MpsChart({ data }: { data: MpsMes[] }) {
  return (
    <div className="card p-4 md:p-6">
      <div className="mb-4">
        <p className="card-label mb-1">Planejamento de produção</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>Horas planejadas por mês</h2>
      </div>
      <div className="h-[300px] md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 34, right: 26, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
            <XAxis dataKey="mes_label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: COR_TEXTO }} interval={0} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: COR_TEXTO }} tickFormatter={(v) => fmtHoras(Number(v))} width={60} />
            <Tooltip />
            <Legend />
            <Bar dataKey="l1_horas" fill={COR_L1} radius={[7, 7, 0, 0]}><LabelList content={LabelHoras(COR_L1)} /></Bar>
            <Bar dataKey="l2_horas" fill={COR_L2} radius={[7, 7, 0, 0]}><LabelList content={LabelHoras(COR_L2)} /></Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ComparativoRealPlanejadoChart({ data }: { data: ComparativoRealPlanejado[] }) {
  const [visible, setVisible] = useState({ planejado: true, realizado: true })
  const [chartWidth, setChartWidth] = useState(1400)

  const NUM_TICKS = 12 * 3
  const tickWidth = chartWidth / NUM_TICKS

  const chartData: ComparativoChartRow[] = data.flatMap((m, i) => {
    const rows: ComparativoChartRow[] = [
      { mes: m.mes, mes_label: m.mes_label, linha: "L1", grupo: `${m.mes_label}-L1`, planejado: Number(m.l1_planejado || 0), realizado: Number(m.l1_real || 0) },
      { mes: m.mes, mes_label: m.mes_label, linha: "L2", grupo: `${m.mes_label}-L2`, planejado: Number(m.l2_planejado || 0), realizado: Number(m.l2_real || 0) },
    ]
    if (i < data.length - 1) {
      rows.push({ mes: m.mes, mes_label: "", linha: "GAP", grupo: `sep-${m.mes}`, planejado: null, realizado: null })
    }
    return rows
  })

  function toggleSerie(key: "planejado" | "realizado") {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const CustomTick = makeCustomLinhaMesTick(tickWidth)

  const PlannedLabel = (props: any) => {
    const { x, y, width, value } = props
    if (!value || Number(value) <= 0 || !visible.planejado) return null
    return (
      <text x={x + width / 2} y={y - 8} textAnchor="middle" fontSize={10} fontWeight={700} fill="#64748B">
        {fmtHoras(value)}
      </text>
    )
  }

  const PlanejadoShape = (props: any) => {
    const { x, y, width, height, fill, value } = props
    if (value === null || value === undefined || Number(value) <= 0) return null
    const r = 8
    return (
      <path d={`M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`} fill={fill} />
    )
  }

  const RealizadoShape = (props: any) => {
    const { background, y, height, fill, value } = props
    if (value === null || value === undefined || Number(value) <= 0) return null
    const cellX = background?.x ?? 0
    const cellW = background?.width ?? BAR_SIZE
    const xC = cellX + (cellW - BAR_REALIZADO) / 2
    const r = 7
    return (
      <path
        d={`M ${xC} ${y + height} L ${xC} ${y + r} Q ${xC} ${y} ${xC + r} ${y} L ${xC + BAR_REALIZADO - r} ${y} Q ${xC + BAR_REALIZADO} ${y} ${xC + BAR_REALIZADO} ${y + r} L ${xC + BAR_REALIZADO} ${y + height} Z`}
        fill={fill}
      />
    )
  }

  const RealizedLabel = (props: any) => {
    const { x, y, width, height, value } = props
    if (value === null || value === undefined || Number(value) <= 0 || !visible.realizado) return null
    const xC = x + (width - BAR_REALIZADO) / 2 + BAR_REALIZADO / 2
    return (
      <text x={xC} y={y + height * 0.4} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={800} fill="#FFFFFF">
        {fmtHoras(value)}
      </text>
    )
  }

  return (
    <div className="card p-4 md:p-6">
      <div className="mb-4">
        <p className="card-label mb-1">Planejado produtivo vs realizado</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>Aderência mensal de horas</h2>
      </div>

      <div className="h-[390px] md:h-[430px]">
        <ResponsiveContainer width="100%" height="100%" onResize={(w) => setChartWidth(w)}>
          <BarChart
            data={chartData}
            margin={{ top: 44, right: 26, left: 10, bottom: 58 }}
            barCategoryGap="10%"
            barGap={-BAR_SIZE}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
            <XAxis dataKey="grupo" axisLine={false} tickLine={false} interval={0} height={62} tick={<CustomTick />} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: COR_TEXTO }} tickFormatter={(v) => fmtHoras(Number(v))} width={60} />
            <Tooltip
              formatter={(value: any, name: any) => {
                if (value === null || value === undefined) return null as any
                return [`${fmtHoras(Number(value))} h`, name === "planejado" ? "Planejado" : "Realizado"]
              }}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ComparativoChartRow | undefined
                if (!row || row.linha === "GAP") return ""
                return `${row.mes_label}/26 · ${row.linha}`
              }}
            />
            <Bar dataKey="planejado" name="Planejado" fill={COR_PLANEJADO} barSize={BAR_SIZE} isAnimationActive={false} hide={!visible.planejado} shape={<PlanejadoShape />}>
              <LabelList content={PlannedLabel} />
            </Bar>
            <Bar dataKey="realizado" name="Realizado" fill={COR_REAL} barSize={BAR_SIZE} isAnimationActive={false} hide={!visible.realizado} shape={<RealizadoShape />}>
              <LabelList content={RealizedLabel} />
            </Bar>
            <Legend
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{ paddingTop: 22, cursor: "pointer", fontSize: 13 }}
              onClick={(e: any) => {
                if (e?.dataKey === "planejado") toggleSerie("planejado")
                if (e?.dataKey === "realizado") toggleSerie("realizado")
              }}
              formatter={(value: string) => {
                const ativo = value === "Planejado" ? visible.planejado : visible.realizado
                return <span style={{ opacity: ativo ? 1 : 0.35, textDecoration: ativo ? "none" : "line-through", color: "#475569", fontWeight: 600 }}>{value}</span>
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
        Clique na legenda para ocultar ou exibir as séries
      </div>
    </div>
  )
}

export function ProducaoPage() {
  const [mps, setMps] = useState<MpsMes[]>([])
  const [comparativo, setComparativo] = useState<ComparativoRealPlanejado[]>([])
  const [paradasParetoL1, setParadasParetoL1] = useState<ParadaParetoItem[]>([])
  const [paradasParetoL2, setParadasParetoL2] = useState<ParadaParetoItem[]>([])
  const [configProducao, setConfigProducao] = useState<ConfigProducaoResponse | null>(null)
  const [modalConfigOpen, setModalConfigOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true
    Promise.all([
      getMpsResumoMensal(),
      getMpsComparativoRealPlanejado(),
      getConfigProducao(),
      getParadasPareto("L1"),
      getParadasPareto("L2"),
    ])
      .then(([mpsRes, compRes, configRes, paretoL1, paretoL2]) => {
        if (!mounted) return
        setMps(mpsRes as MpsMes[])
        setComparativo(compRes as ComparativoRealPlanejado[])
        setConfigProducao(configRes as ConfigProducaoResponse)
        setParadasParetoL1((paretoL1 as ParadasParetoResponse).items || [])
        setParadasParetoL2((paretoL2 as ParadasParetoResponse).items || [])
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Erro ao carregar produção")
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  return (
    <div className="min-h-screen space-y-6 p-3 md:space-y-8 md:p-6">
      <div className="fade-in flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Análise · Produção</p>
          <h1 className="mb-1 text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>Produção 2026</h1>
          <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>Planejamento MPS, setups de linha e aderência entre horas planejadas e realizadas.</p>
        </div>
        <button onClick={() => setModalConfigOpen(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold md:w-auto">
          <Settings2 size={15} />Configurações
        </button>
      </div>

      {loading ? (
        <div className="card p-6 text-sm md:p-10">Carregando produção...</div>
      ) : error ? (
        <div className="card p-6 text-sm md:p-10">{error}</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl"><div className="min-w-[760px]"><MpsChart data={mps} /></div></div>
          <div className="overflow-x-auto rounded-2xl"><div className="min-w-[1400px]"><ComparativoRealPlanejadoChart data={comparativo} /></div></div>
          <div className="overflow-x-auto rounded-2xl"><div className="min-w-[980px]"><ParadasParetoChart data={[]} dataL1={paradasParetoL1} dataL2={paradasParetoL2} /></div></div>
        </>
      )}

      <ConfigProducaoModal
        open={modalConfigOpen}
        configs={configProducao?.configs || []}
        onClose={() => setModalConfigOpen(false)}
        onSaved={(configs) => setConfigProducao((prev) => ({ ano: prev?.ano || 2026, configs }))}
      />
    </div>
  )
}
