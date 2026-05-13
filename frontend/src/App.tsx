import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { ProtectedRoute } from "./components/ProtectedRoute"

import { LoginPage } from "./pages/Login"
import { OverviewPage } from "./pages/Overview"
import { ProducaoPage } from "./pages/Producao"
import { DadosPage } from "./pages/Dados"
import { OrdensPage } from "./pages/Ordens"

import { CalendarioParadasPage } from "./pages/calendario-paradas"

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
          <Route
            path="/overview"
            element={<OverviewPage />}
          />

          {/* Produção */}
          <Route
            path="/producao/*"
            element={<ProducaoPage />}
          />

          {/* Ordens */}
          <Route
            path="/ordens"
            element={<OrdensPage />}
          />

          {/* Calendário de Paradas */}
          <Route
            path="/calendario-paradas"
            element={<CalendarioParadasPage />}
          />

          {/* Dados */}
          <Route
            path="/dados"
            element={<DadosPage />}
          />

          <Route
            path="/dados/:baseId"
            element={<DadosPage />}
          />
        </Route>

        {/* ROOT */}
        <Route
          path="/"
          element={<Navigate to="/overview" replace />}
        />

        {/* FALLBACK */}
        <Route
          path="*"
          element={<Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}
