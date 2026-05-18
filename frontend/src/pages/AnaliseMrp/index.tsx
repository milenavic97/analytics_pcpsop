import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react"

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
  data_snapshot?: string
  created_at?: string
}

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

function fmtData(value?: string) {
  if (!value) return "—"

  const dt = new Date(value)
  if (!Number.isNaN(dt.getTime())) {
    return dt.toLocaleDateString("pt-BR")
  }

  return "—"
}

function classificar(item: ConsumoMaterial) {
  const saldo = toNumber(item.saldo)
  const ref = toNumber(item.maior_media_50)
  const cobertura = toNumber(item.cobertura_dias)

  if (saldo <= 0) {
    return {
      label: "Ruptura",
      color: "#DC2626",
      bg: "#FEF2F2",
      border: "#FECACA",
      Icon: PackageX,
    }
  }

  if (ref > 0 && saldo <= ref) {
    return {
      label: "Crítico",
      color: "#B91C1C",
      bg: "#FEF2F2",
      border: "#FECACA",
      Icon: ShieldAlert,
    }
  }

  if (cobertura > 0 && cobertura < 30) {
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

      const res = (await getDados("consumo_materiais", 1, 1000)) as {
        data: ConsumoMaterial[]
        total: number
        page: number
        per_page: number
      }

      setDados(res.data || [])
    } catch (err) {
      console.error(err)
      setDados([])
    } finally {
      setLoading(false)
    }
  }

  const dadosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return dados

    return dados.filter((item) => {
      return (
        String(item.codigo || "").toLowerCase().includes(termo) ||
        String(item.produto || "").toLowerCase().includes(termo)
      )
    })
  }, [dados, busca])

  const resumo = useMemo(() => {
    const ruptura = dados.filter((d) => toNumber(d.saldo) <= 0).length

    const criticos = dados.filter((d) => {
      const saldo = toNumber(d.saldo)
      const ref = toNumber(d.maior_media_50)
      return saldo > 0 && ref > 0 && saldo <= ref
    }).length

    const coberturaBaixa = dados.filter((d) => {
      const cobertura = toNumber(d.cobertura_dias)
      return cobertura > 0 && cobertura < 30
    }).length

    return {
      total: dados.length,
      ruptura,
      criticos,
      coberturaBaixa,
      snapshot: dados[0]?.data_snapshot || dados[0]?.created_at,
    }
  }, [dados])

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
            Comparativo entre saldo, consumo histórico, cobertura e risco de ruptura.
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
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 fade-in">
        <SummaryCard
          label="Materiais"
          value={resumo.total}
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
          value={resumo.coberturaBaixa}
          sub="< 30 dias"
          color="#F59E0B"
          Icon={AlertTriangle}
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
        Snapshot da base de consumo: {fmtData(resumo.snapshot)}. Nesta primeira versão,
        o risco é calculado com base no saldo da base de consumo e na referência de maior média +50%.
      </div>

      <div className="card p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="card-label mb-1">Saúde dos Materiais</p>

            <h2
              className="text-base font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Consumo histórico x saldo
            </h2>
          </div>

          <div className="relative w-full max-w-md">
            <Search
              className="absolute left-3 top-3"
              size={16}
              style={{ color: "var(--text-secondary)" }}
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
        </div>

        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)" }}>
          <div className="overflow-auto" style={{ maxHeight: "64vh" }}>
            <table className="w-full border-separate border-spacing-0" style={{ minWidth: 980 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr style={{ background: "var(--bg-sidebar)" }}>
                  {[
                    "Código",
                    "Material",
                    "Saldo",
                    "Média 3M",
                    "Maior média",
                    "Maior média +50%",
                    "Cobertura",
                    "Gap",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                      style={{ color: "rgba(255,255,255,0.85)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody style={{ background: "var(--bg-secondary)" }}>
                {loading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-10 text-center text-sm"
                      style={{ color: "var(--text-secondary)" }}
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
                      colSpan={9}
                      className="py-10 text-center text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Nenhum dado encontrado.
                    </td>
                  </tr>
                ) : (
                  dadosFiltrados.map((item) => {
                    const status = classificar(item)
                    const Icon = status.Icon
                    const gap = toNumber(item.saldo_menos_maior_media_50)

                    return (
                      <tr
                        key={item.id}
                        className="transition-colors hover:bg-slate-50"
                      >
                        <Td className="font-mono font-semibold">
                          {item.codigo}
                        </Td>

                        <Td>
                          <span
                            className="block max-w-[420px] truncate font-medium"
                            style={{ color: "var(--text-primary)" }}
                            title={item.produto}
                          >
                            {item.produto}
                          </span>
                        </Td>

                        <Td align="right">{fmt(item.saldo)}</Td>
                        <Td align="right">{fmt(item.media_3m)}</Td>
                        <Td align="right">{fmt(item.maior_media)}</Td>
                        <Td align="right">{fmt(item.maior_media_50)}</Td>

                        <Td align="right">
                          {toNumber(item.cobertura_dias).toFixed(0)} dias
                        </Td>

                        <Td
                          align="right"
                          style={{
                            color: gap < 0 ? "#DC2626" : "var(--text-primary)",
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
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
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
        <span className="card-label leading-5">{label}</span>

        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: color + "18" }}
        >
          <Icon size={17} style={{ color }} />
        </div>
      </div>

      <div>
        <p className="text-2xl font-bold" style={{ color }}>
          {value}
        </p>

        {sub && (
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
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
