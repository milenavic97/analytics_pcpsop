import { useEffect, useMemo, useState } from "react"
import { CalendarDays, Plus, Upload, X } from "lucide-react"

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
const AZUL = "#173B5F"

function fmt(value?: number | null) {
  return Number(value || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  })
}

function fmtData(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

function keyData(date?: string | null) {
  return date ? date.slice(0, 10) : ""
}

function gerarDias(inicioMes: number, inicioAno: number, fimMes: number, fimAno: number) {
  const dias: { data: string; dia: number; mes: number; ano: number }[] = []

  let atual = new Date(inicioAno, inicioMes - 1, 1)
  const fim = new Date(fimAno, fimMes, 0)

  while (atual <= fim) {
    const ano = atual.getFullYear()
    const mes = atual.getMonth() + 1
    const dia = atual.getDate()

    dias.push({
      data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      dia,
      mes,
      ano,
    })

    atual.setDate(atual.getDate() + 1)
  }

  return dias
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

  const [mesInicio, setMesInicio] = useState(hoje.getMonth() + 1)
  const [anoInicio, setAnoInicio] = useState(hoje.getFullYear())
  const [mesFim, setMesFim] = useState(12)
  const [anoFim, setAnoFim] = useState(2026)

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
    const versoes = rodadas
      .filter((r) => r.mes === mesSelecionado && r.ano === anoSelecionado)
      .map((r) => r.versao || 0)

    setVersao(versoes.length ? Math.max(...versoes) + 1 : 1)
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

  const dias = useMemo(
    () => gerarDias(mesInicio, anoInicio, mesFim, anoFim),
    [mesInicio, anoInicio, mesFim, anoFim]
  )

  const mesesAgrupados = useMemo(() => {
    const grupos: { label: string; span: number }[] = []

    dias.forEach((d) => {
      const label = `${MESES[d.mes - 1]}/${d.ano}`

      if (grupos.length && grupos[grupos.length - 1].label === label) {
        grupos[grupos.length - 1].span += 1
      } else {
        grupos.push({ label, span: 1 })
      }
    })

    return grupos
  }, [dias])

  const alocacaoMap = useMemo(() => {
    const map = new Map<string, number>()

    alocacoes.forEach((a) => {
      const key = `${a.recurso}|${a.lote || ""}|${a.codigo_produto || ""}|${keyData(a.data)}`
      map.set(key, (map.get(key) || 0) + Number(a.horas_alocadas || 0))
    })

    return map
  }, [alocacoes])

  const horasDiaMap = useMemo(() => {
    const map = new Map<string, number>()

    alocacoes.forEach((a) => {
      const key = `${a.recurso}|${keyData(a.data)}`
      map.set(key, (map.get(key) || 0) + Number(a.horas_alocadas || 0))
    })

    return map
  }, [alocacoes])

  const etapasPorRecurso = useMemo(() => {
    return RECURSOS.map((recurso) => ({
      recurso,
      etapas: etapas.filter((e) => e.recurso === recurso),
    }))
  }, [etapas])

  return (
    <div className="min-h-screen bg-slate-100 p-5">
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays size={22} className="text-slate-700" />
              <h1 className="text-2xl font-bold text-slate-900">MRP — Planejamento</h1>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Programação integrada de Envase, Fabrima e Liberação QA.
            </p>

            {rodadaSelecionada && (
              <div className="mt-3 inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 px-3 py-2">
                <span className="mr-2 text-xs text-slate-500">Rodada ativa:</span>
                <span className="text-sm font-semibold text-slate-700">
                  {rodadaSelecionada.nome} — {MESES[(rodadaSelecionada.mes || 1) - 1]}/
                  {rodadaSelecionada.ano} — V{rodadaSelecionada.versao}
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

            <div className="flex items-center gap-2">
              <select
                value={`${anoInicio}-${mesInicio}`}
                onChange={(e) => {
                  const [a, m] = e.target.value.split("-").map(Number)
                  setAnoInicio(a)
                  setMesInicio(m)
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Array.from({ length: 20 }, (_, i) => {
                  const m = ((hoje.getMonth() + i) % 12) + 1
                  const a = hoje.getFullYear() + Math.floor((hoje.getMonth() + i) / 12)
                  return (
                    <option key={`${a}-${m}`} value={`${a}-${m}`}>
                      {MESES[m - 1]}/{a}
                    </option>
                  )
                })}
              </select>

              <select
                value={`${anoFim}-${mesFim}`}
                onChange={(e) => {
                  const [a, m] = e.target.value.split("-").map(Number)
                  setAnoFim(a)
                  setMesFim(m)
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {Array.from({ length: 20 }, (_, i) => {
                  const base = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
                  const m = base.getMonth() + 1
                  const a = base.getFullYear()
                  return (
                    <option key={`${a}-${m}`} value={`${a}-${m}`}>
                      {MESES[m - 1]}/{a}
                    </option>
                  )
                })}
              </select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
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
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: AZUL }}
            >
              <Plus size={16} />
              Nova rodada
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {etapasPorRecurso.map(({ recurso, etapas }) => (
          <div key={recurso} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div
              className="flex items-center justify-between px-5 py-3 text-white"
              style={{ backgroundColor: AZUL }}
            >
              <div>
                <h2 className="font-semibold">Programação — {recurso}</h2>
                <p className="text-xs text-white/80">
                  {recurso === "FABRIMA" ? "Programação macro de embalagem." : "Programação macro de envase."}
                </p>
              </div>

              <div className="text-xs text-white/80">
                {loading ? "Carregando..." : `${etapas.length} linhas`}
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-[2800px] border-collapse text-xs">
                <thead>
                  <tr style={{ backgroundColor: AZUL }} className="text-white">
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-left">LOTE</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-left">CÓDIGO</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-left">PRODUTO</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-right">TEMPO<br />(Horas.)</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-right">UN /<br />HORA</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-right">QTD.<br />(Tubetes)</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">MÊS<br />PROD.</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">ANO<br />PROD.</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">DATA<br />INÍCIO</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">DATA<br />FIM</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">DATA<br />LIB.</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">MÊS<br />LIB.</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">ANO<br />LIB.</th>
                    <th rowSpan={3} className="border border-white/20 px-2 py-2 text-center">LINHA</th>

                    {mesesAgrupados.map((m) => (
                      <th key={m.label} colSpan={m.span} className="border border-white/20 px-2 py-1 text-center">
                        {m.label}
                      </th>
                    ))}
                  </tr>

                  <tr style={{ backgroundColor: AZUL }} className="text-white">
                    {dias.map((d) => (
                      <th key={`dia-${d.data}`} className="min-w-[38px] border border-white/20 px-1 py-1 text-center">
                        {d.dia}
                      </th>
                    ))}
                  </tr>

                  <tr style={{ backgroundColor: AZUL }} className="text-emerald-300">
                    {dias.map((d) => {
                      const totalDia = horasDiaMap.get(`${recurso}|${d.data}`) || 0

                      return (
                        <th key={`hora-${d.data}`} className="min-w-[38px] border border-white/20 px-1 py-1 text-center">
                          {fmt(totalDia)}
                        </th>
                      )
                    })}
                  </tr>
                </thead>

                <tbody>
                  {etapas.map((etapa) => (
                    <tr key={etapa.id} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-2 py-1">{etapa.lote || ""}</td>
                      <td className="border border-slate-200 px-2 py-1">{etapa.codigo_produto || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 font-medium text-slate-700">{etapa.descricao_produto || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right">{fmt(etapa.duracao_horas)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right">{fmt(etapa.un_hora)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right">{fmt(etapa.qtd_planejada)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{etapa.mes_producao || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{etapa.ano_producao || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{fmtData(etapa.data_inicio)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{fmtData(etapa.data_fim)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{fmtData(etapa.data_pa)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{etapa.mes_liberacao || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center">{etapa.ano_liberacao || ""}</td>
                      <td className="border border-slate-200 px-2 py-1 text-center font-semibold">{etapa.recurso}</td>

                      {dias.map((d) => {
                        const key = `${recurso}|${etapa.lote || ""}|${etapa.codigo_produto || ""}|${d.data}`
                        const horas = alocacaoMap.get(key) || 0

                        return (
                          <td key={d.data} className="border border-slate-200 px-1 py-1 text-center">
                            {horas > 0 ? (
                              <span className="font-semibold text-emerald-600">
                                {fmt(horas)}
                              </span>
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
                      <td colSpan={14 + dias.length} className="p-10 text-center text-slate-500">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Nova rodada</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Criação de nova versão histórica do planejamento.
                </p>
              </div>

              <button
                onClick={() => setModalOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-6">
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
                  className="mt-1 min-h-[100px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>

              <button
                onClick={handleCriarRodada}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white hover:opacity-90"
                style={{ backgroundColor: AZUL }}
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
