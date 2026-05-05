const API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || "http://localhost:8080"

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(options?.headers || {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail: string }).detail || `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export async function uploadBase(baseId: string, file: File) {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${API_URL}/upload/${baseId}`, { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail: string }).detail || "Erro no upload")
  }
  return res.json()
}

export async function getUploadStatus(baseId: string) {
  return apiFetch(`/upload/status/${baseId}`)
}

// ─── Dados ───────────────────────────────────────────────────────────────────

export async function getDados(tabela: string, page = 1, perPage = 50) {
  return apiFetch(`/dados/${tabela}?page=${page}&per_page=${perPage}`)
}

export async function inserirRegistro(tabela: string, dados: Record<string, unknown>) {
  return apiFetch(`/dados/${tabela}`, {
    method: "POST",
    body: JSON.stringify({ dados }),
    headers: { "Content-Type": "application/json" },
  })
}

export async function atualizarRegistro(tabela: string, pkValue: string, dados: Record<string, unknown>) {
  return apiFetch(`/dados/${tabela}/${pkValue}`, {
    method: "PUT",
    body: JSON.stringify({ dados }),
    headers: { "Content-Type": "application/json" },
  })
}

export async function excluirRegistros(tabela: string, ids: string[]) {
  const params = ids.map(id => `ids=${encodeURIComponent(id)}`).join("&")
  return apiFetch(`/dados/${tabela}?${params}`, { method: "DELETE" })
}

// ─── Overview ────────────────────────────────────────────────────────────────

export async function getOrcadoFaturamento() {
  return apiFetch("/overview/orcado-faturamento")
}

export async function getOrcadoFaturamentoDetalhe() {
  return apiFetch("/overview/orcado-faturamento-detalhe")
}

export async function getProjecaoFaturamento() {
  return apiFetch("/overview/projecao-faturamento")
}

export async function getProjecaoLiberacoes() {
  return apiFetch("/overview/projecao-liberacoes")
}

export async function getOrcadoLiberacao() {
  return apiFetch("/overview/orcado-liberacao")
}

export async function getEntradasReaisMensal() {
  return apiFetch("/overview/entradas-reais-mensal")
}

export async function getForecastMensal() {
  return apiFetch("/overview/forecast-mensal")
}

export async function getVendasReaisMensal() {
  return apiFetch("/overview/vendas-reais-mensal")
}

export async function getEstoqueMensal() {
  return apiFetch("/overview/estoque-mensal")
}

export async function getDisponibilidadeMensal() {
  return apiFetch("/overview/disponibilidade-mensal")
}

// ─── Produção ────────────────────────────────────────────────────────────────

export async function getProducaoResumoMensal() {
  return apiFetch("/producao/resumo-mensal")
}
