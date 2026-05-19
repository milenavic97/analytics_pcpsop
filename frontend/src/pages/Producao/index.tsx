import { useEffect, useMemo, useState } from "react"
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
  getAnaliseCausaRaizProducao,
  getConfigProducao,
  updateConfigProducao,
} from "@/services/api"

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  Factory,
  Gauge,
  Package,
  Save,
  Settings2,
  Target,
  TrendingDown,
  X,
} from "lucide-react"

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
  observacao?: string | null
}

type ConfigProducaoResponse = {
  ano: number
  configs: LinhaConfig[]
}

type PrincipalCausa = {
  rank?: number
  motivo: string
  evento?: string
  horas: number
  ocorrencias?: number
  pct?: number
  pct_acumulado?: number
}

type ProducaoResumo = {
  horas_planejadas_v1: number
  horas_reais_produtivas: number
  horas_reais_apontadas: number
  aderencia_pct: number
  perda_horas: number
  impacto_tubetes: number
  impacto_caixas: number
  qtd_produzida_tubetes: number
  qtd_produzida_caixas: number
  principal_causa?: PrincipalCausa | null
  pior_linha?: string | null
}

type LinhaResumo = {
  linha: "L1" | "L2"
  horas_planejadas_v1: number
  horas_reais_produtivas: number
  horas_reais_apontadas: number
  aderencia_pct: number
  perda_horas: number
  impacto_tubetes: number
  impacto_caixas: number
  qtd_produzida_tubetes: number
  qtd_produzida_caixas: number
}

type DiaAnalise = {
  data: string
  dia: number
  mes: number
  ano: number
  mes_label: string
  linha: "L1" | "L2"
  horas_planejadas_v1: number
  horas_reais_produtivas: number
  horas_reais_apontadas: number
  aderencia_pct: number
  perda_horas: number
  capacidade_tb_h: number
  impacto_tubetes: number
  impacto_caixas: number
  qtd_produzida_tubetes: number
  qtd_produzida_caixas: number
  comentarios_planejado?: string[]
}

type EquipamentoResumo = {
  linha: "L1" | "L2"
  equipamento: string
  horas_produtivas: number
  horas_apontadas: number
  qtd_produzida: number
  qtd_rejeitada: number
  aproveitamento_pct: number
}

type AnaliseCausaRaizResponse = {
  ano: number
  mes: number
  mes_label: string
  baseline: string
  escopo: string
  resumo: ProducaoResumo
  por_linha: LinhaResumo[]
  dias: DiaAnalise[]
  dias_criticos: DiaAnalise[]
  pareto_causas: PrincipalCausa[]
  equipamentos: EquipamentoResumo[]
  debug?: {
    qtd_dias_planejados: number
    qtd_dias_reais: number
    equipamentos_ignorados?: Record<string, number>
  }
}

type ChartDiaRow = {
  dia_label: string
  data: string
  linha: "L1" | "L2"
  planejado: number
  realizado: number
  perda: number
  aderencia: number
}

const ANO_PADRAO = 2026
const MES_ATUAL = new Date().getMonth() + 1

const MESES = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Fev" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Abr" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Ago" },
  { value: 9, label: "Set" },
  { value: 10, label: "Out" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dez" },
]

const COR_L1 = "#27336D"
const COR_L2 = "#6A7FC0"
const COR_PLANEJADO = "#CBD5E1"
const COR_REAL = "#27336D"
const COR_PERDA = "#DC2626"
const COR_GRID = "#E5E7EB"
const COR_TEXTO = "#6B7280"

function fmtNumber(n: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n || 0))
}

function fmtHoras(n: number | null | undefined) {
  return fmtNumber(n, 1)
}

function fmtPct(n: number | null | undefined) {
  return `${fmtNumber(n, 1)}%`
}

function fmtCaixas(n: number | null | undefined) {
  return fmtNumber(n, 0)
}

function fmtData(value: string) {
  if (!value) return "-"
  const [ano, mes, dia] = value.split("-")
  return `${dia}/${mes}/${ano}`
}

function inputNumberValue(value: number | string) {
  if (value === "") return 0
  const parsed = Number(String(value).replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

function periodoLabel(config: LinhaConfig) {
  if (config.periodo_tipo === "semestre") return `${config.periodo_numero}º semestre`
  if (config.periodo_tipo === "trimestre") return `${config.periodo_numero}º trimestre`
  return `${config.periodo_numero}º mês`
}

const LabelHoras = (color: string) => (props: any) => {
  const { x, y, width, value } = props
  if (!value || Number(value) <= 0) return null

  return (
    <text
      x={x + width / 2}
      y={y - 7}
      textAnchor="middle"
      fontSize={10}
      fontWeight={700}
      fill={color}
    >
      {fmtHoras(value)}
    </text>
  )
}

function KpiCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "default",
}: {
  label: string
  value: string
  helper?: string
  icon: any
  tone?: "default" | "danger" | "success"
}) {
  const iconColor =
    tone === "danger" ? "#DC2626" : tone === "success" ? "#059669" : COR_L1

  return (
    <div className="card p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="card-label">{label}</p>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "rgba(39,51,109,0.08)", color: iconColor }}
        >
          <Icon size={18} />
        </div>
      </div>
      <div
        className="text-2xl font-bold tracking-tight md:text-3xl"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {helper && (
        <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
          {helper}
        </p>
      )}
    </div>
  )
}

function LinhaCard({ item }: { item: LinhaResumo }) {
  const color = item.linha === "L1" ? COR_L1 : COR_L2

  return (
    <div className="card p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="card-label mb-1">Resumo por linha</p>
          <h3 className="text-lg font-bold" style={{ color }}>
            {item.linha}
          </h3>
        </div>
        <Factory size={20} style={{ color }} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Planejado V1
          </p>
          <p className="font-bold" style={{ color: "var(--text-primary)" }}>
            {fmtHoras(item.horas_planejadas_v1)} h
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Real Cognitive
          </p>
          <p className="font-bold" style={{ color: "var(--text-primary)" }}>
            {fmtHoras(item.horas_reais_produtivas)} h
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Perda
          </p>
          <p className="font-bold" style={{ color: item.perda_horas > 0 ? COR_PERDA : "var(--text-primary)" }}>
            {fmtHoras(item.perda_horas)} h
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Aderência
          </p>
          <p className="font-bold" style={{ color: "var(--text-primary)" }}>
            {fmtPct(item.aderencia_pct)}
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "#E5E7EB" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(Math.max(item.aderencia_pct || 0, 0), 100)}%`,
            background: color,
          }}
        />
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
        Impacto estimado: {fmtCaixas(item.impacto_caixas)} cx
      </p>
    </div>
  )
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
          ? {
              ...item,
              [field]: field === "observacao" ? String(value) : inputNumberValue(value),
            }
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

      const refreshed = (await getConfigProducao(ANO_PADRAO)) as ConfigProducaoResponse
      onSaved(refreshed.configs)
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar configurações")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 md:p-6"
      style={{ background: "rgba(15,23,42,0.45)" }}
    >
      <div
        className="w-full max-w-6xl overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-4 md:px-6"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <p className="card-label mb-1">Setup operacional</p>
            <h2 className="text-lg font-bold md:text-xl" style={{ color: "var(--text-primary)" }}>
              Configurações de capacidade
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2" disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-x-auto p-4 md:p-6">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {[
                  "Linha",
                  "Período",
                  "Nominal tb/h",
                  "OEE %",
                  "Cap. planejada tb/h",
                  "Horas prod./dia",
                  "Observação",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs uppercase tracking-wider"
                    style={{
                      color: "var(--text-secondary)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drafts.map((item) => (
                <tr key={item.id}>
                  <td
                    className="px-3 py-3 font-bold"
                    style={{ color: item.linha === "L1" ? COR_L1 : COR_L2 }}
                  >
                    {item.linha}
                  </td>
                  <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>
                    {periodoLabel(item)}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      value={item.cap_nominal_tb_h}
                      onChange={(e) => updateDraft(item.id, "cap_nominal_tb_h", e.target.value)}
                      className="w-28 rounded-lg border px-2 py-1.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={item.oee_pct}
                      onChange={(e) => updateDraft(item.id, "oee_pct", e.target.value)}
                      className="w-24 rounded-lg border px-2 py-1.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      value={item.cap_planejada_tb_h}
                      onChange={(e) => updateDraft(item.id, "cap_planejada_tb_h", e.target.value)}
                      className="w-32 rounded-lg border px-2 py-1.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={item.horas_produtivas_dia}
                      onChange={(e) => updateDraft(item.id, "horas_produtivas_dia", e.target.value)}
                      className="w-28 rounded-lg border px-2 py-1.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={item.observacao || ""}
                      onChange={(e) => updateDraft(item.id, "observacao", e.target.value)}
                      className="w-64 rounded-lg border px-2 py-1.5 outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {erro && (
            <div className="mt-4 text-sm" style={{ color: "#DC2626" }}>
              {erro}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-3 px-4 py-4 md:px-6"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-semibold">
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: "#2563EB", color: "#FFFFFF" }}
          >
            <Save size={15} />
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  )
}

function AderenciaDiaChart({ data }: { data: ChartDiaRow[] }) {
  return (
    <div className="card p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="card-label mb-1">Baseline V1 x Cognitive</p>
          <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
            Aderência diária de horas produtivas
          </h2>
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Real da L1 consolidado por janela, sem duplicar Maq 1 e Maq 2
        </p>
      </div>

      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 36, right: 20, left: 0, bottom: 22 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} vertical={false} />
            <XAxis
              dataKey="dia_label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: COR_TEXTO }}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: COR_TEXTO }}
              tickFormatter={(v) => fmtHoras(Number(v))}
              width={54}
            />
            <Tooltip
              formatter={(value: any, name: any) => [
                `${fmtHoras(Number(value))} h`,
                name === "planejado" ? "Planejado V1" : name === "realizado" ? "Real Cognitive" : "Perda",
              ]}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ChartDiaRow | undefined
                if (!row) return ""
                return `${fmtData(row.data)} · ${row.linha}`
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
            <Bar dataKey="planejado" name="Planejado V1" fill={COR_PLANEJADO} radius={[7, 7, 0, 0]}>
              <LabelList content={LabelHoras("#64748B")} />
            </Bar>
            <Bar dataKey="realizado" name="Real Cognitive" fill={COR_REAL} radius={[7, 7, 0, 0]}>
              <LabelList content={LabelHoras(COR_REAL)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ParetoCausasChart({ data }: { data: PrincipalCausa[] }) {
  const rows = data.slice(0, 8)

  return (
    <div className="card p-4 md:p-6">
      <div className="mb-4">
        <p className="card-label mb-1">Causa raiz</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
          Principais motivos de perda
        </h2>
      </div>

      <div className="h-[330px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 22, left: 18, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COR_GRID} horizontal={false} />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: COR_TEXTO }}
              tickFormatter={(v) => fmtHoras(Number(v))}
            />
            <YAxis
              type="category"
              dataKey="motivo"
              axisLine={false}
              tickLine={false}
              width={136}
              tick={{ fontSize: 10, fill: COR_TEXTO }}
            />
            <Tooltip
              formatter={(value: any) => [`${fmtHoras(Number(value))} h`, "Horas"]}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="horas" name="Horas" fill={COR_L1} radius={[0, 7, 7, 0]}>
              <LabelList
                dataKey="horas"
                position="right"
                formatter={(v: any) => fmtHoras(Number(v))}
                style={{ fontSize: 10, fontWeight: 700, fill: COR_TEXTO }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LinhaResumoTable({ data }: { data: LinhaResumo[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-4 md:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-1">Linhas de envase</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
          Resumo executivo por linha
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr>
              {["Linha", "Planejado V1", "Real Cognitive", "Perda", "Aderência", "Impacto estimado"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wider"
                  style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.linha}>
                <td className="px-4 py-3 font-bold" style={{ color: item.linha === "L1" ? COR_L1 : COR_L2 }}>
                  {item.linha}
                </td>
                <td className="px-4 py-3">{fmtHoras(item.horas_planejadas_v1)} h</td>
                <td className="px-4 py-3">{fmtHoras(item.horas_reais_produtivas)} h</td>
                <td className="px-4 py-3 font-semibold" style={{ color: item.perda_horas > 0 ? COR_PERDA : "var(--text-primary)" }}>
                  {fmtHoras(item.perda_horas)} h
                </td>
                <td className="px-4 py-3">{fmtPct(item.aderencia_pct)}</td>
                <td className="px-4 py-3">{fmtCaixas(item.impacto_caixas)} cx</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DiasCriticosTable({ data }: { data: DiaAnalise[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-4 md:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-1">Desvios relevantes</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
          Dias críticos
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr>
              {["Data", "Linha", "Planejado", "Real", "Perda", "Aderência", "Impacto"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wider"
                  style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 10).map((item) => (
              <tr key={`${item.data}-${item.linha}`}>
                <td className="px-4 py-3">{fmtData(item.data)}</td>
                <td className="px-4 py-3 font-bold" style={{ color: item.linha === "L1" ? COR_L1 : COR_L2 }}>
                  {item.linha}
                </td>
                <td className="px-4 py-3">{fmtHoras(item.horas_planejadas_v1)} h</td>
                <td className="px-4 py-3">{fmtHoras(item.horas_reais_produtivas)} h</td>
                <td className="px-4 py-3 font-semibold" style={{ color: item.perda_horas > 0 ? COR_PERDA : "var(--text-primary)" }}>
                  {fmtHoras(item.perda_horas)} h
                </td>
                <td className="px-4 py-3">{fmtPct(item.aderencia_pct)}</td>
                <td className="px-4 py-3">{fmtCaixas(item.impacto_caixas)} cx</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EquipamentosTable({ data }: { data: EquipamentoResumo[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-4 md:px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-1">Detalhe operacional</p>
        <h2 className="text-base font-bold md:text-lg" style={{ color: "var(--text-primary)" }}>
          Aproveitamento por equipamento
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              {["Linha", "Equipamento", "Horas produtivas", "Horas apontadas", "Aproveitamento", "Produção"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wider"
                  style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={`${item.linha}-${item.equipamento}`}>
                <td className="px-4 py-3 font-bold" style={{ color: item.linha === "L1" ? COR_L1 : COR_L2 }}>
                  {item.linha}
                </td>
                <td className="px-4 py-3">{item.equipamento}</td>
                <td className="px-4 py-3">{fmtHoras(item.horas_produtivas)} h</td>
                <td className="px-4 py-3">{fmtHoras(item.horas_apontadas)} h</td>
                <td className="px-4 py-3">{fmtPct(item.aproveitamento_pct)}</td>
                <td className="px-4 py-3">{fmtNumber(item.qtd_produzida, 0)} tb</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ProducaoPage() {
  const [ano] = useState(ANO_PADRAO)
  const [mes, setMes] = useState(MES_ATUAL)
  const [linhaFiltro, setLinhaFiltro] = useState<"TODAS" | "L1" | "L2">("TODAS")
  const [analise, setAnalise] = useState<AnaliseCausaRaizResponse | null>(null)
  const [configProducao, setConfigProducao] = useState<ConfigProducaoResponse | null>(null)
  const [modalConfigOpen, setModalConfigOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true

    setLoading(true)
    setError("")

    Promise.all([
      getAnaliseCausaRaizProducao(ano, mes),
      getConfigProducao(ano),
    ])
      .then(([analiseRes, configRes]) => {
        if (!mounted) return

        setAnalise(analiseRes as AnaliseCausaRaizResponse)
        setConfigProducao(configRes as ConfigProducaoResponse)
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
  }, [ano, mes])

  const diasFiltrados = useMemo(() => {
    const rows = analise?.dias || []
    if (linhaFiltro === "TODAS") return rows
    return rows.filter((d) => d.linha === linhaFiltro)
  }, [analise, linhaFiltro])

  const chartData = useMemo<ChartDiaRow[]>(() => {
    return diasFiltrados
      .filter((d) => d.horas_planejadas_v1 > 0 || d.horas_reais_produtivas > 0)
      .sort((a, b) => `${a.data}-${a.linha}`.localeCompare(`${b.data}-${b.linha}`))
      .map((d) => ({
        dia_label: linhaFiltro === "TODAS" ? `${String(d.dia).padStart(2, "0")} ${d.linha}` : String(d.dia).padStart(2, "0"),
        data: d.data,
        linha: d.linha,
        planejado: d.horas_planejadas_v1,
        realizado: d.horas_reais_produtivas,
        perda: d.perda_horas,
        aderencia: d.aderencia_pct,
      }))
  }, [diasFiltrados, linhaFiltro])

  const porLinha = useMemo(() => {
    const rows = analise?.por_linha || []
    if (linhaFiltro === "TODAS") return rows
    return rows.filter((r) => r.linha === linhaFiltro)
  }, [analise, linhaFiltro])

  const equipamentos = useMemo(() => {
    const rows = analise?.equipamentos || []
    if (linhaFiltro === "TODAS") return rows
    return rows.filter((r) => r.linha === linhaFiltro)
  }, [analise, linhaFiltro])

  const diasCriticos = useMemo(() => {
    const rows = analise?.dias_criticos || []
    if (linhaFiltro === "TODAS") return rows
    return rows.filter((r) => r.linha === linhaFiltro)
  }, [analise, linhaFiltro])

  return (
    <div className="min-h-screen space-y-6 p-3 md:space-y-8 md:p-6">
      <div className="fade-in flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            Análise · Produção
          </p>
          <h1 className="mb-1 text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>
            Causa raiz das perdas
          </h1>
          <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            Comparação entre baseline V1 do MPS e apontamentos reais do Cognitive no envase.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="h-11 rounded-xl border px-3 text-sm font-semibold outline-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
          >
            {MESES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}/{ano}
              </option>
            ))}
          </select>

          <select
            value={linhaFiltro}
            onChange={(e) => setLinhaFiltro(e.target.value as "TODAS" | "L1" | "L2")}
            className="h-11 rounded-xl border px-3 text-sm font-semibold outline-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
          >
            <option value="TODAS">Todas as linhas</option>
            <option value="L1">Linha 1</option>
            <option value="L2">Linha 2</option>
          </select>

          <button
            onClick={() => setModalConfigOpen(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold"
          >
            <Settings2 size={15} />
            Configurações
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-6 text-sm md:p-10">Carregando produção...</div>
      ) : error ? (
        <div className="card p-6 text-sm md:p-10" style={{ color: "#DC2626" }}>
          {error}
        </div>
      ) : !analise ? (
        <div className="card p-6 text-sm md:p-10">Nenhuma análise encontrada.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Aderência ao plano"
              value={fmtPct(analise.resumo.aderencia_pct)}
              helper={`${fmtHoras(analise.resumo.horas_reais_produtivas)} h reais de ${fmtHoras(analise.resumo.horas_planejadas_v1)} h V1`}
              icon={Target}
              tone={analise.resumo.aderencia_pct >= 95 ? "success" : "default"}
            />
            <KpiCard
              label="Perda produtiva"
              value={`${fmtHoras(analise.resumo.perda_horas)} h`}
              helper="Diferença entre horas disponíveis V1 e produção real Cognitive"
              icon={TrendingDown}
              tone="danger"
            />
            <KpiCard
              label="Impacto estimado"
              value={`${fmtCaixas(analise.resumo.impacto_caixas)} cx`}
              helper={`${fmtNumber(analise.resumo.impacto_tubetes, 0)} tubetes de capacidade potencial`}
              icon={Package}
            />
            <KpiCard
              label="Principal causa"
              value={analise.resumo.principal_causa?.motivo || "Sem perda"}
              helper={
                analise.resumo.principal_causa
                  ? `${fmtHoras(analise.resumo.principal_causa.horas)} h apontadas`
                  : "Nenhuma causa relevante no período"
              }
              icon={AlertTriangle}
              tone={analise.resumo.principal_causa ? "danger" : "success"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {porLinha.map((item) => (
              <LinhaCard key={item.linha} item={item} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
            <AderenciaDiaChart data={chartData} />
            <ParetoCausasChart data={analise.pareto_causas || []} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <LinhaResumoTable data={porLinha} />
            <DiasCriticosTable data={diasCriticos} />
          </div>

          <EquipamentosTable data={equipamentos} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              label="Horas apontadas"
              value={`${fmtHoras(analise.resumo.horas_reais_apontadas)} h`}
              helper="Janela real do Cognitive consolidada por linha"
              icon={Clock3}
            />
            <KpiCard
              label="Produção realizada"
              value={`${fmtCaixas(analise.resumo.qtd_produzida_caixas)} cx`}
              helper={`${fmtNumber(analise.resumo.qtd_produzida_tubetes, 0)} tubetes no envase`}
              icon={Activity}
            />
            <KpiCard
              label="Pior linha"
              value={analise.resumo.pior_linha || "-"}
              helper="Linha com maior perda de horas no período"
              icon={Gauge}
            />
          </div>

          <div className="card p-4 text-xs leading-5 md:p-5" style={{ color: "var(--text-secondary)" }}>
            <div className="mb-2 flex items-center gap-2 font-semibold" style={{ color: "var(--text-primary)" }}>
              <BarChart3 size={15} />
              Regra de cálculo
            </div>
            A análise considera apenas envase. Para L1, os apontamentos da Maq 1 e Maq 2 são consolidados por janela de tempo,
            evitando duplicidade de horas quando os equipamentos trabalham em paralelo. O baseline é sempre a V1 da competência.
          </div>
        </>
      )}

      <ConfigProducaoModal
        open={modalConfigOpen}
        configs={configProducao?.configs || []}
        onClose={() => setModalConfigOpen(false)}
        onSaved={(configs) =>
          setConfigProducao((prev) => ({
            ano: prev?.ano || ano,
            configs,
          }))
        }
      />
    </div>
  )
}
