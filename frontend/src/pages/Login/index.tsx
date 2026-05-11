import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { BarChart3 } from "lucide-react"
import { supabase } from "../../lib/supabase"

const USUARIOS: Record<string, string> = {
  adminpcp: "milenavicente1@outlook.com",
}

export function LoginPage() {
  const [usuario, setUsuario] = useState("")
  const [senha, setSenha] = useState("")
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState("")
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErro("")
    setLoading(true)

    const usuarioNormalizado = usuario.trim().toLowerCase()
    const emailLogin = USUARIOS[usuarioNormalizado] || usuarioNormalizado

    const { error } = await supabase.auth.signInWithPassword({
      email: emailLogin,
      password: senha,
    })

    setLoading(false)

    if (error) {
      setErro("Usuário ou senha inválidos.")
      return
    }

    navigate("/overview", { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1B3A5C] shadow-sm">
            <BarChart3 size={28} className="text-white" />
          </div>

          <h1 className="text-2xl font-bold text-slate-950">
            PCP - Analytics
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Entre com seu login e senha
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 sm:p-7"
        >
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-900">
                Usuário ou email
              </label>
              <input
                type="text"
                placeholder="adminpcp"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-900">
                Senha
              </label>
              <input
                type="password"
                placeholder="Digite sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20"
                required
              />
            </div>

            {erro && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#1B3A5C] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#142B45] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
