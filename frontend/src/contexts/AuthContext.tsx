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
  hasPermission: (permissao: string) => boolean
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

export function AuthProvider({
  children,
}: {
  children: ReactNode
}) {
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

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/usuarios/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (!response.ok) {
        setPerfil(null)
        return
      }

      const data = await response.json()

      setPerfil(data)
    } catch (err) {
      console.error(err)
      setPerfil(null)
    }
  }

  async function refreshPerfil() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    await carregarPerfil(user)
  }

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      setUser(user)

      await carregarPerfil(user)

      setLoading(false)
    }

    load()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_, session) => {
      const nextUser = session?.user ?? null

      setUser(nextUser)

      await carregarPerfil(nextUser)

      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const permissoes = useMemo(() => {
    return perfil?.permissoes || []
  }, [perfil])

  function hasPermission(permissao: string) {
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
