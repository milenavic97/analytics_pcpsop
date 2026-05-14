import { useEffect, useMemo, useState } from "react"
import {
  criarMrpRodada,
  getMrpOrdens,
  getMrpRodadas,
  type MrpOrdem,
  type MrpRodada,
} from "@/services/api"

const MESES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
]

function formatDate(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

function getStatusColor(status?: string) {
  if (status === "concluida") return "bg-emerald-500"
  if (status === "em_producao") return "bg-blue-500"
  if (status === "atrasada") return "bg-red-500"
  if (status === "gargalo") return "bg-amber-500"
  return "bg-slate-500"
}

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] = useState<MrpRodada | null>(null)
  const [ordens, setOrdens] = useState<MrpOrdem[]>([])
  const [loading, setLoading] = useState(false)

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

  async function carregarOrdens(rodadaId: string) {
    setLoading(true)
    try {
      const data = await getMrpOrdens(rodadaId)
      setOrdens(data)
    } finally {
      setLoading(false)
    }
  }

  async function handleCriarRodada() {
    const proximaVersao =
      Math.max(
        0,
        ...rodadas
          .filter((r) => r.mes === mes && r.ano === ano)
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
    setObservacao("")
    await carregarRodadas()
  }

  useEffect(() => {
    carregarRodadas()
  }, [])

  useEffect(() => {
    if (rodadaSelecionada?.id) {
      carregarOrdens(rodadaSelecionada.id)
    } else {
      setOrdens([])
    }
  }, [rodadaSelecionada?.id])

  const diasDoMes = useMemo(() => {
    const total = new Date(ano, mes, 0).getDate()
    return Array.from({ length: total }, (_, i) => i + 1)
  }, [mes, ano])

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">
          MRP — Rodadas de Planejamento
        </h1>
        <p className="text-sm text-slate-500">
          Crie versões do plano, acompanhe ordens planejadas e visualize a sequência em formato Gantt.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Nova rodada</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Nome</label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">Mês</label>
                <select
                  value={mes}
                  onChange={(e) => setMes(Number(e.target.value))}
                  className="w-full mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
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
                  className="w-full mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500">Observação</label>
              <textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="w-full mt-1 rounded-xl border border-slate-300 px-3 py-2 text-sm min-h-[80px]"
                placeholder="Ex: rodada considerando compras negociadas até hoje..."
              />
            </div>

            <button
              onClick={handleCriarRodada}
              className="w-full rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Nova rodada
            </button>
          </div>
        </div>

        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Versões existentes</h2>

            <select
              value={rodadaSelecionada?.id || ""}
              onChange={(e) => {
                const rodada = rodadas.find((r) => r.id === e.target.value) || null
                setRodadaSelecionada(rodada)
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Selecione uma rodada</option>
              {rodadas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} — {MESES[(r.mes || 1) - 1]}/{r.ano} — V{r.versao}
                </option>
              ))}
            </select>
          </div>

          {rodadaSelecionada ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs text-slate-500">Rodada</p>
                <p className="font-semibold text-slate-900">{rodadaSelecionada.nome}</p>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs text-slate-500">Período</p>
                <p className="font-semibold text-slate-900">
                  {MESES[(rodadaSelecionada.mes || 1) - 1]}/{rodadaSelecionada.ano}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs text-slate-500">Versão</p>
                <p className="font-semibold text-slate-900">V{rodadaSelecionada.versao}</p>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs text-slate-500">Status</p>
                <p className="font-semibold text-slate-900">{rodadaSelecionada.status || "rascunho"}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhuma rodada selecionada.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">Gantt das ordens planejadas</h2>
          <span className="text-xs text-slate-500">
            {loading ? "Carregando..." : `${ordens.length} ordens`}
          </span>
        </div>

        {ordens.length === 0 ? (
          <div className="rounded-xl bg-slate-50 border border-dashed border-slate-300 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              Ainda não existem ordens para esta rodada.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Na próxima etapa vamos criar o botão de gerar MRP automaticamente.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1000px]">
              <div
                className="grid border-b border-slate-200 pb-2 text-xs text-slate-500"
                style={{ gridTemplateColumns: `220px repeat(${diasDoMes.length}, 32px)` }}
              >
                <div>OP / Produto</div>
                {diasDoMes.map((dia) => (
                  <div key={dia} className="text-center">{dia}</div>
                ))}
              </div>

              <div className="space-y-2 mt-3">
                {ordens.map((ordem) => {
                  const inicio = ordem.data_inicio
                    ? new Date(`${ordem.data_inicio}T00:00:00`).getDate()
                    : 1

                  const fim = ordem.data_fim
                    ? new Date(`${ordem.data_fim}T00:00:00`).getDate()
                    : inicio

                  const duracao = Math.max(1, fim - inicio + 1)

                  return (
                    <div
                      key={ordem.id}
                      className="grid items-center text-xs"
                      style={{ gridTemplateColumns: `220px repeat(${diasDoMes.length}, 32px)` }}
                    >
                      <div className="pr-3">
                        <p className="font-semibold text-slate-800 truncate">
                          {ordem.op || ordem.codigo_produto || "-"}
                        </p>
                        <p className="text-slate-500 truncate">
                          {ordem.descricao_produto || "Sem descrição"}
                        </p>
                      </div>

                      <div
                        className={`${getStatusColor(ordem.status)} h-7 rounded-lg text-white flex items-center px-2 shadow-sm`}
                        style={{
                          gridColumn: `${inicio + 1} / span ${duracao}`,
                        }}
                        title={`${formatDate(ordem.data_inicio)} até ${formatDate(ordem.data_fim)}`}
                      >
                        <span className="truncate">
                          {ordem.linha || ""} {ordem.qtd_planejada ? `• ${ordem.qtd_planejada}` : ""}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
