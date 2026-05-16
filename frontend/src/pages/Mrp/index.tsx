import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Copy,
  Download,
  Filter,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import {
  atualizarMrpEtapa,
  copiarMrpRodada,
  criarMrpRodada,
  excluirMrpRodada,
  getMrpAlocacoes,
  getMrpComparativoLiberacao,
  getMrpEtapas,
  getMrpMudancasRealizado,
  getMrpRodadas,
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

function fmt(value?: number | null) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
}

function fmtData(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

function fmtPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-"
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
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

function fmtSinal(value?: number | null) {
  const n = Number(value || 0)
  return `${n > 0 ? "+" : ""}${fmt(n)}`
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
]

const FROZEN_COLUMNS = COLUMNS.filter((c) => c.frozen)

// ─── Componente Toast ─────────────────────────────────────────────────────────

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
          {toast.tipo === "success" ? <CheckCircle2 size={18} style={{ color: "#16A34A" }} /> : <AlertCircle size={18} style={{ color: "#DC2626" }} />}
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
          <button disabled={salvando} onClick={async () => { setSalvando(true); await onCriar(nome, mes, ano, versao, observacao); setSalvando(false) }}
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

// ─── Comparativo de Liberação ─────────────────────────────────────────────────

function ComparativoLiberacao({ rodadas, etapasPorRodada, recursoFiltro }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  recursoFiltro?: string
}) {
  // Monta Jan → Dez baseado no ano das rodadas comparadas
  const mesesUnicos = useMemo(() => {
    const anoBase =
      rodadas.find((r) => r?.ano)?.ano ||
      new Date().getFullYear()

    return Array.from({ length: 12 }, (_, i) => {
      return `${anoBase}-${String(i + 1).padStart(2, "0")}`
    })
  }, [rodadas])

  // Para cada rodada e cada mês, soma qtd_planejada
  const dados = useMemo(() => {
    return rodadas.map((rodada) => {
      const etapasBase = etapasPorRodada[rodada.id || ""] || []
      const etapas = recursoFiltro
        ? etapasBase.filter((e) => String(e.recurso || "").toUpperCase() === String(recursoFiltro).toUpperCase())
        : etapasBase
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

  const thStyle: React.CSSProperties = {
    background: AZUL, color: "#fff",
    padding: "10px 14px", textAlign: "right" as const,
    fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    borderRight: "1px solid rgba(255,255,255,0.1)",
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-0.5">Comparativo de versões</p>
        <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          Liberação mensal — tubetes e caixas por versão
        </h3>
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
                return (
                  <th key={chave} style={thStyle}>
                    {MESES[Number(mes) - 1]}/{ano}
                  </th>
                )
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
                  {/* Linha tubetes */}
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
                          {anterior && dif !== 0 && (
                            <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {dif > 0 ? "+" : ""}{fmt(dif)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>
                      {fmt(total)}
                    </td>
                  </tr>
                  {/* Linha caixas */}
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
                          {anterior && dif !== 0 && (
                            <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {dif > 0 ? "+" : ""}{fmt(dif)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ padding: "6px 14px 10px", textAlign: "right", color: "var(--text-secondary)" }}>
                      {fmt(total / 500)}
                    </td>
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
  const [pagina, setPagina] = useState(1)
  const [mesInicio, setMesInicio] = useState(hoje.getMonth() + 1)
  const [anoInicio, setAnoInicio] = useState(hoje.getFullYear())
  const [mesFim, setMesFim] = useState(12)
  const [anoFim, setAnoFim] = useState(2026)
  const [filtros, setFiltros] = useState<Filtros>({
    busca: "", lote: "", codigo: "", produto: "",
    mesProducao: "", anoProducao: "", mesLiberacao: "", anoLiberacao: "", recurso: "L1",
  })

  // Para o comparativo: etapas de todas as rodadas do mesmo mês/ano
  const [etapasPorRodada, setEtapasPorRodada] = useState<Record<string, MrpEtapa[]>>({})

  function showToast(data: Toast, duration = 4000) {
    setToast(data)
    window.setTimeout(() => setToast(null), duration)
  }

  function limparFiltros() {
    setFiltros({
      busca: "",
      lote: "",
      codigo: "",
      produto: "",
      mesProducao: "",
      anoProducao: "",
      mesLiberacao: "",
      anoLiberacao: "",
      recurso: "L1",
    })
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

  // Carrega etapas de todas as rodadas do mesmo mês/ano para o comparativo
  async function carregarComparativo(rodadaReferencia: MrpRodada, todasRodadas: MrpRodada[]) {
    const mesmoMesAno = todasRodadas.filter(
      (r) => r.mes === rodadaReferencia.mes && r.ano === rodadaReferencia.ano
    ).sort((a, b) => (a.versao || 0) - (b.versao || 0))

    const mapa: Record<string, MrpEtapa[]> = {}
    await Promise.all(
      mesmoMesAno.map(async (r) => {
        if (!r.id) return
        try {
          const etapas = await getMrpEtapas(r.id)
          mapa[r.id] = etapas
        } catch (_) { mapa[r.id] = [] }
      })
    )
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
        tipo: "success", titulo: proximoMes ? "V1 do próximo mês criada" : "Nova versão criada",
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
      setEtapas((prev) => prev.map((e) => e.id && edicoes[e.id] ? { ...e, ...edicoes[e.id] } : e))
      setEdicoes({})
      showToast({ tipo: "success", titulo: "Salvo", mensagem: "Alterações salvas com sucesso." })
    } catch {
      showToast({ tipo: "error", titulo: "Erro ao salvar", mensagem: "Não foi possível salvar as alterações." })
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

  // Rodadas do mesmo mês/ano para o comparativo
  const rodadasComparativo = useMemo(() => {
    if (!rodadaSelecionada) return []
    return rodadas
      .filter((r) => r.mes === rodadaSelecionada.mes && r.ano === rodadaSelecionada.ano)
      .sort((a, b) => (a.versao || 0) - (b.versao || 0))
  }, [rodadas, rodadaSelecionada])

  const qtdEdicoes = Object.keys(edicoes).length

  const selectStyle: React.CSSProperties = {
    background: "var(--bg-secondary)", borderColor: "var(--border)",
    color: "var(--text-primary)", height: 40, borderRadius: 10,
    border: "1px solid var(--border)", padding: "0 12px", fontSize: 13, outline: "none",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const,
    letterSpacing: "0.06em", color: "var(--text-secondary)", marginBottom: 4, display: "block",
  }

  return (
    <div className="min-h-screen space-y-5 p-4 md:p-6" style={{ background: "var(--bg-primary)" }}>
      {toast && <ToastNotification toast={toast} />}

      {/* ── Header ── */}
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

        {/* Instrução */}
        <div className="mt-4 rounded-xl border px-4 py-3 text-xs"
          style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1E40AF" }}>
          Para atualizar com o realizado: primeiro crie a próxima versão (V+1 ou V1 do próximo mês), depois importe o relatório Cogtive nessa nova versão.
        </div>
      </div>

      {/* ── Barra de ações ── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">

          {/* Seletor de rodada */}
          <div className="flex flex-col" style={{ minWidth: 260 }}>
            <span style={labelStyle}>Rodada</span>
            <select value={rodadaSelecionada?.id || ""} style={selectStyle}
              onChange={(e) => {
                const r = rodadas.find((r) => r.id === e.target.value) || null
                setRodadaSelecionada(r)
              }}>
              <option value="">Selecionar rodada...</option>
              {rodadas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} — {MESES[(r.mes || 1) - 1]}/{r.ano} — V{r.versao}
                </option>
              ))}
            </select>
          </div>

          {/* Importar MPS */}
          <div className="flex flex-col">
            <span style={labelStyle}>Arquivo MPS</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-slate-50"
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

          {/* Importar real */}
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

          {/* Versões */}
          <div className="flex flex-col">
            <span style={labelStyle}>Versionar</span>
            <div className="flex gap-2">
              <button onClick={() => handleCopiarRodada(false)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                title="Cria nova versão dentro do mesmo mês">
                <Copy size={14} />
                V{(rodadaSelecionada?.versao || 0) + 1} (mesmo mês)
              </button>
              <button onClick={() => handleCopiarRodada(true)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                title="Cria V1 do próximo mês a partir desta rodada">
                <CalendarDays size={14} />
                V1 do próximo mês
              </button>
            </div>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          {/* Ações finais */}
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

      {/* ── Filtros ── */}
      <div className="card px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: "var(--text-secondary)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Filtros da tabela</span>
          </div>

          <button
            type="button"
            onClick={limparFiltros}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:border-red-200 hover:text-red-500"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-secondary)",
              background: "var(--bg-secondary)",
            }}
          >
            <Trash2 size={12} />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
          {/* Busca geral */}
          <div className="flex flex-col col-span-2">
            <label style={labelStyle}>Busca geral</label>
            <input value={filtros.busca} onChange={(e) => setFiltros((p) => ({ ...p, busca: e.target.value }))}
              placeholder="Lote, código, produto..."
              className="h-10 rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>

          {/* Recurso */}
          <div className="flex flex-col">
            <label style={labelStyle}>Linha</label>
            <select value={filtros.recurso} style={selectStyle}
              onChange={(e) => setFiltros((p) => ({ ...p, recurso: e.target.value || "L1", lote: "", codigo: "", produto: "" }))}>
              {RECURSOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Lote */}
          <div className="flex flex-col">
            <label style={labelStyle}>Lote</label>
            <select value={filtros.lote} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, lote: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.lote.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Código */}
          <div className="flex flex-col">
            <label style={labelStyle}>Código</label>
            <select value={filtros.codigo} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, codigo: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.codigo.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Produto */}
          <div className="flex flex-col">
            <label style={labelStyle}>Produto</label>
            <select value={filtros.produto} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, produto: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.produto.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Mês prod */}
          <div className="flex flex-col">
            <label style={labelStyle}>Mês prod.</label>
            <select value={filtros.mesProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Ano prod */}
          <div className="flex flex-col">
            <label style={labelStyle}>Ano prod.</label>
            <select value={filtros.anoProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Mês lib */}
          <div className="flex flex-col">
            <label style={labelStyle}>Mês lib.</label>
            <select value={filtros.mesLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Ano lib */}
          <div className="flex flex-col">
            <label style={labelStyle}>Ano lib.</label>
            <select value={filtros.anoLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Período início */}
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — início</label>
            <select value={`${anoInicio}-${mesInicio}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoInicio(a); setMesInicio(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {/* Período fim */}
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — fim</label>
            <select value={`${anoFim}-${mesFim}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoFim(a); setMesFim(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {/* Limpar filtros */}
</div>
      </div>

      {/* ── Tabela Gantt ── */}
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
              {/* Linha de meses */}
              <tr>
                <th colSpan={COLUMNS.length} style={{ background: "var(--bg-secondary)", height: 28, position: "sticky", left: 0, zIndex: 50, borderBottom: "1px solid var(--border)" }} />
                {mesesAgrupados.map((m) => (
                  <th key={m.label} colSpan={m.span}
                    style={{ background: AZUL, color: "#fff", padding: "6px 8px", textAlign: "center", fontSize: 11, fontWeight: 700, minWidth: m.span * 38, borderRight: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap" }}>
                    {m.label}
                  </th>
                ))}
              </tr>
              {/* Cabeçalho colunas fixas + dias */}
              <tr style={{ background: AZUL }}>
                {COLUMNS.map((col) => {
                  const fi = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
                  const frozen = fi >= 0
                  return (
                    <th key={col.key} rowSpan={2}
                      style={{
                        position: frozen ? "sticky" : undefined, left: frozen ? getLeftOffset(fi, FROZEN_COLUMNS) : undefined,
                        zIndex: frozen ? 50 : undefined, background: AZUL, color: "rgba(255,255,255,0.9)",
                        padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width,
                        fontSize: 10, fontWeight: 600, whiteSpace: "pre-line", borderRight: "1px solid rgba(255,255,255,0.1)",
                      }}>
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
              {/* Linha de horas disponíveis */}
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
                      <td key={col.key}
                        style={{
                          position: frozen ? "sticky" : undefined, left: frozen ? getLeftOffset(fi, FROZEN_COLUMNS) : undefined,
                          zIndex: frozen ? 30 : undefined, background: editado ? "#FEFCE8" : "var(--bg-secondary)",
                          padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width,
                          borderBottom: "1px solid var(--border)", borderRight: frozen ? "1px solid var(--border)" : undefined,
                          color: "var(--text-primary)", fontSize: 12,
                        }}>
                        {col.key === "produto" ? (
                          <select value={etapa.descricao_produto || ""} onChange={(e) => aplicarEdicaoProduto(etapa, e.target.value)}
                            style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", fontSize: 12, outline: "none", color: "var(--text-primary)" }}>
                            {produtosUnicos.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
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

        {/* Paginação */}
        <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          <span>Página {paginaCorrigida} de {totalPaginas} · {etapasFiltradas.length} linhas</span>
          <div className="flex gap-2">
            <button disabled={paginaCorrigida <= 1} onClick={() => setPagina(paginaCorrigida - 1)}
              className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              Anterior
            </button>
            <button disabled={paginaCorrigida >= totalPaginas} onClick={() => setPagina(paginaCorrigida + 1)}
              className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* ── Comparativo de liberação ── */}
      {rodadasComparativo.length > 0 && (
        <ComparativoLiberacao
          rodadas={rodadasComparativo}
          etapasPorRodada={etapasPorRodada}
          recursoFiltro={filtros.recurso}
        />
      )}

      {/* ── Mudanças do realizado ── */}
      {mudancasDoRecurso.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <p className="card-label mb-0.5">Realizado Cogtive</p>
              <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                Mudanças aplicadas — {recursoSelecionado}
              </h3>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                Comparação entre data fim planejada e data fim real Cogtive.
              </p>
            </div>
            <span className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              {mudancasDoRecurso.length} lote(s)
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  {["Lote", "Produto", "Fim anterior", "Fim Cogtive", "Impacto", "UN/H ant.", "UN/H nova", "Δ UN/H %", "Motivo"].map((h, i) => (
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
                    <td style={{ padding: "10px 14px", color: "var(--text-secondary)", maxWidth: 200 }}>{m.motivo_provavel || "não identificado"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modais ── */}
      <ModalNovaRodada
        open={modalNovaRodada}
        onClose={() => setModalNovaRodada(false)}
        onCriar={handleCriarRodada}
        rodadas={rodadas}
      />
      <ModalExcluir
        open={modalExcluir}
        rodada={rodadaSelecionada}
        onClose={() => setModalExcluir(false)}
        onConfirmar={confirmarExcluirRodada}
        excluindo={excluindoRodada}
      />
    </div>
  )
}
