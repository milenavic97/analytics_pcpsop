import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { ShieldAlert } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"

type Props = {
  children: ReactNode
  permissao?: string
}

export function ProtectedRoute({ children, permissao }: Props) {
  const { loading, user, perfil, hasPermission } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (permissao && !perfil) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">
          <ShieldAlert size={28} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold">Usuário sem perfil configurado</h1>
          <p className="mt-2 text-sm">
            Seu login existe, mas ainda não foi configurado na tela de usuários.
            Peça ao administrador para liberar seu acesso.
          </p>
        </div>
      </div>
    )
  }

  if (permissao && !hasPermission(permissao)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          <ShieldAlert size={28} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold">Acesso não permitido</h1>
          <p className="mt-2 text-sm">
            Você não possui permissão para visualizar esta página.
          </p>
        </div>
      </div>
    )
  }

  return children
}
