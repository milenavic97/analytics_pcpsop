import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Copy,
  Filter,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from "lucide-react"

import {
  atualizarMrpEtapa,
  copiarMrpRodada,
  criarMrpRodada,
  excluirMrpRodada,
  getMrpAlocacoes,
  getMrpEtapas,
  getMrpMudancasRealizado,
  getMrpRodadas,
  getOrcadoFaturamento,
  importarMrpMps,
  importarMrpProducaoReal,
  type MrpAlocacaoDia,
  type MrpEtapa,
  type MrpRodada,
} from "@/services/api"

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
const RECURSOS = ["L1", "L2", "FABRIMA"]
const AZUL = "#17375E"
const PAGE_SIZE = 50

// ─── Tipos ────────────────────────────────────────────────────────────────────

type UnidadeConsolidado = "caixas" | "tubetes"

type Filtros = {
  busca: string
  lote: string
  codigo: string
  produto: string
  mesProducao: string
  anoProducao: string
  mesLiberacao: string
  anoLiberacao: string
  recurso: string
}

type EdicaoEtapa = {
  descricao_produto?: string | null
  codigo_produto?: string | null
  lote?: string | null
  mes_liberacao?: number | null
  ano_liberacao?: number | null
  observacao?: string | null
  mes_lib_manual?: boolean
}

type Toast = { tipo: "success" | "error"; titulo: string; mensagem: string }

type MudancaRealizado = {
  lote?: string | null
  lote_real_cogtive?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null
  recurso?: string | null
  data_inicio?: string | null
  data_fim_anterior?: string | null
  data_fim_nova?: string | null
  data_lib_nova?: string | null
  mes_liberacao_novo?: number | null
  ano_liberacao_novo?: number | null
  un_hora_anterior?: number | null
  un_hora_nova?: number | null
  duracao_horas_nova?: number | null
  qtd_planejada?: number | null
  motivo_provavel?: string | null
  impacto_dias?: number | null
  tipo_impacto?: "atrasou" | "antecipou" | "sem_mudanca_data" | "sem_comparativo" | string
  delta_un_hora?: number | null
  delta_un_hora_pct?: number | null
}

type Column = {
  key: string
  label: string
  width: number
  align?: "left" | "center" | "right"
  frozen?: boolean
  render: (etapa: MrpEtapa) => string | number | null | undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value?: number | null, decimais = 0) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: decimais })
}

function fmtData(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

function fmtPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-"
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

function fmtSinal(value?: number | null, decimais = 0) {
  const n = Number(value || 0)
  return `${n > 0 ? "+" : ""}${fmt(n, decimais)}`
}

function classeImpacto(tipo?: string | null) {
  if (tipo === "atrasou") return "bg-red-50 text-red-700 border-red-200"
  if (tipo === "antecipou") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (tipo === "sem_mudanca_data") return "bg-slate-50 text-slate-600 border-slate-200"
  return "bg-blue-50 text-blue-700 border-blue-200"
}

function textoImpacto(tipo?: string | null, dias?: number | null) {
  if (tipo === "atrasou") return `Atrasou ${Math.abs(Number(dias || 0))}d`
  if (tipo === "antecipou") return `Antecipou ${Math.abs(Number(dias || 0))}d`
  if (tipo === "sem_mudanca_data") return "Sem mudança"
  return "Sem comparativo"
}

function classeDiferenca(value?: number | null) {
  const n = Number(value || 0)
  if (n > 0) return "text-emerald-700 font-semibold"
  if (n < 0) return "text-red-700 font-semibold"
  return "var(--text-secondary)"
}

function keyData(date?: string | null) {
  return date ? date.slice(0, 10) : ""
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return value
  const texto = String(value).trim()
  if (texto.includes(",")) return Number(texto.replace(/\./g, "").replace(",", "."))
  return Number(texto)
}

function normalizarTexto(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase()
}

function identificarRecursoPorLote(lote?: string | null) {
  const texto = normalizarTexto(String(lote || ""))
  const match = texto.match(/[A-Z](1|2)/)
  if (match?.[1] === "1") return "L1"
  if (match?.[1] === "2") return "L2"
  return ""
}

function identificarRecursoMudanca(m: MudancaRealizado) {
  const r = String(m.recurso || "").trim().toUpperCase()
  if (r === "L1" || r === "L2" || r === "FABRIMA") return r
  return identificarRecursoPorLote(m.lote || "")
}

function uniqueSorted(values: (string | number | null | undefined)[]) {
  return Array.from(new Set(
    values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map((v) => String(v))
  )).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
}

function getLeftOffset(index: number, cols: Column[]) {
  return cols.slice(0, index).reduce((sum, col) => sum + col.width, 0)
}

function gerarDias(inicioMes: number, inicioAno: number, fimMes: number, fimAno: number) {
  const dias: { data: string; dia: number; mes: number; ano: number }[] = []
  const atual = new Date(inicioAno, inicioMes - 1, 1)
  const fim = new Date(fimAno, fimMes, 0)
  while (atual <= fim) {
    const ano = atual.getFullYear()
    const mes = atual.getMonth() + 1
    const dia = atual.getDate()
    dias.push({ data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, dia, mes, ano })
    atual.setDate(atual.getDate() + 1)
  }
  return dias
}

function gerarOpcoesMeses(baseAno: number) {
  const opcoes: { value: string; label: string }[] = []
  for (let ano = baseAno - 1; ano <= baseAno + 2; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      opcoes.push({ value: `${ano}-${mes}`, label: `${MESES[mes - 1]}/${ano}` })
    }
  }
  return opcoes
}

function filtrarEtapas(etapas: MrpEtapa[], filtros: Filtros) {
  return etapas.filter((e) => {
    const busca = filtros.busca.trim().toLowerCase()
    if (busca && ![e.lote, e.codigo_produto, e.descricao_produto, e.recurso].join(" ").toLowerCase().includes(busca)) return false
    if (filtros.recurso && e.recurso !== filtros.recurso) return false
    if (filtros.lote && String(e.lote || "") !== filtros.lote) return false
    if (filtros.codigo && String(e.codigo_produto || "") !== filtros.codigo) return false
    if (filtros.produto && String(e.descricao_produto || "") !== filtros.produto) return false
    if (filtros.mesProducao && String(e.mes_producao || "") !== filtros.mesProducao) return false
    if (filtros.anoProducao && String(e.ano_producao || "") !== filtros.anoProducao) return false
    if (filtros.mesLiberacao && String(e.mes_liberacao || "") !== filtros.mesLiberacao) return false
    if (filtros.anoLiberacao && String(e.ano_liberacao || "") !== filtros.anoLiberacao) return false
    return true
  })
}

function gerarLoteSugerido(etapa: MrpEtapa, novoProduto: string, etapas: MrpEtapa[]) {
  if (etapa.lote) return etapa.lote
  const dataBase = etapa.data_inicio || etapa.data_fim || etapa.data_pa
  const dt = dataBase ? new Date(`${dataBase}T00:00:00`) : new Date()
  const dia = String(dt.getDate()).padStart(2, "0")
  const mes = String(dt.getMonth() + 1).padStart(2, "0")
  const letra = normalizarTexto(novoProduto).slice(0, 1) || "X"
  const sequencias = etapas.map((e) => Number(String(e.lote || "").slice(-4))).filter((n) => !Number.isNaN(n))
  const proximaSeq = String((sequencias.length ? Math.max(...sequencias) : 1000) + 1).padStart(4, "0")
  return `${dia}${mes}${letra}${proximaSeq}`
}

// ─── Colunas da tabela ────────────────────────────────────────────────────────

const COLUMNS: Column[] = [
  { key: "lote", label: "LOTE", width: 100, frozen: true, render: (e) => e.lote },
  { key: "codigo", label: "CÓDIGO", width: 80, frozen: true, render: (e) => e.codigo_produto },
  { key: "produto", label: "PRODUTO", width: 200, frozen: true, render: (e) => e.descricao_produto },
  { key: "tempo", label: "TEMPO\n(h)", width: 80, align: "right", render: (e) => fmt(e.duracao_horas) },
  { key: "unhora", label: "UN/\nHORA", width: 80, align: "right", render: (e) => fmt(e.un_hora) },
  { key: "qtd", label: "QTD.\n(Tubetes)", width: 100, align: "right", render: (e) => fmt(e.qtd_planejada) },
  { key: "mesprod", label: "MÊS\nPROD.", width: 72, align: "center", render: (e) => e.mes_producao },
  { key: "anoprod", label: "ANO\nPROD.", width: 72, align: "center", render: (e) => e.ano_producao },
  { key: "inicio", label: "DATA\nINÍCIO", width: 100, align: "center", render: (e) => fmtData(e.data_inicio) },
  { key: "fim", label: "DATA\nFIM", width: 100, align: "center", render: (e) => fmtData(e.data_fim) },
  { key: "lib", label: "DATA\nLIB.", width: 100, align: "center", render: (e) => fmtData(e.data_pa) },
  { key: "meslib", label: "MÊS\nLIB.", width: 72, align: "center", render: (e) => e.mes_liberacao },
  { key: "anolib", label: "ANO\nLIB.", width: 72, align: "center", render: (e) => e.ano_liberacao },
  { key: "observacao", label: "OBSERVAÇÃO", width: 180, align: "left", render: (e) => e.observacao },
]

const FROZEN_COLUMNS = COLUMNS.filter((c) => c.frozen)
const FROZEN_COLUMNS_WIDTH = FROZEN_COLUMNS.reduce((total, col) => total + col.width, 0)
const SCROLL_COLUMNS = COLUMNS.filter((c) => !c.frozen)

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastNotification({ toast }: { toast: Toast }) {
  return (
    <div className="fixed right-6 top-6 z-[9999] min-w-[340px] rounded-2xl border px-5 py-4 shadow-2xl"
      style={{
        background: toast.tipo === "success" ? "#F0FDF4" : "#FEF2F2",
        borderColor: toast.tipo === "success" ? "#BBF7D0" : "#FECACA",
        color: toast.tipo === "success" ? "#14532D" : "#7F1D1D",
      }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
          style={{ background: toast.tipo === "success" ? "#DCFCE7" : "#FEE2E2" }}>
          {toast.tipo === "success"
            ? <CheckCircle2 size={18} style={{ color: "#16A34A" }} />
            : <AlertCircle size={18} style={{ color: "#DC2626" }} />}
        </div>
        <div>
          <div className="text-sm font-semibold">{toast.titulo}</div>
          <div className="mt-1 text-sm opacity-80">{toast.mensagem}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Nova Rodada ────────────────────────────────────────────────────────

function ModalNovaRodada({ open, onClose, onCriar, rodadas }: {
  open: boolean
  onClose: () => void
  onCriar: (nome: string, mes: number, ano: number, versao: number, obs: string) => Promise<void>
  rodadas: MrpRodada[]
}) {
  const hoje = new Date()
  const [nome, setNome] = useState("MPS")
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [versao, setVersao] = useState(1)
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    const versoes = rodadas.filter((r) => r.mes === mes && r.ano === ano).map((r) => r.versao || 0)
    setVersao(versoes.length ? Math.max(...versoes) + 1 : 1)
  }, [open, mes, ano, rodadas])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)" }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="card-label mb-0.5">MPS</p>
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Nova rodada de planejamento</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <div className="flex flex-col gap-1.5">
            <label className="card-label">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)}
              className="h-11 rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Mês</label>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Ano</label>
              <input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Versão</label>
              <input type="number" value={versao} onChange={(e) => setVersao(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="card-label">Observação</label>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3}
              className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <button disabled={salvando}
            onClick={async () => { setSalvando(true); await onCriar(nome, mes, ano, versao, observacao); setSalvando(false) }}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white"
            style={{ background: AZUL, opacity: salvando ? 0.7 : 1 }}>
            {salvando ? "Criando..." : "Criar rodada"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Confirmar Exclusão ─────────────────────────────────────────────────

function ModalExcluir({ open, rodada, onClose, onConfirmar, excluindo }: {
  open: boolean; rodada: MrpRodada | null
  onClose: () => void; onConfirmar: () => Promise<void>; excluindo: boolean
}) {
  if (!open || !rodada) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)" }}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0" style={{ background: "#FEF2F2" }}>
            <Trash2 size={22} style={{ color: "#DC2626" }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Excluir rodada</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Tem certeza que deseja excluir <strong style={{ color: "var(--text-primary)" }}>{rodada.nome} — V{rodada.versao}</strong>?
              Esta ação remove etapas, alocações e produção real vinculadas.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onClose} disabled={excluindo}
                className="rounded-xl border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                Cancelar
              </button>
              <button onClick={onConfirmar} disabled={excluindo}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "#DC2626", opacity: excluindo ? 0.6 : 1 }}>
                {excluindo ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, delta, destaque = false, cor }: {
  label: string; value: string; sub?: string
  delta?: number | null; destaque?: boolean; cor?: "red" | "green" | "neutral"
}) {
  const corDelta = delta == null ? "neutral" : delta < 0 ? "red" : delta > 0 ? "green" : "neutral"
  const corFinal = cor || corDelta
  return (
    <div style={{
      border: `1px solid ${destaque ? AZUL : "var(--border)"}`,
      background: destaque ? AZUL : "var(--bg-secondary)",
      borderRadius: 16, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 6,
      position: "relative", overflow: "hidden",
    }}>
      {destaque && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: "rgba(255,255,255,0.05)", borderRadius: "0 0 0 80px" }} />
      )}
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: destaque ? "rgba(255,255,255,0.6)" : "var(--text-secondary)", margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 26, fontWeight: 800, margin: 0, lineHeight: 1, color: destaque ? "#fff" : corFinal === "red" ? "#B91C1C" : corFinal === "green" ? "#15803D" : "var(--text-primary)" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, margin: 0, color: destaque ? "rgba(255,255,255,0.55)" : "var(--text-secondary)" }}>{sub}</p>}
      {delta != null && delta !== 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
          {delta < 0 ? <ArrowDown size={12} style={{ color: "#DC2626" }} /> : <ArrowUp size={12} style={{ color: "#16A34A" }} />}
          <span style={{ fontSize: 11, fontWeight: 600, color: delta < 0 ? "#DC2626" : "#16A34A" }}>
            {fmtSinal(delta)} vs anterior
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Evolução de versões ──────────────────────────────────────────────────────

function EvolucaoVersoes({ dadosVersao, divisor, labelUnidade }: {
  dadosVersao: { rodada: MrpRodada; totalMesTubetes: number }[]
  divisor: number; labelUnidade: string
}) {
  const max = Math.max(...dadosVersao.map((d) => d.totalMesTubetes / divisor), 1)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dadosVersao.map((item, idx) => {
        const valor = item.totalMesTubetes / divisor
        const anterior = idx > 0 ? dadosVersao[idx - 1].totalMesTubetes / divisor : null
        const delta = anterior != null ? valor - anterior : null
        const largura = Math.max(4, Math.round((valor / max) * 100))
        const isAtual = idx === dadosVersao.length - 1
        const isPrimeira = idx === 0
        return (
          <div key={item.rodada.id || idx} style={{ display: "grid", gridTemplateColumns: "72px 1fr 180px", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)" }}>V{item.rodada.versao}</span>
              {isAtual && <span style={{ fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px", letterSpacing: "0.05em" }}>ATUAL</span>}
              {isPrimeira && !isAtual && <span style={{ fontSize: 9, fontWeight: 600, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 99, padding: "2px 6px" }}>BASE</span>}
            </div>
            <div style={{ height: 32, background: "var(--bg-primary)", borderRadius: 99, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ width: `${largura}%`, height: "100%", background: isAtual ? AZUL : "rgba(23,55,94,0.25)", borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10 }}>
                {valor > 0 && largura > 15 && <span style={{ fontSize: 11, fontWeight: 700, color: isAtual ? "#fff" : AZUL }}>{fmt(valor)}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{fmt(valor)} {labelUnidade}</div>
              {delta != null && (
                <div style={{ fontSize: 11, fontWeight: 600, color: delta < 0 ? "#DC2626" : delta > 0 ? "#16A34A" : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                  {delta < 0 ? <TrendingDown size={11} /> : delta > 0 ? <TrendingUp size={11} /> : <Minus size={11} />}
                  {fmtSinal(delta)} vs V{dadosVersao[idx - 1].rodada.versao}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tabela mensal unificada ──────────────────────────────────────────────────

function TabelaMensalUnificada({ dadosVersao, anoAnalise, divisor }: {
  dadosVersao: { rodada: MrpRodada; porMes: number[] }[]
  anoAnalise: number; divisor: number
}) {
  if (!dadosVersao.length) return null
  const atual = dadosVersao[dadosVersao.length - 1]
  const primeira = dadosVersao[0]
  const thBase: React.CSSProperties = { padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.8)", textAlign: "right", whiteSpace: "nowrap", background: AZUL, borderRight: "1px solid rgba(255,255,255,0.1)" }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: "left", minWidth: 90, position: "sticky", left: 0, zIndex: 2 }}>Versão</th>
            {MESES.map((m) => <th key={m} style={thBase}>{m}</th>)}
            <th style={{ ...thBase, borderRight: "none" }}>Total ano</th>
          </tr>
        </thead>
        <tbody>
          {dadosVersao.map((item, idx) => {
            const isAtual = idx === dadosVersao.length - 1
            const anterior = idx > 0 ? dadosVersao[idx - 1] : null
            const rowBg = isAtual ? "rgba(23,55,94,0.05)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
            const total = item.porMes.reduce((a, b) => a + b, 0) / divisor
            return (
              <tr key={item.rodada.id || idx} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }}>
                  V{item.rodada.versao}
                  {isAtual && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
                </td>
                {item.porMes.map((totalMes, mesIdx) => {
                  const val = totalMes / divisor
                  const valAnt = (anterior?.porMes[mesIdx] || 0) / divisor
                  const valBase = (primeira.porMes[mesIdx] || 0) / divisor
                  const difAnt = val - valAnt
                  const difBase = val - valBase
                  const temQueda = isAtual && difBase < -0.5
                  const temGanho = isAtual && difBase > 0.5
                  return (
                    <td key={mesIdx} style={{ padding: "10px 10px", textAlign: "right", borderRight: "1px solid var(--border)", background: temQueda ? "rgba(220,38,38,0.04)" : temGanho ? "rgba(22,163,74,0.04)" : undefined }}>
                      <div style={{ fontWeight: isAtual ? 700 : 400, color: "var(--text-primary)" }}>
                        {val > 0 ? fmt(val) : <span style={{ color: "var(--border)" }}>—</span>}
                      </div>
                      {anterior && difAnt !== 0 && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: difAnt > 0 ? "#16A34A" : "#DC2626", marginTop: 1 }}>
                          {fmtSinal(difAnt)}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)}</td>
              </tr>
            )
          })}
          {/* Linha delta V1 → Atual */}
          {dadosVersao.length > 1 && (
            <tr style={{ background: "rgba(23,55,94,0.03)", borderTop: "2px solid var(--border)" }}>
              <td style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", position: "sticky", left: 0, background: "rgba(23,55,94,0.03)", borderRight: "1px solid var(--border)" }}>
                Δ V1→Atual
              </td>
              {atual.porMes.map((totalMes, mesIdx) => {
                const val = totalMes / divisor
                const valBase = (primeira.porMes[mesIdx] || 0) / divisor
                const dif = val - valBase
                return (
                  <td key={mesIdx} style={{ padding: "10px 10px", textAlign: "right", borderRight: "1px solid var(--border)" }}>
                    {dif !== 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: dif > 0 ? "#15803D" : "#B91C1C" }}>{fmtSinal(dif)}</span>
                      : <span style={{ color: "var(--border)", fontSize: 11 }}>—</span>}
                  </td>
                )
              })}
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                {(() => {
                  const totalAtual = atual.porMes.reduce((a, b) => a + b, 0) / divisor
                  const totalBase = primeira.porMes.reduce((a, b) => a + b, 0) / divisor
                  const dif = totalAtual - totalBase
                  return <span style={{ fontSize: 12, fontWeight: 700, color: dif < 0 ? "#B91C1C" : dif > 0 ? "#15803D" : "var(--text-secondary)" }}>{fmtSinal(dif)}</span>
                })()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Abertura por linha ───────────────────────────────────────────────────────

function AberturaLinhas({ dadosVersao, divisor, labelUnidade }: {
  dadosVersao: { rodada: MrpRodada; porLinha: Record<string, number> }[]
  divisor: number; labelUnidade: string
}) {
  const linhas = ["L1", "L2"]
  const thBase: React.CSSProperties = { padding: "10px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.8)", textAlign: "right", whiteSpace: "nowrap", background: AZUL, borderRight: "1px solid rgba(255,255,255,0.1)" }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: "left", minWidth: 90 }}>Versão</th>
            {linhas.map((l) => <th key={l} style={thBase}>{l}</th>)}
            <th style={{ ...thBase, borderRight: "none" }}>Total mês</th>
          </tr>
        </thead>
        <tbody>
          {dadosVersao.map((item, idx) => {
            const isAtual = idx === dadosVersao.length - 1
            const anterior = idx > 0 ? dadosVersao[idx - 1] : null
            const rowBg = isAtual ? "rgba(23,55,94,0.05)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
            const total = linhas.reduce((s, l) => s + (item.porLinha[l] || 0), 0) / divisor
            return (
              <tr key={item.rodada.id || idx} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)", borderRight: "1px solid var(--border)" }}>
                  V{item.rodada.versao}
                  {isAtual && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
                </td>
                {linhas.map((l) => {
                  const val = (item.porLinha[l] || 0) / divisor
                  const valAnt = (anterior?.porLinha[l] || 0) / divisor
                  const dif = val - valAnt
                  return (
                    <td key={l} style={{ padding: "10px 14px", textAlign: "right", borderRight: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: isAtual ? 700 : 400, color: "var(--text-primary)" }}>{fmt(val)}</div>
                      {anterior && dif !== 0 && <div style={{ fontSize: 10, fontWeight: 600, color: dif > 0 ? "#16A34A" : "#DC2626", marginTop: 1 }}>{fmtSinal(dif)}</div>}
                    </td>
                  )
                })}
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)} {labelUnidade}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Painel do realizado ──────────────────────────────────────────────────────

function PainelRealizado({ mudancasRealizado, divisor, labelUnidade }: {
  mudancasRealizado: MudancaRealizado[]; divisor: number; labelUnidade: string
}) {
  const resumo = useMemo(() => {
    const atrasados = mudancasRealizado.filter((m) => m.tipo_impacto === "atrasou")
    const antecipados = mudancasRealizado.filter((m) => m.tipo_impacto === "antecipou")
    const maiorAtraso = Math.max(0, ...atrasados.map((m) => Number(m.impacto_dias || 0)))
    const volumeImpactado = atrasados.reduce((acc, m) => acc + Number(m.qtd_planejada || 0), 0) / divisor
    return { atrasados, antecipados, maiorAtraso, volumeImpactado }
  }, [mudancasRealizado, divisor])

  if (!mudancasRealizado.length) return null

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Realizado Cogtive</p>
        <h3 style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Impacto operacional da semana</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
        {[
          { label: "Lotes atrasados", value: String(resumo.atrasados.length), cor: resumo.atrasados.length > 0 ? "#B91C1C" : "var(--text-primary)", bg: resumo.atrasados.length > 0 ? "rgba(220,38,38,0.04)" : undefined },
          { label: "Lotes antecipados", value: String(resumo.antecipados.length), cor: resumo.antecipados.length > 0 ? "#15803D" : "var(--text-primary)", bg: resumo.antecipados.length > 0 ? "rgba(22,163,74,0.04)" : undefined },
          { label: "Maior atraso", value: `${resumo.maiorAtraso}d`, cor: resumo.maiorAtraso > 2 ? "#B91C1C" : "var(--text-primary)", bg: undefined },
          { label: `Vol. em risco (${labelUnidade})`, value: fmt(resumo.volumeImpactado), cor: resumo.volumeImpactado > 0 ? "#B45309" : "var(--text-primary)", bg: resumo.volumeImpactado > 0 ? "rgba(217,119,6,0.04)" : undefined },
        ].map((kpi, i) => (
          <div key={i} style={{ padding: "16px 20px", borderRight: i < 3 ? "1px solid var(--border)" : undefined, background: kpi.bg }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-secondary)" }}>{kpi.label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 800, color: kpi.cor }}>{kpi.value}</p>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg-primary)" }}>
              {["Lote", "Produto", "Recurso", "Fim planejado", "Fim real", "Impacto", "UN/H ant.", "UN/H nova", "Δ UN/H"].map((h, i) => (
                <th key={h} style={{ padding: "9px 12px", textAlign: i >= 3 ? "center" : "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mudancasRealizado.map((m, idx) => {
              const atrasou = m.tipo_impacto === "atrasou"
              const antecipou = m.tipo_impacto === "antecipou"
              return (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)", background: atrasou ? "rgba(220,38,38,0.02)" : antecipou ? "rgba(22,163,74,0.02)" : undefined }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700, color: "var(--text-primary)" }}>{m.lote || m.lote_real_cogtive || "-"}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{m.descricao_produto || "-"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{m.codigo_produto}</div>
                  </td>
                  <td style={{ padding: "9px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>{m.recurso || "-"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--text-secondary)" }}>{fmtData(m.data_fim_anterior)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{fmtData(m.data_fim_nova)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, border: "1px solid", background: atrasou ? "rgba(220,38,38,0.08)" : antecipou ? "rgba(22,163,74,0.08)" : "rgba(0,0,0,0.04)", borderColor: atrasou ? "rgba(220,38,38,0.25)" : antecipou ? "rgba(22,163,74,0.25)" : "var(--border)", color: atrasou ? "#B91C1C" : antecipou ? "#15803D" : "var(--text-secondary)" }}>
                      {atrasou ? <ArrowDown size={10} /> : antecipou ? <ArrowUp size={10} /> : <Minus size={10} />}
                      {atrasou ? `+${Math.abs(Number(m.impacto_dias || 0))}d` : antecipou ? `-${Math.abs(Number(m.impacto_dias || 0))}d` : "="}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--text-secondary)" }}>{fmt(m.un_hora_anterior)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(m.un_hora_nova)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    {m.delta_un_hora_pct != null
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: Number(m.delta_un_hora_pct) < 0 ? "#B91C1C" : "#15803D" }}>{fmtPct(m.delta_un_hora_pct)}</span>
                      : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─── Gráficos executivos da visão consolidada ────────────────────────────────

type DadosVersaoConsolidado = {
  rodada: MrpRodada
  totalMesTubetes: number
  porLinha: Record<string, number>
  porMes: number[]
}

function GraficoAnualVertical({ dadosVersao, divisor, labelUnidade, orcadoAnualCaixas }: {
  dadosVersao: DadosVersaoConsolidado[]
  divisor: number
  labelUnidade: string
  orcadoAnualCaixas: number | null
}) {
  if (!dadosVersao.length) return null

  const orcadoValor = orcadoAnualCaixas != null
    ? unidadeValor(orcadoAnualCaixas, divisor)
    : null

  const barras = [
    ...(orcadoValor != null ? [{ key: "orcado", label: "Orçado", valor: orcadoValor, tipo: "orcado" as const }] : []),
    ...dadosVersao.map((d, idx) => ({
      key: d.rodada.id || `v-${idx}`,
      label: `V${d.rodada.versao}`,
      valor: d.porMes.reduce((a, b) => a + b, 0) / divisor,
      tipo: idx === dadosVersao.length - 1 ? "atual" as const : "versao" as const,
      deltaAnterior: idx > 0 ? (d.porMes.reduce((a, b) => a + b, 0) - dadosVersao[idx - 1].porMes.reduce((a, b) => a + b, 0)) / divisor : null,
    })),
  ]

  const valores = barras.map((b) => b.valor).filter((v) => Number.isFinite(v) && v > 0)
  const minValor = Math.min(...valores)
  const maxValor = Math.max(...valores)
  const range = Math.max(1, maxValor - minValor)
  const escalaMin = Math.max(0, minValor - range * 0.45)
  const escalaMax = maxValor + range * 0.25
  const escalaRange = Math.max(1, escalaMax - escalaMin)
  const totalAtual = dadosVersao[dadosVersao.length - 1].porMes.reduce((a, b) => a + b, 0) / divisor
  const totalBase = dadosVersao[0].porMes.reduce((a, b) => a + b, 0) / divisor
  const deltaVsBase = totalAtual - totalBase
  const deltaVsOrcado = orcadoValor != null ? totalAtual - orcadoValor : null

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Comparativo anual</p>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Total projetado por versão</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Valores em {labelUnidade}. Escala ajustada para evidenciar variações pequenas entre versões.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Δ V1 → atual</p>
          <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 800, color: deltaVsBase < 0 ? "#B91C1C" : deltaVsBase > 0 ? "#15803D" : "var(--text-primary)" }}>{fmtSinal(deltaVsBase)}</p>
          {deltaVsOrcado != null && (
            <p style={{ margin: 0, fontSize: 11, color: deltaVsOrcado < 0 ? "#B91C1C" : "#15803D", fontWeight: 700 }}>{fmtSinal(deltaVsOrcado)} vs orçado</p>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${barras.length}, minmax(90px, 1fr))`, gap: 18, alignItems: "end", minHeight: 230, padding: "10px 4px 0" }}>
        {barras.map((b, idx) => {
          const h = 62 + ((b.valor - escalaMin) / escalaRange) * 138
          const cor = b.tipo === "orcado" ? "#EA580C" : b.tipo === "atual" ? AZUL : "#CBD5E1"
          const textoCor = b.tipo === "atual" ? AZUL : b.tipo === "orcado" ? "#EA580C" : "var(--text-secondary)"
          const deltaBase = b.tipo !== "orcado" ? b.valor - totalBase : null
          const deltaAnt = "deltaAnterior" in b ? b.deltaAnterior : null
          return (
            <div key={b.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>{fmt(b.valor)}</div>
              <div style={{ width: "min(76px, 62%)", height: h, borderRadius: "12px 12px 4px 4px", background: cor, boxShadow: b.tipo === "atual" ? "0 14px 30px rgba(23,55,94,0.18)" : undefined, opacity: b.tipo === "orcado" ? 0.95 : 1 }} />
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: textoCor, display: "flex", alignItems: "center", gap: 5 }}>
                {b.label}
                {b.tipo === "atual" && <span style={{ fontSize: 9, fontWeight: 800, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
              </div>
              {b.tipo !== "orcado" && deltaBase != null && idx > (orcadoValor != null ? 1 : 0) && (
                <div style={{ fontSize: 10, fontWeight: 700, color: deltaBase < 0 ? "#DC2626" : "#16A34A", marginTop: 2 }}>{fmtSinal(deltaBase)} vs V1</div>
              )}
              {deltaAnt != null && deltaAnt !== 0 && (
                <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 1 }}>{fmtSinal(deltaAnt)} vs anterior</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function unidadeValor(caixas: number, divisor: number) {
  return divisor === 500 ? caixas : caixas * 500
}

function GraficoMensalVersoes({ dadosVersao, divisor, anoAnalise }: {
  dadosVersao: DadosVersaoConsolidado[]
  divisor: number
  anoAnalise: number
}) {
  if (!dadosVersao.length) return null

  const valores = dadosVersao.flatMap((d) => d.porMes.map((v) => v / divisor)).filter((v) => v > 0)
  const max = Math.max(...valores, 1)
  const larguraGrupo = Math.max(92, dadosVersao.length * 20 + 34)

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Evolução mensal</p>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Versões por mês — {anoAnalise}</h3>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {dadosVersao.map((d, idx) => (
            <span key={d.rodada.id || idx} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)", fontWeight: 700 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: idx === dadosVersao.length - 1 ? AZUL : idx === 0 ? "#94A3B8" : "#CBD5E1" }} />
              V{d.rodada.versao}{idx === dadosVersao.length - 1 ? " atual" : ""}
            </span>
          ))}
        </div>
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 2 }}>
        <div style={{ minWidth: Math.max(920, larguraGrupo * 12), height: 270, display: "flex", alignItems: "flex-end", gap: 10, borderBottom: "1px solid var(--border)", padding: "24px 8px 0" }}>
          {MESES.map((mes, mesIdx) => {
            const base = dadosVersao[0]?.porMes[mesIdx] || 0
            const atual = dadosVersao[dadosVersao.length - 1]?.porMes[mesIdx] || 0
            const delta = (atual - base) / divisor
            return (
              <div key={mes} style={{ width: larguraGrupo, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <div style={{ height: 205, display: "flex", alignItems: "flex-end", gap: 4 }}>
                  {dadosVersao.map((d, idx) => {
                    const valor = d.porMes[mesIdx] / divisor
                    const h = Math.max(3, (valor / max) * 185)
                    const cor = idx === dadosVersao.length - 1 ? AZUL : idx === 0 ? "#94A3B8" : "#CBD5E1"
                    return (
                      <div key={d.rodada.id || idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                        {idx === dadosVersao.length - 1 && valor > 0 && <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 9, fontWeight: 800, color: "#fff", position: "absolute", marginBottom: Math.min(h - 8, 150) }}>{fmt(valor)}</span>}
                        <div title={`V${d.rodada.versao} · ${mes}: ${fmt(valor)}`} style={{ width: 14, height: h, borderRadius: "6px 6px 2px 2px", background: cor }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>{mes}</div>
                <div style={{ height: 16, fontSize: 10, fontWeight: 800, color: delta < 0 ? "#DC2626" : delta > 0 ? "#16A34A" : "var(--text-secondary)" }}>{delta !== 0 ? fmtSinal(delta) : "—"}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Visão Consolidada ────────────────────────────────────────────────────────

function VisaoConsolidada({ rodadas, etapasPorRodada, rodadaAtual, mudancasRealizado }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  rodadaAtual: MrpRodada | null
  mudancasRealizado: MudancaRealizado[]
}) {
  const [unidade, setUnidade] = useState<UnidadeConsolidado>("caixas")
  const mesAnalise = rodadaAtual?.mes || new Date().getMonth() + 1
  const anoAnalise = rodadaAtual?.ano || new Date().getFullYear()
  const divisor = unidade === "caixas" ? 500 : 1
  const labelUnidade = unidade === "caixas" ? "cx" : "tb"
  const [orcadoAnualCaixas, setOrcadoAnualCaixas] = useState<number | null>(null)

  useEffect(() => {
    getOrcadoFaturamento()
      .then((d: unknown) => setOrcadoAnualCaixas(Number((d as { total_caixas?: number })?.total_caixas || 0)))
      .catch(() => setOrcadoAnualCaixas(null))
  }, [])

  const dadosVersao = useMemo(() => {
    return rodadas.map((rodada) => {
      const etapasBase = etapasPorRodada[rodada.id || ""] || []
      const etapas = etapasBase.filter((e) => ["L1", "L2"].includes(String(e.recurso || "").toUpperCase()))
      const totalMesTubetes = etapas.reduce((acc, e) => {
        if (Number(e.mes_liberacao) === mesAnalise && Number(e.ano_liberacao) === anoAnalise)
          return acc + Number(e.qtd_planejada || 0)
        return acc
      }, 0)
      const porLinha: Record<string, number> = {}
      ;["L1", "L2"].forEach((r) => {
        porLinha[r] = etapas.reduce((s, e) => {
          if (Number(e.mes_liberacao) === mesAnalise && Number(e.ano_liberacao) === anoAnalise && String(e.recurso || "").toUpperCase() === r)
            return s + Number(e.qtd_planejada || 0)
          return s
        }, 0)
      })
      const porMes = Array.from({ length: 12 }, (_, i) => {
        const mes = i + 1
        return etapas.reduce((acc, e) => {
          if (Number(e.mes_liberacao) === mes && Number(e.ano_liberacao) === anoAnalise)
            return acc + Number(e.qtd_planejada || 0)
          return acc
        }, 0)
      })
      return { rodada, totalMesTubetes, porLinha, porMes }
    })
  }, [rodadas, etapasPorRodada, mesAnalise, anoAnalise])

  const atual = dadosVersao[dadosVersao.length - 1]
  const anterior = dadosVersao.length > 1 ? dadosVersao[dadosVersao.length - 2] : null
  const primeira = dadosVersao[0]

  if (!rodadas.length) {
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Nenhuma versão disponível.</p>
      </div>
    )
  }

  const valorAtual = (atual?.totalMesTubetes || 0) / divisor
  const deltaAnterior = anterior ? valorAtual - (anterior.totalMesTubetes / divisor) : null
  const deltaPrimeira = primeira && primeira !== atual ? valorAtual - (primeira.totalMesTubetes / divisor) : null
  const lotesAtrasados = mudancasRealizado.filter((m) => m.tipo_impacto === "atrasou").length
  const maiorAtraso = Math.max(0, ...mudancasRealizado.map((m) => Number(m.impacto_dias || 0)).filter((v) => v > 0))

  const sectionTitle = (label: string, sub: string) => (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>{label}</p>
      <h3 style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{sub}</h3>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Bloco 1: KPIs */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Visão consolidada</p>
            <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
              {MESES[mesAnalise - 1]}/{anoAnalise} — V{rodadaAtual?.versao} ({rodadas.length} {rodadas.length === 1 ? "versão" : "versões"})
            </h2>
          </div>
          <div style={{ display: "flex", borderRadius: 12, border: "1px solid var(--border)", padding: 4, background: "var(--bg-primary)" }}>
            {(["caixas", "tubetes"] as UnidadeConsolidado[]).map((opcao) => (
              <button key={opcao} type="button" onClick={() => setUnidade(opcao)}
                style={{ borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: unidade === opcao ? AZUL : "transparent", color: unidade === opcao ? "#fff" : "var(--text-secondary)" }}>
                {opcao === "caixas" ? "Caixas" : "Tubetes"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <KpiCard label={`Volume ${MESES[mesAnalise - 1]}/${anoAnalise}`} value={fmt(valorAtual)} sub={`${labelUnidade} — V${atual?.rodada?.versao}`} destaque />
          <KpiCard label="Δ vs versão anterior" value={deltaAnterior != null ? fmtSinal(deltaAnterior) : "—"} sub={anterior ? `V${anterior.rodada.versao} → V${atual?.rodada?.versao}` : "Primeira versão"} delta={deltaAnterior} />
          <KpiCard label={`Δ vs V${primeira?.rodada?.versao || 1} (base)`} value={deltaPrimeira != null ? fmtSinal(deltaPrimeira) : "—"} sub="Acumulado desde o início do mês" delta={deltaPrimeira} />
          <KpiCard label="Lotes atrasados" value={String(lotesAtrasados)} sub="Cogtive na versão atual" cor={lotesAtrasados > 0 ? "red" : "neutral"} />
          <KpiCard label="Maior atraso" value={`${maiorAtraso}d`} sub="Entre lotes atualizados" cor={maiorAtraso > 2 ? "red" : "neutral"} />
        </div>
      </div>

      {/* Bloco 2: Comparativo anual */}
      <GraficoAnualVertical
        dadosVersao={dadosVersao}
        divisor={divisor}
        labelUnidade={labelUnidade}
        orcadoAnualCaixas={orcadoAnualCaixas}
      />

      {/* Bloco 3: Evolução mensal */}
      <GraficoMensalVersoes dadosVersao={dadosVersao} divisor={divisor} anoAnalise={anoAnalise} />

      {/* Bloco 4: Tabela mensal */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {sectionTitle("Distribuição anual", `Liberação mensal por versão — ${anoAnalise}`)}
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
            Valores em {unidade}. Delta em relação à versão anterior. Linha Δ V1→Atual mostra o acumulado total.
          </p>
        </div>
        <TabelaMensalUnificada dadosVersao={dadosVersao} anoAnalise={anoAnalise} divisor={divisor} />
      </div>

      {/* Bloco 5: Abertura por linha */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {sectionTitle("Abertura por linha", `L1 e L2 — ${MESES[mesAnalise - 1]}/${anoAnalise}`)}
        </div>
        <AberturaLinhas dadosVersao={dadosVersao} divisor={divisor} labelUnidade={labelUnidade} />
      </div>

      {/* Bloco 6: Realizado */}
      {mudancasRealizado.length > 0 && (
        <PainelRealizado mudancasRealizado={mudancasRealizado} divisor={divisor} labelUnidade={labelUnidade} />
      )}
    </div>
  )
}

// ─── Comparativo de Liberação (aba detalhado) ─────────────────────────────────

function ComparativoLiberacao({ rodadas, etapasPorRodada, recursoFiltro }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  recursoFiltro?: string
}) {
  const mesesUnicos = useMemo(() => {
    const anoBase = rodadas.find((r) => r?.ano)?.ano || new Date().getFullYear()
    return Array.from({ length: 12 }, (_, i) => `${anoBase}-${String(i + 1).padStart(2, "0")}`)
  }, [rodadas])

  const dados = useMemo(() => {
    return rodadas.map((rodada) => {
      const etapasBase = etapasPorRodada[rodada.id || ""] || []
      const etapas = recursoFiltro ? etapasBase.filter((e) => String(e.recurso || "").toUpperCase() === String(recursoFiltro).toUpperCase()) : etapasBase
      const porMes: Record<string, number> = {}
      mesesUnicos.forEach((chave) => { porMes[chave] = 0 })
      etapas.forEach((e) => {
        if (e.mes_liberacao && e.ano_liberacao) {
          const chave = `${e.ano_liberacao}-${String(e.mes_liberacao).padStart(2, "0")}`
          porMes[chave] = (porMes[chave] || 0) + Number(e.qtd_planejada || 0)
        }
      })
      const total = Object.values(porMes).reduce((a, b) => a + b, 0)
      return { rodada, porMes, total }
    })
  }, [rodadas, etapasPorRodada, mesesUnicos, recursoFiltro])

  if (!rodadas.length || !mesesUnicos.length) return null

  const thStyle: React.CSSProperties = { background: AZUL, color: "#fff", padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", borderRight: "1px solid rgba(255,255,255,0.1)" }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-0.5">Comparativo de versões</p>
        <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Liberação mensal — tubetes e caixas por versão</h3>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          Soma de QTD. (Tubetes) por Mês Lib. de cada versão{recursoFiltro ? ` — ${recursoFiltro}` : ""}. Caixas = tubetes / 500.
        </p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 120, position: "sticky", left: 0, zIndex: 2 }}>Versão</th>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 80 }}>Unidade</th>
              {mesesUnicos.map((chave) => {
                const [ano, mes] = chave.split("-")
                return <th key={chave} style={thStyle}>{MESES[Number(mes) - 1]}/{ano}</th>
              })}
              <th style={{ ...thStyle, borderRight: "none" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.map(({ rodada, porMes, total }, idx) => {
              const anterior = idx > 0 ? dados[idx - 1] : null
              const isLast = idx === dados.length - 1
              const rowBg = isLast ? "rgba(23,55,94,0.04)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
              return (
                <>
                  <tr key={`${rodada.id}-tb`} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--text-primary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }}>
                      V{rodada.versao}
                      {isLast && <span className="ml-2 text-[10px] rounded-full px-1.5 py-0.5 font-semibold" style={{ background: AZUL, color: "#fff" }}>Atual</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-secondary)", borderRight: "1px solid var(--border)" }}>Tubetes</td>
                    {mesesUnicos.map((chave) => {
                      const val = porMes[chave] || 0
                      const valAnt = anterior?.porMes[chave] || 0
                      const dif = val - valAnt
                      return (
                        <td key={chave} style={{ padding: "10px 14px", textAlign: "right", borderRight: "1px solid var(--border)", color: "var(--text-primary)" }}>
                          <div>{fmt(val)}</div>
                          {anterior && dif !== 0 && <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>{dif > 0 ? "+" : ""}{fmt(dif)}</div>}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)}</td>
                  </tr>
                  <tr key={`${rodada.id}-cx`} style={{ background: rowBg, borderBottom: "2px solid var(--border)" }}>
                    <td style={{ padding: "6px 14px 10px", color: "var(--text-secondary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }} />
                    <td style={{ padding: "6px 14px 10px", color: "var(--text-secondary)", borderRight: "1px solid var(--border)" }}>Caixas</td>
                    {mesesUnicos.map((chave) => {
                      const val = (porMes[chave] || 0) / 500
                      const valAnt = (anterior?.porMes[chave] || 0) / 500
                      const dif = val - valAnt
                      return (
                        <td key={chave} style={{ padding: "6px 14px 10px", textAlign: "right", borderRight: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                          <div>{fmt(val)}</div>
                          {anterior && dif !== 0 && <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>{dif > 0 ? "+" : ""}{fmt(dif)}</div>}
                        </td>
                      )
                    })}
                    <td style={{ padding: "6px 14px 10px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt(total / 500)}</td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] = useState<MrpRodada | null>(null)
  const [etapas, setEtapas] = useState<MrpEtapa[]>([])
  const [alocacoes, setAlocacoes] = useState<MrpAlocacaoDia[]>([])
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [importandoReal, setImportandoReal] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [copiandoRodada, setCopiandoRodada] = useState(false)
  const [excluindoRodada, setExcluindoRodada] = useState(false)
  const [modalNovaRodada, setModalNovaRodada] = useState(false)
  const [modalExcluir, setModalExcluir] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [edicoes, setEdicoes] = useState<Record<string, EdicaoEtapa>>({})
  const [arquivoMps, setArquivoMps] = useState<File | null>(null)
  const [arquivoReal, setArquivoReal] = useState<File | null>(null)
  const [mudancasRealizado, setMudancasRealizado] = useState<MudancaRealizado[]>([])
  const [edicoesMudancas, setEdicoesMudancas] = useState<Record<number, { motivo?: string; mes_liberacao?: number }>>({})
  const [salvandoMudanca, setSalvandoMudanca] = useState<number | null>(null)
  const [pagina, setPagina] = useState(1)
  const [mesInicio, setMesInicio] = useState(hoje.getMonth() + 1)
  const [anoInicio, setAnoInicio] = useState(hoje.getFullYear())
  const [mesFim, setMesFim] = useState(12)
  const [anoFim, setAnoFim] = useState(2026)
  const [filtros, setFiltros] = useState<Filtros>({
    busca: "", lote: "", codigo: "", produto: "",
    mesProducao: "", anoProducao: "", mesLiberacao: "", anoLiberacao: "", recurso: "L1",
  })
  const [abaMps, setAbaMps] = useState<"detalhado" | "consolidado">("detalhado")
  const [etapasPorRodada, setEtapasPorRodada] = useState<Record<string, MrpEtapa[]>>({})

  function showToast(data: Toast, duration = 4000) {
    setToast(data)
    window.setTimeout(() => setToast(null), duration)
  }

  function limparFiltros() {
    setFiltros({ busca: "", lote: "", codigo: "", produto: "", mesProducao: "", anoProducao: "", mesLiberacao: "", anoLiberacao: "", recurso: "L1" })
    setPagina(1)
  }

  async function carregarRodadas() {
    const data = await getMrpRodadas()
    setRodadas(data)
    if (data.length > 0 && !rodadaSelecionada) setRodadaSelecionada(data[0])
    return data
  }

  async function carregarDadosRodada(rodadaId: string) {
    setLoading(true)
    try {
      const [etapasData, alocacoesData, mudancasData] = await Promise.all([
        getMrpEtapas(rodadaId),
        getMrpAlocacoes(rodadaId),
        getMrpMudancasRealizado(rodadaId),
      ])
      setEtapas(etapasData)
      setAlocacoes(alocacoesData)
      setMudancasRealizado(mudancasData.mudancas_realizado || mudancasData.lotes_atualizados || [])
      setEdicoes({})
    } finally {
      setLoading(false)
    }
  }

  async function carregarComparativo(rodadaReferencia: MrpRodada, todasRodadas: MrpRodada[]) {
    const mesmoMesAno = todasRodadas
      .filter((r) => r.mes === rodadaReferencia.mes && r.ano === rodadaReferencia.ano)
      .sort((a, b) => (a.versao || 0) - (b.versao || 0))
    const mapa: Record<string, MrpEtapa[]> = {}
    await Promise.all(mesmoMesAno.map(async (r) => {
      if (!r.id) return
      try { mapa[r.id] = await getMrpEtapas(r.id) } catch { mapa[r.id] = [] }
    }))
    setEtapasPorRodada(mapa)
  }

  async function handleCriarRodada(nome: string, mes: number, ano: number, versao: number, obs: string) {
    const nova = await criarMrpRodada({ nome, mes, ano, versao, observacao: obs || null, status: "rascunho" })
    setRodadaSelecionada(nova)
    setModalNovaRodada(false)
    const todas = await carregarRodadas()
    await carregarComparativo(nova, todas)
  }

  async function handleCopiarRodada(proximoMes = false) {
    if (!rodadaSelecionada?.id) return
    try {
      setCopiandoRodada(true)
      let payload = {}
      if (proximoMes) {
        const dt = new Date(rodadaSelecionada.ano, (rodadaSelecionada.mes || 1) - 1 + 1, 1)
        payload = { mes: dt.getMonth() + 1, ano: dt.getFullYear(), versao: 1 }
      }
      const response = await copiarMrpRodada(rodadaSelecionada.id, payload)
      const novaRodada = response.nova_rodada
      const todas = await carregarRodadas()
      setRodadaSelecionada(novaRodada)
      await carregarComparativo(novaRodada, todas)
      showToast({
        tipo: "success",
        titulo: proximoMes ? "V1 do próximo mês criada" : "Nova versão criada",
        mensagem: `Agora trabalhando na V${novaRodada.versao} de ${MESES[(novaRodada.mes || 1) - 1]}/${novaRodada.ano}.`,
      })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao copiar", mensagem: err instanceof Error ? err.message : "Erro ao copiar rodada." })
    } finally {
      setCopiandoRodada(false)
    }
  }

  async function confirmarExcluirRodada() {
    if (!rodadaSelecionada?.id) return
    try {
      setExcluindoRodada(true)
      await excluirMrpRodada(rodadaSelecionada.id)
      const todas = await carregarRodadas()
      const proxima = todas[0] || null
      setRodadaSelecionada(proxima)
      setModalExcluir(false)
      setMudancasRealizado([])
      if (!proxima) { setEtapas([]); setAlocacoes([]) }
      showToast({ tipo: "success", titulo: "Rodada excluída", mensagem: "Rodada e dados vinculados removidos com sucesso." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao excluir", mensagem: err instanceof Error ? err.message : "Erro ao excluir rodada." })
    } finally {
      setExcluindoRodada(false)
    }
  }

  async function handleImportarMps() {
    if (!rodadaSelecionada?.id || !arquivoMps) return
    try {
      setImportando(true)
      await importarMrpMps(rodadaSelecionada.id, arquivoMps)
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "MPS importado", mensagem: "Arquivo processado com sucesso." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao importar", mensagem: err instanceof Error ? err.message : "Erro ao importar MPS." })
    } finally { setImportando(false) }
  }

  async function handleImportarReal() {
    if (!rodadaSelecionada?.id || !arquivoReal) return
    try {
      setImportandoReal(true)
      const response = await importarMrpProducaoReal(rodadaSelecionada.id, arquivoReal)
      setMudancasRealizado(response.mudancas_realizado || response.lotes_atualizados || [])
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "Realizado aplicado", mensagem: `${(response.lotes_atualizados || []).length} lote(s) atualizados.` })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao importar real", mensagem: err instanceof Error ? err.message : "Erro ao importar realizado." })
    } finally { setImportandoReal(false) }
  }

  function aplicarEdicaoProduto(etapa: MrpEtapa, novoProduto: string) {
    if (!etapa.id) return
    const mapaCodigo: Record<string, string> = {}
    etapas.forEach((e) => { if (e.descricao_produto && e.codigo_produto) mapaCodigo[e.descricao_produto] = e.codigo_produto })
    const novoCodigo = mapaCodigo[novoProduto] || etapa.codigo_produto || ""
    const novoLote = !etapa.lote ? gerarLoteSugerido(etapa, novoProduto, etapas) : etapa.lote
    setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), descricao_produto: novoProduto, codigo_produto: novoCodigo, lote: novoLote } }))
  }

  async function salvarAlteracoes() {
    const entradas = Object.entries(edicoes)
    if (!entradas.length) return
    try {
      setSalvando(true)
      for (const [etapaId, dados] of entradas) await atualizarMrpEtapa(etapaId, dados)
      setEdicoes({})
      // Recarregar etapas e comparativo para atualizar gráfico e tabela anual
      if (rodadaSelecionada?.id) {
        await carregarDadosRodada(rodadaSelecionada.id)
        await carregarComparativo(rodadaSelecionada, rodadas)
      }
      showToast({ tipo: "success", titulo: "Salvo", mensagem: "Alterações salvas com sucesso." })
    } catch {
      showToast({ tipo: "error", titulo: "Erro ao salvar", mensagem: "Não foi possível salvar as alterações." })
    } finally { setSalvando(false) }
  }

  async function salvarEdicaoMudanca(idx: number, mudanca: MudancaRealizado) {
    const edicao = edicoesMudancas[idx]
    if (!edicao || !rodadaSelecionada?.id) return
    const loteRef = String(mudanca.lote || mudanca.lote_real_cogtive || "").toUpperCase()
    const recursoRef = identificarRecursoMudanca(mudanca)
    const etapa = etapas.find((e) => {
      const mesmoRecurso = String(e.recurso || "").toUpperCase() === recursoRef
      const mesmoLote = String(e.lote || "").toUpperCase() === loteRef
      return mesmoRecurso && mesmoLote
    })
    if (!etapa?.id) { showToast({ tipo: "error", titulo: "Lote não encontrado", mensagem: "Não encontrei a etapa correspondente." }); return }
    try {
      setSalvandoMudanca(idx)
      const dados: Partial<MrpEtapa> = {}
      if (edicao.motivo !== undefined) dados.observacao = edicao.motivo
      if (edicao.mes_liberacao !== undefined) dados.mes_liberacao = edicao.mes_liberacao
      await atualizarMrpEtapa(etapa.id, dados)
      // Atualizar localmente
      setMudancasRealizado((prev) => prev.map((m, i) => i === idx ? {
        ...m,
        motivo_provavel: edicao.motivo ?? m.motivo_provavel,
        mes_liberacao_novo: edicao.mes_liberacao ?? m.mes_liberacao_novo,
      } : m))
      setEdicoesMudancas((prev) => { const n = {...prev}; delete n[idx]; return n })
      showToast({ tipo: "success", titulo: "Salvo", mensagem: "Motivo e mês de liberação atualizados." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao salvar", mensagem: err instanceof Error ? err.message : "Erro ao salvar." })
    } finally { setSalvandoMudanca(null) }
  }

  async function reverterMudancaRealizado(mudanca: MudancaRealizado) {
    if (!rodadaSelecionada?.id) return
    const loteRef = String(mudanca.lote || mudanca.lote_real_cogtive || "").toUpperCase()
    const recursoRef = identificarRecursoMudanca(mudanca)
    const etapa = etapas.find((e) => {
      const mesmoRecurso = String(e.recurso || "").toUpperCase() === recursoRef
      const mesmoLote = String(e.lote || "").toUpperCase() === loteRef || String(e.op || "").toUpperCase() === loteRef
      return mesmoRecurso && mesmoLote
    })
    if (!etapa?.id) { showToast({ tipo: "error", titulo: "Lote não encontrado", mensagem: "Não encontrei a etapa correspondente." }); return }
    if (!mudanca.data_fim_anterior) { showToast({ tipo: "error", titulo: "Sem data anterior", mensagem: "Esse lote não possui data anterior registrada." }); return }
    try {
      setSalvando(true)
      const dados: EdicaoEtapa & Partial<MrpEtapa> = {
        data_fim: mudanca.data_fim_anterior,
        un_hora: mudanca.un_hora_anterior ?? etapa.un_hora,
        duracao_horas: etapa.qtd_planejada && (mudanca.un_hora_anterior || etapa.un_hora)
          ? Number(etapa.qtd_planejada) / Number(mudanca.un_hora_anterior || etapa.un_hora || 1)
          : etapa.duracao_horas,
        status: "ajuste_manual",
        origem: "AJUSTE_MANUAL_REALIZADO",
        observacao: `Reversão do realizado Cogtive — data fim original: ${mudanca.data_fim_anterior}.`,
      }
      await atualizarMrpEtapa(etapa.id, dados)
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "Ajuste revertido", mensagem: `Lote ${loteRef} voltou para a data fim planejada original.` })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao reverter", mensagem: err instanceof Error ? err.message : "Não foi possível reverter." })
    } finally { setSalvando(false) }
  }

  function etapaComEdicao(e: MrpEtapa): MrpEtapa {
    if (!e.id || !edicoes[e.id]) return e
    return { ...e, ...edicoes[e.id] }
  }

  useEffect(() => { carregarRodadas() }, [])

  useEffect(() => {
    if (rodadaSelecionada?.id) {
      carregarDadosRodada(rodadaSelecionada.id)
      carregarComparativo(rodadaSelecionada, rodadas)
    } else {
      setEtapas([]); setAlocacoes([]); setMudancasRealizado([]); setEtapasPorRodada({}); setEdicoes({})
    }
  }, [rodadaSelecionada?.id])

  useEffect(() => {
    const datas = etapas.map((e) => e.data_inicio).filter(Boolean) as string[]
    if (!datas.length) return
    const menor = datas.sort()[0]
    const dt = new Date(`${menor}T00:00:00`)
    setMesInicio(dt.getMonth() + 1)
    setAnoInicio(dt.getFullYear())
  }, [etapas])

  useEffect(() => { setPagina(1) }, [filtros])

  const dias = useMemo(() => gerarDias(mesInicio, anoInicio, mesFim, anoFim), [mesInicio, anoInicio, mesFim, anoFim])

  const mesesAgrupados = useMemo(() => {
    const grupos: { label: string; span: number }[] = []
    dias.forEach((d) => {
      const label = `${MESES[d.mes - 1]}/${d.ano}`
      if (grupos.length && grupos[grupos.length - 1].label === label) grupos[grupos.length - 1].span += 1
      else grupos.push({ label, span: 1 })
    })
    return grupos
  }, [dias])

  const opcoesPeriodo = useMemo(() => gerarOpcoesMeses(hoje.getFullYear()), [])
  const etapasComEdicoes = useMemo(() => etapas.map(etapaComEdicao), [etapas, edicoes])
  const etapasDoRecurso = useMemo(() => etapasComEdicoes.filter((e) => e.recurso === (filtros.recurso || "L1")), [etapasComEdicoes, filtros.recurso])

  const opcoesFiltros = useMemo(() => ({
    lote: uniqueSorted(etapasDoRecurso.map((e) => e.lote)),
    codigo: uniqueSorted(etapasDoRecurso.map((e) => e.codigo_produto)),
    produto: uniqueSorted(etapasDoRecurso.map((e) => e.descricao_produto)),
    mesProducao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_producao)),
    anoProducao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_producao)),
    mesLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_liberacao)),
    anoLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_liberacao)),
  }), [etapasDoRecurso])

  const produtosUnicos = useMemo(() => uniqueSorted(etapas.map((e) => e.descricao_produto)), [etapas])

  const alocacaoMap = useMemo(() => {
    const map = new Map<string, number>()
    alocacoes.forEach((a) => {
      if (!a.lote && !a.codigo_produto) return
      const key = `${a.recurso}|${a.lote || ""}|${a.codigo_produto || ""}|${keyData(a.data)}`
      map.set(key, (map.get(key) || 0) + toNumber(a.horas_alocadas))
    })
    return map
  }, [alocacoes])

  const horasDiaMap = useMemo(() => {
    const map = new Map<string, number>()
    alocacoes.forEach((a) => {
      const key = `${a.recurso}|${keyData(a.data)}`
      const disponivel = toNumber(a.horas_disponiveis_dia)
      const alocada = toNumber(a.horas_alocadas)
      if (!Number.isNaN(disponivel) && disponivel > 0) map.set(key, disponivel)
      else if (!map.has(key) && !Number.isNaN(alocada)) map.set(key, alocada)
    })
    return map
  }, [alocacoes])

  const etapasFiltradas = useMemo(() => filtrarEtapas(etapasComEdicoes, filtros), [etapasComEdicoes, filtros])
  const recursoSelecionado = filtros.recurso || "L1"
  const totalPaginas = Math.max(1, Math.ceil(etapasFiltradas.length / PAGE_SIZE))
  const paginaCorrigida = Math.min(pagina, totalPaginas)
  const etapasPagina = etapasFiltradas.slice((paginaCorrigida - 1) * PAGE_SIZE, paginaCorrigida * PAGE_SIZE)

  const mudancasDoRecurso = useMemo(
    () => mudancasRealizado.filter((m) => identificarRecursoMudanca(m) === recursoSelecionado),
    [mudancasRealizado, recursoSelecionado]
  )

  const rodadasComparativo = useMemo(() => {
    if (!rodadaSelecionada) return []
    return rodadas.filter((r) => r.mes === rodadaSelecionada.mes && r.ano === rodadaSelecionada.ano).sort((a, b) => (a.versao || 0) - (b.versao || 0))
  }, [rodadas, rodadaSelecionada])

  const qtdEdicoes = Object.keys(edicoes).length

  const selectStyle: React.CSSProperties = {
    background: "var(--bg-secondary)", borderColor: "var(--border)",
    color: "var(--text-primary)", height: 40, borderRadius: 10,
    border: "1px solid var(--border)", padding: "0 12px", fontSize: 13, outline: "none",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.06em", color: "var(--text-secondary)", marginBottom: 4, display: "block",
  }

  return (
    <div className="min-h-screen space-y-5 p-4 md:p-6" style={{ background: "var(--bg-primary)" }}>
      {toast && <ToastNotification toast={toast} />}

      {/* Header */}
      <div className="fade-in">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
          Planejamento · Produção
        </p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>
              MPS — Planejamento Mestre de Produção
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Programação integrada de Envase (L1/L2), Fabrima e Liberação QA.
            </p>
            {rodadaSelecionada && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
                <CalendarDays size={14} style={{ color: "var(--text-secondary)" }} />
                <span style={{ color: "var(--text-secondary)" }}>Rodada ativa:</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {rodadaSelecionada.nome} — {MESES[(rodadaSelecionada.mes || 1) - 1]}/{rodadaSelecionada.ano} — V{rodadaSelecionada.versao}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-xl border px-4 py-3 text-xs" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1E40AF" }}>
          Para atualizar com o realizado: primeiro crie a próxima versão (V+1 ou V1 do próximo mês), depois importe o relatório Cogtive nessa nova versão.
        </div>
      </div>

      {/* Barra de ações */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col" style={{ minWidth: 260 }}>
            <span style={labelStyle}>Rodada</span>
            <select value={rodadaSelecionada?.id || ""} style={selectStyle}
              onChange={(e) => { const r = rodadas.find((r) => r.id === e.target.value) || null; setRodadaSelecionada(r) }}>
              <option value="">Selecionar rodada...</option>
              {rodadas.map((r) => (
                <option key={r.id} value={r.id}>{r.nome} — {MESES[(r.mes || 1) - 1]}/{r.ano} — V{r.versao}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>Arquivo MPS</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--bg-secondary)" }}>
              <Upload size={14} style={{ color: "var(--text-secondary)" }} />
              <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setArquivoMps(e.target.files?.[0] || null)} />
              <span style={{ color: arquivoMps ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {arquivoMps ? arquivoMps.name.slice(0, 20) + (arquivoMps.name.length > 20 ? "..." : "") : "Selecionar arquivo"}
              </span>
            </label>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <button onClick={handleImportarMps} disabled={!arquivoMps || !rodadaSelecionada || importando}
              className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: AZUL }}>
              <RefreshCw size={14} className={importando ? "animate-spin" : ""} />
              {importando ? "Processando..." : "Processar MPS"}
            </button>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>Relatório Cogtive</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--bg-secondary)" }}>
              <Upload size={14} style={{ color: "var(--text-secondary)" }} />
              <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setArquivoReal(e.target.files?.[0] || null)} />
              <span style={{ color: arquivoReal ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {arquivoReal ? arquivoReal.name.slice(0, 20) + (arquivoReal.name.length > 20 ? "..." : "") : "Selecionar relatório"}
              </span>
            </label>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <button onClick={handleImportarReal} disabled={!arquivoReal || !rodadaSelecionada || importandoReal}
              className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "#5B21B6" }}>
              <RefreshCw size={14} className={importandoReal ? "animate-spin" : ""} />
              {importandoReal ? "Aplicando..." : "Aplicar realizado"}
            </button>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>Versionar</span>
            <div className="flex gap-2">
              <button onClick={() => handleCopiarRodada(false)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                <Copy size={14} />
                V{(rodadaSelecionada?.versao || 0) + 1} (mesmo mês)
              </button>
              <button onClick={() => handleCopiarRodada(true)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                <CalendarDays size={14} />
                V1 do próximo mês
              </button>
            </div>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <div className="flex gap-2">
              {qtdEdicoes > 0 && (
                <button onClick={salvarAlteracoes} disabled={salvando}
                  className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "#16A34A" }}>
                  <Save size={14} />
                  {salvando ? "Salvando..." : `Salvar (${qtdEdicoes})`}
                </button>
              )}
              <button onClick={() => setModalNovaRodada(true)}
                className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white"
                style={{ background: AZUL }}>
                <Plus size={14} />
                Nova rodada
              </button>
              <button onClick={() => setModalExcluir(true)} disabled={!rodadaSelecionada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "#FECACA", background: "#FEF2F2", color: "#DC2626" }}>
                <Trash2 size={14} />
                Excluir
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: "var(--text-secondary)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Filtros da tabela</span>
          </div>
          <button type="button" onClick={limparFiltros}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            <Trash2 size={12} />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
          <div className="flex flex-col col-span-2">
            <label style={labelStyle}>Busca geral</label>
            <input value={filtros.busca} onChange={(e) => setFiltros((p) => ({ ...p, busca: e.target.value }))}
              placeholder="Lote, código, produto..."
              className="h-10 rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Linha</label>
            <select value={filtros.recurso} style={selectStyle}
              onChange={(e) => setFiltros((p) => ({ ...p, recurso: e.target.value || "L1", lote: "", codigo: "", produto: "" }))}>
              {RECURSOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Lote</label>
            <select value={filtros.lote} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, lote: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.lote.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Código</label>
            <select value={filtros.codigo} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, codigo: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.codigo.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Produto</label>
            <select value={filtros.produto} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, produto: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.produto.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Mês prod.</label>
            <select value={filtros.mesProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Ano prod.</label>
            <select value={filtros.anoProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Mês lib.</label>
            <select value={filtros.mesLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Ano lib.</label>
            <select value={filtros.anoLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — início</label>
            <select value={`${anoInicio}-${mesInicio}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoInicio(a); setMesInicio(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — fim</label>
            <select value={`${anoFim}-${mesFim}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoFim(a); setMesFim(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap gap-2">
        {(["detalhado", "consolidado"] as const).map((aba) => (
          <button key={aba} type="button" onClick={() => setAbaMps(aba)}
            className="rounded-xl border px-4 py-2 text-sm font-semibold transition"
            style={{
              background: abaMps === aba ? AZUL : "var(--bg-secondary)",
              color: abaMps === aba ? "#fff" : "var(--text-secondary)",
              borderColor: abaMps === aba ? AZUL : "var(--border)",
            }}>
            {aba === "detalhado" ? "MPS detalhado" : "Visão consolidada"}
          </button>
        ))}
      </div>

      {/* Aba consolidada */}
      {abaMps === "consolidado" && (
        <VisaoConsolidada
          rodadas={rodadasComparativo}
          etapasPorRodada={etapasPorRodada}
          rodadaAtual={rodadaSelecionada}
          mudancasRealizado={mudancasRealizado}
        />
      )}

      {/* Aba detalhada */}
      {abaMps === "detalhado" && (
        <>
          {/* Tabela Gantt */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 text-white" style={{ background: AZUL }}>
              <div>
                <h2 className="font-semibold">Programação — {recursoSelecionado}</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {recursoSelecionado === "FABRIMA" ? "Embalagem" : "Envase"}
                </p>
              </div>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>
                {loading ? "Carregando..." : `${etapasFiltradas.length} linhas`}
              </span>
            </div>

            <div style={{ maxHeight: 640, overflow: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 40 }}>
                  <tr>
                    <th colSpan={FROZEN_COLUMNS.length} style={{ background: "var(--bg-secondary)", height: 28, position: "sticky", left: 0, zIndex: 50, minWidth: FROZEN_COLUMNS_WIDTH, width: FROZEN_COLUMNS_WIDTH, borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
                    {SCROLL_COLUMNS.length > 0 && (
                      <th colSpan={SCROLL_COLUMNS.length} style={{ background: "var(--bg-secondary)", height: 28, minWidth: SCROLL_COLUMNS.reduce((t, c) => t + c.width, 0), borderBottom: "1px solid var(--border)" }} />
                    )}
                    {mesesAgrupados.map((m) => (
                      <th key={m.label} colSpan={m.span} style={{ background: AZUL, color: "#fff", padding: "6px 8px", textAlign: "center", fontSize: 11, fontWeight: 700, minWidth: m.span * 38, borderRight: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap" }}>
                        {m.label}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: AZUL }}>
                    {COLUMNS.map((col) => {
                      const fi = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
                      const frozen = fi >= 0
                      return (
                        <th key={col.key} rowSpan={2} style={{ position: frozen ? "sticky" : undefined, left: frozen ? getLeftOffset(fi, FROZEN_COLUMNS) : undefined, zIndex: frozen ? 50 : undefined, background: AZUL, color: "rgba(255,255,255,0.9)", padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width, fontSize: 10, fontWeight: 600, whiteSpace: "pre-line", borderRight: "1px solid rgba(255,255,255,0.1)" }}>
                          {col.label}
                        </th>
                      )
                    })}
                    {dias.map((d) => (
                      <th key={`d-${d.data}`} style={{ background: AZUL, color: "#fff", padding: "6px 2px", textAlign: "center", minWidth: 38, fontSize: 10, fontWeight: 600, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                        {d.dia}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: AZUL }}>
                    {dias.map((d) => {
                      const h = horasDiaMap.get(`${recursoSelecionado}|${d.data}`) || 0
                      return (
                        <th key={`h-${d.data}`} style={{ background: AZUL, color: "#6EE7B7", padding: "4px 2px", textAlign: "center", fontSize: 10, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                          {h > 0 ? fmt(h) : <span style={{ opacity: 0.3 }}>-</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody style={{ background: "var(--bg-secondary)" }}>
                  {etapasPagina.map((etapa) => (
                    <tr key={etapa.id} className="hover:bg-slate-50 transition-colors">
                      {COLUMNS.map((col) => {
                        const fi = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
                        const frozen = fi >= 0
                        const editado = !!etapa.id && !!edicoes[etapa.id]
                        return (
                          <td key={col.key} style={{ position: frozen ? "sticky" : undefined, left: frozen ? getLeftOffset(fi, FROZEN_COLUMNS) : undefined, zIndex: frozen ? 30 : undefined, background: editado ? "#FEFCE8" : "var(--bg-secondary)", padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width, borderBottom: "1px solid var(--border)", borderRight: frozen ? "1px solid var(--border)" : undefined, color: "var(--text-primary)", fontSize: 12 }}>
                            {col.key === "produto" ? (
                              <select value={etapa.descricao_produto || ""} onChange={(e) => aplicarEdicaoProduto(etapa, e.target.value)}
                                style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", fontSize: 12, outline: "none", color: "var(--text-primary)" }}>
                                {produtosUnicos.map((p) => <option key={p} value={p}>{p}</option>)}
                              </select>
                            ) : col.key === "meslib" ? (
                              <select
                                value={edicoes[etapa.id!]?.mes_liberacao ?? etapa.mes_liberacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), mes_liberacao: Number(e.target.value), mes_lib_manual: true } }))}
                                style={{ width: "100%", background: etapa.mes_lib_manual ? "rgba(234,179,8,0.08)" : "transparent", border: `1px solid ${etapa.mes_lib_manual ? "rgba(234,179,8,0.4)" : "transparent"}`, borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "pointer", fontWeight: etapa.mes_lib_manual ? 700 : undefined }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = etapa.mes_lib_manual ? "rgba(234,179,8,0.4)" : "transparent"}
                              >
                                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                              </select>
                            ) : col.key === "anolib" ? (
                              <input
                                type="number"
                                value={edicoes[etapa.id!]?.ano_liberacao ?? etapa.ano_liberacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), ano_liberacao: Number(e.target.value) } }))}
                                style={{ width: "100%", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "pointer" }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = "transparent"}
                              />
                            ) : col.key === "observacao" ? (
                              <input
                                type="text"
                                value={edicoes[etapa.id!]?.observacao ?? etapa.observacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), observacao: e.target.value } }))}
                                placeholder="comentário..."
                                style={{ width: "100%", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "text" }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = "transparent"}
                              />
                            ) : (col.render(etapa) || "")}
                          </td>
                        )
                      })}
                      {dias.map((d) => {
                        const key = `${recursoSelecionado}|${etapa.lote || ""}|${etapa.codigo_produto || ""}|${d.data}`
                        const h = alocacaoMap.get(key) || 0
                        return (
                          <td key={d.data} style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid rgba(0,0,0,0.04)", padding: "4px 2px", textAlign: "center", minWidth: 38, background: h > 0 ? "rgba(16,185,129,0.1)" : undefined }}>
                            {h > 0 ? <span style={{ fontWeight: 600, color: "#059669", fontSize: 11 }}>{fmt(h)}</span> : <span style={{ color: "#CBD5E1", fontSize: 11 }}>-</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <span>Página {paginaCorrigida} de {totalPaginas} · {etapasFiltradas.length} linhas</span>
              <div className="flex gap-2">
                <button disabled={paginaCorrigida <= 1} onClick={() => setPagina(paginaCorrigida - 1)}
                  className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>Anterior</button>
                <button disabled={paginaCorrigida >= totalPaginas} onClick={() => setPagina(paginaCorrigida + 1)}
                  className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>Próxima</button>
              </div>
            </div>
          </div>

          {/* Comparativo de liberação */}
          {rodadasComparativo.length > 0 && (
            <ComparativoLiberacao rodadas={rodadasComparativo} etapasPorRodada={etapasPorRodada} recursoFiltro={filtros.recurso} />
          )}

          {/* Mudanças do realizado */}
          {mudancasDoRecurso.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <p className="card-label mb-0.5">Realizado Cogtive</p>
                  <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Mudanças aplicadas — {recursoSelecionado}</h3>
                  <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Comparação entre data fim planejada e data fim real Cogtive.</p>
                </div>
                <span className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {mudancasDoRecurso.length} lote(s)
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-primary)" }}>
                      {["Lote", "Produto", "Fim anterior", "Fim Cogtive", "Impacto", "UN/H ant.", "UN/H nova", "Δ UN/H %", "Mês Lib.", "Motivo", "Ações"].map((h, i) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: i >= 2 && i <= 7 ? "center" : "left", fontWeight: 600, fontSize: 11, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mudancasDoRecurso.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }} className="hover:bg-slate-50">
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-primary)" }}>{m.lote || m.lote_real_cogtive || "-"}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>{m.descricao_produto || "-"}</div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{m.codigo_produto}</div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>{fmtData(m.data_fim_anterior)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{fmtData(m.data_fim_nova)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${classeImpacto(m.tipo_impacto)}`}>
                            {m.tipo_impacto === "atrasou" && <ArrowDown size={11} />}
                            {m.tipo_impacto === "antecipou" && <ArrowUp size={11} />}
                            {textoImpacto(m.tipo_impacto, m.impacto_dias)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>{fmt(m.un_hora_anterior)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{fmt(m.un_hora_nova)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }} className={classeDiferenca(m.delta_un_hora_pct)}>{fmtPct(m.delta_un_hora_pct)}</td>
                        {/* Mês Lib. editável */}
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <select
                            value={edicoesMudancas[idx]?.mes_liberacao ?? (m.mes_liberacao_novo || "")}
                            onChange={(e) => setEdicoesMudancas((prev) => ({ ...prev, [idx]: { ...prev[idx], mes_liberacao: Number(e.target.value) } }))}
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 11, color: "var(--text-primary)", outline: "none", width: 80 }}
                          >
                            {MESES.map((ml, mi) => (
                              <option key={mi + 1} value={mi + 1}>{ml}</option>
                            ))}
                          </select>
                        </td>
                        {/* Motivo editável */}
                        <td style={{ padding: "10px 14px", minWidth: 200 }}>
                          <input
                            type="text"
                            value={edicoesMudancas[idx]?.motivo ?? (m.motivo_provavel || "")}
                            onChange={(e) => setEdicoesMudancas((prev) => ({ ...prev, [idx]: { ...prev[idx], motivo: e.target.value } }))}
                            placeholder="não identificado"
                            style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none" }}
                          />
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            {edicoesMudancas[idx] && (
                              <button type="button" onClick={() => salvarEdicaoMudanca(idx, m)} disabled={salvandoMudanca === idx}
                                className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50"
                                style={{ borderColor: "#BBF7D0", background: "#F0FDF4", color: "#15803D", whiteSpace: "nowrap" }}>
                                {salvandoMudanca === idx ? "..." : "Salvar"}
                              </button>
                            )}
                            <button type="button" onClick={() => reverterMudancaRealizado(m)} disabled={salvando}
                              className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-secondary)", whiteSpace: "nowrap" }}>
                              Manter planejado
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <ModalNovaRodada open={modalNovaRodada} onClose={() => setModalNovaRodada(false)} onCriar={handleCriarRodada} rodadas={rodadas} />
      <ModalExcluir open={modalExcluir} rodada={rodadaSelecionada} onClose={() => setModalExcluir(false)} onConfirmar={confirmarExcluirRodada} excluindo={excluindoRodada} />
    </div>
  )
}
