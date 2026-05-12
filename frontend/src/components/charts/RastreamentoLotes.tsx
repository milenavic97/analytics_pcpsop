import { useEffect, useState } from "react"
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  Waves,
  Shirt,
  X,
} from "lucide-react"

const API_URL =
  (import.meta as any).env.VITE_API_URL || "https://dfl-sop-api.fly.dev"

interface LoteRastreamento {
  lote: string
  grupo: string
  qtd_prevista_tb: number
  qtd_prevista_cx: number
  qtd_produzida_tb: number
  qtd_produzida_cx: number
  qtd_liberada_cx: number
  sku_pa: string | null
  data_lib: string | null
  data_inicio: string | null
  data_fim: string | null
  check_lavagem: boolean
  check_envase: boolean
  check_embalagem: boolean
  check_liberado: boolean
  atrasado: boolean
  equipamento_atual: string | null
  ordem_op: string | null
}

interface ResumoLiberacao {
  previsto_ate_hoje: number
  liberado_vinculado_lotes_previstos: number
  liberado_sd3_mtd_total: number
  liberado_sd3_fora_gantt_mes_atual: number
  gap_teorico_previsto_menos_vinculado: number
  pendente_localizado_rastreamento: number
  residuo_nao_localizado: number
}

interface LoteForaGantt {
  lote: string
  produto?: string | null
  descr_prod?: string | null
  grupo?: string | null
  qtd_cx: number
  qtd_prevista_cx?: number
  dt_emissao?: string | null
  data_lib_prevista?: string | null
  data_inicio_prevista?: string | null
  data_fim_prevista?: string | null
  linha_prevista?: string | null
  mes_previsto?: number | null
  ano_previsto?: number | null
  grupo_previsto?: string | null
  motivo?: string | null
}

interface RastreamentoData {
  mes: number
  ano: number
  total_lotes: number
  total_lotes_mtd: number
  total_lotes_futuros?: number
  total_lotes_fora_gantt?: number
  total_cx_previsto: number
  total_cx_liberado: number
  total_cx_gap?: number
  total_cx_sd3_mes?: number
  total_cx_fora_gantt?: number
  mtd_cx_previsto: number
  mtd_cx_liberado: number
  mtd_cx_gap: number
  mtd_gap_por_etapa: {
    embalagem: number
    envase: number
    lavagem: number
    nao_iniciado: number
  }
  mtd_resumo_liberacao?: ResumoLiberacao
  lotes_fora_gantt?: LoteForaGantt[]
  lotes: LoteRastreamento[]
}

function fmt(n?: number | null) {
  if (n === null || n === undefined) return "—"
  return new Intl.NumberFormat("pt-BR").format(Math.round(n))
}

function fmtData(iso?: string | null) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}/${m}`
}

function Check({
  ok,
  label,
  icon: Icon,
}: {
  ok: boolean
  label: string
  icon: React.ElementType
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        style={{
          background: ok ? "#F0FDF4" : "#F9FAFB",
          border: `2px solid ${ok ? "#16A34A" : "#E5E7EB"}`,
        }}
      >
        <Icon size={13} style={{ color: ok ? "#16A34A" : "#D1D5DB" }} />
      </div>

      <span
        className="text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: ok ? "#16A34A" : "#9CA3AF" }}
      >
        {label}
      </span>
    </div>
  )
}

function Connector({ ok }: { ok: boolean }) {
  return (
    <div
      className="mx-1 mt-3.5 h-0.5 flex-1"
      style={{
        background: ok ? "#16A34A" : "#E5E7EB",
        minWidth: 12,
      }}
    />
  )
}

const MES_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
]

export function RastreamentoLotes() {
  const [data, setData] = useState<RastreamentoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtroGrupo, setFiltroGrupo] = useState("")
  const [filtroEtapa, setFiltroEtapa] = useState("")
  const [apenasAtrasados, setApenasAtrasados] = useState(true)
  const [modalAuditoria, setModalAuditoria] = useState(false)

  const carregar = async () => {
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/overview/rastreamento-lotes`, {
        credentials: "include",
      })

      setData(await res.json())
    } catch (_) {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const mesLabel = data ? MES_LABELS[(data.mes ?? 1) - 1] : ""

  const grupos = [
    ...new Set((data?.lotes ?? []).map((l) => l.grupo).filter(Boolean)),
  ].sort()

  const hoje = new Date().toISOString().split("T")[0]

  const lotesFiltrados = (data?.lotes ?? []).filter((l) => {
    if (apenasAtrasados && (!l.data_lib || l.data_lib > hoje)) return false
    if (filtroGrupo && l.grupo !== filtroGrupo) return false
    if (filtroEtapa === "LIBERADO" && !l.check_liberado) return false
    if (filtroEtapa === "EMBALAGEM" && (!l.check_embalagem || l.check_liberado)) return false
    if (filtroEtapa === "ENVASE" && (!l.check_envase || l.check_embalagem)) return false
    if (filtroEtapa === "LAVAGEM" && (!l.check_lavagem || l.check_envase)) return false
    if (filtroEtapa === "NAO_INICIADO" && l.check_lavagem) return false
    if (filtroEtapa === "ATRASADO" && (!l.atrasado || l.check_liberado)) return false

    return true
  })

  const resumo = data?.mtd_resumo_liberacao

  const lotesForaGantt = data?.lotes_fora_gantt ?? []

  const thBase =
    "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-right whitespace-nowrap"

  const thLeft =
    "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-left"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p
            className="mb-0.5 text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-secondary)" }}
          >
            Produção · Rastreamento
          </p>

          <h2
            className="text-xl font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            Lotes de {mesLabel}/{data?.ano ?? ""}
          </h2>
        </div>

        <button
          onClick={carregar}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {data && (
        <div className="card overflow-hidden p-0">
          <button
            type="button"
            onClick={() => setModalAuditoria(true)}
            className="w-full border-b px-5 py-4 text-left transition-colors hover:brightness-[0.99]"
            style={{
              borderColor: "var(--border)",
              background:
                data.mtd_cx_gap > 0
                  ? "rgba(220,38,38,0.04)"
                  : "rgba(22,163,74,0.04)",
            }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={16}
                className="mt-0.5 flex-shrink-0"
                style={{
                  color: data.mtd_cx_gap > 0 ? "#DC2626" : "#16A34A",
                }}
              />

              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {data.mtd_cx_gap > 0
                    ? `Deveriam ter liberado ${fmt(
                        data.mtd_cx_previsto
                      )} cx até hoje — só liberou ${fmt(
                        data.mtd_cx_liberado
                      )} cx`
                    : `Todas as ${fmt(
                        data.mtd_cx_previsto
                      )} cx previstas até hoje foram liberadas!`}
                </p>

                {data.mtd_cx_gap > 0 && (
                  <p
                    className="mt-0.5 text-sm"
                    style={{ color: "#DC2626", fontWeight: 700 }}
                  >
                    Faltam {fmt(data.mtd_cx_gap)} cx — veja onde estão:
                  </p>
                )}

                <p
                  className="mt-1 text-[11px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Clique para ver conciliação com SD3
                </p>
              </div>
            </div>
          </button>

          <div
            className="grid grid-cols-2 gap-px sm:grid-cols-4"
            style={{ background: "var(--border)" }}
          >
            {[
              {
                label: "Em Embalagem",
                value: data.mtd_gap_por_etapa.embalagem,
                color: "#EA580C",
                icon: Package,
                filtro: "EMBALAGEM",
              },
              {
                label: "Em Envase",
                value: data.mtd_gap_por_etapa.envase,
                color: "#2563EB",
                icon: Waves,
                filtro: "ENVASE",
              },
              {
                label: "Em Lavagem",
                value: data.mtd_gap_por_etapa.lavagem,
                color: "#CA8A04",
                icon: Shirt,
                filtro: "LAVAGEM",
              },
              {
                label: "Não Iniciado",
                value: data.mtd_gap_por_etapa.nao_iniciado,
                color: "#6B7280",
                icon: Clock,
                filtro: "NAO_INICIADO",
              },
            ].map((k) => (
              <button
                key={k.label}
                onClick={() => {
                  setFiltroEtapa(filtroEtapa === k.filtro ? "" : k.filtro)
                  setApenasAtrasados(true)
                }}
                className="px-4 py-3 text-left transition-all"
                style={{
                  background:
                    filtroEtapa === k.filtro
                      ? "var(--bg-primary)"
                      : "var(--bg-secondary)",
                  opacity: k.value === 0 ? 0.35 : 1,
                  cursor: k.value === 0 ? "default" : "pointer",
                }}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <k.icon size={12} style={{ color: k.color }} />

                  <p
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {k.label}
                  </p>
                </div>

                <p
                  className="text-xl font-bold"
                  style={{
                    color:
                      k.value > 0 ? k.color : "var(--text-secondary)",
                  }}
                >
                  {fmt(k.value)} cx
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Grupo
          </label>

          <select
            value={filtroGrupo}
            onChange={(e) => setFiltroGrupo(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 160,
            }}
          >
            <option value="">Todos os grupos</option>
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Etapa
          </label>

          <select
            value={filtroEtapa}
            onChange={(e) => setFiltroEtapa(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 160,
            }}
          >
            <option value="">Todas as etapas</option>
            <option value="LIBERADO">Liberado</option>
            <option value="EMBALAGEM">Em Embalagem</option>
            <option value="ENVASE">Em Envase</option>
            <option value="LAVAGEM">Em Lavagem</option>
            <option value="NAO_INICIADO">Não Iniciado</option>
            <option value="ATRASADO">Atrasados</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Período
          </label>

          <button
            onClick={() => setApenasAtrasados(!apenasAtrasados)}
            className="rounded-lg border px-3 py-2 text-sm font-semibold transition-colors"
            style={{
              background: apenasAtrasados
                ? "var(--bg-sidebar)"
                : "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: apenasAtrasados ? "#fff" : "var(--text-secondary)",
            }}
          >
            {apenasAtrasados ? "Previsto até hoje" : "Mês completo"}
          </button>
        </div>

        <p
          className="pb-2 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {lotesFiltrados.length} lote
          {lotesFiltrados.length !== 1 ? "s" : ""}
        </p>
      </div>

      {loading ? (
        <div
          className="card p-10 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          <RefreshCw
            size={24}
            className="mx-auto mb-3 animate-spin"
            style={{ opacity: 0.4 }}
          />
          Carregando rastreamento...
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
            <table className="w-full min-w-[800px] border-separate border-spacing-0">
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
                  <th className={thLeft}>Lote / OP</th>
                  <th className={thLeft}>Grupo</th>
                  <th className={thBase}>Data Lib.</th>
                  <th className={thBase}>Tubetes</th>
                  <th className={thBase}>Caixas</th>
                  <th
                    className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-wider"
                    style={{ minWidth: 280 }}
                  >
                    Etapas
                  </th>
                  <th className={thBase}>Liberado (cx)</th>
                </tr>
              </thead>

              <tbody>
                {lotesFiltrados.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-12 text-center text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Nenhum lote encontrado.
                    </td>
                  </tr>
                ) : (
                  lotesFiltrados.map((l, i) => (
                    <tr
                      key={l.lote}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background:
                          l.atrasado && !l.check_liberado
                            ? "rgba(220,38,38,0.03)"
                            : i % 2 === 0
                            ? "var(--bg-secondary)"
                            : "var(--bg-primary)",
                      }}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          {l.atrasado && !l.check_liberado && (
                            <AlertTriangle
                              size={12}
                              style={{
                                color: "#DC2626",
                                flexShrink: 0,
                              }}
                            />
                          )}

                          <span
                            className="font-mono text-sm font-semibold"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {l.lote}
                          </span>
                        </div>

                        {l.ordem_op && (
                          <p
                            className="mt-0.5 font-mono text-[11px]"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            OP {l.ordem_op}
                          </p>
                        )}
                      </td>

                      <td
                        className="px-3 py-3 text-sm"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {l.grupo}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm"
                        style={{
                          color:
                            l.atrasado && !l.check_liberado
                              ? "#DC2626"
                              : "var(--text-secondary)",
                          fontWeight:
                            l.atrasado && !l.check_liberado ? 600 : 400,
                        }}
                      >
                        {fmtData(l.data_lib)}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {l.qtd_prevista_tb > 0 ? fmt(l.qtd_prevista_tb) : "—"}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {l.qtd_prevista_cx > 0 ? fmt(l.qtd_prevista_cx) : "—"}
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex items-start justify-center">
                          <Check
                            ok={l.check_lavagem}
                            label="Lavagem"
                            icon={l.check_lavagem ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_envase} />

                          <Check
                            ok={l.check_envase}
                            label="Envase"
                            icon={l.check_envase ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_embalagem} />

                          <Check
                            ok={l.check_embalagem}
                            label="Embalagem"
                            icon={l.check_embalagem ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_liberado} />

                          <Check
                            ok={l.check_liberado}
                            label="Liberado"
                            icon={l.check_liberado ? CheckCircle2 : XCircle}
                          />
                        </div>
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm font-semibold"
                        style={{
                          color: l.check_liberado
                            ? "#16A34A"
                            : "var(--text-secondary)",
                        }}
                      >
                        {l.qtd_liberada_cx > 0
                          ? fmt(l.qtd_liberada_cx)
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAuditoria && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.45)" }}
          onClick={() => setModalAuditoria(false)}
        >
          <div
            className="w-full max-w-5xl overflow-hidden rounded-2xl shadow-xl"
            style={{ background: "var(--bg-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <h3
                  className="text-lg font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Conciliação da liberação MTD
                </h3>

                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Diferença entre rastreamento por lote e SD3 total do mês
                </p>
              </div>

              <button
                onClick={() => setModalAuditoria(false)}
                className="rounded-lg p-2 hover:bg-black/5"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    label: "Previsto até hoje",
                    value:
                      resumo?.previsto_ate_hoje ?? data.mtd_cx_previsto,
                  },
                  {
                    label: "Liberado vinculado aos lotes",
                    value:
                      resumo?.liberado_vinculado_lotes_previstos ??
                      data.mtd_cx_liberado,
                  },
                  {
                    label: "Liberado SD3 MTD total",
                    value:
                      resumo?.liberado_sd3_mtd_total ??
                      data.total_cx_sd3_mes ??
                      data.mtd_cx_liberado,
                  },
                  {
                    label: `Liberado fora do Gantt de ${mesLabel}`,
                    value:
                      resumo?.liberado_sd3_fora_gantt_mes_atual ??
                      data.total_cx_fora_gantt ??
                      0,
                  },
                  {
                    label: "Gap teórico",
                    value:
                      resumo?.gap_teorico_previsto_menos_vinculado ?? 0,
                  },
                  {
                    label: "Pendente localizado",
                    value:
                      resumo?.pendente_localizado_rastreamento ??
                      data.mtd_cx_gap,
                  },
                  {
                    label: "Resíduo não localizado",
                    value: resumo?.residuo_nao_localizado ?? 0,
                  },
                  {
                    label: "Lotes fora do Gantt",
                    value:
                      data.total_lotes_fora_gantt ??
                      lotesForaGantt.length,
                    suffix: "",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {item.label}
                    </p>

                    <p
                      className="mt-1 text-xl font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {fmt(item.value)}
                      {item.suffix === "" ? "" : " cx"}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className="overflow-hidden rounded-xl border"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="border-b px-4 py-3"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <p
                    className="text-sm font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Lotes liberados na SD3 em {mesLabel}, mas fora do Gantt de{" "}
                    {mesLabel}
                  </p>
                </div>

                <div className="overflow-auto" style={{ maxHeight: 320 }}>
                  <table className="w-full min-w-[900px] text-sm">
                    <thead style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Lote
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Produto
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Grupo SD3
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Qtd. SD3 cx
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Previsto cx
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Dt Lib. Prev.
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Grupo Prev.
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Motivo
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {lotesForaGantt.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-8 text-center"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            Nenhum lote fora do Gantt encontrado.
                          </td>
                        </tr>
                      ) : (
                        lotesForaGantt.map((item) => (
                          <tr
                            key={`${item.lote}-${item.produto}-${item.data_lib_prevista}`}
                            className="border-b"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <td className="px-3 py-2 font-mono font-semibold">
                              {item.lote}
                            </td>

                            <td className="px-3 py-2">
                              {item.descr_prod || item.produto || "—"}
                            </td>

                            <td className="px-3 py-2">{item.grupo || "—"}</td>

                            <td className="px-3 py-2 text-right font-semibold">
                              {fmt(item.qtd_cx)}
                            </td>

                            <td className="px-3 py-2 text-right">
                              {fmt(item.qtd_prevista_cx)}
                            </td>

                            <td className="px-3 py-2 text-right">
                              {fmtData(item.data_lib_prevista)}
                            </td>

                            <td className="px-3 py-2">
                              {item.grupo_previsto || "—"}
                            </td>

                            <td className="px-3 py-2">
                              {item.motivo || "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
