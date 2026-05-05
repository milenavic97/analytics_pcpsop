import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { clsx } from "clsx"

interface Props {
  open:      boolean
  onClose:   () => void
  title:     string
  subtitle?: string
  children:  ReactNode
  size?:     "md" | "lg" | "xl"
}

export function Modal({ open, onClose, title, subtitle, children, size = "lg" }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    if (open) document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const sizeClass = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={clsx("w-full bg-navy-800 rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[85vh] fade-in", sizeClass)}>
        <div className="flex items-start justify-between p-6 border-b border-white/5">
          <div>
            <h2 className="font-display font-bold text-lg text-white">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 -mt-1 -mr-1"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}
