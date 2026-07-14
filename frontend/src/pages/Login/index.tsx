import { FormEvent, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  BarChart3,
  Boxes,
  Eye,
  EyeOff,
  LineChart,
  LockKeyhole,
  Search,
  ShieldCheck,
  User,
} from "lucide-react"
import { supabase } from "../../lib/supabase"

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL || "https://dfl-sop-api.fly.dev"

const AZUL_PCP = "#173A5E"

/**
 * Traduz o que a pessoa digitou (e-mail OU apelido de login, ex.:
 * "adminpcp") para o e-mail real usado no Supabase Auth.
 *
 * Antes disso, essa tradução era feita por um mapa fixo no código do
 * frontend (USUARIOS = { adminpcp: "..." }) -- problema porque o bundle
 * do frontend é público, então qualquer pessoa conseguia ler o e-mail
 * real de um usuário abrindo o JS da página no navegador.
 *
 * Agora a tradução é feita pelo backend, em POST /usuarios/resolver-login
 * (ver backend/app/routers/usuarios.py), que consulta a tabela
 * usuarios_app sem nunca expor esse dado no código-fonte público. Se o
 * texto digitado já parece um e-mail, nem precisa chamar a rota.
 */
async function resolverEmailLogin(usuarioDigitado: string): Promise<string> {
  if (usuarioDigitado.includes("@")) {
    return usuarioDigitado
  }

  try {
    const res = await fetch(`${API_URL}/usuarios/resolver-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: usuarioDigitado }),
    })

    if (!res.ok) {
      return usuarioDigitado
    }

    const data: { email: string | null } = await res.json()
    return data.email || usuarioDigitado
  } catch {
    // Backend fora do ar ou rede instável: cai para o texto digitado.
    // O Supabase vai rejeitar do mesmo jeito com "Usuário ou senha
    // inválidos", sem vazar se o backend estava fora do ar ou se o
    // usuário não existe.
    return usuarioDigitado
  }
}

const FEATURES = [
  {
    icon: Search,
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

  // Fluxo de "Esqueci minha senha": troca o formulário de login por um
  // formulário simples de recuperação, sem navegar pra outra rota.
  const [modo, setModo] = useState<"login" | "esqueci">("login")
  const [usuarioRecuperar, setUsuarioRecuperar] = useState("")
  const [enviandoRecuperacao, setEnviandoRecuperacao] = useState(false)
  const [recuperacaoEnviada, setRecuperacaoEnviada] = useState(false)
  const [erroRecuperacao, setErroRecuperacao] = useState("")

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setErro("")
    setLoading(true)

    const usuarioNormalizado = usuario.trim().toLowerCase()
    const emailLogin = await resolverEmailLogin(usuarioNormalizado)

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

  function abrirEsqueciSenha() {
    setErroRecuperacao("")
    setRecuperacaoEnviada(false)
    setUsuarioRecuperar(usuario)
    setModo("esqueci")
  }

  function voltarParaLogin() {
    setModo("login")
    setErroRecuperacao("")
    setRecuperacaoEnviada(false)
  }

  /**
   * Envia o e-mail de redefinição de senha via Supabase Auth. O link do
   * e-mail leva pra /redefinir-senha (ver pages/RedefinirSenha), onde a
   * pessoa escolhe a senha nova.
   *
   * Sempre mostra a mesma mensagem de sucesso, exista ou não a conta --
   * do contrário, essa tela viraria um jeito fácil de descobrir quais
   * apelidos/e-mails têm conta cadastrada (enumeração de usuário).
   */
  async function handleEsqueciSenha(e: FormEvent) {
    e.preventDefault()
    setErroRecuperacao("")
    setEnviandoRecuperacao(true)

    const digitado = usuarioRecuperar.trim().toLowerCase()
    const email = await resolverEmailLogin(digitado)

    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
    } catch {
      // Mesmo em erro de rede, segue pra mensagem de sucesso genérica --
      // ver comentário da função acima.
    }

    setEnviandoRecuperacao(false)
    setRecuperacaoEnviada(true)
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[0.95fr_1.05fr]">
      <section
        className="relative hidden overflow-hidden px-12 py-14 text-white lg:flex lg:flex-col lg:justify-center xl:px-16"
        style={{ background: AZUL_PCP }}
      >
        <div className="pointer-events-none absolute -left-32 bottom-[-180px] h-[460px] w-[460px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -left-20 bottom-[-130px] h-[360px] w-[360px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-8 top-8 grid grid-cols-5 gap-4 opacity-20">
          {Array.from({ length: 35 }).map((_, index) => (
            <span key={index} className="h-1.5 w-1.5 rounded-full bg-white" />
          ))}
        </div>
        <div className="pointer-events-none absolute right-[-220px] top-[-160px] h-[520px] w-[520px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-[-170px] top-[-110px] h-[420px] w-[420px] rounded-full border border-white/10" />

        <div className="relative z-10 max-w-[640px]">
          <h1 className="text-5xl font-black tracking-tight xl:text-6xl">
            Analytics PCP
          </h1>

          <p className="mt-5 max-w-[560px] text-xl font-semibold leading-relaxed text-white/90 xl:text-2xl">
            Plataforma de planejamento e controle da produção
          </p>

          <div className="mt-7 h-1 w-14 rounded-full bg-sky-300" />

          <div className="mt-14 space-y-6">
            {FEATURES.map((item) => {
              const Icon = item.icon

              return (
                <div key={item.title}>
                  <div className="flex items-center gap-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/35 bg-white/[0.16] shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-sm">
                      <Icon
                        size={30}
                        strokeWidth={3}
                        className="text-white"
                      />
                    </div>

                    <p className="text-lg font-bold text-white">
                      {item.title}
                    </p>
                  </div>

                  <div className="ml-[84px] mt-5 h-px max-w-[430px] bg-white/15" />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 sm:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(23,58,94,0.07),transparent_34%)]" />

        <div className="relative z-10 w-full max-w-[570px]">
          {modo === "login" ? (
            <form
              onSubmit={handleLogin}
              className="rounded-[30px] border border-slate-200 bg-white px-7 py-10 shadow-[0_28px_80px_rgba(15,23,42,0.10)] sm:px-10 sm:py-12"
            >
              <div className="mb-10 flex flex-col items-center text-center">
                <div
                  className="mb-7 flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg"
                  style={{
                    background: AZUL_PCP,
                    boxShadow: "0 18px 38px rgba(23, 58, 94, 0.24)",
                  }}
                >
                  <BarChart3 size={38} strokeWidth={3} className="text-white" />
                </div>

                <h1 className="text-3xl font-black tracking-tight text-slate-950">
                  PCP - Analytics
                </h1>

                <p className="mt-3 text-base font-medium text-slate-500">
                  Entre com seu login e senha
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="usuario"
                    className="mb-2.5 block text-sm font-bold text-slate-900"
                  >
                    Usuário ou email
                  </label>

                  <div className="relative">
                    <User
                      size={22}
                      strokeWidth={2.8}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                      style={{ color: AZUL_PCP }}
                    />

                    <input
                      id="usuario"
                      type="text"
                      placeholder="adminpcp"
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-4 pl-12 pr-4 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4"
                      style={
                        {
                          "--tw-ring-color": "rgba(23, 58, 94, 0.12)",
                        } as React.CSSProperties
                      }
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = AZUL_PCP
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = ""
                      }}
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <label
                      htmlFor="senha"
                      className="block text-sm font-bold text-slate-900"
                    >
                      Senha
                    </label>

                    <button
                      type="button"
                      onClick={abrirEsqueciSenha}
                      className="text-sm font-semibold hover:underline"
                      style={{ color: AZUL_PCP }}
                    >
                      Esqueci minha senha
                    </button>
                  </div>

                  <div className="relative">
                    <LockKeyhole
                      size={22}
                      strokeWidth={2.8}
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                      style={{ color: AZUL_PCP }}
                    />

                    <input
                      id="senha"
                      type={mostrarSenha ? "text" : "password"}
                      placeholder="Digite sua senha"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-4 pl-12 pr-12 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4"
                      style={
                        {
                          "--tw-ring-color": "rgba(23, 58, 94, 0.12)",
                        } as React.CSSProperties
                      }
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = AZUL_PCP
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = ""
                      }}
                      required
                    />

                    <button
                      type="button"
                      onClick={() => setMostrarSenha((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:bg-slate-100"
                      style={{ color: mostrarSenha ? AZUL_PCP : undefined }}
                      aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {mostrarSenha ? (
                        <EyeOff size={22} strokeWidth={2.6} />
                      ) : (
                        <Eye size={22} strokeWidth={2.6} />
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
                  className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    background: AZUL_PCP,
                    boxShadow: "0 18px 32px rgba(23, 58, 94, 0.22)",
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.background = "#102B47"
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) e.currentTarget.style.background = AZUL_PCP
                  }}
                >
                  {loading ? "Entrando..." : "Entrar"}
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={handleEsqueciSenha}
              className="rounded-[30px] border border-slate-200 bg-white px-7 py-10 shadow-[0_28px_80px_rgba(15,23,42,0.10)] sm:px-10 sm:py-12"
            >
              <div className="mb-10 flex flex-col items-center text-center">
                <div
                  className="mb-7 flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg"
                  style={{
                    background: AZUL_PCP,
                    boxShadow: "0 18px 38px rgba(23, 58, 94, 0.24)",
                  }}
                >
                  <LockKeyhole size={36} strokeWidth={3} className="text-white" />
                </div>

                <h1 className="text-3xl font-black tracking-tight text-slate-950">
                  Recuperar senha
                </h1>

                <p className="mt-3 text-base font-medium text-slate-500">
                  {recuperacaoEnviada
                    ? "Confira seu e-mail em alguns instantes."
                    : "Digite seu usuário ou e-mail para receber o link."}
                </p>
              </div>

              {recuperacaoEnviada ? (
                <div className="space-y-6">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                    Se esse usuário ou e-mail tiver uma conta cadastrada, um
                    link para redefinir a senha foi enviado. O link é válido
                    por um tempo limitado.
                  </div>

                  <button
                    type="button"
                    onClick={voltarParaLogin}
                    className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition"
                    style={{ background: AZUL_PCP }}
                  >
                    Voltar para o login
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <label
                      htmlFor="usuarioRecuperar"
                      className="mb-2.5 block text-sm font-bold text-slate-900"
                    >
                      Usuário ou email
                    </label>

                    <div className="relative">
                      <User
                        size={22}
                        strokeWidth={2.8}
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                        style={{ color: AZUL_PCP }}
                      />

                      <input
                        id="usuarioRecuperar"
                        type="text"
                        placeholder="adminpcp"
                        value={usuarioRecuperar}
                        onChange={(e) => setUsuarioRecuperar(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-4 pl-12 pr-4 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4"
                        style={
                          {
                            "--tw-ring-color": "rgba(23, 58, 94, 0.12)",
                          } as React.CSSProperties
                        }
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = AZUL_PCP
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = ""
                        }}
                        autoFocus
                        required
                      />
                    </div>
                  </div>

                  {erroRecuperacao && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                      {erroRecuperacao}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={enviandoRecuperacao}
                    className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: AZUL_PCP }}
                  >
                    {enviandoRecuperacao ? "Enviando..." : "Enviar link de recuperação"}
                  </button>

                  <button
                    type="button"
                    onClick={voltarParaLogin}
                    className="w-full text-center text-sm font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Voltar para o login
                  </button>
                </div>
              )}
            </form>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400 lg:hidden">
            <ShieldCheck size={16} strokeWidth={2.8} />
            Plataforma de planejamento e controle da produção
          </div>
        </div>
      </main>
    </div>
  )
}