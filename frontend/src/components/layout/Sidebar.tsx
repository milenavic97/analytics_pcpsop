import { NavLink, useLocation } from "react-router-dom"
import { BarChart3 } from "lucide-react"
import { clsx } from "clsx"

import { APP_PAGES } from "@/config/pages"

type Props = {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: Props) {
  const { pathname } = useLocation()

  // Sidebar travada no modo compacto.
  // Não existe mais botão/estado de expansão, para manter o layout executivo sempre limpo.
  const collapsed = true

  // Mostra todas as páginas, sem filtro por permissão por enquanto
  const pages = APP_PAGES

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
          width: 64,
          minWidth: 64,
          maxWidth: 64,
          background: "var(--bg-sidebar)",
          color: "var(--text-sidebar)",
          borderRight: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          className="flex h-[66px] items-center justify-center border-b px-0"
          style={{ borderColor: "rgba(255,255,255,0.10)" }}
        >
          <BarChart3
            size={24}
            style={{ color: "var(--text-sidebar-active)" }}
          />
        </div>

        <nav className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
          {pages.map(({ id, label, path, icon: Icon }) => {
            const active =
              path === "/overview"
                ? pathname === "/overview" || pathname === "/"
                : pathname === path || pathname.startsWith(`${path}/`)

            return (
              <NavLink
                key={id}
                to={path}
                title={label}
                onClick={() => {
                  if (window.innerWidth < 768) onCloseMobile?.()
                }}
                className="group relative flex h-11 w-11 items-center justify-center rounded-lg text-sm font-medium transition-all duration-200"
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

                <div
                  className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ background: "var(--bg-sidebar-active)" }}
                >
                  {label}
                </div>
              </NavLink>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
