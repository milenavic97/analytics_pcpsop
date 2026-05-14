import { useEffect, useMemo, useState } from "react"
import { getMrpPlano } from "@/services/api"

type MrpItem = {
  id?: string | number
  produto?: string
  sku?: string
  descricao?: string
  linha?: string
  grupo?: string
  estoque_atual?: number
  necessidade_total?: number
  saldo_final?: number
  dias?: Record<string, number>
}

const AZUL = "#243C8F"

function formatDataISO(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatDia(date: Date) {
  return String(date.getDate()).padStart(2, "0")
}

function formatMesAno(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  })
}

function formatNumber(value: any) {
  const n = Number(value || 0)
  return n.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })
}

function gerarDiasAteDez2026() {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const fim = new Date(2026, 11, 31)
  fim.setHours(0, 0, 0, 0)

  const dias: Date[] = []
  const atual = new Date(hoje)

  while (atual <= fim) {
    dias.push(new Date(atual))
    atual.setDate(atual.getDate() + 1)
  }

  return dias
}

export default function MrpPage() {
  const [dados, setDados] = useState<MrpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [versao, setVersao] = useState<string>("")
  const [filtro, setFiltro] = useState("")

  const dias = useMemo(() => gerarDiasAteDez2026(), [])

  const meses = useMemo(() => {
    const grupos: { mes: string; inicio: number; span: number }[] = []

    dias.forEach((d, index) => {
      const mes = formatMesAno(d)

      const ultimo = grupos[grupos.length - 1]

      if (!ultimo || ultimo.mes !== mes) {
        grupos.push({
          mes,
          inicio: index,
          span: 1,
        })
      } else {
        ultimo.span += 1
      }
    })

    return grupos
  }, [dias])

  const horasDisponiveis = useMemo(() => {
    const mapa: Record<string, number> = {}

    dias.forEach((d) => {
      const diaSemana = d.getDay()
      const iso = formatDataISO(d)

      if (diaSemana === 0) mapa[iso] = 0
      else if (diaSemana === 6) mapa[iso] = 8
      else mapa[iso] = 16
    })

    return mapa
  }, [dias])

  async function carregarDados() {
    setLoading(true)

    try {
      const res = await getMrpPlano()
      setDados(Array.isArray(res) ? res : [])
    } catch (error) {
      console.error("Erro ao carregar MRP:", error)
      setDados([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [])

  const dadosFiltrados = useMemo(() => {
    const termo = filtro.toLowerCase().trim()

    if (!termo) return dados

    return dados.filter((item) => {
      return [
        item.produto,
        item.sku,
        item.descricao,
        item.linha,
        item.grupo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(termo)
    })
  }, [dados, filtro])

  async function novaRodada() {
    const nome = `Rodada ${new Date().toLocaleString("pt-BR")}`
    setVersao(nome)
    await carregarDados()
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Plano MRP
          </h1>
          <p className="text-sm text-slate-500">
            Visão diária de necessidade, capacidade e programação até dez/2026.
          </p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar produto, SKU, grupo ou linha..."
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-700 md:w-80"
          />

          <button
            onClick={novaRodada}
            className="h-10 rounded-xl px-5 text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: AZUL }}
          >
            Nova rodada
          </button>
        </div>
      </div>

      {versao && (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          Versão atual: <b>{versao}</b>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[75vh] overflow-auto">
          <table className="border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  rowSpan={3}
                  className="sticky left-0 z-30 min-w-[150px] rounded-tl-2xl border-r border-blue-300 px-3 py-3 text-left text-white"
                  style={{ backgroundColor: AZUL }}
                >
                  SKU
                </th>

                <th
                  rowSpan={3}
                  className="sticky left-[150px] z-30 min-w-[260px] border-r border-blue-300 px-3 py-3 text-left text-white"
                  style={{ backgroundColor: AZUL }}
                >
                  Produto
                </th>

                <th
                  rowSpan={3}
                  className="sticky left-[410px] z-30 min-w-[100px] border-r border-blue-300 px-3 py-3 text-left text-white"
                  style={{ backgroundColor: AZUL }}
                >
                  Linha
                </th>

                <th
                  rowSpan={3}
                  className="sticky left-[510px] z-30 min-w-[120px] border-r border-blue-300 px-3 py-3 text-right text-white"
                  style={{ backgroundColor: AZUL }}
                >
                  Estoque
                </th>

                <th
                  rowSpan={3}
                  className="sticky left-[630px] z-30 min-w-[130px] border-r border-blue-300 px-3 py-3 text-right text-white"
                  style={{ backgroundColor: AZUL }}
                >
                  Necessidade
                </th>

                {meses.map((m, index) => (
                  <th
                    key={`${m.mes}-${index}`}
                    colSpan={m.span}
                    className={`border-r border-blue-300 px-2 py-2 text-center font-semibold text-white ${
                      index === meses.length - 1 ? "rounded-tr-2xl" : ""
                    }`}
                    style={{ backgroundColor: AZUL }}
                  >
                    {m.mes}
                  </th>
                ))}
              </tr>

              <tr>
                {dias.map((d) => (
                  <th
                    key={`dia-${formatDataISO(d)}`}
                    className="min-w-[44px] border-r border-blue-300 px-1 py-1 text-center text-xs font-medium text-white"
                    style={{ backgroundColor: AZUL }}
                  >
                    {formatDia(d)}
                  </th>
                ))}
              </tr>

              <tr>
                {dias.map((d) => {
                  const iso = formatDataISO(d)

                  return (
                    <th
                      key={`hora-${iso}`}
                      className="min-w-[44px] border-r border-blue-300 px-1 py-1 text-center text-[11px] font-normal text-blue-50"
                      style={{ backgroundColor: AZUL }}
                    >
                      {horasDisponiveis[iso]}h
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={dias.length + 5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Carregando plano MRP...
                  </td>
                </tr>
              )}

              {!loading && dadosFiltrados.length === 0 && (
                <tr>
                  <td
                    colSpan={dias.length + 5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Nenhum dado encontrado.
                  </td>
                </tr>
              )}

              {!loading &&
                dadosFiltrados.map((item, rowIndex) => {
                  const bgBase = rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50"

                  return (
                    <tr key={item.id ?? `${item.sku}-${rowIndex}`}>
                      <td
                        className={`sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-2 font-medium text-slate-800 ${bgBase}`}
                      >
                        {item.sku || "-"}
                      </td>

                      <td
                        className={`sticky left-[150px] z-10 border-b border-r border-slate-200 px-3 py-2 text-slate-700 ${bgBase}`}
                      >
                        {item.descricao || item.produto || "-"}
                      </td>

                      <td
                        className={`sticky left-[410px] z-10 border-b border-r border-slate-200 px-3 py-2 text-slate-700 ${bgBase}`}
                      >
                        {item.linha || "-"}
                      </td>

                      <td
                        className={`sticky left-[510px] z-10 border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 ${bgBase}`}
                      >
                        {formatNumber(item.estoque_atual)}
                      </td>

                      <td
                        className={`sticky left-[630px] z-10 border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700 ${bgBase}`}
                      >
                        {formatNumber(item.necessidade_total)}
                      </td>

                      {dias.map((d) => {
                        const iso = formatDataISO(d)
                        const qtd = Number(item.dias?.[iso] || 0)

                        let cellClass =
                          "border-b border-r border-slate-200 px-1 py-2 text-center text-xs"

                        if (qtd > 0) {
                          cellClass += " bg-blue-100 text-blue-900 font-semibold"
                        } else {
                          cellClass += " text-slate-300"
                        }

                        return (
                          <td key={`${item.sku}-${iso}`} className={cellClass}>
                            {qtd > 0 ? formatNumber(qtd) : ""}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
