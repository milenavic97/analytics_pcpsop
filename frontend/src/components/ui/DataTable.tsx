import { useState } from "react"
import { Trash2, Pencil, Plus, ChevronLeft, ChevronRight } from "lucide-react"

interface DataTableProps {
  colunas:       string[]
  dados:         Record<string, unknown>[]
  total:         number
  page:          number
  loading:       boolean
  onPageChange:  (p: number) => void
  onDelete:      (ids: string[]) => void
  onEdit:        (row: Record<string, unknown>) => void
  onAdd:         () => void
}

function formatarValor(val: unknown): string {
  if (val == null) return "—"
  if (typeof val === "number") {
    return Number.isInteger(val)
      ? val.toLocaleString("pt-BR")
      : val.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }
  if (typeof val === "boolean") return val ? "Sim" : "Não"
  const str = String(val)
  return str.length > 45 ? str.slice(0, 45) + "…" : str
}

export function DataTable({
  colunas, dados, total, page, loading,
  onPageChange, onDelete, onEdit, onAdd,
}: DataTableProps) {
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const totalPaginas = Math.ceil(total / 50)
  const todosSelecionados = dados.length > 0 && selecionados.size === dados.length

  const toggleTodos = () => {
    if (todosSelecionados) setSelecionados(new Set())
    else setSelecionados(new Set(dados.map((_, i) => i)))
  }

  const toggleLinha = (i: number) => {
    const novo = new Set(selecionados)
    if (novo.has(i)) novo.delete(i)
    else novo.add(i)
    setSelecionados(novo)
  }

  const handleDelete = () => {
    const ids = Array.from(selecionados).map(i =>
      String(dados[i]?.id ?? dados[i]?.cod_produto ?? i)
    )
    onDelete(ids)
    setSelecionados(new Set())
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {total.toLocaleString("pt-BR")} registros
          </p>
          {selecionados.size > 0 && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "#EFF6FF", color: "#1D4ED8" }}
            >
              {selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selecionados.size > 0 && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
              style={{
                background: "#FEF2F2", color: "#DC2626",
                border: "1px solid #FECACA", cursor: "pointer",
              }}
            >
              <Trash2 size={13} />
              Excluir selecionados
            </button>
          )}
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white"
            style={{ background: "#2563EB", border: "none", cursor: "pointer" }}
          >
            <Plus size={13} />
            Adicionar
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#1B3A5C" }}>
              <th style={{ width: 44, padding: "11px 16px" }}>
                <input
                  type="checkbox"
                  checked={todosSelecionados}
                  onChange={toggleTodos}
                  style={{ cursor: "pointer", accentColor: "#60A5FA" }}
                />
              </th>
              {colunas.map(c => (
                <th
                  key={c}
                  style={{
                    textAlign: "left", padding: "11px 16px",
                    fontSize: 11, fontWeight: 600, color: "#CBD5E1",
                    textTransform: "uppercase", letterSpacing: "0.07em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </th>
              ))}
              <th style={{ width: 60, padding: "11px 16px" }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={colunas.length + 2}
                  style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}
                >
                  Carregando...
                </td>
              </tr>
            ) : dados.length === 0 ? (
              <tr>
                <td
                  colSpan={colunas.length + 2}
                  style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}
                >
                  Nenhum registro encontrado
                </td>
              </tr>
            ) : dados.map((row, i) => {
              const sel = selecionados.has(i)
              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: sel ? "#EFF6FF" : "transparent",
                    transition: "background 0.1s",
                  }}
                >
                  <td style={{ padding: "10px 16px", width: 44 }}>
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleLinha(i)}
                      style={{ cursor: "pointer", accentColor: "#2563EB" }}
                    />
                  </td>
                  {colunas.map(c => (
                    <td
                      key={c}
                      style={{
                        padding: "10px 16px",
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                      }}
                    >
                      {formatarValor(row[c])}
                    </td>
                  ))}
                  <td style={{ padding: "10px 16px", width: 60 }}>
                    <button
                      onClick={() => onEdit(row)}
                      title="Editar"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--text-secondary)", padding: 4,
                        borderRadius: 6, display: "flex", alignItems: "center",
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {total > 50 && (
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Página {page} de {totalPaginas}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              style={{
                background: "none", border: "none",
                cursor: page === 1 ? "not-allowed" : "pointer",
                color: "var(--text-secondary)", padding: 6,
                opacity: page === 1 ? 0.3 : 1, borderRadius: 6,
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => onPageChange(Math.min(totalPaginas, page + 1))}
              disabled={page >= totalPaginas}
              style={{
                background: "none", border: "none",
                cursor: page >= totalPaginas ? "not-allowed" : "pointer",
                color: "var(--text-secondary)", padding: 6,
                opacity: page >= totalPaginas ? 0.3 : 1, borderRadius: 6,
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}