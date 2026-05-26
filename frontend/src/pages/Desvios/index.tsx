import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Clock3,
  FileWarning,
  History,
  Upload,
} from "lucide-react"

import { api } from "@/services/api"

type Resumo = {
  snapshot_id: string
  ultima_carga: string
  total_lotes: number
  total_desvios: number
  novos_lotes: number
  lotes_removidos: number
  alteracoes: number
  eventos: Evento[]
}

type Evento = {
  id?: string
  data_evento?: string
  tipo_evento: string
  serial?: string
  lote?: string
  descricao?: string
  valor_antigo?: string
  valor_novo?: string
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
  titulo?: string
}

export default function DesviosPage() {
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [atuais, setAtuais] = useState<DesvioAtual[]>([])

  const [busca, setBusca] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)

  async function carregar() {
    try {
      setLoading(true)

      const [
        resumoResp,
        eventosResp,
        snapshotsResp,
        atuaisResp,
      ] = await Promise.all([
        api.get("/desvios/resumo"),
        api.get("/desvios/eventos"),
        api.get("/desvios/snapshots"),
        api.get("/desvios/atual"),
      ])

      setResumo(resumoResp.data)
      setEventos(eventosResp.data || [])
      setSnapshots(snapshotsResp.data || [])
      setAtuais(atuaisResp.data || [])
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

      const formData = new FormData()
      formData.append("file", arquivo)

      await api.post("/desvios/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      })

      setArquivo(null)

      await carregar()
    } catch (err) {
      console.error(err)
      alert("Erro ao subir arquivo de desvios.")
    } finally {
      setUploading(false)
    }
  }

  const atuaisFiltrados = useMemo(() => {
    if (!busca.trim()) return atuais

    const termo = busca.toLowerCase()

    return atuais.filter((item) => {
      return (
        String(item.serial || "").toLowerCase().includes(termo) ||
        String(item.lote || "").toLowerCase().includes(termo) ||
        String(item.destino || "").toLowerCase().includes(termo) ||
        String(item.estado || "").toLowerCase().includes(termo)
      )
    })
  }, [atuais, busca])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Monitor de Desvios
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Histórico, rastreabilidade e alterações automáticas dos desvios.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
            Selecionar arquivo
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] || null)
              }}
            />
          </label>

          <button
            onClick={handleUpload}
            disabled={!arquivo || uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173963] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? "Processando..." : "Upload"}
          </button>
        </div>
      </div>

      {arquivo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Arquivo selecionado: <strong>{arquivo.name}</strong>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card
          title="Desvios Atuais"
          value={resumo?.total_desvios || 0}
          icon={<FileWarning size={18} />}
        />

        <Card
          title="Lotes Monitorados"
          value={resumo?.total_lotes || 0}
          icon={<AlertTriangle size={18} />}
        />

        <Card
          title="Novos Lotes"
          value={resumo?.novos_lotes || 0}
          icon={<History size={18} />}
        />

        <Card
          title="Alterações"
          value={resumo?.alteracoes || 0}
          icon={<Clock3 size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Eventos recentes
              </h2>

              <p className="text-sm text-slate-500">
                Mudanças detectadas automaticamente entre snapshots.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {eventos.map((evento, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">
                      {evento.tipo_evento}
                    </div>

                    <div className="mt-1 text-sm text-slate-600">
                      {evento.descricao}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {evento.serial && (
                        <span>
                          Desvio: <strong>{evento.serial}</strong>
                        </span>
                      )}

                      {evento.lote && (
                        <span>
                          Lote: <strong>{evento.lote}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-400">
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

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              Histórico de snapshots
            </h2>

            <p className="text-sm text-slate-500">
              Uploads realizados.
            </p>
          </div>

          <div className="space-y-3">
            {snapshots.map((snap) => (
              <div
                key={snap.snapshot_id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="text-sm font-semibold text-slate-800">
                  {snap.arquivo_origem || "snapshot"}
                </div>

                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <div>
                    {new Date(snap.data_upload).toLocaleString("pt-BR")}
                  </div>

                  <div>
                    {snap.total_desvios} desvios
                  </div>

                  <div>
                    {snap.total_lotes} lotes
                  </div>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
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
            className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-[#173963] md:w-80"
          />
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-3">Desvio</th>
                <th className="px-3 py-3">Lote</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Destino</th>
                <th className="px-3 py-3">Dias</th>
                <th className="px-3 py-3">Setor</th>
              </tr>
            </thead>

            <tbody>
              {atuaisFiltrados.map((item, idx) => (
                <tr
                  key={idx}
                  className="border-b border-slate-100"
                >
                  <td className="px-3 py-3 font-medium">
                    {item.serial || "-"}
                  </td>

                  <td className="px-3 py-3">
                    {item.lote || "-"}
                  </td>

                  <td className="px-3 py-3">
                    {item.estado || "-"}
                  </td>

                  <td className="px-3 py-3">
                    {item.destino || "-"}
                  </td>

                  <td className="px-3 py-3">
                    {item.dias_desvio || "-"}
                  </td>

                  <td className="px-3 py-3">
                    {item.setor || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!atuaisFiltrados.length && !loading && (
            <div className="py-10 text-center text-sm text-slate-500">
              Nenhum desvio encontrado.
            </div>
          )}
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-500">
            {title}
          </div>

          <div className="mt-2 text-3xl font-bold text-slate-800">
            {value}
          </div>
        </div>

        <div className="rounded-xl bg-slate-100 p-3 text-slate-600">
          {icon}
        </div>
      </div>
    </div>
  )
}
