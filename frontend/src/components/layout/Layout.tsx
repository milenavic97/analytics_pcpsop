import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Moon, Sun, LogOut, User } from "lucide-react"
import { supabase } from "../../lib/supabase"

export function Layout() {
  const [dark, setDark] = useState(false)
  const [nome, setNome] = useState("")
  const navigate = useNavigate()

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light")
  }

  // 🔹 pega usuário logado
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

  // 🔹 logout real
  async function handleLogout() {
    await supabase.auth.signOut()
    navigate("/login")
  }

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header
          className="flex items-center justify-end gap-2 px-6 py-3 flex-shrink-0"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <button
            onClick={toggleTheme}
            className="btn-ghost p-2"
            title={dark ? "Modo claro" : "Modo escuro"}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
              <User size={14} className="text-white" />
            </div>

            <span
              className="text-sm font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {nome}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="btn-ghost p-2"
            title="Sair"
          >
            <LogOut size={16} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}