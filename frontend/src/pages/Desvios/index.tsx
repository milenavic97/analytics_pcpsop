import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Clock3,
  FileWarning,
  History,
  Upload,
} from "lucide-react"

import {
  getDesviosResumo,
  getDesviosEventos,
  getDesviosSnapshots,
  getDesviosAtuais,
  uploadDesvios,
} from "@/services/api"

type Evento = {
  id?: string
  data_evento?: string
  tipo_evento: string
  serial?: string
  lote?: string
  descricao?: string
}

type Resumo = {
  snapshot_id?: string
  ultima_carga?: string
  total_lotes: number
  total_desvios: number
  novos_lotes: number
  lotes_removidos: number
  alteracoes: number
  eventos: Evento[]
}

type Snapshot = {
  snapshot_id: string
  data_upload: string
  arquivo_origem?: string
  total_lotes: number
  total_desvios: number
}

type DesvioAtual = {
  serial?: string
  lote?: string
  estado?: string
  destino?: string
  dias_desvio?: number
  setor?: string
}

export default function DesviosPage() {
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [erroUpload, setErroUpload] = useState("")

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [atuais, setAtuais] = useState<DesvioAtual[]>([])

  const [busca, setBusca] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)

  async function carregar() {
    try {
      setLoading(true)

      const [resumoResp, eventosResp, snapshotsResp, atuaisResp] =
        await Promise.all([
          getDesviosResumo(),
          getDesviosEventos(),
          getDesviosSnapshots(),
          getDesviosAtuais(),
        ])

      setResumo(resumoResp as Resumo)
      setEventos((eventosResp as Evento[]) || [])
      setSnapshots((snapshotsResp as Snapshot[]) || [])
      setAtuais((atuaisResp as DesvioAtual[]) || [])
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

      const resp = await uploadDesvios(arquivo)

      if (resp?.erros?.length) {
        setErroUpload(resp.erros.join(" | "))
        return
      }

      setArquivo(null)
      await carregar()
    } catch (err) {
      console.error(err)

      setErroUpload(
        err instanceof Error
          ? err.message
          : "Erro ao subir arquivo de desvios."
      )
    } finally {
      setUploading(false)
    }
  }

  const atuaisFiltrados = useMemo(() => {
    if (!busca.trim()) return atuais

    const termo = busca.toLowerCase()

    return atuais.filter((item) =>
      String(item.serial || "").toLowerCase().includes(termo) ||
      String(item.lote || "").toLowerCase().includes(termo) ||
      String(item.destino || "").toLowerCase().includes(termo) ||
      String(item.estado || "").toLowerCase().includes(termo) ||
      String(item.setor || "").toLowerCase().includes(termo)
    )
  }, [atuais, busca])

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Monitor de Desvios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Histórico, rastreabilidade e alterações automáticas entre uploads.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            Selecionar arquivo
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
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
        </div>
      </div>

      {arquivo && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Arquivo selecionado: <strong>{arquivo.name}</strong>
        </div>
      )}

      {erroUpload && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Erro no upload:</strong> {erroUpload}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card title="Desvios atuais" value={resumo?.total_desvios || 0} icon={<FileWarning size={18} />} />
        <Card title="Lotes monitorados" value={resumo?.total_lotes || 0} icon={<AlertTriangle size={18} />} />
        <Card title="Novos lotes" value={resumo?.novos_lotes || 0} icon={<History size={18} />} />
        <Card title="Lotes removidos" value={resumo?.lotes_removidos || 0} icon={<AlertTriangle size={18} />} />
        <Card title="Alterações" value={resumo?.alteracoes || 0} icon={<Clock3 size={18} />} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Eventos recentes
          </h2>
          <p className="text-sm text-slate-500">
            Mudanças detectadas no último snapshot e histórico recente.
          </p>

          <div className="mt-4 space-y-3">
            {eventos.map((evento, idx) => (
              <div
                key={`${evento.id || idx}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {evento.tipo_evento}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {evento.descricao || "-"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      {evento.serial && <span>Desvio: <strong>{evento.serial}</strong></span>}
                      {evento.lote && <span>Lote: <strong>{evento.lote}</strong></span>}
                    </div>
                  </div>

                  <div className="whitespace-nowrap text-xs text-slate-400">
                    {evento.data_evento
                      ? new Date(evento.data_evento).toLocaleString("pt-BR")
                      : "-"}
                  </div>
                </div>
              </div>
            ))}

            {!eventos.length && !loading && (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                Nenhum evento encontrado.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Histórico de snapshots
          </h2>
          <p className="text-sm text-slate-500">
            Uploads realizados com data e hora.
          </p>

          <div className="mt-4 space-y-3">
            {snapshots.map((snap) => (
              <div
                key={snap.snapshot_id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="text-sm font-semibold text-slate-900">
                  {snap.arquivo_origem || "snapshot"}
                </div>

                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <div>{new Date(snap.data_upload).toLocaleString("pt-BR")}</div>
                  <div>{snap.total_desvios} desvios</div>
                  <div>{snap.total_lotes} lotes</div>
                </div>
              </div>
            ))}

            {!snapshots.length && !loading && (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                Nenhum snapshot encontrado.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Desvios atuais
            </h2>
            <p className="text-sm text-slate-500">
              Último snapshot carregado.
            </p>
          </div>

          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar lote, desvio, status..."
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#17375E] md:w-80"
          />
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#17375E] text-white">
                <th className="px-4 py-3 text-left font-medium">Desvio</th>
                <th className="px-4 py-3 text-left font-medium">Lote</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-left font-medium">Destino</th>
                <th className="px-4 py-3 text-right font-medium">Dias</th>
                <th className="px-4 py-3 text-left font-medium">Setor</th>
              </tr>
            </thead>

            <tbody>
              {atuaisFiltrados.map((item, idx) => (
                <tr key={`${item.serial}-${item.lote}-${idx}`} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{item.serial || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{item.lote || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{item.estado || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{item.destino || "-"}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{item.dias_desvio ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{item.setor || "-"}</td>
                </tr>
              ))}

              {!atuaisFiltrados.length && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhum desvio encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Card({
  title,
  value,
  icon,
}: {
  title: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
        </div>

        <div className="rounded-xl bg-slate-100 p-3 text-[#17375E]">
          {icon}
        </div>
      </div>
    </div>
  )
}
