import { useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, LogOut, ShieldCheck, Copy, Check } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabase"
import {
  nivelSeguranca,
  listarFatores,
  verificarCodigoLogin,
  iniciarCadastroTotp,
  confirmarCadastroTotp,
} from "@/lib/mfa"

/**
 * Porteiro de autenticação em 2 fatores. Fica por dentro do
 * ProtectedRoute (que já garante que existe um `user` logado) e decide,
 * a cada carregamento, em qual dos 3 estados a sessão está:
 *
 *  - "ok"       -> segue normal, renderiza os filhos (Layout + páginas).
 *  - "desafio"  -> a conta JÁ tem um fator TOTP verificado, mas a sessão
 *                  atual está em aal1 (login por senha ainda não passou
 *                  pelo segundo fator). Pede o código e trava a tela até
 *                  confirmar -- sem isso, o backend rejeitaria qualquer
 *                  chamada de API com 401 "mfa_aal2_requerido" mesmo
 *                  assim, então é melhor pedir aqui do que deixar a
 *                  pessoa bater a cabeça em cada tela.
 *  - "cadastro" -> a conta ainda não tem NENHUM fator, e o cadastro está
 *                  marcado como obrigatório (settings.mfa_obrigatorio no
 *                  backend). Mostra o QR code e obriga a confirmar antes
 *                  de liberar o resto do sistema.
 *
 * Uso (em App.tsx), por dentro do ProtectedRoute:
 *   <Route element={<ProtectedRoute><MfaGate><Layout /></MfaGate></ProtectedRoute>}>
 */

type Estado = "verificando" | "ok" | "desafio" | "cadastro"

type Props = {
  children: ReactNode
}

export function MfaGate({ children }: Props) {
  const { loading: authLoading, perfil, refreshPerfil } = useAuth()
  const navigate = useNavigate()

  const [estado, setEstado] = useState<Estado>("verificando")
  const [erroInicial, setErroInicial] = useState("")

  async function avaliarSessao() {
    setErroInicial("")

    try {
      const { atual, proximo } = await nivelSeguranca()

      // Sessão já passou pelo segundo fator neste login.
      if (atual === "aal2") {
        setEstado("ok")
        return
      }

      // Tem fator verificado cadastrado, mas este login ainda não
      // completou o desafio -- precisa digitar o código agora.
      if (proximo === "aal2") {
        setEstado("desafio")
        return
      }

      // Ninguém cadastrou fator ainda (atual === proximo === "aal1").
      // Só bloqueia com tela de cadastro se o backend estiver exigindo.
      // `mfa_obrigatorio` vem de GET /usuarios/me -- se ainda não existir
      // nessa resposta (backend antigo), o cadastro fica opcional e a
      // pessoa passa direto.
      const obrigatorio = Boolean((perfil as any)?.mfa_obrigatorio)
      const jaTemFator = Boolean((perfil as any)?.mfa_ativo)

      if (obrigatorio && !jaTemFator) {
        setEstado("cadastro")
        return
      }

      setEstado("ok")
    } catch (err) {
      console.error("Erro verificando nível de segurança da sessão:", err)
      setErroInicial("Não foi possível verificar a segurança da sessão. Tente novamente.")
      setEstado("verificando")
    }
  }

  useEffect(() => {
    if (authLoading) return
    avaliarSessao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, perfil?.auth_user_id])

  async function handleSair() {
    await supabase.auth.signOut()
    navigate("/login", { replace: true })
  }

  if (authLoading || estado === "verificando") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500">
        <Loader2 size={22} className="animate-spin text-[#1B3A5C]" />
        <span>Verificando segurança da sessão...</span>
        {erroInicial && (
          <div className="mt-2 flex flex-col items-center gap-2 text-center">
            <p className="max-w-sm text-red-600">{erroInicial}</p>
            <button
              onClick={avaliarSessao}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Tentar de novo
            </button>
          </div>
        )}
      </div>
    )
  }

  if (estado === "desafio") {
    return <TelaDesafio onSucesso={avaliarSessao} onSair={handleSair} />
  }

  if (estado === "cadastro") {
    return (
      <TelaCadastroObrigatorio
        onSucesso={async () => {
          await refreshPerfil()
          await avaliarSessao()
        }}
        onSair={handleSair}
      />
    )
  }

  return <>{children}</>
}

// ────────────────────────────────────────────────────────────
// Tela de desafio: conta já tem fator verificado, só falta digitar o
// código deste login.
// ────────────────────────────────────────────────────────────

function TelaDesafio({
  onSucesso,
  onSair,
}: {
  onSucesso: () => void
  onSair: () => void
}) {
  const [codigo, setCodigo] = useState("")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [carregandoFator, setCarregandoFator] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState("")

  useEffect(() => {
    async function carregar() {
      try {
        const fatores = await listarFatores()
        const verificado = fatores.find((f) => f.status === "verified")

        if (!verificado) {
          setErro("Não encontramos um fator de segurança verificado nesta conta.")
        } else {
          setFactorId(verificado.id)
        }
      } catch (err) {
        console.error("Erro carregando fatores MFA:", err)
        setErro("Não foi possível carregar as informações de segurança.")
      } finally {
        setCarregandoFator(false)
      }
    }

    carregar()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return

    setErro("")
    setEnviando(true)

    try {
      await verificarCodigoLogin(factorId, codigo)
      onSucesso()
    } catch (err: any) {
      setErro("Código inválido ou expirado. Confira no seu app autenticador e tente novamente.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <TelaBase
      titulo="Verificação em duas etapas"
      subtitulo="Digite o código de 6 dígitos do seu app autenticador para continuar."
      onSair={onSair}
    >
      {carregandoFator ? (
        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
          <Loader2 size={18} className="mr-2 animate-spin" />
          Carregando...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-900">
              Código do autenticador
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              autoFocus
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-center text-lg tracking-[0.3em] text-slate-900 outline-none transition focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20"
              required
            />
          </div>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>
          )}

          <button
            type="submit"
            disabled={enviando || !factorId || codigo.length < 6}
            className="w-full rounded-lg bg-[#1B3A5C] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#142B45] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? "Verificando..." : "Verificar"}
          </button>
        </form>
      )}
    </TelaBase>
  )
}

// ────────────────────────────────────────────────────────────
// Tela de cadastro obrigatório: conta ainda não tem fator nenhum e o
// backend está exigindo (settings.mfa_obrigatorio = true).
// ────────────────────────────────────────────────────────────

function TelaCadastroObrigatorio({
  onSucesso,
  onSair,
}: {
  onSucesso: () => void
  onSair: () => void
}) {
  const [etapa, setEtapa] = useState<"carregando" | "qrcode" | "erro">("carregando")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null)
  const [segredoManual, setSegredoManual] = useState<string | null>(null)
  const [codigo, setCodigo] = useState("")
  const [copiado, setCopiado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState("")

  useEffect(() => {
    async function iniciar() {
      try {
        const dados = await iniciarCadastroTotp()
        setFactorId(dados.factorId)
        setQrCodeSvg(dados.qrCodeSvg)
        setSegredoManual(dados.segredoManual)
        setEtapa("qrcode")
      } catch (err) {
        console.error("Erro iniciando cadastro MFA:", err)
        setErro("Não foi possível gerar o QR code de cadastro. Tente novamente.")
        setEtapa("erro")
      }
    }

    iniciar()
  }, [])

  async function handleConfirmar(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return

    setErro("")
    setEnviando(true)

    try {
      await confirmarCadastroTotp(factorId, codigo)
      onSucesso()
    } catch (err: any) {
      setErro("Código inválido. Confira se o horário do seu celular está correto e tente de novo.")
    } finally {
      setEnviando(false)
    }
  }

  async function handleCopiar() {
    if (!segredoManual) return
    try {
      await navigator.clipboard.writeText(segredoManual)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard pode falhar em contexto não-seguro; sem problema, o
      // segredo já está visível na tela pra digitar manualmente.
    }
  }

  return (
    <TelaBase
      titulo="Cadastro do segundo fator obrigatório"
      subtitulo="Por segurança, todo acesso ao Analytics PCP agora exige um segundo fator de autenticação."
      onSair={onSair}
    >
      {etapa === "carregando" && (
        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
          <Loader2 size={18} className="mr-2 animate-spin" />
          Gerando QR code...
        </div>
      )}

      {etapa === "erro" && (
        <div className="space-y-4">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {etapa === "qrcode" && (
        <form onSubmit={handleConfirmar} className="space-y-5">
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              1. Abra um app autenticador (Google Authenticator, Authy, 1Password, etc.) e
              escaneie o QR code abaixo.
            </p>

            {qrCodeSvg && (
              <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-4">
                {/* O Supabase pode devolver o QR code de duas formas dependendo
                    da versão do SDK: já como uma data URI completa
                    ("data:image/svg+xml;utf-8,<svg>...") ou como o marcador
                    <svg> puro. Uma <img src> lida com os dois casos sem
                    vazar o prefixo "data:..." como texto solto na tela --
                    problema que aparecia antes com dangerouslySetInnerHTML
                    quando a resposta já vinha como data URI. */}
                <img
                  src={
                    qrCodeSvg.startsWith("data:")
                      ? qrCodeSvg
                      : `data:image/svg+xml;utf-8,${encodeURIComponent(qrCodeSvg)}`
                  }
                  alt="QR code para cadastro do segundo fator"
                  width={200}
                  height={200}
                />
              </div>
            )}

            {segredoManual && (
              <div>
                <p className="mb-1 text-xs text-slate-500">
                  Não conseguiu escanear? Digite o código manualmente:
                </p>
                <button
                  type="button"
                  onClick={handleCopiar}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-left font-mono text-xs text-slate-700 hover:bg-slate-100"
                >
                  <span className="truncate">{segredoManual}</span>
                  {copiado ? (
                    <Check size={14} className="ml-2 shrink-0 text-emerald-600" />
                  ) : (
                    <Copy size={14} className="ml-2 shrink-0 text-slate-400" />
                  )}
                </button>
              </div>
            )}

            <p>2. Digite abaixo o código de 6 dígitos gerado pelo app.</p>
          </div>

          <div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              autoFocus
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-center text-lg tracking-[0.3em] text-slate-900 outline-none transition focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/20"
              required
            />
          </div>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>
          )}

          <button
            type="submit"
            disabled={enviando || codigo.length < 6}
            className="w-full rounded-lg bg-[#1B3A5C] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#142B45] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? "Confirmando..." : "Concluir cadastro"}
          </button>
        </form>
      )}
    </TelaBase>
  )
}

// ────────────────────────────────────────────────────────────
// Casca visual compartilhada pelas duas telas, no mesmo estilo do
// Login (pages/Login/index.tsx).
// ────────────────────────────────────────────────────────────

function TelaBase({
  titulo,
  subtitulo,
  onSair,
  children,
}: {
  titulo: string
  subtitulo: string
  onSair: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1B3A5C] shadow-sm">
            <ShieldCheck size={28} className="text-white" />
          </div>

          <h1 className="text-2xl font-bold text-slate-950">{titulo}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitulo}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 sm:p-7">
          {children}
        </div>

        <button
          onClick={onSair}
          className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <LogOut size={14} />
          Sair e entrar com outra conta
        </button>
      </div>
    </div>
  )
}