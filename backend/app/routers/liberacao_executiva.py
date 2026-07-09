from __future__ import annotations

import math
import re
import time
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Query

from app.database import supabase
from app.routers import overview

router = APIRouter(prefix="/liberacao-executiva", tags=["liberacao-executiva"])

TUBETES_POR_CAIXA = 500.0
MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
PLANO1_JANEIRO_V3_CX_2026 = 220_534
ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026 = 1_016
_CACHE: dict[str, dict[str, Any]] = {}
CACHE_TTL_SEGUNDOS = 180


def _cache_get(chave: str):
    item = _CACHE.get(chave)
    if not item:
        return None
    if time.time() - item.get("ts", 0) > item.get("ttl", CACHE_TTL_SEGUNDOS):
        _CACHE.pop(chave, None)
        return None
    return item.get("value")


def _cache_set(chave: str, value: Any, ttl: int = CACHE_TTL_SEGUNDOS):
    _CACHE[chave] = {"ts": time.time(), "ttl": ttl, "value": value}
    return value


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        texto = str(value).strip()
        if not texto:
            return default
        if "," in texto:
            texto = texto.replace(".", "").replace(",", ".")
        return float(texto)
    except Exception:
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(str(value).strip().replace(",", ".")))
    except Exception:
        return default


def _versao_num(value: Any) -> int:
    return overview._versao_num(value)


def _select_all(query) -> list[dict[str, Any]]:
    return overview._select_all(query)


def _round(value: Any) -> int:
    return int(round(_to_float(value)))


def _updated_label() -> str:
    agora = datetime.now()
    return agora.strftime("%d/%m/%Y às %H:%M")


def _formatar_data_hora(value: Any) -> str | None:
    if not value:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    try:
        normalizado = texto.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalizado)
        return dt.strftime("%d/%m/%Y às %H:%M")
    except Exception:
        return texto


def _safe_overview_resumo() -> dict[str, Any]:
    """
    Lê diretamente o snapshot já salvo da Overview.
    IMPORTANTE: não chama get_overview_resumo(), porque essa rota pode recalcular
    e deixar a Liberação Executiva presa em carregamento.
    """
    try:
        cache = overview._read_cache_overview()
        if cache and isinstance(cache.get("payload"), dict):
            return {
                "from_cache": True,
                "cache_atual": True,
                "atualizado_em": cache.get("atualizado_em"),
                "payload": cache.get("payload") or {},
            }
        return {"erro": "cache_overview_sem_payload", "payload": {}}
    except Exception as exc:
        return {"erro": str(exc), "payload": {}}


def _safe_rastreamento_cache(mes: int, ano: int) -> dict[str, Any]:
    """
    Lê o cache do Rastreamento de Lotes.
    Não recalcula na abertura da página para evitar travar o dashboard.
    """
    try:
        chave = overview._rastreamento_cache_chave(mes, ano)
        cache = overview._read_cache_overview(chave)
        if cache and isinstance(cache.get("payload"), dict):
            return cache.get("payload") or {}
        return {}
    except Exception:
        return {}


def _payload_overview(wrapper: dict[str, Any]) -> dict[str, Any]:
    payload = wrapper.get("payload") if isinstance(wrapper, dict) else None
    return payload if isinstance(payload, dict) else {}


def _projecao_liberacoes_oficial(
    proj_liberacoes: dict[str, Any],
    disponibilidade_mensal: dict[str, Any],
) -> dict[str, Any]:
    """
    Espelha EXATAMENTE a função calcularProjecaoLiberacoesOficial do front da
    Overview (frontend/src/pages/Overview/index.tsx). A Overview não confia no
    total_projetado "cru" salvo em /overview/projecao-liberacoes — ela recalcula
    no navegador, mês a mês, a partir de disponibilidade_mensal:
      - meses fechados: usa "entradas" (real);
      - mês atual: usa "entradas_real_mes_atual" (SD3 MTD, mais preciso que o
        valor cru, que pode incluir estimativa/forecast residual do mês);
      - meses futuros: usa "entradas" (forecast/previsto).

    Esse recálculo NUNCA voltava pro backend — só existia no JS do navegador.
    Por isso a Liberação Executiva (que lê o total_projetado cru direto do
    cache) sempre divergia da Overview (que mostra o valor recalculado).
    Replicando aqui, com a MESMA fonte (disponibilidade_mensal já salva no
    cache_overview), as duas telas passam a bater sempre — e atualizam juntas
    automaticamente quando o cache da Overview é recalculado (ex: depois de
    atualizar o MPS).
    """
    meses = disponibilidade_mensal.get("meses") if isinstance(disponibilidade_mensal, dict) else None
    if not proj_liberacoes or not meses:
        return proj_liberacoes or {}

    mes_atual = _to_int(
        disponibilidade_mensal.get("mes_atual"),
        date.today().month,
    )

    total_real = 0.0
    total_previsto = 0.0

    for mes in meses:
        numero_mes = _to_int(mes.get("mes"))
        entrada = _to_float(mes.get("entradas"))

        if numero_mes < mes_atual:
            total_real += entrada
        elif numero_mes == mes_atual:
            entrada_mes_atual = mes.get("entradas_real_mes_atual")
            total_real += _to_float(entrada_mes_atual) if entrada_mes_atual is not None else entrada
        else:
            total_previsto += entrada

    total_projetado = total_real + total_previsto
    total_orcado = _to_float(proj_liberacoes.get("total_orcado"))

    resultado = dict(proj_liberacoes)
    resultado["total_real"] = _round(total_real)
    resultado["total_previsto"] = _round(total_previsto)
    resultado["total_projetado"] = _round(total_projetado)
    if total_orcado > 0:
        resultado["pct_atingimento"] = round(total_projetado / total_orcado * 100, 1)
        resultado["delta_caixas"] = _round(total_projetado - total_orcado)
    resultado["ultimo_mes_fechado"] = mes_atual

    return resultado


async def _safe_rastreamento(mes: int, ano: int) -> dict[str, Any]:
    try:
        return await overview.get_rastreamento_lotes(mes=mes, ano=ano)
    except Exception as exc:
        return {"erro": str(exc), "mes": mes, "ano": ano}


async def _safe_projecao_liberacoes() -> dict[str, Any]:
    try:
        return await overview.get_projecao_liberacoes()
    except Exception as exc:
        return {"erro": str(exc)}


async def _safe_orcado_faturamento() -> dict[str, Any]:
    try:
        return await overview.get_orcado_faturamento(None, None, None, None, None, None)
    except Exception as exc:
        return {"erro": str(exc), "total_caixas": 0}


async def _safe_projecao_faturamento() -> dict[str, Any]:
    try:
        return await overview.get_projecao_faturamento(None, None, None, None, None, None)
    except Exception as exc:
        return {"erro": str(exc), "total_projetado": 0}


def _estoque_inicial_jan(ano: int) -> int:
    try:
        estoque_mes, _, _debug = overview._estoque_inicial_overview_por_mes(ano_base=ano)
        return _round(estoque_mes.get(1, 0.0))
    except Exception:
        return 0


def _qtd_mps_liberacao_cx(row: dict[str, Any]) -> float:
    """
    Quantidade da tabela f_mps_liberacoes em caixas.

    A base normalmente já vem em qtd_caixas. Mantive alternativas para evitar
    quebra se o nome da coluna variar em algum ambiente.
    """
    qtd = _to_float(
        row.get("qtd_caixas")
        or row.get("qtd_caixa")
        or row.get("caixas")
        or row.get("volume_cx")
        or row.get("qtd_cx")
        or row.get("qtd")
        or row.get("quantidade")
        or row.get("qtd_tubetes")
        or row.get("tubetes")
    )

    if qtd <= 0:
        return 0.0

    # Se vier em tubetes por algum motivo, converte para caixas.
    return qtd / TUBETES_POR_CAIXA if qtd > 10000 else qtd


def _mps_liberacoes_rows(ano: int, mes_revisao: int) -> list[dict[str, Any]]:
    try:
        query = (
            supabase.table("f_mps_liberacoes")
            .select("*")
            .eq("ano", ano)
            .eq("mes_revisao", mes_revisao)
        )
        return _select_all(query)
    except Exception:
        return []


def _mps_liberacoes_total(ano: int, mes_revisao: int, versao: int | None = None) -> int:
    """
    Soma f_mps_liberacoes para uma revisão/versão do ano inteiro.

    Regra da Liberação Executiva:
    - Plano 1 anual = revisão de Janeiro, V3.
    - NÃO filtra por linha aqui, porque f_mps_liberacoes já representa o plano
      de liberações consolidado. O filtro errado estava fazendo cair no fallback
      da Overview e mostrava 222.002 cx.
    """
    rows = _mps_liberacoes_rows(ano, mes_revisao)

    if not rows:
        return 0

    if versao is None:
        versoes = [_versao_num(r.get("versao")) for r in rows if _versao_num(r.get("versao")) > 0]
        versao = max(versoes) if versoes else None

    total = 0.0
    for r in rows:
        if versao is not None and _versao_num(r.get("versao")) != versao:
            continue
        total += _qtd_mps_liberacao_cx(r)

    return _round(total)


def _rodadas_mes(ano: int, mes: int) -> list[dict[str, Any]]:
    try:
        rows = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano)
            .eq("mes", mes)
        )
    except Exception:
        return []

    validas = [r for r in rows if r.get("id") and _versao_num(r.get("versao")) > 0]
    return sorted(
        validas,
        key=lambda r: (_versao_num(r.get("versao")), str(r.get("criado_em") or r.get("created_at") or "")),
    )


def _competencia_liberacao(row: dict[str, Any]) -> tuple[int, int]:
    mes = _to_int(row.get("mes_liberacao") or row.get("mes_lib") or row.get("mes_producao") or row.get("mes"))
    ano = _to_int(row.get("ano_liberacao") or row.get("ano_lib") or row.get("ano_producao") or row.get("ano"), date.today().year)
    return mes, ano


def _qtd_planejada_cx(row: dict[str, Any]) -> float:
    qtd = _to_float(
        row.get("qtd_planejada")
        or row.get("quantidade")
        or row.get("qtd")
        or row.get("qtd_tubetes")
        or row.get("tubetes")
    )
    if qtd <= 0:
        return 0.0
    return qtd / TUBETES_POR_CAIXA if qtd > 10000 else qtd


def _lote_key(row: dict[str, Any]) -> str:
    value = (
        row.get("lote")
        or row.get("lote_op")
        or row.get("numero_lote")
        or row.get("num_lote")
        or row.get("ordem")
        or row.get("op")
        or row.get("ordem_producao")
    )
    return str(value or "").strip().upper()


def _etapa_plano_valida(row: dict[str, Any]) -> bool:
    etapa = str(row.get("etapa") or "").strip().upper()
    if not etapa:
        return True
    if etapa in {"ENVASE", "PRODUCAO", "PRODUÇÃO", "LIBERACAO", "LIBERAÇÃO", "MPS", "PLANO"}:
        return True
    return any(token in etapa for token in ["ENVASE", "PRODU", "LIBERA"])


def _mapa_lotes_rodada(rodada: dict[str, Any], ano: int) -> dict[str, dict[str, Any]]:
    if not rodada or not rodada.get("id"):
        return {}

    try:
        rows = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada.get("id"))
        )
    except Exception:
        return {}

    mapa: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not _etapa_plano_valida(row):
            continue

        mes_lib, ano_lib = _competencia_liberacao(row)
        if ano_lib != ano or not (1 <= mes_lib <= 12):
            continue

        lote = _lote_key(row)
        if not lote:
            continue

        qtd_cx = _qtd_planejada_cx(row)
        if qtd_cx <= 0:
            continue

        item = mapa.setdefault(lote, {"lote": lote, "qtd_cx": 0.0, "mes": mes_lib, "ano": ano_lib})
        item["qtd_cx"] += qtd_cx
        # Para o mesmo lote, considera a menor competência como referência de liberação.
        if mes_lib < _to_int(item.get("mes"), mes_lib):
            item["mes"] = mes_lib

    return mapa

def _select_etapas_rodadas_bulk(rodada_ids: list[Any]) -> list[dict[str, Any]]:
    """
    Busca f_mrp_etapas de várias rodadas de uma vez.
    Isso evita dezenas/centenas de chamadas na abertura da Liberação Executiva.
    """
    ids = [rid for rid in rodada_ids if rid]
    if not ids:
        return []

    rows: list[dict[str, Any]] = []
    chunk_size = 120

    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        try:
            parte = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .in_("rodada_id", chunk)
            )
            rows.extend(parte)
        except Exception:
            # Fallback seguro se o driver não aceitar in_ em algum ambiente.
            for rid in chunk:
                try:
                    rows.extend(_select_all(
                        supabase.table("f_mrp_etapas")
                        .select("*")
                        .eq("rodada_id", rid)
                    ))
                except Exception:
                    continue

    return rows


def _mapas_lotes_rodadas_bulk(rodadas: list[dict[str, Any]], ano: int) -> dict[str, dict[str, dict[str, Any]]]:
    """
    Monta mapa rodada_id -> lote -> dados de plano em uma única varredura.
    """
    rodada_ids = [r.get("id") for r in rodadas if r.get("id")]
    rows = _select_etapas_rodadas_bulk(rodada_ids)

    mapas: dict[str, dict[str, dict[str, Any]]] = {}

    for row in rows:
        if not _etapa_plano_valida(row):
            continue

        rodada_id = str(row.get("rodada_id") or "")
        if not rodada_id:
            continue

        mes_lib, ano_lib = _competencia_liberacao(row)
        if ano_lib != ano or not (1 <= mes_lib <= 12):
            continue

        lote = _lote_key(row)
        if not lote:
            continue

        qtd_cx = _qtd_planejada_cx(row)
        if qtd_cx <= 0:
            continue

        mapa = mapas.setdefault(rodada_id, {})
        item = mapa.setdefault(lote, {"lote": lote, "qtd_cx": 0.0, "mes": mes_lib, "ano": ano_lib})
        item["qtd_cx"] += qtd_cx

        if mes_lib < _to_int(item.get("mes"), mes_lib):
            item["mes"] = mes_lib

    return mapas


def _delta_gantt_mensal_mapas(
    mapa_de: dict[str, dict[str, Any]],
    mapa_para: dict[str, dict[str, Any]],
    mes: int,
) -> dict[str, Any]:
    """
    Compara duas versões usando mapas já carregados.

    Atraso prod.:
    - lote/OP que estava no mês e saiu/reduziu no mês na próxima versão.

    Reorg.:
    - lote/OP que entrou ou aumentou no mês na próxima versão.
    """
    atraso = 0.0
    reorg = 0.0
    lotes_atraso: set[str] = set()
    lotes_reorg: set[str] = set()

    for lote in set(mapa_de.keys()) | set(mapa_para.keys()):
        a = mapa_de.get(lote) or {}
        b = mapa_para.get(lote) or {}

        a_mes = _to_int(a.get("mes"))
        b_mes = _to_int(b.get("mes"))

        a_no_mes = _to_float(a.get("qtd_cx")) if a_mes == mes else 0.0
        b_no_mes = _to_float(b.get("qtd_cx")) if b_mes == mes else 0.0

        if a_no_mes <= 0 and b_no_mes <= 0:
            continue

        delta = b_no_mes - a_no_mes

        if delta < -0.5:
            atraso += abs(delta)
            lotes_atraso.add(lote)
        elif delta > 0.5:
            reorg += delta
            lotes_reorg.add(lote)

    return {
        "atraso": _round(atraso),
        "reorg": _round(reorg),
        "lotes_atraso": lotes_atraso,
        "lotes_reorg": lotes_reorg,
    }



def _total_rodada_mes(rodada: dict[str, Any], ano: int, mes: int) -> int:
    mapa = _mapa_lotes_rodada(rodada, ano)
    return _round(sum(item.get("qtd_cx", 0.0) for item in mapa.values() if _to_int(item.get("mes")) == mes))


def _delta_entre_rodadas(
    rodada_de: dict[str, Any],
    rodada_para: dict[str, Any],
    ano: int,
    mes: int,
) -> list[dict[str, Any]]:
    """
    Classificação objetiva entre duas versões do Gantt/MPS.
    - lote que saiu do mês e foi para mês futuro = atraso;
    - lote que entrou/saiu sem caracterizar atraso = reorganização;
    - alteração de quantidade planejada no mês = reorganização.
    Reprovação e rendimento são fatos operacionais e entram pelo rastreamento atual, não pela versão do Gantt.
    """
    mapa_de = _mapa_lotes_rodada(rodada_de, ano)
    mapa_para = _mapa_lotes_rodada(rodada_para, ano)

    reorg = 0.0
    atraso = 0.0
    lotes_reorg: set[str] = set()
    lotes_atraso: set[str] = set()

    lotes = set(mapa_de.keys()) | set(mapa_para.keys())
    for lote in lotes:
        a = mapa_de.get(lote)
        b = mapa_para.get(lote)
        a_mes = _to_int((a or {}).get("mes"))
        b_mes = _to_int((b or {}).get("mes"))
        a_qtd = _to_float((a or {}).get("qtd_cx")) if a_mes == mes else 0.0
        b_qtd = _to_float((b or {}).get("qtd_cx")) if b_mes == mes else 0.0

        # Estava no mês e foi empurrado para mês futuro na próxima versão.
        if a_qtd > 0 and b_mes > mes:
            atraso -= a_qtd
            lotes_atraso.add(lote)
            continue

        delta = b_qtd - a_qtd
        if abs(delta) >= 0.5:
            reorg += delta
            lotes_reorg.add(lote)

    steps: list[dict[str, Any]] = []
    if abs(reorg) >= 0.5:
        steps.append({
            "id": f"reorganizacao-v{_versao_num(rodada_para.get('versao'))}",
            "label": "Reorg.",
            "kind": "delta",
            "value": _round(reorg),
            "tone": "slate" if reorg >= 0 else "gray",
            "clickable": True,
            "lotes": len(lotes_reorg),
        })
    if abs(atraso) >= 0.5:
        steps.append({
            "id": f"atraso-v{_versao_num(rodada_para.get('versao'))}",
            "label": "Atraso",
            "kind": "delta",
            "value": _round(atraso),
            "tone": "red",
            "lotes": len(lotes_atraso),
        })

    return steps


def _ponte_versoes(ano: int, mes: int, rastreamento: dict[str, Any]) -> list[dict[str, Any]]:
    rodadas = _rodadas_mes(ano, mes)
    lotes_causa = _lotes_por_causa_rastreamento(rastreamento)

    if len(rodadas) < 2:
        v1 = _round(rastreamento.get("mes_cx_previsto_v1"))
        atual = _round(
            rastreamento.get("mes_cx_plano_atual_tendencia")
            or rastreamento.get("mes_cx_reconciliado_v1")
            or v1
        )
        causas = rastreamento.get("mes_perdas_vs_v1_por_causa") or {}
        return [
            {"id": "v1", "label": "V1", "kind": "total", "value": v1, "tone": "navy"},
            _with_lotes({"id": "atraso", "label": "Atraso", "kind": "delta", "value": -abs(_round(causas.get("atraso_producao"))), "tone": "red"}, lotes_causa.get("atraso")),
            _with_lotes({"id": "reprovacao", "label": "Reprov.", "kind": "delta", "value": -abs(_round(causas.get("reprovacao_desvio"))), "tone": "orange"}, lotes_causa.get("reprovacao")),
            _with_lotes({"id": "rendimento", "label": "Rend.", "kind": "delta", "value": -abs(_round(causas.get("rendimento"))), "tone": "gray"}, lotes_causa.get("perda_rendimento")),
            _with_lotes({"id": "ganho", "label": "Ganho", "kind": "delta", "value": abs(_round(causas.get("ganho_rendimento"))), "tone": "green"}, lotes_causa.get("ganho_rendimento")),
            {"id": "vatual", "label": "V atual", "kind": "total", "value": atual, "tone": "teal"},
        ]

    # Mostra o histórico real de versões existentes no Gantt/MPS: V1 → V2 → V3...
    # O total final usa a disponibilidade/tendência atual do Rastreamento, que já cruza Gantt + SD3 + desvios.
    steps: list[dict[str, Any]] = []
    for idx, rodada in enumerate(rodadas):
        versao = _versao_num(rodada.get("versao"))
        total_gantt = _total_rodada_mes(rodada, ano, mes)

        if idx == 0:
            steps.append({"id": f"v{versao}", "label": f"V{versao}", "kind": "total", "value": total_gantt, "tone": "navy"})
            continue

        anterior = rodadas[idx - 1]
        steps.extend(_delta_entre_rodadas(anterior, rodada, ano, mes))

        is_final = idx == len(rodadas) - 1
        if is_final:
            # Depois da última versão do Gantt, aplica fatos reais já registrados na ferramenta.
            # Desvio/reprovação vem da aba Desvios/Rastreamento; rendimento vem da SD3.
            steps.extend(_operacionais_mes_steps(rastreamento))
            total_atual = _round(rastreamento.get("mes_cx_plano_atual_tendencia")) or total_gantt
            steps.append({"id": f"v{versao}", "label": f"V{versao} atual", "kind": "total", "value": total_atual, "tone": "teal"})
        else:
            steps.append({"id": f"v{versao}", "label": f"V{versao}", "kind": "total", "value": total_gantt, "tone": "navy"})

    return [step for step in steps if step.get("kind") == "total" or abs(_to_float(step.get("value"))) > 0]



def _lotes_por_causa_rastreamento(rastreamento: dict[str, Any]) -> dict[str, int]:
    """Conta lotes reais já calculados pela própria visão de Rastreamento/Overview."""
    lotes = rastreamento.get("lotes") or []
    if not isinstance(lotes, list):
        lotes = []

    atraso: set[str] = set()
    reprovacao: set[str] = set()
    rendimento: set[str] = set()
    ganho: set[str] = set()

    for item in lotes:
        if not isinstance(item, dict):
            continue
        lote = _lote_key(item)
        if not lote:
            continue

        status = str(item.get("status_gap") or "").strip()

        if item.get("atraso_producao") or item.get("reprogramado") or status == "Atraso de produção":
            atraso.add(lote)

        if item.get("desvio_reprovacao") or status == "Reprovação/desvio":
            reprovacao.add(lote)

        if item.get("perda_rendimento") or status == "Perda por rendimento" or _to_float(item.get("qtd_perda_rendimento_cx")) > 0:
            rendimento.add(lote)

        previsto = _to_float(item.get("qtd_prevista_cx"))
        liberado = _to_float(item.get("qtd_liberada_cx"))
        if previsto > 0 and liberado > previsto:
            ganho.add(lote)

    # Se a lista detalhada não vier por algum motivo, usa os resumos já existentes.
    if not atraso:
        atraso_lista = rastreamento.get("atraso_producao_lotes") or []
        if isinstance(atraso_lista, list):
            for item in atraso_lista:
                if isinstance(item, dict):
                    lote = _lote_key(item)
                    if lote:
                        atraso.add(lote)

    # Sempre une com a lista consolidada de reprovação/desvio da Overview.
    # Antes só usava fallback quando o rastreamento vinha vazio; isso fazia a
    # cascata mostrar 13 lotes quando o consolidado correto era 14.
    try:
        for lote in overview._lotes_reprovacao_desvio_overview():
            lote_norm = str(lote or "").strip().upper()
            if lote_norm:
                reprovacao.add(lote_norm)
    except Exception:
        pass

    return {
        "atraso": len(atraso),
        "reprovacao": len(reprovacao),
        "perda_rendimento": len(rendimento),
        "ganho_rendimento": len(ganho),
    }


def _with_lotes(step: dict[str, Any], lotes: int | None) -> dict[str, Any]:
    if lotes is not None and lotes > 0:
        step["lotes"] = int(lotes)
    return step


def _lotes_reorg_ponte(steps: list[dict[str, Any]]) -> int:
    total = 0
    for step in steps:
        if str(step.get("id") or "").startswith("reorganizacao"):
            total += _to_int(step.get("lotes"))
    return total


def _operacionais_mes_steps(rastreamento: dict[str, Any]) -> list[dict[str, Any]]:
    causas = rastreamento.get("mes_perdas_vs_v1_por_causa") or {}
    lotes = _lotes_por_causa_rastreamento(rastreamento)

    steps: list[dict[str, Any]] = []
    reprov = abs(_round(causas.get("reprovacao_desvio")))
    rend = abs(_round(causas.get("rendimento")))
    ganho = abs(_round(causas.get("ganho_rendimento")))

    if reprov > 0:
        steps.append(_with_lotes({
            "id": "reprovacao-atual",
            "label": "Reprov.",
            "kind": "delta",
            "value": -reprov,
            "tone": "orange",
        }, lotes.get("reprovacao")))

    if rend > 0:
        steps.append(_with_lotes({
            "id": "rendimento-atual",
            "label": "Rend.",
            "kind": "delta",
            "value": -rend,
            "tone": "gray",
        }, lotes.get("perda_rendimento")))

    if ganho > 0:
        steps.append(_with_lotes({
            "id": "ganho-atual",
            "label": "Ganho",
            "kind": "delta",
            "value": ganho,
            "tone": "green",
        }, lotes.get("ganho_rendimento")))

    return steps

def _causas_anuais(
    plano1_base_cx: int,
    disponibilidade_atual_cx: int,
    rastreamento: dict[str, Any],
) -> dict[str, int]:
    """
    Helper legado usado pelo /resumo rápido.

    Importante: não força fechamento da ponte.
    Se houver diferença entre causas conhecidas e gap total, ela deve aparecer
    como não classificada no debug da rota principal, não ser jogada dentro de
    Reorg. ou Atraso.
    """
    causas_mes = rastreamento.get("mes_perdas_vs_v1_por_causa") or {}

    reorg = max(0, _round(rastreamento.get("mes_cx_acrescimo_plano_atual")))
    atraso = abs(_round(causas_mes.get("atraso_producao")))
    reprov = abs(_round(causas_mes.get("reprovacao_desvio")))
    perda_rend = abs(_round(causas_mes.get("rendimento")))
    ganho_rend = abs(_round(causas_mes.get("ganho_rendimento")))

    return {
        "reorg": _round(reorg),
        "atraso": _round(atraso),
        "reprovacao": _round(reprov),
        "perda_rendimento": _round(perda_rend),
        "ganho_rendimento": _round(ganho_rend),
    }




def _rodada_mrp_unica(ano: int, mes: int, versao: int) -> dict[str, Any] | None:
    try:
        rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano)
            .eq("mes", mes)
            .eq("versao", versao)
        )
    except Exception:
        return None

    rodadas_validas = [r for r in rodadas if isinstance(r, dict) and r.get("id")]
    if not rodadas_validas:
        return None

    return sorted(
        rodadas_validas,
        key=lambda r: str(r.get("criado_em") or r.get("created_at") or ""),
    )[-1]


def _total_rodada_mrp_cx(ano: int, mes: int, versao: int) -> dict[str, Any]:
    """
    Soma uma rodada do Gantt/MRP em f_mrp_etapas.

    Usado para Plano 1:
    - Jan/V3
    - linhas L1/L2
    - ano_liberacao = ano
    """
    rodada = _rodada_mrp_unica(ano, mes, versao)
    if not rodada or not rodada.get("id"):
        return {
            "total_cx": 0,
            "lotes": 0,
            "rodada": None,
            "totais_por_mes": {},
            "fonte": "f_mrp_etapas:rodada_nao_encontrada",
        }

    try:
        etapas = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada.get("id"))
        )
    except Exception:
        etapas = []

    linhas_validas = {"L1", "L2"}
    total = 0.0
    lotes: set[str] = set()
    totais_por_mes: dict[str, float] = {}

    for row in etapas:
        if not isinstance(row, dict):
            continue

        if not _etapa_plano_valida(row):
            continue

        linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
        if linha not in linhas_validas:
            continue

        mes_lib, ano_lib = _competencia_liberacao(row)
        if ano_lib != ano or not (1 <= mes_lib <= 12):
            continue

        qtd_cx = _qtd_planejada_cx(row)
        if qtd_cx <= 0:
            continue

        total += qtd_cx

        lote = _lote_key(row)
        if lote:
            lotes.add(lote)

        mes_key = str(mes_lib)
        totais_por_mes[mes_key] = totais_por_mes.get(mes_key, 0.0) + qtd_cx

    return {
        "total_cx": _round(total),
        "lotes": len(lotes),
        "rodada": {
            "id": rodada.get("id"),
            "mes": rodada.get("mes"),
            "versao": rodada.get("versao"),
            "criado_em": rodada.get("criado_em") or rodada.get("created_at"),
        },
        "totais_por_mes": {
            k: _round(v)
            for k, v in sorted(totais_por_mes.items(), key=lambda item: int(item[0]))
        },
        "fonte": f"f_mrp_etapas:rodada_mrp:mes={mes}:versao={versao}",
    }

@router.get("/plano1")
def get_liberacao_executiva_plano1(
    ano: int | None = Query(default=None),
):
    """
    Base correta da disponibilidade anual orçada:
    Plano 1 = rodada Gantt/MRP Janeiro V3 + estoque inicial de janeiro.

    Confirmado no diagnóstico:
    - f_mrp_etapas Jan/V3 soma 220.534 cx em 2026.
    - f_mps_liberacoes é agregado e não serve como base auditável por lote/OP.
    """
    ano_ref = ano or date.today().year
    estoque_jan_cx = _estoque_inicial_jan(ano_ref)

    if estoque_jan_cx <= 0 and ano_ref == 2026:
        estoque_jan_cx = ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026

    plano1 = _total_rodada_mrp_cx(ano_ref, mes=1, versao=3)
    plano1_liberacao_cx = _round(plano1.get("total_cx"))
    fonte = str(plano1.get("fonte") or "f_mrp_etapas:rodada_mrp:mes=1:versao=3")

    if plano1_liberacao_cx <= 0 and ano_ref == 2026:
        plano1_liberacao_cx = PLANO1_JANEIRO_V3_CX_2026
        fonte = "fallback_operacional_mps_janeiro_v3_2026"

    return {
        "ano": ano_ref,
        "plano1LiberacaoCx": plano1_liberacao_cx,
        "estoqueInicialJanCx": estoque_jan_cx,
        "plano1BaseCx": plano1_liberacao_cx + estoque_jan_cx,
        "fonte": fonte,
        "debug": {
            "regra": "Plano 1 = f_mrp_etapas rodada MRP Jan/V3 + estoque inicial Jan",
            "rodada_mrp": plano1.get("rodada"),
            "lotes_plano1": plano1.get("lotes"),
            "totais_por_mes": plano1.get("totais_por_mes"),
        },
    }



def _row_mps_key(row: dict[str, Any]) -> str | None:
    """
    Chave para contar item/lote impactado na ponte.
    Usa a primeira coluna disponível. Se não houver granularidade de lote/produto,
    não inventa quantidade.
    """
    candidatos = [
        "lote",
        "lote_op",
        "numero_lote",
        "num_lote",
        "op",
        "ordem_producao",
        "produto",
        "codigo_produto",
        "cod_produto",
        "cod_item",
        "item",
    ]

    for campo in candidatos:
        valor = row.get(campo)
        if valor is not None and str(valor).strip():
            return str(valor).strip()

    return None


def _mps_rows_mes_revisao(ano: int, mes: int) -> list[dict[str, Any]]:
    try:
        query = (
            supabase.table("f_mps_liberacoes")
            .select("*")
            .eq("ano", ano)
            .eq("mes_revisao", mes)
            .eq("mes", mes)
        )
        return _select_all(query)
    except Exception:
        return []


def _count_itens_impactados_por_versao(
    rows: list[dict[str, Any]],
    versao_a: int,
    versao_b: int,
) -> int:
    mapa_a: dict[str, float] = {}
    mapa_b: dict[str, float] = {}

    for row in rows:
        versao = _versao_num(row.get("versao"))
        if versao not in {versao_a, versao_b}:
            continue

        chave = _row_mps_key(row)
        if not chave:
            continue

        qtd = _qtd_mps_liberacao_cx(row)
        if versao == versao_a:
            mapa_a[chave] = mapa_a.get(chave, 0.0) + qtd
        else:
            mapa_b[chave] = mapa_b.get(chave, 0.0) + qtd

    chaves = set(mapa_a) | set(mapa_b)
    return sum(1 for chave in chaves if round(mapa_a.get(chave, 0.0)) != round(mapa_b.get(chave, 0.0)))


@router.get("/ponte-versoes")
def get_liberacao_executiva_ponte_versoes(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None, ge=1, le=12),
):
    """
    Ponte leve de versões do mês atual usando apenas f_mps_liberacoes.

    Regra:
    - mês atual: mes_revisao = mês atual
    - compara V1, V2, V3... dentro do mesmo mês
    - não consulta f_mrp_etapas para não travar a página
    """
    hoje = date.today()
    ano_ref = ano or hoje.year
    mes_ref = mes or hoje.month

    rows = _mps_rows_mes_revisao(ano_ref, mes_ref)

    totais_por_versao: dict[int, float] = {}
    for row in rows:
        versao = _versao_num(row.get("versao"))
        if versao <= 0:
            continue

        totais_por_versao[versao] = totais_por_versao.get(versao, 0.0) + _qtd_mps_liberacao_cx(row)

    versoes = sorted(v for v, total in totais_por_versao.items() if round(total) != 0)

    if len(versoes) < 2:
        return {
            "ano": ano_ref,
            "mes": mes_ref,
            "steps": [],
            "debug": {
                "linhas": len(rows),
                "versoes": versoes,
                "motivo": "menos_de_duas_versoes_com_valor",
            },
        }

    steps: list[dict[str, Any]] = []

    primeira = versoes[0]
    steps.append({
        "id": f"v{primeira}",
        "label": f"V{primeira}",
        "kind": "total",
        "value": _round(totais_por_versao.get(primeira, 0)),
        "tone": "navy",
    })

    for idx in range(1, len(versoes)):
        anterior = versoes[idx - 1]
        atual = versoes[idx]

        total_anterior = _round(totais_por_versao.get(anterior, 0))
        total_atual = _round(totais_por_versao.get(atual, 0))
        delta = total_atual - total_anterior

        lotes_impactados = _count_itens_impactados_por_versao(rows, anterior, atual)

        if abs(delta) >= 1:
            delta_step = {
                "id": f"var-v{anterior}-v{atual}",
                "label": "Variação",
                "kind": "delta",
                "value": delta,
                "tone": "green" if delta > 0 else "red",
            }

            if lotes_impactados > 0:
                delta_step["lotes"] = lotes_impactados

            steps.append(delta_step)

        steps.append({
            "id": f"v{atual}",
            "label": f"V{atual} atual" if idx == len(versoes) - 1 else f"V{atual}",
            "kind": "total",
            "value": total_atual,
            "tone": "teal" if idx == len(versoes) - 1 else "navy",
        })

    return {
        "ano": ano_ref,
        "mes": mes_ref,
        "versoes": versoes,
        "steps": steps,
        "debug": {
            "linhas": len(rows),
            "fonte": "f_mps_liberacoes",
            "filtros": {
                "ano": ano_ref,
                "mes_revisao": mes_ref,
                "mes": mes_ref,
            },
            "totais_por_versao": {f"V{k}": _round(v) for k, v in totais_por_versao.items()},
        },
    }



def _lotes_sets_rastreamento(rastreamento: dict[str, Any]) -> dict[str, set[str]]:
    lotes = rastreamento.get("lotes") or []
    if not isinstance(lotes, list):
        lotes = []

    sets = {
        "atraso": set(),
        "reprovacao": set(),
        "perda_rendimento": set(),
        "ganho_rendimento": set(),
    }

    for item in lotes:
        if not isinstance(item, dict):
            continue

        lote = _lote_key(item)
        if not lote:
            continue

        status = str(item.get("status_gap") or "").strip()

        if item.get("atraso_producao") or item.get("reprogramado") or status == "Atraso de produção":
            sets["atraso"].add(lote)

        if item.get("desvio_reprovacao") or status == "Reprovação/desvio":
            sets["reprovacao"].add(lote)

        if item.get("perda_rendimento") or status == "Perda por rendimento" or _to_float(item.get("qtd_perda_rendimento_cx")) > 0:
            sets["perda_rendimento"].add(lote)

        previsto = _to_float(item.get("qtd_prevista_cx"))
        liberado = _to_float(item.get("qtd_liberada_cx"))
        if previsto > 0 and liberado > previsto:
            sets["ganho_rendimento"].add(lote)

    return sets


def _somar_sets(destino: dict[str, set[str]], origem: dict[str, set[str]]):
    for chave, valores in origem.items():
        destino.setdefault(chave, set()).update(valores)


def _delta_gantt_mensal_entre_rodadas(
    rodada_de: dict[str, Any],
    rodada_para: dict[str, Any],
    ano: int,
    mes: int,
) -> dict[str, Any]:
    """
    Varre Gantt/MRP entre duas versões para um mês específico.

    Classificação:
    - Atraso prod.: volume que estava no mês e saiu do mês na versão seguinte
      ou foi empurrado para mês posterior.
    - Reorg.: volume que entrou no mês, voltou ao mês ou alteração de mix/quantidade
      que não é saída por atraso.
    """
    mapa_de = _mapa_lotes_rodada(rodada_de, ano)
    mapa_para = _mapa_lotes_rodada(rodada_para, ano)

    atraso = 0.0
    reorg = 0.0
    lotes_atraso: set[str] = set()
    lotes_reorg: set[str] = set()

    for lote in set(mapa_de.keys()) | set(mapa_para.keys()):
        a = mapa_de.get(lote) or {}
        b = mapa_para.get(lote) or {}

        a_mes = _to_int(a.get("mes"))
        b_mes = _to_int(b.get("mes"))

        a_no_mes = _to_float(a.get("qtd_cx")) if a_mes == mes else 0.0
        b_no_mes = _to_float(b.get("qtd_cx")) if b_mes == mes else 0.0

        if a_no_mes <= 0 and b_no_mes <= 0:
            continue

        delta = b_no_mes - a_no_mes

        # Saiu total ou parcialmente do mês. Se foi para mês posterior ou sumiu da
        # versão do mês, classifica como atraso/reprogramação.
        if delta < -0.5:
            atraso += abs(delta)
            lotes_atraso.add(lote)
            continue

        # Entrou/aumentou no mês: reorg/mix/plano.
        if delta > 0.5:
            reorg += delta
            lotes_reorg.add(lote)

    return {
        "atraso": _round(atraso),
        "reorg": _round(reorg),
        "lotes_atraso": lotes_atraso,
        "lotes_reorg": lotes_reorg,
    }


def _gantt_causas_anuais(ano: int) -> dict[str, Any]:
    """
    Varredura real nas versões do Gantt/MRP do ano.

    Otimizado:
    - busca f_mrp_rodadas uma vez;
    - busca f_mrp_etapas em lote;
    - compara versões em memória.
    """
    chave = f"gantt-causas-anuais:v3-bulk:{ano}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    try:
        todas_rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano)
        )
    except Exception:
        todas_rodadas = []

    rodadas_validas = [
        r for r in todas_rodadas
        if r.get("id") and _versao_num(r.get("versao")) > 0 and 1 <= _to_int(r.get("mes")) <= 12
    ]

    rodadas_por_mes: dict[int, list[dict[str, Any]]] = {}
    for r in rodadas_validas:
        rodadas_por_mes.setdefault(_to_int(r.get("mes")), []).append(r)

    for mes, rodadas in rodadas_por_mes.items():
        rodadas_por_mes[mes] = sorted(
            rodadas,
            key=lambda r: (
                _versao_num(r.get("versao")),
                str(r.get("criado_em") or r.get("created_at") or ""),
            ),
        )

    mapas = _mapas_lotes_rodadas_bulk(rodadas_validas, ano)

    atraso = 0
    reorg = 0
    lotes_atraso: set[str] = set()
    lotes_reorg: set[str] = set()
    detalhes: list[dict[str, Any]] = []
    comparacoes = 0

    for mes in range(1, 13):
        rodadas = rodadas_por_mes.get(mes) or []
        if len(rodadas) < 2:
            continue

        for idx in range(1, len(rodadas)):
            anterior = rodadas[idx - 1]
            atual = rodadas[idx]

            mapa_anterior = mapas.get(str(anterior.get("id")), {})
            mapa_atual = mapas.get(str(atual.get("id")), {})

            delta = _delta_gantt_mensal_mapas(mapa_anterior, mapa_atual, mes)
            comparacoes += 1

            if delta["atraso"]:
                atraso += int(delta["atraso"])
                lotes_atraso.update(delta["lotes_atraso"])

            if delta["reorg"]:
                reorg += int(delta["reorg"])
                lotes_reorg.update(delta["lotes_reorg"])

            if delta["atraso"] or delta["reorg"]:
                detalhes.append({
                    "mes": mes,
                    "de": f"V{_versao_num(anterior.get('versao'))}",
                    "para": f"V{_versao_num(atual.get('versao'))}",
                    "atraso": int(delta["atraso"]),
                    "reorg": int(delta["reorg"]),
                    "lotes_atraso": len(delta["lotes_atraso"]),
                    "lotes_reorg": len(delta["lotes_reorg"]),
                })

    return _cache_set(chave, {
        "atraso": atraso,
        "reorg": reorg,
        "lotes_atraso": lotes_atraso,
        "lotes_reorg": lotes_reorg,
        "detalhes": detalhes,
        "rodadas_lidas": len(rodadas_validas),
        "comparacoes": comparacoes,
    }, ttl=1800)


def _operacional_causas_anuais(ano: int) -> dict[str, Any]:
    reprovacao = 0
    perda_rendimento = 0
    ganho_rendimento = 0

    lotes_sets = {
        "atraso": set(),
        "reprovacao": set(),
        "perda_rendimento": set(),
        "ganho_rendimento": set(),
    }

    meses_lidos = 0

    for mes in range(1, 13):
        rast = _safe_rastreamento_cache(mes, ano)
        if not rast:
            continue

        meses_lidos += 1
        causas = rast.get("mes_perdas_vs_v1_por_causa") or {}

        reprovacao += abs(_round(causas.get("reprovacao_desvio")))
        perda_rendimento += abs(_round(causas.get("rendimento")))
        ganho_rendimento += abs(_round(causas.get("ganho_rendimento")))

        _somar_sets(lotes_sets, _lotes_sets_rastreamento(rast))

    # Complemento importante: alguns lotes reprovados/descartados podem estar
    # no Monitor de Desvios/Overview e não aparecerem em todos os caches mensais
    # do Rastreamento. A cascata executiva deve contar o conjunto consolidado.
    try:
        for lote in overview._lotes_reprovacao_desvio_overview():
            lote_norm = str(lote or "").strip().upper()
            if lote_norm:
                lotes_sets["reprovacao"].add(lote_norm)
    except Exception:
        pass

    return {
        "reprovacao": reprovacao,
        "perda_rendimento": perda_rendimento,
        "ganho_rendimento": ganho_rendimento,
        "lotes": lotes_sets,
        "meses_lidos": meses_lidos,
    }



def _normalizar_texto_upper(value: Any) -> str:
    texto = str(value or "").strip().upper()
    troca = {
        "Á": "A", "À": "A", "Â": "A", "Ã": "A",
        "É": "E", "Ê": "E",
        "Í": "I",
        "Ó": "O", "Ô": "O", "Õ": "O",
        "Ú": "U",
        "Ç": "C",
    }
    for de, para in troca.items():
        texto = texto.replace(de, para)
    return " ".join(texto.split())


def _normalizar_chave_coluna(value: Any) -> str:
    """Normaliza nome de coluna vindo do Supabase/Excel para busca flexível."""
    texto = _normalizar_texto_upper(value)
    for ch in [" ", "-", "/", ".", "(", ")", "[", "]"]:
        texto = texto.replace(ch, "_")
    while "__" in texto:
        texto = texto.replace("__", "_")
    return texto.strip("_").lower()


def _get_any(row: dict[str, Any], *candidatos: str) -> Any:
    """Busca campo considerando variações de caixa, acento, espaço e underline."""
    if not isinstance(row, dict):
        return None

    for campo in candidatos:
        if campo in row:
            return row.get(campo)

    mapa = {_normalizar_chave_coluna(k): v for k, v in row.items()}
    for campo in candidatos:
        chave = _normalizar_chave_coluna(campo)
        if chave in mapa:
            return mapa.get(chave)

    return None


def _parse_date_value(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    texto = str(value).strip()
    if not texto:
        return None

    # ISO/RFC3339 vindo do Supabase.
    try:
        return datetime.fromisoformat(texto.replace("Z", "+00:00")).date()
    except Exception:
        pass

    # Data do Excel/CSV em dd/mm/aaaa ou dd-mm-aaaa.
    for sep in ("/", "-"):
        partes = texto.split(sep)
        if len(partes) >= 3:
            try:
                if len(partes[0]) == 4:
                    return date(int(partes[0]), int(partes[1]), int(partes[2][:2]))
                return date(int(partes[2][:4]), int(partes[1]), int(partes[0]))
            except Exception:
                pass

    return None


def _data_row(row: dict[str, Any]) -> date | None:
    # Para f_apontamentos/Cogtive, a data operacional correta é DATA INICIAL.
    # Evita cair em data/criado_em/data de carga, que jogava tudo para 26/06.
    campos_operacionais = (
        "data_inicial",
        "DATA INICIAL",
        "data_inicio",
        "dt_inicio",
        "inicio",
        "data_apontamento",
        "dt_apontamento",
        "data_evento",
        "data_producao",
        "data_final",
        "DATA FINAL",
        "data_fim",
        "fim",
    )
    for campo in campos_operacionais:
        dt = _parse_date_value(_get_any(row, campo))
        if dt:
            return dt

    # Fallback apenas para layouts antigos que realmente usam coluna data como
    # data operacional. created_at/criado_em NÃO entram aqui para não confundir
    # data de carga com data de produção.
    dt = _parse_date_value(_get_any(row, "data"))
    return dt


def _linha_producao_from_row(row: dict[str, Any]) -> str:
    candidatos = [
        _get_any(row, "linha"),
        _get_any(row, "linha_origem"),
        _get_any(row, "recurso"),
        _get_any(row, "centro_trabalho"),
        _get_any(row, "equipamento", "EQUIPAMENTO"),
        _get_any(row, "maquina", "máquina"),
        _get_any(row, "descricao_recurso"),
        _get_any(row, "setor"),
        _get_any(row, "tag", "TAG"),
    ]
    texto = _normalizar_texto_upper(" ".join(str(v or "") for v in candidatos))

    if "L2" in texto or "LINHA 2" in texto:
        return "L2"

    if (
        "L1" in texto
        or "LINHA 1" in texto
        or "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQUINA 1" in texto
        or "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQUINA 2" in texto
    ):
        return "L1"

    return ""


def _row_envase_producao_valida(row: dict[str, Any]) -> bool:
    """Filtro do realizado do Cogtive/apontamentos para PRODUÇÃO em ENVASE."""
    if not isinstance(row, dict):
        return False

    tipo = _normalizar_texto_upper(_get_any(
        row,
        "tipo_evento",
        "tipo de evento",
        "TIPO DE EVENTO",
        "evento_tipo",
    ))
    evento = _normalizar_texto_upper(_get_any(row, "evento", "EVENTO"))

    # Na base Cogtive, só PRODUÇÃO deve entrar no realizado; paradas/setup/fim
    # de lote não podem virar volume produzido.
    if tipo and "PRODU" not in tipo:
        return False
    if not tipo and evento and evento not in {"PRODUCAO", "PRODUÇÃO"} and "PRODU" not in evento:
        return False

    texto_etapa = _normalizar_texto_upper(
        " ".join(
            str(_get_any(row, campo) or "")
            for campo in (
                "etapa",
                "fase",
                "processo",
                "operacao",
                "operação",
                "recurso",
                "centro_trabalho",
                "equipamento",
                "EQUIPAMENTO",
                "maquina",
                "máquina",
                "TAG",
                "tag",
            )
        )
    )

    if not texto_etapa:
        return True

    if "ENVASE" in texto_etapa or "ENVASAD" in texto_etapa:
        return True

    if texto_etapa in {"L1", "LINHA 1", "L2", "LINHA 2"}:
        return True

    return False


def _qtd_realizada_cx(row: dict[str, Any]) -> float:
    # Na base Cogtive/f_apontamentos, QUANTIDADE PRODUZIDA está em tubetes,
    # mesmo quando o valor da linha é pequeno. Por isso divide sempre por 500.
    for campo in (
        "quantidade_produzida",
        "QUANTIDADE PRODUZIDA",
        "qtd_produzida_tubetes",
        "qtd_realizada_tubetes",
        "qtd_apontada_tubetes",
        "qtd_tubetes",
        "tubetes",
    ):
        qtd = _to_float(_get_any(row, campo))
        if qtd > 0:
            return qtd / TUBETES_POR_CAIXA

    # Campos explicitamente em caixas.
    for campo in (
        "qtd_caixas",
        "qtd_caixa",
        "caixas",
        "qtd_cx",
        "cx",
        "volume_cx",
        "qtd_realizada_cx",
        "qtd_produzida_cx",
        "qtd_apontada_cx",
        "qtd_liberada_cx",
    ):
        qtd = _to_float(_get_any(row, campo))
        if qtd > 0:
            return qtd

    # Campos genéricos. Em f_apontamentos/Cogtive, quando existe TIPO DE EVENTO
    # ou EVENTO de produção, esses campos costumam estar em tubetes.
    # Para outras tabelas, mantém a heurística antiga.
    parece_cogtive = bool(_get_any(row, "tipo_evento", "TIPO DE EVENTO", "evento", "EVENTO", "Origem Apontamento"))
    for campo in (
        "qtd_realizada",
        "qtd_produzida",
        "qtd_apontada",
        "quantidade",
        "qtd",
        "volume",
    ):
        qtd = _to_float(_get_any(row, campo))
        if qtd > 0:
            if parece_cogtive:
                return qtd / TUBETES_POR_CAIXA
            return qtd / TUBETES_POR_CAIXA if qtd > 10000 else qtd

    return 0.0


def _produto_valido_gantt(row: dict[str, Any]) -> bool:
    produto = _normalizar_texto_upper(row.get("descricao_produto") or row.get("produto"))
    codigo = _normalizar_texto_upper(row.get("codigo_produto") or row.get("cod_produto"))
    if produto in {"TOTAL", "TOTAIS"} or codigo in {"TOTAL", "TOTAIS"}:
        return False
    if "AG AVULSO" in produto or produto == "AVULSO":
        return False
    return True


def _competencia_producao(row: dict[str, Any]) -> tuple[int, int]:
    mes = _to_int(row.get("mes_producao") or row.get("mes_prod") or row.get("mes"))
    ano = _to_int(row.get("ano_producao") or row.get("ano_prod") or row.get("ano"))

    if ano and mes:
        return mes, ano

    for campo in ("data_inicio", "data_fim", "data_pa", "data_liberacao", "data"):
        dt = _parse_date_value(row.get(campo))
        if dt:
            return dt.month, dt.year

    return mes, ano


def _plano_jan_v3_producao_ate_mes(ano: int, mes_limite: int) -> dict[str, Any]:
    """
    Plano original de produção/envase acumulado até o mês de referência.

    Usa MES_PRODUÇÃO/ANO_PRODUÇÃO, não mês de liberação, porque o objetivo aqui
    é comparar com o realizado Cogtive/apontamentos.
    """
    chave = f"plano-jan-v3-producao-ate-mes:v1:{ano}:{mes_limite}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    rodada = _rodada_mrp_unica(ano, mes=1, versao=3)
    if not rodada or not rodada.get("id"):
        return _cache_set(chave, {
            "total_cx": 0,
            "por_linha": {},
            "por_mes": {},
            "por_linha_mes": {},
            "por_produto": [],
            "rodada": None,
            "regra": "rodada_jan_v3_nao_encontrada",
        }, ttl=1800)

    try:
        rows = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada.get("id"))
        )
    except Exception:
        rows = []

    total = 0.0
    por_linha: dict[str, float] = {}
    por_mes: dict[str, float] = {}
    por_linha_mes: dict[str, dict[str, float]] = {}
    por_produto_map: dict[tuple[str, str, str], float] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue
        if not _etapa_plano_valida(row):
            continue

        linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
        if linha not in {"L1", "L2"}:
            continue
        if not _produto_valido_gantt(row):
            continue

        mes_prod, ano_prod = _competencia_producao(row)
        if ano_prod != ano or not (1 <= mes_prod <= mes_limite):
            continue

        qtd_cx = _qtd_planejada_cx(row)
        if qtd_cx <= 0:
            continue

        codigo = str(row.get("codigo_produto") or row.get("cod_produto") or "").strip()
        produto = str(row.get("descricao_produto") or row.get("produto") or "").strip()

        total += qtd_cx
        por_linha[linha] = por_linha.get(linha, 0.0) + qtd_cx
        por_mes[str(mes_prod)] = por_mes.get(str(mes_prod), 0.0) + qtd_cx
        por_linha_mes.setdefault(str(mes_prod), {})
        por_linha_mes[str(mes_prod)][linha] = por_linha_mes[str(mes_prod)].get(linha, 0.0) + qtd_cx
        por_produto_map[(linha, codigo, produto)] = por_produto_map.get((linha, codigo, produto), 0.0) + qtd_cx

    por_produto = [
        {"linha": linha, "codigo_produto": codigo, "descricao_produto": produto, "cx": _round(cx)}
        for (linha, codigo, produto), cx in sorted(por_produto_map.items(), key=lambda item: abs(item[1]), reverse=True)
    ]

    return _cache_set(chave, {
        "total_cx": _round(total),
        "por_linha": {k: _round(v) for k, v in sorted(por_linha.items())},
        "por_mes": {k: _round(v) for k, v in sorted(por_mes.items(), key=lambda item: int(item[0]))},
        "por_linha_mes": {
            mes: {linha: _round(cx) for linha, cx in sorted(linhas.items())}
            for mes, linhas in sorted(por_linha_mes.items(), key=lambda item: int(item[0]))
        },
        "por_produto": por_produto,
        "rodada": {
            "id": rodada.get("id"),
            "mes": rodada.get("mes"),
            "versao": rodada.get("versao"),
            "criado_em": rodada.get("criado_em") or rodada.get("created_at"),
        },
        "regra": "f_mrp_etapas Jan/V3 por MES_PRODUCAO ate mes_limite; etapa ENVASE; L1/L2",
    }, ttl=1800)


def _realizado_envase_ate_mes(ano: int, mes_limite: int) -> dict[str, Any]:
    """
    Realizado acumulado de envase até o mês de referência.

    Tenta primeiro f_apontamentos, depois tabelas de produção real. O filtro é
    defensivo para aceitar variações de layout sem quebrar o endpoint.
    """
    chave = f"realizado-envase-ate-mes:v2:{ano}:{mes_limite}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    tabelas = ["f_apontamentos", "f_mrp_producao_real", "f_producao_real"]
    rows: list[dict[str, Any]] = []
    fonte = "nenhuma"
    erros: dict[str, str] = {}

    for tabela in tabelas:
        try:
            rows = _select_all(supabase.table(tabela).select("*"))
            fonte = tabela
            break
        except Exception as exc:
            erros[tabela] = str(exc)
            rows = []

    total = 0.0
    por_linha: dict[str, float] = {}
    por_mes: dict[str, float] = {}
    por_linha_mes: dict[str, dict[str, float]] = {}
    registros_validos = 0
    data_min: date | None = None
    data_max: date | None = None

    for row in rows:
        if not isinstance(row, dict):
            continue
        if not _row_envase_producao_valida(row):
            continue

        dt = _data_row(row)
        if not dt or dt.year != ano or not (1 <= dt.month <= mes_limite):
            continue

        qtd_cx = _qtd_realizada_cx(row)
        if qtd_cx <= 0:
            continue

        linha = _linha_producao_from_row(row)
        if linha not in {"L1", "L2"}:
            continue

        registros_validos += 1
        total += qtd_cx
        data_min = dt if data_min is None or dt < data_min else data_min
        data_max = dt if data_max is None or dt > data_max else data_max
        por_linha[linha] = por_linha.get(linha, 0.0) + qtd_cx
        por_mes[str(dt.month)] = por_mes.get(str(dt.month), 0.0) + qtd_cx
        por_linha_mes.setdefault(str(dt.month), {})
        por_linha_mes[str(dt.month)][linha] = por_linha_mes[str(dt.month)].get(linha, 0.0) + qtd_cx

    return _cache_set(chave, {
        "total_cx": _round(total),
        "por_linha": {k: _round(v) for k, v in sorted(por_linha.items())},
        "por_mes": {k: _round(v) for k, v in sorted(por_mes.items(), key=lambda item: int(item[0]))},
        "por_linha_mes": {
            mes: {linha: _round(cx) for linha, cx in sorted(linhas.items())}
            for mes, linhas in sorted(por_linha_mes.items(), key=lambda item: int(item[0]))
        },
        "data_inicio": data_min.isoformat() if data_min else None,
        "data_fim": data_max.isoformat() if data_max else None,
        "registros_lidos": len(rows),
        "registros_validos": registros_validos,
        "fonte": fonte,
        "erros_fontes": erros,
        "regra": "realizado Cogtive/apontamentos; tipo_evento PRODUCAO quando existir; etapa/recurso ENVASE; L1/L2",
    }, ttl=1800)


def _gap_plano_vs_realizado_envase(ano: int, mes_limite: int) -> dict[str, Any]:
    plano = _plano_jan_v3_producao_ate_mes(ano, mes_limite)
    realizado = _realizado_envase_ate_mes(ano, mes_limite)

    linhas = sorted(set((plano.get("por_linha") or {}).keys()) | set((realizado.get("por_linha") or {}).keys()))
    por_linha = []
    for linha in linhas:
        plano_cx = _round((plano.get("por_linha") or {}).get(linha))
        realizado_cx = _round((realizado.get("por_linha") or {}).get(linha))
        por_linha.append({
            "linha": linha,
            "plano_cx": plano_cx,
            "realizado_cx": realizado_cx,
            "gap_cx": realizado_cx - plano_cx,
        })

    meses = sorted(set((plano.get("por_mes") or {}).keys()) | set((realizado.get("por_mes") or {}).keys()), key=lambda x: int(x))
    por_mes = []
    for mes in meses:
        plano_cx = _round((plano.get("por_mes") or {}).get(mes))
        realizado_cx = _round((realizado.get("por_mes") or {}).get(mes))
        por_mes.append({
            "mes": _to_int(mes),
            "mes_label": MES_LABELS[_to_int(mes) - 1] if 1 <= _to_int(mes) <= 12 else str(mes),
            "plano_cx": plano_cx,
            "realizado_cx": realizado_cx,
            "gap_cx": realizado_cx - plano_cx,
        })

    plano_total = _round(plano.get("total_cx"))
    realizado_total = _round(realizado.get("total_cx"))

    return {
        "plano_cx": plano_total,
        "realizado_cx": realizado_total,
        "gap_cx": realizado_total - plano_total,
        "por_linha": por_linha,
        "por_mes": por_mes,
        "plano": plano,
        "realizado": realizado,
        "regra": "gap = realizado envase acumulado - plano Jan/V3 por MES_PRODUCAO",
    }


def _plano_atual_mrp_liberacao(ano: int, mes_atual: int) -> dict[str, Any]:
    """Total da última rodada do mês atual por ANO/MÊS LIBERAÇÃO em 2026."""
    chave = f"plano-atual-mrp-liberacao:v1:{ano}:{mes_atual}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    rodada = _ultima_rodada_mes(ano, mes_atual)
    if not rodada or not rodada.get("id"):
        return _cache_set(chave, {
            "total_cx": 0,
            "totais_por_mes": {},
            "rodada": None,
            "fonte": "rodada_atual_nao_encontrada",
        }, ttl=1800)

    diag = _total_rodada_por_mes_liberacao(
        ano,
        _to_int(rodada.get("mes")),
        _versao_num(rodada.get("versao")),
    )
    return _cache_set(chave, {
        "total_cx": _round(diag.get("total_cx")),
        "totais_por_mes": diag.get("totais_por_mes") or {},
        "rodada": diag.get("rodada"),
        "fonte": diag.get("fonte"),
        "regra": "ultima_rodada_mes_atual_por_ano_liberacao_2026",
    }, ttl=1800)


def _arraste_2027_por_produto(ano: int, mes_atual: int) -> dict[str, Any]:
    """
    Leitura auxiliar do modal: quanto mudou o volume com ANO_LIBERAÇÃO = 2027
    entre Jan/V3 e a última rodada atual. Não fecha a cascata principal.
    """
    chave = f"arraste-2027-produto:v2:{ano}:{mes_atual}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    plano1 = _rodada_mrp_unica(ano, mes=1, versao=3)
    atual = _ultima_rodada_mes(ano, mes_atual)

    if not plano1 or not atual:
        return _cache_set(chave, {
            "arraste_bruto_para_2027_cx": 0,
            "puxada_ou_reducao_2027_cx": 0,
            "arraste_liquido_para_2027_cx": 0,
            "itens": [],
            "regra": "rodada_nao_encontrada",
        }, ttl=1800)

    rows = _select_etapas_rodadas_bulk([plano1.get("id"), atual.get("id")])

    def ano_liberacao_explicito(row: dict[str, Any]) -> int:
        return _to_int(_get_any(row, "ano_liberacao", "ano_lib", "ANO LIBERAÇÃO", "ANO_LIBERACAO"))

    def acumular(rodada_id: str) -> dict[tuple[str, str, str], float]:
        out: dict[tuple[str, str, str], float] = {}
        for row in rows:
            if str(row.get("rodada_id") or "") != rodada_id:
                continue
            if not _etapa_plano_valida(row):
                continue
            linha = str(_get_any(row, "recurso", "linha_origem", "linha") or "").strip().upper()
            if linha not in {"L1", "L2"}:
                continue
            if not _produto_valido_gantt(row):
                continue
            if ano_liberacao_explicito(row) != 2027:
                continue
            qtd_cx = _qtd_planejada_cx(row)
            if qtd_cx <= 0:
                continue
            codigo = str(_get_any(row, "codigo_produto", "cod_produto", "sku", "SKU") or "").strip()
            produto = str(_get_any(row, "descricao_produto", "produto", "PRODUTO") or "").strip()
            key = (linha, codigo, produto)
            out[key] = out.get(key, 0.0) + qtd_cx
        return out

    jan = acumular(str(plano1.get("id")))
    cur = acumular(str(atual.get("id")))

    itens = []
    bruto = 0.0
    reducao = 0.0
    for key in sorted(set(jan) | set(cur), key=lambda k: abs(cur.get(k, 0.0) - jan.get(k, 0.0)), reverse=True):
        delta = cur.get(key, 0.0) - jan.get(key, 0.0)
        if abs(delta) < 0.5:
            continue
        if delta > 0:
            bruto += delta
        else:
            reducao += delta
        linha, codigo, produto = key
        itens.append({
            "linha": linha,
            "codigo_produto": codigo,
            "descricao_produto": produto,
            "cx_2027_jan_v3": _round(jan.get(key, 0.0)),
            "cx_2027_atual": _round(cur.get(key, 0.0)),
            "delta_2027_cx": _round(delta),
            "arraste_bruto_para_2027_cx": _round(max(delta, 0.0)),
            "puxada_ou_reducao_2027_cx": _round(min(delta, 0.0)),
        })

    return _cache_set(chave, {
        "arraste_bruto_para_2027_cx": _round(bruto),
        "puxada_ou_reducao_2027_cx": _round(reducao),
        "arraste_liquido_para_2027_cx": _round(bruto + reducao),
        "itens": itens,
        "plano1_rodada": {"id": plano1.get("id"), "mes": plano1.get("mes"), "versao": plano1.get("versao")},
        "rodada_atual": {"id": atual.get("id"), "mes": atual.get("mes"), "versao": atual.get("versao")},
        "regra": "volume com ANO_LIBERACAO=2027 na Jan/V3 vs rodada atual",
    }, ttl=1800)

def _step_delta(
    id_: str,
    label: str,
    value: int,
    tone: str,
    lotes: int | None = None,
    clickable: bool = False,
) -> dict[str, Any] | None:
    if abs(value) < 1:
        return None

    step: dict[str, Any] = {
        "id": id_,
        "label": label,
        "kind": "delta",
        "value": value,
        "tone": tone,
    }

    if lotes and lotes > 0:
        step["lotes"] = lotes

    if clickable:
        step["clickable"] = True

    return step






def _agrupar_atraso_alteracoes_plano_steps(
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Agrupa, temporariamente, as causas ainda operacionais/de plano em um único step.

    Mantém separados somente os fatos já auditáveis que a operação quer ver agora:
    - Reprov. lote;
    - Perda rend.;
    - Ganho rend.

    Junta em "Atraso produção / Alterações plano":
    - Atraso produção;
    - Reorg. plano/calendário;
    - Saldo a classificar/conciliação.
    """
    if not steps:
        return steps or []

    ids_agrupar = {
        "atraso-pos-cogtive",
        "atraso-producao",
        "atraso-produção",
        "reorg-plano",
        "reorganizacao-plano",
        "reorganização-plano",
        "saldo-a-classificar",
        "nao-classificado-debug",
    }

    def _deve_agrupar(step: dict[str, Any]) -> bool:
        if str(step.get("kind") or "").lower() != "delta":
            return False
        step_id = str(step.get("id") or "").strip().lower()
        label_norm = _normalizar_texto_upper(step.get("label"))
        if step_id in ids_agrupar:
            return True
        if "ATRASO" in label_norm:
            return True
        if "REORG" in label_norm or "REORGAN" in label_norm:
            return True
        if "SALDO" in label_norm and "CLASSIFIC" in label_norm:
            return True
        return False

    agrupados: list[dict[str, Any]] = []
    mantidos: list[dict[str, Any]] = []
    idx_primeiro: int | None = None

    for idx, step in enumerate(steps):
        if _deve_agrupar(step):
            if idx_primeiro is None:
                idx_primeiro = len(mantidos)
            agrupados.append(step)
            continue
        mantidos.append(step)

    if not agrupados:
        return steps

    valor_componentes_originais = _round(sum(_to_float(step.get("value")) for step in agrupados))

    # Regra temporária validada na operação:
    # enquanto a abertura fina de atraso/reorg/saldo ainda está em validação,
    # o bloco "Atraso produção / Alterações plano" deve absorver TODO o saldo
    # necessário para fechar a ponte, mantendo separados apenas Reprov. lote,
    # Perda rend. e Ganho rend.
    totais = [
        step for step in steps
        if str(step.get("kind") or "").lower() == "total"
    ]
    base_total = _round(totais[0].get("value")) if totais else None
    final_total = _round(totais[-1].get("value")) if len(totais) >= 2 else None

    valor_total = valor_componentes_originais
    ajuste_absorvido = 0
    soma_causas_separadas = 0
    delta_total_oficial = None

    if base_total is not None and final_total is not None:
        delta_total_oficial = _round(final_total - base_total)
        soma_causas_separadas = _round(sum(
            _to_float(step.get("value"))
            for step in mantidos
            if str(step.get("kind") or "").lower() == "delta"
        ))
        valor_total = _round(delta_total_oficial - soma_causas_separadas)
        ajuste_absorvido = _round(valor_total - valor_componentes_originais)

    lotes_total = sum(_to_int(step.get("lotes")) for step in agrupados)

    componentes = []
    for step in agrupados:
        componentes.append({
            "id": step.get("id"),
            "label": step.get("label"),
            "value": _round(step.get("value")),
            "lotes": step.get("lotes"),
            "statusCalculo": step.get("statusCalculo"),
            "observacao": step.get("observacao"),
        })

    if ajuste_absorvido:
        componentes.append({
            "id": "ajuste-fechamento-grupo",
            "label": "Saldo temporariamente absorvido",
            "value": ajuste_absorvido,
            "lotes": None,
            "statusCalculo": "fechamento temporário",
            "observacao": (
                "Diferença necessária para o bloco Atraso produção / Alterações plano fechar exatamente "
                "a disponibilidade atual, sem alterar Reprov. lote, Perda rend. e Ganho rend."
            ),
        })

    step_unificado: dict[str, Any] = {
        "id": "atraso-alteracoes-plano",
        "label": "Atraso produção / Alterações plano",
        "kind": "delta",
        "value": valor_total,
        "tone": "red" if valor_total < 0 else "green",
        "statusCalculo": "agrupado temporariamente",
        "observacao": (
            "Agrupa Atraso produção, Reorg. plano e todo saldo ainda não aberto, mantendo separados "
            "apenas Reprov. lote, Perda rend. e Ganho rend. Assim a cascata fecha matematicamente."
        ),
        "modal": {
            "titulo": "Atraso produção / Alterações plano",
            "delta_cx": valor_total,
            "descricao": (
                "Visão temporária: este bloco absorve o delta restante da ponte depois de separar "
                "reprovação e rendimento. A abertura fina entre atraso, reorg. e saldo pendente será validada depois."
            ),
            "componentes": componentes,
            "calculo": {
                "formula": "delta_total_oficial - Reprov. lote - Perda rend. - Ganho rend.",
                "delta_total_oficial_cx": delta_total_oficial,
                "soma_causas_separadas_cx": soma_causas_separadas,
                "componentes_originais_agrupados_cx": valor_componentes_originais,
                "ajuste_absorvido_no_grupo_cx": ajuste_absorvido,
                "resultado_cx": valor_total,
            },
            "leitura": "Reprov. lote, Perda rend. e Ganho rend. continuam como causas separadas e auditáveis.",
        },
    }
    if lotes_total > 0:
        step_unificado["lotes"] = lotes_total

    # Insere onde estava o primeiro step agrupado, sem mexer nos totais inicial/final.
    pos = idx_primeiro if idx_primeiro is not None else max(0, len(mantidos) - 1)
    mantidos.insert(pos, step_unificado)
    return mantidos

def _conciliar_waterfall_snapshot_steps(
    steps: list[dict[str, Any]],
    base_cx: int,
    final_cx: int,
) -> tuple[list[dict[str, Any]], int]:
    """
    Conciliação leve e segura da waterfall.

    Não recalcula nenhuma fonte pesada. Só compara:
      delta oficial = disponibilidade atual - disponibilidade orçada
      soma causas = soma dos steps delta já carregados
    Se faltar saldo, inclui um step explícito "Saldo a classificar" antes do total final.
    """
    try:
        delta_total = _round(final_cx) - _round(base_cx)
        soma_causas = 0
        steps_limpos: list[dict[str, Any]] = []

        for step in steps or []:
            if str(step.get("id") or "") == "saldo-a-classificar":
                continue
            steps_limpos.append(step)
            if str(step.get("kind") or "").lower() == "delta":
                soma_causas += _round(step.get("value"))

        saldo = _round(delta_total - soma_causas)
        if abs(saldo) < 1:
            return steps_limpos, 0

        step_saldo = {
            "id": "saldo-a-classificar",
            "label": "Saldo a classificar",
            "kind": "delta",
            "value": saldo,
            "tone": "red" if saldo < 0 else "green",
            "statusCalculo": "conciliação",
            "clickable": True,
            "observacao": (
                "Diferença entre o delta total oficial e as causas já classificadas. "
                "Não foi jogado automaticamente em atraso, calendário, rendimento ou reprovação."
            ),
            "modal": {
                "titulo": "Saldo a classificar",
                "delta_cx": saldo,
                "descricao": (
                    "Parcela necessária para fechar matematicamente a ponte entre a disponibilidade anual orçada "
                    "e a disponibilidade atual. Deve ser investigada/classificada na próxima revisão."
                ),
                "calculo": {
                    "formula": "delta_total_oficial - soma_causas_classificadas",
                    "delta_total_oficial_cx": delta_total,
                    "soma_causas_classificadas_cx": _round(soma_causas),
                    "saldo_a_classificar_cx": saldo,
                },
                "leitura": "A cascata não esconde saldo residual; ela mostra explicitamente o que ainda falta classificar.",
            },
        }

        idx_final = next(
            (
                i for i, step in enumerate(steps_limpos)
                if str(step.get("kind") or "").lower() == "total"
                and str(step.get("id") or "") in {"disponibilidade", "disp-atual", "disponibilidade-atual"}
            ),
            None,
        )
        if idx_final is None:
            steps_limpos.append(step_saldo)
        else:
            steps_limpos.insert(idx_final, step_saldo)
        return steps_limpos, saldo
    except Exception:
        # Nunca deixa uma falha de conciliação derrubar a página.
        return steps or [], 0


def _json_safe(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, set):
        return sorted(list(value))
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _compact_row(row: dict[str, Any], max_len: int = 160) -> dict[str, Any]:
    out: dict[str, Any] = {}

    for k, v in row.items():
        value = _json_safe(v)
        if isinstance(value, str) and len(value) > max_len:
            value = value[:max_len] + "..."
        out[str(k)] = value

    return out


def _rows_by_ids(table_name: str, id_col: str, ids: list[Any], limit: int = 80) -> list[dict[str, Any]]:
    if not ids:
        return []

    try:
        return _select_all(
            supabase.table(table_name)
            .select("*")
            .in_(id_col, ids[:120])
            .limit(limit)
        )[:limit]
    except Exception:
        rows: list[dict[str, Any]] = []
        for value in ids[:10]:
            try:
                rows.extend(_select_all(
                    supabase.table(table_name)
                    .select("*")
                    .eq(id_col, value)
                    .limit(10)
                ))
            except Exception:
                continue
        return rows[:limit]


def _columns(rows: list[dict[str, Any]]) -> list[str]:
    cols: set[str] = set()
    for row in rows:
        if isinstance(row, dict):
            cols.update(str(k) for k in row.keys())
    return sorted(cols)


def _annotation_columns(rows: list[dict[str, Any]]) -> list[str]:
    termos = ["obs", "observ", "coment", "anota", "nota", "parada", "motivo", "justif", "descr", "desc"]
    cols = _columns(rows)
    return [c for c in cols if any(t in c.lower() for t in termos)]


def _non_empty_annotation_samples(rows: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    cols = _annotation_columns(rows)
    samples: list[dict[str, Any]] = []

    for row in rows:
        item = {}
        for c in cols:
            value = row.get(c)
            if value is not None and str(value).strip():
                item[c] = value

        if item:
            for c in ["id", "rodada_id", "mes", "versao", "lote", "op", "produto", "codigo_produto", "data_liberacao", "data_inicio"]:
                if c in row and c not in item:
                    item[c] = row.get(c)
            samples.append(_compact_row(item))

        if len(samples) >= limit:
            break

    return samples


def _totais_mps_liberacoes(rows: list[dict[str, Any]]) -> dict[str, Any]:
    por_revisao_versao: dict[str, float] = {}
    jan_por_versao_mes: dict[str, dict[str, float]] = {}

    for row in rows:
        mes_revisao = _to_int(row.get("mes_revisao"))
        versao = _versao_num(row.get("versao"))
        mes = _to_int(row.get("mes"))
        qtd = _qtd_mps_liberacao_cx(row)

        chave = f"rev{mes_revisao}_V{versao}"
        por_revisao_versao[chave] = por_revisao_versao.get(chave, 0.0) + qtd

        if mes_revisao == 1 and versao > 0:
            versao_key = f"V{versao}"
            jan_por_versao_mes.setdefault(versao_key, {})
            jan_por_versao_mes[versao_key][str(mes)] = jan_por_versao_mes[versao_key].get(str(mes), 0.0) + qtd

    return {
        "por_revisao_versao": {k: _round(v) for k, v in sorted(por_revisao_versao.items())},
        "jan_por_versao_mes": {
            v: {m: _round(q) for m, q in sorted(meses.items(), key=lambda x: int(x[0]))}
            for v, meses in sorted(jan_por_versao_mes.items())
        },
    }


@router.get("/diagnostico-fontes")
def get_liberacao_executiva_diagnostico_fontes(
    ano: int | None = Query(default=None),
):
    """
    Diagnóstico das fontes antes de fechar a lógica da cascata.

    Não altera cálculo. Serve para vermos:
    - estrutura real de f_mps_liberacoes;
    - estrutura real de f_mrp_rodadas/f_mrp_etapas;
    - onde estão anotações/paradas/comentários do Gantt;
    - quais colunas usar para lote/OP/data/qtd.
    """
    ano_ref = ano or date.today().year

    try:
        mps_rows = _select_all(
            supabase.table("f_mps_liberacoes")
            .select("*")
            .eq("ano", ano_ref)
        )
    except Exception as exc:
        mps_rows = [{"erro": str(exc)}]

    try:
        rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano_ref)
        )
    except Exception as exc:
        rodadas = [{"erro": str(exc)}]

    rodadas_validas = [
        r for r in rodadas
        if isinstance(r, dict) and r.get("id")
    ]
    rodada_ids = [r.get("id") for r in rodadas_validas[:24]]

    etapas = _rows_by_ids("f_mrp_etapas", "rodada_id", rodada_ids, limit=120)

    mps_cols = _columns([r for r in mps_rows if isinstance(r, dict)])
    etapa_cols = _columns([r for r in etapas if isinstance(r, dict)])

    return _json_safe({
        "ano": ano_ref,
        "mps_liberacoes": {
            "qtd_linhas": len(mps_rows),
            "colunas": mps_cols,
            "amostra": [_compact_row(r) for r in mps_rows[:8] if isinstance(r, dict)],
            "totais": _totais_mps_liberacoes([r for r in mps_rows if isinstance(r, dict)]),
            "colunas_candidatas": {
                "quantidade": [c for c in mps_cols if any(t in c.lower() for t in ["qtd", "quant", "caixa", "cx", "tubete", "volume"])],
                "competencia": [c for c in mps_cols if any(t in c.lower() for t in ["mes", "ano", "data", "compet"])],
                "produto_lote_op": [c for c in mps_cols if any(t in c.lower() for t in ["lote", "op", "produto", "item", "codigo", "cod"])],
            },
        },
        "mrp_rodadas": {
            "qtd_linhas": len(rodadas_validas),
            "colunas": _columns(rodadas_validas),
            "amostra": [_compact_row(r) for r in rodadas_validas[:12]],
            "anotacoes_colunas": _annotation_columns(rodadas_validas),
            "anotacoes_amostra": _non_empty_annotation_samples(rodadas_validas),
        },
        "mrp_etapas": {
            "qtd_amostra": len(etapas),
            "colunas": etapa_cols,
            "amostra": [_compact_row(r) for r in etapas[:12] if isinstance(r, dict)],
            "anotacoes_colunas": _annotation_columns(etapas),
            "anotacoes_amostra": _non_empty_annotation_samples([r for r in etapas if isinstance(r, dict)]),
            "colunas_candidatas": {
                "lote_op": [c for c in etapa_cols if any(t in c.lower() for t in ["lote", "op", "ordem"])],
                "produto": [c for c in etapa_cols if any(t in c.lower() for t in ["produto", "item", "codigo", "cod"])],
                "data": [c for c in etapa_cols if any(t in c.lower() for t in ["data", "dt", "inicio", "fim", "liber"])],
                "quantidade": [c for c in etapa_cols if any(t in c.lower() for t in ["qtd", "quant", "caixa", "cx", "tubete", "volume"])],
                "linha_equipamento": [c for c in etapa_cols if any(t in c.lower() for t in ["linha", "equip", "maq", "maquina"])],
            },
        },
        "leitura": {
            "proxima_decisao": "Usar este diagnóstico para ajustar as colunas exatas de lote/OP, data, quantidade e anotações do Gantt antes de fechar a cascata.",
            "sem_saldo_no_grafico": True,
        },
    })



@router.get("/diagnostico-rodada")
def get_liberacao_executiva_diagnostico_rodada(
    ano: int | None = Query(default=None),
    mes: int = Query(default=1, ge=1, le=12),
    versao: int = Query(default=3, ge=1),
):
    """
    Diagnóstico de uma rodada específica do Gantt/MPS.

    Objetivo:
    - Confirmar se Janeiro/V3 do Gantt/MPS soma 220.534 cx.
    - Ver por mês de liberação, linha, lote/OP e observação.
    """
    ano_ref = ano or date.today().year

    try:
        rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano_ref)
            .eq("mes", mes)
            .eq("versao", versao)
        )
    except Exception as exc:
        return {"erro": str(exc), "etapa": "buscar_rodadas"}

    if not rodadas:
        return {
            "ano": ano_ref,
            "mes": mes,
            "versao": versao,
            "erro": "rodada_nao_encontrada",
        }

    rodada = sorted(
        rodadas,
        key=lambda r: str(r.get("criado_em") or r.get("created_at") or ""),
    )[-1]

    rodada_id = rodada.get("id")

    try:
        etapas = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada_id)
        )
    except Exception as exc:
        return {"erro": str(exc), "etapa": "buscar_etapas", "rodada": _json_safe(rodada)}

    linhas_validas = {"L1", "L2"}
    etapas_validas: list[dict[str, Any]] = []

    totais_por_mes: dict[str, float] = {}
    totais_por_linha: dict[str, float] = {}
    totais_por_mes_linha: dict[str, dict[str, float]] = {}
    lotes_por_mes: dict[str, set[str]] = {}
    anotacoes: list[dict[str, Any]] = []

    for row in etapas:
        if not _etapa_plano_valida(row):
            continue

        linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
        if linha not in linhas_validas:
            continue

        mes_lib, ano_lib = _competencia_liberacao(row)
        if ano_lib != ano_ref or not mes_lib:
            continue

        qtd_cx = _qtd_planejada_cx(row)
        if qtd_cx <= 0:
            continue

        lote = _lote_key(row) or str(row.get("id") or "")

        item = dict(row)
        item["_mes_lib"] = mes_lib
        item["_ano_lib"] = ano_lib
        item["_qtd_cx"] = qtd_cx
        item["_linha_calc"] = linha
        etapas_validas.append(item)

        mes_key = str(mes_lib)
        totais_por_mes[mes_key] = totais_por_mes.get(mes_key, 0.0) + qtd_cx
        totais_por_linha[linha] = totais_por_linha.get(linha, 0.0) + qtd_cx
        totais_por_mes_linha.setdefault(mes_key, {})
        totais_por_mes_linha[mes_key][linha] = totais_por_mes_linha[mes_key].get(linha, 0.0) + qtd_cx
        lotes_por_mes.setdefault(mes_key, set()).add(lote)

        obs = str(row.get("observacao") or "").strip()
        if obs and len(anotacoes) < 60:
            anotacoes.append({
                "lote": lote,
                "op": row.get("op"),
                "linha": linha,
                "mes_liberacao": mes_lib,
                "qtd_cx": _round(qtd_cx),
                "observacao": obs,
            })

    total_cx = sum(totais_por_mes.values())

    return _json_safe({
        "ano": ano_ref,
        "mes_revisao": mes,
        "versao": versao,
        "rodada": _compact_row(rodada),
        "qtd_etapas_total": len(etapas),
        "qtd_etapas_validas_l1_l2_ano": len(etapas_validas),
        "total_cx": _round(total_cx),
        "total_tubetes": _round(total_cx * TUBETES_POR_CAIXA),
        "totais_por_mes": {k: _round(v) for k, v in sorted(totais_por_mes.items(), key=lambda x: int(x[0]))},
        "totais_por_linha": {k: _round(v) for k, v in sorted(totais_por_linha.items())},
        "totais_por_mes_linha": {
            mes_key: {linha: _round(qtd) for linha, qtd in sorted(linhas.items())}
            for mes_key, linhas in sorted(totais_por_mes_linha.items(), key=lambda x: int(x[0]))
        },
        "lotes_por_mes": {
            mes_key: len(lotes)
            for mes_key, lotes in sorted(lotes_por_mes.items(), key=lambda x: int(x[0]))
        },
        "amostra_etapas_validas": [
            _compact_row({
                "lote": row.get("lote"),
                "op": row.get("op"),
                "codigo_produto": row.get("codigo_produto"),
                "descricao_produto": row.get("descricao_produto"),
                "linha": row.get("_linha_calc"),
                "data_inicio": row.get("data_inicio"),
                "data_fim": row.get("data_fim"),
                "data_pa": row.get("data_pa"),
                "mes_liberacao": row.get("_mes_lib"),
                "ano_liberacao": row.get("_ano_lib"),
                "qtd_planejada": row.get("qtd_planejada"),
                "qtd_cx": _round(row.get("_qtd_cx")),
                "observacao": row.get("observacao"),
            })
            for row in etapas_validas[:30]
        ],
        "anotacoes_amostra": anotacoes,
        "leitura": {
            "meta_esperada_cx_para_jan_v3_2026": 220534 if ano_ref == 2026 and mes == 1 and versao == 3 else None,
            "proxima_decisao": "Se total_cx bater 220.534, a base anual deve vir de f_mrp_etapas/rodada Jan V3, não de f_mps_liberacoes.",
        },
    })



def _rodadas_mes_diagnostico(ano: int, mes: int) -> list[dict[str, Any]]:
    try:
        rows = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano)
            .eq("mes", mes)
        )
    except Exception:
        return []

    validas = [
        r for r in rows
        if isinstance(r, dict) and r.get("id") and _versao_num(r.get("versao")) > 0
    ]

    return sorted(
        validas,
        key=lambda r: (
            _versao_num(r.get("versao")),
            str(r.get("criado_em") or r.get("created_at") or ""),
        ),
    )


def _ultima_rodada_mes(ano: int, mes: int) -> dict[str, Any] | None:
    rodadas = _rodadas_mes_diagnostico(ano, mes)
    return rodadas[-1] if rodadas else None


def _total_rodada_por_mes_liberacao(ano: int, mes_revisao: int, versao: int) -> dict[str, Any]:
    plano = _total_rodada_mrp_cx(ano, mes=mes_revisao, versao=versao)
    return {
        "mes_revisao": mes_revisao,
        "versao": versao,
        "total_cx": _round(plano.get("total_cx")),
        "totais_por_mes": plano.get("totais_por_mes") or {},
        "rodada": plano.get("rodada"),
        "fonte": plano.get("fonte"),
    }


@router.get("/diagnostico-plano-atual")
def get_liberacao_executiva_diagnostico_plano_atual(
    ano: int | None = Query(default=None),
    mes_atual: int | None = Query(default=None, ge=1, le=12),
):
    """
    Diagnóstico para descobrir qual composição de Gantt/MRP bate com a
    disponibilidade atual da Overview.

    Não altera a tela.
    Não fecha cálculo.
    Só compara possíveis regras de composição.
    """
    hoje = date.today()
    ano_ref = ano or hoje.year
    mes_ref = mes_atual or hoje.month

    overview_resumo = _safe_overview_resumo()
    payload = _payload_overview(overview_resumo)
    proj_liberacoes = payload.get("projecao_liberacoes") or {}

    total_overview = _round(proj_liberacoes.get("total_projetado"))
    estoque_jan_cx = _estoque_inicial_jan(ano_ref)
    if estoque_jan_cx <= 0 and ano_ref == 2026:
        estoque_jan_cx = ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026

    plano1 = _total_rodada_por_mes_liberacao(ano_ref, 1, 3)
    plano1_por_mes = plano1.get("totais_por_mes") or {}

    # Opção A:
    # Usa a última rodada do mês atual como visão atual para o ano todo.
    rodada_atual = _ultima_rodada_mes(ano_ref, mes_ref)
    opcao_a = None
    if rodada_atual:
        opcao_a = _total_rodada_por_mes_liberacao(
            ano_ref,
            _to_int(rodada_atual.get("mes")),
            _versao_num(rodada_atual.get("versao")),
        )

    # Opção B:
    # Meses fechados: última rodada do próprio mês.
    # Mês atual e futuros: última rodada do mês atual.
    meses_b: list[dict[str, Any]] = []
    total_b = 0

    for mes in range(1, 13):
        if mes < mes_ref:
            rodada_base = _ultima_rodada_mes(ano_ref, mes)
            regra = "ultima_rodada_do_proprio_mes"
        else:
            rodada_base = rodada_atual
            regra = "ultima_rodada_do_mes_atual"

        if rodada_base:
            diag = _total_rodada_por_mes_liberacao(
                ano_ref,
                _to_int(rodada_base.get("mes")),
                _versao_num(rodada_base.get("versao")),
            )
            valor_mes = _round((diag.get("totais_por_mes") or {}).get(str(mes)))
            rodada_info = diag.get("rodada")
        else:
            valor_mes = 0
            rodada_info = None

        total_b += valor_mes

        meses_b.append({
            "mes": mes,
            "valor_cx": valor_mes,
            "plano1_cx": _round(plano1_por_mes.get(str(mes))),
            "delta_vs_plano1_cx": valor_mes - _round(plano1_por_mes.get(str(mes))),
            "regra": regra,
            "rodada": rodada_info,
        })

    # Opção C:
    # Usa sempre última rodada disponível de cada mês, inclusive futuros se existirem.
    meses_c: list[dict[str, Any]] = []
    total_c = 0

    for mes in range(1, 13):
        rodada_base = _ultima_rodada_mes(ano_ref, mes)

        if rodada_base:
            diag = _total_rodada_por_mes_liberacao(
                ano_ref,
                _to_int(rodada_base.get("mes")),
                _versao_num(rodada_base.get("versao")),
            )
            valor_mes = _round((diag.get("totais_por_mes") or {}).get(str(mes)))
            rodada_info = diag.get("rodada")
        else:
            valor_mes = 0
            rodada_info = None

        total_c += valor_mes

        meses_c.append({
            "mes": mes,
            "valor_cx": valor_mes,
            "plano1_cx": _round(plano1_por_mes.get(str(mes))),
            "delta_vs_plano1_cx": valor_mes - _round(plano1_por_mes.get(str(mes))),
            "regra": "ultima_rodada_disponivel_do_mes",
            "rodada": rodada_info,
        })

    rodadas_resumo = []
    for mes in range(1, 13):
        rodadas = _rodadas_mes_diagnostico(ano_ref, mes)
        rodadas_resumo.append({
            "mes": mes,
            "versoes": [_versao_num(r.get("versao")) for r in rodadas],
            "qtd_rodadas": len(rodadas),
            "ultima": {
                "id": rodadas[-1].get("id"),
                "versao": _versao_num(rodadas[-1].get("versao")),
                "criado_em": rodadas[-1].get("criado_em") or rodadas[-1].get("created_at"),
            } if rodadas else None,
        })

    return {
        "ano": ano_ref,
        "mes_atual_usado": mes_ref,
        "overview": {
            "projecao_liberacoes_total_projetado_cx": total_overview,
            "estoque_inicial_jan_cx": estoque_jan_cx,
            "disponibilidade_atual_com_estoque_cx": total_overview + estoque_jan_cx,
        },
        "plano1": {
            "total_cx": plano1.get("total_cx"),
            "com_estoque_cx": _round(plano1.get("total_cx")) + estoque_jan_cx,
            "totais_por_mes": plano1_por_mes,
            "rodada": plano1.get("rodada"),
        },
        "opcao_a_ultima_rodada_mes_atual_ano_todo": {
            "total_cx": opcao_a.get("total_cx") if opcao_a else 0,
            "diferenca_vs_overview_cx": (_round(opcao_a.get("total_cx")) - total_overview) if opcao_a else None,
            "totais_por_mes": opcao_a.get("totais_por_mes") if opcao_a else {},
            "rodada": opcao_a.get("rodada") if opcao_a else None,
        },
        "opcao_b_meses_fechados_proprios_futuro_mes_atual": {
            "total_cx": total_b,
            "diferenca_vs_overview_cx": total_b - total_overview,
            "meses": meses_b,
        },
        "opcao_c_ultima_rodada_disponivel_de_cada_mes": {
            "total_cx": total_c,
            "diferenca_vs_overview_cx": total_c - total_overview,
            "meses": meses_c,
        },
        "rodadas_por_mes": rodadas_resumo,
        "leitura": {
            "objetivo": "Identificar qual composição bate com a projeção de liberações da Overview antes de quebrar Atraso e Reorg.",
            "proximo_passo": "Usar a opção cujo total_cx ficar igual ou mais próximo de overview.projecao_liberacoes_total_projetado_cx.",
        },
    }



def _plano_atual_gantt_opcao_b(ano: int, mes_atual: int) -> dict[str, Any]:
    """
    Plano atual do Gantt/MRP pela regra que mais aproxima a Overview:
    - meses fechados: última rodada do próprio mês;
    - mês atual e futuros: última rodada do mês atual.

    Retorna totais por mês para comparar contra Jan/V3.
    """
    rodada_atual = _ultima_rodada_mes(ano, mes_atual)

    meses: list[dict[str, Any]] = []
    total = 0

    for mes in range(1, 13):
        if mes < mes_atual:
            rodada_base = _ultima_rodada_mes(ano, mes)
            regra = "ultima_rodada_do_proprio_mes"
        else:
            rodada_base = rodada_atual
            regra = "ultima_rodada_do_mes_atual"

        if rodada_base:
            diag = _total_rodada_por_mes_liberacao(
                ano,
                _to_int(rodada_base.get("mes")),
                _versao_num(rodada_base.get("versao")),
            )
            valor_mes = _round((diag.get("totais_por_mes") or {}).get(str(mes)))
            rodada_info = diag.get("rodada")
        else:
            valor_mes = 0
            rodada_info = None

        total += valor_mes

        meses.append({
            "mes": mes,
            "valor_cx": valor_mes,
            "regra": regra,
            "rodada": rodada_info,
        })

    return {
        "total_cx": total,
        "meses": meses,
        "rodada_atual": rodada_atual,
        "regra": "fechados_proprio_mes_atual_futuros_mes_atual",
    }


def _gantt_causas_por_delta_mensal(ano: int, mes_atual: int, plano1_por_mes: dict[str, Any]) -> dict[str, Any]:
    """
    Calcula Reorg. e Atraso pela diferença mensal entre:
    - Plano 1: Jan/V3 do Gantt/MRP
    - Plano atual: composição que bate mais próximo da Overview

    Reorg. = meses que aumentaram vs Plano 1.
    Atraso prod. = meses que reduziram vs Plano 1.
    """
    atual = _plano_atual_gantt_opcao_b(ano, mes_atual)

    reorg = 0
    atraso = 0
    detalhes: list[dict[str, Any]] = []

    for item in atual.get("meses", []):
        mes = _to_int(item.get("mes"))
        valor_atual = _round(item.get("valor_cx"))
        valor_plano1 = _round(plano1_por_mes.get(str(mes)))
        delta = valor_atual - valor_plano1

        if delta > 0:
            reorg += delta
        elif delta < 0:
            atraso += abs(delta)

        detalhes.append({
            "mes": mes,
            "plano1_cx": valor_plano1,
            "plano_atual_cx": valor_atual,
            "delta_cx": delta,
            "causa_macro": "Reorg." if delta > 0 else ("Atraso prod." if delta < 0 else "Sem variação"),
            "regra": item.get("regra"),
            "rodada": item.get("rodada"),
        })

    return {
        "reorg": reorg,
        "atraso": atraso,
        "total_plano_atual_gantt_cx": atual.get("total_cx"),
        "detalhes": detalhes,
        "rodada_atual": atual.get("rodada_atual"),
        "regra": atual.get("regra"),
    }


def _median(values: list[float], default: float = 0.0) -> float:
    nums = sorted([_to_float(v) for v in values if _to_float(v) > 0])
    if not nums:
        return default
    meio = len(nums) // 2
    if len(nums) % 2:
        return nums[meio]
    return (nums[meio - 1] + nums[meio]) / 2.0


def _gantt_lotes_equivalentes_atraso_delta_mensal(
    ano: int,
    mes_atual: int,
    plano1_rodada: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Conta lotes equivalentes perdidos por atraso de produção.

    Por que não contar lote real puro?
    - O Plano 1 Jan/V3 tem vários slots sem lote/OP real preenchido.
    - O plano atual já pode ter lote real em parte das linhas.
    - Se compararmos lote a lote, parece que milhares de caixas "sumiram" e
      "entraram" só por mudança de identificação, não por perda real.

    Regra aqui:
    - mantém o valor de Atraso prod. pela diferença mensal líquida;
    - quebra o delta negativo por mês + linha + produto;
    - converte caixas perdidas em lote equivalente usando o tamanho típico do
      lote naquela linha/produto, calculado pelas próprias linhas do Gantt;
    - isso dá um contador executivo auditável: quantos lotes produtivos
      equivalentes deixaram de estar disponíveis por atraso.
    """
    chave_cache = f"lotes-atraso-equivalentes:v1:{ano}:{mes_atual}:{(plano1_rodada or {}).get('id') or 'sem_plano1'}"
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    if not plano1_rodada or not plano1_rodada.get("id"):
        return _cache_set(chave_cache, {
            "lotes_atraso_equivalentes": 0,
            "cx_atraso_base_calculo": 0,
            "detalhes": [],
            "qtd_detalhes_total": 0,
            "regra": "sem_plano1",
        }, ttl=1800)

    rodada_atual = _ultima_rodada_mes(ano, mes_atual)

    rodadas_por_mes: dict[int, dict[str, Any] | None] = {}
    for mes in range(1, 13):
        if mes < mes_atual:
            rodadas_por_mes[mes] = _ultima_rodada_mes(ano, mes)
        else:
            rodadas_por_mes[mes] = rodada_atual

    rodadas_necessarias: list[dict[str, Any]] = []
    vistos: set[str] = set()
    for rodada in [plano1_rodada, *[r for r in rodadas_por_mes.values() if r]]:
        rid = str((rodada or {}).get("id") or "")
        if not rid or rid in vistos:
            continue
        vistos.add(rid)
        rodadas_necessarias.append(rodada)

    rows = _select_etapas_rodadas_bulk([r.get("id") for r in rodadas_necessarias])
    rows_por_rodada: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        rid = str(row.get("rodada_id") or "")
        if rid:
            rows_por_rodada.setdefault(rid, []).append(row)

    def normalizar_linha(row: dict[str, Any]) -> str:
        return str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()

    def chave_produto(row: dict[str, Any]) -> tuple[str, str, str]:
        linha = normalizar_linha(row)
        codigo = str(row.get("codigo_produto") or row.get("cod_produto") or "").strip().upper()
        produto = str(row.get("descricao_produto") or row.get("produto") or "").strip().upper()
        return linha, codigo, produto

    def fallback_lote_linha(linha: str) -> float:
        if linha == "L1":
            return 600.0
        if linha == "L2":
            return 288.0
        return 500.0

    def agrupar_mes(rodada: dict[str, Any] | None, mes_filtro: int) -> dict[tuple[str, str, str], dict[str, Any]]:
        rid = str((rodada or {}).get("id") or "")
        if not rid:
            return {}

        mapa: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in rows_por_rodada.get(rid, []):
            if not isinstance(row, dict) or not _etapa_plano_valida(row):
                continue

            linha = normalizar_linha(row)
            if linha not in {"L1", "L2"}:
                continue

            mes_lib, ano_lib = _competencia_liberacao(row)
            if ano_lib != ano or mes_lib != mes_filtro:
                continue

            produto = str(row.get("descricao_produto") or row.get("produto") or "").strip().upper()
            codigo = str(row.get("codigo_produto") or row.get("cod_produto") or "").strip().upper()
            if produto in {"TOTAL", "TOTAIS"} or codigo in {"TOTAL", "TOTAIS"}:
                continue
            if "AG AVULSO" in produto or produto == "AVULSO":
                continue

            qtd_cx = _qtd_planejada_cx(row)
            if qtd_cx <= 0:
                continue

            key = chave_produto(row)
            item = mapa.setdefault(key, {
                "cx": 0.0,
                "lotes_reais": set(),
                "tamanhos_lote": [],
                "linha": linha,
                "codigo": codigo,
                "produto": produto,
            })
            item["cx"] += qtd_cx

            # Cada linha do Gantt normalmente representa um lote/slot produtivo.
            # Guardamos o tamanho para transformar perda em lote equivalente.
            if qtd_cx > 0:
                item["tamanhos_lote"].append(qtd_cx)

            lote_real = _chave_lote_real_gantt(row)
            if lote_real:
                item["lotes_reais"].add(lote_real)

        return mapa

    detalhes: list[dict[str, Any]] = []
    total_lotes_equiv = 0.0
    total_cx_atraso = 0.0

    for mes in range(1, 13):
        rodada_comp = rodadas_por_mes.get(mes)
        base = agrupar_mes(plano1_rodada, mes)
        atual = agrupar_mes(rodada_comp, mes)

        for key in sorted(set(base.keys()) | set(atual.keys())):
            a = base.get(key) or {}
            b = atual.get(key) or {}
            base_cx = _to_float(a.get("cx"))
            atual_cx = _to_float(b.get("cx"))
            delta = atual_cx - base_cx
            if delta >= -0.5:
                continue

            linha = str((a or b).get("linha") or key[0] or "")
            tamanhos = list(a.get("tamanhos_lote") or []) + list(b.get("tamanhos_lote") or [])
            tamanho_lote = _median(tamanhos, fallback_lote_linha(linha))
            if tamanho_lote <= 0:
                tamanho_lote = fallback_lote_linha(linha)

            atraso_cx = abs(delta)
            lotes_equiv = atraso_cx / tamanho_lote if tamanho_lote > 0 else 0.0
            # Para leitura executiva, lote parcial também consome um lote produtivo.
            lotes_equiv_arred = int(math.ceil(lotes_equiv - 1e-9)) if lotes_equiv > 0 else 0

            total_cx_atraso += atraso_cx
            total_lotes_equiv += lotes_equiv_arred

            detalhe = {
                "mes": mes,
                "linha": linha,
                "codigo": (a or b).get("codigo") or key[1],
                "produto": (a or b).get("produto") or key[2],
                "plano1_cx": _round(base_cx),
                "plano_atual_cx": _round(atual_cx),
                "delta_cx": -_round(atraso_cx),
                "tamanho_lote_ref_cx": _round(tamanho_lote),
                "lotes_equivalentes": lotes_equiv_arred,
                "lotes_reais_plano1": len(a.get("lotes_reais") or set()),
                "lotes_reais_atual": len(b.get("lotes_reais") or set()),
                "regra": "delta_negativo_mes_linha_produto_dividido_por_lote_tipico",
            }
            detalhes.append(detalhe)

    return _cache_set(chave_cache, {
        "lotes_atraso_equivalentes": int(total_lotes_equiv),
        "cx_atraso_base_calculo": _round(total_cx_atraso),
        "detalhes": detalhes[:300],
        "qtd_detalhes_total": len(detalhes),
        "regra": "lotes_equivalentes_por_delta_mensal_linha_produto",
    }, ttl=1800)




def _gantt_lotes_empurrados_fora_do_ano(
    ano: int,
    mes_atual: int | None = None,
    lotes_reprovados: set[str] | None = None,
) -> dict[str, Any]:
    """
    Conta quantos lotes produtivos foram perdidos no ano por atraso de produção.

    Regra operacional validada:
    - cada linha do MPS/Gantt = 1 lote macro;
    - Plano 1 = MPS Janeiro/V3;
    - Plano atual = última versão disponível do mês atual, ex.: Jun/V4;
    - se a linha estava com MÊS/ANO LIBERAÇÃO dentro de 2026 no Plano 1
      e agora a mesma linha macro está com ANO LIBERAÇÃO > 2026, conta 1 lote
      perdido por atraso de produção;
    - usa MES_LIBERACAO / ANO_LIBERACAO, não data início/fim, porque as datas
      mudam justamente quando o lote atrasa;
    - quando existe lote/OP nas duas versões, usa esse identificador;
    - quando ainda não existe lote/OP, casa por linha + produto + qtd + ocorrência
      daquela linha no MPS, porque o Gantt macro pode não ter lote real preenchido.

    Importante: o VALOR em caixas da cascata continua vindo do delta mensal líquido
    para fechar a ponte. Esta função calcula a QTD de lotes perdidos por atraso.
    """

    lotes_reprovados_norm = {
        str(l).strip().upper()
        for l in (lotes_reprovados or set())
        if str(l).strip()
    }

    def normalizar_linha(row: dict[str, Any]) -> str:
        return str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()

    def normalizar_texto(value: Any) -> str:
        return " ".join(str(value or "").strip().upper().split())

    def competencia_liberacao_linha(row: dict[str, Any]) -> tuple[int, int]:
        mes_lib, ano_lib = _competencia_liberacao(row)
        mes_lib = _to_int(mes_lib)
        ano_lib = _to_int(ano_lib)

        # Fallback para importações antigas: se MES/ANO LIBERAÇÃO estiver vazio,
        # usa data_pa/data_liberacao/data_fim apenas como contingência.
        if not ano_lib:
            for campo in ("data_pa", "data_liberacao", "data_fim"):
                raw = row.get(campo)
                if not raw:
                    continue
                texto = str(raw)
                try:
                    ano_lib = int(texto[:4])
                    if len(texto) >= 7:
                        mes_lib = int(texto[5:7])
                    break
                except Exception:
                    continue

        return mes_lib, ano_lib

    def dentro_do_ano(row: dict[str, Any]) -> bool:
        mes_lib, ano_lib = competencia_liberacao_linha(row)
        return ano_lib == ano and 1 <= mes_lib <= 12

    def fora_do_ano_para_frente(row: dict[str, Any]) -> bool:
        _mes_lib, ano_lib = competencia_liberacao_linha(row)
        return ano_lib > ano

    def linha_valida(row: dict[str, Any]) -> bool:
        if not isinstance(row, dict) or not _etapa_plano_valida(row):
            return False
        linha = normalizar_linha(row)
        if linha not in {"L1", "L2"}:
            return False
        produto = normalizar_texto(row.get("descricao_produto") or row.get("produto"))
        codigo = normalizar_texto(row.get("codigo_produto"))
        if produto in {"TOTAL", "TOTAIS"} or codigo in {"TOTAL", "TOTAIS"}:
            return False
        if "AG AVULSO" in produto or produto == "AVULSO":
            return False
        if _qtd_planejada_cx(row) <= 0:
            return False
        return True

    def chave_real(row: dict[str, Any]) -> str | None:
        # Lote/OP é ótimo quando existe. Mas em muitos Gantts macro futuros ainda
        # vem vazio, então isso é só a primeira tentativa de casamento.
        valor = _lote_key(row)
        if not valor:
            return None
        valor = normalizar_texto(valor)
        invalidos = {"-", "--", "N/A", "NA", "NONE", "NULL", "SEM LOTE", "SEM_LOTE"}
        if valor in invalidos:
            return None
        return valor

    def chave_macro_base(row: dict[str, Any]) -> tuple[str, str, int]:
        linha = normalizar_linha(row)
        codigo = normalizar_texto(row.get("codigo_produto"))
        produto = normalizar_texto(row.get("descricao_produto") or row.get("produto"))
        # Código é mais estável que descrição. Se não tiver código, usa descrição.
        sku = codigo or produto
        qtd_cx = _round(_qtd_planejada_cx(row))
        return (linha, sku, qtd_cx)

    def ordenacao_mps(row: dict[str, Any]) -> tuple[Any, ...]:
        # A sequência/ordem de importação é a melhor referência de ocorrência.
        # Datas entram só para ordenar fallback; não entram na identidade porque mudam.
        seq = _to_int(row.get("sequencia"), 999999)
        return (
            seq,
            str(row.get("data_inicio") or ""),
            str(row.get("data_fim") or ""),
            str(row.get("data_pa") or ""),
            str(row.get("id") or ""),
        )

    def rows_rodada(rodada: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not rodada or not rodada.get("id"):
            return []
        try:
            rows = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("rodada_id", rodada.get("id"))
            )
        except Exception:
            rows = []
        validas = [r for r in rows if linha_valida(r)]
        return sorted(validas, key=ordenacao_mps)

    def pares_mps(plano1_rows: list[dict[str, Any]], atual_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """
        Casa linhas do Plano 1 com linhas do plano atual.

        Estratégia:
        1) casa por lote/OP quando o mesmo identificador existe de forma única nos dois planos;
        2) o restante casa por grupo macro (linha + produto/código + qtd cx) e ocorrência.

        Isso evita contar como atraso uma simples troca de lote real preenchido depois,
        e também evita depender de data início/fim, que é justamente o que muda.
        """
        base_usados: set[int] = set()
        atual_usados: set[int] = set()
        pares: list[dict[str, Any]] = []

        base_por_real: dict[str, list[int]] = {}
        atual_por_real: dict[str, list[int]] = {}
        for i, row in enumerate(plano1_rows):
            key = chave_real(row)
            if key:
                base_por_real.setdefault(key, []).append(i)
        for j, row in enumerate(atual_rows):
            key = chave_real(row)
            if key:
                atual_por_real.setdefault(key, []).append(j)

        for key in sorted(set(base_por_real) & set(atual_por_real)):
            # Só usa chave real quando ela é única dos dois lados. Se for repetida,
            # cai no matching macro por ocorrência para não emparelhar errado.
            if len(base_por_real[key]) != 1 or len(atual_por_real[key]) != 1:
                continue
            i = base_por_real[key][0]
            j = atual_por_real[key][0]
            base_usados.add(i)
            atual_usados.add(j)
            pares.append({
                "key": f"REAL|{key}",
                "metodo": "lote_op_real",
                "base_idx": i,
                "atual_idx": j,
                "plano1": plano1_rows[i],
                "atual": atual_rows[j],
            })

        base_grupos: dict[tuple[str, str, int], list[int]] = {}
        atual_grupos: dict[tuple[str, str, int], list[int]] = {}
        for i, row in enumerate(plano1_rows):
            if i in base_usados:
                continue
            base_grupos.setdefault(chave_macro_base(row), []).append(i)
        for j, row in enumerate(atual_rows):
            if j in atual_usados:
                continue
            atual_grupos.setdefault(chave_macro_base(row), []).append(j)

        sem_par_atual = 0
        extras_atual = 0
        for grupo in sorted(set(base_grupos) | set(atual_grupos)):
            base_idxs = sorted(base_grupos.get(grupo, []), key=lambda i: ordenacao_mps(plano1_rows[i]))
            atual_idxs = sorted(atual_grupos.get(grupo, []), key=lambda j: ordenacao_mps(atual_rows[j]))
            n = min(len(base_idxs), len(atual_idxs))
            sem_par_atual += max(0, len(base_idxs) - n)
            extras_atual += max(0, len(atual_idxs) - n)
            for occ in range(n):
                i = base_idxs[occ]
                j = atual_idxs[occ]
                base_usados.add(i)
                atual_usados.add(j)
                linha, sku, qtd_cx = grupo
                pares.append({
                    "key": f"MACRO|{linha}|{sku}|{qtd_cx}|OCC|{occ + 1}",
                    "metodo": "macro_linha_produto_qtd_ocorrencia",
                    "base_idx": i,
                    "atual_idx": j,
                    "ocorrencia": occ + 1,
                    "plano1": plano1_rows[i],
                    "atual": atual_rows[j],
                })

        debug = {
            "pares_por_lote_op_real": sum(1 for p in pares if p.get("metodo") == "lote_op_real"),
            "pares_por_macro_ocorrencia": sum(1 for p in pares if p.get("metodo") == "macro_linha_produto_qtd_ocorrencia"),
            "pares_mapeados_total": len(pares),
            "linhas_plano1_sem_par_atual": sem_par_atual,
            "linhas_atual_extras_sem_par_plano1": extras_atual,
        }
        return pares, debug

    mes_ref = mes_atual or date.today().month
    plano1_rodada = _rodada_mrp_unica(ano, mes=1, versao=3)
    rodada_atual = _ultima_rodada_mes(ano, mes_ref)

    plano1_rows = rows_rodada(plano1_rodada)
    atual_rows = rows_rodada(rodada_atual)
    pares, debug_pares = pares_mps(plano1_rows, atual_rows)

    lotes_empurrados: set[str] = set()
    detalhes: list[dict[str, Any]] = []
    caixas_empurradas = 0.0
    linhas_plano1_no_ano = 0
    linhas_deslocadas_dentro_ano = 0
    linhas_fora_ano = 0
    linhas_reprovadas_excluidas = 0

    for row in plano1_rows:
        if dentro_do_ano(row):
            linhas_plano1_no_ano += 1

    for par in pares:
        row_prev = par["plano1"]
        row_curr = par["atual"]

        if not dentro_do_ano(row_prev):
            continue

        lote_prev = chave_real(row_prev)
        lote_curr = chave_real(row_curr)
        lote_ref = str(lote_prev or lote_curr or "").strip().upper()
        if lote_ref and lote_ref in lotes_reprovados_norm:
            linhas_reprovadas_excluidas += 1
            continue

        mes_prev, ano_prev = competencia_liberacao_linha(row_prev)
        mes_curr, ano_curr = competencia_liberacao_linha(row_curr)

        if ano_curr == ano and 1 <= mes_curr <= 12 and mes_curr != mes_prev:
            linhas_deslocadas_dentro_ano += 1

        if not fora_do_ano_para_frente(row_curr):
            continue

        unique_key = str(par.get("key") or f"{par.get('base_idx')}|{par.get('atual_idx')}")
        if unique_key in lotes_empurrados:
            continue

        lotes_empurrados.add(unique_key)
        linhas_fora_ano += 1

        qtd_cx = _qtd_planejada_cx(row_prev) or _qtd_planejada_cx(row_curr)
        caixas_empurradas += qtd_cx

        detalhes.append({
            "linha_mps_key": unique_key,
            "metodo_casamento": par.get("metodo"),
            "ocorrencia": par.get("ocorrencia"),
            "linha": normalizar_linha(row_prev),
            "sequencia_plano1": row_prev.get("sequencia"),
            "sequencia_atual": row_curr.get("sequencia"),
            "codigo_produto": row_prev.get("codigo_produto") or row_curr.get("codigo_produto"),
            "produto": row_prev.get("descricao_produto") or row_curr.get("descricao_produto"),
            "lote_plano1": row_prev.get("lote"),
            "lote_atual": row_curr.get("lote"),
            "op_plano1": row_prev.get("op"),
            "op_atual": row_curr.get("op"),
            "qtd_cx": _round(qtd_cx),
            "plano1_rodada_id": plano1_rodada.get("id") if plano1_rodada else None,
            "plano1_versao": 3,
            "rodada_atual_id": rodada_atual.get("id") if rodada_atual else None,
            "rodada_atual_mes": rodada_atual.get("mes") if rodada_atual else None,
            "rodada_atual_versao": _versao_num(rodada_atual.get("versao")) if rodada_atual else None,
            "mes_liberacao_plano1": mes_prev,
            "ano_liberacao_plano1": ano_prev,
            "mes_liberacao_atual": mes_curr,
            "ano_liberacao_atual": ano_curr,
            "data_inicio_plano1": row_prev.get("data_inicio"),
            "data_fim_plano1": row_prev.get("data_fim"),
            "data_lib_plano1": row_prev.get("data_pa"),
            "data_inicio_atual": row_curr.get("data_inicio"),
            "data_fim_atual": row_curr.get("data_fim"),
            "data_lib_atual": row_curr.get("data_pa"),
            "regra": "linha_mps_plano1_in_2026_e_mes_ano_liberacao_atual_fora_do_ano",
        })

    return {
        "lotes_atraso": len(lotes_empurrados),
        "caixas_atraso_linhas_fora_ano": _round(caixas_empurradas),
        "detalhes": detalhes[:500],
        "qtd_detalhes_total": len(detalhes),
        "linhas_plano1_validas": len(plano1_rows),
        "linhas_atual_validas": len(atual_rows),
        "linhas_plano1_no_ano": linhas_plano1_no_ano,
        "linhas_deslocadas_dentro_ano": linhas_deslocadas_dentro_ano,
        "linhas_empurradas_fora_do_ano": linhas_fora_ano,
        "linhas_reprovadas_excluidas": linhas_reprovadas_excluidas,
        **debug_pares,
        "plano1_rodada": {
            "id": plano1_rodada.get("id") if plano1_rodada else None,
            "mes": plano1_rodada.get("mes") if plano1_rodada else None,
            "versao": plano1_rodada.get("versao") if plano1_rodada else None,
            "criado_em": plano1_rodada.get("criado_em") if plano1_rodada else None,
        },
        "rodada_atual": {
            "id": rodada_atual.get("id") if rodada_atual else None,
            "mes": rodada_atual.get("mes") if rodada_atual else None,
            "versao": rodada_atual.get("versao") if rodada_atual else None,
            "criado_em": rodada_atual.get("criado_em") if rodada_atual else None,
        },
        "regra": "plano1_jan_v3_vs_ultima_rodada_atual_linhas_mps_em_2026_que_foram_para_2027_por_mes_ano_liberacao",
        "observacao": "Cada linha do MPS é tratada como 1 lote macro. A comparação usa MES/ANO LIBERAÇÃO: estava em 2026 no Plano 1 e está em 2027+ no plano atual. Data início/fim não entra na chave, porque muda quando o lote atrasa.",
    }


def _count_lotes_delta_mensal(ano: int, mes_atual: int, plano1_rodada: dict[str, Any] | None) -> dict[str, int]:
    """
    Conta itens/lotes afetados comparando, mês a mês, os lotes/OPs do Plano 1
    contra a rodada usada no Plano Atual.

    Usa lote/op quando existir. Quando não existir, usa um identificador de slot
    para não perder volume planejado sem lote.
    """
    if not plano1_rodada:
        return {"lotes_reorg": 0, "lotes_atraso": 0}

    def chave_item(row: dict[str, Any]) -> str:
        lote = _lote_key(row)
        if lote:
            return lote

        return "|".join([
            "SLOT",
            str(row.get("codigo_produto") or ""),
            str(row.get("recurso") or row.get("linha_origem") or ""),
            str(row.get("data_inicio") or ""),
            str(row.get("data_pa") or ""),
            str(row.get("sequencia") or ""),
        ])

    def mapa_mes(rodada: dict[str, Any] | None, mes: int) -> dict[str, float]:
        if not rodada or not rodada.get("id"):
            return {}

        try:
            rows = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("rodada_id", rodada.get("id"))
            )
        except Exception:
            rows = []

        mapa: dict[str, float] = {}

        for row in rows:
            if not isinstance(row, dict):
                continue
            if not _etapa_plano_valida(row):
                continue

            linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
            if linha not in {"L1", "L2"}:
                continue

            mes_lib, ano_lib = _competencia_liberacao(row)
            if ano_lib != ano or mes_lib != mes:
                continue

            qtd_cx = _qtd_planejada_cx(row)
            if qtd_cx <= 0:
                continue

            chave = chave_item(row)
            mapa[chave] = mapa.get(chave, 0.0) + qtd_cx

        return mapa

    rodada_atual = _ultima_rodada_mes(ano, mes_atual)
    itens_reorg: set[str] = set()
    itens_atraso: set[str] = set()

    for mes in range(1, 13):
        if mes < mes_atual:
            rodada_comparacao = _ultima_rodada_mes(ano, mes)
        else:
            rodada_comparacao = rodada_atual

        base = mapa_mes(plano1_rodada, mes)
        atual = mapa_mes(rodada_comparacao, mes)

        for chave in set(base.keys()) | set(atual.keys()):
            delta = atual.get(chave, 0.0) - base.get(chave, 0.0)
            if delta > 0.5:
                itens_reorg.add(chave)
            elif delta < -0.5:
                itens_atraso.add(chave)

    return {
        "lotes_reorg": len(itens_reorg),
        "lotes_atraso": len(itens_atraso),
    }



def _chave_lote_real_gantt(row: dict[str, Any]) -> str:
    """
    Chave auditável para contar lotes/OPs reais no Gantt.

    Não cria SLOT artificial para exibição. Quando não há lote/OP, o volume
    ainda entra na conciliação anual, mas não infla o contador de "lotes".
    """
    for campo in ["lote", "lote_op", "numero_lote", "num_lote", "op", "ordem", "ordem_producao"]:
        valor = row.get(campo)
        if valor is None:
            continue
        texto = str(valor).strip().upper()
        if texto and texto not in {"NAN", "NONE", "NULL", "-"}:
            if texto.endswith(".0"):
                texto = texto[:-2]
            return texto
    return ""


def _chave_volume_gantt(row: dict[str, Any], prefixo: str = "SEM_LOTE") -> str:
    """
    Chave usada para fechar volume anual mesmo quando o Excel não trouxe lote/OP.
    Esses casos aparecem no debug como sem_lote e não entram no contador exibido.
    """
    chave_real = _chave_lote_real_gantt(row)
    if chave_real:
        return chave_real

    return "|".join([
        prefixo,
        str(row.get("codigo_produto") or "").strip().upper(),
        str(row.get("descricao_produto") or "").strip().upper(),
        str(row.get("recurso") or row.get("linha_origem") or "").strip().upper(),
        str(row.get("data_inicio") or ""),
        str(row.get("data_fim") or ""),
        str(row.get("data_pa") or ""),
        str(row.get("sequencia") or ""),
    ])


def _gantt_causas_por_lote_anual(
    ano: int,
    mes_atual: int,
    plano1_rodada: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Cálculo anual correto de Reorg. e Atraso por lote/OP real.

    O cálculo anterior quebrava Reorg./Atraso por delta mensal agregado e depois
    contava "slots" do Gantt. Isso podia inflar o contador de lotes e também
    tratar simples deslocamento dentro do próprio ano como causa anual.

    Regra desta versão:
      - Plano 1 = Jan/V3 anual por lote/OP;
      - Plano atual = meses fechados pela última rodada do próprio mês + mês
        atual/futuros pela última rodada do mês atual;
      - compara o TOTAL ANUAL por lote/OP;
      - se o lote/OP aumentou no ano => Reorg.;
      - se o lote/OP reduziu/saiu do ano => Atraso prod.;
      - lote que só mudou de mês dentro de 2026, mantendo o total anual, não
        entra na causa anual. Ele deve aparecer na visão mensal.
    """
    if not plano1_rodada or not plano1_rodada.get("id"):
        return {
            "reorg": 0,
            "atraso": 0,
            "lotes_reorg": 0,
            "lotes_atraso": 0,
            "lotes_reorg_set": set(),
            "lotes_atraso_set": set(),
            "sem_lote_reorg": 0,
            "sem_lote_atraso": 0,
            "detalhes": [],
            "total_plano_atual_gantt_cx": 0,
            "regra": "sem_plano1",
        }

    rodada_atual = _ultima_rodada_mes(ano, mes_atual)

    rodadas_por_mes: dict[int, dict[str, Any] | None] = {}
    for mes in range(1, 13):
        if mes < mes_atual:
            rodadas_por_mes[mes] = _ultima_rodada_mes(ano, mes)
        else:
            rodadas_por_mes[mes] = rodada_atual

    rodadas_necessarias: list[dict[str, Any]] = []
    vistos: set[str] = set()

    for rodada in [plano1_rodada, *[r for r in rodadas_por_mes.values() if r]]:
        rid = str((rodada or {}).get("id") or "")
        if not rid or rid in vistos:
            continue
        vistos.add(rid)
        rodadas_necessarias.append(rodada)

    rows = _select_etapas_rodadas_bulk([r.get("id") for r in rodadas_necessarias])
    rows_por_rodada: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        rid = str(row.get("rodada_id") or "")
        if rid:
            rows_por_rodada.setdefault(rid, []).append(row)

    def acumular(
        destino: dict[str, dict[str, Any]],
        rodada: dict[str, Any] | None,
        mes_filtro: int | None = None,
    ):
        rid = str((rodada or {}).get("id") or "")
        if not rid:
            return

        for row in rows_por_rodada.get(rid, []):
            if not isinstance(row, dict):
                continue
            if not _etapa_plano_valida(row):
                continue

            linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
            if linha not in {"L1", "L2"}:
                continue

            mes_lib, ano_lib = _competencia_liberacao(row)
            if ano_lib != ano or not (1 <= mes_lib <= 12):
                continue
            if mes_filtro is not None and mes_lib != mes_filtro:
                continue

            produto = str(row.get("descricao_produto") or row.get("produto") or "").strip().upper()
            codigo = str(row.get("codigo_produto") or row.get("cod_produto") or "").strip().upper()
            if produto in {"TOTAL", "TOTAIS"} or codigo in {"TOTAL", "TOTAIS"}:
                continue
            if "AG AVULSO" in produto or produto == "AVULSO":
                continue

            qtd_cx = _qtd_planejada_cx(row)
            if qtd_cx <= 0:
                continue

            chave_real = _chave_lote_real_gantt(row)
            chave_volume = chave_real or _chave_volume_gantt(row)

            item = destino.setdefault(chave_volume, {
                "chave": chave_volume,
                "lote": chave_real or None,
                "tem_lote_real": bool(chave_real),
                "qtd_cx": 0.0,
                "meses": set(),
                "linhas": set(),
                "codigos": set(),
                "produtos": set(),
            })
            item["qtd_cx"] += qtd_cx
            item["meses"].add(mes_lib)
            if linha:
                item["linhas"].add(linha)
            if codigo:
                item["codigos"].add(codigo)
            if produto:
                item["produtos"].add(produto)

    plano1_map: dict[str, dict[str, Any]] = {}
    atual_map: dict[str, dict[str, Any]] = {}

    acumular(plano1_map, plano1_rodada, None)
    for mes in range(1, 13):
        acumular(atual_map, rodadas_por_mes.get(mes), mes)

    reorg = 0.0
    atraso = 0.0
    lotes_reorg: set[str] = set()
    lotes_atraso: set[str] = set()
    sem_lote_reorg = 0
    sem_lote_atraso = 0
    detalhes: list[dict[str, Any]] = []

    for chave in sorted(set(plano1_map.keys()) | set(atual_map.keys())):
        base = plano1_map.get(chave) or {}
        atual = atual_map.get(chave) or {}
        base_qtd = _to_float(base.get("qtd_cx"))
        atual_qtd = _to_float(atual.get("qtd_cx"))
        delta = atual_qtd - base_qtd

        if abs(delta) < 0.5:
            continue

        ref = atual if atual else base
        lote_real = ref.get("lote") or base.get("lote") or atual.get("lote")
        tem_lote_real = bool(lote_real)

        detalhe = {
            "chave": chave,
            "lote": lote_real,
            "tem_lote_real": tem_lote_real,
            "plano1_cx": _round(base_qtd),
            "plano_atual_cx": _round(atual_qtd),
            "delta_cx": _round(delta),
            "linha": ", ".join(sorted((ref.get("linhas") or set()))) if ref.get("linhas") else None,
            "meses_plano1": sorted(list(base.get("meses") or [])),
            "meses_atual": sorted(list(atual.get("meses") or [])),
        }

        if delta > 0:
            reorg += delta
            detalhe["causa"] = "Reorg."
            if tem_lote_real:
                lotes_reorg.add(str(lote_real))
            else:
                sem_lote_reorg += 1
        else:
            atraso += abs(delta)
            detalhe["causa"] = "Atraso prod."
            if tem_lote_real:
                lotes_atraso.add(str(lote_real))
            else:
                sem_lote_atraso += 1

        detalhes.append(detalhe)

    total_atual = _round(sum(_to_float(item.get("qtd_cx")) for item in atual_map.values()))

    return {
        "reorg": _round(reorg),
        "atraso": _round(atraso),
        "total_plano_atual_gantt_cx": total_atual,
        "lotes_reorg": len(lotes_reorg),
        "lotes_atraso": len(lotes_atraso),
        "lotes_reorg_set": lotes_reorg,
        "lotes_atraso_set": lotes_atraso,
        "sem_lote_reorg": sem_lote_reorg,
        "sem_lote_atraso": sem_lote_atraso,
        "detalhes": detalhes[:500],
        "qtd_detalhes_total": len(detalhes),
        "rodada_atual": rodada_atual,
        "regra": "anual_por_lote_op_real_sem_slot_mock",
    }




def _linha_calendario(row: dict[str, Any]) -> str:
    texto = str(_get_any(row, "linha", "recurso", "linha_origem", "equipamento", "maquina", "máquina", "centro_trabalho") or "").strip().upper()
    if "L2" in texto or "LINHA 2" in texto:
        return "L2"
    if "L1" in texto or "LINHA 1" in texto or "MAQ 1" in texto or "MAQ 2" in texto or "MÁQ 1" in texto or "MÁQ 2" in texto:
        return "L1"
    return texto or "GERAL"


def _data_calendario(row: dict[str, Any]) -> date | None:
    for campo in (
        "data", "dia", "data_dia", "data_calendario", "dt", "dt_calendario",
        "data_inicio", "inicio", "DATA", "DIA",
    ):
        dt = _parse_date_value(_get_any(row, campo))
        if dt:
            return dt
    return None


def _comentario_gantt_calendario(row: dict[str, Any]) -> str:
    """
    Comentário REAL do Gantt/calendário.

    Importante: aqui não inventa texto. Se não houver comentário/motivo vindo do
    arquivo do Gantt, retorna vazio e a linha não aparece no modal detalhado.
    Isso evita gerar linhas falsas tipo "Parada/indisponibilidade sem descrição".
    """
    campos = (
        # Nome real confirmado no Supabase/f_mrp_calendario_dia.
        "comentario_calendario", "comentário_calendario", "comentario calendário",
        "comentario_do_calendario", "comentario_gantt", "comentario_do_gantt",
        "comentario", "comentário", "comentarios", "comentários",
        "observacao", "observação", "observacoes", "observações",
        "obs", "nota", "anotacao", "anotação",
        "motivo", "motivo_parada", "motivo_indisponibilidade", "motivo_bloqueio",
        "descricao_parada", "descrição_parada", "descricao", "descrição",
        "justificativa", "evento", "tipo_parada", "causa",
    )

    invalidos = {
        "", "-", "--", "N/A", "NA", "NAN", "NONE", "NULL", "SEM OBS", "SEM OBS.",
        "SEM OBSERVACAO", "SEM OBSERVAÇÃO", "SEM COMENTARIO", "SEM COMENTÁRIO",
    }

    for campo in campos:
        valor = _get_any(row, campo)
        if valor is None:
            continue
        texto = " ".join(str(valor).strip().split())
        if not texto:
            continue
        if _normalizar_texto_upper(texto) in invalidos:
            continue
        return texto

    return ""


def _texto_parada_calendario(row: dict[str, Any]) -> str:
    # Mantém compatibilidade, mas sem inventar descrição.
    return _comentario_gantt_calendario(row)


def _categoria_parada_calendario(texto: str) -> str:
    normalizado = _normalizar_texto_upper(texto)
    if any(t in normalizado for t in ["INTERVEN", "MANUT", "TECNIC", "CORRETIVA", "PREVENTIVA"]):
        return "Intervenção técnica"
    if any(t in normalizado for t in ["TREIN", "EVENTO", "REUNIAO", "REUNIÃO"]):
        return "Evento/treinamento"
    if any(t in normalizado for t in ["QUALIDADE", "VALID", "CQ", "GARANTIA"]):
        return "Qualidade/validação"
    if any(t in normalizado for t in ["REORG", "CALEND", "CALENDARIO", "CALENDÁRIO", "PLANEJ"]):
        return "Reorg. calendário"
    return "Parada planejada"


def _flag_indisponivel_calendario(row: dict[str, Any]) -> bool:
    texto_status = _normalizar_texto_upper(" ".join(
        str(_get_any(row, campo) or "")
        for campo in (
            "disponivel", "disponível", "is_disponivel", "status_dia", "status",
            "situacao", "situação", "tipo", "tipo_dia", "flag_parada",
        )
    ))

    if any(t in texto_status for t in ["INDISPON", "PARADA", "BLOQUE", "NAO", "NÃO", "FALSE", "FALSO"]):
        return True
    return False


def _horas_parada_calendario(row: dict[str, Any]) -> float:
    for campo in (
        "horas_parada", "horas_indisponiveis", "horas_indisponíveis", "horas_bloqueadas",
        "duracao_horas", "duração_horas", "duracao", "duração", "horas", "h_parada",
    ):
        valor = _to_float(_get_any(row, campo))
        if valor > 0:
            return valor

    # Fallback só quando existe comentário real do Gantt e o dia está marcado
    # explicitamente como indisponível/parada. Sem comentário, não entra no modal.
    if _comentario_gantt_calendario(row) and _flag_indisponivel_calendario(row):
        return 21.0

    return 0.0


def _cx_por_hora_linha(linha: str) -> float:
    linha_norm = str(linha or "").strip().upper()
    if linha_norm == "L1":
        return 13500.0 / TUBETES_POR_CAIXA
    if linha_norm == "L2":
        return 12000.0 / TUBETES_POR_CAIXA
    return 12500.0 / TUBETES_POR_CAIXA


def _numeric_by_column_tokens(
    row: dict[str, Any],
    include_any: tuple[str, ...],
    include_all: tuple[str, ...] = (),
    exclude_any: tuple[str, ...] = (),
) -> float:
    """
    Busca número por nome de coluna de forma flexível.
    Útil porque o calendário do Gantt vem do Excel/Supabase com nomes que podem
    variar, ex.: qtd_disponivel_cx, disponibilidade_cx, cx_disponivel_dia etc.
    """
    if not isinstance(row, dict):
        return 0.0

    for key, value in row.items():
        chave = _normalizar_chave_coluna(key)
        if include_any and not any(token in chave for token in include_any):
            continue
        if include_all and not all(token in chave for token in include_all):
            continue
        if exclude_any and any(token in chave for token in exclude_any):
            continue
        valor = _to_float(value, default=0.0)
        if abs(valor) > 0:
            return valor
    return 0.0


def _capacidade_total_dia_cx_calendario(row: dict[str, Any]) -> float:
    """Capacidade nominal/total do dia em caixas, quando vier no calendário."""
    for campo in (
        "capacidade_total_cx", "capacidade_dia_cx", "capacidade_planejada_cx",
        "capacidade_nominal_cx", "qtd_capacidade_cx", "qtd_planejada_cx",
        "qtd_total_cx", "total_cx", "caixas_dia", "cx_dia",
    ):
        valor = _to_float(_get_any(row, campo))
        if valor > 0:
            return valor

    valor = _numeric_by_column_tokens(
        row,
        include_any=("capacidade", "total", "planejada", "nominal"),
        include_all=("cx",),
        exclude_any=("indispon", "perd", "real", "liber"),
    )
    if valor > 0:
        return valor

    # Fallback operacional: 21h/dia x capacidade/h da linha.
    # Só usado para transformar disponibilidade em indisponibilidade quando
    # não existe coluna explícita de capacidade total.
    return 21.0 * _cx_por_hora_linha(_linha_calendario(row))


def _qtd_disponivel_cx_calendario(row: dict[str, Any]) -> float:
    """Quantidade disponível do dia em caixas, salva no calendário do Gantt."""
    for campo in (
        "qtd_disponivel_cx", "qtd_disponível_cx", "disponivel_cx", "disponível_cx",
        "caixas_disponiveis", "caixas_disponíveis", "cx_disponivel", "cx_disponível",
        "capacidade_disponivel_cx", "capacidade_disponível_cx", "qtd_disponivel",
        "qtd_disponível", "disponibilidade_cx", "disponibilidade",
    ):
        valor_raw = _get_any(row, campo)
        if valor_raw is None:
            continue
        valor = _to_float(valor_raw, default=0.0)
        # Zero também é informação válida: dia totalmente indisponível.
        if valor >= 0 and str(valor_raw).strip() != "":
            return valor

    valor = _numeric_by_column_tokens(
        row,
        include_any=("dispon", "disponivel", "disponibilidade"),
        exclude_any=("indispon", "status", "flag", "is_", "bool"),
    )
    if valor > 0:
        return valor

    return -1.0


def _capacidade_indisponivel_cx_calendario(row: dict[str, Any]) -> float:
    # 1) Primeiro tenta ler a indisponibilidade/capacidade perdida direta.
    for campo in (
        "capacidade_indisponivel_cx", "capacidade_indisponível_cx", "cx_indisponivel",
        "cx_indisponível", "qtd_cx_indisponivel", "qtd_cx_indisponível", "perda_cx",
        "impacto_cx", "capacidade_perdida_cx", "qtd_caixas_indisponivel",
        "qtd_caixas_indisponível", "caixas_indisponiveis", "caixas_indisponíveis",
    ):
        valor = _to_float(_get_any(row, campo))
        if abs(valor) > 0:
            return abs(valor)

    valor_dinamico = _numeric_by_column_tokens(
        row,
        include_any=("indispon", "perd", "bloque"),
        exclude_any=("status", "flag", "is_", "bool"),
    )
    if abs(valor_dinamico) > 0:
        return abs(valor_dinamico)

    # 2) Se o calendário tem a quantidade disponível do dia, calcula:
    # indisponível = capacidade total/nominal - disponível.
    qtd_disponivel = _qtd_disponivel_cx_calendario(row)
    if qtd_disponivel >= 0:
        capacidade_total = _capacidade_total_dia_cx_calendario(row)
        return max(0.0, capacidade_total - qtd_disponivel)

    # 3) Último fallback: horas indisponíveis/parada.
    horas = _horas_parada_calendario(row)
    if horas <= 0:
        return 0.0
    return horas * _cx_por_hora_linha(_linha_calendario(row))


def _lote_tipico_por_linha(ano: int, rodada_ids: list[Any]) -> dict[str, float]:
    try:
        rows = _select_etapas_rodadas_bulk(rodada_ids)
    except Exception:
        rows = []

    por_linha: dict[str, list[float]] = {"L1": [], "L2": []}
    for row in rows:
        if not isinstance(row, dict) or not _etapa_plano_valida(row):
            continue
        linha = str(row.get("recurso") or row.get("linha_origem") or "").strip().upper()
        if linha not in por_linha:
            continue
        mes_lib, ano_lib = _competencia_liberacao(row)
        if ano_lib != ano or not (1 <= mes_lib <= 12):
            continue
        qtd = _qtd_planejada_cx(row)
        if qtd > 0:
            por_linha[linha].append(qtd)

    return {
        "L1": _median(por_linha.get("L1") or [], 600.0),
        "L2": _median(por_linha.get("L2") or [], 288.0),
        "GERAL": _median((por_linha.get("L1") or []) + (por_linha.get("L2") or []), 500.0),
    }



def _reorg_plano_detalhes_calendario(ano: int, mes_atual: int, reorg_plano_cx: int) -> dict[str, Any]:
    """
    Detalha Reorg. plano comparando calendário REAL salvo no Gantt.

    Regra correta para o modal:
    - Plano 1 = Jan/V3.
    - Plano atual = última versão disponível do mês atual.
    - A comparação é por data + linha, NÃO por comentário como chave principal.
    - Comentário é explicação do que mudou; impacto vem da disponibilidade/capacidade salva do dia.
    - Se só houver comentário e não houver disponibilidade/horas salvas, a linha aparece com impacto 0
      e fonte "sem_disponibilidade_salva". Não inventa 21h para fechar número.
    """
    chave_cache = f"reorg_plano_calendario_real_v9:{ano}:{mes_atual}:{int(reorg_plano_cx or 0)}"
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    plano1_rodada = _rodada_mrp_unica(ano, 1, 3)
    rodada_atual = _ultima_rodada_mes(ano, mes_atual)

    if not plano1_rodada or not rodada_atual:
        return _cache_set(chave_cache, {
            "saldo_liquido_cascata_cx": _round(reorg_plano_cx),
            "impacto_liquido_calendario_cx": 0,
            "lotes_equivalentes_liquido": 0,
            "lotes_adicionados_equivalentes": 0,
            "lotes_removidos_equivalentes": 0,
            "detalhes": [],
            "qtd_detalhes_total": 0,
            "debug_comentarios": {
                "erro": "rodadas_nao_encontradas",
                "plano1_encontrado": bool(plano1_rodada),
                "rodada_atual_encontrada": bool(rodada_atual),
            },
        }, ttl=1800)

    rodada_ids = [plano1_rodada.get("id"), rodada_atual.get("id")]
    ids_validos = [rid for rid in rodada_ids if rid]

    def _select_calendario_rows(ids: list[Any]) -> list[dict[str, Any]]:
        if not ids:
            return []
        try:
            return _select_all(
                supabase.table("f_mrp_calendario_dia")
                .select("*")
                .in_("rodada_id", ids)
            )
        except Exception:
            pass

        rows: list[dict[str, Any]] = []
        for rid in ids:
            try:
                rows.extend(_select_all(
                    supabase.table("f_mrp_calendario_dia")
                    .select("*")
                    .eq("rodada_id", rid)
                ))
            except Exception:
                continue
        return rows

    def _limpar_comentario_modal(texto: str) -> str:
        texto = " ".join(str(texto or "").strip().split())
        if not texto:
            return ""

        # Remove o texto padrão do Excel de comentário encadeado, mantendo só o conteúdo após "Comentário:".
        m = re.search(r"coment[aá]rio\s*:\s*(.*)$", texto, flags=re.IGNORECASE)
        if m and m.group(1).strip():
            texto = m.group(1).strip()

        texto = re.sub(r"\[?Coment[aá]rio encadeado\]?.*?linkid=870924", "", texto, flags=re.IGNORECASE)
        texto = texto.replace("https://go.microsoft.com/fwlink/?linkid=870924", "")
        texto = " ".join(texto.split())
        return texto

    def _horas_do_comentario(texto: str) -> float:
        texto_norm = _normalizar_texto_upper(texto)
        # Exemplos: "(2H)", "4H", "2 h", "8 HORAS".
        candidatos = re.findall(r"(\d+(?:[\.,]\d+)?)\s*(?:H|HORAS?)\b", texto_norm)
        valores = []
        for c in candidatos:
            try:
                v = float(c.replace(",", "."))
                if 0 < v <= 24:
                    valores.append(v)
            except Exception:
                continue
        if valores:
            # quando o comentário cita várias atividades no mesmo dia, usa a soma limitada a 21h.
            return min(21.0, sum(valores))
        return 0.0

    def _qtd_disponivel_ou_none(row: dict[str, Any]) -> float | None:
        valor = _qtd_disponivel_cx_calendario(row)
        return valor if valor >= 0 else None

    def _indisponivel_por_row(row: dict[str, Any], linha: str, comentario_limpo: str) -> tuple[float, float, str]:
        """Indisponibilidade por linha do calendário sem inventar dia inteiro."""
        # 1) Campo direto de indisponibilidade/capacidade perdida.
        direto = 0.0
        for campo in (
            "capacidade_indisponivel_cx", "capacidade_indisponível_cx", "cx_indisponivel",
            "cx_indisponível", "qtd_cx_indisponivel", "qtd_cx_indisponível", "perda_cx",
            "impacto_cx", "capacidade_perdida_cx", "qtd_caixas_indisponivel",
            "qtd_caixas_indisponível", "caixas_indisponiveis", "caixas_indisponíveis",
        ):
            direto = _to_float(_get_any(row, campo))
            if abs(direto) > 0:
                direto = abs(direto)
                cx_h = _cx_por_hora_linha(linha)
                horas = direto / cx_h if cx_h > 0 else 0.0
                return direto, horas, "capacidade_indisponivel_cx_do_calendario"

        # 2) Disponibilidade do dia salva no calendário.
        disp = _qtd_disponivel_ou_none(row)
        if disp is not None:
            total = _capacidade_total_dia_cx_calendario(row)
            indisp = max(0.0, total - disp)
            cx_h = _cx_por_hora_linha(linha)
            horas = indisp / cx_h if cx_h > 0 else 0.0
            return indisp, horas, "disponibilidade_cx_do_calendario"

        # 3) Horas explícitas em coluna.
        horas_col = _horas_parada_calendario(row)
        # _horas_parada_calendario antigo ainda pode retornar 21h pelo flag. Só aceita se houver campo explícito.
        tem_campo_horas = any(
            _to_float(_get_any(row, campo)) > 0
            for campo in (
                "horas_parada", "horas_indisponiveis", "horas_indisponíveis", "horas_bloqueadas",
                "duracao_horas", "duração_horas", "duracao", "duração", "horas", "h_parada",
            )
        )
        if horas_col > 0 and tem_campo_horas:
            return horas_col * _cx_por_hora_linha(linha), horas_col, "horas_parada_do_calendario"

        # 4) Horas escritas dentro do comentário, ex.: "(2H)".
        horas_txt = _horas_do_comentario(comentario_limpo)
        if horas_txt > 0:
            return horas_txt * _cx_por_hora_linha(linha), horas_txt, "horas_extraidas_do_comentario_calendario"

        # 5) Não inventa 21h. A linha ainda explica mudança de comentário, mas sem impacto calculado.
        return 0.0, 0.0, "sem_disponibilidade_ou_horas_salvas"

    rows = _select_calendario_rows(ids_validos)
    lote_tipico = _lote_tipico_por_linha(ano, [plano1_rodada.get("id"), rodada_atual.get("id")])

    def lado_row(row: dict[str, Any]) -> str:
        rid = str(row.get("rodada_id") or "")
        if rid == str(plano1_rodada.get("id")):
            return "plano1"
        if rid == str(rodada_atual.get("id")):
            return "atual"
        return ""

    # Agrega por DATA + LINHA. Comentário entra como atributo explicativo, não como chave.
    mapas: dict[str, dict[tuple[str, str], dict[str, Any]]] = {"plano1": {}, "atual": {}}
    debug = {
        "plano1_rodada_id": str(plano1_rodada.get("id")),
        "rodada_atual_id": str(rodada_atual.get("id")),
        "linhas_lidas_total": len(rows),
        "linhas_lidas": {"plano1": 0, "atual": 0},
        "linhas_com_comentario_calendario": {"plano1": 0, "atual": 0},
        "linhas_com_disponibilidade_detectada": {"plano1": 0, "atual": 0},
        "linhas_ignoradas_sem_data": 0,
        "linhas_ignoradas_fora_do_ano": 0,
        "amostras_comentarios": [],
    }

    for row in rows:
        if not isinstance(row, dict):
            continue
        lado = lado_row(row)
        if not lado:
            continue
        debug["linhas_lidas"][lado] += 1

        dt = _data_calendario(row)
        if not dt:
            debug["linhas_ignoradas_sem_data"] += 1
            continue
        if dt.year != ano:
            debug["linhas_ignoradas_fora_do_ano"] += 1
            continue

        linha = _linha_calendario(row) or "GERAL"
        comentario_raw = _comentario_gantt_calendario(row)
        comentario = _limpar_comentario_modal(comentario_raw)
        if comentario:
            debug["linhas_com_comentario_calendario"][lado] += 1

        disp = _qtd_disponivel_ou_none(row)
        if disp is not None:
            debug["linhas_com_disponibilidade_detectada"][lado] += 1

        indisp_cx, horas, fonte = _indisponivel_por_row(row, linha, comentario)
        key = (dt.isoformat(), linha)
        item = mapas[lado].setdefault(key, {
            "data": dt.isoformat(),
            "linha": linha,
            "comentarios": [],
            "comentarios_norm": set(),
            "categoria": None,
            "disponivel_cx": None,
            "indisponivel_cx": 0.0,
            "horas": 0.0,
            "qtd_linhas": 0,
            "fontes": set(),
        })

        if comentario:
            comentario_norm = _normalizar_texto_upper(comentario)
            if comentario_norm not in item["comentarios_norm"]:
                item["comentarios"].append(comentario)
                item["comentarios_norm"].add(comentario_norm)
            item["categoria"] = item.get("categoria") or _categoria_parada_calendario(comentario)

        if disp is not None:
            # Se houver mais de uma linha no mesmo dia/recurso, soma disponibilidade.
            item["disponivel_cx"] = (0.0 if item["disponivel_cx"] is None else _to_float(item["disponivel_cx"])) + disp

        item["indisponivel_cx"] += indisp_cx
        item["horas"] += horas
        item["qtd_linhas"] += 1
        item["fontes"].add(fonte)

        if len(debug["amostras_comentarios"]) < 10 and comentario:
            debug["amostras_comentarios"].append({
                "lado": lado,
                "data": dt.isoformat(),
                "linha": linha,
                "comentario_calendario": comentario,
                "disponivel_cx": None if disp is None else _round(disp),
                "indisponivel_cx": _round(indisp_cx),
                "fonte": fonte,
            })

    detalhes: list[dict[str, Any]] = []
    impacto_liquido = 0.0
    lotes_adicionados_equiv = 0  # compatibilidade legada; não usar no modal executivo
    lotes_removidos_equiv = 0    # compatibilidade legada; não usar no modal executivo
    eventos_liberados = 0
    eventos_consumidos = 0
    horas_liberadas = 0.0
    horas_consumidas = 0.0

    for key in sorted(set(mapas["plano1"].keys()) | set(mapas["atual"].keys())):
        base = mapas["plano1"].get(key)
        atual = mapas["atual"].get(key)

        linha = key[1]
        ref_lote = lote_tipico.get(linha) or lote_tipico.get("GERAL") or 500.0

        base_disp = None if not base else base.get("disponivel_cx")
        atual_disp = None if not atual else atual.get("disponivel_cx")
        base_indisp = _to_float((base or {}).get("indisponivel_cx"))
        atual_indisp = _to_float((atual or {}).get("indisponivel_cx"))
        base_horas = _to_float((base or {}).get("horas"))
        atual_horas = _to_float((atual or {}).get("horas"))

        # Preferência absoluta: comparar disponibilidade do dia salva no Gantt.
        if base_disp is not None and atual_disp is not None:
            impacto = _to_float(atual_disp) - _to_float(base_disp)
            fonte_impacto = "delta_disponibilidade_cx_salva_no_calendario"
        else:
            impacto = base_indisp - atual_indisp
            fonte_impacto = "delta_indisponibilidade_calculada"

        comentarios_base = list((base or {}).get("comentarios") or [])
        comentarios_atual = list((atual or {}).get("comentarios") or [])
        coment_base_norm = set((base or {}).get("comentarios_norm") or set())
        coment_atual_norm = set((atual or {}).get("comentarios_norm") or set())
        comentarios_mudaram = coment_base_norm != coment_atual_norm

        horas_impacto = base_horas - atual_horas

        # Só mostra no modal quando houve impacto REAL de capacidade/disponibilidade.
        # Mudança apenas textual no comentario_calendario, sem diferença de horas/cx, não justifica lote
        # e não deve poluir o modal executivo.
        if abs(impacto) < 0.5 and abs(horas_impacto) < 0.05:
            continue

        if impacto > 0.5 or horas_impacto > 0.05:
            movimento = "Capacidade liberada"
            tipo = "ganho"
            eventos_liberados += 1
            horas_liberadas += abs(horas_impacto)
        elif impacto < -0.5 or horas_impacto < -0.05:
            movimento = "Capacidade consumida"
            tipo = "perda"
            eventos_consumidos += 1
            horas_consumidas += abs(horas_impacto)
        else:
            continue

        # Reorg. de calendário NÃO deve virar lote equivalente: 2h de parada não são 1 lote.
        # Mantemos campos legados zerados apenas para não quebrar versões antigas do front.
        lotes_equiv = 0
        if impacto > 0:
            lotes_adicionados_equiv += lotes_equiv
        elif impacto < 0:
            lotes_removidos_equiv += lotes_equiv

        impacto_liquido += impacto
        fontes = set()
        fontes.update((base or {}).get("fontes") or set())
        fontes.update((atual or {}).get("fontes") or set())
        fontes.add(fonte_impacto)

        detalhes.append({
            "id": f"{key[0]}|{linha}",
            "tipo": tipo,
            "movimento": movimento,
            "categoria": str((atual or base or {}).get("categoria") or _categoria_parada_calendario(" ".join(comentarios_atual + comentarios_base))),
            "data": key[0],
            "linha": linha,
            "motivo_plano1": " | ".join(comentarios_base) if comentarios_base else "Sem comentário/parada no Plano 1",
            "motivo_atual": " | ".join(comentarios_atual) if comentarios_atual else "Sem comentário/parada no Plano Atual",
            "disponivel_plano1_cx": None if base_disp is None else _round(base_disp),
            "disponivel_atual_cx": None if atual_disp is None else _round(atual_disp),
            "indisponivel_plano1_cx": _round(base_indisp),
            "indisponivel_atual_cx": _round(atual_indisp),
            "horas_plano1": _round(base_horas),
            "horas_atual": _round(atual_horas),
            "horas_impacto": _round(horas_impacto),
            "impacto_cx": _round(impacto),
            "impacto_tubetes": _round(impacto * TUBETES_POR_CAIXA),
            "tamanho_lote_ref_cx": _round(ref_lote),
            "lotes_equivalentes": lotes_equiv,
            "lotes_adicionados_equivalentes": lotes_equiv if impacto > 0 else 0,
            "lotes_removidos_equivalentes": lotes_equiv if impacto < 0 else 0,
            "fonte_impacto": " | ".join(sorted(fontes)),
            "regra": "comparacao_data_linha; impacto = disponibilidade_atual - disponibilidade_jan_v3 quando disponível; comentário explica a mudança",
        })

    # Ordem executiva: data/linha para conseguir auditar a evolução do calendário.
    detalhes = sorted(detalhes, key=lambda item: (str(item.get("data") or ""), str(item.get("linha") or "")))
    ref_lote_geral = lote_tipico.get("GERAL") or 500.0
    lotes_liquido = int(math.ceil(abs(impacto_liquido) / ref_lote_geral - 1e-9)) if abs(impacto_liquido) > 0.5 and ref_lote_geral > 0 else 0

    return _cache_set(chave_cache, {
        "saldo_liquido_cascata_cx": _round(reorg_plano_cx),
        "impacto_liquido_calendario_cx": _round(impacto_liquido),
        "impacto_bruto_calendario_cx": _round(impacto_liquido),
        "eventos_capacidade_liberada": eventos_liberados,
        "eventos_capacidade_consumida": eventos_consumidos,
        "horas_liberadas": _round(horas_liberadas),
        "horas_consumidas": _round(horas_consumidas),
        # Campos legados mantidos zerados. Não converter paradas parciais em lotes equivalentes.
        "lotes_equivalentes_liquido": 0,
        "lotes_adicionados_equivalentes": 0,
        "lotes_removidos_equivalentes": 0,
        "lote_tipico_por_linha_cx": {k: _round(v) for k, v in lote_tipico.items()},
        "detalhes": detalhes[:300],
        "qtd_detalhes_total": len(detalhes),
        "plano1_rodada": {"id": plano1_rodada.get("id"), "mes": plano1_rodada.get("mes"), "versao": plano1_rodada.get("versao")},
        "rodada_atual": {"id": rodada_atual.get("id"), "mes": rodada_atual.get("mes"), "versao": rodada_atual.get("versao")},
        "debug_comentarios": debug,
        "regra": "comparacao_real_f_mrp_calendario_dia_por_data_linha; comentario_calendario explica; disponibilidade/capacidade calcula impacto; linhas 0h/0cx são filtradas; sem inventar 21h; sem converter horas parciais em lotes",
    }, ttl=1800)



def _snapshot_exec_rows_ativo(ano: int, mes: int) -> list[dict[str, Any]]:
    """
    Snapshot auditado da Liberação Executiva.

    Hotfix v5:
    - primeiro tenta o snapshot ativo do mês solicitado;
    - se o mês virou e ainda não existe snapshot novo (ex.: abriu julho, mas o
      snapshot auditado ainda é junho), usa o snapshot ativo mais recente do ano.

    Isso evita a tela cair no cálculo pesado/fallback do MRP ao virar o mês e
    sumir a cascata anual.
    """

    def _ordenar_componentes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted([r for r in rows if isinstance(r, dict)], key=lambda r: _to_int(r.get("ordem"), 9999))

    def _escolher_snapshot_id(rows: list[dict[str, Any]], mes_ref: int) -> str:
        grupos: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sid = str(row.get("snapshot_id") or row.get("id") or "").strip()
            if not sid:
                continue
            atual = grupos.get(sid) or {}
            mes_row = _to_int(row.get("mes_ref"), 0)
            grupos[sid] = {
                "snapshot_id": sid,
                "mes_ref": mes_row or _to_int(atual.get("mes_ref"), 0),
                "criado_em": row.get("criado_em") or row.get("created_at") or atual.get("criado_em") or "",
            }

        if not grupos:
            return ""

        candidatos = list(grupos.values())
        anteriores = [g for g in candidatos if 1 <= _to_int(g.get("mes_ref")) <= mes_ref]
        base = anteriores if anteriores else candidatos
        escolhido = sorted(
            base,
            key=lambda g: (_to_int(g.get("mes_ref")), str(g.get("criado_em") or ""), str(g.get("snapshot_id") or "")),
        )[-1]
        return str(escolhido.get("snapshot_id") or "")

    def _componentes_por_snapshot(snap: dict[str, Any]) -> list[dict[str, Any]]:
        if not snap or not snap.get("id"):
            return []
        try:
            comps = _select_all(
                supabase.table("f_liberacao_exec_componentes_auditoria")
                .select("*")
                .eq("snapshot_id", snap.get("id"))
            )
        except Exception:
            return []

        out: list[dict[str, Any]] = []
        for c in comps:
            if not isinstance(c, dict):
                continue
            out.append({
                "snapshot_id": snap.get("id"),
                "ano_ref": snap.get("ano_ref"),
                "mes_ref": snap.get("mes_ref"),
                "versao_base": snap.get("versao_base"),
                "versao_atual": snap.get("versao_atual"),
                "snapshot_descricao": snap.get("descricao"),
                "snapshot_fallback_mes_mais_recente": _to_int(snap.get("mes_ref")) != _to_int(mes),
                "ordem": c.get("ordem"),
                "componente": c.get("componente"),
                "tipo": c.get("tipo"),
                "valor_cx": c.get("valor_cx"),
                "valor_tubetes": c.get("valor_tubetes"),
                "qtd_lotes": c.get("qtd_lotes"),
                "descricao": c.get("descricao"),
            })
        return _ordenar_componentes(out)

    # 1) View exata do mês solicitado.
    try:
        rows = _select_all(
            supabase.table("v_liberacao_exec_snapshot_ativo")
            .select("*")
            .eq("ano_ref", ano)
            .eq("mes_ref", mes)
        )
        rows = _ordenar_componentes(rows)
        if rows:
            return rows
    except Exception:
        pass

    # 2) View do ano, usando o snapshot ativo mais recente <= mês solicitado.
    try:
        rows_ano = _select_all(
            supabase.table("v_liberacao_exec_snapshot_ativo")
            .select("*")
            .eq("ano_ref", ano)
        )
        rows_ano = [r for r in rows_ano if isinstance(r, dict)]
        sid = _escolher_snapshot_id(rows_ano, mes)
        if sid:
            escolhidas = [dict(r, snapshot_fallback_mes_mais_recente=_to_int(r.get("mes_ref")) != _to_int(mes)) for r in rows_ano if str(r.get("snapshot_id") or "") == sid]
            if escolhidas:
                return _ordenar_componentes(escolhidas)
    except Exception:
        pass

    # 3) Tabelas diretas: snapshot ativo exato.
    try:
        snaps = _select_all(
            supabase.table("f_liberacao_exec_snapshot")
            .select("*")
            .eq("ano_ref", ano)
            .eq("mes_ref", mes)
            .eq("ativo", True)
        )
        snaps = [s for s in snaps if isinstance(s, dict) and s.get("id")]
        if snaps:
            snap = sorted(
                snaps,
                key=lambda s: str(s.get("criado_em") or s.get("created_at") or s.get("id") or ""),
            )[-1]
            out = _componentes_por_snapshot(snap)
            if out:
                return out
    except Exception:
        pass

    # 4) Tabelas diretas: snapshot ativo mais recente do ano.
    try:
        snaps = _select_all(
            supabase.table("f_liberacao_exec_snapshot")
            .select("*")
            .eq("ano_ref", ano)
            .eq("ativo", True)
        )
        snaps = [s for s in snaps if isinstance(s, dict) and s.get("id")]
        if not snaps:
            return []

        anteriores = [s for s in snaps if 1 <= _to_int(s.get("mes_ref")) <= mes]
        base = anteriores if anteriores else snaps
        snap = sorted(
            base,
            key=lambda s: (_to_int(s.get("mes_ref")), str(s.get("criado_em") or s.get("created_at") or ""), str(s.get("id") or "")),
        )[-1]
        return _componentes_por_snapshot(snap)
    except Exception:
        return []

def _snapshot_component_value(rows: list[dict[str, Any]], token: str, default: int = 0) -> int:
    token_norm = _normalizar_texto_upper(token)
    for row in rows:
        comp = _normalizar_texto_upper(row.get("componente"))
        if token_norm in comp:
            return _round(row.get("valor_cx"))
    return default


def _snapshot_component_row(rows: list[dict[str, Any]], token: str) -> dict[str, Any] | None:
    token_norm = _normalizar_texto_upper(token)
    for row in rows:
        comp = _normalizar_texto_upper(row.get("componente"))
        if token_norm in comp:
            return row
    return None


def _snapshot_base_final(rows: list[dict[str, Any]]) -> tuple[int, int]:
    base = 0
    final = 0
    for row in rows:
        tipo = str(row.get("tipo") or "").strip().lower()
        if tipo == "base":
            base = _round(row.get("valor_cx"))
        elif tipo == "final":
            final = _round(row.get("valor_cx"))
    return base, final


def _snapshot_horas_detalhes(snapshot_id: str, limit: int = 500) -> list[dict[str, Any]]:
    if not snapshot_id:
        return []
    try:
        rows = _select_all(
            supabase.table("f_liberacao_exec_horas_auditoria")
            .select("*")
            .eq("snapshot_id", snapshot_id)
            .limit(limit)
        )
    except Exception:
        return []

    detalhes: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        # O modal de Var. calendário deve mostrar somente o que ficou classificado
        # como alteração de calendário no snapshot auditado. Comentários operacionais
        # como ATRASO DE PRODUÇÃO, PARADA EMERGENCIAL, falha recravadora etc.
        # ficam dentro do saldo de Atraso produção / rolagem operacional.
        causa = _normalizar_texto_upper(row.get("causa_executiva") or row.get("categoria_atual") or row.get("categoria_v1"))
        if "ATRASO" in causa or "OPERACIONAL" in causa:
            continue

        # A tabela auditada de horas guarda a abertura como "horas de parada/indisponibilidade"
        # e, no snapshot mais recente, as colunas V1/Atual vieram invertidas para o calendário.
        # Ex.: FESTA JULINA adicionada no plano atual aparecia em comentario_v1 com +5h,
        # fazendo o modal ler como capacidade liberada. Para a visão executiva, a leitura correta é:
        # - comentario_v1/horas_v1 do banco => Plano Atual;
        # - comentario_atual/horas_atual do banco => Plano 1;
        # - variação de disponibilidade = parada_plano1 - parada_atual.
        impacto_raw = _round(row.get("impacto_cx"))
        var_horas_raw = _to_float(row.get("var_horas"))

        horas_parada_atual = _to_float(row.get("horas_v1"))
        horas_parada_plano1 = _to_float(row.get("horas_atual"))

        var_horas_corrigida = -var_horas_raw if abs(var_horas_raw) > 0.001 else (horas_parada_plano1 - horas_parada_atual)
        impacto = -impacto_raw if abs(impacto_raw) > 0 else 0

        if abs(impacto) < 1 and abs(var_horas_corrigida) < 0.01:
            continue

        detalhes.append({
            "id": str(row.get("id") or ""),
            "data": _json_safe(row.get("data")),
            "linha": row.get("linha"),
            "horas_plano1": _round(horas_parada_plano1),
            "horas_atual": _round(horas_parada_atual),
            "horas_impacto": _round(var_horas_corrigida),
            "impacto_cx": impacto,
            "impacto_tubetes": _round(impacto * TUBETES_POR_CAIXA),
            "motivo_plano1": row.get("comentario_atual") or "Sem comentário/parada no Plano 1",
            "motivo_atual": row.get("comentario_v1") or "Sem comentário/parada no Plano Atual",
            "categoria": row.get("causa_executiva") or row.get("categoria_atual") or row.get("categoria_v1"),
            "regra": "snapshot_auditado_analisehoras_corrigido; horas do banco representam parada/indisponibilidade; colunas V1/Atual invertidas no snapshot; impacto = -(impacto_cx original)",
        })

    return sorted(detalhes, key=lambda item: (str(item.get("data") or ""), str(item.get("linha") or "")))[:limit]



def _snapshot_resumo_horas_calendario(detalhes: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Resumo executivo do modal de alteração de calendário.

    horas_impacto > 0 = capacidade/hora liberada no plano atual vs Jan/V3.
    horas_impacto < 0 = capacidade/hora consumida no plano atual vs Jan/V3.

    O impacto em disponibilidade deve vir do saldo em cx; horas são leitura
    operacional de apoio. Por isso enviamos liberadas, consumidas e líquido.
    """
    eventos_liberada = 0
    eventos_consumida = 0
    horas_liberadas = 0.0
    horas_consumidas = 0.0
    impacto_liberado = 0.0
    impacto_consumido = 0.0

    for item in detalhes or []:
        h = _to_float(item.get("horas_impacto"))
        cx = _to_float(item.get("impacto_cx"))

        if h > 0.01 or cx > 0.5:
            eventos_liberada += 1
            horas_liberadas += max(h, 0.0)
            impacto_liberado += max(cx, 0.0)

        if h < -0.01 or cx < -0.5:
            eventos_consumida += 1
            horas_consumidas += abs(min(h, 0.0))
            impacto_consumido += abs(min(cx, 0.0))

    horas_liquidas = horas_liberadas - horas_consumidas
    impacto_liquido = impacto_liberado - impacto_consumido

    return {
        "eventos_capacidade_liberada": eventos_liberada,
        "eventos_capacidade_consumida": eventos_consumida,
        "horas_liberadas": _round(horas_liberadas),
        "horas_consumidas": _round(horas_consumidas),
        "horas_liquidas": _round(horas_liquidas),
        "impacto_liberado_cx": _round(impacto_liberado),
        "impacto_consumido_cx": _round(impacto_consumido),
        "impacto_liquido_calendario_cx": _round(impacto_liquido),
        "leitura": "Horas liberadas menos horas consumidas. O valor oficial da cascata continua sendo o impacto líquido em caixas do snapshot.",
    }



def _normalizar_lote_desvio(value: Any) -> str:
    texto = str(value or "").strip().upper()
    if texto.endswith(".0"):
        texto = texto[:-2]
    invalidos = {"", "-", "--", "N/A", "NA", "NAN", "NONE", "NULL", "SEM LOTE", "SEM_LOTE"}
    return "" if texto in invalidos else texto


def _estado_desvio_label(value: Any) -> str:
    """Converte o estado numérico do Monitor de Desvios para uma leitura executiva."""
    texto = str(value or "").strip()
    if not texto:
        return ""

    try:
        numero = int(float(texto.replace(",", ".")))
    except Exception:
        return texto

    mapa = {
        1: "Novo",
        2: "Em aberto",
        3: "Em análise",
        4: "Concluído",
        5: "Cancelado",
    }
    return mapa.get(numero, texto)



def _truthy_flag(value: Any) -> bool:
    texto = _normalizar_texto_upper(value)
    return texto in {"TRUE", "T", "1", "SIM", "S", "YES", "Y", "REPROVADO", "REPROVADA"}


# Lista oficial enviada pelo PCP em "Lotes_Descarte_2026_final (1).xlsx".
# Essa lista é a fonte executiva do modal de lotes descartados de 2026 quando
# o Monitor de Desvios ou o snapshot auditado estiver incompleto.
LOTES_DESCARTE_OFICIAL_2026: list[dict[str, Any]] = [
    {
        "lote": "2512C2080",
        "nc": "NC 2026 012",
        "titulo": "[MED] MEPIADRE - Teor de Cloridrato de mepivacaína abaixo da especificação",
        "qtd_raw": 104500,
    },
    {
        "lote": "2601F2010",
        "nc": "NC 2026 038",
        "titulo": "[MED] - ARTICAINE - Linha 2 - Ausência de Monitoramento Ambiental",
        "qtd_raw": 137500,
    },
    {"lote": "2603F1010", "nc": "NC 2026 090", "titulo": "[MED] ARTICAINE - Resultado fora de tendência", "qtd_raw": None},
    {"lote": "2603F1011", "nc": "NC 2026 090", "titulo": "[MED] ARTICAINE - Resultado fora de tendência", "qtd_raw": None},
    {"lote": "2603F1012", "nc": "NC 2026 090", "titulo": "[MED] ARTICAINE - Resultado fora de tendência", "qtd_raw": None},
    {"lote": "2603F1013", "nc": "NC 2026 090", "titulo": "[MED] ARTICAINE - Resultado fora de tendência", "qtd_raw": None},
    {
        "lote": "2604D1041",
        "nc": "NC 2026 129",
        "titulo": "[MED] - Indicador Biológico - ineficiência no processo de esterilização",
        "qtd_raw": None,
    },
    {
        "lote": "2604D1042",
        "nc": "NC 2026 129",
        "titulo": "[MED] - Indicador Biológico - ineficiência no processo de esterilização",
        "qtd_raw": None,
    },
    {
        "lote": "2604K1005",
        "nc": "NC 2026 129",
        "titulo": "[MED] - Indicador Biológico - ineficiência no processo de esterilização",
        "qtd_raw": None,
    },
    {
        "lote": "2604F1024",
        "nc": "NC 2026 129",
        "titulo": "[MED] - Indicador Biológico - ineficiência no processo de esterilização",
        "qtd_raw": None,
    },
    {
        "lote": "2604F1025",
        "nc": "NC 2026 129",
        "titulo": "[MED] - Indicador Biológico - ineficiência no processo de esterilização",
        "qtd_raw": None,
    },
    {"lote": "2604F2026", "nc": "-", "titulo": "[MED] - Descarte", "qtd_raw": None},
    {"lote": "2605F1032", "nc": "-", "titulo": "[MED] - Descarte", "qtd_raw": None},
    {"lote": "2605F2033", "nc": "-", "titulo": "[MED] - Descarte", "qtd_raw": None},
]


def _qtd_oficial_descarte_cx(value: Any) -> int | None:
    """Converte a quantidade do arquivo oficial para caixas quando existir.

    No arquivo recebido, as duas primeiras quantidades estão em tubetes apesar
    do cabeçalho vir como "Qtd Caixas" (104.500 e 137.500). Como uma caixa tem
    500 tubetes, valores muito altos são convertidos para caixas.
    """
    qtd = _to_float(value, default=0.0)
    if qtd <= 0:
        return None
    if qtd > 10000:
        return _round(qtd / TUBETES_POR_CAIXA)
    return _round(qtd)


def _desvios_oficiais_descarte_2026() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in LOTES_DESCARTE_OFICIAL_2026:
        lote = _normalizar_lote_desvio(item.get("lote"))
        nc_raw = str(item.get("nc") or "").strip()
        nc = "" if nc_raw in {"-", "—"} else nc_raw
        titulo = str(item.get("titulo") or "").strip()
        qtd_cx = _qtd_oficial_descarte_cx(item.get("qtd_raw"))
        row = {
            "id": f"oficial-descarte-2026-{lote}",
            "serial": nc,
            "nc": nc,
            "lote": lote,
            "lote_original": lote,
            "titulo": titulo,
            "título": titulo,
            "descricao": titulo,
            "descrição": titulo,
            "destino": "Reprovado - Destino: Descarte",
            "estado": 4 if nc else "",
            "status": "Concluído" if nc else "",
            "qtd_cx": qtd_cx,
            "qtd_perda_cx": qtd_cx,
            "qtd_caixas": qtd_cx,
            "qtd_tubetes": _round(qtd_cx * TUBETES_POR_CAIXA) if qtd_cx else None,
            "fonte_oficial_descarte_2026": True,
            "ano": 2026,
        }
        rows.append(row)
    return rows


def _lotes_oficiais_descarte_set(ano: int | None = None) -> set[str]:
    if ano and ano != 2026:
        return set()
    return {_normalizar_lote_desvio(item.get("lote")) for item in LOTES_DESCARTE_OFICIAL_2026 if _normalizar_lote_desvio(item.get("lote"))}


def _desvio_pertence_ao_ano(row: dict[str, Any], ano: int | None) -> bool:
    if not ano:
        return True
    ano_txt = str(ano)
    texto = " ".join(str(_get_any(row, c) or "") for c in (
        "serial", "nc", "data_criacao", "created_at", "arquivo_origem", "titulo", "título"
    ))
    return ano_txt in texto


def _row_desvio_reprovado(row: dict[str, Any], ano: int | None = None) -> bool:
    """Filtro executivo do Monitor de Desvios para reprovação/descarte."""
    if not isinstance(row, dict):
        return False
    if not _desvio_pertence_ao_ano(row, ano):
        return False

    texto = _normalizar_texto_upper(" ".join(str(_get_any(row, c) or "") for c in (
        "destino", "titulo", "título", "descricao", "descrição", "status", "estado", "serial", "nc"
    )))

    if any(t in texto for t in ["CANCEL", "CANCELAD", "ANULAD"]):
        return False

    # Na base de desvios da DFL, o sinal mais confiável para perda definitiva é
    # Destino = Descarte/Reprovado. Mantemos REPROV no título como fallback.
    return any(t in texto for t in ["DESCARTE", "DESCART", "REPROV"])


def _all_desvios_lotes_rows_cached() -> list[dict[str, Any]]:
    """Lê f_desvios_lotes uma vez e casa em Python.

    Motivo: o Supabase faz comparação exata/case-sensitive no .in_("lote", ...).
    Alguns arquivos de desvio podem chegar com espaço, caixa diferente ou lote
    apenas em lote_original. Para o modal executivo, é melhor varrer a tabela
    pequena de desvios e normalizar localmente do que deixar NC em branco.
    """
    chave = "f_desvios_lotes:all:v3"
    cached = _cache_get(chave)
    if cached is not None:
        return cached
    try:
        rows = _select_all(
            supabase.table("f_desvios_lotes")
            .select("*")
            .limit(10000)
        )
    except Exception:
        rows = []
    rows = [r for r in rows if isinstance(r, dict)]
    return _cache_set(chave, rows, ttl=300)


def _lotes_extraidos_do_desvio(row: dict[str, Any]) -> set[str]:
    """Extrai lote de campos estruturados e, como fallback, do texto da linha.

    Importante: alguns registros do Monitor de Desvios vêm com vários lotes
    na mesma célula, ex.: "2603F1010, 2603F1011, 2603F1012, 2603F1013".
    Nesses casos a célula NÃO deve virar uma linha de lote agrupado no modal;
    ela precisa ser quebrada em lotes individuais.
    """
    lotes: set[str] = set()

    def adicionar_texto_lotes(value: Any):
        texto = str(value or "").strip().upper()
        if not texto:
            return

        # Captura lotes no padrão DFL em qualquer texto, inclusive listas
        # separadas por vírgula, ponto e vírgula, barra ou quebra de linha.
        encontrados = re.findall(r"\b\d{4,6}[A-Z][A-Z0-9]*\b", texto)
        if encontrados:
            for m in encontrados:
                lote = _normalizar_lote_desvio(m)
                if lote:
                    lotes.add(lote)
            return

        # Fallback para algum formato estruturado não coberto pelo regex.
        for parte in re.split(r"[,;/\n\r\t]+", texto):
            lote = _normalizar_lote_desvio(parte)
            if lote:
                lotes.add(lote)

    for campo in (
        "lote", "lote_original", "lote original", "lote_op", "numero_lote",
        "num_lote", "ordem", "op", "ordem_producao",
    ):
        adicionar_texto_lotes(_get_any(row, campo))

    # Fallback para linhas importadas com o lote dentro de descrição/comentário.
    texto_linha = " ".join(str(v or "") for v in row.values())
    adicionar_texto_lotes(texto_linha)
    return lotes


def _select_desvios_reprovados_ano(ano: int | None, limit: int = 1000) -> list[dict[str, Any]]:
    """Fallback direto do Monitor de Desvios + lista oficial de descartes.

    A lista oficial do PCP entra primeiro para garantir os 14 lotes descartados
    de 2026, inclusive 2604F1025 e os lotes que ainda não estão completos no
    Monitor de Desvios. Depois complementa com a f_desvios_lotes.
    """
    rows = _all_desvios_lotes_rows_cached()
    filtrados = [r for r in rows if _row_desvio_reprovado(r, ano)]

    candidatos: list[dict[str, Any]] = []
    if ano in (None, 2026):
        candidatos.extend(_desvios_oficiais_descarte_2026())
    candidatos.extend(sorted(filtrados, key=_rank_desvio_reprovacao, reverse=True))

    vistos: set[str] = set()
    saida: list[dict[str, Any]] = []
    for row in candidatos:
        lotes = sorted(_lotes_extraidos_do_desvio(row))
        lote_key = ",".join(lotes)
        nc = str(_get_any(row, "serial", "nc") or "").strip()
        titulo = str(_get_any(row, "titulo", "título", "descricao", "descrição") or "").strip()

        # Deduplica por lote+NC. Isso evita duplicar quando o Monitor traz a
        # mesma NC com título ligeiramente diferente da lista oficial.
        if lote_key:
            chave = "|".join([nc, lote_key])
        else:
            chave = "|".join([nc, titulo]) or str(row.get("id") or "")

        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append(row)
        if len(saida) >= limit:
            break

    return saida

def _rank_desvio_reprovacao(row: dict[str, Any]) -> int:
    texto = _normalizar_texto_upper(" ".join(str(_get_any(row, c) or "") for c in (
        "destino", "titulo", "título", "descricao", "descrição", "serial", "estado",
    )))
    score = 0
    if row.get("fonte_oficial_descarte_2026"):
        score += 1000
    if "REPROV" in texto:
        score += 50
    if "DESCARTE" in texto:
        score += 40
    if "NC" in texto:
        score += 5
    if _get_any(row, "serial", "nc"):
        score += 5
    return score


def _select_desvios_lotes(lotes: set[str], limit: int = 1000) -> list[dict[str, Any]]:
    """Busca o Monitor de Desvios por lote/lote_original com casamento normalizado.

    Primeiro tenta a busca exata para ser rápido. Depois varre a tabela carregada
    em cache e compara lote normalizado em Python. Isso corrige casos em que o
    snapshot tem o lote, mas a NC vinha em branco porque o valor no banco tinha
    espaço, lower/upper diferente, lote_original ou lote dentro de texto.
    """
    lotes_norm = sorted({_normalizar_lote_desvio(l) for l in lotes if _normalizar_lote_desvio(l)})
    if not lotes_norm:
        return []

    alvo = set(lotes_norm)
    rows: list[dict[str, Any]] = []
    vistos: set[str] = set()

    def adicionar(lista: list[dict[str, Any]]):
        for row in lista or []:
            if not isinstance(row, dict):
                continue
            chave = str(row.get("id") or "|").strip()
            if chave == "|":
                chave = "|".join(str(row.get(c) or "") for c in ("serial", "lote", "lote_original", "titulo"))
            if chave in vistos:
                continue
            vistos.add(chave)
            rows.append(row)

    chunk_size = 80
    for i in range(0, len(lotes_norm), chunk_size):
        chunk = lotes_norm[i:i + chunk_size]
        try:
            adicionar(_select_all(
                supabase.table("f_desvios_lotes")
                .select("*")
                .in_("lote", chunk)
                .limit(limit)
            ))
        except Exception:
            pass

        try:
            adicionar(_select_all(
                supabase.table("f_desvios_lotes")
                .select("*")
                .in_("lote_original", chunk)
                .limit(limit)
            ))
        except Exception:
            pass

    # Fallback robusto: varre tudo e casa com normalização local.
    for row in _all_desvios_lotes_rows_cached():
        lotes_row = _lotes_extraidos_do_desvio(row)
        if not lotes_row or not (lotes_row & alvo):
            continue
        adicionar([row])
        if len(rows) >= limit:
            break

    return rows[:limit]

def _mapa_desvios_por_lote(lotes: set[str]) -> dict[str, list[dict[str, Any]]]:
    rows = _select_desvios_lotes(lotes)
    mapa: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        for chave in _lotes_extraidos_do_desvio(row):
            if chave:
                mapa.setdefault(chave, []).append(row)

    for chave, lista in mapa.items():
        mapa[chave] = sorted(lista, key=_rank_desvio_reprovacao, reverse=True)
    return mapa


def _qtd_lote_cx_from_row(row: dict[str, Any]) -> int:
    """Lê quantidade do lote em caixas aceitando variações de coluna.

    Algumas tabelas gravam o volume como caixas (qtd_cx/qtd_prevista_cx),
    outras gravam como tubetes (qtd_tubetes/qtd_planejada). Aqui padronizamos
    para caixas para o modal de reprovados fechar com a cascata.
    """
    for campo in (
        "qtd_cx", "qtd_perda_cx", "qtd_prevista_cx", "qtdPrevistaCx",
        "caixas", "qtd_caixas", "volume_cx", "qtd_planejada_cx",
    ):
        valor = _get_any(row, campo)
        if valor is not None and _to_float(valor) > 0:
            return _qtd_oficial_descarte_cx(valor) or 0

    for campo in (
        "qtd_tubetes", "tubetes", "qtd_planejada", "quantidade",
        "qtd", "volume", "qtd_prevista_tubetes",
    ):
        valor = _get_any(row, campo)
        if valor is not None and _to_float(valor) > 0:
            qtd = _to_float(valor)
            return _round(qtd / TUBETES_POR_CAIXA) if qtd > 10000 else _round(qtd)

    return 0


def _lote_auditoria_to_base(row: dict[str, Any]) -> dict[str, Any]:
    lote_raw = _get_any(
        row,
        "lote", "lote_original", "lote original", "lote_op", "numero_lote",
        "num_lote", "op", "ordem", "ordem_producao",
    )
    lote = _normalizar_lote_desvio(lote_raw)
    qtd_cx = _qtd_lote_cx_from_row(row)
    qtd_tubetes = _round(_get_any(row, "qtd_tubetes", "tubetes") or (qtd_cx * TUBETES_POR_CAIXA if qtd_cx else 0))
    return {
        "lote": lote or lote_raw,
        "codigo": row.get("codigo") or row.get("codigo_produto") or row.get("cod_produto"),
        "produto": row.get("produto") or row.get("descricao_produto"),
        "linha": row.get("linha"),
        "qtd_cx": qtd_cx,
        "qtd_tubetes": qtd_tubetes,
        "mes_liberacao": row.get("mes_liberacao"),
        "ano_liberacao": row.get("ano_liberacao"),
        "versao": row.get("versao"),
    }


def _normalizar_detalhe_lote_reprovado(
    base: dict[str, Any],
    desvio: dict[str, Any] | None = None,
) -> dict[str, Any]:
    desvio = desvio or {}
    lote = _normalizar_lote_desvio(base.get("lote") or _get_any(desvio, "lote", "lote_original"))
    nc = str(_get_any(desvio, "serial", "nc", "numero_nc", "n_nc") or "").strip()
    descricao = str(_get_any(desvio, "titulo", "título", "descricao", "descrição") or "").strip()
    destino = str(_get_any(desvio, "destino") or "").strip()
    estado_raw = _get_any(desvio, "estado", "status")
    status = _estado_desvio_label(estado_raw)
    setor = str(_get_any(desvio, "setor", "area", "área") or "").strip()
    dias = _to_int(_get_any(desvio, "dias_desvio", "dias", "dias_em_desvio"), 0)

    qtd_raw = None
    for campo in ("qtd_cx", "qtd_perda_cx", "qtdPrevistaCx", "caixas", "qtd_prevista_cx"):
        valor = base.get(campo)
        if valor is not None and _to_float(valor) > 0:
            qtd_raw = valor
            break

    if qtd_raw is None:
        for campo in ("qtd_cx", "qtd_perda_cx", "qtdPrevistaCx", "caixas", "qtd_caixas", "Qtd Caixas", "qtd_tubetes"):
            valor = _get_any(desvio, campo)
            if valor is not None and _to_float(valor) > 0:
                qtd_raw = valor
                break

    qtd_cx_calc = _qtd_oficial_descarte_cx(qtd_raw)
    qtd_cx = _round(qtd_cx_calc or 0)
    tem_qtd_base = qtd_cx > 0
    qtd_tubetes = _round(
        base.get("qtd_tubetes")
        or _get_any(desvio, "qtd_tubetes", "tubetes")
        or (qtd_cx * TUBETES_POR_CAIXA if qtd_cx else 0)
    )
    produto = str(base.get("produto") or "").strip()
    codigo = str(base.get("codigo") or base.get("codigo_produto") or "").strip()
    produto_label = " - ".join([v for v in [codigo, produto] if v]) or produto or codigo

    item = {
        # Campos novos do modal executivo.
        "nc": nc,
        "lote": lote or str(base.get("lote") or "").strip(),
        "produto": produto_label,
        "codigo": codigo,
        "descricao": descricao,
        "caixas": qtd_cx if tem_qtd_base else None,
        "tubetes": qtd_tubetes if tem_qtd_base else None,
        "destino": destino,
        "status": status,
        # Campos de apoio/legado para compatibilidade com o front antigo.
        "estado": status,
        "estado_raw": estado_raw,
        "setor": setor,
        "diasDesvio": dias if dias > 0 else None,
        "dias_desvio": dias if dias > 0 else None,
        "qtdPrevistaCx": qtd_cx,
        "qtdLiberadaCx": 0,
        "qtdPerdaCx": qtd_cx,
        "qtd_prevista_cx": qtd_cx,
        "qtd_liberada_cx": 0,
        "qtd_perda_cx": qtd_cx,
        "qtd_cx": qtd_cx,
        "qtd_tubetes": qtd_tubetes,
        "motivo": descricao,
        "titulo": descricao,
        "serial": nc,
        "arquivo_origem": _get_any(desvio, "arquivo_origem"),
        "data_criacao": _json_safe(_get_any(desvio, "data_criacao", "created_at")),
        "mes_liberacao": _to_int(base.get("mes_liberacao") or _get_any(desvio, "mes_liberacao", "mes_lib")),
        "ano_liberacao": _to_int(base.get("ano_liberacao") or _get_any(desvio, "ano_liberacao", "ano_lib")),
        "regra": "f_liberacao_exec_lotes_auditoria + f_desvios_lotes por lote/lote_original",
    }
    return item


def _audit_por_lote_snapshot(snapshot_id: str | None) -> dict[str, dict[str, Any]]:
    """Mapa lote -> dados auditados de produto/caixas do snapshot."""
    if not snapshot_id:
        return {}

    try:
        audit_rows = _select_all(
            supabase.table("f_liberacao_exec_lotes_auditoria")
            .select("*")
            .eq("snapshot_id", snapshot_id)
            .limit(5000)
        )
    except Exception:
        audit_rows = []

    mapa: dict[str, dict[str, Any]] = {}
    for row in audit_rows:
        if not isinstance(row, dict):
            continue
        base = _lote_auditoria_to_base(row)
        lote = _normalizar_lote_desvio(base.get("lote"))
        if lote:
            mapa.setdefault(lote, base)
    return mapa




def _qtd_sd3_por_lote(ano: int, lotes: set[str]) -> dict[str, dict[str, Any]]:
    """Soma quantidade real encontrada na SD3 por lote.

    Regra de negócio para o modal de reprovados:
    - se o lote já aparece na SD3, a coluna Caixas deve usar a soma da SD3;
    - se não aparece na SD3, usa o Gantt/MPS como fallback.

    Em geral, f_sd3_entradas.quantidade já está em caixas. Ainda assim,
    se algum ambiente trouxer tubetes em valor muito alto, convertemos por /500.
    """
    lotes_norm = {_normalizar_lote_desvio(l) for l in (lotes or set()) if _normalizar_lote_desvio(l)}
    if not lotes_norm:
        return {}

    chave_cache = f"qtd-sd3-reprovados:v1:{ano}:{','.join(sorted(lotes_norm))}"
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    rows: list[dict[str, Any]] = []

    # Busca exata em lotes para reduzir carga.
    chunk_size = 80
    for i in range(0, len(lotes_norm), chunk_size):
        chunk = sorted(lotes_norm)[i:i + chunk_size]
        try:
            rows.extend(_select_all(
                supabase.table("f_sd3_entradas")
                .select("*")
                .eq("ano", ano)
                .in_("lote", chunk)
                .limit(10000)
            ))
        except Exception:
            pass

    # Fallback robusto: se a busca exata não achou tudo, varre o ano e casa
    # normalizado em Python. Mantém cache curto para não pesar a tela.
    encontrados = {_normalizar_lote_desvio(r.get("lote")) for r in rows if isinstance(r, dict)}
    faltantes = lotes_norm - encontrados
    if faltantes:
        try:
            rows_ano = _select_all(
                supabase.table("f_sd3_entradas")
                .select("*")
                .eq("ano", ano)
                .limit(50000)
            )
            rows.extend([r for r in rows_ano if _normalizar_lote_desvio(r.get("lote")) in faltantes])
        except Exception:
            pass

    saida: dict[str, dict[str, Any]] = {}
    vistos: set[str] = set()

    for row in rows:
        if not isinstance(row, dict):
            continue

        lote = _normalizar_lote_desvio(_get_any(row, "lote", "lote_original", "num_lote", "numero_lote"))
        if lote not in lotes_norm:
            continue

        # Evita somar exatamente a mesma linha se a busca exata + fallback trouxerem duplicado.
        chave_linha = str(row.get("id") or "|".join(str(row.get(c) or "") for c in ("lote", "documento", "doc", "dt_mov", "data", "quantidade")))
        if chave_linha in vistos:
            continue
        vistos.add(chave_linha)

        qtd_raw = _get_any(
            row,
            "quantidade", "qtd", "qtd_movimento", "quantidade_liberada",
            "qtd_liberada", "qtd_entrada", "qtd_cx", "caixas",
        )
        qtd_val = _to_float(qtd_raw, 0)
        if qtd_val <= 0:
            continue

        # SD3 normalmente vem em caixas. Se vier claramente em tubetes, converte.
        qtd_cx = _round(qtd_val / TUBETES_POR_CAIXA) if qtd_val > 10000 else _round(qtd_val)
        if qtd_cx <= 0:
            continue

        atual = saida.setdefault(lote, {
            "lote": lote,
            "qtd_cx": 0,
            "qtd_tubetes": 0,
            "codigo": None,
            "produto": None,
            "fonte_qtd": "f_sd3_entradas",
            "regra_qtd": "soma_sd3_por_lote; se_sd3_existe_prevalece_sobre_gantt",
            "qtd_linhas_sd3": 0,
        })
        atual["qtd_cx"] = _round(_to_float(atual.get("qtd_cx"), 0) + qtd_cx)
        atual["qtd_tubetes"] = _round(_to_float(atual.get("qtd_cx"), 0) * TUBETES_POR_CAIXA)
        atual["qtd_linhas_sd3"] = _to_int(atual.get("qtd_linhas_sd3"), 0) + 1

        codigo = _get_any(row, "codigo_produto", "cod_produto", "codigo", "produto_codigo", "cod")
        produto = _get_any(row, "descr_prod", "descricao_produto", "produto", "descrição", "descricao")
        if codigo and not atual.get("codigo"):
            atual["codigo"] = codigo
        if produto and not atual.get("produto"):
            atual["produto"] = produto

    return _cache_set(chave_cache, saida, ttl=600)


def _soma_caixas_lotes_reprovados(detalhes: list[dict[str, Any]]) -> int:
    return _round(sum(
        _to_float(item.get("qtd_perda_cx") or item.get("qtd_cx") or item.get("caixas"), 0)
        for item in (detalhes or [])
    ))

def _qtd_mrp_plano1_por_lote(ano: int, lotes: set[str]) -> dict[str, dict[str, Any]]:
    """Busca uma quantidade de referência do Gantt para cada lote.

    Correção importante:
    o objetivo do modal não é somar todas as aparições do lote em todas as
    versões/rodadas do MPS. O mesmo lote pode aparecer em várias rodadas e isso
    inflava absurdamente a quantidade (ex.: 12.600 cx para um único lote).

    Regra correta para preencher a coluna Caixas:
    - localizar o lote no Gantt/MPS;
    - pegar UMA ocorrência representativa do lote;
    - converter QTD. (Tubetes) para caixas dividindo por 500;
    - usar produto/código dessa mesma ocorrência.

    Preferência:
    1) Plano 1 Jan/V3 quando o lote existir lá;
    2) qualquer ocorrência em f_mrp_etapas, escolhendo a quantidade mais comum
       entre as versões. Isso evita somar a mesma OP repetida em V1/V2/V3.
    """
    lotes_norm = {_normalizar_lote_desvio(l) for l in lotes if _normalizar_lote_desvio(l)}
    if not lotes_norm:
        return {}

    chave_cache = f"qtd-gantt-uma-ocorrencia-reprovados:v3-normalizado:{ano}:{','.join(sorted(lotes_norm))}"
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    candidatos: dict[str, list[dict[str, Any]]] = {lote: [] for lote in lotes_norm}

    def qtd_cx_gantt_row(row: dict[str, Any]) -> int:
        def _ajustar_1cx_reprovado(qtd_cx: int) -> int:
            # Regra operacional validada:
            # alguns lotes reprovados foram colocados no Gantt com 1 cx apenas
            # para não inflar a disponibilidade. Para medir a perda real por lote,
            # 1 cx no Gantt deve voltar para o lote padrão de 600 cx.
            return 600 if _round(qtd_cx) == 1 else _round(qtd_cx)

        # Prioriza explicitamente colunas em tubetes do Gantt.
        for campo in (
            "qtd_planejada", "QTD. (Tubetes)", "QTD (Tubetes)", "qtd_tubetes",
            "tubetes", "quantidade_tubetes", "qtd",
        ):
            valor = _get_any(row, campo)
            if valor is None or _to_float(valor) <= 0:
                continue
            qtd = _to_float(valor)
            # No Gantt, a quantidade principal é tubete. Valores altos viram caixas.
            qtd_cx = _round(qtd / TUBETES_POR_CAIXA) if qtd > 10000 else _round(qtd)
            return _ajustar_1cx_reprovado(qtd_cx)

        # Fallback para colunas já em caixas, quando existirem.
        for campo in ("qtd_cx", "qtd_caixas", "caixas", "volume_cx", "qtd_planejada_cx"):
            valor = _get_any(row, campo)
            if valor is not None and _to_float(valor) > 0:
                return _ajustar_1cx_reprovado(_round(_to_float(valor)))
        return 0

    def consumir_row(row: dict[str, Any], fonte: str, prioridade: int):
        lote = _normalizar_lote_desvio(_get_any(
            row,
            "lote", "lote_original", "lote_op", "numero_lote", "num_lote",
            "op", "ordem", "ordem_producao",
        ))
        if lote not in lotes_norm:
            return
        if not _etapa_plano_valida(row):
            return
        qtd_cx = qtd_cx_gantt_row(row)
        if qtd_cx <= 0:
            return
        candidatos.setdefault(lote, []).append({
            "lote": lote,
            "qtd_cx": qtd_cx,
            "qtd_tubetes": _round(qtd_cx * TUBETES_POR_CAIXA),
            "codigo": _get_any(row, "codigo_produto", "cod_produto", "codigo", "código"),
            "produto": _get_any(row, "descricao_produto", "produto", "descr_prod"),
            "linha": _get_any(row, "recurso", "linha", "linha_origem"),
            "mes_liberacao": _to_int(_get_any(row, "mes_liberacao", "mes_lib")),
            "ano_liberacao": _to_int(_get_any(row, "ano_liberacao", "ano_lib")),
            "data_pa": _get_any(row, "data_pa", "data_liberacao", "data_lib"),
            "rodada_id": _get_any(row, "rodada_id"),
            "sequencia": _get_any(row, "sequencia"),
            "fonte_qtd": fonte,
            "prioridade": prioridade,
        })

    # 1) Tenta Jan/V3, que é a base orçada da cascata.
    try:
        rodada = _rodada_mrp_unica(ano, mes=1, versao=3)
        if rodada and rodada.get("id"):
            for row in _select_etapas_rodadas_bulk([rodada.get("id")]):
                if isinstance(row, dict):
                    consumir_row(row, "f_mrp_etapas_jan_v3_uma_ocorrencia", 1)
    except Exception:
        pass

    # 2) Complementa faltantes buscando em qualquer Gantt, sem somar versões.
    # Primeiro tenta busca exata por lote. Depois faz fallback normalizado por ano,
    # porque em alguns uploads o lote pode estar com espaços, .0, OP ou variação de coluna.
    faltantes = {lote for lote in lotes_norm if not candidatos.get(lote)}
    if faltantes:
        try:
            rows_lote = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .in_("lote", sorted(faltantes))
                .limit(10000)
            )
        except Exception:
            rows_lote = []
        for row in rows_lote:
            if isinstance(row, dict):
                consumir_row(row, "f_mrp_etapas_qualquer_gantt_uma_ocorrencia", 2)

    # Fallback robusto: varre o ano de liberação/produção e casa em Python pelo
    # lote normalizado. Isso é o que garante que a reprovação mensal use o mesmo
    # mês de liberação do Gantt/MPS mesmo quando a busca exata não acha o lote.
    faltantes = {lote for lote in lotes_norm if not candidatos.get(lote)}
    if faltantes:
        rows_norm: list[dict[str, Any]] = []
        try:
            rows_norm.extend(_select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("ano_liberacao", ano)
                .limit(50000)
            ))
        except Exception:
            pass
        try:
            rows_norm.extend(_select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("ano_producao", ano)
                .limit(50000)
            ))
        except Exception:
            pass

        vistos_rows: set[str] = set()
        for row in rows_norm:
            if not isinstance(row, dict):
                continue
            chave_row = str(row.get("id") or "|".join(str(row.get(c) or "") for c in ("rodada_id", "lote", "op", "codigo_produto", "data_pa", "sequencia")))
            if chave_row in vistos_rows:
                continue
            vistos_rows.add(chave_row)

            lote_row = _normalizar_lote_desvio(_get_any(
                row,
                "lote", "lote_original", "lote_op", "numero_lote", "num_lote",
                "op", "ordem", "ordem_producao",
            ))
            if lote_row in faltantes:
                consumir_row(row, "f_mrp_etapas_ano_normalizado_uma_ocorrencia", 3)

    saida: dict[str, dict[str, Any]] = {}
    for lote, lista in candidatos.items():
        lista = [c for c in lista if _round(c.get("qtd_cx")) > 0]
        if not lista:
            continue

        # Escolhe a quantidade mais comum dentro da melhor prioridade disponível.
        # Se a mesma linha aparece em várias versões, ela não pode ser somada;
        # a moda representa a quantidade planejada do lote.
        melhor_prioridade = min(_to_int(c.get("prioridade"), 99) or 99 for c in lista)
        lista_prio = [c for c in lista if (_to_int(c.get("prioridade"), 99) or 99) == melhor_prioridade]

        contagem: dict[int, int] = {}
        for c in lista_prio:
            qtd = _round(c.get("qtd_cx"))
            contagem[qtd] = contagem.get(qtd, 0) + 1

        qtd_escolhida = sorted(contagem.items(), key=lambda item: (-item[1], item[0]))[0][0]
        # Pega um candidato com a quantidade escolhida para carregar código/produto.
        escolhido = next((c for c in lista_prio if _round(c.get("qtd_cx")) == qtd_escolhida), lista_prio[0])
        saida[lote] = {
            **escolhido,
            "qtd_cx": qtd_escolhida,
            "qtd_tubetes": _round(qtd_escolhida * TUBETES_POR_CAIXA),
            "qtd_ocorrencias_encontradas": len(lista),
            "qtd_ocorrencias_mesma_prioridade": len(lista_prio),
            "regra_qtd": "uma_ocorrencia_do_gantt; nao_soma_versoes; qtd_tubetes_dividido_por_500",
        }

    return _cache_set(chave_cache, saida, ttl=600)

def _set_quantidade_lote_modal(item: dict[str, Any], qtd_cx: int, fonte: str):
    qtd_cx = _round(qtd_cx)
    if qtd_cx <= 0:
        return
    item["caixas"] = qtd_cx
    item["qtd_cx"] = qtd_cx
    item["qtd_perda_cx"] = qtd_cx
    item["qtdPerdaCx"] = qtd_cx
    item["qtd_prevista_cx"] = qtd_cx
    item["qtdPrevistaCx"] = qtd_cx
    item["qtd_liberada_cx"] = 0
    item["qtdLiberadaCx"] = 0
    item["tubetes"] = _round(qtd_cx * TUBETES_POR_CAIXA)
    item["qtd_tubetes"] = _round(qtd_cx * TUBETES_POR_CAIXA)
    item["fonte_qtd"] = fonte


def _fechar_quantidades_lotes_reprovados(
    detalhes: list[dict[str, Any]],
    *,
    ano: int | None,
    snapshot_id: str | None,
    total_oficial_cx: int | None = None,
) -> list[dict[str, Any]]:
    """Completa a coluna Caixas para o modal de lotes reprovados.

    Regra validada:
    1. se o lote existir na SD3, usa a soma da SD3 por lote;
    2. se não existir na SD3, mantém quantidade oficial já informada;
    3. se não houver quantidade oficial, usa uma ocorrência do Gantt/MPS
       (QTD. Tubetes / 500);
    4. quando o Gantt trouxe 1 cx para não contar na disponibilidade, trata
       como lote padrão de 600 cx para mensurar a perda real do descarte.

    A soma detalhada passa a ser o total de perda por lote. O saldo restante da
    ponte fica no bloco Atraso produção / Alterações plano.
    """
    if not detalhes:
        return detalhes

    lotes = {_normalizar_lote_desvio(item.get("lote")) for item in detalhes if _normalizar_lote_desvio(item.get("lote"))}
    sd3 = _qtd_sd3_por_lote(ano or date.today().year, lotes) if ano else {}
    audit = _audit_por_lote_snapshot(snapshot_id)
    mrp = _qtd_mrp_plano1_por_lote(ano or date.today().year, lotes) if ano else {}

    def _preencher_mes_liberacao_item(item: dict[str, Any], lote: str):
        # A reprovação mensal deve cair no mês em que o lote seria liberado no Gantt/MPS.
        # SD3 pode ajudar na quantidade, mas não define o mês da perda executiva.
        if _to_int(item.get("mes_liberacao")) and _to_int(item.get("ano_liberacao")):
            return
        base_mes = audit.get(lote) or mrp.get(lote) or {}
        mes_lib = _to_int(base_mes.get("mes_liberacao"))
        ano_lib = _to_int(base_mes.get("ano_liberacao"))
        if (not mes_lib or not ano_lib) and base_mes.get("data_pa"):
            dt_pa = _parse_date_value(base_mes.get("data_pa"))
            if dt_pa:
                mes_lib = mes_lib or dt_pa.month
                ano_lib = ano_lib or dt_pa.year
        if mes_lib:
            item["mes_liberacao"] = mes_lib
        if ano_lib:
            item["ano_liberacao"] = ano_lib

    for item in detalhes:
        lote = _normalizar_lote_desvio(item.get("lote"))
        _preencher_mes_liberacao_item(item, lote)

        # 1) SD3 prevalece quando existir.
        base_sd3 = sd3.get(lote) or {}
        qtd_sd3 = _round(base_sd3.get("qtd_cx"))
        if qtd_sd3 > 0:
            _set_quantidade_lote_modal(item, qtd_sd3, str(base_sd3.get("fonte_qtd") or "f_sd3_entradas"))
            codigo = str(base_sd3.get("codigo") or "").strip()
            produto = str(base_sd3.get("produto") or "").strip()
            if codigo or produto:
                item["produto"] = " - ".join([v for v in [codigo, produto] if v]) or produto or codigo or item.get("produto")
            item["regra_qtd"] = base_sd3.get("regra_qtd")
            item["qtd_linhas_sd3"] = base_sd3.get("qtd_linhas_sd3")
            continue

        # 2) Mantém quantidade já presente na lista oficial/manual.
        qtd_atual = _round(item.get("qtd_perda_cx") or item.get("qtd_cx") or item.get("caixas"))
        if qtd_atual > 0:
            item.setdefault("fonte_qtd", "detalhe_existente")
            item.setdefault("regra_qtd", "quantidade_preexistente_no_detalhe_oficial")
            continue

        # 3) Usa auditoria do snapshot se vier com quantidade.
        base = audit.get(lote) or {}
        qtd_audit = _round(base.get("qtd_cx"))
        if qtd_audit > 0:
            _set_quantidade_lote_modal(item, qtd_audit, "f_liberacao_exec_lotes_auditoria")
            if not item.get("produto") or item.get("produto") == "—":
                codigo = str(base.get("codigo") or "").strip()
                produto = str(base.get("produto") or "").strip()
                item["produto"] = " - ".join([v for v in [codigo, produto] if v]) or produto or codigo or item.get("produto")
            item["regra_qtd"] = "snapshot_auditoria"
            continue

        # 4) Fallback: uma ocorrência do Gantt/MPS.
        base_mrp = mrp.get(lote) or {}
        qtd_mrp = _round(base_mrp.get("qtd_cx"))
        if qtd_mrp > 0:
            _set_quantidade_lote_modal(item, qtd_mrp, str(base_mrp.get("fonte_qtd") or "f_mrp_etapas"))
            if not item.get("produto") or item.get("produto") == "—":
                codigo = str(base_mrp.get("codigo") or "").strip()
                produto = str(base_mrp.get("produto") or "").strip()
                item["produto"] = " - ".join([v for v in [codigo, produto] if v]) or produto or codigo or item.get("produto")
            item["regra_qtd"] = base_mrp.get("regra_qtd")
            if base_mrp.get("mes_liberacao"):
                item["mes_liberacao"] = _to_int(base_mrp.get("mes_liberacao"))
            if base_mrp.get("ano_liberacao"):
                item["ano_liberacao"] = _to_int(base_mrp.get("ano_liberacao"))

    total_reprov_por_lote = _soma_caixas_lotes_reprovados(detalhes)
    total_snapshot = abs(_round(total_oficial_cx)) if total_oficial_cx is not None else 0

    for item in detalhes:
        item["total_snapshot_reprovacao_cx"] = total_snapshot
        item["total_oficial_reprovacao_cx"] = total_reprov_por_lote
        item["soma_detalhada_reprovacao_cx"] = total_reprov_por_lote
        item["leitura_qtd"] = (
            "Total de reprovados vem da soma dos lotes: SD3 quando existir; "
            "senão Gantt/MPS; Gantt com 1 cx é tratado como 600 cx."
        )

    return detalhes


def _detalhar_lotes_reprovados_oficial_2026(
    *,
    snapshot_id: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Fonte executiva do modal de descarte 2026: exatamente 1 linha por lote oficial.

    A lista "Lotes_Descarte_2026_final" é a verdade de negócio para este
    modal. O Monitor de Desvios pode trazer NC agrupada em uma linha e também
    linhas individuais; se misturarmos as duas fontes, aparecem duplicidades.
    Por isso, para 2026, a tabela sai da lista oficial e só usa o snapshot como
    complemento de produto/caixas quando houver.
    """
    audit_por_lote = _audit_por_lote_snapshot(snapshot_id)
    detalhes: list[dict[str, Any]] = []
    vistos: set[str] = set()

    for desvio in _desvios_oficiais_descarte_2026():
        lote = _normalizar_lote_desvio(_get_any(desvio, "lote", "lote_original"))
        if not lote or lote in vistos:
            continue
        vistos.add(lote)

        base = audit_por_lote.get(lote) or {"lote": lote, "qtd_cx": 0, "qtd_tubetes": 0}
        item = _normalizar_detalhe_lote_reprovado(base, desvio)
        item["fonte"] = "lista_oficial_descarte_2026"
        item["regra"] = "lista_oficial_2026_uma_linha_por_lote; snapshot_apenas_complementa_produto_caixas"
        detalhes.append(item)

    return sorted(
        detalhes,
        key=lambda item: (
            str(item.get("nc") or "ZZZ"),
            str(item.get("lote") or ""),
        ),
    )[:limit]


def _detalhar_lotes_reprovados(
    *,
    snapshot_id: str | None = None,
    lotes: set[str] | None = None,
    ano: int | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Retorna linhas prontas para o modal: NC, lote, produto, descrição, caixas, destino e status."""
    # Para 2026, a planilha oficial de descarte enviada pelo PCP é a fonte de
    # verdade. Isso evita duplicar NCs quando a f_desvios_lotes tem uma linha
    # agrupada da NC e também linhas individuais por lote.
    if ano == 2026:
        return _detalhar_lotes_reprovados_oficial_2026(snapshot_id=snapshot_id, limit=limit)

    bases: list[dict[str, Any]] = []
    audit_rows: list[dict[str, Any]] = []
    audit_por_lote: dict[str, dict[str, Any]] = {}

    if snapshot_id:
        try:
            # Não filtramos reprovado_qualidade no Supabase porque em alguns
            # ambientes esse campo veio como texto/inteiro ou simplesmente não
            # veio populado. Filtramos em Python e guardamos o mapa por lote para
            # usar como complemento de caixas/produto quando o fallback vier do
            # Monitor de Desvios.
            audit_rows = _select_all(
                supabase.table("f_liberacao_exec_lotes_auditoria")
                .select("*")
                .eq("snapshot_id", snapshot_id)
                .limit(5000)
            )
        except Exception:
            audit_rows = []

        vistos_auditoria: set[str] = set()
        for row in audit_rows:
            if not isinstance(row, dict):
                continue
            base = _lote_auditoria_to_base(row)
            lote_base = _normalizar_lote_desvio(base.get("lote"))
            if lote_base:
                audit_por_lote.setdefault(lote_base, base)

            flag_reprovado = any(_truthy_flag(_get_any(row, campo)) for campo in (
                "reprovado_qualidade", "reprovado", "flag_reprovado", "desvio_reprovacao", "qualidade_reprovado"
            ))
            causa_texto = _normalizar_texto_upper(" ".join(str(_get_any(row, c) or "") for c in (
                "causa", "causa_executiva", "status_gap", "destino", "observacao", "observação"
            )))
            if not flag_reprovado and not any(t in causa_texto for t in ["REPROV", "DESCARTE", "DESCART"]):
                continue

            chave = lote_base or str(row.get("id") or "")
            if chave in vistos_auditoria:
                continue
            vistos_auditoria.add(chave)
            bases.append(base)

    lotes_norm = {_normalizar_lote_desvio(l) for l in (lotes or set()) if _normalizar_lote_desvio(l)}
    lotes_existentes = {_normalizar_lote_desvio(b.get("lote")) for b in bases if _normalizar_lote_desvio(b.get("lote"))}
    for lote in sorted(lotes_norm - lotes_existentes):
        bases.append(audit_por_lote.get(lote) or {"lote": lote, "qtd_cx": 0, "qtd_tubetes": 0})

    # Fallback principal para o caso do print: o componente da cascata tem 14
    # lotes, mas a tabela auditada do snapshot não devolve nenhum detalhe.
    # Nessa situação, monta a tabela direto da f_desvios_lotes.
    if not bases and ano:
        detalhes_diretos: list[dict[str, Any]] = []
        vistos_diretos: set[str] = set()
        for desvio in _select_desvios_reprovados_ano(ano, limit=limit):
            lote = _normalizar_lote_desvio(_get_any(desvio, "lote", "lote_original", "lote original"))
            base = audit_por_lote.get(lote) or {"lote": lote, "qtd_cx": 0, "qtd_tubetes": 0}
            item = _normalizar_detalhe_lote_reprovado(base, desvio)
            chave = "|".join([str(item.get("nc") or ""), str(item.get("lote") or ""), str(item.get("descricao") or "")])
            if chave in vistos_diretos:
                continue
            vistos_diretos.add(chave)
            detalhes_diretos.append(item)
        return sorted(
            detalhes_diretos,
            key=lambda item: (str(item.get("nc") or "ZZZ"), str(item.get("lote") or "")),
        )[:limit]

    lotes_para_busca = {_normalizar_lote_desvio(b.get("lote")) for b in bases if _normalizar_lote_desvio(b.get("lote"))}
    desvios_por_lote = _mapa_desvios_por_lote(lotes_para_busca)

    # Complementa sempre com o Monitor inteiro do ano.
    # Antes isso só rodava quando nenhum lote casava; no caso real, 7 NCs casavam
    # e os demais lotes ficavam em branco. Agora a fonte de desvios entra como
    # complemento linha a linha, sem depender do snapshot estar completo.
    if ano and bases:
        for desvio in _select_desvios_reprovados_ano(ano, limit=limit):
            lotes_do_desvio = _lotes_extraidos_do_desvio(desvio)
            if not lotes_do_desvio:
                continue
            for lote in lotes_do_desvio:
                if desvio.get("fonte_oficial_descarte_2026"):
                    nc_oficial = str(_get_any(desvio, "serial", "nc") or "").strip()
                    existentes = []
                    for d in desvios_por_lote.get(lote, []):
                        nc_existente = str(_get_any(d, "serial", "nc") or "").strip()
                        # A lista oficial é a fonte de verdade para o par lote+NC.
                        if nc_oficial and nc_existente == nc_oficial:
                            continue
                        existentes.append(d)
                    desvios_por_lote[lote] = [desvio, *existentes]
                else:
                    desvios_por_lote.setdefault(lote, []).append(desvio)

                if lote not in lotes_para_busca:
                    bases.append(audit_por_lote.get(lote) or {"lote": lote, "qtd_cx": 0, "qtd_tubetes": 0})
                    lotes_para_busca.add(lote)

    detalhes: list[dict[str, Any]] = []
    vistos_saida: set[str] = set()
    for base in bases:
        lote = _normalizar_lote_desvio(base.get("lote"))
        desvios = desvios_por_lote.get(lote) or [None]
        # Mantém todos os NCs associados ao lote quando existir mais de um.
        for desvio in desvios:
            item = _normalizar_detalhe_lote_reprovado(base, desvio)
            chave = "|".join([str(item.get("nc") or ""), str(item.get("lote") or ""), str(item.get("descricao") or "")])
            if chave in vistos_saida:
                continue
            vistos_saida.add(chave)
            detalhes.append(item)

    return sorted(
        detalhes,
        key=lambda item: (
            str(item.get("nc") or "ZZZ"),
            str(item.get("lote") or ""),
        ),
    )[:limit]


def _resumo_modal_lotes_reprovados(detalhes_lotes: list[dict[str, Any]], delta_cx: int, qtd_lotes_fallback: int = 0) -> dict[str, Any]:
    lotes_unicos = {_normalizar_lote_desvio(item.get("lote")) for item in detalhes_lotes if _normalizar_lote_desvio(item.get("lote"))}
    ncs_unicas = {str(item.get("nc") or "").strip() for item in detalhes_lotes if str(item.get("nc") or "").strip()}
    total_detalhe = sum(_round(item.get("qtd_perda_cx") or item.get("qtd_cx") or item.get("caixas")) for item in detalhes_lotes)
    # O card precisa manter o valor oficial da cascata. A tabela pode ter caixa
    # parcial por lote quando a lista oficial informa somente alguns volumes.
    total_oficial = abs(_round(delta_cx))
    total_cx = total_oficial if total_oficial > 0 else total_detalhe
    qtd_lotes = len(lotes_unicos) or qtd_lotes_fallback

    return {
        "qtd_lotes": qtd_lotes,
        "qtd_ncs": len(ncs_unicas),
        "total_caixas": total_cx,
        "total_tubetes": _round(total_cx * TUBETES_POR_CAIXA),
    }


def _snapshot_lotes_reprovados(snapshot_id: str, ano: int | None = None, limit: int = 500) -> list[dict[str, Any]]:
    return _detalhar_lotes_reprovados(snapshot_id=snapshot_id, ano=ano, limit=limit)

@router.get("/debug-lotes-reprovados")
def get_liberacao_executiva_debug_lotes_reprovados(
    ano: int | None = Query(default=None),
    mes_atual: int | None = Query(default=None, ge=1, le=12),
):
    """Diagnóstico rápido do vínculo entre snapshot e Monitor de Desvios."""
    hoje = date.today()
    ano_ref = ano or hoje.year
    mes_ref = mes_atual or hoje.month
    rows = _snapshot_exec_rows_ativo(ano_ref, mes_ref)
    snapshot_id = str(rows[0].get("snapshot_id") or "") if rows else ""

    lotes_snapshot = set()
    if snapshot_id:
        try:
            audit_rows = _select_all(
                supabase.table("f_liberacao_exec_lotes_auditoria")
                .select("*")
                .eq("snapshot_id", snapshot_id)
                .limit(5000)
            )
        except Exception:
            audit_rows = []
        for row in audit_rows:
            lote = _normalizar_lote_desvio(_get_any(row, "lote", "lote_original"))
            if lote:
                lotes_snapshot.add(lote)

    desvios_ano = _select_desvios_reprovados_ano(ano_ref)
    lotes_desvios = set()
    for row in desvios_ano:
        lotes_desvios.update(_lotes_extraidos_do_desvio(row))

    detalhes = _detalhar_lotes_reprovados(snapshot_id=snapshot_id, ano=ano_ref)
    lotes_detalhes = {_normalizar_lote_desvio(d.get("lote")) for d in detalhes if _normalizar_lote_desvio(d.get("lote"))}
    lotes_oficiais = _lotes_oficiais_descarte_set(ano_ref)

    return _json_safe({
        "ano": ano_ref,
        "mes": mes_ref,
        "snapshot_id": snapshot_id,
        "qtd_lotes_oficiais_2026": len(lotes_oficiais),
        "lotes_oficiais_2026": sorted(lotes_oficiais),
        "qtd_snapshot_lotes": len(lotes_snapshot),
        "qtd_desvios_reprovados_ano": len(desvios_ano),
        "qtd_lotes_desvios_ano": len(lotes_desvios),
        "qtd_detalhes_modal": len(detalhes),
        "lotes_snapshot_sem_nc": sorted(lotes_snapshot - lotes_desvios),
        "lotes_desvios_fora_snapshot": sorted(lotes_desvios - lotes_snapshot),
        "lotes_detalhes": sorted(lotes_detalhes),
        "soma_caixas_detalhes": sum(_round(d.get("qtd_perda_cx") or d.get("qtd_cx") or d.get("caixas")) for d in detalhes),
        "fontes_qtd": sorted({str(d.get("fonte_qtd") or "") for d in detalhes if d.get("fonte_qtd")}),
        "amostra_detalhes": detalhes[:30],
    })


def _snapshot_tone(row: dict[str, Any]) -> str:
    comp = _normalizar_texto_upper(row.get("componente"))
    valor = _round(row.get("valor_cx"))

    if str(row.get("tipo") or "").lower() == "base":
        return "navy"
    if str(row.get("tipo") or "").lower() == "final":
        return "teal"
    if "REPROV" in comp:
        return "orange"
    if "REND" in comp:
        return "green" if valor > 0 else "gray"
    if "ATRASO" in comp:
        return "red" if valor < 0 else "green"
    if "CALEND" in comp:
        return "red" if valor < 0 else "green"
    return "red" if valor < 0 else "green"


def _snapshot_step_id(row: dict[str, Any]) -> str:
    comp = _normalizar_texto_upper(row.get("componente"))
    tipo = str(row.get("tipo") or "").lower()
    if tipo == "base":
        return "plano1"
    if tipo == "final":
        return "disponibilidade"
    if "CALEND" in comp:
        return "reorg-plano"
    if "REPROV" in comp:
        return "reprovacao"
    if "REND" in comp:
        return "rendimento"
    if "ATRASO" in comp:
        return "atraso-pos-cogtive"
    return re.sub(r"[^a-z0-9]+", "-", _normalizar_chave_coluna(row.get("componente") or "step")).strip("-")


def _snapshot_step_label(row: dict[str, Any]) -> str:
    comp = str(row.get("componente") or "").strip()
    comp_norm = _normalizar_texto_upper(comp)
    if "ATRASO" in comp_norm:
        return "Atraso produção"
    if "ALTERACAO" in comp_norm or "ALTERAÇÃO" in comp_norm or "CALEND" in comp_norm:
        return "Var. calendário"
    if "REPROV" in comp_norm:
        return "Reprov. lote"
    return comp


def _snapshot_causas_payload(ano_ref: int, mes_ref: int, detalhes: bool = False) -> dict[str, Any] | None:
    rows = _snapshot_exec_rows_ativo(ano_ref, mes_ref)
    if not rows:
        return None

    snapshot_id = str(rows[0].get("snapshot_id") or "")
    base_cx, final_cx = _snapshot_base_final(rows)
    if base_cx <= 0 or final_cx <= 0:
        return None

    estoque_jan_cx = _estoque_inicial_jan(ano_ref)
    if estoque_jan_cx <= 0 and ano_ref == 2026:
        estoque_jan_cx = ESTOQUE_INICIAL_JAN_FALLBACK_CX_2026

    plano1_liberacao_cx = base_cx - estoque_jan_cx
    plano_atual_liberacao_cx = final_cx - estoque_jan_cx
    delta_total = final_cx - base_cx

    calendario_cx = _snapshot_component_value(rows, "CALEND")
    reprovacao_cx = _snapshot_component_value(rows, "REPROV")
    rendimento_cx = _snapshot_component_value(rows, "REND")
    atraso_cx = _snapshot_component_value(rows, "ATRASO")

    # O detalhe dos modais não pode derrubar a cascata anual.
    # Em julho, o backend estava deixando a waterfall sumir porque uma falha no
    # enriquecimento dos lotes/NCs quebrava o payload inteiro de /causas-anuais.
    try:
        detalhes_calendario_snapshot = _snapshot_horas_detalhes(snapshot_id)
    except Exception:
        detalhes_calendario_snapshot = []

    try:
        detalhes_lotes_reprovados_snapshot = _snapshot_lotes_reprovados(snapshot_id, ano=ano_ref)
    except Exception as exc:
        detalhes_lotes_reprovados_snapshot = []
        # Para 2026, mesmo se o cruzamento com o banco falhar, usa a lista
        # oficial de descartes para manter o modal funcionando.
        if ano_ref == 2026:
            try:
                detalhes_lotes_reprovados_snapshot = _detalhar_lotes_reprovados_oficial_2026(
                    snapshot_id=None,
                    limit=500,
                )
            except Exception:
                detalhes_lotes_reprovados_snapshot = []

    detalhes_lotes_reprovados_snapshot = _fechar_quantidades_lotes_reprovados(
        detalhes_lotes_reprovados_snapshot,
        ano=ano_ref,
        snapshot_id=snapshot_id,
        total_oficial_cx=abs(reprovacao_cx),
    )

    reprovacao_detalhada_cx = _soma_caixas_lotes_reprovados(detalhes_lotes_reprovados_snapshot)
    if reprovacao_detalhada_cx > 0:
        # O total do step Reprov. lote passa a ser a soma dos lotes perdidos.
        # Se esse total mudar versus snapshot, o bloco Atraso/Alterações plano
        # absorve o restante para a cascata fechar.
        reprovacao_cx = -abs(reprovacao_detalhada_cx)

    resumo_reprov_snapshot = _resumo_modal_lotes_reprovados(
        detalhes_lotes_reprovados_snapshot,
        reprovacao_cx,
        _to_int((_snapshot_component_row(rows, "REPROV") or {}).get("qtd_lotes")),
    )

    resumo_calendario_snapshot = _snapshot_resumo_horas_calendario(detalhes_calendario_snapshot)
    calendario_cx_original_snapshot = calendario_cx
    if detalhes_calendario_snapshot:
        # Usa a soma dos detalhes corrigidos como fonte do step de calendário.
        # Isso evita manter o sinal errado do componente salvo no snapshot.
        calendario_cx = _round(resumo_calendario_snapshot.get("impacto_liquido_calendario_cx"))

    steps: list[dict[str, Any]] = []
    for row in rows:
        tipo = str(row.get("tipo") or "").strip().lower()
        step_id = _snapshot_step_id(row)
        valor = _round(row.get("valor_cx"))
        if step_id == "reorg-plano":
            valor = calendario_cx
        if step_id == "reprovacao":
            valor = reprovacao_cx
        step: dict[str, Any] = {
            "id": step_id,
            "label": _snapshot_step_label(row),
            "kind": "total" if tipo in {"base", "final"} else "delta",
            "value": valor,
            "tone": ("green" if valor > 0 else "red") if step_id == "reorg-plano" else _snapshot_tone(row),
            "statusCalculo": "snapshot auditado",
            "observacao": row.get("descricao"),
        }

        qtd_lotes = _to_int(row.get("qtd_lotes"))
        if qtd_lotes > 0:
            step["lotes"] = qtd_lotes

        if step["id"] == "reorg-plano":
            step["clickable"] = True
            step["modal"] = {
                "titulo": "Alteração de calendário",
                "delta_cx": valor,
                "descricao": "Snapshot auditado da aba analisehoras: comparação Jan/V3 × Jun/V4 com comentários extraídos das células.",
                "resumo_calendario": {
                    "impacto_bruto_calendario_cx": valor,
                    "qtd_detalhes_total": len(detalhes_calendario_snapshot),
                    **resumo_calendario_snapshot,
                },
                "detalhes_calendario": detalhes_calendario_snapshot,
                "detalhes_url": f"/liberacao-executiva/causas-anuais?ano={ano_ref}&mes_atual={mes_ref}&detalhes=true",
                "leitura": "Mostra só a variação auditada de calendário. O restante do delta fica em atraso produção/rolagem operacional.",
            }

        if step["id"] == "reprovacao":
            step["clickable"] = True
            step["modal"] = {
                "titulo": "Lotes reprovados por qualidade",
                "descricao": "Abertura dos lotes reprovados considerados na disponibilidade anual, cruzando o snapshot auditado com o Monitor de Desvios.",
                "delta_cx": valor,
                "lotes": resumo_reprov_snapshot.get("qtd_lotes") or (qtd_lotes if qtd_lotes > 0 else None),
                "qtd_lotes": resumo_reprov_snapshot.get("qtd_lotes") or (qtd_lotes if qtd_lotes > 0 else None),
                "qtd_ncs": resumo_reprov_snapshot.get("qtd_ncs"),
                "total_caixas": resumo_reprov_snapshot.get("total_caixas"),
                "total_tubetes": resumo_reprov_snapshot.get("total_tubetes"),
                "detalhes_lotes": detalhes_lotes_reprovados_snapshot,
                "lotesReprovados": detalhes_lotes_reprovados_snapshot,
                "detalhes_url": f"/liberacao-executiva/causas-anuais?ano={ano_ref}&mes_atual={mes_ref}&detalhes=true",
                "regra": "lotes únicos reprovados; f_liberacao_exec_lotes_auditoria enriquecida por f_desvios_lotes via lote/lote_original",
            }

        if step["id"] == "atraso-pos-cogtive":
            step["modal"] = {
                "titulo": "Atraso produção / rolagem operacional",
                "delta_disponibilidade_cx": valor,
                "descricao": "Saldo operacional da ponte depois de tirar calendário, qualidade e rendimento. Fechado contra a disponibilidade oficial do Overview.",
                "formula": "delta total - calendário - qualidade - rendimento",
                "detalhes_carregados": bool(detalhes),
            }

        steps.append(step)

    steps, ajuste_conciliacao_cx = _conciliar_waterfall_snapshot_steps(steps, base_cx, final_cx)
    steps = _agrupar_atraso_alteracoes_plano_steps(steps)

    return {
        "ano": ano_ref,
        "mes_atual_usado": mes_ref,
        "dados": {
            "snapshotUsado": True,
            "snapshotId": snapshot_id,
            "snapshotDescricao": rows[0].get("snapshot_descricao"),
            "versaoBase": rows[0].get("versao_base"),
            "versaoAtual": rows[0].get("versao_atual"),
            "plano1LiberacaoCx": _round(plano1_liberacao_cx),
            "estoqueInicialJanCx": estoque_jan_cx,
            "plano1BaseCx": base_cx,
            "planoAtualLiberacaoCx": _round(plano_atual_liberacao_cx),
            "planoAtualOverviewLiberacaoCx": _round(plano_atual_liberacao_cx),
            "planoAtualMrpLiberacaoCx": _round(plano_atual_liberacao_cx),
            "disponibilidadeAtualCx": final_cx,
            "deltaTotalCx": delta_total,
            "atrasoPosCogtiveCx": atraso_cx,
            "atrasoProducaoCx": abs(atraso_cx),
            "lotesAtrasoProducao": _to_int((_snapshot_component_row(rows, "ATRASO") or {}).get("qtd_lotes")),
            "lotesAtrasoProducaoTipo": "lotes/rolagem auditada",
            "perdaReprovacaoCx": abs(reprovacao_cx) if reprovacao_cx < 0 else reprovacao_cx,
            "perdaRendimentoCx": abs(rendimento_cx) if rendimento_cx < 0 else 0,
            "ganhoRendimentoCx": rendimento_cx if rendimento_cx > 0 else 0,
            "reorganizacaoPlanoCx": calendario_cx,
            "reorgPlanoCx": calendario_cx,
            "saldoPonteDiagnosticoCx": ajuste_conciliacao_cx,
            "diferencaNaoClassificadaDebugCx": ajuste_conciliacao_cx,
            "ajusteConciliacaoCx": ajuste_conciliacao_cx,
            "outrosAjustesCx": 0,
            "gapRealizadoVsPlanoCx": 0,
        },
        "steps": steps,
        "modalAtrasoPosCogtive": next((s.get("modal") for s in steps if s.get("id") == "atraso-pos-cogtive"), {}),
        "debug": {
            "fonte": "v_liberacao_exec_snapshot_ativo",
            "snapshot_usado": True,
            "sem_fechamento_escondido": True,
            "delta_total_cx": delta_total,
            "ajuste_conciliacao_cx": ajuste_conciliacao_cx,
            "componentes_snapshot": rows,
            "observacao": "Snapshot auditado usado como fonte de verdade para a reunião. Para calendário, o sinal do detalhe é corrigido no payload porque a auditoria de horas guarda paradas/indisponibilidades e veio com V1/Atual invertidos.",
            "qtd_detalhes_lotes_reprovados": len(detalhes_lotes_reprovados_snapshot),
            "qtd_detalhes_calendario": len(detalhes_calendario_snapshot),
            "calendario_cx_original_snapshot": calendario_cx_original_snapshot,
            "calendario_cx_corrigido_modal": calendario_cx,
            "snapshot_calendario_sinal_corrigido": bool(detalhes_calendario_snapshot),
            "snapshot_fallback_mes_mais_recente": bool(rows[0].get("snapshot_fallback_mes_mais_recente")),
            "mes_snapshot_usado": rows[0].get("mes_ref"),
        },
    }


@router.get("/causas-anuais")
async def get_liberacao_executiva_causas_anuais(
    ano: int | None = Query(default=None),
    mes_atual: int | None = Query(default=None, ge=1, le=12),
    mostrar_nao_classificado: bool = Query(default=False),
    detalhes: bool = Query(default=False),
):
    """
    Causas anuais da Liberação Executiva — regra pós-Cogtive.

    Regra validada:
    - Plano 1: Jan/V3 em f_mrp_etapas por MÊS/ANO LIBERAÇÃO + estoque inicial.
    - Disponibilidade atual: projeção de liberações da Overview + mesmo estoque.
    - A Jun/V4 já carrega o realizado Cogtive e reprograma a fila. Portanto,
      o principal impacto não deve ser chamado de "revisão de mix" pura nem de
      "arraste líquido para 2027".
    - O impacto principal da ponte é:
        plano_atual_liberacao_cx - plano1_liberacao_cx
      exibido como "Atraso produção".
    - O modal comprova esse impacto cruzando Plano Jan/V3 por MÊS PRODUÇÃO
      contra realizado Cogtive/apontamentos.
    - Reprovados/desvios entram como fato operacional separado.
    - Rendimento é fato real vindo da SD3/Rastreamento: perda e ganho ficam
      em steps separados.
    - Reorg. plano fecha a ponte com o efeito líquido de reorganização do plano/calendário
      depois das causas operacionais auditáveis (atraso produção, reprovação e rendimento).
    """
    hoje = date.today()
    ano_ref = ano or hoje.year
    mes_ref = mes_atual or hoje.month

    snapshot_payload = _snapshot_causas_payload(ano_ref, mes_ref, detalhes=detalhes)
    if snapshot_payload is not None:
        return snapshot_payload

    overview_resumo = _safe_overview_resumo()
    overview_payload = _payload_overview(overview_resumo)
    proj_liberacoes_cru = overview_payload.get("projecao_liberacoes") or {}
    disponibilidade_mensal_payload = overview_payload.get("disponibilidade_mensal") or {}
    # Usa a MESMA projeção "oficial" que a Overview mostra na tela (recalculada
    # a partir de disponibilidade_mensal), não o total_projetado cru do cache —
    # ver docstring de _projecao_liberacoes_oficial para o motivo.
    proj_liberacoes = _projecao_liberacoes_oficial(proj_liberacoes_cru, disponibilidade_mensal_payload)

    plano1 = get_liberacao_executiva_plano1(ano_ref)
    plano1_liberacao_cx = _round(plano1.get("plano1LiberacaoCx"))
    estoque_jan_cx = _round(plano1.get("estoqueInicialJanCx"))
    plano1_base_cx = plano1_liberacao_cx + estoque_jan_cx

    # Disponibilidade atual vem da Overview/cache, porque inclui os fatos operacionais
    # já materializados na projeção final.
    plano_atual_overview_liberacao_cx = _round(proj_liberacoes.get("total_projetado"))
    disponibilidade_atual_cx = plano_atual_overview_liberacao_cx + estoque_jan_cx

    # Plano atual MRP/Gantt vem da Jun/V4 e é usado para medir o impacto da
    # reprogramação pós-Cogtive antes de reprovações/rendimento.
    plano_atual_mrp = _plano_atual_mrp_liberacao(ano_ref, mes_ref)
    plano_atual_mrp_liberacao_cx = _round(plano_atual_mrp.get("total_cx"))

    # Fallback operacional só para não zerar a tela se o cache da Overview estiver ausente.
    if plano_atual_overview_liberacao_cx <= 0 and ano_ref == 2026:
        plano_atual_overview_liberacao_cx = 199_793 - estoque_jan_cx
        disponibilidade_atual_cx = plano_atual_overview_liberacao_cx + estoque_jan_cx

    if plano_atual_mrp_liberacao_cx <= 0:
        # Em último caso usa a própria Overview, mas marca no debug.
        plano_atual_mrp_liberacao_cx = plano_atual_overview_liberacao_cx

    oper = _operacional_causas_anuais(ano_ref)
    lotes_oper = oper.get("lotes") or {}
    lotes_reprovados = lotes_oper.get("reprovacao", set()) or set()

    reprovacao = _round(oper.get("reprovacao"))
    perda_rendimento_cache = _round(oper.get("perda_rendimento"))
    ganho_rendimento_cache = _round(oper.get("ganho_rendimento"))

    delta_total = disponibilidade_atual_cx - plano1_base_cx

    # Esse é o impacto principal validado: compara Jan/V3 contra a rodada atual
    # do MRP/Gantt. A Overview final já vem menor porque depois entram
    # reprovações/rendimento; por isso NÃO usamos total_projetado da Overview
    # para este step.
    atraso_pos_cogtive = plano_atual_mrp_liberacao_cx - plano1_liberacao_cx

    # Rendimento NÃO é residual: é fato real da SD3/Rastreamento.
    # IMPORTANTE: Reorg. plano também NÃO pode ser residual/fechamento.
    # O saldo abaixo fica apenas como diagnóstico da ponte. O step de Reorg.
    # plano será calculado pelo calendário real Jan/V3 × rodada atual.
    saldo_ponte_apos_causas_cx = (
        delta_total
        - atraso_pos_cogtive
        + reprovacao
        + perda_rendimento_cache
        - ganho_rendimento_cache
    )

    # Valor provisório apenas para compatibilidade até calcular o calendário.
    reorg_plano_cx = 0

    # IMPORTANTE: os detalhes do modal são pesados porque precisam varrer
    # apontamentos/Cogtive e etapas do MRP. Não calcula no carregamento normal
    # da página para evitar timeout no Fly/Supabase.
    if detalhes:
        gap_realizado = _gap_plano_vs_realizado_envase(ano_ref, mes_ref)
        arraste_2027 = _arraste_2027_por_produto(ano_ref, mes_ref)
    else:
        gap_realizado = {
            "plano_cx": 0,
            "realizado_cx": 0,
            "gap_cx": 0,
            "por_linha": [],
            "por_mes": [],
            "plano": {},
            "realizado": {},
            "regra": "detalhes_desativados_no_carregamento; use detalhes=true",
        }
        arraste_2027 = {
            "arraste_bruto_para_2027_cx": 0,
            "puxada_ou_reducao_2027_cx": 0,
            "arraste_liquido_para_2027_cx": 0,
            "itens": [],
            "regra": "detalhes_desativados_no_carregamento; use detalhes=true",
        }

    # Quantidade de lotes do step de Atraso produção.
    # Como a Jan/V3 pode ter linhas macro ainda sem lote/OP real, usamos
    # "lotes equivalentes": quebra o delta negativo por mês + linha + produto
    # e divide pelo tamanho típico de lote observado no próprio Gantt.
    plano1_rodada_mrp = ((plano1.get("debug") or {}).get("rodada_mrp") or {})
    try:
        lotes_atraso_info = _gantt_lotes_equivalentes_atraso_delta_mensal(
            ano_ref,
            mes_ref,
            plano1_rodada_mrp,
        )
    except Exception as exc:
        lotes_atraso_info = {
            "lotes_atraso_equivalentes": 0,
            "cx_atraso_base_calculo": 0,
            "detalhes": [],
            "qtd_detalhes_total": 0,
            "erro": str(exc),
            "regra": "erro_no_calculo_de_lotes_equivalentes",
        }

    lotes_atraso_producao = _to_int(lotes_atraso_info.get("lotes_atraso_equivalentes"))

    calculo_atraso_producao = {
        "formula": "plano_atual_mrp_liberacao_cx - plano1_liberacao_cx",
        "plano1_liberacao_cx": plano1_liberacao_cx,
        "plano_atual_mrp_liberacao_cx": plano_atual_mrp_liberacao_cx,
        "resultado_cx": _round(atraso_pos_cogtive),
        "formula_com_estoque": "(plano_atual_mrp_liberacao_cx + estoque_inicial_jan_cx) - (plano1_liberacao_cx + estoque_inicial_jan_cx)",
        "plano1_com_estoque_cx": plano1_liberacao_cx + estoque_jan_cx,
        "plano_atual_mrp_com_estoque_cx": plano_atual_mrp_liberacao_cx + estoque_jan_cx,
        "estoque_inicial_jan_cx": estoque_jan_cx,
        "leitura": "O estoque inicial é o mesmo dos dois lados; por isso o delta continua igual.",
    }

    detalhes_lotes_reprovados = _detalhar_lotes_reprovados(lotes=lotes_reprovados, ano=ano_ref)
    detalhes_lotes_reprovados = _fechar_quantidades_lotes_reprovados(
        detalhes_lotes_reprovados,
        ano=ano_ref,
        snapshot_id=None,
        total_oficial_cx=abs(reprovacao),
    )
    qtd_lotes_reprovados_fallback = max(14, len(lotes_reprovados)) if ano_ref == 2026 and reprovacao > 0 else len(lotes_reprovados)
    reprovacao_detalhada_cx = _soma_caixas_lotes_reprovados(detalhes_lotes_reprovados)
    if reprovacao_detalhada_cx > 0:
        # O total de Reprov. lote passa a ser a soma dos lotes detalhados.
        # O restante do delta oficial será absorvido em Atraso produção /
        # Alterações plano pela função de agrupamento da cascata.
        reprovacao = reprovacao_detalhada_cx

    resumo_reprovacao_modal = _resumo_modal_lotes_reprovados(
        detalhes_lotes_reprovados,
        -abs(reprovacao),
        qtd_lotes_reprovados_fallback,
    )

    try:
        reorg_plano_detalhes = _reorg_plano_detalhes_calendario(
            ano_ref,
            mes_ref,
            _round(saldo_ponte_apos_causas_cx),
        )
    except Exception as exc:
        reorg_plano_detalhes = {
            "saldo_liquido_cascata_cx": _round(saldo_ponte_apos_causas_cx),
            "impacto_bruto_calendario_cx": 0,
            "lotes_equivalentes_liquido": 0,
            "lotes_adicionados_equivalentes": 0,
            "lotes_removidos_equivalentes": 0,
            "detalhes": [],
            "erro": str(exc),
            "regra": "erro_no_calculo_de_reorg_plano_detalhado",
        }

    # Reorg. plano deve ser somente o impacto auditável do calendário.
    # Se todas as linhas do modal consomem capacidade, o step precisa ser negativo.
    reorg_plano_cx = _round((reorg_plano_detalhes or {}).get("impacto_bruto_calendario_cx"))
    saldo_ponte_nao_classificado_cx = _round(saldo_ponte_apos_causas_cx - reorg_plano_cx)

    steps: list[dict[str, Any]] = [
        {
            "id": "plano1",
            "label": "Disp. anual orçada",
            "kind": "total",
            "value": plano1_base_cx,
            "tone": "navy",
        }
    ]

    atraso_step = _step_delta(
        "atraso-pos-cogtive",
        "Atraso produção",
        _round(atraso_pos_cogtive),
        "red" if atraso_pos_cogtive < 0 else "green",
        lotes_atraso_producao if lotes_atraso_producao > 0 else None,
        False,
    )
    if atraso_step is not None:
        atraso_step["statusCalculo"] = "auditavel"
        atraso_step["observacao"] = (
            "Diferença entre o Plano 1 Jan/V3 e a rodada atual do MRP/Gantt, ambos por mês/ano de liberação. "
            "A versão atual já considera o realizado Cogtive e reprograma a fila de produção."
        )
        atraso_step["lotesTipo"] = "equivalentes"
        atraso_step["calculo"] = calculo_atraso_producao
        atraso_step["modal"] = {
            "titulo": "Atraso produção",
            "descricao": (
                "O valor é calculado comparando a disponibilidade de liberação do Plano 1 Jan/V3 "
                "com a disponibilidade de liberação da rodada atual do MRP/Gantt. "
                "Como o estoque inicial é igual nos dois cenários, ele não altera o delta."
            ),
            "delta_disponibilidade_cx": _round(atraso_pos_cogtive),
            "lotes_equivalentes": lotes_atraso_producao,
            "lotes_calculo": lotes_atraso_info,
            "calculo_valor": calculo_atraso_producao,
            "detalhes_carregados": bool(detalhes),
            "detalhes_url": f"/liberacao-executiva/causas-anuais?ano={ano_ref}&mes_atual={mes_ref}&detalhes=true",
            "plano_vs_realizado": {
                "plano_jan_v3_ate_mes_cx": _round(gap_realizado.get("plano_cx")),
                "realizado_cogtive_ate_mes_cx": _round(gap_realizado.get("realizado_cx")),
                "gap_realizado_vs_plano_cx": _round(gap_realizado.get("gap_cx")),
                "diferenca_gap_vs_delta_disponibilidade_cx": _round(
                    _to_float(gap_realizado.get("gap_cx")) - _to_float(atraso_pos_cogtive)
                ),
                "data_inicio_realizado": ((gap_realizado.get("realizado") or {}).get("data_inicio")),
                "data_fim_realizado": ((gap_realizado.get("realizado") or {}).get("data_fim")),
                "fonte_realizado": ((gap_realizado.get("realizado") or {}).get("fonte")),
                "por_linha": gap_realizado.get("por_linha") or [],
                "por_mes": gap_realizado.get("por_mes") or [],
            },
            "arraste_2027": arraste_2027,
        }
        steps.append(atraso_step)

    reprov_step = _step_delta(
        "reprovacao",
        "Reprov. lote",
        -abs(reprovacao),
        "orange",
        _to_int(resumo_reprovacao_modal.get("qtd_lotes")),
        True,
    )
    if reprov_step is not None:
        reprov_step["statusCalculo"] = "auditavel"
        reprov_step["observacao"] = "Lotes reprovados/descartados vindos do Rastreamento/Monitor de Desvios."
        reprov_step["modal"] = {
            "titulo": "Lotes reprovados por qualidade",
            "descricao": "Abertura dos lotes reprovados considerados na disponibilidade anual, cruzando os lotes consolidados com o Monitor de Desvios.",
            "delta_cx": -abs(reprovacao),
            "lotes": resumo_reprovacao_modal.get("qtd_lotes"),
            "qtd_lotes": resumo_reprovacao_modal.get("qtd_lotes"),
            "qtd_ncs": resumo_reprovacao_modal.get("qtd_ncs"),
            "total_caixas": resumo_reprovacao_modal.get("total_caixas"),
            "total_tubetes": resumo_reprovacao_modal.get("total_tubetes"),
            "detalhes_lotes": detalhes_lotes_reprovados,
            "lotesReprovados": detalhes_lotes_reprovados,
            "detalhes_url": f"/liberacao-executiva/causas-anuais?ano={ano_ref}&mes_atual={mes_ref}&detalhes=true",
            "regra": "lotes consolidados de reprovação enriquecidos por f_desvios_lotes via lote/lote_original",
        }
        steps.append(reprov_step)

    perda_rend_step = _step_delta(
        "perda-rendimento",
        "Perda rend.",
        -abs(perda_rendimento_cache),
        "gray",
        None,
        False,
    )
    if perda_rend_step is not None:
        perda_rend_step["statusCalculo"] = "auditavel"
        perda_rend_step["observacao"] = (
            "Perda real de rendimento calculada pelo Rastreamento a partir da SD3: "
            "quantidade liberada/real vs quantidade planejada/teórica do lote."
        )
        perda_rend_step["modal"] = {
            "titulo": "Perda real de rendimento",
            "delta_cx": -abs(perda_rendimento_cache),
            "fonte": "rastreamento_lotes_cache / SD3",
            "regra": "soma das perdas reais de rendimento por lote; não é residual",
        }
        steps.append(perda_rend_step)

    ganho_rend_step = _step_delta(
        "ganho-rendimento",
        "Ganho rend.",
        abs(ganho_rendimento_cache),
        "green",
        None,
        False,
    )
    if ganho_rend_step is not None:
        ganho_rend_step["statusCalculo"] = "auditavel"
        ganho_rend_step["observacao"] = (
            "Ganho real de rendimento calculado pelo Rastreamento a partir da SD3: "
            "quantidade liberada/real acima da quantidade planejada/teórica do lote."
        )
        ganho_rend_step["modal"] = {
            "titulo": "Ganho real de rendimento",
            "delta_cx": abs(ganho_rendimento_cache),
            "fonte": "rastreamento_lotes_cache / SD3",
            "regra": "soma dos ganhos reais de rendimento por lote; não é residual",
        }
        steps.append(ganho_rend_step)

    reorg_plano_step = _step_delta(
        "reorg-plano",
        "Reorg. plano",
        _round(reorg_plano_cx),
        "green" if reorg_plano_cx > 0 else "red",
        None,
        True,
    )
    if reorg_plano_step is not None:
        reorg_plano_step["statusCalculo"] = "Jan/V3 × versão atual"
        reorg_plano_step["observacao"] = (
            "Impacto quantificável do calendário salvo no Gantt: paradas/horas adicionadas, "
            "removidas ou alteradas entre Jan/V3 e a rodada atual. Não é saldo residual."
        )
        reorg_plano_step["modal"] = {
            "titulo": "Reorganização do plano",
            "delta_cx": _round(reorg_plano_cx),
            "descricao": (
                "Comparação real do calendário salvo no Gantt: Plano 1 Jan/V3 contra a última versão atual. "
                "A tabela mostra apenas mudanças com impacto real em horas ou caixas; comentário_calendario explica o motivo."
            ),
            "calculo": {
                "formula": "soma do impacto real de horas/disponibilidade do calendário Jan/V3 × Atual",
                "resultado_reorg_plano_cx": _round(reorg_plano_cx),
                "impacto_calendario_cx": _round(reorg_plano_cx),
                "saldo_ponte_diagnostico_cx": _round(saldo_ponte_apos_causas_cx),
                "diferenca_nao_classificada_debug_cx": _round(saldo_ponte_nao_classificado_cx),
            },
            "resumo_calendario": {
                "impacto_bruto_calendario_cx": _round((reorg_plano_detalhes or {}).get("impacto_bruto_calendario_cx")),
                "eventos_capacidade_liberada": _to_int((reorg_plano_detalhes or {}).get("eventos_capacidade_liberada")),
                "eventos_capacidade_consumida": _to_int((reorg_plano_detalhes or {}).get("eventos_capacidade_consumida")),
                "horas_liberadas": _round((reorg_plano_detalhes or {}).get("horas_liberadas")),
                "horas_consumidas": _round((reorg_plano_detalhes or {}).get("horas_consumidas")),
                # campos legados zerados: o modal não deve converter horas parciais em lotes.
                "lotes_adicionados_equivalentes": 0,
                "lotes_removidos_equivalentes": 0,
                "lotes_equivalentes_liquido": 0,
                "lote_tipico_por_linha_cx": (reorg_plano_detalhes or {}).get("lote_tipico_por_linha_cx") or {},
                "qtd_detalhes_total": _to_int((reorg_plano_detalhes or {}).get("qtd_detalhes_total")),
            },
            "detalhes_calendario": (reorg_plano_detalhes or {}).get("detalhes") or [],
            "leitura": "Não é rendimento e não é fechamento residual. O Reorg. plano mostra somente mudanças quantificáveis de calendário/paradas em horas e caixas. Se as horas foram consumidas, o impacto fica negativo.",
        }
        steps.append(reorg_plano_step)

    if mostrar_nao_classificado:
        # Mantido por compatibilidade com diagnóstico. A ponte principal fecha
        # explicitamente em Reorg. plano. Não deve aparecer na tela principal.
        steps.append({
            "id": "nao-classificado-debug",
            "label": "Não classif. debug",
            "kind": "delta",
            "value": 0,
            "tone": "gray",
            "statusCalculo": "diagnostico",
        })

    steps.append({
        "id": "disponibilidade",
        "label": "Disp. atual",
        "kind": "total",
        "value": disponibilidade_atual_cx,
        "tone": "teal",
    })

    steps = _agrupar_atraso_alteracoes_plano_steps(steps)

    return {
        "ano": ano_ref,
        "mes_atual_usado": mes_ref,
        "dados": {
            "plano1LiberacaoCx": plano1_liberacao_cx,
            "estoqueInicialJanCx": estoque_jan_cx,
            "plano1BaseCx": plano1_base_cx,
            "planoAtualLiberacaoCx": plano_atual_overview_liberacao_cx,
            "planoAtualOverviewLiberacaoCx": plano_atual_overview_liberacao_cx,
            "planoAtualMrpLiberacaoCx": plano_atual_mrp_liberacao_cx,
            "disponibilidadeAtualCx": disponibilidade_atual_cx,
            "deltaTotalCx": _round(delta_total),
            "atrasoPosCogtiveCx": _round(atraso_pos_cogtive),
            "lotesAtrasoProducao": lotes_atraso_producao,
            "lotesAtrasoProducaoTipo": "equivalentes",
            "calculoAtrasoProducao": calculo_atraso_producao,
            "perdaReprovacaoCx": reprovacao,
            "perdaRendimentoCx": perda_rendimento_cache,
            "ganhoRendimentoCx": ganho_rendimento_cache,
            "reorganizacaoPlanoCx": _round(reorg_plano_cx),
            "reorgPlanoCx": _round(reorg_plano_cx),
            "saldoPonteDiagnosticoCx": _round(saldo_ponte_apos_causas_cx),
            "diferencaNaoClassificadaDebugCx": _round(saldo_ponte_nao_classificado_cx),
            "ajusteConciliacaoCx": 0,
            "outrosAjustesCx": 0,
            "gapRealizadoVsPlanoCx": _round(gap_realizado.get("gap_cx")),
        },
        "steps": steps,
        "modalAtrasoPosCogtive": atraso_step.get("modal") if atraso_step else {},
        "debug": {
            "regra_principal": "Ponte anual com causas auditáveis. Reorg. plano não fecha residual; é somente impacto real de calendário.",
            "detalhes_carregados": bool(detalhes),
            "sem_fechamento_escondido": True,
            "delta_total_cx": _round(delta_total),
            "calculo_reorg_plano": {
                "formula": "impacto_calendario_real_cx",
                "impacto_calendario_real_cx": _round(reorg_plano_cx),
                "saldo_ponte_diagnostico_cx": _round(saldo_ponte_apos_causas_cx),
                "diferenca_nao_classificada_debug_cx": _round(saldo_ponte_nao_classificado_cx),
                "leitura": "Reorg. plano não é residual. Se o calendário só consome horas, o valor deve ser negativo.",
            },
            "plano1_usado": plano1,
            "plano_atual_mrp_usado_no_step": plano_atual_mrp,
            "calculo_atraso_producao": calculo_atraso_producao,
            "lotes_atraso_producao": lotes_atraso_info,
            "gap_plano_vs_realizado_envase": gap_realizado,
            "arraste_2027_auxiliar": arraste_2027,
            "operacional": {
                "reprovacao": reprovacao,
                "reprovacao_lotes": max(14, len(lotes_reprovados)) if ano_ref == 2026 and reprovacao > 0 else len(lotes_reprovados),
                "perda_rendimento_cache": perda_rendimento_cache,
                "ganho_rendimento_cache": ganho_rendimento_cache,
                "meses_lidos": oper.get("meses_lidos"),
            },
            "observacao": (
                "O arraste líquido para 2027 é só leitura auxiliar. O atraso real acumulado aparece "
                "principalmente como reprogramação da fila na Jun/V4, porque ela já considera o Cogtive."
            ),
        },
    }



def _valor_mes_dict(dados: dict[str, Any] | None, mes: int) -> int:
    """Lê valor mensal de um dicionário com chave 1/"1"/"01"."""
    if not isinstance(dados, dict):
        return 0
    for chave in (str(mes), mes, f"{mes:02d}"):
        if chave in dados:
            return _round(dados.get(chave))
    return 0


def _plano_referencia_mensal_liberacao(ano: int) -> dict[int, dict[str, Any]]:
    """
    Referência mensal para o gráfico inferior da Liberação Executiva.

    Regra solicitada:
    - Janeiro compara contra Jan/V3;
    - Fev-Dez comparam contra V1 do próprio mês.

    Esta função não altera a cascata anual nem os racionais das causas. Ela só
    cria a base mensal para responder: quanto estamos abaixo/acima do plano de
    referência de cada mês.
    """
    chave = f"plano-referencia-mensal-liberacao:v1:{ano}"
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    out: dict[int, dict[str, Any]] = {}

    for mes in range(1, 13):
        versao_ref = 3 if mes == 1 else 1
        baseline = f"{MES_LABELS[mes - 1]}/V{versao_ref}"

        try:
            diag = _total_rodada_por_mes_liberacao(ano, mes, versao_ref)
        except Exception as exc:
            diag = {
                "total_cx": 0,
                "totais_por_mes": {},
                "rodada": None,
                "erro": str(exc),
                "fonte": "erro_total_rodada_por_mes_liberacao",
            }

        valor_mes = _valor_mes_dict(diag.get("totais_por_mes") or {}, mes)

        # Fallback defensivo: para janeiro, se por algum motivo a quebra mensal
        # não vier, tenta usar o cache de rastreamento. Não usa o total anual
        # Jan/V3 como mês, porque isso inflaria janeiro.
        if valor_mes <= 0:
            rast = _safe_rastreamento_cache(mes, ano)
            valor_mes = _round(rast.get("mes_cx_previsto_v1") or rast.get("total_cx_previsto"))

        out[mes] = {
            "mes": mes,
            "baseline": baseline,
            "plano_ref_cx": valor_mes,
            "versao_ref": versao_ref,
            "rodada": diag.get("rodada"),
            "fonte": diag.get("fonte"),
            "erro": diag.get("erro"),
        }

    return _cache_set(chave, out, ttl=1800)


def _plano_atual_liberacao_por_mes(ano: int, mes_ref: int) -> dict[int, int]:
    """
    Plano/liberação atual por mês, usando a mesma base MRP/Gantt já existente.
    Usado apenas no gráfico mensal, principalmente para meses futuros.
    """
    try:
        atual = _plano_atual_mrp_liberacao(ano, mes_ref)
        totais = atual.get("totais_por_mes") or {}
    except Exception:
        totais = {}

    return {mes: _valor_mes_dict(totais, mes) for mes in range(1, 13)}


def _reprovacao_oficial_por_mes_liberacao(ano: int, snapshot_id: str | None = None) -> dict[int, int]:
    """Soma a reprovação mensal usando a mesma regra do modal anual.

    Regra validada pelo PCP:
    - o lote reprovado entra no mês em que seria liberado no Gantt/MPS;
    - quantidade = SD3 quando o lote existir na SD3; senão Gantt/MPS QTD. Tubetes / 500;
    - se no Gantt o lote foi deixado como 1 cx só para não contar disponibilidade,
      usa 600 cx para medir a perda real por lote;
    - não soma versões do mesmo lote.
    """
    try:
        detalhes = _detalhar_lotes_reprovados(snapshot_id=snapshot_id, ano=ano, limit=1000)
        detalhes = _fechar_quantidades_lotes_reprovados(
            detalhes,
            ano=ano,
            snapshot_id=snapshot_id,
            total_oficial_cx=None,
        )
    except Exception:
        return {}

    por_mes: dict[int, float] = {}
    vistos: set[str] = set()

    for item in detalhes or []:
        lote = _normalizar_lote_desvio(item.get("lote"))
        if not lote or lote in vistos:
            continue
        vistos.add(lote)

        mes_lib = _to_int(item.get("mes_liberacao"))
        ano_lib = _to_int(item.get("ano_liberacao"), ano)

        # Último fallback operacional: se por algum motivo o Gantt não trouxe
        # mês de liberação, usa o mês embutido no lote (YYMM...) apenas para não
        # esconder a reprovação do gráfico. Quando o Gantt existir, ele sempre prevalece.
        if (not mes_lib or not (1 <= mes_lib <= 12)) and lote and len(lote) >= 4:
            try:
                yy = int(lote[:2])
                mm = int(lote[2:4])
                if 1 <= mm <= 12:
                    mes_lib = mm
                    ano_lib = 2000 + yy
                    item["mes_liberacao_fallback_lote"] = True
            except Exception:
                pass

        if ano_lib != ano or not mes_lib or not (1 <= mes_lib <= 12):
            continue

        qtd_cx = _round(item.get("qtd_perda_cx") or item.get("qtd_cx") or item.get("caixas"))
        if qtd_cx <= 0:
            continue
        por_mes[mes_lib] = por_mes.get(mes_lib, 0.0) + qtd_cx

    return {mes: _round(valor) for mes, valor in por_mes.items()}


def _snapshot_reprovacao_por_mes(snapshot_id: str, ano: int) -> dict[int, int]:
    """
    Lotes reprovados/descartados por mês de liberação no snapshot auditado.

    Se um lote liberado foi reprovado, ele não deve contar como liberação válida
    no gráfico mensal. Deduplica por lote para não duplicar lote presente em mais
    de uma versão.
    """
    if not snapshot_id:
        return {}

    try:
        rows = _select_all(
            supabase.table("f_liberacao_exec_lotes_auditoria")
            .select("*")
            .eq("snapshot_id", snapshot_id)
            .eq("reprovado_qualidade", True)
        )
    except Exception:
        return {}

    por_mes: dict[int, float] = {}
    vistos: set[str] = set()

    for row in rows:
        if not isinstance(row, dict):
            continue
        lote = str(row.get("lote") or row.get("id") or "").strip().upper()
        if not lote or lote in vistos:
            continue
        vistos.add(lote)

        ano_lib = _to_int(row.get("ano_liberacao"), ano)
        mes_lib = _to_int(row.get("mes_liberacao"))
        if ano_lib != ano or not (1 <= mes_lib <= 12):
            continue

        por_mes[mes_lib] = por_mes.get(mes_lib, 0.0) + _to_float(row.get("qtd_cx"))

    return {mes: _round(valor) for mes, valor in por_mes.items()}


def _reprovacao_mes_fallback_rastreamento(rastreamento: dict[str, Any]) -> int:
    causas = rastreamento.get("mes_perdas_vs_v1_por_causa") or {}
    candidatos = [
        rastreamento.get("mes_cx_desconto_reprovacao_plano_atual"),
        causas.get("reprovacao_desvio"),
        rastreamento.get("total_cx_desvio"),
        rastreamento.get("mtd_cx_desvio"),
    ]
    for valor in candidatos:
        qtd = abs(_round(valor))
        if qtd > 0:
            return qtd
    return 0


def _atraso_alteracoes_mes_rastreamento(rastreamento: dict[str, Any]) -> int:
    """
    Lê a abertura mensal já calculada pelo Rastreamento/Overview para o bloco
    Atraso produção / Alterações plano.

    O gráfico mensal tinha voltado a ficar quase só com Reprovação porque usava
    apenas o residual líquido vs plano. Quando a liberação bruta do mês compensava
    parte da reprovação, o residual ficava zero e o azul sumia, mesmo existindo
    atraso/reprogramação na abertura por causa do próprio Rastreamento.

    Aqui mantemos a regra validada: Reorg./alterações, atraso e saldo operacional
    ficam agrupados no azul; Reprovação fica separada no vermelho. Não inclui
    rendimento, porque rendimento já está fora do gráfico mensal.
    """
    if not isinstance(rastreamento, dict) or not rastreamento:
        return 0

    causas = rastreamento.get("mes_perdas_vs_v1_por_causa") or {}

    candidatos = [
        causas.get("atraso_producao"),
        causas.get("atraso"),
        causas.get("reprogramacao"),
        causas.get("reprogramação"),
        causas.get("reorg"),
        causas.get("reorganizacao"),
        causas.get("reorganização"),
        causas.get("alteracao_plano"),
        causas.get("alteração_plano"),
        rastreamento.get("mes_cx_atraso_producao"),
        rastreamento.get("mes_cx_atraso"),
        rastreamento.get("mes_cx_reprogramado"),
        rastreamento.get("mes_cx_reprogramacao"),
        rastreamento.get("mes_cx_reprogramação"),
    ]

    total = 0
    for valor in candidatos:
        qtd = abs(_round(valor))
        if qtd > 0:
            total += qtd

    return _round(total)


def _liberacao_bruta_mes_para_grafico(
    mes: int,
    mes_ref: int,
    rastreamento: dict[str, Any],
    plano_atual_por_mes: dict[int, int],
) -> int:
    """
    Valor bruto antes de descontar reprovação para o gráfico mensal.

    - meses fechados: usa realizado/liberado real do rastreamento/SD3;
    - mês atual: usa tendência/plano atual quando existir, senão realizado;
    - meses futuros: usa plano atual MRP/Gantt por mês.
    """
    if mes < mes_ref:
        for campo in (
            "mes_cx_realizado",
            "total_cx_sd3_mes",
            "total_cx_liberado",
            "mes_cx_plano_atual_tendencia",
            "mes_cx_reconciliado_v1",
        ):
            qtd = _round(rastreamento.get(campo))
            if qtd > 0:
                return qtd
        return _round(plano_atual_por_mes.get(mes))

    if mes == mes_ref:
        for campo in (
            "mes_cx_plano_atual_tendencia",
            "mes_cx_reconciliado_v1",
            "mes_cx_realizado",
            "total_cx_sd3_mes",
            "total_cx_liberado",
        ):
            qtd = _round(rastreamento.get(campo))
            if qtd > 0:
                return qtd
        return _round(plano_atual_por_mes.get(mes))

    return _round(plano_atual_por_mes.get(mes))


def _montar_perdas_mensais_vs_plano_ref(
    ano: int,
    mes_ref: int,
    rastreamento_mes_ref: dict[str, Any],
    snapshot_id: str | None = None,
) -> list[dict[str, Any]]:
    """
    Gráfico mensal de causas das perdas vs plano de referência.

    Regra executiva validada:
    - Janeiro compara contra Jan/V3; Fev-Dez contra V1 do próprio mês;
    - Meses fechados usam a abertura mensal já salva no Rastreamento/Overview;
    - Mês atual usa MTD/tendência do Rastreamento;
    - Meses futuros ficam vazios até haver simulação;
    - Azul = Atraso produção / Alterações plano;
    - Vermelho = Reprovação por lote;
    - Rendimento fica fora deste gráfico.
    """
    refs = _plano_referencia_mensal_liberacao(ano)
    plano_atual_por_mes = _plano_atual_liberacao_por_mes(ano, mes_ref)
    reprov_oficial_por_mes = _reprovacao_oficial_por_mes_liberacao(ano, str(snapshot_id or "") or None)
    reprov_snapshot = _snapshot_reprovacao_por_mes(str(snapshot_id or ""), ano)

    perdas: list[dict[str, Any]] = []

    for mes in range(1, 13):
        ref = refs.get(mes) or {}
        plano_ref_cx = _round(ref.get("plano_ref_cx"))
        baseline = str(ref.get("baseline") or f"{MES_LABELS[mes - 1]}/V{3 if mes == 1 else 1}")

        if mes <= mes_ref:
            rast = rastreamento_mes_ref if mes == mes_ref else _safe_rastreamento_cache(mes, ano)
        else:
            rast = {}

        liberado_bruto_cx = _liberacao_bruta_mes_para_grafico(mes, mes_ref, rast, plano_atual_por_mes)
        reprovado_cx = _round(reprov_oficial_por_mes.get(mes))
        if reprovado_cx <= 0:
            reprovado_cx = _round(reprov_snapshot.get(mes))
        if reprovado_cx <= 0 and mes <= mes_ref:
            reprovado_cx = _reprovacao_mes_fallback_rastreamento(rast)

        liberado_valido_cx = max(0, liberado_bruto_cx - reprovado_cx)
        saldo_vs_ref_cx = liberado_valido_cx - plano_ref_cx
        perda_cx = max(0, -saldo_vs_ref_cx)
        ganho_cx = max(0, saldo_vs_ref_cx)

        if mes < mes_ref:
            status = "fechado"
        elif mes == mes_ref:
            status = "mtd"
        else:
            status = "futuro"

        # Para meses futuros, a tela deve ficar limpa; valores simulados entram
        # pelo front. Não mostra causa real sem mês fechado/MTD.
        if status == "futuro":
            reprovacao_segmento_cx = 0
            atraso_rastreamento_cx = 0
            atraso_residual_cx = 0
            atraso_alteracoes_cx = 0
            perda_classificada_cx = 0
            pct_vs_ref = 0.0
        else:
            # Reprovação usa a regra oficial dos lotes por mês de liberação.
            reprovacao_segmento_cx = max(0, reprovado_cx)

            # Abertura azul vem primeiro do Rastreamento/Overview, que já
            # classifica Atraso/Reorg./Alterações do mês. Como proteção, mantém
            # o residual líquido caso o Rastreamento ainda não tenha a causa.
            atraso_rastreamento_cx = _atraso_alteracoes_mes_rastreamento(rast)
            atraso_residual_cx = max(0, perda_cx - reprovacao_segmento_cx)
            atraso_alteracoes_cx = max(atraso_rastreamento_cx, atraso_residual_cx)

            perda_classificada_cx = atraso_alteracoes_cx + reprovacao_segmento_cx
            pct_vs_ref = round((perda_classificada_cx / plano_ref_cx) * 100, 1) if plano_ref_cx > 0 else 0.0

        perdas.append({
            "mes": MES_LABELS[mes - 1],
            "mes_num": mes,
            "baseline": baseline,
            "v1": plano_ref_cx,
            "planoRefCx": plano_ref_cx,
            "liberadoBrutoCx": liberado_bruto_cx,
            "reprovadoCx": reprovado_cx,
            "liberadoValidoCx": liberado_valido_cx,
            "saldoVsPlanoCx": saldo_vs_ref_cx,
            "perdaCx": perda_cx,
            "ganhoCx": ganho_cx,
            "pctPerdaVsPlano": pct_vs_ref,
            "perdaClassificadaCx": perda_classificada_cx,
            "atraso": atraso_alteracoes_cx,
            "reorg": 0,
            "reprovacao": reprovacao_segmento_cx,
            "saldo": 0,
            "status": status,
            "regra": "Reprovação mensal = regra oficial dos lotes por mês de liberação; Atraso/Alterações = abertura mensal do Rastreamento/Overview com fallback residual",
            "tooltip": {
                "referencia": baseline,
                "plano_ref_cx": plano_ref_cx,
                "liberado_bruto_cx": liberado_bruto_cx,
                "reprovado_descontado_cx": reprovado_cx,
                "reprovacao_oficial_mes_liberacao_cx": reprovacao_segmento_cx,
                "atraso_alteracoes_plano_cx": atraso_alteracoes_cx,
                "atraso_alteracoes_rastreamento_cx": atraso_rastreamento_cx,
                "atraso_alteracoes_residual_cx": atraso_residual_cx,
                "liberado_valido_cx": liberado_valido_cx,
                "perda_vs_plano_cx": perda_cx,
                "perda_classificada_cx": perda_classificada_cx,
                "ganho_vs_plano_cx": ganho_cx,
            },
        })

    return perdas


@router.get("/resumo")
async def get_liberacao_executiva_resumo(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None, ge=1, le=12),
    force: bool = Query(default=False),
):
    hoje = date.today()
    ano_ref = ano or hoje.year
    mes_ref = mes or hoje.month
    chave = f"resumo:v26-causas-mensais-rastreamento:{ano_ref}:{mes_ref}"

    if not force:
        cached = _cache_get(chave)
        if cached is not None:
            return cached

    overview_resumo = _safe_overview_resumo()
    overview_payload = _payload_overview(overview_resumo)

    if not overview_payload:
        return {
            "erro": overview_resumo.get("erro") or "overview_cache_indisponivel",
            "mensagem": "Não encontrei o snapshot da Overview em cache_overview. Abra/recalcule a Overview antes de carregar esta página.",
            "ano": ano_ref,
            "mes": mes_ref,
            "atualizadoLabel": None,
            "dados": None,
            "waterfallSteps": [],
            "perdasMensais": [],
            "ponteVersoesSteps": [],
            "itensReorganizacao": [],
            "debug": {"fonte": "overview._read_cache_overview"},
        }

    # Fonte de verdade dos cards: mesmo snapshot usado na página Overview.
    # Não chama endpoints pesados aqui. Se o snapshot estiver incompleto,
    # retorna erro rápido em vez de travar a tela.
    orcado_faturamento = overview_payload.get("orcado_faturamento") or {}
    proj_faturamento = overview_payload.get("projecao_faturamento") or {}
    proj_liberacoes = overview_payload.get("projecao_liberacoes") or {}
    orcado_liberacao = overview_payload.get("orcado_liberacao") or {}

    campos_obrigatorios = {
        "orcado_faturamento": orcado_faturamento,
        "projecao_faturamento": proj_faturamento,
        "projecao_liberacoes": proj_liberacoes,
    }
    faltantes = [nome for nome, valor in campos_obrigatorios.items() if not isinstance(valor, dict) or not valor]
    if faltantes:
        return {
            "erro": "overview_cache_incompleto",
            "mensagem": f"Snapshot da Overview incompleto. Campos ausentes: {', '.join(faltantes)}.",
            "ano": ano_ref,
            "mes": mes_ref,
            "atualizadoLabel": None,
            "dados": None,
            "waterfallSteps": [],
            "perdasMensais": [],
            "ponteVersoesSteps": [],
            "itensReorganizacao": [],
            "debug": {
                "fonte": "overview._read_cache_overview",
                "faltantes": faltantes,
            },
        }

    rastreamento_mes = _safe_rastreamento_cache(mes_ref, ano_ref)

    orcado_faturamento_cx = _round(orcado_faturamento.get("total_caixas"))
    faturamento_projetado_cx = _round(proj_faturamento.get("total_projetado"))
    estoque_jan_cx = _estoque_inicial_jan(ano_ref)

    # Disponibilidade atual PRECISA casar com a Overview:
    # disponibilidade = liberações reais + previstas da Overview + estoque inicial Jan.
    plano_atual_liberacao_cx = _round(proj_liberacoes.get("total_projetado"))
    disponibilidade_atual_cx = plano_atual_liberacao_cx + estoque_jan_cx

    # Disponibilidade anual orçada:
    # usa o mesmo orçado/liberação já materializado na Overview.
    # A ponte de versões real será otimizada separadamente; não consultar f_mrp_etapas
    # aqui para não travar a abertura da página.
    plano1_liberacao_cx = _round(orcado_liberacao.get("total_caixas") or proj_liberacoes.get("total_orcado"))

    plano1_base_cx = plano1_liberacao_cx + estoque_jan_cx
    causas = _causas_anuais(plano1_base_cx, disponibilidade_atual_cx, rastreamento_mes)
    lotes_causa = _lotes_por_causa_rastreamento(rastreamento_mes)
    ponte_steps: list[dict[str, Any]] = []
    lotes_reorg = 0

    waterfall_steps = [
        {"id": "plano1", "label": "Disp. anual orçada", "kind": "total", "value": plano1_base_cx, "tone": "navy"},
        _with_lotes({"id": "reorganizacao", "label": "Reorg.", "kind": "delta", "value": causas["reorg"], "tone": "slate", "clickable": True}, lotes_reorg),
        _with_lotes({"id": "atraso", "label": "Atraso prod.", "kind": "delta", "value": -causas["atraso"], "tone": "red"}, lotes_causa.get("atraso")),
        _with_lotes({"id": "reprovacao", "label": "Reprov. lote", "kind": "delta", "value": -causas["reprovacao"], "tone": "orange"}, lotes_causa.get("reprovacao")),
        _with_lotes({"id": "rendimento", "label": "Perda rend.", "kind": "delta", "value": -causas["perda_rendimento"], "tone": "gray"}, lotes_causa.get("perda_rendimento")),
        _with_lotes({"id": "ganho", "label": "Ganho rend.", "kind": "delta", "value": causas["ganho_rendimento"], "tone": "green"}, lotes_causa.get("ganho_rendimento")),
        {"id": "disponibilidade", "label": "Disp. atual", "kind": "total", "value": disponibilidade_atual_cx, "tone": "teal"},
    ]

    # Mantém compatibilidade com o front que ainda consome /resumo, mas troca
    # a cascata antiga pela regra anual validada em /causas-anuais.
    causas_anuais_payload: dict[str, Any] = {}
    try:
        causas_anuais_payload = await get_liberacao_executiva_causas_anuais(
            ano=ano_ref,
            mes_atual=mes_ref,
            mostrar_nao_classificado=False,
            detalhes=False,
        )
        if isinstance(causas_anuais_payload, dict) and causas_anuais_payload.get("steps"):
            waterfall_steps = causas_anuais_payload.get("steps") or waterfall_steps
    except Exception as exc:
        causas_anuais_payload = {"erro": str(exc)}


    dados_causas_anuais = (causas_anuais_payload.get("dados") or {}) if isinstance(causas_anuais_payload, dict) else {}
    if dados_causas_anuais.get("snapshotUsado"):
        # Quando existe snapshot auditado, os cards e a cascata da Liberação
        # Executiva precisam fechar exatamente contra ele/Overview.
        plano1_base_cx = _round(dados_causas_anuais.get("plano1BaseCx")) or plano1_base_cx
        disponibilidade_atual_cx = _round(dados_causas_anuais.get("disponibilidadeAtualCx")) or disponibilidade_atual_cx
        plano1_liberacao_cx = _round(dados_causas_anuais.get("plano1LiberacaoCx")) or plano1_liberacao_cx
        plano_atual_liberacao_cx = _round(dados_causas_anuais.get("planoAtualLiberacaoCx")) or plano_atual_liberacao_cx

    # Gráfico mensal simplificado para simulação:
    # não abre por causa; compara cada mês contra seu plano de referência.
    # Jan usa Jan/V3; demais meses usam V1 do próprio mês.
    # Lotes reprovados/descartados não contam como liberação válida.
    perdas_mensais = _montar_perdas_mensais_vs_plano_ref(
        ano=ano_ref,
        mes_ref=mes_ref,
        rastreamento_mes_ref=rastreamento_mes,
        snapshot_id=dados_causas_anuais.get("snapshotId"),
    )

    payload = {
        "ano": ano_ref,
        "mes": mes_ref,
        "atualizadoLabel": _formatar_data_hora(overview_resumo.get("ultima_atualizacao") or overview_resumo.get("atualizado_em")) or _updated_label(),
        "dados": {
            "orcadoFaturamentoCx": orcado_faturamento_cx,
            "faturamentoProjetadoCx": faturamento_projetado_cx,
            "plano1LiberacaoCx": plano1_liberacao_cx,
            "planoAtualLiberacaoCx": plano_atual_liberacao_cx,
            "estoqueInicialJanCx": estoque_jan_cx,
            "snapshotUsado": bool(dados_causas_anuais.get("snapshotUsado")),
            "snapshotId": dados_causas_anuais.get("snapshotId"),
            "reorganizacaoPlanoCx": _round(dados_causas_anuais.get("reorganizacaoPlanoCx")) if dados_causas_anuais else causas["reorg"],
            "atrasoProducaoCx": _round(dados_causas_anuais.get("atrasoProducaoCx")) if dados_causas_anuais else causas["atraso"],
            "perdaReprovacaoCx": _round(dados_causas_anuais.get("perdaReprovacaoCx")) if dados_causas_anuais else causas["reprovacao"],
            "perdaRendimentoCx": _round(dados_causas_anuais.get("perdaRendimentoCx")) if dados_causas_anuais else causas["perda_rendimento"],
            "ganhoRendimentoCx": _round(dados_causas_anuais.get("ganhoRendimentoCx")) if dados_causas_anuais else causas["ganho_rendimento"],
            "atrasoPosCogtiveCx": _round(dados_causas_anuais.get("atrasoPosCogtiveCx")),
            "lotesAtrasoProducao": _to_int(dados_causas_anuais.get("lotesAtrasoProducao")),
            "lotesAtrasoProducaoTipo": dados_causas_anuais.get("lotesAtrasoProducaoTipo"),
            "calculoAtrasoProducao": dados_causas_anuais.get("calculoAtrasoProducao"),
            "outrosAjustesCx": _round(dados_causas_anuais.get("outrosAjustesCx")),
            "gapRealizadoVsPlanoCx": _round(dados_causas_anuais.get("gapRealizadoVsPlanoCx")),
        },
        "waterfallSteps": waterfall_steps,
        "perdasMensais": perdas_mensais,
        "ponteVersoesSteps": ponte_steps,
        "itensReorganizacao": [],
        "debug": {
            "fonte_orcado_faturamento": "overview/resumo.payload.orcado_faturamento",
            "fonte_faturamento_projetado": "overview/resumo.payload.projecao_faturamento",
            "fonte_liberacoes": "overview/resumo.payload.projecao_liberacoes",
            "fonte_rastreamento_mes": "overview/rastreamento-lotes-cache direto",
            "fonte_versoes": "desativado temporariamente no endpoint rapido; proxima etapa otimizar consulta MPS",
            "lotes_por_causa": lotes_causa,
            "overview_cache_atual": overview_resumo.get("cache_atual"),
            "overview_from_cache": overview_resumo.get("from_cache"),
            "reprovacao_oficial_por_mes_liberacao": _reprovacao_oficial_por_mes_liberacao(ano_ref, dados_causas_anuais.get("snapshotId")),
            "observacao": "Endpoint rápido: cards usam cache da Overview/Rastreamento. Waterfall anual usa /causas-anuais com regra pós-Cogtive. Perdas mensais usam reprovação oficial por mês de liberação do Gantt/MPS e atraso/alterações como residual.",
            "causas_anuais_resumo": {
                "dados": (causas_anuais_payload.get("dados") or {}) if isinstance(causas_anuais_payload, dict) else {},
                "erro": causas_anuais_payload.get("erro") if isinstance(causas_anuais_payload, dict) else None,
            },
        },
    }

    return _cache_set(chave, payload)