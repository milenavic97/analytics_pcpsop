import { useState, useEffect, useRef } from "react"
import { useParams, NavLink } from "react-router-dom"
import {
  Upload, Download, CheckCircle, XCircle, Clock, AlertCircle,
  Package, CalendarCheck, TrendingUp, ShoppingCart,
  PackageCheck, Warehouse, Factory,
} from "lucide-react"
import { BASES } from "@/data/bases"
import { uploadBase, getUploadStatus, getDados, inserirRegistro, atualizarRegistro, excluirRegistros } from "@/services/api"
import { DataTable } from "@/components/ui/DataTable"
import { RowModal } from "@/components/ui/RowModal"

const ICON_MAP: Record<string, React.ElementType> = {
  Package, CalendarCheck, TrendingUp, ShoppingCart,
  PackageCheck, Warehouse, Factory,
}

type StatusLocal = { status: string; nome_arquivo?: string; total_registros?: number }

function StatusBadge({ status }: { status: string }) {
  if (status === "sucesso")     return <span className="badge-ok"><CheckCircle size={11} /> Atualizado</span>
  if (status === "erro")        return <span className="badge-erro"><XCircle size={11} /> Erro</span>
  if (status === "processando") return <span className="badge-warn"><Clock size={11} /> Processando</span>
  return <span className="badge-neutral"><AlertCircle size={11} /> Sem dados</span>
}

export function DadosPage() {
  const { baseId } = useParams<{ baseId: string }>()
  const base = baseId ? BASES.find(b => b.id === baseId) : null

  return (
    <div className="flex h-full" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex-shrink-0 py-4 px-2"
        style={{ width: 224, borderRight: "1px solid var(--border)", background: "var(--bg-secondary)" }}
      >
        <p className="card-label" style={{ padding: "0 12px", display: "block", marginBottom: 12 }}>
          Bases de dados
        </p>
        {BASES.map(b => {
          const Icon = ICON_MAP[b.icone] || Package
          const active = baseId === b.id
          return (
            <NavLink
              key={b.id}
              to={`/dados/${b.id}`}
              className="flex items-center gap-2 rounded-lg text-sm"
              style={{
                padding: "8px 12px", marginBottom: 2,
                background: active ? "#EFF6FF" : "transparent",
                color: active ? "#1D4ED8" : "var(--text-secondary)",
                fontWeight: active ? 500 : 400,
                textDecoration: "none",
                transition: "background 0.15s",
              }}
            >
              <Icon size={15} className="flex-shrink-0" />
              <span className="truncate">{b.label}</span>
            </NavLink>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!base ? (
          <div
            className="flex flex-col items-center justify-center text-sm"
            style={{ height: 256, color: "var(--text-secondary)" }}
          >
            <Package size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>Selecione uma base de dados no menu lateral</p>
          </div>
        ) : (
          <BaseDetail base={base} />
        )}
      </div>
    </div>
  )
}

function BaseDetail({ base }: { base: typeof BASES[0] }) {
  const [status, setStatus]           = useState<StatusLocal>({ status: "sem_dados" })
  const [uploading, setUploading]     = useState(false)
  const [resultado, setResultado]     = useState<{ total: number; erros: string[] } | null>(null)
  const [dados, setDados]             = useState<Record<string, unknown>[]>([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(1)
  const [loading, setLoading]         = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [linhaEditando, setLinhaEditando] = useState<Record<string, unknown> | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const Icon = ICON_MAP[base.icone] || Package

  useEffect(() => {
    setResultado(null)
    setPage(1)
    getUploadStatus(base.id)
      .then((s: unknown) => setStatus(s as StatusLocal))
      .catch(() => {})
    carregarDados(1)
  }, [base.id])

  const carregarDados = async (p: number) => {
    setLoading(true)
    try {
      const res = await getDados(base.id, p) as { data: Record<string, unknown>[]; total: number }
      setDados(res.data ?? [])
      setTotal(res.total ?? 0)
    } catch (_) {
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setResultado(null)
    try {
      const res = await uploadBase(base.id, file) as { total_inserido: number; erros: string[] }
      setResultado({ total: res.total_inserido, erros: res.erros ?? [] })
      setStatus({ status: res.erros?.length ? "erro" : "sucesso", nome_arquivo: file.name, total_registros: res.total_inserido })
      carregarDados(1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido"
      setResultado({ total: 0, erros: [msg] })
      setStatus({ status: "erro" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  const handleDelete = async (ids: string[]) => {
    if (!window.confirm(`Excluir ${ids.length} registro(s)?`)) return
    try {
      await excluirRegistros(base.id, ids)
      carregarDados(page)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao excluir")
    }
  }

  const handleSave = async (formData: Record<string, string>) => {
    try {
      if (linhaEditando) {
        const pk = String(linhaEditando.id ?? linhaEditando.cod_produto ?? "")
        await atualizarRegistro(base.id, pk, formData)
      } else {
        await inserirRegistro(base.id, formData)
      }
      carregarDados(page)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao salvar")
    }
  }

  const colunas = dados.length > 0
    ? Object.keys(dados[0]).filter(c => c !== "id" && c !== "created_at")
    : base.colunas

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={18} style={{ color: "var(--text-secondary)" }} />
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{base.label}</h1>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{base.descricao}</p>
      </div>

      {/* Card upload */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge status={status.status} />
              {status.nome_arquivo && (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{status.nome_arquivo}</span>
              )}
            </div>
            <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Colunas esperadas:</p>
            <div className="flex flex-wrap gap-1.5">
              {base.colunas.map(c => (
                <span key={c} className="badge-neutral" style={{ fontFamily: "monospace", fontSize: 10 }}>{c}</span>
              ))}
            </div>
            {status.total_registros != null && (
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
                Última carga: {status.total_registros.toLocaleString("pt-BR")} registros
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={`/templates/${base.template}`}
              download={base.template}
              className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                textDecoration: "none",
                background: "transparent",
              }}
            >
              <Download size={14} /> Template
            </a>
            <button
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 text-white font-medium"
              style={{
                background: uploading ? "#93C5FD" : "#2563EB",
                border: "none",
                cursor: uploading ? "not-allowed" : "pointer",
              }}
            >
              <Upload size={14} />
              {uploading ? "Processando..." : "Upload"}
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
          </div>
        </div>

        {resultado && (
          <div
            className="mt-4 p-3 rounded-lg text-sm"
            style={{
              background: resultado.erros.length ? "#FEF2F2" : "#F0FDF4",
              border: `1px solid ${resultado.erros.length ? "#FECACA" : "#BBF7D0"}`,
              color: resultado.erros.length ? "#991B1B" : "#166534",
            }}
          >
            {resultado.erros.length === 0 ? (
              <span className="flex items-center gap-2">
                <CheckCircle size={14} />
                {resultado.total.toLocaleString("pt-BR")} registros carregados com sucesso.
              </span>
            ) : (
              <div>
                <p className="flex items-center gap-2 mb-1"><XCircle size={14} /> {resultado.erros.length} erro(s) encontrado(s)</p>
                {resultado.erros.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-xs ml-5" style={{ opacity: 0.75 }}>• {e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabela */}
      <DataTable
        colunas={colunas}
        dados={dados}
        total={total}
        page={page}
        loading={loading}
        onPageChange={p => { setPage(p); carregarDados(p) }}
        onDelete={handleDelete}
        onEdit={row => { setLinhaEditando(row); setModalAberto(true) }}
        onAdd={() => { setLinhaEditando(undefined); setModalAberto(true) }}
      />

      {/* Modal */}
      <RowModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onSave={handleSave}
        colunas={colunas}
        dados={linhaEditando}
        titulo={linhaEditando ? "Editar registro" : "Adicionar registro"}
      />
    </div>
  )
}