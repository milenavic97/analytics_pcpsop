import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { ProtectedRoute } from "./components/ProtectedRoute"

import { LoginPage } from "./pages/Login"
import { OverviewPage } from "./pages/Overview"
import { ProducaoPage } from "./pages/Producao"
import { DadosPage } from "./pages/Dados"
import { OrdensPage } from "./pages/Ordens"
import Mrp from "./pages/Mrp"

import { CalendarioParadasPage } from "./pages/calendario-paradas"

import { Layout } from "./components/layout/Layout"

export default function App() {
  return (
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
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/producao/*" element={<ProducaoPage />} />
          <Route path="/ordens" element={<OrdensPage />} />

          <Route path="/mps" element={<Mrp />} />
          <Route path="/mrp" element={<Navigate to="/mps" replace />} />

          <Route path="/calendario-paradas" element={<CalendarioParadasPage />} />
          <Route path="/dados" element={<DadosPage />} />
          <Route path="/dados/:baseId" element={<DadosPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
