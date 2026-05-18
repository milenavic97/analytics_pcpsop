import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Search, ShieldAlert } from "lucide-react"

import { getDados } from "../../services/api"

type ConsumoMaterial = {
  id: number
  codigo: string
  produto: string

  saldo: number

  media_3m: number
  media_6m: number
  maior_media: number
  maior_media_50: number

  cobertura_dias: number

  saldo_menos_maior_media_50: number

  created_at?: string
}

export default function AnaliseMrpPage() {
  const [loading, setLoading] = useState(true)

  const [dados, setDados] = useState<ConsumoMaterial[]>([])

  const [busca, setBusca] = useState("")

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)

      const res = (await getDados(
        "consumo_materiais",
        1,
        1000
      )) as {
        data: ConsumoMaterial[]
        total: number
        page: number
        per_page: number
      }

      setDados(res.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const dadosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase()

    return dados.filter((item) => {
      return (
        item.codigo?.toLowerCase().includes(termo) ||
        item.produto?.toLowerCase().includes(termo)
      )
    })
  }, [dados, busca])

  const materiaisCriticos = useMemo(() => {
    return dados.filter(
      (d) =>
        Number(d.saldo || 0) <=
        Number(d.maior_media_50 || 0)
    ).length
  }, [dados])

  const coberturaBaixa = useMemo(() => {
    return dados.filter(
      (d) => Number(d.cobertura_dias || 0) < 30
    ).length
  }, [dados])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">
          Análise MRP
        </h1>

        <p className="mt-1 text-sm text-zinc-400">
          Comparativo entre estoque,
          consumo histórico e risco de ruptura.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CardResumo
          titulo="Materiais"
          valor={dados.length}
        />

        <CardResumo
          titulo="Materiais Críticos"
          valor={materiaisCriticos}
          danger
        />

        <CardResumo
          titulo="Cobertura < 30 dias"
          valor={coberturaBaixa}
          warning
        />

        <CardResumo
          titulo="Snapshot Atual"
          valor={
            dados.length
              ? new Date().toLocaleDateString("pt-BR")
              : "-"
          }
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search
              className="absolute left-3 top-3 text-zinc-500"
              size={16}
            />

            <input
              value={busca}
              onChange={(e) =>
                setBusca(e.target.value)
              }
              placeholder="Buscar material..."
              className="w-full rounded-xl border border-white/10 bg-zinc-950 px-10 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-zinc-400">
                <th className="px-3 py-3">
                  Código
                </th>

                <th className="px-3 py-3">
                  Produto
                </th>

                <th className="px-3 py-3 text-right">
                  Saldo
                </th>

                <th className="px-3 py-3 text-right">
                  Média 3M
                </th>

                <th className="px-3 py-3 text-right">
                  Maior Média +50%
                </th>

                <th className="px-3 py-3 text-right">
                  Cobertura
                </th>

                <th className="px-3 py-3 text-center">
                  Status
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-zinc-500"
                  >
                    Carregando...
                  </td>
                </tr>
              ) : dadosFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-zinc-500"
                  >
                    Nenhum dado encontrado.
                  </td>
                </tr>
              ) : (
                dadosFiltrados.map((item) => {
                  const saldo = Number(
                    item.saldo || 0
                  )

                  const referencia = Number(
                    item.maior_media_50 || 0
                  )

                  const cobertura = Number(
                    item.cobertura_dias || 0
                  )

                  const critico =
                    saldo <= referencia

                  const coberturaRuim =
                    cobertura < 30

                  return (
                    <tr
                      key={item.id}
                      className="border-b border-white/5 transition hover:bg-white/5"
                    >
                      <td className="px-3 py-3 font-medium text-zinc-300">
                        {item.codigo}
                      </td>

                      <td className="px-3 py-3 text-zinc-200">
                        {item.produto}
                      </td>

                      <td className="px-3 py-3 text-right text-zinc-300">
                        {saldo.toLocaleString(
                          "pt-BR"
                        )}
                      </td>

                      <td className="px-3 py-3 text-right text-zinc-300">
                        {Number(
                          item.media_3m || 0
                        ).toLocaleString("pt-BR")}
                      </td>

                      <td className="px-3 py-3 text-right text-zinc-300">
                        {referencia.toLocaleString(
                          "pt-BR"
                        )}
                      </td>

                      <td className="px-3 py-3 text-right text-zinc-300">
                        {cobertura.toFixed(0)} dias
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex justify-center">
                          {critico ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-400">
                              <ShieldAlert
                                size={14}
                              />
                              Crítico
                            </span>
                          ) : coberturaRuim ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-3 py-1 text-xs font-medium text-yellow-300">
                              <AlertTriangle
                                size={14}
                              />
                              Atenção
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-400">
                              Saudável
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

type CardProps = {
  titulo: string
  valor: string | number
  danger?: boolean
  warning?: boolean
}

function CardResumo({
  titulo,
  valor,
  danger,
  warning,
}: CardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
      <p className="text-sm text-zinc-400">
        {titulo}
      </p>

      <h2
        className={[
          "mt-2 text-3xl font-bold",
          danger
            ? "text-red-400"
            : warning
            ? "text-yellow-300"
            : "text-white",
        ].join(" ")}
      >
        {valor}
      </h2>
    </div>
  )
}
