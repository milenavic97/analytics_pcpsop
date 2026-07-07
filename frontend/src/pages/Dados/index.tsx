import { useState, useEffect, useRef } from "react"
import { useParams, NavLink } from "react-router-dom"
import {
  Upload, Download, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw,
  Package, CalendarCheck, TrendingUp, ShoppingCart,
  PackageCheck, Warehouse, Factory, BarChart3, ClipboardList, DollarSign,
} from "lucide-react"
import { BASES } from "@/data/bases"
import { uploadBase, getUploadStatus, getDados, inserirRegistro, atualizarRegistro, excluirRegistros, UploadBaseError } from "@/services/api"
import { DataTable } from "@/components/ui/DataTable"
import { RowModal } from "@/components/ui/RowModal"

const ICON_MAP: Record<string, React.ElementType> = {
  Package, CalendarCheck, TrendingUp, ShoppingCart,
  PackageCheck, Warehouse, Factory, BarChart3, ClipboardList, DollarSign,
}

type StatusLocal = { status: string; nome_arquivo?: string; total_registros?: number }

type ResultadoUpload = {
  total: number
  erros: string[]
  logProdutosCsv?: string | null
  logProdutosNome?: string | null
  modoCarga?: string | null
  periodosSubstituidos?: { ano: number; mes: number; mes_ref?: string }[]
  primeiraDataArquivo?: string | null
  ultimaDataArquivo?: string | null
}

const MARCADOR_LOG_FORECAST = "LOG_PRODUTOS_NAO_ENCONTRADOS_FORECAST:"

function extrairLogProdutosForecast(erros: string[]) {
  const erroComLog = erros.find((erro) => erro.includes(MARCADOR_LOG_FORECAST))
  if (!erroComLog) return null

  const csv = erroComLog
    .split(MARCADOR_LOG_FORECAST)[1]
    ?.trim()

  if (!csv) return null

  return csv
}

function limparErrosParaTela(erros: string[]) {
  return erros.map((erro) => {
    if (!erro.includes(MARCADOR_LOG_FORECAST)) return erro

    const primeiraLinha = erro.split("\n")[0]?.trim()
    return primeiraLinha || "Log de produtos não encontrados gerado para download."
  })
}

function baixarArquivoTexto(nomeArquivo: string, conteudo: string) {
  const blob = new Blob(["\ufeff" + conteudo], {
    type: "text/csv;charset=utf-8;",
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = nomeArquivo
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function errosDoUploadPayload(payload: unknown) {
  const p = payload as {
    detail?: string | string[]
    erros?: string[]
  }

  const erros: string[] = []

  if (Array.isArray(p?.erros)) erros.push(...p.erros.map(String))

  if (Array.isArray(p?.detail)) erros.push(...p.detail.map(String))
  else if (p?.detail) erros.push(String(p.detail))

  return erros
}


function StatusBadge({ status }: { status: string }) {
  if (status === "sucesso")     return <span className="badge-ok"><CheckCircle size={11} /> Atualizado</span>
  if (status === "erro")        return <span className="badge-erro"><XCircle size={11} /> Erro</span>
  if (status === "processando") return <span className="badge-warn"><Clock size={11} /> Processando</span>
  return <span className="badge-neutral"><AlertCircle size={11} /> Sem dados</span>
}

export function DadosPage() {
  const { baseId } = useParams<{ baseId: string }>()
  const base = baseId ? BASES.find(b => b.id === baseId) : null

  return (
    <div className="flex h-full" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex-shrink-0 py-4 px-2"
        style={{ width: 224, borderRight: "1px solid var(--border)", background: "var(--bg-secondary)" }}
      >
        <p className="card-label" style={{ padding: "0 12px", display: "block", marginBottom: 12 }}>
          Bases de dados
        </p>

        {BASES.map(b => {
          const Icon = ICON_MAP[b.icone] || Package
          const active = baseId === b.id

          return (
            <NavLink
              key={b.id}
              to={`/dados/${b.id}`}
              className="flex items-center gap-2 rounded-lg text-sm"
              style={{
                padding: "8px 12px",
                marginBottom: 2,
                background: active ? "#EFF6FF" : "transparent",
                color: active ? "#1D4ED8" : "var(--text-secondary)",
                fontWeight: active ? 500 : 400,
                textDecoration: "none",
                transition: "background 0.15s",
              }}
            >
              <Icon size={15} className="flex-shrink-0" />
              <span className="truncate">{b.label}</span>
            </NavLink>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!base ? (
          <div
            className="flex flex-col items-center justify-center text-sm"
            style={{ height: 256, color: "var(--text-secondary)" }}
          >
            <Package size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>Selecione uma base de dados no menu lateral</p>
          </div>
        ) : (
          <BaseDetail base={base} />
        )}
      </div>
    </div>
  )
}

function BaseDetail({ base }: { base: typeof BASES[0] }) {
  const [status, setStatus]               = useState<StatusLocal>({ status: "sem_dados" })
  const [uploading, setUploading]         = useState(false)
  const [resultado, setResultado]         = useState<ResultadoUpload | null>(null)
  const [dados, setDados]                 = useState<Record<string, unknown>[]>([])
  const [total, setTotal]                 = useState(0)
  const [page, setPage]                   = useState(1)
  const [loading, setLoading]             = useState(false)
  const [modalAberto, setModalAberto]     = useState(false)
  const [linhaEditando, setLinhaEditando] = useState<Record<string, unknown> | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const requestSeqRef = useRef(0)
  const Icon = ICON_MAP[base.icone] || Package

  const carregarStatus = async () => {
    try {
      const s = await getUploadStatus(base.id)
      setStatus(s as StatusLocal)
    } catch (_) {
    }
  }

  const carregarDados = async (p: number, limparAntes = false) => {
    const requestSeq = ++requestSeqRef.current

    if (limparAntes) {
      setDados([])
      setTotal(0)
    }

    setLoading(true)

    try {
      const res = await getDados(base.id, p) as { data: Record<string, unknown>[]; total: number }

      // Evita que uma resposta antiga sobrescreva a tela depois de upload/delete/refetch.
      if (requestSeq !== requestSeqRef.current) return

      setDados(res.data ?? [])
      setTotal(res.total ?? 0)
    } catch (_) {
      if (requestSeq === requestSeqRef.current) {
        setDados([])
        setTotal(0)
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false)
      }
    }
  }

  const recarregarTela = async (p = page, limparAntes = false) => {
    await Promise.all([
      carregarStatus(),
      carregarDados(p, limparAntes),
    ])
  }

  useEffect(() => {
    requestSeqRef.current += 1
    setResultado(null)
    setPage(1)
    setDados([])
    setTotal(0)

    recarregarTela(1, true)
  }, [base.id])

  useEffect(() => {
    const recarregarSeVisivel = () => {
      if (document.visibilityState === "visible") {
        recarregarTela(page, false)
      }
    }

    window.addEventListener("focus", recarregarSeVisivel)
    document.addEventListener("visibilitychange", recarregarSeVisivel)

    // Mantém a tela sincronizada entre usuários/sessões.
    // Não é cache longo: se alguém troca a base, todos veem a atualização no próximo ciclo.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !uploading) {
        recarregarTela(page, false)
      }
    }, 30000)

    return () => {
      window.removeEventListener("focus", recarregarSeVisivel)
      document.removeEventListener("visibilitychange", recarregarSeVisivel)
      window.clearInterval(intervalId)
    }
  }, [base.id, page, uploading])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setResultado(null)

    try {
      const res = await uploadBase(base.id, file)
      const payload = res as {
        erros?: string[]
        total_inserido?: number
        modo_carga?: string | null
        periodos_substituidos?: { ano: number; mes: number; mes_ref?: string }[]
        primeira_data_arquivo?: string | null
        ultima_data_arquivo?: string | null
      }

      const errosOriginais = payload.erros ?? []
      const logProdutosCsv = extrairLogProdutosForecast(errosOriginais)
      const errosTela = limparErrosParaTela(errosOriginais)
      const totalInserido = payload.total_inserido ?? 0

      setResultado({
        total: totalInserido,
        erros: errosTela,
        logProdutosCsv,
        logProdutosNome: logProdutosCsv ? `produtos_nao_encontrados_forecast_${new Date().toISOString().slice(0, 10)}.csv` : null,
        modoCarga: payload.modo_carga ?? null,
        periodosSubstituidos: payload.periodos_substituidos ?? [],
        primeiraDataArquivo: payload.primeira_data_arquivo ?? null,
        ultimaDataArquivo: payload.ultima_data_arquivo ?? null,
      })

      setStatus({
        status: errosOriginais.length ? "erro" : "sucesso",
        nome_arquivo: file.name,
        total_registros: totalInserido,
      })

      if (!errosOriginais.length) {
        setPage(1)
        await recarregarTela(1, true)
      }
    } catch (err: unknown) {
      let erros = [err instanceof Error ? err.message : "Erro desconhecido"]

      if (err instanceof UploadBaseError) {
        const errosPayload = errosDoUploadPayload(err.payload)
        if (errosPayload.length) erros = errosPayload
      }

      const logProdutosCsv = extrairLogProdutosForecast(erros)
      const errosTela = limparErrosParaTela(erros)

      setResultado({
        total: 0,
        erros: errosTela,
        logProdutosCsv,
        logProdutosNome: logProdutosCsv ? `produtos_nao_encontrados_forecast_${new Date().toISOString().slice(0, 10)}.csv` : null,
      })
      setStatus({ status: "erro" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  const handleDelete = async (ids: string[]) => {
    if (!window.confirm(`Excluir ${ids.length} registro(s)?`)) return

    try {
      await excluirRegistros(base.id, ids)
      await recarregarTela(page, true)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao excluir")
    }
  }

  const handleSave = async (formData: Record<string, string>) => {
    try {
      if (linhaEditando) {
        const pk = String(linhaEditando.id ?? linhaEditando.cod_produto ?? "")
        await atualizarRegistro(base.id, pk, formData)
      } else {
        await inserirRegistro(base.id, formData)
      }

      await recarregarTela(page, true)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao salvar")
    }
  }

  const colunas: string[] = base.colunasVisiveis
    ? base.colunasVisiveis.map(c => c.key)
    : dados.length > 0
      ? Object.keys(dados[0]).filter(c => c !== "id" && c !== "created_at")
      : base.colunas

  const colunasLabels: Record<string, string> | undefined = base.colunasVisiveis
    ? Object.fromEntries(base.colunasVisiveis.map(c => [c.key, c.label]))
    : undefined

  return (
    <div className="space-y-6 fade-in">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={18} style={{ color: "var(--text-secondary)" }} />
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {base.label}
          </h1>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {base.descricao}
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge status={status.status} />
              {status.nome_arquivo && (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {status.nome_arquivo}
                </span>
              )}
            </div>

            <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
              Colunas esperadas:
            </p>

            <div className="flex flex-wrap gap-1.5">
              {base.colunas.map(c => (
                <span key={c} className="badge-neutral" style={{ fontFamily: "monospace", fontSize: 10 }}>
                  {c}
                </span>
              ))}
            </div>

            {status.total_registros != null && (
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
                Última carga: {status.total_registros.toLocaleString("pt-BR")} registros
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={loading || uploading}
              onClick={() => recarregarTela(page, true)}
              className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 font-medium"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                background: "transparent",
                cursor: loading || uploading ? "not-allowed" : "pointer",
                opacity: loading || uploading ? 0.6 : 1,
              }}
            >
              <RefreshCw size={14} />
              Atualizar
            </button>

            {base.template && (
              <a
                href={`/templates/${base.template}`}
                download={base.template}
                className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  background: "transparent",
                }}
              >
                <Download size={14} /> Template
              </a>
            )}

            <button
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 text-white font-medium"
              style={{
                background: uploading ? "#93C5FD" : "#2563EB",
                border: "none",
                cursor: uploading ? "not-allowed" : "pointer",
              }}
            >
              <Upload size={14} />
              {uploading ? "Processando..." : "Upload"}
            </button>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        {resultado && (
          <div
            className="mt-4 p-3 rounded-lg text-sm"
            style={{
              background: resultado.erros.length ? "#FEF2F2" : "#F0FDF4",
              border: `1px solid ${resultado.erros.length ? "#FECACA" : "#BBF7D0"}`,
              color: resultado.erros.length ? "#991B1B" : "#166534",
            }}
          >
            {resultado.erros.length === 0 ? (
              <div>
                <span className="flex items-center gap-2">
                  <CheckCircle size={14} />
                  {resultado.total.toLocaleString("pt-BR")} registros carregados com sucesso.
                </span>

                {(resultado.modoCarga || resultado.periodosSubstituidos?.length || resultado.primeiraDataArquivo || resultado.ultimaDataArquivo) && (
                  <div className="mt-2 text-xs" style={{ opacity: 0.8 }}>
                    {resultado.modoCarga && (
                      <p>Modo da carga: {resultado.modoCarga === "replace_month" ? "substituição mensal" : resultado.modoCarga}</p>
                    )}

                    {!!resultado.periodosSubstituidos?.length && (
                      <p>
                        Período substituído: {resultado.periodosSubstituidos.map(p => p.mes_ref || `${p.ano}-${String(p.mes).padStart(2, "0")}`).join(", ")}
                      </p>
                    )}

                    {(resultado.primeiraDataArquivo || resultado.ultimaDataArquivo) && (
                      <p>
                        Datas do arquivo: {resultado.primeiraDataArquivo || "-"} até {resultado.ultimaDataArquivo || "-"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="flex items-center gap-2 mb-1">
                  <XCircle size={14} /> {resultado.erros.length} erro(s) encontrado(s)
                </p>

                {resultado.erros.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-xs ml-5" style={{ opacity: 0.75 }}>
                    • {e}
                  </p>
                ))}

                {resultado.logProdutosCsv && (
                  <button
                    type="button"
                    onClick={() => baixarArquivoTexto(
                      resultado.logProdutosNome || "produtos_nao_encontrados_forecast.csv",
                      resultado.logProdutosCsv || ""
                    )}
                    className="mt-3 ml-5 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium"
                    style={{
                      border: "1px solid #FCA5A5",
                      color: "#991B1B",
                    }}
                  >
                    <Download size={14} />
                    Baixar log de produtos não encontrados
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <DataTable
        colunas={colunas}
        colunasLabels={colunasLabels}
        dados={dados}
        total={total}
        page={page}
        loading={loading}
        onPageChange={p => {
          setPage(p)
          carregarDados(p, true)
        }}
        onDelete={handleDelete}
        onEdit={row => {
          setLinhaEditando(row)
          setModalAberto(true)
        }}
        onAdd={() => {
          setLinhaEditando(undefined)
          setModalAberto(true)
        }}
      />

      <RowModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onSave={handleSave}
        colunas={colunas}
        dados={linhaEditando}
        titulo={linhaEditando ? "Editar registro" : "Adicionar registro"}
      />
    </div>
  )
}
