import { useEffect, useMemo, useState } from "react"
import {
  Plus,
  CalendarDays,
  X,
  Upload,
} from "lucide-react"

import {
  criarMrpRodada,
  getMrpAlocacoes,
  getMrpEtapas,
  getMrpRodadas,
  importarMrpMps,
  type MrpAlocacaoDia,
  type MrpEtapa,
  type MrpRodada,
} from "@/services/api"

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
const RECURSOS = ["L1", "L2", "FABRIMA"]

function dateKey(date?: string | null) {
  return date ? date.slice(0, 10) : ""
}

function formatNumber(value?: number | null) {
  return Number(value || 0).toLocaleString("pt-BR")
}

function formatDate(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] = useState<MrpRodada | null>(null)

  const [etapas, setEtapas] = useState<MrpEtapa[]>([])
  const [alocacoes, setAlocacoes] = useState<MrpAlocacaoDia[]>([])

  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const [nome, setNome] = useState("Rodada MRP")
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [versao, setVersao] = useState(1)
  const [observacao, setObservacao] = useState("")
  const [arquivoMps, setArquivoMps] = useState<File | null>(null)

  async function carregarRodadas() {
    const data = await getMrpRodadas()
    setRodadas(data)

    if (data.length > 0 && !rodadaSelecionada) {
      setRodadaSelecionada(data[0])
    }
  }

  async function carregarDadosRodada(rodadaId: string) {
    setLoading(true)

    try {
      const [etapasData, alocacoesData] = await Promise.all([
        getMrpEtapas(rodadaId),
        getMrpAlocacoes(rodadaId),
      ])

      setEtapas(etapasData)
      setAlocacoes(alocacoesData)
    } finally {
      setLoading(false)
    }
  }

  function sugerirProximaVersao(mesSelecionado: number, anoSelecionado: number) {
    const versoesMesmoMes = rodadas
      .filter((r) => r.mes === mesSelecionado && r.ano === anoSelecionado)
      .map((r) => r.versao || 0)

    setVersao(versoesMesmoMes.length > 0 ? Math.max(...versoesMesmoMes) + 1 : 1)
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

      await importarMrpMps(rodadaSelecionada.id, arquivoMps)
      await carregarDadosRodada(rodadaSelecionada.id)

      alert("Planejamento importado com sucesso.")
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : "Erro ao importar planejamento.")
    } finally {
      setImportando(false)
    }
  }

  useEffect(() => {
    carregarRodadas()
  }, [])

  useEffect(() => {
    if (rodadaSelecionada?.id) {
      carregarDadosRodada(rodadaSelecionada.id)
    } else {
      setEtapas([])
      setAlocacoes([])
    }
  }, [rodadaSelecionada?.id])

  useEffect(() => {
    sugerirProximaVersao(mes, ano)
  }, [mes, ano, rodadas])

  const diasDoMes = useMemo(() => {
    const total = new Date(ano, mes, 0).getDate()

    return Array.from({ length: total }, (_, i) => {
      const dia = i + 1
      const data = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`

      return { dia, data }
    })
  }, [mes, ano])

  const alocacaoMap = useMemo(() => {
    const map = new Map<string, number>()

    for (const item of alocacoes) {
      const key = `${item.recurso}|${item.lote || ""}|${item.codigo_produto || ""}|${dateKey(item.data)}`
      map.set(key, (map.get(key) || 0) + Number(item.horas_alocadas || 0))
    }

    return map
  }, [alocacoes])

  const capacidadePorRecursoDia = useMemo(() => {
    const map = new Map<string, number>()

    for (const item of alocacoes) {
      const key = `${item.recurso}|${dateKey(item.data)}`
      map.set(key, (map.get(key) || 0) + Number(item.horas_alocadas || 0))
    }

    return map
  }, [alocacoes])

  const etapasPorRecurso = useMemo(() => {
    return RECURSOS.map((recurso) => ({
      recurso,
      etapas: etapas.filter((e) => e.recurso === recurso),
    }))
  }, [etapas])

  return (
    <div className="bg-slate-100 min-h-screen p-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays size={22} className="text-slate-700" />
              <h1 className="text-2xl font-bold text-slate-900">MRP — Planejamento</h1>
            </div>

            <p className="text-sm text-slate-500 mt-1">
              Programação visual com colunas operacionais e horas alocadas dia a dia.
            </p>

            {rodadaSelecionada && (
              <div className="mt-3 inline-flex items-center rounded-xl bg-slate-100 border border-slate-200 px-3 py-2">
                <span className="text-xs text-slate-500 mr-2">Rodada ativa:</span>
                <span className="text-sm font-semibold text-slate-700">
                  {rodadaSelecionada.nome} — {MESES[(rodadaSelecionada.mes || 1) - 1]}/{rodadaSelecionada.ano} — V
                  {rodadaSelecionada.versao}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={rodadaSelecionada?.id || ""}
              onChange={(e) => {
                const rodada = rodadas.find((r) => r.id === e.target.value) || null
                setRodadaSelecionada(rodada)

                if (rodada) {
                  setMes(rodada.mes)
                  setAno(rodada.ano)
                }
              }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">Selecionar rodada</option>

              {rodadas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} — {MESES[(r.mes || 1) - 1]}/{r.ano} — V{r.versao}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
              <Upload size={16} />

              <input
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => setArquivoMps(e.target.files?.[0] || null)}
              />

              {arquivoMps ? "Arquivo selecionado" : "Importar planejamento"}
            </label>

            <button
              onClick={handleImportarMps}
              disabled={!arquivoMps || !rodadaSelecionada || importando}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {importando ? "Importando..." : "Processar MPS"}
            </button>

            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} />
              Nova rodada
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {etapasPorRecurso.map(({ recurso, etapas }) => (
          <div key={recurso} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">Programação — {recurso}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {recurso === "FABRIMA" ? "Programação macro de embalagem." : "Programação macro de envase."}
                </p>
              </div>

              <div className="text-xs text-slate-500">
                {loading ? "Carregando..." : `${etapas.length} linhas`}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-[2400px] border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="sticky left-0 z-20 bg-slate-50 border border-slate-200 px-2 py-2 text-left w-[90px]">EMBALADO</th>
                    <th className="border border-slate-200 px-2 py-2 text-left w-[110px]">LOTE</th>
                    <th className="border border-slate-200 px-2 py-2 text-left w-[110px]">CÓDIGO</th>
                    <th className="border border-slate-200 px-2 py-2 text-left w-[220px]">PRODUTO</th>
                    <th className="border border-slate-200 px-2 py-2 text-right w-[110px]">TEMPO (Horas.)</th>
                    <th className="border border-slate-200 px-2 py-2 text-right w-[90px]">UN / HORA</th>
                    <th className="border border-slate-200 px-2 py-2 text-right w-[120px]">QTD. (Tubetes)</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[90px]">MÊS PRODUÇÃO</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[90px]">ANO PRODUÇÃO</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[100px]">DATA INÍCIO</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[100px]">DATA FIM</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[100px]">DATA LIB.</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[100px]">MÊS LIBERAÇÃO</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[100px]">ANO LIBERAÇÃO</th>
                    <th className="border border-slate-200 px-2 py-2 text-center w-[70px]">LINHA</th>

                    {diasDoMes.map((d) => {
                      const totalDia = capacidadePorRecursoDia.get(`${recurso}|${d.data}`) || 0

                      return (
                        <th key={d.data} className="border border-slate-200 px-1 py-1 text-center min-w-[46px]">
                          <div className="font-semibold">{d.dia}</div>
                          <div className="text-[10px] text-slate-400">{formatNumber(totalDia)}h</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>

                <tbody>
                  {etapas.map((etapa) => (
                    <tr key={etapa.id} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white border border-slate-200 px-2 py-2">{etapa.embalado || ""}</td>
                      <td className="border border-slate-200 px-2 py-2">{etapa.lote || ""}</td>
                      <td className="border border-slate-200 px-2 py-2">{etapa.codigo_produto || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 font-medium text-slate-700">{etapa.descricao_produto || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right">{formatNumber(etapa.duracao_horas)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right">{formatNumber(etapa.un_hora)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-right">{formatNumber(etapa.qtd_planejada)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{etapa.mes_producao || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{etapa.ano_producao || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{formatDate(etapa.data_inicio)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{formatDate(etapa.data_fim)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{formatDate(etapa.data_pa)}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{etapa.mes_liberacao || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center">{etapa.ano_liberacao || ""}</td>
                      <td className="border border-slate-200 px-2 py-2 text-center font-semibold">{etapa.recurso}</td>

                      {diasDoMes.map((d) => {
                        const key = `${recurso}|${etapa.lote || ""}|${etapa.codigo_produto || ""}|${d.data}`
                        const horas = alocacaoMap.get(key) || 0

                        return (
                          <td key={d.data} className="border border-slate-200 px-1 py-1 text-center">
                            {horas > 0 ? (
                              <div className="rounded bg-emerald-100 text-emerald-800 font-semibold py-1">
                                {formatNumber(horas)}
                              </div>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}

                  {etapas.length === 0 && (
                    <tr>
                      <td colSpan={15 + diasDoMes.length} className="border border-slate-200 p-10 text-center text-slate-500">
                        Nenhuma etapa cadastrada para {recurso}. Selecione uma rodada e importe o Excel MPS.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Nova rodada</h2>
                <p className="text-xs text-slate-500 mt-1">Criação de nova versão histórica do planejamento.</p>
              </div>

              <button
                onClick={() => setModalOpen(false)}
                className="h-9 w-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500">Nome</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Mês</label>
                  <select
                    value={mes}
                    onChange={(e) => setMes(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  >
                    {MESES.map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Ano</label>
                  <input
                    type="number"
                    value={ano}
                    onChange={(e) => setAno(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Versão</label>
                  <input
                    type="number"
                    value={versao}
                    onChange={(e) => setVersao(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">Observação</label>
                <textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm min-h-[100px]"
                />
              </div>

              <button
                onClick={handleCriarRodada}
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
