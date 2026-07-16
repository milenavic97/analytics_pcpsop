import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"

type PerfilUsuario = {
  id: string
  auth_user_id: string
  nome: string
  usuario: string
  email: string
  perfil: string
  ativo: boolean
  permissoes: string[]
  // Autenticação em 2 fatores (ver lib/mfa.ts e components/MfaGate.tsx).
  // Vêm de GET /usuarios/me -- opcionais aqui só por segurança de tipo
  // (ex.: se o backend ainda não tiver sido atualizado).
  mfa_ativo?: boolean
  mfa_obrigatorio?: boolean
}

type AuthContextType = {
  loading: boolean
  user: User | null
  perfil: PerfilUsuario | null
  permissoes: string[]
  hasPermission: (permissao?: string) => boolean
  refreshPerfil: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  loading: true,
  user: null,
  perfil: null,
  permissoes: [],
  hasPermission: () => false,
  refreshPerfil: async () => {},
})

const API_URL = import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null)

  // Guarda o id do usuário autenticado fora do estado do React (não dispara
  // re-render) para conseguirmos comparar, dentro do listener abaixo, se um
  // evento é realmente uma pessoa entrando/saindo ou só o Supabase
  // reconfirmando a mesma sessão (ver comentário mais abaixo).
  const usuarioAutenticadoIdRef = useRef<string | null>(null)

  async function carregarPerfil(authUser: User | null) {
    if (!authUser) {
      setPerfil(null)
      return
    }

    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    if (!token) {
      setPerfil(null)
      return
    }

    // Tenta algumas vezes antes de desistir. Sem isso, uma instabilidade
    // passageira do backend (ex.: o processo reiniciando logo depois de um
    // deploy) fazia a chamada falhar uma única vez e a pessoa via
    // "Usuário sem perfil configurado" -- mensagem errada, já que o
    // problema era só de rede/timing, não de cadastro. As tentativas
    // seguintes normalmente já encontram o backend de pé de novo.
    const TENTATIVAS = 3
    const ESPERA_ENTRE_TENTATIVAS_MS = 700

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        const res = await fetch(`${API_URL}/usuarios/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (res.ok) {
          const perfilApi = await res.json()

          setPerfil({
            ...perfilApi,
            permissoes: Array.isArray(perfilApi?.permissoes)
              ? perfilApi.permissoes
              : [],
          })
          return
        }

        // 401/403 de verdade (token inválido, usuário sem perfil, inativo)
        // não melhora tentando de novo -- para na hora.
        if (res.status === 401 || res.status === 403) {
          setPerfil(null)
          return
        }
      } catch {
        // Erro de rede (ex.: backend momentaneamente inacessível) --
        // segue para a próxima tentativa, se houver.
      }

      if (tentativa < TENTATIVAS) {
        await new Promise((resolve) => setTimeout(resolve, ESPERA_ENTRE_TENTATIVAS_MS * tentativa))
      }
    }

    setPerfil(null)
  }

  async function refreshPerfil() {
    const { data } = await supabase.auth.getUser()
    setUser(data.user)
    await carregarPerfil(data.user)
  }

  useEffect(() => {
    let ativo = true

    async function iniciar() {
      try {
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 4000)
        )

        const getUserPromise = supabase.auth.getUser()

        const result = await Promise.race([getUserPromise, timeout])

        if (!ativo) return

        if (!result) {
          setUser(null)
          setPerfil(null)
          usuarioAutenticadoIdRef.current = null
          return
        }

        const authUser = result.data.user

        setUser(authUser)
        usuarioAutenticadoIdRef.current = authUser?.id ?? null
        await carregarPerfil(authUser)
      } catch (err) {
        console.error("Erro no AuthProvider:", err)
        setUser(null)
        setPerfil(null)
        usuarioAutenticadoIdRef.current = null
      } finally {
        if (ativo) setLoading(false)
      }
    }

    iniciar()

    const { data } = supabase.auth.onAuthStateChange((evento, session) => {
      const nextUser = session?.user ?? null
      const idAnterior = usuarioAutenticadoIdRef.current
      const idNovo = nextUser?.id ?? null

      setUser(nextUser)
      usuarioAutenticadoIdRef.current = idNovo

      // Só os eventos que representam uma pessoa entrando ou saindo DE
      // VERDADE merecem mostrar a tela de "Verificando segurança da
      // sessão..." (necessário pra evitar o flash de "sem perfil" logo
      // após o login, corrigido antes).
      //
      // O Supabase dispara "INITIAL_SESSION" (e às vezes "SIGNED_IN") de
      // novo sozinho toda vez que a aba volta a ficar em foco/visível,
      // mesmo que a pessoa já estivesse logada o tempo todo -- ele só está
      // reconfirmando a sessão existente, não é uma pessoa entrando. Tratar
      // esse replay como um login novo fazia a tela (Overview, Gestão de
      // Estoques, etc.) ser desmontada e remontada por baixo dos panos toda
      // vez que a aba ganhava foco -- os dados em cache voltavam rápido,
      // mas qualquer estado que só existe dentro do componente (ex.: o
      // toggle de versão "beta" da Overview) resetava, e coisas que
      // dependem de useRef para não buscar de novo perdiam essa trava.
      //
      // Por isso, só contamos como login/logout real quando o id do
      // usuário efetivamente muda (ninguém -> alguém, alguém -> ninguém,
      // ou troca de conta). Reconfirmação da mesma sessão (mesmo id) nunca
      // passa por aqui.
      const eventoRepresentaLoginOuLogout =
        evento === "SIGNED_OUT" ? Boolean(idAnterior) : idAnterior !== idNovo

      if (eventoRepresentaLoginOuLogout) {
        setLoading(true)
        carregarPerfil(nextUser).finally(() => {
          setLoading(false)
        })
      } else {
        // TOKEN_REFRESHED, INITIAL_SESSION repetido, USER_UPDATED, etc.:
        // atualiza o perfil por trás, sem nunca mostrar spinner nem travar
        // (ou desmontar) a tela que a pessoa já está vendo.
        carregarPerfil(nextUser).catch(() => {})
      }
    })

    return () => {
      ativo = false
      data.subscription.unsubscribe()
    }
  }, [])

  const permissoes = useMemo(() => perfil?.permissoes || [], [perfil])

  function hasPermission(permissao?: string) {
    if (!permissao) return true
    if (!perfil?.ativo) return false
    if (perfil.perfil === "admin") return true
    return permissoes.includes(permissao)
  }

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        perfil,
        permissoes,
        hasPermission,
        refreshPerfil,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}