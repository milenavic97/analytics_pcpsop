import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Clock3,
  FileWarning,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react"

import {
  clearDesvios,
  getDesviosAtuais,
  getDesviosEventos,
  getDesviosResumo,
  getDesviosSnapshots,
  uploadDesviosFile,
} from "../../services/api"

type Resumo = {
  total_desvios: number
  total_lotes: number
  novos_lotes: number
  lotes_removidos: number
  alteracoes: number
}

type Evento = {
  tipo_evento?: string
  serial?: string
  lote?: string
}

type Snapshot = {
  snapshot_id: string
  data_upload?: string
  arquivo_origem?: string
}

type Desvio = {
  serial?: string
  status?: string
  destino?: string
  title?: string
  qtd_lotes?: number
  lotes?: string[]
  mes_impactado?: string
  linha?: string
  grupo?: string
  qtd_prevista?: number
  dias_desvio?: number
  setor?: string
}

function formatarNumero(valor?: number) {
  return new Intl.NumberFormat("pt-BR").format(valor || 0)
}

function formatarStatus(status?: string) {
  if (!status) return "-"

  if (status === "4" || status.toLowerCase().includes("reprov")) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
        Reprovado
      </span>
    )
  }

  if (status === "6" || status.toLowerCase().includes("aprov")) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
        Aprovado
      </span>
    )
  }

  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
      -
    </span>
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
  const colors = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }

  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color]}`}>
      <div className="text-sm font-semibold">{title}</div>

      <div className="mt-1 text-sm leading-relaxed">
        {text}
      </div>
    </div>
  )
}

export default function DesviosPage() {
  const [loading, setLoading] = useState(false)

  const [arquivo, setArquivo] = useState<File | null>(null)

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [desvios, setDesvios] = useState<Desvio[]>([])

  const [busca, setBusca] = useState("")
  const [mesFiltro, setMesFiltro] = useState("Todos os meses")

  async function carregar() {
    try {
      setLoading(true)

      const [
        resumoResp,
        eventosResp,
        snapshotsResp,
        desviosResp,
      ] = await Promise.all([
        getDesviosResumo(),
        getDesviosEventos(),
        getDesviosSnapshots(),
        getDesviosAtuais(),
      ])

      setResumo(resumoResp.data as Resumo)
      setEventos((eventosResp.data || []) as Evento[])
      setSnapshots((snapshotsResp.data || []) as Snapshot[])
      setDesvios((desviosResp.data || []) as Desvio[])
    } catch (error) {
      console.error(error)
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
      setLoading(true)

      await uploadDesviosFile(arquivo)

      setArquivo(null)

      await carregar()
    } catch (error) {
      console.error(error)
      alert("Erro ao subir arquivo.")
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    try {
      setLoading(true)

      await clearDesvios()

      await carregar()
    } catch (error) {
      console.error(error)
      alert("Erro ao excluir dados.")
    } finally {
      setLoading(false)
    }
  }

  const meses = useMemo(() => {
    const values = new Set<string>()

    desvios.forEach((item) => {
      if (item.mes_impactado) {
        item.mes_impactado
          .split(",")
          .map((v) => v.trim())
          .forEach((v) => values.add(v))
      }
    })

    return ["Todos os meses", ...Array.from(values)]
  }, [desvios])

  const desviosFiltrados = useMemo(() => {
    return desvios.filter((item) => {
      const texto = `
        ${item.serial || ""}
        ${item.title || ""}
        ${item.lotes?.join(" ") || ""}
      `
        .toLowerCase()

      const matchBusca = texto.includes(busca.toLowerCase())

      const matchMes =
        mesFiltro === "Todos os meses"
          ? true
          : item.mes_impactado?.includes(mesFiltro)

      return matchBusca && matchMes
    })
  }, [desvios, busca, mesFiltro])

  const novosLotes = eventos.filter(
    (e) => e.tipo_evento === "LOTE_ADICIONADO"
  )

  const lotesRemovidos = eventos.filter(
    (e) => e.tipo_evento === "LOTE_REMOVIDO"
  )

  const novosDesvios = eventos.filter(
    (e) => e.tipo_evento === "NOVO_DESVIO"
  )

  const desviosRemovidos = eventos.filter(
    (e) => e.tipo_evento === "DESVIO_REMOVIDO"
  )

  const alteracoesGerais = eventos.filter(
    (e) =>
      ![
        "LOTE_ADICIONADO",
        "LOTE_REMOVIDO",
        "NOVO_DESVIO",
        "DESVIO_REMOVIDO",
      ].includes(e.tipo_evento || "")
  )

  const temAlteracoes =
    novosLotes.length > 0 ||
    lotesRemovidos.length > 0 ||
    novosDesvios.length > 0 ||
    desviosRemovidos.length > 0 ||
    alteracoesGerais.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Monitor de Desvios
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Histórico, rastreabilidade e impacto dos lotes travados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Selecionar arquivo

            <input
              type="file"
              className="hidden"
              onChange={(e) =>
                setArquivo(e.target.files?.[0] || null)
              }
            />
          </label>

          <button
            onClick={handleUpload}
            disabled={!arquivo || loading}
            className="flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Upload size={16} />
            Upload
          </button>

          <button
            onClick={handleClear}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          >
            <Trash2 size={16} />
            Excluir dados
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <CardResumo
          title="Desvios atuais"
          value={resumo?.total_desvios || 0}
          icon={<FileWarning size={16} />}
          color="blue"
        />

        <CardResumo
          title="Lotes monitorados"
          value={resumo?.total_lotes || 0}
          icon={<AlertTriangle size={16} />}
          color="amber"
        />

        <CardResumo
          title="Novos lotes"
          value={resumo?.novos_lotes || 0}
          icon={<RefreshCcw size={16} />}
          color="green"
        />

        <CardResumo
          title="Lotes removidos"
          value={resumo?.lotes_removidos || 0}
          icon={<AlertTriangle size={16} />}
          color="red"
        />

        <CardResumo
          title="Alterações"
          value={resumo?.alteracoes || 0}
          icon={<Clock3 size={16} />}
          color="purple"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
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
              value={mesFiltro}
              onChange={(e) => setMesFiltro(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {meses.map((mes) => (
                <option key={mes}>{mes}</option>
              ))}
            </select>

            <input
              placeholder="Buscar desvio, lote, descrição..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
            />
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-[#16345f] text-white">
              <tr>
                <th className="px-4 py-3 text-left">Desvio</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Destino</th>
                <th className="px-4 py-3 text-left">Descrição</th>
                <th className="px-4 py-3 text-left">Qtd. lotes</th>
                <th className="px-4 py-3 text-left">Lotes</th>
                <th className="px-4 py-3 text-left">Mês impactado</th>
                <th className="px-4 py-3 text-left">Linha</th>
                <th className="px-4 py-3 text-left">Grupo</th>
                <th className="px-4 py-3 text-right">Qtd prevista</th>
                <th className="px-4 py-3 text-right">Dias</th>
                <th className="px-4 py-3 text-left">Setor</th>
              </tr>
            </thead>

            <tbody>
              {desviosFiltrados.map((item, index) => (
                <tr
                  key={`${item.serial}-${index}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-4 py-4 font-semibold text-slate-900">
                    {item.serial}
                  </td>

                  <td className="px-4 py-4">
                    {formatarStatus(item.status)}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.destino || "-"}
                  </td>

                  <td className="max-w-[280px] px-4 py-4 text-slate-700">
                    {item.title || "-"}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.qtd_lotes || 0}
                  </td>

                  <td className="max-w-[320px] px-4 py-4 text-slate-700">
                    {item.lotes?.join(", ")}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.mes_impactado || "-"}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.linha || "-"}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.grupo || "-"}
                  </td>

                  <td className="px-4 py-4 text-right text-slate-700">
                    {formatarNumero(item.qtd_prevista)}
                  </td>

                  <td className="px-4 py-4 text-right text-slate-700">
                    {formatarNumero(item.dias_desvio)}
                  </td>

                  <td className="px-4 py-4 text-slate-700">
                    {item.setor || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                text={novosLotes
                  .map((e) => `${e.lote} no ${e.serial}`)
                  .join("; ")}
              />
            )}

            {!!lotesRemovidos.length && (
              <AvisoAlteracao
                title="Lotes removidos"
                color="red"
                text={lotesRemovidos
                  .map((e) => `${e.lote} do ${e.serial}`)
                  .join("; ")}
              />
            )}

            {!!novosDesvios.length && (
              <AvisoAlteracao
                title="Novos desvios"
                color="blue"
                text={novosDesvios
                  .map((e) => e.serial)
                  .filter(Boolean)
                  .join("; ")}
              />
            )}

            {!!desviosRemovidos.length && (
              <AvisoAlteracao
                title="Desvios removidos"
                color="slate"
                text={desviosRemovidos
                  .map((e) => e.serial)
                  .filter(Boolean)
                  .join("; ")}
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
    </div>
  )
}

function CardResumo({
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
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500">{title}</div>

          <div className="mt-2 text-4xl font-bold text-slate-900">
            {formatarNumero(value)}
          </div>
        </div>

        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[color]}`}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}
