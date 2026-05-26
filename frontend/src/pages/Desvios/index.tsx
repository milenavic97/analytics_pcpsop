import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Clock3,
  FileWarning,
  History,
  Trash2,
  Upload,
} from "lucide-react"

import {
  getDesviosResumo,
  getDesviosEventos,
  getDesviosSnapshots,
  getDesviosAtuais,
  uploadDesvios,
  limparDesvios,
} from "@/services/api"

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

type Desvio = {
  serial: string
  estado?: string
  destino?: string
  setor?: string
  titulo?: string
  dias_desvio?: number
  qtd_lotes: number
  lotes_texto: string
  meses_lib_texto?: string
  grupos_produto_texto?: string
  linhas_texto?: string
  qtd_prevista_total?: number
}

type Resumo = {
  total_lotes: number
  total_desvios: number
  novos_lotes: number
  lotes_removidos: number
  alteracoes: number
}

function formatNumero(valor?: number) {
  if (!valor) return "-"
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(valor)
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

  const [busca, setBusca] = useState("")
  const [filtroMes, setFiltroMes] = useState("TODOS")

  async function carregar() {
    try {
      setLoading(true)

      const [resumoResp, eventosResp, snapshotsResp, desviosResp] =
        await Promise.all([
          getDesviosResumo(),
          getDesviosEventos(),
          getDesviosSnapshots(),
          getDesviosAtuais(),
        ])

      setResumo(resumoResp as Resumo)
      setEventos((eventosResp as Evento[]) || [])
      setSnapshots((snapshotsResp as Snapshot[]) || [])
      setDesvios((desviosResp as Desvio[]) || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

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

  const mesesDisponiveis = useMemo(() => {
    const meses = new Set<string>()

    desvios.forEach((d) => {
      if (!d.meses_lib_texto) return

      d.meses_lib_texto
        .split(",")
        .map((x) => x.trim())
        .forEach((m) => meses.add(m))
    })

    return Array.from(meses).sort()
  }, [desvios])

  const desviosFiltrados = useMemo(() => {
    return desvios.filter((d) => {
      const termo = busca.toLowerCase()

      const passouBusca =
        !termo ||
        String(d.serial || "").toLowerCase().includes(termo) ||
        String(d.destino || "").toLowerCase().includes(termo) ||
        String(d.estado || "").toLowerCase().includes(termo) ||
        String(d.setor || "").toLowerCase().includes(termo) ||
        String(d.lotes_texto || "").toLowerCase().includes(termo)

      const passouMes =
        filtroMes === "TODOS" ||
        String(d.meses_lib_texto || "").includes(filtroMes)

      return passouBusca && passouMes
    })
  }, [desvios, busca, filtroMes])

  const novosLotes = eventos.filter((e) => e.tipo_evento === "NOVO_LOTE")
  const lotesRemovidos = eventos.filter((e) => e.tipo_evento === "LOTE_REMOVIDO")
  const novosDesvios = eventos.filter((e) => e.tipo_evento === "NOVO_DESVIO")
  const desviosRemovidos = eventos.filter((e) => e.tipo_evento === "DESVIO_REMOVIDO")
  const alteracoesGerais = eventos.filter(
    (e) =>
      ![
        "NOVO_LOTE",
        "LOTE_REMOVIDO",
        "NOVO_DESVIO",
        "DESVIO_REMOVIDO",
      ].includes(e.tipo_evento)
  )

  const temAlteracoes =
    novosLotes.length ||
    lotesRemovidos.length ||
    novosDesvios.length ||
    desviosRemovidos.length ||
    alteracoesGerais.length

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

      <div className="grid gap-4 md:grid-cols-5">
        <Card title="Desvios atuais" value={resumo?.total_desvios || 0} icon={<FileWarning size={18} />} color="blue" />
        <Card title="Lotes monitorados" value={resumo?.total_lotes || 0} icon={<AlertTriangle size={18} />} color="amber" />
        <Card title="Novos lotes" value={resumo?.novos_lotes || 0} icon={<History size={18} />} color="green" />
        <Card title="Lotes removidos" value={resumo?.lotes_removidos || 0} icon={<AlertTriangle size={18} />} color="red" />
        <Card title="Alterações" value={resumo?.alteracoes || 0} icon={<Clock3 size={18} />} color="purple" />
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
              placeholder="Buscar desvio, lote, setor..."
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
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
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
                text={novosLotes.map((e) => `${e.lote} no ${e.serial}`).join("; ")}
              />
            )}

            {!!lotesRemovidos.length && (
              <AvisoAlteracao
                title="Lotes removidos"
                color="red"
                text={lotesRemovidos.map((e) => `${e.lote} do ${e.serial}`).join("; ")}
              />
            )}

            {!!novosDesvios.length && (
              <AvisoAlteracao
                title="Novos desvios"
                color="blue"
                text={novosDesvios.map((e) => e.serial).filter(Boolean).join("; ")}
              />
            )}

            {!!desviosRemovidos.length && (
              <AvisoAlteracao
                title="Desvios removidos"
                color="slate"
                text={desviosRemovidos.map((e) => e.serial).filter(Boolean).join("; ")}
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
