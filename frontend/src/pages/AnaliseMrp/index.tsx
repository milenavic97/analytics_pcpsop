import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  getAnaliseMrpMateriais,
  getAnaliseMrpMaterial,
  getAnaliseMrpResumo,
  type AnaliseMrpMaterial,
  type AnaliseMrpResumo,
} from "../../services/api"

type SortKey =
  | "codigo"
  | "descricao"
  | "un"
  | "saldo_base_consumo"
  | "estoque_real"
  | "media_3m"
  | "maior_media"
  | "maior_media_50"
  | "cobertura_dias"
  | "gap_consumo"
  | "demanda_mrp"
  | "forecast"
  | "status"

type SortDirection = "asc" | "desc"

function toNumber(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function fmt(value: unknown) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toNumber(value))
}

function fmtData(value?: string | null) {
  if (!value) return "—"

  const dt = new Date(value)

  if (!Number.isNaN(dt.getTime())) {
    return dt.toLocaleDateString("pt-BR")
  }

  return "—"
}

function classificar(item: AnaliseMrpMaterial) {
  const status = String(item.status || "").toUpperCase()

  if (status === "RUPTURA") {
    return {
      label: "Ruptura",
      color: "#DC2626",
      bg: "#FEF2F2",
      border: "#FECACA",
      Icon: PackageX,
    }
  }

  if (status === "CRITICO") {
    return {
      label: "Crítico",
      color: "#B91C1C",
      bg: "#FEF2F2",
      border: "#FECACA",
      Icon: ShieldAlert,
    }
  }

  if (status === "ATENCAO") {
    return {
      label: "Atenção",
      color: "#92400E",
      bg: "#FFFBEB",
      border: "#FDE68A",
      Icon: AlertTriangle,
    }
  }

  return {
    label: "Saudável",
    color: "#166534",
    bg: "#F0FDF4",
    border: "#BBF7D0",
    Icon: PackageCheck,
  }
}

function getUltimoForecast(item: AnaliseMrpMaterial) {
  const grafico = item.grafico || []
  if (!grafico.length) return null
  return grafico[grafico.length - 1]?.forecast ?? null
}

export default function AnaliseMrpPage() {
  const [loading, setLoading] = useState(true)
  const [loadingDetalhe, setLoadingDetalhe] = useState(false)

  const [dados, setDados] = useState<AnaliseMrpMaterial[]>([])
  const [materialSelecionado, setMaterialSelecionado] =
    useState<AnaliseMrpMaterial | null>(null)

  const [resumo, setResumo] =
    useState<AnaliseMrpResumo>({
      total_materiais: 0,
      ruptura: 0,
      criticos: 0,
      atencao: 0,
      saudaveis: 0,
    })

  const [busca, setBusca] = useState("")
  const [statusFiltro, setStatusFiltro] = useState("TODOS")
  const [sortKey, setSortKey] = useState<SortKey>("gap_consumo")
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("asc")

  useEffect(() => {
    carregar()
  }, [])

  async function carregar() {
    try {
      setLoading(true)

      const [materiais, resumoApi] = await Promise.all([
        getAnaliseMrpMateriais(),
        getAnaliseMrpResumo(),
      ])

      const lista = materiais || []

      setDados(lista)
      setResumo(resumoApi)

      if (lista.length > 0) {
        await selecionarMaterial(lista[0].codigo)
      } else {
        setMaterialSelecionado(null)
      }
    } catch (err) {
      console.error(err)

      setDados([])
      setMaterialSelecionado(null)

      setResumo({
        total_materiais: 0,
        ruptura: 0,
        criticos: 0,
        atencao: 0,
        saudaveis: 0,
      })
    } finally {
      setLoading(false)
    }
  }

  async function selecionarMaterial(codigo: string) {
    try {
      setLoadingDetalhe(true)

      const detalhe = await getAnaliseMrpMaterial(codigo)

      setMaterialSelecionado(detalhe)
    } catch (err) {
      console.error(err)

      const fallback = dados.find((item) => item.codigo === codigo)
      setMaterialSelecionado(fallback || null)
    } finally {
      setLoadingDetalhe(false)
    }
  }

  function alterarOrdenacao(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((atual) =>
        atual === "asc" ? "desc" : "asc"
      )
      return
    }

    setSortKey(key)
    setSortDirection("asc")
  }

  const dadosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()

    const filtrados = dados.filter((item) => {
      const status = String(item.status || "").toUpperCase()

      const statusOk =
        statusFiltro === "TODOS" || status === statusFiltro

      const textoOk =
        !termo ||
        String(item.codigo || "")
          .toLowerCase()
          .includes(termo) ||
        String(item.produto || item.descricao || "")
          .toLowerCase()
          .includes(termo) ||
        String(item.grupo_descricao || "")
          .toLowerCase()
          .includes(termo)

      return statusOk && textoOk
    })

    return [...filtrados].sort((a, b) => {
      const getValue = (item: AnaliseMrpMaterial) => {
        if (sortKey === "descricao") {
          return item.produto || item.descricao || ""
        }

        if (sortKey === "un") {
          return item.un || item.unid || ""
        }

        if (sortKey === "forecast") {
          return getUltimoForecast(item) ?? 0
        }

        return item[sortKey as keyof AnaliseMrpMaterial] ?? ""
      }

      const va = getValue(a)
      const vb = getValue(b)

      if (typeof va === "number" && typeof vb === "number") {
        return sortDirection === "asc" ? va - vb : vb - va
      }

      return sortDirection === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va))
    })
  }, [dados, busca, statusFiltro, sortKey, sortDirection])

  const dadosGrafico = materialSelecionado?.grafico || []

  return (
    <div className="min-h-screen space-y-5 p-3 md:space-y-6 md:p-6">
      <div className="fade-in flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p
            className="mb-1 text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-secondary)" }}
          >
            Planejamento · Materiais
          </p>

          <h1
            className="mb-1 text-xl font-bold md:text-2xl"
            style={{ color: "var(--text-primary)" }}
          >
            Análise MRP
          </h1>

          <p
            className="text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Comparativo entre consumo real, demanda MRP, forecast,
            estoque real, cobertura e risco de ruptura.
          </p>
        </div>

        <button
          onClick={carregar}
          disabled={loading}
          className="flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold"
          style={{
            cursor: loading ? "not-allowed" : "pointer",
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <RefreshCw
            size={14}
            className={loading ? "animate-spin" : ""}
          />

          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 fade-in">
        <SummaryCard
          label="Materiais"
          value={resumo.total_materiais}
          sub="itens analisados"
          color="#6B7280"
          Icon={PackageCheck}
        />

        <SummaryCard
          label="Ruptura atual"
          value={resumo.ruptura}
          sub="saldo zerado"
          color="#DC2626"
          Icon={PackageX}
        />

        <SummaryCard
          label="Materiais críticos"
          value={resumo.criticos}
          sub="saldo abaixo da ref."
          color="#B91C1C"
          Icon={ShieldAlert}
        />

        <SummaryCard
          label="Cobertura baixa"
          value={resumo.atencao}
          sub="< 30 dias"
          color="#F59E0B"
          Icon={AlertTriangle}
        />

        <SummaryCard
          label="Saudáveis"
          value={resumo.saudaveis}
          sub="sem alerta"
          color="#16A34A"
          Icon={PackageCheck}
        />
      </div>

      <div
        className="fade-in rounded-xl border px-4 py-2 text-xs"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        Snapshot consumo: {fmtData(resumo.data_snapshot_consumo)} ·
        Snapshot estoque: {fmtData(resumo.data_snapshot_estoque)} ·
        Snapshot MRP: {fmtData(resumo.data_snapshot_mrp)}
      </div>

      <div className="card p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="card-label mb-1">
              Saúde dos Materiais
            </p>

            <h2
              className="text-base font-bold"
              style={{
                color: "var(--text-primary)",
              }}
            >
              Consumo, estoque e planejamento MRP
            </h2>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
            <div className="relative w-full md:w-96">
              <Search
                className="absolute left-3 top-3"
                size={16}
                style={{
                  color: "var(--text-secondary)",
                }}
              />

              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por código ou material..."
                className="h-10 w-full rounded-lg border pl-10 pr-3 text-sm outline-none"
                style={{
                  background: "var(--bg-primary)",
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <select
              value={statusFiltro}
              onChange={(e) =>
                setStatusFiltro(e.target.value)
              }
              className="h-10 rounded-lg border px-3 text-sm outline-none"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="TODOS">Todos</option>
              <option value="RUPTURA">Ruptura</option>
              <option value="CRITICO">Crítico</option>
              <option value="ATENCAO">Atenção</option>
              <option value="SAUDAVEL">Saudável</option>
            </select>
          </div>
        </div>

        <div
          className="overflow-hidden rounded-2xl border"
          style={{
            borderColor: "var(--border)",
          }}
        >
          <div
            className="overflow-auto"
            style={{ maxHeight: "64vh" }}
          >
            <table
              className="w-full border-separate border-spacing-0"
              style={{ minWidth: 1650 }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}
              >
                <tr
                  style={{
                    background: "var(--bg-sidebar)",
                  }}
                >
                  <Th label="Código" sortKey="codigo" onSort={alterarOrdenacao} />
                  <Th label="Material" sortKey="descricao" onSort={alterarOrdenacao} />
                  <Th label="UN" sortKey="un" onSort={alterarOrdenacao} />
                  <Th label="Saldo Consumo" sortKey="saldo_base_consumo" onSort={alterarOrdenacao} align="right" />
                  <Th label="Estoque Real" sortKey="estoque_real" onSort={alterarOrdenacao} align="right" />
                  <Th label="Demanda MRP" sortKey="demanda_mrp" onSort={alterarOrdenacao} align="right" />
                  <Th label="Forecast" sortKey="forecast" onSort={alterarOrdenacao} align="right" />
                  <Th label="Média 3M" sortKey="media_3m" onSort={alterarOrdenacao} align="right" />
                  <Th label="Maior Média" sortKey="maior_media" onSort={alterarOrdenacao} align="right" />
                  <Th label="Maior Média +50%" sortKey="maior_media_50" onSort={alterarOrdenacao} align="right" />
                  <Th label="Cobertura" sortKey="cobertura_dias" onSort={alterarOrdenacao} align="right" />
                  <Th label="Gap" sortKey="gap_consumo" onSort={alterarOrdenacao} align="right" />
                  <Th label="Status" sortKey="status" onSort={alterarOrdenacao} />

                  <th
                    className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    Causa Provável
                  </th>
                </tr>
              </thead>

              <tbody
                style={{
                  background: "var(--bg-secondary)",
                }}
              >
                {loading ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="py-10 text-center text-sm"
                      style={{
                        color: "var(--text-secondary)",
                      }}
                    >
                      <RefreshCw
                        size={22}
                        className="mx-auto mb-3 animate-spin"
                        style={{ opacity: 0.45 }}
                      />

                      Carregando análise...
                    </td>
                  </tr>
                ) : dadosFiltrados.length === 0 ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="py-10 text-center text-sm"
                      style={{
                        color: "var(--text-secondary)",
                      }}
                    >
                      Nenhum dado encontrado.
                    </td>
                  </tr>
                ) : (
                  dadosFiltrados.map((item) => {
                    const status = classificar(item)
                    const Icon = status.Icon
                    const gap = toNumber(item.gap_consumo)
                    const selecionado =
                      materialSelecionado?.codigo === item.codigo

                    return (
                      <tr
                        key={`${item.codigo}-${item.produto}`}
                        onClick={() => selecionarMaterial(item.codigo)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        style={{
                          background: selecionado
                            ? "rgba(59,130,246,0.08)"
                            : undefined,
                        }}
                      >
                        <Td className="font-mono font-semibold">
                          {item.codigo}
                        </Td>

                        <Td>
                          <span
                            className="block max-w-[520px] truncate font-medium"
                            style={{
                              color: "var(--text-primary)",
                            }}
                            title={
                              item.produto ||
                              item.descricao ||
                              ""
                            }
                          >
                            {item.produto ||
                              item.descricao ||
                              "—"}
                          </span>
                        </Td>

                        <Td>
                          {item.un || item.unid || "—"}
                        </Td>

                        <Td align="right">
                          {fmt(item.saldo_base_consumo)}
                        </Td>

                        <Td align="right" style={{ fontWeight: 700 }}>
                          {fmt(item.estoque_real)}
                        </Td>

                        <Td align="right">
                          {fmt(item.demanda_mrp)}
                        </Td>

                        <Td align="right">
                          {fmt(getUltimoForecast(item))}
                        </Td>

                        <Td align="right">
                          {fmt(item.media_3m)}
                        </Td>

                        <Td align="right">
                          {fmt(item.maior_media)}
                        </Td>

                        <Td align="right">
                          {fmt(item.maior_media_50)}
                        </Td>

                        <Td align="right">
                          {toNumber(item.cobertura_dias).toFixed(0)} dias
                        </Td>

                        <Td
                          align="right"
                          style={{
                            color:
                              gap < 0
                                ? "#DC2626"
                                : "var(--text-primary)",
                            fontWeight: gap < 0 ? 700 : 500,
                          }}
                        >
                          {fmt(gap)}
                        </Td>

                        <Td>
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                            style={{
                              background: status.bg,
                              border: `1px solid ${status.border}`,
                              color: status.color,
                            }}
                          >
                            <Icon size={12} />
                            {status.label}
                          </span>
                        </Td>

                        <Td>
                          <span
                            className="text-xs"
                            style={{
                              color: "var(--text-secondary)",
                            }}
                          >
                            {item.causa_provavel || "—"}
                          </span>
                        </Td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card p-4 md:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="card-label mb-1">
              Detalhe do Material
            </p>

            <h2
              className="text-base font-bold"
              style={{
                color: "var(--text-primary)",
              }}
            >
              Demanda MRP x Consumido x Forecast
            </h2>
          </div>

          {loadingDetalhe && (
            <RefreshCw
              size={16}
              className="animate-spin"
              style={{ color: "var(--text-secondary)" }}
            />
          )}
        </div>

        {!materialSelecionado ? (
          <div
            className="flex h-[420px] items-center justify-center rounded-2xl border text-sm"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            Selecione um material na tabela.
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className="rounded-2xl border p-4"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-secondary)",
              }}
            >
              <p
                className="font-mono text-xs font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                {materialSelecionado.codigo}
              </p>

              <p
                className="mt-1 text-sm font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {materialSelecionado.produto ||
                  materialSelecionado.descricao ||
                  "—"}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                <MiniInfo
                  label="UN"
                  value={
                    materialSelecionado.un ||
                    materialSelecionado.unid ||
                    "—"
                  }
                />
                <MiniInfo
                  label="Estoque"
                  value={fmt(materialSelecionado.estoque_real)}
                />
                <MiniInfo
                  label="Saldo Consumo"
                  value={fmt(materialSelecionado.saldo_base_consumo)}
                />
                <MiniInfo
                  label="Demanda MRP"
                  value={fmt(materialSelecionado.demanda_mrp)}
                />
                <MiniInfo
                  label="Forecast"
                  value={fmt(getUltimoForecast(materialSelecionado))}
                />
                <MiniInfo
                  label="Necessidade"
                  value={fmt(materialSelecionado.necessidade_mrp)}
                />
                <MiniInfo
                  label="Pedidos"
                  value={fmt(materialSelecionado.pedidos_mrp)}
                />
                <MiniInfo
                  label="Cobertura"
                  value={`${toNumber(
                    materialSelecionado.cobertura_dias
                  ).toFixed(0)} dias`}
                />
              </div>
            </div>

            <div
              className="h-[430px] rounded-2xl border p-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-secondary)",
              }}
            >
              {dadosGrafico.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="mes_label"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => fmt(value)}
                    />
                    <Tooltip
                      formatter={(value) => fmt(value)}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="consumo_real"
                      name="Consumido"
                      stroke="#2563EB"
                      strokeWidth={2}
                      dot
                    />
                    <Line
                      type="monotone"
                      dataKey="demanda_mrp"
                      name="Demanda MRP"
                      stroke="#DC2626"
                      strokeWidth={2}
                      dot
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      name="Forecast"
                      stroke="#16A34A"
                      strokeWidth={2}
                      dot
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div
                  className="flex h-full items-center justify-center text-center text-sm"
                  style={{
                    color: "var(--text-secondary)",
                  }}
                >
                  Sem histórico de gráfico para este material.
                  <br />
                  O front está pronto, mas o backend precisa devolver o campo
                  grafico preenchido.
                </div>
              )}
            </div>

            <div
              className="rounded-xl border px-4 py-2 text-xs"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              Consumo:{" "}
              {fmtData(materialSelecionado.data_snapshot_consumo)} ·
              Estoque:{" "}
              {fmtData(materialSelecionado.data_snapshot_estoque)} ·
              MRP: {fmtData(materialSelecionado.data_snapshot_mrp)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
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
  sub?: string
  color: string
  Icon: React.ElementType
}) {
  return (
    <div className="card flex flex-col gap-3 p-4 text-left w-full">
      <div className="flex items-start justify-between gap-2">
        <span className="card-label leading-5">
          {label}
        </span>

        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: color + "18",
          }}
        >
          <Icon size={17} style={{ color }} />
        </div>
      </div>

      <div>
        <p
          className="text-2xl font-bold"
          style={{ color }}
        >
          {value}
        </p>

        {sub && (
          <p
            className="mt-0.5 text-xs"
            style={{
              color: "var(--text-secondary)",
            }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

function MiniInfo({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div
      className="rounded-xl border px-3 py-2"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-primary)",
      }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </p>

      <p
        className="mt-1 text-sm font-bold"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  )
}

function Th({
  label,
  sortKey,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  onSort: (key: SortKey) => void
  align?: "left" | "right" | "center"
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none"
      style={{
        color: "rgba(255,255,255,0.85)",
        textAlign: align,
      }}
      title="Clique para ordenar"
    >
      {label}
    </th>
  )
}

function Td({
  children,
  className = "",
  align = "left",
  style = {},
}: {
  children: React.ReactNode
  className?: string
  align?: "left" | "right" | "center"
  style?: React.CSSProperties
}) {
  return (
    <td
      className={`border-b px-3 py-2.5 text-sm ${className}`}
      style={{
        borderColor: "#E2E8F0",
        color: "var(--text-primary)",
        textAlign: align,
        ...style,
      }}
    >
      {children}
    </td>
  )
}
