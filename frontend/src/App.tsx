import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { LoginPage } from "./pages/Login"
import { OverviewPage } from "./pages/Overview"
import { ProducaoPage } from "./pages/Producao"
import { DadosPage } from "./pages/Dados"
import { OrdensPage } from "./pages/Ordens"
import { Layout } from "./components/layout/Layout"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<LoginPage />} />

        {/* SISTEMA COM LAYOUT */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Overview */}
          <Route path="/overview" element={<OverviewPage />} />

          {/* Produção */}
          <Route path="/producao/*" element={<ProducaoPage />} />

          {/* Ordens de Produção */}
          <Route path="/ordens" element={<OrdensPage />} />

          {/* Dados (IMPORTANTE) */}
          <Route path="/dados" element={<DadosPage />} />
          <Route path="/dados/:baseId" element={<DadosPage />} />
        </Route>

        {/* ROOT */}
        <Route path="/" element={<Navigate to="/overview" replace />} />

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
