import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"

type Props = {
  children: ReactNode
  permissao?: string
}

export function ProtectedRoute({ children, permissao }: Props) {
  const { loading, user, hasPermission } = useAuth()
  const location = useLocation()

  if (loading) return null

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (permissao && !hasPermission(permissao)) {
    return <Navigate to="/overview" replace />
  }

  return children
}
