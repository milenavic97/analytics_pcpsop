import { useEffect, useMemo, useState } from "react"
import {
  CalendarDays,
  Factory,
  Wrench,
  Clock3,
  Plus,
  Filter,
  RefreshCw,
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

const BG_LINHA: Record<string, string> = {
  L1: "#EFF6FF",
  L2: "#F5F3FF",
  FABRIMA: "#FFF7ED",
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

const LINHAS = [
  { value: "TODAS", label: "Todas" },
  { value: "L1", label: "Linha 1" },
  { value: "L2", label: "Linha 2" },
  { value: "FABRIMA", label: "Fabrima" },
]

function formatarData(data: string) {
  try {
    const [ano, mes, dia] = data.split("-").map(Number)
    return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR")
  } catch {
    return data
  }
}

function dataLocal(data: string) {
  const [ano, mes, dia] = data.split("-").map(Number)
  return new Date(ano, mes - 1, dia)
}

function getMesAno(baseMes: number, baseAno: number, offset: number) {
  const d = new Date(baseAno, baseMes + offset, 1)
  return {
    mes: d.getMonth(),
    ano: d.getFullYear(),
  }
}

function filtrarPorMesAno(paradas: ParadaProgramada[], mes: number, ano: number) {
  return paradas.filter((p) => {
    const d = dataLocal(p.data)
    return d.getMonth() === mes && d.getFullYear() === ano
  })
}

function SummaryCard({
  label,
  value,
  sub,
  color,
  Icon,
}: {
  label: string
  value: number | string
  sub: string
  color: string
  Icon: React.ElementType
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="card-label mb-2">{label}</p>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {value}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {sub}
          </p>
        </div>

        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{
            background: `${color}18`,
            color,
          }}
        >
          <Icon size={19} />
        </div>
      </div>
    </div>
  )
}

function LinhaBadge({ linha }: { linha: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
      style={{ background: CORES_LINHA[linha] || "#64748B" }}
    >
      {linha}
    </span>
  )
}

function MesCalendar({
  mes,
  ano,
  paradas,
  diaSelecionado,
  onDia,
}: {
  mes: number
  ano: number
  paradas: ParadaProgramada[]
  diaSelecionado: string | null
  onDia: (key: string) => void
}) {
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
  const ajusteSegunda = primeiroDiaSemana === 0 ? 6 : primeiroDiaSemana - 1
  const ultimoDia = new Date(ano, mes + 1, 0).getDate()
  const dias = Array.from({ length: ultimoDia }, (_, i) => i + 1)
  const vazios = Array.from({ length: ajusteSegunda }, (_, i) => i)

  return (
    <div className="card p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          {MESES[mes]} {ano}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {paradas.length} parada{paradas.length !== 1 ? "s" : ""} programada{paradas.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-2">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-3">
        {vazios.map((v) => (
          <div key={`empty-${v}`} />
        ))}

        {dias.map((dia) => {
          const eventos = paradas.filter((p) => dataLocal(p.data).getDate() === dia)
          const key = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
          const selected = diaSelecionado === key

          return (
            <button
              key={key}
              onClick={() => onDia(key)}
              className="rounded-2xl border p-3 text-left transition hover:shadow-md"
              style={{
                minHeight: 118,
                borderColor: selected ? "#2563EB" : "var(--border)",
                background: selected ? "#EFF6FF" : "var(--bg-secondary)",
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {dia}
                </span>

                {eventos.length > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ background: "#1E3A8A" }}
                  >
                    {eventos.length}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {eventos.slice(0, 3).map((evento) => (
                  <div
                    key={evento.id || `${evento.data}-${evento.linha}-${evento.descricao}`}
                    className="truncate rounded-lg px-2 py-1 text-[11px] font-semibold"
                    style={{
                      background: BG_LINHA[evento.linha] || "#F8FAFC",
                      color: CORES_LINHA[evento.linha] || "#475569",
                      border: `1px solid ${CORES_LINHA[evento.linha] || "#CBD5E1"}33`,
                    }}
                    title={`${evento.linha} · ${evento.descricao}`}
                  >
                    {evento.linha} · {evento.descricao}
                  </div>
                ))}

                {eventos.length > 3 && (
                  <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    +{eventos.length - 3} eventos
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarioParadasPage() {
  const hoje = new Date()

  const [mesSelecionado, setMesSelecionado] = useState(hoje.getMonth())
  const [anoSelecionado] = useState(hoje.getFullYear())
  const [linhaSelecionada, setLinhaSelecionada] = useState("TODAS")
  const [visao, setVisao] = useState<"MES" | "M3">("M3")
  const [loading, setLoading] = useState(true)
  const [paradas, setParadas] = useState<ParadaProgramada[]>([])
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null)

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)
      const dados = await getCalendarioParadas()
      await getResumoCalendarioParadas().catch(() => null)
      setParadas(dados)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const mesesVisiveis = useMemo(() => {
    const qtd = visao === "M3" ? 4 : 1
    return Array.from({ length: qtd }, (_, i) => getMesAno(mesSelecionado, anoSelecionado, i))
  }, [visao, mesSelecionado, anoSelecionado])

  const paradasFiltradas = useMemo(() => {
    return paradas.filter((p) => {
      if (linhaSelecionada !== "TODAS" && p.linha !== linhaSelecionada) return false

      return mesesVisiveis.some(({ mes, ano }) => {
        const d = dataLocal(p.data)
        return d.getMonth() === mes && d.getFullYear() === ano
      })
    })
  }, [paradas, linhaSelecionada, mesesVisiveis])

  const resumoFiltrado = useMemo(() => {
    const total = paradasFiltradas.length
    const l1 = paradasFiltradas.filter((p) => p.linha === "L1").length
    const l2 = paradasFiltradas.filter((p) => p.linha === "L2").length
    const fabrima = paradasFiltradas.filter((p) => p.linha === "FABRIMA").length

    const futuras = [...paradasFiltradas]
      .filter((p) => dataLocal(p.data) >= new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()))
      .sort((a, b) => dataLocal(a.data).getTime() - dataLocal(b.data).getTime())

    return {
      total,
      l1,
      l2,
      fabrima,
      proxima: futuras[0] || null,
    }
  }, [paradasFiltradas])

  const paradasDia = useMemo(() => {
    if (!diaSelecionado) return []
    return paradasFiltradas.filter((p) => p.data === diaSelecionado)
  }, [paradasFiltradas, diaSelecionado])

  return (
    <div className="min-h-screen space-y-6 p-4 md:p-6" style={{ background: "var(--bg-primary)" }}>
      <div className="fade-in flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p
            className="mb-1 text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-secondary)" }}
          >
            Planejamento · Capacidade
          </p>

          <div className="flex items-center gap-2">
            <CalendarDays size={24} style={{ color: "#2563EB" }} />
            <h1 className="text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>
              Calendário de Paradas
            </h1>
          </div>

          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Gestão visual das paradas programadas da fábrica por linha produtiva.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={carregar}
            disabled={loading}
            className="flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold"
            style={{ cursor: loading ? "not-allowed" : "pointer" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>

          <button
            className="flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold text-white"
            style={{ background: "var(--bg-sidebar)" }}
          >
            <Plus size={14} />
            Nova parada
          </button>
        </div>
      </div>

      <div className="card p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Filter size={14} style={{ color: "var(--text-secondary)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
            Filtros
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label className="card-label">Mês inicial</label>
            <select
              value={mesSelecionado}
              onChange={(e) => {
                setMesSelecionado(Number(e.target.value))
                setDiaSelecionado(null)
              }}
              className="h-11 rounded-lg border px-3 text-sm outline-none"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {MESES.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="card-label">Visão</label>
            <select
              value={visao}
              onChange={(e) => {
                setVisao(e.target.value as "MES" | "M3")
                setDiaSelecionado(null)
              }}
              className="h-11 rounded-lg border px-3 text-sm outline-none"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="MES">Somente mês</option>
              <option value="M3">Mês + 3 meses</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="card-label">Linha</label>
            <select
              value={linhaSelecionada}
              onChange={(e) => {
                setLinhaSelecionada(e.target.value)
                setDiaSelecionado(null)
              }}
              className="h-11 rounded-lg border px-3 text-sm outline-none"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {LINHAS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-end">
            <div
              className="rounded-xl border px-4 py-3 text-xs"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              Exibindo{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {paradasFiltradas.length}
              </strong>{" "}
              parada{paradasFiltradas.length !== 1 ? "s" : ""} no período.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 fade-in">
        <SummaryCard
          label="Total no período"
          value={resumoFiltrado.total}
          sub={visao === "M3" ? "Mês inicial + 3 meses" : "Mês selecionado"}
          color="#64748B"
          Icon={CalendarDays}
        />

        <SummaryCard
          label="Linha 1"
          value={resumoFiltrado.l1}
          sub="Paradas programadas"
          color="#2563EB"
          Icon={Factory}
        />

        <SummaryCard
          label="Linha 2"
          value={resumoFiltrado.l2}
          sub="Paradas programadas"
          color="#7C3AED"
          Icon={Factory}
        />

        <SummaryCard
          label="Fabrima"
          value={resumoFiltrado.fabrima}
          sub="Paradas programadas"
          color="#EA580C"
          Icon={Wrench}
        />
      </div>

      {resumoFiltrado.proxima && (
        <div
          className="fade-in rounded-xl border px-4 py-3 text-xs"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          Próxima parada no período:{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {formatarData(resumoFiltrado.proxima.data)}
          </strong>{" "}
          · <LinhaBadge linha={resumoFiltrado.proxima.linha} />{" "}
          <span style={{ color: "var(--text-primary)" }}>
            {resumoFiltrado.proxima.descricao}
          </span>
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm fade-in" style={{ color: "var(--text-secondary)" }}>
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" style={{ opacity: 0.4 }} />
          Carregando calendário de paradas...
        </div>
      ) : (
        <div className="space-y-5 fade-in">
          {mesesVisiveis.map(({ mes, ano }) => (
            <MesCalendar
              key={`${ano}-${mes}`}
              mes={mes}
              ano={ano}
              paradas={filtrarPorMesAno(paradasFiltradas, mes, ano)}
              diaSelecionado={diaSelecionado}
              onDia={setDiaSelecionado}
            />
          ))}
        </div>
      )}

      {diaSelecionado && (
        <div className="card p-5 fade-in">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="card-label mb-1">Detalhamento</p>
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {formatarData(diaSelecionado)}
              </h2>
            </div>

            <button
              onClick={() => setDiaSelecionado(null)}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              Fechar
            </button>
          </div>

          {paradasDia.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              Nenhuma parada neste dia para os filtros selecionados.
            </div>
          ) : (
            <div className="space-y-3">
              {paradasDia.map((p) => (
                <div
                  key={p.id || `${p.data}-${p.linha}-${p.descricao}`}
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: "var(--border)",
                    background: BG_LINHA[p.linha] || "var(--bg-secondary)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <LinhaBadge linha={p.linha} />
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {formatarData(p.data)}
                        </span>
                      </div>

                      <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {p.descricao}
                      </h3>

                      {p.observacao && (
                        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                          {p.observacao}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
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
