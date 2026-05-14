import { useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  LayoutDashboard,
  Factory,
  Database,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  ClipboardList,
  CalendarDays,
  GitBranch,
} from "lucide-react"
import { clsx } from "clsx"

const NAV = [
  {
    id: "overview",
    label: "Overview",
    path: "/",
    Icon: LayoutDashboard,
  },
  {
    id: "producao",
    label: "Produção",
    path: "/producao",
    Icon: Factory,
  },
  {
    id: "ordens",
    label: "Ordens de Produção",
    path: "/ordens",
    Icon: ClipboardList,
  },
  {
    id: "mrp",
    label: "MRP",
    path: "/mrp",
    Icon: GitBranch,
  },
  {
    id: "calendario-paradas",
    label: "Calendário de Paradas",
    path: "/calendario-paradas",
    Icon: CalendarDays,
  },
  {
    id: "dados",
    label: "Dados",
    path: "/dados",
    Icon: Database,
  },
]

type Props = {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={clsx(
          "fixed left-0 top-0 z-50 flex h-screen flex-shrink-0 flex-col transition-all duration-300 md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          width: collapsed ? 64 : 256,
          background: "var(--bg-sidebar)",
          color: "var(--text-sidebar)",
          borderRight: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Logo */}
        <div
          className={clsx(
            "flex h-[66px] items-center border-b",
            collapsed ? "justify-center px-0" : "justify-between px-4"
          )}
          style={{ borderColor: "rgba(255,255,255,0.10)" }}
        >
          <div
            className={clsx(
              "flex items-center",
              collapsed ? "justify-center" : "gap-3"
            )}
          >
            <BarChart3
              size={24}
              style={{ color: "var(--text-sidebar-active)" }}
            />

            {!collapsed && (
              <div className="leading-tight">
                <p
                  className="text-[17px] font-bold leading-tight"
                  style={{ color: "var(--text-sidebar-active)" }}
                >
                  PCP - Analytics
                </p>

                <p
                  className="mt-0.5 text-[11px]"
                  style={{ color: "var(--text-sidebar)" }}
                >
                  Dashboard Operacional
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10"
              style={{ color: "var(--text-sidebar)" }}
              aria-label="Recolher menu"
            >
              <ChevronLeft size={18} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav
          className={clsx(
            "flex flex-1 flex-col gap-1 px-2 py-3",
            collapsed && "items-center"
          )}
        >
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="group relative flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-white/10"
              style={{ color: "var(--text-sidebar)" }}
              aria-label="Expandir menu"
            >
              <ChevronRight size={19} />

              <div
                className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{ background: "var(--bg-sidebar-active)" }}
              >
                Expandir menu
              </div>
            </button>
          )}

          {NAV.map(({ id, label, path, Icon }) => {
            const active =
              path === "/"
                ? pathname === "/"
                : pathname.startsWith(path)

            return (
              <NavLink
                key={id}
                to={path}
                title={collapsed ? label : undefined}
                onClick={() => {
                  if (window.innerWidth < 768) onCloseMobile?.()
                }}
                className={clsx(
                  "group relative flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                  collapsed
                    ? "h-11 w-11 justify-center"
                    : "h-12 gap-3 px-3"
                )}
                style={{
                  background: active
                    ? "rgba(255,255,255,0.14)"
                    : "transparent",

                  color: active
                    ? "var(--text-sidebar-active)"
                    : "var(--text-sidebar)",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    ;(e.currentTarget as HTMLElement).style.background =
                      "rgba(255,255,255,0.08)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    ;(e.currentTarget as HTMLElement).style.background =
                      "transparent"
                  }
                }}
              >
                <Icon size={20} className="flex-shrink-0" />

                {!collapsed && (
                  <span className="truncate">
                    {label}
                  </span>
                )}

                {collapsed && (
                  <div
                    className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    style={{ background: "var(--bg-sidebar-active)" }}
                  >
                    {label}
                  </div>
                )}
              </NavLink>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
