import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { ProtectedRoute } from "./components/ProtectedRoute"
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

import { CalendarioParadasPage } from "./pages/calendario-paradas"

import { Layout } from "./components/layout/Layout"

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/overview"
              element={
                <ProtectedRoute permissao="overview">
                  <OverviewPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/producao/*"
              element={
                <ProtectedRoute permissao="producao">
                  <ProducaoPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/faturamento"
              element={
                <ProtectedRoute>
                  <FaturamentoPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/ordens"
              element={
                <ProtectedRoute permissao="ordens">
                  <OrdensPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/mps"
              element={
                <ProtectedRoute permissao="mps">
                  <Mrp />
                </ProtectedRoute>
              }
            />

            <Route path="/mrp" element={<Navigate to="/mps" replace />} />

            <Route
              path="/analise-mrp"
              element={
                <ProtectedRoute permissao="analise-mrp">
                  <AnaliseMrpPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/calendario-paradas"
              element={
                <ProtectedRoute permissao="calendario-paradas">
                  <CalendarioParadasPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/dados"
              element={
                <ProtectedRoute permissao="dados">
                  <DadosPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/dados/:baseId"
              element={
                <ProtectedRoute permissao="dados">
                  <DadosPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/configuracoes"
              element={
                <ProtectedRoute permissao="configuracoes">
                  <ConfiguracoesPage />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
