import { useMemo } from "react"
import { NavLink, useLocation } from "react-router-dom"
import clsx from "clsx"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { APP_PAGES } from "@/config/pages"

type Props = {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: Props) {
  const { pathname } = useLocation()

  // REMOVIDO FILTRO DE PERMISSÃO
  const pages = APP_PAGES

  const activePage = useMemo(() => {
    return pages.find((page) => pathname.startsWith(page.path))
  }, [pathname, pages])

  return (
    <aside
      className={clsx(
        "flex h-screen flex-col border-r border-slate-800 bg-[#17375E] text-white transition-all duration-300",
        collapsed ? "w-[60px]" : "w-[260px]"
      )}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-4">
        {!collapsed && (
          <div>
            <h1 className="text-2xl font-bold leading-none">
              PCP - Analytics
            </h1>

            <p className="mt-1 text-xs text-slate-300">
              Dashboard Operacional
            </p>
          </div>
        )}

        <button
          onClick={onToggle}
          className="rounded-lg p-1 transition hover:bg-slate-700"
        >
          {collapsed ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronLeft size={18} />
          )}
        </button>
      </div>

      {/* MENU */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {pages.map((page) => {
          const Icon = page.icon

          const active =
            pathname === page.path ||
            pathname.startsWith(`${page.path}/`) ||
            activePage?.id === page.id

          return (
            <NavLink
              key={page.id}
              to={page.path}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all",
                active
                  ? "bg-white/15 text-white"
                  : "text-slate-200 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon size={20} />

              {!collapsed && (
                <span className="truncate">{page.label}</span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* FOOTER */}
      <div className="border-t border-slate-700 p-3">
        <div
          className={clsx(
            "flex items-center gap-3 rounded-xl bg-white/10 px-3 py-3 text-sm",
            collapsed && "justify-center"
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 font-semibold">
            P
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-medium">PCP Analytics</p>
              <p className="truncate text-xs text-slate-300">
                Dashboard operacional
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
