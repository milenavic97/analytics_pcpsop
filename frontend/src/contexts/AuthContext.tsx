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

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ||
  "https://dfl-sop-api.fly.dev"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null)

  async function carregarPerfil(authUser: User | null) {
    if (!authUser) {
      setPerfil(null)
      return
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const token = session?.access_token

      if (!token) {
        setPerfil(null)
        return
      }

      const response = await fetch(`${API_URL}/usuarios/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        setPerfil(null)
        return
      }

      const data = await response.json()

      setPerfil({
        ...data,
        permissoes: Array.isArray(data?.permissoes) ? data.permissoes : [],
      })
    } catch (err) {
      console.error("Erro carregando perfil do usuário:", err)
      setPerfil(null)
    }
  }

  async function refreshPerfil() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    setUser(user)
    await carregarPerfil(user)
  }

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!alive) return

        setUser(user)
        await carregarPerfil(user)
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (!alive) return

      const nextUser = session?.user ?? null

      setUser(nextUser)
      setLoading(true)

      try {
        await carregarPerfil(nextUser)
      } finally {
        if (alive) setLoading(false)
      }
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])

  const permissoes = useMemo(() => {
    return perfil?.permissoes || []
  }, [perfil])

  function hasPermission(permissao?: string) {
    if (!permissao) return true

    if (!perfil?.ativo) return false

    if (perfil?.perfil === "admin") return true

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
