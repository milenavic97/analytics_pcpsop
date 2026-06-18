import { useEffect, useState, useMemo } from "react";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  Waves,
  Droplets,
  TrendingDown,
  X,
  Download,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { clearApiCache, getRastreamentoLotes } from "@/services/api";

interface DesvioInfo {
  serial?: string | null;
  titulo?: string | null;
  title?: string | null;
  motivo?: string | null;
  estado?: string | null;
  dias_desvio?: number | null;
  setor?: string | null;
  destino?: string | null;
  desvio_destino?: string | null;
  destino_produto_insumo?: string | null;
}

interface LoteRastreamento {
  lote: string;
  grupo: string;
  qtd_prevista_tb: number;
  qtd_prevista_cx: number;
  qtd_produzida_tb: number;
  qtd_produzida_cx: number;
  qtd_liberada_cx: number;
  qtd_perda_rendimento_cx?: number;
  considerar_previsto_ate_hoje?: boolean;
  sku_pa: string | null;
  data_lib: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  check_lavagem: boolean;
  check_envase: boolean;
  check_embalagem: boolean;
  check_liberado: boolean;
  atrasado: boolean;
  equipamento_atual: string | null;
  ordem_op: string | null;
  em_desvio?: boolean;
  desvio_serial?: string | null;
  desvio_titulo?: string | null;
  desvio_estado?: string | null;
  desvio_dias?: number | null;
  desvio_setor?: string | null;
  desvio_destino?: string | null;
  desvio_destino_consolidado?: string | null;
  destino?: string | null;
  destino_produto_insumo?: string | null;
  desvio_destino_produto_insumo?: string | null;
  qtd_desvios?: number | null;
  desvios?: DesvioInfo[] | null;
  desvio_reprovacao?: boolean;
  reprogramado?: boolean;
  atraso_producao?: boolean;
  perda_rendimento?: boolean;
  status_gap?: string | null;
  motivo_gap?: string | null;
  data_lib_atual?: string | null;
  mes_previsto_atual?: number | null;
  ano_previsto_atual?: number | null;
}

interface ResumoLiberacao {
  previsto_ate_hoje: number;
  liberado_vinculado_lotes_previstos: number;
  liberado_sd3_mtd_total: number;
  liberado_sd3_fora_gantt_mes_atual: number;
  gap_teorico_previsto_menos_vinculado: number;
  pendente_localizado_rastreamento: number;
  residuo_nao_localizado: number;
}

interface LoteForaGantt {
  lote: string;
  produto?: string | null;
  descr_prod?: string | null;
  grupo?: string | null;
  qtd_cx: number;
  qtd_prevista_cx?: number;
  dt_emissao?: string | null;
  data_lib_prevista?: string | null;
  data_inicio_prevista?: string | null;
  data_fim_prevista?: string | null;
  linha_prevista?: string | null;
  mes_previsto?: number | null;
  ano_previsto?: number | null;
  grupo_previsto?: string | null;
  motivo?: string | null;
}

interface UltimaAtualizacaoResponse {
  base_id: string;
  ultima_atualizacao: string | null;
}

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL || "https://dfl-sop-api.fly.dev";

const BASE_APONTAMENTO_PRODUCAO = "apontamentos";

async function buscarUltimaAtualizacaoProducaoNoCache(): Promise<string | null> {
  const url = `${API_URL}/upload/ultima-atualizacao/${BASE_APONTAMENTO_PRODUCAO}?_t=${Date.now()}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });

  if (!res.ok) return null;

  const payload = (await res.json().catch(() => null)) as UltimaAtualizacaoResponse | null;

  return payload?.ultima_atualizacao || null;
}

interface RastreamentoCacheEntry {
  createdAt: number;
  apontamentoAtualizadoEm: string | null;
  data: RastreamentoData;
}

interface RastreamentoData {
  mes: number;
  ano: number;
  total_lotes: number;
  total_lotes_mtd: number;
  total_lotes_futuros?: number;
  total_lotes_fora_gantt?: number;
  total_lotes_desvio?: number;
  mes_cx_previsto_v1?: number;
  mes_cx_planejado_v1?: number;
  mes_cx_realizado?: number;
  mes_cx_plano_atual_puro?: number;
  mes_cx_plano_atual_tendencia?: number;
  mes_cx_diferenca_vs_v1?: number;
  mes_cx_saldo_tendencia?: number;
  mes_gap_por_etapa?: {
    desvio?: number;
    reprovacao_desvio?: number;
    desvio_aberto?: number;
    atraso_producao?: number;
    rendimento?: number;
    embalagem?: number;
    envase?: number;
    lavagem?: number;
    nao_iniciado?: number;
  };
  total_cx_previsto: number;
  total_cx_liberado: number;
  total_cx_gap?: number;
  total_cx_sd3_mes?: number;
  total_cx_fora_gantt?: number;
  total_cx_desvio?: number;
  mtd_cx_previsto: number;
  mtd_cx_liberado: number;
  mtd_cx_gap: number;
  mtd_cx_desvio?: number;
  mtd_gap_por_etapa: {
    desvio?: number;
    reprovacao_desvio?: number;
    desvio_aberto?: number;
    atraso_producao?: number;
    rendimento?: number;
    embalagem: number;
    envase: number;
    lavagem: number;
    nao_iniciado: number;
  };
  mtd_resumo_liberacao?: ResumoLiberacao;
  lotes_fora_gantt?: LoteForaGantt[];
  lotes: LoteRastreamento[];
}

function fmt(n?: number | null) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function fmtPercent(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "0,0";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(n));
}

function fmtData(iso?: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

function formatarDataHoraAtualizacao(value?: string | null) {
  if (!value) return null;

  const data = new Date(value);

  if (Number.isNaN(data.getTime())) return null;

  const dataFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);

  const horaFmt = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);

  return `${dataFmt} às ${horaFmt}`;
}

function Check({
  ok,
  label,
  icon: Icon,
}: {
  ok: boolean;
  label: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        style={{
          background: ok ? "#F0FDF4" : "#F9FAFB",
          border: `2px solid ${ok ? "#16A34A" : "#E5E7EB"}`,
        }}
      >
        <Icon size={13} style={{ color: ok ? "#16A34A" : "#D1D5DB" }} />
      </div>

      <span
        className="text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: ok ? "#16A34A" : "#9CA3AF" }}
      >
        {label}
      </span>
    </div>
  );
}

function Connector({ ok }: { ok: boolean }) {
  return (
    <div
      className="mx-1 mt-3.5 h-0.5 flex-1"
      style={{
        background: ok ? "#16A34A" : "#E5E7EB",
        minWidth: 12,
      }}
    />
  );
}

function getListaDesvios(lote: LoteRastreamento): DesvioInfo[] {
  if (Array.isArray(lote.desvios) && lote.desvios.length > 0) {
    return lote.desvios;
  }

  if (!lote.em_desvio) return [];

  return [
    {
      serial: lote.desvio_serial,
      titulo: lote.desvio_titulo,
      estado: lote.desvio_estado,
      dias_desvio: lote.desvio_dias,
      setor: lote.desvio_setor,
      destino: lote.desvio_destino,
    },
  ];
}

function getTituloDesvioItem(desvio: DesvioInfo) {
  return (
    desvio.titulo ||
    desvio.title ||
    desvio.motivo ||
    null
  );
}

function getDestinoDesvioItem(desvio: DesvioInfo) {
  return (
    desvio.desvio_destino ||
    desvio.destino_produto_insumo ||
    desvio.destino ||
    null
  );
}

function normalizarTextoDesvio(value?: string | null) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function dividirDestinos(value?: string | null) {
  const texto = String(value || "").trim();
  if (!texto) return [] as string[];

  return texto
    .split(/\s+\/\s+/g)
    .map((parte) => parte.trim())
    .filter(Boolean);
}

function isDestinoReprovado(value?: string | null) {
  const texto = normalizarTextoDesvio(value);
  return (
    texto.includes("REPROV") ||
    texto.includes("DESCARTE") ||
    texto.includes("DESCART") ||
    texto.includes("REJEIT")
  );
}

function isDestinoPendente(value?: string | null) {
  const texto = normalizarTextoDesvio(value);
  return (
    texto.includes("ANALISE") ||
    texto.includes("PENDENTE") ||
    texto.includes("ABERTO") ||
    texto.includes("AGUARD")
  );
}

function isDestinoAprovado(value?: string | null) {
  const texto = normalizarTextoDesvio(value);
  return texto.includes("APROV");
}

function escolherDestinoConsolidado(destinos: Array<string | null | undefined>) {
  const partes = destinos
    .flatMap((destino) => dividirDestinos(destino))
    .filter(Boolean);

  if (partes.length === 0) return null;

  const reprovado = partes.find(isDestinoReprovado);
  if (reprovado) return reprovado;

  const pendente = partes.find(isDestinoPendente);
  if (pendente) return pendente;

  const aprovado = partes.find(isDestinoAprovado);
  if (aprovado) return aprovado;

  return partes[0];
}

function getDesvioTitulo(lote: LoteRastreamento) {
  const desvios = getListaDesvios(lote);
  const primeiro = desvios[0];

  if (primeiro) {
    return getTituloDesvioItem(primeiro);
  }

  const item = lote as LoteRastreamento & {
    titulo?: string | null;
    title?: string | null;
    motivo?: string | null;
    desvio_title?: string | null;
    desvio_motivo?: string | null;
  };

  return (
    item.desvio_titulo ||
    item.desvio_motivo ||
    item.desvio_title ||
    item.titulo ||
    item.title ||
    item.motivo ||
    null
  );
}

function getDesvioTooltip(lote: LoteRastreamento) {
  const desvios = getListaDesvios(lote);

  if (desvios.length > 1) {
    const linhas = [`${desvios.length} desvios vinculados ao lote ${lote.lote}:`];

    desvios.forEach((d, index) => {
      const titulo = getTituloDesvioItem(d);
      const destino = getDestinoDesvioItem(d);

      linhas.push("");
      linhas.push(`${index + 1}. ${d.serial || "Sem serial"}`);

      if (titulo) linhas.push(`Motivo/Título: ${titulo}`);
      if (d.estado) linhas.push(`Estado: ${d.estado}`);
      if (d.dias_desvio != null) linhas.push(`Dias de desvio: ${fmt(d.dias_desvio)}`);
      if (d.setor) linhas.push(`Setor: ${d.setor}`);
      if (destino) linhas.push(`Destino: ${destino}`);
    });

    return linhas.join("\n");
  }

  const primeiro = desvios[0];
  const titulo = primeiro ? getTituloDesvioItem(primeiro) : getDesvioTitulo(lote);
  const destino = primeiro ? getDestinoDesvioItem(primeiro) : getDesvioDestino(lote);

  const linhas = [
    titulo ? `Motivo/Título: ${titulo}` : null,
    primeiro?.serial || lote.desvio_serial ? `Serial: ${primeiro?.serial || lote.desvio_serial}` : null,
    primeiro?.estado || lote.desvio_estado ? `Estado: ${primeiro?.estado || lote.desvio_estado}` : null,
    primeiro?.dias_desvio != null || lote.desvio_dias != null
      ? `Dias de desvio: ${fmt(primeiro?.dias_desvio ?? lote.desvio_dias)}`
      : null,
    primeiro?.setor || lote.desvio_setor ? `Setor: ${primeiro?.setor || lote.desvio_setor}` : null,
    destino ? `Destino: ${destino}` : null,
  ].filter(Boolean);

  return linhas.length ? linhas.join("\n") : "Lote em desvio";
}

function getDesvioDestino(lote: LoteRastreamento) {
  const item = lote as LoteRastreamento & {
    desvio_destino_consolidado?: string | null;
    destino?: string | null;
    destino_produto_insumo?: string | null;
    desvio_destino_produto_insumo?: string | null;
  };

  // Primeiro usa o campo consolidado do backend, quando existir.
  // Mesmo assim passa pela função de prioridade para evitar exibir textos mistos
  // como "Aprovado / Reprovado".
  const destinoConsolidadoBackend = escolherDestinoConsolidado([
    item.desvio_destino_consolidado,
  ]);
  if (destinoConsolidadoBackend) return destinoConsolidadoBackend;

  // Para o status visual do lote, escolhe o pior destino entre todos os desvios.
  // O tooltip continua usando a lista completa em lote.desvios.
  const desvios = getListaDesvios(lote);

  if (desvios.length > 0) {
    const destinoConsolidadoLista = escolherDestinoConsolidado(
      desvios.map((d) => getDestinoDesvioItem(d)),
    );

    if (destinoConsolidadoLista) return destinoConsolidadoLista;
  }

  return escolherDestinoConsolidado([
    item.desvio_destino,
    item.desvio_destino_produto_insumo,
    item.destino_produto_insumo,
    item.destino,
  ]);
}


function DesvioBadge({ lote }: { lote: LoteRastreamento }) {
  if (!lote.em_desvio) return null;

  const desvios = getListaDesvios(lote);
  const qtdDesvios = lote.qtd_desvios || desvios.length || 1;
  const titulo = getDesvioTitulo(lote);
  const tooltip = getDesvioTooltip(lote);

  const seriais = desvios
    .map((d) => d.serial)
    .filter(Boolean) as string[];

  const seriaisTexto = Array.from(new Set(seriais)).join(", ");

  const detalhe =
    qtdDesvios > 1
      ? `${qtdDesvios} desvios${seriaisTexto ? `: ${seriaisTexto}` : ""}`
      : [
          lote.desvio_serial ? `Serial ${lote.desvio_serial}` : null,
          lote.desvio_estado || null,
          lote.desvio_dias != null ? `${fmt(lote.desvio_dias)} dias` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const tituloCurto =
    qtdDesvios > 1
      ? null
      : titulo && titulo.length > 70
        ? `${titulo.slice(0, 70)}...`
        : titulo;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        title={tooltip}
        style={{
          background: qtdDesvios > 1 ? "#DBEAFE" : "#FEF3C7",
          color: qtdDesvios > 1 ? "#1D4ED8" : "#92400E",
          border: `1px solid ${qtdDesvios > 1 ? "#BFDBFE" : "#FDE68A"}`,
        }}
      >
        <AlertTriangle size={10} />
        {qtdDesvios > 1 ? `${qtdDesvios} desvios` : "Em desvio"}
      </span>

      {detalhe && (
        <span
          className="text-[10px]"
          title={tooltip}
          style={{ color: "var(--text-secondary)" }}
        >
          {detalhe}
        </span>
      )}

      {tituloCurto && (
        <span
          className="text-[10px]"
          title={tooltip}
          style={{ color: "#92400E" }}
        >
          {tituloCurto}
        </span>
      )}
    </div>
  );
}

const MES_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];


const RASTREAMENTO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function getRastreamentoCacheKey(mes: number, ano: number) {
  return `rastreamento-lotes:${ano}-${String(mes).padStart(2, "0")}`;
}

function lerRastreamentoCache(mes: number, ano: number): RastreamentoCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(getRastreamentoCacheKey(mes, ano));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const createdAt = Number(parsed?.createdAt || 0);
    const isValid = createdAt > 0 && Date.now() - createdAt <= RASTREAMENTO_CACHE_TTL_MS;

    if (!isValid || !parsed?.data) {
      window.localStorage.removeItem(getRastreamentoCacheKey(mes, ano));
      return null;
    }

    return {
      createdAt,
      apontamentoAtualizadoEm: parsed?.apontamentoAtualizadoEm || null,
      data: parsed.data as RastreamentoData,
    };
  } catch (_) {
    return null;
  }
}

function salvarRastreamentoCache(
  mes: number,
  ano: number,
  data: RastreamentoData,
  apontamentoAtualizadoEm: string | null
) {
  try {
    window.localStorage.setItem(
      getRastreamentoCacheKey(mes, ano),
      JSON.stringify({
        createdAt: Date.now(),
        apontamentoAtualizadoEm,
        data,
      })
    );
  } catch (_) {
    // localStorage pode estar indisponível em modo privado; nesse caso só ignora.
  }
}

function limparRastreamentoCache(mes: number, ano: number) {
  try {
    window.localStorage.removeItem(getRastreamentoCacheKey(mes, ano));
  } catch (_) {
    // noop
  }
}

export function RastreamentoLotes({ onMtdLoad }: { onMtdLoad?: (mtd_cx_previsto: number, mtd_cx_liberado: number) => void } = {}) {
  const [data, setData] = useState<RastreamentoData | null>(null);
  const [ultimaAtualizacaoProducao, setUltimaAtualizacaoProducao] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [filtroEmbalado, setFiltroEmbalado] = useState("");
  const [filtroVisaoPlano, setFiltroVisaoPlano] = useState("");
  const [apenasAtrasados, setApenasAtrasados] = useState(false);
  const [modalAuditoria, setModalAuditoria] = useState(false);
  const [retemPorLote, setRetemPorLote] = useState(0.7);
  const [sortRendimento, setSortRendimento] = useState<"asc" | "desc" | null>(null);
  const [sortDataLib, setSortDataLib] = useState<"asc" | "desc" | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const hojeBase = new Date();
  const [mesSelecionado, setMesSelecionado] = useState(hojeBase.getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState(hojeBase.getFullYear());

  const buscarAtualizacaoProducao = async () => {
    try {
      // Importante: esta checagem não pode usar o cache global de 12h do api.ts.
      // Ela é o gatilho que faz outras pessoas receberem a base nova quando você sobe apontamento.
      return await buscarUltimaAtualizacaoProducaoNoCache();
    } catch (_) {
      return null;
    }
  };

  const carregar = async (
    forceRefresh = false,
    manterTabelaDuranteRefresh = false,
    apontamentoAtualizadoEmRef?: string | null
  ) => {
    // Fluxo normal: usa cache local de 12h para voltar de outra página sem recarregar.
    // Mas antes/assim que possível valida a versão da base de produção no backend.
    // Se você subir uma base nova, qualquer usuário detecta a nova atualização e recarrega sozinho.
    if (!forceRefresh) {
      const cached = lerRastreamentoCache(mesSelecionado, anoSelecionado);
      if (cached) {
        setData(cached.data);
        setUltimaAtualizacaoProducao(cached.apontamentoAtualizadoEm || null);
        setLoading(false);
        setRefreshing(false);
        if (onMtdLoad) {
          onMtdLoad(cached.data.mtd_cx_previsto ?? 0, cached.data.mtd_cx_liberado ?? 0);
        }

        // Checagem leve em segundo plano: só consulta a data da última base.
        // Se mudou, força recarga e grava o cache novo para as próximas entradas.
        buscarAtualizacaoProducao().then((ultimaServidor) => {
          if (ultimaServidor && ultimaServidor !== cached.apontamentoAtualizadoEm) {
            carregar(true, true, ultimaServidor);
          }
        });

        return;
      }
    }

    if (manterTabelaDuranteRefresh || data) {
      setRefreshing(true);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      if (forceRefresh) {
        limparRastreamentoCache(mesSelecionado, anoSelecionado);
        clearApiCache("/overview/rastreamento-lotes");
      }

      const params: any = {
        mes: mesSelecionado,
        ano: anoSelecionado,
      };

      if (forceRefresh) {
        params.force_refresh = true;
        params._t = Date.now();
      }

      const [json, atualizacaoServidor] = await Promise.all([
        getRastreamentoLotes(params) as Promise<RastreamentoData>,
        apontamentoAtualizadoEmRef !== undefined
          ? Promise.resolve(apontamentoAtualizadoEmRef)
          : buscarAtualizacaoProducao(),
      ]);

      setData(json);
      setUltimaAtualizacaoProducao(atualizacaoServidor || null);
      salvarRastreamentoCache(mesSelecionado, anoSelecionado, json, atualizacaoServidor || null);
      if (onMtdLoad) {
        onMtdLoad(json.mtd_cx_previsto ?? 0, json.mtd_cx_liberado ?? 0);
      }
    } catch (_) {
      // Se for atualização automática/manual, preserva a tabela antiga para não sumir tudo.
      if (!manterTabelaDuranteRefresh && !data) {
        setData(null);
        setUltimaAtualizacaoProducao(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const verificarBaseNovaEAtualizar = async () => {
    const ultimaServidor = await buscarAtualizacaoProducao();
    if (!ultimaServidor) return;

    setUltimaAtualizacaoProducao(ultimaServidor);

    const cached = lerRastreamentoCache(mesSelecionado, anoSelecionado);
    const ultimaLocal = cached?.apontamentoAtualizadoEm || ultimaAtualizacaoProducao;

    if (ultimaLocal && ultimaServidor === ultimaLocal) return;

    await carregar(true, true, ultimaServidor);
  };

  useEffect(() => {
    setSelecionados(new Set());
    carregar(false, false);
  }, [mesSelecionado, anoSelecionado]);

  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        verificarBaseNovaEAtualizar();
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        verificarBaseNovaEAtualizar();
      }
    }, 30000);

    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [mesSelecionado, anoSelecionado, ultimaAtualizacaoProducao]);

  const mesLabel = data ? MES_LABELS[(data.mes ?? 1) - 1] : "";

  const grupos = [
    ...new Set((data?.lotes ?? []).map((l) => l.grupo).filter(Boolean)),
  ].sort();

  const hoje = new Date().toISOString().split("T")[0];

  function statusPrincipalLote(l: LoteRastreamento) {
    // Status/causa principal do lote.
    // A ordem evita que um lote reprovado ou reprogramado apareça também como "em envase"
    // só porque já teve apontamento de envase.
    if (l.desvio_reprovacao) return "REPROVACAO_DESVIO";
    if (l.em_desvio) return "DESVIO";
    if (l.atraso_producao) return "ATRASO_PRODUCAO";
    if (l.perda_rendimento) return "RENDIMENTO";
    if (l.check_liberado) return "LIBERADO";
    if (l.check_embalagem) return "EMBALAGEM";
    if (l.check_envase) return "ENVASE";
    if (l.check_lavagem) return "LAVAGEM";
    return "NAO_INICIADO";
  }

  const lotesFiltradosBase = (data?.lotes ?? []).filter((l) => {
    if (apenasAtrasados && !l.considerar_previsto_ate_hoje) return false;
    if (filtroGrupo && l.grupo !== filtroGrupo) return false;

    if (filtroVisaoPlano === "REPROGRAMADOS" && !(l.reprogramado || l.atraso_producao)) return false;
    if (filtroVisaoPlano === "MANTIDOS" && (l.reprogramado || l.atraso_producao)) return false;

    if (filtroEmbalado === "SIM" && !l.check_embalagem) return false;
    if (filtroEmbalado === "NAO" && l.check_embalagem) return false;

    if (filtroEtapa === "ATRASADO" && (!l.atrasado || l.check_liberado)) return false;
    if (filtroEtapa && filtroEtapa !== "ATRASADO" && statusPrincipalLote(l) !== filtroEtapa) return false;

    return true;
  });

  const gapPorStatusTela = useMemo(() => {
    const etapa = (data?.mes_gap_por_etapa ?? data?.mtd_gap_por_etapa ?? {}) as Partial<RastreamentoData["mtd_gap_por_etapa"]>;

    const totais = {
      reprovacao_desvio: Math.round(Number(etapa.reprovacao_desvio ?? 0)),
      desvio_aberto: Math.round(Number(etapa.desvio_aberto ?? 0)),
      atraso_producao: Math.round(Number(etapa.atraso_producao ?? 0)),
      rendimento: Math.round(Number(etapa.rendimento ?? 0)),
      embalagem: Math.round(Number(etapa.embalagem ?? 0)),
      envase: Math.round(Number(etapa.envase ?? 0)),
      lavagem: Math.round(Number(etapa.lavagem ?? 0)),
      nao_iniciado: Math.round(Number(etapa.nao_iniciado ?? 0)),
      total: 0,
    };

    totais.total =
      totais.reprovacao_desvio +
      totais.desvio_aberto +
      totais.atraso_producao +
      totais.rendimento +
      totais.embalagem +
      totais.envase +
      totais.lavagem +
      totais.nao_iniciado;

    return totais;
  }, [data?.mes_gap_por_etapa, data?.mtd_gap_por_etapa]);

  // MTD continua disponível para conciliação operacional, mas o topo da página
  // passa a ser mensal: V1 do mês versus plano atual/tendência.
  const gapAlertaTela = data?.mtd_cx_gap ?? gapPorStatusTela.total ?? 0;
  const mesPrevistoV1 = Number(data?.mes_cx_previsto_v1 ?? data?.total_cx_previsto ?? 0);
  const mesPlanoAtualTendencia = Number(
    data?.mes_cx_plano_atual_tendencia ?? data?.total_cx_liberado ?? 0,
  );
  const mesRealizado = Number(data?.mes_cx_realizado ?? data?.total_cx_liberado ?? 0);
  const mesDiferencaVsV1 = Number(
    data?.mes_cx_diferenca_vs_v1 ?? mesPrevistoV1 - mesPlanoAtualTendencia,
  );
  const mesSaldoTendencia = Number(
    data?.mes_cx_saldo_tendencia ?? Math.max(mesPlanoAtualTendencia - mesRealizado, 0),
  );
  const denominadorCards = Math.max(0, Number(mesPrevistoV1 || data?.total_cx_previsto || gapPorStatusTela.total || 0));
  const textoPercentualCard = (valor: number) =>
    denominadorCards > 0
      ? `${fmtPercent((Number(valor || 0) / denominadorCards) * 100)}% da V1`
      : "0,0% da V1";

  const lotesFiltrados = useMemo(() => {
    let lista = [...lotesFiltradosBase];
    if (sortDataLib) {
      lista.sort((a, b) => {
        const da = a.data_lib || "9999-12-31";
        const db = b.data_lib || "9999-12-31";
        return sortDataLib === "asc" ? da.localeCompare(db) : db.localeCompare(da);
      });
    } else if (sortRendimento) {
      lista.sort((a, b) => {
        const ra = calcularRendimento(a);
        const rb = calcularRendimento(b);
        const va = ra ?? (sortRendimento === "asc" ? Infinity : -Infinity);
        const vb = rb ?? (sortRendimento === "asc" ? Infinity : -Infinity);
        return sortRendimento === "asc" ? va - vb : vb - va;
      });
    }
    return lista;
  }, [lotesFiltradosBase, sortRendimento, sortDataLib, retemPorLote]);

  const resumo = data?.mtd_resumo_liberacao;

  const lotesForaGantt = data?.lotes_fora_gantt ?? [];

  const thBase =
    "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-right whitespace-nowrap";

  const thLeft =
    "px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-left";

  const todosLotes = lotesFiltrados.map((l) => l.lote);
  const todosSelecionados = todosLotes.length > 0 && todosLotes.every((id) => selecionados.has(id));
  const algunsSelecionados = todosLotes.some((id) => selecionados.has(id)) && !todosSelecionados;

  function toggleTodos() {
    if (todosSelecionados) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(todosLotes));
    }
  }

  function toggleLote(lote: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(lote)) next.delete(lote);
      else next.add(lote);
      return next;
    });
  }

  function exportarExcel() {
    const alvo = selecionados.size > 0
      ? lotesFiltrados.filter((l) => selecionados.has(l.lote))
      : lotesFiltrados;

    const headers = ["Lote","OP","Grupo","Status gap","Destino/Motivo","Data Lib. V1","Data Lib. atual","Lavagem","Envase","Embalagem","Liberado","Tubetes","Caixas","Liberado (cx)","Rendimento (%)","Em Desvio"];
    const rows = alvo.map((l) => {
      const r = calcularRendimento(l);
      return [
        l.lote,
        l.ordem_op || "",
        l.grupo,
        l.status_gap || "",
        getDesvioDestino(l) || l.motivo_gap || "",
        l.data_lib || "",
        l.data_lib_atual || "",
        l.check_lavagem ? "Sim" : "Não",
        l.check_envase ? "Sim" : "Não",
        l.check_embalagem ? "Sim" : "Não",
        l.check_liberado ? "Sim" : "Não",
        l.qtd_prevista_tb,
        l.qtd_prevista_cx,
        l.qtd_liberada_cx,
        r !== null ? r.toFixed(1) : "",
        l.em_desvio ? "Sim" : "Não",
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rastreamento_lotes_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function calcularRendimento(lote: LoteRastreamento) {
    const planejadoCx = Number(lote.qtd_prevista_cx || 0);
    const liberadoCx = Number(lote.qtd_liberada_cx || 0);
    const baseRendimento = Math.max(planejadoCx - Number(retemPorLote || 0), 0);

    if (!lote.check_liberado || liberadoCx <= 0 || baseRendimento <= 0) {
      return null;
    }

    return (liberadoCx / baseRendimento) * 100;
  }

  function getRendimentoStatus(rendimento: number | null) {
    if (rendimento === null) {
      return {
        label: "Pendente",
        color: "var(--text-secondary)",
        bg: "#F3F4F6",
        border: "#E5E7EB",
      };
    }

    if (rendimento >= 98) {
      return {
        label: "Bom",
        color: "#166534",
        bg: "#DCFCE7",
        border: "#BBF7D0",
      };
    }

    if (rendimento >= 95) {
      return {
        label: "Atenção",
        color: "#92400E",
        bg: "#FEF3C7",
        border: "#FDE68A",
      };
    }

    return {
      label: "Crítico",
      color: "#991B1B",
      bg: "#FEE2E2",
      border: "#FECACA",
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p
            className="mb-0.5 text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-secondary)" }}
          >
            Produção · Rastreamento
          </p>

          <h2
            className="text-xl font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            Lotes de {mesLabel}/{data?.ano ?? ""}
          </h2>

          <div
            className="mt-2 inline-flex items-center gap-2 rounded-2xl border bg-white px-3 py-1.5 shadow-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <Clock size={13} style={{ color: "var(--text-secondary)" }} />
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Dados de produção atualizados em
            </span>
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {formatarDataHoraAtualizacao(ultimaAtualizacaoProducao) ?? "--"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              Mês de análise
            </label>

            <select
              value={mesSelecionado}
              onChange={(e) => setMesSelecionado(Number(e.target.value))}
              className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
                minWidth: 140,
              }}
            >
              {MES_LABELS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}/{anoSelecionado}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              Ano
            </label>

            <select
              value={anoSelecionado}
              onChange={(e) => setAnoSelecionado(Number(e.target.value))}
              className="rounded-xl border px-3 py-2 text-xs font-semibold outline-none"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
                minWidth: 100,
              }}
            >
              {[anoSelecionado - 1, anoSelecionado, anoSelecionado + 1]
                .filter((ano, index, arr) => arr.indexOf(ano) === index)
                .sort((a, b) => a - b)
                .map((ano) => (
                  <option key={ano} value={ano}>
                    {ano}
                  </option>
                ))}
            </select>
          </div>

          <button
            onClick={() => carregar(true, true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-secondary)",
              opacity: loading || refreshing ? 0.75 : 1,
            }}
          >
            <RefreshCw size={14} className={loading || refreshing ? "animate-spin" : ""} />
            {refreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {data && (
        <div className="card overflow-hidden p-0">
          <button
            type="button"
            onClick={() => setModalAuditoria(true)}
            className="w-full border-b px-5 py-4 text-left transition-colors hover:brightness-[0.99]"
            style={{
              borderColor: "var(--border)",
              background:
                mesDiferencaVsV1 > 0
                  ? "rgba(220,38,38,0.04)"
                  : "rgba(22,163,74,0.04)",
            }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={16}
                className="mt-0.5 flex-shrink-0"
                style={{
                  color: mesDiferencaVsV1 > 0 ? "#DC2626" : "#16A34A",
                }}
              />

              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {`Planejado V1 do mês: ${fmt(mesPrevistoV1)} cx — plano atual/tendência: ${fmt(
                    mesPlanoAtualTendencia,
                  )} cx`}
                </p>

                <p
                  className="mt-0.5 text-sm"
                  style={{ color: mesDiferencaVsV1 > 0 ? "#DC2626" : "#16A34A", fontWeight: 700 }}
                >
                  {mesDiferencaVsV1 > 0
                    ? `Diferença vs V1: -${fmt(mesDiferencaVsV1)} cx — veja composição abaixo:`
                    : mesDiferencaVsV1 < 0
                      ? `Plano atual acima da V1 em ${fmt(Math.abs(mesDiferencaVsV1))} cx`
                      : "Plano atual igual à V1"}
                </p>

                <p
                  className="mt-1 text-[11px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Realizado até hoje: {fmt(mesRealizado)} cx · Saldo previsto na tendência atual: {fmt(mesSaldoTendencia)} cx · clique para ver conciliação MTD com SD3
                </p>
              </div>
            </div>
          </button>

          <div
            className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-7"
            style={{ background: "var(--border)" }}
          >
            {[
              {
                label: "Perda reprovação/desvio",
                value: gapPorStatusTela.reprovacao_desvio,
                color: "#92400E",
                icon: AlertTriangle,
                filtro: "REPROVACAO_DESVIO",
              },
              {
                label: "Perda produção",
                value: gapPorStatusTela.atraso_producao,
                color: "#DC2626",
                icon: Clock,
                filtro: "ATRASO_PRODUCAO",
              },
              {
                label: "Perda rendimento",
                value: gapPorStatusTela.rendimento,
                color: "#6B7280",
                icon: TrendingDown,
                filtro: "RENDIMENTO",
              },
              {
                label: "Em desvio aberto",
                value: gapPorStatusTela.desvio_aberto,
                color: "#B45309",
                icon: AlertTriangle,
                filtro: "DESVIO",
              },
              {
                label: "Em embalagem",
                value: gapPorStatusTela.embalagem,
                color: "#EA580C",
                icon: Package,
                filtro: "EMBALAGEM",
              },
              {
                label: "Em envase",
                value: gapPorStatusTela.envase,
                color: "#2563EB",
                icon: Waves,
                filtro: "ENVASE",
              },
              {
                label: "Em lavagem",
                value: gapPorStatusTela.lavagem,
                color: "#CA8A04",
                icon: Droplets,
                filtro: "LAVAGEM",
              },
            ].map((k) => (
              <button
                key={k.label}
                onClick={() => {
                  setFiltroEtapa(filtroEtapa === k.filtro ? "" : k.filtro);
                  setFiltroEmbalado("");
                  setApenasAtrasados(false);
                  setSelecionados(new Set());
                }}
                className="px-4 py-3 text-left transition-all"
                style={{
                  background:
                    filtroEtapa === k.filtro
                      ? "var(--bg-primary)"
                      : "var(--bg-secondary)",
                  opacity: k.value === 0 ? 0.35 : 1,
                  cursor: k.value === 0 ? "default" : "pointer",
                }}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <k.icon size={12} style={{ color: k.color }} />

                  <p
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {k.label}
                  </p>
                </div>

                <p
                  className="text-xl font-bold"
                  style={{
                    color: k.value > 0 ? k.color : "var(--text-secondary)",
                  }}
                >
                  {fmt(k.value)} cx
                </p>

                <p
                  className="mt-0.5 text-[11px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {textoPercentualCard(k.value)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Grupo
          </label>

          <select
            value={filtroGrupo}
            onChange={(e) => {
              setFiltroGrupo(e.target.value);
              setSelecionados(new Set());
            }}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 160,
            }}
          >
            <option value="">Todos os grupos</option>
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Visão do plano
          </label>

          <select
            value={filtroVisaoPlano}
            onChange={(e) => {
              setFiltroVisaoPlano(e.target.value);
              setSelecionados(new Set());
            }}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 190,
            }}
          >
            <option value="">V1 do mês</option>
            <option value="MANTIDOS">Mantidos no mês atual</option>
            <option value="REPROGRAMADOS">Reprogramados</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Status/causa
          </label>

          <select
            value={filtroEtapa}
            onChange={(e) => {
              setFiltroEtapa(e.target.value);
              setFiltroEmbalado("");
              setSelecionados(new Set());
            }}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 160,
            }}
          >
            <option value="">Todos os status</option>
            <option value="LIBERADO">Liberado</option>
            <option value="REPROVACAO_DESVIO">Perda reprovação/desvio</option>
            <option value="DESVIO">Em desvio aberto</option>
            <option value="ATRASO_PRODUCAO">Perda produção</option>
            <option value="RENDIMENTO">Perda rendimento</option>
            <option value="EMBALAGEM">Em embalagem</option>
            <option value="ENVASE">Em envase</option>
            <option value="LAVAGEM">Em lavagem</option>
            <option value="NAO_INICIADO">Não iniciado</option>
            <option value="ATRASADO">Atrasados</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Passou embalagem?
          </label>

          <select
            value={filtroEmbalado}
            onChange={(e) => {
              setFiltroEmbalado(e.target.value);
              setSelecionados(new Set());
            }}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              minWidth: 130,
            }}
          >
            <option value="">Todos</option>
            <option value="SIM">Sim</option>
            <option value="NAO">Não</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Período
          </label>

          <select
            value={apenasAtrasados ? "ATE_HOJE" : "MES_COMPLETO"}
            onChange={(e) => {
              setApenasAtrasados(e.target.value === "ATE_HOJE");
              setSelecionados(new Set());
            }}
            className="rounded-lg border px-3 py-2 text-sm font-semibold outline-none"
            style={{
              background: apenasAtrasados ? "var(--bg-sidebar)" : "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: apenasAtrasados ? "#fff" : "var(--text-primary)",
              minWidth: 150,
            }}
          >
            <option value="MES_COMPLETO">Mês completo</option>
            <option value="ATE_HOJE">Previsto até hoje</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Retém por lote (cx)
          </label>

          <input
            type="number"
            step="0.1"
            min="0"
            value={retemPorLote}
            onChange={(e) => setRetemPorLote(Number(e.target.value || 0))}
            className="rounded-lg border px-3 py-2 text-sm font-semibold outline-none"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              width: 130,
            }}
          />
        </div>

        <button
          onClick={exportarExcel}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          <Download size={13} />
          Exportar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
        </button>

        <p className="pb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          {lotesFiltrados.length} lote
          {lotesFiltrados.length !== 1 ? "s" : ""}
        </p>
      </div>

      {loading && !data ? (
        <div
          className="card p-10 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          <RefreshCw
            size={24}
            className="mx-auto mb-3 animate-spin"
            style={{ opacity: 0.4 }}
          />
          Carregando rastreamento...
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {refreshing && (
            <div
              className="flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-secondary)" }}
            >
              <RefreshCw size={13} className="animate-spin" />
              Nova base de produção detectada. Atualizando...
            </div>
          )}
          <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
            <table className="w-full min-w-[1180px] border-separate border-spacing-0">
              <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                <tr style={{ background: "var(--bg-sidebar)", color: "#fff" }}>
                  <th className="px-3 py-3 text-center" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={todosSelecionados}
                      ref={(el) => { if (el) el.indeterminate = algunsSelecionados; }}
                      onChange={toggleTodos}
                      style={{ cursor: "pointer", accentColor: "#fff" }}
                    />
                  </th>
                  <th className={thLeft}>Lote / OP</th>
                  <th className={thLeft}>Grupo</th>
                  <th className={thLeft}>Destino Produto/Insumo</th>
                  <th
                    className={thBase + " cursor-pointer select-none"}
                    onClick={() => setSortDataLib((s) => s === "asc" ? "desc" : s === "desc" ? null : "asc")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      Data Lib.
                      {sortDataLib === "asc" ? <ChevronUp size={12} /> : sortDataLib === "desc" ? <ChevronDown size={12} /> : <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th
                    className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-wider"
                    style={{ minWidth: 280 }}
                  >
                    Etapas
                  </th>
                  <th className={thBase}>Tubetes</th>
                  <th className={thBase}>Caixas</th>
                  <th className={thBase}>Liberado (cx)</th>
                  <th
                    className={thBase + " cursor-pointer select-none"}
                    onClick={() => setSortRendimento((s) => s === "desc" ? "asc" : s === "asc" ? null : "desc")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      Rendimento
                      {sortRendimento === "desc" ? <ChevronDown size={12} /> : sortRendimento === "asc" ? <ChevronUp size={12} /> : <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {lotesFiltrados.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Nenhum lote encontrado.
                    </td>
                  </tr>
                ) : (
                  lotesFiltrados.map((l, i) => (
                    <tr
                      key={l.lote}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background:
                          l.em_desvio && !l.check_liberado
                            ? "rgba(245,158,11,0.05)"
                            : (l.atraso_producao || l.atrasado) && !l.check_liberado
                              ? "rgba(220,38,38,0.03)"
                              : i % 2 === 0
                                ? "var(--bg-secondary)"
                                : "var(--bg-primary)",
                      }}
                    >
                      <td className="px-3 py-3 text-center" style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={selecionados.has(l.lote)}
                          onChange={() => toggleLote(l.lote)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          {(l.em_desvio ||
                            ((l.atraso_producao || l.atrasado) && !l.check_liberado)) && (
                            <span
                              title={
                                l.em_desvio
                                  ? getDesvioTooltip(l)
                                  : l.motivo_gap || "Lote atrasado"
                              }
                              className="inline-flex items-center"
                              style={{ flexShrink: 0 }}
                            >
                              <AlertTriangle
                                size={12}
                                style={{
                                  color: l.em_desvio ? "#92400E" : "#DC2626",
                                  flexShrink: 0,
                                }}
                              />
                            </span>
                          )}

                          <span
                            className="font-mono text-sm font-semibold"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {l.lote}
                          </span>
                        </div>

                        {l.ordem_op && (
                          <p
                            className="mt-0.5 font-mono text-[11px]"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            OP {l.ordem_op}
                          </p>
                        )}

                        <DesvioBadge lote={l} />

                        {l.em_desvio && getListaDesvios(l).length > 1 && (
                          <p
                            className="mt-1 max-w-[320px] truncate text-[10px] font-medium"
                            title={getDesvioTooltip(l)}
                            style={{ color: "#1D4ED8" }}
                          >
                            {getListaDesvios(l)
                              .map((d) => d.serial)
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}

                        {l.em_desvio && getListaDesvios(l).length <= 1 && l.desvio_titulo && (
                          <p
                            className="mt-1 max-w-[260px] truncate text-[10px]"
                            title={getDesvioTooltip(l)}
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {l.desvio_titulo}
                          </p>
                        )}
                      </td>

                      <td
                        className="px-3 py-3 text-xs font-semibold"
                        style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}
                      >
                        {l.grupo || "—"}
                      </td>

                      <td
                        className="px-3 py-3 text-sm"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {(getDesvioDestino(l) || l.motivo_gap || l.status_gap) ? (
                          <span
                            className="inline-flex max-w-[260px] items-center rounded-full px-2 py-1 text-[11px] font-semibold"
                            title={(getDesvioDestino(l) || l.motivo_gap || l.status_gap) || undefined}
                            style={{
                              background:
                                String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                  .toUpperCase()
                                  .includes("REPROV") ||
                                String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                  .toUpperCase()
                                  .includes("DESCARTE")
                                  ? "#FEE2E2"
                                  : String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                        .toUpperCase()
                                        .includes("APROV")
                                    ? "#DCFCE7"
                                    : "#F3F4F6",
                              color:
                                String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                  .toUpperCase()
                                  .includes("REPROV") ||
                                String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                  .toUpperCase()
                                  .includes("DESCARTE")
                                  ? "#991B1B"
                                  : String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
                                        .toUpperCase()
                                        .includes("APROV")
                                    ? "#166534"
                                    : "var(--text-secondary)",
                            }}
                          >
                            <span className="truncate">
                              {getDesvioDestino(l) || l.motivo_gap || l.status_gap}
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm"
                        style={{
                          color:
                            l.em_desvio && !l.check_liberado
                              ? "#92400E"
                              : l.atrasado && !l.check_liberado
                                ? "#DC2626"
                                : "var(--text-secondary)",
                          fontWeight:
                            (l.em_desvio || l.atrasado) && !l.check_liberado
                              ? 600
                              : 400,
                        }}
                      >
                        {fmtData(l.data_lib)}
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex items-start justify-center">
                          <Check
                            ok={l.check_lavagem}
                            label="Lavagem"
                            icon={l.check_lavagem ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_envase} />

                          <Check
                            ok={l.check_envase}
                            label="Envase"
                            icon={l.check_envase ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_embalagem} />

                          <Check
                            ok={l.check_embalagem}
                            label="Embalagem"
                            icon={l.check_embalagem ? CheckCircle2 : XCircle}
                          />

                          <Connector ok={l.check_liberado} />

                          <Check
                            ok={l.check_liberado}
                            label="Liberado"
                            icon={l.check_liberado ? CheckCircle2 : XCircle}
                          />
                        </div>
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {l.qtd_prevista_tb > 0 ? fmt(l.qtd_prevista_tb) : "—"}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {l.qtd_prevista_cx > 0 ? fmt(l.qtd_prevista_cx) : "—"}
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm font-semibold"
                        style={{
                          color: l.check_liberado
                            ? "#16A34A"
                            : "var(--text-secondary)",
                        }}
                      >
                        {l.qtd_liberada_cx > 0 ? fmt(l.qtd_liberada_cx) : "—"}
                      </td>

                      <td className="px-3 py-3 text-right">
                        {(() => {
                          const rendimento = calcularRendimento(l);
                          const status = getRendimentoStatus(rendimento);

                          return (
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-bold"
                                style={{
                                  background: status.bg,
                                  borderColor: status.border,
                                  color: status.color,
                                }}
                              >
                                {rendimento === null
                                  ? "—"
                                  : `${rendimento.toFixed(1).replace(".", ",")}%`}
                              </span>

                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAuditoria && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.45)" }}
          onClick={() => setModalAuditoria(false)}
        >
          <div
            className="w-full max-w-5xl overflow-hidden rounded-2xl shadow-xl"
            style={{ background: "var(--bg-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <h3
                  className="text-lg font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Conciliação da liberação MTD
                </h3>

                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Conciliação operacional até hoje, mantendo a visão mensal V1 x plano atual no topo
                </p>
              </div>

              <button
                onClick={() => setModalAuditoria(false)}
                className="rounded-lg p-2 hover:bg-black/5"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    label: "Previsto até hoje",
                    value: resumo?.previsto_ate_hoje ?? data.mtd_cx_previsto,
                  },
                  {
                    label: "Liberado vinculado aos lotes",
                    value:
                      resumo?.liberado_vinculado_lotes_previstos ??
                      data.mtd_cx_liberado,
                  },
                  {
                    label: "Liberado SD3 MTD total",
                    value:
                      resumo?.liberado_sd3_mtd_total ??
                      data.total_cx_sd3_mes ??
                      data.mtd_cx_liberado,
                  },
                  {
                    label: `Liberado fora do Gantt de ${mesLabel}`,
                    value:
                      resumo?.liberado_sd3_fora_gantt_mes_atual ??
                      data.total_cx_fora_gantt ??
                      0,
                  },
                  {
                    label: "Gap teórico",
                    value: resumo?.gap_teorico_previsto_menos_vinculado ?? 0,
                  },
                  {
                    label: "Pendente em desvio",
                    value:
                      data.mtd_gap_por_etapa.desvio ?? data.mtd_cx_desvio ?? 0,
                  },
                  {
                    label: "Pendente localizado",
                    value:
                      resumo?.pendente_localizado_rastreamento ??
                      data.mtd_cx_gap,
                  },
                  {
                    label: "Resíduo não localizado",
                    value: resumo?.residuo_nao_localizado ?? 0,
                  },
                  {
                    label: "Lotes fora do Gantt",
                    value: data.total_lotes_fora_gantt ?? lotesForaGantt.length,
                    suffix: "",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {item.label}
                    </p>

                    <p
                      className="mt-1 text-xl font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {fmt(item.value)}
                      {item.suffix === "" ? "" : " cx"}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className="overflow-hidden rounded-xl border"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="border-b px-4 py-3"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <p
                    className="text-sm font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Lotes liberados na SD3 em {mesLabel}, mas fora do Gantt de{" "}
                    {mesLabel}
                  </p>
                </div>

                <div className="overflow-auto" style={{ maxHeight: 320 }}>
                  <table className="w-full min-w-[900px] text-sm">
                    <thead
                      style={{ background: "var(--bg-sidebar)", color: "#fff" }}
                    >
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Lote
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Produto
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Dt Lib. SD3
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Qtd. SD3 cx
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Previsto cx
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase">
                          Dt Lib. Prev.
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Grupo Prev.
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase">
                          Motivo
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {lotesForaGantt.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-8 text-center"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            Nenhum lote fora do Gantt encontrado.
                          </td>
                        </tr>
                      ) : (
                        lotesForaGantt.map((item) => (
                          <tr
                            key={`${item.lote}-${item.produto}-${item.data_lib_prevista}`}
                            className="border-b"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <td className="px-3 py-2 font-mono font-semibold">
                              {item.lote}
                            </td>

                            <td className="px-3 py-2">
                              {item.descr_prod || item.produto || "—"}
                            </td>

                            <td className="px-3 py-2 text-right">
                              {fmtData(item.dt_emissao)}
                            </td>

                            <td className="px-3 py-2 text-right font-semibold">
                              {fmt(item.qtd_cx)}
                            </td>

                            <td className="px-3 py-2 text-right">
                              {fmtData(item.data_lib_prevista)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
