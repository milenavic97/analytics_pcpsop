import { useEffect, useMemo, useState } from "react"
import {
  CalendarDays,
  Factory,
  Wrench,
  Clock3,
  Plus,
} from "lucide-react"

import {
  getCalendarioParadas,
  getResumoCalendarioParadas,
  type ParadaProgramada,
} from "@/services/api"

const CORES_LINHA: Record<string, string> = {
  L1: "#2563EB",
  L2: "#7C3AED",
  FABRIMA: "#EA580C",
}

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
]

function formatarData(data: string) {
  try {
    return new Date(data).toLocaleDateString("pt-BR")
  } catch {
    return data
  }
}

export function CalendarioParadasPage() {
  const hoje = new Date()

  const [mesSelecionado, setMesSelecionado] = useState(
    hoje.getMonth()
  )

  const [anoSelecionado] = useState(
    hoje.getFullYear()
  )

  const [loading, setLoading] = useState(true)

  const [paradas, setParadas] = useState<ParadaProgramada[]>([])

  const [resumo, setResumo] = useState<{
    total_paradas: number
    por_linha: Record<string, number>
    proxima_parada: ParadaProgramada | null
  } | null>(null)

  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null)

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)

      const [dados, resumoDados] = await Promise.all([
        getCalendarioParadas(),
        getResumoCalendarioParadas(),
      ])

      setParadas(dados)
      setResumo(resumoDados)

    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const diasMes = useMemo(() => {
    const ultimoDia = new Date(
      anoSelecionado,
      mesSelecionado + 1,
      0
    ).getDate()

    return Array.from({ length: ultimoDia }, (_, i) => i + 1)
  }, [mesSelecionado, anoSelecionado])

  const paradasMes = useMemo(() => {
    return paradas.filter((p) => {
      const data = new Date(p.data)

      return (
        data.getMonth() === mesSelecionado &&
        data.getFullYear() === anoSelecionado
      )
    })
  }, [paradas, mesSelecionado, anoSelecionado])

  const paradasDia = useMemo(() => {
    if (!diaSelecionado) return []

    return paradasMes.filter((p) => {
      const data = new Date(p.data)
      return data.getDate() === Number(diaSelecionado)
    })
  }, [paradasMes, diaSelecionado])

  return (
    <div
      className="p-6 space-y-6 fade-in"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays size={22} />
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Calendário de Paradas
            </h1>
          </div>

          <p
            className="text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Gestão visual das paradas programadas da fábrica
          </p>
        </div>

        <button
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{
            background: "#2563EB",
          }}
        >
          <Plus size={16} />
          Nova parada
        </button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <CalendarDays size={18} />
            <span className="text-xs opacity-70">Mês</span>
          </div>

          <p className="text-3xl font-bold">
            {resumo?.total_paradas ?? 0}
          </p>

          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Paradas programadas
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <Factory size={18} />
            <span className="text-xs opacity-70">L1</span>
          </div>

          <p className="text-3xl font-bold">
            {resumo?.por_linha?.L1 ?? 0}
          </p>

          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Paradas Linha 1
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <Factory size={18} />
            <span className="text-xs opacity-70">L2</span>
          </div>

          <p className="text-3xl font-bold">
            {resumo?.por_linha?.L2 ?? 0}
          </p>

          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Paradas Linha 2
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <Wrench size={18} />
            <span className="text-xs opacity-70">Fabrima</span>
          </div>

          <p className="text-3xl font-bold">
            {resumo?.por_linha?.FABRIMA ?? 0}
          </p>

          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Paradas Fabrima
          </p>
        </div>
      </div>

      {/* Calendário */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">
              {MESES[mesSelecionado]} {anoSelecionado}
            </h2>

            <p
              className="text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              Visualização mensal das paradas
            </p>
          </div>

          <select
            value={mesSelecionado}
            onChange={(e) => setMesSelecionado(Number(e.target.value))}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            {MESES.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm opacity-60">
            Carregando calendário...
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-3">
            {diasMes.map((dia) => {
              const eventos = paradasMes.filter((p) => {
                const data = new Date(p.data)
                return data.getDate() === dia
              })

              return (
                <button
                  key={dia}
                  onClick={() => setDiaSelecionado(String(dia))}
                  className="rounded-2xl border p-3 text-left transition hover:shadow-md"
                  style={{
                    minHeight: 130,
                    borderColor:
                      diaSelecionado === String(dia)
                        ? "#2563EB"
                        : "var(--border)",
                    background:
                      diaSelecionado === String(dia)
                        ? "#EFF6FF"
                        : "white",
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">
                      {dia}
                    </span>

                    {eventos.length > 0 && (
                      <span
                        className="text-[10px] rounded-full px-2 py-0.5 text-white"
                        style={{
                          background: "#1E3A8A",
                        }}
                      >
                        {eventos.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {eventos.slice(0, 3).map((evento, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg px-2 py-1 text-[11px] text-white truncate"
                        style={{
                          background:
                            CORES_LINHA[evento.linha] || "#64748B",
                        }}
                      >
                        {evento.linha} • {evento.descricao}
                      </div>
                    ))}

                    {eventos.length > 3 && (
                      <div
                        className="text-[10px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        +{eventos.length - 3} eventos
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Painel lateral */}
      {diaSelecionado && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">
                Dia {diaSelecionado}
              </h2>

              <p
                className="text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                Detalhamento das paradas
              </p>
            </div>

            <button
              onClick={() => setDiaSelecionado(null)}
              className="text-sm opacity-70 hover:opacity-100"
            >
              Fechar
            </button>
          </div>

          {paradasDia.length === 0 ? (
            <div
              className="text-sm py-8 text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              Nenhuma parada neste dia.
            </div>
          ) : (
            <div className="space-y-3">
              {paradasDia.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="rounded-full px-2 py-1 text-xs text-white font-medium"
                          style={{
                            background:
                              CORES_LINHA[p.linha] || "#64748B",
                          }}
                        >
                          {p.linha}
                        </span>

                        <span
                          className="text-xs"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {formatarData(p.data)}
                        </span>
                      </div>

                      <h3 className="font-semibold">
                        {p.descricao}
                      </h3>

                      {p.observacao && (
                        <p
                          className="text-sm mt-2"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {p.observacao}
                        </p>
                      )}
                    </div>

                    <div
                      className="flex items-center gap-1 text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Clock3 size={14} />
                      {p.horas ?? 0}h
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
