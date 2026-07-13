import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

    const res = await fetch(`${API_URL}/usuarios/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      setPerfil(null)
      return
    }

    const perfilApi = await res.json()

    setPerfil({
      ...perfilApi,
      permissoes: Array.isArray(perfilApi?.permissoes)
        ? perfilApi.permissoes
        : [],
    })
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
          return
        }

        const authUser = result.data.user

        setUser(authUser)
        await carregarPerfil(authUser)
      } catch (err) {
        console.error("Erro no AuthProvider:", err)
        setUser(null)
        setPerfil(null)
      } finally {
        if (ativo) setLoading(false)
      }
    }

    iniciar()

    const { data } = supabase.auth.onAuthStateChange((_, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)

      carregarPerfil(nextUser).finally(() => {
        setLoading(false)
      })
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