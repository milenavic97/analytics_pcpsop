import { useEffect, useState, type ReactNode } from "react"
import { Navigate } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    async function getSession() {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
      setLoading(false)
    }

    getSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return null

  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}