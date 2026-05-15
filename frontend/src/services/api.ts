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
const HEADER_CLARO = "#F3F6FA"
const PAGE_SIZE = 50

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

type Column = {
  key: string
  label: string
  width: number
  align?: "left" | "center" | "right"
  frozen?: boolean
  render: (etapa: MrpEtapa) => string | number | null | undefined
}

function fmt(value?: number | null) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
}

function fmtData(date?: string | null) {
  if (!date) return "-"
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")
}

const COLUMNS: Column[] = [
  { key: "lote", label: "LOTE", width: 90, frozen: true, render: (e) => e.lote },
  { key: "codigo", label: "CÓDIGO", width: 90, frozen: true, render: (e) => e.codigo_produto },
  { key: "produto", label: "PRODUTO", width: 210, frozen: true, render: (e) => e.descricao_produto },
  { key: "tempo", label: "TEMPO\n(Horas.)", width: 90, align: "right", render: (e) => fmt(e.duracao_horas) },
  { key: "unhora", label: "UN /\nHORA", width: 90, align: "right", render: (e) => fmt(e.un_hora) },
  { key: "qtd", label: "QTD.\n(Tubetes)", width: 105, align: "right", render: (e) => fmt(e.qtd_planejada) },
  { key: "mesprod", label: "MÊS\nPROD.", width: 80, align: "center", render: (e) => e.mes_producao },
  { key: "anoprod", label: "ANO\nPROD.", width: 80, align: "center", render: (e) => e.ano_producao },
  { key: "inicio", label: "DATA\nINÍCIO", width: 110, align: "center", render: (e) => fmtData(e.data_inicio) },
  { key: "fim", label: "DATA\nFIM", width: 110, align: "center", render: (e) => fmtData(e.data_fim) },
  { key: "lib", label: "DATA\nLIB.", width: 110, align: "center", render: (e) => fmtData(e.data_pa) },
  { key: "meslib", label: "MÊS\nLIB.", width: 80, align: "center", render: (e) => e.mes_liberacao },
  { key: "anolib", label: "ANO\nLIB.", width: 80, align: "center", render: (e) => e.ano_liberacao },
]

const FROZEN_COLUMNS = COLUMNS.filter((c) => c.frozen)

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

function getLeftOffset(index: number) {
  return FROZEN_COLUMNS.slice(0, index).reduce((sum, col) => sum + col.width, 0)
}

function gerarDias(inicioMes: number, inicioAno: number, fimMes: number, fimAno: number) {
  const dias: { data: string; dia: number; mes: number; ano: number }[] = []
  const atual = new Date(inicioAno, inicioMes - 1, 1)
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

function gerarOpcoesMeses(baseAno: number) {
  const opcoes: { value: string; label: string }[] = []

  for (let ano = baseAno - 1; ano <= baseAno + 2; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      opcoes.push({
        value: `${ano}-${mes}`,
        label: `${MESES[mes - 1]}/${ano}`,
      })
    }
  }

  return opcoes
}

function uniqueSorted(values: (string | number | null | undefined)[]) {
  return Array.from(
    new Set(
      values
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .map((v) => String(v))
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
}

function filtrarEtapas(etapas: MrpEtapa[], filtros: Filtros) {
  return etapas.filter((e) => {
    const busca = filtros.busca.trim().toLowerCase()

    if (busca) {
      const texto = [e.lote, e.codigo_produto, e.descricao_produto, e.recurso]
        .join(" ")
        .toLowerCase()

      if (!texto.includes(busca)) return false
    }

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

  const [pagina, setPagina] = useState(1)

  const [filtros, setFiltros] = useState<Filtros>({
    busca: "",
    lote: "",
    codigo: "",
    produto: "",
    mesProducao: "",
    anoProducao: "",
    mesLiberacao: "",
    anoLiberacao: "",
    recurso: "L1",
  })

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
    if (rodadaSelecionada?.id) carregarDadosRodada(rodadaSelecionada.id)
    else {
      setEtapas([])
      setAlocacoes([])
    }
  }, [rodadaSelecionada?.id])

  useEffect(() => {
    sugerirProximaVersao(mes, ano)
  }, [mes, ano, rodadas])

  useEffect(() => {
    setPagina(1)
  }, [filtros, mesInicio, anoInicio, mesFim, anoFim])

  useEffect(() => {
    const datas = etapas.map((e) => e.data_inicio).filter(Boolean) as string[]
    if (!datas.length) return

    const menor = datas.sort()[0]
    const dt = new Date(`${menor}T00:00:00`)

    setMesInicio(dt.getMonth() + 1)
    setAnoInicio(dt.getFullYear())
  }, [etapas])

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

  const opcoesPeriodo = useMemo(() => gerarOpcoesMeses(hoje.getFullYear()), [])

  const etapasDoRecurso = useMemo(
    () => etapas.filter((e) => e.recurso === (filtros.recurso || "L1")),
    [etapas, filtros.recurso]
  )

  const opcoesFiltros = useMemo(() => {
    return {
      lote: uniqueSorted(etapasDoRecurso.map((e) => e.lote)),
      codigo: uniqueSorted(etapasDoRecurso.map((e) => e.codigo_produto)),
      produto: uniqueSorted(etapasDoRecurso.map((e) => e.descricao_produto)),
      mesProducao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_producao)),
      anoProducao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_producao)),
      mesLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.mes_liberacao)),
      anoLiberacao: uniqueSorted(etapasDoRecurso.map((e) => e.ano_liberacao)),
    }
  }, [etapasDoRecurso])

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

      if (!Number.isNaN(disponivel) && disponivel > 0) {
        map.set(key, disponivel)
      } else if (!map.has(key) && !Number.isNaN(alocada)) {
        map.set(key, alocada)
      }
    })

    return map
  }, [alocacoes])

  const etapasFiltradas = useMemo(
    () => filtrarEtapas(etapas, filtros),
    [etapas, filtros]
  )

  const recursoSelecionado = filtros.recurso || "L1"
  const totalPaginas = Math.max(1, Math.ceil(etapasFiltradas.length / PAGE_SIZE))
  const paginaCorrigida = Math.min(pagina, totalPaginas)
  const inicioPagina = (paginaCorrigida - 1) * PAGE_SIZE
  const etapasPagina = etapasFiltradas.slice(inicioPagina, inicioPagina + PAGE_SIZE)

  function limparFiltros() {
    setFiltros({
      busca: "",
      lote: "",
      codigo: "",
      produto: "",
      mesProducao: "",
      anoProducao: "",
      mesLiberacao: "",
      anoLiberacao: "",
      recurso: "L1",
    })
  }

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

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <input
            value={filtros.busca}
            onChange={(e) => setFiltros((prev) => ({ ...prev, busca: e.target.value }))}
            placeholder="Buscar geral..."
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />

          <select
            value={filtros.recurso}
            onChange={(e) =>
              setFiltros((prev) => ({
                ...prev,
                recurso: e.target.value || "L1",
                lote: "",
                codigo: "",
                produto: "",
              }))
            }
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            {RECURSOS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <select value={filtros.lote} onChange={(e) => setFiltros((prev) => ({ ...prev, lote: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Lote</option>
            {opcoesFiltros.lote.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.codigo} onChange={(e) => setFiltros((prev) => ({ ...prev, codigo: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Código</option>
            {opcoesFiltros.codigo.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.produto} onChange={(e) => setFiltros((prev) => ({ ...prev, produto: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Produto</option>
            {opcoesFiltros.produto.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.mesProducao} onChange={(e) => setFiltros((prev) => ({ ...prev, mesProducao: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Mês prod.</option>
            {opcoesFiltros.mesProducao.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.anoProducao} onChange={(e) => setFiltros((prev) => ({ ...prev, anoProducao: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Ano prod.</option>
            {opcoesFiltros.anoProducao.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.mesLiberacao} onChange={(e) => setFiltros((prev) => ({ ...prev, mesLiberacao: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Mês lib.</option>
            {opcoesFiltros.mesLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filtros.anoLiberacao} onChange={(e) => setFiltros((prev) => ({ ...prev, anoLiberacao: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Ano lib.</option>
            {opcoesFiltros.anoLiberacao.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select
            value={`${anoInicio}-${mesInicio}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split("-").map(Number)
              setAnoInicio(a)
              setMesInicio(m)
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            {opcoesPeriodo.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <select
            value={`${anoFim}-${mesFim}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split("-").map(Number)
              setAnoFim(a)
              setMesFim(m)
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            {opcoesPeriodo.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <button
            onClick={limparFiltros}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 text-white" style={{ backgroundColor: AZUL }}>
          <div>
            <h2 className="font-semibold">Programação — {recursoSelecionado}</h2>
            <p className="text-xs text-white/80">
              {recursoSelecionado === "FABRIMA" ? "Programação macro de embalagem." : "Programação macro de envase."}
            </p>
          </div>

          <div className="text-xs text-white/90">
            {loading ? "Carregando..." : `${etapasFiltradas.length} linhas filtradas`}
          </div>
        </div>

        <div className="max-h-[680px] overflow-auto">
          <table className="border-collapse text-xs">
            <thead className="sticky top-0 z-40">
              <tr>
                <th
                  colSpan={COLUMNS.length}
                  className="sticky left-0 z-50 border border-slate-300"
                  style={{ backgroundColor: HEADER_CLARO }}
                />

                {mesesAgrupados.map((m) => (
                  <th
                    key={m.label}
                    colSpan={m.span}
                    className="border border-white/20 px-2 py-1 text-center text-white"
                    style={{ backgroundColor: AZUL, minWidth: m.span * 38 }}
                  >
                    {m.label}
                  </th>
                ))}
              </tr>

              <tr className="text-slate-700" style={{ backgroundColor: HEADER_CLARO }}>
                {COLUMNS.map((col) => {
                  const frozenIndex = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
                  const frozen = frozenIndex >= 0
                  const left = frozen ? getLeftOffset(frozenIndex) : undefined

                  return (
                    <th
                      key={col.key}
                      rowSpan={2}
                      className={`${frozen ? "sticky z-50" : ""} border border-slate-300 px-2 py-2 font-semibold`}
                      style={{
                        left,
                        minWidth: col.width,
                        width: col.width,
                        maxWidth: col.width,
                        backgroundColor: HEADER_CLARO,
                        textAlign: col.align || "left",
                      }}
                    >
                      <span className="whitespace-pre-line">{col.label}</span>
                    </th>
                  )
                })}

                {dias.map((d) => (
                  <th
                    key={`dia-${d.data}`}
                    className="min-w-[38px] border border-white/20 px-1 py-1 text-center text-white"
                    style={{ backgroundColor: AZUL }}
                  >
                    {d.dia}
                  </th>
                ))}
              </tr>

              <tr className="text-emerald-300" style={{ backgroundColor: AZUL }}>
                {dias.map((d) => {
                  const totalDia = horasDiaMap.get(`${recursoSelecionado}|${d.data}`) || 0

                  return (
                    <th key={`hora-${d.data}`} className="min-w-[38px] border border-white/20 px-1 py-1 text-center">
                      {fmt(totalDia)}
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {etapasPagina.map((etapa) => (
                <tr key={etapa.id} className="hover:bg-slate-50">
                  {COLUMNS.map((col) => {
                    const frozenIndex = FROZEN_COLUMNS.findIndex((c) => c.key === col.key)
                    const frozen = frozenIndex >= 0
                    const left = frozen ? getLeftOffset(frozenIndex) : undefined

                    return (
                      <td
                        key={col.key}
                        className={`${frozen ? "sticky z-30" : ""} border border-slate-200 bg-white px-2 py-1`}
                        style={{
                          left,
                          minWidth: col.width,
                          width: col.width,
                          maxWidth: col.width,
                          textAlign: col.align || "left",
                        }}
                      >
                        {col.render(etapa) || ""}
                      </td>
                    )
                  })}

                  {dias.map((d) => {
                    const key = `${recursoSelecionado}|${etapa.lote || ""}|${etapa.codigo_produto || ""}|${d.data}`
                    const horas = alocacaoMap.get(key) || 0

                    return (
                      <td
                        key={d.data}
                        className="border border-slate-200 px-1 py-1 text-center"
                        style={{ background: horas > 0 ? "rgba(16,185,129,0.12)" : "white" }}
                      >
                        {horas > 0 ? (
                          <span className="font-semibold text-emerald-600">{fmt(horas)}</span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-3 text-xs text-slate-600">
          <span>Página {paginaCorrigida} de {totalPaginas}</span>

          <button
            disabled={paginaCorrigida <= 1}
            onClick={() => setPagina(paginaCorrigida - 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
          >
            Anterior
          </button>

          <button
            disabled={paginaCorrigida >= totalPaginas}
            onClick={() => setPagina(paginaCorrigida + 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Nova rodada</h2>
                <p className="mt-1 text-xs text-slate-500">Criação de nova versão histórica do planejamento.</p>
              </div>

              <button onClick={() => setModalOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div>
                <label className="text-xs font-medium text-slate-500">Nome</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Mês</label>
                  <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
                    {MESES.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Ano</label>
                  <input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Versão</label>
                  <input type="number" value={versao} onChange={(e) => setVersao(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">Observação</label>
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} className="mt-1 min-h-[100px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>

              <button onClick={handleCriarRodada} className="w-full rounded-xl py-3 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: AZUL }}>
                Criar rodada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export async function copiarMrpRodada(
  rodadaId: string,
  payload?: {
    nome?: string
    mes?: number
    ano?: number
    versao?: number
    observacao?: string | null
  }
): Promise<MrpRodada> {
  return apiFetch(`/mrp/rodadas/${rodadaId}/copiar`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
    headers: {
      "Content-Type": "application/json",
    },
  })
}

export async function importarMrpProducaoReal(
  rodadaId: string,
  file: File
) {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(
    `${API_URL}/mrp/rodadas/${rodadaId}/importar-producao-real`,
    {
      method: "POST",
      body: form,
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({
      detail: res.statusText,
    }))

    throw new Error(
      (err as { detail: string }).detail ||
        "Erro ao importar produção real"
    )
  }

  return res.json()
}
