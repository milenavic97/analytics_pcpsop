import { FormEvent, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  BarChart3,
  Boxes,
  Eye,
  EyeOff,
  LineChart,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  User,
} from "lucide-react"
import { supabase } from "../../lib/supabase"

const USUARIOS: Record<string, string> = {
  adminpcp: "milenavicente1@outlook.com",
}

const FEATURES = [
  {
    icon: ScanSearch,
    title: "Rastreamento de lotes",
  },
  {
    icon: LineChart,
    title: "Demanda vs disponibilidade",
  },
  {
    icon: Boxes,
    title: "Estoque, produção e planejamento",
  },
  {
    icon: ShieldCheck,
    title: "Autenticação em 2 fatores",
  },
]

export function LoginPage() {
  const [usuario, setUsuario] = useState("")
  const [senha, setSenha] = useState("")
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState("")
  const navigate = useNavigate()

  async function handleLogin(e: FormEvent) {
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
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[0.95fr_1.05fr]">
      <section className="relative hidden overflow-hidden bg-[#173A5E] px-12 py-14 text-white lg:flex lg:flex-col lg:justify-center xl:px-16">
        <div className="pointer-events-none absolute -left-32 bottom-[-180px] h-[460px] w-[460px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -left-20 bottom-[-130px] h-[360px] w-[360px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-8 top-8 grid grid-cols-5 gap-4 opacity-20">
          {Array.from({ length: 35 }).map((_, index) => (
            <span key={index} className="h-1.5 w-1.5 rounded-full bg-white" />
          ))}
        </div>
        <div className="pointer-events-none absolute right-[-220px] top-[-160px] h-[520px] w-[520px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-[-170px] top-[-110px] h-[420px] w-[420px] rounded-full border border-white/10" />

        <div className="relative z-10 max-w-[620px]">
          <h1 className="text-5xl font-black tracking-tight xl:text-6xl">
            Analytics PCP
          </h1>

          <p className="mt-5 max-w-[520px] text-xl font-medium leading-relaxed text-sky-100/85 xl:text-2xl">
            Plataforma de planejamento e controle da produção
          </p>

          <div className="mt-7 h-1 w-14 rounded-full bg-sky-300" />

          <div className="mt-14 space-y-6">
            {FEATURES.map((item) => {
              const Icon = item.icon

              return (
                <div key={item.title}>
                  <div className="flex items-center gap-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-white/10 shadow-[0_12px_30px_rgba(0,0,0,0.15)] backdrop-blur-sm">
                      <Icon
                        size={30}
                        strokeWidth={2.8}
                        className="text-white"
                      />
                    </div>

                    <p className="text-lg font-bold text-white">
                      {item.title}
                    </p>
                  </div>

                  <div className="ml-[84px] mt-5 h-px max-w-[430px] bg-white/12" />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[520px]">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#173A5E] shadow-lg shadow-[#173A5E]/20">
              <BarChart3 size={32} strokeWidth={2.8} className="text-white" />
            </div>

            <h2 className="text-3xl font-black tracking-tight text-slate-950">
              PCP - Analytics
            </h2>

            <p className="mt-3 text-base font-medium text-slate-500">
              Entre com seu login e senha
            </p>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-8"
          >
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="usuario"
                  className="mb-2 block text-sm font-bold text-slate-900"
                >
                  Usuário ou email
                </label>

                <div className="relative">
                  <User
                    size={21}
                    strokeWidth={2.6}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#173A5E]"
                  />

                  <input
                    id="usuario"
                    type="text"
                    placeholder="adminpcp"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/70 py-3.5 pl-12 pr-4 text-base font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#173A5E] focus:bg-white focus:ring-4 focus:ring-[#173A5E]/10"
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="senha"
                  className="mb-2 block text-sm font-bold text-slate-900"
                >
                  Senha
                </label>

                <div className="relative">
                  <LockKeyhole
                    size={21}
                    strokeWidth={2.6}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#173A5E]"
                  />

                  <input
                    id="senha"
                    type={mostrarSenha ? "text" : "password"}
                    placeholder="Digite sua senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/70 py-3.5 pl-12 pr-12 text-base font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#173A5E] focus:bg-white focus:ring-4 focus:ring-[#173A5E]/10"
                    required
                  />

                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-[#173A5E]"
                    aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {mostrarSenha ? (
                      <EyeOff size={21} strokeWidth={2.5} />
                    ) : (
                      <Eye size={21} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>

              {erro && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                  {erro}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full rounded-xl bg-[#173A5E] px-5 py-4 text-base font-bold text-white shadow-lg shadow-[#173A5E]/18 transition hover:bg-[#102B47] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-slate-400 lg:hidden">
            <ShieldCheck size={15} strokeWidth={2.6} />
            Plataforma de planejamento e controle da produção
          </div>
        </div>
      </main>
    </div>
  )
}