import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, Save } from "lucide-react"

interface RowModalProps {
  open:    boolean
  onClose: () => void
  onSave:  (data: Record<string, string>) => Promise<void>
  colunas: string[]
  dados?:  Record<string, unknown>
  titulo:  string
}

export function RowModal({ open, onClose, onSave, colunas, dados, titulo }: RowModalProps) {
  const [form, setForm]         = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (open) {
      const inicial: Record<string, string> = {}
      colunas.forEach(c => { inicial[c] = dados ? String(dados[c] ?? "") : "" })
      setForm(inicial)
      // Bloqueia scroll do body
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [open, dados, colunas])

  if (!open) return null

  const handleSave = async () => {
    setSalvando(true)
    await onSave(form)
    setSalvando(false)
    onClose()
  }

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(4px)",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}
        >
          <h2 className="font-bold text-base" style={{ color: "var(--text-primary)", margin: 0 }}>
            {titulo}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, display: "flex" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {colunas.map(c => (
            <div key={c}>
              <label
                className="card-label"
                style={{ display: "block", marginBottom: 6 }}
              >
                {c}
              </label>
              <input
                type="text"
                value={form[c] || ""}
                onChange={e => setForm(f => ({ ...f, [c]: e.target.value }))}
                className="input-field"
                placeholder={`Digite ${c}`}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2"
          style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", flexShrink: 0 }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 14,
              background: "var(--bg-primary)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={salvando}
            className="flex items-center gap-2"
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500,
              background: salvando ? "#93C5FD" : "#2563EB",
              color: "white", border: "none",
              cursor: salvando ? "not-allowed" : "pointer",
            }}
          >
            <Save size={14} />
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}