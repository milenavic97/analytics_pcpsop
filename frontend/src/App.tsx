import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { Layout } from "./components/Layout"
import { LoginPage } from "./pages/Login"
import { OverviewPage } from "./pages/Overview"
import { OrdensPage } from "./pages/Ordens"
import { ProducaoPage } from "./pages/Producao"
import { DadosPage } from "./pages/Dados"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<LoginPage />} />

        {/* SISTEMA — com layout + sidebar */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/ordens" element={<OrdensPage />} />
          <Route path="/producao" element={<ProducaoPage />} />
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
