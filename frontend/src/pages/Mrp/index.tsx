import { useEffect, useMemo, useState } from "react"
import {
  Plus,
  CalendarDays,
  Factory,
  PackageCheck,
  FlaskConical,
  X,
  Upload,
} from "lucide-react"

import {
  criarMrpRodada,
  getMrpEtapas,
  getMrpRodadas,
  importarMrpMps,
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

const RECURSOS = ["L1", "L2", "FABRIMA"]

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

function getDia(date?: string | null) {
  if (!date) return 1
  return new Date(`${date}T00:00:00`).getDate()
}

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] =
    useState<MrpRodada | null>(null)

  const [etapas, setEtapas] = useState<MrpEtapa[]>([])

  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)

  const [nome, setNome] = useState("Rodada MRP")
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [versao, setVersao] = useState(1)

  const [observacao, setObservacao] = useState("")

  const [arquivoMps, setArquivoMps] =
    useState<File | null>(null)

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

  function sugerirProximaVersao(
    mesSelecionado: number,
    anoSelecionado: number
  ) {
    const versoesMesmoMes = rodadas
      .filter(
        (r) =>
          r.mes === mesSelecionado &&
          r.ano === anoSelecionado
      )
      .map((r) => r.versao || 0)

    const maior =
      versoesMesmoMes.length > 0
        ? Math.max(...versoesMesmoMes)
        : 0

    setVersao(maior + 1)
  }

  async function handleCriarRodada() {
    const nova = await criarMrpRodada({
      nome,
      mes,
      ano,
      versao,
      observacao: observacao || null,
      status: "rascunho",
    })

    setRodadaSelecionada(nova)

    setModalOpen(false)

    setObservacao("")
    setArquivoMps(null)

    await carregarRodadas()
  }

  async function handleImportarMps() {
    if (!rodadaSelecionada?.id) {
      alert("Selecione uma rodada.")
      return
    }

    if (!arquivoMps) {
      alert("Selecione o arquivo MPS.")
      return
    }

    try {
      setImportando(true)

      await importarMrpMps(
        rodadaSelecionada.id,
        arquivoMps
      )

      await carregarEtapas(
        rodadaSelecionada.id
      )

      alert(
        "Planejamento importado com sucesso."
      )
    } catch (err) {
      console.error(err)

      alert(
        err instanceof Error
          ? err.message
          : "Erro ao importar planejamento."
      )
    } finally {
      setImportando(false)
    }
  }

  useEffect(() => {
    carregarRodadas()
  }, [])

  useEffect(() => {
    if (rodadaSelecionada?.id) {
      carregarEtapas(
        rodadaSelecionada.id
      )
    } else {
      setEtapas([])
    }
  }, [rodadaSelecionada?.id])

  useEffect(() => {
    sugerirProximaVersao(mes, ano)
  }, [mes, ano, rodadas])

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

  const etapasPorRecurso = useMemo(() => {
    return RECURSOS.map((recurso) => ({
      recurso,
      etapas: etapas.filter(
        (e) => e.recurso === recurso
      ),
    }))
  }, [etapas])

  return (
    <div className="bg-slate-100 min-h-screen p-5">
      {/* HEADER */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
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

            {rodadaSelecionada && (
              <div className="mt-3 inline-flex items-center rounded-xl bg-slate-100 border border-slate-200 px-3 py-2">
                <span className="text-xs text-slate-500 mr-2">
                  Rodada ativa:
                </span>

                <span className="text-sm font-semibold text-slate-700">
                  {
                    rodadaSelecionada.nome
                  }{" "}
                  —{" "}
                  {
                    MESES[
                      (rodadaSelecionada.mes ||
                        1) - 1
                    ]
                  }
                  /
                  {
                    rodadaSelecionada.ano
                  }{" "}
                  — V
                  {
                    rodadaSelecionada.versao
                  }
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
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

                if (rodada) {
                  setMes(rodada.mes)
                  setAno(rodada.ano)
                }
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

            <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
              <Upload size={16} />

              <input
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const file =
                    e.target.files?.[0] ||
                    null

                  setArquivoMps(file)
                }}
              />

              {arquivoMps
                ? "Arquivo selecionado"
                : "Importar planejamento"}
            </label>

            <button
              onClick={handleImportarMps}
              disabled={
                !arquivoMps ||
                !rodadaSelecionada ||
                importando
              }
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {importando
                ? "Importando..."
                : "Processar MPS"}
            </button>

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

      {/* GANTTS */}
      <div className="space-y-5">
        {etapasPorRecurso.map(
          ({ recurso, etapas }) => (
            <div
              key={recurso}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    Gantt — {recurso}
                  </h2>

                  <p className="text-xs text-slate-500 mt-1">
                    {recurso ===
                    "FABRIMA"
                      ? "Programação macro de embalagem."
                      : "Programação macro de envase."}
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
                  {/* HEADER */}
                  <div
                    className="grid border-b border-slate-200 bg-slate-50 text-xs text-slate-500 sticky top-0 z-10"
                    style={{
                      gridTemplateColumns: `360px repeat(${diasDoMes.length}, 38px)`,
                    }}
                  >
                    <div className="px-4 py-3 font-semibold">
                      Linha / Produto /
                      Lote
                    </div>

                    {diasDoMes.map(
                      (dia) => (
                        <div
                          key={dia}
                          className="py-3 text-center border-l border-slate-100"
                        >
                          {dia}
                        </div>
                      )
                    )}
                  </div>

                  {/* LINHAS */}
                  <div className="divide-y divide-slate-100">
                    {etapas.map(
                      (etapa) => {
                        const inicio =
                          getDia(
                            etapa.data_inicio
                          )

                        const fim =
                          getDia(
                            etapa.data_fim
                          )

                        const duracao =
                          Math.max(
                            1,
                            fim -
                              inicio +
                              1
                          )

                        const Icon =
                          getEtapaIcon(
                            etapa.etapa
                          )

                        return (
                          <div
                            key={
                              etapa.id
                            }
                            className="grid items-center min-h-[68px]"
                            style={{
                              gridTemplateColumns: `360px repeat(${diasDoMes.length}, 38px)`,
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
                                  <Icon
                                    size={
                                      18
                                    }
                                  />
                                </div>

                                <div className="min-w-0">
                                  <p className="font-semibold text-sm text-slate-900 truncate">
                                    {etapa.descricao_produto ||
                                      etapa.codigo_produto ||
                                      "Sem produto"}
                                  </p>

                                  <p className="text-xs text-slate-500 truncate">
                                    {etapa.codigo_produto ||
                                      "-"}{" "}
                                    •
                                    Lote{" "}
                                    {etapa.lote ||
                                      "-"}{" "}
                                    •{" "}
                                    {etapa.qtd_planejada
                                      ? etapa.qtd_planejada.toLocaleString(
                                          "pt-BR"
                                        )
                                      : "0"}{" "}
                                    tubetes
                                  </p>

                                  <p className="text-[11px] text-slate-400 truncate">
                                    {etapa.duracao_horas
                                      ? `${etapa.duracao_horas.toLocaleString(
                                          "pt-BR"
                                        )} h`
                                      : "0 h"}{" "}
                                    •
                                    PA:{" "}
                                    {etapa.data_pa ||
                                      "-"}
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
                              title={`${etapa.etapa} • ${etapa.recurso}`}
                            >
                              <span className="truncate">
                                {
                                  etapa.etapa
                                }{" "}
                                •{" "}
                                {etapa.lote ||
                                  etapa.codigo_produto}
                              </span>
                            </div>
                          </div>
                        )
                      }
                    )}

                    {etapas.length ===
                      0 && (
                      <div className="p-12 text-center">
                        <p className="text-sm font-medium text-slate-700">
                          Nenhuma
                          etapa
                          cadastrada
                          para{" "}
                          {
                            recurso
                          }
                          .
                        </p>

                        <p className="text-xs text-slate-500 mt-2">
                          Selecione
                          uma
                          rodada e
                          importe o
                          Excel
                          MPS.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        )}
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
                  versão histórica
                  do planejamento.
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

              <div className="grid grid-cols-3 gap-3">
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
                      (
                        m,
                        idx
                      ) => (
                        <option
                          key={
                            m
                          }
                          value={
                            idx +
                            1
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

                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Versão
                  </label>

                  <input
                    type="number"
                    value={
                      versao
                    }
                    onChange={(e) =>
                      setVersao(
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
                  value={
                    observacao
                  }
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
