import { memo, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  BarChart3,
  ChevronDown,
  Clock3,
  Factory,
  CheckCircle2,
  Copy,
  Filter,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from "lucide-react"

import {
  atualizarMrpEtapa,
  copiarMrpRodada,
  criarMrpRodada,
  excluirMrpRodada,
  getMrpAlocacoes,
  getMrpEtapas,
  getMrpMudancasRealizado,
  getMrpRodadas,
  getOrcadoFaturamento,
  getOrcadoLiberacao,
  getSd3RealizadoMensal,
  importarMrpMps,
  importarMrpProducaoReal,
  type MrpAlocacaoDia,
  type MrpEtapa,
  type MrpRodada,
} from "@/services/api"

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
const RECURSOS = ["L1", "L2", "FABRIMA"]
const AZUL = "#17375E"
const PAGE_SIZE = 50

type AbaMps = "detalhado" | "consolidado" | "perdas"

const COR_ORCADO = "#EA580C"
const COR_PERDA = "#DC2626"
const COR_GANHO = "#15803D"

// ─── Tipos ────────────────────────────────────────────────────────────────────

type UnidadeConsolidado = "caixas" | "tubetes"
type ComparativoPerda = "v1" | "orcado_saida" | "orcado_liberacao"

type Filtros = {
  busca: string
  lote: string
  codigo: string
  produto: string
  mesProducao: string
  anoProducao: string
  mesLiberacao: string
  anoLiberacao: string
  recurso: string
}

type EdicaoEtapa = {
  descricao_produto?: string | null
  codigo_produto?: string | null
  lote?: string | null
  mes_liberacao?: number | null
  ano_liberacao?: number | null
  observacao?: string | null
  mes_lib_manual?: boolean
}

type Toast = { tipo: "success" | "error"; titulo: string; mensagem: string }

type ParadaCogtive = {
  recurso?: string | null
  equipamento?: string | null
  tipo_evento?: string | null
  evento?: string | null
  data_inicial?: string | null
  data_final?: string | null
  hora_inicio?: string | null
  hora_fim?: string | null
  duracao_horas?: number | null
}

type MudancaRealizado = {
  lote?: string | null
  lote_real_cogtive?: string | null
  codigo_produto?: string | null
  descricao_produto?: string | null
  recurso?: string | null
  data_inicio?: string | null
  data_inicio_anterior?: string | null
  data_fim_anterior?: string | null
  data_fim_nova?: string | null
  hora_fim_real?: string | null
  data_lib_nova?: string | null
  mes_liberacao_novo?: number | null
  ano_liberacao_novo?: number | null
  un_hora_anterior?: number | null
  un_hora_nova?: number | null
  duracao_horas_nova?: number | null
  qtd_planejada?: number | null
  motivo_provavel?: string | null
  metodo_casamento?: string | null
  tipo_realizacao?: "concluido" | "parcial_em_producao" | "cascata" | string | null
  impacto_dias?: number | null
  tipo_impacto?: "atrasou" | "antecipou" | "sem_mudanca_data" | "sem_comparativo" | string
  delta_un_hora?: number | null
  delta_un_hora_pct?: number | null
  paradas_dia_fim_anterior?: ParadaCogtive[]
  total_paradas_dia_fim_anterior?: number | null
  horas_paradas_dia_fim_anterior?: number | null
  data_referencia_operacional?: string | null
  horas_produtivas_planejadas_dia?: number | null
  horas_produtivas_reais_dia?: number | null
  gap_horas_produtivas_dia?: number | null
}

type Column = {
  key: string
  label: string
  width: number
  align?: "left" | "center" | "right"
  frozen?: boolean
  render: (etapa: MrpEtapa) => string | number | null | undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value?: number | null, decimais = 0) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: decimais })
}

function fmtAbrev(value?: number | null) {
  const n = Number(value || 0)
  const abs = Math.abs(n)

  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
  }

  if (abs >= 1_000) {
    return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
  }

  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
}

function fmtData(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

function fmtPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-"
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

function fmtHorasParada(value?: number | null) {
  const n = Number(value || 0)
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: n % 1 ? 1 : 0,
    maximumFractionDigits: 1,
  })
}

function resumoParadasCogtive(m: MudancaRealizado) {
  const total = Number(m.total_paradas_dia_fim_anterior ?? m.paradas_dia_fim_anterior?.length ?? 0)
  const horas = Number(
    m.horas_paradas_dia_fim_anterior ??
      (m.paradas_dia_fim_anterior || []).reduce((acc, p) => acc + Number(p.duracao_horas || 0), 0)
  )

  return { total, horas }
}

function formatarDuracaoParada(horas?: number | null) {
  const totalSeg = Math.max(0, Math.round(Number(horas || 0) * 3600))
  const h = Math.floor(totalSeg / 3600)
  const m = Math.floor((totalSeg % 3600) / 60)
  const s = totalSeg % 60

  if (h > 0 && m > 0) return `${h}h ${m}min`
  if (h > 0) return `${h}h`
  if (m > 0 && s > 0) return `${m}min ${s}s`
  if (m > 0) return `${m}min`
  return `${s}s`
}

function fmtHoraProdutiva(value?: number | null) {
  const n = Number(value || 0)
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`
}

function horaCurta(hora?: string | null) {
  if (!hora) return "--:--"
  return String(hora).slice(0, 5)
}

function dataCurta(data?: string | null) {
  if (!data) return ""
  try {
    return new Date(`${String(data).slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    })
  } catch {
    return String(data).slice(0, 10)
  }
}

function segundosDeHora(hora?: string | null) {
  if (!hora) return null
  const partes = String(hora).split(":").map((p) => Number(p))
  if (partes.some((p) => Number.isNaN(p))) return null
  const [h = 0, m = 0, sec = 0] = partes
  return h * 3600 + m * 60 + sec
}

function intervaloParadaSegundos(p: ParadaCogtive): [number, number] | null {
  const iniRaw = segundosDeHora(p.hora_inicio)
  const fimRaw = segundosDeHora(p.hora_fim)
  const duracaoSeg = Math.max(0, Number(p.duracao_horas || 0) * 3600)

  let ini = iniRaw
  let fim = fimRaw

  if (ini === null && fim !== null && duracaoSeg > 0) {
    ini = fim - duracaoSeg
  }

  if (fim === null && ini !== null && duracaoSeg > 0) {
    fim = ini + duracaoSeg
  }

  if (ini === null || fim === null) return null

  if (fim < ini) fim += 24 * 3600
  if (fim === ini && duracaoSeg > 0) fim = ini + duracaoSeg
  if (fim <= ini) return null

  return [ini, fim]
}

function mesclarIntervalos(intervalos: Array<[number, number]>) {
  if (!intervalos.length) return [] as Array<[number, number]>

  const ordenados = intervalos.slice().sort((a, b) => a[0] - b[0])
  const resultado: Array<[number, number]> = []
  let [iniAtual, fimAtual] = ordenados[0]

  for (let i = 1; i < ordenados.length; i += 1) {
    const [ini, fim] = ordenados[i]

    if (ini <= fimAtual) {
      fimAtual = Math.max(fimAtual, fim)
    } else {
      resultado.push([iniAtual, fimAtual])
      iniAtual = ini
      fimAtual = fim
    }
  }

  resultado.push([iniAtual, fimAtual])
  return resultado
}

function calcularCoberturaParalela(paradas: ParadaCogtive[]) {
  const porEquipamento = new Map<string, Array<[number, number]>>()
  let fallbackSegundos = 0

  for (const p of paradas) {
    const equipamento = p.equipamento || "Sem equipamento"
    const intervalo = intervaloParadaSegundos(p)
    const duracaoSeg = Math.max(0, Number(p.duracao_horas || 0) * 3600)

    if (!intervalo) {
      fallbackSegundos += duracaoSeg
      continue
    }

    if (!porEquipamento.has(equipamento)) porEquipamento.set(equipamento, [])
    porEquipamento.get(equipamento)!.push(intervalo)
  }

  const eventosSweep: Array<{ t: number; delta: number }> = []

  for (const [, intervalos] of porEquipamento.entries()) {
    for (const [ini, fim] of mesclarIntervalos(intervalos)) {
      eventosSweep.push({ t: ini, delta: 1 })
      eventosSweep.push({ t: fim, delta: -1 })
    }
  }

  if (!eventosSweep.length) {
    return {
      linhaHoras: fallbackSegundos / 3600,
      parcialHoras: fallbackSegundos / 3600,
      simultaneaHoras: 0,
    }
  }

  eventosSweep.sort((a, b) => (a.t === b.t ? a.delta - b.delta : a.t - b.t))

  let ativo = 0
  let anterior = eventosSweep[0].t
  let parcial = 0
  let simultanea = 0

  for (const evento of eventosSweep) {
    const deltaTempo = Math.max(0, evento.t - anterior)

    if (ativo === 1) parcial += deltaTempo
    if (ativo >= 2) simultanea += deltaTempo

    ativo += evento.delta
    anterior = evento.t
  }

  return {
    linhaHoras: (parcial + simultanea + fallbackSegundos) / 3600,
    parcialHoras: (parcial + fallbackSegundos) / 3600,
    simultaneaHoras: simultanea / 3600,
  }
}

function formatarHorarioParada(p: ParadaCogtive) {
  const dataIniRaw = (p.data_inicial || (p as any).data_inicio || "") as string
  const dataFimRaw = (p.data_final || (p as any).data_fim || "") as string
  const horaInicioRaw = p.hora_inicio ? String(p.hora_inicio) : ""
  const horaFimRaw = p.hora_fim ? String(p.hora_fim) : ""
  const duracaoSeg = Math.max(0, Math.round(Number(p.duracao_horas || 0) * 3600))

  const montarDate = (data?: string | null, hora?: string | null) => {
    if (!data || !hora) return null
    const dataBase = String(data).slice(0, 10)
    const horaBase = String(hora).slice(0, 8)
    const dt = new Date(`${dataBase}T${horaBase}`)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  let fimDt = montarDate(dataFimRaw, horaFimRaw)
  let inicioDt = montarDate(dataIniRaw, horaInicioRaw)

  // Quando o backend ainda não tem hora de início, calcula pelo fim - duração.
  // Isso cobre paradas que começaram no dia anterior e terminaram no dia de referência.
  if (!inicioDt && fimDt && duracaoSeg > 0) {
    inicioDt = new Date(fimDt.getTime() - duracaoSeg * 1000)
  }

  if (!fimDt && inicioDt && duracaoSeg > 0) {
    fimDt = new Date(inicioDt.getTime() + duracaoSeg * 1000)
  }

  const fmtDiaHora = (dt: Date) =>
    `${dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`

  const fmtHora = (dt: Date) =>
    dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

  if (inicioDt && fimDt) {
    const mesmoDia = inicioDt.toDateString() === fimDt.toDateString()
    if (mesmoDia) return `${fmtHora(inicioDt)} → ${fmtHora(fimDt)}`
    return `${fmtDiaHora(inicioDt)} → ${fmtDiaHora(fimDt)}`
  }

  const dIni = dataCurta(dataIniRaw)
  const dFim = dataCurta(dataFimRaw)
  const hIni = horaCurta(horaInicioRaw)
  const hFim = horaCurta(horaFimRaw)
  const mudouDia = dIni && dFim && dIni !== dFim

  if (mudouDia) return `${dIni} ${hIni} → ${dFim} ${hFim}`
  if (dFim) return `${dFim} ${hIni} → ${hFim}`
  return `${hIni} → ${hFim}`
}

function ParadasCogtiveCell({ mudanca, contextoCascata = false }: { mudanca: MudancaRealizado; contextoCascata?: boolean }) {
  const paradas = mudanca.paradas_dia_fim_anterior || []
  const { total, horas } = resumoParadasCogtive(mudanca)
  const [modalAberto, setModalAberto] = useState(false)
  const [equipamentoSelecionado, setEquipamentoSelecionado] = useState<string>("TODOS")
  const [eventoAberto, setEventoAberto] = useState<string | null>(null)

  const dataRefIso = mudanca.data_referencia_operacional || mudanca.data_fim_anterior || null
  const dataRef = fmtData(dataRefIso)
  const dataFimNovoRef = fmtData(mudanca.data_fim_nova)
  const janelaAnalise =
    dataRef !== "-" && dataFimNovoRef !== "-" && dataRef !== dataFimNovoRef
      ? `${dataRef} a ${dataFimNovoRef}`
      : dataRef
  const coberturaLinha = calcularCoberturaParalela(paradas)

  const horasPlanejadasGantt = Number(mudanca.horas_produtivas_planejadas_dia || 0)
  const horasReaisCogtive = Number(mudanca.horas_produtivas_reais_dia || 0)
  const gapHorasProdutivas =
    mudanca.gap_horas_produtivas_dia !== undefined && mudanca.gap_horas_produtivas_dia !== null
      ? Number(mudanca.gap_horas_produtivas_dia)
      : horasReaisCogtive - horasPlanejadasGantt
  const temHorasOperacionais = horasPlanejadasGantt > 0 || horasReaisCogtive > 0
  const recursoMudanca = String(mudanca.recurso || "").trim().toUpperCase()
  const taxaTubetesHora =
    Number(mudanca.un_hora_nova || mudanca.un_hora_anterior || 0) ||
    (recursoMudanca === "L2" ? 6000 : 13500)
  const gapTubetesAprox = gapHorasProdutivas * taxaTubetesHora

  const montarDate = (data?: string | null, hora?: string | null) => {
    if (!data || !hora) return null
    const dataBase = String(data).slice(0, 10)
    const horaBase = String(hora).slice(0, 8)
    const dt = new Date(`${dataBase}T${horaBase}`)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  const formatarPeriodoParada = (p: ParadaCogtive) => {
    const dataIniRaw = (p.data_inicial || (p as any).data_inicio || dataRefIso || "") as string
    const dataFimRaw = (p.data_final || (p as any).data_fim || dataRefIso || "") as string
    const horaInicioRaw = p.hora_inicio ? String(p.hora_inicio).slice(0, 8) : ""
    const horaFimRaw = p.hora_fim ? String(p.hora_fim).slice(0, 8) : ""
    const duracaoSeg = Math.max(0, Math.round(Number(p.duracao_horas || 0) * 3600))

    let fimDt = montarDate(dataFimRaw, horaFimRaw)
    let inicioDt = montarDate(dataIniRaw, horaInicioRaw)

    if (!inicioDt && fimDt && duracaoSeg > 0) {
      inicioDt = new Date(fimDt.getTime() - duracaoSeg * 1000)
    }

    if (!fimDt && inicioDt && duracaoSeg > 0) {
      fimDt = new Date(inicioDt.getTime() + duracaoSeg * 1000)
    }

    const fmtDiaHora = (dt: Date) =>
      `${dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`

    const fmtHora = (dt: Date) =>
      dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

    if (inicioDt && fimDt) {
      const mesmoDia = inicioDt.toDateString() === fimDt.toDateString()
      return mesmoDia ? `${fmtHora(inicioDt)} → ${fmtHora(fimDt)}` : `${fmtDiaHora(inicioDt)} → ${fmtDiaHora(fimDt)}`
    }

    return formatarHorarioParada(p)
  }

  const equipamentosMap = new Map<
    string,
    { totalHoras: number; operacionalHoras: number; ocorrencias: number; paradas: ParadaCogtive[] }
  >()

  for (const p of paradas) {
    const equipamento = p.equipamento || "Sem equipamento"
    const h = Number(p.duracao_horas || 0)

    if (!equipamentosMap.has(equipamento)) {
      equipamentosMap.set(equipamento, { totalHoras: 0, operacionalHoras: 0, ocorrencias: 0, paradas: [] })
    }

    const item = equipamentosMap.get(equipamento)!
    item.totalHoras += h
    item.ocorrencias += 1
    item.paradas.push(p)
  }

  for (const [, item] of equipamentosMap.entries()) {
    item.operacionalHoras = calcularCoberturaParalela(item.paradas).linhaHoras
  }

  const equipamentosOrdenados = [...equipamentosMap.entries()].sort((a, b) => b[1].totalHoras - a[1].totalHoras)
  const totalEquipamentos = equipamentosOrdenados.length

  const paradasFiltradas =
    equipamentoSelecionado === "TODOS"
      ? paradas
      : paradas.filter((p) => (p.equipamento || "Sem equipamento") === equipamentoSelecionado)

  const eventosMap = new Map<
    string,
    {
      totalHoras: number
      ocorrencias: number
      detalhes: ParadaCogtive[]
    }
  >()

  for (const p of paradasFiltradas) {
    const evento = p.evento || p.tipo_evento || "Parada sem descrição"
    const h = Number(p.duracao_horas || 0)

    if (!eventosMap.has(evento)) {
      eventosMap.set(evento, { totalHoras: 0, ocorrencias: 0, detalhes: [] })
    }

    const item = eventosMap.get(evento)!
    item.totalHoras += h
    item.ocorrencias += 1
    item.detalhes.push(p)
  }

  const eventosOrdenados = [...eventosMap.entries()].sort((a, b) => b[1].totalHoras - a[1].totalHoras)
  const maxHoras = Math.max(...eventosOrdenados.map(([, item]) => item.totalHoras), 0.0001)
  const totalHorasFiltro = paradasFiltradas.reduce((acc, p) => acc + Number(p.duracao_horas || 0), 0)

  const abrirModal = () => {
    setEquipamentoSelecionado("TODOS")
    setEventoAberto(null)
    setModalAberto(true)
  }

  const selecionarEquipamento = (equipamento: string) => {
    setEquipamentoSelecionado(equipamento)
    setEventoAberto(null)
  }

  const cardBase = (ativo = false) => ({
    border: ativo ? "1px solid rgba(234,88,12,0.55)" : "1px solid var(--border)",
    borderRadius: 14,
    padding: "14px 16px",
    background: ativo ? "#FFF7ED" : "var(--bg-secondary)",
    boxShadow: ativo ? "0 8px 18px rgba(234,88,12,0.10)" : "0 1px 2px rgba(15,23,42,0.03)",
  })

  const badgeValor = contextoCascata
    ? total
      ? `Arraste · ${total} parada${total !== 1 ? "s" : ""}`
      : "Arraste da fila"
    : total
      ? `${total} parada${total !== 1 ? "s" : ""} · ${formatarDuracaoParada(coberturaLinha.linhaHoras || horas)}`
      : "Sem paradas · abrir"

  return (
    <>
      <button
        type="button"
        onClick={abrirModal}
        style={{
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 800,
          color: contextoCascata ? "#B45309" : "#B45309",
          background: contextoCascata ? "rgba(217,119,6,0.08)" : "rgba(245,158,11,0.10)",
          border: contextoCascata ? "1px solid rgba(217,119,6,0.26)" : "1px solid rgba(245,158,11,0.28)",
          whiteSpace: "nowrap",
        }}
        title={contextoCascata ? "Abrir contexto do arraste da fila." : "Paradas registradas no Cogtive no dia de referência. Não é causa automática do atraso."}
      >
        {contextoCascata && <RefreshCw size={11} />}
        {badgeValor}
      </button>

      {modalAberto && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setModalAberto(false)}
        >
          <div
            style={{
              width: "min(1580px, 97vw)",
              height: "min(92vh, 980px)",
              borderRadius: 22,
              border: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              boxShadow: "0 30px 90px rgba(15,23,42,0.34)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "16px 22px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(245,158,11,0.12)",
                    color: "#B45309",
                    flexShrink: 0,
                  }}
                >
                  <CalendarDays size={20} />
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 21,
                      fontWeight: 900,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {contextoCascata ? "Contexto do arraste da fila" : "Contexto operacional do lote"}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-secondary)" }}>
                    {contextoCascata
                      ? `Este lote ainda não tem apontamento produtivo próprio; foi recalculado pela fila da linha. Janela considerada: ${janelaAnalise}.`
                      : `Eventos do Cogtive, exceto produção. Janela considerada: ${janelaAnalise}.`}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalAberto(false)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--bg-secondary)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                padding: 16,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                  gap: 12,
                  flexShrink: 0,
                }}
              >
                <div style={cardBase(false)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(37,99,235,0.10)", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <CalendarDays size={19} />
                    </div>
                    <div>
                      <div className="card-label">Horas planejadas Gantt</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.05 }}>
                        {temHorasOperacionais ? fmtHoraProdutiva(horasPlanejadasGantt) : "-"}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        capacidade produtiva prevista
                      </div>
                    </div>
                  </div>
                </div>

                <div style={cardBase(false)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(16,185,129,0.10)", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Factory size={19} />
                    </div>
                    <div>
                      <div className="card-label">Horas produtivas Cogtive</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.05 }}>
                        {temHorasOperacionais ? fmtHoraProdutiva(horasReaisCogtive) : "-"}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        produção real registrada
                      </div>
                    </div>
                  </div>
                </div>

                <div style={cardBase(gapHorasProdutivas < 0)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 13,
                        background: gapHorasProdutivas < 0 ? "rgba(220,38,38,0.10)" : "rgba(16,185,129,0.10)",
                        color: gapHorasProdutivas < 0 ? "#DC2626" : "#059669",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {gapHorasProdutivas < 0 ? <TrendingDown size={19} /> : <TrendingUp size={19} />}
                    </div>
                    <div>
                      <div className="card-label">Gap produtivo</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: gapHorasProdutivas < 0 ? "#DC2626" : "#059669", lineHeight: 1.05 }}>
                        {temHorasOperacionais ? `${gapHorasProdutivas > 0 ? "+" : ""}${fmtHoraProdutiva(gapHorasProdutivas)}` : "-"}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        ≈ {fmtSinal(gapTubetesAprox, 0)} tubetes
                      </div>
                    </div>
                  </div>
                </div>

                <div style={cardBase(false)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(245,158,11,0.12)", color: "#B45309", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Clock3 size={19} />
                    </div>
                    <div>
                      <div className="card-label">Paradas do dia</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.05 }}>
                        {formatarDuracaoParada(coberturaLinha.linhaHoras)}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        {total} eventos · união dos intervalos
                      </div>
                    </div>
                  </div>
                </div>

                <div style={cardBase(false)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(239,68,68,0.10)", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Clock3 size={19} />
                    </div>
                    <div>
                      <div className="card-label">Parada simultânea</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.05 }}>
                        {formatarDuracaoParada(coberturaLinha.simultaneaHoras)}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        2+ máquinas juntas
                      </div>
                    </div>
                  </div>
                </div>

                <div style={cardBase(false)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(16,185,129,0.10)", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Factory size={19} />
                    </div>
                    <div>
                      <div className="card-label">Parada parcial</div>
                      <div style={{ fontSize: 23, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.05 }}>
                        {formatarDuracaoParada(coberturaLinha.parcialHoras)}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                        uma máquina parada
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(Math.max(equipamentosOrdenados.length, 1), 3)}, minmax(0, 1fr))`,
                  gap: 12,
                  flexShrink: 0,
                }}
              >
                {equipamentosOrdenados.map(([equipamento, dados]) => {
                  const pct = Math.min(100, Math.max(4, (dados.totalHoras / Math.max(horas, 0.0001)) * 100))
                  const ativo = equipamentoSelecionado === equipamento

                  return (
                    <button
                      key={equipamento}
                      type="button"
                      onClick={() => selecionarEquipamento(ativo ? "TODOS" : equipamento)}
                      style={{
                        ...cardBase(ativo),
                        textAlign: "left",
                        cursor: "pointer",
                        minHeight: 96,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={equipamento}>
                            {equipamento}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 21, fontWeight: 900, color: "#B45309" }}>
                            {formatarDuracaoParada(dados.totalHoras)}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-secondary)" }}>
                            {dados.ocorrencias} parada{dados.ocorrencias !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <ChevronDown
                          size={17}
                          style={{
                            color: ativo ? "#B45309" : "var(--text-secondary)",
                            transform: ativo ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 150ms ease",
                            flexShrink: 0,
                          }}
                        />
                      </div>
                      <div style={{ marginTop: 11, height: 7, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "linear-gradient(90deg,#F59E0B,#FB923C)" }} />
                      </div>
                    </button>
                  )
                })}
              </div>

              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 18,
                  overflow: "hidden",
                  background: "var(--bg-secondary)",
                  minHeight: 0,
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    padding: "13px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-primary)",
                    flexShrink: 0,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text-primary)" }}>Ranking de paradas</div>
                    <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-secondary)" }}>
                      {equipamentoSelecionado === "TODOS" ? "Todos os equipamentos" : equipamentoSelecionado}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#B45309" }}>{formatarDuracaoParada(totalHorasFiltro)}</div>
                </div>

                <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
                  {!eventosOrdenados.length && (
                    <div
                      style={{
                        margin: 16,
                        border: "1px dashed var(--border)",
                        borderRadius: 16,
                        padding: "22px 18px",
                        background: "var(--bg-primary)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text-primary)" }}>Nenhuma parada encontrada nessa janela</div>
                      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                        A consulta está olhando a janela <strong>{janelaAnalise}</strong> para a linha <strong>{mudanca.recurso || "-"}</strong>.
                        Se havia parada nesse período, o ajuste precisa estar no retorno do backend, não no clique do front.
                      </div>
                    </div>
                  )}
                  {eventosOrdenados.map(([evento, dados]) => {
                    const pct = Math.max(4, (dados.totalHoras / maxHoras) * 100)
                    const aberto = eventoAberto === evento

                    return (
                      <div key={evento} style={{ borderBottom: "1px solid var(--border)" }}>
                        <button
                          type="button"
                          onClick={() => setEventoAberto(aberto ? null : evento)}
                          style={{
                            width: "100%",
                            border: 0,
                            background: aberto ? "#FFF7ED" : "transparent",
                            cursor: "pointer",
                            padding: "12px 16px",
                            textAlign: "left",
                          }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 130px 120px 40px", gap: 16, alignItems: "center" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 900, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={evento}>
                                {evento}
                              </div>
                              <div style={{ marginTop: 7, height: 8, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#F59E0B,#FB923C)", borderRadius: 999 }} />
                              </div>
                            </div>

                            <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "right" }}>
                              {dados.ocorrencias} ocorrência{dados.ocorrencias !== 1 ? "s" : ""}
                            </div>

                            <div style={{ fontSize: 14, fontWeight: 900, color: "#B45309", textAlign: "right" }}>
                              {formatarDuracaoParada(dados.totalHoras)}
                            </div>

                            <ChevronDown size={18} style={{ color: aberto ? "#B45309" : "var(--text-secondary)", transform: aberto ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }} />
                          </div>
                        </button>

                        {aberto && (
                          <div style={{ padding: "0 16px 14px" }}>
                            <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg-primary)" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "250px 110px minmax(0, 1fr)", gap: 14, padding: "9px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
                                <div>Período</div>
                                <div>Duração</div>
                                <div>Equipamento</div>
                              </div>

                              {dados.detalhes
                                .slice()
                                .sort((a, b) => String(a.hora_inicio || "").localeCompare(String(b.hora_inicio || "")))
                                .map((p, idx) => (
                                  <div
                                    key={`${evento}-${idx}`}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "250px 110px minmax(0, 1fr)",
                                      gap: 14,
                                      padding: "9px 12px",
                                      borderBottom: idx === dados.detalhes.length - 1 ? "none" : "1px solid var(--border)",
                                      fontSize: 12,
                                      color: "var(--text-primary)",
                                      alignItems: "center",
                                    }}
                                  >
                                    <div>{formatarPeriodoParada(p)}</div>
                                    <div style={{ fontWeight: 900, color: "#B45309" }}>{formatarDuracaoParada(p.duracao_horas)}</div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.equipamento || "Sem equipamento"}>
                                      {p.equipamento || "Sem equipamento"}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
function fmtSinal(value?: number | null, decimais = 0) {
  const n = Number(value || 0)
  return `${n > 0 ? "+" : ""}${fmt(n, decimais)}`
}

type ChartPoint = { x: number; y: number }

function smoothPath(points: ChartPoint[]) {
  if (!points.length) return ""
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  // Curva controlada: suaviza sem overshoot e sem distorcer a leitura.
  // Mantém o desenho próximo da linha real, parecido com a Overview.
  const tension = 0.08
  let d = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }

  return d
}

function classeImpacto(tipo?: string | null) {
  if (tipo === "atrasou") return "bg-red-50 text-red-700 border-red-200"
  if (tipo === "antecipou") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (tipo === "sem_mudanca_data") return "bg-slate-50 text-slate-600 border-slate-200"
  return "bg-blue-50 text-blue-700 border-blue-200"
}

function textoImpacto(tipo?: string | null, dias?: number | null) {
  if (tipo === "atrasou") return `Atrasou ${Math.abs(Number(dias || 0))}d`
  if (tipo === "antecipou") return `Antecipou ${Math.abs(Number(dias || 0))}d`
  if (tipo === "sem_mudanca_data") return "Sem mudança"
  return "Sem comparativo"
}

function classeDiferenca(value?: number | null) {
  const n = Number(value || 0)
  if (n > 0) return "text-emerald-700 font-semibold"
  if (n < 0) return "text-red-700 font-semibold"
  return "var(--text-secondary)"
}

function keyData(date?: string | null) {
  return date ? date.slice(0, 10) : ""
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return value
  const texto = String(value).trim()
  if (texto.includes(",")) return Number(texto.replace(/\./g, "").replace(",", "."))
  return Number(texto)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asMonthlyArray(value: unknown): Array<number | null> {
  const vazio = Array.from({ length: 12 }, () => null as number | null)
  const arr = asArray<unknown>(value)

  if (!arr.length) return vazio

  const temMesExplicito = arr.some((item) => {
    const obj = asRecord(item)
    return obj.mes !== undefined || obj.mes_numero !== undefined || obj.month !== undefined
  })

  if (temMesExplicito) {
    const meses = [...vazio]
    arr.forEach((item) => {
      const obj = asRecord(item)
      const mes = Number(obj.mes ?? obj.mes_numero ?? obj.month)
      if (!Number.isFinite(mes) || mes < 1 || mes > 12) return

      const bruto = obj.qtd_caixas ?? obj.quantidade ?? obj.realizado ?? obj.valor ?? obj.total ?? obj.qtd ?? null
      if (bruto === null || bruto === undefined || bruto === "") {
        meses[mes - 1] = null
        return
      }

      const n = Number(bruto)
      meses[mes - 1] = Number.isFinite(n) ? n : null
    })
    return meses
  }

  return Array.from({ length: 12 }, (_, idx) => {
    const bruto = arr[idx]
    if (bruto === null || bruto === undefined || bruto === "") return null
    const n = Number(bruto)
    return Number.isFinite(n) ? n : null
  })
}

function asMudancasRealizado(value: unknown): MudancaRealizado[] {
  if (Array.isArray(value)) return value as MudancaRealizado[]

  const obj = asRecord(value)
  const candidatas = [
    obj.mudancas_realizado,
    obj.lotes_atualizados,
    obj.dados,
    obj.items,
    obj.results,
  ]

  for (const candidata of candidatas) {
    if (Array.isArray(candidata)) return candidata as MudancaRealizado[]
  }

  return []
}

function normalizarTexto(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase()
}

function identificarRecursoPorLote(lote?: string | null) {
  const texto = normalizarTexto(String(lote || ""))
  const match = texto.match(/[A-Z](1|2)/)
  if (match?.[1] === "1") return "L1"
  if (match?.[1] === "2") return "L2"
  return ""
}

function identificarRecursoMudanca(m: MudancaRealizado) {
  const r = String(m.recurso || "").trim().toUpperCase()
  if (r === "L1" || r === "L2" || r === "FABRIMA") return r
  return identificarRecursoPorLote(m.lote || "")
}

function tipoRealizacaoMudanca(m: MudancaRealizado) {
  const bruto = `${m.tipo_realizacao || ""} ${m.metodo_casamento || ""} ${m.motivo_provavel || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  if (bruto.includes("cascata") || bruto.includes("arrastado")) return "cascata"
  if (bruto.includes("parcial")) return "parcial"
  return "real"
}

function ehMudancaCascata(m: MudancaRealizado) {
  return tipoRealizacaoMudanca(m) === "cascata"
}

function labelTipoRealizacao(m: MudancaRealizado) {
  const tipo = tipoRealizacaoMudanca(m)
  if (tipo === "cascata") return "Arrastado pela fila"
  if (tipo === "parcial") return "Em produção"
  return "Real Cogtive"
}

function classeTipoRealizacao(m: MudancaRealizado) {
  const tipo = tipoRealizacaoMudanca(m)
  if (tipo === "cascata") return "bg-amber-50 text-amber-700 border-amber-200"
  if (tipo === "parcial") return "bg-blue-50 text-blue-700 border-blue-200"
  return "bg-emerald-50 text-emerald-700 border-emerald-200"
}

function textoImpactoOperacional(m: MudancaRealizado) {
  const dias = Number(m.impacto_dias || 0)
  const abs = Math.abs(dias)

  if (ehMudancaCascata(m)) {
    if (dias > 0) return `Arrastado +${abs}d`
    if (dias < 0) return `Reprogramado -${abs}d`
    return "Reprogramado"
  }

  return textoImpacto(m.tipo_impacto, m.impacto_dias)
}

function classeImpactoOperacional(m: MudancaRealizado) {
  if (ehMudancaCascata(m)) return "bg-amber-50 text-amber-700 border-amber-200"
  return classeImpacto(m.tipo_impacto)
}

function iconeImpactoOperacional(m: MudancaRealizado) {
  if (ehMudancaCascata(m)) return <RefreshCw size={11} />
  if (m.tipo_impacto === "atrasou") return <ArrowDown size={11} />
  if (m.tipo_impacto === "antecipou") return <ArrowUp size={11} />
  return <Minus size={11} />
}

function valorUnHoraMudanca(m: MudancaRealizado, campo: "anterior" | "nova") {
  if (ehMudancaCascata(m)) return "—"
  return campo === "anterior" ? fmt(m.un_hora_anterior) : fmt(m.un_hora_nova)
}

function uniqueSorted(values: (string | number | null | undefined)[]) {
  return Array.from(new Set(
    values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map((v) => String(v))
  )).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
}

function getLeftOffset(index: number, cols: Column[]) {
  return cols.slice(0, index).reduce((sum, col) => sum + col.width, 0)
}

function gerarDias(inicioMes: number, inicioAno: number, fimMes: number, fimAno: number) {
  const dias: { data: string; dia: number; mes: number; ano: number }[] = []
  const atual = new Date(inicioAno, inicioMes - 1, 1)
  const fim = new Date(fimAno, fimMes, 0)
  while (atual <= fim) {
    const ano = atual.getFullYear()
    const mes = atual.getMonth() + 1
    const dia = atual.getDate()
    dias.push({ data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, dia, mes, ano })
    atual.setDate(atual.getDate() + 1)
  }
  return dias
}

function gerarOpcoesMeses(baseAno: number) {
  const opcoes: { value: string; label: string }[] = []
  for (let ano = baseAno - 1; ano <= baseAno + 2; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      opcoes.push({ value: `${ano}-${mes}`, label: `${MESES[mes - 1]}/${ano}` })
    }
  }
  return opcoes
}

function filtrarEtapas(etapas: MrpEtapa[], filtros: Filtros) {
  return etapas.filter((e) => {
    const busca = filtros.busca.trim().toLowerCase()
    if (busca && ![e.lote, e.codigo_produto, e.descricao_produto, e.recurso].join(" ").toLowerCase().includes(busca)) return false
    if (filtros.recurso && e.recurso !== filtros.recurso) return false
    if (filtros.lote && String(e.lote || "") !== filtros.lote) return false
    if (filtros.codigo && String(e.codigo_produto || "") !== filtros.codigo) return false
    if (filtros.produto && String(e.descricao_produto || "") !== filtros.produto) return false
    if (filtros.mesProducao && String(e.mes_producao || "") !== filtros.mesProducao) return false
    if (filtros.anoProducao && String(e.ano_producao || "") !== filtros.anoProducao) return false
    if (filtros.mesLiberacao && String(e.mes_liberacao || "") !== filtros.mesLiberacao) return false
    if (filtros.anoLiberacao && String(e.ano_liberacao || "") !== filtros.anoLiberacao) return false
    return true
  })
}

function gerarLoteSugerido(etapa: MrpEtapa, novoProduto: string, etapas: MrpEtapa[]) {
  if (etapa.lote) return etapa.lote
  const dataBase = etapa.data_inicio || etapa.data_fim || etapa.data_pa
  const dt = dataBase ? new Date(`${dataBase}T00:00:00`) : new Date()
  const dia = String(dt.getDate()).padStart(2, "0")
  const mes = String(dt.getMonth() + 1).padStart(2, "0")
  const letra = normalizarTexto(novoProduto).slice(0, 1) || "X"
  const sequencias = etapas.map((e) => Number(String(e.lote || "").slice(-4))).filter((n) => !Number.isNaN(n))
  const proximaSeq = String((sequencias.length ? Math.max(...sequencias) : 1000) + 1).padStart(4, "0")
  return `${dia}${mes}${letra}${proximaSeq}`
}

// ─── Colunas da tabela ────────────────────────────────────────────────────────

const COLUMNS: Column[] = [
  { key: "lote", label: "LOTE", width: 100, frozen: true, render: (e) => e.lote },
  { key: "codigo", label: "CÓDIGO", width: 80, frozen: true, render: (e) => e.codigo_produto },
  { key: "produto", label: "PRODUTO", width: 200, frozen: true, render: (e) => e.descricao_produto },
  { key: "tempo", label: "TEMPO\n(h)", width: 80, align: "right", render: (e) => fmt(e.duracao_horas) },
  { key: "unhora", label: "UN/\nHORA", width: 80, align: "right", render: (e) => fmt(e.un_hora) },
  { key: "qtd", label: "QTD.\n(Tubetes)", width: 100, align: "right", render: (e) => fmt(e.qtd_planejada) },
  { key: "mesprod", label: "MÊS\nPROD.", width: 72, align: "center", render: (e) => e.mes_producao },
  { key: "anoprod", label: "ANO\nPROD.", width: 72, align: "center", render: (e) => e.ano_producao },
  { key: "inicio", label: "DATA\nINÍCIO", width: 100, align: "center", render: (e) => fmtData(e.data_inicio) },
  { key: "fim", label: "DATA\nFIM", width: 100, align: "center", render: (e) => fmtData(e.data_fim) },
  { key: "lib", label: "DATA\nLIB.", width: 100, align: "center", render: (e) => fmtData(e.data_pa) },
  { key: "meslib", label: "MÊS\nLIB.", width: 72, align: "center", render: (e) => e.mes_liberacao },
  { key: "anolib", label: "ANO\nLIB.", width: 72, align: "center", render: (e) => e.ano_liberacao },
  { key: "observacao", label: "OBSERVAÇÃO", width: 180, align: "left", render: (e) => e.observacao },
]

const FROZEN_COLUMNS = COLUMNS.filter((c) => c.frozen)
const FROZEN_COLUMNS_WIDTH = FROZEN_COLUMNS.reduce((total, col) => total + col.width, 0)
const COLUMN_RENDER_META = COLUMNS.map((col) => {
  const frozenIndex = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
  const frozen = frozenIndex >= 0
  return {
    col,
    frozenIndex,
    frozen,
    left: frozen ? getLeftOffset(frozenIndex, FROZEN_COLUMNS) : undefined,
  }
})
const SCROLL_COLUMNS = COLUMNS.filter((c) => !c.frozen)

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastNotification({ toast }: { toast: Toast }) {
  return (
    <div className="fixed right-6 top-6 z-[9999] min-w-[340px] rounded-2xl border px-5 py-4 shadow-2xl"
      style={{
        background: toast.tipo === "success" ? "#F0FDF4" : "#FEF2F2",
        borderColor: toast.tipo === "success" ? "#BBF7D0" : "#FECACA",
        color: toast.tipo === "success" ? "#14532D" : "#7F1D1D",
      }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
          style={{ background: toast.tipo === "success" ? "#DCFCE7" : "#FEE2E2" }}>
          {toast.tipo === "success"
            ? <CheckCircle2 size={18} style={{ color: "#16A34A" }} />
            : <AlertCircle size={18} style={{ color: "#DC2626" }} />}
        </div>
        <div>
          <div className="text-sm font-semibold">{toast.titulo}</div>
          <div className="mt-1 text-sm opacity-80">{toast.mensagem}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Nova Rodada ────────────────────────────────────────────────────────

function ModalNovaRodada({ open, onClose, onCriar, rodadas }: {
  open: boolean
  onClose: () => void
  onCriar: (nome: string, mes: number, ano: number, versao: number, obs: string) => Promise<void>
  rodadas: MrpRodada[]
}) {
  const hoje = new Date()
  const [nome, setNome] = useState("MPS")
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [versao, setVersao] = useState(1)
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    const versoes = rodadas.filter((r) => r.mes === mes && r.ano === ano).map((r) => r.versao || 0)
    setVersao(versoes.length ? Math.max(...versoes) + 1 : 1)
  }, [open, mes, ano, rodadas])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)" }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="card-label mb-0.5">MPS</p>
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Nova rodada de planejamento</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <div className="flex flex-col gap-1.5">
            <label className="card-label">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)}
              className="h-11 rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Mês</label>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Ano</label>
              <input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="card-label">Versão</label>
              <input type="number" value={versao} onChange={(e) => setVersao(Number(e.target.value))}
                className="h-11 rounded-lg border px-3 text-sm outline-none"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="card-label">Observação</label>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3}
              className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <button disabled={salvando}
            onClick={async () => { setSalvando(true); await onCriar(nome, mes, ano, versao, observacao); setSalvando(false) }}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white"
            style={{ background: AZUL, opacity: salvando ? 0.7 : 1 }}>
            {salvando ? "Criando..." : "Criar rodada"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Confirmar Exclusão ─────────────────────────────────────────────────

function ModalExcluir({ open, rodada, onClose, onConfirmar, excluindo }: {
  open: boolean; rodada: MrpRodada | null
  onClose: () => void; onConfirmar: () => Promise<void>; excluindo: boolean
}) {
  if (!open || !rodada) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)" }}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0" style={{ background: "#FEF2F2" }}>
            <Trash2 size={22} style={{ color: "#DC2626" }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Excluir rodada</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Tem certeza que deseja excluir <strong style={{ color: "var(--text-primary)" }}>{rodada.nome} — V{rodada.versao}</strong>?
              Esta ação remove etapas, alocações e produção real vinculadas.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onClose} disabled={excluindo}
                className="rounded-xl border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                Cancelar
              </button>
              <button onClick={onConfirmar} disabled={excluindo}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "#DC2626", opacity: excluindo ? 0.6 : 1 }}>
                {excluindo ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, delta, destaque = false, cor }: {
  label: string; value: string; sub?: string
  delta?: number | null; destaque?: boolean; cor?: "red" | "green" | "neutral"
}) {
  const corDelta = delta == null ? "neutral" : delta < 0 ? "red" : delta > 0 ? "green" : "neutral"
  const corFinal = cor || corDelta
  return (
    <div style={{
      border: `1px solid ${destaque ? AZUL : "var(--border)"}`,
      background: destaque ? AZUL : "var(--bg-secondary)",
      borderRadius: 16, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 6,
      position: "relative", overflow: "hidden",
    }}>
      {destaque && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: "rgba(255,255,255,0.05)", borderRadius: "0 0 0 80px" }} />
      )}
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: destaque ? "rgba(255,255,255,0.6)" : "var(--text-secondary)", margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 26, fontWeight: 800, margin: 0, lineHeight: 1, color: destaque ? "#fff" : corFinal === "red" ? "#B91C1C" : corFinal === "green" ? "#15803D" : "var(--text-primary)" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, margin: 0, color: destaque ? "rgba(255,255,255,0.55)" : "var(--text-secondary)" }}>{sub}</p>}
      {delta != null && delta !== 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
          {delta < 0 ? <ArrowDown size={12} style={{ color: "#DC2626" }} /> : <ArrowUp size={12} style={{ color: "#16A34A" }} />}
          <span style={{ fontSize: 11, fontWeight: 600, color: delta < 0 ? "#DC2626" : "#16A34A" }}>
            {fmtSinal(delta)} vs anterior
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Evolução de versões ──────────────────────────────────────────────────────

function EvolucaoVersoes({ dadosVersao, divisor, labelUnidade }: {
  dadosVersao: { rodada: MrpRodada; totalMesTubetes: number }[]
  divisor: number; labelUnidade: string
}) {
  const max = Math.max(...dadosVersao.map((d) => d.totalMesTubetes / divisor), 1)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {dadosVersao.map((item, idx) => {
        const valor = item.totalMesTubetes / divisor
        const anterior = idx > 0 ? dadosVersao[idx - 1].totalMesTubetes / divisor : null
        const delta = anterior != null ? valor - anterior : null
        const largura = Math.max(4, Math.round((valor / max) * 100))
        const isAtual = idx === dadosVersao.length - 1
        const isPrimeira = idx === 0
        return (
          <div key={item.rodada.id || idx} style={{ display: "grid", gridTemplateColumns: "72px 1fr 180px", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)" }}>V{item.rodada.versao}</span>
              {isAtual && <span style={{ fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px", letterSpacing: "0.05em" }}>ATUAL</span>}
              {isPrimeira && !isAtual && <span style={{ fontSize: 9, fontWeight: 600, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 99, padding: "2px 6px" }}>BASE</span>}
            </div>
            <div style={{ height: 32, background: "var(--bg-primary)", borderRadius: 99, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ width: `${largura}%`, height: "100%", background: isAtual ? AZUL : "rgba(23,55,94,0.25)", borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10 }}>
                {valor > 0 && largura > 15 && <span style={{ fontSize: 11, fontWeight: 700, color: isAtual ? "#fff" : AZUL }}>{fmt(valor)}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{fmt(valor)} {labelUnidade}</div>
              {delta != null && (
                <div style={{ fontSize: 11, fontWeight: 600, color: delta < 0 ? "#DC2626" : delta > 0 ? "#16A34A" : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                  {delta < 0 ? <TrendingDown size={11} /> : delta > 0 ? <TrendingUp size={11} /> : <Minus size={11} />}
                  {fmtSinal(delta)} vs V{dadosVersao[idx - 1].rodada.versao}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tabela mensal unificada ──────────────────────────────────────────────────

function TabelaMensalUnificada({ dadosVersao, anoAnalise, divisor }: {
  dadosVersao: { rodada: MrpRodada; porMes: number[] }[]
  anoAnalise: number; divisor: number
}) {
  if (!dadosVersao.length) return null
  const atual = dadosVersao[dadosVersao.length - 1]
  const primeira = dadosVersao[0]
  const thBase: React.CSSProperties = { padding: "10px 12px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.8)", textAlign: "right", whiteSpace: "nowrap", background: AZUL, borderRight: "1px solid rgba(255,255,255,0.1)" }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: "left", minWidth: 90, position: "sticky", left: 0, zIndex: 2 }}>Versão</th>
            {MESES.map((m) => <th key={m} style={thBase}>{m}</th>)}
            <th style={{ ...thBase, borderRight: "none" }}>Total ano</th>
          </tr>
        </thead>
        <tbody>
          {dadosVersao.map((item, idx) => {
            const isAtual = idx === dadosVersao.length - 1
            const anterior = idx > 0 ? dadosVersao[idx - 1] : null
            const rowBg = isAtual ? "rgba(23,55,94,0.05)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
            const total = item.porMes.reduce((a, b) => a + b, 0) / divisor
            return (
              <tr key={item.rodada.id || idx} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }}>
                  V{item.rodada.versao}
                  {isAtual && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
                </td>
                {item.porMes.map((totalMes, mesIdx) => {
                  const val = totalMes / divisor
                  const valAnt = (anterior?.porMes[mesIdx] || 0) / divisor
                  const valBase = (primeira.porMes[mesIdx] || 0) / divisor
                  const difAnt = val - valAnt
                  const difBase = val - valBase
                  const temQueda = isAtual && difBase < -0.5
                  const temGanho = isAtual && difBase > 0.5
                  return (
                    <td key={mesIdx} style={{ padding: "10px 10px", textAlign: "right", borderRight: "1px solid var(--border)", background: temQueda ? "rgba(220,38,38,0.04)" : temGanho ? "rgba(22,163,74,0.04)" : undefined }}>
                      <div style={{ fontWeight: isAtual ? 700 : 400, color: "var(--text-primary)" }}>
                        {val > 0 ? fmt(val) : <span style={{ color: "var(--border)" }}>—</span>}
                      </div>
                      {anterior && difAnt !== 0 && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: difAnt > 0 ? "#16A34A" : "#DC2626", marginTop: 1 }}>
                          {fmtSinal(difAnt)}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)}</td>
              </tr>
            )
          })}
          {/* Linha delta V1 → Atual */}
          {dadosVersao.length > 1 && (
            <tr style={{ background: "rgba(23,55,94,0.03)", borderTop: "2px solid var(--border)" }}>
              <td style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", position: "sticky", left: 0, background: "rgba(23,55,94,0.03)", borderRight: "1px solid var(--border)" }}>
                Δ V1→Atual
              </td>
              {atual.porMes.map((totalMes, mesIdx) => {
                const val = totalMes / divisor
                const valBase = (primeira.porMes[mesIdx] || 0) / divisor
                const dif = val - valBase
                return (
                  <td key={mesIdx} style={{ padding: "10px 10px", textAlign: "right", borderRight: "1px solid var(--border)" }}>
                    {dif !== 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: dif > 0 ? "#15803D" : "#B91C1C" }}>{fmtSinal(dif)}</span>
                      : <span style={{ color: "var(--border)", fontSize: 11 }}>—</span>}
                  </td>
                )
              })}
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                {(() => {
                  const totalAtual = atual.porMes.reduce((a, b) => a + b, 0) / divisor
                  const totalBase = primeira.porMes.reduce((a, b) => a + b, 0) / divisor
                  const dif = totalAtual - totalBase
                  return <span style={{ fontSize: 12, fontWeight: 700, color: dif < 0 ? "#B91C1C" : dif > 0 ? "#15803D" : "var(--text-secondary)" }}>{fmtSinal(dif)}</span>
                })()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Abertura por linha ───────────────────────────────────────────────────────

function AberturaLinhas({ dadosVersao, divisor, labelUnidade }: {
  dadosVersao: { rodada: MrpRodada; porLinha: Record<string, number> }[]
  divisor: number; labelUnidade: string
}) {
  const linhas = ["L1", "L2"]
  const thBase: React.CSSProperties = { padding: "10px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.8)", textAlign: "right", whiteSpace: "nowrap", background: AZUL, borderRight: "1px solid rgba(255,255,255,0.1)" }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thBase, textAlign: "left", minWidth: 90 }}>Versão</th>
            {linhas.map((l) => <th key={l} style={thBase}>{l}</th>)}
            <th style={{ ...thBase, borderRight: "none" }}>Total mês</th>
          </tr>
        </thead>
        <tbody>
          {dadosVersao.map((item, idx) => {
            const isAtual = idx === dadosVersao.length - 1
            const anterior = idx > 0 ? dadosVersao[idx - 1] : null
            const rowBg = isAtual ? "rgba(23,55,94,0.05)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
            const total = linhas.reduce((s, l) => s + (item.porLinha[l] || 0), 0) / divisor
            return (
              <tr key={item.rodada.id || idx} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700, color: isAtual ? AZUL : "var(--text-primary)", borderRight: "1px solid var(--border)" }}>
                  V{item.rodada.versao}
                  {isAtual && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
                </td>
                {linhas.map((l) => {
                  const val = (item.porLinha[l] || 0) / divisor
                  const valAnt = (anterior?.porLinha[l] || 0) / divisor
                  const dif = val - valAnt
                  return (
                    <td key={l} style={{ padding: "10px 14px", textAlign: "right", borderRight: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: isAtual ? 700 : 400, color: "var(--text-primary)" }}>{fmt(val)}</div>
                      {anterior && dif !== 0 && <div style={{ fontSize: 10, fontWeight: 600, color: dif > 0 ? "#16A34A" : "#DC2626", marginTop: 1 }}>{fmtSinal(dif)}</div>}
                    </td>
                  )
                })}
                <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)} {labelUnidade}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Painel do realizado ──────────────────────────────────────────────────────

function PainelRealizado({ mudancasRealizado, divisor, labelUnidade }: {
  mudancasRealizado: MudancaRealizado[]; divisor: number; labelUnidade: string
}) {
  const resumo = useMemo(() => {
    const reaisCogtive = mudancasRealizado.filter((m) => !ehMudancaCascata(m))
    const arrastadosFila = mudancasRealizado.filter((m) => ehMudancaCascata(m))
    const impactados = mudancasRealizado.filter((m) => ehMudancaCascata(m) || m.tipo_impacto === "atrasou" || Number(m.impacto_dias || 0) > 0)
    const maiorAtraso = Math.max(0, ...mudancasRealizado.map((m) => Number(m.impacto_dias || 0)).filter((v) => v > 0))
    const volumeImpactado = impactados.reduce((acc, m) => acc + Number(m.qtd_planejada || 0), 0) / divisor
    return { reaisCogtive, arrastadosFila, impactados, maiorAtraso, volumeImpactado }
  }, [mudancasRealizado, divisor])

  if (!mudancasRealizado.length) return null

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Realizado + cascata</p>
        <h3 style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Impacto operacional da semana</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
        {[
          { label: "Lotes Cogtive", value: String(resumo.reaisCogtive.length), cor: resumo.reaisCogtive.length > 0 ? "#15803D" : "var(--text-primary)", bg: resumo.reaisCogtive.length > 0 ? "rgba(22,163,74,0.04)" : undefined },
          { label: "Arrastados na fila", value: String(resumo.arrastadosFila.length), cor: resumo.arrastadosFila.length > 0 ? "#B45309" : "var(--text-primary)", bg: resumo.arrastadosFila.length > 0 ? "rgba(217,119,6,0.04)" : undefined },
          { label: "Maior atraso", value: `${resumo.maiorAtraso}d`, cor: resumo.maiorAtraso > 2 ? "#B91C1C" : "var(--text-primary)", bg: undefined },
          { label: `Vol. em risco (${labelUnidade})`, value: fmt(resumo.volumeImpactado), cor: resumo.volumeImpactado > 0 ? "#B45309" : "var(--text-primary)", bg: resumo.volumeImpactado > 0 ? "rgba(217,119,6,0.04)" : undefined },
        ].map((kpi, i) => (
          <div key={i} style={{ padding: "16px 20px", borderRight: i < 3 ? "1px solid var(--border)" : undefined, background: kpi.bg }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-secondary)" }}>{kpi.label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 800, color: kpi.cor }}>{kpi.value}</p>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg-primary)" }}>
              {["Lote", "Produto", "Recurso", "Fim planejado", "Fim novo", "Status", "Impacto", "Paradas dia", "UN/H ant.", "UN/H nova", "Δ UN/H"].map((h, i) => (
                <th key={h} style={{ padding: "9px 12px", textAlign: i >= 3 ? "center" : "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mudancasRealizado.map((m, idx) => {
              const cascata = ehMudancaCascata(m)
              const atrasou = !cascata && m.tipo_impacto === "atrasou"
              const antecipou = !cascata && m.tipo_impacto === "antecipou"
              const bgLinha = cascata ? "rgba(217,119,6,0.03)" : atrasou ? "rgba(220,38,38,0.02)" : antecipou ? "rgba(22,163,74,0.02)" : undefined

              return (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)", background: bgLinha }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700, color: "var(--text-primary)" }}>{m.lote || m.lote_real_cogtive || "-"}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{m.descricao_produto || "-"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{m.codigo_produto}</div>
                  </td>
                  <td style={{ padding: "9px 12px", color: "var(--text-secondary)", fontWeight: 600 }}>{m.recurso || "-"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--text-secondary)" }}>{fmtData(m.data_fim_anterior)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                    <div>{fmtData(m.data_fim_nova)}</div>
                    {cascata && <div style={{ marginTop: 2, fontSize: 10, color: "#B45309", fontWeight: 700 }}>Recalculado</div>}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${classeTipoRealizacao(m)}`}>
                      {cascata ? <RefreshCw size={11} /> : <CheckCircle2 size={11} />}
                      {labelTipoRealizacao(m)}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${classeImpactoOperacional(m)}`}>
                      {iconeImpactoOperacional(m)}
                      {textoImpactoOperacional(m)}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "center", verticalAlign: "top" }}>
                    <ParadasCogtiveCell mudanca={m} contextoCascata={cascata} />
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: "var(--text-secondary)" }}>{valorUnHoraMudanca(m, "anterior")}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: "var(--text-primary)" }}>{valorUnHoraMudanca(m, "nova")}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}>
                    {!cascata && m.delta_un_hora_pct != null
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: Number(m.delta_un_hora_pct) < 0 ? "#B91C1C" : "#15803D" }}>{fmtPct(m.delta_un_hora_pct)}</span>
                      : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─── Gráficos executivos da visão consolidada ────────────────────────────────

type DadosVersaoConsolidado = {
  rodada: MrpRodada
  totalMesTubetes: number
  porLinha: Record<string, number>
  porMes: number[]
}

function GraficoAnualVertical({ dadosVersao, divisor, labelUnidade, orcadoAnualCaixas, mostrarLegenda }: {
  dadosVersao: DadosVersaoConsolidado[]
  divisor: number
  labelUnidade: string
  orcadoAnualCaixas: number | null
  mostrarLegenda: boolean
}) {
  const [ocultas, setOcultas] = useState<Record<string, boolean>>({})
  if (!dadosVersao.length) return null

  const orcadoValor = orcadoAnualCaixas != null ? unidadeValor(orcadoAnualCaixas, divisor) : null

  const versoes = dadosVersao.map((d, idx) => ({
    key: `v-${d.rodada.versao}`,
    label: `V${d.rodada.versao}`,
    valor: d.porMes.reduce((a, b) => a + b, 0) / divisor,
    tipo: idx === dadosVersao.length - 1 ? "atual" as const : idx === 0 ? "base" as const : "versao" as const,
    deltaAnterior: idx > 0 ? (d.porMes.reduce((a, b) => a + b, 0) - dadosVersao[idx - 1].porMes.reduce((a, b) => a + b, 0)) / divisor : null,
  }))

  const barras = [
    ...(orcadoValor != null ? [{ key: "orcado", label: "Orçado", valor: orcadoValor, tipo: "orcado" as const, deltaAnterior: null as number | null }] : []),
    ...versoes,
  ]

  const visiveis = barras.filter((b) => !ocultas[b.key])
  const valores = visiveis.map((b) => b.valor).filter((v) => Number.isFinite(v) && v > 0)
  const maxValor = Math.max(...valores, 1)
  const chartHeight = 250
  const barAreaHeight = 178
  const escalaMax = maxValor * 1.06

  const totalAtual = dadosVersao[dadosVersao.length - 1].porMes.reduce((a, b) => a + b, 0) / divisor
  const totalBase = dadosVersao[0].porMes.reduce((a, b) => a + b, 0) / divisor
  const deltaVsBase = totalAtual - totalBase
  const deltaVsOrcado = orcadoValor != null ? totalAtual - orcadoValor : null

  const corSerie = (tipo: "orcado" | "base" | "versao" | "atual") => {
    if (tipo === "orcado") return "#EA580C"
    if (tipo === "atual") return AZUL
    if (tipo === "base") return "#94A3B8"
    return "#CBD5E1"
  }

  function toggleSerie(key: string) {
    setOcultas((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Comparativo anual</p>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Total projetado por versão</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Orçado e versões no mesmo eixo, com rótulos sempre visíveis.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Δ V1 → atual</p>
          <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 800, color: deltaVsBase < 0 ? "#B91C1C" : deltaVsBase > 0 ? "#15803D" : "var(--text-primary)" }}>{fmtSinal(deltaVsBase)}</p>
          {deltaVsOrcado != null && (
            <p style={{ margin: 0, fontSize: 11, color: deltaVsOrcado < 0 ? "#B91C1C" : "#15803D", fontWeight: 700 }}>{fmtSinal(deltaVsOrcado)} vs orçado</p>
          )}
        </div>
      </div>

      {mostrarLegenda && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
          {barras.map((b) => {
            const off = !!ocultas[b.key]
            return (
              <button key={b.key} type="button" onClick={() => toggleSerie(b.key)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: off ? "#94A3B8" : "var(--text-secondary)", border: "none", background: "transparent", padding: 0, cursor: "pointer", opacity: off ? 0.45 : 1 }}
                title={off ? "Mostrar série" : "Ocultar série"}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: corSerie(b.tipo) }} />
                {b.label}{b.tipo === "atual" ? " atual" : ""}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ position: "relative", height: chartHeight, padding: "28px 8px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ height: barAreaHeight, display: "grid", gridTemplateColumns: `repeat(${Math.max(visiveis.length, 1)}, minmax(110px, 1fr))`, gap: 26, alignItems: "end" }}>
          {visiveis.map((b) => {
            const h = Math.max(6, (b.valor / escalaMax) * barAreaHeight)
            const cor = corSerie(b.tipo)
            return (
              <div key={b.key} style={{ height: barAreaHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text-primary)", marginBottom: 6 }}>{fmt(b.valor)}</div>
                <div title={`${b.label}: ${fmt(b.valor)} ${labelUnidade}`} style={{ width: "min(76px, 68%)", height: h, borderRadius: "12px 12px 4px 4px", background: cor, boxShadow: b.tipo === "atual" ? "0 14px 30px rgba(23,55,94,0.18)" : undefined }} />
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(visiveis.length, 1)}, minmax(110px, 1fr))`, gap: 26, padding: "8px 8px 0" }}>
        {visiveis.map((b) => {
          const idxVersao = versoes.findIndex((v) => v.key === b.key)
          const deltaBase = b.tipo === "orcado" ? null : b.valor - totalBase
          const deltaAnt = b.deltaAnterior
          const showDeltaBase = deltaBase != null && idxVersao > 0 && Math.abs(deltaBase) > 0.0001
          return (
            <div key={`${b.key}-label`} style={{ textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: b.tipo === "orcado" ? "#EA580C" : b.tipo === "atual" ? AZUL : b.tipo === "base" ? "var(--text-primary)" : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                {b.label}
                {b.tipo === "base" && <span style={{ fontSize: 9, fontWeight: 800, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 99, padding: "2px 6px" }}>BASE</span>}
                {b.tipo === "atual" && <span style={{ fontSize: 9, fontWeight: 800, background: AZUL, color: "#fff", borderRadius: 99, padding: "2px 6px" }}>ATUAL</span>}
              </div>
              <div style={{ height: 16, fontSize: 10, fontWeight: 800, color: showDeltaBase ? (deltaBase! < 0 ? "#DC2626" : "#16A34A") : "var(--text-secondary)", marginTop: 3 }}>
                {showDeltaBase ? `${fmtSinal(deltaBase)} vs V1` : b.tipo === "orcado" && deltaVsOrcado != null ? `${fmtSinal(deltaVsOrcado)} atual` : "—"}
              </div>
              {deltaAnt != null && deltaAnt !== 0 && (
                <div style={{ height: 14, fontSize: 10, color: "var(--text-secondary)" }}>{fmtSinal(deltaAnt)} vs anterior</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function unidadeValor(caixas: number, divisor: number) {
  return divisor === 500 ? caixas : caixas * 500
}

function GraficoMensalVersoes({ dadosVersao, divisor, anoAnalise, mostrarLegenda, orcadoMensalCaixas, labelUnidade }: {
  dadosVersao: DadosVersaoConsolidado[]
  divisor: number
  anoAnalise: number
  mostrarLegenda: boolean
  orcadoMensalCaixas: number[]
  labelUnidade: string
}) {
  const [ocultas, setOcultas] = useState<Record<string, boolean>>({})
  if (!dadosVersao.length) return null

  const serieKeys = dadosVersao.map((d) => `v-${d.rodada.versao}`)
  const versoesVisiveis = dadosVersao.filter((d) => !ocultas[`v-${d.rodada.versao}`])
  const mostrarOrcado = !ocultas.orcado
  const valoresVersoes = versoesVisiveis.flatMap((d) => d.porMes.map((v) => v / divisor)).filter((v) => v > 0)
  const valoresOrcado = mostrarOrcado ? orcadoMensalCaixas.map((v) => unidadeValor(v, divisor)).filter((v) => v > 0) : []
  const max = Math.max(...valoresVersoes, ...valoresOrcado, 1)
  const larguraGrupo = Math.max(118, versoesVisiveis.length * 30 + 52)
  const barAreaHeight = 208

  const corVersao = (idxOriginal: number) => {
    if (idxOriginal === dadosVersao.length - 1) return AZUL
    if (idxOriginal === 0) return "#94A3B8"
    return "#CBD5E1"
  }

  function toggleSerie(key: string) {
    setOcultas((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Evolução mensal</p>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Versões por mês — {anoAnalise}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Orçado mensal em linha laranja. Clique na legenda para ocultar ou mostrar séries.</p>
        </div>
        {mostrarLegenda && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {dadosVersao.map((d, idx) => {
              const key = `v-${d.rodada.versao}`
              const off = !!ocultas[key]
              return (
                <button key={key} type="button" onClick={() => toggleSerie(key)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: off ? "#94A3B8" : "var(--text-secondary)", fontWeight: 800, border: "none", background: "transparent", padding: 0, cursor: "pointer", opacity: off ? 0.45 : 1 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: corVersao(idx) }} />
                  V{d.rodada.versao}{idx === dadosVersao.length - 1 ? " atual" : ""}
                </button>
              )
            })}
            <button type="button" onClick={() => toggleSerie("orcado")}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: ocultas.orcado ? "#94A3B8" : "var(--text-secondary)", fontWeight: 800, border: "none", background: "transparent", padding: 0, cursor: "pointer", opacity: ocultas.orcado ? 0.45 : 1 }}>
              <span style={{ width: 18, height: 3, borderRadius: 99, background: "#EA580C" }} />
              Orçado
            </button>
          </div>
        )}
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 2 }}>
        <div style={{ minWidth: Math.max(1040, larguraGrupo * 12), height: 320, display: "flex", alignItems: "flex-end", gap: 10, borderBottom: "1px solid var(--border)", padding: "26px 8px 0" }}>
          {MESES.map((mes, mesIdx) => {
            const base = dadosVersao[0]?.porMes[mesIdx] || 0
            const atual = dadosVersao[dadosVersao.length - 1]?.porMes[mesIdx] || 0
            const delta = (atual - base) / divisor
            const orcado = unidadeValor(orcadoMensalCaixas[mesIdx] || 0, divisor)
            const orcadoTop = barAreaHeight - Math.max(2, (orcado / (max * 1.06)) * barAreaHeight)
            return (
              <div key={mes} style={{ width: larguraGrupo, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <div style={{ height: barAreaHeight + 34, width: "100%", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6 }}>
                  {mostrarOrcado && orcado > 0 && (
                    <div style={{ position: "absolute", left: 4, right: 4, top: orcadoTop + 20, borderTop: "3px solid #EA580C", zIndex: 4 }} title={`Orçado ${mes}: ${fmt(orcado)} ${labelUnidade}`}>
                      <span style={{ position: "absolute", right: 0, top: -18, fontSize: 9, fontWeight: 900, color: "#EA580C", background: "var(--bg-secondary)", paddingLeft: 4 }}>
                        {fmt(orcado)}
                      </span>
                    </div>
                  )}
                  {versoesVisiveis.map((d) => {
                    const idxOriginal = dadosVersao.findIndex((x) => x.rodada.id === d.rodada.id)
                    const valor = d.porMes[mesIdx] / divisor
                    const h = Math.max(valor > 0 ? 4 : 0, (valor / (max * 1.06)) * barAreaHeight)
                    const cor = corVersao(idxOriginal)
                    return (
                      <div key={d.rodada.id || d.rodada.versao} style={{ height: barAreaHeight + 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", minWidth: 22, position: "relative", zIndex: 3 }}>
                        <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 9, fontWeight: 900, color: "var(--text-primary)", marginBottom: 5, minHeight: 38 }}>
                          {valor > 0 ? fmt(valor) : "—"}
                        </span>
                        <div title={`V${d.rodada.versao} · ${mes}: ${fmt(valor)}`} style={{ width: 16, height: h, borderRadius: "6px 6px 2px 2px", background: cor }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, color: "var(--text-secondary)" }}>{mes}</div>
                <div style={{ height: 16, fontSize: 10, fontWeight: 900, color: delta < 0 ? "#DC2626" : delta > 0 ? "#16A34A" : "var(--text-secondary)" }}>{delta !== 0 ? fmtSinal(delta) : "—"}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ─── Aba: Projeção e perdas mensais ──────────────────────────────────────────

function extrairOrcadoMensalFaturamento(data: unknown, totalAnual: number, fallbackDistribuicao: number[]) {
  const d = data as Record<string, unknown>
  const candidatos = [d.meses, d.por_mes, d.mensal, d.orcado_mensal, d.dados]
  const arr = candidatos.find((x) => Array.isArray(x)) as Array<Record<string, unknown>> | undefined

  if (arr?.length) {
    const meses = Array.from({ length: 12 }, (_, idx) => {
      const mes = idx + 1
      const item = arr.find((m) => Number(m.mes ?? m.mes_numero ?? m.month) === mes)
      const direto = Number(
        item?.qtd_caixas ??
        item?.caixas ??
        item?.total_caixas ??
        item?.orcado_caixas ??
        item?.faturamento_caixas ??
        0
      )
      return Number.isFinite(direto) ? direto : 0
    })
    if (meses.some((v) => v > 0)) return { meses, origem: "Orçado faturamento mensal" }
  }

  const somaFallback = fallbackDistribuicao.reduce((a, b) => a + b, 0)
  if (totalAnual > 0 && somaFallback > 0) {
    return {
      meses: fallbackDistribuicao.map((v) => (v / somaFallback) * totalAnual),
      origem: "Orçado mensal estimado pela curva V1",
    }
  }

  if (totalAnual > 0) {
    return { meses: Array.from({ length: 12 }, () => totalAnual / 12), origem: "Orçado mensal estimado linear" }
  }

  return { meses: Array.from({ length: 12 }, () => 0), origem: "Orçado não disponível" }
}

function extrairOrcadoMensalLiberacao(data: unknown) {
  const d = data as Record<string, unknown>
  const arr = (Array.isArray(d.meses) ? d.meses : []) as Array<Record<string, unknown>>

  const meses = Array.from({ length: 12 }, (_, idx) => {
    const mes = idx + 1
    const item = arr.find((m) => Number(m.mes ?? m.mes_numero ?? m.month) === mes)

    if (!item) return 0

    const direto = Number(
      item.qtd_caixas ??
      item.caixas ??
      item.total_caixas ??
      item.orcado_caixas ??
      0
    )

    if (Number.isFinite(direto) && direto > 0) return direto

    const l1 = Number(item.L1 ?? item.l1 ?? item.linha1 ?? 0)
    const l2 = Number(item.L2 ?? item.l2 ?? item.linha2 ?? 0)

    // O endpoint de orçado de liberação normalmente devolve L1/L2 em tubetes.
    // Quando vier muito alto, converte para caixas; se já vier em caixas, mantém.
    const soma = (Number.isFinite(l1) ? l1 : 0) + (Number.isFinite(l2) ? l2 : 0)
    return soma > 100000 ? soma / 500 : soma
  })

  return meses
}



// ─── Aba: Projeção e perdas mensais ──────────────────────────────────────────

function ProjecaoPerdasMensais({ rodadas, etapasPorRodada, rodadaAtual }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  rodadaAtual: MrpRodada | null
}) {
  const anoAnalise = rodadaAtual?.ano || new Date().getFullYear()
  const mesAnalise = rodadaAtual?.mes || new Date().getMonth() + 1

  const [orcadoAnualSaida, setOrcadoAnualSaida] = useState<number>(0)
  const [orcadoMensalSaida, setOrcadoMensalSaida] = useState<number[]>(Array.from({ length: 12 }, () => 0))
  const [orcadoMensalLiberacao, setOrcadoMensalLiberacao] = useState<number[]>(Array.from({ length: 12 }, () => 0))
  const [origemOrcadoMensal, setOrigemOrcadoMensal] = useState("Orçado mensal")
  const [sd3Mensal, setSd3Mensal] = useState<Array<number | null>>(Array.from({ length: 12 }, () => null))

  const [comparativoPerda, setComparativoPerda] = useState<ComparativoPerda>("v1")
  const [tipoSimulacao, setTipoSimulacao] = useState<"percentual" | "quantidade">("percentual")
  const [valorGlobal, setValorGlobal] = useState("0")
  const [perdasPctMes, setPerdasPctMes] = useState<string[]>(Array.from({ length: 12 }, () => ""))
  const [perdasCxMes, setPerdasCxMes] = useState<string[]>(Array.from({ length: 12 }, () => ""))
  const [modalMesAberto, setModalMesAberto] = useState(false)
  const [modoGraficoSimulacao, setModoGraficoSimulacao] = useState<"mensal" | "acumulado">("mensal")
  const [seriesVisiveisSimulacao, setSeriesVisiveisSimulacao] = useState({
    orcado: true,
    realizado: true,
    projecao: true,
    simulado: true,
  })

  function toggleSerieSimulacao(key: keyof typeof seriesVisiveisSimulacao) {
    setSeriesVisiveisSimulacao((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const atual = useMemo(() => {
    if (!rodadas.length) return null
    const rodada = rodadas[rodadas.length - 1]
    const etapasBase = etapasPorRodada[rodada.id || ""] || []
    const etapas = etapasBase.filter((e) => ["L1", "L2"].includes(String(e.recurso || "").toUpperCase()))
    const porMes = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1
      return etapas.reduce((acc, e) => {
        if (Number(e.mes_liberacao) === mes && Number(e.ano_liberacao) === anoAnalise) return acc + Number(e.qtd_planejada || 0)
        return acc
      }, 0) / 500
    })
    return { rodada, porMes }
  }, [rodadas, etapasPorRodada, anoAnalise])

  const v1Mensal = useMemo(() => {
    if (!rodadas.length) return Array.from({ length: 12 }, () => 0)
    const rodada = rodadas[0]
    const etapasBase = etapasPorRodada[rodada.id || ""] || []
    const etapas = etapasBase.filter((e) => ["L1", "L2"].includes(String(e.recurso || "").toUpperCase()))
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1
      return etapas.reduce((acc, e) => {
        if (Number(e.mes_liberacao) === mes && Number(e.ano_liberacao) === anoAnalise) return acc + Number(e.qtd_planejada || 0)
        return acc
      }, 0) / 500
    })
  }, [rodadas, etapasPorRodada, anoAnalise])

  useEffect(() => {
    getOrcadoFaturamento()
      .then((d: unknown) => {
        const total = Number((d as { total_caixas?: number })?.total_caixas || 0)
        setOrcadoAnualSaida(total)
        const mensal = extrairOrcadoMensalFaturamento(d, total, v1Mensal)
        setOrcadoMensalSaida(mensal.meses)
        setOrigemOrcadoMensal(mensal.origem)
      })
      .catch(() => {
        setOrcadoAnualSaida(0)
        setOrcadoMensalSaida(Array.from({ length: 12 }, () => 0))
        setOrigemOrcadoMensal("Orçado não disponível")
      })
  }, [v1Mensal])

  useEffect(() => {
    getOrcadoLiberacao()
      .then((d: unknown) => setOrcadoMensalLiberacao(extrairOrcadoMensalLiberacao(d)))
      .catch(() => setOrcadoMensalLiberacao(Array.from({ length: 12 }, () => 0)))
  }, [])

  useEffect(() => {
    getSd3RealizadoMensal(anoAnalise)
      .then((d: unknown) => setSd3Mensal(asMonthlyArray(d)))
      .catch(() => setSd3Mensal(Array.from({ length: 12 }, () => null)))
  }, [anoAnalise])

  function parseValor(txt: string) {
    const n = Number(String(txt || "0").replace(/\./g, "").replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }

  function limparSimulacao() {
    setValorGlobal("0")
    setPerdasPctMes(Array.from({ length: 12 }, () => ""))
    setPerdasCxMes(Array.from({ length: 12 }, () => ""))
  }

  function atualizarPctMes(idx: number, value: string) {
    setPerdasPctMes((prev) => prev.map((v, i) => i === idx ? value : v))
  }

  function atualizarCxMes(idx: number, value: string) {
    setPerdasCxMes((prev) => prev.map((v, i) => i === idx ? value : v))
  }

  if (!rodadas.length || !atual) {
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Nenhuma versão disponível para projetar perdas.</p>
      </div>
    )
  }

  const linhas = MESES.map((mes, idx) => {
    const numeroMes = idx + 1
    const orcado = Number(orcadoMensalSaida[idx] || 0)
    const mpsAtual = Number(atual.porMes[idx] || 0)
    const v1 = Number(v1Mensal[idx] || 0)
    const realSd3 = sd3Mensal[idx]
    const temSd3 = realSd3 !== null && realSd3 !== undefined
    const fechado = numeroMes < mesAnalise
    const base = fechado && temSd3 ? Number(realSd3) : mpsAtual
    const origem = fechado && temSd3 ? "Real SD3" : fechado ? "MPS atual (sem SD3)" : "MPS atual"
    const orcadoLiberacao = Number(orcadoMensalLiberacao[idx] || 0)
    const referenciaPerda =
      comparativoPerda === "orcado_saida" ? orcado :
      comparativoPerda === "orcado_liberacao" ? orcadoLiberacao :
      v1
    const referenciaPerdaLabel =
      comparativoPerda === "orcado_saida" ? "Orçado saída" :
      comparativoPerda === "orcado_liberacao" ? "Orçado liberação" :
      "V1"
    const gapVsOrcado = base - orcado
    const perdaRealComparativo = temSd3 ? Number(realSd3) - referenciaPerda : null
    const perdaRealVsV1 = temSd3 ? Number(realSd3) - v1 : null

    const pctMes = parseValor(perdasPctMes[idx])
    const cxMes = parseValor(perdasCxMes[idx])
    const global = parseValor(valorGlobal)
    const mesSimulavel = numeroMes >= mesAnalise

    let perdaSimulada = 0
    if (mesSimulavel) {
      if (cxMes > 0) perdaSimulada = cxMes
      else if (pctMes > 0) perdaSimulada = base * (pctMes / 100)
      else if (tipoSimulacao === "percentual") perdaSimulada = base * (Math.max(0, global) / 100)
      else perdaSimulada = Math.max(0, global)
    }

    const projetadoSimulado = Math.max(0, base - perdaSimulada)
    const gapSimulado = projetadoSimulado - orcado

    return {
      mes,
      numeroMes,
      orcado,
      orcadoLiberacao,
      v1,
      mpsAtual,
      referenciaPerda,
      referenciaPerdaLabel,
      base,
      origem,
      temSd3,
      fechado,
      gapVsOrcado,
      perdaRealComparativo,
      perdaRealVsV1,
      perdaSimulada,
      projetadoSimulado,
      gapSimulado,
      mesSimulavel,
    }
  })

  const totalOrcado = orcadoAnualSaida > 0 ? orcadoAnualSaida : linhas.reduce((s, l) => s + l.orcado, 0)
  const totalBase = linhas.reduce((s, l) => s + l.base, 0)
  const totalSimulado = linhas.reduce((s, l) => s + l.projetadoSimulado, 0)
  const totalPerdaSimulada = linhas.reduce((s, l) => s + l.perdaSimulada, 0)
  const gapBase = totalBase - totalOrcado
  const gapSimulado = totalSimulado - totalOrcado
  const atendimentoBase = totalOrcado > 0 ? (totalBase / totalOrcado) * 100 : 0
  const atendimentoSimulado = totalOrcado > 0 ? (totalSimulado / totalOrcado) * 100 : 0

  const perdasReaisComparativo = linhas
    .filter((l) => l.perdaRealComparativo !== null && l.perdaRealComparativo < 0)
    .map((l) => Math.abs(l.perdaRealComparativo || 0))
  const mediaPerdaRealComparativo = perdasReaisComparativo.length ? perdasReaisComparativo.reduce((a, b) => a + b, 0) / perdasReaisComparativo.length : 0
  const labelComparativoPerda = comparativoPerda === "orcado_saida" ? "orçado de saída" : comparativoPerda === "orcado_liberacao" ? "orçado de liberação" : "V1"
  const mediaPerdaAplicada = linhas.filter((l) => l.mesSimulavel).length
    ? totalPerdaSimulada / Math.max(1, linhas.filter((l) => l.mesSimulavel).length)
    : 0

  const maxPerdaReal = Math.max(1, ...linhas.map((l) => Math.abs(l.perdaRealComparativo || 0)))
  const maxMensal = Math.max(1, ...linhas.flatMap((l) => [l.orcado, l.base, l.projetadoSimulado]))

  const linhasGrafico = modoGraficoSimulacao === "acumulado"
    ? linhas.reduce<Array<typeof linhas[number] & { orcadoAcum: number; baseAcum: number; simuladoAcum: number }>>((acc, item) => {
        const ant = acc[acc.length - 1]
        acc.push({
          ...item,
          orcadoAcum: (ant?.orcadoAcum || 0) + item.orcado,
          baseAcum: (ant?.baseAcum || 0) + item.base,
          simuladoAcum: (ant?.simuladoAcum || 0) + item.projetadoSimulado,
        })
        return acc
      }, [])
    : []

  const maxAcumulado = Math.max(1, ...linhasGrafico.flatMap((l) => [l.orcadoAcum, l.baseAcum, l.simuladoAcum]))

  const minChartHeight = 260
  const barMaxHeight = 185
  const chartMinWidth = 1120
  const linhaOrcadoPontos = linhas.map((l, idx) => ({
    x: (idx + 0.5) * 100,
    y: 235 - ((l.orcado / maxMensal) * barMaxHeight),
  }))
  const linhaOrcadoPath = smoothPath(linhaOrcadoPontos)
  const linhaSimuladaPontos = linhas
    .filter((l) => l.mesSimulavel && l.perdaSimulada > 0)
    .map((l) => ({
      x: (l.numeroMes - 0.5) * 100,
      y: 235 - ((l.projetadoSimulado / maxMensal) * barMaxHeight),
    }))
  const linhaSimuladaPath = smoothPath(linhaSimuladaPontos)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 18, padding: 20, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Impacto executivo</p>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 950, color: "var(--text-primary)" }}>Perdas mensais vs orçado de saída — {anoAnalise}</h2>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
              Realizado via SD3 quando disponível. Futuro segue a versão atual do MPS. Simule perdas para medir o impacto anual.
            </p>
          </div>
          <button type="button" onClick={limparSimulacao}
            style={{ height: 40, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-secondary)", padding: "0 14px", fontSize: 12, fontWeight: 850, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={15} /> Limpar simulação
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <KpiCard label="Orçado saída anual" value={fmt(totalOrcado)} sub="cx" cor="neutral" />
          <KpiCard label="Projetado base" value={fmt(totalBase)} sub={`${fmtSinal(gapBase)} vs orçado`} delta={gapBase} />
          <KpiCard label="Projetado simulado" value={fmt(totalSimulado)} sub={`${fmtSinal(gapSimulado)} vs orçado`} destaque />
          <KpiCard label="Atendimento base" value={`${atendimentoBase.toFixed(1).replace(".", ",")}%`} sub="base / orçado" cor={atendimentoBase >= 100 ? "green" : atendimentoBase >= 95 ? "neutral" : "red"} />
          <KpiCard label="Atendimento simulado" value={`${atendimentoSimulado.toFixed(1).replace(".", ",")}%`} sub="simulado / orçado" cor={atendimentoSimulado >= 100 ? "green" : atendimentoSimulado >= 95 ? "neutral" : "red"} />
          <KpiCard label="Média de perda" value={fmt(mediaPerdaRealComparativo)} sub={`SD3 abaixo de ${labelComparativoPerda} / mês`} cor={mediaPerdaRealComparativo > 0 ? "red" : "neutral"} />
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 18, padding: 20, background: "var(--bg-secondary)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Perda realizada</p>
            <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 950, color: "var(--text-primary)" }}>SD3 vs {labelComparativoPerda} da mesma competência</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Use essa média para calibrar a simulação dos meses futuros.</p>
            <div style={{ marginTop: 12, display: "inline-flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--bg-primary)" }}>
              {[
                { key: "v1", label: "SD3 vs V1" },
                { key: "orcado_saida", label: "SD3 vs orçado saída" },
                { key: "orcado_liberacao", label: "SD3 vs orçado liberação" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setComparativoPerda(item.key as ComparativoPerda)}
                  style={{
                    height: 36,
                    border: "none",
                    borderRight: item.key !== "orcado_liberacao" ? "1px solid var(--border)" : "none",
                    background: comparativoPerda === item.key ? "rgba(37,99,235,0.12)" : "transparent",
                    color: comparativoPerda === item.key ? AZUL : "var(--text-secondary)",
                    padding: "0 12px",
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "12px 16px", minWidth: 210, background: "var(--bg-primary)" }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>Média da perda real</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 950, color: mediaPerdaRealComparativo > 0 ? COR_PERDA : "var(--text-primary)" }}>{fmt(mediaPerdaRealComparativo)} cx</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>considera meses com SD3 abaixo de {labelComparativoPerda}</p>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: chartMinWidth, height: 282, display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14, alignItems: "center", padding: "8px 8px 0", position: "relative" }}>
            <div style={{ position: "absolute", left: 8, right: 8, top: "50%", borderTop: "1px solid var(--border)" }} />
            <div style={{ position: "absolute", left: `calc(${(Math.max(mesAnalise - 1, 0) / 12) * 100}% + 8px)`, top: 0, bottom: 0, width: `calc(${((13 - mesAnalise) / 12) * 100}% - 16px)`, background: "rgba(148,163,184,0.07)", borderRadius: 16, pointerEvents: "none" }}>
              <span style={{ position: "absolute", right: 14, top: 12, fontSize: 11, fontWeight: 800, color: "var(--text-secondary)" }}>Futuro sem SD3</span>
            </div>
            {linhas.map((l) => {
              const diff = l.perdaRealComparativo
              const h = Math.max(diff === null ? 0 : 6, (Math.abs(diff || 0) / maxPerdaReal) * 92)
              const positivo = (diff || 0) >= 0
              const visivel = diff !== null
              return (
                <div key={l.mes} style={{ height: 236, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 2 }}>
                  <div style={{ height: 95, display: "flex", alignItems: "flex-end" }}>
                    {visivel && positivo && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 950, color: COR_GANHO }}>{fmtSinal(diff || 0)}</span>
                        <div style={{ width: 34, height: h, borderRadius: "7px 7px 2px 2px", background: "linear-gradient(180deg, #7BC67E 0%, #2E7D32 100%)", boxShadow: "0 10px 18px rgba(21,128,61,0.14)" }} />
                      </div>
                    )}
                  </div>
                  <div style={{ height: 42, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 950, color: "var(--text-primary)" }}>{l.mes}</span>
                    {visivel && (
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--text-secondary)", lineHeight: 1.25, textAlign: "center", whiteSpace: "nowrap" }}>
                        <span>SD3 {fmtAbrev(Number(sd3Mensal[l.numeroMes - 1] || 0))}</span>
                        <br />
                        <span>{l.referenciaPerdaLabel} {fmtAbrev(l.referenciaPerda)}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ height: 95, display: "flex", alignItems: "flex-start" }}>
                    {visivel && !positivo && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 34, height: h, borderRadius: "2px 2px 7px 7px", background: "linear-gradient(180deg, #EF4444 0%, #DC2626 100%)", boxShadow: "0 10px 18px rgba(220,38,38,0.16)" }} />
                        <span style={{ fontSize: 11, fontWeight: 950, color: COR_PERDA }}>{fmtSinal(diff || 0)}</span>
                      </div>
                    )}
                    {!visivel && (
                      <span style={{ marginTop: 12, fontSize: 11, fontWeight: 800, color: "var(--text-secondary)" }}>—</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 18, padding: 20, background: "var(--bg-secondary)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Simular perda</p>
            <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 950, color: "var(--text-primary)" }}>Aplique uma perda nos meses futuros</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Use percentual ou quantidade fixa. Para valores diferentes por mês, abra o editor mensal.</p>
          </div>
          <button type="button" onClick={() => setModalMesAberto(true)}
            style={{ height: 40, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-primary)", color: AZUL, padding: "0 14px", fontSize: 12, fontWeight: 900, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <CalendarDays size={15} /> Personalizar mês a mês
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) minmax(220px, 1fr) minmax(220px, 1fr)", gap: 14, alignItems: "end" }}>
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 850, color: "var(--text-secondary)" }}>Tipo de perda</p>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--bg-primary)" }}>
              {(["percentual", "quantidade"] as const).map((tipo) => (
                <button key={tipo} type="button" onClick={() => setTipoSimulacao(tipo)}
                  style={{ height: 38, border: "none", borderRight: tipo === "percentual" ? "1px solid var(--border)" : "none", background: tipoSimulacao === tipo ? "rgba(37,99,235,0.12)" : "transparent", color: tipoSimulacao === tipo ? AZUL : "var(--text-secondary)", padding: "0 14px", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
                  {tipo === "percentual" ? "% Percentual" : "cx Quantidade"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 850, color: "var(--text-secondary)" }}>Valor da perda</p>
            <div style={{ display: "flex", alignItems: "center", maxWidth: 190 }}>
              <input value={valorGlobal} onChange={(e) => setValorGlobal(e.target.value)}
                style={{ width: 110, height: 38, borderRadius: "12px 0 0 12px", border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "0 12px", fontSize: 13, fontWeight: 900, outline: "none" }} />
              <span style={{ height: 38, minWidth: 44, border: "1px solid var(--border)", borderLeft: "none", borderRadius: "0 12px 12px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg-primary)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 900 }}>
                {tipoSimulacao === "percentual" ? "%" : "cx"}
              </span>
            </div>
          </div>

          <div>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 850, color: "var(--text-secondary)" }}>Média aplicada</p>
            <div style={{ height: 38, display: "inline-flex", alignItems: "center", borderRadius: 12, padding: "0 14px", background: "rgba(124,58,237,0.10)", color: "#6D28D9", fontSize: 13, fontWeight: 950 }}>
              {tipoSimulacao === "percentual" && perdasCxMes.every((v) => !parseValor(v)) && perdasPctMes.every((v) => !parseValor(v))
                ? `${parseValor(valorGlobal).toFixed(1).replace(".", ",")}%`
                : `${fmt(mediaPerdaAplicada)} cx/mês`}
            </div>
          </div>

          <div>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 850, color: "var(--text-secondary)" }}>Período</p>
            <div style={{ height: 38, display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 12, padding: "0 14px", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 12, fontWeight: 900 }}>
              <CalendarDays size={15} color="var(--text-secondary)" /> {MESES[mesAnalise - 1]} a Dez/{anoAnalise}
            </div>
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 18, padding: 20, background: "var(--bg-secondary)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Orçado de saída vs realizado e projeções</p>
            <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 950, color: "var(--text-primary)" }}>Visão mensal com simulação</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{origemOrcadoMensal}. Valores em caixas.</p>
          </div>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--bg-primary)" }}>
            {(["mensal", "acumulado"] as const).map((modo) => (
              <button key={modo} type="button" onClick={() => setModoGraficoSimulacao(modo)}
                style={{ height: 38, border: "none", borderRight: modo === "mensal" ? "1px solid var(--border)" : "none", background: modoGraficoSimulacao === modo ? "rgba(37,99,235,0.12)" : "transparent", color: modoGraficoSimulacao === modo ? AZUL : "var(--text-secondary)", padding: "0 14px", fontSize: 12, fontWeight: 900, cursor: "pointer", textTransform: "capitalize" }}>
                {modo}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg-primary)", padding: "12px 14px" }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>Orçado saída anual</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 950, color: "var(--text-primary)" }}>{fmt(totalOrcado)} <span style={{ fontSize: 12, fontWeight: 850, color: "var(--text-secondary)" }}>cx</span></p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg-primary)", padding: "12px 14px" }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>Projetado anual simulado</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 950, color: AZUL }}>{fmt(totalSimulado)} <span style={{ fontSize: 12, fontWeight: 850, color: "var(--text-secondary)" }}>cx</span></p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: atendimentoSimulado >= 100 ? COR_GANHO : atendimentoSimulado >= 95 ? "var(--text-secondary)" : COR_PERDA, fontWeight: 850 }}>{atendimentoSimulado.toFixed(1).replace(".", ",")}% do orçado saída</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, paddingLeft: 4 }}>
          {[
            { key: "orcado" as const, label: "Orçado saída", cor: "#356AC3", tipo: "linha" },
            { key: "realizado" as const, label: "Realizado SD3", cor: AZUL, tipo: "barra" },
            { key: "projecao" as const, label: "Projeção MPS", cor: "#CBD5E1", tipo: "barra" },
            { key: "simulado" as const, label: "Simulado", cor: "#8B5CF6", tipo: "tracejado" },
          ].map((item) => {
            const ativo = seriesVisiveisSimulacao[item.key]
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleSerieSimulacao(item.key)}
                style={{
                  height: 28,
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  background: ativo ? "var(--bg-primary)" : "rgba(148,163,184,0.10)",
                  color: ativo ? "var(--text-secondary)" : "#94A3B8",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "0 10px",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  opacity: ativo ? 1 : 0.55,
                }}
              >
                <span style={{ width: item.tipo === "linha" ? 24 : 12, height: item.tipo === "linha" ? 3 : 12, borderRadius: item.tipo === "linha" ? 999 : 3, background: item.tipo === "tracejado" ? "transparent" : item.cor, border: item.tipo === "tracejado" ? `2px dashed ${item.cor}` : "none" }} />
                {item.label}
              </button>
            )
          })}
        </div>

        <div style={{ overflowX: "auto" }}>
          {modoGraficoSimulacao === "mensal" ? (
            <div style={{ minWidth: chartMinWidth, height: 360, position: "relative", padding: "26px 12px 38px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ position: "absolute", left: 12, right: 12, top: 40, bottom: 38, backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: "100% 72px", opacity: 0.55 }} />
              <div style={{ position: "absolute", left: `calc(${(Math.max(mesAnalise - 1, 0) / 12) * 100}% + 12px)`, top: 30, bottom: 38, borderLeft: "1px dashed #CBD5E1" }} />

              {seriesVisiveisSimulacao.orcado && (
                <svg
                  viewBox="0 0 1200 235"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", left: 12, right: 12, top: 52, height: 235, width: "calc(100% - 24px)", overflow: "visible", zIndex: 5, pointerEvents: "none" }}
                >
                  <path
                    d={linhaOrcadoPath}
                    fill="none"
                    stroke="#356AC3"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.96}
                  />
                  {linhaOrcadoPontos.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={1.45}
                      fill="#FFFFFF"
                      stroke="#356AC3"
                      strokeWidth={1.25}
                      opacity={0.9}
                    />
                  ))}
                </svg>
              )}

              {seriesVisiveisSimulacao.simulado && linhaSimuladaPontos.length >= 2 && (
                <svg
                  viewBox="0 0 1200 235"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", left: 12, right: 12, top: 52, height: 235, width: "calc(100% - 24px)", overflow: "visible", zIndex: 6, pointerEvents: "none" }}
                >
                  <path
                    d={linhaSimuladaPath}
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth={1.8}
                    strokeDasharray="5 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                  {linhaSimuladaPontos.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={1.4}
                      fill="#FFFFFF"
                      stroke="#8B5CF6"
                      strokeWidth={1.2}
                      opacity={0.9}
                    />
                  ))}
                </svg>
              )}

              <div style={{ height: "100%", display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14, alignItems: "end", position: "relative", zIndex: 2 }}>
                {linhas.map((l) => {
                  const baseH = Math.max(l.base > 0 ? 4 : 0, (l.base / maxMensal) * barMaxHeight)
                  const simH = Math.max(l.projetadoSimulado > 0 ? 4 : 0, (l.projetadoSimulado / maxMensal) * barMaxHeight)
                  const isReal = l.fechado && l.temSd3
                  const mostrarBase = isReal ? seriesVisiveisSimulacao.realizado : seriesVisiveisSimulacao.projecao
                  const mostrarSimulado = seriesVisiveisSimulacao.simulado && l.mesSimulavel && l.perdaSimulada > 0

                  return (
                    <div key={l.mes} style={{ height: 292, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative" }}>
                      <div style={{ height: 235, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, position: "relative" }}>
                        {mostrarBase && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 950, color: "var(--text-primary)", minHeight: 14 }}>{l.base > 0 ? fmtAbrev(l.base) : ""}</span>
                            <div title={`${l.origem}: ${fmt(l.base)} cx`} style={{ width: 34, height: baseH, borderRadius: "8px 8px 2px 2px", background: isReal ? AZUL : "#CBD5E1", boxShadow: isReal ? "0 12px 24px rgba(23,55,94,0.16)" : "none" }} />
                          </div>
                        )}
                        {mostrarSimulado && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 950, color: "#7C3AED", minHeight: 14 }}>{fmtAbrev(l.projetadoSimulado)}</span>
                            <div title={`Simulado: ${fmt(l.projetadoSimulado)} cx`} style={{ width: 26, height: simH, borderRadius: "8px 8px 2px 2px", background: "rgba(139,92,246,0.08)", border: "2px dashed #8B5CF6" }} />
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "var(--text-primary)" }}>{l.mes}</div>
                      <div style={{ marginTop: 4, fontSize: 10, fontWeight: 800, color: l.gapSimulado < 0 ? COR_PERDA : l.gapSimulado > 0 ? COR_GANHO : "var(--text-secondary)" }}>{fmtSinal(l.gapSimulado)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ minWidth: chartMinWidth, height: 360, position: "relative", padding: "28px 12px 40px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ position: "absolute", left: 12, right: 12, top: 40, bottom: 42, backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: "100% 70px", opacity: 0.55 }} />
              <div style={{ height: "100%", display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 10, alignItems: "end", position: "relative", zIndex: 2 }}>
                {linhasGrafico.map((l) => {
                  const orcadoH = Math.max(4, (l.orcadoAcum / maxAcumulado) * 245)
                  const baseH = Math.max(4, (l.baseAcum / maxAcumulado) * 245)
                  const simH = Math.max(4, (l.simuladoAcum / maxAcumulado) * 245)
                  return (
                    <div key={l.mes} style={{ height: 292, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                      <div style={{ height: 252, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 5 }}>
                        <div style={{ width: 18, height: orcadoH, borderRadius: "6px 6px 2px 2px", background: "rgba(37,99,235,0.20)" }} title={`Orçado acum.: ${fmt(l.orcadoAcum)}`} />
                        <div style={{ width: 18, height: baseH, borderRadius: "6px 6px 2px 2px", background: AZUL }} title={`Base acum.: ${fmt(l.baseAcum)}`} />
                        <div style={{ width: 18, height: simH, borderRadius: "6px 6px 2px 2px", background: "rgba(139,92,246,0.08)", border: "2px dashed #8B5CF6" }} title={`Simulado acum.: ${fmt(l.simuladoAcum)}`} />
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "var(--text-primary)" }}>{l.mes}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, borderRadius: 16, padding: "16px 18px", background: "linear-gradient(90deg, rgba(139,92,246,0.10), rgba(139,92,246,0.03))", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(139,92,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <TrendingDown size={18} color="#7C3AED" />
            </div>
            <p style={{ margin: 0, color: "var(--text-primary)", fontSize: 14 }}>
              Com esta simulação, o atendimento anual fica em <strong style={{ color: "#7C3AED" }}>{atendimentoSimulado.toFixed(1).replace(".", ",")}%</strong> do orçado.
            </p>
          </div>
          <p style={{ margin: 0, color: "var(--text-primary)", fontSize: 14 }}>
            Você deixaria de entregar <strong style={{ color: gapSimulado < 0 ? COR_PERDA : COR_GANHO }}>{fmtSinal(gapSimulado)} cx</strong> no ano.
          </p>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Detalhamento</p>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 950, color: "var(--text-primary)" }}>Base mensal e simulação</h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Mês", "Origem", "Orçado saída", "Orçado lib.", "V1", "Base", `SD3 - ${labelComparativoPerda}`, "Perda simulada", "Projetado", "Gap simulado"].map((h, idx) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: idx <= 1 ? "left" : "right", background: AZUL, color: "rgba(255,255,255,0.86)", fontSize: 10, fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.06em", borderRight: "1px solid rgba(255,255,255,0.12)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, idx) => (
                <tr key={l.mes} style={{ background: idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)", borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 900, color: "var(--text-primary)" }}>{l.mes}</td>
                  <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>{l.origem}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 750 }}>{fmt(l.orcado)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 750 }}>{fmt(l.orcadoLiberacao)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 750 }}>{fmt(l.v1)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 850 }}>{fmt(l.base)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: (l.perdaRealComparativo || 0) < 0 ? COR_PERDA : (l.perdaRealComparativo || 0) > 0 ? COR_GANHO : "var(--text-secondary)", fontWeight: 850 }}>{l.perdaRealComparativo === null ? "—" : fmtSinal(l.perdaRealComparativo)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: l.perdaSimulada > 0 ? COR_PERDA : "var(--text-secondary)", fontWeight: 850 }}>{fmt(l.perdaSimulada)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-primary)", fontWeight: 900 }}>{fmt(l.projetadoSimulado)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: l.gapSimulado < 0 ? COR_PERDA : l.gapSimulado > 0 ? COR_GANHO : "var(--text-secondary)", fontWeight: 900 }}>{fmtSinal(l.gapSimulado)}</td>
                </tr>
              ))}
              <tr style={{ background: "rgba(23,55,94,0.05)", borderTop: "2px solid var(--border)" }}>
                <td style={{ padding: "12px", fontWeight: 950, color: "var(--text-primary)" }}>Total</td>
                <td style={{ padding: "12px", color: "var(--text-secondary)" }}>Ano</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950 }}>{fmt(totalOrcado)}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950 }}>{fmt(orcadoMensalLiberacao.reduce((a, b) => a + b, 0))}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950 }}>{fmt(v1Mensal.reduce((a, b) => a + b, 0))}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950 }}>{fmt(totalBase)}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950, color: mediaPerdaRealComparativo > 0 ? COR_PERDA : "var(--text-secondary)" }}>{mediaPerdaRealComparativo > 0 ? `média -${fmt(mediaPerdaRealComparativo)}` : "—"}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950, color: totalPerdaSimulada > 0 ? COR_PERDA : "var(--text-secondary)" }}>{fmt(totalPerdaSimulada)}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950 }}>{fmt(totalSimulado)}</td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 950, color: gapSimulado < 0 ? COR_PERDA : COR_GANHO }}>{fmtSinal(gapSimulado)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {modalMesAberto && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setModalMesAberto(false) }}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div style={{ width: "min(1040px, 96vw)", maxHeight: "88vh", overflow: "auto", borderRadius: 18, border: "1px solid var(--border)", background: "var(--bg-secondary)", boxShadow: "0 24px 70px rgba(15,23,42,0.24)" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: "var(--text-primary)" }}>Personalizar perda mês a mês</h3>
                <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>Preencha % ou quantidade em caixas. Quantidade tem prioridade quando os dois campos estiverem preenchidos.</p>
              </div>
              <button type="button" onClick={() => setModalMesAberto(false)} style={{ width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-primary)", color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <X size={17} />
              </button>
            </div>

            <div style={{ padding: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {linhas.map((l, idx) => {
                const bloqueado = !l.mesSimulavel
                return (
                  <div key={l.mes} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: bloqueado ? "rgba(148,163,184,0.06)" : "var(--bg-primary)", opacity: bloqueado ? 0.62 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{l.mes}</strong>
                      <span style={{ fontSize: 9, fontWeight: 900, color: bloqueado ? "var(--text-secondary)" : AZUL, border: "1px solid var(--border)", borderRadius: 999, padding: "2px 6px", background: "var(--bg-secondary)" }}>{bloqueado ? "fechado" : "futuro"}</span>
                    </div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 850, color: "var(--text-secondary)", marginBottom: 4 }}>% perda</label>
                    <input value={perdasPctMes[idx]} disabled={bloqueado} onChange={(e) => atualizarPctMes(idx, e.target.value)} placeholder="0"
                      style={{ width: "100%", height: 34, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", padding: "0 9px", fontSize: 12, fontWeight: 850, outline: "none", marginBottom: 8 }} />
                    <label style={{ display: "block", fontSize: 10, fontWeight: 850, color: "var(--text-secondary)", marginBottom: 4 }}>cx perda</label>
                    <input value={perdasCxMes[idx]} disabled={bloqueado} onChange={(e) => atualizarCxMes(idx, e.target.value)} placeholder="0"
                      style={{ width: "100%", height: 34, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", padding: "0 9px", fontSize: 12, fontWeight: 850, outline: "none" }} />
                    <p style={{ margin: "8px 0 0", fontSize: 10, color: "var(--text-secondary)" }}>Base: {fmt(l.base)} cx</p>
                  </div>
                )
              })}
            </div>

            <div style={{ padding: "16px 22px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={() => { setPerdasPctMes(Array.from({ length: 12 }, () => "")); setPerdasCxMes(Array.from({ length: 12 }, () => "")) }}
                style={{ height: 38, borderRadius: 11, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-secondary)", padding: "0 14px", fontSize: 12, fontWeight: 850, cursor: "pointer" }}>
                Limpar mês a mês
              </button>
              <button type="button" onClick={() => setModalMesAberto(false)}
                style={{ height: 38, borderRadius: 11, border: "1px solid transparent", background: AZUL, color: "#fff", padding: "0 16px", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
                Aplicar simulação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Visão Consolidada ────────────────────────────────────────────────────────

function VisaoConsolidada({ rodadas, etapasPorRodada, rodadaAtual, mudancasRealizado }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  rodadaAtual: MrpRodada | null
  mudancasRealizado: MudancaRealizado[]
}) {
  const [unidade, setUnidade] = useState<UnidadeConsolidado>("caixas")
  const mesAnalise = rodadaAtual?.mes || new Date().getMonth() + 1
  const anoAnalise = rodadaAtual?.ano || new Date().getFullYear()
  const divisor = unidade === "caixas" ? 500 : 1
  const labelUnidade = unidade === "caixas" ? "cx" : "tb"
  const [orcadoAnualCaixas, setOrcadoAnualCaixas] = useState<number | null>(null)
  const [orcadoMensalCaixas, setOrcadoMensalCaixas] = useState<number[]>([])
  const [sd3MensalConsolidado, setSd3MensalConsolidado] = useState<Array<number | null>>(Array.from({ length: 12 }, () => null))
  const [mostrarLegenda, setMostrarLegenda] = useState(true)

  useEffect(() => {
    getOrcadoFaturamento()
      .then((d: unknown) => {
        const total = Number((d as { total_caixas?: number })?.total_caixas || 0)
        const mensalSaida = extrairOrcadoMensalFaturamento(d, total, Array.from({ length: 12 }, () => 0)).meses
        const totalFallback = mensalSaida.reduce((a, b) => a + Number(b || 0), 0)
        setOrcadoAnualCaixas(total > 0 ? total : (totalFallback > 0 ? totalFallback : null))
      })
      .catch(() => setOrcadoAnualCaixas(null))

    getOrcadoLiberacao()
      .then((d: unknown) => {
        const data = d as { meses?: unknown }
        const mesesRaw = asArray<{ mes?: number; L1?: number; L2?: number }>(data.meses)
        const meses = Array.from({ length: 12 }, (_, i) => {
          const item = mesesRaw.find((m) => Number(m.mes) === i + 1)
          return ((Number(item?.L1 || 0) + Number(item?.L2 || 0)) / 500)
        })
        setOrcadoMensalCaixas(meses)
      })
      .catch(() => setOrcadoMensalCaixas([]))
  }, [])

  useEffect(() => {
    getSd3RealizadoMensal(anoAnalise)
      .then((d: unknown) => setSd3MensalConsolidado(asMonthlyArray(d)))
      .catch(() => setSd3MensalConsolidado(Array.from({ length: 12 }, () => null)))
  }, [anoAnalise])

  const dadosVersao = useMemo(() => {
    return rodadas.map((rodada) => {
      const etapasBase = etapasPorRodada[rodada.id || ""] || []
      const etapas = etapasBase.filter((e) => ["L1", "L2"].includes(String(e.recurso || "").toUpperCase()))
      const totalMesTubetes = etapas.reduce((acc, e) => {
        if (Number(e.mes_liberacao) === mesAnalise && Number(e.ano_liberacao) === anoAnalise)
          return acc + Number(e.qtd_planejada || 0)
        return acc
      }, 0)
      const porLinha: Record<string, number> = {}
      ;["L1", "L2"].forEach((r) => {
        porLinha[r] = etapas.reduce((s, e) => {
          if (Number(e.mes_liberacao) === mesAnalise && Number(e.ano_liberacao) === anoAnalise && String(e.recurso || "").toUpperCase() === r)
            return s + Number(e.qtd_planejada || 0)
          return s
        }, 0)
      })
      const porMes = Array.from({ length: 12 }, (_, i) => {
        const mes = i + 1
        const planejado = etapas.reduce((acc, e) => {
          if (Number(e.mes_liberacao) === mes && Number(e.ano_liberacao) === anoAnalise)
            return acc + Number(e.qtd_planejada || 0)
          return acc
        }, 0)

        // Para o comparativo anual executivo, meses anteriores à rodada ativa devem
        // refletir o realizado oficial da SD3 quando disponível.
        // Assim o total projetado por versão vira: realizado fechado + plano da versão.
        const realizadoSd3Cx = sd3MensalConsolidado[i]
        if (mes < mesAnalise && realizadoSd3Cx !== null && realizadoSd3Cx !== undefined) {
          return Number(realizadoSd3Cx || 0) * 500
        }

        return planejado
      })
      return { rodada, totalMesTubetes: porMes[mesAnalise - 1] || totalMesTubetes, porLinha, porMes }
    })
  }, [rodadas, etapasPorRodada, mesAnalise, anoAnalise, sd3MensalConsolidado])

  const atual = dadosVersao[dadosVersao.length - 1]
  const anterior = dadosVersao.length > 1 ? dadosVersao[dadosVersao.length - 2] : null
  const primeira = dadosVersao[0]

  if (!rodadas.length) {
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Nenhuma versão disponível.</p>
      </div>
    )
  }

  const valorAtual = (atual?.totalMesTubetes || 0) / divisor
  const valorV1Mes = primeira ? primeira.totalMesTubetes / divisor : 0
  const orcadoMesValor = orcadoMensalCaixas[mesAnalise - 1] != null ? unidadeValor(orcadoMensalCaixas[mesAnalise - 1], divisor) : null
  const deltaOrcadoMes = orcadoMesValor != null ? valorAtual - orcadoMesValor : null
  const deltaAnterior = anterior ? valorAtual - (anterior.totalMesTubetes / divisor) : null
  const deltaPrimeira = primeira && primeira !== atual ? valorAtual - (primeira.totalMesTubetes / divisor) : null
  const lotesImpactados = mudancasRealizado.filter((m) => ehMudancaCascata(m) || m.tipo_impacto === "atrasou").length
  const maiorAtraso = Math.max(0, ...mudancasRealizado.map((m) => Number(m.impacto_dias || 0)).filter((v) => v > 0))

  const sectionTitle = (label: string, sub: string) => (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>{label}</p>
      <h3 style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{sub}</h3>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Bloco 1: KPIs */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 20, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>Visão consolidada</p>
            <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
              {MESES[mesAnalise - 1]}/{anoAnalise} — V{rodadaAtual?.versao} ({rodadas.length} {rodadas.length === 1 ? "versão" : "versões"})
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setMostrarLegenda((prev) => !prev)}
              style={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                padding: "9px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: mostrarLegenda ? "#EFF6FF" : "var(--bg-primary)",
                color: mostrarLegenda ? AZUL : "var(--text-secondary)",
              }}
            >
              {mostrarLegenda ? "Ocultar legendas" : "Mostrar legendas"}
            </button>
            <div style={{ display: "flex", borderRadius: 12, border: "1px solid var(--border)", padding: 4, background: "var(--bg-primary)" }}>
              {(["caixas", "tubetes"] as UnidadeConsolidado[]).map((opcao) => (
                <button key={opcao} type="button" onClick={() => setUnidade(opcao)}
                  style={{ borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: unidade === opcao ? AZUL : "transparent", color: unidade === opcao ? "#fff" : "var(--text-secondary)" }}>
                  {opcao === "caixas" ? "Caixas" : "Tubetes"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <KpiCard label={`Volume ${MESES[mesAnalise - 1]}/${anoAnalise}`} value={fmt(valorAtual)} sub={`${labelUnidade} — V${atual?.rodada?.versao}`} destaque />
          <KpiCard label={`Orçado ${MESES[mesAnalise - 1]}/${anoAnalise}`} value={orcadoMesValor != null ? fmt(orcadoMesValor) : "—"} sub={labelUnidade} cor="neutral" />
          <KpiCard label={`V1 do mês`} value={fmt(valorV1Mes)} sub={`${labelUnidade} — base`} cor="neutral" />
          <KpiCard label="Δ vs orçado" value={deltaOrcadoMes != null ? fmtSinal(deltaOrcadoMes) : "—"} sub="Atual vs orçamento mensal" delta={deltaOrcadoMes} />
          <KpiCard label="Δ vs versão anterior" value={deltaAnterior != null ? fmtSinal(deltaAnterior) : "—"} sub={anterior ? `V${anterior.rodada.versao} → V${atual?.rodada?.versao}` : "Primeira versão"} delta={deltaAnterior} />
          <KpiCard label={`Δ vs V${primeira?.rodada?.versao || 1} (base)`} value={deltaPrimeira != null ? fmtSinal(deltaPrimeira) : "—"} sub="Acumulado desde o início do mês" delta={deltaPrimeira} />
          <KpiCard label="Lotes impactados" value={String(lotesImpactados)} sub="Real + cascata da fila" cor={lotesImpactados > 0 ? "red" : "neutral"} />
          <KpiCard label="Maior atraso" value={`${maiorAtraso}d`} sub="Entre real e reprogramação" cor={maiorAtraso > 2 ? "red" : "neutral"} />
        </div>
      </div>

      {/* Bloco 2: Comparativo anual */}
      <GraficoAnualVertical
        dadosVersao={dadosVersao}
        divisor={divisor}
        labelUnidade={labelUnidade}
        orcadoAnualCaixas={orcadoAnualCaixas}
        mostrarLegenda={mostrarLegenda}
      />

      {/* Bloco 3: Evolução mensal */}
      <GraficoMensalVersoes dadosVersao={dadosVersao} divisor={divisor} anoAnalise={anoAnalise} mostrarLegenda={mostrarLegenda} orcadoMensalCaixas={orcadoMensalCaixas} labelUnidade={labelUnidade} />

      {/* Bloco 4: Tabela mensal */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {sectionTitle("Distribuição anual", `Liberação mensal por versão — ${anoAnalise}`)}
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
            Valores em {unidade}. Meses anteriores usam SD3 quando disponível. Delta em relação à versão anterior. Linha Δ V1→Atual mostra o acumulado total.
          </p>
        </div>
        <TabelaMensalUnificada dadosVersao={dadosVersao} anoAnalise={anoAnalise} divisor={divisor} />
      </div>

      {/* Bloco 5: Abertura por linha */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--bg-secondary)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {sectionTitle("Abertura por linha", `L1 e L2 — ${MESES[mesAnalise - 1]}/${anoAnalise}`)}
        </div>
        <AberturaLinhas dadosVersao={dadosVersao} divisor={divisor} labelUnidade={labelUnidade} />
      </div>

      {/* Bloco 6: Realizado */}
      {mudancasRealizado.length > 0 && (
        <PainelRealizado mudancasRealizado={mudancasRealizado} divisor={divisor} labelUnidade={labelUnidade} />
      )}
    </div>
  )
}

// ─── Comparativo de Liberação (aba detalhado) ─────────────────────────────────

function ComparativoLiberacao({ rodadas, etapasPorRodada, recursoFiltro }: {
  rodadas: MrpRodada[]
  etapasPorRodada: Record<string, MrpEtapa[]>
  recursoFiltro?: string
}) {
  const mesesUnicos = useMemo(() => {
    const anoBase = rodadas.find((r) => r?.ano)?.ano || new Date().getFullYear()
    return Array.from({ length: 12 }, (_, i) => `${anoBase}-${String(i + 1).padStart(2, "0")}`)
  }, [rodadas])

  const dados = useMemo(() => {
    return rodadas.map((rodada) => {
      const etapasBase = etapasPorRodada[rodada.id || ""] || []
      const etapas = recursoFiltro ? etapasBase.filter((e) => String(e.recurso || "").toUpperCase() === String(recursoFiltro).toUpperCase()) : etapasBase
      const porMes: Record<string, number> = {}
      mesesUnicos.forEach((chave) => { porMes[chave] = 0 })
      etapas.forEach((e) => {
        if (e.mes_liberacao && e.ano_liberacao) {
          const chave = `${e.ano_liberacao}-${String(e.mes_liberacao).padStart(2, "0")}`
          porMes[chave] = (porMes[chave] || 0) + Number(e.qtd_planejada || 0)
        }
      })
      const total = Object.values(porMes).reduce((a, b) => a + b, 0)
      return { rodada, porMes, total }
    })
  }, [rodadas, etapasPorRodada, mesesUnicos, recursoFiltro])

  if (!rodadas.length || !mesesUnicos.length) return null

  const thStyle: React.CSSProperties = { background: AZUL, color: "#fff", padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", borderRight: "1px solid rgba(255,255,255,0.1)" }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="card-label mb-0.5">Comparativo de versões</p>
        <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Liberação mensal — tubetes e caixas por versão</h3>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          Soma de QTD. (Tubetes) por Mês Lib. de cada versão{recursoFiltro ? ` — ${recursoFiltro}` : ""}. Caixas = tubetes / 500.
        </p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 120, position: "sticky", left: 0, zIndex: 2 }}>Versão</th>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 80 }}>Unidade</th>
              {mesesUnicos.map((chave) => {
                const [ano, mes] = chave.split("-")
                return <th key={chave} style={thStyle}>{MESES[Number(mes) - 1]}/{ano}</th>
              })}
              <th style={{ ...thStyle, borderRight: "none" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.map(({ rodada, porMes, total }, idx) => {
              const anterior = idx > 0 ? dados[idx - 1] : null
              const isLast = idx === dados.length - 1
              const rowBg = isLast ? "rgba(23,55,94,0.04)" : idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-primary)"
              return (
                <>
                  <tr key={`${rodada.id}-tb`} style={{ background: rowBg, borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--text-primary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }}>
                      V{rodada.versao}
                      {isLast && <span className="ml-2 text-[10px] rounded-full px-1.5 py-0.5 font-semibold" style={{ background: AZUL, color: "#fff" }}>Atual</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-secondary)", borderRight: "1px solid var(--border)" }}>Tubetes</td>
                    {mesesUnicos.map((chave) => {
                      const val = porMes[chave] || 0
                      const valAnt = anterior?.porMes[chave] || 0
                      const dif = val - valAnt
                      return (
                        <td key={chave} style={{ padding: "10px 14px", textAlign: "right", borderRight: "1px solid var(--border)", color: "var(--text-primary)" }}>
                          <div>{fmt(val)}</div>
                          {anterior && dif !== 0 && <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>{dif > 0 ? "+" : ""}{fmt(dif)}</div>}
                        </td>
                      )
                    })}
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(total)}</td>
                  </tr>
                  <tr key={`${rodada.id}-cx`} style={{ background: rowBg, borderBottom: "2px solid var(--border)" }}>
                    <td style={{ padding: "6px 14px 10px", color: "var(--text-secondary)", position: "sticky", left: 0, background: rowBg, zIndex: 1, borderRight: "1px solid var(--border)" }} />
                    <td style={{ padding: "6px 14px 10px", color: "var(--text-secondary)", borderRight: "1px solid var(--border)" }}>Caixas</td>
                    {mesesUnicos.map((chave) => {
                      const val = (porMes[chave] || 0) / 500
                      const valAnt = (anterior?.porMes[chave] || 0) / 500
                      const dif = val - valAnt
                      return (
                        <td key={chave} style={{ padding: "6px 14px 10px", textAlign: "right", borderRight: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                          <div>{fmt(val)}</div>
                          {anterior && dif !== 0 && <div className={`text-[10px] ${dif > 0 ? "text-emerald-600" : "text-red-600"}`}>{dif > 0 ? "+" : ""}{fmt(dif)}</div>}
                        </td>
                      )
                    })}
                    <td style={{ padding: "6px 14px 10px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt(total / 500)}</td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

const VisaoConsolidadaMemo = memo(VisaoConsolidada)
const ProjecaoPerdasMensaisMemo = memo(ProjecaoPerdasMensais)

export default function Mrp() {
  const hoje = new Date()

  const [rodadas, setRodadas] = useState<MrpRodada[]>([])
  const [rodadaSelecionada, setRodadaSelecionada] = useState<MrpRodada | null>(null)
  const [etapas, setEtapas] = useState<MrpEtapa[]>([])
  const [alocacoes, setAlocacoes] = useState<MrpAlocacaoDia[]>([])
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [importandoReal, setImportandoReal] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [copiandoRodada, setCopiandoRodada] = useState(false)
  const [excluindoRodada, setExcluindoRodada] = useState(false)
  const [modalNovaRodada, setModalNovaRodada] = useState(false)
  const [modalExcluir, setModalExcluir] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [edicoes, setEdicoes] = useState<Record<string, EdicaoEtapa>>({})
  const [arquivoMps, setArquivoMps] = useState<File | null>(null)
  const [arquivoReal, setArquivoReal] = useState<File | null>(null)
  const [mudancasRealizado, setMudancasRealizado] = useState<MudancaRealizado[]>([])
  const [edicoesMudancas, setEdicoesMudancas] = useState<Record<number, { motivo?: string; mes_liberacao?: number }>>({})
  const [salvandoMudanca, setSalvandoMudanca] = useState<number | null>(null)
  const [pagina, setPagina] = useState(1)
  const [mesInicio, setMesInicio] = useState(hoje.getMonth() + 1)
  const [anoInicio, setAnoInicio] = useState(hoje.getFullYear())
  const [mesFim, setMesFim] = useState(12)
  const [anoFim, setAnoFim] = useState(2026)
  const [filtros, setFiltros] = useState<Filtros>({
    busca: "", lote: "", codigo: "", produto: "",
    mesProducao: "", anoProducao: "", mesLiberacao: "", anoLiberacao: "", recurso: "L1",
  })
  const [abaMps, setAbaMps] = useState<AbaMps>("detalhado")
  const [isPendingAbaMps, startTransitionAbaMps] = useTransition()
  const abaMpsRenderizada = useDeferredValue(abaMps)
  const trocandoAbaMps = isPendingAbaMps || abaMps !== abaMpsRenderizada
  const filtrosRenderizados = useDeferredValue(filtros)
  const trocandoFiltros = filtros !== filtrosRenderizados
  const [etapasPorRodada, setEtapasPorRodada] = useState<Record<string, MrpEtapa[]>>({})
  const [carregandoComparativo, setCarregandoComparativo] = useState(false)

  function trocarAbaMps(aba: AbaMps) {
    if (aba === abaMps) return
    startTransitionAbaMps(() => setAbaMps(aba))
  }

  function showToast(data: Toast, duration = 4000) {
    setToast(data)
    window.setTimeout(() => setToast(null), duration)
  }

  function limparFiltros() {
    setFiltros({ busca: "", lote: "", codigo: "", produto: "", mesProducao: "", anoProducao: "", mesLiberacao: "", anoLiberacao: "", recurso: "L1" })
    setPagina(1)
  }

  async function carregarRodadas() {
    try {
      const dataRaw = await getMrpRodadas()
      const data = asArray<MrpRodada>(dataRaw)
      setRodadas(data)

      if (data.length > 0 && !rodadaSelecionada) setRodadaSelecionada(data[0])
      if (!Array.isArray(dataRaw)) {
        console.warn("Resposta inesperada em getMrpRodadas:", dataRaw)
      }

      return data
    } catch (err) {
      console.error("Erro ao carregar rodadas MRP:", err)
      setRodadas([])
      setRodadaSelecionada(null)
      showToast({
        tipo: "error",
        titulo: "Erro ao carregar MPS",
        mensagem: "Não foi possível carregar as rodadas do MPS agora.",
      })
      return []
    }
  }

  async function carregarDadosRodada(rodadaId: string) {
    setLoading(true)
    try {
      const [etapasData, alocacoesData, mudancasData] = await Promise.all([
        getMrpEtapas(rodadaId).catch((err) => {
          console.error("Erro ao carregar etapas MRP:", err)
          return []
        }),
        getMrpAlocacoes(rodadaId).catch((err) => {
          console.error("Erro ao carregar alocações MRP:", err)
          return []
        }),
        getMrpMudancasRealizado(rodadaId).catch((err) => {
          console.error("Erro ao carregar mudanças do realizado:", err)
          return []
        }),
      ])

      setEtapas(asArray<MrpEtapa>(etapasData))
      setAlocacoes(asArray<MrpAlocacaoDia>(alocacoesData))
      setMudancasRealizado(asMudancasRealizado(mudancasData))
      setEdicoes({})
    } finally {
      setLoading(false)
    }
  }

  async function carregarComparativo(rodadaReferencia: MrpRodada, todasRodadas: MrpRodada[]) {
    const mesmoMesAno = todasRodadas
      .filter((r) => r.mes === rodadaReferencia.mes && r.ano === rodadaReferencia.ano)
      .sort((a, b) => (a.versao || 0) - (b.versao || 0))

    if (!mesmoMesAno.length) {
      setEtapasPorRodada({})
      return
    }

    const ids = mesmoMesAno.map((r) => r.id).filter(Boolean) as string[]
    const faltantes = ids.filter((id) => !etapasPorRodada[id])

    if (!faltantes.length) return

    setCarregandoComparativo(true)
    try {
      const mapa: Record<string, MrpEtapa[]> = { ...etapasPorRodada }

      await Promise.all(mesmoMesAno.map(async (r) => {
        if (!r.id || mapa[r.id]) return
        try {
          mapa[r.id] = asArray<MrpEtapa>(await getMrpEtapas(r.id))
        } catch {
          mapa[r.id] = []
        }
      }))

      setEtapasPorRodada(mapa)
    } finally {
      setCarregandoComparativo(false)
    }
  }

  function agendarComparativo(rodadaReferencia: MrpRodada, todasRodadas: MrpRodada[]) {
    const executar = () => {
      void carregarComparativo(rodadaReferencia, todasRodadas)
    }

    const w = window as any
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(executar, { timeout: 5000 })
      return () => {
        if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id)
      }
    }

    const id = window.setTimeout(executar, 900)
    return () => window.clearTimeout(id)
  }

  async function handleCriarRodada(nome: string, mes: number, ano: number, versao: number, obs: string) {
    const nova = await criarMrpRodada({ nome, mes, ano, versao, observacao: obs || null, status: "rascunho" })
    setRodadaSelecionada(nova)
    setModalNovaRodada(false)
    const todas = await carregarRodadas()
    await carregarComparativo(nova, todas)
  }

  async function handleCopiarRodada(proximoMes = false) {
    if (!rodadaSelecionada?.id) return
    try {
      setCopiandoRodada(true)
      let payload = {}
      if (proximoMes) {
        const dt = new Date(rodadaSelecionada.ano, (rodadaSelecionada.mes || 1) - 1 + 1, 1)
        payload = { mes: dt.getMonth() + 1, ano: dt.getFullYear(), versao: 1 }
      }
      const response = await copiarMrpRodada(rodadaSelecionada.id, payload)
      const novaRodada = response.nova_rodada
      const todas = await carregarRodadas()
      setRodadaSelecionada(novaRodada)
      await carregarComparativo(novaRodada, todas)
      showToast({
        tipo: "success",
        titulo: proximoMes ? "V1 do próximo mês criada" : "Nova versão criada",
        mensagem: `Agora trabalhando na V${novaRodada.versao} de ${MESES[(novaRodada.mes || 1) - 1]}/${novaRodada.ano}.`,
      })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao copiar", mensagem: err instanceof Error ? err.message : "Erro ao copiar rodada." })
    } finally {
      setCopiandoRodada(false)
    }
  }

  async function confirmarExcluirRodada() {
    if (!rodadaSelecionada?.id) return
    try {
      setExcluindoRodada(true)
      await excluirMrpRodada(rodadaSelecionada.id)
      const todas = await carregarRodadas()
      const proxima = todas[0] || null
      setRodadaSelecionada(proxima)
      setModalExcluir(false)
      setMudancasRealizado([])
      if (!proxima) { setEtapas([]); setAlocacoes([]) }
      showToast({ tipo: "success", titulo: "Rodada excluída", mensagem: "Rodada e dados vinculados removidos com sucesso." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao excluir", mensagem: err instanceof Error ? err.message : "Erro ao excluir rodada." })
    } finally {
      setExcluindoRodada(false)
    }
  }

  async function handleImportarMps() {
    if (!rodadaSelecionada?.id || !arquivoMps) return
    try {
      setImportando(true)
      await importarMrpMps(rodadaSelecionada.id, arquivoMps)
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "MPS importado", mensagem: "Arquivo processado com sucesso." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao importar", mensagem: err instanceof Error ? err.message : "Erro ao importar MPS." })
    } finally { setImportando(false) }
  }

  async function handleImportarReal() {
    if (!rodadaSelecionada?.id || !arquivoReal) return
    try {
      setImportandoReal(true)
      const response = await importarMrpProducaoReal(rodadaSelecionada.id, arquivoReal)
      const mudancas = asMudancasRealizado(response)
      setMudancasRealizado(mudancas)
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "Realizado aplicado", mensagem: `${mudancas.length} lote(s) atualizados.` })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao importar real", mensagem: err instanceof Error ? err.message : "Erro ao importar realizado." })
    } finally { setImportandoReal(false) }
  }

  function aplicarEdicaoProduto(etapa: MrpEtapa, novoProduto: string) {
    if (!etapa.id) return
    const mapaCodigo: Record<string, string> = {}
    etapas.forEach((e) => { if (e.descricao_produto && e.codigo_produto) mapaCodigo[e.descricao_produto] = e.codigo_produto })
    const novoCodigo = mapaCodigo[novoProduto] || etapa.codigo_produto || ""
    const novoLote = !etapa.lote ? gerarLoteSugerido(etapa, novoProduto, etapas) : etapa.lote
    setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), descricao_produto: novoProduto, codigo_produto: novoCodigo, lote: novoLote } }))
  }

  async function salvarAlteracoes() {
    const entradas = Object.entries(edicoes)
    if (!entradas.length) return
    try {
      setSalvando(true)
      for (const [etapaId, dados] of entradas) await atualizarMrpEtapa(etapaId, dados)
      setEdicoes({})
      // Recarregar etapas e comparativo para atualizar gráfico e tabela anual
      if (rodadaSelecionada?.id) {
        await carregarDadosRodada(rodadaSelecionada.id)
        await carregarComparativo(rodadaSelecionada, rodadas)
      }
      showToast({ tipo: "success", titulo: "Salvo", mensagem: "Alterações salvas com sucesso." })
    } catch {
      showToast({ tipo: "error", titulo: "Erro ao salvar", mensagem: "Não foi possível salvar as alterações." })
    } finally { setSalvando(false) }
  }

  async function salvarEdicaoMudanca(idx: number, mudanca: MudancaRealizado) {
    const edicao = edicoesMudancas[idx]
    if (!edicao || !rodadaSelecionada?.id) return
    const loteRef = String(mudanca.lote || mudanca.lote_real_cogtive || "").toUpperCase()
    const recursoRef = identificarRecursoMudanca(mudanca)
    const etapa = etapas.find((e) => {
      const mesmoRecurso = String(e.recurso || "").toUpperCase() === recursoRef
      const mesmoLote = String(e.lote || "").toUpperCase() === loteRef
      return mesmoRecurso && mesmoLote
    })
    if (!etapa?.id) { showToast({ tipo: "error", titulo: "Lote não encontrado", mensagem: "Não encontrei a etapa correspondente." }); return }
    try {
      setSalvandoMudanca(idx)
      const dados: Partial<MrpEtapa> = {}
      if (edicao.motivo !== undefined) dados.observacao = edicao.motivo
      if (edicao.mes_liberacao !== undefined) dados.mes_liberacao = edicao.mes_liberacao
      await atualizarMrpEtapa(etapa.id, dados)
      // Atualizar localmente
      setMudancasRealizado((prev) => prev.map((m, i) => i === idx ? {
        ...m,
        motivo_provavel: edicao.motivo ?? m.motivo_provavel,
        mes_liberacao_novo: edicao.mes_liberacao ?? m.mes_liberacao_novo,
      } : m))
      setEdicoesMudancas((prev) => { const n = {...prev}; delete n[idx]; return n })
      showToast({ tipo: "success", titulo: "Salvo", mensagem: "Motivo e mês de liberação atualizados." })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao salvar", mensagem: err instanceof Error ? err.message : "Erro ao salvar." })
    } finally { setSalvandoMudanca(null) }
  }

  async function reverterMudancaRealizado(mudanca: MudancaRealizado) {
    if (!rodadaSelecionada?.id) return
    const loteRef = String(mudanca.lote || mudanca.lote_real_cogtive || "").toUpperCase()
    const recursoRef = identificarRecursoMudanca(mudanca)
    const etapa = etapas.find((e) => {
      const mesmoRecurso = String(e.recurso || "").toUpperCase() === recursoRef
      const mesmoLote = String(e.lote || "").toUpperCase() === loteRef || String(e.op || "").toUpperCase() === loteRef
      return mesmoRecurso && mesmoLote
    })
    if (!etapa?.id) { showToast({ tipo: "error", titulo: "Lote não encontrado", mensagem: "Não encontrei a etapa correspondente." }); return }
    if (!mudanca.data_fim_anterior) { showToast({ tipo: "error", titulo: "Sem data anterior", mensagem: "Esse lote não possui data anterior registrada." }); return }
    try {
      setSalvando(true)
      const dados: EdicaoEtapa & Partial<MrpEtapa> = {
        data_fim: mudanca.data_fim_anterior,
        un_hora: mudanca.un_hora_anterior ?? etapa.un_hora,
        duracao_horas: etapa.qtd_planejada && (mudanca.un_hora_anterior || etapa.un_hora)
          ? Number(etapa.qtd_planejada) / Number(mudanca.un_hora_anterior || etapa.un_hora || 1)
          : etapa.duracao_horas,
        status: "ajuste_manual",
        origem: "AJUSTE_MANUAL_REALIZADO",
        observacao: `Reversão do realizado Cogtive — data fim original: ${mudanca.data_fim_anterior}.`,
      }
      await atualizarMrpEtapa(etapa.id, dados)
      await carregarDadosRodada(rodadaSelecionada.id)
      await carregarComparativo(rodadaSelecionada, rodadas)
      showToast({ tipo: "success", titulo: "Ajuste revertido", mensagem: `Lote ${loteRef} voltou para a data fim planejada original.` })
    } catch (err) {
      showToast({ tipo: "error", titulo: "Erro ao reverter", mensagem: err instanceof Error ? err.message : "Não foi possível reverter." })
    } finally { setSalvando(false) }
  }

  function etapaComEdicao(e: MrpEtapa): MrpEtapa {
    if (!e.id || !edicoes[e.id]) return e
    return { ...e, ...edicoes[e.id] }
  }

  useEffect(() => { carregarRodadas() }, [])

  useEffect(() => {
    let cancelarComparativo: (() => void) | undefined

    if (rodadaSelecionada?.id) {
      void carregarDadosRodada(rodadaSelecionada.id)
      cancelarComparativo = agendarComparativo(rodadaSelecionada, rodadas)
    } else {
      setEtapas([]); setAlocacoes([]); setMudancasRealizado([]); setEtapasPorRodada({}); setEdicoes({})
    }

    return () => cancelarComparativo?.()
  }, [rodadaSelecionada?.id])

  useEffect(() => {
    if (!rodadaSelecionada?.id) return
    if (abaMps !== "consolidado" && abaMps !== "perdas") return
    if (etapasPorRodada[rodadaSelecionada.id]) return

    void carregarComparativo(rodadaSelecionada, rodadas)
  }, [abaMps, rodadaSelecionada?.id, rodadas.length])

  useEffect(() => {
    const datas = etapas.map((e) => e.data_inicio).filter(Boolean) as string[]
    if (!datas.length) return
    const menor = datas.sort()[0]
    const dt = new Date(`${menor}T00:00:00`)
    setMesInicio(dt.getMonth() + 1)
    setAnoInicio(dt.getFullYear())
  }, [etapas])

  useEffect(() => { setPagina(1) }, [filtros])

  const dias = useMemo(() => gerarDias(mesInicio, anoInicio, mesFim, anoFim), [mesInicio, anoInicio, mesFim, anoFim])

  const mesesAgrupados = useMemo(() => {
    const grupos: { label: string; span: number }[] = []
    dias.forEach((d) => {
      const label = `${MESES[d.mes - 1]}/${d.ano}`
      if (grupos.length && grupos[grupos.length - 1].label === label) grupos[grupos.length - 1].span += 1
      else grupos.push({ label, span: 1 })
    })
    return grupos
  }, [dias])

  const opcoesPeriodo = useMemo(() => gerarOpcoesMeses(hoje.getFullYear()), [])
  const etapasComEdicoes = useMemo(() => etapas.map(etapaComEdicao), [etapas, edicoes])
  const etapasDoRecurso = useMemo(() => etapasComEdicoes.filter((e) => e.recurso === (filtrosRenderizados.recurso || "L1")), [etapasComEdicoes, filtrosRenderizados.recurso])

  const opcoesFiltros = useMemo(() => ({
    lote: uniqueSorted(etapasDoRecurso.map((e) => e.lote)),
    codigo: uniqueSorted(etapasDoRecurso.map((e) => e.codigo_produto)),
    produto: uniqueSorted(etapasDoRecurso.map((e) => e.descricao_produto)),
    mesProducao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_producao)),
    anoProducao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_producao)),
    mesLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_liberacao)),
    anoLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_liberacao)),
  }), [etapasDoRecurso])

  const produtosUnicos = useMemo(() => uniqueSorted(etapas.map((e) => e.descricao_produto)), [etapas])
  const produtoOptions = useMemo(() => produtosUnicos.map((p) => <option key={p} value={p}>{p}</option>), [produtosUnicos])
  const mesOptions = useMemo(() => MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>), [])

  const alocacaoMap = useMemo(() => {
    const map = new Map<string, number>()
    alocacoes.forEach((a) => {
      if (!a.lote && !a.codigo_produto) return
      const key = `${a.recurso}|${a.lote || ""}|${a.codigo_produto || ""}|${keyData(a.data)}`
      map.set(key, (map.get(key) || 0) + toNumber(a.horas_alocadas))
    })
    return map
  }, [alocacoes])

  const horasDiaMap = useMemo(() => {
    const map = new Map<string, number>()
    alocacoes.forEach((a) => {
      const key = `${a.recurso}|${keyData(a.data)}`
      const disponivel = toNumber(a.horas_disponiveis_dia)
      const alocada = toNumber(a.horas_alocadas)
      if (!Number.isNaN(disponivel) && disponivel > 0) map.set(key, disponivel)
      else if (!map.has(key) && !Number.isNaN(alocada)) map.set(key, alocada)
    })
    return map
  }, [alocacoes])

  const etapasFiltradas = useMemo(() => filtrarEtapas(etapasComEdicoes, filtrosRenderizados), [etapasComEdicoes, filtrosRenderizados])
  const recursoSelecionado = filtrosRenderizados.recurso || "L1"
  const totalPaginas = Math.max(1, Math.ceil(etapasFiltradas.length / PAGE_SIZE))
  const paginaCorrigida = Math.min(pagina, totalPaginas)
  const etapasPagina = useMemo(
    () => etapasFiltradas.slice((paginaCorrigida - 1) * PAGE_SIZE, paginaCorrigida * PAGE_SIZE),
    [etapasFiltradas, paginaCorrigida]
  )

  const mudancasDoRecurso = useMemo(
    () => mudancasRealizado.filter((m) => identificarRecursoMudanca(m) === recursoSelecionado),
    [mudancasRealizado, recursoSelecionado]
  )

  const rodadasComparativo = useMemo(() => {
    if (!rodadaSelecionada) return []
    return rodadas.filter((r) => r.mes === rodadaSelecionada.mes && r.ano === rodadaSelecionada.ano).sort((a, b) => (a.versao || 0) - (b.versao || 0))
  }, [rodadas, rodadaSelecionada])

  const qtdEdicoes = Object.keys(edicoes).length

  const selectStyle: React.CSSProperties = {
    background: "var(--bg-secondary)", borderColor: "var(--border)",
    color: "var(--text-primary)", height: 40, borderRadius: 10,
    border: "1px solid var(--border)", padding: "0 12px", fontSize: 13, outline: "none",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.06em", color: "var(--text-secondary)", marginBottom: 4, display: "block",
  }

  return (
    <div className="min-h-screen space-y-5 p-4 md:p-6" style={{ background: "var(--bg-primary)" }}>
      {toast && <ToastNotification toast={toast} />}

      {/* Header */}
      <div className="fade-in">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
          Planejamento · Produção
        </p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold md:text-2xl" style={{ color: "var(--text-primary)" }}>
              MPS — Planejamento Mestre de Produção
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Programação integrada de Envase (L1/L2), Fabrima e Liberação QA.
            </p>
            {rodadaSelecionada && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
                <CalendarDays size={14} style={{ color: "var(--text-secondary)" }} />
                <span style={{ color: "var(--text-secondary)" }}>Rodada ativa:</span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {rodadaSelecionada.nome} — {MESES[(rodadaSelecionada.mes || 1) - 1]}/{rodadaSelecionada.ano} — V{rodadaSelecionada.versao}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-xl border px-4 py-3 text-xs" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1E40AF" }}>
          Para atualizar com o realizado: primeiro crie a próxima versão (V+1 ou V1 do próximo mês), depois importe o relatório Cogtive nessa nova versão.
        </div>
      </div>

      {/* Barra de ações */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col" style={{ minWidth: 260 }}>
            <span style={labelStyle}>Rodada</span>
            <select value={rodadaSelecionada?.id || ""} style={selectStyle}
              onChange={(e) => { const r = rodadas.find((r) => r.id === e.target.value) || null; setRodadaSelecionada(r) }}>
              <option value="">Selecionar rodada...</option>
              {rodadas.map((r) => (
                <option key={r.id} value={r.id}>{r.nome} — {MESES[(r.mes || 1) - 1]}/{r.ano} — V{r.versao}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>Arquivo MPS</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--bg-secondary)" }}>
              <Upload size={14} style={{ color: "var(--text-secondary)" }} />
              <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setArquivoMps(e.target.files?.[0] || null)} />
              <span style={{ color: arquivoMps ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {arquivoMps ? arquivoMps.name.slice(0, 20) + (arquivoMps.name.length > 20 ? "..." : "") : "Selecionar arquivo"}
              </span>
            </label>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <button onClick={handleImportarMps} disabled={!arquivoMps || !rodadaSelecionada || importando}
              className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: AZUL }}>
              <RefreshCw size={14} className={importando ? "animate-spin" : ""} />
              {importando ? "Processando..." : "Processar MPS"}
            </button>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>Relatório Cogtive</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--bg-secondary)" }}>
              <Upload size={14} style={{ color: "var(--text-secondary)" }} />
              <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setArquivoReal(e.target.files?.[0] || null)} />
              <span style={{ color: arquivoReal ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {arquivoReal ? arquivoReal.name.slice(0, 20) + (arquivoReal.name.length > 20 ? "..." : "") : "Selecionar relatório"}
              </span>
            </label>
          </div>

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <button onClick={handleImportarReal} disabled={!arquivoReal || !rodadaSelecionada || importandoReal}
              className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "#5B21B6" }}>
              <RefreshCw size={14} className={importandoReal ? "animate-spin" : ""} />
              {importandoReal ? "Aplicando..." : "Aplicar realizado"}
            </button>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>Versionar</span>
            <div className="flex gap-2">
              <button onClick={() => handleCopiarRodada(false)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                <Copy size={14} />
                V{(rodadaSelecionada?.versao || 0) + 1} (mesmo mês)
              </button>
              <button onClick={() => handleCopiarRodada(true)} disabled={!rodadaSelecionada || copiandoRodada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                <CalendarDays size={14} />
                V1 do próximo mês
              </button>
            </div>
          </div>

          <div className="w-px self-stretch" style={{ background: "var(--border)", margin: "0 4px" }} />

          <div className="flex flex-col">
            <span style={labelStyle}>&nbsp;</span>
            <div className="flex gap-2">
              {qtdEdicoes > 0 && (
                <button onClick={salvarAlteracoes} disabled={salvando}
                  className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "#16A34A" }}>
                  <Save size={14} />
                  {salvando ? "Salvando..." : `Salvar (${qtdEdicoes})`}
                </button>
              )}
              <button onClick={() => setModalNovaRodada(true)}
                className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white"
                style={{ background: AZUL }}>
                <Plus size={14} />
                Nova rodada
              </button>
              <button onClick={() => setModalExcluir(true)} disabled={!rodadaSelecionada}
                className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: "#FECACA", background: "#FEF2F2", color: "#DC2626" }}>
                <Trash2 size={14} />
                Excluir
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter size={14} style={{ color: "var(--text-secondary)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Filtros da tabela</span>
          </div>
          <button type="button" onClick={limparFiltros}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            <Trash2 size={12} />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
          <div className="flex flex-col col-span-2">
            <label style={labelStyle}>Busca geral</label>
            <input value={filtros.busca} onChange={(e) => setFiltros((p) => ({ ...p, busca: e.target.value }))}
              placeholder="Lote, código, produto..."
              className="h-10 rounded-lg border px-3 text-sm outline-none"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Linha</label>
            <select value={filtros.recurso} style={selectStyle}
              onChange={(e) => setFiltros((p) => ({ ...p, recurso: e.target.value || "L1", lote: "", codigo: "", produto: "" }))}>
              {RECURSOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Lote</label>
            <select value={filtros.lote} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, lote: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.lote.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Código</label>
            <select value={filtros.codigo} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, codigo: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.codigo.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Produto</label>
            <select value={filtros.produto} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, produto: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.produto.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Mês prod.</label>
            <select value={filtros.mesProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Ano prod.</label>
            <select value={filtros.anoProducao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoProducao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoProducao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Mês lib.</label>
            <select value={filtros.mesLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, mesLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.mesLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Ano lib.</label>
            <select value={filtros.anoLiberacao} style={selectStyle} onChange={(e) => setFiltros((p) => ({ ...p, anoLiberacao: e.target.value }))}>
              <option value="">Todos</option>
              {opcoesFiltros.anoLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — início</label>
            <select value={`${anoInicio}-${mesInicio}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoInicio(a); setMesInicio(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label style={labelStyle}>Gantt — fim</label>
            <select value={`${anoFim}-${mesFim}`} style={selectStyle}
              onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setAnoFim(a); setMesFim(m) }}>
              {opcoesPeriodo.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap gap-2">
        {(["detalhado", "consolidado", "perdas"] as const).map((aba) => (
          <button key={aba} type="button" onClick={() => trocarAbaMps(aba)}
            className="rounded-xl border px-4 py-2 text-sm font-semibold transition"
            style={{
              background: abaMps === aba ? AZUL : "var(--bg-secondary)",
              color: abaMps === aba ? "#fff" : "var(--text-secondary)",
              borderColor: abaMps === aba ? AZUL : "var(--border)",
            }}>
            {aba === "detalhado" ? "MPS detalhado" : aba === "consolidado" ? "Visão consolidada" : "Perdas mensais"}
          </button>
        ))}
      </div>

      {(trocandoAbaMps || trocandoFiltros || carregandoComparativo) && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {carregandoComparativo ? "Preparando comparativo em segundo plano..." : "Atualizando visão..."}
        </div>
      )}

      {/* Aba consolidada */}
      {abaMpsRenderizada === "consolidado" && (
        <VisaoConsolidadaMemo
          rodadas={rodadasComparativo}
          etapasPorRodada={etapasPorRodada}
          rodadaAtual={rodadaSelecionada}
          mudancasRealizado={mudancasRealizado}
        />
      )}

      {/* Aba perdas mensais */}
      {abaMpsRenderizada === "perdas" && (
        <ProjecaoPerdasMensaisMemo
          rodadas={rodadasComparativo}
          etapasPorRodada={etapasPorRodada}
          rodadaAtual={rodadaSelecionada}
        />
      )}

      {/* Aba detalhada */}
      {abaMpsRenderizada === "detalhado" && (
        <>
          {/* Tabela Gantt */}
          <div
            className="card overflow-hidden"
            style={{
              contain: "layout paint",
              contentVisibility: "auto",
              containIntrinsicSize: "900px",
            }}
          >
            <div className="flex items-center justify-between px-5 py-3 text-white" style={{ background: AZUL }}>
              <div>
                <h2 className="font-semibold">Programação — {recursoSelecionado}</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {recursoSelecionado === "FABRIMA" ? "Embalagem" : "Envase"}
                </p>
              </div>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>
                {loading ? "Carregando..." : `${etapasFiltradas.length} linhas`}
              </span>
            </div>

            <div style={{ maxHeight: 640, overflow: "auto", contain: "layout paint", willChange: "scroll-position" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 40 }}>
                  <tr>
                    <th colSpan={FROZEN_COLUMNS.length} style={{ background: "var(--bg-secondary)", height: 28, position: "sticky", left: 0, zIndex: 50, minWidth: FROZEN_COLUMNS_WIDTH, width: FROZEN_COLUMNS_WIDTH, borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)" }} />
                    {SCROLL_COLUMNS.length > 0 && (
                      <th colSpan={SCROLL_COLUMNS.length} style={{ background: "var(--bg-secondary)", height: 28, minWidth: SCROLL_COLUMNS.reduce((t, c) => t + c.width, 0), borderBottom: "1px solid var(--border)" }} />
                    )}
                    {mesesAgrupados.map((m) => (
                      <th key={m.label} colSpan={m.span} style={{ background: AZUL, color: "#fff", padding: "6px 8px", textAlign: "center", fontSize: 11, fontWeight: 700, minWidth: m.span * 38, borderRight: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap" }}>
                        {m.label}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: AZUL }}>
                    {COLUMN_RENDER_META.map(({ col, frozen, left }) => {
                      return (
                        <th key={col.key} rowSpan={2} style={{ position: frozen ? "sticky" : undefined, left, zIndex: frozen ? 50 : undefined, background: AZUL, color: "rgba(255,255,255,0.9)", padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width, fontSize: 10, fontWeight: 600, whiteSpace: "pre-line", borderRight: "1px solid rgba(255,255,255,0.1)" }}>
                          {col.label}
                        </th>
                      )
                    })}
                    {dias.map((d) => (
                      <th key={`d-${d.data}`} style={{ background: AZUL, color: "#fff", padding: "6px 2px", textAlign: "center", minWidth: 38, fontSize: 10, fontWeight: 600, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                        {d.dia}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ background: AZUL }}>
                    {dias.map((d) => {
                      const h = horasDiaMap.get(`${recursoSelecionado}|${d.data}`) || 0
                      return (
                        <th key={`h-${d.data}`} style={{ background: AZUL, color: "#6EE7B7", padding: "4px 2px", textAlign: "center", fontSize: 10, borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                          {h > 0 ? fmt(h) : <span style={{ opacity: 0.3 }}>-</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody style={{ background: "var(--bg-secondary)" }}>
                  {etapasPagina.map((etapa) => (
                    <tr key={etapa.id} className="hover:bg-slate-50 transition-colors">
                      {COLUMN_RENDER_META.map(({ col, frozen, left }) => {
                        const editado = !!etapa.id && !!edicoes[etapa.id]
                        return (
                          <td key={col.key} style={{ position: frozen ? "sticky" : undefined, left, zIndex: frozen ? 30 : undefined, background: editado ? "#FEFCE8" : "var(--bg-secondary)", padding: "8px 10px", textAlign: col.align || "left", minWidth: col.width, width: col.width, borderBottom: "1px solid var(--border)", borderRight: frozen ? "1px solid var(--border)" : undefined, color: "var(--text-primary)", fontSize: 12 }}>
                            {col.key === "produto" ? (
                              <select value={etapa.descricao_produto || ""} onChange={(e) => aplicarEdicaoProduto(etapa, e.target.value)}
                                style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", fontSize: 12, outline: "none", color: "var(--text-primary)" }}>
                                {produtoOptions}
                              </select>
                            ) : col.key === "meslib" ? (
                              <select
                                value={edicoes[etapa.id!]?.mes_liberacao ?? etapa.mes_liberacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), mes_liberacao: Number(e.target.value), mes_lib_manual: true } }))}
                                style={{ width: "100%", background: etapa.mes_lib_manual ? "rgba(234,179,8,0.08)" : "transparent", border: `1px solid ${etapa.mes_lib_manual ? "rgba(234,179,8,0.4)" : "transparent"}`, borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "pointer", fontWeight: etapa.mes_lib_manual ? 700 : undefined }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = etapa.mes_lib_manual ? "rgba(234,179,8,0.4)" : "transparent"}
                              >
                                {mesOptions}
                              </select>
                            ) : col.key === "anolib" ? (
                              <input
                                type="number"
                                value={edicoes[etapa.id!]?.ano_liberacao ?? etapa.ano_liberacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), ano_liberacao: Number(e.target.value) } }))}
                                style={{ width: "100%", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "pointer" }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = "transparent"}
                              />
                            ) : col.key === "observacao" ? (
                              <input
                                type="text"
                                value={edicoes[etapa.id!]?.observacao ?? etapa.observacao ?? ""}
                                onChange={(e) => etapa.id && setEdicoes((prev) => ({ ...prev, [etapa.id!]: { ...(prev[etapa.id!] || {}), observacao: e.target.value } }))}
                                placeholder="comentário..."
                                style={{ width: "100%", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", fontSize: 12, outline: "none", color: "var(--text-primary)", cursor: "text" }}
                                onFocus={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                                onBlur={(e) => e.currentTarget.style.borderColor = "transparent"}
                              />
                            ) : (col.render(etapa) || "")}
                          </td>
                        )
                      })}
                      {dias.map((d) => {
                        const key = `${recursoSelecionado}|${etapa.lote || ""}|${etapa.codigo_produto || ""}|${d.data}`
                        const h = alocacaoMap.get(key) || 0
                        return (
                          <td key={d.data} style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid rgba(0,0,0,0.04)", padding: "4px 2px", textAlign: "center", minWidth: 38, background: h > 0 ? "rgba(16,185,129,0.1)" : undefined }}>
                            {h > 0 ? <span style={{ fontWeight: 600, color: "#059669", fontSize: 11 }}>{fmt(h)}</span> : <span style={{ color: "#CBD5E1", fontSize: 11 }}>-</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <span>Página {paginaCorrigida} de {totalPaginas} · {etapasFiltradas.length} linhas</span>
              <div className="flex gap-2">
                <button disabled={paginaCorrigida <= 1} onClick={() => setPagina(paginaCorrigida - 1)}
                  className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>Anterior</button>
                <button disabled={paginaCorrigida >= totalPaginas} onClick={() => setPagina(paginaCorrigida + 1)}
                  className="rounded-lg border px-3 py-1.5 font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>Próxima</button>
              </div>
            </div>
          </div>

          {/* Comparativo de liberação */}
          {rodadasComparativo.length > 0 && (
            <ComparativoLiberacao rodadas={rodadasComparativo} etapasPorRodada={etapasPorRodada} recursoFiltro={filtros.recurso} />
          )}

          {/* Mudanças do realizado */}
          {mudancasDoRecurso.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <p className="card-label mb-0.5">Realizado + cascata</p>
                  <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Mudanças aplicadas — {recursoSelecionado}</h3>
                  <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Real aplicado somente no lote produtivo; os próximos são recalculados pela fila da linha.</p>
                </div>
                <span className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {mudancasDoRecurso.length} lote(s)
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-primary)" }}>
                      {["Lote", "Produto", "Fim anterior", "Fim novo", "Status", "Impacto", "Paradas no dia", "UN/H ant.", "UN/H nova", "Δ UN/H %", "Mês Lib.", "Motivo", "Ações"].map((h, i) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: i >= 2 && i <= 8 ? "center" : "left", fontWeight: 600, fontSize: 11, color: "var(--text-secondary)", borderBottom: "2px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mudancasDoRecurso.map((m, idx) => {
                      const cascata = ehMudancaCascata(m)

                      return (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border)", background: cascata ? "rgba(217,119,6,0.03)" : undefined }} className="hover:bg-slate-50">
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-primary)" }}>{m.lote || m.lote_real_cogtive || "-"}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>{m.descricao_produto || "-"}</div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{m.codigo_produto}</div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>{fmtData(m.data_fim_anterior)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                          <div>{fmtData(m.data_fim_nova)}</div>
                          {cascata && <div style={{ marginTop: 2, fontSize: 10, color: "#B45309", fontWeight: 700 }}>Recalculado</div>}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${classeTipoRealizacao(m)}`}>
                            {cascata ? <RefreshCw size={11} /> : <CheckCircle2 size={11} />}
                            {labelTipoRealizacao(m)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${classeImpactoOperacional(m)}`}>
                            {iconeImpactoOperacional(m)}
                            {textoImpactoOperacional(m)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center", verticalAlign: "top" }}>
                          <ParadasCogtiveCell mudanca={m} contextoCascata={cascata} />
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>{valorUnHoraMudanca(m, "anterior")}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{valorUnHoraMudanca(m, "nova")}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }} className={!cascata ? classeDiferenca(m.delta_un_hora_pct) : undefined}>{!cascata ? fmtPct(m.delta_un_hora_pct) : "—"}</td>
                        {/* Mês Lib. editável */}
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <select
                            value={edicoesMudancas[idx]?.mes_liberacao ?? (m.mes_liberacao_novo || "")}
                            onChange={(e) => setEdicoesMudancas((prev) => ({ ...prev, [idx]: { ...prev[idx], mes_liberacao: Number(e.target.value) } }))}
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 11, color: "var(--text-primary)", outline: "none", width: 80 }}
                          >
                            {MESES.map((ml, mi) => (
                              <option key={mi + 1} value={mi + 1}>{ml}</option>
                            ))}
                          </select>
                        </td>
                        {/* Motivo editável */}
                        <td style={{ padding: "10px 14px", minWidth: 200 }}>
                          <input
                            type="text"
                            value={edicoesMudancas[idx]?.motivo ?? (m.motivo_provavel || "")}
                            onChange={(e) => setEdicoesMudancas((prev) => ({ ...prev, [idx]: { ...prev[idx], motivo: e.target.value } }))}
                            placeholder="não identificado"
                            style={{ width: "100%", background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none" }}
                          />
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            {edicoesMudancas[idx] && (
                              <button type="button" onClick={() => salvarEdicaoMudanca(idx, m)} disabled={salvandoMudanca === idx}
                                className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50"
                                style={{ borderColor: "#BBF7D0", background: "#F0FDF4", color: "#15803D", whiteSpace: "nowrap" }}>
                                {salvandoMudanca === idx ? "..." : "Salvar"}
                              </button>
                            )}
                            <button type="button" onClick={() => reverterMudancaRealizado(m)} disabled={salvando || cascata}
                              className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-secondary)", whiteSpace: "nowrap" }}
                              title={cascata ? "Linha recalculada por cascata. Para desfazer, reimporte ou ajuste a rodada." : "Voltar este lote para o fim planejado anterior."}>
                              {cascata ? "Fila" : "Manter planejado"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <ModalNovaRodada open={modalNovaRodada} onClose={() => setModalNovaRodada(false)} onCriar={handleCriarRodada} rodadas={rodadas} />
      <ModalExcluir open={modalExcluir} rodada={rodadaSelecionada} onClose={() => setModalExcluir(false)} onConfirmar={confirmarExcluirRodada} excluindo={excluindoRodada} />
    </div>
  )
}
