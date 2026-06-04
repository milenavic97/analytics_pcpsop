const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL || "https://dfl-sop-api.fly.dev"

// ─────────────────────────────────────────────────────────────
// Cache simples de GETs no frontend
// ─────────────────────────────────────────────────────────────
// Objetivo:
// - Ao sair e voltar para uma página, reaproveitar os dados carregados.
// - Evitar chamadas duplicadas simultâneas para o mesmo endpoint.
// - Persistir o cache no navegador para continuar rápido após F5/fechar e abrir.
// - Limpar o cache automaticamente depois de uploads/edições/exclusões.
//
// Regra de negócio atual:
// - As bases costumam ser atualizadas uma vez por dia.
// - Por isso, o cache de GET fica válido por 12 horas.
// - Qualquer POST/PUT/DELETE/upload limpa o cache e força recálculo.

const API_CACHE_STALE_MS = 12 * 60 * 60 * 1000  // dado considerado fresco por 12h
const API_CACHE_GC_MS = 24 * 60 * 60 * 1000     // remove do storage depois de 24h
const API_CACHE_STORAGE_PREFIX = "dfl-api-cache-v2:"

type ApiCacheEntry<T = unknown> = {
  timestamp: number
  data?: T
  promise?: Promise<T>
}

type ApiStorageEntry<T = unknown> = {
  timestamp: number
  data: T
}

const apiCache = new Map<string, ApiCacheEntry>()

function getApiCacheKey(path: string) {
  return `${API_URL}${path}`
}

function getStorage() {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

function getStorageKey(cacheKey: string) {
  return `${API_CACHE_STORAGE_PREFIX}${cacheKey}`
}

function readPersistentCache<T>(cacheKey: string): ApiStorageEntry<T> | null {
  const storage = getStorage()
  if (!storage) return null

  const storageKey = getStorageKey(cacheKey)

  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as ApiStorageEntry<T>

    if (
      !parsed ||
      typeof parsed.timestamp !== "number" ||
      !Object.prototype.hasOwnProperty.call(parsed, "data")
    ) {
      storage.removeItem(storageKey)
      return null
    }

    if (Date.now() - parsed.timestamp > API_CACHE_STALE_MS) {
      storage.removeItem(storageKey)
      return null
    }

    return parsed
  } catch {
    storage.removeItem(storageKey)
    return null
  }
}

function writePersistentCache<T>(cacheKey: string, data: T) {
  const storage = getStorage()
  if (!storage) return

  try {
    const payload: ApiStorageEntry<T> = {
      timestamp: Date.now(),
      data,
    }

    storage.setItem(getStorageKey(cacheKey), JSON.stringify(payload))
  } catch {
    // Se o navegador bloquear ou o storage encher, mantém apenas o cache em memória.
  }
}

function limparCacheExpirado() {
  const agora = Date.now()

  for (const [key, entry] of apiCache.entries()) {
    if (!entry.promise && agora - entry.timestamp > API_CACHE_GC_MS) {
      apiCache.delete(key)
    }
  }

  const storage = getStorage()
  if (!storage) return

  try {
    const keysToRemove: string[] = []

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key || !key.startsWith(API_CACHE_STORAGE_PREFIX)) continue

      try {
        const raw = storage.getItem(key)
        if (!raw) {
          keysToRemove.push(key)
          continue
        }

        const parsed = JSON.parse(raw) as ApiStorageEntry

        if (
          !parsed ||
          typeof parsed.timestamp !== "number" ||
          agora - parsed.timestamp > API_CACHE_GC_MS
        ) {
          keysToRemove.push(key)
        }
      } catch {
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key))
  } catch {
    // Não bloqueia a tela caso o storage falhe.
  }
}

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    apiCache.clear()

    const storage = getStorage()
    if (!storage) return

    try {
      const keysToRemove: string[] = []

      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (key?.startsWith(API_CACHE_STORAGE_PREFIX)) {
          keysToRemove.push(key)
        }
      }

      keysToRemove.forEach((key) => storage.removeItem(key))
    } catch {
      // Não bloqueia a mutação caso o storage falhe.
    }

    return
  }

  const prefixAbs = `${API_URL}${prefix}`

  for (const key of apiCache.keys()) {
    if (key.startsWith(prefixAbs) || key.includes(prefix)) {
      apiCache.delete(key)
    }
  }

  const storage = getStorage()
  if (!storage) return

  try {
    const keysToRemove: string[] = []

    for (let i = 0; i < storage.length; i += 1) {
      const storageKey = storage.key(i)
      if (!storageKey?.startsWith(API_CACHE_STORAGE_PREFIX)) continue

      const cacheKey = storageKey.replace(API_CACHE_STORAGE_PREFIX, "")

      if (cacheKey.startsWith(prefixAbs) || cacheKey.includes(prefix)) {
        keysToRemove.push(storageKey)
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key))
  } catch {
    // Não bloqueia a limpeza caso o storage falhe.
  }
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const method = String(options?.method || "GET").toUpperCase()
  const isGet = method === "GET"
  const cacheKey = getApiCacheKey(path)

  if (isGet) {
    limparCacheExpirado()

    const cached = apiCache.get(cacheKey) as ApiCacheEntry<T> | undefined

    if (cached?.data !== undefined && Date.now() - cached.timestamp < API_CACHE_STALE_MS) {
      return cached.data
    }

    if (cached?.promise) {
      return cached.promise
    }

    const persisted = readPersistentCache<T>(cacheKey)
    if (persisted) {
      apiCache.set(cacheKey, {
        timestamp: persisted.timestamp,
        data: persisted.data,
      })

      return persisted.data
    }
  }

  const requestPromise = (async () => {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...(options?.headers || {}) },
    })

    const payload = await res
      .json()
      .catch(() => ({ detail: res.statusText }))

    if (!res.ok) {
      throw new Error(
        (payload as { detail?: string }).detail ||
          `Erro ${res.status}`
      )
    }

    // Qualquer mutação pode alterar números exibidos em várias telas.
    // Por segurança, limpamos o cache completo após POST/PUT/DELETE.
    if (!isGet) {
      clearApiCache()
    }

    return payload as T
  })()

  if (isGet) {
    apiCache.set(cacheKey, {
      timestamp: Date.now(),
      promise: requestPromise,
    })

    requestPromise
      .then((data) => {
        const timestamp = Date.now()

        apiCache.set(cacheKey, {
          timestamp,
          data,
        })

        writePersistentCache(cacheKey, data)
      })
      .catch(() => {
        apiCache.delete(cacheKey)
      })
  }

  return requestPromise
}

// ─────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────

export type UploadBaseResponse = {
  total_inserido: number
  erros?: string[]
  detail?: string | string[]
}

export class UploadBaseError extends Error {
  payload?: unknown

  constructor(message: string, payload?: unknown) {
    super(message)
    this.name = "UploadBaseError"
    this.payload = payload
  }
}

function normalizarErroUpload(payload: unknown, fallback: string) {
  const p = payload as {
    detail?: string | string[]
    erros?: string[]
    message?: string
  }

  const partes: string[] = []

  if (Array.isArray(p?.detail)) partes.push(...p.detail.map(String))
  else if (p?.detail) partes.push(String(p.detail))

  if (Array.isArray(p?.erros)) partes.push(...p.erros.map(String))

  if (p?.message) partes.push(String(p.message))

  return partes.length ? partes.join("\n") : fallback
}

export async function uploadBase(baseId: string, file: File): Promise<UploadBaseResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(`${API_URL}/upload/${baseId}`, {
    method: "POST",
    body: form,
  })

  const payload = await res
    .json()
    .catch(() => null)

  if (!res.ok) {
    throw new UploadBaseError(
      normalizarErroUpload(payload, "Erro no upload"),
      payload
    )
  }

  clearApiCache()

  return payload as UploadBaseResponse
}

export async function getUploadStatus(baseId: string) {
  return apiFetch(`/upload/status/${baseId}`)
}

export type UltimaAtualizacaoResponse = {
  base_id: string
  ultima_atualizacao: string | null
}

export async function buscarUltimaAtualizacao(
  baseId: string
): Promise<UltimaAtualizacaoResponse> {
  return apiFetch(`/upload/ultima-atualizacao/${baseId}`)
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

export type OverviewFiltros = {
  linha?: string
  familia?: string
  segmento?: string
  grupo?: string
  mercado?: string
  status_portfolio?: string
}

export type OverviewPeriodo = {
  mes?: number
  ano?: number
}

export type OverviewFiltrosComPeriodo = OverviewFiltros & OverviewPeriodo

function buildOverviewQuery(filtros?: OverviewFiltrosComPeriodo) {
  const params = new URLSearchParams()

  Object.entries(filtros || {}).forEach(([key, value]) => {
    const texto = String(value ?? "").trim()
    if (texto && texto !== "TODOS" && texto !== "TODAS") {
      params.set(key, texto)
    }
  })

  const query = params.toString()
  return query ? `?${query}` : ""
}

export async function getOverviewFiltrosProdutos() {
  return apiFetch("/overview/filtros-produtos")
}

export async function getOrcadoFaturamento(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/orcado-faturamento${buildOverviewQuery(filtros)}`)
}

export async function getOrcadoFaturamentoDetalhe(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/orcado-faturamento-detalhe${buildOverviewQuery(filtros)}`)
}

export async function getProjecaoFaturamento(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/projecao-faturamento${buildOverviewQuery(filtros)}`)
}

export async function getProjecaoLiberacoes(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/projecao-liberacoes${buildOverviewQuery(filtros)}`)
}

export async function getOrcadoLiberacao(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/orcado-liberacao${buildOverviewQuery(filtros)}`)
}

export async function getEntradasReaisMensal(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/entradas-reais-mensal${buildOverviewQuery(filtros)}`)
}

export async function getForecastMensal(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/forecast-mensal${buildOverviewQuery(filtros)}`)
}

export async function getVendasReaisMensal(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/vendas-reais-mensal${buildOverviewQuery(filtros)}`)
}

export async function getEstoqueMensal(filtros?: OverviewFiltros) {
  return apiFetch(`/overview/estoque-mensal${buildOverviewQuery(filtros)}`)
}

export async function getDisponibilidadeMensal(filtros?: OverviewFiltrosComPeriodo) {
  return apiFetch(`/overview/disponibilidade-mensal${buildOverviewQuery(filtros)}`)
}

export async function getAtendimentoSku(filtros?: OverviewFiltrosComPeriodo) {
  return apiFetch(`/overview/atendimento-sku${buildOverviewQuery(filtros)}`)
}

export async function getRastreamentoLotes(filtros?: OverviewPeriodo) {
  return apiFetch(`/overview/rastreamento-lotes${buildOverviewQuery(filtros)}`)
}

// ─────────────────────────────────────────────────────────────
//// ─────────────────────────────────────────────────────────────
// Produção
// ─────────────────────────────────────────────────────────────

export async function getProducaoResumoMensal(
  ano = 2026
) {
  return apiFetch(
    `/producao/resumo-mensal?ano=${ano}`
  )
}

export async function getParadasPareto(
  linha?: "L1" | "L2",
  ano = 2026,
  mes?: number
) {
  const params = new URLSearchParams()

  params.set("ano", String(ano))

  if (linha) {
    params.set("linha", linha)
  }

  if (mes) {
    params.set("mes", String(mes))
  }

  return apiFetch(
    `/producao/paradas-pareto?${params.toString()}`
  )
}

export async function getConfigProducao(
  ano = 2026
) {
  return apiFetch(
    `/producao/config-producao?ano=${ano}`
  )
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

export async function getMpsResumoMensal(
  ano = 2026
) {
  return apiFetch(
    `/producao/mps-resumo-mensal?ano=${ano}`
  )
}

export async function getMpsModal(
  mes: number,
  ano = 2026
) {
  return apiFetch(
    `/producao/mps-modal/${mes}?ano=${ano}`
  )
}

export async function getMpsComparativoRealPlanejado(
  ano = 2026
) {
  return apiFetch(
    `/producao/mps-comparativo-real-planejado?ano=${ano}`
  )
}

export async function getMpsVersoes(
  mes: number,
  ano = 2026
) {
  return apiFetch(
    `/producao/mps-versoes/${mes}?ano=${ano}`
  )
}

export async function getAnaliseCausaRaizProducao(
  ano = 2026,
  mes?: number
) {
  const params = new URLSearchParams()

  params.set("ano", String(ano))

  if (mes) {
    params.set("mes", String(mes))
  }

  return apiFetch(
    `/producao/analise-causa-raiz?${params.toString()}`
  )
}

// ─────────────────────────────────────────────────────────────
// MRP / APS
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

export interface MrpEtapa {
  id?: string
  rodada_id: string

  lote?: string | null
  op?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null

  etapa: string
  recurso: string
  linha_origem?: string | null

  data_inicio?: string | null
  data_fim?: string | null
  data_pa?: string | null

  qtd_planejada?: number
  duracao_horas?: number

  sequencia?: number | null
  status?: string

  origem?: string | null
  observacao?: string | null

  embalado?: string | null
  un_hora?: number | null
  mes_producao?: number | null
  ano_producao?: number | null
  mes_liberacao?: number | null
  ano_liberacao?: number | null
  mes_lib_manual?: boolean | null

  criado_em?: string
}

export interface MrpAlocacaoDia {
  id?: string
  rodada_id: string

  recurso: string

  lote?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null

  data: string

  horas_alocadas?: number
  horas_disponiveis_dia?: number

  origem?: string | null

  criado_em?: string
}

export interface MrpComparativoLiberacaoLinha {
  mes_liberacao: number
  ano_liberacao: number
  qtd_tubetes_anterior: number
  caixas_anterior: number
  qtd_tubetes_atual: number
  caixas_atual: number
  dif_tubetes: number
  dif_caixas: number
  variacao_pct?: number | null
  lotes_anterior: number
  lotes_atual: number
}

export interface MrpComparativoLiberacaoResponse {
  ok: boolean
  rodada_id: string
  tem_rodada_anterior: boolean
  rodada_atual: MrpRodada
  rodada_anterior?: MrpRodada | null
  total_qtd_tubetes_anterior: number
  total_caixas_anterior: number
  total_qtd_tubetes_atual: number
  total_caixas_atual: number
  dif_total_tubetes: number
  dif_total_caixas: number
  linhas: MrpComparativoLiberacaoLinha[]
}

export interface ImportarMpsResponse {
  ok: boolean
  rodada_id: string
  arquivo: string
  abas_lidas: {
    aba: string
    qtd_registros: number
    qtd_alocacoes?: number
  }[]
  total_registros: number
  total_inserido: number
  total_alocacoes?: number
}

export interface CopiarMrpRodadaPayload {
  nome?: string
  mes?: number
  ano?: number
  versao?: number
  observacao?: string | null
}

export interface MudancaRealizado {
  lote?: string | null
  lote_real_cogtive?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null
  recurso?: string | null

  data_inicio?: string | null
  data_fim_anterior?: string | null
  data_fim_nova?: string | null
  data_lib_nova?: string | null

  mes_liberacao_novo?: number | null
  ano_liberacao_novo?: number | null

  un_hora_anterior?: number | null
  un_hora_nova?: number | null
  duracao_horas_nova?: number | null
  qtd_planejada?: number | null

  motivo_provavel?: string | null
  metodo_casamento?: string | null

  impacto_dias?: number | null
  tipo_impacto?:
    | "atrasou"
    | "antecipou"
    | "sem_mudanca_data"
    | "sem_comparativo"
    | string

  delta_un_hora?: number | null
  delta_un_hora_pct?: number | null
}

export interface MrpMudancasRealizadoResponse {
  ok: boolean
  rodada_id: string
  total: number
  resumo_por_linha?: Record<
    string,
    {
      total: number
      atrasou: number
      antecipou: number
      sem_mudanca_data: number
      sem_comparativo: number
      [key: string]: number
    }
  >
  mudancas_realizado: MudancaRealizado[]
  lotes_atualizados: MudancaRealizado[]
}

export interface ImportarProducaoRealResponse {
  ok: boolean
  rodada_id: string
  arquivo: string

  total_apontamentos_lidos: number
  total_real_inserido: number
  total_lotes_atualizados?: number
  total_lotes_nao_encontrados?: number

  resumo_por_linha?: Record<
    string,
    {
      total: number
      atrasou: number
      antecipou: number
      sem_mudanca_data: number
      sem_comparativo: number
      [key: string]: number
    }
  >

  mudancas_realizado?: MudancaRealizado[]
  lotes_atualizados: MudancaRealizado[]

  lotes_nao_encontrados: {
    lote?: string | null
    recurso?: string | null
    data_real_fim?: string | null
    motivo_provavel?: string | null
  }[]
}

export async function getMrpRodadas(): Promise<MrpRodada[]> {
  return apiFetch("/mrp/rodadas")
}

export async function criarMrpRodada(
  payload: MrpRodada
): Promise<MrpRodada> {
  return apiFetch("/mrp/rodadas", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function excluirMrpRodada(rodadaId: string): Promise<{
  ok: boolean
  rodada_id: string
  alocacoes_excluidas: number
  etapas_excluidas: number
  rodada_excluida: MrpRodada | null
}> {
  return apiFetch(`/mrp/rodadas/${rodadaId}`, {
    method: "DELETE",
  })
}

export async function copiarMrpRodada(
  rodadaId: string,
  payload?: CopiarMrpRodadaPayload
): Promise<{
  ok: boolean
  rodada_origem_id: string
  nova_rodada: MrpRodada
  total_etapas: number
  total_alocacoes: number
}> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/copiar`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function getMrpEtapas(
  rodadaId: string
): Promise<MrpEtapa[]> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/etapas`)
}

export async function getMrpAlocacoes(
  rodadaId: string
): Promise<MrpAlocacaoDia[]> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/alocacoes`)
}

export async function getMrpMudancasRealizado(
  rodadaId: string
): Promise<MrpMudancasRealizadoResponse> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/mudancas-realizado`)
}

export async function getMrpComparativoLiberacao(
  rodadaId: string
): Promise<MrpComparativoLiberacaoResponse> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/comparativo-liberacao`)
}

export async function criarMrpEtapa(
  payload: MrpEtapa
): Promise<MrpEtapa> {
  return apiFetch("/mrp/etapas", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function atualizarMrpEtapa(
  etapaId: string,
  payload: Partial<MrpEtapa>
): Promise<MrpEtapa> {
  return apiFetch(`/mrp/etapas/${etapaId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function excluirMrpEtapa(etapaId: string) {
  return apiFetch(`/mrp/etapas/${etapaId}`, {
    method: "DELETE",
  })
}

export async function importarMrpMps(
  rodadaId: string,
  file: File
): Promise<ImportarMpsResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(
    `${API_URL}/mrp/rodadas/${rodadaId}/importar-mps`,
    {
      method: "POST",
      body: form,
    }
  )

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({
        detail: res.statusText,
      }))

    throw new Error(
      (err as { detail: string }).detail ||
        "Erro ao importar MPS"
    )
  }

  const payload = await res.json()
  clearApiCache()
  return payload
}

export async function importarMrpProducaoReal(
  rodadaId: string,
  file: File
): Promise<ImportarProducaoRealResponse> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(
    `${API_URL}/mrp/rodadas/${rodadaId}/importar-producao-real`,
    {
      method: "POST",
      body: form,
    }
  )

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({
        detail: res.statusText,
      }))

    throw new Error(
      (err as { detail: string }).detail ||
        "Erro ao importar produção real"
    )
  }

  const payload = await res.json()
  clearApiCache()
  return payload
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
  quantidade_programada?: number | null
  quantidade_teorica?: number | null
  qtd_teorica_abertura?: number | null
  quantidade_calculo?: number | null
  usa_lote_teorico?: boolean | null
  lote_teorico_encontrado?: boolean | null
  linha_lote_teorico?: string | null
  letra_lote_teorico?: string | null
  observacao_lote_teorico?: string | null
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


export interface ExcluirProgramacaoOpsMesResponse {
  ok: boolean
  mes_ref: string
  total_excluido: number
  ajustes_removidos?: number
  message?: string
}

export async function excluirProgramacaoOpsMes(
  mesRef: string
): Promise<ExcluirProgramacaoOpsMesResponse> {
  return apiFetch(`/ops/programacao/${encodeURIComponent(mesRef)}`, {
    method: "DELETE",
  })
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
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function editarParada(
  id: string,
  payload: Partial<ParadaProgramada>
) {
  return apiFetch(`/calendario-paradas/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
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
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function excluirAjusteCompraOP(id: string) {
  return apiFetch(`/ajustes-compras-ops/${id}`, {
    method: "DELETE",
  })
}

// ─────────────────────────────────────────────────────────────
// Análise MRP
// ─────────────────────────────────────────────────────────────

export interface AnaliseMrpGraficoPonto {
  ano: number
  mes: number
  mes_label: string
  consumo_real: number
  demanda_mrp: number
  estoque_mrp: number
  pedidos_mrp: number
  necessidade_mrp: number
  forecast?: number | null
}

export interface AnaliseMrpMaterial {
  codigo: string
  produto?: string | null
  descricao?: string | null
  unid?: string | null
  un?: string | null
  tipo?: string | null
  grupo?: string | null
  grupo_descricao?: string | null

  data_snapshot_consumo?: string | null
  data_snapshot_estoque?: string | null
  data_snapshot_mrp?: string | null

  estoque_real: number
  saldo_base_consumo: number

  media_3m: number
  media_6m: number
  media_9m: number
  maior_media: number
  maior_media_50: number

  cobertura_dias: number
  cobertura_base_consumo: number

  gap_consumo: number
  saldo_menos_maior_media_50: number

  estoque_mrp?: number | null
  demanda_mrp?: number | null
  pedidos_mrp?: number | null
  necessidade_mrp?: number | null
  gap_planejamento?: number | null

  mes_mrp?: number | null
  ano_mrp?: number | null
  mes_label_mrp?: string | null

  grafico?: AnaliseMrpGraficoPonto[]

  status:
    | "RUPTURA"
    | "CRITICO"
    | "ATENCAO"
    | "SAUDAVEL"
    | string

  causa_provavel?: string | null
}

export interface AnaliseMrpResumo {
  total_materiais: number
  ruptura: number
  criticos: number
  atencao: number
  saudaveis: number

  data_snapshot_consumo?: string | null
  data_snapshot_estoque?: string | null
  data_snapshot_mrp?: string | null
}

export async function getAnaliseMrpMateriais(): Promise<AnaliseMrpMaterial[]> {
  return apiFetch("/analise-mrp/materiais")
}

export async function getAnaliseMrpResumo(): Promise<AnaliseMrpResumo> {
  return apiFetch("/analise-mrp/resumo")
}

export async function getAnaliseMrpMaterial(
  codigo: string
): Promise<AnaliseMrpMaterial> {
  return apiFetch(`/analise-mrp/material/${codigo}`)
}

// ─── SD3 Realizado ────────────────────────────────────────────────────────────

export interface Sd3RealizadoItem {
  mes: number
  ano: number
  caixas: number
  caixas_l1: number
  caixas_l2: number
}

export async function getMrpSd3Realizado(ano: number): Promise<Sd3RealizadoItem[]> {
  return apiFetch(`/mrp/sd3-realizado?ano=${ano}`)
}


// ─────────────────────────────────────────────────────────────
// Gestão de Estoque / Aging e Cobertura
// ─────────────────────────────────────────────────────────────

export type AgingStatus =
  | "RUPTURA"
  | "CRITICO"
  | "ATENCAO"
  | "SAUDAVEL"
  | "EXCESSO"
  | "SEM_GIRO"
  | "SEM_CONSUMO"
  | string

export interface AgingPedidoAberto {
  pedido_numero?: string | null
  pedido?: string | null
  sc_numero?: string | null
  quantidade_pendente?: number
  quantidade?: number
  data_prevista_entrega?: string | null
  data_entrega?: string | null
  fornecedor?: string | null
  comprador?: string | null
  status_entrega?: string | null
}

export interface AgingHistoricoConsumo {
  periodo: string
  campo?: string
  consumo: number
}

export interface AgingEstoqueItem {
  codigo: string
  produto?: string | null
  unid?: string | null
  armaz?: string | null
  nome_2?: string | null
  tipo?: string | null
  grupo?: string | null
  grupo_descricao?: string | null

  saldo: number
  qtd_pedidos_abertos: number
  estoque_mais_pedidos: number

  media_3m: number
  media_6m: number
  media_9m: number
  maior_media: number

  lead_time_dias: number
  qtd_minima: number
  consumo_durante_lt?: number
  estoque_ideal: number

  cobertura_dias: number
  cobertura_futura_dias: number
  gap_volume: number

  giro_estoque?: number
  maior_media_50?: number
  saldo_menos_maior_media_50?: number

  menor_data_entrega?: string | null
  pedidos?: AgingPedidoAberto[]

  status: AgingStatus
  historico_consumo?: AgingHistoricoConsumo[]
}

export interface AgingResumo {
  total_itens: number
  ruptura: number
  critico: number
  atencao: number
  saudavel: number
  excesso: number
  sem_giro?: number
  saldo_total: number
  pedidos_total: number
  gap_total: number
  cobertura_media_dias: number
  cobertura_futura_media_dias: number
}

export interface AgingFaixaCobertura {
  faixa: string
  itens: number
}

export interface AgingPorTipo {
  tipo: string
  itens: number
  criticos: number
  excesso: number
  saldo: number
}

export interface AgingResumoResponse {
  data_snapshot_consumo?: string | null
  data_snapshot_mrp?: string | null
  resumo: AgingResumo
  faixas_cobertura?: AgingFaixaCobertura[]
  por_tipo?: AgingPorTipo[]
  top_excesso: AgingEstoqueItem[]
  top_criticos: AgingEstoqueItem[]
}

export interface AgingItensResponse {
  page: number
  page_size: number
  total: number
  total_pages: number
  itens: AgingEstoqueItem[]
}

// Mantido por compatibilidade com a versão anterior da tela.
export interface AgingDashboard extends AgingResumoResponse {
  total_itens?: number
  total_filtrado?: number
  itens: AgingEstoqueItem[]
}

export async function getAgingResumo(): Promise<AgingResumoResponse> {
  return apiFetch("/aging-estoque/resumo")
}

export async function getAgingItens(params?: {
  page?: number
  page_size?: number
  status?: string
  tipo?: string
  busca?: string
  sort_key?: string
  sort_direction?: "asc" | "desc"
}): Promise<AgingItensResponse> {
  const query = new URLSearchParams()

  query.set("page", String(params?.page || 1))
  query.set("page_size", String(params?.page_size || 100))

  if (params?.status && params.status !== "TODOS") {
    query.set("status", params.status)
  }

  if (params?.tipo && params.tipo !== "TODOS") {
    query.set("tipo", params.tipo)
  }

  if (params?.busca) {
    query.set("busca", params.busca)
  }

  if (params?.sort_key) {
    query.set("sort_key", params.sort_key)
  }

  if (params?.sort_direction) {
    query.set("sort_direction", params.sort_direction)
  }

  return apiFetch(`/aging-estoque/itens?${query.toString()}`)
}

// Compatibilidade: se alguma parte antiga ainda chamar dashboard,
// montamos o formato anterior usando os endpoints leves.
export async function getAgingEstoqueDashboard(params?: {
  status?: string
  tipo?: string
  busca?: string
}): Promise<AgingDashboard> {
  const [resumo, itens] = await Promise.all([
    getAgingResumo(),
    getAgingItens({
      page: 1,
      page_size: 100,
      status: params?.status,
      tipo: params?.tipo,
      busca: params?.busca,
    }),
  ])
  return {
    ...resumo,
    total_itens: resumo.resumo?.total_itens || itens.total,
    total_filtrado: itens.total,
    itens: itens.itens,
    faixas_cobertura: resumo.faixas_cobertura || [],
    por_tipo: resumo.por_tipo || [],
  }
}
export async function getAgingEstoqueItem(
  codigo: string
): Promise<AgingEstoqueItem> {
  return apiFetch(
    `/aging-estoque/item/${codigo}`
  )
}
// ─────────────────────────────────────────────────────────────
// Faturamento
// ─────────────────────────────────────────────────────────────

export async function getResumoFaturamento(params?: {
  ano?: number
  bloco?: string
}) {
  const query = new URLSearchParams()

  if (params?.ano) {
    query.set("ano", String(params.ano))
  }

  if (params?.bloco) {
    query.set("bloco", params.bloco)
  }

  const qs = query.toString()

  return apiFetch(
    `/faturamento/resumo${
      qs ? `?${qs}` : ""
    }`
  )
}

// ─────────────────────────────────────────────────────────────
// Desvios
// ─────────────────────────────────────────────────────────────

export async function getDesviosResumo() {
  return apiFetch("/desvios/resumo")
}

export async function getDesviosEventos() {
  return apiFetch("/desvios/eventos")
}

export async function getDesviosSnapshots() {
  return apiFetch("/desvios/snapshots")
}

export async function getDesviosAtuais() {
  return apiFetch("/desvios/atual")
}

export async function uploadDesvios(file: File) {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(`${API_URL}/desvios/upload`, {
    method: "POST",
    body: form,
  })

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: res.statusText }))

    throw new Error(
      (err as { detail: string }).detail ||
        "Erro ao subir arquivo de desvios"
    )
  }

  const payload = await res.json()
  clearApiCache()
  return payload
}


export async function limparDesvios() {
  return apiFetch("/desvios/limpar", {
    method: "DELETE",
  })
}

export const clearDesvios = limparDesvios

// ─────────────────────────────────────────────────────────────
// Prefetch em segundo plano
// ─────────────────────────────────────────────────────────────
// Objetivo:
// - Depois que o app abre, carregar as páginas mais usadas em background.
// - Como o apiFetch já tem cache de 12h + localStorage, esses dados ficam prontos
//   quando o usuário navegar para outras páginas.
// - O prefetch é escalonado para não disputar a primeira carga da Overview.

let appPrefetchStarted = false

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function safePrefetch(label: string, task: () => Promise<unknown>) {
  try {
    await task()
  } catch (err) {
    console.debug(`[prefetch] ${label} ignorado`, err)
  }
}

export function prefetchAppData(options?: { initialDelayMs?: number }) {
  if (appPrefetchStarted) {
    return () => undefined
  }

  if (typeof window === "undefined") {
    return () => undefined
  }

  appPrefetchStarted = true

  let cancelled = false
  const initialDelayMs = options?.initialDelayMs ?? 5000

  const timer = window.setTimeout(() => {
    void (async () => {
      if (cancelled) return

      const hoje = new Date()
      const ano = hoje.getFullYear()
      const mes = hoje.getMonth() + 1
      const mesRefAtual = `${ano}-${String(mes).padStart(2, "0")}`

      // 1) Overview e indicadores principais.
      // Se a usuária já abriu a Overview, essas chamadas reaproveitam a mesma promise/cache.
      await Promise.allSettled([
        safePrefetch("overview/projecao-faturamento", () => getProjecaoFaturamento()),
        safePrefetch("overview/projecao-liberacoes", () => getProjecaoLiberacoes()),
        safePrefetch("overview/orcado-faturamento", () => getOrcadoFaturamento()),
        safePrefetch("overview/orcado-liberacao", () => getOrcadoLiberacao()),
        safePrefetch("overview/estoque-mensal", () => getEstoqueMensal()),
        safePrefetch("overview/disponibilidade-mensal", () => getDisponibilidadeMensal({ mes, ano })),
        safePrefetch("overview/rastreamento-lotes", () => getRastreamentoLotes({ mes, ano })),
      ])

      if (cancelled) return
      await delay(1200)

      // 2) Ordens — busca os meses e pré-carrega o mês atual quando existir.
      await safePrefetch("ops", async () => {
        const resp = await getOpsMeses()
        const meses = Array.isArray(resp?.meses) ? resp.meses : []
        const mesRef = meses.includes(mesRefAtual) ? mesRefAtual : meses[meses.length - 1]

        if (!mesRef) return

        await Promise.allSettled([
          getOpsViabilidade(mesRef),
          getOpsResumo(mesRef),
        ])
      })

      if (cancelled) return
      await delay(1200)

      // 3) Desvios — tela normalmente usada junto com Overview/Ordens.
      await Promise.allSettled([
        safePrefetch("desvios/resumo", () => getDesviosResumo()),
        safePrefetch("desvios/eventos", () => getDesviosEventos()),
        safePrefetch("desvios/snapshots", () => getDesviosSnapshots()),
        safePrefetch("desvios/atual", () => getDesviosAtuais()),
      ])

      if (cancelled) return
      await delay(1200)

      // 4) Produção/MPS/Faturamento — pré-carrega só os endpoints de resumo.
      await Promise.allSettled([
        safePrefetch("producao/resumo", () => getProducaoResumoMensal(ano)),
        safePrefetch("producao/mps-resumo", () => getMpsResumoMensal(ano)),
        safePrefetch("producao/mps-comparativo", () => getMpsComparativoRealPlanejado(ano)),
        safePrefetch("mrp/rodadas", () => getMrpRodadas()),
        safePrefetch("analise-mrp/resumo", () => getAnaliseMrpResumo()),
        safePrefetch("faturamento/resumo", () => getResumoFaturamento({ ano })),
      ])
    })()
  }, initialDelayMs)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}

