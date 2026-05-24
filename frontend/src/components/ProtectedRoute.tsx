import { useEffect, useState, type ReactNode } from "react"
import { Navigate } from "react-router-dom"
import type { User } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let alive = true

    async function check() {
      try {
        const { data } = await supabase.auth.getUser()
        if (!alive) return
        setUser(data.user)
      } catch {
        if (!alive) return
        setUser(null)
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    check()

    const timeout = window.setTimeout(() => {
      if (alive) setLoading(false)
    }, 3000)

    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return children
}
