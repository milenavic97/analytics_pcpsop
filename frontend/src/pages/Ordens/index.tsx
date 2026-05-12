import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronUp, RefreshCw,
  CalendarDays, PackageCheck, PackageX, ClipboardList,
  X, Pencil, Save, Download, Plus, Filter, AlertOctagon,
} from "lucide-react"
import {
  getOpsMeses,
  getOpsViabilidade,
  atualizarRegistro,
  type OPResult,
  type ResumoViabilidade,
  type StatusOP,
} from "@/services/api"

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Gargalo = {
  codigo_comp: string
  descricao: string
  tp: string
  unidade: string
  necessario: number
  saldo_chegou: number
  saldo_chegou_98: number
  faltante: number
  status: "falta" | "quarentena"
}

type OPEditavel = OPResult & {
  id?: string
  mes_ref?: string
  anotacao?: string
  resumo_faltas?: string
  tempo_horas?: number | null
  un_h?: number | null
  observacoes?: string | null
  data_lavagem_emb?: string | null
  data_lavagem_pesagem?: string | null
  data_inicio_fabricacao?: string | null
  data_termino?: string | null
  fifo_posicao?: number | null
  gargalo?: Gargalo | null
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TABLE_HEADER_BG = "var(--bg-sidebar)"
const GRID_COLOR = "#E2E8F0"
const PRODUTO_COL_MIN = 80
const PRODUTO_COL_MAX = 600
const PRODUTO_COL_DEFAULT = 160

const LINHA_LABEL: Record<string, string> = {
  ENVASE_L1: "Envase L1",
  ENVASE_L2: "Envase L2",
  EMBALAGEM: "Embalagem",
}

const STATUS_CONFIG: Record<StatusOP, {
  label: string; bg: string; border: string; text: string
  icon: React.ElementType; dot: string
}> = {
  aberta:     { label: "OP Aberta",  bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8", icon: Clock,         dot: "#3B82F6" },
  ok:         { label: "OK",         bg: "#F0FDF4", border: "#BBF7D0", text: "#166534", icon: CheckCircle2,  dot: "#16A34A" },
  quarentena: { label: "Quarentena", bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", icon: AlertTriangle, dot: "#F59E0B" },
  falta:      { label: "Falta Mat.", bg: "#FEF2F2", border: "#FECACA", text: "#991B1B", icon: XCircle,       dot: "#DC2626" },
  sem_bom:    { label: "Sem BOM",    bg: "#F5F3FF", border: "#DDD6FE", text: "#5B21B6", icon: AlertTriangle, dot: "#7C3AED" },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (!isFinite(v)) return "—"
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v)
}

function mesLabel(mesRef: string): string {
  if (!mesRef) return ""
  const [ano, mes] = mesRef.split("-").map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
}

function fmtData(iso: string | null | undefined) {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.split("-").map(Number)
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR")
}

function tipoProduto(linha: string) {
  return linha === "EMBALAGEM" ? "PA" : "PI"
}

function normalizarTexto(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function isTubete(item: Partial<Gargalo> | Record<string, unknown> | null | undefined) {
  if (!item) return false
  const codigo = normalizarTexto((item as Record<string, unknown>).codigo_comp)
  const descricao = normalizarTexto((item as Record<string, unknown>).descricao)
  const tp = normalizarTexto((item as Record<string, unknown>).tp)
  return codigo.includes("tubet") || descricao.includes("tubet") || tp.includes("tubet")
}

function toNumber(value: unknown) {
  const n = Number(value ?? 0)
  return isFinite(n) ? n : 0
}

function alertaToGargalo(comp: Record<string, unknown>): Gargalo {
  const necessario = toNumber(comp.necessario)
  const saldoChegou = toNumber(comp.saldo_chegou ?? comp.saldo_01 ?? comp.saldo_atual)
  const saldo98 = toNumber(comp.saldo_chegou_98 ?? comp.saldo_98)
  const faltante = toNumber(comp.faltante ?? Math.max(0, necessario - saldoChegou))
  return {
    codigo_comp: String(comp.codigo_comp ?? ""),
    descricao: String(comp.descricao ?? comp.codigo_comp ?? ""),
    tp: String(comp.tp ?? ""),
    unidade: String(comp.unidade ?? ""),
    necessario,
    saldo_chegou: saldoChegou,
    saldo_chegou_98: saldo98,
    faltante,
    status: comp.status === "quarentena" ? "quarentena" : "falta",
  }
}

function sanitizarOP(op: OPEditavel): OPEditavel {
  const alertasOriginais = Array.isArray(op.alertas) ? op.alertas : []
  const alertasMP = alertasOriginais.filter(comp => !isTubete(comp as unknown as Record<string, unknown>))
  const alertasCriticosMP = alertasMP.filter(comp => comp.status === "falta" || comp.status === "quarentena")

  let status = op.status
  if ((status === "falta" || status === "quarentena") && alertasCriticosMP.length === 0) {
    status = "ok"
  }

  let gargalo = op.gargalo && !isTubete(op.gargalo) ? op.gargalo : null
  if (!gargalo && alertasCriticosMP.length > 0) {
    gargalo = alertaToGargalo(alertasCriticosMP[0] as unknown as Record<string, unknown>)
  }

  return { ...op, status, alertas: alertasMP, gargalo }
}

function ordenarESequenciarOps(lista: OPEditavel[]) {
  const ordenadas = [...lista]
    .map((op, originalIndex) => ({ op, originalIndex }))
    .sort((a, b) => {
      const tipoA = tipoProduto(a.op.linha) === "PA" ? 0 : 1
      const tipoB = tipoProduto(b.op.linha) === "PA" ? 0 : 1
      if (tipoA !== tipoB) return tipoA - tipoB
      const fifoA = a.op.fifo_posicao ?? Number.MAX_SAFE_INTEGER
      const fifoB = b.op.fifo_posicao ?? Number.MAX_SAFE_INTEGER
      if (fifoA !== fifoB) return fifoA - fifoB
      const dataA = a.op.data_inicio_fabricacao || a.op.data_fim || "9999-12-31"
      const dataB = b.op.data_inicio_fabricacao || b.op.data_fim || "9999-12-31"
      if (dataA !== dataB) return dataA.localeCompare(dataB)
      return a.originalIndex - b.originalIndex
    })
    .map(({ op }) => op)

  let seqPA = 0
  let seqPI = 0
  return ordenadas.map(op => {
    const tipo = tipoProduto(op.linha)
    const fifo_posicao = tipo === "PA" ? ++seqPA : ++seqPI
    return { ...op, fifo_posicao }
  })
}

// ─── Hook: resize de coluna ───────────────────────────────────────────────────

function useProdutoColResize(defaultWidth = PRODUTO_COL_DEFAULT) {
  const [width, setWidth] = useState(defaultWidth)
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(defaultWidth)
  const [resizing, setResizing] = useState(false)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = width
    setResizing(true)
  }, [width])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const delta = e.clientX - startX.current
      const next = Math.min(PRODUTO_COL_MAX, Math.max(PRODUTO_COL_MIN, startWidth.current + delta))
      setWidth(next)
    }
    function onMouseUp() {
      if (!isResizing.current) return
      isResizing.current = false
      setResizing(false)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  return { produtoColWidth: width, handleResizeMouseDown, isResizing: resizing }
}

// ─── Componentes base ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusOP }) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  )
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative min-w-0 max-w-full"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && text && (
        <div className="absolute z-50 bottom-full left-0 mb-2 rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none"
          style={{ background: "var(--bg-sidebar)", color: "#fff", maxWidth: 300, whiteSpace: "normal" }}>
          {text}
          <div className="absolute top-full left-4 w-0 h-0"
            style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid var(--bg-sidebar)" }} />
        </div>
      )}
    </div>
  )
}

// ─── MultiSelect ─────────────────────────────────────────────────────────────

type SelectOption = { value: string; label: string }

function MultiSelect({
  label,
  values,
  options,
  placeholder,
  onChange,
}: {
  label: string
  values: string[]
  options: SelectOption[]
  placeholder: string
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const filteredOptions = options.filter(opt => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${opt.label} ${opt.value}`.toLowerCase().includes(q)
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function toggleValue(v: string) {
    if (values.includes(v)) {
      onChange(values.filter(x => x !== v))
    } else {
      onChange([...values, v])
    }
  }

  function clearAll() {
    onChange([])
    setSearch("")
  }

  // Texto do botão
  const buttonLabel = values.length === 0
    ? placeholder
    : values.length === 1
    ? (options.find(o => o.value === values[0])?.label ?? values[0])
    : `${values.length} selecionados`

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1.5 min-w-0">
      <label className="card-label">{label}</label>

      <button
        type="button"
        onClick={() => { setOpen(prev => !prev); setSearch("") }}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm outline-none transition-colors"
        style={{
          background: "var(--bg-secondary)",
          borderColor: open ? "var(--bg-sidebar)" : values.length > 0 ? "var(--bg-sidebar)" : "var(--border)",
          color: values.length > 0 ? "var(--text-primary)" : "#94A3B8",
          boxShadow: open ? "0 0 0 3px rgba(27,58,92,0.10)" : undefined,
        }}
      >
        <span className="truncate font-medium">{buttonLabel}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {values.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); clearAll() }}
              className="flex items-center justify-center w-4 h-4 rounded-full hover:opacity-70 transition-opacity"
              style={{ background: "var(--bg-sidebar)", color: "#fff", fontSize: 10, cursor: "pointer" }}
            >
              ×
            </span>
          )}
          <ChevronDown size={16} className="transition-transform"
            style={{ color: "var(--text-secondary)", transform: open ? "rotate(180deg)" : undefined }} />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar..."
              className="h-9 w-full rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
          </div>

          <div className="max-h-56 overflow-y-auto p-1">
            {/* Limpar tudo */}
            {values.length > 0 && (
              <button type="button" onClick={clearAll}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-slate-100"
                style={{ color: "#DC2626" }}>
                <X size={12} /> Limpar seleção ({values.length})
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                Nenhuma opção encontrada.
              </div>
            ) : filteredOptions.map(opt => {
              const active = values.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleValue(opt.value)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100"
                  style={{ color: active ? "var(--bg-sidebar)" : "var(--text-primary)" }}
                >
                  {/* Checkbox visual */}
                  <div className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all"
                    style={{
                      background: active ? "var(--bg-sidebar)" : "transparent",
                      borderColor: active ? "var(--bg-sidebar)" : "var(--border)",
                    }}>
                    {active && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SearchableSelect (só para Mês — seleção única) ───────────────────────────

function SearchableSelect({
  label, value, options, placeholder, onChange,
}: {
  label: string; value: string; options: SelectOption[]; placeholder: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find(opt => opt.value === value)

  const filteredOptions = options.filter(opt => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${opt.label} ${opt.value}`.toLowerCase().includes(q)
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1.5 min-w-0">
      <label className="card-label">{label}</label>
      <button type="button" onClick={() => { setOpen(prev => !prev); setSearch("") }}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm outline-none transition-colors"
        style={{
          background: "var(--bg-secondary)",
          borderColor: open ? "var(--bg-sidebar)" : "var(--border)",
          color: selected ? "var(--text-primary)" : "#94A3B8",
          boxShadow: open ? "0 0 0 3px rgba(27,58,92,0.10)" : undefined,
        }}>
        <span className="truncate">{selected?.label || placeholder}</span>
        <ChevronDown size={16} className="flex-shrink-0 transition-transform"
          style={{ color: "var(--text-secondary)", transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar..." className="h-9 w-full rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filteredOptions.map(opt => {
              const active = opt.value === value
              return (
                <button key={opt.value} type="button"
                  onClick={() => { onChange(opt.value); setSearch(""); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100"
                  style={{ color: active ? "var(--bg-sidebar)" : "var(--text-primary)" }}>
                  <span className="truncate">{opt.label}</span>
                  {active && <CheckCircle2 size={14} className="flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

function FilterPanel({
  meses, mesSel, linhasSel, statusesSel, tiposSel, lotesSel, codigosSel, produtosSel,
  loteOptions, codigoOptions, produtoOptions, tipoOptions,
  onMes, onLinhas, onStatuses, onTipos, onLotes, onCodigos, onProdutos,
}: {
  meses: string[]; mesSel: string
  linhasSel: string[]; statusesSel: string[]; tiposSel: string[]
  lotesSel: string[]; codigosSel: string[]; produtosSel: string[]
  loteOptions: SelectOption[]; codigoOptions: SelectOption[]
  produtoOptions: SelectOption[]; tipoOptions: SelectOption[]
  onMes: (v: string) => void
  onLinhas: (v: string[]) => void; onStatuses: (v: string[]) => void
  onTipos: (v: string[]) => void; onLotes: (v: string[]) => void
  onCodigos: (v: string[]) => void; onProdutos: (v: string[]) => void
}) {
  const mesOptions = meses.map(m => ({ value: m, label: mesLabel(m) }))
  const linhaOptions: SelectOption[] = [
    { value: "ENVASE_L1", label: "Envase L1" },
    { value: "ENVASE_L2", label: "Envase L2" },
    { value: "EMBALAGEM", label: "Embalagem" },
  ]
  const statusOptions: SelectOption[] = [
    { value: "aberta",     label: "OP Aberta" },
    { value: "ok",         label: "OK" },
    { value: "quarentena", label: "Quarentena" },
    { value: "falta",      label: "Falta Material" },
    { value: "sem_bom",    label: "Sem BOM" },
  ]

  return (
    <div className="card p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Filter size={14} style={{ color: "var(--text-secondary)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Filtros</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        <SearchableSelect label="Mês" value={mesSel} options={mesOptions} placeholder="Nenhum disponível" onChange={onMes} />
        <MultiSelect label="Linha"   values={linhasSel}   options={linhaOptions}   placeholder="Todas as linhas"   onChange={onLinhas} />
        <MultiSelect label="Status"  values={statusesSel} options={statusOptions}  placeholder="Todos os status"   onChange={onStatuses} />
        <MultiSelect label="Tipo"    values={tiposSel}    options={tipoOptions}    placeholder="Todos os tipos"    onChange={onTipos} />
        <MultiSelect label="Lote"    values={lotesSel}    options={loteOptions}    placeholder="Todos os lotes"    onChange={onLotes} />
        <MultiSelect label="Código"  values={codigosSel}  options={codigoOptions}  placeholder="Todos os códigos"  onChange={onCodigos} />
        <MultiSelect label="Produto" values={produtosSel} options={produtoOptions} placeholder="Todos os produtos" onChange={onProdutos} />
      </div>
    </div>
  )
}

// ─── Célula da tabela ─────────────────────────────────────────────────────────

function Td({ children, className = "", style = {}, onClick }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void
}) {
  return (
    <td className={`px-3 py-2.5 text-sm border-b ${className}`}
      style={{ borderColor: GRID_COLOR, ...style }} onClick={onClick}>
      {children}
    </td>
  )
}

// ─── Card de Gargalo ──────────────────────────────────────────────────────────

function GargaloCard({ gargalo, fifo_posicao }: { gargalo: Gargalo; fifo_posicao?: number | null }) {
  const isFalta = gargalo.status === "falta"
  const pctUsado = gargalo.necessario > 0
    ? Math.min(100, Math.round(((gargalo.necessario - gargalo.faltante) / gargalo.necessario) * 100))
    : 0

  return (
    <div className="rounded-xl p-4"
      style={{ background: isFalta ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${isFalta ? "#FECACA" : "#FDE68A"}` }}>
      <div className="flex items-start gap-3">
        <AlertOctagon size={16} className="flex-shrink-0 mt-0.5" style={{ color: isFalta ? "#DC2626" : "#F59E0B" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: isFalta ? "#991B1B" : "#92400E" }}>
              Gargalo FIFO{fifo_posicao ? ` · posição ${fifo_posicao}` : ""}
            </span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ background: isFalta ? "#FECACA" : "#FDE68A", color: isFalta ? "#7F1D1D" : "#78350F" }}>
              {gargalo.codigo_comp}
            </span>
          </div>
          <p className="text-sm font-semibold mb-3" style={{ color: isFalta ? "#7F1D1D" : "#78350F" }}>{gargalo.descricao}</p>
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1" style={{ color: isFalta ? "#991B1B" : "#92400E" }}>
              <span>Saldo que chegou nesta OP</span>
              <span className="font-semibold">{pctUsado}% do necessário</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: isFalta ? "#FECACA" : "#FDE68A" }}>
              <div className="h-full rounded-full" style={{ width: `${pctUsado}%`, background: isFalta ? "#DC2626" : "#F59E0B" }} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { label: "Necessário", value: gargalo.necessario, color: isFalta ? "#7F1D1D" : "#78350F" },
              { label: `Chegou${gargalo.saldo_chegou_98 > 0 ? " (arm. 01)" : ""}`, value: gargalo.saldo_chegou, color: gargalo.saldo_chegou > 0 ? "#16A34A" : "#DC2626" },
              { label: "Faltante", value: gargalo.faltante, color: isFalta ? "#DC2626" : "#F59E0B" },
            ].map(k => (
              <div key={k.label} className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.7)" }}>
                <p className="font-medium mb-0.5" style={{ color: isFalta ? "#991B1B" : "#92400E", opacity: 0.7 }}>{k.label}</p>
                <p className="font-bold" style={{ color: k.color }}>
                  {fmt(k.value)} <span style={{ fontWeight: 400, opacity: 0.7 }}>{gargalo.unidade}</span>
                </p>
              </div>
            ))}
          </div>
          {gargalo.saldo_chegou_98 > 0 && (
            <p className="mt-2 text-xs" style={{ color: "#92400E" }}>
              + {fmt(gargalo.saldo_chegou_98)} {gargalo.unidade} em quarentena (arm. 98) —
              {gargalo.status === "quarentena" ? " cobre com liberação do CQ" : " insuficiente mesmo com quarentena"}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal de edição ──────────────────────────────────────────────────────────

function EditModal({ op, onClose, onSaved, isNova = false }: {
  op: OPEditavel; onClose: () => void
  onSaved: (atualizado: Partial<OPEditavel>) => void; isNova?: boolean
}) {
  const [form, setForm] = useState({
    lote: op.lote || "", produto: op.produto || "", codigo: op.codigo || "",
    linha: op.linha || "", op_numero: op.op_numero || "",
    quantidade: String(op.quantidade || ""), tempo_horas: String(op.tempo_horas || ""),
    un_h: String(op.un_h || ""), observacoes: op.observacoes || "",
    data_lavagem_emb: op.data_lavagem_emb || "", data_lavagem_pesagem: op.data_lavagem_pesagem || "",
    data_inicio_fabricacao: op.data_inicio_fabricacao || "", data_fim: op.data_fim || "",
    data_termino: op.data_termino || "", anotacao: op.anotacao || "",
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState("")

  async function handleSave() {
    setSaving(true); setErro("")
    try {
      const payload: Record<string, unknown> = {
        lote: form.lote, produto: form.produto, codigo: form.codigo, linha: form.linha,
        op_numero: form.op_numero || null,
        quantidade: parseFloat(form.quantidade.replace(",", ".")) || 0,
        tempo_horas: form.tempo_horas ? parseFloat(form.tempo_horas.replace(",", ".")) : null,
        un_h: form.un_h ? parseFloat(form.un_h.replace(",", ".")) : null,
        observacoes: form.observacoes || null,
        data_lavagem_emb: form.data_lavagem_emb || null,
        data_lavagem_pesagem: form.data_lavagem_pesagem || null,
        data_inicio_fabricacao: form.data_inicio_fabricacao || null,
        data_fim: form.data_fim || null,
        data_termino: form.data_termino || null,
        anotacao: form.anotacao || null,
      }
      if (isNova) {
        const { inserirRegistro } = await import("@/services/api")
        await inserirRegistro("programacao_ops", { ...payload, mes_ref: op.mes_ref || "2026-00" })
      } else {
        if (!op.id) { setErro("ID da OP não encontrado."); setSaving(false); return }
        await atualizarRegistro("programacao_ops", op.id, payload)
      }
      onSaved({ ...payload, linha: form.linha as OPResult["linha"] } as Partial<OPEditavel>)
      onClose()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar")
    } finally { setSaving(false) }
  }

  const inp = "rounded-lg border px-3 py-2 text-sm outline-none w-full"
  const s = { background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }
  const isEnvase = form.linha !== "EMBALAGEM"

  return (
    <div className="fixed inset-0 z-[999] flex items-end md:items-center justify-center p-0 md:p-4"
      style={{ background: "rgba(15,23,42,0.55)" }} onClick={onClose}>
      <div className="w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", maxHeight: "92vh" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--bg-sidebar)" }}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>{isNova ? "Nova OP" : "Editar OP"}</p>
            <h3 className="text-base font-bold text-white">{isNova ? "Adicionar Ordem de Produção" : `${op.lote} · ${op.produto || op.codigo}`}</h3>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5" style={{ maxHeight: "calc(92vh - 140px)" }}>
          <div>
            <p className="card-label mb-3">Identificação</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5"><label className="card-label">Lote</label><input className={inp} style={s} value={form.lote} onChange={e => setForm(f => ({ ...f, lote: e.target.value }))} /></div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Código</label><input className={inp} style={s} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} /></div>
            </div>
            <div className="flex flex-col gap-1.5 mt-3"><label className="card-label">Produto</label><input className={inp} style={s} value={form.produto} onChange={e => setForm(f => ({ ...f, produto: e.target.value }))} /></div>
          </div>
          <div>
            <p className="card-label mb-3">Produção</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="flex flex-col gap-1.5"><label className="card-label">Linha</label>
                <select className={inp} style={s} value={form.linha} onChange={e => setForm(f => ({ ...f, linha: e.target.value }))}>
                  <option value="ENVASE_L1">Envase L1</option><option value="ENVASE_L2">Envase L2</option><option value="EMBALAGEM">Embalagem</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Nº OP</label><input className={inp} style={s} value={form.op_numero} placeholder="Ex: 90311" onChange={e => setForm(f => ({ ...f, op_numero: e.target.value }))} /></div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Quantidade</label><input type="number" className={inp} style={s} value={form.quantidade} onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))} /></div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Tempo (h)</label><input type="number" className={inp} style={s} value={form.tempo_horas} onChange={e => setForm(f => ({ ...f, tempo_horas: e.target.value }))} /></div>
            </div>
          </div>
          <div>
            <p className="card-label mb-3">Datas</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {isEnvase && (<>
                <div className="flex flex-col gap-1.5"><label className="card-label">Lav. Êmb e Lacre</label><input type="date" className={inp} style={s} value={form.data_lavagem_emb || ""} onChange={e => setForm(f => ({ ...f, data_lavagem_emb: e.target.value }))} /></div>
                <div className="flex flex-col gap-1.5"><label className="card-label">Lav. e Pesagem</label><input type="date" className={inp} style={s} value={form.data_lavagem_pesagem || ""} onChange={e => setForm(f => ({ ...f, data_lavagem_pesagem: e.target.value }))} /></div>
              </>)}
              <div className="flex flex-col gap-1.5"><label className="card-label">Início Fabricação</label><input type="date" className={inp} style={s} value={form.data_inicio_fabricacao || ""} onChange={e => setForm(f => ({ ...f, data_inicio_fabricacao: e.target.value }))} /></div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Data Fim</label><input type="date" className={inp} style={s} value={form.data_fim || ""} onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))} /></div>
              {isEnvase && <div className="flex flex-col gap-1.5"><label className="card-label">Término Real</label><input type="date" className={inp} style={s} value={form.data_termino || ""} onChange={e => setForm(f => ({ ...f, data_termino: e.target.value }))} /></div>}
            </div>
          </div>
          <div>
            <p className="card-label mb-3">Observações</p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5"><label className="card-label">Observação da planilha</label><input className={inp} style={s} value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} /></div>
              <div className="flex flex-col gap-1.5"><label className="card-label">Anotação interna</label><textarea className={inp} style={{ ...s, resize: "vertical", minHeight: 72 }} value={form.anotacao} placeholder="Anotações sobre esta OP..." onChange={e => setForm(f => ({ ...f, anotacao: e.target.value }))} /></div>
            </div>
          </div>
          {erro && <p className="text-sm" style={{ color: "#DC2626" }}>{erro}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} disabled={saving} className="rounded-xl border px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--bg-sidebar)", opacity: saving ? 0.7 : 1 }}>
            {isNova ? <><Plus size={14} /> {saving ? "Adicionando..." : "Adicionar"}</> : <><Save size={14} /> {saving ? "Salvando..." : "Salvar"}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal dos cards ──────────────────────────────────────────────────────────

type ModalTipo = "total" | "abertas" | "faltam" | "com_material" | "sem_material" | null

function CardModal({ tipo, ops, onClose }: { tipo: ModalTipo; ops: OPEditavel[]; onClose: () => void }) {
  if (!tipo) return null
  const LINHAS = ["ENVASE_L1", "ENVASE_L2", "EMBALAGEM"]
  function filtrar(linha: string) {
    const l = ops.filter(op => op.linha === linha)
    if (tipo === "total")        return l
    if (tipo === "abertas")      return l.filter(op => op.status === "aberta")
    if (tipo === "faltam")       return l.filter(op => op.status !== "aberta")
    if (tipo === "com_material") return l.filter(op => op.status === "ok")
    if (tipo === "sem_material") return l.filter(op => op.status === "falta" || op.status === "quarentena")
    return []
  }
  const TITULO: Record<NonNullable<ModalTipo>, string> = {
    total: "Total de OPs do mês", abertas: "OPs abertas no Protheus",
    faltam: "OPs que faltam abrir", com_material: "OPs com material disponível",
    sem_material: "OPs com material insuficiente",
  }
  const mat: Record<string, { descricao: string; count: number }> = {}
  if (tipo === "sem_material") {
    ops.filter(op => op.status === "falta" || op.status === "quarentena").forEach(op => {
      op.alertas.filter(a => a.status === "falta" || a.status === "quarentena").forEach(comp => {
        if (!mat[comp.codigo_comp]) mat[comp.codigo_comp] = { descricao: comp.descricao || comp.codigo_comp, count: 0 }
        mat[comp.codigo_comp].count++
      })
    })
  }
  const topMat = Object.entries(mat).sort((a, b) => b[1].count - a[1].count).slice(0, 8)

  return (
    <div className="fixed inset-0 z-[998] flex items-end md:items-center justify-center p-0 md:p-4"
      style={{ background: "rgba(15,23,42,0.5)" }} onClick={onClose}>
      <div className="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", maxHeight: "85vh" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div><p className="card-label mb-0.5">Detalhamento</p><h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{TITULO[tipo]}</h3></div>
          <button onClick={onClose} className="btn-ghost p-2"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(85vh - 80px)" }}>
          {LINHAS.map(linha => {
            const opsL = filtrar(linha)
            const total = ops.filter(op => op.linha === linha).length
            const pct = total > 0 ? Math.round((opsL.length / total) * 100) : 0
            return (
              <div key={linha} className="rounded-xl p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{LINHA_LABEL[linha]}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{opsL.length}</span>
                    {tipo !== "total" && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>de {total} · {pct}%</span>}
                  </div>
                </div>
                {tipo !== "total" && total > 0 && (
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tipo === "com_material" ? "#16A34A" : tipo === "sem_material" ? "#DC2626" : tipo === "abertas" ? "#2563EB" : "#6B7280" }} />
                  </div>
                )}
              </div>
            )
          })}
          {tipo === "sem_material" && topMat.length > 0 && (
            <div>
              <p className="card-label mb-3">Materiais mais críticos</p>
              <div className="space-y-2">
                {topMat.map(([codigo, info]) => (
                  <div key={codigo} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
                    <div className="min-w-0"><p className="text-xs font-mono" style={{ color: "#991B1B" }}>{codigo}</p><p className="text-xs truncate" style={{ color: "#7F1D1D" }}>{info.descricao}</p></div>
                    <span className="text-xs font-bold ml-3 flex-shrink-0" style={{ color: "#DC2626" }}>{info.count} OP{info.count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Cards de resumo ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color, Icon, onClick }: {
  label: string; value: number | string; sub?: string; color: string; Icon: React.ElementType; onClick?: () => void
}) {
  return (
    <button onClick={onClick} className="card flex flex-col gap-3 p-4 text-left w-full hover:shadow-md transition-all" style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="flex items-start justify-between gap-2">
        <span className="card-label leading-5">{label}</span>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: color + "18" }}>
          <Icon size={17} style={{ color }} />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color }}>{value}</p>
        {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
      {onClick && <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Clique para detalhes</p>}
    </button>
  )
}

// ─── Linha divisória FIFO ─────────────────────────────────────────────────────

function FifoDivider({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={15} style={{ padding: 0 }}>
        <div className="flex items-center gap-2 px-3 py-1.5"
          style={{ background: "#FEF2F2", borderTop: "2px dashed #FECACA", borderBottom: "1px solid #FECACA" }}>
          <AlertOctagon size={12} style={{ color: "#DC2626", flexShrink: 0 }} />
          <span className="text-xs font-semibold" style={{ color: "#991B1B" }}>{label}</span>
        </div>
      </td>
    </tr>
  )
}

// ─── Linha da tabela ──────────────────────────────────────────────────────────

function OPRow({ op, selecionado, onSelect, onEdit, produtoColWidth, mostrarDivisoria }: {
  op: OPEditavel; selecionado: boolean
  onSelect: (id: string, val: boolean) => void
  onEdit: (op: OPEditavel) => void
  produtoColWidth: number
  mostrarDivisoria: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const cfg = STATUS_CONFIG[op.status]
  const tipo = tipoProduto(op.linha)
  const rowId = op.id || `${op.lote}-${op.codigo}`
  const podeExpandir = op.status !== "aberta" || !!op.anotacao || !!op.observacoes
  const detalhesVisiveis = Array.isArray(op.detalhes)
    ? op.detalhes.filter(comp => !isTubete(comp as unknown as Record<string, unknown>))
    : []

  const rowBg = selecionado ? "rgba(27,58,92,0.10)" : aberto ? cfg.bg + "33" : undefined
  const gargaloLabel = op.gargalo
    ? `${op.gargalo.descricao} · chegou ${fmt(op.gargalo.saldo_chegou)} / necessário ${fmt(op.gargalo.necessario)} ${op.gargalo.unidade}`
    : undefined

  return (
    <>
      <tr style={{ background: rowBg }} className="hover:bg-slate-50 transition-colors cursor-pointer"
        onClick={() => podeExpandir && setAberto(!aberto)}>
        <td className="pl-3 py-2.5 w-8 border-b" style={{ borderColor: GRID_COLOR }} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selecionado} onChange={e => onSelect(rowId, e.target.checked)}
            style={{ accentColor: "var(--bg-sidebar)" }} className="rounded" />
        </td>
        <td className="px-2 py-2.5 w-5 border-b" style={{ borderColor: GRID_COLOR }}>
          <div className="w-2 h-2 rounded-full" style={{ background: cfg.dot }} />
        </td>
        <td className="px-2 py-2.5 w-8 border-b text-center" style={{ borderColor: GRID_COLOR }}>
          {op.fifo_posicao != null ? (
            <span className="text-[10px] font-mono font-bold"
              style={{ color: op.status === "ok" ? "#16A34A" : op.status === "falta" ? "#DC2626" : "var(--text-secondary)" }}>
              {op.fifo_posicao}
            </span>
          ) : <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>—</span>}
        </td>
        <Td className="w-28 font-semibold" style={{ color: "var(--text-primary)" }}>{op.lote}</Td>
        <Td style={{ width: produtoColWidth, minWidth: produtoColWidth, maxWidth: produtoColWidth, color: "var(--text-primary)" }}>
          <Tooltip text={op.produto || op.codigo}>
            <span className="block truncate text-sm">{op.produto || op.codigo}</span>
          </Tooltip>
        </Td>
        <Td className="hidden md:table-cell w-20 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{op.codigo}</Td>
        <Td className="hidden md:table-cell w-24" style={{ color: "var(--text-primary)" }}>{LINHA_LABEL[op.linha] || op.linha}</Td>
        <Td className="hidden md:table-cell w-14">
          <span className="inline-block rounded px-1.5 py-0.5 text-xs font-bold font-mono"
            style={{ background: tipo === "PA" ? "#F5F3FF" : "#EFF6FF", color: tipo === "PA" ? "#5B21B6" : "#1D4ED8" }}>
            {tipo}
          </span>
        </Td>
        <Td className="hidden lg:table-cell w-24 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{op.op_numero || "—"}</Td>
        <Td className="hidden lg:table-cell w-24 font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(op.quantidade)}</Td>
        <Td className="hidden xl:table-cell w-28 text-xs" style={{ color: "var(--text-secondary)" }}>{fmtData(op.data_lavagem_emb)}</Td>
        <Td className="hidden xl:table-cell w-28 text-xs" style={{ color: "var(--text-secondary)" }}>{fmtData(op.data_inicio_fabricacao)}</Td>
        <Td className="hidden lg:table-cell w-24 text-xs" style={{ color: "var(--text-secondary)" }}>{fmtData(op.data_fim)}</Td>
        <Td className="w-36">
          <Tooltip text={gargaloLabel || ""}><StatusBadge status={op.status} /></Tooltip>
        </Td>
        <td className="pr-3 py-2.5 w-16 border-b" style={{ borderColor: GRID_COLOR }}>
          <div className="flex items-center justify-end gap-1">
            {selecionado && (
              <button onClick={e => { e.stopPropagation(); onEdit(op) }}
                className="flex items-center justify-center h-7 w-7 rounded-lg transition-colors"
                style={{ background: "var(--bg-sidebar)", color: "#fff" }} title="Editar OP">
                <Pencil size={13} />
              </button>
            )}
            {podeExpandir && (
              <div style={{ color: "var(--text-secondary)" }}>
                {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </div>
            )}
          </div>
        </td>
      </tr>

      {mostrarDivisoria && (
        <FifoDivider label={op.gargalo ? `Gargalo da OP: ${op.gargalo.descricao} (${op.gargalo.codigo_comp})` : "Gargalo da OP identificado"} />
      )}

      {aberto && (
        <tr>
          <td colSpan={15} className="px-4 pb-4 pt-1">
            <div className="rounded-xl p-4 space-y-4" style={{ background: cfg.bg + "44", border: `1px solid ${cfg.border}` }}>
              {op.gargalo && <GargaloCard gargalo={op.gargalo} fifo_posicao={op.fifo_posicao} />}
              {((op as OPEditavel).observacoes || (op as OPEditavel).anotacao) && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {op.observacoes && <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}><p className="card-label mb-1">Observação</p><p className="text-sm" style={{ color: "var(--text-primary)" }}>{op.observacoes}</p></div>}
                  {op.anotacao && <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}><p className="card-label mb-1">Anotação interna</p><p className="text-sm" style={{ color: "var(--text-primary)" }}>{op.anotacao}</p></div>}
                </div>
              )}
              {op.linha !== "EMBALAGEM" && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-xs">
                  {[
                    { label: "Lav. Êmb e Lacre", val: op.data_lavagem_emb },
                    { label: "Lav. e Pesagem", val: op.data_lavagem_pesagem },
                    { label: "Início Fabricação", val: op.data_inicio_fabricacao },
                    { label: "Término Real", val: op.data_termino },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-lg px-3 py-2" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                      <p className="card-label mb-0.5">{label}</p>
                      <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>{fmtData(val)}</p>
                    </div>
                  ))}
                </div>
              )}
              {detalhesVisiveis.length > 0 && (
                <>
                  <p className="card-label">Componentes necessários</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[520px]">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["Código", "Descrição", "TP", "Necessário", "Saldo Atual", "Saldo Restante", "Saldo 98", "Status"].map(h => (
                            <th key={h} className="pb-2 pr-4 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)", fontSize: 10 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detalhesVisiveis.map((comp, i) => {
                          const compCfg = STATUS_CONFIG[comp.status as StatusOP] || STATUS_CONFIG.ok
                          const saldoRestante = Number((comp as { saldo_restante?: number }).saldo_restante ?? (comp.saldo_01 - comp.necessario))
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: comp.status !== "ok" ? compCfg.bg + "55" : undefined }}>
                              <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-secondary)" }}>{comp.codigo_comp}</td>
                              <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>{comp.descricao}</td>
                              <td className="py-2 pr-4"><span className="rounded px-1.5 py-0.5 font-mono font-bold" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", fontSize: 10 }}>{comp.tp}</span></td>
                              <td className="py-2 pr-4 font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(comp.necessario)}</td>
                              <td className="py-2 pr-4 font-semibold" style={{ color: comp.saldo_01 >= comp.necessario ? "#16A34A" : comp.saldo_01 > 0 ? "#F59E0B" : "#DC2626" }}>{fmt(comp.saldo_01)}</td>
                              <td className="py-2 pr-4 font-semibold" style={{ color: saldoRestante >= 0 ? "#16A34A" : "#DC2626" }}>{fmt(saldoRestante)}</td>
                              <td className="py-2 pr-4" style={{ color: comp.saldo_98 > 0 ? "#F59E0B" : "var(--text-secondary)", fontWeight: comp.saldo_98 > 0 ? 600 : 400 }}
                                title={comp.saldo_98 > 0 ? "Em quarentena — aguardando liberação do CQ" : undefined}>
                                {comp.saldo_98 > 0 ? `Quarentena: ${fmt(comp.saldo_98)}` : "—"}
                              </td>
                              <td className="py-2"><StatusBadge status={comp.status as StatusOP} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Tabela ───────────────────────────────────────────────────────────────────

function OPTable({ ops, selecionados, onSelect, onSelectAll, onEdit }: {
  ops: OPEditavel[]; selecionados: Set<string>
  onSelect: (id: string, val: boolean) => void
  onSelectAll: (val: boolean) => void
  onEdit: (op: OPEditavel) => void
}) {
  const todosSelect = ops.length > 0 && ops.every(op => selecionados.has(op.id || `${op.lote}-${op.codigo}`))
  const { produtoColWidth, handleResizeMouseDown, isResizing } = useProdutoColResize()

  const divisoriaSet = new Set<number>()
  const ctrl: Record<"PA" | "PI", { viuOk: boolean; mostrou: boolean }> = {
    PA: { viuOk: false, mostrou: false },
    PI: { viuOk: false, mostrou: false },
  }
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const tipo = tipoProduto(op.linha) as "PA" | "PI"
    if (op.status === "ok") { ctrl[tipo].viuOk = true; continue }
    if (!ctrl[tipo].mostrou && ctrl[tipo].viuOk && (op.status === "falta" || op.status === "quarentena") && op.fifo_posicao != null) {
      divisoriaSet.add(i)
      ctrl[tipo].mostrou = true
    }
  }

  const thCls = "px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
  const thStyle = { color: "rgba(255,255,255,0.85)" }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", cursor: isResizing ? "col-resize" : undefined }}>
      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="w-full min-w-[900px] border-separate border-spacing-0">
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr style={{ background: TABLE_HEADER_BG }}>
              <th className="pl-3 py-3 w-8">
                <input type="checkbox" checked={todosSelect} onChange={e => onSelectAll(e.target.checked)} style={{ accentColor: "#fff" }} className="rounded" />
              </th>
              <th className="w-5 py-3" />
              <th className="px-2 py-3 w-8 text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.65)" }} title="Posição na fila FIFO">#</th>
              <th className={`${thCls} w-28`} style={thStyle}>Lote</th>
              <th className={thCls} style={{ ...thStyle, width: produtoColWidth, minWidth: produtoColWidth, maxWidth: produtoColWidth, position: "relative", userSelect: "none" }}>
                Produto
                <span onMouseDown={handleResizeMouseDown} title="Arraste para redimensionar"
                  style={{ position: "absolute", right: 0, top: "20%", height: "60%", width: 6, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2, background: isResizing ? "rgba(255,255,255,0.5)" : "transparent", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (!isResizing) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.3)" }}
                  onMouseLeave={e => { if (!isResizing) (e.currentTarget as HTMLElement).style.background = "transparent" }}>
                  <svg width="6" height="14" viewBox="0 0 6 14" fill="none">
                    <line x1="2" y1="0" x2="2" y2="14" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
                    <line x1="4" y1="0" x2="4" y2="14" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
                  </svg>
                </span>
              </th>
              <th className={`${thCls} hidden md:table-cell w-20`} style={thStyle}>Código</th>
              <th className={`${thCls} hidden md:table-cell w-24`} style={thStyle}>Linha</th>
              <th className={`${thCls} hidden md:table-cell w-14`} style={thStyle}>Tipo</th>
              <th className={`${thCls} hidden lg:table-cell w-24`} style={thStyle}>OP</th>
              <th className={`${thCls} hidden lg:table-cell w-24`} style={thStyle}>Qtd.</th>
              <th className={`${thCls} hidden xl:table-cell w-28`} style={thStyle}>Lav. Êmb</th>
              <th className={`${thCls} hidden xl:table-cell w-28`} style={thStyle}>Início Fab.</th>
              <th className={`${thCls} hidden lg:table-cell w-24`} style={thStyle}>Data Fim</th>
              <th className={`${thCls} w-36`} style={thStyle}>Status</th>
              <th className="w-16 py-3 pr-3" />
            </tr>
          </thead>
          <tbody style={{ background: "var(--bg-secondary)" }}>
            {ops.map((op, i) => (
              <OPRow key={op.id || `${op.lote}-${op.codigo}-${i}`} op={op}
                selecionado={selecionados.has(op.id || `${op.lote}-${op.codigo}`)}
                onSelect={onSelect} onEdit={onEdit}
                produtoColWidth={produtoColWidth} mostrarDivisoria={divisoriaSet.has(i)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Export Excel ─────────────────────────────────────────────────────────────

function exportarExcel(ops: OPEditavel[], mesRef: string) {
  const headers = ["#FIFO", "Lote", "Produto", "Código", "Linha", "Tipo", "OP", "Qtd.", "Lav. Êmb", "Início Fab.", "Data Fim", "Status", "Gargalo", "Observação", "Anotação"]
  const rows = ops.map(op => [
    op.fifo_posicao ?? "", op.lote, op.produto || op.codigo, op.codigo,
    LINHA_LABEL[op.linha] || op.linha, tipoProduto(op.linha), op.op_numero || "", op.quantidade,
    fmtData(op.data_lavagem_emb), fmtData(op.data_inicio_fabricacao), fmtData(op.data_fim),
    STATUS_CONFIG[op.status]?.label || op.status,
    op.gargalo ? `${op.gargalo.descricao} (chegou ${op.gargalo.saldo_chegou} / necessário ${op.gargalo.necessario} ${op.gargalo.unidade})` : "",
    op.observacoes || "", op.anotacao || "",
  ])
  const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n")
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a"); a.href = url; a.download = `ops_${mesRef || "export"}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function OrdensPage() {
  const [meses, setMeses]                   = useState<string[]>([])
  const [mesSel, setMesSel]                 = useState<string>("")
  const [linhasSel, setLinhasSel]           = useState<string[]>([])
  const [statusesSel, setStatusesSel]       = useState<string[]>([])
  const [tiposSel, setTiposSel]             = useState<string[]>([])
  const [lotesSel, setLotesSel]             = useState<string[]>([])
  const [codigosSel, setCodigosSel]         = useState<string[]>([])
  const [produtosSel, setProdutosSel]       = useState<string[]>([])
  const [ops, setOps]                       = useState<OPEditavel[]>([])
  const [dados, setDados]                   = useState<ResumoViabilidade | null>(null)
  const [loading, setLoading]               = useState(false)
  const [erro, setErro]                     = useState("")
  const [modalCard, setModalCard]           = useState<ModalTipo>(null)
  const [opEditando, setOpEditando]         = useState<OPEditavel | null>(null)
  const [selecionados, setSelecionados]     = useState<Set<string>>(new Set())
  const [novaOpModal, setNovaOpModal]       = useState(false)

  useEffect(() => {
    getOpsMeses().then(res => {
      setMeses(res.meses)
      if (res.meses.length > 0) setMesSel(res.meses[0])
    }).catch(() => {})
  }, [])

  useEffect(() => { if (mesSel) buscar() }, [mesSel])

  const buscar = async () => {
    if (!mesSel) return
    setLoading(true); setErro(""); setSelecionados(new Set())
    try {
      const res = await getOpsViabilidade(mesSel)
      setDados(res)
      const opsTratadas = ordenarESequenciarOps(
        res.ops.map((op, i) => sanitizarOP({ ...op, id: (op as OPEditavel).id || `op-${i}` } as OPEditavel))
      )
      setOps(opsTratadas)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar OPs")
    } finally { setLoading(false) }
  }

  const totalMes    = ops.length
  const abertas     = ops.filter(op => op.status === "aberta").length
  const faltamAbrir = ops.filter(op => op.status !== "aberta").length
  const comMaterial = ops.filter(op => op.status === "ok").length
  const semMaterial = ops.filter(op => op.status === "falta" || op.status === "quarentena").length
  const pctAbertas  = totalMes > 0 ? Math.round((abertas / totalMes) * 100) : 0

  function uniqueOptions(values: Array<string | null | undefined>): SelectOption[] {
    return Array.from(new Set(values.map(v => String(v || "").trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
      .map(v => ({ value: v, label: v }))
  }

  const tipoOptions    = useMemo(() => uniqueOptions(ops.map(op => tipoProduto(op.linha))), [ops])
  const loteOptions    = useMemo(() => uniqueOptions(ops.map(op => op.lote)), [ops])
  const codigoOptions  = useMemo(() => uniqueOptions(ops.map(op => op.codigo)), [ops])
  const produtoOptions = useMemo(() => uniqueOptions(ops.map(op => op.produto || op.codigo)), [ops])

  const opsFiltradas = ops.filter(op => {
    if (linhasSel.length > 0 && !linhasSel.includes(op.linha)) return false
    if (statusesSel.length > 0 && !statusesSel.includes(op.status)) return false
    if (tiposSel.length > 0 && !tiposSel.includes(tipoProduto(op.linha))) return false
    if (lotesSel.length > 0 && !lotesSel.includes(op.lote)) return false
    if (codigosSel.length > 0 && !codigosSel.includes(op.codigo)) return false
    if (produtosSel.length > 0 && !produtosSel.includes(op.produto || op.codigo)) return false
    return true
  })

  function handleSelect(id: string, val: boolean) {
    setSelecionados(prev => { const n = new Set(prev); val ? n.add(id) : n.delete(id); return n })
  }

  function handleSelectAll(val: boolean) {
    setSelecionados(val ? new Set(opsFiltradas.map(op => op.id || `${op.lote}-${op.codigo}`)) : new Set())
  }

  function handleSaved(atualizado: Partial<OPEditavel>) {
    setOps(prev => ordenarESequenciarOps(prev.map(op =>
      op.id === opEditando?.id ? sanitizarOP({ ...op, ...atualizado } as OPEditavel) : op
    )))
  }

  return (
    <div className="min-h-screen space-y-5 p-3 md:space-y-6 md:p-6">
      <div className="fade-in flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Planejamento · Ordens de Produção</p>
          <h1 className="mb-1 text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>Verificação de OPs</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Confira quais OPs sem emissão têm material disponível para abertura no Protheus.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selecionados.size > 0 && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{selecionados.size} selecionada{selecionados.size !== 1 ? "s" : ""}</span>}
          {selecionados.size > 0 && (
            <button onClick={() => exportarExcel(opsFiltradas.filter(op => selecionados.has(op.id || `${op.lote}-${op.codigo}`)), mesSel)}
              className="flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold"
              style={{ background: "#F0FDF4", borderColor: "#BBF7D0", color: "#166534" }}>
              <Download size={14} /> Exportar ({selecionados.size})
            </button>
          )}
          <button onClick={() => exportarExcel(opsFiltradas, mesSel)} className="flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold" style={{ cursor: "pointer" }}>
            <Download size={14} /> Exportar tudo
          </button>
          <button onClick={() => setNovaOpModal(true)} className="flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold text-white" style={{ background: "var(--bg-sidebar)" }}>
            <Plus size={14} /> Nova OP
          </button>
          <button onClick={buscar} disabled={loading || !mesSel} className="flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold" style={{ cursor: loading ? "not-allowed" : "pointer" }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
        </div>
      </div>

      <FilterPanel
        meses={meses} mesSel={mesSel}
        linhasSel={linhasSel} statusesSel={statusesSel} tiposSel={tiposSel}
        lotesSel={lotesSel} codigosSel={codigosSel} produtosSel={produtosSel}
        loteOptions={loteOptions} codigoOptions={codigoOptions}
        produtoOptions={produtoOptions} tipoOptions={tipoOptions}
        onMes={setMesSel} onLinhas={setLinhasSel} onStatuses={setStatusesSel}
        onTipos={setTiposSel} onLotes={setLotesSel} onCodigos={setCodigosSel} onProdutos={setProdutosSel}
      />

      {dados && !loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 fade-in">
          <SummaryCard label="Total do mês"  value={totalMes}    sub="OPs programadas"              color="#6B7280" Icon={CalendarDays}  onClick={() => setModalCard("total")} />
          <SummaryCard label="OPs abertas"   value={abertas}     sub={`de ${totalMes} · ${pctAbertas}%`} color="#2563EB" Icon={ClipboardList} onClick={() => setModalCard("abertas")} />
          <SummaryCard label="Faltam abrir"  value={faltamAbrir} sub="sem OP emitida"               color="#F59E0B" Icon={Clock}         onClick={() => setModalCard("faltam")} />
          <SummaryCard label="Com material"  value={comMaterial} sub="prontas para abrir"           color="#16A34A" Icon={PackageCheck}  onClick={() => setModalCard("com_material")} />
          <SummaryCard label="Sem material"  value={semMaterial} sub="falta ou quarentena"          color="#DC2626" Icon={PackageX}      onClick={() => setModalCard("sem_material")} />
        </div>
      )}

      {loading && (
        <div className="card p-10 text-center text-sm fade-in" style={{ color: "var(--text-secondary)" }}>
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" style={{ opacity: 0.4 }} />
          Verificando estoque e BOM...
        </div>
      )}

      {!loading && erro && (
        <div className="card p-6 text-sm fade-in" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>
          <XCircle size={16} className="inline mr-2" />{erro}
        </div>
      )}

      {!loading && !erro && opsFiltradas.length > 0 && (
        <div className="fade-in space-y-2">
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {opsFiltradas.length} OP{opsFiltradas.length !== 1 ? "s" : ""} encontrada{opsFiltradas.length !== 1 ? "s" : ""}
          </p>
          <OPTable ops={opsFiltradas} selecionados={selecionados} onSelect={handleSelect} onSelectAll={handleSelectAll} onEdit={setOpEditando} />
        </div>
      )}

      {!loading && !erro && dados && opsFiltradas.length === 0 && (
        <div className="card p-10 text-center text-sm fade-in" style={{ color: "var(--text-secondary)" }}>Nenhuma OP encontrada para os filtros selecionados.</div>
      )}

      {!loading && !erro && !dados && !mesSel && (
        <div className="card p-10 text-center text-sm fade-in" style={{ color: "var(--text-secondary)" }}>Nenhuma programação carregada. Faça o upload da planilha de OPs na aba Dados.</div>
      )}

      <CardModal tipo={modalCard} ops={ops} onClose={() => setModalCard(null)} />

      {novaOpModal && (
        <EditModal
          op={{ id: undefined, mes_ref: mesSel, lote: "", produto: "", codigo: "", linha: "ENVASE_L1" as OPResult["linha"], op_numero: null, quantidade: 0, status: "ok" as StatusOP, alertas: [], detalhes: [], data_fim: null } as OPEditavel}
          onClose={() => setNovaOpModal(false)}
          onSaved={(novo) => {
            setOps(prev => ordenarESequenciarOps([...prev, sanitizarOP({ ...novo, id: `new-${Date.now()}`, status: "ok" as StatusOP, alertas: [], detalhes: [] } as OPEditavel)]))
            setNovaOpModal(false)
          }}
          isNova
        />
      )}

      {opEditando && (
        <EditModal op={opEditando}
          onClose={() => { setOpEditando(null); setSelecionados(new Set()) }}
          onSaved={handleSaved} />
      )}
    </div>
  )
}
