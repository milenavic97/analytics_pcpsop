import { useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { AuthProvider } from "./contexts/AuthContext"

import { LoginPage } from "./pages/Login"
import { OverviewPage } from "./pages/Overview"
import { ProducaoPage } from "./pages/Producao"
import { DadosPage } from "./pages/Dados"
import { OrdensPage } from "./pages/Ordens"
import Mrp from "./pages/Mrp"
import AnaliseMrpPage from "./pages/AnaliseMrp"
import ConfiguracoesPage from "./pages/Configuracoes"
import FaturamentoPage from "./pages/Faturamento"
import DesviosPage from "./pages/Desvios"
import LiberacaoExecutiva from "./pages/LiberacaoExecutiva"

import { CalendarioParadasPage } from "./pages/calendario-paradas"

import { Layout } from "./components/layout/Layout"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { MfaGate } from "./components/MfaGate"
import { prefetchAppData } from "./services/api"

export default function App() {
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/login") {
      return
    }

    return prefetchAppData({ initialDelayMs: 5000 })
  }, [])

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <MfaGate>
                  <Layout />
                </MfaGate>
              </ProtectedRoute>
            }
          >
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/liberacao-executiva" element={<LiberacaoExecutiva />} />
            <Route path="/producao/*" element={<ProducaoPage />} />
            <Route path="/faturamento" element={<FaturamentoPage />} />
            <Route path="/desvios" element={<DesviosPage />} />
            <Route path="/ordens" element={<OrdensPage />} />
            <Route path="/mps" element={<Mrp />} />
            <Route path="/mrp" element={<Navigate to="/mps" replace />} />
            <Route path="/analise-mrp" element={<AnaliseMrpPage />} />
            <Route path="/calendario-paradas" element={<CalendarioParadasPage />} />
            <Route path="/dados" element={<DadosPage />} />
            <Route path="/dados/:baseId" element={<DadosPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}