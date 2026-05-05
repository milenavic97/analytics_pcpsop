import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { LayoutDashboard, Factory, Database, ChevronLeft, ChevronRight, Activity } from "lucide-react"
import { clsx } from "clsx"

const NAV = [
  { id: "overview", label: "Overview",  path: "/",         Icon: LayoutDashboard },
  { id: "producao", label: "Produção",  path: "/producao", Icon: Factory },
  { id: "dados",    label: "Dados",     path: "/dados",    Icon: Database },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()

  return (
    <aside
      className={clsx("sidebar relative flex flex-col h-screen flex-shrink-0", collapsed && "collapsed")}
      style={{ background: "var(--bg-sidebar)", borderRight: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 min-h-[64px]"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
          <Activity size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="font-bold text-sm text-white leading-tight">DFL S&OP</p>
            <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--text-sidebar)" }}>
              Dashboard Operacional
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map(({ id, label, path, Icon }) => {
          const active = path === "/" ? pathname === "/" : pathname.startsWith(path)
          return (
            <NavLink
              key={id}
              to={path}
              title={collapsed ? label : undefined}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 group relative",
              )}
              style={{
                background: active ? "var(--bg-sidebar-active)" : "transparent",
                color: active ? "var(--text-sidebar-active)" : "var(--text-sidebar)",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--bg-sidebar-hover)" }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent" }}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}

              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-300 rounded-r" />
              )}

              {collapsed && (
                <div
                  className="absolute left-full ml-2 px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50 text-xs text-white border border-white/10"
                  style={{ background: "var(--bg-sidebar-active)" }}
                >
                  {label}
                </div>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full flex items-center justify-center transition-colors z-10 shadow-md border border-white/10"
        style={{ background: "var(--bg-sidebar-hover)", color: "var(--text-sidebar)" }}
        aria-label={collapsed ? "Expandir" : "Recolher"}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  )
}