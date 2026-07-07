import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { PCPChat } from "@/components/charts/PCPChat"
import { Moon, Sun, LogOut, User, Menu } from "lucide-react"
import { supabase } from "../../lib/supabase"

export function Layout() {
  const [dark, setDark] = useState(false)
  const [nome, setNome] = useState("")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light")
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  // Inicializa tema salvo
  useEffect(() => {
    const saved = localStorage.getItem("theme")
    if (saved === "dark") {
      setDark(true)
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.setAttribute("data-theme", "light")
    }
  }, [])

  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser()
      const nomeUser =
        data.user?.user_metadata?.name ||
        data.user?.email?.split("@")[0] ||
        "Usuário"
      setNome(nomeUser)
    }
    getUser()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate("/login")
  }

  return (
    <div
      className="flex h-[100dvh] overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex items-center justify-between md:justify-end gap-2 px-3 md:px-6 py-3 flex-shrink-0"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
              }}
            >
              <Menu size={18} />
            </button>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={toggleTheme}
              className="btn-ghost p-2"
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <div className="flex items-center gap-2 px-2 py-1.5 md:px-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
                <User size={14} className="text-white" />
              </div>
              <span
                className="hidden text-sm font-medium sm:block"
                style={{ color: "var(--text-primary)" }}
              >
                {nome}
              </span>
            </div>

            <button onClick={handleLogout} className="btn-ghost p-2" title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* Chat global — aparece em todas as páginas */}
      <PCPChat />
    </div>
  )
}
