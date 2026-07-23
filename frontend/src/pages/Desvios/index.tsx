import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Download,
  FileWarning,
  History,
  Trash2,
  Upload,
  Undo2,
  CheckCircle2,
} from "lucide-react"

import {
  getDesviosResumo,
  getDesviosEventos,
  getDesviosSnapshots,
  getDesviosAtuais,
  getDesviosHistoricoAnual,
  uploadDesvios,
  limparDesvios,
} from "@/services/api"
import { getAuthHeaders } from "@/lib/authHeaders"

const API_URL = String(import.meta.env.VITE_API_URL || "https://dfl-sop-api.fly.dev").replace(/\/$/, "")
const MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

type Evento = {
  id?: string
  data_evento?: string
  tipo_evento: string
  serial?: string
  lote?: string
  descricao?: string
}

type Snapshot = {
  snapshot_id: string
  data_upload: string
  arquivo_origem?: string
  total_lotes: number
  total_desvios: number
}

type LoteDesvio = {
  lote: string
  data_lib?: string | null
  mes_lib?: number | string | null
  ano_lib?: number | string | null
  grupo_produto?: string | null
  linha?: string | null
  qtd_prevista?: number | null
}

type LoteRevertido = {
  lote: string
  serial_nc?: string | null
  mes_origem?: number | null
  ano_origem?: number | null
  mes_liberacao: number
  ano_liberacao: number
  motivo?: string | null
}

type Desvio = {
  serial: string
  estado?: string
  destino?: string
  setor?: string
  titulo?: string
  dias_desvio?: number
  qtd_lotes: number
  lotes_texto: string
  lotes?: LoteDesvio[]
  meses_lib_texto?: string
  grupos_produto_texto?: string
  linhas_texto?: string
  qtd_prevista_total?: number
}

type HistoricoDesvio = Desvio & {
  situacao_historico?: "Aberto" | "Fechado" | string
  primeiro_upload?: string | null
  ultimo_upload?: string | null
  fechado_detectado_em?: string | null
  lotes_revertidos?: LoteRevertido[]
}

type Resumo = {
  total_lotes: number
  total_desvios: number
  novos_lotes: number
  lotes_removidos: number
  desvios_fechados?: number
  novos_desvios?: number
  alteracoes: number
}

function formatNumero(valor?: number) {
  if (!valor) return "-"
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(valor)
}

function normalizarTextoFiltro(valor?: string | null) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
}

function matchDestinoHistorico(destino: string | undefined, filtro: string) {
  const destinoNorm = normalizarTextoFiltro(destino)
  const filtroNorm = normalizarTextoFiltro(filtro)

  if (!filtroNorm || filtroNorm === "TODOS") return true

  if (filtroNorm === "SEM DESTINO") {
    return !destinoNorm || destinoNorm === "-" || destinoNorm === "—"
  }

  if (filtroNorm === "DESCARTADO") {
    return destinoNorm.includes("DESCART")
  }

  return destinoNorm.includes(filtroNorm)
}

function ehDestinoDescartado(destino?: string | null) {
  return normalizarTextoFiltro(destino).includes("DESCART")
}

function csvEscape(valor: unknown) {
  const texto = String(valor ?? "")
  return `"${texto.replace(/"/g, '""')}"`
}

function baixarCsv(nomeArquivo: string, linhas: string[][]) {
  const conteudo = "\ufeff" + linhas.map((linha) => linha.map(csvEscape).join(";")).join("\n")
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.href = url
  link.download = nomeArquivo
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}


function garantirArray<T>(valor: unknown): T[] {
  if (Array.isArray(valor)) return valor as T[]

  const obj = valor as { data?: unknown; items?: unknown; results?: unknown }

  if (Array.isArray(obj?.data)) return obj.data as T[]
  if (Array.isArray(obj?.items)) return obj.items as T[]
  if (Array.isArray(obj?.results)) return obj.results as T[]

  return []
}

function garantirResumo(valor: unknown): Resumo | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null
  return valor as Resumo
}

function renderDestinoTag(destino?: string) {
  if (!destino || destino === "-") {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
        -
      </span>
    )
  }

  const texto = destino.toLowerCase()

  if (texto.includes("descart")) {
    return (
      <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
        Descartado
      </span>
    )
  }

  if (texto.includes("reprovado")) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
        Reprovado
      </span>
    )
  }

  if (texto.includes("aprovado")) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
        Aprovado
      </span>
    )
  }

  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      {destino}
    </span>
  )
}

function renderEstadoTag(estado?: string) {
  if (!estado) return "-"

  const cor =
    estado === "6"
      ? "bg-emerald-100 text-emerald-700"
      : estado === "4"
      ? "bg-red-100 text-red-700"
      : estado === "2"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-700"

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cor}`}>
      {estado}
    </span>
  )
}

function renderSituacaoHistoricoTag(situacao?: string) {
  const fechado = String(situacao || "").toLowerCase().includes("fechado")

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-semibold ${
        fechado
          ? "bg-slate-100 text-slate-700"
          : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {fechado ? "Fechado" : "Aberto"}
    </span>
  )
}

function formatDataHora(valor?: string | null) {
  if (!valor) return "-"

  const dt = new Date(valor)

  if (Number.isNaN(dt.getTime())) return String(valor)

  return dt
    .toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", " às")
}

async function reverterLoteReprovado(
  lote: string,
  mesLiberacao: number,
  anoLiberacao: number,
  motivo: string
): Promise<void> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_URL}/desvios/lotes-reprovados/reverter`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      lote,
      mes_liberacao: mesLiberacao,
      ano_liberacao: anoLiberacao,
      motivo: motivo || null,
    }),
  })
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null)
    throw new Error(detalhe?.detail || `Erro ao marcar lote como liberado (${res.status})`)
  }
}

async function removerReversaoLoteReprovado(lote: string): Promise<void> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_URL}/desvios/lotes-reprovados/reverter/${encodeURIComponent(lote)}`,
    { method: "DELETE", headers: authHeaders }
  )
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null)
    throw new Error(detalhe?.detail || `Erro ao desfazer reversão (${res.status})`)
  }
}

export default function DesviosPage() {
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false)

  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erroUpload, setErroUpload] = useState("")

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [desvios, setDesvios] = useState<Desvio[]>([])
  const [historico, setHistorico] = useState<HistoricoDesvio[]>([])

  const [busca, setBusca] = useState("")
  const [filtroMes, setFiltroMes] = useState("TODOS")
  const [anoHistorico, setAnoHistorico] = useState("2026")
  const [filtroSituacaoHistorico, setFiltroSituacaoHistorico] = useState("TODOS")
  const [filtroDestinoHistorico, setFiltroDestinoHistorico] = useState("TODOS")
  const [historicoSelecionado, setHistoricoSelecionado] = useState<Set<string>>(new Set())

  // Reversão de lote reprovado/descartado -- ver migration
  // 013_lotes_reprovacao_revertida.sql. Modal aberto ao clicar num lote
  // descartado, pra marcar que ele foi liberado de verdade depois.
  const hoje = new Date()
  const [modalReverter, setModalReverter] = useState<{ lote: string; serial: string } | null>(null)
  const [mesReverterForm, setMesReverterForm] = useState(hoje.getMonth() + 1)
  const [anoReverterForm, setAnoReverterForm] = useState(hoje.getFullYear())
  const [motivoReverterForm, setMotivoReverterForm] = useState("")
  const [salvandoReversao, setSalvandoReversao] = useState(false)
  const [erroReversao, setErroReversao] = useState<string | null>(null)
  const [desfazendoLote, setDesfazendoLote] = useState<string | null>(null)

  async function carregar() {
    try {
      setLoading(true)

      const ano = Number(anoHistorico) || new Date().getFullYear()

      const [resumoResp, eventosResp, snapshotsResp, desviosResp, historicoResp] =
        await Promise.all([
          getDesviosResumo(),
          getDesviosEventos(),
          getDesviosSnapshots(),
          getDesviosAtuais(),
          getDesviosHistoricoAnual(ano).catch(() => [] as HistoricoDesvio[]),
        ])

      setResumo(garantirResumo(resumoResp))
      setEventos(garantirArray<Evento>(eventosResp))
      setSnapshots(garantirArray<Snapshot>(snapshotsResp))
      setDesvios(garantirArray<Desvio>(desviosResp))
      setHistorico(garantirArray<HistoricoDesvio>(historicoResp))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [anoHistorico])

  useEffect(() => {
    setHistoricoSelecionado(new Set())
  }, [anoHistorico, filtroSituacaoHistorico, filtroDestinoHistorico, busca])

  async function handleUpload() {
    if (!arquivo) return

    try {
      setUploading(true)
      setErroUpload("")

      const resp = (await uploadDesvios(arquivo)) as {
        erros?: string[]
      }

      if (resp?.erros?.length) {
        setErroUpload(resp.erros.join(" | "))
        return
      }

      setArquivo(null)
      await carregar()
    } catch (err) {
      console.error(err)
      setErroUpload(
        err instanceof Error ? err.message : "Erro ao subir arquivo."
      )
    } finally {
      setUploading(false)
    }
  }

  async function handleLimparDados() {
    try {
      setLoading(true)
      setErroUpload("")

      await limparDesvios()

      setArquivo(null)
      setResumo(null)
      setEventos([])
      setSnapshots([])
      setDesvios([])
      setHistorico([])
      setConfirmarLimpeza(false)

      await carregar()
    } catch (err) {
      console.error(err)
      setErroUpload(
        err instanceof Error
          ? err.message
          : "Erro ao limpar dados de desvios."
      )
    } finally {
      setLoading(false)
    }
  }

  function abrirModalReverter(lote: string, serial: string) {
    setModalReverter({ lote, serial })
    setMesReverterForm(hoje.getMonth() + 1)
    setAnoReverterForm(hoje.getFullYear())
    setMotivoReverterForm("")
    setErroReversao(null)
  }

  function fecharModalReverter() {
    if (salvandoReversao) return
    setModalReverter(null)
    setErroReversao(null)
  }

  async function confirmarReversao() {
    if (!modalReverter) return

    setSalvandoReversao(true)
    setErroReversao(null)
    try {
      await reverterLoteReprovado(
        modalReverter.lote,
        mesReverterForm,
        anoReverterForm,
        motivoReverterForm.trim()
      )
      setModalReverter(null)
      await carregar()
    } catch (err) {
      setErroReversao(
        err instanceof Error ? err.message : "Não foi possível marcar o lote como liberado."
      )
    } finally {
      setSalvandoReversao(false)
    }
  }

  async function desfazerReversao(lote: string) {
    if (!window.confirm(`Desfazer a reversão do lote ${lote}? Ele volta a contar como reprovação/desvio normalmente.`)) {
      return
    }

    setDesfazendoLote(lote)
    try {
      await removerReversaoLoteReprovado(lote)
      await carregar()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Não foi possível desfazer a reversão.")
    } finally {
      setDesfazendoLote(null)
    }
  }

  const desviosSafe = garantirArray<Desvio>(desvios)
  const eventosSafe = garantirArray<Evento>(eventos)
  const snapshotsSafe = garantirArray<Snapshot>(snapshots)
  const historicoSafe = garantirArray<HistoricoDesvio>(historico)

  const mesesDisponiveis = useMemo(() => {
    const meses = new Set<string>()

    desviosSafe.forEach((d) => {
      if (!d.meses_lib_texto) return

      d.meses_lib_texto
        .split(",")
        .map((x) => x.trim())
        .forEach((m) => meses.add(m))
    })

    return Array.from(meses).sort()
  }, [desviosSafe])

  const desviosFiltrados = useMemo(() => {
    return desviosSafe.filter((d) => {
      const termo = busca.toLowerCase()

      const passouBusca =
        !termo ||
        String(d.serial || "").toLowerCase().includes(termo) ||
        String(d.destino || "").toLowerCase().includes(termo) ||
        String(d.estado || "").toLowerCase().includes(termo) ||
        String(d.setor || "").toLowerCase().includes(termo) ||
        String(d.titulo || "").toLowerCase().includes(termo) ||
        String(d.lotes_texto || "").toLowerCase().includes(termo)

      const passouMes =
        filtroMes === "TODOS" ||
        String(d.meses_lib_texto || "").includes(filtroMes)

      return passouBusca && passouMes
    })
  }, [desviosSafe, busca, filtroMes])

  const historicoFiltrado = useMemo(() => {
    return historicoSafe.filter((d) => {
      const termo = busca.toLowerCase()

      const passouBusca =
        !termo ||
        String(d.serial || "").toLowerCase().includes(termo) ||
        String(d.destino || "").toLowerCase().includes(termo) ||
        String(d.estado || "").toLowerCase().includes(termo) ||
        String(d.setor || "").toLowerCase().includes(termo) ||
        String(d.titulo || "").toLowerCase().includes(termo) ||
        String(d.lotes_texto || "").toLowerCase().includes(termo)

      const passouSituacao =
        filtroSituacaoHistorico === "TODOS" ||
        String(d.situacao_historico || "").toLowerCase() ===
          filtroSituacaoHistorico.toLowerCase()

      const passouDestino = matchDestinoHistorico(d.destino, filtroDestinoHistorico)

      return passouBusca && passouSituacao && passouDestino
    })
  }, [historicoSafe, busca, filtroSituacaoHistorico, filtroDestinoHistorico])

  const historicoFiltradoSerials = useMemo(
    () => historicoFiltrado.map((item) => item.serial).filter(Boolean),
    [historicoFiltrado]
  )

  const todosHistoricoFiltradosSelecionados =
    historicoFiltradoSerials.length > 0 &&
    historicoFiltradoSerials.every((serial) => historicoSelecionado.has(serial))

  const historicoParaExportar = useMemo(() => {
    const selecionados = historicoFiltrado.filter((item) =>
      historicoSelecionado.has(item.serial)
    )

    return selecionados.length ? selecionados : historicoFiltrado
  }, [historicoFiltrado, historicoSelecionado])

  function toggleSelecionarHistorico(serial: string) {
    setHistoricoSelecionado((prev) => {
      const next = new Set(prev)

      if (next.has(serial)) next.delete(serial)
      else next.add(serial)

      return next
    })
  }

  function toggleSelecionarTodosHistoricoFiltrado() {
    setHistoricoSelecionado((prev) => {
      const next = new Set(prev)

      if (todosHistoricoFiltradosSelecionados) {
        historicoFiltradoSerials.forEach((serial) => next.delete(serial))
      } else {
        historicoFiltradoSerials.forEach((serial) => next.add(serial))
      }

      return next
    })
  }

  function exportarHistoricoSelecionado() {
    if (!historicoParaExportar.length) return

    const linhas = [
      [
        "Situacao",
        "Desvio",
        "Estado",
        "Destino",
        "Descricao",
        "Qtd lotes",
        "Lotes",
        "Mes impactado",
        "Linha",
        "Grupo",
        "Qtd prevista",
        "Primeiro upload",
        "Ultimo upload",
        "Fechado detectado em",
        "Setor",
      ],
      ...historicoParaExportar.map((item) => [
        item.situacao_historico || "",
        item.serial || "",
        String(item.estado ?? ""),
        String(item.destino ?? ""),
        item.titulo || "",
        String(item.qtd_lotes ?? 0),
        item.lotes_texto || "",
        item.meses_lib_texto || "",
        item.linhas_texto || "",
        item.grupos_produto_texto || "",
        String(item.qtd_prevista_total ?? 0),
        item.primeiro_upload || "",
        item.ultimo_upload || "",
        item.fechado_detectado_em || "",
        item.setor || "",
      ]),
    ]

    const sufixo =
      historicoSelecionado.size > 0
        ? "selecionados"
        : filtroDestinoHistorico !== "TODOS"
          ? filtroDestinoHistorico.toLowerCase().replace(/\s+/g, "_")
          : "filtrados"

    baixarCsv(`historico_desvios_${anoHistorico}_${sufixo}.csv`, linhas)
  }



  const novosLotes = eventosSafe.filter((e) => e.tipo_evento === "NOVO_LOTE")
  const lotesRemovidos = eventosSafe.filter((e) => e.tipo_evento === "LOTE_REMOVIDO")
  const novosDesvios = eventosSafe.filter((e) => e.tipo_evento === "NOVO_DESVIO")
  const desviosFechados = eventosSafe.filter((e) =>
    ["DESVIO_FECHADO", "DESVIO_REMOVIDO"].includes(e.tipo_evento)
  )
  const alteracoesGerais = eventosSafe.filter(
    (e) =>
      ![
        "NOVO_LOTE",
        "LOTE_REMOVIDO",
        "NOVO_DESVIO",
        "DESVIO_FECHADO",
        "DESVIO_REMOVIDO",
      ].includes(e.tipo_evento)
  )

  const temAlteracoes =
    novosLotes.length ||
    lotesRemovidos.length ||
    novosDesvios.length ||
    desviosFechados.length ||
    alteracoesGerais.length

  const lotesReprovadosAno = useMemo(() => {
    const lotes = new Set<string>()
    historicoSafe.forEach((d) => {
      const destino = normalizarTextoFiltro(d.destino)
      if (destino.includes("REPROVADO") || destino.includes("DESCART")) {
        String(d.lotes_texto || "")
          .split(/[,;]/)
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((l) => lotes.add(l))
      }
    })
    return lotes.size
  }, [historicoSafe])

  function renderColunaLotes(item: HistoricoDesvio) {
    const descartado = ehDestinoDescartado(item.destino)
    const lotesDetalhados = item.lotes

    // Sem a lista detalhada por lote (endpoint antigo/sem essa quebra) ou
    // NC não descartado: mantém o comportamento simples de sempre.
    if (!descartado || !lotesDetalhados?.length) {
      return <div className="line-clamp-3">{item.lotes_texto || "-"}</div>
    }

    const revertidosPorLote = new Map(
      (item.lotes_revertidos || []).map((r) => [r.lote, r])
    )

    return (
      <div className="flex flex-wrap gap-1.5">
        {lotesDetalhados.map((loteInfo) => {
          const reversao = revertidosPorLote.get(loteInfo.lote)

          if (reversao) {
            return (
              <span
                key={loteInfo.lote}
                title={`Revertido: conta em ${MES_LABELS[(reversao.mes_liberacao || 1) - 1]}/${reversao.ano_liberacao}${reversao.motivo ? ` -- ${reversao.motivo}` : ""}`}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
              >
                <CheckCircle2 size={12} />
                {loteInfo.lote}
                <span className="text-emerald-500">
                  → {MES_LABELS[(reversao.mes_liberacao || 1) - 1]}/{reversao.ano_liberacao}
                </span>
                <button
                  type="button"
                  onClick={() => desfazerReversao(loteInfo.lote)}
                  disabled={desfazendoLote === loteInfo.lote}
                  title="Desfazer reversão"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <Undo2 size={11} />
                </button>
              </span>
            )
          }

          return (
            <button
              key={loteInfo.lote}
              type="button"
              onClick={() => abrirModalReverter(loteInfo.lote, item.serial)}
              title="Marcar este lote como liberado depois (reverte a reprovação)"
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {loteInfo.lote}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">
            Monitor de Desvios
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Histórico, rastreabilidade e impacto dos lotes travados.
          </p>
          {snapshotsSafe.length > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Dados atualizados em:</span>
              <span className="text-sm text-slate-500">
                {formatDataHora([...snapshotsSafe].sort((a, b) => new Date(b.data_upload).getTime() - new Date(a.data_upload).getTime())[0].data_upload)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            Selecionar arquivo

            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                setErroUpload("")
                setArquivo(e.target.files?.[0] || null)
              }}
            />
          </label>

          <button
            onClick={handleUpload}
            disabled={!arquivo || uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#17375E] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? "Processando..." : "Upload"}
          </button>

          <button
            onClick={() => setConfirmarLimpeza(true)}
            disabled={loading || uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 size={16} />
            Excluir dados
          </button>
        </div>
      </div>

      {arquivo && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Arquivo selecionado: <strong>{arquivo.name}</strong>
        </div>
      )}

      {erroUpload && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erroUpload}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-6">
        <Card title="Desvios atuais" value={resumo?.total_desvios || 0} icon={<FileWarning size={18} />} color="blue" />
        <Card title="Lotes monitorados" value={resumo?.total_lotes || 0} icon={<AlertTriangle size={18} />} color="amber" />
        <Card title="Novos lotes" value={resumo?.novos_lotes || 0} icon={<History size={18} />} color="green" />
        <Card title="Desvios fechados" value={resumo?.desvios_fechados ?? desviosFechados.length} icon={<AlertTriangle size={18} />} color="red" />
        <Card title="Alterações" value={resumo?.alteracoes || 0} icon={<Clock3 size={18} />} color="purple" />
        <Card title="Lotes reprovados no ano" value={lotesReprovadosAno} icon={<Trash2 size={18} />} color="red" />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Desvios atuais
            </h2>

            <p className="text-sm text-slate-500">
              Visão consolidada por desvio.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={filtroMes}
              onChange={(e) => setFiltroMes(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E]"
            >
              <option value="TODOS">Todos os meses</option>

              {mesesDisponiveis.map((mes) => (
                <option key={mes} value={mes}>
                  {mes}
                </option>
              ))}
            </select>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar desvio, lote, descrição..."
              className="w-80 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E]"
            />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#17375E] text-white">
                <th className="px-4 py-3 text-left font-medium">Desvio</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-left font-medium">Destino</th>
                <th className="px-4 py-3 text-left font-medium">Descrição</th>
                <th className="px-4 py-3 text-left font-medium">Qtd. lotes</th>
                <th className="px-4 py-3 text-left font-medium">Lotes</th>
                <th className="px-4 py-3 text-left font-medium">Mês impactado</th>
                <th className="px-4 py-3 text-left font-medium">Linha</th>
                <th className="px-4 py-3 text-left font-medium">Grupo</th>
                <th className="px-4 py-3 text-right font-medium">Qtd prevista</th>
                <th className="px-4 py-3 text-right font-medium">Dias</th>
                <th className="px-4 py-3 text-left font-medium">Setor</th>
              </tr>
            </thead>

            <tbody>
              {desviosFiltrados.map((item) => (
                <tr key={item.serial} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-4 font-semibold text-slate-900">{item.serial}</td>
                  <td className="px-4 py-4">{renderEstadoTag(item.estado)}</td>
                  <td className="px-4 py-4">{renderDestinoTag(item.destino)}</td>
                  <td className="max-w-[320px] px-4 py-4 text-slate-700">
                    <div className="line-clamp-3">{item.titulo || "-"}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{item.qtd_lotes}</td>
                  <td className="max-w-[360px] px-4 py-4 text-slate-700">
                    <div className="line-clamp-3">{item.lotes_texto || "-"}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{item.meses_lib_texto || "-"}</td>
                  <td className="px-4 py-4 text-slate-700">{item.linhas_texto || "-"}</td>
                  <td className="px-4 py-4 text-slate-700">{item.grupos_produto_texto || "-"}</td>
                  <td className="px-4 py-4 text-right text-slate-700">{formatNumero(item.qtd_prevista_total)}</td>
                  <td className="px-4 py-4 text-right text-slate-700">{item.dias_desvio || "-"}</td>
                  <td className="max-w-[260px] px-4 py-4 text-slate-700">{item.setor || "-"}</td>
                </tr>
              ))}

              {!desviosFiltrados.length && !loading && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhum desvio encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Alterações detectadas no último upload
          </h2>

          <p className="text-sm text-slate-500">
            Comparação automática entre o último arquivo enviado e o snapshot anterior.
          </p>
        </div>

        {temAlteracoes ? (
          <div className="space-y-3">
            {!!novosLotes.length && (
              <AvisoAlteracao
                title="Lotes adicionados"
                color="green"
                text={novosLotes.map((e) => e.descricao || `${e.lote} no ${e.serial}`).join("; ")}
              />
            )}

            {!!lotesRemovidos.length && (
              <AvisoAlteracao
                title="Lotes removidos"
                color="red"
                text={lotesRemovidos.map((e) => e.descricao || `${e.lote} removido do ${e.serial}`).join("; ")}
              />
            )}

            {!!novosDesvios.length && (
              <AvisoAlteracao
                title="Novos desvios"
                color="blue"
                text={novosDesvios.map((e) => e.descricao || `Novo desvio: ${e.serial}`).filter(Boolean).join("; ")}
              />
            )}

            {!!desviosFechados.length && (
              <AvisoAlteracao
                title="Desvios fechados"
                color="slate"
                text={desviosFechados.map((e) => e.descricao || `Desvio fechado: ${e.serial}`).filter(Boolean).join("; ")}
              />
            )}

            {!!alteracoesGerais.length && (
              <AvisoAlteracao
                title="Alterações gerais"
                color="amber"
                text={`${alteracoesGerais.length} alteração(ões) identificadas no último upload.`}
              />
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Nenhuma alteração detectada no último upload.
          </div>
        )}
      </div>


      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Histórico de desvios do ano
            </h2>

            <p className="text-sm text-slate-500">
              Todos os desvios que já apareceram no ano selecionado, inclusive os fechados que não constam mais no Interact.
              {" "}Clique num lote descartado pra marcar que ele foi liberado depois.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={anoHistorico}
              onChange={(e) => setAnoHistorico(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E]"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
            </select>

            <select
              value={filtroSituacaoHistorico}
              onChange={(e) => setFiltroSituacaoHistorico(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E]"
            >
              <option value="TODOS">Todos os status</option>
              <option value="Aberto">Abertos</option>
              <option value="Fechado">Fechados</option>
            </select>

            <select
              value={filtroDestinoHistorico}
              onChange={(e) => setFiltroDestinoHistorico(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E]"
            >
              <option value="TODOS">Todos os destinos</option>
              <option value="Aprovado">Aprovado</option>
              <option value="Reprovado">Reprovado</option>
              <option value="Descartado">Descartado</option>
              <option value="SEM DESTINO">Sem destino</option>
            </select>

            <button
              type="button"
              onClick={exportarHistoricoSelecionado}
              disabled={!historicoParaExportar.length}
              className="inline-flex items-center gap-2 rounded-xl bg-[#17375E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f2947] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={16} />
              Exportar {historicoSelecionado.size ? `selecionados (${historicoSelecionado.size})` : "filtrados"}
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <span>
            {historicoFiltrado.length} desvio(s) no filtro
            {historicoSelecionado.size ? ` · ${historicoSelecionado.size} selecionado(s)` : ""}
          </span>

          {filtroDestinoHistorico === "Descartado" && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
              Exibindo descartados
            </span>
          )}
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#17375E] text-white">
                <th className="w-10 px-4 py-3 text-left font-medium">
                  <input
                    type="checkbox"
                    checked={todosHistoricoFiltradosSelecionados}
                    onChange={toggleSelecionarTodosHistoricoFiltrado}
                    className="h-4 w-4 rounded border-white/40 text-[#17375E]"
                    aria-label="Selecionar todos os desvios filtrados"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Situação</th>
                <th className="px-4 py-3 text-left font-medium">Desvio</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-left font-medium">Destino</th>
                <th className="px-4 py-3 text-left font-medium">Descrição</th>
                <th className="px-4 py-3 text-left font-medium">Qtd. lotes</th>
                <th className="px-4 py-3 text-left font-medium">Lotes</th>
                <th className="px-4 py-3 text-left font-medium">Mês impactado</th>
                <th className="px-4 py-3 text-left font-medium">Linha</th>
                <th className="px-4 py-3 text-left font-medium">Grupo</th>
                <th className="px-4 py-3 text-right font-medium">Qtd prevista</th>
                <th className="px-4 py-3 text-left font-medium">Última aparição</th>
                <th className="px-4 py-3 text-left font-medium">Setor</th>
              </tr>
            </thead>

            <tbody>
              {historicoFiltrado.map((item) => (
                <tr key={`${item.serial}-${item.ultimo_upload || ""}`} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={historicoSelecionado.has(item.serial)}
                      onChange={() => toggleSelecionarHistorico(item.serial)}
                      className="h-4 w-4 rounded border-slate-300 text-[#17375E]"
                      aria-label={`Selecionar ${item.serial}`}
                    />
                  </td>
                  <td className="px-4 py-4">{renderSituacaoHistoricoTag(item.situacao_historico)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-900">{item.serial}</td>
                  <td className="px-4 py-4">{renderEstadoTag(item.estado)}</td>
                  <td className="px-4 py-4">{renderDestinoTag(item.destino)}</td>
                  <td className="max-w-[320px] px-4 py-4 text-slate-700">
                    <div className="line-clamp-3">{item.titulo || "-"}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{item.qtd_lotes}</td>
                  <td className="max-w-[360px] px-4 py-4 text-slate-700">
                    {renderColunaLotes(item)}
                  </td>
                  <td className="px-4 py-4 text-slate-700">{item.meses_lib_texto || "-"}</td>
                  <td className="px-4 py-4 text-slate-700">{item.linhas_texto || "-"}</td>
                  <td className="px-4 py-4 text-slate-700">{item.grupos_produto_texto || "-"}</td>
                  <td className="px-4 py-4 text-right text-slate-700">{formatNumero(item.qtd_prevista_total)}</td>
                  <td className="px-4 py-4 text-slate-700">{formatDataHora(item.ultimo_upload)}</td>
                  <td className="max-w-[260px] px-4 py-4 text-slate-700">{item.setor || "-"}</td>
                </tr>
              ))}

              {!historicoFiltrado.length && !loading && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhum histórico encontrado para o ano selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmarLimpeza && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-red-50 p-3 text-red-600">
                <Trash2 size={22} />
              </div>

              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  Excluir dados de desvios
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Tem certeza que deseja excluir todos os snapshots, eventos e desvios carregados?
                </p>

                <p className="mt-2 text-sm font-medium text-red-600">
                  Essa ação não pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmarLimpeza(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                onClick={handleLimparDados}
                disabled={loading}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Excluir dados
              </button>
            </div>
          </div>
        </div>
      )}

      {modalReverter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharModalReverter()
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                <CheckCircle2 size={22} />
              </div>

              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  Marcar lote como liberado
                </h3>

                <p className="mt-1 font-mono text-sm text-slate-500">
                  Lote {modalReverter.lote} · NC {modalReverter.serial}
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Esse lote estava contando como perda por reprovação/desvio. Ao confirmar, ele
                  para de contar como perda e passa a entrar no plano do mês escolhido abaixo.
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">
                  Mês de liberação
                </label>
                <select
                  value={mesReverterForm}
                  onChange={(e) => setMesReverterForm(Number(e.target.value))}
                  disabled={salvandoReversao}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#17375E]"
                >
                  {MES_LABELS.map((label, idx) => (
                    <option key={label} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">
                  Ano
                </label>
                <input
                  type="number"
                  value={anoReverterForm}
                  onChange={(e) => setAnoReverterForm(Number(e.target.value))}
                  disabled={salvandoReversao}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#17375E]"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Motivo (opcional)
              </label>
              <textarea
                value={motivoReverterForm}
                onChange={(e) => setMotivoReverterForm(e.target.value)}
                disabled={salvandoReversao}
                rows={2}
                placeholder="Ex.: Reprocessado e reanalisado, liberado após reanálise."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#17375E]"
              />
            </div>

            {erroReversao && (
              <p className="mt-3 text-sm text-red-600">{erroReversao}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={fecharModalReverter}
                disabled={salvandoReversao}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                onClick={confirmarReversao}
                disabled={salvandoReversao}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {salvandoReversao ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AvisoAlteracao({
  title,
  text,
  color,
}: {
  title: string
  text: string
  color: "green" | "red" | "blue" | "amber" | "slate"
}) {
  const styles = {
    green: "border-emerald-100 bg-emerald-50 text-emerald-800",
    red: "border-red-100 bg-red-50 text-red-800",
    blue: "border-blue-100 bg-blue-50 text-blue-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles[color]}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 leading-6">{text || "-"}</div>
    </div>
  )
}

function Card({
  title,
  value,
  icon,
  color,
}: {
  title: string
  value: number
  icon: React.ReactNode
  color: "blue" | "amber" | "green" | "red" | "purple"
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
        </div>

        <div className={`rounded-xl p-3 ${styles[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}