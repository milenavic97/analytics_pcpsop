import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Layout } from "@/components/layout/Layout"
import { LoginPage }    from "@/pages/Login"
import { OverviewPage } from "@/pages/Overview"
import { ProducaoPage } from "@/pages/Producao"
import { DadosPage }    from "@/pages/Dados"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="/producao" element={<ProducaoPage />} />
          <Route path="/dados" element={<DadosPage />} />
          <Route path="/dados/:baseId" element={<DadosPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
