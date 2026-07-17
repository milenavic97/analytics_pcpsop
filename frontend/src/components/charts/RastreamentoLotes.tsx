import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  Lock,
  Package,
  Waves,
  Droplet,
  Droplets,
  TrendingDown,
  TrendingUp,
  X,
  Download,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  Search,
  Pencil,
  Plus,
  Trash2,
  ArrowUpCircle,
  Undo2,
  Link as LinkIcon,
} from "lucide-react";
import { clearApiCache, getRastreamentoLotes, getRastreamentoLotesCacheVersao } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

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
  qtd_prevista_ajustada_cx?: number | null;
  qtd_produzida_tb: number;
  qtd_produzida_cx: number;
  qtd_liberada_cx: number;
  qtd_quarentena_cx?: number | null;
  qtd_gap_cx?: number;
  qtd_gap_cx_float?: number;
  qtd_perda_rendimento_cx?: number;
  qtd_perda_rendimento_cx_float?: number;
  qtd_prevista_cx_float?: number;
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
  observacao_manual?: string | null;
  promovido_para?: string | null;
  promovido_de?: string | null;
  lote_manual?: boolean;
  qtd_desvios?: number | null;
  desvios?: DesvioInfo[] | null;
  desvio_reprovacao?: boolean;
  reprogramado?: boolean;
  atraso_producao?: boolean;
  perda_rendimento?: boolean;
  status_gap?: string | null;
  motivo_gap?: string | null;
  data_lib_atual?: string | null;
  data_fim_atual?: string | null;
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

import { getAuthHeaders } from "../../lib/authHeaders";

const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL || "https://dfl-sop-api.fly.dev";

const BASE_APONTAMENTO_PRODUCAO = "apontamentos";

async function buscarUltimaAtualizacaoProducaoNoCache(): Promise<string | null> {
  const url = `${API_URL}/upload/ultima-atualizacao/${BASE_APONTAMENTO_PRODUCAO}?_t=${Date.now()}`;

  const authHeaders = await getAuthHeaders();
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      ...authHeaders,
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
  versaoBase?: string | null;
  data: RastreamentoData;
}

interface ApontamentoEvento {
  data_inicial?: string | null;
  data_final?: string | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  tipo_evento?: string | null;
  evento?: string | null;
  equipamento?: string | null;
  recurso?: string | null;
  etapa?: string | null;
  duracao_h?: number | null;
  duracao_horas?: number | null;
  situacao?: string | null;
  qtd_produzida?: number | null;
  fonte_evento?: string | null;
  is_parada?: boolean | null;
}

interface AtrasoProducaoLote {
  lote: string;
  grupo?: string | null;
  linha?: string | null;
  produto?: string | null;
  qtd_prevista_cx?: number | null;
  qtd_prevista_tb?: number | null;
  qtd_atual_cx?: number | null;
  qtd_futura_cx?: number | null;
  data_inicio_prevista?: string | null;
  data_fim_prevista?: string | null;
  data_lib_prevista?: string | null;
  data_inicio_atual?: string | null;
  data_fim_atual?: string | null;
  data_lib_atual?: string | null;
  mes_previsto_atual?: number | null;
  ano_previsto_atual?: number | null;
  status_atual?: string | null;
  motivo?: string | null;
  explicacao?: string | null;
  check_lavagem?: boolean | null;
  check_envase?: boolean | null;
  check_embalagem?: boolean | null;
  check_liberado?: boolean | null;
  em_desvio?: boolean | null;
  desvio_reprovacao?: boolean | null;
  data_fim_real_apontamento?: string | null;
  fim_real_fonte?: string | null;
  paradas_periodo?: ApontamentoEvento[] | null;
  qtd_paradas_periodo?: number | null;
  horas_parada_periodo?: number | null;
  paradas_dia_fim_previsto?: ApontamentoEvento[] | null;
  qtd_paradas_dia_fim_previsto?: number | null;
  horas_paradas_dia_fim_previsto?: number | null;
  data_referencia_parada?: string | null;
  apontamentos_periodo?: ApontamentoEvento[] | null;
  resumo_parada?: string | null;
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
  mes_cx_saldo_tendencia_bruto?: number;
  mes_cx_desconto_reprovacao_plano_atual?: number;
  mes_cx_acrescimo_plano_atual?: number;
  mes_cx_ganho_rendimento?: number;
  mes_cx_perdas_brutas_vs_v1?: number;
  mes_cx_reconciliado_v1?: number;
  mes_perdas_vs_v1_por_causa?: {
    reprovacao_desvio?: number;
    atraso_producao?: number;
    rendimento?: number;
    ganho_rendimento?: number;
    outros?: number;
  };
  mes_gap_por_etapa?: {
    desvio?: number;
    reprovacao_desvio?: number;
    desvio_aberto?: number;
    atraso_producao?: number;
    rendimento?: number;
    embalagem?: number;
    embalagem_em_desvio?: number;
    envase?: number;
    envase_em_desvio?: number;
    lavagem?: number;
    lavagem_em_desvio?: number;
    nao_iniciado?: number;
    nao_iniciado_em_desvio?: number;
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
    embalagem_em_desvio?: number;
    envase: number;
    envase_em_desvio?: number;
    lavagem: number;
    lavagem_em_desvio?: number;
    nao_iniciado: number;
    nao_iniciado_em_desvio?: number;
  };
  mtd_resumo_liberacao?: ResumoLiberacao;
  lotes_fora_gantt?: LoteForaGantt[];
  atraso_producao_lotes?: AtrasoProducaoLote[];
  perda_producao_reprogramados_simples?: number;
  lotes_reprogramados_simples?: string[];
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

function fmtTubetes(cx?: number | null) {
  if (cx === null || cx === undefined) return "—";
  return fmt(Number(cx || 0) * 500);
}

function fmtData(iso?: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}


function fmtHora(hora?: string | null) {
  if (!hora) return "";
  const raw = String(hora);
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

function fmtPeriodoApontamento(ev: ApontamentoEvento) {
  const data = fmtData(ev.data_inicial || ev.data_final);
  const hi = fmtHora(ev.hora_inicio);
  const hf = fmtHora(ev.hora_fim);
  if (hi && hf) return `${data} · ${hi} → ${hf}`;
  if (hi) return `${data} · ${hi}`;
  if (hf) return `${data} · até ${hf}`;
  return data;
}

function fmtHorasApontamento(ev: ApontamentoEvento) {
  const horas = Number(ev.duracao_horas ?? ev.duracao_h ?? 0);
  if (!horas) return "";
  return `${horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
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



async function buscarRastreamentoLotesDireto(params: Record<string, any>): Promise<RastreamentoData> {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });

  query.set("_t", String(Date.now()));

  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/rastreamento-lotes?${query.toString()}`, {
    cache: "no-store",
    headers: {
      ...authHeaders,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });

  if (!res.ok) {
    throw new Error(`Erro ao carregar rastreamento direto (${res.status})`);
  }

  return (await res.json()) as RastreamentoData;
}

async function salvarLoteObservacaoManual(
  lote: string,
  mes: number,
  ano: number,
  motivo: string
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/lotes-observacao-manual`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ lote, mes, ano, motivo }),
  });
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao salvar observação (${res.status})`);
  }
}

async function removerLoteObservacaoManual(lote: string, mes: number, ano: number): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/overview/lotes-observacao-manual/${encodeURIComponent(lote)}?mes=${mes}&ano=${ano}`,
    { method: "DELETE", headers: authHeaders }
  );
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao remover observação (${res.status})`);
  }
}

async function salvarLoteManualRastreamento(
  lote: string,
  mes: number,
  ano: number,
  grupo: string,
  qtdCaixas: number,
  dataLiberacao: string,
  motivo: string
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/lotes-manuais-rastreamento`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      lote,
      mes,
      ano,
      grupo: grupo || null,
      qtd_caixas: qtdCaixas,
      data_liberacao: dataLiberacao || null,
      motivo: motivo || null,
    }),
  });
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao salvar lote manual (${res.status})`);
  }
}

async function removerLoteManualRastreamento(lote: string, mes: number, ano: number): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/overview/lotes-manuais-rastreamento/${encodeURIComponent(lote)}?mes=${mes}&ano=${ano}`,
    { method: "DELETE", headers: authHeaders }
  );
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao remover lote manual (${res.status})`);
  }
}

async function promoverLoteMesAtual(
  lote: string,
  mesOrigem: number,
  anoOrigem: number,
  qtdCaixas: number,
  grupo: string | null
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/lotes-promover-mes-atual`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      lote,
      mes_origem: mesOrigem,
      ano_origem: anoOrigem,
      qtd_caixas: qtdCaixas,
      grupo: grupo || null,
    }),
  });
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao promover lote (${res.status})`);
  }
}

async function removerPromocaoLote(lote: string, mesOrigem: number, anoOrigem: number): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/overview/lotes-promover-mes-atual/${encodeURIComponent(lote)}?mes_origem=${mesOrigem}&ano_origem=${anoOrigem}`,
    { method: "DELETE", headers: authHeaders }
  );
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao remover promoção (${res.status})`);
  }
}

async function criarLoteAlias(loteErrado: string, loteCorreto: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/lotes-alias`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ lote_errado: loteErrado, lote_correto: loteCorreto }),
  });
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao salvar de-para (${res.status})`);
  }
}

async function salvarAjustePlanejado(lote: string, mes: number, ano: number, qtdCaixas: number): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}/overview/lotes-ajuste-planejado`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ lote, mes, ano, qtd_caixas: qtdCaixas }),
  });
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao salvar ajuste (${res.status})`);
  }
}

async function removerAjustePlanejado(lote: string, mes: number, ano: number): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/overview/lotes-ajuste-planejado/${encodeURIComponent(lote)}?mes=${mes}&ano=${ano}`,
    { method: "DELETE", headers: authHeaders }
  );
  if (!res.ok) {
    const detalhe = await res.json().catch(() => null);
    throw new Error(detalhe?.detail || `Erro ao remover ajuste (${res.status})`);
  }
}


// Cache em memória do módulo.
// Diferente do localStorage, ele permanece vivo enquanto a SPA está aberta.
// Isso evita que o Rastreamento suma ao navegar por várias páginas e voltar.
const rastreamentoRuntimeCache = new Map<string, RastreamentoCacheEntry>();

function getRastreamentoCacheKey(mes: number, ano: number) {
  return `rastreamento-lotes-v7-direto-cache-rapido:${ano}-${String(mes).padStart(2, "0")}`;
}

function lerRastreamentoCache(_mes: number, _ano: number): RastreamentoCacheEntry | null {
  // Desativado: o Rastreamento alimenta números oficiais da Overview.
  // Cache local/runtime fez aba normal e aba anônima mostrarem valores diferentes.
  return null;
}

function salvarRastreamentoCache(
  _mes: number,
  _ano: number,
  _data: RastreamentoData,
  _apontamentoAtualizadoEm: string | null,
  _versaoBase: string | null
) {
  // Desativado de propósito. O payload precisa vir sempre do backend/SD3 atual.
}

function limparRastreamentoCache(mes: number, ano: number) {
  const cacheKey = getRastreamentoCacheKey(mes, ano);
  rastreamentoRuntimeCache.delete(cacheKey);

  try {
    window.localStorage.removeItem(cacheKey);
  } catch (_) {
    // noop
  }
}

interface RastreamentoMtdLoadPayload {
  previstoAteHoje: number;
  liberadoSd3MtdTotal: number;
  liberadoVinculadoLotesPrevistos: number;
  liberadoSd3ForaGanttMesAtual: number;
  fonte: "mtd_resumo_liberacao" | "fallback";
}

export function RastreamentoLotes({ onMtdLoad }: { onMtdLoad?: (mtd_cx_previsto: number, mtd_cx_liberado: number, payload?: RastreamentoMtdLoadPayload) => void } = {}) {
  const { hasPermission } = useAuth();
  const podeEditarObservacaoManual = hasPermission("configuracoes");
  const hojeBase = new Date();
  const mesInicial = hojeBase.getMonth() + 1;
  const anoInicial = hojeBase.getFullYear();
  // Cache local/runtime desativado: esta seção alimenta números oficiais da Overview.
  const cacheInicial = lerRastreamentoCache(mesInicial, anoInicial);

  const [data, setData] = useState<RastreamentoData | null>(cacheInicial?.data ?? null);
  const [ultimaAtualizacaoProducao, setUltimaAtualizacaoProducao] = useState<string | null>(
    cacheInicial?.apontamentoAtualizadoEm ?? null
  );
  const [loading, setLoading] = useState(!cacheInicial?.data);
  const tentativasAutoRetryRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [filtroEmbalado, setFiltroEmbalado] = useState("");
  const [filtroVisaoPlano, setFiltroVisaoPlano] = useState("");
  const [buscaLote, setBuscaLote] = useState("");
  const [apenasAtrasados, setApenasAtrasados] = useState(false);
  const [modalAuditoria, setModalAuditoria] = useState(false);
  // Modal "Perda Produção" removido de propósito: mostrava os lotes que
  // SAÍRAM do mês (consequência), não os que de fato ATRASARAM (causa) --
  // confundia mais do que ajudava. Comparar corretamente exige olhar sempre
  // a versão anterior do MPS/Gantt (Vn-1, não sempre V1), o que fica pra uma
  // próxima entrega. Por ora o card só filtra a tabela abaixo, sem modal.
  const [acompanhamentoHojeAberto, setAcompanhamentoHojeAberto] = useState(false);
  const [retemPorLote, setRetemPorLote] = useState(0.7);
  const [sortRendimento, setSortRendimento] = useState<"asc" | "desc" | null>(null);
  const [sortDataLib, setSortDataLib] = useState<"asc" | "desc" | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [mesSelecionado, setMesSelecionado] = useState(mesInicial);
  const [anoSelecionado, setAnoSelecionado] = useState(anoInicial);

  const aplicarDadosRastreamento = (
    json: RastreamentoData,
    atualizacaoServidor: string | null
  ) => {
    setData(json);
    setUltimaAtualizacaoProducao(atualizacaoServidor || null);

    // Os cards "mês atual" da Overview (Atendimento Projetado, Liberações e o
    // gráfico de Demanda vs. Disponibilidade) só devem refletir o mês
    // corrente de verdade. Sem essa checagem, trocar o filtro deste widget
    // para um mês passado (ex.: Junho, para conferir o Rastreamento) também
    // sobrescrevia esses cards da Overview com o dado do mês selecionado.
    const ehMesAtualDeVerdade = mesSelecionado === mesInicial && anoSelecionado === anoInicial;

    if (onMtdLoad && ehMesAtualDeVerdade) {
      const resumoLiberacao = json.mtd_resumo_liberacao;
      const previstoAteHoje = Number(
        resumoLiberacao?.previsto_ate_hoje ?? json.mtd_cx_previsto ?? 0
      );
      const liberadoSd3MtdTotal = Number(
        resumoLiberacao?.liberado_sd3_mtd_total ??
          json.total_cx_sd3_mes ??
          json.mtd_cx_liberado ??
          0
      );
      const liberadoVinculado = Number(
        resumoLiberacao?.liberado_vinculado_lotes_previstos ??
          json.mtd_cx_liberado ??
          0
      );
      const liberadoForaGantt = Number(
        resumoLiberacao?.liberado_sd3_fora_gantt_mes_atual ??
          json.total_cx_fora_gantt ??
          0
      );

      // Valor oficial para a Overview/gráfico/card: SD3 MTD total.
      // O vinculado aos lotes é apenas uma visão de conciliação operacional.
      onMtdLoad(previstoAteHoje, liberadoSd3MtdTotal, {
        previstoAteHoje,
        liberadoSd3MtdTotal,
        liberadoVinculadoLotesPrevistos: liberadoVinculado,
        liberadoSd3ForaGanttMesAtual: liberadoForaGantt,
        fonte: resumoLiberacao ? "mtd_resumo_liberacao" : "fallback",
      });
    }
  };

  const buscarVersaoRastreamento = async () => {
    try {
      return await getRastreamentoLotesCacheVersao({
        mes: mesSelecionado,
        ano: anoSelecionado,
      });
    } catch (_) {
      return null;
    }
  };

  const carregar = async (
    forceRefresh = false,
    manterTabelaDuranteRefresh = false,
    versaoServidorRef?: string | null,
    atualizacaoServidorRef?: string | null
  ) => {
    // Fluxo rápido:
    // ao voltar para a página, mostra o último payload calculado imediatamente.
    // Para buscar dado novo, o botão Atualizar força novo cálculo direto no backend.
    if (!forceRefresh) {
      const cached = lerRastreamentoCache(mesSelecionado, anoSelecionado);

      if (cached?.data) {
        aplicarDadosRastreamento(cached.data, cached.apontamentoAtualizadoEm || null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
    }

    // Stale while refresh:
    // se já tem dado na tela, não apaga a seção; só mostra "Atualizando..."
    if (manterTabelaDuranteRefresh || data) {
      setRefreshing(true);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const params: any = {
        mes: mesSelecionado,
        ano: anoSelecionado,
      };

      if (forceRefresh) {
        params.force = true;
        params.allow_stale = false;
        params._t = Date.now();
        limparRastreamentoCache(mesSelecionado, anoSelecionado);
      }

      // Retry automático: essa chamada ignora cache de propósito (sempre
      // recalcula na hora, ver buscarRastreamentoLotesDireto), então uma
      // falha passageira de rede (ex.: erro intermitente de concorrência do
      // HTTP/2 com o Supabase, já visto em produção) deixava o painel em
      // branco pra sempre, só recuperando com F5 manual. Agora tenta de novo
      // até 3 vezes, com uma pausa curta crescente entre elas, antes de
      // desistir de verdade.
      let json: RastreamentoData | null = null;
      let versaoServidor: any = null;
      let ultimoErro: unknown = null;

      for (let tentativa = 0; tentativa < 3; tentativa++) {
        try {
          const resultado = await Promise.all([
            // Chamada direta sem cache do endpoint. O cache do rastreamento estava
            // segurando payload antigo e impedindo desvios recém-carregados de
            // aparecerem na Overview.
            buscarRastreamentoLotesDireto(params),
            versaoServidorRef !== undefined
              ? Promise.resolve({
                  versao_base: versaoServidorRef,
                  ultima_atualizacao: atualizacaoServidorRef ?? null,
                })
              : buscarVersaoRastreamento(),
          ]);
          json = resultado[0];
          versaoServidor = resultado[1];
          ultimoErro = null;
          break;
        } catch (erro) {
          ultimoErro = erro;
          if (tentativa < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * (tentativa + 1)));
          }
        }
      }

      if (ultimoErro || !json) {
        throw ultimoErro || new Error("Falha ao carregar rastreamento de lotes");
      }

      const versaoBase = versaoServidor?.versao_base || versaoServidorRef || null;
      const atualizacaoServidor =
        versaoServidor?.ultima_atualizacao || atualizacaoServidorRef || null;

      aplicarDadosRastreamento(json, atualizacaoServidor);
      salvarRastreamentoCache(
        mesSelecionado,
        anoSelecionado,
        json,
        atualizacaoServidor,
        versaoBase
      );
      // Deu certo -- zera o contador de auto-retry pra próxima vez que algo falhar.
      tentativasAutoRetryRef.current = 0;
    } catch (_) {
      // Se for atualização automática/manual, preserva a tabela antiga para não sumir tudo.
      if (!manterTabelaDuranteRefresh && !data) {
        setData(null);
        setUltimaAtualizacaoProducao(null);
      }

      // Auto-retry externo: as 3 tentativas internas (acima) já cobrem falha
      // de rede passageira, mas se o backend estiver mais sobrecarregado
      // (ex.: logo depois de subir todas as bases de uma vez), as 3 podem
      // não ser suficientes -- e sem isso o painel ficava em branco pra
      // sempre, só recuperando com F5 manual. Agenda até 3 tentativas extras,
      // 15s cada, sozinho, sem precisar de nenhuma ação da pessoa.
      if (tentativasAutoRetryRef.current < 3) {
        tentativasAutoRetryRef.current += 1;
        window.setTimeout(() => {
          void carregar(true, true, versaoServidorRef, atualizacaoServidorRef);
        }, 15000);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const verificarBaseNovaEAtualizar = async () => {
    const versaoServidor = await buscarVersaoRastreamento();
    if (!versaoServidor?.versao_base) return;

    const atualizacaoServidor = versaoServidor.ultima_atualizacao || null;
    if (atualizacaoServidor) {
      setUltimaAtualizacaoProducao(atualizacaoServidor);
    }

    const cached = lerRastreamentoCache(mesSelecionado, anoSelecionado);

    if (cached) {
      // Cache antigo sem versaoBase: carimba a versão atual e não recarrega.
      if (!cached.versaoBase) {
        salvarRastreamentoCache(
          mesSelecionado,
          anoSelecionado,
          cached.data,
          atualizacaoServidor,
          versaoServidor.versao_base
        );
        return;
      }

      if (cached.versaoBase === versaoServidor.versao_base) {
        return;
      }

      await carregar(true, true, versaoServidor.versao_base, atualizacaoServidor);
      return;
    }

    if (data) {
      // Se a tela tem dados mas o localStorage não tem, salva a versão atual
      // e evita apagar/recarregar a seção ao navegar entre páginas.
      salvarRastreamentoCache(
        mesSelecionado,
        anoSelecionado,
        data,
        atualizacaoServidor,
        versaoServidor.versao_base
      );
      return;
    }

    await carregar(true, true, versaoServidor.versao_base, atualizacaoServidor);
  };

  useEffect(() => {
    setSelecionados(new Set());
    carregar(false, false);
  }, [mesSelecionado, anoSelecionado]);

  useEffect(() => {
    // Desativado para evitar loop de refresh/flicker na Overview.
    // A atualização do Rastreamento fica manual pelo botão "Atualizar".
    // Mantemos a referência abaixo para evitar alerta de variável não usada em builds mais rígidos.
    void verificarBaseNovaEAtualizar;
  }, [mesSelecionado, anoSelecionado]);


  const mesLabel = data ? MES_LABELS[(data.mes ?? 1) - 1] : "";

  const grupos = [
    ...new Set((data?.lotes ?? []).map((l) => l.grupo).filter(Boolean)),
  ].sort();

  const hoje = new Date().toISOString().split("T")[0];

  function normalizarStatusLocal(valor?: string | null) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function loteEhReprovacaoOuDescarte(l: LoteRastreamento) {
    const textos = [
      l.desvio_destino,
      l.desvio_destino_consolidado,
      l.destino,
      l.destino_produto_insumo,
      l.desvio_destino_produto_insumo,
      l.desvio_estado,
      l.desvio_titulo,
      l.status_gap,
      ...(l.desvios || []).flatMap((d) => [
        d.destino,
        d.desvio_destino,
        d.destino_produto_insumo,
        d.estado,
        d.titulo,
        d.title,
        d.motivo,
      ]),
    ]
      .map(normalizarStatusLocal)
      .join(" ");

    return (
      Boolean(l.desvio_reprovacao) ||
      textos.includes("REPROV") ||
      textos.includes("DESCART") ||
      textos.includes("DESCARTE") ||
      textos.includes("REJEIT") ||
      textos.includes("SUCATA") ||
      textos.includes("DESTRUI")
    );
  }

  function statusPrincipalLote(l: LoteRastreamento) {
    // Status/causa principal do lote.
    // A ordem evita que um lote reprovado ou reprogramado apareça também como "em envase"
    // só porque já teve apontamento de envase.
    if (loteEhReprovacaoOuDescarte(l)) return "REPROVACAO_DESVIO";
    if (l.atraso_producao || l.reprogramado || l.status_gap === "Atraso de produção") return "ATRASO_PRODUCAO";
    if (l.em_desvio) return "DESVIO";
    if (l.perda_rendimento) return "RENDIMENTO";
    if (l.check_liberado) return "LIBERADO";
    if (l.check_embalagem) return "EMBALAGEM";
    if (l.check_envase) return "ENVASE";
    if (l.check_lavagem) return "LAVAGEM";
    return "NAO_INICIADO";
  }

  // Etapa física do lote, independente de estar ou não em desvio aberto --
  // mesmo critério usado no backend (_etapa_fisica_lote) e no recálculo de
  // fallback acima. Um lote embalado que caiu em desvio continua contando
  // como "embalado" pro filtro/card dessa etapa; a etiqueta de desvio na
  // linha da tabela continua aparecendo, só não vira uma categoria à parte.
  function etapaFisicaLote(l: LoteRastreamento): string | null {
    if (l.check_liberado) return null;
    if (loteEhReprovacaoOuDescarte(l)) return null;
    if (l.atraso_producao || l.reprogramado || l.status_gap === "Atraso de produção") return null;
    if (l.check_embalagem) return "EMBALAGEM";
    if (l.check_envase) return "ENVASE";
    if (l.check_lavagem) return "LAVAGEM";
    return "NAO_INICIADO";
  }

  const ETAPAS_FISICAS = new Set(["EMBALAGEM", "ENVASE", "LAVAGEM", "NAO_INICIADO"]);

  // Casamento do lote com o filtro "STATUS/CAUSA" selecionado.
  // - Causas fechadas/prioritárias (reprovação, atraso, rendimento, liberado)
  //   continuam exclusivas, igual antes.
  // - "DESVIO" agora significa "está em desvio aberto", sem importar em qual
  //   etapa -- pode aparecer junto com qualquer uma das 4 etapas físicas.
  // - As 4 etapas físicas casam pelo estágio real do lote, esteja ele em
  //   desvio ou não -- é isso que faz o card bater com a tabela.
  function loteCorrespondeAoFiltro(l: LoteRastreamento, filtro: string): boolean {
    if (filtro === "DESVIO") return Boolean(l.em_desvio) && etapaFisicaLote(l) !== null;
    // "Liberados" representa todo lote já entregue -- não pode perder a
    // contagem só porque também teve variação de rendimento ou desvio
    // aberto (o que é comum). Bate direto no estado físico, igual as etapas.
    if (filtro === "LIBERADO") return Boolean(l.check_liberado);
    // Card "Outras perdas/ajustes": mesmo critério do backend pra entrar
    // no card (observação manual ativa) -- ver overview.py, "outros" só
    // conta lote com observacao_manual preenchida.
    if (filtro === "OBSERVACAO_MANUAL") return Boolean(l.observacao_manual);
    if (ETAPAS_FISICAS.has(filtro)) return etapaFisicaLote(l) === filtro;
    return statusPrincipalLote(l) === filtro;
  }

  const lotesFiltradosBase = (data?.lotes ?? []).filter((l) => {
    if (apenasAtrasados && !l.considerar_previsto_ate_hoje) return false;
    if (filtroGrupo && l.grupo !== filtroGrupo) return false;

    if (filtroVisaoPlano === "REPROGRAMADOS" && !(l.reprogramado || l.atraso_producao)) return false;
    if (filtroVisaoPlano === "MANTIDOS" && (l.reprogramado || l.atraso_producao)) return false;

    if (filtroEmbalado === "SIM" && !l.check_embalagem) return false;
    if (filtroEmbalado === "NAO" && l.check_embalagem) return false;

    if (filtroEtapa === "ATRASADO" && (!l.atrasado || l.check_liberado)) return false;
    if (filtroEtapa && filtroEtapa !== "ATRASADO" && !loteCorrespondeAoFiltro(l, filtroEtapa)) return false;

    if (buscaLote.trim()) {
      const alvo = buscaLote.trim().toLowerCase();
      const campos = [
        l.lote,
        l.ordem_op,
        l.grupo,
        l.destino,
        l.destino_produto_insumo,
        l.desvio_destino,
        l.desvio_destino_consolidado,
        l.desvio_destino_produto_insumo,
      ];
      const encontrou = campos.some((campo) =>
        String(campo ?? "").toLowerCase().includes(alvo)
      );
      if (!encontrou) return false;
    }

    return true;
  });

  type GapPorEtapaNormalizado = {
    reprovacao_desvio: number;
    desvio_aberto: number;
    atraso_producao: number;
    rendimento: number;
    embalagem: number;
    embalagem_em_desvio: number;
    envase: number;
    envase_em_desvio: number;
    lavagem: number;
    lavagem_em_desvio: number;
    nao_iniciado: number;
    nao_iniciado_em_desvio: number;
    outros: number;
    total: number;
  };

  const normalizarGapPorEtapa = (
    etapa?: (Partial<RastreamentoData["mtd_gap_por_etapa"]> & { outros?: number }),
  ): GapPorEtapaNormalizado => {
    const totais = {
      reprovacao_desvio: Math.round(Number(etapa?.reprovacao_desvio ?? 0)),
      // Compatibilidade: algumas respostas do backend ainda vêm como `desvio`.
      // Isso agora é só informativo (soma dos "_em_desvio" abaixo) -- não
      // entra mais somado à parte no total, pra não contar o mesmo lote 2x
      // (uma vez na etapa física dele, outra em "desvio aberto").
      desvio_aberto: Math.round(Number(etapa?.desvio_aberto ?? etapa?.desvio ?? 0)),
      atraso_producao: Math.round(Number(etapa?.atraso_producao ?? 0)),
      rendimento: Math.round(Number(etapa?.rendimento ?? 0)),
      embalagem: Math.round(Number(etapa?.embalagem ?? 0)),
      embalagem_em_desvio: Math.round(Number((etapa as any)?.embalagem_em_desvio ?? 0)),
      envase: Math.round(Number(etapa?.envase ?? 0)),
      envase_em_desvio: Math.round(Number((etapa as any)?.envase_em_desvio ?? 0)),
      lavagem: Math.round(Number(etapa?.lavagem ?? 0)),
      lavagem_em_desvio: Math.round(Number((etapa as any)?.lavagem_em_desvio ?? 0)),
      nao_iniciado: Math.round(Number(etapa?.nao_iniciado ?? 0)),
      nao_iniciado_em_desvio: Math.round(Number((etapa as any)?.nao_iniciado_em_desvio ?? 0)),
      outros: Math.round(Number(etapa?.outros ?? 0)),
      total: 0,
    };

    totais.total =
      totais.reprovacao_desvio +
      totais.atraso_producao +
      totais.rendimento +
      totais.embalagem +
      totais.envase +
      totais.lavagem +
      totais.nao_iniciado +
      totais.outros;

    return totais;
  };

  const recalcularTotalGapPorEtapa = (base: GapPorEtapaNormalizado): GapPorEtapaNormalizado => ({
    ...base,
    total:
      base.reprovacao_desvio +
      base.atraso_producao +
      base.rendimento +
      base.embalagem +
      base.envase +
      base.lavagem +
      base.nao_iniciado +
      base.outros,
  });

  const aplicarFallbackOperacionalDosLotes = (
    base: GapPorEtapaNormalizado,
    fallbackLotes: GapPorEtapaNormalizado,
  ): GapPorEtapaNormalizado => {
    // As perdas principais continuam vindo preferencialmente dos campos reconciliados do backend.
    // Já os status operacionais abertos precisam bater com os lotes visíveis na tabela.
    const temFallbackPrincipal =
      fallbackLotes.reprovacao_desvio > 0 ||
      fallbackLotes.atraso_producao > 0 ||
      fallbackLotes.rendimento > 0;

    const combinado = {
      ...base,
      // Para as perdas principais, quando os lotes visíveis permitem reclassificar
      // o destino como Descartado/Reprovado, a tabela deve mandar no card.
      // Ex.: lote com Desvio = "-" e Destino = "Descartado".
      reprovacao_desvio: temFallbackPrincipal ? fallbackLotes.reprovacao_desvio : base.reprovacao_desvio,
      atraso_producao: temFallbackPrincipal ? fallbackLotes.atraso_producao : base.atraso_producao,
      rendimento: temFallbackPrincipal ? fallbackLotes.rendimento : base.rendimento,

      // Status abertos continuam usando o backend quando ele já trouxe valor;
      // fallback só evita card zerado quando o backend não manda a quebra.
      desvio_aberto: base.desvio_aberto > 0 ? base.desvio_aberto : fallbackLotes.desvio_aberto,
      embalagem: base.embalagem > 0 ? base.embalagem : fallbackLotes.embalagem,
      embalagem_em_desvio: base.embalagem > 0 ? base.embalagem_em_desvio : fallbackLotes.embalagem_em_desvio,
      envase: base.envase > 0 ? base.envase : fallbackLotes.envase,
      envase_em_desvio: base.envase > 0 ? base.envase_em_desvio : fallbackLotes.envase_em_desvio,
      lavagem: base.lavagem > 0 ? base.lavagem : fallbackLotes.lavagem,
      lavagem_em_desvio: base.lavagem > 0 ? base.lavagem_em_desvio : fallbackLotes.lavagem_em_desvio,
      nao_iniciado: base.nao_iniciado > 0 ? base.nao_iniciado : fallbackLotes.nao_iniciado,
      nao_iniciado_em_desvio: base.nao_iniciado > 0 ? base.nao_iniciado_em_desvio : fallbackLotes.nao_iniciado_em_desvio,
    };

    return recalcularTotalGapPorEtapa(combinado);
  };

  const calcularStatusOperacionalPelosLotes = (somentePrevistoAteHoje: boolean): GapPorEtapaNormalizado => {
    // Acumula em float e só arredonda o total no final -- somar valores JÁ
    // arredondados por lote (como fazia antes com previstoCx/perdaRendimentoCx)
    // pode divergir 1 cx do valor oficial, o mesmo tipo de erro de acúmulo de
    // arredondamento que já foi corrigido no backend (qtd_gap_cx_float /
    // qtd_perda_rendimento_cx_float). Usa os campos em float quando existirem,
    // com fallback pros campos antigos pra não quebrar em respostas antigas do backend.
    //
    // Etapa física (embalagem/envase/lavagem/não iniciado) agora é calculada
    // independente de estar ou não em desvio aberto -- mesmo ajuste feito no
    // backend (_etapa_fisica_lote). Antes, um lote já embalado que caísse em
    // desvio virava só "em desvio" e sumia do card de "Embalados não
    // liberados", fazendo esse card parecer menor do que a etapa real.
    const acumulado = {
      reprovacao_desvio: 0,
      desvio_aberto: 0,
      atraso_producao: 0,
      rendimento: 0,
      embalagem: 0,
      embalagem_em_desvio: 0,
      envase: 0,
      envase_em_desvio: 0,
      lavagem: 0,
      lavagem_em_desvio: 0,
      nao_iniciado: 0,
      nao_iniciado_em_desvio: 0,
    };

    for (const lote of data?.lotes ?? []) {
      if (somentePrevistoAteHoje && !lote.considerar_previsto_ate_hoje) continue;

      const previstoCxFloat = Number(lote.qtd_prevista_cx_float ?? lote.qtd_prevista_cx ?? 0);
      const liberadoCxFloat = Number(lote.qtd_liberada_cx ?? 0);
      const perdaRendimentoCxFloat = Number(
        lote.qtd_perda_rendimento_cx_float
          ?? lote.qtd_perda_rendimento_cx
          ?? Math.max(previstoCxFloat - liberadoCxFloat, 0),
      );

      if (loteEhReprovacaoOuDescarte(lote)) {
        acumulado.reprovacao_desvio += previstoCxFloat;
        continue;
      }
      if (lote.atraso_producao || lote.reprogramado || lote.status_gap === "Atraso de produção") {
        acumulado.atraso_producao += previstoCxFloat;
        continue;
      }
      if (lote.check_liberado) {
        if (lote.perda_rendimento) acumulado.rendimento += perdaRendimentoCxFloat;
        continue;
      }

      const emDesvio = Boolean(lote.em_desvio);
      if (lote.check_embalagem) {
        acumulado.embalagem += previstoCxFloat;
        if (emDesvio) acumulado.embalagem_em_desvio += previstoCxFloat;
      } else if (lote.check_envase) {
        acumulado.envase += previstoCxFloat;
        if (emDesvio) acumulado.envase_em_desvio += previstoCxFloat;
      } else if (lote.check_lavagem) {
        acumulado.lavagem += previstoCxFloat;
        if (emDesvio) acumulado.lavagem_em_desvio += previstoCxFloat;
      } else {
        acumulado.nao_iniciado += previstoCxFloat;
        if (emDesvio) acumulado.nao_iniciado_em_desvio += previstoCxFloat;
      }
      if (emDesvio) acumulado.desvio_aberto += previstoCxFloat;
    }

    // normalizarGapPorEtapa já arredonda cada campo (uma vez, no total) e
    // recalcula o total somado -- não precisa passar por recalcularTotalGapPorEtapa de novo.
    return normalizarGapPorEtapa(acumulado);
  };

  const statusOperacionalMesPelosLotes = useMemo(
    () => calcularStatusOperacionalPelosLotes(false),
    [data?.lotes],
  );

  const statusOperacionalMtdPelosLotes = useMemo(
    () => calcularStatusOperacionalPelosLotes(true),
    [data?.lotes],
  );

  const perdaProducaoReprogramadosSimples = useMemo(() => {
    const valorBackend = Math.round(Number(data?.perda_producao_reprogramados_simples ?? 0));

    const valorPelosLotesFloat = (data?.lotes ?? []).reduce((acc, lote) => {
      if (loteEhReprovacaoOuDescarte(lote)) return acc;

      const ehPerdaProducao =
        Boolean(lote.reprogramado) ||
        Boolean(lote.atraso_producao) ||
        lote.status_gap === "Atraso de produção";

      if (!ehPerdaProducao) return acc;

      const qtd = Number(lote.qtd_gap_cx_float ?? lote.qtd_gap_cx ?? lote.qtd_prevista_cx_float ?? lote.qtd_prevista_cx ?? 0);
      return acc + qtd;
    }, 0);
    const valorPelosLotes = Math.round(valorPelosLotesFloat);

    return Math.max(valorBackend, valorPelosLotes);
  }, [data?.perda_producao_reprogramados_simples, data?.lotes]);

  const gapPorStatusMes = useMemo(() => {
    const perdas = data?.mes_perdas_vs_v1_por_causa;
    const etapas = data?.mes_gap_por_etapa;

    const baseMes = normalizarGapPorEtapa({
      reprovacao_desvio: perdas?.reprovacao_desvio ?? etapas?.reprovacao_desvio,
      atraso_producao: perdas?.atraso_producao ?? etapas?.atraso_producao,
      rendimento: perdas?.rendimento ?? etapas?.rendimento,
      outros: perdas?.outros,
      desvio_aberto: etapas?.desvio_aberto ?? etapas?.desvio,
      embalagem: etapas?.embalagem,
      embalagem_em_desvio: etapas?.embalagem_em_desvio,
      envase: etapas?.envase,
      envase_em_desvio: etapas?.envase_em_desvio,
      lavagem: etapas?.lavagem,
      lavagem_em_desvio: etapas?.lavagem_em_desvio,
      nao_iniciado: etapas?.nao_iniciado,
      nao_iniciado_em_desvio: etapas?.nao_iniciado_em_desvio,
    } as any);

    const combinado = aplicarFallbackOperacionalDosLotes(baseMes, statusOperacionalMesPelosLotes);

    if (perdaProducaoReprogramadosSimples > combinado.atraso_producao) {
      return recalcularTotalGapPorEtapa({
        ...combinado,
        atraso_producao: perdaProducaoReprogramadosSimples,
      });
    }

    return combinado;
  }, [
    data?.mes_perdas_vs_v1_por_causa,
    data?.mes_gap_por_etapa,
    statusOperacionalMesPelosLotes,
    perdaProducaoReprogramadosSimples,
  ]);

  const gapPorStatusMtd = useMemo(
    () => aplicarFallbackOperacionalDosLotes(
      normalizarGapPorEtapa(data?.mtd_gap_por_etapa),
      statusOperacionalMtdPelosLotes,
    ),
    [data?.mtd_gap_por_etapa, statusOperacionalMtdPelosLotes],
  );

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
  const mesAcrescimoPlanoAtual = Number(data?.mes_cx_acrescimo_plano_atual ?? 0);
  const mesGanhoRendimento = Number(data?.mes_cx_ganho_rendimento ?? data?.mes_perdas_vs_v1_por_causa?.ganho_rendimento ?? 0);
  const mesPerdasBrutasVsV1 = Number(
    data?.mes_cx_perdas_brutas_vs_v1 ?? gapPorStatusMes.total,
  );
  const mesReconciliadoV1 = Number(
    data?.mes_cx_reconciliado_v1
      ?? Math.round(mesPlanoAtualTendencia + mesPerdasBrutasVsV1 - mesAcrescimoPlanoAtual - mesGanhoRendimento),
  );

  const mtdPrevistoV1 = Number(data?.mtd_cx_previsto ?? 0);
  const mtdLiberado = Number(data?.mtd_cx_liberado ?? 0);
const mtdGap = Number(data?.mtd_cx_gap ?? Math.max(mtdPrevistoV1 - mtdLiberado, 0));

const lotesPerdaProducao = useMemo<AtrasoProducaoLote[]>(() => {
  const backend = data?.atraso_producao_lotes ?? [];
  if (backend.length > 0) return backend;

  return (data?.lotes ?? [])
    .filter((l) => l.atraso_producao || l.reprogramado || l.status_gap === "Atraso de produção")
    .map((l) => ({
      lote: l.lote,
      grupo: l.grupo,
      produto: l.sku_pa || l.grupo,
      qtd_prevista_cx: l.qtd_prevista_cx,
      qtd_prevista_tb: l.qtd_prevista_tb,
      data_inicio_prevista: l.data_inicio,
      data_fim_prevista: l.data_fim,
      data_lib_prevista: l.data_lib,
      data_fim_atual: l.data_fim_atual,
      data_lib_atual: l.data_lib_atual,
      mes_previsto_atual: l.mes_previsto_atual,
      ano_previsto_atual: l.ano_previsto_atual,
      status_atual: l.status_gap,
      motivo: l.motivo_gap,
      explicacao: l.motivo_gap || "Lote saiu da liberação mensal prevista na V1.",
      check_lavagem: l.check_lavagem,
      check_envase: l.check_envase,
      check_embalagem: l.check_embalagem,
      check_liberado: l.check_liberado,
      em_desvio: l.em_desvio,
      desvio_reprovacao: l.desvio_reprovacao,
    }));
}, [data]);

const textoPercentualV1 = (valor: number) =>
    mesPrevistoV1 > 0
      ? `${fmtPercent((Number(valor || 0) / mesPrevistoV1) * 100)}% da V1`
      : "0,0% da V1";

  const textoPercentualMtd = (valor: number) =>
    mtdGap > 0
      ? `${fmtPercent((Number(valor || 0) / mtdGap) * 100)}% do faltante até hoje`
      : "0,0% do faltante até hoje";

  const perdasMes = [
    {
      label: "Perda reprovação/desvio",
      value: gapPorStatusMes.reprovacao_desvio,
      color: "#92400E",
      icon: AlertTriangle,
      filtro: "REPROVACAO_DESVIO",
    },
    {
      label: "Perda produção",
      value: gapPorStatusMes.atraso_producao,
      color: "#DC2626",
      icon: Clock,
      filtro: "ATRASO_PRODUCAO",
    },
    {
      label: "Perda rendimento",
      value: gapPorStatusMes.rendimento,
      color: "#6B7280",
      icon: TrendingDown,
      filtro: "RENDIMENTO",
    },
    {
      label: "Ganho rendimento",
      value: mesGanhoRendimento,
      color: "#16A34A",
      icon: TrendingUp,
      filtro: "LIBERADO",
    },
    ...(gapPorStatusMes.outros > 0
      ? [{
          label: "Outras perdas/ajustes",
          value: gapPorStatusMes.outros,
          color: "#7C2D12",
          icon: AlertTriangle,
          filtro: "OBSERVACAO_MANUAL",
        }]
      : []),
  ];

  const mesCardsCount = 3 + perdasMes.length;

  // Só as etapas físicas aqui -- reprovação/desvio, atraso de produção e
  // rendimento já aparecem na fileira sempre visível (perdasMes) logo acima
  // deste painel, com o mesmo clique-pra-filtrar. Repetir esses 3 cards aqui
  // dentro era pura duplicação visual.
  const montarStatusCards = (base: GapPorEtapaNormalizado) => [
    {
      label: "Embalados não liberados",
      value: base.embalagem,
      emDesvio: base.embalagem_em_desvio,
      color: "#EA580C",
      icon: Package,
      filtro: "EMBALAGEM",
    },
    {
      label: "Envasados não embalados",
      value: base.envase,
      emDesvio: base.envase_em_desvio,
      color: "#2563EB",
      icon: Waves,
      filtro: "ENVASE",
    },
    {
      label: "Lavados não envasados",
      value: base.lavagem,
      emDesvio: base.lavagem_em_desvio,
      color: "#0891B2",
      icon: Droplet,
      filtro: "LAVAGEM",
    },
    {
      label: "Não iniciados",
      value: base.nao_iniciado,
      emDesvio: base.nao_iniciado_em_desvio,
      color: "#CA8A04",
      icon: Droplets,
      filtro: "NAO_INICIADO",
    },
  ];

  const totalLiberadoAcompanhamento = apenasAtrasados ? mtdLiberado : mesRealizado;
  const totalPrevistoAcompanhamento = apenasAtrasados ? mtdPrevistoV1 : mesPrevistoV1;
  const textoPercentualLiberado = totalPrevistoAcompanhamento > 0
    ? `${fmtPercent((totalLiberadoAcompanhamento / totalPrevistoAcompanhamento) * 100)}% do previsto ${apenasAtrasados ? "até hoje" : "no mês (V1)"}`
    : "0,0% do previsto";

  const statusAcompanhamentoBruto = [
    {
      label: "Liberados",
      value: totalLiberadoAcompanhamento,
      color: "#16A34A",
      icon: CheckCircle2,
      filtro: "LIBERADO",
      percentualTexto: textoPercentualLiberado,
    },
    ...montarStatusCards(apenasAtrasados ? gapPorStatusMtd : gapPorStatusMes),
  ];

  // Total em desvio aberto (soma das 4 etapas) -- não é mais um card na
  // grade, virou um aviso discreto no cabeçalho do painel (ver render mais
  // abaixo). Continua fora da soma/reconciliação com o previsto, porque já
  // está embutido dentro dos cards de etapa -- somar de novo aqui infla o
  // total além do previsto.
  const gapPorStatusAcompanhamento = apenasAtrasados ? gapPorStatusMtd : gapPorStatusMes;
  const totalEmDesvioAcompanhamento = gapPorStatusAcompanhamento.desvio_aberto;
  const qtdLotesEmDesvioAcompanhamento = (data?.lotes ?? []).filter(
    (l) => Boolean(l.em_desvio) && etapaFisicaLote(l) !== null,
  ).length;

  // Ajuste de arredondamento: cada card já vem arredondado individualmente
  // (na origem, back ou fallback dos lotes), então a soma pode ficar 1 cx
  // acima/abaixo do previsto total. Em vez de deixar essa sobra aparecer só
  // "boiando", jogamos ela no card de maior volume (normalmente "Não
  // iniciados") -- lá 1 cx não muda leitura nenhuma, e a soma dos cards
  // sempre bate com o previsto total.
  //
  // Importante: este painel só mostra Liberados + as 4 etapas físicas.
  // Reprovação/desvio, atraso de produção e rendimento saíram daqui (já
  // aparecem na fileira sempre visível acima) -- por isso o "previsto" de
  // referência para ESTES cards precisa descontar essas 3 fatias do V1
  // total, senão a comparação acha uma "sobra" enorme (o tamanho das 3
  // categorias removidas) e distorce o card de maior volume tentando
  // absorver isso como se fosse um simples arredondamento de 1 cx.
  const totalPrevistoCardsFisicos = Math.max(
    totalPrevistoAcompanhamento
      - gapPorStatusAcompanhamento.reprovacao_desvio
      - gapPorStatusAcompanhamento.atraso_producao
      - gapPorStatusAcompanhamento.rendimento,
    0,
  );

  const somaCardsAcompanhamento = statusAcompanhamentoBruto.reduce((acc, c) => acc + c.value, 0);
  const deltaArredondamentoAcompanhamento =
    totalPrevistoCardsFisicos > 0
      ? Math.round(totalPrevistoCardsFisicos) - Math.round(somaCardsAcompanhamento)
      : 0;

  const statusAcompanhamento = (() => {
    if (deltaArredondamentoAcompanhamento === 0) return statusAcompanhamentoBruto;
    const indiceMaior = statusAcompanhamentoBruto.reduce(
      (melhorIdx, c, idx, arr) => (c.value > arr[melhorIdx].value ? idx : melhorIdx),
      0,
    );
    return statusAcompanhamentoBruto.map((c, idx) =>
      idx === indiceMaior ? { ...c, value: Math.max(c.value + deltaArredondamentoAcompanhamento, 0) } : c,
    );
  })();
  const tituloAcompanhamento = apenasAtrasados
    ? "Lotes previstos até hoje pela V1"
    : `Acompanhamento lotes: ${MES_LABELS[mesSelecionado - 1]}/${anoSelecionado}`;
  const textoResumoAcompanhamento = apenasAtrasados
    ? `Planejado até hoje: ${fmt(mtdPrevistoV1)} cx — liberado: ${fmt(mtdLiberado)} cx — diferença: ${fmt(mtdGap)} cx`
    : `V1 do mês: ${fmt(mesPrevistoV1)} cx — plano atualizado: ${fmt(mesPlanoAtualTendencia)} cx — diferença: ${fmt(Math.abs(mesDiferencaVsV1))} cx`;
  const textoApoioAcompanhamento = apenasAtrasados
    ? "Abaixo, os lotes vencidos pela V1 separados pelo status operacional atual."
    : "Abaixo, os lotes do mês completo separados pelo status operacional atual.";
  const textoPercentualAcompanhamento = (valor: number) => (apenasAtrasados ? textoPercentualMtd(valor) : textoPercentualV1(valor));

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
    "px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-right whitespace-nowrap";

  const thLeft =
    "px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-left";

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

    const headers = ["Lote","OP","Grupo","Status gap","Destino/Motivo","Data Lib. V1","Data Lib. atual","Lavagem","Envase","Embalagem","Liberado","Tubetes","Caixas","Quarentena (98)","Liberado (cx)","Rendimento (%)","Em Desvio"];
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
        l.qtd_quarentena_cx ?? "",
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

  const [modalObservacao, setModalObservacao] = useState<{ lote: string; motivoAtual: string } | null>(null);
  const [motivoRascunho, setMotivoRascunho] = useState("");
  const [salvandoObservacao, setSalvandoObservacao] = useState(false);
  const [erroObservacao, setErroObservacao] = useState<string | null>(null);

  function abrirModalObservacaoManual(lote: LoteRastreamento) {
    if (!podeEditarObservacaoManual) return;
    setErroObservacao(null);
    setMotivoRascunho(lote.observacao_manual || "");
    setModalObservacao({ lote: lote.lote, motivoAtual: lote.observacao_manual || "" });
  }

  function fecharModalObservacaoManual() {
    if (salvandoObservacao) return;
    setModalObservacao(null);
    setErroObservacao(null);
  }

  async function confirmarObservacaoManual() {
    if (!modalObservacao || !data) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    const motivo = motivoRascunho.trim();

    setSalvandoObservacao(true);
    setErroObservacao(null);
    try {
      if (motivo) {
        await salvarLoteObservacaoManual(modalObservacao.lote, mesRef, anoRef, motivo);
      } else if (modalObservacao.motivoAtual) {
        await removerLoteObservacaoManual(modalObservacao.lote, mesRef, anoRef);
      }
      setModalObservacao(null);
      await carregar(true, true);
    } catch (erro: any) {
      setErroObservacao(erro?.message || "Não foi possível salvar a observação.");
    } finally {
      setSalvandoObservacao(false);
    }
  }

  async function removerObservacaoManualAtual() {
    if (!modalObservacao || !data) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;

    setSalvandoObservacao(true);
    setErroObservacao(null);
    try {
      await removerLoteObservacaoManual(modalObservacao.lote, mesRef, anoRef);
      setModalObservacao(null);
      await carregar(true, true);
    } catch (erro: any) {
      setErroObservacao(erro?.message || "Não foi possível remover a observação.");
    } finally {
      setSalvandoObservacao(false);
    }
  }

  const [modalLoteManual, setModalLoteManual] = useState(false);
  const [loteManualForm, setLoteManualForm] = useState({
    lote: "",
    grupo: "",
    caixas: "",
    dataLiberacao: "",
    motivo: "",
  });
  const [salvandoLoteManual, setSalvandoLoteManual] = useState(false);
  const [erroLoteManual, setErroLoteManual] = useState<string | null>(null);

  function abrirModalLoteManual() {
    if (!podeEditarObservacaoManual) return;
    setLoteManualForm({ lote: "", grupo: "", caixas: "", dataLiberacao: "", motivo: "" });
    setErroLoteManual(null);
    setModalLoteManual(true);
  }

  async function confirmarLoteManual() {
    if (!data) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    const caixas = Number(loteManualForm.caixas);

    if (!loteManualForm.lote.trim()) {
      setErroLoteManual("Informe o número do lote.");
      return;
    }
    if (!caixas || caixas <= 0) {
      setErroLoteManual("Informe uma quantidade de caixas válida.");
      return;
    }

    setSalvandoLoteManual(true);
    setErroLoteManual(null);
    try {
      await salvarLoteManualRastreamento(
        loteManualForm.lote.trim(),
        mesRef,
        anoRef,
        loteManualForm.grupo.trim(),
        caixas,
        loteManualForm.dataLiberacao,
        loteManualForm.motivo.trim()
      );
      setModalLoteManual(false);
      await carregar(true, true);
    } catch (erro: any) {
      setErroLoteManual(erro?.message || "Não foi possível salvar o lote.");
    } finally {
      setSalvandoLoteManual(false);
    }
  }

  async function removerLoteManual(lote: LoteRastreamento) {
    if (!data || !podeEditarObservacaoManual) return;
    if (!window.confirm(`Remover o lote manual ${lote.lote}? Ele deixa de contar no mês.`)) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    try {
      await removerLoteManualRastreamento(lote.lote, mesRef, anoRef);
      await carregar(true, true);
    } catch (erro: any) {
      window.alert(erro?.message || "Não foi possível remover o lote manual.");
    }
  }

  async function promoverLote(lote: LoteRastreamento) {
    if (!data || !podeEditarObservacaoManual) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    const qtd = Number(lote.qtd_prevista_cx || 0);
    if (
      !window.confirm(
        `Promover o lote ${lote.lote} (${qtd} cx) pro mês corrente?\n\n` +
          `Ele sai da pendência de ${MES_LABELS[mesRef - 1]}/${anoRef} (fica só registrado com a tag ` +
          `"Promovido") e passa a contar de verdade no Plano Atualizado do mês atual.`
      )
    ) {
      return;
    }
    try {
      await promoverLoteMesAtual(lote.lote, mesRef, anoRef, qtd, lote.grupo || null);
      await carregar(true, true);
    } catch (erro: any) {
      window.alert(erro?.message || "Não foi possível promover o lote.");
    }
  }

  async function desfazerPromocaoLote(lote: LoteRastreamento) {
    if (!data || !podeEditarObservacaoManual) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    if (!window.confirm(`Desfazer a promoção do lote ${lote.lote}? Ele volta a contar no mês original.`)) return;
    try {
      await removerPromocaoLote(lote.lote, mesRef, anoRef);
      await carregar(true, true);
    } catch (erro: any) {
      window.alert(erro?.message || "Não foi possível desfazer a promoção.");
    }
  }

  async function corrigirCodigoLote(lote: LoteRastreamento) {
    if (!podeEditarObservacaoManual) return;
    const loteCorreto = window.prompt(
      `O código "${lote.lote}" aparece errado em algum apontamento (ex.: erro de digitação na Cogtive)?\n\n` +
        `Digite o código CORRETO (o que está certo no planejamento/Gantt/MPS). ` +
        `A partir de agora, "${lote.lote}" sempre vai ser tratado como esse código correto, em todas as telas.`,
      ""
    );
    if (loteCorreto === null || !loteCorreto.trim()) return;
    if (!window.confirm(`Confirma: sempre que aparecer "${lote.lote}", tratar como "${loteCorreto.trim().toUpperCase()}"?`)) {
      return;
    }
    try {
      await criarLoteAlias(lote.lote, loteCorreto.trim());
      await carregar(true, true);
    } catch (erro: any) {
      window.alert(erro?.message || "Não foi possível salvar o de-para.");
    }
  }

  async function editarCaixasPlanejadas(lote: LoteRastreamento) {
    if (!data || !podeEditarObservacaoManual) return;
    const mesRef = data.mes ?? mesSelecionado;
    const anoRef = data.ano ?? anoSelecionado;
    const valorAtual = lote.qtd_prevista_ajustada_cx ?? lote.qtd_prevista_cx;
    const novoValor = window.prompt(
      `Ajustar caixas planejadas do lote ${lote.lote} (original: ${fmt(lote.qtd_prevista_cx)} cx).\n\n` +
        `Isso não muda o Planejado V1 (congelado) -- só o Plano Atualizado do mês, ` +
        `e o que aparece nesta coluna. Deixe em branco e confirme pra voltar ao valor original.`,
      String(valorAtual)
    );
    if (novoValor === null) return;

    try {
      if (novoValor.trim() === "") {
        if (lote.qtd_prevista_ajustada_cx == null) return;
        await removerAjustePlanejado(lote.lote, mesRef, anoRef);
      } else {
        const numero = Number(novoValor.replace(",", "."));
        if (!Number.isFinite(numero) || numero < 0) {
          window.alert("Digite um número válido (0 ou mais).");
          return;
        }
        await salvarAjustePlanejado(lote.lote, mesRef, anoRef, numero);
      }
      await carregar(true, true);
    } catch (erro: any) {
      window.alert(erro?.message || "Não foi possível salvar o ajuste.");
    }
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
        <div className="space-y-3">
          <div className="card overflow-hidden p-0">
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
              style={{ borderColor: "var(--border)", background: "#FFFFFF" }}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Visão mensal
                </p>
                <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                  Planejado de liberação do mês
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setModalAuditoria(true)}
                className="rounded-xl border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Ver conciliação
              </button>
            </div>

            <div className="overflow-x-auto">
              <div
                className="grid gap-px"
                style={{
                  gridTemplateColumns: `repeat(${mesCardsCount}, minmax(155px, 1fr))`,
                  minWidth: `${mesCardsCount * 165}px`,
                  background: "var(--border)",
                }}
              >
                <div className="relative min-h-[92px] overflow-hidden bg-white p-4 flex items-center gap-3">
                  <Lock size={64} strokeWidth={1.5} style={{ position: "absolute", right: -10, bottom: -14, color: "#1D4ED8", opacity: 0.06, pointerEvents: "none" }} />
                  <div className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl" style={{ background: "#1D4ED817" }}>
                    <Lock size={20} strokeWidth={2.25} style={{ color: "#1D4ED8" }} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Planejado V1
                    </p>
                    <p className="text-lg font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
                      {fmt(mesPrevistoV1)} cx
                    </p>
                    <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {fmtTubetes(mesPrevistoV1)} tubetes · V1 congelada
                    </p>
                  </div>
                </div>

                <div className="relative min-h-[92px] overflow-hidden bg-white p-4 flex items-center gap-3">
                  <RefreshCw size={64} strokeWidth={1.5} style={{ position: "absolute", right: -10, bottom: -14, color: "#0F766E", opacity: 0.06, pointerEvents: "none" }} />
                  <div className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl" style={{ background: "#0F766E17" }}>
                    <RefreshCw size={20} strokeWidth={2.25} style={{ color: "#0F766E" }} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Plano atualizado
                    </p>
                    <p className="text-lg font-bold leading-tight" style={{ color: "#0F766E" }}>
                      {fmt(mesPlanoAtualTendencia)} cx
                    </p>
                    <p className="truncate text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                      Real {fmt(mesRealizado)} cx + saldo {fmt(mesSaldoTendencia)} cx
                    </p>
                  </div>
                </div>

                <div
                  className="relative min-h-[92px] overflow-hidden p-4 flex items-center gap-3"
                  style={{
                    background: mesDiferencaVsV1 > 0 ? "rgba(254,242,242,0.95)" : "rgba(240,253,244,0.95)",
                    boxShadow: "inset 0 0 0 1px " + (mesDiferencaVsV1 > 0 ? "rgba(239,68,68,0.22)" : "rgba(34,197,94,0.22)"),
                  }}
                >
                  <TrendingDown size={64} strokeWidth={1.5} style={{ position: "absolute", right: -10, bottom: -14, color: mesDiferencaVsV1 > 0 ? "#DC2626" : "#16A34A", opacity: 0.07, pointerEvents: "none" }} />
                  <div
                    className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl"
                    style={{ background: mesDiferencaVsV1 > 0 ? "#DC262617" : "#16A34A17" }}
                  >
                    <TrendingDown size={20} strokeWidth={2.25} style={{ color: mesDiferencaVsV1 > 0 ? "#DC2626" : "#16A34A" }} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Diferença vs V1
                    </p>
                    <p className="text-lg font-bold leading-tight" style={{ color: mesDiferencaVsV1 > 0 ? "#B91C1C" : "#15803D" }}>
                      {mesDiferencaVsV1 > 0 ? "-" : mesDiferencaVsV1 < 0 ? "+" : ""}{fmt(Math.abs(mesDiferencaVsV1))} cx
                    </p>
                    <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {fmtTubetes(Math.abs(mesDiferencaVsV1))} tubetes · Líquido vs V1
                    </p>
                  </div>
                </div>

                {perdasMes.map((k) => (
                  <button
                    key={k.label}
                    type="button"
                    onClick={() => {
                      setFiltroEtapa(filtroEtapa === k.filtro ? "" : k.filtro);
                      setFiltroEmbalado("");
                      setApenasAtrasados(false);
                      setSelecionados(new Set());
                    }}
                    className="relative min-h-[92px] overflow-hidden bg-white p-4 text-left transition-all hover:bg-slate-50 flex items-center gap-3"
                    style={{
                      boxShadow: filtroEtapa === k.filtro ? `inset 0 0 0 2px ${k.color}` : "none",
                      opacity: k.value === 0 ? 0.45 : 1,
                      cursor: "pointer",
                    }}
                  >
                    <k.icon size={64} strokeWidth={1.5} style={{ position: "absolute", right: -10, bottom: -14, color: k.color, opacity: 0.06, pointerEvents: "none" }} />
                    <div className="flex h-10 w-10 min-w-10 items-center justify-center rounded-xl" style={{ background: `${k.color}17` }}>
                      <k.icon size={20} strokeWidth={2.25} style={{ color: k.color }} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                        {k.label}
                      </p>
                      <p className="text-lg font-bold leading-tight" style={{ color: k.value > 0 ? k.color : "var(--text-secondary)" }}>
                        {fmt(k.value)} cx
                      </p>
                      <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                        {fmtTubetes(k.value)} tubetes · {textoPercentualV1(k.value)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`card overflow-hidden p-0 shadow-none ${acompanhamentoHojeAberto ? "rounded-b-none border-b-0" : ""}`}>
            <div
              className="px-5 py-4"
              style={{ background: "#173A5E", color: "white" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                    <AlertTriangle size={16} style={{ color: "#FDE68A" }} />
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                      Status operacional
                    </p>
                    <h3 className="text-base font-bold text-white">
                      {tituloAcompanhamento}
                    </h3>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {totalEmDesvioAcompanhamento > 0 && (
                    <button
                      type="button"
                      title="Filtrar lotes em desvio aberto"
                      onClick={() => {
                        setFiltroEtapa(filtroEtapa === "DESVIO" ? "" : "DESVIO");
                        setFiltroEmbalado("");
                        setSelecionados(new Set());
                        if (!acompanhamentoHojeAberto) setAcompanhamentoHojeAberto(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold transition hover:bg-red-50"
                      style={{
                        boxShadow: filtroEtapa === "DESVIO" ? "inset 0 0 0 2px #DC2626" : "inset 0 0 0 1px rgba(0,0,0,0.06)",
                        color: "#1F2937",
                      }}
                    >
                      <AlertTriangle size={14} strokeWidth={2.5} style={{ color: "#DC2626" }} />
                      {qtdLotesEmDesvioAcompanhamento === 1
                        ? "1 lote em desvio"
                        : `${qtdLotesEmDesvioAcompanhamento} lotes em desvio`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAcompanhamentoHojeAberto((v) => !v)}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/15"
                    aria-expanded={acompanhamentoHojeAberto}
                  >
                    {acompanhamentoHojeAberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {acompanhamentoHojeAberto ? "Minimizar" : "Abrir"}
                  </button>
                </div>
              </div>
            </div>

            {acompanhamentoHojeAberto && (
              <>
            <div
              className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5"
              style={{ background: "var(--border)" }}
            >
              {statusAcompanhamento.map((k) => (
                <button
                  key={k.label}
                  type="button"
                  onClick={() => {
                    setFiltroEtapa(filtroEtapa === k.filtro ? "" : k.filtro);
                    setFiltroEmbalado("");
                    setSelecionados(new Set());
                  }}
                  className="relative overflow-hidden px-4 py-3 text-left transition-all"
                  style={{
                    background:
                      filtroEtapa === k.filtro
                        ? "#EFF6FF"
                        : "#FAFBFD",
                    opacity: k.value === 0 ? 0.35 : 1,
                    cursor: k.value === 0 ? "default" : "pointer",
                  }}
                >
                <k.icon size={60} strokeWidth={1.5} style={{ position: "absolute", right: -10, bottom: -14, color: k.color, opacity: 0.06, pointerEvents: "none" }} />
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 min-w-9 items-center justify-center rounded-xl" style={{ background: `${k.color}17` }}>
                    <k.icon size={18} strokeWidth={2.25} style={{ color: k.color }} />
                  </div>
                  <div>
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {k.label}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                      <p
                        className="text-lg font-bold leading-tight"
                        style={{ color: k.value > 0 ? k.color : "var(--text-secondary)" }}
                      >
                        {fmt(k.value)} cx
                      </p>
                      {Boolean((k as any).emDesvio) && (
                        <span
                          title={`${fmt((k as any).emDesvio)} cx em desvio aberto`}
                          className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ background: "rgba(220,38,38,0.12)", color: "#DC2626" }}
                        >
                          {fmt((k as any).emDesvio)} desvio
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {fmtTubetes(k.value)} tubetes
                    </p>
                  </div>
                </div>
                </button>
              ))}
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {acompanhamentoHojeAberto && (
        <div
          className="card -mt-7 overflow-hidden rounded-t-none border-t-0 p-0 shadow-none"
          style={{ background: "#FFFFFF", boxShadow: "none" }}
        >
          <div
            className="border-b px-4 py-3"
            style={{ borderColor: "var(--border)", background: "#FFFFFF" }}
          >
      <div className="flex flex-wrap items-end gap-3">
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

        <button
          onClick={exportarExcel}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          <Download size={13} />
          Exportar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
        </button>

        {podeEditarObservacaoManual && (
          <button
            onClick={abrirModalLoteManual}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            title="Adicionar um lote que o sistema automático não está enxergando"
          >
            <Plus size={13} />
            Adicionar lote
          </button>
        )}

        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-secondary)" }}
          />
          <input
            type="text"
            value={buscaLote}
            onChange={(e) => setBuscaLote(e.target.value)}
            placeholder="Buscar lote, OP, grupo ou destino..."
            className="rounded-lg border py-2 pl-8 pr-8 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-primary)",
              background: "var(--bg-secondary)",
              minWidth: 260,
            }}
          />
          {buscaLote && (
            <button
              onClick={() => setBuscaLote("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <p className="pb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          {lotesFiltrados.length} lote
          {lotesFiltrados.length !== 1 ? "s" : ""}
        </p>
      </div>
          </div>

      {!data ? (
        <div
          className="p-10 text-center text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          <RefreshCw
            size={24}
            className="mx-auto mb-3 animate-spin"
            style={{ opacity: 0.4 }}
          />
          {loading ? "Carregando rastreamento..." : "Tentando carregar de novo..."}
        </div>
      ) : (
        <div className="overflow-hidden p-0">
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
                <tr
                  style={{
                    background: "#F1F5F9",
                    color: "#475569",
                    boxShadow: "inset 0 -1px 0 var(--border)",
                  }}
                >
                  <th className="px-3 py-3 text-center" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={todosSelecionados}
                      ref={(el) => { if (el) el.indeterminate = algunsSelecionados; }}
                      onChange={toggleTodos}
                      style={{ cursor: "pointer", accentColor: "var(--bg-sidebar)" }}
                    />
                  </th>
                  <th className={thLeft}>OP</th>
                  <th className={thLeft}>Lote</th>
                  <th className={thLeft}>Grupo</th>
                  <th className={thLeft}>Status</th>
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
                    className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider"
                    style={{ minWidth: 280 }}
                  >
                    Etapas
                  </th>
                  <th className={thBase}>Tubetes</th>
                  <th className={thBase} title="Clica no lápis pra ajustar manualmente, quando já se sabe que o rendimento vai ficar abaixo do planejado original">
                    Caixas Planejadas
                  </th>
                  <th className={thBase} title="Saldo em quarentena (armazém 98) -- já reflete o rendimento real, antes da liberação formal">
                    98 (Quarentena)
                  </th>
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
                                ? "#FCFCFB"
                                : "#FFFFFF",
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
                      <td
                        className="px-3 py-3 font-mono text-xs"
                        style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}
                      >
                        {l.ordem_op ? `OP ${l.ordem_op}` : "—"}
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
                        <div className="flex items-center gap-1.5">
                          {(getDesvioDestino(l) || l.motivo_gap || l.status_gap) ? (
                            <span
                              className="inline-flex max-w-[260px] items-center rounded-full px-2 py-1 text-[11px] font-semibold"
                              title={(getDesvioDestino(l) || l.motivo_gap || l.status_gap) || undefined}
                              style={{
                                background: l.observacao_manual
                                  ? "#EDE9FE"
                                  : String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
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
                                color: l.observacao_manual
                                  ? "#5B21B6"
                                  : String(getDesvioDestino(l) || l.motivo_gap || l.status_gap)
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

                          {podeEditarObservacaoManual && !l.check_liberado && (
                            <button
                              type="button"
                              onClick={() => abrirModalObservacaoManual(l)}
                              title={
                                l.observacao_manual
                                  ? "Editar ou remover observação manual"
                                  : "Adicionar observação manual (ex.: aguardando aprovação externa)"
                              }
                              className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              <Pencil size={12} />
                            </button>
                          )}

                          {podeEditarObservacaoManual && l.lote_manual && (
                            <button
                              type="button"
                              onClick={() => removerLoteManual(l)}
                              title="Remover lote adicionado manualmente"
                              className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                              style={{ color: "#B45309" }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}

                          {podeEditarObservacaoManual &&
                            !l.check_liberado &&
                            !l.desvio_reprovacao &&
                            !l.promovido_para &&
                            (mesSelecionado !== new Date().getMonth() + 1 ||
                              anoSelecionado !== new Date().getFullYear()) && (
                              <button
                                type="button"
                                onClick={() => promoverLote(l)}
                                title="Promover pro mês corrente"
                                className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                                style={{ color: "#0F6E5A" }}
                              >
                                <ArrowUpCircle size={12} />
                              </button>
                            )}

                          {podeEditarObservacaoManual && l.promovido_para && (
                            <button
                              type="button"
                              onClick={() => desfazerPromocaoLote(l)}
                              title="Desfazer promoção"
                              className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                              style={{ color: "#B45309" }}
                            >
                              <Undo2 size={12} />
                            </button>
                          )}

                          {podeEditarObservacaoManual && (
                            <button
                              type="button"
                              onClick={() => corrigirCodigoLote(l)}
                              title='Corrigir código deste lote (de-para permanente, ex.: erro de digitação na Cogtive)'
                              className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                              style={{ color: "#6B7280" }}
                            >
                              <LinkIcon size={12} />
                            </button>
                          )}
                        </div>
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
                        style={{ color: l.qtd_prevista_ajustada_cx != null ? "#B45309" : "var(--text-primary)" }}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {l.qtd_prevista_ajustada_cx != null && (
                            <span
                              className="text-xs font-normal line-through"
                              style={{ color: "var(--text-secondary)" }}
                              title="Valor planejado original (V1), antes do ajuste manual"
                            >
                              {fmt(l.qtd_prevista_cx)}
                            </span>
                          )}
                          <span title={l.qtd_prevista_ajustada_cx != null ? "Ajustado manualmente" : undefined}>
                            {l.qtd_prevista_ajustada_cx != null
                              ? fmt(l.qtd_prevista_ajustada_cx)
                              : l.qtd_prevista_cx > 0 ? fmt(l.qtd_prevista_cx) : "—"}
                          </span>
                          {podeEditarObservacaoManual && (
                            <button
                              type="button"
                              onClick={() => editarCaixasPlanejadas(l)}
                              title="Ajustar caixas planejadas manualmente"
                              className="shrink-0 rounded p-0.5 transition-colors hover:bg-black/5"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      </td>

                      <td
                        className="px-3 py-3 text-right text-sm font-semibold"
                        style={{ color: l.qtd_quarentena_cx != null ? "#7C3AED" : "var(--text-secondary)" }}
                        title={
                          l.qtd_quarentena_cx != null
                            ? "Saldo físico em quarentena -- usado no Plano Atualizado em vez do planejado"
                            : undefined
                        }
                      >
                        {l.qtd_quarentena_cx != null ? fmt(l.qtd_quarentena_cx) : "—"}
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

      {modalObservacao &&
        createPortal(
          <div
            onClick={(event) => {
              if (event.target === event.currentTarget) fecharModalObservacaoManual();
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              backdropFilter: "blur(4px)",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <div
              className="fade-in"
              style={{
                width: "100%",
                maxWidth: 480,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "20px 24px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                    Observação manual
                  </h2>
                  <p
                    className="font-mono"
                    style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}
                  >
                    Lote {modalObservacao.lote}
                  </p>
                </div>

                <button
                  onClick={fecharModalObservacaoManual}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    padding: 4,
                    display: "flex",
                    borderRadius: 6,
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: "20px 24px" }}>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                  Use quando o motivo de não liberar este mês não se encaixa nas causas padrão
                  (reprovação/desvio, atraso de produção, rendimento) — ex.: aguardando aprovação
                  regulatória externa. O lote sai da conta normal do mês e entra no card{" "}
                  <strong>Outros</strong>, até ser liberado de verdade.
                </p>

                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  Motivo
                </label>
                <textarea
                  autoFocus
                  value={motivoRascunho}
                  onChange={(e) => setMotivoRascunho(e.target.value)}
                  placeholder='Ex.: "Aguardando aprovação regulatória X para ser liberado"'
                  rows={3}
                  disabled={salvandoObservacao}
                  className="text-sm outline-none"
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    padding: "10px 12px",
                    resize: "vertical",
                  }}
                />

                {erroObservacao && (
                  <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>{erroObservacao}</p>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "16px 24px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--bg-primary)",
                }}
              >
                {modalObservacao.motivoAtual ? (
                  <button
                    onClick={removerObservacaoManualAtual}
                    disabled={salvandoObservacao}
                    className="text-xs font-semibold transition-colors hover:underline"
                    style={{ color: "#DC2626", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Remover observação
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={fecharModalObservacaoManual}
                    disabled={salvandoObservacao}
                    className="rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarObservacaoManual}
                    disabled={salvandoObservacao || !motivoRascunho.trim()}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-white transition-opacity"
                    style={{
                      background: "var(--bg-sidebar)",
                      opacity: salvandoObservacao || !motivoRascunho.trim() ? 0.5 : 1,
                    }}
                  >
                    {salvandoObservacao ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {modalLoteManual &&
        createPortal(
          <div
            onClick={(event) => {
              if (event.target === event.currentTarget && !salvandoLoteManual) setModalLoteManual(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              backdropFilter: "blur(4px)",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <div
              className="fade-in"
              style={{
                width: "100%",
                maxWidth: 480,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "20px 24px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                  Adicionar lote manualmente
                </h2>
                <button
                  onClick={() => setModalLoteManual(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, display: "flex", borderRadius: 6 }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: "20px 24px", display: "grid", gap: 12 }}>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                  Use quando um lote já liberado (ou que vai ser) não aparece aqui porque não está
                  no Gantt/MPS automático. Ele entra na tabela e soma nas caixas do mês, igual um
                  lote real.
                </p>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                    Lote
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={loteManualForm.lote}
                    onChange={(e) => setLoteManualForm((f) => ({ ...f, lote: e.target.value }))}
                    placeholder="Ex.: 2603C2014"
                    disabled={salvandoLoteManual}
                    className="text-sm outline-none"
                    style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "8px 12px" }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                      Grupo (opcional)
                    </label>
                    <input
                      type="text"
                      value={loteManualForm.grupo}
                      onChange={(e) => setLoteManualForm((f) => ({ ...f, grupo: e.target.value }))}
                      placeholder="Ex.: ARTICAINE"
                      disabled={salvandoLoteManual}
                      className="text-sm outline-none"
                      style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "8px 12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                      Caixas
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={loteManualForm.caixas}
                      onChange={(e) => setLoteManualForm((f) => ({ ...f, caixas: e.target.value }))}
                      placeholder="Ex.: 600"
                      disabled={salvandoLoteManual}
                      className="text-sm outline-none"
                      style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "8px 12px" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                    Data de liberação (opcional)
                  </label>
                  <input
                    type="date"
                    value={loteManualForm.dataLiberacao}
                    onChange={(e) => setLoteManualForm((f) => ({ ...f, dataLiberacao: e.target.value }))}
                    disabled={salvandoLoteManual}
                    className="text-sm outline-none"
                    style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "8px 12px" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                    Observação (opcional)
                  </label>
                  <textarea
                    value={loteManualForm.motivo}
                    onChange={(e) => setLoteManualForm((f) => ({ ...f, motivo: e.target.value }))}
                    placeholder='Ex.: "Lote fora do MPS, controlado à parte"'
                    rows={2}
                    disabled={salvandoLoteManual}
                    className="text-sm outline-none"
                    style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", padding: "8px 12px", resize: "vertical" }}
                  />
                </div>

                {erroLoteManual && (
                  <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>{erroLoteManual}</p>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  padding: "16px 24px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--bg-primary)",
                }}
              >
                <button
                  onClick={() => setModalLoteManual(false)}
                  disabled={salvandoLoteManual}
                  className="rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarLoteManual}
                  disabled={salvandoLoteManual}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-white transition-opacity"
                  style={{ background: "var(--bg-sidebar)", opacity: salvandoLoteManual ? 0.5 : 1 }}
                >
                  {salvandoLoteManual ? "Salvando..." : "Adicionar"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}