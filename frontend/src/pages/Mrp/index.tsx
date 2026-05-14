import { useEffect, useMemo, useState } from "react"
import {
  Plus,
  CalendarDays,
  Factory,
  PackageCheck,
  FlaskConical,
  X,
} from "lucide-react"

import {
  criarMrpEtapa,
  criarMrpRodada,
  getMrpEtapas,
  getMrpRodadas,
  type MrpEtapa,
  type MrpRodada,
} from "@/services/api"

const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
]

function getEtapaColor(etapa?: string) {
  if (etapa === "ENVASE") return "bg-blue-500"
  if (etapa === "FABRIMA") return "bg-violet-500"
  if (etapa === "QA") return "bg-emerald-500"
  return "bg-slate-500"
}

function getEtapaIcon(etapa?: string) {
  if (etapa === "ENVASE") return Factory
  if (etapa === "FABRIMA") return PackageCheck
  return FlaskConical
}

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] =
    useState<MrpRodada | null>(null)

  const [etapas, setEtapas] = useState<MrpEtapa[]>([])

  const [loading, setLoading] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)

  const [nome, setNome] = useState("Rodada MRP")
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [observacao, setObservacao] = useState("")

  async function carregarRodadas() {
    const data = await getMrpRodadas()

    setRodadas(data)

    if (data.length > 0 && !rodadaSelecionada) {
      setRodadaSelecionada(data[0])
    }
  }

  async function carregarEtapas(rodadaId: string) {
    setLoading(true)

    try {
      const data = await getMrpEtapas(rodadaId)
      setEtapas(data)
    } finally {
      setLoading(false)
    }
  }

  async function handleCriarRodada() {
    const proximaVersao =
      Math.max(
        0,
        ...rodadas
          .filter(
            (r) =>
              r.mes === mes &&
              r.ano === ano
          )
          .map((r) => r.versao || 0)
      ) + 1

    const nova = await criarMrpRodada({
      nome,
      mes,
      ano,
      versao: proximaVersao,
      observacao: observacao || null,
      status: "rascunho",
    })

    setRodadaSelecionada(nova)

    setModalOpen(false)

    await carregarRodadas()
  }

  useEffect(() => {
    carregarRodadas()
  }, [])

  useEffect(() => {
    if (rodadaSelecionada?.id) {
      carregarEtapas(rodadaSelecionada.id)
    }
  }, [rodadaSelecionada?.id])

  const diasDoMes = useMemo(() => {
    const total = new Date(
      ano,
      mes,
      0
    ).getDate()

    return Array.from(
      { length: total },
      (_, i) => i + 1
    )
  }, [mes, ano])

  return (
    <div className="bg-slate-100 min-h-screen p-5">
      {/* HEADER */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays
                size={22}
                className="text-slate-700"
              />

              <h1 className="text-2xl font-bold text-slate-900">
                MRP — Planejamento
              </h1>
            </div>

            <p className="text-sm text-slate-500 mt-1">
              Sequenciamento integrado
              de Envase, Fabrima e
              Liberação QA.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={
                rodadaSelecionada?.id || ""
              }
              onChange={(e) => {
                const rodada =
                  rodadas.find(
                    (r) =>
                      r.id ===
                      e.target.value
                  ) || null

                setRodadaSelecionada(
                  rodada
                )
              }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">
                Selecionar rodada
              </option>

              {rodadas.map((r) => (
                <option
                  key={r.id}
                  value={r.id}
                >
                  {r.nome} —{" "}
                  {
                    MESES[
                      (r.mes || 1) - 1
                    ]
                  }
                  /{r.ano} — V
                  {r.versao}
                </option>
              ))}
            </select>

            <button
              onClick={() =>
                setModalOpen(true)
              }
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} />
              Nova rodada
            </button>
          </div>
        </div>
      </div>

      {/* GANTT */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">
              Timeline produtiva
            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Visualização integrada
              das etapas do lote.
            </p>
          </div>

          <div className="text-xs text-slate-500">
            {loading
              ? "Carregando..."
              : `${etapas.length} etapas`}
          </div>
        </div>

        <div className="overflow-auto">
          <div className="min-w-[1800px]">
            {/* HEADER DIAS */}
            <div
              className="grid border-b border-slate-200 bg-slate-50 text-xs text-slate-500 sticky top-0 z-10"
              style={{
                gridTemplateColumns: `320px repeat(${diasDoMes.length}, 38px)`,
              }}
            >
              <div className="px-4 py-3 font-semibold">
                Linha / Etapa
              </div>

              {diasDoMes.map((dia) => (
                <div
                  key={dia}
                  className="py-3 text-center border-l border-slate-100"
                >
                  {dia}
                </div>
              ))}
            </div>

            {/* LINHAS */}
            <div className="divide-y divide-slate-100">
              {etapas.map((etapa) => {
                const inicio =
                  etapa.data_inicio
                    ? new Date(
                        `${etapa.data_inicio}T00:00:00`
                      ).getDate()
                    : 1

                const fim =
                  etapa.data_fim
                    ? new Date(
                        `${etapa.data_fim}T00:00:00`
                      ).getDate()
                    : inicio

                const duracao =
                  Math.max(
                    1,
                    fim - inicio + 1
                  )

                const Icon =
                  getEtapaIcon(
                    etapa.etapa
                  )

                return (
                  <div
                    key={etapa.id}
                    className="grid items-center min-h-[68px]"
                    style={{
                      gridTemplateColumns: `320px repeat(${diasDoMes.length}, 38px)`,
                    }}
                  >
                    {/* INFO */}
                    <div className="px-4 py-3 border-r border-slate-100">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-10 w-10 rounded-xl flex items-center justify-center text-white ${getEtapaColor(
                            etapa.etapa
                          )}`}
                        >
                          <Icon size={18} />
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {etapa.codigo_produto ||
                              etapa.lote ||
                              "Sem produto"}
                          </p>

                          <p className="text-xs text-slate-500 truncate">
                            {
                              etapa.etapa
                            }{" "}
                            •{" "}
                            {
                              etapa.recurso
                            }
                            {etapa.qtd_planejada
                              ? ` • ${etapa.qtd_planejada.toLocaleString(
                                  "pt-BR"
                                )}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* BARRA */}
                    <div
                      className={`${getEtapaColor(
                        etapa.etapa
                      )} h-9 rounded-xl shadow-sm text-white text-xs flex items-center px-3 font-medium`}
                      style={{
                        gridColumn: `${inicio + 1} / span ${duracao}`,
                      }}
                    >
                      <span className="truncate">
                        {etapa.recurso}
                      </span>
                    </div>
                  </div>
                )
              })}

              {etapas.length === 0 && (
                <div className="p-16 text-center">
                  <p className="text-sm font-medium text-slate-700">
                    Nenhuma etapa cadastrada
                    ainda.
                  </p>

                  <p className="text-xs text-slate-500 mt-2">
                    Próxima etapa:
                    importar automaticamente
                    do Excel MPS.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Nova rodada
                </h2>

                <p className="text-xs text-slate-500 mt-1">
                  Criação de nova
                  versão do planejamento.
                </p>
              </div>

              <button
                onClick={() =>
                  setModalOpen(false)
                }
                className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500">
                  Nome
                </label>

                <input
                  value={nome}
                  onChange={(e) =>
                    setNome(
                      e.target.value
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Mês
                  </label>

                  <select
                    value={mes}
                    onChange={(e) =>
                      setMes(
                        Number(
                          e.target.value
                        )
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  >
                    {MESES.map(
                      (m, idx) => (
                        <option
                          key={m}
                          value={
                            idx + 1
                          }
                        >
                          {m}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Ano
                  </label>

                  <input
                    type="number"
                    value={ano}
                    onChange={(e) =>
                      setAno(
                        Number(
                          e.target.value
                        )
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">
                  Observação
                </label>

                <textarea
                  value={observacao}
                  onChange={(e) =>
                    setObservacao(
                      e.target.value
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm min-h-[100px]"
                />
              </div>

              <button
                onClick={
                  handleCriarRodada
                }
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Criar rodada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
