import { FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BarChart3, Eye, EyeOff, LockKeyhole } from "lucide-react"

import { supabase } from "../../lib/supabase"

const AZUL_PCP = "#173A5E"

/**
 * Tela que recebe a pessoa depois que ela clica no link de "Esqueci
 * minha senha" recebido por e-mail (disparado em Login/index.tsx via
 * supabase.auth.resetPasswordForEmail).
 *
 * O Supabase, ao carregar essa URL, detecta sozinho o token que vem no
 * link (supabase-js já vem configurado com detectSessionInUrl = true
 * por padrão) e dispara um evento "PASSWORD_RECOVERY" -- é esse evento
 * que confirma que a pessoa realmente veio de um link válido, e não só
 * digitou essa URL na mão sem ter clicado em nada.
 */
export function RedefinirSenhaPage() {
  const navigate = useNavigate()

  const [estado, setEstado] = useState<"verificando" | "pronto" | "invalido" | "sucesso">(
    "verificando"
  )
  const [novaSenha, setNovaSenha] = useState("")
  const [confirmarSenha, setConfirmarSenha] = useState("")
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState("")

  useEffect(() => {
    let liberado = false

    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") {
        liberado = true
        setEstado("pronto")
      }
    })

    // Alguns navegadores/e-mails já processam o link antes deste
    // componente montar -- por segurança, também checa se já existe uma
    // sessão válida quando a página carrega, sem depender só do evento.
    supabase.auth.getSession().then(({ data: sessao }) => {
      if (!liberado && sessao.session) {
        liberado = true
        setEstado("pronto")
      } else if (!liberado) {
        // Dá um tempo curto pro evento PASSWORD_RECOVERY chegar antes de
        // desistir e mostrar "link inválido" -- em alguns casos o evento
        // demora uma fração de segundo a mais que o getSession inicial.
        setTimeout(() => {
          if (!liberado) setEstado("invalido")
        }, 2500)
      }
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  async function handleSalvar(e: FormEvent) {
    e.preventDefault()
    setErro("")

    if (novaSenha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.")
      return
    }

    if (novaSenha !== confirmarSenha) {
      setErro("As senhas digitadas não são iguais.")
      return
    }

    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    setSalvando(false)

    if (error) {
      setErro("Não foi possível salvar a senha. Solicite um novo link e tente de novo.")
      return
    }

    setEstado("sucesso")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[480px]">
        <div className="mb-7 flex flex-col items-center text-center">
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
            Definir nova senha
          </h1>
        </div>

        <div className="rounded-[30px] border border-slate-200 bg-white px-7 py-10 shadow-[0_28px_80px_rgba(15,23,42,0.10)] sm:px-10 sm:py-12">
          {estado === "verificando" && (
            <p className="text-center text-sm font-medium text-slate-500">
              Verificando o link...
            </p>
          )}

          {estado === "invalido" && (
            <div className="space-y-6 text-center">
              <p className="text-sm font-medium text-slate-600">
                Este link é inválido ou já expirou. Volte para a tela de login
                e solicite um novo link de recuperação.
              </p>

              <button
                onClick={() => navigate("/login", { replace: true })}
                className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition"
                style={{ background: AZUL_PCP }}
              >
                Voltar para o login
              </button>
            </div>
          )}

          {estado === "sucesso" && (
            <div className="space-y-6 text-center">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Senha alterada com sucesso.
              </div>

              <button
                onClick={() => navigate("/overview", { replace: true })}
                className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition"
                style={{ background: AZUL_PCP }}
              >
                Entrar na ferramenta
              </button>
            </div>
          )}

          {estado === "pronto" && (
            <form onSubmit={handleSalvar} className="space-y-6">
              <div>
                <label
                  htmlFor="novaSenha"
                  className="mb-2.5 block text-sm font-bold text-slate-900"
                >
                  Nova senha
                </label>

                <div className="relative">
                  <LockKeyhole
                    size={22}
                    strokeWidth={2.8}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: AZUL_PCP }}
                  />

                  <input
                    id="novaSenha"
                    type={mostrarSenha ? "text" : "password"}
                    placeholder="Digite a nova senha"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-4 pl-12 pr-12 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4"
                    style={{ "--tw-ring-color": "rgba(23, 58, 94, 0.12)" } as React.CSSProperties}
                    autoFocus
                    required
                  />

                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:bg-slate-100"
                    aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {mostrarSenha ? <EyeOff size={22} strokeWidth={2.6} /> : <Eye size={22} strokeWidth={2.6} />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirmarSenha"
                  className="mb-2.5 block text-sm font-bold text-slate-900"
                >
                  Confirmar nova senha
                </label>

                <div className="relative">
                  <LockKeyhole
                    size={22}
                    strokeWidth={2.8}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: AZUL_PCP }}
                  />

                  <input
                    id="confirmarSenha"
                    type={mostrarSenha ? "text" : "password"}
                    placeholder="Digite a nova senha de novo"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-4 pl-12 pr-4 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4"
                    style={{ "--tw-ring-color": "rgba(23, 58, 94, 0.12)" } as React.CSSProperties}
                    required
                  />
                </div>
              </div>

              {erro && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                  {erro}
                </div>
              )}

              <button
                type="submit"
                disabled={salvando}
                className="w-full rounded-xl px-5 py-4 text-base font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: AZUL_PCP }}
              >
                {salvando ? "Salvando..." : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}