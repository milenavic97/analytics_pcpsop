const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL || "https://dfl-sop-api.fly.dev"

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(options?.headers || {}) },
  })

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: res.statusText }))

    throw new Error(
      (err as { detail: string }).detail ||
        `Erro ${res.status}`
    )
  }

  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────

export async function uploadBase(
  baseId: string,
  file: File
) {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(`${API_URL}/upload/${baseId}`, {
    method: "POST",
    body: form,
  })

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: res.statusText }))

    throw new Error(
      (err as { detail: string }).detail ||
        "Erro no upload"
    )
  }

  return res.json()
}

export async function getUploadStatus(baseId: string) {
  return apiFetch(`/upload/status/${baseId}`)
}

// ─────────────────────────────────────────────────────────────
// Dados
// ─────────────────────────────────────────────────────────────

export async function getDados(
  tabela: string,
  page = 1,
  perPage = 50
) {
  return apiFetch(
    `/dados/${tabela}?page=${page}&per_page=${perPage}`
  )
}

export async function inserirRegistro(
  tabela: string,
  dados: Record<string, unknown>
) {
  return apiFetch(`/dados/${tabela}`, {
    method: "POST",
    body: JSON.stringify({ dados }),
    headers: { "Content-Type": "application/json" },
  })
}

export async function atualizarRegistro(
  tabela: string,
  pkValue: string,
  dados: Record<string, unknown>
) {
  return apiFetch(`/dados/${tabela}/${pkValue}`, {
    method: "PUT",
    body: JSON.stringify({ dados }),
    headers: { "Content-Type": "application/json" },
  })
}

export async function excluirRegistros(
  tabela: string,
  ids: string[]
) {
  const params = ids
    .map((id) => `ids=${encodeURIComponent(id)}`)
    .join("&")

  return apiFetch(`/dados/${tabela}?${params}`, {
    method: "DELETE",
  })
}

// ─────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────

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

export async function getAtendimentoSku() {
  return apiFetch("/overview/atendimento-sku")
}

// ─────────────────────────────────────────────────────────────
// Produção
// ─────────────────────────────────────────────────────────────

export async function getProducaoResumoMensal() {
  return apiFetch("/producao/resumo-mensal")
}

export async function getParadasPareto(
  linha?: "L1" | "L2"
) {
  return apiFetch(
    `/producao/paradas-pareto${
      linha ? `?linha=${linha}` : ""
    }`
  )
}

export async function getConfigProducao() {
  return apiFetch("/producao/config-producao")
}

export async function updateConfigProducao(
  configId: string,
  dados: {
    cap_nominal_tb_h: number
    oee_pct: number
    cap_planejada_tb_h: number
    horas_produtivas_dia: number
    observacao?: string | null
  }
) {
  return apiFetch(
    `/producao/config-producao/${configId}`,
    {
      method: "PUT",
      body: JSON.stringify(dados),
      headers: {
        "Content-Type": "application/json",
      },
    }
  )
}

export async function getMpsResumoMensal() {
  return apiFetch("/producao/mps-resumo-mensal")
}

export async function getMpsModal(mes: number) {
  return apiFetch(`/producao/mps-modal/${mes}`)
}

export async function getMpsComparativoRealPlanejado() {
  return apiFetch(
    "/producao/mps-comparativo-real-planejado"
  )
}

export async function getMpsVersoes(mes: number) {
  return apiFetch(`/producao/mps-versoes/${mes}`)
}

// ─────────────────────────────────────────────────────────────
// MRP
// ─────────────────────────────────────────────────────────────

export interface MrpRodada {
  id?: string
  nome: string
  mes: number
  ano: number
  versao: number
  status?: string
  observacao?: string | null
  criado_em?: string
}

export interface MrpOrdem {
  id?: string
  rodada_id: string

  op?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null

  linha?: string | null

  data_inicio?: string | null
  data_fim?: string | null
  data_negociada?: string | null

  qtd_planejada?: number
  qtd_atendida?: number
  qtd_faltante?: number

  status?: string
  gargalo?: string | null
  observacao?: string | null

  criado_em?: string
}

export async function getMrpRodadas(): Promise<
  MrpRodada[]
> {
  return apiFetch("/mrp/rodadas")
}

export async function criarMrpRodada(
  payload: MrpRodada
): Promise<MrpRodada> {
  return apiFetch("/mrp/rodadas", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
}

export async function getMrpOrdens(
  rodadaId: string
): Promise<MrpOrdem[]> {
  return apiFetch(
    `/mrp/rodadas/${rodadaId}/ordens`
  )
}

export async function criarMrpOrdem(
  payload: MrpOrdem
): Promise<MrpOrdem> {
  return apiFetch("/mrp/ordens", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
}

// ─────────────────────────────────────────────────────────────
// OPs — Verificação de viabilidade
// ─────────────────────────────────────────────────────────────

export type StatusOP =
  | "aberta"
  | "ok"
  | "quarentena"
  | "falta"
  | "sem_bom"

export interface ComponenteOP {
  codigo_comp: string
  descricao: string
  tp: string
  unidade: string
  necessario: number
  saldo_01: number
  saldo_98: number
  armazem_ref: string
  status: "ok" | "quarentena" | "falta"
}

export interface OPResult {
  lote: string
  codigo: string
  produto: string
  linha: string
  quantidade: number
  data_fim: string | null
  op_numero: string | null
  status: StatusOP
  alertas: ComponenteOP[]
  detalhes: ComponenteOP[]
}

export interface ResumoViabilidade {
  mes_ref: string
  total_ops: number
  resumo: {
    abertas: number
    ok: number
    quarentena: number
    falta: number
    sem_bom: number
  }
  ops: OPResult[]
}

export interface ResumoPorLinha {
  mes_ref: string
  total_ops: number
  por_linha: Record<
    string,
    {
      aberta: number
      ok: number
      quarentena: number
      falta: number
      sem_bom: number
    }
  >
}

export async function getOpsViabilidade(
  mesRef: string,
  linha?: string
): Promise<ResumoViabilidade> {
  const params = linha ? `&linha=${linha}` : ""

  return apiFetch(
    `/ops/viabilidade?mes_ref=${mesRef}${params}`
  )
}

export async function getOpsMeses(): Promise<{
  meses: string[]
}> {
  return apiFetch("/ops/meses")
}

export async function getOpsResumo(
  mesRef: string
): Promise<ResumoPorLinha> {
  return apiFetch(`/ops/resumo/${mesRef}`)
}

// ─────────────────────────────────────────────────────────────
// Calendário de Paradas
// ─────────────────────────────────────────────────────────────

export type LinhaParada =
  | "L1"
  | "L2"
  | "FABRIMA"
  | string

export interface ParadaProgramada {
  id?: string
  data: string
  linha: LinhaParada
  descricao: string
  horas?: number | null
  observacao?: string | null
  origem?: string | null
  created_at?: string
  updated_at?: string
}

export interface ResumoCalendarioParadas {
  total_paradas: number
  por_linha: Record<string, number>
  proxima_parada: ParadaProgramada | null
}

export async function getCalendarioParadas(): Promise<
  ParadaProgramada[]
> {
  return apiFetch("/calendario-paradas/")
}

export async function getResumoCalendarioParadas(): Promise<ResumoCalendarioParadas> {
  return apiFetch("/calendario-paradas/resumo")
}

export async function criarParada(
  payload: Partial<ParadaProgramada>
) {
  return apiFetch("/calendario-paradas/", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
}

export async function editarParada(
  id: string,
  payload: Partial<ParadaProgramada>
) {
  return apiFetch(`/calendario-paradas/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
}

export async function excluirParada(id: string) {
  return apiFetch(`/calendario-paradas/${id}`, {
    method: "DELETE",
  })
}

// ─────────────────────────────────────────────────────────────
// Ajustes compras OP
// ─────────────────────────────────────────────────────────────

export interface AjusteCompraOP {
  id?: string
  op_id: string
  lote?: string | null
  codigo_op?: string | null
  codigo_comp: string
  pedido_numero?: string | null
  sc_numero?: string | null
  qtd_negociada: number
  data_negociada?: string | null
  observacao?: string | null
}

export async function getAjustesComprasOps(): Promise<
  AjusteCompraOP[]
> {
  return apiFetch("/ajustes-compras-ops")
}

export async function salvarAjusteCompraOP(
  payload: AjusteCompraOP
) {
  return apiFetch("/ajustes-compras-ops", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
}

export async function excluirAjusteCompraOP(
  id: string
) {
  return apiFetch(`/ajustes-compras-ops/${id}`, {
    method: "DELETE",
  })
}
