import { useState } from "react"
import { useNavigate } from "react-router-dom"
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

    navigate("/", { replace: true })
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--bg-primary)" }}
    >
      <form onSubmit={handleLogin} className="card p-8 w-full max-w-sm space-y-5">
        <div>
          <p className="card-label mb-2">DFL S&OP Dashboard</p>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Entrar
          </h1>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Usuário"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
            }}
            required
          />

          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
            }}
            required
          />
        </div>

        {erro && (
          <p className="text-sm" style={{ color: "#DC2626" }}>
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ background: "#2563EB", color: "#FFFFFF" }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  )
}