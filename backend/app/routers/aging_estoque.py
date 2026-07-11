from fastapi import APIRouter, HTTPException, Query
from app.database import supabase
from typing import Any, Dict, List, Optional, Tuple
from math import ceil
from collections import defaultdict
from threading import Lock
import calendar
import time
import re
import unicodedata
from datetime import date, datetime, timedelta

router = APIRouter(prefix="/aging-estoque", tags=["aging-estoque"])

VERSAO_AGING_ESTOQUE = "debug_2026_07_08_v30_busca_insumo_previsao_mes_mps_bom"

# Tipos usados para separar produto acabado/revenda de componente operacional da BOM.
# Importante para Gestão de Estoque:
# - ativo_analise controla a lista oficial de PA/MR/PPS;
# - componente vindo da BOM deve entrar como insumo mesmo se ativo_analise=False;
# - quando d_produtos divergir da BOM (ex.: 71991 cadastrado como PI, mas BOM tp=MP),
#   a visão de Insumos deve usar o tipo da BOM para não excluir o componente.
TIPOS_PRODUTO_ACABADO_ESTOQUE = {"PA", "MR", "PPS", "PV", "PA/MR"}
TIPOS_COMPONENTE_BOM_CONSUMIVEL = {"MP", "ME", "MI", "MC", "MP/ME"}
TIPOS_INTERMEDIARIO_BOM = {"PI", "SEMI", "INTERMEDIARIO", "INTERMEDIÁRIO"}


# Cache curto em memória para a base pesada da Gestão de Estoque.
# Sem isso, cada filtro/troca de página refaz leitura de consumo, d_produtos,
# SB8, compras, MPS/Gantt, BOM, custos e faturamento.
BUILD_BASE_CACHE_TTL_SECONDS = 12 * 60 * 60
# Proteção contra tempestade de refresh.
# O front atual envia force_refresh=true em várias chamadas paralelas
# (/resumo, /itens, /serie e filtros). Se o backend obedecer literalmente,
# cada chamada reconstrói a base pesada e a Machine do Fly bate 50 conexões.
# Como a chave do cache já muda quando há novo upload/snapshot, o refresh manual
# não precisa reconstruir várias vezes seguidas com a mesma chave.
FORCE_REFRESH_COOLDOWN_SECONDS = 3 * 60
SERIE_PRODUTOS_CACHE_TTL_SECONDS = 15 * 60

# Limites defensivos para evitar que chamadas legadas do front derrubem o back.
# O front antigo dispara /itens?escopo=todos&page_size=5000 com force_refresh=true.
# Para a tabela operacional, 500 linhas por resposta já é mais do que suficiente
# e evita segurar conexões no Fly por vários minutos.
MAX_PAGE_SIZE_TABELA = 500
BULK_TODOS_PAGE_SIZE_LIMITE = 1000
_BUILD_BASE_CACHE: Dict[str, Any] = {
    "key": None,
    "created_at": 0.0,
    "data": None,
}

_BUILD_BASE_CACHE_LOCK = Lock()

# Entrada prevista específica do Benzotop 30G.
# A liberação do item 52749 vem da planilha CAPACIDADE X FORECAST BENZOTOP,
# salva em f_benzotop_liberacao; não vem de compra nem do MPS genérico.
BENZOTOP_LIBERACAO_CODIGO_PA = "52749"
BENZOTOP_LIBERACAO_DESCRICAO_PA = "BENZOTOP - T.FRUTTI 30G"


_SERIE_PRODUTOS_CACHE: Dict[str, Any] = {
    "key": None,
    "created_at": 0.0,
    "data": None,
}
_SERIE_PRODUTOS_CACHE_LOCK = Lock()


# V_perf_2026_07_08: cache curto para as linhas cruas de d_bom_estrutura.
# Antes, _buscar_bom_filhos() e _buscar_componentes_bom_info() refaziam a
# consulta completa na tabela toda vez que eram chamadas — e cada requisição
# de /aging-estoque/itens chama essas funções (via _explodir_forecast_multinivel)
# até 4 vezes. Com a BOM pequena isso passava despercebido; com o upload novo
# de PPS (tabela quase triplicou), virou 4 buscas completas + reprocessamento
# redundante dentro da mesma chamada. Este cache elimina a repetição sem mudar
# o resultado: TTL curto o suficiente para refletir uploads novos rapidamente.
BOM_ESTRUTURA_RAW_CACHE_TTL_SECONDS = 5 * 60
_BOM_ESTRUTURA_RAW_CACHE: Dict[str, Any] = {
    "key": "bom_estrutura_raw",
    "created_at": 0.0,
    "data": None,
}
_BOM_ESTRUTURA_RAW_CACHE_LOCK = Lock()


def _buscar_bom_estrutura_rows_raw() -> List[Dict[str, Any]]:
    """Retorna as linhas cruas de d_bom_estrutura, com cache curto em memória
    compartilhado entre _buscar_bom_filhos() e _buscar_componentes_bom_info()."""
    cache_key = "bom_estrutura_raw"

    if _cache_simples_valido(_BOM_ESTRUTURA_RAW_CACHE, cache_key, BOM_ESTRUTURA_RAW_CACHE_TTL_SECONDS):
        return _BOM_ESTRUTURA_RAW_CACHE.get("data") or []

    with _BOM_ESTRUTURA_RAW_CACHE_LOCK:
        if _cache_simples_valido(_BOM_ESTRUTURA_RAW_CACHE, cache_key, BOM_ESTRUTURA_RAW_CACHE_TTL_SECONDS):
            return _BOM_ESTRUTURA_RAW_CACHE.get("data") or []

        try:
            rows = _select_all(
                supabase.table("d_bom_estrutura")
                .select("codigo_pai, codigo_comp, descricao_comp, tp, tipo_pai, descricao_pai, quantidade")
            )
        except Exception:
            rows = []

        _BOM_ESTRUTURA_RAW_CACHE["key"] = cache_key
        _BOM_ESTRUTURA_RAW_CACHE["created_at"] = time.time()
        _BOM_ESTRUTURA_RAW_CACHE["data"] = rows

        return rows


def _cache_base_valido(
    cached_data: Any,
    cached_key: Any,
    cache_key: str,
    cached_at: Any,
    now: Optional[float] = None,
    force_refresh: bool = False,
    ttl_seconds: int = BUILD_BASE_CACHE_TTL_SECONDS,
) -> bool:
    """
    Decide se pode reaproveitar cache de base pesada.

    Regra de performance:
    - sem cache ou chave diferente: reconstrói;
    - chave igual e TTL válido: reutiliza;
    - mesmo com force_refresh=True, reutiliza se a mesma chave foi reconstruída há
      poucos minutos. Isso bloqueia rajadas de refresh geradas por filtro/tabela.
    - quando há upload novo, a chave muda por snapshot/upload_id e reconstrói mesmo
      sem force_refresh.
    """
    if cached_data is None or cached_key != cache_key:
        return False

    try:
        idade = (now if now is not None else time.time()) - float(cached_at or 0)
    except Exception:
        return False

    if idade < 0:
        idade = 0

    if idade > ttl_seconds:
        return False

    if force_refresh and idade > FORCE_REFRESH_COOLDOWN_SECONDS:
        return False

    return True


def _cache_simples_valido(
    cache: Dict[str, Any],
    cache_key: str,
    ttl_seconds: int,
) -> bool:
    cached_data = cache.get("data")
    cached_key = cache.get("key")
    cached_at = float(cache.get("created_at") or 0)
    now = time.time()
    return (
        cached_data is not None
        and cached_key == cache_key
        and (now - cached_at) <= ttl_seconds
    )


D_PRODUTOS_SELECT = """
            cod_produto,
            desc_produto,
            grupo,
            mercado,
            tipo_produto_erp,
            familia,
            segmento,
            abc_ytm,
            linha,
            status_original,
            macro_negocio,
            tipo_negocio,
            status_portfolio,
            transferencia_bravi,
            fornecedor_terceiro,
            modelo_fornecimento,
            grupo_gerencial,
            incluir_overview_anestesicos,
            ativo_analise,
            observacao,
            concatenado_produto
        """


@router.get("/debug-versao")
def debug_versao_aging_estoque():
    return {
        "router": "aging_estoque",
        "versao": VERSAO_AGING_ESTOQUE,
        "arquivo": "app/routers/aging_estoque.py",
        "status": "router carregado corretamente",
    }



@router.get("/debug-sd2-historico/{codigo}")
def debug_sd2_historico_codigo(codigo: str):
    """Diagnóstico rápido do Histórico 6M usado no Dashboard de estoque."""
    codigo_norm = _normalizar_codigo(codigo)
    historico = _buscar_faturamento_sd2_ultimos_6m_por_codigo([codigo_norm]).get(codigo_norm, [])
    return {
        "codigo_informado": codigo,
        "codigo_normalizado": codigo_norm,
        "variantes_consulta": _codigo_variantes_consulta(codigo_norm),
        "historico_6m": historico,
        "total_6m": _round(sum(_to_float(p.get("faturamento_qtd")) for p in historico), 4),
        "valor_6m": _round(sum(_to_float(p.get("faturamento_valor")) for p in historico), 2),
        "backend_versao": VERSAO_AGING_ESTOQUE,
    }


_CACHE_VERSION_TTL_SEGUNDOS = 60
_CACHE_VERSION_MEMO: Dict[str, Any] = {"criado_em": 0.0, "payload": None}
_CACHE_VERSION_LOCK = Lock()


@router.get("/cache-version")
def cache_version_aging_estoque():
    """
    Versão operacional da Gestão de Estoque.

    O front usa esta chave para invalidar cache visual/local sempre que muda
    alguma base que afeta estoque, demanda ou entradas. Isso evita que uma
    pessoa veja número antigo em outra janela/navegador depois de upload.

    Cache curto (60s): as consultas "pega a linha mais recente" abaixo usam
    .order(...).limit(1) sem critério de desempate explícito. Se alguma
    tabela tiver mais de uma linha empatada no mesmo timestamp mais recente
    (comum em upload em lote), o banco pode devolver uma linha diferente a
    cada chamada -- fazendo essa versão "flutuar" entre 2 valores mesmo sem
    dado novo nenhum. Como o front consulta isso a cada 30s e recalcula tudo
    quando a versão muda, esse flutuar sozinho causava o card oscilar entre
    dois números (ex.: 100 e 178 itens) mesmo com o mesmo cache de base.
    Com o valor memorizado por 60s, chamadas próximas sempre recebem a MESMA
    versão -- upload novo de verdade ainda é detectado, só com até 60s de
    atraso a mais, o que é uma troca segura por parar de oscilar.
    """
    agora = time.time()

    with _CACHE_VERSION_LOCK:
        memo = _CACHE_VERSION_MEMO
        if memo.get("payload") is not None and (agora - float(memo.get("criado_em") or 0)) <= _CACHE_VERSION_TTL_SEGUNDOS:
            return memo["payload"]

    def safe(fn, default):
        try:
            return fn() or default
        except Exception:
            return default

    snapshot_consumo = safe(_latest_consumo_snapshot, "sem_posicao")
    snapshot_sb8 = safe(_latest_sb8_snapshot, "sem_sb8")
    marker_mps = safe(_latest_mps_cache_marker, "sem_mps")
    marker_parametros = safe(_latest_parametros_estoque_atualizacao, "sem_parametros")
    marker_benzotop = safe(_latest_benzotop_liberacao_snapshot, "sem_benzotop")

    versao = "|".join([
        VERSAO_AGING_ESTOQUE,
        f"posicao:{snapshot_consumo}",
        f"sb8:{snapshot_sb8}",
        f"mps:{marker_mps}",
        f"param:{marker_parametros}",
        f"benzotop:{marker_benzotop}",
        f"dia:{date.today().isoformat()}",
    ])

    payload = {
        "version": versao,
        "versao": versao,
        "backend_versao": VERSAO_AGING_ESTOQUE,
        "snapshot_consumo": snapshot_consumo,
        "snapshot_sb8": snapshot_sb8,
        "marker_mps": marker_mps,
        "marker_parametros": marker_parametros,
        "marker_benzotop": marker_benzotop,
    }

    with _CACHE_VERSION_LOCK:
        _CACHE_VERSION_MEMO["criado_em"] = agora
        _CACHE_VERSION_MEMO["payload"] = payload

    return payload


def preaquecer_todos_caches_aging_estoque(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Aquece os 3 caches oficiais da Gestão de Estoque: produtos, insumos e a
    base completa (usada pelo escopo=todos e por /resumo).

    Extraído do endpoint /preaquecer-cache para ser reutilizável também pelo
    scheduler automático em background (ver app/main.py). Antes, o endpoint
    manual só aquecia produtos/insumos e NUNCA aquecia _BUILD_BASE_CACHE
    (usado por escopo=todos) -- então a chamada manual de manhã não evitava
    o build pesado para quem abria a tela sem escopo específico.
    """
    inicio = time.time()
    erros: Dict[str, str] = {}
    resultados: Dict[str, Any] = {}

    try:
        produtos = _build_produtos_oficiais_fast_cached(force_refresh=force_refresh)
        resultados["produtos"] = {
            "itens": len(produtos.get("itens") or []),
            "fastpath": produtos.get("fastpath"),
        }
    except Exception as e:
        erros["produtos"] = str(e)[:500]

    try:
        insumos = _build_insumos_fast_cached(force_refresh=force_refresh)
        resultados["insumos"] = {
            "itens": len(insumos.get("itens") or []),
            "fastpath": insumos.get("fastpath"),
        }
    except Exception as e:
        erros["insumos"] = str(e)[:500]

    try:
        base_todos = _build_base_cached(force_refresh=force_refresh)
        resultados["todos"] = {
            "itens": len(base_todos.get("itens") or []),
        }
    except Exception as e:
        erros["todos"] = str(e)[:500]

    return {
        "ok": not bool(erros),
        "status": "cache_aquecido" if not erros else "cache_aquecido_com_avisos",
        "backend_versao": VERSAO_AGING_ESTOQUE,
        "resultados": resultados,
        "erros": erros,
        "duracao_segundos": round(time.time() - inicio, 3),
    }


@router.api_route("/preaquecer-cache", methods=["GET", "POST"])
def preaquecer_cache_aging_estoque(force_refresh: bool = Query(False)):
    """
    Aquece os caches oficiais em memória do backend para a Gestão de Estoque.

    Uso operacional: depois que a Milena sobe as bases de manhã, chamar este endpoint
    deixa PA/MR, Insumos e a base completa (escopo=todos) prontos para os usuários
    abrirem a tela sem pagar o build pesado.

    Desde V31: isso também roda sozinho em background a cada poucos minutos
    (ver app/main.py, _agendar_preaquecimento_cache), então normalmente não
    precisa mais ser chamado manualmente -- fica disponível pra forçar um
    refresh imediato quando quiser (force_refresh=true).
    """
    resultado = preaquecer_todos_caches_aging_estoque(force_refresh=force_refresh)

    try:
        versao_payload = cache_version_aging_estoque()
    except Exception:
        versao_payload = {"version": VERSAO_AGING_ESTOQUE}

    resultado["version"] = versao_payload.get("version") or versao_payload.get("versao")
    return resultado


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default

        if isinstance(value, (int, float)):
            return float(value)

        texto = str(value).strip()

        if not texto:
            return default

        # Corrige formato brasileiro:
        # 1.234,56 -> 1234.56
        # 1234,56 -> 1234.56
        # 1234.56 -> 1234.56
        if "," in texto:
            texto = texto.replace(".", "").replace(",", ".")

        return float(texto)

    except Exception:
        return default



def _round(value: Any, casas: int = 2) -> float:
    return round(_to_float(value), casas)


def _normalizar_codigo(value: Any) -> str:
    texto = str(value or "").strip()
    if texto.endswith(".0"):
        texto = texto[:-2]
    return texto.zfill(5) if texto.isdigit() else texto


def _normalizar_armazem_estoque(row: Dict[str, Any]) -> str:
    """
    Normaliza o armazém vindo da SB8/f_estoque_saldo.

    Importante: Quarentena só pode ser o armazém 98.
    Não podemos tratar armazéns 10, 88, 96, 97 etc. como quarentena.
    """
    valor = _coalesce(
        row.get("armazem"),
        row.get("armazem_codigo"),
        row.get("armaz"),
        row.get("local"),
        row.get("b8_local"),
        row.get("B8_LOCAL"),
        row.get("B8_LOCALIZ"),
        row.get("local_estoque"),
    )

    texto = str(valor or "").strip().upper()

    if texto.endswith(".0"):
        texto = texto[:-2]

    # Mantém 98 como 98 e evita transformar outros locais em quarentena.
    if texto.isdigit():
        return texto.zfill(2)

    return texto


def _armazens_validos_por_tipo(tipo: Optional[str]):
    tipo_norm = str(tipo or "").strip().upper()

    if tipo_norm in {"MP", "ME", "MI"}:
        return {"01"}

    if tipo_norm == "PA":
        return {"03", "04", "05", "07", "88"}

    if tipo_norm == "MC":
        return {"20", "A0"}

    return None


def _armazens_sb8_normais_por_tipo(tipo: Optional[str]):
    """
    Regra SB8 usada para produto acabado/revenda na visão de estoque.

    Para itens PA/MR/PPS ou ainda "A classificar" vindos da d_produtos,
    considera apenas os armazéns operacionais 04 e 07. A quarentena fica
    separada no armazém 98.

    Para MP/ME/MI que continuam vindo da posição de estoque/Aging, mantemos
    o armazém 01 quando a série SB8 for consultada apenas para detalhe.
    """
    tipo_norm = str(tipo or "").strip().upper()

    if tipo_norm in {"MP", "ME", "MI"}:
        return {"01"}

    # PA/MR/PPS/itens novos ou sem tipo classificado.
    return {"04", "07"}




def _aplicar_saldo_insumos_somente_armazem_01(
    rows: List[Dict[str, Any]],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> List[Dict[str, Any]]:
    """
    Regra oficial da Gestão de Estoque para Insumos.

    Para MP/ME/MI na visão de Insumos, o estoque disponível deve considerar
    somente o armazém 01. Materiais em 86, 10, 88, 96, 97 etc. não podem
    compor o campo "Estoque atual" porque não estão disponíveis como
    matéria-prima para produção.

    A quarentena segue separada pelo armazém 98 e é preenchida pela rotina
    _aplicar_quarentena_sb8_98_em_todos_os_itens.

    Observação importante:
    - Não removemos a linha do item, apenas zeramos o saldo disponível quando
      a origem da posição está em armazém diferente de 01. Assim itens como
      TUBETE DE VIDRO LINUO continuam aparecendo na busca, mas sem inflar
      cobertura/estoque se o saldo estiver em armazém 86.
    """
    produtos_all = produtos_all or {}

    for row in rows or []:
        if not isinstance(row, dict):
            continue

        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue

        tipo = _tipo_produto_erp_por_codigo(codigo, row=row, produtos_all=produtos_all)
        tipo_norm = str(tipo or "").strip().upper()

        # Esta função é chamada em fluxos de Insumos, mas mantemos uma trava
        # para nunca mexer em PA/MR/PPS/PV por engano.
        if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}:
            continue

        armazem = _normalizar_armazem_estoque(row)

        # Se a linha não tem armazém informado, não inventa regra; preserva o
        # fallback existente para evitar zerar sintéticos/dimensões sem posição.
        if not armazem:
            row.setdefault("__saldo_origem", row.get("__saldo_origem") or "posicao_estoque_sem_armazem_informado")
            continue

        # Armazém 01 é o único saldo disponível de insumo.
        if armazem == "01":
            row.setdefault("__saldo_origem", row.get("__saldo_origem") or "posicao_estoque_armazem_01_insumos")
            row["__armazens_saldo_origem"] = ["01"]
            continue

        # Armazém 98 será tratado como quarentena separada. Qualquer outro
        # armazém não entra em estoque atual de insumo.
        saldo_original = _to_float(row.get("saldo"))
        if saldo_original != 0:
            row["__saldo_ignorado_por_regra_armazem"] = saldo_original
            row["__armazem_ignorado_por_regra_armazem"] = armazem
            row["__saldo_origem_original"] = row.get("__saldo_origem") or "posicao_estoque"

        row["saldo"] = 0.0
        row["__saldo_origem"] = f"posicao_estoque_ignorada_armazem_{armazem}_insumo_regra_01"
        row["__data_saldo_origem"] = row.get("data_snapshot") or row.get("data_ref") or row.get("data")
        row["__armazens_saldo_origem"] = ["01"]

    return rows

def _valor_empenho_lote(row: Dict[str, Any]) -> float:
    """
    Identifica a quantidade empenhada/reservada no lote.

    A base SB8 pode chegar com nomes diferentes dependendo do processor/upload.
    Por isso testamos os nomes mais comuns sem quebrar quando algum campo não
    existir.
    """
    candidatos = [
        "empenho_lote",
        "qtd_empenho_lote",
        "empenhado_lote",
        "saldo_empenhado",
        "qtd_empenhada",
        "quantidade_empenhada",
        "empenho",
        "empenhado",
    ]

    for campo in candidatos:
        if campo in row:
            valor = _to_float(row.get(campo))
            if valor != 0:
                return valor

    return 0.0


def _saldo_lote_bruto(row: Dict[str, Any]) -> float:
    """
    Saldo bruto do lote na SB8.

    A tabela f_estoque_saldo pode ter sido alimentada por versões diferentes do
    processor:
      - versões novas gravam saldo_bruto = Saldo Lote original da SB8;
      - saldo_lote pode estar como saldo disponível, por compatibilidade antiga;
      - se saldo_bruto não existir, saldo_lote vira o fallback.
    """
    if row is None:
        return 0.0

    bruto_raw = row.get("saldo_bruto")
    if bruto_raw is not None and str(bruto_raw).strip() not in {"", "None", "nan", "NaN"}:
        return _to_float(bruto_raw)

    return _to_float(row.get("saldo_lote"))


def _saldo_disponivel_lote(row: Dict[str, Any]) -> float:
    """
    Saldo disponível do lote.

    Regra robusta para não quebrar bases antigas nem duplicar desconto de empenho:
      1. se existir saldo_disponivel preenchido, usa ele;
      2. se saldo_lote já parecer ser o disponível, usa saldo_lote;
      3. caso contrário, calcula saldo_bruto - empenho_lote.
    """
    if row is None:
        return 0.0

    disp_raw = row.get("saldo_disponivel")
    if disp_raw is not None and str(disp_raw).strip() not in {"", "None", "nan", "NaN"}:
        return max(0.0, _to_float(disp_raw))

    saldo_lote_col = _to_float(row.get("saldo_lote"))
    saldo_bruto = _saldo_lote_bruto(row)
    empenho = _valor_empenho_lote(row)
    calculado = max(0.0, saldo_bruto - empenho)

    # Quando o processor já gravou saldo_lote como disponível, evita subtrair
    # empenho de novo. Ex.: bruto 1125, empenho 1125, saldo_lote 0.
    if "saldo_bruto" in row and abs(saldo_lote_col - calculado) <= 0.0001:
        return max(0.0, saldo_lote_col)

    # Em bases sem saldo_bruto, saldo_lote costuma ser o bruto.
    if "saldo_bruto" not in row:
        return max(0.0, saldo_lote_col - empenho)

    return calculado


def _select_all(query, page_size: int = 1000):
    todos = []
    page = 0

    while True:
        res = query.range(page * page_size, ((page + 1) * page_size) - 1).execute()
        data = res.data or []
        todos.extend(data)

        if len(data) < page_size:
            break

        page += 1

    return todos


# ────────────────────────────────────────────────────────────
# Cache curto (60s) pros marcadores "pega a linha mais recente" usados na
# chave de cache da base pesada (_build_produtos_oficiais_fast_cached,
# _build_insumos_fast_cached, _build_base_cached) e no /cache-version.
#
# Esses marcadores usam .order(coluna, desc=True).limit(1) sem critério de
# desempate explícito. Se alguma tabela tiver mais de uma linha empatada no
# mesmo timestamp mais recente (comum em upload em lote), o Postgres pode
# devolver uma linha diferente a cada chamada -- fazendo a chave de cache
# "flutuar" entre 2 valores mesmo sem nenhum dado novo. Como a chave muda,
# _cache_base_valido acha que precisa reconstruir, e cada reconstrução pode
# considerar um snapshot ligeiramente diferente -- causando o card oscilar
# entre números diferentes (ex.: 100 e 178 itens) para o mesmo filtro.
#
# Com esse cache curto, todas as chamadas dentro da mesma janela de 60s
# recebem o MESMO valor -- upload novo de verdade ainda é detectado, só com
# até 60s de atraso a mais, troca segura por parar de oscilar.
_MARCADOR_CURTO_CACHE: Dict[str, tuple[float, Any]] = {}
_MARCADOR_CURTO_LOCK = Lock()
_MARCADOR_CURTO_TTL_SEGUNDOS = 60


def _marcador_com_cache_curto(chave: str, func):
    agora = time.time()

    with _MARCADOR_CURTO_LOCK:
        cached = _MARCADOR_CURTO_CACHE.get(chave)
        if cached is not None and (agora - cached[0]) <= _MARCADOR_CURTO_TTL_SEGUNDOS:
            return cached[1]

    valor = func()

    with _MARCADOR_CURTO_LOCK:
        _MARCADOR_CURTO_CACHE[chave] = (agora, valor)

    return valor


def _latest_consumo_snapshot_impl():
    res = (
        supabase.table("f_consumo_materiais")
        .select("data_snapshot")
        .not_.is_("data_snapshot", "null")
        .order("data_snapshot", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0]["data_snapshot"] if res.data else None


def _latest_consumo_snapshot():
    return _marcador_com_cache_curto("latest_consumo_snapshot", _latest_consumo_snapshot_impl)


def _latest_sb8_snapshot_impl():
    """Marcador do último upload da SB8 usado para invalidar cache.

    Antes o cache usava apenas data_ref. Quando a SB8 era reenviada no mesmo
    dia, o data_ref continuava igual e a Gestão de Estoque reaproveitava a base
    montada antiga, mantendo Quarentena 98 zerada até o TTL expirar ou reiniciar
    o backend. O upload_id muda a cada carga e força a reconstrução da base.
    """
    try:
        res = (
            supabase.table("f_estoque_saldo")
            .select("data_ref,upload_id")
            .not_.is_("data_ref", "null")
            .order("data_ref", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None

        row = res.data[0] or {}
        data_ref = row.get("data_ref") or "sem_data_ref"
        upload_id = row.get("upload_id") or "sem_upload_id"
        return f"{data_ref}|{upload_id}"
    except Exception:
        return None


def _latest_sb8_snapshot():
    return _marcador_com_cache_curto("latest_sb8_snapshot", _latest_sb8_snapshot_impl)


def _latest_benzotop_liberacao_snapshot_impl():
    """Marcador do último upload da planilha de liberação Benzotop.

    A Gestão PA/MR usa cache pesado; quando a planilha CAPACIDADE X FORECAST
    BENZOTOP é reenviada, o upload_id precisa entrar na chave para o item 52749
    atualizar entradas previstas sem aguardar TTL/restart.
    """
    try:
        res = (
            supabase.table("f_benzotop_liberacao")
            .select("upload_id,created_at,data_ref")
            .eq("codigo_pa", BENZOTOP_LIBERACAO_CODIGO_PA)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return "sem_benzotop"

        row = res.data[0] or {}
        upload_id = row.get("upload_id") or "sem_upload_id"
        data_ref = row.get("data_ref") or "sem_data_ref"
        created_at = row.get("created_at") or "sem_created_at"
        return f"{data_ref}|{upload_id}|{created_at}"
    except Exception:
        return "sem_benzotop"


def _latest_benzotop_liberacao_snapshot():
    return _marcador_com_cache_curto("latest_benzotop_liberacao_snapshot", _latest_benzotop_liberacao_snapshot_impl)



def _buscar_posicao_estoque_latest_por_codigos(codigos: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Busca a última posição de estoque/Aging somente para os códigos informados.

    Uso principal no fast path PA/MR/PPS:
    - o fast path nasce de linhas sintéticas da d_produtos;
    - quando a SB8 do dia não traz 04/07 para um SKU, precisamos do saldo da
      posição de estoque mais recente como fallback operacional;
    - não pode ler a f_consumo_materiais inteira para não pesar a abertura do dashboard.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    if not codigos_norm:
        return {}

    snapshot = _latest_consumo_snapshot()
    resultado: Dict[str, Dict[str, Any]] = {}

    for chunk in _chunks_lista(codigos_norm, 400):
        try:
            query = supabase.table("f_consumo_materiais").select("*").in_("codigo", chunk)
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            # Desempate determinístico: se por acaso existir mais de uma linha
            # pro mesmo código no mesmo snapshot (upload duplicado/reprocessado),
            # sem isso o Postgres podia devolver em ordem diferente a cada
            # chamada -- e o dedup abaixo ("primeira que aparecer") pegava ora
            # uma linha, ora outra, fazendo Estoque atual/Quarentena mudarem
            # sozinhos entre uma consulta e outra (inclusive em computadores
            # diferentes ao mesmo tempo). Ordenando por id decrescente, a
            # "primeira" é sempre a de inserção mais recente, sempre a mesma.
            query = query.order("id", desc=True)
            rows = _select_all(query)
        except Exception:
            rows = []

        for row in rows or []:
            codigo = _normalizar_codigo(row.get("codigo"))
            if codigo and codigo not in resultado:
                resultado[codigo] = row

    return resultado


def _buscar_consumo_latest():
    """
    Busca o último snapshot da base de Posição de Estoque / Consumo.

    Essa função é a base da Gestão de Estoque. Ela precisa devolver:
      - todas as linhas do último data_snapshot carregado;
      - a data_snapshot usada, para exibir no front.

    Observação:
    Se não houver data_snapshot preenchido, cai para um fallback lendo a tabela
    inteira. Isso evita quebrar a tela em bases antigas/importações manuais.
    """
    snapshot = _latest_consumo_snapshot()

    try:
        query = supabase.table("f_consumo_materiais").select("*")

        if snapshot:
            query = query.eq("data_snapshot", snapshot)

        # Mesmo desempate de _buscar_posicao_estoque_latest_por_codigos: sem
        # ORDER BY, linha duplicada do mesmo código no mesmo snapshot podia
        # vir em ordem diferente a cada chamada, e quem monta o dict por
        # código a partir daqui (dedup "por último/primeiro que aparecer")
        # acabava pegando uma linha diferente seguindo essa ordem instável.
        query = query.order("id", desc=True)

        rows = _select_all(query)

        return rows, snapshot

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao buscar f_consumo_materiais: {str(e)}",
        )


def _latest_parametros_estoque_atualizacao_impl():
    """
    Retorna a maior data de atualização entre as tabelas de Lead Time e MOQ.

    Mantive a resposta sendo usada como snapshot_mrp nos endpoints para não
    quebrar o front atual, mas a origem correta agora é:
      - d_lead_time_estoque
      - d_qtd_minima_estoque
    """
    datas = []

    for tabela in ["d_lead_time_estoque", "d_qtd_minima_estoque"]:
        try:
            res = (
                supabase.table(tabela)
                .select("atualizado_em")
                .not_.is_("atualizado_em", "null")
                .order("atualizado_em", desc=True)
                .limit(1)
                .execute()
            )
            if res.data:
                datas.append(res.data[0].get("atualizado_em"))
        except Exception:
            continue

    datas = [d for d in datas if d]
    return max(datas) if datas else None


def _latest_parametros_estoque_atualizacao():
    return _marcador_com_cache_curto(
        "latest_parametros_estoque_atualizacao", _latest_parametros_estoque_atualizacao_impl
    )


def _buscar_parametros_estoque(codigos: List[str]):
    """
    Busca Lead Time e MOQ nas novas tabelas próprias da Gestão de Estoque.

    Antes esta página pegava lead_time_total e moq da f_mrp_demanda.
    Isso fazia a tabela ficar com LT = 0 e Qtd. mínima = 0 quando o MRP não
    estava carregado/atualizado. Agora a fonte oficial é o upload unificado
    Lead Time e MOQ, que grava em:
      - d_lead_time_estoque.lead_time_dias
      - d_qtd_minima_estoque.qtd_minima
    """
    codigos_set = set(codigos or [])
    parametros: Dict[str, dict] = {
        codigo: {"lead_time_total": 0.0, "moq": 0.0}
        for codigo in codigos_set
    }

    try:
        rows_lt = _select_all(
            supabase.table("d_lead_time_estoque")
            .select("codigo, lead_time_dias, ativo")
        )
    except Exception:
        rows_lt = []

    for row in rows_lt:
        codigo = _normalizar_codigo(
            _coalesce(
                row.get("codigo"),
                row.get("produto"),
                row.get("cod_produto"),
                row.get("produto_codigo"),
                row.get("b8_produto"),
                row.get("B8_PRODUTO"),
            )
        )

        if codigo not in codigos_set:
            continue

        if row.get("ativo") is False:
            continue

        parametros.setdefault(codigo, {"lead_time_total": 0.0, "moq": 0.0})
        parametros[codigo]["lead_time_total"] = _to_float(row.get("lead_time_dias"))

    try:
        rows_moq = _select_all(
            supabase.table("d_qtd_minima_estoque")
            .select("codigo, qtd_minima, ativo")
        )
    except Exception:
        rows_moq = []

    for row in rows_moq:
        codigo = _normalizar_codigo(row.get("codigo"))

        if codigo not in codigos_set:
            continue

        if row.get("ativo") is False:
            continue

        parametros.setdefault(codigo, {"lead_time_total": 0.0, "moq": 0.0})
        parametros[codigo]["moq"] = _to_float(row.get("qtd_minima"))

    return parametros, _latest_parametros_estoque_atualizacao()


def _buscar_custos_unitarios(codigos: List[str]):
    codigos_set = set(codigos or [])

    if not codigos_set:
        return {}

    try:
        rows = _select_all(
            supabase.table("d_custo_unitario")
            .select("codigo, custo_unitario, ativo")
        )
    except Exception:
        rows = []

    custos = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("codigo"))

        if codigo not in codigos_set:
            continue

        if row.get("ativo") is False:
            continue

        custos[codigo] = _to_float(row.get("custo_unitario"))

    return custos


def _buscar_compras_resumido(codigos: List[str]):
    codigos_set = set(codigos)

    rows = _select_all_por_codigos(
        "f_compras_abertas",
        "produto_codigo",
        list(codigos_set),
        "*",
    )

    compras = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("produto_codigo"))

        if codigo not in codigos_set:
            continue

        qtd = _to_float(row.get("quantidade_pendente"))

        if qtd <= 0:
            continue

        if codigo not in compras:
            compras[codigo] = {
                "qtd_pedidos_abertos": 0.0,
                "menor_data_entrega": None,
            }

        compras[codigo]["qtd_pedidos_abertos"] += qtd

        data_entrega = _data_prevista_compra(row)

        if data_entrega:
            atual = compras[codigo]["menor_data_entrega"]
            if atual is None or str(data_entrega) < str(atual):
                compras[codigo]["menor_data_entrega"] = data_entrega

    return compras



def _buscar_compras_fup_por_codigo(codigo: str) -> List[Dict[str, Any]]:
    """
    Busca comentários de FUP importados das abas Detalhes* da reunião de compras.

    A tabela é opcional para manter compatibilidade com ambientes antes da migração.
    Se ela ainda não existir, apenas retorna lista vazia e a Gestão segue funcionando.

    Importante: algumas cargas antigas podem ter gravado o produto sem zeros à
    esquerda. Por isso buscamos tanto o código normalizado da ferramenta
    quanto a versão numérica simples.
    """
    codigo_norm = _normalizar_codigo(codigo)
    if not codigo_norm:
        return []

    variantes = [codigo_norm]
    try:
        if codigo_norm.isdigit():
            sem_zeros = str(int(codigo_norm))
            if sem_zeros and sem_zeros not in variantes:
                variantes.append(sem_zeros)
    except Exception:
        pass

    try:
        rows = _select_all(
            supabase.table("f_compras_fup")
            .select("*")
            .in_("produto_codigo", variantes)
        )
    except Exception:
        rows = []

    return rows or []


def _texto_compra_key(value: Any) -> str:
    texto = str(value or "").strip()
    if texto.endswith(".0"):
        texto = texto[:-2]
    if texto.lower() in {"", "none", "nan", "nat", "null"}:
        return ""
    return texto


def _score_fup_para_pedido(fup: Dict[str, Any], pedido: Dict[str, Any]) -> int:
    """
    Pontua o melhor comentário FUP para um pedido aberto.

    Regra segura:
    - produto precisa bater;
    - precisa bater pelo menos PEDIDO ou SC;
    - item e quantidade servem apenas como desempate/reforço;
    - nunca aplicar FUP usando só produto + quantidade ou só produto + item.

    Isso evita contaminar pedidos futuros do mesmo item/mesma quantidade com
    comentários de follow-up de pedidos antigos/atrasados.
    """
    if _normalizar_codigo(fup.get("produto_codigo")) != _normalizar_codigo(pedido.get("produto_codigo")):
        return -1

    pedido_numero = _texto_compra_key(pedido.get("pedido_numero"))
    pedido_item = _texto_compra_key(pedido.get("pedido_item"))
    sc_numero = _texto_compra_key(pedido.get("sc_numero"))
    sc_item = _texto_compra_key(pedido.get("sc_item"))

    fup_pedido_numero = _texto_compra_key(fup.get("pedido_numero"))
    fup_pedido_item = _texto_compra_key(fup.get("pedido_item"))
    fup_sc_numero = _texto_compra_key(fup.get("sc_numero"))
    fup_sc_item = _texto_compra_key(fup.get("sc_item"))

    score = 0
    tem_match_forte = False

    if pedido_numero and fup_pedido_numero and pedido_numero == fup_pedido_numero:
        score += 100
        tem_match_forte = True

    if sc_numero and fup_sc_numero and sc_numero == fup_sc_numero:
        score += 80
        tem_match_forte = True

    # Sem pedido/SC batendo, não aplica o FUP.
    # Produto + item ou produto + quantidade é fraco demais.
    if not tem_match_forte:
        return -1

    if pedido_item and fup_pedido_item and pedido_item == fup_pedido_item:
        score += 10

    if sc_item and fup_sc_item and sc_item == fup_sc_item:
        score += 5

    qtd_pedido = _to_float(pedido.get("quantidade_pendente"))
    qtd_fup = _to_float(fup.get("quantidade_pendente") or fup.get("quantidade_sa"))
    if qtd_pedido > 0 and qtd_fup > 0 and abs(qtd_pedido - qtd_fup) <= max(1.0, qtd_pedido * 0.01):
        score += 1

    return score

def _melhor_fup_para_pedido(pedido: Dict[str, Any], fups: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    melhor = None
    melhor_score = -1
    for fup in fups or []:
        score = _score_fup_para_pedido(fup, pedido)
        if score > melhor_score:
            melhor_score = score
            melhor = fup

    # Exige match forte por pedido ou SC. Evita aplicar comentário errado
    # quando há vários pedidos do mesmo item/mesma quantidade.
    return melhor if melhor is not None and melhor_score > 0 else None


def _status_pedido_operacional(data_entrega: Optional[str], qtd: float, status_fup: Optional[str] = None) -> Tuple[bool, int, str]:
    data_ref = _parse_data(data_entrega)
    hoje = date.today()
    em_atraso = bool(qtd > 0 and data_ref and data_ref < hoje)
    dias = (hoje - data_ref).days if em_atraso and data_ref else 0

    if em_atraso:
        if status_fup and "AGUARD" in str(status_fup).upper():
            return True, dias, "Atrasado / aguardando retorno"
        if status_fup:
            return True, dias, f"Atrasado / {status_fup}"
        return True, dias, "Atrasado"

    if status_fup:
        return False, 0, status_fup

    return False, 0, "No prazo"


def _data_entrada_grafico_compra(row: Dict[str, Any], fup: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """
    Data operacional para posicionar a compra no gráfico.

    Regra:
      - se o FUP trouxe nova previsão, usa essa data;
      - senão usa a data prevista original do Protheus;
      - se a data original já venceu e ainda não há nova previsão FUP,
        posiciona no 1º dia do mês atual apenas para bucket/projeção.

    Importante:
      essa data NÃO substitui a entrega original exibida na tabela/tooltip.
      Ela serve só para não fazer pedido aberto atrasado sumir da projeção.
    """
    hoje = date.today()
    inicio_mes_atual = date(hoje.year, hoje.month, 1)
    data_fup = _parse_data((fup or {}).get("nova_previsao_fup"))
    data_original = _parse_data(_data_prevista_compra(row))
    data_base = data_fup or data_original

    if not data_base:
        return None

    if data_fup:
        return data_fup.isoformat()

    if data_base < inicio_mes_atual:
        return inicio_mes_atual.isoformat()

    if data_base < hoje:
        return inicio_mes_atual.isoformat()

    return data_base.isoformat()


def _somar_pedidos_atrasados(pedidos: List[Dict[str, Any]]) -> float:
    return _round(sum(_to_float(p.get("quantidade_pendente")) for p in (pedidos or []) if p.get("em_atraso")), 4)

def _buscar_compras_detalhadas(codigo: str):
    codigo_norm_ref = _normalizar_codigo(codigo)
    rows = _select_all_por_codigos(
        "f_compras_abertas",
        "produto_codigo",
        [codigo_norm_ref],
        "*",
    )

    fups = _buscar_compras_fup_por_codigo(codigo_norm_ref)
    pedidos = []

    for row in rows:
        cod = _normalizar_codigo(row.get("produto_codigo"))

        if cod != codigo_norm_ref:
            continue

        qtd = _to_float(row.get("quantidade_pendente"))

        if qtd <= 0:
            continue

        data_entrega = _data_prevista_compra(row)
        fup = _melhor_fup_para_pedido(row, fups)
        status_fup = (fup or {}).get("status_fup")
        em_atraso, dias_atraso, status_operacional = _status_pedido_operacional(data_entrega, qtd, status_fup)

        pedidos.append({
            "pedido_numero": row.get("pedido_numero"),
            "pedido_item": row.get("pedido_item"),
            "sc_numero": row.get("sc_numero"),
            "sc_item": row.get("sc_item"),
            "produto_codigo": cod,
            "produto_descricao": row.get("produto_descricao"),

            "quantidade_pendente": _round(qtd, 4),
            "quantidade_sa": _round(row.get("quantidade_sa"), 4),
            "quantidade_pc": _round(row.get("quantidade_pc"), 4),
            "quantidade_entregue": _round(row.get("quantidade_entregue"), 4),

            "pedido_emissao": row.get("pedido_emissao"),
            "sc_emissao": row.get("sc_emissao"),
            "data_prevista_entrega": data_entrega,
            "data_prevista_entrega_original": data_entrega,
            "data_entrada_grafico": _data_entrada_grafico_compra(row, fup),
            "origem_data_entrada_grafico": (
                "nova_previsao_fup" if (fup or {}).get("nova_previsao_fup") else
                "mes_atual_pedido_atrasado_sem_fup" if em_atraso else
                _origem_data_prevista_compra(row)
            ),
            "data_previsao_necessidade": row.get("data_previsao_necessidade"),
            "origem_data_prevista": _origem_data_prevista_compra(row),

            "nova_previsao_fup": (fup or {}).get("nova_previsao_fup"),
            "data_previsao_fup": (fup or {}).get("nova_previsao_fup"),
            "comentario_fup": (fup or {}).get("comentario_fup"),
            "status_fup": status_fup,
            "aba_fup": (fup or {}).get("aba_origem"),
            "arquivo_fup": (fup or {}).get("arquivo_origem"),

            "fornecedor": row.get("razao_social_fornecedor") or (fup or {}).get("fornecedor"),
            "comprador": row.get("comprador_nome") or row.get("comprador") or (fup or {}).get("comprador"),
            "status_entrega": row.get("entrega_status"),
            "status_operacional": status_operacional,
            "em_atraso": em_atraso,
            "dias_atraso": dias_atraso,
        })

    pedidos.sort(
        key=lambda x: (
            0 if x.get("em_atraso") else 1,
            x.get("data_prevista_entrega") or "9999-12-31",
            x.get("pedido_numero") or "",
            x.get("sc_numero") or "",
        )
    )

    return pedidos


def _calcular_status(
    saldo,
    estoque_mais_pedidos,
    maior_media,
    cobertura_futura,
    lead_time,
    estoque_ideal,
):
    if maior_media <= 0:
        return "SEM_CONSUMO"

    if saldo <= 0:
        return "RUPTURA"

    if lead_time > 0 and cobertura_futura < lead_time:
        return "CRITICO"

    if estoque_ideal > 0 and estoque_mais_pedidos < estoque_ideal:
        return "CRITICO"

    if cobertura_futura < 30:
        return "ATENCAO"

    if estoque_ideal > 0 and saldo > estoque_ideal * 1.5:
        return "EXCESSO"

    return "SAUDAVEL"



def _normalizar_texto_filtro(value: Any) -> str:
    return str(value or "").strip()


def _buscar_d_produtos(codigos: List[str], filtrar_por_codigos: bool = True):
    """
    Busca a dimensão gerencial de produtos.

    Quando há lista de códigos, busca direto no Supabase por chunks para não
    carregar a d_produtos inteira. O carregamento completo só fica disponível
    para rotinas antigas que ainda pedem filtrar_por_codigos=False.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if filtrar_por_codigos and codigos_set:
        return _buscar_d_produtos_por_codigos(sorted(codigos_set))

    rows = _select_all(
        supabase.table("d_produtos")
        .select(D_PRODUTOS_SELECT)
    )

    produtos = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("cod_produto"))

        if not codigo:
            continue

        if filtrar_por_codigos and codigos_set and codigo not in codigos_set:
            continue

        produtos[codigo] = row

    return produtos




def _d_produtos_to_dict(rows: List[Dict[str, Any]]) -> Dict[str, dict]:
    produtos: Dict[str, dict] = {}

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("cod_produto"))
        if not codigo:
            continue
        produtos[codigo] = row

    return produtos


def _chunks_lista(valores: List[str], tamanho: int = 500):
    valores = list(valores or [])
    for i in range(0, len(valores), tamanho):
        yield valores[i:i + tamanho]


def _select_all_por_codigos(
    tabela: str,
    coluna_codigo: str,
    codigos: List[str],
    select_expr: str = "*",
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Busca linhas filtrando por código em chunks.

    Isso evita ler tabelas grandes inteiras no Fly, que estava derrubando o
    processo por falta de memória quando o Dashboard PA/MR abria.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})

    if not codigos_norm:
        return []

    todos: List[Dict[str, Any]] = []

    for chunk in _chunks_lista(codigos_norm, 400):
        try:
            query = supabase.table(tabela).select(select_expr).in_(coluna_codigo, chunk)
            todos.extend(_select_all(query, page_size=page_size))
        except Exception:
            continue

    return todos





def _codigo_variantes_consulta(value: Any) -> List[str]:
    """
    Gera variantes seguras de código para consulta em tabelas legadas.

    Motivo: algumas tabelas estão com códigos Protheus com zero à esquerda
    (ex.: 05111), enquanto outras ficaram como 5111. Se a consulta usa só
    zfill(5), o histórico SD2 pode voltar vazio mesmo existindo venda.
    """
    raw = str(value or "").strip()
    if raw.endswith(".0"):
        raw = raw[:-2]

    normalizado = _normalizar_codigo(raw)
    variantes = {raw, normalizado}

    if raw.isdigit():
        sem_zeros = raw.lstrip("0") or "0"
        variantes.add(sem_zeros)
        variantes.add(sem_zeros.zfill(5))

    if normalizado.isdigit():
        sem_zeros = normalizado.lstrip("0") or "0"
        variantes.add(sem_zeros)
        variantes.add(sem_zeros.zfill(5))

    return sorted(v for v in variantes if v not in {"", "None", "nan", "NaN"})


def _select_all_por_codigos_variantes(
    tabela: str,
    coluna_codigo: str,
    codigos: List[str],
    select_exprs: List[str],
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Igual ao _select_all_por_codigos, mas consultando código com e sem zero à esquerda
    e testando selects alternativos quando a tabela não possui alguma coluna.

    Uso principal: f_sd2_saidas para histórico 6M/YTD do Dashboard.
    """
    valores_consulta = sorted({
        variante
        for codigo in (codigos or [])
        for variante in _codigo_variantes_consulta(codigo)
    })

    if not valores_consulta:
        return []

    for select_expr in select_exprs:
        todos: List[Dict[str, Any]] = []
        erro_select = False

        for chunk in _chunks_lista(valores_consulta, 400):
            try:
                query = supabase.table(tabela).select(select_expr).in_(coluna_codigo, chunk)
                todos.extend(_select_all(query, page_size=page_size))
            except Exception:
                erro_select = True
                break

        if not erro_select:
            return todos

    return []


def _ano_mes_sd2_row(row: Dict[str, Any]) -> Tuple[int, int]:
    """Extrai ano/mês da SD2 usando ano+mes como fonte principal."""
    ano = _to_int(row.get("ano"))
    mes = _to_int(row.get("mes"))

    if 1 <= mes <= 12 and ano > 1900:
        return ano, mes

    for campo in ["emissao", "data_emissao", "dt_emissao", "data", "data_nf", "created_at"]:
        data_ref = _parse_data(row.get(campo))
        if data_ref:
            return data_ref.year, data_ref.month

    return 0, 0


def _valor_total_sd2_row(row: Dict[str, Any]) -> float:
    """Valor faturado da SD2 com fallback para nomes de coluna usados em imports diferentes."""
    for campo in ["vlr_total", "valor_total", "valor", "vlr_liquido", "total", "faturamento_valor"]:
        if campo in row:
            valor = _to_float(row.get(campo))
            if valor != 0:
                return valor
    return 0.0

def _row_identity_safe(row: Dict[str, Any]) -> str:
    """Chave simples para deduplicar linhas retornadas por colunas alternativas."""
    if not isinstance(row, dict):
        return str(row)

    ident = _coalesce(row.get("id"), row.get("uuid"))
    if ident:
        return f"id:{ident}"

    codigo = _codigo_sb8_linha(row) if "_codigo_sb8_linha" in globals() else _normalizar_codigo(
        _coalesce(row.get("codigo"), row.get("produto"), row.get("cod_produto"), row.get("produto_codigo"))
    )
    armazem = _normalizar_armazem_estoque(row)
    lote = str(_coalesce(row.get("lote"), row.get("lote_fornecedor"), row.get("lote_fornec"), "") or "").strip()
    data_ref = str(_coalesce(row.get("data_ref"), row.get("data"), row.get("created_at"), "") or "").strip()
    saldo = str(_coalesce(row.get("saldo_lote"), row.get("saldo_disponivel"), row.get("saldo_bruto"), "") or "").strip()
    return f"{codigo}|{armazem}|{lote}|{data_ref}|{saldo}"


def _select_all_estoque_saldo_por_codigos(
    codigos: List[str],
    select_expr: str = "*",
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Busca SB8/f_estoque_saldo por código de forma robusta.

    Em ambientes diferentes, a coluna do produto pode ter sido criada/importada
    como codigo, produto, cod_produto ou produto_codigo. Antes a Gestão olhava
    só `codigo`; se o upload gravasse em outra coluna, a Quarentena 98 existia
    na tabela mas virava zero na tela.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})

    if not codigos_norm:
        return []

    colunas_codigo = ["codigo", "produto", "cod_produto", "produto_codigo", "b8_produto", "B8_PRODUTO"]
    todos: List[Dict[str, Any]] = []
    vistos = set()

    for coluna in colunas_codigo:
        try:
            rows_coluna = _select_all_por_codigos(
                "f_estoque_saldo",
                coluna,
                codigos_norm,
                select_expr,
                page_size=page_size,
            )
        except Exception:
            rows_coluna = []

        for row in rows_coluna or []:
            codigo_row = _normalizar_codigo(
                _coalesce(
                    row.get("codigo"),
                    row.get("produto"),
                    row.get("cod_produto"),
                    row.get("produto_codigo"),
                    row.get("b8_produto"),
                    row.get("B8_PRODUTO"),
                )
            )
            if codigo_row not in set(codigos_norm):
                continue

            chave = _row_identity_safe(row)
            if chave in vistos:
                continue

            vistos.add(chave)
            todos.append(row)

    return todos


def _buscar_d_produtos_por_codigos(codigos: List[str]) -> Dict[str, dict]:
    """
    Busca somente os códigos necessários da d_produtos.

    Com a dimensão completa do MATA010, a tabela pode ter mais de 46 mil linhas.
    Ler tudo em toda montagem da Gestão derruba/estoura o endpoint no Fly.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})

    if not codigos_norm:
        return {}

    produtos: Dict[str, dict] = {}

    for chunk in _chunks_lista(codigos_norm, 500):
        try:
            rows = _select_all(
                supabase.table("d_produtos")
                .select(D_PRODUTOS_SELECT)
                .in_("cod_produto", chunk)
            )
        except Exception:
            rows = []

        produtos.update(_d_produtos_to_dict(rows))

    return produtos


def _valor_ativo_analise_explicito(value: Any) -> Optional[bool]:
    """
    Interpreta ativo_analise sem assumir True quando está vazio.

    Depois que d_produtos virou dimensão completa, vazio não pode significar
    ativo, senão a tela tenta carregar o cadastro inteiro no PA/MR.
    """
    if value is True:
        return True
    if value is False:
        return False

    texto = str(value if value is not None else "").strip().upper()

    if texto in {"TRUE", "1", "S", "SIM", "YES", "Y", "ATIVO", "ATIVA"}:
        return True

    if texto in {
        "FALSE",
        "0",
        "N",
        "NAO",
        "NÃO",
        "NO",
        "INATIVO",
        "INATIVA",
        "NÃO ANALISAR",
        "NAO ANALISAR",
        "DESCONSIDERAR",
    }:
        return False

    return None


def _produto_ativo_analise_explicito(produto: Optional[dict]) -> bool:
    if not produto:
        return False
    return _valor_ativo_analise_explicito(produto.get("ativo_analise")) is True


def _buscar_d_produtos_ativos_analise() -> Dict[str, dict]:
    """
    Busca somente SKUs marcados explicitamente com ativo_analise = True.

    Importante:
    Depois que a d_produtos recebeu a base inteira do MATA010, nunca podemos
    fazer fallback lendo a tabela inteira só para filtrar em Python. No Fly isso
    derruba o endpoint pesado da Gestão/Dashboard.

    Como o upload pode gravar ativo_analise como booleano ou texto, tentamos
    os formatos usuais diretamente no Supabase e juntamos os resultados.
    """
    ativos: Dict[str, dict] = {}

    valores_true = [True, "True", "TRUE", "true", "1", "Sim", "SIM", "S", "s"]

    for valor in valores_true:
        try:
            rows = _select_all(
                supabase.table("d_produtos")
                .select(D_PRODUTOS_SELECT)
                .eq("ativo_analise", valor)
            )
            ativos.update(_d_produtos_to_dict(rows))
        except Exception:
            continue

    return ativos


def _buscar_pais_bom_dos_componentes(codigos_componentes: List[str]) -> set[str]:
    """
    Busca os códigos pai necessários para herdar classificação de insumos.

    Assim evitamos carregar toda a d_produtos só para a classificação BOM.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos_componentes or []) if _normalizar_codigo(c)}
    if not codigos_set:
        return set()

    try:
        rows = _buscar_bom_estrutura_rows_raw()
    except Exception:
        rows = []

    pais = set()
    for row in rows or []:
        comp = _normalizar_codigo(row.get("codigo_comp"))
        if comp not in codigos_set:
            continue
        pai = _normalizar_codigo(row.get("codigo_pai"))
        if pai:
            pais.add(pai)

    return pais


def _buscar_d_produtos_relevantes_para_base(rows_consumo: List[Dict[str, Any]]) -> Dict[str, dict]:
    """
    Monta a d_produtos necessária para a Gestão sem carregar 46 mil SKUs no build.

    Inclui:
      - códigos existentes no snapshot do Aging;
      - PA/MR oficiais com ativo_analise=True;
      - pais da BOM necessários para classificar insumos;
      - PAs/PIs do mapa Bravi.
    """
    codigos_consumo = sorted({
        _normalizar_codigo(row.get("codigo"))
        for row in (rows_consumo or [])
        if _normalizar_codigo(row.get("codigo"))
    })

    produtos_ativos = _buscar_d_produtos_ativos_analise()

    codigos_bravi = set(BRAVI_PA_PI_STATIC_MAP.keys())
    for pis in BRAVI_PA_PI_STATIC_MAP.values():
        for pi in pis or []:
            codigos_bravi.add(_normalizar_codigo(pi))

    pais_bom = _buscar_pais_bom_dos_componentes(codigos_consumo)

    codigos_relevantes = set(codigos_consumo) | set(produtos_ativos.keys()) | pais_bom | codigos_bravi

    produtos = _buscar_d_produtos_por_codigos(sorted(codigos_relevantes))
    produtos.update(produtos_ativos)

    return produtos

def _texto_valido(value: Any) -> Optional[str]:
    if value is None:
        return None

    texto = str(value).strip()

    if not texto:
        return None

    if texto.upper() in {"NAN", "NONE", "NULL", "-", "—"}:
        return None

    return texto


def _eh_classificado(value: Any) -> bool:
    texto = _texto_valido(value)

    if not texto:
        return False

    return texto.upper() not in {"A CLASSIFICAR", "SEM CLASSIFICACAO", "SEM CLASSIFICAÇÃO", "VALIDAR"}


def _normalizar_sim_nao(value: Any, default: str = "Não") -> str:
    texto = str(value or "").strip().upper()

    if texto in {"SIM", "S", "TRUE", "1", "YES", "Y"}:
        return "Sim"

    if texto in {"NAO", "NÃO", "N", "FALSE", "0", "NO"}:
        return "Não"

    return default


# ─── Regra Bravi PA ↔ PI ──────────────────────────────────────────────────────
#
# Durante a transição/industrialização Bravi, a demanda e o faturamento continuam
# no PA vendido, mas as compras/entradas chegam em PI. Portanto, para PA marcado
# como transferencia_bravi, a disponibilidade futura deve olhar o PI vinculado.
#
# A associação ideal vem do cadastro Protheus/MATA010: Codigo, Descricao, Tipo,
# Unidade. Como nem todo ambiente tem a MATA010 em tabela própria, mantemos um
# mapa seguro extraído da base enviada e também tentamos montar pares dinamicamente
# por descrição normalizada dentro da d_produtos.
BRAVI_PA_PI_STATIC_MAP: Dict[str, List[str]] = {
    # CLONAGE / CLONAGEM
    # Mantido como fallback seguro quando o cadastro gerencial marcar o PA como transferência Bravi.
    "50149": ["40482", "40484"],
    "50151": ["40486"],
    "50167": ["40482", "40484", "40486"],
    "50609": ["40482"],
    "50611": ["40484"],
    "50613": ["40486"],
    "50883": ["40482", "40486"],
    "50923": ["40482", "40484"],
    "50941": ["40482", "40484", "40486"],
    "51110": ["40486"],
    "51111": ["40482"],
    "51113": ["40484"],
    "51115": ["40482", "40484", "40486"],
    "51199": ["40482", "40484", "40486"],
    "52459": ["40484"],
    "52465": ["40482", "40486"],
    "52862": ["40486"],
    "52863": ["40486"],
    "52864": ["40486"],
    "52865": ["40486"],
    "52866": ["40486"],
    "52867": ["40486"],
    "52868": ["40486"],
    "52869": ["40486"],
    "52870": ["40482"],
    "52871": ["40482"],
    "52872": ["40484"],
    "52873": ["40482", "40484", "40486"],
    "52876": ["40482"],
    "52877": ["40484"],
    "52878": ["40482", "40484", "40486"],

    # FUTURA AD — PIs de industrialização/transferência no armazém 10.
    "50853": ["40566"],  # FUTURA AD DENSO BASE + CAT.
    "51079": ["40566"],
    "51127": ["40566"],

    "50855": ["40562"],  # FUTURA AD FLUIDO REGULAR REFIL
    "51136": ["40562"],
    "50869": ["40562"],  # KIT SIMPLES - F REG
    "51161": ["40562"],

    "50857": ["40560"],  # FUTURA AD FLUIDO LEVE REFIL
    "51133": ["40560"],
    "50871": ["40560"],  # KIT SIMPLES - F LEVE
    "51160": ["40560"],

    "50859": ["40564"],  # FUTURA AD KIT COMPLETO
    "51144": ["40564"],  # KIT COMP + DISPENSADOR: entrada operacional principal vem do kit PI
    "51152": ["40564"],
    "51231": ["40564"],
    "51369": ["40564"],
    "51375": ["40564"],
    "51503": ["40564"],

    # Dispensador / ponta misturadora: só usa PI se houver mapeamento explícito no cadastro.
    "50981": ["40480"],
    "51121": ["40480"],

    # SIGMA FLOW — PIs de industrialização/transferência no armazém 10.
    "50875": ["40568"],
    "52885": ["40568"],

    "50877": ["40570"],
    "52886": ["40570"],

    "50881": ["40572"],
    "52887": ["40572"],

    "50885": ["40573"],
    "52888": ["40573"],

    "50889": ["40574"],
    "52890": ["40574"],

    "50895": ["40575"],
    "52889": ["40575"],
}

# Armazém Protheus usado para PIs que estão em transferência/industrialização Bravi.
# Esse saldo NÃO vira estoque PA nem quarentena PA; entra como disponibilidade operacional futura.
BRAVI_PI_ARMAZENS_TRANSFERENCIA = {"10"}


def _normalizar_descricao_match(value: Any) -> str:
    texto = str(value or "").strip().upper()
    if not texto:
        return ""
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
    texto = texto.replace("+", " PLUS ")
    texto = re.sub(r"[^A-Z0-9]+", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def _produto_eh_transferencia_bravi(
    codigo: str,
    row: Optional[Dict[str, Any]] = None,
    produtos_all: Optional[Dict[str, dict]] = None,
) -> bool:
    codigo_norm = _normalizar_codigo(codigo)
    produto_dim = (produtos_all or {}).get(codigo_norm) or {}
    row = row or {}

    if codigo_norm in BRAVI_PA_PI_STATIC_MAP:
        return True

    transferencia = _normalizar_sim_nao(
        _coalesce(
            produto_dim.get("transferencia_bravi"),
            row.get("transferencia_bravi"),
        ),
        default="Não",
    )
    return transferencia == "Sim"


def _item_deve_usar_entrada_pi_bravi(
    codigo: str,
    tipo: Optional[str] = None,
    row: Optional[Dict[str, Any]] = None,
    produtos_all: Optional[Dict[str, dict]] = None,
    mapa_pa_pi_bravi: Optional[Dict[str, List[str]]] = None,
) -> bool:
    """
    Define quando o item vendido deve buscar entradas no PI Bravi vinculado.

    Alguns PAs Bravi ainda estão como tipo ERP "A classificar" na d_produtos.
    Mesmo assim, se o código está no mapa PA -> PI, ele deve usar compras/SC/saldo
    do PI como entrada operacional, mantendo faturamento, forecast e estoque no PA.
    """
    codigo_norm = _normalizar_codigo(codigo)
    if not codigo_norm:
        return False

    mapa = mapa_pa_pi_bravi or BRAVI_PA_PI_STATIC_MAP
    if not mapa.get(codigo_norm):
        return False

    tipo_norm = str(tipo or "").strip().upper()
    if tipo_norm in {"MP", "ME", "MI", "PI", "MP/ME"}:
        return False

    return _produto_eh_transferencia_bravi(codigo_norm, row=row, produtos_all=produtos_all)


def _item_deve_usar_saldo_sb8_produto(
    codigo: str,
    tipo: Optional[str] = None,
) -> bool:
    """
    Define quando o saldo oficial deve vir da SB8 por código exato.

    Além de PA/MR/PPS, inclui PA Bravi mapeado manualmente mesmo que ainda esteja
    como "A classificar" no cadastro. Isso não faz o PI virar estoque do PA: o saldo
    continua sendo buscado pelo código exato do PA em 04/07 e quarentena 98.
    """
    codigo_norm = _normalizar_codigo(codigo)
    return _item_usa_saldo_sb8_como_oficial(tipo) or codigo_norm in BRAVI_PA_PI_STATIC_MAP


def _data_prevista_compra(row: Dict[str, Any]) -> Optional[str]:
    """
    Data operacional da entrada prevista de compra.

    Regra v45:
    - para o gráfico de entradas futuras, compra só pode cair no mês da data
      prevista de entrega ou, quando não houver pedido, na data de necessidade;
    - não usar emissão do pedido/SC como fallback, porque isso concentra tudo
      no mês atual e passa a sensação de que vai entrar tudo de uma vez.
    """
    return _coalesce(
        row.get("data_prevista_entrega"),
        row.get("data_previsao_necessidade"),
    )


def _origem_data_prevista_compra(row: Dict[str, Any]) -> Optional[str]:
    if row.get("data_prevista_entrega"):
        return "data_prevista_entrega"
    if row.get("data_previsao_necessidade"):
        return "data_previsao_necessidade"
    return None


def _mapear_pa_para_pi_bravi(
    codigos_pa: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
    rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[str]]:
    """
    Mapa PA vendido -> PI operacional comprado/recebido da Bravi.

    Prioridade:
      1. mapa estático seguro extraído da MATA010 enviada;
      2. pareamento dinâmico por descrição normalizada quando a d_produtos já
         contiver PA e PI do cadastro Protheus.
    """
    produtos_all = produtos_all or {}
    rows = rows or []
    codigos_set = {_normalizar_codigo(c) for c in (codigos_pa or []) if _normalizar_codigo(c)}
    resultado: Dict[str, List[str]] = {}

    # Candidatos vindos da d_produtos + linhas da base montada.
    candidatos: Dict[str, Dict[str, Any]] = {}

    for codigo, prod in produtos_all.items():
        codigo_norm = _normalizar_codigo(codigo or prod.get("cod_produto"))
        if not codigo_norm:
            continue
        candidatos[codigo_norm] = {
            "codigo": codigo_norm,
            "descricao": prod.get("desc_produto") or prod.get("produto"),
            "tipo": prod.get("tipo_produto_erp") or prod.get("tipo"),
            "transferencia_bravi": prod.get("transferencia_bravi"),
        }

    for row in rows:
        codigo_norm = _normalizar_codigo(row.get("codigo") or row.get("cod_produto"))
        if not codigo_norm or codigo_norm in candidatos:
            continue
        candidatos[codigo_norm] = {
            "codigo": codigo_norm,
            "descricao": row.get("produto") or row.get("desc_produto") or row.get("descricao"),
            "tipo": row.get("tipo") or row.get("tipo_produto_erp"),
            "transferencia_bravi": row.get("transferencia_bravi"),
        }

    pis_por_desc: Dict[str, List[str]] = defaultdict(list)
    for codigo, item in candidatos.items():
        tipo = str(item.get("tipo") or "").strip().upper()
        if tipo != "PI":
            continue
        desc_norm = _normalizar_descricao_match(item.get("descricao"))
        if not desc_norm:
            continue
        pis_por_desc[desc_norm].append(codigo)

    for codigo in codigos_set:
        pis: List[str] = []

        # 1) estático: garante FUTURA/CLONAGE mesmo sem MATA010 em tabela.
        pis.extend(BRAVI_PA_PI_STATIC_MAP.get(codigo) or [])

        # 2) dinâmico por descrição para novos PA/PI cadastrados.
        item = candidatos.get(codigo) or {}
        tipo = str(item.get("tipo") or "").strip().upper()
        if tipo == "PA" and _produto_eh_transferencia_bravi(codigo, item, produtos_all):
            desc_norm = _normalizar_descricao_match(item.get("descricao"))
            pis.extend(pis_por_desc.get(desc_norm) or [])

        pis_norm = []
        vistos = set()
        for pi in pis:
            pi_norm = _normalizar_codigo(pi)
            if not pi_norm or pi_norm == codigo or pi_norm in vistos:
                continue
            vistos.add(pi_norm)
            pis_norm.append(pi_norm)

        if pis_norm:
            resultado[codigo] = pis_norm

    return resultado


def _buscar_saldo_pi_bravi_resumido(mapa_pa_pi: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    """
    Saldo de PI em transferência Bravi para somar como entrada operacional do PA.

    Importante: não vira estoque atual nem quarentena do PA. É entrada operacional
    porque ainda falta a OP de transformação PI -> PA.
    """
    if not mapa_pa_pi:
        return {}

    pi_para_pa: Dict[str, List[str]] = defaultdict(list)
    for pa, pis in mapa_pa_pi.items():
        for pi in pis or []:
            pi_norm = _normalizar_codigo(pi)
            if pi_norm:
                pi_para_pa[pi_norm].append(pa)

    if not pi_para_pa:
        return {}

    try:
        rows = _select_all_por_codigos(
            "f_estoque_saldo",
            "codigo",
            list(pi_para_pa.keys()),
            "*",
        )
    except Exception:
        rows = []

    resultado: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "qtd_pi_transferencia": 0.0,
        "codigos_pi_bravi": [],
        "linhas_pi_transferencia": [],
    })

    for row in rows or []:
        codigo_pi = _codigo_sb8_linha(row)
        if codigo_pi not in pi_para_pa:
            continue

        armazem = _normalizar_armazem_estoque(row)
        if armazem not in BRAVI_PI_ARMAZENS_TRANSFERENCIA:
            continue

        # Para PI Bravi no armazém 10, o saldo pode estar 100% empenhado.
        # Operacionalmente isso ainda representa PI em transferência/industrialização,
        # então usamos o saldo bruto como entrada operacional futura do PA.
        saldo_disp = _saldo_disponivel_lote(row)
        saldo_bruto = _saldo_lote_bruto(row)
        empenho = _valor_empenho_lote(row)
        qtd_transferencia = max(saldo_bruto, saldo_disp)

        if qtd_transferencia <= 0:
            continue

        data_ref = _parse_data(row.get("data_ref") or row.get("data"))

        for codigo_pa in pi_para_pa[codigo_pi]:
            resultado[codigo_pa]["qtd_pi_transferencia"] += qtd_transferencia
            if codigo_pi not in resultado[codigo_pa]["codigos_pi_bravi"]:
                resultado[codigo_pa]["codigos_pi_bravi"].append(codigo_pi)
            resultado[codigo_pa]["linhas_pi_transferencia"].append({
                "produto_codigo": codigo_pi,
                "codigo_pi_bravi": codigo_pi,
                "codigo_pa_venda": codigo_pa,
                "quantidade_pendente": _round(qtd_transferencia, 4),
                "saldo_disponivel": _round(saldo_disp, 4),
                "saldo_bruto": _round(saldo_bruto, 4),
                "empenho_lote": _round(empenho, 4),
                "data_prevista_entrega": data_ref.isoformat() if data_ref else date.today().isoformat(),
                "pedido_numero": row.get("lote") or "SALDO-PI-BRAVI",
                "sc_numero": None,
                "fornecedor": "Bravi / PI em transferência",
                "comprador": None,
                "status_entrega": "saldo_pi_transferencia_bruto_armazem_10",
                "tipo_entrada": "saldo_pi_bravi_transferencia_bruto",
                "armazem": armazem,
            })

    return {
        pa: {
            **info,
            "qtd_pi_transferencia": _round(info.get("qtd_pi_transferencia"), 4),
            "codigos_pi_bravi": sorted(set(info.get("codigos_pi_bravi") or [])),
        }
        for pa, info in resultado.items()
    }


def _somar_compras_codigos(codigos_compra: List[str], compras: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    total = 0.0
    menor_data = None
    codigos_usados = []

    for codigo in codigos_compra or []:
        codigo_norm = _normalizar_codigo(codigo)
        info = compras.get(codigo_norm) or {}
        qtd = _to_float(info.get("qtd_pedidos_abertos"))
        if qtd > 0:
            total += qtd
            codigos_usados.append(codigo_norm)

        data = info.get("menor_data_entrega")
        if data and (menor_data is None or str(data) < str(menor_data)):
            menor_data = data

    return {
        "qtd_pedidos_abertos": _round(total, 4),
        "qtd_pedidos_compra": _round(total, 4),
        "menor_data_entrega": menor_data,
        "codigos_pi_com_compra": sorted(set(codigos_usados)),
    }


def _entradas_bravi_pa_por_pi(
    codigo_pa: str,
    mapa_pa_pi: Dict[str, List[str]],
    compras: Dict[str, Dict[str, Any]],
    saldos_pi_bravi: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    codigo_pa = _normalizar_codigo(codigo_pa)
    codigos_pi = mapa_pa_pi.get(codigo_pa) or []
    resumo_compras = _somar_compras_codigos(codigos_pi, compras)
    saldo_info = (saldos_pi_bravi or {}).get(codigo_pa) or {}

    qtd_compra = _to_float(resumo_compras.get("qtd_pedidos_compra"))
    qtd_pi_transferencia = _to_float(saldo_info.get("qtd_pi_transferencia"))
    total = qtd_compra + qtd_pi_transferencia

    menor_data = resumo_compras.get("menor_data_entrega")
    if not menor_data and qtd_pi_transferencia > 0:
        menor_data = date.today().isoformat()

    return {
        "qtd_pedidos_abertos": _round(total, 4),
        "qtd_pedidos_compra": _round(qtd_compra, 4),
        "qtd_pi_transferencia": _round(qtd_pi_transferencia, 4),
        "qtd_liberacoes_previstas": 0.0,
        "menor_data_entrega": menor_data,
        "fonte_entradas_previstas": "pi_bravi_compras_transferencia",
        "label_entradas_previstas": "PI Bravi: compras + transferência",
        "codigos_pi_bravi": codigos_pi,
        "codigo_pi_principal": codigos_pi[0] if codigos_pi else None,
        "linhas_pi_transferencia": saldo_info.get("linhas_pi_transferencia") or [],
    }


def _buscar_entradas_bravi_pa_detalhadas(codigo_pa: str) -> List[Dict[str, Any]]:
    codigo_pa = _normalizar_codigo(codigo_pa)
    codigos_dim = {codigo_pa}
    for pi_tmp in BRAVI_PA_PI_STATIC_MAP.get(codigo_pa) or []:
        codigos_dim.add(_normalizar_codigo(pi_tmp))
    produtos_all = _buscar_d_produtos_por_codigos(sorted(codigos_dim))
    mapa_pa_pi = _mapear_pa_para_pi_bravi([codigo_pa], produtos_all=produtos_all, rows=[])
    codigos_pi = mapa_pa_pi.get(codigo_pa) or []

    if not codigos_pi:
        return []

    detalhes: List[Dict[str, Any]] = []

    saldo_info = _buscar_saldo_pi_bravi_resumido({codigo_pa: codigos_pi}).get(codigo_pa) or {}
    for row in saldo_info.get("linhas_pi_transferencia") or []:
        detalhes.append({
            **row,
            "produto_codigo": row.get("produto_codigo"),
            "codigo_pa_venda": codigo_pa,
            "codigo_pi_bravi": row.get("codigo_pi_bravi"),
            "origem_entrada": "saldo_pi_bravi_transferencia",
        })

    for codigo_pi in codigos_pi:
        for pedido in _buscar_compras_detalhadas(codigo_pi):
            detalhes.append({
                **pedido,
                "produto_codigo": codigo_pi,
                "codigo_pa_venda": codigo_pa,
                "codigo_pi_bravi": codigo_pi,
                "origem_entrada": "compra_pi_bravi",
            })

    detalhes.sort(key=lambda x: (str(x.get("data_prevista_entrega") or "9999-12-31"), str(x.get("pedido_numero") or "")))
    return detalhes


def _buscar_saldo_pi_bravi_periodo(
    codigos_pa: List[str],
    mapa_pa_pi: Dict[str, List[str]],
    granularidade: str = "mensal",
) -> List[Dict[str, Any]]:
    """
    Série mensal de saldo PI Bravi em transferência.

    Regra v45:
    - saldo de PI em transferência é estoque físico/operacional sem uma data de
      entrega futura confiável;
    - portanto ele pode aparecer no card/detalhe de entradas, mas não deve ser
      plotado como entrada prevista do mês atual;
    - no gráfico mensal, Bravi deve seguir a mesma regra dos demais itens com
      compra: usar data_prevista_entrega/data_previsao_necessidade dos pedidos.
    """
    return []


def _primeiro_valor_classificado(valores: List[Any], default: str = "A classificar") -> str:
    for valor in valores:
        texto = _texto_valido(valor)
        if texto and _eh_classificado(texto):
            return texto
    return default


def _valor_unico_ou_compartilhado(valores: List[Any], default: str = "A classificar") -> str:
    limpos = []
    vistos = set()

    for valor in valores:
        texto = _texto_valido(valor)
        if not texto or not _eh_classificado(texto):
            continue

        chave = texto.upper()
        if chave in vistos:
            continue

        vistos.add(chave)
        limpos.append(texto)

    if not limpos:
        return default

    if len(limpos) == 1:
        return limpos[0]

    return "Compartilhado"


def _linha_bom_from_texto(value: Any) -> Optional[str]:
    """
    Identifica a linha de negócio do pai da BOM quando a dimensão não traz
    classificação suficiente. Para insumos, a linha precisa vir do produto pai,
    não do cadastro do componente.
    """
    texto = str(value or "").strip().upper()
    if not texto:
        return None

    texto_norm = unicodedata.normalize("NFD", texto)
    texto_norm = "".join(ch for ch in texto_norm if unicodedata.category(ch) != "Mn")

    if "BENZOTOP" in texto_norm:
        return "Benzotop"

    if "PPS" in texto_norm:
        return "PPS"

    termos_anestesicos = [
        "ANEST", "ALPHACAINE", "ARTICAINE", "MEPISV", "MEPIADRE",
        "PRILONEST", "LIDOCAINE", "LIDOCAINA", "MEPIVACAINE",
        "MEPIVACAINA", "TUBETE PREP", "TUBETE PREPAR",
    ]
    if any(termo in texto_norm for termo in termos_anestesicos):
        return "Anestésicos Injetáveis"

    return None


def _linha_bom_from_produto_dim(produto: Optional[Dict[str, Any]], descricao_fallback: Any = None) -> str:
    """
    Linha gerencial do produto pai da BOM.

    Correção v36:
      - para classificar INSUMOS, a linha precisa vir do pai produtivo da BOM;
      - alguns pais de Benzotop ficaram com campo gerencial antigo/contaminado como PPS;
      - por isso, quando a descrição do pai indica claramente Benzotop ou Anestésicos,
        ela tem prioridade sobre campos cadastrais genéricos;
      - PPS continua existindo como produto acabado/revenda, mas não deve virar
        linha de insumo produzido.
    """
    produto = produto or {}

    # 1) Primeiro tenta identificar pela descrição do pai, que é a fonte mais
    # segura para a BOM atual. Ex.: 49050 - BENZOTOP TUTTI-FRUTTI A GRANEL.
    descricoes = [
        descricao_fallback,
        produto.get("desc_produto"),
        produto.get("concatenado_produto"),
    ]

    for valor in descricoes:
        linha = _linha_bom_from_texto(valor)
        if linha in {"Anestésicos Injetáveis", "Benzotop"}:
            return linha

    # 2) Depois usa campos gerenciais, aceitando primeiro apenas linhas produtivas.
    campos_gerenciais = [
        produto.get("tipo_negocio"),
        produto.get("macro_negocio"),
        produto.get("grupo_gerencial"),
        produto.get("familia"),
        produto.get("segmento"),
        produto.get("linha"),
    ]

    for valor in campos_gerenciais:
        texto = _texto_valido(valor)
        if texto and texto in {"Anestésicos Injetáveis", "Benzotop"}:
            return texto

        linha = _linha_bom_from_texto(valor)
        if linha in {"Anestésicos Injetáveis", "Benzotop"}:
            return linha

    # 3) PPS só é retornado para que a montagem das raízes consiga ignorá-lo.
    # Ele não deve classificar insumos no dashboard.
    for valor in list(campos_gerenciais) + list(descricoes):
        texto = _texto_valido(valor)
        if texto == "PPS":
            return "PPS"

        linha = _linha_bom_from_texto(valor)
        if linha == "PPS":
            return "PPS"

    return "A classificar"


def _linha_unica_ou_compartilhada(linhas: List[Any], default: str = "A classificar") -> str:
    limpas: List[str] = []
    vistos = set()

    for linha in linhas or []:
        texto = _texto_valido(linha)
        if not texto or not _eh_classificado(texto) or texto == "A classificar":
            continue
        chave = texto.upper()
        if chave in vistos:
            continue
        vistos.add(chave)
        limpas.append(texto)

    if not limpas:
        return default
    if len(limpas) == 1:
        return limpas[0]
    return "Compartilhado"


def _classificacao_bom_dict_from_linhas(linhas: List[Any]) -> Dict[str, Any]:
    linha = _linha_unica_ou_compartilhada(linhas)

    if linha == "Compartilhado":
        grupo = "Insumos - Compartilhados"
        modelo = "Insumo de produção compartilhado"
    elif linha in {"Anestésicos Injetáveis", "Benzotop", "PPS"}:
        grupo = f"Insumos - {linha}"
        modelo = "Insumo de produção"
    else:
        grupo = "Insumos - A classificar"
        modelo = "Insumo de produção"

    return {
        "macro_negocio": linha,
        "tipo_negocio": linha,
        "status_portfolio": "Ativo",
        "transferencia_bravi": "Não",
        "modelo_fornecimento": modelo,
        "grupo_gerencial": grupo,
        "familia": linha,
        "segmento": linha,
        "mercado": "NACIONAL",
        "origem_classificacao": "BOM",
        "linha_bom": linha,
    }


def _buscar_classificacao_bom(codigos: List[str], produtos_dim_all: Dict[str, dict]):
    """
    Classifica insumos pela linha do produto pai da BOM.

    Regra validada:
      - o componente não deve ser agrupado pela própria d_produtos;
      - a linha do insumo vem dos pais onde ele aparece na estrutura;
      - se aparece em pais de Anestésicos e Benzotop, vira Compartilhado;
      - PPS não explode insumo no cenário atual, então não deve aparecer por
        herança indevida do cadastro do componente.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return {}

    componentes_info = _buscar_componentes_bom_info()
    resultado: Dict[str, Dict[str, Any]] = {}

    for codigo in codigos_set:
        comp_info = componentes_info.get(codigo)
        if not comp_info:
            continue

        linhas_bom = comp_info.get("linhas_bom") or []
        classificacao = _classificacao_bom_dict_from_linhas(linhas_bom)
        classificacao["pais_bom"] = comp_info.get("pais_bom") or []
        classificacao["qtd_pais_bom"] = comp_info.get("qtd_pais_bom") or 0
        classificacao["linha_bom"] = comp_info.get("linha_bom")
        classificacao["tipo_negocio_bom"] = comp_info.get("tipo_negocio_bom")
        classificacao["macro_negocio_bom"] = comp_info.get("macro_negocio_bom")
        classificacao["grupo_gerencial_bom"] = comp_info.get("grupo_gerencial_bom")
        classificacao["tp"] = comp_info.get("tp")
        classificacao["tipo_componente_bom"] = comp_info.get("tp")
        classificacao["descricao_comp"] = comp_info.get("descricao_comp")
        resultado[codigo] = classificacao

    return resultado

def _buscar_faturamento_ytd(codigos: List[str]):
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return {}

    ano_atual = date.today().year

    rows = _select_all_por_codigos_variantes(
        "f_sd2_saidas",
        "produto",
        list(codigos_set),
        [
            "produto, quantidade, vlr_total, ano, mes, emissao",
            "produto, quantidade, vlr_total, ano, mes",
            "produto, quantidade, valor_total, ano, mes",
            "produto, quantidade, ano, mes",
        ],
    )

    vendas: Dict[str, Dict[str, float]] = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("produto"))

        if codigo not in codigos_set:
            continue

        ano, _mes = _ano_mes_sd2_row(row)
        if ano != ano_atual:
            continue

        if codigo not in vendas:
            vendas[codigo] = {
                "faturamento_ytd_qtd": 0.0,
                "faturamento_ytd_valor": 0.0,
            }

        vendas[codigo]["faturamento_ytd_qtd"] += _to_float(row.get("quantidade"))
        vendas[codigo]["faturamento_ytd_valor"] += _valor_total_sd2_row(row)

    return vendas




def _parse_data(value: Any) -> Optional[date]:
    """
    Normaliza datas vindas do Supabase/Protheus.

    Aceita:
      - date/datetime
      - YYYY-MM-DD
      - YYYY-MM-DDTHH:MM:SS
      - DD/MM/YYYY
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    texto = str(value).strip()

    if not texto:
        return None

    texto = texto[:10]

    try:
        if "-" in texto:
            return date.fromisoformat(texto)
    except Exception:
        pass

    try:
        if "/" in texto:
            dia, mes, ano = texto.split("/")[:3]
            return date(int(ano), int(mes), int(dia))
    except Exception:
        pass

    return None


def _normalizar_granularidade(value: Any) -> str:
    texto = str(value or "mensal").strip().lower()

    if texto in {"dia", "diario", "diária", "diaria", "daily"}:
        return "diaria"

    if texto in {"semana", "semanal", "weekly"}:
        return "semanal"

    return "mensal"


def _periodo_from_data(data_ref: date, granularidade: str) -> Dict[str, Any]:
    """
    Retorna uma chave ordenável e um rótulo amigável para a série do gráfico.
    """
    granularidade = _normalizar_granularidade(granularidade)

    if granularidade == "diaria":
        return {
            "key": data_ref.isoformat(),
            "ordem": data_ref.isoformat(),
            "data_inicio": data_ref.isoformat(),
            "data_fim": data_ref.isoformat(),
            "periodo": data_ref.strftime("%d/%m"),
            "periodo_completo": data_ref.strftime("%d/%m/%Y"),
            "ano": data_ref.year,
            "mes": data_ref.month,
        }

    if granularidade == "semanal":
        inicio = data_ref - timedelta(days=data_ref.weekday())
        fim = inicio + timedelta(days=6)
        return {
            "key": inicio.isoformat(),
            "ordem": inicio.isoformat(),
            "data_inicio": inicio.isoformat(),
            "data_fim": fim.isoformat(),
            "periodo": f"{inicio.strftime('%d/%m')} - {fim.strftime('%d/%m')}",
            "periodo_completo": f"{inicio.strftime('%d/%m/%Y')} - {fim.strftime('%d/%m/%Y')}",
            "ano": inicio.year,
            "mes": inicio.month,
        }

    return {
        "key": f"{data_ref.year}-{str(data_ref.month).zfill(2)}",
        "ordem": f"{data_ref.year}-{str(data_ref.month).zfill(2)}",
        "data_inicio": date(data_ref.year, data_ref.month, 1).isoformat(),
        "data_fim": None,
        "periodo": _mes_label(data_ref.month, data_ref.year),
        "periodo_completo": _mes_label(data_ref.month, data_ref.year),
        "ano": data_ref.year,
        "mes": data_ref.month,
    }


def _empty_periodo_row(info: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": info["key"],
        "ordem": info["ordem"],
        "periodo": info["periodo"],
        "periodo_completo": info.get("periodo_completo"),
        "data_inicio": info.get("data_inicio"),
        "data_fim": info.get("data_fim"),
        "ano": info.get("ano"),
        "mes": info.get("mes"),
        "estoque": None,
        "estoque_medio": None,
        "estoque_quarentena": None,
        "quarentena": None,
        "saldo_quarentena": None,
        "entradas_previstas": None,
        "faturamento_qtd": None,
        "faturamento_valor": None,
        "consumo": None,
        "demanda": None,
        "pedidos_detalhe": [],
        "faturamento_detalhe": [],
    }


def _buscar_faturamento_sd2_periodo(codigos: List[str], granularidade: str = "mensal") -> List[Dict[str, Any]]:
    """
    Busca faturamento/saídas na SD2 agrupado por granularidade.

    Uso principal:
      - visão Bravi: somente itens com transferencia_bravi = Sim;
      - detalhe do item: faturamento do SKU selecionado.

    Observação:
    Mantém a mesma fonte já usada no Aging para faturamento YTD: f_sd2_saidas.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return []

    granularidade = _normalizar_granularidade(granularidade)

    try:
        rows = _select_all_por_codigos(
            "f_sd2_saidas",
            "produto",
            list(codigos_set),
            "produto, quantidade, vlr_total, emissao",
        )
    except Exception:
        rows = []

    por_periodo: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("produto"))

        if codigo not in codigos_set:
            continue

        data_ref = _parse_data(row.get("emissao"))

        if not data_ref:
            continue

        info = _periodo_from_data(data_ref, granularidade)
        key = info["key"]

        if key not in por_periodo:
            por_periodo[key] = _empty_periodo_row(info)

        qtd = _to_float(row.get("quantidade"))
        valor = _to_float(row.get("vlr_total"))

        por_periodo[key]["faturamento_qtd"] = _round(
            _to_float(por_periodo[key].get("faturamento_qtd")) + qtd,
            4,
        )
        por_periodo[key]["faturamento_valor"] = _round(
            _to_float(por_periodo[key].get("faturamento_valor")) + valor,
            2,
        )

        if granularidade == "diaria":
            por_periodo[key]["faturamento_detalhe"].append({
                "data": data_ref.isoformat(),
                "codigo": codigo,
                "quantidade": _round(qtd, 4),
                "valor": _round(valor, 2),
            })

    return [
        por_periodo[k]
        for k in sorted(por_periodo.keys())
    ]



def _buscar_faturamento_sd2_ultimos_6m_por_codigo(codigos: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Retorna histórico mensal de faturamento dos últimos 6 meses por SKU.

    Correção v26:
      - usa ano/mes da f_sd2_saidas como fonte principal, igual a Overview;
      - aceita emissão/data apenas como fallback;
      - consulta código com e sem zero à esquerda.

    Isso evita o dashboard ficar com Histórico 6M zerado quando a SD2 existe,
    mas a tabela foi importada com produto 5111 enquanto a dimensão veio como 05111,
    ou quando a coluna emissao não está preenchida no processamento atual.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    if not codigos_norm:
        return {}

    hoje = date.today()
    meses_ref: List[Tuple[int, int]] = []
    for i in range(5, -1, -1):
        mes_base = hoje.month - i
        ano = hoje.year
        while mes_base <= 0:
            mes_base += 12
            ano -= 1
        meses_ref.append((ano, mes_base))

    meses_validos = set(meses_ref)
    resultado: Dict[str, Dict[Tuple[int, int], Dict[str, Any]]] = {
        codigo: {
            (ano, mes): {
                "ano": ano,
                "mes": mes,
                "periodo": _periodo_from_data(date(ano, mes, 1), "mensal").get("periodo"),
                "periodo_completo": _periodo_from_data(date(ano, mes, 1), "mensal").get("periodo_completo"),
                "faturamento_qtd": 0.0,
                "faturamento_valor": 0.0,
            }
            for ano, mes in meses_ref
        }
        for codigo in codigos_norm
    }

    rows = _select_all_por_codigos_variantes(
        "f_sd2_saidas",
        "produto",
        codigos_norm,
        [
            "produto, quantidade, vlr_total, ano, mes, emissao",
            "produto, quantidade, vlr_total, ano, mes",
            "produto, quantidade, valor_total, ano, mes",
            "produto, quantidade, ano, mes",
        ],
    )

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("produto"))
        if codigo not in resultado:
            continue

        ano, mes = _ano_mes_sd2_row(row)
        chave = (ano, mes)
        if chave not in meses_validos:
            continue

        ponto = resultado[codigo][chave]
        ponto["faturamento_qtd"] = _round(_to_float(ponto.get("faturamento_qtd")) + _to_float(row.get("quantidade")), 4)
        ponto["faturamento_valor"] = _round(_to_float(ponto.get("faturamento_valor")) + _valor_total_sd2_row(row), 2)

    return {
        codigo: [resultado[codigo][chave] for chave in meses_ref]
        for codigo in codigos_norm
    }



def _texto_tipo_forecast_sop(row: Dict[str, Any]) -> str:
    """Texto normalizado para identificar linhas Faturado/Forecast na base S&OP."""
    campos = [
        "tipo", "tipo_valor", "tipo_linha", "categoria", "cenario", "cenário",
        "versao", "versão", "origem", "fonte", "medida", "indicador", "status",
    ]
    partes = []
    for campo in campos:
        valor = row.get(campo)
        if valor is not None and str(valor).strip():
            partes.append(str(valor))
    texto = " ".join(partes).strip().upper()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
    texto = re.sub(r"\s+", " ", texto)
    return texto


def _row_forecast_sop_eh_faturado(row: Dict[str, Any]) -> bool:
    texto = _texto_tipo_forecast_sop(row)
    if not texto:
        # Bases em formato largo/normalizado podem não ter campo de tipo, mas
        # podem trazer colunas explícitas de faturado. Nesse caso, a existência
        # dessas colunas já é suficiente para usar como histórico realizado.
        return any(
            campo in row and _to_float(row.get(campo)) != 0
            for campo in [
                "qtd_faturado", "faturado_qtd", "faturado", "faturado_real",
                "qtd_realizado", "realizado_qtd", "realizado", "venda_real",
                "qtd_venda", "venda_qtd", "faturamento_qtd",
            ]
        )
    if "LY" in texto or "ANO ANTERIOR" in texto:
        return False
    return any(termo in texto for termo in ["FATURADO", "REALIZADO", "VENDA REAL", "VENDIDO"])




def _row_forecast_sop_eh_demanda_forecast(row: Dict[str, Any]) -> bool:
    """True para linhas que representam previsão/demanda futura na S&OP."""
    texto = _texto_tipo_forecast_sop(row)
    if not texto:
        return True

    # Não deixar histórico ou referência LY entrar como demanda futura.
    bloqueios = ["FATURADO", "REALIZADO", "VENDIDO", "VENDA REAL", "LY", "ANO ANTERIOR"]
    if any(termo in texto for termo in bloqueios):
        return False

    # Forecast firme/corrigido/orçamento são cenários válidos para demanda.
    permitidos = ["FORECAST", "CORRIGIDO", "ORCAMENTO", "ORÇAMENTO", "PREVISAO", "PREVISÃO", "DEMANDA", "S&OP", "SOP"]
    return any(termo in texto for termo in permitidos) or texto in {"", "V1"}

def _valor_faturado_forecast_sop(row: Dict[str, Any]) -> float:
    """Quantidade realizada na base S&OP/forecast, quando existir."""
    campos_explicitos = [
        "qtd_faturado", "faturado_qtd", "faturado", "faturado_real",
        "qtd_realizado", "realizado_qtd", "realizado", "venda_real",
        "qtd_venda", "venda_qtd", "faturamento_qtd",
    ]
    for campo in campos_explicitos:
        if campo in row:
            valor = _to_float(row.get(campo))
            if valor != 0:
                return valor

    # Quando a tabela vier em formato longo, a quantidade pode estar na mesma
    # coluna do forecast, diferenciada pelo campo tipo/cenário = Faturado.
    if _row_forecast_sop_eh_faturado(row):
        return _to_float(
            _coalesce(
                row.get("qtd_forecast"),
                row.get("forecast"),
                row.get("quantidade"),
                row.get("qtd"),
                row.get("valor"),
            )
        )

    return 0.0


def _buscar_faturamento_sop_ultimos_6m_por_codigo(codigos: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Histórico realizado vindo da própria base S&OP/Forecast, quando ela traz
    linhas/colunas de Faturado.

    Essa fonte é importante para PA/PPS porque é a mesma linha azul já validada
    no dashboard executivo de forecast. A SD2 fica como fallback quando a S&OP
    não trouxer faturado.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    if not codigos_norm:
        return {}

    hoje = date.today()
    meses_ref: List[Tuple[int, int]] = []
    for i in range(5, -1, -1):
        mes_base = hoje.month - i
        ano = hoje.year
        while mes_base <= 0:
            mes_base += 12
            ano -= 1
        meses_ref.append((ano, mes_base))

    meses_validos = set(meses_ref)
    resultado: Dict[str, Dict[Tuple[int, int], Dict[str, Any]]] = {
        codigo: {
            (ano, mes): {
                "ano": ano,
                "mes": mes,
                "periodo": _periodo_from_data(date(ano, mes, 1), "mensal").get("periodo"),
                "periodo_completo": _periodo_from_data(date(ano, mes, 1), "mensal").get("periodo_completo"),
                "faturamento_qtd": 0.0,
                "faturamento_valor": 0.0,
                "origem_historico": "forecast_sop_faturado",
            }
            for ano, mes in meses_ref
        }
        for codigo in codigos_norm
    }

    try:
        rows = _select_all_por_codigos(
            "f_forecast_sop",
            "cod_produto",
            codigos_norm,
            "*",
        )
    except Exception:
        rows = []

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("cod_produto"))
        if codigo not in resultado:
            continue

        ano = _to_int(row.get("ano"))
        mes = _to_int(row.get("mes"))
        if ano <= 0 or mes <= 0 or mes > 12:
            continue
        if (ano, mes) not in meses_validos:
            continue

        qtd = _valor_faturado_forecast_sop(row)
        if qtd == 0:
            continue

        ponto = resultado[codigo][(ano, mes)]
        ponto["faturamento_qtd"] = _round(_to_float(ponto.get("faturamento_qtd")) + qtd, 4)

    return {
        codigo: [resultado[codigo][chave] for chave in meses_ref]
        for codigo in codigos_norm
    }


def _buscar_historico_operacional_ultimos_6m_por_codigo(codigos: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Histórico 6M para PA/MR/PPS/PV na Gestão de Estoques.

    Regra validada com a Overview:
      - faturado/venda real vem da SD2 já processada em f_sd2_saidas;
      - f_sd2_saidas já aplica os filtros técnicos de venda válida no ETL:
        armazéns 03/04/07/27/88, PA/MR quando existir, sem AVULSO,
        sem estorno e Tipo Saída/TES classificado como Venda;
      - f_forecast_sop fica somente para previsão/demanda futura, não para histórico faturado.
    """
    return _buscar_faturamento_sd2_ultimos_6m_por_codigo(codigos)

def _buscar_compras_periodo(codigos: List[str], granularidade: str = "mensal") -> List[Dict[str, Any]]:
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return []

    granularidade = _normalizar_granularidade(granularidade)

    try:
        rows = _select_all_por_codigos(
            "f_compras_abertas",
            "produto_codigo",
            list(codigos_set),
            """
                produto_codigo,
                produto_descricao,
                quantidade_pendente,
                quantidade_sa,
                quantidade_pc,
                quantidade_entregue,
                data_prevista_entrega,
                data_previsao_necessidade,
                pedido_numero,
                pedido_item,
                sc_numero,
                sc_item,
                pedido_emissao,
                sc_emissao,
                razao_social_fornecedor,
                comprador_nome,
                entrega_status
            """,
        )
    except Exception:
        rows = []

    fups_por_codigo = {
        codigo: _buscar_compras_fup_por_codigo(codigo)
        for codigo in codigos_set
    }

    por_periodo: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        codigo = _normalizar_codigo(row.get("produto_codigo"))

        if codigo not in codigos_set:
            continue

        qtd = _to_float(row.get("quantidade_pendente"))

        if qtd <= 0:
            continue

        fup = _melhor_fup_para_pedido(row, fups_por_codigo.get(codigo, []))
        data_entrega_original = _data_prevista_compra(row)
        data_entrada_grafico = _data_entrada_grafico_compra(row, fup)
        data_ref = _parse_data(data_entrada_grafico)

        # Compra sem data prevista/necessidade não entra no gráfico mensal.
        # Ela continua podendo aparecer no total do card, mas não pode ser
        # jogada automaticamente no mês atual sem qualquer referência de data.
        if not data_ref:
            continue

        em_atraso, dias_atraso, status_operacional = _status_pedido_operacional(
            data_entrega_original,
            qtd,
            (fup or {}).get("status_fup"),
        )

        info = _periodo_from_data(data_ref, granularidade)
        key = info["key"]

        if key not in por_periodo:
            por_periodo[key] = _empty_periodo_row(info)

        por_periodo[key]["entradas_previstas"] = _round(
            _to_float(por_periodo[key].get("entradas_previstas")) + qtd,
            4,
        )
        por_periodo[key]["pedidos_detalhe"].append({
            # data_prevista_entrega permanece sendo a data original do Protheus.
            # data_entrada_grafico é só o bucket usado para projeção quando há atraso sem FUP.
            "data_prevista_entrega": data_entrega_original,
            "data_prevista_entrega_original": data_entrega_original,
            "data_entrada_grafico": data_entrada_grafico,
            "origem_data_entrada_grafico": (
                "nova_previsao_fup" if (fup or {}).get("nova_previsao_fup") else
                "mes_atual_pedido_atrasado_sem_fup" if em_atraso else
                _origem_data_prevista_compra(row)
            ),
            "data_previsao_necessidade": row.get("data_previsao_necessidade"),
            "origem_data_prevista": _origem_data_prevista_compra(row),
            "codigo": codigo,
            "quantidade_pendente": _round(qtd, 4),
            "pedido_numero": row.get("pedido_numero"),
            "pedido_item": row.get("pedido_item"),
            "sc_numero": row.get("sc_numero"),
            "sc_item": row.get("sc_item"),
            "pedido_emissao": row.get("pedido_emissao"),
            "sc_emissao": row.get("sc_emissao"),
            "nova_previsao_fup": (fup or {}).get("nova_previsao_fup"),
            "data_previsao_fup": (fup or {}).get("nova_previsao_fup"),
            "comentario_fup": (fup or {}).get("comentario_fup"),
            "status_fup": (fup or {}).get("status_fup"),
            "fornecedor": row.get("razao_social_fornecedor") or (fup or {}).get("fornecedor"),
            "comprador": row.get("comprador_nome") or (fup or {}).get("comprador"),
            "status_entrega": row.get("entrega_status"),
            "status_operacional": status_operacional,
            "em_atraso": em_atraso,
            "dias_atraso": dias_atraso,
        })

    return [
        por_periodo[k]
        for k in sorted(por_periodo.keys())
    ]

def _buscar_estoque_periodo(
    codigos: List[str],
    tipos_por_codigo: Optional[Dict[str, Any]] = None,
    granularidade: str = "mensal",
) -> List[Dict[str, Any]]:
    """
    Retorna série de estoque por granularidade a partir do SB8/f_estoque_saldo.

    Regra SB8:
      - saldo normal considera somente armazéns 04 e 07 para PA/MR/PPS/itens novos;
      - armazém 98 fica separado como quarentena;
      - saldo disponível = saldo_lote - empenho do lote.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return []

    granularidade = _normalizar_granularidade(granularidade)
    tipos_por_codigo = tipos_por_codigo or {}

    try:
        rows = _select_all_estoque_saldo_por_codigos(
            list(codigos_set),
            "*",
        )
        rows = sorted(rows, key=lambda r: str(r.get("data_ref") or r.get("data") or ""))
    except Exception:
        rows = []

    saldo_por_dia = defaultdict(lambda: {"normal": 0.0, "quarentena": 0.0})

    for row in rows:
        codigo = _codigo_sb8_linha(row)

        if codigo not in codigos_set:
            continue

        data_ref = _parse_data(row.get("data_ref"))

        if not data_ref:
            continue

        armazem = _normalizar_armazem_estoque(row)
        saldo_disponivel = _saldo_disponivel_lote(row)
        saldo_bruto = _saldo_lote_bruto(row)

        if armazem == "98":
            # Na SB8 o armazém 98 não é saldo disponível/liberado.
            # A coluna saldo_disponivel costuma vir 0 por regra de negócio,
            # mas para a tela precisamos mostrar o volume físico em quarentena.
            saldo_quarentena_98 = max(_to_float(saldo_bruto), _to_float(saldo_disponivel))
            saldo_por_dia[data_ref.isoformat()]["quarentena"] += saldo_quarentena_98
            continue

        armazens_validos = _armazens_sb8_normais_por_tipo(tipos_por_codigo.get(codigo))

        if armazem not in armazens_validos:
            continue

        saldo_por_dia[data_ref.isoformat()]["normal"] += saldo_disponivel

    valores_por_periodo = defaultdict(list)

    for data_txt, saldos in saldo_por_dia.items():
        data_ref = _parse_data(data_txt)

        if not data_ref:
            continue

        info = _periodo_from_data(data_ref, granularidade)
        valores_por_periodo[info["key"]].append({
            "info": info,
            "saldo": saldos["normal"],
            "quarentena": saldos["quarentena"],
            "data": data_ref.isoformat(),
        })

    resultado = []

    for key in sorted(valores_por_periodo.keys()):
        registros = valores_por_periodo[key]
        info = registros[0]["info"]
        ponto = _empty_periodo_row(info)

        if granularidade == "diaria":
            saldo = registros[-1]["saldo"]
            quarentena = registros[-1]["quarentena"]
        else:
            saldo = sum(r["saldo"] for r in registros) / max(1, len(registros))
            quarentena = sum(r["quarentena"] for r in registros) / max(1, len(registros))

        ponto["estoque"] = _round(saldo, 4)
        ponto["estoque_medio"] = _round(saldo, 4)
        ponto["estoque_quarentena"] = _round(quarentena, 4)
        ponto["quarentena"] = _round(quarentena, 4)
        ponto["saldo_quarentena"] = _round(quarentena, 4)
        resultado.append(ponto)

    return resultado


def _buscar_ultimo_saldo_sb8(
    codigos: List[str],
    tipos_por_codigo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Busca o último saldo disponível no SB8/f_estoque_saldo para cada código.

    Regras:
      - saldo normal considera somente 04 e 07 para PA/MR/PPS/itens novos;
      - armazém 98 é quarentena e fica separado;
      - saldo disponível = saldo_lote - empenho do lote;
      - quando a linha já existe na Posição de Estoque/Aging, o saldo principal
        continua vindo do Aging. Este fallback só preenche linhas sintéticas da
        d_produtos.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}

    if not codigos_set:
        return {}

    tipos_por_codigo = tipos_por_codigo or {}

    rows: List[Dict[str, Any]] = []
    for tentativa in range(3):
        try:
            rows = _select_all_estoque_saldo_por_codigos(
                list(codigos_set),
                "*",
            )
            break
        except Exception:
            rows = []
            if tentativa < 2:
                time.sleep(1)

    # Antes: pegava, por código, a maior data_ref entre as linhas que tinham
    # valor diferente de zero -- se um item saiu da quarentena hoje (upload de
    # hoje não tem mais linha dele no armazém 98), essa lógica "achava" um
    # upload de dias atrás com valor e mostrava ele como se fosse atual.
    # Agora usa o upload_id do envio mais recente da SB8 como critério: só
    # entra no cálculo (normal ou quarentena) quem pertence a esse upload
    # exato. Se não tem hoje, é zero -- sem cair pra histórico. Isso não
    # quebra o caso da FELIPRESSINA (comentário antigo abaixo): aquele
    # problema era acontecer no MESMO upload só que com data_ref do lote
    # diferente de hoje -- filtrar por upload_id não olha data_ref nenhuma,
    # só "essa linha pertence ao envio mais recente ou não".
    snapshot_sb8 = _latest_sb8_snapshot() or ""
    upload_id_mais_recente = snapshot_sb8.split("|", 1)[1] if "|" in snapshot_sb8 else None

    # Não filtra pela maior data_ref global da SB8. Em alguns uploads,
    # data_ref vem como data do lote/movimento, não como data única do snapshot.
    # Filtrar pela maior data global derrubava saldos válidos em quarentena
    # 98, como FELIPRESSINA, que está no arquivo atual mas com data própria do lote.
    rows = sorted(rows, key=lambda r: str(r.get("data_ref") or r.get("data") or ""))

    if upload_id_mais_recente:
        rows = [r for r in rows if str(r.get("upload_id") or "") == upload_id_mais_recente]

    saldo_por_codigo_dia: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {
            "saldo": 0.0,
            "quarentena": 0.0,
            "saldo_bruto": 0.0,
            "empenho": 0.0,
            "quarentena_bruta": 0.0,
            "empenho_quarentena": 0.0,
        })
    )

    for row in rows:
        codigo = _codigo_sb8_linha(row)

        if codigo not in codigos_set:
            continue

        data_ref = _parse_data(row.get("data_ref"))

        if not data_ref:
            continue

        # Já filtramos pelas linhas do upload mais recente acima -- não faz
        # mais sentido separar por data_ref do lote aqui (um código pode ter
        # lotes com datas diferentes de entrada em quarentena, todos válidos
        # hoje). Some tudo numa chave só. Se não tiver upload_id disponível
        # (fallback raro), mantém o agrupamento por data de antes.
        data_key = "atual" if upload_id_mais_recente else data_ref.isoformat()
        armazem = _normalizar_armazem_estoque(row)
        saldo_bruto = _saldo_lote_bruto(row)
        empenho = _valor_empenho_lote(row)
        saldo_disponivel = _saldo_disponivel_lote(row)

        if armazem == "98":
            # Armazém 98 representa material físico em quarentena/aguardando liberação.
            # No Supabase, saldo_disponivel pode estar 0 mesmo com saldo_lote/saldo_bruto > 0;
            # portanto a coluna Quarentena 98 deve usar o saldo físico bruto.
            saldo_quarentena_98 = max(_to_float(saldo_bruto), _to_float(saldo_disponivel))
            saldo_por_codigo_dia[codigo][data_key]["quarentena"] += saldo_quarentena_98
            saldo_por_codigo_dia[codigo][data_key]["quarentena_bruta"] += saldo_bruto
            saldo_por_codigo_dia[codigo][data_key]["empenho_quarentena"] += empenho
            continue

        armazens_validos = _armazens_sb8_normais_por_tipo(tipos_por_codigo.get(codigo))

        if armazem not in armazens_validos:
            continue

        saldo_por_codigo_dia[codigo][data_key]["saldo"] += saldo_disponivel
        saldo_por_codigo_dia[codigo][data_key]["saldo_bruto"] += saldo_bruto
        saldo_por_codigo_dia[codigo][data_key]["empenho"] += empenho

    resultado: Dict[str, Dict[str, Any]] = {}

    for codigo, saldos_por_dia in saldo_por_codigo_dia.items():
        if not saldos_por_dia:
            continue

        # Antes era usada a maior data geral do código. Isso perdia a quarentena 98
        # quando o armazém 98 tinha data diferente do saldo normal.
        # Agora pegamos a última data do saldo normal e a última data do 98 separadamente.
        datas_normal = [
            data_key
            for data_key, valores in saldos_por_dia.items()
            if _to_float(valores.get("saldo")) != 0
            or _to_float(valores.get("saldo_bruto")) != 0
            or _to_float(valores.get("empenho")) != 0
        ]
        datas_quarentena = [
            data_key
            for data_key, valores in saldos_por_dia.items()
            if _to_float(valores.get("quarentena")) != 0
            or _to_float(valores.get("quarentena_bruta")) != 0
            or _to_float(valores.get("empenho_quarentena")) != 0
        ]

        ultima_data_normal = max(datas_normal) if datas_normal else max(saldos_por_dia.keys())
        ultima_data_quarentena = max(datas_quarentena) if datas_quarentena else None

        valores_normal = saldos_por_dia[ultima_data_normal]
        valores_quarentena = (
            saldos_por_dia[ultima_data_quarentena]
            if ultima_data_quarentena
            else {
                "quarentena": 0.0,
                "quarentena_bruta": 0.0,
                "empenho_quarentena": 0.0,
            }
        )

        data_ref_upload_atual = snapshot_sb8.split("|", 1)[0] if "|" in snapshot_sb8 else None

        ultima_data_normal_reportada = (
            data_ref_upload_atual if (upload_id_mais_recente and ultima_data_normal == "atual") else ultima_data_normal
        )
        ultima_data_quarentena_reportada = (
            data_ref_upload_atual
            if (upload_id_mais_recente and ultima_data_quarentena == "atual")
            else ultima_data_quarentena
        )

        data_ref_geral = max([d for d in [ultima_data_normal_reportada, ultima_data_quarentena_reportada] if d])

        armazens_normais_codigo = _armazens_sb8_normais_por_tipo(tipos_por_codigo.get(codigo))

        # Decisão de negócio confirmada: para PA/MR/PPS (armazém 04/07), o
        # "Estoque atual" é o saldo BRUTO da SB8, sem descontar empenho --
        # mesma regra aplicada em _buscar_saldo_sb8_exato_produtos, pra não
        # ter dois caminhos de cálculo divergentes pro mesmo campo (era
        # exatamente essa divergência que fazia o valor "piscar" dependendo
        # de qual dos dois caminhos atendia a requisição). Para MP/ME/MI
        # (armazém 01) mantém o líquido, que não fez parte dessa decisão.
        saldo_para_tela = (
            valores_normal["saldo_bruto"]
            if armazens_normais_codigo == {"04", "07"}
            else valores_normal["saldo"]
        )

        resultado[codigo] = {
            "saldo": _round(saldo_para_tela, 4),
            "saldo_bruto": _round(valores_normal["saldo_bruto"], 4),
            "empenho": _round(valores_normal["empenho"], 4),
            "saldo_quarentena": _round(valores_quarentena["quarentena"], 4),
            "quarentena_bruta": _round(valores_quarentena["quarentena_bruta"], 4),
            "empenho_quarentena": _round(valores_quarentena["empenho_quarentena"], 4),
            "data_ref": data_ref_geral,
            "data_ref_saldo": ultima_data_normal_reportada,
            "data_ref_quarentena": ultima_data_quarentena_reportada,
            "armazens_normais": sorted(armazens_normais_codigo),
            "armazem_quarentena": "98",
        }

    return resultado



def _tipo_produto_erp_por_codigo(
    codigo: str,
    row: Optional[Dict[str, Any]] = None,
    produtos_all: Optional[Dict[str, dict]] = None,
) -> str:
    """
    Retorna o tipo ERP mais confiável do item.

    Prioridade:
      1. d_produtos.tipo_produto_erp;
      2. linha da posição de estoque/Aging;
      3. vazio.
    """
    codigo_norm = _normalizar_codigo(codigo)
    produto_dim = (produtos_all or {}).get(codigo_norm) or {}
    return str(
        _coalesce(
            produto_dim.get("tipo_produto_erp"),
            (row or {}).get("tipo"),
            (row or {}).get("tipo_produto_erp"),
            "",
        ) or ""
    ).strip().upper()


def _item_usa_saldo_sb8_como_oficial(tipo: Optional[str]) -> bool:
    """
    Define quando a Gestão de Estoque deve usar SB8 como saldo oficial.

    Regra fechada:
      - Insumos MP/ME/MI continuam usando Posição Estoque/Aging como oficial;
      - PA usa SB8;
      - MR é produto acabado comprado e usa SB8;
      - PPS/PV/revenda também usam SB8 quando estiverem no cadastro comercial.
    """
    tipo_norm = str(tipo or "").strip().upper()
    return tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}


def _codigo_sb8_linha(row: Dict[str, Any]) -> str:
    """
    Código do produto na SB8.

    Dependendo do processor, a coluna pode chegar como codigo, produto ou cod_produto.
    A regra é sempre comparar por código exato, nunca por descrição.
    """
    return _normalizar_codigo(
        _coalesce(
            row.get("codigo"),
            row.get("produto"),
            row.get("cod_produto"),
            row.get("produto_codigo"),
            row.get("B8_PRODUTO"),
            row.get("b8_produto"),
        )
    )


def _buscar_saldo_sb8_exato_produtos(codigos: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Saldo oficial PA/MR/PPS pela SB8 com código exato.

    Regra fechada para Produtos:
    - Estoque disponível: somente armazéns 04 e 07;
    - Quarentena: somente armazém 98 exato;
    - Não considera 10, 88, 96, 97 como estoque disponível nem quarentena;
    - Não busca por descrição, somente código exato;
    - PI/intermediário de Bravi entra como entrada prevista, não como estoque/quarentena do PA.

    Correção v20:
    - a busca na SB8 é robusta para colunas de código diferentes
      (codigo/produto/cod_produto/produto_codigo/B8_PRODUTO);
    - saldo normal e quarentena 98 são tratados com datas independentes.
      Na prática, a linha de quarentena pode ter data_ref diferente da linha 04/07.
      Antes a rotina usava uma única "última data" do código; se nessa foto não
      existisse armazém 98, a quarentena sumia em PA/MR, embora aparecesse em insumos.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}
    if not codigos_set:
        return {}

    rows: List[Dict[str, Any]] = []
    for tentativa in range(3):
        try:
            rows = _select_all_estoque_saldo_por_codigos(
                list(codigos_set),
                "*",
            )
            break
        except Exception:
            rows = []
            if tentativa < 2:
                time.sleep(1)

    # Mesma correção de _buscar_ultimo_saldo_sb8: filtra pelo upload mais
    # recente da SB8 antes de somar, pra código sem linha hoje (ex.: saiu da
    # quarentena) dar zero em vez de repescar upload de dias atrás.
    snapshot_sb8 = _latest_sb8_snapshot() or ""
    upload_id_mais_recente = snapshot_sb8.split("|", 1)[1] if "|" in snapshot_sb8 else None
    if upload_id_mais_recente:
        rows = [r for r in rows if str(r.get("upload_id") or "") == upload_id_mais_recente]

    # Acumula por código + data_ref para evitar somar snapshots distintos.
    por_codigo_data: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(
        lambda: defaultdict(lambda: {
            "saldo": 0.0,
            "saldo_bruto": 0.0,
            "empenho": 0.0,
            "saldo_quarentena": 0.0,
            "quarentena_bruta": 0.0,
            "empenho_quarentena": 0.0,
            "data_key": None,
            "tem_linha_saldo_0407": False,
            "tem_linha_quarentena_98": False,
        })
    )

    for row in rows or []:
        codigo = _codigo_sb8_linha(row)
        if codigo not in codigos_set:
            continue

        data_ref = _parse_data(
            _coalesce(
                row.get("data_ref"),
                row.get("data_snapshot"),
                row.get("snapshot"),
                row.get("atualizado_em"),
                row.get("created_at"),
                row.get("data"),
            )
        )
        # Já filtrado pelo upload mais recente acima -- some tudo numa chave
        # só em vez de separar por data_ref do lote (ver comentário em
        # _buscar_ultimo_saldo_sb8). Sem upload_id disponível, mantém o
        # agrupamento por data de antes.
        data_key = "atual" if upload_id_mais_recente else (data_ref.isoformat() if data_ref else "sem_data_ref")

        armazem = _normalizar_armazem_estoque(row)
        saldo_bruto = _saldo_lote_bruto(row)
        empenho = _valor_empenho_lote(row)
        saldo_disp = _saldo_disponivel_lote(row)

        bucket = por_codigo_data[codigo][data_key]
        bucket["data_key"] = data_key

        if armazem == "98":
            bucket["tem_linha_quarentena_98"] = True
            # Para quarentena 98 mostramos o saldo físico.
            # saldo_disponivel normalmente vem 0 quando ainda não está liberado.
            saldo_quarentena_98 = max(_to_float(saldo_bruto), _to_float(saldo_disp))
            bucket["saldo_quarentena"] += saldo_quarentena_98
            bucket["quarentena_bruta"] += saldo_bruto
            bucket["empenho_quarentena"] += empenho
            continue

        if armazem in {"04", "07"}:
            bucket["tem_linha_saldo_0407"] = True
            bucket["saldo"] += saldo_disp
            bucket["saldo_bruto"] += saldo_bruto
            bucket["empenho"] += empenho

    saida: Dict[str, Dict[str, Any]] = {}

    for codigo in codigos_set:
        saldos_por_data = por_codigo_data.get(codigo) or {}

        if not saldos_por_data:
            saida[codigo] = {
                "saldo": 0.0,
                "saldo_bruto": 0.0,
                "empenho": 0.0,
                "saldo_quarentena": 0.0,
                "quarentena_bruta": 0.0,
                "empenho_quarentena": 0.0,
                "data_ref": None,
                "data_ref_saldo": None,
                "data_ref_quarentena": None,
                "armazens_saldo_origem": ["04", "07"],
                "armazem_quarentena": "98",
                "regra_saldo": "sb8_exata_codigo_produtos_04_07_98_v20_sem_linha_sb8",
            }
            continue

        datas_normal = [
            data_key
            for data_key, valores in saldos_por_data.items()
            if bool(valores.get("tem_linha_saldo_0407"))
            or _to_float(valores.get("saldo")) != 0
            or _to_float(valores.get("saldo_bruto")) != 0
            or _to_float(valores.get("empenho")) != 0
        ]
        datas_quarentena = [
            data_key
            for data_key, valores in saldos_por_data.items()
            if bool(valores.get("tem_linha_quarentena_98"))
            or _to_float(valores.get("saldo_quarentena")) != 0
            or _to_float(valores.get("quarentena_bruta")) != 0
            or _to_float(valores.get("empenho_quarentena")) != 0
        ]

        ultima_data_normal = max(datas_normal) if datas_normal else None
        ultima_data_quarentena = max(datas_quarentena) if datas_quarentena else None

        valores_normal = (
            saldos_por_data[ultima_data_normal]
            if ultima_data_normal
            else {
                "saldo": 0.0,
                "saldo_bruto": 0.0,
                "empenho": 0.0,
                "tem_linha_saldo_0407": False,
            }
        )
        valores_quarentena = (
            saldos_por_data[ultima_data_quarentena]
            if ultima_data_quarentena
            else {
                "saldo_quarentena": 0.0,
                "quarentena_bruta": 0.0,
                "empenho_quarentena": 0.0,
                "tem_linha_quarentena_98": False,
            }
        )

        saldo_disp = _to_float(valores_normal.get("saldo"))
        saldo_bruto = _to_float(valores_normal.get("saldo_bruto"))
        empenho = _to_float(valores_normal.get("empenho"))
        # Decisão de negócio confirmada: "Estoque atual" de PA/MR/PPS é o saldo
        # BRUTO da SB8 (soma direta dos armazéns 04/07), sem descontar empenho.
        # Antes usava o disponível líquido (bruto - empenho por lote, com piso
        # em 0 por lote) -- além de não ser o valor que a área quer ver aqui,
        # esse cálculo por lote já vinha divergindo do simples "bruto - empenho
        # total" em casos reais (ex.: Benzotop 52749: bruto 85.071, empenho
        # 600, mas o líquido por lote dava 84.751 em vez de 84.471).
        saldo_calculado = max(0.0, saldo_bruto - empenho)
        saldo_final = saldo_bruto

        data_ref_upload_atual = snapshot_sb8.split("|", 1)[0] if "|" in snapshot_sb8 else None
        ultima_data_normal_reportada = (
            data_ref_upload_atual if (upload_id_mais_recente and ultima_data_normal == "atual") else ultima_data_normal
        )
        ultima_data_quarentena_reportada = (
            data_ref_upload_atual
            if (upload_id_mais_recente and ultima_data_quarentena == "atual")
            else ultima_data_quarentena
        )

        datas_validas = [d for d in [ultima_data_normal_reportada, ultima_data_quarentena_reportada] if d and d != "sem_data_ref"]
        data_ref_geral = max(datas_validas) if datas_validas else None
        data_ref_saldo = None if ultima_data_normal_reportada in {None, "sem_data_ref"} else ultima_data_normal_reportada
        data_ref_quarentena = None if ultima_data_quarentena_reportada in {None, "sem_data_ref"} else ultima_data_quarentena_reportada

        tem_linha_saldo_0407 = bool(valores_normal.get("tem_linha_saldo_0407"))
        tem_linha_quarentena_98 = bool(valores_quarentena.get("tem_linha_quarentena_98"))

        saida[codigo] = {
            "saldo": _round(saldo_final, 4),
            "saldo_bruto": _round(saldo_bruto, 4),
            "empenho": _round(empenho, 4),
            "saldo_quarentena": _round(_to_float(valores_quarentena.get("saldo_quarentena")), 4),
            "quarentena_bruta": _round(_to_float(valores_quarentena.get("quarentena_bruta")), 4),
            "empenho_quarentena": _round(_to_float(valores_quarentena.get("empenho_quarentena")), 4),
            "data_ref": data_ref_geral,
            "data_ref_saldo": data_ref_saldo,
            "data_ref_quarentena": data_ref_quarentena,
            "tem_linha_saldo_0407_no_dia": tem_linha_saldo_0407,
            "tem_linha_quarentena_98_no_dia": tem_linha_quarentena_98,
            "armazens_saldo_origem": ["04", "07"],
            "armazem_quarentena": "98",
            "regra_saldo": "sb8_exata_codigo_produtos_04_07_98_v20_datas_independentes_saldo_quarentena",
        }

    return saida

def _aplicar_saldo_sb8_exato_produtos_tela(
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
) -> List[Dict[str, Any]]:
    """
    Última camada de segurança para PA/MR oficiais.

    Regra v31:
      - no fast path de produtos, a lista já vem da d_produtos com ativo_analise=True;
      - portanto TODOS esses códigos devem buscar saldo oficial na SB8 por código exato;
      - não depende mais apenas do tipo_produto_erp para aplicar saldo, porque um
        cadastro com tipo vazio/inconsistente fazia os 177 PA/MR ficarem com saldo zero;
      - estoque disponível: armazéns 04 e 07;
      - quarentena: armazém 98 separado.
    """
    codigos_produtos: List[str] = []

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue

        produto_dim = produtos_all.get(codigo) if produtos_all else None
        tipo = _tipo_produto_erp_por_codigo(codigo, row=row, produtos_all=produtos_all)
        eh_produto_oficial = _produto_ativo_analise(produto_dim) if produto_dim else False

        if not eh_produto_oficial and not _item_deve_usar_saldo_sb8_produto(codigo, tipo):
            continue

        codigos_produtos.append(codigo)

    codigos_produtos = sorted(set(codigos_produtos))
    if not codigos_produtos:
        return rows

    saldos_exatos = _buscar_saldo_sb8_exato_produtos(codigos_produtos)

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue

        produto_dim = produtos_all.get(codigo) if produtos_all else None
        tipo = _tipo_produto_erp_por_codigo(codigo, row=row, produtos_all=produtos_all)
        eh_produto_oficial = _produto_ativo_analise(produto_dim) if produto_dim else False

        if not eh_produto_oficial and not _item_deve_usar_saldo_sb8_produto(codigo, tipo):
            continue

        saldo_info = saldos_exatos.get(codigo)
        if saldo_info is None:
            continue

        saldo_sb8_dia = _to_float(saldo_info.get("saldo"))
        saldo_posicao = _to_float(row.get("saldo"))
        tem_linha_saldo_0407 = bool(saldo_info.get("tem_linha_saldo_0407_no_dia"))

        # Regra validada: saldo do dia em 04/07 é a fonte SB8.
        # Quando a foto SB8 do dia não traz linha 04/07 para o SKU, preserva a
        # Posição de Estoque/Aging como fallback operacional da mesma tela.
        # Isso evita carregar saldo antigo de 04/07 e mantém casos em que a
        # posição oficial já mostra saldo do dia.
        if tem_linha_saldo_0407 or saldo_posicao <= 0:
            saldo_final_tela = saldo_sb8_dia
            origem_saldo_tela = "sb8_exata_codigo_produtos_04_07_mesma_data_ref_v39"
            data_saldo_tela = saldo_info.get("data_ref_saldo") or saldo_info.get("data_ref")
        else:
            saldo_final_tela = saldo_posicao
            origem_saldo_tela = "posicao_estoque_fallback_sem_0407_na_sb8_do_dia_v39"
            data_saldo_tela = row.get("data_snapshot") or saldo_info.get("data_ref")

        row["saldo"] = saldo_final_tela
        row["__saldo_origem"] = origem_saldo_tela
        row["__data_saldo_origem"] = data_saldo_tela
        row["__saldo_quarentena"] = _to_float(saldo_info.get("saldo_quarentena"))
        row["__saldo_sb8_bruto"] = _to_float(saldo_info.get("saldo_bruto"))
        row["__empenho_lote"] = _to_float(saldo_info.get("empenho"))
        row["__saldo_quarentena_bruto"] = _to_float(saldo_info.get("quarentena_bruta"))
        row["__empenho_quarentena"] = _to_float(saldo_info.get("empenho_quarentena"))
        row["__data_quarentena_origem"] = saldo_info.get("data_ref_quarentena")
        row["__armazens_saldo_origem"] = saldo_info.get("armazens_saldo_origem")
        row["__armazem_quarentena"] = saldo_info.get("armazem_quarentena")
        row["__tem_linha_saldo_0407_no_dia"] = saldo_info.get("tem_linha_saldo_0407_no_dia")
        row["__tem_linha_quarentena_98_no_dia"] = saldo_info.get("tem_linha_quarentena_98_no_dia")

    return rows


def _aplicar_saldo_sb8_em_produtos(
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
) -> List[Dict[str, Any]]:
    """
    Aplica a fonte oficial de saldo para PA/MR/PPS.

    Para insumos, a fonte oficial continua sendo a posição de estoque/Aging.
    Para PA/MR/PPS, a fonte oficial deve ser a SB8 nos armazéns comerciais/produtivos
    definidos para a tela, com quarentena 98 separada e sem somar no disponível.
    """
    codigos_produtos: List[str] = []
    tipos_por_codigo: Dict[str, Any] = {}

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue

        tipo = _tipo_produto_erp_por_codigo(codigo, row=row, produtos_all=produtos_all)
        if not _item_deve_usar_saldo_sb8_produto(codigo, tipo):
            continue

        codigos_produtos.append(codigo)
        tipos_por_codigo[codigo] = tipo

    codigos_produtos = sorted(set(codigos_produtos))

    if not codigos_produtos:
        return rows

    saldos_sb8 = _buscar_ultimo_saldo_sb8(
        codigos_produtos,
        tipos_por_codigo=tipos_por_codigo,
    )

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue

        tipo = _tipo_produto_erp_por_codigo(codigo, row=row, produtos_all=produtos_all)
        if not _item_deve_usar_saldo_sb8_produto(codigo, tipo):
            # Insumos seguem com Posição Estoque/Aging como saldo oficial.
            row.setdefault("__saldo_origem", row.get("__saldo_origem") or "f_consumo_materiais")
            continue

        saldo_info = saldos_sb8.get(codigo)
        if not saldo_info:
            row.setdefault("__saldo_origem", "sb8_sem_saldo_para_produto")
            continue

        row["saldo"] = _to_float(saldo_info.get("saldo"))
        row["__saldo_origem"] = "ultimo_sb8_04_07_menos_empenho"
        row["__data_saldo_origem"] = saldo_info.get("data_ref")
        row["__saldo_quarentena"] = _to_float(saldo_info.get("saldo_quarentena"))
        row["__saldo_sb8_bruto"] = _to_float(saldo_info.get("saldo_bruto"))
        row["__empenho_lote"] = _to_float(saldo_info.get("empenho"))
        row["__saldo_quarentena_bruto"] = _to_float(saldo_info.get("quarentena_bruta"))
        row["__empenho_quarentena"] = _to_float(saldo_info.get("empenho_quarentena"))
        row["__armazens_saldo_origem"] = saldo_info.get("armazens_normais")
        row["__armazem_quarentena"] = saldo_info.get("armazem_quarentena")

    return rows


def _aplicar_quarentena_sb8_98_em_todos_os_itens(
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
) -> List[Dict[str, Any]]:
    """
    Preenche a coluna Quarentena 98 para todos os escopos.

    O saldo oficial de MP/ME/MI continua vindo da Posição de Estoque/Aging.
    Porém a quarentena 98 fica na SB8/f_estoque_saldo e precisa aparecer
    separada na tabela de insumos.
    """
    codigos = sorted({
        _normalizar_codigo(row.get("codigo"))
        for row in (rows or [])
        if _normalizar_codigo(row.get("codigo"))
    })

    if not codigos:
        return rows

    tipos_por_codigo = {
        codigo: _tipo_produto_erp_por_codigo(codigo, row=None, produtos_all=produtos_all)
        for codigo in codigos
    }

    saldos_sb8 = _buscar_ultimo_saldo_sb8(
        codigos,
        tipos_por_codigo=tipos_por_codigo,
    )

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        saldo_info = saldos_sb8.get(codigo)

        if not saldo_info:
            continue

        row["__saldo_quarentena"] = _to_float(saldo_info.get("saldo_quarentena"))
        row["__saldo_quarentena_bruto"] = _to_float(saldo_info.get("quarentena_bruta"))
        row["__empenho_quarentena"] = _to_float(saldo_info.get("empenho_quarentena"))
        row["__armazem_quarentena"] = saldo_info.get("armazem_quarentena")
        row["__data_quarentena_origem"] = saldo_info.get("data_ref_quarentena")

    return rows


def _aplicar_saldo_sb8_em_linhas_sinteticas(
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
) -> List[Dict[str, Any]]:
    """
    Preenche saldo principal de linhas vindas só da d_produtos usando último SB8.

    A linha continua marcada como sem posição no Aging, porque não veio da
    f_consumo_materiais, mas passa a refletir o saldo real disponível no estoque
    diário. Isso evita casos como 52875 aparecer com saldo 0 mesmo tendo saldo
    em f_estoque_saldo.
    """
    codigos_sinteticos = [
        _normalizar_codigo(row.get("codigo"))
        for row in (rows or [])
        if row.get("__origem_linha_estoque") == "d_produtos_sem_snapshot_aging"
        and _normalizar_codigo(row.get("codigo"))
    ]

    if not codigos_sinteticos:
        return rows

    tipos_por_codigo = {
        codigo: (produtos_all.get(codigo) or {}).get("tipo_produto_erp")
        for codigo in codigos_sinteticos
    }

    saldos_sb8 = _buscar_ultimo_saldo_sb8(
        codigos_sinteticos,
        tipos_por_codigo=tipos_por_codigo,
    )

    for row in rows or []:
        if row.get("__origem_linha_estoque") != "d_produtos_sem_snapshot_aging":
            continue

        codigo = _normalizar_codigo(row.get("codigo"))
        saldo_info = saldos_sb8.get(codigo)

        if not saldo_info:
            row.setdefault("__saldo_origem", "d_produtos_sem_snapshot_aging_sem_sb8")
            continue

        row["saldo"] = _to_float(saldo_info.get("saldo"))
        row["__saldo_origem"] = "ultimo_sb8_04_07_menos_empenho"
        row["__data_saldo_origem"] = saldo_info.get("data_ref")
        row["__saldo_quarentena"] = _to_float(saldo_info.get("saldo_quarentena"))
        row["__saldo_sb8_bruto"] = _to_float(saldo_info.get("saldo_bruto"))
        row["__empenho_lote"] = _to_float(saldo_info.get("empenho"))
        row["__saldo_quarentena_bruto"] = _to_float(saldo_info.get("quarentena_bruta"))
        row["__empenho_quarentena"] = _to_float(saldo_info.get("empenho_quarentena"))
        row["__armazens_saldo_origem"] = saldo_info.get("armazens_normais")
        row["__armazem_quarentena"] = saldo_info.get("armazem_quarentena")

        if not row.get("nome_2") or row.get("nome_2") == "Sem posição no Aging":
            row["nome_2"] = "Sem posição no Aging; saldo via SB8"

    return rows


def _corrigir_estoque_serie_item_pa_mr(
    serie: List[Dict[str, Any]],
    saldo_info: Dict[str, Any],
    granularidade: str,
) -> List[Dict[str, Any]]:
    """
    Corrige somente a série do gráfico PA/MR por item.

    Problema observado:
    - resumo/tabela do SUGCLEAN vinha correto com estoque atual 1.030;
    - série do gráfico ainda vinha com estoque 1.052 em Jun/26.

    Regra:
    - estoque/quarentena do gráfico por item deve usar o mesmo saldo do resumo/tabela;
    - não usar o estoque calculado pela série histórica para o item PA/MR;
    - passado não inventa estoque;
    - período atual mostra a foto atual;
    - futuro mantém entradas/forecast e não recebe estoque histórico.
    """
    granularidade_norm = _normalizar_granularidade(granularidade)
    info_atual = _periodo_from_data(date.today(), granularidade_norm)
    ordem_atual = str(info_atual.get("ordem") or info_atual.get("key"))

    saldo_atual = _to_float(saldo_info.get("saldo"))
    quarentena_atual = _to_float(saldo_info.get("saldo_quarentena"))

    corrigida: List[Dict[str, Any]] = []

    for ponto in serie or []:
        ponto_saida = dict(ponto)
        ordem = str(ponto_saida.get("ordem") or ponto_saida.get("key") or "")

        ponto_saida["estoque"] = None
        ponto_saida["estoque_medio"] = None
        ponto_saida["estoque_quarentena"] = None
        ponto_saida["quarentena"] = None
        ponto_saida["saldo_quarentena"] = None

        if ordem == ordem_atual:
            ponto_saida["estoque"] = _round(saldo_atual, 4) if saldo_atual > 0 else None
            ponto_saida["estoque_medio"] = _round(saldo_atual, 4) if saldo_atual > 0 else None
            ponto_saida["estoque_quarentena"] = _round(quarentena_atual, 4) if quarentena_atual > 0 else 0.0
            ponto_saida["quarentena"] = _round(quarentena_atual, 4) if quarentena_atual > 0 else 0.0
            ponto_saida["saldo_quarentena"] = _round(quarentena_atual, 4) if quarentena_atual > 0 else 0.0
            ponto_saida["tipo_estoque"] = "atual_corrigido_resumo"

        corrigida.append(ponto_saida)

    return corrigida


def _merge_series_periodo(*series: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapa: Dict[str, Dict[str, Any]] = {}

    for serie in series:
        for ponto in serie or []:
            key = str(ponto.get("key") or ponto.get("periodo") or "")

            if not key:
                continue

            if key not in mapa:
                mapa[key] = {
                    "key": key,
                    "ordem": ponto.get("ordem") or key,
                    "periodo": ponto.get("periodo"),
                    "periodo_completo": ponto.get("periodo_completo"),
                    "data_inicio": ponto.get("data_inicio"),
                    "data_fim": ponto.get("data_fim"),
                    "ano": ponto.get("ano"),
                    "mes": ponto.get("mes"),
                    "estoque": None,
                    "estoque_medio": None,
                    "estoque_quarentena": None,
                    "quarentena": None,
                    "saldo_quarentena": None,
                    "entradas_previstas": None,
                    "faturamento_qtd": None,
                    "faturamento_valor": None,
                    "consumo": None,
                    "demanda": None,
                    "pedidos_detalhe": [],
                    "faturamento_detalhe": [],
                }

            for campo in [
                "estoque",
                "estoque_medio",
                "estoque_quarentena",
                "quarentena",
                "saldo_quarentena",
                "entradas_previstas",
                "faturamento_qtd",
                "faturamento_valor",
                "consumo",
                "demanda",
            ]:
                valor = ponto.get(campo)
                if valor is not None:
                    mapa[key][campo] = valor

            for campo in ["pedidos_detalhe", "faturamento_detalhe"]:
                if ponto.get(campo):
                    mapa[key][campo].extend(ponto.get(campo) or [])

    return [
        mapa[k]
        for k in sorted(mapa.keys(), key=lambda k: mapa[k].get("ordem") or k)
    ]


def _consumo_mensal_por_rows(rows: List[Dict[str, Any]], granularidade: str = "mensal") -> List[Dict[str, Any]]:
    """
    Consumo do Aging vem como colunas mensais na f_consumo_materiais.
    Por isso, para semanal/diária não há base real de consumo; retornamos mensal.
    """
    granularidade = _normalizar_granularidade(granularidade)

    if granularidade != "mensal":
        return []

    acumulado = defaultdict(float)

    for row in rows or []:
        for ponto in _historico_consumo(row):
            ano = int(ponto.get("ano") or 0)
            mes = int(ponto.get("mes") or 0)
            if ano <= 0 or mes <= 0:
                continue
            acumulado[(ano, mes)] += _to_float(ponto.get("consumo"))

    resultado = []

    for (ano, mes), valor in sorted(acumulado.items()):
        data_ref = date(ano, mes, 1)
        info = _periodo_from_data(data_ref, "mensal")
        ponto = _empty_periodo_row(info)
        ponto["consumo"] = _round(valor, 4)
        resultado.append(ponto)

    return resultado


def _buscar_codigos_bravi_da_base(base: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Retorna os itens Bravi da base final da Gestão de Estoque.

    Como _build_base agora une f_consumo_materiais + d_produtos, o universo
    passa a incluir também PA/MR/PPS cadastrados que não estão na BOM ou no
    snapshot atual. Assim, Bravi, Agulha e One Step Drop Mini Kit não dependem
    da d_bom_estrutura para aparecer.
    """
    base = base or _build_base()
    itens = [
        item for item in base.get("itens", [])
        if str(item.get("transferencia_bravi") or "").strip() == "Sim"
    ]

    codigos = sorted({
        _normalizar_codigo(item.get("codigo"))
        for item in itens
        if item.get("codigo")
    })

    tipos_por_codigo = {
        _normalizar_codigo(item.get("codigo")): item.get("tipo")
        for item in itens
        if item.get("codigo")
    }

    return {
        "base": base,
        "itens": itens,
        "codigos": codigos,
        "tipos_por_codigo": tipos_por_codigo,
    }


def _buscar_codigos_produtos_da_base(base: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Retorna o universo de Produtos acabados / Revenda usado na tela PA/MR.

    Esse endpoint alimenta o gráfico "Estoque e faturamento dos PA/MR".
    Não depende de transferência Bravi; usa o mesmo escopo "produtos" da tabela.
    """
    base = base or _build_base()
    itens = _filtrar_por_escopo_estoque(base.get("itens", []), "produtos")

    codigos = sorted({
        _normalizar_codigo(item.get("codigo"))
        for item in itens
        if item.get("codigo")
    })

    tipos_por_codigo = {
        _normalizar_codigo(item.get("codigo")): item.get("tipo")
        for item in itens
        if item.get("codigo")
    }

    return {
        "base": base,
        "itens": itens,
        "codigos": codigos,
        "tipos_por_codigo": tipos_por_codigo,
    }


def _buscar_bom_filhos():
    """
    Retorna a estrutura/BOM organizada por código pai.

    A quantidade vem da d_bom_estrutura conforme foi carregada do Protheus.

    Regra importante de unidade:
    - a explosão NÃO multiplica todo código 40xxx por 100;
    - o x100 só é aplicado quando o nó intermediário for identificado como
      preparação/intermediário de tubetes, seguindo o mesmo racional usado na
      página de Ordens de Produção: alguns intermediários saem em centos de
      tubetes, mas os insumos abaixo deles são consumidos por tubete.

    Para isso, a explosão carrega também o contexto do filho:
      - descricao_comp
      - tp

    Esse contexto acompanha o item na pilha de explosão e permite aplicar o
    x100 somente quando o intermediário realmente representa centos de tubetes.
    """
    try:
        rows = _buscar_bom_estrutura_rows_raw()
    except Exception:
        rows = []

    filhos_por_pai = defaultdict(list)

    for row in rows:
        pai = _normalizar_codigo(row.get("codigo_pai"))
        comp = _normalizar_codigo(row.get("codigo_comp"))
        fator = _to_float(row.get("quantidade"))

        if not pai or not comp or fator <= 0:
            continue

        filhos_por_pai[pai].append({
            "codigo_pai": pai,
            "codigo_comp": comp,
            "quantidade": fator,
            "descricao_comp": row.get("descricao_comp"),
            "tp": row.get("tp"),
        })

    return filhos_por_pai





def _buscar_componentes_bom_info() -> Dict[str, Dict[str, Any]]:
    """
    Retorna os componentes relevantes da BOM e a linha de negócio herdada dos pais.

    Regra de negócio:
      - Insumos = componentes da estrutura dos PAs/PIs produtivos;
      - PPS fica como produto acabado/revenda e não deve gerar insumo;
      - a classificação do insumo vem do pai da estrutura:
          pai Anestésicos -> Anestésicos Injetáveis
          pai Benzotop -> Benzotop
          mais de uma linha -> Compartilhado
    """
    try:
        rows = _buscar_bom_estrutura_rows_raw()
    except Exception:
        rows = []

    if not rows:
        return {}

    produtos_ativos = _buscar_d_produtos_ativos_analise()
    pais_oficiais = {
        _normalizar_codigo(codigo)
        for codigo, produto in (produtos_ativos or {}).items()
        if _normalizar_codigo(codigo)
        and str(produto.get("tipo_produto_erp") or "").strip().upper() in {"PA", "MR", "PPS", "PV", "PA/MR"}
    }

    filhos_por_pai: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    tipo_pai_por_codigo: Dict[str, str] = {}
    descricao_pai_por_codigo: Dict[str, Any] = {}
    pais_todos: set[str] = set()
    comps_todos: set[str] = set()

    for row in rows:
        pai = _normalizar_codigo(row.get("codigo_pai"))
        comp = _normalizar_codigo(row.get("codigo_comp"))
        if not pai or not comp:
            continue

        pais_todos.add(pai)
        comps_todos.add(comp)

        tipo_pai = str(row.get("tipo_pai") or "").strip().upper()
        if tipo_pai and pai not in tipo_pai_por_codigo:
            tipo_pai_por_codigo[pai] = tipo_pai
        if pai not in descricao_pai_por_codigo:
            descricao_pai_por_codigo[pai] = row.get("descricao_pai")

        filhos_por_pai[pai].append(row)

    produtos_dim_bom = _buscar_d_produtos_por_codigos(sorted(pais_todos | comps_todos | pais_oficiais))
    produtos_dim_bom.update(produtos_ativos or {})

    # Raízes de estrutura: PAs oficiais + pais explicitamente PA/PI na BOM.
    raizes = set(pais_oficiais)
    for row in rows:
        pai = _normalizar_codigo(row.get("codigo_pai"))
        tipo_pai = str(row.get("tipo_pai") or "").strip().upper()
        if pai and tipo_pai in {"PA", "PI"}:
            raizes.add(pai)

    componentes: Dict[str, Dict[str, Any]] = {}
    visitados: set[tuple[str, tuple[str, ...]]] = set()

    stack: List[tuple[str, tuple[str, ...]]] = []
    for raiz in sorted(raizes):
        linha_raiz = _linha_bom_from_produto_dim(
            produtos_dim_bom.get(raiz),
            descricao_pai_por_codigo.get(raiz),
        )

        stack.append((raiz, tuple([linha_raiz] if linha_raiz else [])))

    while stack:
        pai_atual, linhas_origem_tuple = stack.pop()
        pai_atual = _normalizar_codigo(pai_atual)
        linhas_origem = tuple(l for l in linhas_origem_tuple if l)
        chave_visitado = (pai_atual, tuple(sorted(set(linhas_origem))))

        if not pai_atual or chave_visitado in visitados:
            continue

        visitados.add(chave_visitado)

        for row in filhos_por_pai.get(pai_atual, []) or []:
            comp = _normalizar_codigo(row.get("codigo_comp"))
            if not comp:
                continue

            if comp not in componentes:
                componentes[comp] = {
                    "codigo": comp,
                    "descricao_comp": row.get("descricao_comp"),
                    "tp": row.get("tp"),
                    "qtd_pais_bom": 0,
                    "pais_bom": set(),
                    "linhas_bom": set(),
                    "origem_bom_escopo": "PA_PI",
                }

            componentes[comp]["pais_bom"].add(pai_atual)
            componentes[comp]["qtd_pais_bom"] = len(componentes[comp]["pais_bom"])

            for linha in linhas_origem:
                if linha and linha != "A classificar":
                    componentes[comp]["linhas_bom"].add(linha)

            # Mantém a primeira descrição válida, mas preenche se a primeira vier vazia.
            if not _texto_valido(componentes[comp].get("descricao_comp")) and _texto_valido(row.get("descricao_comp")):
                componentes[comp]["descricao_comp"] = row.get("descricao_comp")

            if not _texto_valido(componentes[comp].get("tp")) and _texto_valido(row.get("tp")):
                componentes[comp]["tp"] = row.get("tp")

            # Se o componente também é pai de outra estrutura e é PI/intermediário,
            # percorremos o próximo nível para trazer os insumos do PI preservando a linha do PA raiz.
            tipo_comp = str(row.get("tp") or tipo_pai_por_codigo.get(comp) or (produtos_dim_bom.get(comp) or {}).get("tipo_produto_erp") or "").strip().upper()
            desc_comp = _texto_upper(row.get("descricao_comp") or (produtos_dim_bom.get(comp) or {}).get("desc_produto"))
            eh_pi_ou_intermediario = (
                tipo_comp in {"PI", "SEMI", "INTERMEDIARIO", "INTERMEDIÁRIO"}
                or "PREP" in desc_comp
                or "PREPAR" in desc_comp
            )

            if comp in filhos_por_pai and eh_pi_ou_intermediario:
                stack.append((comp, linhas_origem))

    for comp in componentes.values():
        linhas = sorted(comp.get("linhas_bom") or [])
        linha_final = _linha_unica_ou_compartilhada(linhas)
        comp["linhas_bom"] = linhas
        comp["linha_bom"] = linha_final
        comp["tipo_negocio_bom"] = linha_final
        comp["macro_negocio_bom"] = linha_final
        comp["grupo_gerencial_bom"] = _classificacao_bom_dict_from_linhas(linhas).get("grupo_gerencial")
        comp["pais_bom"] = sorted(comp.get("pais_bom") or [])

    return componentes

def _linha_consumo_sintetica_componente_bom(codigo: str, comp_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cria linha sintética para componente de PA/PI que não apareceu no snapshot
    do Aging. Assim a visão Insumos parte da estrutura, não apenas da posição.
    """
    codigo_norm = _normalizar_codigo(codigo)
    return {
        "codigo": codigo_norm,
        "produto": _coalesce(comp_info.get("descricao_comp"), codigo_norm),
        "unid": None,
        "armaz": None,
        "nome_2": "Sem posição no Aging",
        "grupo": None,
        "grupo_descricao": None,
        "tipo": comp_info.get("tp"),
        "saldo": 0.0,
        "media_3m": 0.0,
        "media_6m": 0.0,
        "media_9m": 0.0,
        "maior_media": 0.0,
        "giro_estoque": 0.0,
        "maior_media_50": 0.0,
        "saldo_menos_maior_media_50": 0.0,
        "__origem_linha_estoque": "bom_pa_pi_sem_snapshot_aging",
    }


def _mesclar_consumo_com_componentes_bom(
    rows: List[Dict[str, Any]],
    componentes_bom_info: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Garante que a visão Insumos tenha como universo os componentes da estrutura
    dos PAs/PIs. Linhas já existentes no Aging são preservadas; componentes que
    não vieram no Aging entram sintéticos com saldo zero.
    """
    rows_saida = [dict(r) for r in (rows or [])]
    codigos_existentes = {
        _normalizar_codigo(row.get("codigo"))
        for row in rows_saida
        if _normalizar_codigo(row.get("codigo"))
    }

    for codigo, comp_info in (componentes_bom_info or {}).items():
        codigo_norm = _normalizar_codigo(codigo)
        if not codigo_norm or codigo_norm in codigos_existentes:
            continue
        rows_saida.append(_linha_consumo_sintetica_componente_bom(codigo_norm, comp_info))
        codigos_existentes.add(codigo_norm)

    return rows_saida

def _texto_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def _eh_intermediario_centena_tubete(contexto_atual: Optional[Dict[str, Any]]) -> bool:
    """
    Identifica quando o nó atual da BOM representa centos de tubetes.

    Esta função substitui a regra simplista de "todo código 40xxx x100".
    O x100 só entra quando o item intermediário carregado na pilha tem contexto
    de preparação/intermediário de tubete.

    Exemplo validado:
      PA comercial -> 40319 / ARTICAINE 100 TUBETE PREP -> 08191 / EPINEFRINA

    No primeiro passo, o PA gera uma quantidade de PI em centos. No segundo
    passo, antes de consumir os insumos do PI, convertemos centos para tubetes.
    """
    if not contexto_atual:
        return False

    descricao = _texto_upper(contexto_atual.get("descricao_comp"))
    tipo = _texto_upper(contexto_atual.get("tp"))

    if not descricao:
        return False

    tem_tubete = (
        "TUBETE" in descricao
        or "TUBETES" in descricao
        or " TUB " in f" {descricao} "
        or "TUB." in descricao
    )

    if not tem_tubete:
        return False

    # Casos típicos: "TUBETE PREP", "TUBETE PREPARADO", "PREPARAÇÃO DE TUBETE".
    tem_preparo = (
        "PREP" in descricao
        or "PREPAR" in descricao
        or "PREPARAC" in descricao
        or "PREPARAÇ" in descricao
    )

    # O campo tp pode vir como PI / MP / ME / PA dependendo do cadastro da estrutura.
    eh_intermediario = tipo in {"PI", "SEMI", "INTERMEDIARIO", "INTERMEDIÁRIO"}

    return tem_preparo or eh_intermediario


def _multiplicador_saida_no_bom(contexto_atual: Optional[Dict[str, Any]]) -> float:
    return 100.0 if _eh_intermediario_centena_tubete(contexto_atual) else 1.0


def _explodir_forecast_multinivel(
    forecast_rows: List[Dict[str, Any]],
    codigos_interesse: Optional[set[str]] = None,
    max_niveis: int = 8,
):
    """
    Explode o forecast pela BOM em múltiplos níveis.

    Exemplo real validado:
      50137 - ARTICAINE 100 URUG 50CARP CX10
        -> 40319 - ARTICAINE 100 TUBETE PREP
        -> 08191 - EPINEFRINA SYN-TECH

    Antes a ferramenta só procurava componente direto do código do forecast.
    Com isso, a demanda da EPINEFRINA ficava zerada porque não existia forecast
    direto para 40319. Agora o forecast do PA atravessa o PI e chega no insumo.

    Regra de unidade:
      - NÃO aplica x100 por prefixo de código;
      - aplica x100 somente ao sair de um intermediário de tubete/preparo,
        porque ali a demanda acumulada está em centos de tubetes e os filhos
        abaixo são consumidos por tubete.

    Retorna:
      - demanda_direta: forecast original por código/período;
      - demanda_explodida: demanda acumulada por componente/período.
    """
    filhos_por_pai = _buscar_bom_filhos()

    demanda_direta = defaultdict(float)
    demanda_explodida = defaultdict(float)

    max_niveis = max(1, min(int(max_niveis or 8), 20))

    for row in forecast_rows or []:
        raiz = _normalizar_codigo(row.get("cod_produto"))
        ano = int(row.get("ano") or 0)
        mes = int(row.get("mes") or 0)
        qtd_forecast = _to_float(row.get("qtd_forecast"))

        if not raiz or ano <= 0 or mes <= 0 or qtd_forecast == 0:
            continue

        demanda_direta[(raiz, ano, mes)] += qtd_forecast

        # Pilha: código atual, demanda acumulada até o nó atual, nível, caminho, contexto do nó atual.
        # O contexto do nó atual é o registro pelo qual ele apareceu como componente no nível anterior.
        stack = [(raiz, qtd_forecast, 0, {raiz}, None)]

        while stack:
            codigo_atual, demanda_atual, nivel, caminho, contexto_atual = stack.pop()

            if nivel >= max_niveis:
                continue

            filhos = filhos_por_pai.get(codigo_atual, [])

            if not filhos:
                continue

            multiplicador_saida = _multiplicador_saida_no_bom(contexto_atual)

            for filho in filhos:
                codigo_filho = filho["codigo_comp"]
                fator = _to_float(filho.get("quantidade"))

                if not codigo_filho or fator <= 0:
                    continue

                # Exemplo com intermediário em centos de tubetes:
                # PA -> PI = quantidade em centos
                # PI -> insumo = consumo por tubete
                # Ao sair do PI, converte centos para tubetes com x100.
                demanda_filho = demanda_atual * multiplicador_saida * fator

                if codigos_interesse is None or codigo_filho in codigos_interesse:
                    demanda_explodida[(codigo_filho, ano, mes)] += demanda_filho

                # Mesmo que o filho não seja um código de interesse, ele pode ser intermediário.
                if codigo_filho in filhos_por_pai and codigo_filho not in caminho:
                    contexto_filho = {
                        "codigo_pai": codigo_atual,
                        "codigo_comp": codigo_filho,
                        "descricao_comp": filho.get("descricao_comp"),
                        "tp": filho.get("tp"),
                    }
                    stack.append((
                        codigo_filho,
                        demanda_filho,
                        nivel + 1,
                        caminho | {codigo_filho},
                        contexto_filho,
                    ))

    return demanda_direta, demanda_explodida



def _get_any(row: Dict[str, Any], campos: List[str], default: Any = None) -> Any:
    """
    Retorna o primeiro campo existente/não vazio de uma linha.

    Esta função é usada principalmente na leitura da programação/Gantt, porque
    os nomes das colunas podem variar conforme o processor/upload.
    """
    if not row:
        return default

    # Acesso direto primeiro.
    for campo in campos:
        if campo in row:
            valor = row.get(campo)
            if valor is not None and str(valor).strip() != "":
                return valor

    # Depois acesso case-insensitive.
    mapa_lower = {str(k).strip().lower(): k for k in row.keys()}
    for campo in campos:
        chave = mapa_lower.get(str(campo).strip().lower())
        if chave is None:
            continue
        valor = row.get(chave)
        if valor is not None and str(valor).strip() != "":
            return valor

    return default


def _row_has_any(row: Dict[str, Any], campos: List[str]) -> bool:
    if not row:
        return False

    keys_lower = {str(k).strip().lower() for k in row.keys()}
    return any(str(c).strip().lower() in keys_lower for c in campos)


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default

        if isinstance(value, int):
            return value

        if isinstance(value, float):
            return int(value)

        texto = str(value).strip()

        if not texto:
            return default

        # "06/2026", "2026-06", "junho de 2026" são tratados em funções próprias.
        return int(float(texto.replace(",", ".")))
    except Exception:
        return default


def _ano_mes_from_row(
    row: Dict[str, Any],
    ano_campos: List[str],
    mes_campos: List[str],
    data_campos: List[str],
) -> tuple[int, int]:
    """
    Extrai ano/mês de uma linha usando primeiro colunas ano+mes e depois data.
    """
    ano = _to_int(_get_any(row, ano_campos))
    mes = _to_int(_get_any(row, mes_campos))

    if ano > 0 and 1 <= mes <= 12:
        if ano < 100:
            ano += 2000
        return ano, mes

    data_valor = _get_any(row, data_campos)
    data_ref = _parse_data(data_valor)

    if data_ref:
        return data_ref.year, data_ref.month

    texto = str(data_valor or "").strip().lower()

    # Fallback simples para "2026-06", "06/2026" ou "junho de 2026".
    if texto:
        try:
            import re
            m = re.search(r"(20\d{2})[-/](\d{1,2})", texto)
            if m:
                return int(m.group(1)), int(m.group(2))
            m = re.search(r"(\d{1,2})[-/](20\d{2})", texto)
            if m:
                return int(m.group(2)), int(m.group(1))

            meses_txt = {
                "jan": 1, "janeiro": 1,
                "fev": 2, "fevereiro": 2,
                "mar": 3, "marco": 3, "março": 3,
                "abr": 4, "abril": 4,
                "mai": 5, "maio": 5,
                "jun": 6, "junho": 6,
                "jul": 7, "julho": 7,
                "ago": 8, "agosto": 8,
                "set": 9, "setembro": 9,
                "out": 10, "outubro": 10,
                "nov": 11, "novembro": 11,
                "dez": 12, "dezembro": 12,
            }
            ano_match = re.search(r"(20\d{2})", texto)
            if ano_match:
                ano_txt = int(ano_match.group(1))
                for nome, mes_num in meses_txt.items():
                    if nome in texto:
                        return ano_txt, mes_num
        except Exception:
            pass

    return 0, 0


def _normalizar_versao_programacao(value: Any) -> str:
    texto = str(value or "").strip().upper()
    texto = texto.replace("VERSÃO", "VERSAO")
    texto = texto.replace(" ", "")
    return texto


def _eh_v1_programacao(row: Dict[str, Any]) -> bool:
    """
    True quando a linha é V1 ou quando não existe coluna explícita de versão.

    Quando existir coluna de versão, filtramos V1. Quando não existir, mantemos
    a linha para não quebrar a tela em tabelas mais simples.
    """
    campos_versao = [
        "versao",
        "versão",
        "versao_plano",
        "versao_programacao",
        "versao_programação",
        "versao_mps",
        "rodada",
        "cenario",
        "cenário",
        "tipo_versao",
    ]

    if not _row_has_any(row, campos_versao):
        return True

    versao = _normalizar_versao_programacao(_get_any(row, campos_versao))

    return versao in {"V1", "1", "VERSAO1", "VERSAOV1", "RODADA1", "RODADAV1"}


def _linha_programacao_valida(row: Dict[str, Any]) -> bool:
    """
    Garante que a demanda de produção some apenas L1 + L2.

    Se a tabela tiver coluna de linha, filtramos apenas L1/L2. Se não tiver,
    assumimos que a quantidade já veio consolidada no nível SKU/mês.
    """
    campos_linha = [
        "linha",
        "linha_producao",
        "linha_produção",
        "linha_envase",
        "recurso",
        "centro_trabalho",
        "workcenter",
    ]

    if not _row_has_any(row, campos_linha):
        return True

    linha = str(_get_any(row, campos_linha) or "").strip().upper()
    linha = linha.replace("LINHA", "L").replace(" ", "")

    return linha in {"L1", "L2", "1", "2"}


def _codigo_programacao(row: Dict[str, Any]) -> str:
    campos_codigo = [
        "cod_produto",
        "codigo_produto",
        "cód_produto",
        "produto_codigo",
        "codigo",
        "código",
        "cod_item",
        "item_codigo",
        "sku",
        "produto",
        "cod_pa",
        "pa_codigo",
    ]

    valor = _get_any(row, campos_codigo)
    codigo = _normalizar_codigo(valor)

    # Evita pegar descrição textual por engano quando a coluna "produto" for nome.
    if not codigo or not any(ch.isdigit() for ch in codigo):
        return ""

    return codigo


def _quantidade_programacao(row: Dict[str, Any]) -> float:
    """
    Quantidade planejada da programação.

    Se a base vier com colunas separadas de L1 e L2 na mesma linha, soma as duas.
    Caso contrário, usa a quantidade da linha atual; como filtramos linha L1/L2,
    o agrupamento final soma naturalmente as duas linhas.
    """
    campos_l1 = [
        "qtd_l1",
        "qtde_l1",
        "quantidade_l1",
        "qtd_linha_1",
        "quantidade_linha_1",
        "l1",
        "L1",
    ]
    campos_l2 = [
        "qtd_l2",
        "qtde_l2",
        "quantidade_l2",
        "qtd_linha_2",
        "quantidade_linha_2",
        "l2",
        "L2",
    ]

    tem_l1_l2 = _row_has_any(row, campos_l1) or _row_has_any(row, campos_l2)

    if tem_l1_l2:
        return _to_float(_get_any(row, campos_l1)) + _to_float(_get_any(row, campos_l2))

    campos_qtd = [
        "qtd_programada",
        "quantidade_programada",
        "qtd_planejada",
        "quantidade_planejada",
        "qtd_envase",
        "quantidade_envase",
        "qtd_producao",
        "qtd_produção",
        "quantidade_producao",
        "quantidade_produção",
        "qtd",
        "quantidade",
        "volume",
        "qtd_op",
        "quantidade_op",
        "qtde",
    ]

    return _to_float(_get_any(row, campos_qtd))


def _snapshot_programacao(row: Dict[str, Any]) -> str:
    campos_snapshot = [
        "data_snapshot",
        "snapshot",
        "atualizado_em",
        "updated_at",
        "criado_em",
        "created_at",
        "data_upload",
        "data_rodada",
        "rodada_data",
        "data_atualizacao",
        "data_atualização",
    ]

    valor = _get_any(row, campos_snapshot)

    if not valor:
        return ""

    return str(valor)


def _normalizar_linhas_programacao(rows: List[Dict[str, Any]], tabela: str) -> List[Dict[str, Any]]:
    """
    Normaliza a programação/Gantt para o mesmo formato do forecast:
      cod_produto, ano, mes, qtd_forecast

    Conceito definido para o Aging de Insumos:
      - usar V1 do mês atual;
      - para cada SKU/mês, somar L1 + L2;
      - explodir a BOM em cima dessa quantidade planejada.
    """
    hoje = date.today()
    ano_base = hoje.year
    mes_base = hoje.month

    ano_mes_campos = {
        "ano_campos": ["ano", "ano_programacao", "ano_programação", "ano_envase", "ano_fabricacao", "ano_fabricação"],
        "mes_campos": ["mes", "mês", "mes_programacao", "mês_programação", "mes_envase", "mes_fabricacao", "mês_fabricação"],
        "data_campos": [
            "data",
            "data_programacao",
            "data_programação",
            "data_envase",
            "data_fabricacao",
            "data_fabricação",
            "data_inicio",
            "dt_inicio",
            "inicio",
            "competencia",
            "competência",
            "periodo",
            "período",
        ],
    }

    ref_campos = {
        "ano_campos": ["ano_referencia", "ano_referência", "ano_base", "ano_rodada", "ano_ref"],
        "mes_campos": ["mes_referencia", "mês_referência", "mes_base", "mês_base", "mes_rodada", "mês_rodada", "mes_ref"],
        "data_campos": [
            "data_referencia",
            "data_referência",
            "data_base",
            "data_rodada",
            "competencia_referencia",
            "competência_referência",
            "mes_referencia",
            "mês_referência",
            "mes_base",
            "mês_base",
        ],
    }

    normalizadas = []

    for row in rows or []:
        if not _eh_v1_programacao(row):
            continue

        if not _linha_programacao_valida(row):
            continue

        codigo = _codigo_programacao(row)

        if not codigo:
            continue

        ano, mes = _ano_mes_from_row(row, **ano_mes_campos)

        if ano <= 0 or mes <= 0 or mes > 12:
            continue

        # Só precisamos do mês atual para frente no Aging.
        if (ano, mes) < (ano_base, mes_base):
            continue

        qtd = _quantidade_programacao(row)

        if qtd == 0:
            continue

        ref_ano, ref_mes = _ano_mes_from_row(row, **ref_campos)
        snapshot = _snapshot_programacao(row)

        normalizadas.append({
            "cod_produto": codigo,
            "ano": ano,
            "mes": mes,
            "qtd_forecast": qtd,
            "origem": "mrp_v1_l1_l2",
            "tabela_origem": tabela,
            "ref_ano": ref_ano,
            "ref_mes": ref_mes,
            "snapshot": snapshot,
        })

    if not normalizadas:
        return []

    # Se a base trouxer mês de referência, pega a V1 do mês atual.
    tem_ref = any(int(r.get("ref_ano") or 0) > 0 and int(r.get("ref_mes") or 0) > 0 for r in normalizadas)

    if tem_ref:
        filtradas_ref = [
            r for r in normalizadas
            if (int(r.get("ref_ano") or 0), int(r.get("ref_mes") or 0)) == (ano_base, mes_base)
        ]

        if filtradas_ref:
            normalizadas = filtradas_ref

    # Se houver múltiplos uploads/snapshots dentro da mesma versão, fica com o mais recente.
    snapshots = sorted({str(r.get("snapshot") or "") for r in normalizadas if r.get("snapshot")})

    if snapshots:
        ultimo_snapshot = snapshots[-1]
        normalizadas_snapshot = [r for r in normalizadas if str(r.get("snapshot") or "") == ultimo_snapshot]

        if normalizadas_snapshot:
            normalizadas = normalizadas_snapshot

    # Agrupa para garantir soma L1 + L2 por SKU/mês.
    agrupado = defaultdict(float)
    meta = {}

    for r in normalizadas:
        chave = (r["cod_produto"], int(r["ano"]), int(r["mes"]))
        agrupado[chave] += _to_float(r.get("qtd_forecast"))
        meta[chave] = {
            "origem": r.get("origem"),
            "tabela_origem": r.get("tabela_origem"),
            "ref_ano": r.get("ref_ano"),
            "ref_mes": r.get("ref_mes"),
            "snapshot": r.get("snapshot"),
        }

    resultado = []

    for (codigo, ano, mes), qtd in sorted(agrupado.items(), key=lambda x: (x[0][1], x[0][2], x[0][0])):
        if qtd == 0:
            continue

        row_meta = meta.get((codigo, ano, mes), {})
        resultado.append({
            "cod_produto": codigo,
            "ano": ano,
            "mes": mes,
            "qtd_forecast": _round(qtd, 4),
            "origem": row_meta.get("origem") or "mrp_v1_l1_l2",
            "tabela_origem": row_meta.get("tabela_origem") or tabela,
            "ref_ano": row_meta.get("ref_ano"),
            "ref_mes": row_meta.get("ref_mes"),
            "snapshot": row_meta.get("snapshot"),
        })

    return resultado


def _buscar_mrp_v1_l1_l2_rows() -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Busca a programação/Gantt V1 real do MRP para explodir demanda de insumos.

    Fonte correta do Gantt/MPS:
      - f_mrp_rodadas: identifica a rodada V1 do mês atual;
      - f_mrp_etapas: contém os lotes/etapas importados do MPS;
      - recurso L1 e L2: representam as duas linhas de envase.

    Regra de negócio:
      - enquanto estamos no mês atual, usar a V1 do mês atual;
      - usar meses atuais/futuros existentes nessa V1;
      - somar qtd_planejada de L1 + L2 por SKU/mês de produção;
      - devolver no formato do forecast para reaproveitar a explosão BOM.
    """
    hoje = date.today()
    ano_base = hoje.year
    mes_base = hoje.month
    mes_base_label = f"{ano_base}-{str(mes_base).zfill(2)}"

    tentativas = []

    # 1) Busca a V1 do mês atual em f_mrp_rodadas.
    try:
        rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("id,nome,mes,ano,versao,status,criado_em,observacao")
            .eq("ano", ano_base)
            .eq("mes", mes_base)
            .eq("versao", 1)
            .order("criado_em", desc=True)
        )
    except Exception as e:
        return [], {
            "fonte_demanda": "mrp_v1_l1_l2",
            "tabela": "f_mrp_rodadas/f_mrp_etapas",
            "rodada": None,
            "qtd_linhas_normalizadas": 0,
            "mes_base": mes_base_label,
            "observacao": "Erro ao buscar a V1 do mês atual em f_mrp_rodadas.",
            "erro": str(e)[:300],
            "tentativas": [{"tabela": "f_mrp_rodadas", "status": "erro", "erro": str(e)[:300]}],
        }

    tentativas.append({
        "tabela": "f_mrp_rodadas",
        "status": "ok" if rodadas else "sem_v1_mes_atual",
        "mes": mes_base,
        "ano": ano_base,
        "versao": 1,
        "qtd_rodadas": len(rodadas),
        "amostra": rodadas[:3],
    })

    if not rodadas:
        return [], {
            "fonte_demanda": "mrp_v1_l1_l2",
            "tabela": "f_mrp_rodadas/f_mrp_etapas",
            "rodada": None,
            "qtd_linhas_normalizadas": 0,
            "mes_base": mes_base_label,
            "observacao": (
                "Nenhuma rodada V1 encontrada para o mês atual em f_mrp_rodadas. "
                "O backend vai usar forecast S&OP como fallback para não zerar a tela."
            ),
            "tentativas": tentativas,
        }

    rodada = rodadas[0]
    rodada_id = rodada.get("id")

    if not rodada_id:
        return [], {
            "fonte_demanda": "mrp_v1_l1_l2",
            "tabela": "f_mrp_rodadas/f_mrp_etapas",
            "rodada": rodada,
            "qtd_linhas_normalizadas": 0,
            "mes_base": mes_base_label,
            "observacao": "Rodada V1 encontrada, mas sem id.",
            "tentativas": tentativas,
        }

    # 2) Busca as etapas dessa V1. L1 e L2 são as abas de envase do Gantt/MPS.
    try:
        etapas = _select_all(
            supabase.table("f_mrp_etapas")
            .select(
                "id,rodada_id,lote,op,codigo_produto,descricao_produto,etapa,"
                "recurso,linha_origem,data_inicio,data_fim,data_pa,qtd_planejada,"
                "duracao_horas,sequencia,status,origem,mes_producao,ano_producao"
            )
            .eq("rodada_id", rodada_id)
            .in_("recurso", ["L1", "L2"])
        )
    except Exception as e:
        tentativas.append({"tabela": "f_mrp_etapas", "status": "erro", "erro": str(e)[:300]})
        return [], {
            "fonte_demanda": "mrp_v1_l1_l2",
            "tabela": "f_mrp_rodadas/f_mrp_etapas",
            "rodada": rodada,
            "qtd_linhas_normalizadas": 0,
            "mes_base": mes_base_label,
            "observacao": "Erro ao buscar etapas L1/L2 da rodada V1 em f_mrp_etapas.",
            "erro": str(e)[:300],
            "tentativas": tentativas,
        }

    tentativas.append({
        "tabela": "f_mrp_etapas",
        "status": "ok" if etapas else "sem_etapas_l1_l2",
        "rodada_id": rodada_id,
        "qtd_linhas_brutas": len(etapas),
        "campos_amostra": list((etapas[0] or {}).keys())[:80] if etapas else [],
        "amostra_bruta": etapas[:3],
    })

    normalizadas_base = []

    for row in etapas or []:
        recurso = str(row.get("recurso") or "").strip().upper()
        if recurso not in {"L1", "L2"}:
            continue

        codigo = _normalizar_codigo(row.get("codigo_produto"))
        if not codigo or not any(ch.isdigit() for ch in codigo):
            continue

        ano = _to_int(row.get("ano_producao"))
        mes = _to_int(row.get("mes_producao"))

        # Fallback para casos em que mes_producao/ano_producao não vieram preenchidos.
        if ano <= 0 or mes <= 0 or mes > 12:
            data_ref = _parse_data(row.get("data_inicio")) or _parse_data(row.get("data_fim"))
            if data_ref:
                ano = data_ref.year
                mes = data_ref.month

        if ano <= 0 or mes <= 0 or mes > 12:
            continue

        # Enquanto estamos no mês atual, usa apenas mês atual/futuro dessa V1.
        if (ano, mes) < (ano_base, mes_base):
            continue

        qtd = _to_float(row.get("qtd_planejada"))
        if qtd == 0:
            continue

        normalizadas_base.append({
            "cod_produto": codigo,
            "ano": ano,
            "mes": mes,
            "qtd_forecast": qtd,
            "origem": "mrp_v1_l1_l2",
            "tabela_origem": "f_mrp_etapas",
            "rodada_id": rodada_id,
            "rodada_nome": rodada.get("nome"),
            "rodada_versao": rodada.get("versao"),
            "ref_ano": ano_base,
            "ref_mes": mes_base,
            "recurso": recurso,
            "lote": row.get("lote"),
            "descricao_produto": row.get("descricao_produto"),
            "status_etapa": row.get("status"),
        })

    if not normalizadas_base:
        return [], {
            "fonte_demanda": "mrp_v1_l1_l2",
            "tabela": "f_mrp_rodadas/f_mrp_etapas",
            "rodada": rodada,
            "qtd_linhas_brutas": len(etapas),
            "qtd_linhas_normalizadas": 0,
            "mes_base": mes_base_label,
            "observacao": (
                "A rodada V1 foi encontrada, mas não há etapas L1/L2 com "
                "codigo_produto, mês de produção e qtd_planejada válidos para mês atual/futuro. "
                "O backend vai usar forecast S&OP como fallback para não zerar a tela."
            ),
            "tentativas": tentativas,
        }

    # 3) Agrupa por SKU/mês para somar L1 + L2.
    agrupado = defaultdict(float)
    meta = {}
    linhas_por_recurso = defaultdict(int)

    for r in normalizadas_base:
        chave = (r["cod_produto"], int(r["ano"]), int(r["mes"]))
        agrupado[chave] += _to_float(r.get("qtd_forecast"))
        linhas_por_recurso[r.get("recurso") or ""] += 1
        meta[chave] = {
            "origem": r.get("origem"),
            "tabela_origem": r.get("tabela_origem"),
            "rodada_id": r.get("rodada_id"),
            "rodada_nome": r.get("rodada_nome"),
            "rodada_versao": r.get("rodada_versao"),
            "ref_ano": r.get("ref_ano"),
            "ref_mes": r.get("ref_mes"),
        }

    resultado = []

    for (codigo, ano, mes), qtd in sorted(agrupado.items(), key=lambda x: (x[0][1], x[0][2], x[0][0])):
        if qtd == 0:
            continue
        row_meta = meta.get((codigo, ano, mes), {})
        resultado.append({
            "cod_produto": codigo,
            "ano": ano,
            "mes": mes,
            "qtd_forecast": _round(qtd, 4),
            "origem": "mrp_v1_l1_l2",
            "tabela_origem": "f_mrp_etapas",
            "rodada_id": row_meta.get("rodada_id"),
            "rodada_nome": row_meta.get("rodada_nome"),
            "rodada_versao": row_meta.get("rodada_versao"),
            "ref_ano": row_meta.get("ref_ano"),
            "ref_mes": row_meta.get("ref_mes"),
        })

    debug = {
        "fonte_demanda": "mrp_v1_l1_l2",
        "tabela": "f_mrp_rodadas/f_mrp_etapas",
        "rodada": rodada,
        "rodada_id": rodada_id,
        "qtd_linhas_brutas": len(etapas),
        "qtd_linhas_l1_l2_validas": len(normalizadas_base),
        "qtd_linhas_normalizadas": len(resultado),
        "linhas_por_recurso": dict(linhas_por_recurso),
        "mes_base": mes_base_label,
        "meses_programados": sorted({f"{r['ano']}-{str(r['mes']).zfill(2)}" for r in resultado}),
        "amostra_normalizada": resultado[:10],
        "tentativas": tentativas,
    }

    return resultado, debug




MPS_TUBETES_POR_CAIXA = 500.0


def _produto_eh_exportacao_mps(produto: Optional[Dict[str, Any]]) -> bool:
    """
    Identifica PAs de exportação para a alocação do MPS.

    Regra de negócio validada com PCP:
    - a produção planejada no PI deve atender exportação primeiro;
    - depois a sobra é distribuída para mercado nacional;
    - fonte principal: d_produtos.mercado;
    - fallback: descrição/nome do SKU com país/destino de exportação, pois
      alguns cadastros podem vir sem mercado revisado.
    """
    produto = produto or {}

    def normaliza_texto(value: Any) -> str:
        texto = str(value or "").strip().upper()
        texto = unicodedata.normalize("NFD", texto)
        texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
        texto = re.sub(r"[^A-Z0-9]+", " ", texto)
        return re.sub(r"\s+", " ", texto).strip()

    mercado = normaliza_texto(produto.get("mercado"))

    # Primeiro tenta o cadastro gerencial.
    if any(token in f" {mercado} " for token in [
        " EXPORTACAO ", " EXPORT ", " EXP ", " EXTERNO ", " INTERNACIONAL ", " EXTERIOR "
    ]):
        return True

    # Se o mercado vier explicitamente nacional, só usa fallback por descrição
    # quando o próprio SKU traz destino claro de exportação.
    campos = [
        produto.get("desc_produto"),
        produto.get("concatenado_produto"),
        produto.get("grupo_gerencial"),
        produto.get("familia"),
        produto.get("segmento"),
        produto.get("tipo_negocio"),
        produto.get("macro_negocio"),
    ]
    texto = normaliza_texto(" ".join(str(v or "") for v in campos))

    destinos_exportacao = {
        # países/destinos observados nos SKUs de anestésicos exportação
        "MEXICO", "NIGERIA", "BOLIVIA", "CHILE", "FIJI", "DIMO",
        "MADAGASCAR", "TURCOMENISTAO", "TURKMENISTAN", "ARMENIA",
        "HONDURAS", "EQUADOR", "ECUADOR", "PANAMA", "URUG", "URUGUAI",
        "URUGUAY", "RUS", "RUSSIA", "AZERBAIJAO", "AZERBAIJAN",
        "GUARANI", "SIL LOTUS", "SILVER LOTUS", "LOTUS",
    }

    texto_com_espacos = f" {texto} "
    if any(f" {destino} " in texto_com_espacos for destino in destinos_exportacao):
        return True

    # Fallback adicional para cadastros que trazem exportação em campos macro.
    return "EXPORT" in texto or " EXP " in texto_com_espacos


def _buscar_rodadas_mps_mais_atuais_por_mes() -> tuple[Dict[tuple[int, int], Dict[str, Any]], Dict[str, Any]]:
    """
    Busca a rodada operacional mais atual disponível do MPS.

    Regra validada para entrada prevista de PA na Gestão de Estoque:
      - o MPS/Gantt é de envase/PI, não de PA vendido;
      - para converter PI em entrada operacional de PA, usamos a versão mais
        atual disponível do MPS, por exemplo Junho/V2;
      - dentro dessa rodada, cada linha é alocada no mês definido por MÊS LIB.;
      - a distribuição do PI entre PAs acontece depois, via forecast e prioridade
        exportação antes de nacional.

    A função mantém o retorno em dict por compatibilidade com chamadas antigas,
    mas normalmente retorna apenas uma chave: (ano_rodada, mes_rodada).
    """
    hoje = date.today()
    tentativas: List[Dict[str, Any]] = []

    try:
        rows = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("id,nome,mes,ano,versao,status,criado_em,observacao")
        )
    except Exception as e:
        return {}, {
            "fonte": "mps_rodada_operacional_mais_atual",
            "status": "erro_rodadas",
            "erro": str(e)[:300],
            "tentativas": [{"tabela": "f_mrp_rodadas", "status": "erro", "erro": str(e)[:300]}],
        }

    tentativas.append({
        "tabela": "f_mrp_rodadas",
        "status": "ok" if rows else "sem_rodadas",
        "qtd_rodadas": len(rows or []),
    })

    rodadas_validas: List[Dict[str, Any]] = []

    for row in rows or []:
        ano = _to_int(row.get("ano"))
        mes = _to_int(row.get("mes"))
        versao = _to_int(row.get("versao"))
        if not row.get("id") or ano <= 0 or not (1 <= mes <= 12) or versao <= 0:
            continue

        # Evita usar uma rodada antiga como plano operacional se já estamos em
        # mês posterior. Ex.: em julho, não usa maio.
        if (ano, mes) < (hoje.year, hoje.month):
            continue

        rodadas_validas.append(row)

    if not rodadas_validas:
        return {}, {
            "fonte": "mps_rodada_operacional_mais_atual",
            "status": "sem_rodadas_futuras",
            "qtd_rodadas_validas": 0,
            "tentativas": tentativas,
        }

    rodada = sorted(
        rodadas_validas,
        key=lambda r: (
            _to_int(r.get("ano")),
            _to_int(r.get("mes")),
            _to_int(r.get("versao")),
            str(r.get("criado_em") or ""),
        ),
        reverse=True,
    )[0]

    ano = _to_int(rodada.get("ano"))
    mes = _to_int(rodada.get("mes"))
    chave = (ano, mes)

    return {chave: rodada}, {
        "fonte": "mps_rodada_operacional_mais_atual",
        "status": "ok",
        "qtd_rodadas_validas": len(rodadas_validas),
        "rodada_utilizada": {
            "ano": ano,
            "mes": mes,
            "rodada_id": rodada.get("id"),
            "versao": rodada.get("versao"),
            "nome": rodada.get("nome"),
            "criado_em": rodada.get("criado_em"),
        },
        "rodadas_por_mes": [
            {
                "ano": ano,
                "mes": mes,
                "rodada_id": rodada.get("id"),
                "versao": rodada.get("versao"),
                "nome": rodada.get("nome"),
                "criado_em": rodada.get("criado_em"),
            }
        ],
        "tentativas": tentativas,
    }

def _latest_mps_cache_marker_impl() -> str:
    """Marcador simples para invalidar cache quando o MPS mudar."""
    try:
        res = (
            supabase.table("f_mrp_rodadas")
            .select("id,ano,mes,versao,criado_em")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .order("versao", desc=True)
            .order("criado_em", desc=True)
            .limit(1)
            .execute()
        )
        row = (res.data or [None])[0]
        if not row:
            return "sem_mps"
        return f"{row.get('ano')}-{row.get('mes')}-v{row.get('versao')}-{row.get('criado_em')}-{row.get('id')}"
    except Exception:
        return "mps_indisponivel"


def _latest_mps_cache_marker() -> str:
    return _marcador_com_cache_curto("latest_mps_cache_marker", _latest_mps_cache_marker_impl)


def _codigo_mps_linha(row: Dict[str, Any]) -> str:
    return _normalizar_codigo(
        _coalesce(
            row.get("codigo_produto"),
            row.get("cod_produto"),
            row.get("produto_codigo"),
            row.get("codigo"),
            row.get("produto"),
        )
    )


def _quantidade_mps_tubetes(row: Dict[str, Any]) -> float:
    return _to_float(
        _coalesce(
            row.get("qtd_planejada"),
            row.get("quantidade_planejada"),
            row.get("qtd_programada"),
            row.get("quantidade_programada"),
            row.get("qtd"),
            row.get("quantidade"),
        )
    )


def _ano_mes_mps_linha(row: Dict[str, Any], ano_rodada: int, mes_rodada: int) -> tuple[int, int]:
    """
    Mês correto da entrada prevista no PA.

    Regra validada com PCP:
    - para a Gestão de Estoque PA, a entrada futura deve seguir o MÊS LIB.
      da página de MPS/Gantt, não o mês de produção, data_inicio, data_fim ou
      mês da rodada;
    - quantidade continua sendo qtd_planejada em tubetes, agrupada por PI +
      mês de liberação e depois convertida para caixas (/500);
    - mês/ano de produção ficam apenas como fallback quando a base antiga não
      tiver coluna de liberação.
    """
    ano_lib = _to_int(_coalesce(
        row.get("ano_liberacao"),
        row.get("ano_liberação"),
        row.get("ano_lib"),
        row.get("ano_liberacao_novo"),
        row.get("ano_lib_novo"),
    ))
    mes_lib = _to_int(_coalesce(
        row.get("mes_liberacao"),
        row.get("mês_liberacao"),
        row.get("mes_liberação"),
        row.get("mês_liberação"),
        row.get("mes_lib"),
        row.get("mês_lib"),
        row.get("mes_liberacao_novo"),
        row.get("mes_lib_novo"),
    ))

    if ano_lib > 0 and 1 <= mes_lib <= 12:
        return ano_lib, mes_lib

    data_lib = _parse_data(_coalesce(
        row.get("data_liberacao"),
        row.get("data_liberação"),
        row.get("data_lib"),
        row.get("dt_liberacao"),
        row.get("dt_lib"),
    ))
    if data_lib:
        return data_lib.year, data_lib.month

    # Fallback de compatibilidade para bases antigas sem MÊS LIB.
    ano = _to_int(_coalesce(row.get("ano_producao"), row.get("ano_programacao"), row.get("ano")))
    mes = _to_int(_coalesce(row.get("mes_producao"), row.get("mes_programacao"), row.get("mes")))
    if ano > 0 and 1 <= mes <= 12:
        return ano, mes

    data_ref = _parse_data(row.get("data_pa")) or _parse_data(row.get("data_fim")) or _parse_data(row.get("data_inicio"))
    if data_ref:
        return data_ref.year, data_ref.month

    return ano_rodada, mes_rodada


def _buscar_mapa_pi_para_pas_por_bom(
    codigos_pa: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> Dict[str, List[str]]:
    """
    Mapeia PI/intermediário -> PAs finais pela estrutura.

    A entrada prevista dos PAs produzidos internamente vem do MPS no nível PI.
    Para saber quais PAs recebem essa liberação, usamos a BOM:
      PA final -> PI/intermediário.
    """
    codigos_pa_set = {_normalizar_codigo(c) for c in (codigos_pa or []) if _normalizar_codigo(c)}
    produtos_all = produtos_all or _buscar_d_produtos_por_codigos(sorted(codigos_pa_set))
    if not codigos_pa_set:
        return {}

    try:
        rows = _buscar_bom_estrutura_rows_raw()
    except Exception:
        rows = []

    pais_com_filhos = {
        _normalizar_codigo(row.get("codigo_pai"))
        for row in rows or []
        if _normalizar_codigo(row.get("codigo_pai"))
    }
    codigos_comp = sorted({
        _normalizar_codigo(row.get("codigo_comp"))
        for row in rows or []
        if _normalizar_codigo(row.get("codigo_comp"))
    })
    produtos_componentes = _buscar_d_produtos_por_codigos(codigos_comp)

    mapa: Dict[str, List[str]] = defaultdict(list)

    for row in rows or []:
        pai = _normalizar_codigo(row.get("codigo_pai"))
        comp = _normalizar_codigo(row.get("codigo_comp"))
        if pai not in codigos_pa_set or not comp:
            continue

        produto_pai = produtos_all.get(pai) or {}
        tipo_pai = str(_coalesce(row.get("tipo_pai"), produto_pai.get("tipo_produto_erp"), "") or "").strip().upper()
        if tipo_pai and tipo_pai not in {"PA", "MR", "PPS", "PV", "PA/MR"}:
            continue

        produto_comp = produtos_componentes.get(comp) or {}
        tipo_comp = str(_coalesce(row.get("tp"), produto_comp.get("tipo_produto_erp"), "") or "").strip().upper()
        desc_comp = _texto_upper(row.get("descricao_comp") or produto_comp.get("desc_produto"))

        # Para alocar MPS no nível PI -> PA, não podemos mapear qualquer
        # componente intermediário/filho da BOM. Na versão anterior, itens que
        # apenas apareciam como pai em outro nível ou tinham "TUBETE" na
        # descrição podiam virar PI candidato, fazendo o mesmo PA receber várias
        # alocações no mesmo mês.
        #
        # Regra segura: considera PI somente quando o tipo do componente é PI/
        # intermediário OU quando a descrição indica claramente preparação/granel
        # industrial. "TUBETE" sozinho não basta.
        eh_pi = (
            tipo_comp in {"PI", "SEMI", "INTERMEDIARIO", "INTERMEDIÁRIO"}
            or "PREP" in desc_comp
            or "PREPAR" in desc_comp
            or "GRANEL" in desc_comp
        )

        if not eh_pi:
            continue

        if pai not in mapa[comp]:
            mapa[comp].append(pai)

    return {pi: sorted(set(pas)) for pi, pas in mapa.items()}


def _buscar_forecast_direto_pa_futuro(
    codigos_pa: List[str],
) -> Dict[tuple[str, int, int], float]:
    """Forecast direto dos PAs do mês atual em diante, na unidade carregada no S&OP."""
    codigos_set = {_normalizar_codigo(c) for c in (codigos_pa or []) if _normalizar_codigo(c)}
    hoje = date.today()
    forecast: Dict[tuple[str, int, int], float] = defaultdict(float)

    if not codigos_set:
        return {}

    for row in _buscar_forecast_sop_rows() or []:
        codigo = _normalizar_codigo(row.get("cod_produto"))
        if codigo not in codigos_set:
            continue
        ano = _to_int(row.get("ano"))
        mes = _to_int(row.get("mes"))
        if ano <= 0 or not 1 <= mes <= 12:
            continue
        if (ano, mes) < (hoje.year, hoje.month):
            continue
        forecast[(codigo, ano, mes)] += _to_float(row.get("qtd_forecast"))

    return forecast


def _alocar_mps_para_grupo(
    disponivel: float,
    candidatos: List[Dict[str, Any]],
) -> tuple[Dict[str, float], float]:
    """
    Aloca disponibilidade em caixas por forecast.

    Se houver disponibilidade suficiente, cada PA recebe até o forecast.
    Se não houver, distribui proporcionalmente dentro do grupo.
    """
    alocado: Dict[str, float] = defaultdict(float)
    disponivel = max(0.0, _to_float(disponivel))
    candidatos = [c for c in (candidatos or []) if _to_float(c.get("forecast")) > 0]
    total_forecast = sum(_to_float(c.get("forecast")) for c in candidatos)

    if disponivel <= 0 or total_forecast <= 0:
        return alocado, disponivel

    if disponivel >= total_forecast:
        for c in candidatos:
            alocado[c["codigo_pa"]] += _to_float(c.get("forecast"))
        return alocado, disponivel - total_forecast

    # Rateio proporcional quando nem o grupo prioritário inteiro cabe.
    restante = disponivel
    for idx, c in enumerate(candidatos):
        codigo_pa = c["codigo_pa"]
        forecast = _to_float(c.get("forecast"))
        if idx == len(candidatos) - 1:
            qtd = max(0.0, restante)
        else:
            qtd = min(forecast, disponivel * (forecast / total_forecast))
            restante -= qtd
        alocado[codigo_pa] += qtd

    return alocado, 0.0


def _buscar_liberacoes_previstas_pa_por_mps_alocado_rows(
    codigos: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> List[Dict[str, Any]]:
    """
    Entradas previstas de PA produzido internamente via MPS/Gantt alocado.

    Regra validada:
    - MPS/Gantt está no nível PI e em tubetes;
    - forecast do PA está em caixas;
    - conversão: caixas = tubetes / 500;
    - para cada PI/mês, aloca primeiro para PAs de exportação conforme forecast;
    - a sobra vai para PAs nacionais conforme forecast;
    - a versão usada é sempre a rodada operacional mais atual disponível.
    """
    codigos_pa = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    if not codigos_pa:
        return []

    produtos_all = produtos_all or _buscar_d_produtos_por_codigos(codigos_pa)
    codigos_pa = [
        c for c in codigos_pa
        if str((produtos_all.get(c) or {}).get("tipo_produto_erp") or "").strip().upper() == "PA"
    ]
    if not codigos_pa:
        return []

    mapa_pi_pas = _buscar_mapa_pi_para_pas_por_bom(codigos_pa, produtos_all=produtos_all)
    codigos_pi = sorted(mapa_pi_pas.keys())
    if not codigos_pi:
        return []

    rodadas_por_mes, debug_rodadas = _buscar_rodadas_mps_mais_atuais_por_mes()
    if not rodadas_por_mes:
        return []

    hoje = date.today()
    forecast_pa_mes = _buscar_forecast_direto_pa_futuro(codigos_pa)

    # Soma MPS por PI/mês, deduplicando lote/OP dentro da rodada.
    por_pi_mes_lote: Dict[tuple[str, int, int, str], Dict[str, Any]] = {}

    for (ano_rodada, mes_rodada), rodada in sorted(rodadas_por_mes.items()):
        rodada_id = rodada.get("id")
        if not rodada_id:
            continue

        for chunk in _chunks_lista(codigos_pi, 350):
            try:
                etapas = _select_all(
                    supabase.table("f_mrp_etapas")
                    .select(
                        "id,rodada_id,lote,op,codigo_produto,descricao_produto,etapa,"
                        "recurso,linha_origem,data_inicio,data_fim,data_pa,qtd_planejada,"
                        "duracao_horas,sequencia,status,origem,mes_producao,ano_producao,"
                        "mes_liberacao,ano_liberacao,mes_lib_manual"
                    )
                    .eq("rodada_id", rodada_id)
                    .in_("codigo_produto", chunk)
                )
            except Exception:
                etapas = []

            for row in etapas or []:
                codigo_pi = _codigo_mps_linha(row)
                if codigo_pi not in mapa_pi_pas:
                    continue

                qtd_tubetes = _quantidade_mps_tubetes(row)
                if qtd_tubetes <= 0:
                    continue

                ano_ref, mes_ref = _ano_mes_mps_linha(row, ano_rodada, mes_rodada)
                if ano_ref <= 0 or mes_ref <= 0 or mes_ref > 12:
                    continue
                if (ano_ref, mes_ref) < (hoje.year, hoje.month):
                    continue

                lote_ref = str(row.get("lote") or "").strip()
                op_ref = str(row.get("op") or "").strip()
                chave_lote = "|".join([x for x in [lote_ref, op_ref] if x]) or str(row.get("id") or "")
                chave = (codigo_pi, ano_ref, mes_ref, chave_lote)

                atual = por_pi_mes_lote.get(chave)
                if atual is None or qtd_tubetes > _to_float(atual.get("qtd_tubetes")):
                    por_pi_mes_lote[chave] = {
                        "codigo_pi": codigo_pi,
                        "ano": ano_ref,
                        "mes": mes_ref,
                        "qtd_tubetes": qtd_tubetes,
                        "qtd_caixas": qtd_tubetes / MPS_TUBETES_POR_CAIXA,
                        "lote": row.get("lote"),
                        "op": row.get("op"),
                        "data_prevista_entrega": date(ano_ref, mes_ref, 1).isoformat(),
                        "mes_liberacao": mes_ref,
                        "ano_liberacao": ano_ref,
                        "descricao_produto": row.get("descricao_produto"),
                        "rodada_id": rodada_id,
                        "rodada_nome": rodada.get("nome"),
                        "rodada_versao": rodada.get("versao"),
                        "rodada_mes": rodada.get("mes"),
                        "rodada_ano": rodada.get("ano"),
                        "debug_rodadas": debug_rodadas,
                    }

    mps_por_pi_mes: Dict[tuple[str, int, int], Dict[str, Any]] = defaultdict(lambda: {
        "qtd_tubetes": 0.0,
        "qtd_caixas": 0.0,
        "linhas": [],
    })

    for info in por_pi_mes_lote.values():
        chave = (info["codigo_pi"], int(info["ano"]), int(info["mes"]))
        mps_por_pi_mes[chave]["qtd_tubetes"] += _to_float(info.get("qtd_tubetes"))
        mps_por_pi_mes[chave]["qtd_caixas"] += _to_float(info.get("qtd_caixas"))
        mps_por_pi_mes[chave]["linhas"].append(info)

    resultado_pre: List[Dict[str, Any]] = []

    for (codigo_pi, ano, mes), info_mps in sorted(mps_por_pi_mes.items(), key=lambda x: (x[0][1], x[0][2], x[0][0])):
        qtd_caixas_disponivel = _to_float(info_mps.get("qtd_caixas"))
        if qtd_caixas_disponivel <= 0:
            continue

        pas_do_pi = [pa for pa in mapa_pi_pas.get(codigo_pi, []) if pa in codigos_pa]
        if not pas_do_pi:
            continue

        candidatos = []
        for pa in pas_do_pi:
            forecast = _to_float(forecast_pa_mes.get((pa, ano, mes)))
            if forecast <= 0:
                continue
            produto_pa = produtos_all.get(pa) or {}
            candidatos.append({
                "codigo_pa": pa,
                "forecast": forecast,
                "prioridade": "exportacao" if _produto_eh_exportacao_mps(produto_pa) else "nacional",
                "produto": produto_pa,
            })

        if not candidatos:
            continue

        candidatos_export = sorted([c for c in candidatos if c["prioridade"] == "exportacao"], key=lambda c: (-_to_float(c.get("forecast")), c["codigo_pa"]))
        candidatos_nacional = sorted([c for c in candidatos if c["prioridade"] != "exportacao"], key=lambda c: (-_to_float(c.get("forecast")), c["codigo_pa"]))

        alocado_total: Dict[str, float] = defaultdict(float)
        alocado_export, sobra = _alocar_mps_para_grupo(qtd_caixas_disponivel, candidatos_export)
        for pa, qtd in alocado_export.items():
            alocado_total[pa] += qtd

        alocado_nacional, sobra_final = _alocar_mps_para_grupo(sobra, candidatos_nacional)
        for pa, qtd in alocado_nacional.items():
            alocado_total[pa] += qtd

        for pa, qtd_alocada in alocado_total.items():
            if qtd_alocada <= 0:
                continue
            produto_pa = produtos_all.get(pa) or {}
            prioridade = "exportacao" if _produto_eh_exportacao_mps(produto_pa) else "nacional"
            forecast_mes = _to_float(forecast_pa_mes.get((pa, ano, mes)))
            resultado_pre.append({
                "codigo": pa,
                "produto_codigo": pa,
                "quantidade_pendente": _round(qtd_alocada, 4),
                "quantidade_alocada_caixas": _round(qtd_alocada, 4),
                "qtd_mps_tubetes_pi": _round(info_mps.get("qtd_tubetes"), 4),
                "qtd_mps_caixas_pi": _round(qtd_caixas_disponivel, 4),
                "forecast_pa_mes": _round(forecast_mes, 4),
                "saldo_mps_nao_alocado_caixas": _round(sobra_final, 4),
                "data_prevista_entrega": date(ano, mes, 1).isoformat(),
                "mes_liberacao": mes,
                "ano_liberacao": ano,
                "pedido_numero": f"MPS-{codigo_pi}-{ano}{str(mes).zfill(2)}",
                "sc_numero": None,
                "fornecedor": "Produção interna / MPS",
                "comprador": None,
                "status_entrega": "mps_pi_alocado_por_forecast",
                "tipo_entrada": "mps_pi_alocado_forecast",
                "fonte_entradas_previstas": "mps_pi_alocado_por_forecast",
                "label_entradas_previstas": "MPS PI alocado ao PA por forecast",
                "codigo_pi_mps": codigo_pi,
                "prioridade_alocacao": prioridade,
                "ano": ano,
                "mes": mes,
                "linhas_mps_origem": info_mps.get("linhas") or [],
                "debug_rodadas": debug_rodadas,
            })

    # Segurança final: um PA pode aparecer ligado a mais de um PI/intermediário
    # pela estrutura. A alocação por PI, isoladamente, limita pelo forecast daquele
    # PI; mas somando vários PIs o PA podia receber várias vezes o forecast do
    # mesmo mês. Para a tela PA, a entrada prevista alocada não deve passar da
    # necessidade/forecast mensal do próprio PA, já que não temos agenda real de
    # embalagem por código PA final. Consolidamos por PA+mês e capamos no forecast.
    consolidado: Dict[tuple[str, int, int], Dict[str, Any]] = {}

    for row in resultado_pre:
        pa = _normalizar_codigo(row.get("produto_codigo") or row.get("codigo"))
        ano = _to_int(row.get("ano_liberacao") or row.get("ano"))
        mes = _to_int(row.get("mes_liberacao") or row.get("mes"))
        if not pa or ano <= 0 or not (1 <= mes <= 12):
            continue

        chave = (pa, ano, mes)
        forecast_mes = _to_float(forecast_pa_mes.get((pa, ano, mes)), _to_float(row.get("forecast_pa_mes")))

        if chave not in consolidado:
            consolidado[chave] = {
                "codigo": pa,
                "produto_codigo": pa,
                "quantidade_pendente_bruta": 0.0,
                "quantidade_pendente": 0.0,
                "quantidade_alocada_caixas": 0.0,
                "qtd_mps_tubetes_pi": 0.0,
                "qtd_mps_caixas_pi": 0.0,
                "forecast_pa_mes": _round(forecast_mes, 4),
                "data_prevista_entrega": date(ano, mes, 1).isoformat(),
                "mes_liberacao": mes,
                "ano_liberacao": ano,
                "pedido_numero": f"MPS-ALOCADO-{pa}-{ano}{str(mes).zfill(2)}",
                "sc_numero": None,
                "fornecedor": "Produção interna / MPS",
                "comprador": None,
                "status_entrega": "mps_pi_alocado_consolidado_por_pa_mes",
                "tipo_entrada": "mps_pi_alocado_forecast",
                "fonte_entradas_previstas": "mps_pi_alocado_por_forecast",
                "label_entradas_previstas": "MPS PI alocado ao PA por forecast",
                "codigo_pi_mps": None,
                "codigos_pi_mps": [],
                "prioridade_alocacao": row.get("prioridade_alocacao"),
                "ano": ano,
                "mes": mes,
                "linhas_mps_origem": [],
                "debug_rodadas": row.get("debug_rodadas"),
            }

        item = consolidado[chave]
        qtd = _to_float(row.get("quantidade_pendente"))
        item["quantidade_pendente_bruta"] += qtd
        item["qtd_mps_tubetes_pi"] += _to_float(row.get("qtd_mps_tubetes_pi"))
        item["qtd_mps_caixas_pi"] += _to_float(row.get("qtd_mps_caixas_pi"))

        codigo_pi = _normalizar_codigo(row.get("codigo_pi_mps"))
        if codigo_pi and codigo_pi not in item["codigos_pi_mps"]:
            item["codigos_pi_mps"].append(codigo_pi)

        item["linhas_mps_origem"].append({
            "codigo_pi_mps": codigo_pi,
            "quantidade_alocada_caixas": _round(qtd, 4),
            "qtd_mps_tubetes_pi": row.get("qtd_mps_tubetes_pi"),
            "qtd_mps_caixas_pi": row.get("qtd_mps_caixas_pi"),
            "forecast_pa_mes": row.get("forecast_pa_mes"),
            "pedido_numero": row.get("pedido_numero"),
            "linhas_mps_origem": row.get("linhas_mps_origem") or [],
        })

    resultado: List[Dict[str, Any]] = []
    for (pa, ano, mes), item in sorted(consolidado.items(), key=lambda x: (x[0][1], x[0][2], x[0][0])):
        bruto = _to_float(item.get("quantidade_pendente_bruta"))
        forecast_mes = _to_float(item.get("forecast_pa_mes"))
        cap = forecast_mes if forecast_mes > 0 else bruto
        final = min(bruto, cap)
        item["quantidade_pendente_bruta"] = _round(bruto, 4)
        item["quantidade_pendente"] = _round(final, 4)
        item["quantidade_alocada_caixas"] = _round(final, 4)
        item["qtd_mps_tubetes_pi"] = _round(item.get("qtd_mps_tubetes_pi"), 4)
        item["qtd_mps_caixas_pi"] = _round(item.get("qtd_mps_caixas_pi"), 4)
        item["codigos_pi_mps"] = sorted(set(item.get("codigos_pi_mps") or []))
        item["codigo_pi_mps"] = ",".join(item["codigos_pi_mps"]) if item["codigos_pi_mps"] else None
        item["alocacao_capada_no_forecast_pa_mes"] = bruto > final + 0.0001
        item["quantidade_cortada_por_cap_forecast"] = _round(max(0.0, bruto - final), 4)
        resultado.append(item)

    return resultado


def _buscar_liberacoes_previstas_pa_diretas_rows(
    codigos: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> List[Dict[str, Any]]:
    """
    Fallback antigo: se o MPS vier diretamente no PA, usa a liberação direta.

    Mantido apenas para não zerar casos em que a página MPS ainda não esteja no PI.
    Quando existe alocação por PI, ela tem prioridade.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}
    if not codigos_set:
        return []

    rodadas_por_mes, debug_rodadas = _buscar_rodadas_mps_mais_atuais_por_mes()
    if not rodadas_por_mes:
        return []

    inicio_mes_atual = date(date.today().year, date.today().month, 1)
    por_lote: Dict[tuple[str, str, int, int], Dict[str, Any]] = {}

    for (ano_rodada, mes_rodada), rodada in sorted(rodadas_por_mes.items()):
        rodada_id = rodada.get("id")
        if not rodada_id:
            continue
        for chunk in _chunks_lista(sorted(codigos_set), 350):
            try:
                etapas = _select_all(
                    supabase.table("f_mrp_etapas")
                    .select(
                        "id,rodada_id,lote,op,codigo_produto,descricao_produto,etapa,"
                        "recurso,linha_origem,data_inicio,data_fim,data_pa,qtd_planejada,"
                        "duracao_horas,sequencia,status,origem,mes_producao,ano_producao,"
                        "mes_liberacao,ano_liberacao,mes_lib_manual"
                    )
                    .eq("rodada_id", rodada_id)
                    .in_("codigo_produto", chunk)
                )
            except Exception:
                etapas = []

            for row in etapas or []:
                codigo = _codigo_mps_linha(row)
                if codigo not in codigos_set:
                    continue
                qtd = _quantidade_mps_tubetes(row)
                if qtd <= 0:
                    continue
                ano_ref, mes_ref = _ano_mes_mps_linha(row, ano_rodada, mes_rodada)
                data_ref = date(ano_ref, mes_ref, 1) if ano_ref > 0 and 1 <= mes_ref <= 12 else None
                if not data_ref or data_ref < inicio_mes_atual:
                    continue
                lote_ref = str(_coalesce(row.get("lote"), row.get("op"), row.get("id"), "") or "").strip()
                chave = (codigo, lote_ref or str(row.get("id") or ""), ano_ref, mes_ref)
                atual = por_lote.get(chave)
                if atual is None or qtd > _to_float(atual.get("quantidade_pendente")):
                    por_lote[chave] = {
                        "codigo": codigo,
                        "produto_codigo": codigo,
                        "quantidade_pendente": _round(qtd, 4),
                        "data_prevista_entrega": data_ref.isoformat(),
                        "pedido_numero": row.get("lote") or row.get("op"),
                        "sc_numero": row.get("op"),
                        "fornecedor": "Produção interna",
                        "comprador": None,
                        "status_entrega": row.get("status"),
                        "tipo_entrada": "liberacao_gantt_mps_direta_pa",
                        "fonte_entradas_previstas": "mps_direto_pa_fallback",
                        "label_entradas_previstas": "Liberações previstas",
                        "rodada_id": rodada_id,
                        "rodada_nome": rodada.get("nome"),
                        "rodada_versao": rodada.get("versao"),
                        "rodada_mes": rodada.get("mes"),
                        "rodada_ano": rodada.get("ano"),
                        "debug_rodadas": debug_rodadas,
                    }

    return sorted(por_lote.values(), key=lambda x: (x.get("data_prevista_entrega") or "9999-12-31", x.get("pedido_numero") or ""))


def _buscar_benzotop_liberacao_latest_upload_id() -> Optional[str]:
    try:
        res = (
            supabase.table("f_benzotop_liberacao")
            .select("upload_id,created_at")
            .eq("codigo_pa", BENZOTOP_LIBERACAO_CODIGO_PA)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return str((res.data[0] or {}).get("upload_id") or "") or None
    except Exception:
        return None


def _buscar_liberacoes_benzotop_rows(codigos: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Liberações previstas do Benzotop 52749 pela planilha específica.

    Fonte: public.f_benzotop_liberacao
    Regra: filtrar mês/ano de liberação e somar PRODUÇÃO DIA.
    Só se aplica ao código 52749 para não duplicar nos demais Benzotops.
    """
    codigos_norm = {_normalizar_codigo(c) for c in (codigos or [BENZOTOP_LIBERACAO_CODIGO_PA]) if _normalizar_codigo(c)}
    if codigos_norm and BENZOTOP_LIBERACAO_CODIGO_PA not in codigos_norm:
        return []

    upload_id = _buscar_benzotop_liberacao_latest_upload_id()
    if not upload_id:
        return []

    try:
        rows = _select_all(
            supabase.table("f_benzotop_liberacao")
            .select("*")
            .eq("codigo_pa", BENZOTOP_LIBERACAO_CODIGO_PA)
            .eq("upload_id", upload_id)
        )
    except Exception:
        rows = []

    hoje = date.today()
    inicio_mes_atual = date(hoje.year, hoje.month, 1)
    resultado: List[Dict[str, Any]] = []

    for row in rows or []:
        qtd = _to_float(row.get("producao_dia"))
        if qtd <= 0:
            continue

        ano = _to_int(row.get("ano_liberacao"))
        mes = _to_int(row.get("mes_liberacao"))
        data_liberacao = _parse_data(row.get("data_liberacao"))

        if (ano <= 0 or mes <= 0 or mes > 12) and data_liberacao:
            ano = data_liberacao.year
            mes = data_liberacao.month

        if ano <= 0 or mes <= 0 or mes > 12:
            continue

        data_bucket = date(ano, mes, 1)
        if data_bucket < inicio_mes_atual:
            continue

        resultado.append({
            "codigo": BENZOTOP_LIBERACAO_CODIGO_PA,
            "produto_codigo": BENZOTOP_LIBERACAO_CODIGO_PA,
            "produto_descricao": row.get("descricao_pa") or BENZOTOP_LIBERACAO_DESCRICAO_PA,
            "quantidade_pendente": _round(qtd, 4),
            "data_prevista_entrega": data_bucket.isoformat(),
            "data_liberacao": data_liberacao.isoformat() if data_liberacao else data_bucket.isoformat(),
            "pedido_numero": "LIB-BENZOTOP",
            "sc_numero": None,
            "fornecedor": "Produção Benzotop",
            "comprador": None,
            "status_entrega": "Liberação prevista",
            "tipo_entrada": "liberacao_benzotop",
            "fonte_entradas_previstas": "benzotop_liberacao",
            "label_entradas_previstas": "Liberação Benzotop",
            "ano_liberacao": ano,
            "mes_liberacao": mes,
            "data_envase": row.get("data_envase"),
            "mes_envase": row.get("mes_envase"),
            "ano_envase": row.get("ano_envase"),
            "parada": row.get("parada"),
            "dia_semana": row.get("dia_semana"),
            "upload_id": upload_id,
            "arquivo_origem": row.get("arquivo_origem"),
            "aba_origem": row.get("aba_origem"),
        })

    return sorted(resultado, key=lambda x: (x.get("data_prevista_entrega") or "9999-12-31", x.get("data_liberacao") or ""))


def _resumir_liberacoes_benzotop_rows(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    total = 0.0
    menor_data = None
    for row in rows or []:
        qtd = _to_float(row.get("quantidade_pendente"))
        if qtd <= 0:
            continue
        total += qtd
        data = row.get("data_prevista_entrega")
        if data and (menor_data is None or str(data) < str(menor_data)):
            menor_data = data

    if total <= 0:
        return {}

    return {
        BENZOTOP_LIBERACAO_CODIGO_PA: {
            "qtd_pedidos_abertos": _round(total, 4),
            "qtd_liberacoes_previstas": _round(total, 4),
            "qtd_pedidos_compra": 0.0,
            "menor_data_entrega": menor_data,
            "fonte_entradas_previstas": "benzotop_liberacao",
            "label_entradas_previstas": "Liberação Benzotop",
            "debug_entradas_previstas": {
                "fonte": "f_benzotop_liberacao",
                "upload_id": rows[0].get("upload_id") if rows else None,
                "qtd_linhas": len(rows or []),
            },
        }
    }


def _buscar_liberacoes_benzotop_resumido(codigos: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
    return _resumir_liberacoes_benzotop_rows(_buscar_liberacoes_benzotop_rows(codigos))


def _buscar_liberacoes_benzotop_periodo(codigos: List[str], granularidade: str = "mensal") -> List[Dict[str, Any]]:
    rows = _buscar_liberacoes_benzotop_rows(codigos)
    granularidade = _normalizar_granularidade(granularidade)
    por_periodo: Dict[str, Dict[str, Any]] = {}

    for row in rows or []:
        data_ref = _parse_data(row.get("data_prevista_entrega") or row.get("data_liberacao"))
        if not data_ref:
            continue

        info = _periodo_from_data(data_ref, granularidade)
        key = info["key"]
        if key not in por_periodo:
            por_periodo[key] = _empty_periodo_row(info)

        qtd = _to_float(row.get("quantidade_pendente"))
        por_periodo[key]["entradas_previstas"] = _round(
            _to_float(por_periodo[key].get("entradas_previstas")) + qtd,
            4,
        )
        por_periodo[key].setdefault("pedidos_detalhe", [])
        por_periodo[key]["pedidos_detalhe"].append(row)

    return [por_periodo[k] for k in sorted(por_periodo.keys())]



def _buscar_liberacoes_previstas_pa_rows(
    codigos: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> List[Dict[str, Any]]:
    """
    Entradas previstas de PA produzido internamente.

    Prioridade:
    1. MPS no nível PI alocado para PA por forecast, com conversão tubetes/500;
    2. fallback antigo: MPS direto no PA, se não houver alocação por PI para o SKU.
    """
    alocadas = _buscar_liberacoes_previstas_pa_por_mps_alocado_rows(codigos, produtos_all=produtos_all)
    codigos_com_alocacao = {_normalizar_codigo(r.get("produto_codigo") or r.get("codigo")) for r in alocadas}

    codigos_sem_alocacao = [
        _normalizar_codigo(c)
        for c in (codigos or [])
        if _normalizar_codigo(c) and _normalizar_codigo(c) not in codigos_com_alocacao
    ]
    diretas = _buscar_liberacoes_previstas_pa_diretas_rows(codigos_sem_alocacao, produtos_all=produtos_all)

    return sorted(alocadas + diretas, key=lambda x: (x.get("data_prevista_entrega") or "9999-12-31", x.get("produto_codigo") or x.get("codigo") or ""))


def _resumir_liberacoes_previstas_pa_rows(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    resumo: Dict[str, Dict[str, Any]] = {}

    for row in rows or []:
        codigo = _normalizar_codigo(row.get("produto_codigo") or row.get("codigo"))
        qtd = _to_float(row.get("quantidade_pendente"))
        if not codigo or qtd <= 0:
            continue

        if codigo not in resumo:
            resumo[codigo] = {
                "qtd_pedidos_abertos": 0.0,
                "qtd_liberacoes_previstas": 0.0,
                "qtd_pedidos_compra": 0.0,
                "menor_data_entrega": None,
                "fonte_entradas_previstas": row.get("fonte_entradas_previstas") or "mps_pi_alocado_por_forecast",
                "label_entradas_previstas": row.get("label_entradas_previstas") or "MPS PI alocado ao PA por forecast",
                "debug_entradas_previstas": row.get("debug_rodadas"),
            }

        resumo[codigo]["qtd_pedidos_abertos"] += qtd
        resumo[codigo]["qtd_liberacoes_previstas"] += qtd
        data_entrega = row.get("data_prevista_entrega")
        if data_entrega:
            atual = resumo[codigo]["menor_data_entrega"]
            if atual is None or str(data_entrega) < str(atual):
                resumo[codigo]["menor_data_entrega"] = data_entrega

        if row.get("fonte_entradas_previstas"):
            resumo[codigo]["fonte_entradas_previstas"] = row.get("fonte_entradas_previstas")
        if row.get("label_entradas_previstas"):
            resumo[codigo]["label_entradas_previstas"] = row.get("label_entradas_previstas")

    for codigo, info in resumo.items():
        info["qtd_pedidos_abertos"] = _round(info.get("qtd_pedidos_abertos"), 4)
        info["qtd_liberacoes_previstas"] = _round(info.get("qtd_liberacoes_previstas"), 4)

    return resumo


def _buscar_liberacoes_previstas_pa_resumido(
    codigos: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> Dict[str, Dict[str, Any]]:
    rows = _buscar_liberacoes_previstas_pa_rows(codigos, produtos_all=produtos_all)
    return _resumir_liberacoes_previstas_pa_rows(rows)


def _periodo_entrada_prevista_row(data_ref: date) -> Dict[str, Any]:
    info = _periodo_from_data(data_ref, "mensal")
    return {
        "key": info.get("key"),
        "ordem": info.get("ordem"),
        "periodo": info.get("periodo"),
        "periodo_completo": info.get("periodo_completo"),
        "data_inicio": info.get("data_inicio"),
        "data_fim": info.get("data_fim"),
        "ano": info.get("ano"),
        "mes": info.get("mes"),
        "entradas_previstas": 0.0,
        "qtd_entradas_previstas": 0.0,
        "pedidos_detalhe": [],
    }


def _adicionar_entrada_prevista_mes(
    mapa: Dict[str, Dict[tuple[int, int], Dict[str, Any]]],
    codigo_destino: str,
    data_ref: Optional[date],
    qtd: Any,
    detalhe: Optional[Dict[str, Any]] = None,
):
    codigo_destino = _normalizar_codigo(codigo_destino)
    qtd_float = _to_float(qtd)

    if not codigo_destino or data_ref is None or qtd_float <= 0:
        return

    chave = (data_ref.year, data_ref.month)

    if chave not in mapa[codigo_destino]:
        mapa[codigo_destino][chave] = _periodo_entrada_prevista_row(date(data_ref.year, data_ref.month, 1))

    ponto = mapa[codigo_destino][chave]
    ponto["entradas_previstas"] = _round(_to_float(ponto.get("entradas_previstas")) + qtd_float, 4)
    ponto["qtd_entradas_previstas"] = ponto["entradas_previstas"]

    if detalhe:
        ponto.setdefault("pedidos_detalhe", [])
        ponto["pedidos_detalhe"].append(detalhe)


def _finalizar_entradas_previstas_serie(
    mapa: Dict[str, Dict[tuple[int, int], Dict[str, Any]]]
) -> Dict[str, List[Dict[str, Any]]]:
    resultado: Dict[str, List[Dict[str, Any]]] = {}

    for codigo, por_mes in mapa.items():
        resultado[codigo] = [
            {
                **ponto,
                "entradas_previstas": _round(ponto.get("entradas_previstas"), 4),
                "qtd_entradas_previstas": _round(ponto.get("qtd_entradas_previstas"), 4),
            }
            for _, ponto in sorted(por_mes.items(), key=lambda x: x[0])
        ]

    return resultado


def _buscar_entradas_previstas_serie_por_codigo(
    codigos: List[str],
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
    mapa_pa_pi_bravi: Optional[Dict[str, List[str]]] = None,
    liberacoes_pa_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Série mensal das entradas previstas por SKU.

    Regra validada na tela de Gestão de Estoques:
      - pedido/SC deve cair no mês da data_prevista_entrega ou data_previsao_necessidade;
      - nunca jogar o total de pedidos no mês atual só porque existe quantidade aberta;
      - PA interno não usa MPS como entrada no PA nesta versão;
      - MR/PPS/revenda usa pedidos de compra;
      - PA Bravi usa compras dos PIs vinculados.
    """
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    if not codigos_norm:
        return {}

    mapa_pa_pi_bravi = mapa_pa_pi_bravi or _mapear_pa_para_pi_bravi(codigos_norm, produtos_all=produtos_all, rows=rows)
    mapa_saida: Dict[str, Dict[tuple[int, int], Dict[str, Any]]] = defaultdict(dict)

    row_por_codigo = {
        _normalizar_codigo(row.get("codigo")): row
        for row in (rows or [])
        if _normalizar_codigo(row.get("codigo"))
    }

    # 1) PA produzido internamente: NÃO adiciona MPS como entrada prevista no PA.
    # O MPS está no nível PI/envase e o rateio PI -> PA ainda será validado.
    # Por isso, nesta versão, o gráfico/status de PA interno usa somente estoque atual.


    # 1.1) Benzotop 52749: entrada prevista vem da planilha específica
    # CAPACIDADE X FORECAST BENZOTOP, somando PRODUÇÃO DIA por mês de liberação.
    for row_benz in _buscar_liberacoes_benzotop_rows(codigos_norm):
        data_ref = _parse_data(row_benz.get("data_prevista_entrega") or row_benz.get("data_liberacao"))
        qtd = _to_float(row_benz.get("quantidade_pendente"))
        _adicionar_entrada_prevista_mes(mapa_saida, BENZOTOP_LIBERACAO_CODIGO_PA, data_ref, qtd, row_benz)

    # 2) Pedidos/SC de compra: buscar uma vez para os códigos de compra diretos + PIs Bravi.
    codigos_consulta = set(codigos_norm)
    for pis in (mapa_pa_pi_bravi or {}).values():
        for pi in pis or []:
            pi_norm = _normalizar_codigo(pi)
            if pi_norm:
                codigos_consulta.add(pi_norm)

    try:
        compras_rows = _select_all_por_codigos(
            "f_compras_abertas",
            "produto_codigo",
            sorted(codigos_consulta),
            """
                produto_codigo,
                quantidade_pendente,
                data_prevista_entrega,
                data_previsao_necessidade,
                pedido_numero,
                sc_numero,
                razao_social_fornecedor,
                comprador_nome,
                entrega_status
            """,
        )
    except Exception:
        compras_rows = []

    compras_por_codigo: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in compras_rows or []:
        codigo_compra = _normalizar_codigo(row.get("produto_codigo"))
        qtd = _to_float(row.get("quantidade_pendente"))
        data_ref = _parse_data(_data_prevista_compra(row))

        if not codigo_compra or qtd <= 0 or data_ref is None:
            continue

        compras_por_codigo[codigo_compra].append(row)

    for codigo in codigos_norm:
        row_ref = row_por_codigo.get(codigo) or {"codigo": codigo}
        tipo = _tipo_produto_erp_por_codigo(codigo, row=row_ref, produtos_all=produtos_all)

        if codigo == BENZOTOP_LIBERACAO_CODIGO_PA:
            # A série mensal do Benzotop já foi adicionada acima a partir de
            # f_benzotop_liberacao. Não buscar RELPC/compras para o 52749.
            codigos_compra_item = []
        elif _item_deve_usar_entrada_pi_bravi(
            codigo,
            tipo=tipo,
            row=row_ref,
            produtos_all=produtos_all,
            mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        ):
            codigos_compra_item = mapa_pa_pi_bravi.get(codigo) or []
        elif _item_produto_usa_mps_interno(
            codigo,
            tipo=tipo,
            row=row_ref,
            produtos_all=produtos_all,
        ):
            # PA interno já foi tratado pelo MPS. Não joga compra no mês atual.
            codigos_compra_item = []
        else:
            codigos_compra_item = [codigo]

        for codigo_compra in codigos_compra_item:
            codigo_compra_norm = _normalizar_codigo(codigo_compra)
            for row in compras_por_codigo.get(codigo_compra_norm, []) or []:
                data_ref = _parse_data(_data_prevista_compra(row))
                qtd = _to_float(row.get("quantidade_pendente"))
                detalhe = {
                    "tipo_entrada": "pedido_compra",
                    "produto_codigo": codigo_compra_norm,
                    "pedido_numero": row.get("pedido_numero"),
                    "sc_numero": row.get("sc_numero"),
                    "quantidade_pendente": _round(qtd, 4),
                    "data_prevista_entrega": data_ref.isoformat() if data_ref else _data_prevista_compra(row),
                    "data_previsao_necessidade": row.get("data_previsao_necessidade"),
                    "origem_data_prevista": _origem_data_prevista_compra(row),
                    "fornecedor": row.get("razao_social_fornecedor"),
                    "comprador": row.get("comprador_nome"),
                    "status_entrega": row.get("entrega_status"),
                }
                _adicionar_entrada_prevista_mes(mapa_saida, codigo, data_ref, qtd, detalhe)

    return _finalizar_entradas_previstas_serie(mapa_saida)


def _buscar_liberacoes_previstas_pa_detalhadas(codigo: str) -> List[Dict[str, Any]]:
    codigo_norm = _normalizar_codigo(codigo)
    produtos_all = _buscar_d_produtos_por_codigos([codigo_norm])
    return [
        row for row in _buscar_liberacoes_previstas_pa_rows([codigo_norm], produtos_all=produtos_all)
        if _normalizar_codigo(row.get("produto_codigo") or row.get("codigo")) == codigo_norm
    ]


def _buscar_liberacoes_previstas_pa_periodo(codigos: List[str], granularidade: str = "mensal") -> List[Dict[str, Any]]:
    produtos_all = _buscar_d_produtos_por_codigos(sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}))
    rows = _buscar_liberacoes_previstas_pa_rows(codigos, produtos_all=produtos_all)
    granularidade = _normalizar_granularidade(granularidade)
    por_periodo: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        data_ref = _parse_data(row.get("data_prevista_entrega"))
        if not data_ref:
            continue

        info = _periodo_from_data(data_ref, granularidade)
        key = info["key"]
        if key not in por_periodo:
            por_periodo[key] = _empty_periodo_row(info)

        qtd = _to_float(row.get("quantidade_pendente"))
        por_periodo[key]["entradas_previstas"] = _round(
            _to_float(por_periodo[key].get("entradas_previstas")) + qtd,
            4,
        )
        por_periodo[key]["pedidos_detalhe"].append(row)

    return [por_periodo[k] for k in sorted(por_periodo.keys())]



def _texto_produto_para_regra_entrada(
    codigo: str,
    row: Optional[Dict[str, Any]] = None,
    produtos_all: Optional[Dict[str, dict]] = None,
) -> str:
    """
    Junta campos gerenciais/cadastrais para decidir a fonte de entrada prevista.

    Regra da Gestão PA:
    - Anestésicos e Benzotop produzidos internamente usam MPS/Gantt;
    - PPS/MR/revenda usam pedidos de compra;
    - Bravi é tratado antes pela regra especial PA -> PI.
    """
    codigo_norm = _normalizar_codigo(codigo)
    produto = (produtos_all or {}).get(codigo_norm) or {}
    row = row or {}

    campos = [
        produto.get("tipo_produto_erp"),
        produto.get("tipo_negocio"),
        produto.get("macro_negocio"),
        produto.get("grupo_gerencial"),
        produto.get("familia"),
        produto.get("segmento"),
        produto.get("linha"),
        produto.get("modelo_fornecimento"),
        produto.get("fornecedor_terceiro"),
        produto.get("mercado"),
        produto.get("desc_produto"),
        produto.get("concatenado_produto"),
        row.get("tipo"),
        row.get("tipo_produto_erp"),
        row.get("tipo_negocio"),
        row.get("macro_negocio"),
        row.get("grupo_gerencial"),
        row.get("familia"),
        row.get("segmento"),
        row.get("linha"),
        row.get("modelo_fornecimento"),
        row.get("produto"),
        row.get("descricao"),
        row.get("desc_produto"),
    ]

    texto = " ".join(str(v or "") for v in campos).strip().upper()
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
    texto = re.sub(r"\s+", " ", texto)
    return texto


def _item_produto_usa_mps_interno(
    codigo: str,
    tipo: Optional[str] = None,
    row: Optional[Dict[str, Any]] = None,
    produtos_all: Optional[Dict[str, dict]] = None,
) -> bool:
    """
    Decide se o PA deve buscar entrada prevista no MPS/Gantt.

    Regra validada:
    - Anestésicos Injetáveis e Benzotop: entrada do PA vem do MPS/Gantt;
    - o MPS pode estar no nível PI, então usamos a alocação PI -> PA por forecast;
    - forecast está em caixas e MPS em tubetes; conversão feita na função de alocação;
    - PPS/MR/revenda/terceirizados não usam MPS como entrada do PA, usam compras.
    """
    tipo_norm = str(tipo or "").strip().upper()
    codigo_norm = _normalizar_codigo(codigo)

    if not codigo_norm:
        return False

    if tipo_norm in {"MR", "PPS", "PV", "MP", "ME", "MI", "PI", "MP/ME"}:
        return False

    # Bravi tem regra própria e já é tratado antes de chegar aqui.
    if codigo_norm in BRAVI_PA_PI_STATIC_MAP:
        return False

    texto = _texto_produto_para_regra_entrada(codigo_norm, row=row, produtos_all=produtos_all)

    # PPS/revenda/terceiro sempre fica em compras para não misturar com produção interna.
    if any(termo in texto for termo in ["PPS", "REVENDA", "TERCEIR", "COMPRADO", "COMPRA"]):
        if "BENZOTOP" not in texto and "ANEST" not in texto:
            return False
        # Mesmo que apareça algum termo junto, PPS deve ganhar prioridade como revenda.
        if "PPS" in texto:
            return False

    linha_detectada = _linha_bom_from_texto(texto)
    if linha_detectada in {"Anestésicos Injetáveis", "Benzotop"}:
        return True

    termos_anestesicos = [
        "ALPHACAINE",
        "ARTICAINE",
        "MEPISV",
        "MEPIADRE",
        "PRILONEST",
        "LIDOCAINE",
        "LIDOCAINA",
        "MEPIVACAINE",
        "MEPIVACAINA",
    ]
    if "BENZOTOP" in texto:
        return True
    if any(termo in texto for termo in termos_anestesicos):
        return True

    return False

def _combinar_entradas_previstas_por_tipo(
    codigos: List[str],
    rows: List[Dict[str, Any]],
    produtos_all: Dict[str, dict],
    compras: Dict[str, Dict[str, Any]],
    liberacoes_pa: Dict[str, Dict[str, Any]],
    mapa_pa_pi_bravi: Optional[Dict[str, List[str]]] = None,
    saldos_pi_bravi: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Monta uma única estrutura de entradas previstas, respeitando o tipo do item.

    PA normal: entradas previstas zeradas enquanto o rateio PI -> PA não estiver validado.
    PA Bravi em transferência: entradas previstas = compras/saldo do PI vinculado.
    MR/PPS/PV: entradas previstas = pedidos de compra.
    Demais itens: mantém pedidos de compra quando existirem.
    """
    row_por_codigo = {
        _normalizar_codigo(row.get("codigo")): row
        for row in (rows or [])
        if _normalizar_codigo(row.get("codigo"))
    }

    mapa_pa_pi_bravi = mapa_pa_pi_bravi or _mapear_pa_para_pi_bravi(
        list(codigos or []),
        produtos_all=produtos_all,
        rows=rows,
    )
    saldos_pi_bravi = saldos_pi_bravi or _buscar_saldo_pi_bravi_resumido(mapa_pa_pi_bravi)

    benzotop_liberacoes = _buscar_liberacoes_benzotop_resumido(codigos)

    resultado: Dict[str, Dict[str, Any]] = {}

    for codigo in {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}:
        tipo = _tipo_produto_erp_por_codigo(codigo, row=row_por_codigo.get(codigo), produtos_all=produtos_all)

        if codigo == BENZOTOP_LIBERACAO_CODIGO_PA:
            entrada = dict(benzotop_liberacoes.get(codigo) or {})
            entrada.setdefault("qtd_pedidos_abertos", 0.0)
            entrada.setdefault("qtd_liberacoes_previstas", _to_float(entrada.get("qtd_pedidos_abertos")))
            entrada.setdefault("qtd_pedidos_compra", 0.0)
            entrada.setdefault("fonte_entradas_previstas", "benzotop_liberacao")
            entrada.setdefault("label_entradas_previstas", "Liberação Benzotop")
        elif _item_deve_usar_entrada_pi_bravi(
            codigo,
            tipo=tipo,
            row=row_por_codigo.get(codigo),
            produtos_all=produtos_all,
            mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        ):
            entrada = _entradas_bravi_pa_por_pi(
                codigo,
                mapa_pa_pi_bravi,
                compras,
                saldos_pi_bravi=saldos_pi_bravi,
            )
        elif _item_produto_usa_mps_interno(
            codigo,
            tipo=tipo,
            row=row_por_codigo.get(codigo),
            produtos_all=produtos_all,
        ):
            # Regra v71:
            # Para PA produzido internamente, por enquanto a Gestão não considera
            # entradas previstas do MPS no status/gráfico do SKU.
            # Motivo: o MPS está no nível de envase/PI e ainda precisa de rateio
            # validado para virar PA. Até fechar esse rateio, o PA é analisado
            # somente pelo estoque atual contra o forecast.
            entrada = {}
            entrada.setdefault("qtd_pedidos_abertos", 0.0)
            entrada.setdefault("qtd_liberacoes_previstas", 0.0)
            entrada.setdefault("qtd_pedidos_compra", 0.0)
            entrada.setdefault("fonte_entradas_previstas", "estoque_atual_sem_mps_pa")
            entrada.setdefault("label_entradas_previstas", "Sem entrada MPS no PA")
        elif tipo in {"MR", "PPS", "PV"}:
            entrada = dict(compras.get(codigo) or {})
            entrada.setdefault("qtd_pedidos_abertos", 0.0)
            entrada.setdefault("qtd_pedidos_compra", _to_float(entrada.get("qtd_pedidos_abertos")))
            entrada.setdefault("qtd_liberacoes_previstas", 0.0)
            entrada.setdefault("fonte_entradas_previstas", "pedidos_compra")
            entrada.setdefault("label_entradas_previstas", "Entradas previstas")
        else:
            entrada = dict(compras.get(codigo) or {})
            entrada.setdefault("qtd_pedidos_abertos", 0.0)
            entrada.setdefault("qtd_pedidos_compra", _to_float(entrada.get("qtd_pedidos_abertos")))
            entrada.setdefault("qtd_liberacoes_previstas", 0.0)
            entrada.setdefault("fonte_entradas_previstas", "pedidos_compra")
            entrada.setdefault("label_entradas_previstas", "Entradas previstas")

        resultado[codigo] = entrada

    return resultado


def _buscar_entradas_previstas_detalhadas(codigo: str, tipo: Optional[str]) -> List[Dict[str, Any]]:
    tipo_norm = str(tipo or "").strip().upper()
    codigo_norm = _normalizar_codigo(codigo)

    codigos_dim = {codigo_norm}
    for pi_tmp in BRAVI_PA_PI_STATIC_MAP.get(codigo_norm) or []:
        codigos_dim.add(_normalizar_codigo(pi_tmp))
    produtos_all = _buscar_d_produtos_por_codigos(sorted(codigos_dim))
    mapa_pa_pi = _mapear_pa_para_pi_bravi([codigo_norm], produtos_all=produtos_all, rows=[])

    if codigo_norm == BENZOTOP_LIBERACAO_CODIGO_PA:
        entradas_benzotop = _buscar_liberacoes_benzotop_rows([codigo_norm])
        if entradas_benzotop:
            return entradas_benzotop

    if _item_deve_usar_entrada_pi_bravi(
        codigo_norm,
        tipo=tipo_norm,
        produtos_all=produtos_all,
        mapa_pa_pi_bravi=mapa_pa_pi,
    ):
        entradas_bravi = _buscar_entradas_bravi_pa_detalhadas(codigo_norm)
        if entradas_bravi:
            return entradas_bravi

    if _item_produto_usa_mps_interno(
        codigo_norm,
        tipo=tipo_norm,
        produtos_all=produtos_all,
    ):
        return _buscar_liberacoes_previstas_pa_detalhadas(codigo_norm)

    return _buscar_compras_detalhadas(codigo_norm)


def _buscar_entradas_previstas_periodo_por_tipo(
    codigos: List[str],
    tipos_por_codigo: Optional[Dict[str, Any]] = None,
    granularidade: str = "mensal",
) -> List[Dict[str, Any]]:
    tipos_por_codigo = tipos_por_codigo or {}
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    codigos_dim = set(codigos_norm)
    for codigo_tmp in codigos_norm:
        for pi_tmp in BRAVI_PA_PI_STATIC_MAP.get(codigo_tmp) or []:
            codigos_dim.add(_normalizar_codigo(pi_tmp))

    produtos_all = _buscar_d_produtos_por_codigos(sorted(codigos_dim))
    mapa_pa_pi = _mapear_pa_para_pi_bravi(codigos_norm, produtos_all=produtos_all, rows=[])

    codigos_benzotop = []
    codigos_pa_normais = []
    codigos_pa_bravi = []
    codigos_compra = []

    for codigo in codigos_norm:
        tipo = str(tipos_por_codigo.get(codigo) or (produtos_all.get(codigo) or {}).get("tipo_produto_erp") or "").strip().upper()
        if codigo == BENZOTOP_LIBERACAO_CODIGO_PA:
            codigos_benzotop.append(codigo)
            continue

        if _item_deve_usar_entrada_pi_bravi(
            codigo,
            tipo=tipo,
            produtos_all=produtos_all,
            mapa_pa_pi_bravi=mapa_pa_pi,
        ):
            codigos_pa_bravi.append(codigo)
            codigos_compra.extend(mapa_pa_pi.get(codigo) or [])
        elif _item_produto_usa_mps_interno(
            codigo,
            tipo=tipo,
            produtos_all=produtos_all,
        ):
            codigos_pa_normais.append(codigo)
        else:
            codigos_compra.append(codigo)

    codigos_compra = sorted({_normalizar_codigo(c) for c in codigos_compra if _normalizar_codigo(c)})

    return _merge_series_periodo(
        _buscar_liberacoes_benzotop_periodo(codigos_benzotop, granularidade=granularidade) if codigos_benzotop else [],
        _buscar_liberacoes_previstas_pa_periodo(codigos_pa_normais, granularidade=granularidade) if codigos_pa_normais else [],
        _buscar_compras_periodo(codigos_compra, granularidade=granularidade) if codigos_compra else [],
        _buscar_saldo_pi_bravi_periodo(codigos_pa_bravi, mapa_pa_pi, granularidade=granularidade) if codigos_pa_bravi else [],
    )

def _buscar_forecast_sop_rows(
    ano: Optional[int] = None,
    mes: Optional[int] = None,
) -> List[Dict[str, Any]]:
    try:
        # Select * para aceitar bases S&OP em formato longo com tipo/cenário
        # e/ou colunas extras de faturado. A filtragem abaixo evita misturar
        # Faturado/LY dentro da previsão futura.
        query = supabase.table("f_forecast_sop").select("*")

        if ano is not None:
            query = query.eq("ano", ano)

        if mes is not None:
            query = query.eq("mes", mes)

        rows = _select_all(query)
        return [row for row in (rows or []) if _row_forecast_sop_eh_demanda_forecast(row)]
    except Exception:
        return []


def _rows_mes_atual(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    hoje = date.today()
    return [
        r for r in (rows or [])
        if int(r.get("ano") or 0) == hoje.year
        and int(r.get("mes") or 0) == hoje.month
    ]


def _buscar_forecast_futuro_por_codigo(
    codigos: List[str],
    produtos_all: Optional[Dict[str, dict]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Série futura de demanda por SKU para dashboard e cobertura.

    Regra final da Gestão:
      - PA/MR/PPS/PV/Bravi: usa forecast direto do SKU;
      - Insumos MP/ME/MI/PI: usa a programação/Gantt V1 do mês atual,
        somando L1 + L2 e explodindo pela BOM multinível;
      - se não houver V1 disponível, usa forecast S&OP explodido como fallback;
      - mantém meses com demanda zero quando eles existem na fonte da programação,
        para o front desenhar buraco/linha quebrada em vez de inventar consumo.
    """
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}
    if not codigos_set:
        return {}

    hoje = date.today()
    produtos_all = produtos_all or {}

    forecast_rows_all = []
    for row in _buscar_forecast_sop_rows() or []:
        ano = _to_int(row.get("ano"))
        mes = _to_int(row.get("mes"))
        if ano <= 0 or mes <= 0 or mes > 12:
            continue
        if (ano, mes) < (hoje.year, hoje.month):
            continue
        forecast_rows_all.append(row)

    demanda_direta, demanda_explodida_sop = _explodir_forecast_multinivel(
        forecast_rows_all,
        codigos_interesse=codigos_set,
    ) if forecast_rows_all else ({}, {})

    programacao_rows, debug_programacao = _buscar_mrp_v1_l1_l2_rows()
    origem_insumos = "mrp_v1_l1_l2_bom"

    if programacao_rows:
        source_rows_insumos = [
            r for r in programacao_rows
            if (_to_int(r.get("ano")), _to_int(r.get("mes"))) >= (hoje.year, hoje.month)
        ]
        _, demanda_explodida_mps = _explodir_forecast_multinivel(
            source_rows_insumos,
            codigos_interesse=codigos_set,
        )
    else:
        source_rows_insumos = forecast_rows_all
        demanda_explodida_mps = demanda_explodida_sop
        origem_insumos = "forecast_sop_bom_fallback_sem_programacao_v1"

    meses_insumos_programacao = sorted({
        (_to_int(r.get("ano")), _to_int(r.get("mes")))
        for r in source_rows_insumos or []
        if _to_int(r.get("ano")) > 0 and 1 <= _to_int(r.get("mes")) <= 12
    })
    meses_insumos_sop = sorted({
        (_to_int(r.get("ano")), _to_int(r.get("mes")))
        for r in forecast_rows_all or []
        if _to_int(r.get("ano")) > 0 and 1 <= _to_int(r.get("mes")) <= 12
    })
    # V79: fallback por item/mês.
    # Se a V1/Gantt existe, mas não carrega uma família como Benzotop,
    # o componente ficava com previsão zerada apesar de existir forecast S&OP
    # explodível pela BOM. Mantemos V1 como prioridade; quando ela não trouxer
    # demanda para o item, usamos o S&OP explodido como referência operacional.
    meses_insumos = sorted(set(meses_insumos_programacao) | set(meses_insumos_sop))
    meses_forecast = sorted({
        (_to_int(r.get("ano")), _to_int(r.get("mes")))
        for r in forecast_rows_all or []
        if _to_int(r.get("ano")) > 0 and 1 <= _to_int(r.get("mes")) <= 12
    })

    resultado: Dict[str, List[Dict[str, Any]]] = {}

    for codigo in codigos_set:
        tipo = _tipo_produto_erp_por_codigo(codigo, produtos_all=produtos_all)
        usar_direto = tipo in {"PA", "MR", "PPS", "PV", "PA/MR"} or codigo in BRAVI_PA_PI_STATIC_MAP
        meses_base = meses_forecast if usar_direto else meses_insumos
        serie = []

        for ano, mes in meses_base:
            chave = (codigo, ano, mes)
            if usar_direto:
                valor = demanda_direta.get(chave, 0.0)
                metodo = "forecast_direto"
            else:
                valor_mps = demanda_explodida_mps.get(chave, 0.0)
                valor_sop = demanda_explodida_sop.get(chave, 0.0)
                if valor_mps > 0:
                    valor = valor_mps
                    metodo = origem_insumos
                elif valor_sop > 0:
                    valor = valor_sop
                    metodo = "forecast_sop_bom_fallback_item_sem_demanda_v1"
                else:
                    valor = 0.0
                    metodo = origem_insumos

            serie.append({
                "ano": ano,
                "mes": mes,
                "periodo": _mes_label(mes, ano),
                "forecast": _round(valor, 4),
                "demanda": _round(valor, 4),
                "qtd_forecast": _round(valor, 4),
                "metodo": metodo,
                "origem_demanda": metodo,
                "debug_programacao_v1": {
                    "fonte_demanda": origem_insumos,
                    "tabela": (debug_programacao or {}).get("tabela"),
                    "qtd_linhas_normalizadas": (debug_programacao or {}).get("qtd_linhas_normalizadas"),
                    "mes_base": (debug_programacao or {}).get("mes_base"),
                } if not usar_direto else None,
            })

        resultado[codigo] = serie

    return resultado

def _buscar_demanda_mes_atual(codigos: List[str]):
    """
    Calcula a demanda do mês atual para a tabela de Aging.

    Regra atualizada:
      - PA/MR continuam com demanda direta do forecast S&OP para a visão comercial;
      - insumos usam demanda explodida pela BOM com base na programação/Gantt V1,
        somando L1 + L2 por SKU/mês;
      - se a programação V1 não for encontrada, usa forecast S&OP como fallback
        para não quebrar a tela.
    """
    codigos_set = set(codigos or [])

    if not codigos_set:
        return {}

    hoje = date.today()
    ano_atual = hoje.year
    mes_atual = hoje.month

    demanda = {
        codigo: {
            "demanda_direta_mes_atual": 0.0,
            "demanda_bom_mes_atual": 0.0,
            "origem_demanda_bom": "mrp_v1_l1_l2_bom",
            "debug_programacao_v1": None,
        }
        for codigo in codigos_set
    }

    # Demanda direta de PA/MR segue no forecast comercial.
    forecast_rows_mes = _buscar_forecast_sop_rows(ano_atual, mes_atual)

    demanda_direta_forecast, demanda_explodida_sop_mes = _explodir_forecast_multinivel(
        forecast_rows_mes,
        codigos_interesse=codigos_set,
    )

    # Demanda de insumos passa a vir da programação/Gantt V1.
    programacao_rows, debug_programacao = _buscar_mrp_v1_l1_l2_rows()

    origem_demanda_bom = "mrp_v1_l1_l2_bom"

    if not programacao_rows:
        # Fallback controlado: mantém a tela funcionando enquanto validamos o
        # nome/estrutura da tabela de Gantt no ambiente.
        programacao_rows = forecast_rows_mes
        origem_demanda_bom = "forecast_sop_bom_fallback_sem_programacao_v1"

    # Explode a programação inteira (todos os meses) e filtra o resultado pelo
    # mês atual depois, em vez de filtrar as linhas de entrada antes de
    # explodir. Isso alinha com o gráfico de detalhe (_forecast_explodido_bom)
    # e evita zerar a demanda de um insumo quando o intermediário da BOM (PI)
    # aparece na programação com um mês próprio diferente do mês do PA final
    # que efetivamente puxa a demanda no mês atual.
    _, demanda_explodida_completa = _explodir_forecast_multinivel(
        programacao_rows,
        codigos_interesse=codigos_set,
    )
    demanda_explodida = {
        chave: valor
        for chave, valor in demanda_explodida_completa.items()
        if chave[1] == ano_atual and chave[2] == mes_atual
    }

    for codigo in codigos_set:
        chave_mes = (codigo, ano_atual, mes_atual)
        demanda[codigo]["demanda_direta_mes_atual"] = demanda_direta_forecast.get(
            chave_mes,
            0.0,
        )

        valor_mps = demanda_explodida.get(chave_mes, 0.0)
        valor_sop = demanda_explodida_sop_mes.get(chave_mes, 0.0)

        # V79: mantém a programação/Gantt V1 como fonte prioritária, mas,
        # quando ela não explode demanda para o item no mês, usa o S&OP
        # explodido como fallback. Isso cobre famílias como Benzotop, que têm
        # forecast do mês, mas podem não estar na V1 L1/L2.
        if valor_mps > 0:
            valor_bom = valor_mps
            origem_item = origem_demanda_bom
        elif valor_sop > 0:
            valor_bom = valor_sop
            origem_item = "forecast_sop_bom_fallback_item_sem_demanda_v1"
        else:
            valor_bom = 0.0
            origem_item = origem_demanda_bom

        demanda[codigo]["demanda_bom_mes_atual"] = valor_bom
        demanda[codigo]["origem_demanda_bom"] = origem_item
        demanda[codigo]["debug_programacao_v1"] = {
            "fonte_demanda": origem_item,
            "tabela": debug_programacao.get("tabela"),
            "qtd_linhas_normalizadas": debug_programacao.get("qtd_linhas_normalizadas"),
            "mes_base": debug_programacao.get("mes_base"),
            "valor_mps_v1": _round(valor_mps, 4),
            "valor_sop_explodido": _round(valor_sop, 4),
        }

    return demanda

def _coalesce(*values):
    for value in values:
        if value is None:
            continue

        texto = str(value).strip()

        if not texto:
            continue

        if texto.upper() in {"NAN", "NONE", "NULL"}:
            continue

        return value

    return None


def _valor_gerencial(produto: Optional[dict], campo: str, default: str = "A classificar"):
    if not produto:
        return default

    valor = produto.get(campo)

    if valor is None:
        return default

    texto = str(valor).strip()

    if not texto:
        return default

    return texto


def _normalizar_demanda_futura_para_cobertura(
    forecast_codigo: List[Dict[str, Any]],
    consumo_mes_atual: float = 0.0,
    data_ref: Optional[date] = None,
) -> List[Dict[str, Any]]:
    """
    Normaliza a série futura usada para cobertura operacional.

    Regra validada com PCP:
      - PA/MR/PPS: cobertura consome o forecast futuro mês a mês;
      - insumos: cobertura consome a demanda futura explodida pela BOM;
      - no mês atual, a cobertura usa somente a demanda que ainda falta atender:
            demanda_restante_mes_atual = max(demanda_mes_atual - consumo_real_mes_atual, 0)
        e conta apenas a fração de mês restante:
            dias_restantes_incluindo_hoje / dias_do_mes
      - meses futuros entram como 1,00 mês cheio.
    """
    hoje = data_ref or date.today()
    dias_no_mes = calendar.monthrange(hoje.year, hoje.month)[1]
    dias_restantes = max(0, dias_no_mes - hoje.day + 1)
    fracao_mes_atual = dias_restantes / max(1, dias_no_mes)

    consumo_mes_atual = max(0.0, _to_float(consumo_mes_atual))
    pontos: List[Dict[str, Any]] = []

    for ponto in forecast_codigo or []:
        ano = _to_int(ponto.get("ano"))
        mes = _to_int(ponto.get("mes"))

        if ano <= 0 or mes <= 0 or mes > 12:
            continue

        if (ano, mes) < (hoje.year, hoje.month):
            continue

        demanda_original = max(
            0.0,
            _to_float(
                _coalesce(
                    ponto.get("forecast"),
                    ponto.get("demanda"),
                    ponto.get("qtd_forecast"),
                    ponto.get("quantidade"),
                )
            ),
        )

        if demanda_original <= 0:
            continue

        eh_mes_atual = (ano, mes) == (hoje.year, hoje.month)

        if eh_mes_atual:
            demanda_usada = max(0.0, demanda_original - consumo_mes_atual)
            peso_mes = fracao_mes_atual
        else:
            demanda_usada = demanda_original
            peso_mes = 1.0

        # Se o mês atual já foi totalmente atendido, ele não consome cobertura.
        # A cobertura começa no próximo bucket com demanda em aberto.
        if demanda_usada <= 0:
            continue

        pontos.append({
            "ano": ano,
            "mes": mes,
            "periodo": ponto.get("periodo") or _mes_label(mes, ano),
            "demanda": demanda_usada,
            "demanda_original": demanda_original,
            "demanda_restante": demanda_usada,
            "demanda_atendida_mes_atual": consumo_mes_atual if eh_mes_atual else 0.0,
            "eh_mes_atual": eh_mes_atual,
            "peso_mes_cobertura": peso_mes,
            "dias_no_mes": dias_no_mes if eh_mes_atual else None,
            "dias_restantes_mes_atual": dias_restantes if eh_mes_atual else None,
        })

    pontos.sort(key=lambda x: (int(x.get("ano") or 0), int(x.get("mes") or 0)))
    return pontos

def _calcular_cobertura_demanda_futura(
    quantidade_disponivel: float,
    forecast_codigo: List[Dict[str, Any]],
    fallback_mensal: float = 0.0,
    consumo_mes_atual: float = 0.0,
) -> Dict[str, Any]:
    """
    Calcula cobertura em meses consumindo a demanda futura acumulada.

    Racional atual:
      - mês atual usa apenas o que ainda falta atender:
            max(demanda_mes_atual - consumo_real_mes_atual, 0)
      - se cobrir o mês atual restante, soma só a fração de dias que restam no mês;
      - próximos meses entram como 1,00 mês;
      - no mês em que o estoque acabar, soma a fração proporcional daquele bucket.

    Exemplo:
      estoque 15, demanda atual 5, consumo atual 3, próximo mês 10,
      mês seguinte 5, hoje dia 29/30:
        falta atual = 2
        fração atual = 2/30 = 0,07
        cobertura = 0,07 + 1,00 + 3/5 = 1,67 mês.
    """
    disponivel = max(0.0, _to_float(quantidade_disponivel))
    consumo_mes_atual = max(0.0, _to_float(consumo_mes_atual))
    pontos = _normalizar_demanda_futura_para_cobertura(
        forecast_codigo,
        consumo_mes_atual=consumo_mes_atual,
    )

    demanda_total = sum(_to_float(p.get("demanda")) for p in pontos)
    demanda_total_original = sum(_to_float(p.get("demanda_original")) for p in pontos)
    ponto_mes_atual = next((p for p in pontos if p.get("eh_mes_atual")), None)

    base_sem_estoque = {
        "demanda_total_forecast": _round(demanda_total, 4),
        "demanda_total_forecast_original": _round(demanda_total_original, 4),
        "meses_forecast": len(pontos),
        "demanda_media_extrapolacao": _round((demanda_total / len(pontos)) if pontos else 0, 4),
        "cobertura_extrapolada": False,
        "consumo_mes_atual_descontado": _round(consumo_mes_atual, 4),
        "demanda_mes_atual_original": _round(_to_float((ponto_mes_atual or {}).get("demanda_original")), 4),
        "demanda_mes_atual_restante": _round(_to_float((ponto_mes_atual or {}).get("demanda")), 4),
        "fracao_mes_atual_cobertura": _round(_to_float((ponto_mes_atual or {}).get("peso_mes_cobertura")), 4),
        "dias_restantes_mes_atual": (ponto_mes_atual or {}).get("dias_restantes_mes_atual"),
        "dias_no_mes": (ponto_mes_atual or {}).get("dias_no_mes"),
    }

    if disponivel <= 0:
        return {
            "cobertura_meses": 0.0,
            "cobertura_dias": 0.0,
            "metodo": "forecast_acumulado_demanda_restante_mes_atual" if pontos else ("maior_media_fallback" if fallback_mensal > 0 else "sem_demanda"),
            **base_sem_estoque,
        }

    if not pontos:
        fallback = _to_float(fallback_mensal)
        if fallback > 0:
            meses = disponivel / fallback
            return {
                "cobertura_meses": _round(meses, 4),
                "cobertura_dias": _round(meses * 30, 2),
                "metodo": "maior_media_fallback",
                "demanda_total_forecast": 0.0,
                "demanda_total_forecast_original": 0.0,
                "meses_forecast": 0,
                "demanda_media_extrapolacao": _round(fallback, 4),
                "cobertura_extrapolada": False,
                "consumo_mes_atual_descontado": _round(consumo_mes_atual, 4),
                "demanda_mes_atual_original": 0.0,
                "demanda_mes_atual_restante": 0.0,
                "fracao_mes_atual_cobertura": 0.0,
                "dias_restantes_mes_atual": None,
                "dias_no_mes": None,
            }

        return {
            "cobertura_meses": 0.0,
            "cobertura_dias": 0.0,
            "metodo": "sem_demanda",
            "demanda_total_forecast": 0.0,
            "demanda_total_forecast_original": 0.0,
            "meses_forecast": 0,
            "demanda_media_extrapolacao": 0.0,
            "cobertura_extrapolada": False,
            "consumo_mes_atual_descontado": _round(consumo_mes_atual, 4),
            "demanda_mes_atual_original": 0.0,
            "demanda_mes_atual_restante": 0.0,
            "fracao_mes_atual_cobertura": 0.0,
            "dias_restantes_mes_atual": None,
            "dias_no_mes": None,
        }

    restante = disponivel
    meses_cobertos = 0.0

    for ponto in pontos:
        demanda = _to_float(ponto.get("demanda"))
        peso_mes = max(0.0, _to_float(ponto.get("peso_mes_cobertura"), 1.0))

        if demanda <= 0 or peso_mes <= 0:
            continue

        if restante >= demanda:
            meses_cobertos += peso_mes
            restante -= demanda
        else:
            meses_cobertos += peso_mes * (restante / demanda)
            restante = 0.0
            break

    cobertura_extrapolada = False
    # Para extrapolar além do horizonte, usa a média dos meses futuros conhecidos.
    # O mês atual restante pode ser parcial; ainda assim é melhor que voltar para giro médio.
    demanda_media = demanda_total / max(1, len(pontos))

    if restante > 0 and demanda_media > 0:
        meses_cobertos += restante / demanda_media
        cobertura_extrapolada = True

    return {
        "cobertura_meses": _round(meses_cobertos, 4),
        "cobertura_dias": _round(meses_cobertos * 30, 2),
        "metodo": "forecast_acumulado_demanda_restante_mes_atual",
        "demanda_total_forecast": _round(demanda_total, 4),
        "demanda_total_forecast_original": _round(demanda_total_original, 4),
        "meses_forecast": len(pontos),
        "demanda_media_extrapolacao": _round(demanda_media, 4),
        "cobertura_extrapolada": cobertura_extrapolada,
        "consumo_mes_atual_descontado": _round(consumo_mes_atual, 4),
        "demanda_mes_atual_original": _round(_to_float((ponto_mes_atual or {}).get("demanda_original")), 4),
        "demanda_mes_atual_restante": _round(_to_float((ponto_mes_atual or {}).get("demanda")), 4),
        "fracao_mes_atual_cobertura": _round(_to_float((ponto_mes_atual or {}).get("peso_mes_cobertura")), 4),
        "dias_restantes_mes_atual": (ponto_mes_atual or {}).get("dias_restantes_mes_atual"),
        "dias_no_mes": (ponto_mes_atual or {}).get("dias_no_mes"),
    }

def _entradas_mes_atual_da_serie(serie: Optional[List[Dict[str, Any]]]) -> float:
    """
    Soma somente as entradas previstas do mês atual.

    Regra de status validada:
    - entrada futura fora do mês atual não entra na classificação de crítico/excesso;
    - ela continua aparecendo no gráfico/projeção mensal.
    """
    hoje = date.today()
    total = 0.0

    for ponto in serie or []:
        ano = _to_int(ponto.get("ano"))
        mes = _to_int(ponto.get("mes"))

        if ano <= 0 or mes <= 0:
            data_ref = _parse_data(
                _coalesce(
                    ponto.get("data_inicio"),
                    ponto.get("data_prevista_entrega"),
                    ponto.get("periodo_data"),
                )
            )
            if data_ref:
                ano = data_ref.year
                mes = data_ref.month

        if ano == hoje.year and mes == hoje.month:
            total += _to_float(
                _coalesce(
                    ponto.get("entradas_previstas"),
                    ponto.get("qtd_entradas_previstas"),
                    ponto.get("quantidade_pendente"),
                    ponto.get("quantidade"),
                )
            )

    return _round(total, 4)


def _consumo_ultimos_6m_row(row: Dict[str, Any]) -> float:
    """Soma consumo real dos últimos 6 meses a partir das colunas mensais do Aging."""
    hoje = date.today()
    meses_ref: set[tuple[int, int]] = set()

    for i in range(1, 7):
        mes = hoje.month - i
        ano = hoje.year
        while mes <= 0:
            mes += 12
            ano -= 1
        meses_ref.add((ano, mes))

    total = 0.0
    for ponto in _historico_consumo(row):
        ano = _to_int(ponto.get("ano"))
        mes = _to_int(ponto.get("mes"))
        if (ano, mes) in meses_ref:
            total += _to_float(ponto.get("consumo"))

    if total <= 0:
        # Fallback seguro para bases que só trazem média 6m e não as colunas mensais.
        total = _to_float(row.get("media_6m")) * 6.0

    return _round(total, 4)


def _faturamento_mes_atual_por_codigo(
    codigo: str,
    faturamento_6m_por_codigo: Optional[Dict[str, Any]] = None,
) -> float:
    """Venda/faturamento real do mês atual para PA/MR/PPS/PV.

    Para produto acabado, "consumo mês" na Gestão deve vir da venda/SD2.
    Para PI/MP/ME/MI, o consumo mês continua vindo da Posição de Estoque/Aging.
    """
    codigo_norm = _normalizar_codigo(codigo)
    hoje = date.today()
    dados = (faturamento_6m_por_codigo or {}).get(codigo_norm)

    if isinstance(dados, list):
        total = 0.0
        for ponto in dados or []:
            if _to_int(ponto.get("ano")) == hoje.year and _to_int(ponto.get("mes")) == hoje.month:
                total += _to_float(ponto.get("faturamento_qtd"))
        return _round(total, 4)

    if isinstance(dados, dict):
        # Fallback para eventual retorno agregado já filtrado no mês atual.
        if _to_int(dados.get("ano")) == hoje.year and _to_int(dados.get("mes")) == hoje.month:
            return _round(dados.get("faturamento_qtd"), 4)

    return 0.0


def _movimento_6m_status_item(
    codigo: str,
    tipo_produto: Any,
    row: Dict[str, Any],
    movimento_6m_por_codigo: Optional[Dict[str, Any]] = None,
) -> float:
    """
    Movimento real dos últimos 6 meses para decidir 'Sem consumo'.

    PA/MR/PPS/PV: usa venda/faturamento real 6m da SD2.
    Insumos: usa consumo real 6m das colunas do Aging.
    """
    codigo_norm = _normalizar_codigo(codigo)
    tipo_norm = str(tipo_produto or "").strip().upper()
    movimento_6m_por_codigo = movimento_6m_por_codigo or {}

    if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}:
        valor = movimento_6m_por_codigo.get(codigo_norm)

        if isinstance(valor, list):
            return _round(sum(_to_float(p.get("faturamento_qtd")) for p in valor), 4)

        if isinstance(valor, dict):
            if valor.get("total_6m") is not None:
                return _round(valor.get("total_6m"), 4)
            if valor.get("faturamento_qtd") is not None:
                return _round(valor.get("faturamento_qtd"), 4)

        return _round(_to_float(valor), 4)

    return _consumo_ultimos_6m_row(row)


def _demanda_base_status_mes_atual(demanda_mes_atual: Any, movimento_6m: Any) -> float:
    """
    Base mensal usada para cobertura/status do mês atual.

    Regra final validada:
      - crítico/ruptura depende da demanda/forecast do mês atual;
      - venda/consumo dos últimos 6 meses serve para histórico e para não chamar
        tudo de "sem consumo", mas NÃO cria demanda artificial no mês atual.

    Ex.: PA exportação sem forecast em junho, mas com venda em março, não deve
    entrar como crítico em junho só porque teve histórico.
    """
    return max(0.0, _to_float(demanda_mes_atual))


def _demanda_restante_mes_atual(demanda_mes_atual: Any, consumo_mes_atual: Any) -> float:
    """Demanda ainda em aberto no mês atual para status/cobertura operacional.

    A previsão mensal permanece sendo o forecast oficial completo. Porém, para
    decidir crítico/ruptura no meio do mês, não podemos cobrar de novo a parcela
    já consumida/atendida.

    Ex.: previsão 12.000, consumo real 6.333 => falta atender 5.667.
    """
    demanda = max(0.0, _to_float(demanda_mes_atual))
    consumo = max(0.0, _to_float(consumo_mes_atual))
    return max(0.0, demanda - consumo)

def _calcular_cobertura_status_mes_atual(
    saldo: Any,
    entradas_mes_atual: Any,
    demanda_mes_atual: Any,
    movimento_6m: Any,
) -> Dict[str, Any]:
    """
    Cobertura usada para status operacional.

    Separação importante:
      - risco/ruptura pode considerar estoque atual + entradas do mês, porque uma
        entrada confirmada evita ruptura operacional;
      - excesso/cobertura de estoque deve considerar apenas o estoque atual, para
        não transformar entrada prevista em excesso já disponível.

    Exemplo: estoque 753, entrada mês 2.400 e forecast atual 744.
    A disponibilidade operacional cobre o mês, mas o estoque atual cobre cerca
    de 1,0 mês, não 5,5 meses.
    """
    estoque_atual = max(0.0, _to_float(saldo))
    entradas_mes = max(0.0, _to_float(entradas_mes_atual))
    estoque_com_entradas = estoque_atual + entradas_mes
    demanda_base = _demanda_base_status_mes_atual(demanda_mes_atual, movimento_6m)

    if demanda_base <= 0:
        return {
            "cobertura_meses": 0.0,
            "cobertura_dias": 0.0,
            "cobertura_meses_estoque_atual": 0.0,
            "cobertura_dias_estoque_atual": 0.0,
            "cobertura_meses_com_entradas": 0.0,
            "cobertura_dias_com_entradas": 0.0,
            "estoque_base_status": _round(estoque_com_entradas, 4),
            "estoque_atual_base_status": _round(estoque_atual, 4),
            "entradas_base_status": _round(entradas_mes, 4),
            "demanda_base_status": 0.0,
            "metodo": "sem_demanda_mes_atual",
        }

    meses_estoque_atual = estoque_atual / demanda_base
    meses_com_entradas = estoque_com_entradas / demanda_base

    return {
        # Mantém compatibilidade: cobertura_meses agora representa a cobertura do
        # estoque atual, que é a base correta para excesso/matriz.
        "cobertura_meses": _round(meses_estoque_atual, 4),
        "cobertura_dias": _round(meses_estoque_atual * 30.0, 2),
        "cobertura_meses_estoque_atual": _round(meses_estoque_atual, 4),
        "cobertura_dias_estoque_atual": _round(meses_estoque_atual * 30.0, 2),
        "cobertura_meses_com_entradas": _round(meses_com_entradas, 4),
        "cobertura_dias_com_entradas": _round(meses_com_entradas * 30.0, 2),
        "estoque_base_status": _round(estoque_com_entradas, 4),
        "estoque_atual_base_status": _round(estoque_atual, 4),
        "entradas_base_status": _round(entradas_mes, 4),
        "demanda_base_status": _round(demanda_base, 4),
        "metodo": "estoque_atual_sobre_demanda_mes_atual_com_entradas_para_resgate_operacional",
    }


def _tipo_bom_deve_prevalecer_para_componente(
    tipo_bom: Any,
    tipo_cadastro: Any = None,
) -> bool:
    """
    Decide quando o tipo informado na BOM deve prevalecer sobre d_produtos.

    Caso real que motivou a regra:
    - 71991 aparece na BOM como MP (AGULHA UNOJECT SHORT BISEL);
    - em d_produtos está como PI e ativo_analise=False;
    - a listagem de Insumos não pode excluir esse item como intermediário, porque
      na estrutura ele é componente consumível do PA.
    """
    tipo_bom_norm = str(tipo_bom or "").strip().upper()
    tipo_cadastro_norm = str(tipo_cadastro or "").strip().upper()

    if tipo_bom_norm in TIPOS_COMPONENTE_BOM_CONSUMIVEL:
        return True

    # Se a BOM disse explicitamente que é PI/intermediário, não converte.
    if tipo_bom_norm in TIPOS_INTERMEDIARIO_BOM:
        return False

    # Se o cadastro é PA/MR/PPS/PV, preserva o cadastro para não transformar
    # produto acabado/revenda em insumo por engano.
    if tipo_cadastro_norm in TIPOS_PRODUTO_ACABADO_ESTOQUE:
        return False

    return False


def _tipo_produto_usa_entradas_compra_no_status(tipo_produto: Any, fonte_entradas_previstas: Any = None) -> bool:
    """
    Define quando as entradas previstas podem entrar na cobertura/status.

    Regra v71:
      - PA produzido internamente: não usa MPS como entrada no PA enquanto o
        rateio PI -> PA não estiver validado;
      - PPS/MR/PV/revenda/comprado: usa entradas de compra, porque a entrada já
        é do próprio SKU comprado;
      - Bravi continua com regra própria do PI de terceiro.
    """
    tipo_norm = str(tipo_produto or "").strip().upper()
    fonte = str(fonte_entradas_previstas or "").strip().lower()

    # PA produzido internamente não usa entradas previstas do MPS/PI no status
    # enquanto o rateio PI -> PA não estiver validado. Para os demais tipos
    # comprados/insumos, pedidos de compra entram como volume em trânsito.
    if tipo_norm == "PA" and fonte != "pi_bravi_compras_transferencia":
        return False

    if fonte in {"pedidos_compra", "pi_bravi_compras_transferencia"}:
        return True

    return tipo_norm in {"MR", "PPS", "PV", "MP", "ME", "MI", "PI"}


def _calcular_cobertura_status_futura(
    saldo: Any,
    entradas_previstas_total: Any,
    forecast_codigo: List[Dict[str, Any]],
    fallback_mensal: float = 0.0,
    considerar_entradas: bool = False,
    consumo_mes_atual: float = 0.0,
) -> Dict[str, Any]:
    """
    Cobertura usada para status e matriz.

    - PA interno: quantidade disponível = estoque atual.
    - PPS/MR/PV/comprados: quantidade disponível = estoque atual + entradas de compra.
    - O consumo da cobertura é o forecast/demanda futura mês a mês.
    - No mês atual, desconta o consumo/atendimento já realizado e usa só a fração
      restante do mês.
    """
    estoque_atual = max(0.0, _to_float(saldo))
    entradas = max(0.0, _to_float(entradas_previstas_total)) if considerar_entradas else 0.0
    quantidade_base = estoque_atual + entradas

    info = _calcular_cobertura_demanda_futura(
        quantidade_base,
        forecast_codigo,
        fallback_mensal=fallback_mensal,
        consumo_mes_atual=consumo_mes_atual,
    )

    info["estoque_base_status"] = _round(quantidade_base, 4)
    info["estoque_atual_base_status"] = _round(estoque_atual, 4)
    info["entradas_base_status"] = _round(entradas, 4)
    # Para status do mês atual, a base correta é a demanda que ainda falta
    # atender no mês, não a previsão cheia nem a média do horizonte.
    info["demanda_base_status"] = _round(info.get("demanda_mes_atual_restante"), 4)
    info["demanda_base_status_original"] = _round(info.get("demanda_mes_atual_original"), 4)
    info["metodo"] = (
        "forecast_futuro_estoque_mais_compras_demanda_restante_mes_atual"
        if considerar_entradas
        else "forecast_futuro_estoque_atual_demanda_restante_mes_atual"
    )
    return info

def _montar_item_base(row, compras, parametros, custos, demanda_mes, produtos, vendas, classificacao_bom, forecast_futuro=None, entradas_previstas_serie_por_codigo=None, movimento_6m_por_codigo=None):
    codigo = _normalizar_codigo(row.get("codigo"))

    produto_dim = produtos.get(codigo, {})
    bom_dim = classificacao_bom.get(codigo, {})
    venda = vendas.get(codigo, {})
    forecast_futuro = forecast_futuro or {}
    forecast_codigo = forecast_futuro.get(codigo) or []
    entradas_previstas_serie_por_codigo = entradas_previstas_serie_por_codigo or {}
    entradas_codigo = entradas_previstas_serie_por_codigo.get(codigo) or []
    entradas_mes_atual = _entradas_mes_atual_da_serie(entradas_codigo)

    saldo = _to_float(row.get("saldo"))
    saldo_quarentena = _to_float(row.get("__saldo_quarentena"))

    media_3m = _to_float(row.get("media_3m"))
    media_6m = _to_float(row.get("media_6m"))
    media_9m = _to_float(row.get("media_9m"))

    maior_media = _to_float(row.get("maior_media"))

    if maior_media <= 0:
        maior_media = max(media_3m, media_6m, media_9m)

    compra = compras.get(codigo, {})
    qtd_pedidos_abertos = _to_float(compra.get("qtd_pedidos_abertos"))
    qtd_liberacoes_previstas = _to_float(compra.get("qtd_liberacoes_previstas"))
    qtd_pedidos_compra = _to_float(compra.get("qtd_pedidos_compra"))
    fonte_entradas_previstas = str(compra.get("fonte_entradas_previstas") or "pedidos_compra")
    label_entradas_previstas = str(compra.get("label_entradas_previstas") or "Entradas previstas")

    parametro = parametros.get(codigo, {})
    lead_time = _to_float(parametro.get("lead_time_total"))
    moq = _to_float(parametro.get("moq"))

    custo_unitario = _to_float(custos.get(codigo))

    # "Estoque + entradas" = estoque atual + o que está chegando (pedidos/entradas
    # em aberto) + quarentena (saldo líquido, o mesmo mostrado na coluna
    # "Quarentena 98").
    estoque_mais_pedidos = saldo + qtd_pedidos_abertos + saldo_quarentena

    # Aging Excel:
    # consumo no lead time = (maior média mensal / 30) x LT
    # estoque ideal = maior entre consumo no LT e MOQ
    consumo_lt = (maior_media / 30.0) * lead_time if maior_media > 0 else 0.0
    estoque_ideal = max(consumo_lt, moq)

    # Cobertura oficial da tela: sempre contra demanda/forecast futuro real.
    # Não usa maior média histórica como fallback para não parecer que há
    # cobertura planejada quando não existe forecast/demanda futura cadastrada.
    cobertura_atual_info = _calcular_cobertura_demanda_futura(
        saldo,
        forecast_codigo,
        fallback_mensal=0.0,
        consumo_mes_atual=0.0,  # recalculado abaixo após identificar consumo real do mês
    )
    cobertura_futura_info = _calcular_cobertura_demanda_futura(
        estoque_mais_pedidos,
        forecast_codigo,
        fallback_mensal=0.0,
        consumo_mes_atual=0.0,  # recalculado abaixo após identificar consumo real do mês
    )

    cobertura_meses_atual = _to_float(cobertura_atual_info.get("cobertura_meses"))
    cobertura = _to_float(cobertura_atual_info.get("cobertura_dias"))
    cobertura_meses_futura = _to_float(cobertura_futura_info.get("cobertura_meses"))
    cobertura_futura = _to_float(cobertura_futura_info.get("cobertura_dias"))

    base_consumo_mais_lt = consumo_lt + maior_media
    cobertura_consumo_lt = (
        estoque_mais_pedidos / base_consumo_mais_lt
        if base_consumo_mais_lt > 0
        else 0.0
    )

    gap = estoque_mais_pedidos - estoque_ideal

    status = _calcular_status(
        saldo,
        estoque_mais_pedidos,
        maior_media,
        cobertura_futura,
        lead_time,
        estoque_ideal,
    )

    origem_classificacao = "NAO_CLASSIFICADO"

    if produto_dim:
        origem_classificacao = "DIMENSAO"
    elif bom_dim:
        origem_classificacao = "BOM"

    def gerencial(campo: str, default: str = "A classificar") -> str:
        # Para insumos/componentes da estrutura, a linha correta vem do pai da BOM,
        # não do cadastro do próprio componente. Isso evita componente com cadastro
        # PPS ou A classificar aparecer no Dashboard de Insumos como PPS/A classificar.
        tipo_cadastro = str(
            _coalesce(
                row.get("tipo"),
                produto_dim.get("tipo_produto_erp") if produto_dim else None,
                "",
            ) or ""
        ).strip().upper()
        priorizar_bom = bool(bom_dim) and tipo_cadastro not in {"PA", "MR", "PPS", "PV", "PA/MR"}

        if priorizar_bom and bom_dim and _eh_classificado(bom_dim.get(campo)):
            return str(bom_dim.get(campo)).strip()

        if produto_dim and _eh_classificado(produto_dim.get(campo)):
            return str(produto_dim.get(campo)).strip()

        if bom_dim and _eh_classificado(bom_dim.get(campo)):
            return str(bom_dim.get(campo)).strip()

        return default

    tipo_produto_erp_cadastro = produto_dim.get("tipo_produto_erp") if produto_dim else None
    tipo_produto_erp_row = row.get("tipo")
    tipo_produto_erp_bom = _coalesce(
        bom_dim.get("tp") if bom_dim else None,
        bom_dim.get("tipo_componente_bom") if bom_dim else None,
    )

    if bom_dim and _tipo_bom_deve_prevalecer_para_componente(tipo_produto_erp_bom, tipo_produto_erp_cadastro):
        tipo_produto_erp = tipo_produto_erp_bom
        tipo_produto_erp_origem = "BOM"
    else:
        tipo_produto_erp = _coalesce(
            tipo_produto_erp_cadastro,
            tipo_produto_erp_row,
            tipo_produto_erp_bom,
        )
        tipo_produto_erp_origem = (
            "DIMENSAO" if tipo_produto_erp_cadastro is not None and str(tipo_produto_erp_cadastro).strip() != "" else
            "ESTOQUE" if tipo_produto_erp_row is not None and str(tipo_produto_erp_row).strip() != "" else
            "BOM" if tipo_produto_erp_bom is not None and str(tipo_produto_erp_bom).strip() != "" else
            None
        )

    desc_produto = _coalesce(
        produto_dim.get("desc_produto") if produto_dim else None,
        row.get("produto"),
    )

    grupo = _coalesce(
        produto_dim.get("grupo") if produto_dim else None,
        row.get("grupo"),
    )

    grupo_descricao = _coalesce(
        row.get("grupo_descricao"),
        produto_dim.get("grupo") if produto_dim else None,
        row.get("grupo"),
    )

    transferencia_bravi = _normalizar_sim_nao(
        _coalesce(
            produto_dim.get("transferencia_bravi") if produto_dim else None,
            bom_dim.get("transferencia_bravi") if bom_dim else None,
        ),
        default="Não",
    )

    macro_negocio_gerencial = gerencial("macro_negocio")
    tipo_negocio_gerencial = gerencial("tipo_negocio")
    familia_gerencial = gerencial("familia")
    segmento_gerencial = gerencial("segmento")
    grupo_gerencial_valor = gerencial("grupo_gerencial")

    # Regra PPS/Bravi:
    # transferência Bravi não deve tirar o item da linha PPS.
    # Se qualquer classificação gerencial indicar PPS, mantém tipo_negocio = PPS
    # e deixa Bravi apenas como tag/filtro/status.
    contexto_pps = " ".join([
        str(tipo_negocio_gerencial or ""),
        str(macro_negocio_gerencial or ""),
        str(familia_gerencial or ""),
        str(segmento_gerencial or ""),
        str(grupo_gerencial_valor or ""),
    ]).upper()
    if transferencia_bravi == "Sim" and "PPS" in contexto_pps:
        tipo_negocio_gerencial = "PPS"

    status_portfolio = gerencial("status_portfolio")

    # Sinalização operacional específica para PPS/Bravi/descontinuados.
    status_estoque = status
    status_portfolio_norm = status_portfolio.upper()

    if "DESCONT" in status_portfolio_norm and saldo > 0:
        status_estoque = "DESCONTINUADO_COM_SALDO"
    elif transferencia_bravi == "Sim" and saldo > 0:
        status_estoque = "TRANSFERENCIA_BRAVI"

    demanda_info = demanda_mes.get(codigo, {})
    tipo_norm = str(tipo_produto_erp or "").strip().upper()

    demanda_direta_mes_atual = _to_float(demanda_info.get("demanda_direta_mes_atual"))
    demanda_bom_mes_atual = _to_float(demanda_info.get("demanda_bom_mes_atual"))
    origem_demanda_bom = str(demanda_info.get("origem_demanda_bom") or "mrp_v1_l1_l2_bom")

    if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"} or codigo in BRAVI_PA_PI_STATIC_MAP:
        demanda_mes_atual = demanda_direta_mes_atual
        metodo_demanda = "forecast_direto"
    else:
        demanda_mes_atual = demanda_bom_mes_atual
        metodo_demanda = origem_demanda_bom

    # Fallback: se por algum motivo o item tiver forecast direto mas não for PA/MR cadastrado,
    # não deixa a demanda zerada.
    if demanda_mes_atual <= 0 and demanda_direta_mes_atual > 0:
        demanda_mes_atual = demanda_direta_mes_atual
        metodo_demanda = "forecast_direto"

    hoje = date.today()
    consumo_aging_mes_atual, consumo_aging_campo, consumo_aging_origem = _get_consumo_mes_origem(row, hoje.month, hoje.year)

    if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"} or codigo in BRAVI_PA_PI_STATIC_MAP:
        consumo_mes_atual = _faturamento_mes_atual_por_codigo(codigo, movimento_6m_por_codigo)
        consumo_mes_atual_campo = "f_sd2_saidas.quantidade"
        consumo_mes_atual_origem = "sd2_venda_mes_atual"
    else:
        # MP/ME/MI/PI: consumo realizado vem da Posição de Estoque/Aging.
        consumo_mes_atual = consumo_aging_mes_atual
        consumo_mes_atual_campo = consumo_aging_campo
        consumo_mes_atual_origem = consumo_aging_origem

    movimento_6m_status = _movimento_6m_status_item(
        codigo,
        tipo_produto_erp,
        row,
        movimento_6m_por_codigo=movimento_6m_por_codigo,
    )
    considerar_entradas_compra_status = _tipo_produto_usa_entradas_compra_no_status(
        tipo_produto_erp,
        fonte_entradas_previstas,
    )
    # Status operacional: para insumos/comprados, considerar o pacote total
    # estoque atual + pedidos/entradas em aberto + quarentena. Antes a regra
    # olhava apenas entradas do mês e podia marcar crítico mesmo com PC aberto
    # suficiente para cobrir a previsão. PA produzido internamente segue sem
    # entrada MPS no status enquanto o rateio PI -> PA não estiver validado.
    entradas_status_operacional = (qtd_pedidos_abertos + saldo_quarentena) if considerar_entradas_compra_status else 0.0

    # Cobertura operacional já desconta o consumo/atendimento realizado no mês atual.
    # Assim, no meio/fim do mês o card não considera novamente a demanda que já foi atendida.
    cobertura_atual_info = _calcular_cobertura_demanda_futura(
        saldo,
        forecast_codigo,
        fallback_mensal=0.0,
        consumo_mes_atual=consumo_mes_atual,
    )
    cobertura_futura_info = _calcular_cobertura_demanda_futura(
        estoque_mais_pedidos,
        forecast_codigo,
        fallback_mensal=0.0,
        consumo_mes_atual=consumo_mes_atual,
    )

    cobertura_meses_atual = _to_float(cobertura_atual_info.get("cobertura_meses"))
    cobertura = _to_float(cobertura_atual_info.get("cobertura_dias"))
    cobertura_meses_futura = _to_float(cobertura_futura_info.get("cobertura_meses"))
    cobertura_futura = _to_float(cobertura_futura_info.get("cobertura_dias"))

    cobertura_status_info = _calcular_cobertura_status_futura(
        saldo,
        entradas_status_operacional,
        forecast_codigo,
        fallback_mensal=0.0,
        considerar_entradas=considerar_entradas_compra_status,
        consumo_mes_atual=consumo_mes_atual,
    )
    cobertura_meses_status = _to_float(cobertura_status_info.get("cobertura_meses"))
    cobertura_status_dias = _to_float(cobertura_status_info.get("cobertura_dias"))
    base_cobertura_status = _to_float(cobertura_status_info.get("estoque_base_status"))
    demanda_mes_atual_original_operacional = max(0.0, _to_float(demanda_mes_atual))
    demanda_restante_mes_atual_operacional = _demanda_restante_mes_atual(
        demanda_mes_atual_original_operacional,
        consumo_mes_atual,
    )
    demanda_base_status = demanda_restante_mes_atual_operacional
    cobertura_status_info["demanda_base_status"] = _round(demanda_base_status, 4)
    cobertura_status_info["demanda_base_status_original"] = _round(demanda_mes_atual_original_operacional, 4)
    cobertura_status_info["demanda_mes_atual_restante"] = _round(demanda_restante_mes_atual_operacional, 4)

    # Reclassificação operacional v71:
    # - PA interno: usa estoque atual contra forecast; não usa entrada MPS no PA.
    # - PPS/MR/PV comprados: usa compras/entradas previstas para avaliar cobertura.
    status = _status_operacional_com_demanda(
        status,
        tipo_produto_erp,
        saldo,
        entradas_status_operacional,
        demanda_mes_atual,
        consumo_mes_atual,
        cobertura_meses_status,
        movimento_6m_status,
    )

    # Reaplica tags operacionais de portfólio após ajustar o status base.
    status_estoque = status
    if "DESCONT" in status_portfolio_norm and saldo > 0:
        status_estoque = "DESCONTINUADO_COM_SALDO"
    elif transferencia_bravi == "Sim" and saldo > 0:
        status_estoque = "TRANSFERENCIA_BRAVI"

    consumo_sem_previsao = demanda_mes_atual <= 0 and consumo_mes_atual > 0
    previsto_vs_consumido_pct = (
        (consumo_mes_atual / demanda_mes_atual) * 100
        if demanda_mes_atual > 0
        else (9999.0 if consumo_sem_previsao else 0.0)
    )
    status_plano_mes = _status_plano_mes(consumo_mes_atual, demanda_mes_atual)
    status_plano_visual = _status_visual_plano_mes(consumo_mes_atual, demanda_mes_atual)
    previsao_consumo_alerta = 1 if status_plano_mes in {"SEM_PREVISAO", "ALERTA", "ACIMA_PREVISAO"} else 0

    estoque_atual_valor = saldo * custo_unitario
    pedidos_abertos_valor = qtd_pedidos_abertos * custo_unitario
    estoque_mais_pedidos_valor = estoque_mais_pedidos * custo_unitario
    maior_media_valor = maior_media * custo_unitario
    consumo_durante_lt_valor = consumo_lt * custo_unitario
    estoque_ideal_valor = estoque_ideal * custo_unitario
    gap_valor = gap * custo_unitario

    return {
        "codigo": codigo,
        "produto": desc_produto,
        "unid": row.get("unid"),
        "armaz": row.get("armaz"),
        "nome_2": row.get("nome_2"),
        "grupo": grupo,
        "grupo_descricao": grupo_descricao,
        "tipo": tipo_produto_erp,

        # Tipo operacional usado na Gestão.
        # Para componentes da BOM, o tipo da estrutura pode prevalecer sobre o
        # tipo do cadastro, evitando excluir insumos por ativo_analise/tipo PI.
        "tipo_produto_erp_cadastro": tipo_produto_erp_cadastro,
        "tipo_produto_erp_bom": tipo_produto_erp_bom,
        "tipo_produto_erp_origem": tipo_produto_erp_origem,

        # Classificações gerenciais da d_produtos ou herdadas da BOM.
        "macro_negocio": macro_negocio_gerencial,
        "tipo_negocio": tipo_negocio_gerencial,
        "tipo_produto_erp": tipo_produto_erp,
        "familia": familia_gerencial,
        "segmento": segmento_gerencial,
        "mercado": gerencial("mercado", default="NACIONAL"),
        "abc_ytm": gerencial("abc_ytm"),
        "curva_a": gerencial("abc_ytm"),
        "linha": gerencial("linha"),
        "status_original": gerencial("status_original"),
        "status_portfolio": status_portfolio,
        "transferencia_bravi": transferencia_bravi,
        "fornecedor_terceiro": gerencial("fornecedor_terceiro"),
        "modelo_fornecimento": gerencial("modelo_fornecimento"),
        "grupo_gerencial": grupo_gerencial_valor,
        "origem_classificacao": origem_classificacao,
        "origem_linha_estoque": row.get("__origem_linha_estoque") or "f_consumo_materiais",
        "tem_posicao_aging": (row.get("__origem_linha_estoque") or "f_consumo_materiais") == "f_consumo_materiais",
        "saldo_origem": row.get("__saldo_origem") or "f_consumo_materiais",
        "data_saldo_origem": row.get("__data_saldo_origem"),
        "data_quarentena_origem": row.get("__data_quarentena_origem"),
        "saldo_quarentena": _round(row.get("__saldo_quarentena"), 4),
        "quarentena": _round(row.get("__saldo_quarentena"), 4),
        "saldo_sb8_bruto": _round(row.get("__saldo_sb8_bruto"), 4),
        "empenho_lote": _round(row.get("__empenho_lote"), 4),
        "saldo_quarentena_bruto": _round(row.get("__saldo_quarentena_bruto"), 4),
        "empenho_quarentena": _round(row.get("__empenho_quarentena"), 4),
        "armazens_saldo_origem": row.get("__armazens_saldo_origem"),
        "armazem_quarentena": row.get("__armazem_quarentena"),
        "tem_linha_saldo_0407_no_dia": row.get("__tem_linha_saldo_0407_no_dia"),
        "tem_linha_quarentena_98_no_dia": row.get("__tem_linha_quarentena_98_no_dia"),
        "item_mapeado": origem_classificacao in {"DIMENSAO", "BOM"},
        "ativo_analise": _produto_ativo_analise(produto_dim) if produto_dim else True,
        "observacao": produto_dim.get("observacao") if produto_dim else None,

        "saldo": _round(saldo),
        # Mantém qtd_pedidos_abertos por compatibilidade com o front atual.
        # Conceitualmente, agora este campo representa entradas previstas:
        # PA = liberações previstas do Gantt/MPS; MR = pedidos de compra.
        "qtd_pedidos_abertos": _round(qtd_pedidos_abertos),
        "entradas_previstas": _round(qtd_pedidos_abertos),
        "qtd_entradas_previstas": _round(qtd_pedidos_abertos),
        "qtd_liberacoes_previstas": _round(qtd_liberacoes_previstas),
        "qtd_pedidos_compra": _round(qtd_pedidos_compra),
        "qtd_pi_transferencia": _round(compra.get("qtd_pi_transferencia")),
        "codigos_pi_bravi": compra.get("codigos_pi_bravi") or [],
        "codigo_pi_principal": compra.get("codigo_pi_principal"),
        "fonte_entradas_previstas": fonte_entradas_previstas,
        "label_entradas_previstas": label_entradas_previstas,
        "estoque_mais_pedidos": _round(estoque_mais_pedidos),
        "estoque_mais_entradas": _round(estoque_mais_pedidos),

        "custo_unitario": _round(custo_unitario, 4),
        "estoque_atual_valor": _round(estoque_atual_valor, 2),
        "pedidos_abertos_valor": _round(pedidos_abertos_valor, 2),
        "estoque_mais_pedidos_valor": _round(estoque_mais_pedidos_valor, 2),

        "media_3m": _round(media_3m),
        "media_6m": _round(media_6m),
        "media_9m": _round(media_9m),
        "maior_media": _round(maior_media),
        "maior_media_valor": _round(maior_media_valor, 2),

        "lead_time_dias": _round(lead_time),
        "qtd_minima": _round(moq),
        "consumo_durante_lt": _round(consumo_lt),
        "consumo_durante_lt_valor": _round(consumo_durante_lt_valor, 2),
        "estoque_ideal": _round(estoque_ideal),
        "estoque_ideal_valor": _round(estoque_ideal_valor, 2),

        "dias_em_estoque": _round(cobertura, 1),
        "cobertura_dias": _round(cobertura, 1),
        "cobertura_meses_atual": _round(cobertura_meses_atual, 2),
        "cobertura_meses_status": _round(cobertura_meses_status, 2),
        "cobertura_status_dias": _round(cobertura_status_dias, 1),
        "cobertura_meses_estoque_atual": _round(cobertura_status_info.get("cobertura_meses_estoque_atual"), 2),
        "cobertura_dias_estoque_atual": _round(cobertura_status_info.get("cobertura_dias_estoque_atual"), 1),
        "cobertura_meses_com_entradas": _round(cobertura_status_info.get("cobertura_meses_com_entradas"), 2),
        "cobertura_dias_com_entradas": _round(cobertura_status_info.get("cobertura_dias_com_entradas"), 1),
        "entradas_mes_atual": _round(entradas_mes_atual, 4),
        "base_cobertura_status": _round(base_cobertura_status, 4),
        "estoque_atual_base_status": _round(cobertura_status_info.get("estoque_atual_base_status"), 4),
        "entradas_base_status": _round(cobertura_status_info.get("entradas_base_status"), 4),
        "demanda_base_status": _round(demanda_base_status, 4),
        "movimento_6m_status": _round(movimento_6m_status, 4),
        "cobertura_futura_dias": _round(cobertura_futura, 1),
        "cobertura_meses_futura": _round(cobertura_meses_futura, 2),
        "cobertura_consumo_lt": _round(cobertura_consumo_lt, 2),
        "metodo_cobertura": cobertura_status_info.get("metodo"),
        "metodo_cobertura_futura": cobertura_futura_info.get("metodo"),
        "demanda_cobertura_futura_total": _round(cobertura_futura_info.get("demanda_total_forecast"), 4),
        "meses_forecast_cobertura": cobertura_futura_info.get("meses_forecast"),
        "demanda_media_extrapolacao_cobertura": _round(cobertura_futura_info.get("demanda_media_extrapolacao"), 4),
        "cobertura_extrapolada": bool(cobertura_futura_info.get("cobertura_extrapolada")),
        "demanda_mes_atual_original_cobertura": _round(cobertura_atual_info.get("demanda_mes_atual_original"), 4),
        "demanda_mes_atual_restante_cobertura": _round(cobertura_atual_info.get("demanda_mes_atual_restante"), 4),
        "consumo_mes_atual_descontado_cobertura": _round(cobertura_atual_info.get("consumo_mes_atual_descontado"), 4),
        "fracao_mes_atual_cobertura": _round(cobertura_atual_info.get("fracao_mes_atual_cobertura"), 4),
        "dias_restantes_mes_atual_cobertura": cobertura_atual_info.get("dias_restantes_mes_atual"),
        "dias_no_mes_cobertura": cobertura_atual_info.get("dias_no_mes"),

        "gap_volume": _round(gap),
        "gap_valor": _round(gap_valor, 2),
        "giro_estoque": _round(row.get("giro_estoque")),
        "maior_media_50": _round(row.get("maior_media_50")),
        "saldo_menos_maior_media_50": _round(row.get("saldo_menos_maior_media_50")),

        "demanda_mes_atual": _round(demanda_mes_atual, 4),
        "demanda_mes_atual_original": _round(demanda_mes_atual_original_operacional, 4),
        "demanda_restante_mes_atual": _round(demanda_restante_mes_atual_operacional, 4),
        "demanda_restante_mes_atual_status": _round(demanda_restante_mes_atual_operacional, 4),
        "demanda_atendida_mes_atual": _round(min(consumo_mes_atual, demanda_mes_atual_original_operacional), 4),
        "demanda_direta_mes_atual": _round(demanda_direta_mes_atual, 4),
        "demanda_bom_mes_atual": _round(demanda_bom_mes_atual, 4),
        "metodo_demanda": metodo_demanda,
        "origem_demanda_bom": origem_demanda_bom,
        "debug_programacao_v1": demanda_info.get("debug_programacao_v1"),
        "forecast": forecast_codigo,
        "forecast_futuro": forecast_codigo,
        "consumo_mes_atual": _round(consumo_mes_atual),
        "consumo_mes_atual_campo": consumo_mes_atual_campo,
        "consumo_mes_atual_origem": consumo_mes_atual_origem,
        "previsao_mes_atual": _round(demanda_mes_atual, 4),
        "previsao_consumo_alerta": previsao_consumo_alerta,
        "consumo_sem_previsao": 1 if consumo_sem_previsao else 0,
        "status_plano": status_plano_mes,
        "status_mes": status_plano_mes,
        "status_plano_visual": status_plano_visual,
        "status_mes_visual": status_plano_visual,
        "previsto_vs_consumido_pct": _round(previsto_vs_consumido_pct, 1),
        "perc_mes_decorrido": _round(_percentual_mes_decorrido(), 1),
        "desvio_ritmo_pct": _round(((consumo_mes_atual / demanda_mes_atual) * 100.0 if demanda_mes_atual > 0 else 0.0) - _percentual_mes_decorrido(), 1),

        "faturamento_ytd_qtd": _round(venda.get("faturamento_ytd_qtd")),
        "faturamento_ytd_valor": _round(venda.get("faturamento_ytd_valor")),

        "menor_data_entrega": compra.get("menor_data_entrega"),
        "status": status,
        "status_estoque": status_estoque,
        "status_visual": None,  # preenchido logo abaixo para manter a regra centralizada
    }



def _produto_ativo_analise(produto: Optional[dict]) -> bool:
    """
    Define se um SKU da d_produtos deve entrar como linha sintética na Gestão.

    Depois que a Dimensão Produtos passou a ser a base inteira do MATA010, o
    padrão precisa ser conservador:
      - True/Sim/1 entra;
      - False/Não/0 não entra;
      - vazio não entra como sintético.

    Observação: se o item já existe no snapshot do Aging, ele continua entrando
    pela própria f_consumo_materiais. Esta função só controla a inclusão extra
    vinda diretamente da dimensão.
    """
    return _produto_ativo_analise_explicito(produto)


def _linha_consumo_sintetica_d_produtos(codigo: str, produto_dim: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cria uma linha sintética para SKUs existentes na d_produtos, mas ausentes
    no último snapshot da f_consumo_materiais.

    Por que isso existe:
      - a Gestão de Estoque parte do Aging/f_consumo_materiais;
      - alguns PA/MR/PPS de portfólio, revenda ou kit podem não estar na BOM
        e também podem não aparecer no snapshot atual de estoque;
      - mesmo assim, eles precisam aparecer na ferramenta para análise de
        faturamento SD2, Bravi, status de portfólio e acompanhamento gerencial.

    A linha entra com estoque/consumo zerado, mas com cadastro gerencial da
    d_produtos. Isso evita depender da d_bom_estrutura para listar PA/MR.
    """
    codigo_norm = _normalizar_codigo(codigo)

    return {
        "codigo": codigo_norm,
        "produto": _coalesce(
            produto_dim.get("desc_produto"),
            produto_dim.get("concatenado_produto"),
            codigo_norm,
        ),
        "unid": produto_dim.get("unid") or produto_dim.get("unidade"),
        "armaz": None,
        "nome_2": "Sem posição no Aging",
        "grupo": produto_dim.get("grupo"),
        "grupo_descricao": produto_dim.get("grupo"),
        "tipo": produto_dim.get("tipo_produto_erp"),
        "saldo": 0.0,
        "media_3m": 0.0,
        "media_6m": 0.0,
        "media_9m": 0.0,
        "maior_media": 0.0,
        "giro_estoque": 0.0,
        "maior_media_50": 0.0,
        "saldo_menos_maior_media_50": 0.0,
        "__origem_linha_estoque": "d_produtos_sem_snapshot_aging",
    }


def _mesclar_consumo_com_d_produtos(rows_consumo: List[Dict[str, Any]], produtos_all: Dict[str, dict]) -> List[Dict[str, Any]]:
    """
    Une o snapshot de Aging com a d_produtos.

    Antes a tela só mostrava códigos presentes na f_consumo_materiais. Isso
    deixava fora SKUs PA/MR/PPS que estavam no cadastro e/ou faturamento SD2,
    mas não tinham linha na posição de estoque atual ou não tinham BOM.

    A nova regra é:
      - mantém todas as linhas do snapshot de consumo/estoque;
      - adiciona, com saldo zero, os SKUs ativos da d_produtos que não estão no
        snapshot;
      - a d_bom_estrutura continua sendo usada apenas para explosão/herança de
        insumos, não como cadastro mestre de produtos.
    """
    rows_saida = []
    codigos_consumo = set()

    for row in rows_consumo or []:
        codigo = _normalizar_codigo(row.get("codigo"))

        if codigo:
            codigos_consumo.add(codigo)

        row_copy = dict(row)
        row_copy.setdefault("__origem_linha_estoque", "f_consumo_materiais")
        rows_saida.append(row_copy)

    for codigo, produto_dim in (produtos_all or {}).items():
        codigo_norm = _normalizar_codigo(codigo)

        if not codigo_norm or codigo_norm in codigos_consumo:
            continue

        if not _produto_ativo_analise(produto_dim):
            continue

        rows_saida.append(_linha_consumo_sintetica_d_produtos(codigo_norm, produto_dim))

    return rows_saida


def _normalizar_escopo_estoque(value: Any) -> str:
    """
    Normaliza o escopo visual da Gestão de Estoque.

    Escopos aceitos:
      - produtos: PA / MR / PPS / itens comerciais, Bravi e portfólio;
      - insumos: MP / ME / MI e materiais consumíveis vindos do Aging/BOM;
        PI/intermediários ficam fora para não misturar tubete preparado com insumo;
      - todos: compatibilidade com a tela antiga.

    A separação é apenas de leitura/filtragem da tela. A base interna continua
    sendo montada uma vez com f_consumo_materiais + d_produtos para não perder
    nem insumos como EPINEFRINA, nem produtos novos como ONE STEP DROP MINI KIT.
    """
    texto = str(value or "todos").strip().lower()

    if texto in {"produto", "produtos", "pa", "pa_mr", "pa/mr", "pa-mr", "acabado", "acabados"}:
        return "produtos"

    if texto in {"insumo", "insumos", "materiais", "mp", "mp_me_mi", "mp/me/mi"}:
        return "insumos"

    return "todos"


def _tipo_item_norm(item: Dict[str, Any]) -> str:
    return str(
        _coalesce(
            item.get("tipo_produto_erp"),
            item.get("tipo"),
            "",
        )
        or ""
    ).strip().upper()



def _item_eh_intermediario_pi(item: Dict[str, Any]) -> bool:
    """
    Identifica itens intermediários/preparações que não devem compor a visão
    operacional de Insumos.

    Regra validada:
      - PI representa produto intermediário/preparado, como TUBETE PREP;
      - a visão Insumos deve focar MP/ME/MI/MC e materiais consumíveis;
      - se o item aparece na BOM com tp=MP/ME/MI/MC, o tipo da BOM prevalece
        sobre d_produtos.tipo_produto_erp para a visão de Insumos.

    Caso real:
      - 71991 está em d_produtos como PI/ativo_analise=false;
      - mas na d_bom_estrutura aparece como componente MP do PA 52832;
      - portanto deve aparecer em Insumos e não ser excluído como PI.
    """
    tipo_norm = _tipo_item_norm(item)
    tipo_bom = str(
        _coalesce(
            item.get("tipo_componente_bom"),
            item.get("tp"),
            item.get("tipo_produto_erp_bom"),
            "",
        )
        or ""
    ).strip().upper()

    eh_componente_bom = (
        item.get("eh_componente_bom") is True
        or str(item.get("origem_classificacao") or "").strip() == "BOM"
        or str(item.get("origem_linha_estoque") or "").strip() == "bom_pa_pi_sem_snapshot_aging"
    )

    # Se a estrutura disse que o item é componente consumível, não deixa o tipo
    # cadastral PI derrubar o item do escopo de Insumos.
    if eh_componente_bom and tipo_bom in TIPOS_COMPONENTE_BOM_CONSUMIVEL:
        return False

    # Se a própria BOM diz que é intermediário, mantém fora da visão operacional.
    if tipo_bom in TIPOS_INTERMEDIARIO_BOM:
        return True

    return tipo_norm in TIPOS_INTERMEDIARIO_BOM


def _item_ativo_analise(item: Dict[str, Any]) -> bool:
    """
    Interpreta ativo_analise no item final usando a regra explícita.

    True/Sim/1 entra no escopo PA/MR. False/Não/0/vazio não entra.
    Isso é necessário porque d_produtos agora é base mestre completa, com 46 mil
    códigos, e não uma lista de SKUs comerciais ativos.
    """
    if not item:
        return False

    return _valor_ativo_analise_explicito(item.get("ativo_analise")) is True


def _item_eh_produto_estoque(item: Dict[str, Any]) -> bool:
    """
    Define se o item pertence à visão Produtos acabados / Revenda.

    Regra corrigida:
      - se o código aparece como componente na d_bom_estrutura, ele é tratado
        como insumo, mesmo que herde tipo_negocio = Anestésicos/PPS/Benzotop;
      - produtos são PA/MR/PPS/revenda/Bravi/itens comerciais da d_produtos,
        desde que não sejam componentes da BOM.

    Isso evita que EPINEFRINA e outros materiais consumidos na estrutura caiam
    na visão PA/MR apenas por herdarem uma classificação gerencial.
    """
    if item.get("eh_componente_bom") is True:
        return False

    origem_linha = str(item.get("origem_linha_estoque") or "").strip()
    origem_classificacao = str(item.get("origem_classificacao") or "").strip()

    # A lista oficial de PA/MR vem da Dimensão Produtos.
    # Quando ativo_analise=False, o item pode continuar em "Todos" ou como insumo
    # caso apareça na BOM, mas não entra no escopo Produtos acabados / Revenda.
    if origem_classificacao == "DIMENSAO" and not _item_ativo_analise(item):
        return False

    tipo_norm = _tipo_item_norm(item)

    if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}:
        return True

    if tipo_norm in {"MP", "ME", "MI", "PI", "MP/ME"}:
        return False

    # Itens adicionados pela d_produtos são, em geral, produtos comerciais/portfólio.
    # Ex.: 52875 - ONE STEP DROP MINI KIT.
    if origem_linha == "d_produtos_sem_snapshot_aging":
        return True

    if str(item.get("transferencia_bravi") or "").strip() == "Sim":
        return True

    tipo_negocio = str(item.get("tipo_negocio") or "").strip()
    macro_negocio = str(item.get("macro_negocio") or "").strip()
    grupo_gerencial = str(item.get("grupo_gerencial") or "").strip()

    sinais_comerciais = {
        "Anestésicos Injetáveis",
        "Benzotop",
        "PPS",
    }

    # Como componentes já foram excluídos no topo, agora é seguro usar a
    # classificação gerencial para identificar PA/MR/PPS ainda com tipo ERP
    # "A classificar".
    if origem_classificacao == "DIMENSAO":
        if tipo_negocio in sinais_comerciais or macro_negocio in sinais_comerciais:
            return True

        if grupo_gerencial in {
            "Anestésicos Injetáveis",
            "Benzotop",
            "PPS - Ativo terceirizado/revenda",
            "PPS - Descontinuado",
            "PPS - Transferência Bravi",
        }:
            return True

        if _to_float(item.get("demanda_direta_mes_atual")) > 0:
            return True

        if _to_float(item.get("faturamento_ytd_qtd")) > 0:
            return True

        if _to_float(item.get("qtd_pedidos_abertos")) > 0 and not item.get("tem_posicao_aging"):
            return True

    return False




def _item_eh_insumo_estoque(item: Dict[str, Any]) -> bool:
    """
    Define se o item pertence à visão Insumos.

    Regra de negócio validada com PCP:
      - insumo da tela = item que aparece na estrutura dos PAs e dos PIs;
      - porém PI/produto intermediário (ex.: TUBETE PREP) não entra na visão
        operacional de Insumos, porque não é MP/ME/MI consumível;
      - além dos componentes da BOM, a consulta operacional também deve mostrar
        itens reais que existem na posição de estoque/Aging/SB8, desde que não
        sejam PA/MR/PPS/revenda.

    Portanto, a base oficial combina d_bom_estrutura com a posição de estoque
    atual. O objetivo é não esconder códigos existentes no estoque quando o
    usuário filtra por descrição/código.
    """
    # Produto intermediário/preparado não deve poluir ruptura/crítico da visão
    # de Insumos. Ex.: 40299/40319/40295/40303/40315 - TUBETE PREP.
    if _item_eh_intermediario_pi(item):
        return False

    if item.get("eh_componente_bom") is True:
        return True

    if _item_eh_produto_estoque(item):
        return False

    if str(item.get("origem_classificacao") or "").strip() == "BOM":
        return True

    if str(item.get("origem_classificacao") or "").strip() == "ESTOQUE":
        return True

    if _to_float(item.get("demanda_bom_mes_atual")) > 0:
        return True

    if _item_estoque_deve_entrar_em_insumos_consulta(item):
        return True

    return False

def _filtrar_por_escopo_estoque(itens: List[Dict[str, Any]], escopo: Optional[str] = "todos") -> List[Dict[str, Any]]:
    escopo_norm = _normalizar_escopo_estoque(escopo)

    if escopo_norm == "produtos":
        return [item for item in itens or [] if _item_eh_produto_estoque(item)]

    if escopo_norm == "insumos":
        return [item for item in itens or [] if _item_eh_insumo_estoque(item)]

    return list(itens or [])


def _build_base():
    rows_consumo, snapshot_consumo = _buscar_consumo_latest()

    # d_produtos é o cadastro mestre gerencial da ferramenta.
    # Agora ela está com a base inteira do MATA010, então não podemos carregar
    # 46 mil SKUs como linhas da análise em cada request. Buscamos apenas:
    # snapshot do Aging + lista oficial ativo_analise=True + pais BOM/Bravi.
    produtos_all = _buscar_d_produtos_relevantes_para_base(rows_consumo)
    rows = _mesclar_consumo_com_d_produtos(rows_consumo, produtos_all)
    rows = _aplicar_saldo_sb8_em_linhas_sinteticas(rows, produtos_all)
    rows = _aplicar_saldo_sb8_em_produtos(rows, produtos_all)
    rows = _aplicar_quarentena_sb8_98_em_todos_os_itens(rows, produtos_all)
    # Importante: precisa vir por último para PA/MR/PPS não herdarem saldo/quarentena
    # de PI/intermediário ou por descrição. Insumos ficam intactos.
    rows = _aplicar_saldo_sb8_exato_produtos_tela(rows, produtos_all)

    # Universo correto de insumos: componentes das estruturas dos PAs e PIs.
    # O Aging deixa de definir sozinho quem é insumo; ele só complementa saldo,
    # histórico e cobertura dos componentes relevantes.
    componentes_bom_info = _buscar_componentes_bom_info()
    rows = _mesclar_consumo_com_componentes_bom(rows, componentes_bom_info)

    # v10 — Quarentena 98 para insumos:
    # a aplicação da quarentena precisa acontecer também depois da mescla com a BOM,
    # porque alguns itens podem entrar/ser enriquecidos nessa etapa. Se a SB8 tiver
    # saldo no armazém 98, ele deve aparecer na coluna "Quarentena 98" e entrar em
    # "Estoque + entr. + quar.", sem virar saldo disponível.
    rows = _aplicar_quarentena_sb8_98_em_todos_os_itens(rows, produtos_all)

    # Segurança final da visão de Insumos: estoque disponível só armazém 01.
    # Mantém o item listado, mas zera saldo operacional se a posição veio de 86/10/etc.
    rows = _aplicar_saldo_insumos_somente_armazem_01(rows, produtos_all)

    codigos = sorted({
        _normalizar_codigo(r.get("codigo"))
        for r in rows
        if r.get("codigo")
    })

    mapa_pa_pi_bravi = _mapear_pa_para_pi_bravi(codigos, produtos_all=produtos_all, rows=rows)
    codigos_pi_bravi = sorted({
        _normalizar_codigo(pi)
        for pis in mapa_pa_pi_bravi.values()
        for pi in (pis or [])
        if _normalizar_codigo(pi)
    })
    codigos_compra_consulta = sorted(set(codigos + codigos_pi_bravi))

    compras_raw = _buscar_compras_resumido(codigos_compra_consulta)
    liberacoes_pa_rows = _buscar_liberacoes_previstas_pa_rows(codigos, produtos_all=produtos_all)
    liberacoes_pa = _resumir_liberacoes_previstas_pa_rows(liberacoes_pa_rows)
    saldos_pi_bravi = _buscar_saldo_pi_bravi_resumido(mapa_pa_pi_bravi)
    entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
        codigos,
        rows,
        produtos_all,
        mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        liberacoes_pa_rows=liberacoes_pa_rows,
    )
    compras = _combinar_entradas_previstas_por_tipo(
        codigos,
        rows,
        produtos_all,
        compras_raw,
        liberacoes_pa,
        mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        saldos_pi_bravi=saldos_pi_bravi,
    )
    parametros, snapshot_parametros = _buscar_parametros_estoque(codigos)
    custos = _buscar_custos_unitarios(codigos)
    demanda_mes = _buscar_demanda_mes_atual(codigos)
    forecast_futuro = _buscar_forecast_futuro_por_codigo(codigos, produtos_all=produtos_all)

    # Produtos diretos = códigos que aparecem na base final da gestão de estoque.
    # Como a base final agora já inclui f_consumo_materiais + d_produtos, usamos
    # a dimensão completa filtrada em memória para evitar depender da BOM.
    produtos = {
        codigo: produtos_all[codigo]
        for codigo in codigos
        if codigo in produtos_all
    }

    # A BOM é usada para:
    #   1) classificar/herdar informações gerenciais de insumos;
    #   2) definir o escopo "insumos" com a regra correta:
    #      todo código que aparece como componente é insumo.
    classificacao_bom = _buscar_classificacao_bom(codigos, produtos_all)

    vendas = _buscar_faturamento_ytd(codigos)
    faturamento_6m_por_codigo = _buscar_historico_operacional_ultimos_6m_por_codigo(codigos)

    itens = []

    for row in rows:
        item = _montar_item_base(
            row,
            compras,
            parametros,
            custos,
            demanda_mes,
            produtos,
            vendas,
            classificacao_bom,
            forecast_futuro,
            entradas_previstas_serie_por_codigo,
            faturamento_6m_por_codigo,
        )

        codigo_item = _normalizar_codigo(item.get("codigo"))
        comp_info = componentes_bom_info.get(codigo_item)

        item["entradas_previstas_serie"] = entradas_previstas_serie_por_codigo.get(codigo_item) or []
        item["pedidos_futuros_por_mes"] = item["entradas_previstas_serie"]
        historico_6m = faturamento_6m_por_codigo.get(codigo_item, [])
        item["faturamento_sd2"] = historico_6m
        item["historico_6m"] = historico_6m
        item["historico_faturado_sop"] = historico_6m
        item["total_6m"] = _round(sum(_to_float(p.get("faturamento_qtd")) for p in historico_6m), 4)
        item["valor_6m"] = _round(sum(_to_float(p.get("faturamento_valor")) for p in historico_6m), 2)

        item["eh_componente_bom"] = bool(comp_info)
        item["qtd_pais_bom"] = int((comp_info or {}).get("qtd_pais_bom") or 0)
        item["tipo_componente_bom"] = (comp_info or {}).get("tp")
        item["eh_intermediario_pi"] = _item_eh_intermediario_pi(item)
        item["excluido_escopo_insumos"] = bool(item.get("eh_intermediario_pi"))
        item["motivo_exclusao_escopo_insumos"] = (
            "PI/produto intermediário não compõe a visão operacional de Insumos"
            if item.get("eh_intermediario_pi") else None
        )
        item["descricao_componente_bom"] = (comp_info or {}).get("descricao_comp")
        item["pais_bom"] = (comp_info or {}).get("pais_bom") or []
        item["linhas_bom"] = (comp_info or {}).get("linhas_bom") or []
        item["linha_bom"] = (comp_info or {}).get("linha_bom")

        # Segurança final: para insumos, a classificação visual deve vir do pai da BOM.
        # Produto acabado/revenda continua usando d_produtos.
        if comp_info:
            linha_bom = str((comp_info or {}).get("linha_bom") or "").strip()
            if linha_bom and linha_bom != "A classificar":
                item["tipo_negocio"] = linha_bom
                item["macro_negocio"] = linha_bom
                item["familia"] = linha_bom
                item["segmento"] = linha_bom
                item["grupo_gerencial"] = (comp_info or {}).get("grupo_gerencial_bom") or (
                    "Insumos - Compartilhados" if linha_bom == "Compartilhado" else f"Insumos - {linha_bom}"
                )
                item["modelo_fornecimento"] = (
                    "Insumo de produção compartilhado" if linha_bom == "Compartilhado" else "Insumo de produção"
                )
                item["origem_classificacao"] = "BOM"

        # Devolve o semáforo já calculado no backend para o front, cards, exportação
        # e filtros usarem exatamente a mesma regra operacional.
        item["status_visual"] = _status_visual_item(item)

        itens.append(item)

    itens.sort(
        key=lambda x: (
            x["origem_classificacao"] == "NAO_CLASSIFICADO",
            x.get("origem_linha_estoque") == "d_produtos_sem_snapshot_aging",
            x["status"] != "RUPTURA",
            x["status"] != "CRITICO",
            x["status_estoque"] != "TRANSFERENCIA_BRAVI",
            x["status_estoque"] != "DESCONTINUADO_COM_SALDO",
            x["cobertura_futura_dias"],
        )
    )

    return {
        "snapshot_consumo": snapshot_consumo,
        # Mantém o nome antigo para compatibilidade com o front.
        "snapshot_mrp": snapshot_parametros,
        "snapshot_parametros": snapshot_parametros,
        "qtd_linhas_consumo_snapshot": len(rows_consumo or []),
        "qtd_linhas_d_produtos_adicionadas": max(0, len(rows) - len(rows_consumo or [])),
        "qtd_d_produtos_relevantes_carregados": len(produtos_all),
        "qtd_componentes_bom": len(componentes_bom_info),
        "itens": itens,
    }



def _build_base_cached(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Cacheia a base final por alguns minutos e evita builds duplicados.

    Ajuste de performance:
    - TTL aumentado para 30 minutos, porque a base de estoque não muda a cada clique;
    - lock global para impedir que /resumo e /itens reconstruam a base ao mesmo tempo;
    - double-check dentro do lock para reutilizar o cache que outra requisição acabou de montar.

    Isso melhora principalmente a abertura em reunião, quando a página dispara
    cards + tabela quase ao mesmo tempo.
    """
    try:
        snapshot_consumo = _latest_consumo_snapshot()
    except Exception:
        snapshot_consumo = "sem_snapshot"

    try:
        snapshot_sb8 = _latest_sb8_snapshot()
    except Exception:
        snapshot_sb8 = "sem_snapshot_sb8"

    try:
        marker_mps = _latest_mps_cache_marker()
    except Exception:
        marker_mps = "sem_mps"

    try:
        marker_benzotop = _latest_benzotop_liberacao_snapshot()
    except Exception:
        marker_benzotop = "sem_benzotop"

    cache_key = f"{VERSAO_AGING_ESTOQUE}|{snapshot_consumo}|{snapshot_sb8}|{marker_mps}|benzotop:{marker_benzotop}|{date.today().isoformat()}"
    now = time.time()

    cached_key = _BUILD_BASE_CACHE.get("key")
    cached_at = float(_BUILD_BASE_CACHE.get("created_at") or 0)
    cached_data = _BUILD_BASE_CACHE.get("data")

    if _cache_base_valido(
        cached_data,
        cached_key,
        cache_key,
        cached_at,
        now=now,
        force_refresh=force_refresh,
    ):
        return cached_data

    with _BUILD_BASE_CACHE_LOCK:
        now = time.time()
        cached_key = _BUILD_BASE_CACHE.get("key")
        cached_at = float(_BUILD_BASE_CACHE.get("created_at") or 0)
        cached_data = _BUILD_BASE_CACHE.get("data")

        if _cache_base_valido(
            cached_data,
            cached_key,
            cache_key,
            cached_at,
            now=now,
            force_refresh=force_refresh,
        ):
            return cached_data

        # Hotfix: aqui precisa chamar _build_base(), não _build_base_cached(),
        # senão entra em recursão infinita.
        base = _build_base()

        _BUILD_BASE_CACHE["key"] = cache_key
        _BUILD_BASE_CACHE["created_at"] = now
        _BUILD_BASE_CACHE["data"] = base

        return base


def _percentual_mes_decorrido(ref: Optional[date] = None) -> float:
    hoje = ref or date.today()
    total_dias = calendar.monthrange(hoje.year, hoje.month)[1]
    if total_dias <= 0:
        return 0.0
    return min(100.0, max(0.0, (hoje.day / total_dias) * 100.0))


def _status_plano_mes(consumo_mes: Any, previsao_mes: Any) -> str:
    """
    Status do plano do mês: mede somente consumo/venda realizado vs previsão
    do mês atual. Não avalia ruptura, estoque ou cobertura.
    """
    consumo = max(0.0, _to_float(consumo_mes))
    previsao = max(0.0, _to_float(previsao_mes))

    if previsao <= 0 and consumo <= 0:
        return "SEM_MOVIMENTO"

    if previsao <= 0 and consumo > 0:
        return "SEM_PREVISAO"

    pct = (consumo / previsao) * 100.0 if previsao > 0 else 0.0

    if pct > 100.0:
        return "ACIMA_PREVISAO"
    if pct >= 85.0:
        return "ALERTA"
    if pct >= 75.0:
        return "ATENCAO"
    return "OK"


def _status_visual_plano_mes(consumo_mes: Any, previsao_mes: Any) -> str:
    status = _status_plano_mes(consumo_mes, previsao_mes)
    if status in {"SEM_PREVISAO", "ACIMA_PREVISAO"}:
        return "VERMELHO"
    if status == "ALERTA":
        return "LARANJA"
    if status == "ATENCAO":
        return "AMARELO"
    if status == "OK":
        return "VERDE"
    return "CINZA"


def _status_visual_consumo_insumo(item: Dict[str, Any]) -> str:
    """
    Semáforo dos insumos baseado no ritmo de consumo do mês.

    Ideia:
    - se hoje é dia 4 e já consumiu 70% da previsão do mês, o item precisa alertar;
    - comparamos % consumido da previsão mensal vs % do mês decorrido.
    """
    previsao_mes = max(0.0, _to_float(item.get("demanda_mes_atual")))
    consumo_mes = max(0.0, _to_float(item.get("consumo_mes_atual")))
    perc_mes = _percentual_mes_decorrido()

    # Sem previsão e sem consumo: não há risco operacional para acompanhar agora.
    # Então fica OK, não "sem referência".
    if previsao_mes <= 0 and consumo_mes <= 0:
        return "VERDE"

    # Consumo sem previsão continua sendo alerta vermelho na coluna
    # "Consumo vs previsão", mas não deve transformar automaticamente o
    # status principal em Crítico quando ainda há cobertura. A criticidade
    # principal fica reservada para risco de falta/cobertura baixa.
    if previsao_mes <= 0 and consumo_mes > 0:
        cobertura_futura = max(0.0, _to_float(item.get("cobertura_meses_futura")))
        estoque_operacional = (
            max(0.0, _to_float(item.get("saldo")))
            + max(0.0, _to_float(item.get("qtd_pedidos_abertos")))
            + max(0.0, _to_float(item.get("saldo_quarentena"), _to_float(item.get("quarentena"))))
        )
        if estoque_operacional <= 0 or cobertura_futura <= 0.5:
            return "VERMELHO"
        if cobertura_futura < 3.0:
            return "AMARELO"
        return "VERDE"

    perc_consumo = (consumo_mes / previsao_mes) * 100.0 if previsao_mes > 0 else 0.0
    desvio_ritmo = perc_consumo - perc_mes

    # Consumiu toda a previsão antes do fim do mês, ou muito acima do ritmo esperado.
    if (perc_consumo >= 100.0 and perc_mes < 98.0) or desvio_ritmo > 25.0:
        return "VERMELHO"

    if desvio_ritmo > 10.0:
        return "AMARELO"

    return "VERDE"


def _status_visual_item(item: Dict[str, Any]) -> str:
    """
    Status visual usado nos cards e na tabela.

    PA/MR:
      - crítico apenas quando há forecast/demanda e a disponibilidade não cobre.

    Insumos:
      - semáforo baseado no ritmo de consumo do mês:
        consumo acumulado vs previsão mensal proporcional ao dia atual.
    """
    if not item:
        return "CINZA"

    tipo_norm = str(item.get("tipo") or item.get("tipo_produto_erp") or "").upper()
    codigo_norm = _normalizar_codigo(item.get("codigo"))
    transferencia_bravi = _normalizar_sim_nao(item.get("transferencia_bravi"), default="Não")
    tratar_como_produto = (
        tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}
        or codigo_norm in BRAVI_PA_PI_STATIC_MAP
        or transferencia_bravi == "Sim"
    )

    status = str(item.get("status") or item.get("status_estoque") or "").upper()
    status_estoque = str(item.get("status_estoque") or "").upper()

    # Tags de portfolio não devem sozinhas virar crítico.
    if status_estoque in {"DESCONTINUADO_COM_SALDO", "TRANSFERENCIA_BRAVI"}:
        status = str(item.get("status") or "").upper()

    # O semáforo deve usar o saldo disponível exibido na tabela, não o saldo bruto.
    # Ex.: se o saldo bruto existe mas está empenhado, usar bruto faria o item parecer OK indevidamente.
    saldo_real = max(0.0, _to_float(item.get("saldo")))
    # Status de estoque usa a mesma base operacional da cobertura futura:
    # estoque atual + entradas/PC consideradas + quarentena 98, calculada no backend.
    # Para PA interno, base_cobertura_status já respeita a regra de não usar MPS
    # como entrada direta do PA quando isso não estiver validado.
    estoque_com_entradas = max(
        0.0,
        _to_float(
            item.get("base_cobertura_status"),
            saldo_real
            + _to_float(item.get("qtd_pedidos_abertos"))
            + _to_float(item.get("saldo_quarentena"), _to_float(item.get("quarentena"))),
        ),
    )
    demanda = max(
        0.0,
        _to_float(
            item.get("demanda_restante_mes_atual"),
            _demanda_restante_mes_atual(
                item.get("demanda_mes_atual", item.get("previsao_mes_atual")),
                item.get("consumo_mes_atual"),
            ),
        ),
    )

    # Primeiro respeita a criticidade operacional de estoque para todos os itens.
    # Antes, insumos com status RUPTURA podiam aparecer verdes porque o semáforo
    # caía no comparativo consumo realizado x previsão.
    if demanda > 0:
        if estoque_com_entradas <= 0:
            return "VERMELHO"
        if status in {"RUPTURA", "CRITICO"}:
            return "VERMELHO"
        if estoque_com_entradas < demanda:
            return "VERMELHO"
        if status == "ATENCAO":
            return "AMARELO"
        if status in {"EXCESSO", "SAUDAVEL"}:
            return "VERDE"

    # A partir da v81, status_visual é estoque/cobertura. O desvio do plano do
    # mês fica em status_plano/status_plano_visual e na coluna Consumo vs previsão.
    if demanda <= 0:
        if status in {"SEM_CONSUMO", "SEM_GIRO"}:
            return "CINZA"
        return "VERDE"

    return "VERDE"


def _status_operacional_com_demanda(
    status_original: str,
    tipo_produto: str,
    saldo: float,
    entradas_mes_atual: float,
    demanda_mes_atual: float,
    consumo_mes_atual: float,
    cobertura_meses_status: float = 0.0,
    movimento_6m: float = 0.0,
) -> str:
    """
    Classificação operacional da Gestão de Estoques.

    Regra final ajustada:
      - Ruptura/Crítico só existem quando há demanda/forecast no mês atual;
      - entradas do mês podem evitar ruptura, mas não criam excesso de estoque;
      - Excesso usa cobertura do estoque atual, não estoque + entrada prevista;
      - Sem consumo = sem demanda atual e sem venda/consumo real nos últimos 6 meses.
    """
    saldo_atual = max(0.0, _to_float(saldo))
    entradas_mes = max(0.0, _to_float(entradas_mes_atual))
    demanda_atual_original = max(0.0, _to_float(demanda_mes_atual))
    consumo_atual = max(0.0, _to_float(consumo_mes_atual))
    demanda_atual = _demanda_restante_mes_atual(demanda_atual_original, consumo_atual)
    movimento_6m = max(0.0, _to_float(movimento_6m))

    estoque_base_mes = saldo_atual + entradas_mes
    cobertura_futura = max(0.0, _to_float(cobertura_meses_status))

    if demanda_atual <= 0:
        if movimento_6m <= 0:
            return "SEM_CONSUMO"
        if cobertura_futura > 3.0:
            return "EXCESSO"
        return "SAUDAVEL"

    # Crítico = rompe no mês atual com a base considerada.
    # PA interno: entradas_mes chega zerada, então usa só estoque atual.
    # PPS/MR/PV: entradas_mes pode vir de compras do mês atual.
    if estoque_base_mes <= 0:
        return "RUPTURA"

    if estoque_base_mes < demanda_atual:
        return "CRITICO"

    # Excesso = cobertura acima de 3 meses.
    if cobertura_futura > 3.0:
        return "EXCESSO"

    # Atenção = atende o mês atual, mas não sustenta 3 meses de forecast.
    if cobertura_futura < 3.0:
        return "ATENCAO"

    return "SAUDAVEL"

def _item_descontinuado(item: Dict[str, Any]) -> bool:
    status_portfolio = str(item.get("status_portfolio") or "").upper()
    status_estoque = str(item.get("status_estoque") or item.get("status") or "").upper()
    grupo_gerencial = str(item.get("grupo_gerencial") or "").upper()
    return "DESCONT" in status_portfolio or "DESCONT" in status_estoque or "DESCONT" in grupo_gerencial


def _filtrar_itens(
    itens,
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    busca: Optional[str] = None,
    tipo_negocio: Optional[str] = None,
    status_portfolio: Optional[str] = None,
    transferencia_bravi: Optional[str] = None,
    modelo_fornecimento: Optional[str] = None,
    grupo_gerencial: Optional[str] = None,
    grupo: Optional[str] = None,
    curva_a: Optional[str] = None,
    classificacao_cadastro: Optional[str] = "MAPEADOS",
    semaforo: Optional[str] = None,
    status_plano: Optional[str] = None,
    alerta_previsao: Optional[str] = None,
    descontinuado: Optional[str] = None,
):
    filtrados = itens

    # Padrão da tela: mostrar itens mapeados pela dimensão/BOM e também
    # itens reais que existem na posição de estoque/Aging.
    #
    # Correção v22:
    # O fast path de Insumos não pode esconder um item existente no estoque só
    # porque ele ainda não aparece na BOM ou não foi classificado na dimensão.
    # Ex.: busca por "tubete" deve retornar todos os códigos encontrados na
    # posição de estoque/SB8, não apenas o componente que está na BOM.
    if classificacao_cadastro and classificacao_cadastro != "TODOS":
        if classificacao_cadastro == "MAPEADOS":
            filtrados = [
                i for i in filtrados
                if i.get("origem_classificacao") in {"DIMENSAO", "BOM", "ESTOQUE"}
            ]
        elif classificacao_cadastro == "NAO_CLASSIFICADOS":
            filtrados = [
                i for i in filtrados
                if i.get("origem_classificacao") == "NAO_CLASSIFICADO"
            ]
        elif classificacao_cadastro in {"DIMENSAO", "BOM", "ESTOQUE"}:
            filtrados = [
                i for i in filtrados
                if i.get("origem_classificacao") == classificacao_cadastro
            ]

    if status and status != "TODOS":
        filtrados = [
            i for i in filtrados
            if i.get("status") == status or i.get("status_estoque") == status
        ]

    if tipo and tipo != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("tipo") or "") == tipo
            or str(i.get("tipo_produto_erp") or "") == tipo
        ]

    if tipo_negocio and tipo_negocio != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("tipo_negocio") or "") == tipo_negocio
        ]

    if status_portfolio and status_portfolio != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("status_portfolio") or "") == status_portfolio
        ]

    if transferencia_bravi and transferencia_bravi != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("transferencia_bravi") or "") == transferencia_bravi
        ]

    if modelo_fornecimento and modelo_fornecimento != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("modelo_fornecimento") or "") == modelo_fornecimento
        ]

    if grupo_gerencial and grupo_gerencial != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("grupo_gerencial") or "") == grupo_gerencial
        ]

    if grupo and grupo != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("grupo") or "") == grupo
        ]

    if curva_a and curva_a != "TODOS":
        filtrados = [
            i for i in filtrados
            if str(i.get("curva_a") or "").strip().upper() == curva_a.strip().upper()
        ]

    if semaforo and semaforo != "TODOS":
        filtrados = [
            i for i in filtrados
            if _status_visual_item(i) == semaforo
        ]

    if status_plano and status_plano != "TODOS":
        status_plano_norm = str(status_plano or "").strip().upper()
        filtrados = [
            i for i in filtrados
            if str(i.get("status_plano") or i.get("status_mes") or "").strip().upper() == status_plano_norm
        ]

    if alerta_previsao and alerta_previsao != "TODOS":
        if alerta_previsao == "SIM":
            filtrados = [
                i for i in filtrados
                if _to_float(i.get("previsao_consumo_alerta")) > 0
                or (
                    _to_float(i.get("demanda_mes_atual")) > 0
                    and _to_float(i.get("consumo_mes_atual")) > _to_float(i.get("demanda_mes_atual"))
                )
            ]
        elif alerta_previsao == "NAO":
            filtrados = [
                i for i in filtrados
                if not (
                    _to_float(i.get("previsao_consumo_alerta")) > 0
                    or (
                        _to_float(i.get("demanda_mes_atual")) > 0
                        and _to_float(i.get("consumo_mes_atual")) > _to_float(i.get("demanda_mes_atual"))
                    )
                )
            ]

    if descontinuado and descontinuado != "TODOS":
        if descontinuado == "SIM":
            filtrados = [i for i in filtrados if _item_descontinuado(i)]
        elif descontinuado == "NAO":
            filtrados = [i for i in filtrados if not _item_descontinuado(i)]

    if busca:
        busca_txt = str(busca or "").strip()
        termos_busca = []

        if busca_txt:
            termos_busca.append(busca_txt.upper())

        # Autocomplete do front pode enviar rótulo completo, ex.:
        # "04782 · TUBETE VIDRO L1440149". Para não zerar a tabela,
        # também filtramos pelo código inicial normalizado.
        match_codigo_inicial = re.match(r"^\s*([0-9]{1,12})", busca_txt)
        if match_codigo_inicial:
            codigo_auto = _normalizar_codigo(match_codigo_inicial.group(1)).upper()
            if codigo_auto and codigo_auto not in termos_busca:
                termos_busca.append(codigo_auto)

        termos_busca = [t for t in termos_busca if t]

        def _item_match_busca(i: Dict[str, Any]) -> bool:
            campos_busca = [
                str(i.get("codigo") or ""),
                str(i.get("produto") or ""),
                str(i.get("grupo_descricao") or ""),
                str(i.get("grupo_gerencial") or ""),
                str(i.get("status_portfolio") or ""),
                str(i.get("tipo_negocio") or ""),
            ]
            texto_item = " | ".join(campos_busca).upper()
            return any(termo in texto_item for termo in termos_busca)

        filtrados = [i for i in filtrados if _item_match_busca(i)]

    return filtrados


def _opcoes_filtro(itens):
    def valores(campo: str, incluir_a_classificar: bool = False):
        vals = set()

        for item in itens:
            texto = str(item.get(campo) or "").strip()

            if not texto:
                continue

            if not incluir_a_classificar and not _eh_classificado(texto):
                continue

            vals.add(texto)

        return sorted(vals)

    return {
        "tipo_negocio": valores("tipo_negocio"),
        "tipo": valores("tipo", incluir_a_classificar=True),
        "status_portfolio": valores("status_portfolio"),
        # Fixo para não aparecer dropdown vazio/só com Todos.
        "transferencia_bravi": ["Sim", "Não"],
        "modelo_fornecimento": valores("modelo_fornecimento"),
        "grupo_gerencial": valores("grupo_gerencial"),
        "grupo": valores("grupo"),
        # Fixo: sempre as 3 curvas, mesmo que algum item ainda esteja
        # "A classificar" (esse não entra na lista, só A/B/C de verdade).
        "curva_a": ["A", "B", "C"],
        "classificacao_cadastro": ["MAPEADOS", "DIMENSAO", "BOM", "NAO_CLASSIFICADOS", "TODOS"],
    }


def _montar_resumo(itens):
    cobertura_validos = [
        i["cobertura_dias"]
        for i in itens
        if _to_float(i.get("demanda_cobertura_futura_total")) > 0
        or _to_float(i.get("maior_media")) > 0
        or _to_float(i.get("demanda_mes_atual")) > 0
    ]

    cobertura_futura_validos = [
        i["cobertura_futura_dias"]
        for i in itens
        if _to_float(i.get("demanda_cobertura_futura_total")) > 0
        or _to_float(i.get("maior_media")) > 0
        or _to_float(i.get("demanda_mes_atual")) > 0
    ]

    return {
        "total_itens": len(itens),
        "ruptura": sum(1 for i in itens if _status_visual_item(i) == "VERMELHO" and i.get("status") == "RUPTURA"),
        "critico": sum(1 for i in itens if _status_visual_item(i) == "VERMELHO" and i.get("status") != "RUPTURA"),
        "atencao": sum(1 for i in itens if _status_visual_item(i) == "AMARELO"),
        "saudavel": sum(1 for i in itens if _status_visual_item(i) == "VERDE"),
        "excesso": sum(1 for i in itens if i["status"] == "EXCESSO"),
        "sem_giro": sum(1 for i in itens if i["status"] in {"SEM_GIRO", "SEM_CONSUMO"}),
        "descontinuado_com_saldo": sum(1 for i in itens if i.get("status_estoque") == "DESCONTINUADO_COM_SALDO"),
        # Conta Bravi pela mesma regra do filtro da tabela:
        # transferencia_bravi = "Sim".
        # Antes contava apenas status_estoque = TRANSFERENCIA_BRAVI, que depende de saldo > 0
        # e fazia o card divergir do total filtrado da tabela.
        "transferencia_bravi": sum(
            1 for i in itens
            if str(i.get("transferencia_bravi") or "").strip() == "Sim"
        ),

        "saldo_total": _round(sum(i["saldo"] for i in itens)),
        "pedidos_total": _round(sum(i["qtd_pedidos_abertos"] for i in itens)),
        "entradas_previstas_total": _round(sum(i.get("entradas_previstas", i.get("qtd_pedidos_abertos", 0)) for i in itens)),
        "liberacoes_previstas_total": _round(sum(i.get("qtd_liberacoes_previstas", 0) for i in itens)),
        "pedidos_compra_total": _round(sum(i.get("qtd_pedidos_compra", 0) for i in itens)),
        "estoque_ideal_total": _round(sum(i.get("estoque_ideal", 0) for i in itens)),
        "gap_total": _round(sum(i["gap_volume"] for i in itens)),

        "estoque_atual_valor_total": _round(sum(i.get("estoque_atual_valor", 0) for i in itens), 2),
        "pedidos_abertos_valor_total": _round(sum(i.get("pedidos_abertos_valor", 0) for i in itens), 2),
        "estoque_mais_pedidos_valor_total": _round(sum(i.get("estoque_mais_pedidos_valor", 0) for i in itens), 2),
        "estoque_ideal_valor_total": _round(sum(i.get("estoque_ideal_valor", 0) for i in itens), 2),
        "gap_valor_total": _round(sum(i.get("gap_valor", 0) for i in itens), 2),

        "demanda_mes_atual_total": _round(sum(i.get("demanda_mes_atual", 0) for i in itens)),
        "consumo_mes_atual_total": _round(sum(i.get("consumo_mes_atual", 0) for i in itens)),
        "faturamento_ytd_qtd": _round(sum(i.get("faturamento_ytd_qtd", 0) for i in itens)),
        "faturamento_ytd_valor": _round(sum(i.get("faturamento_ytd_valor", 0) for i in itens)),

        "cobertura_media_dias": _round(
            sum(cobertura_validos) / max(1, len(cobertura_validos)), 1
        ),

        "cobertura_futura_media_dias": _round(
            sum(cobertura_futura_validos) / max(1, len(cobertura_futura_validos)), 1
        ),
    }


def _montar_saude_negocios(itens):
    ordem = ["Anestésicos Injetáveis", "Benzotop", "PPS", "A classificar"]

    grupos = defaultdict(list)

    for item in itens:
        grupos[str(item.get("tipo_negocio") or "A classificar")].append(item)

    resultado = []

    for tipo_negocio in sorted(grupos.keys(), key=lambda x: (ordem.index(x) if x in ordem else 99, x)):
        subset = grupos[tipo_negocio]
        resumo = _montar_resumo(subset)

        resultado.append({
            "tipo_negocio": tipo_negocio,
            "itens": resumo["total_itens"],
            "criticos": resumo["ruptura"] + resumo["critico"],
            "excesso": resumo["excesso"],
            "sem_giro": resumo["sem_giro"],
            "descontinuado_com_saldo": resumo["descontinuado_com_saldo"],
            "transferencia_bravi": resumo["transferencia_bravi"],
            "saldo_total": resumo["saldo_total"],
            "pedidos_total": resumo["pedidos_total"],
            "entradas_previstas_total": resumo.get("entradas_previstas_total", resumo["pedidos_total"]),
            "liberacoes_previstas_total": resumo.get("liberacoes_previstas_total", 0),
            "pedidos_compra_total": resumo.get("pedidos_compra_total", 0),
            "faturamento_ytd_qtd": resumo["faturamento_ytd_qtd"],
            "faturamento_ytd_valor": resumo["faturamento_ytd_valor"],
            "cobertura_futura_media_dias": resumo["cobertura_futura_media_dias"],
        })

    return resultado

def _mes_label(mes: int, ano: int):
    nomes = {
        1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
        7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
    }
    return f"{nomes.get(mes, str(mes).zfill(2))}/{str(ano)[-2:]}"




def _normalizar_ano_consumo(ano_raw: Any) -> int:
    """
    Normaliza o ano das colunas de consumo.

    A base pode vir como:
      - m_06_2025 / M_06_2025
      - m_06_25   / M_06_25

    O formato com 2 dígitos é comum no Aging do Excel.
    """
    try:
        ano = int(str(ano_raw).strip())
    except Exception:
        return 0

    if ano < 100:
        # Como o histórico do Aging é recente, 24, 25, 26 viram 2024, 2025, 2026.
        return 2000 + ano

    return ano


def _normalizar_campo_consumo(value: Any) -> str:
    """
    Normaliza nomes de colunas de consumo mensal.

    A posição de estoque pode chegar no banco com variações como:
      M_06_2026, m_06_2026, M 06 2026, M-06-2026 ou até com espaços.
    Para a Gestão, todas devem ser interpretadas como m_06_2026.
    """
    texto = str(value or "").strip().lower()
    if not texto:
        return ""

    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
    texto = re.sub(r"[^a-z0-9]+", "_", texto)
    texto = re.sub(r"_+", "_", texto).strip("_")
    return texto


def _get_consumo_mes_origem(row: Dict[str, Any], mes: int, ano: int) -> Tuple[float, Optional[str], str]:
    """
    Busca o consumo realizado do mês na posição de estoque/Aging.

    Fonte correta:
      - coluna M_MM_AAAA do próprio Aging/posição de estoque.
        Exemplo de junho/2026: M_06_2026.

    Retorna:
      - valor;
      - nome do campo encontrado;
      - método usado.

    Isso evita mostrar consumo mês = 0 quando o arquivo veio com cabeçalho em
    maiúsculo, com espaço, com ano curto ou com alguma normalização do upload.
    """
    mes_str = str(int(mes)).zfill(2)
    ano_4 = str(int(ano))
    ano_2 = ano_4[-2:]

    candidatos = [
        f"m_{mes_str}_{ano_4}",
        f"M_{mes_str}_{ano_4}",
        f"m_{mes_str}_{ano_2}",
        f"M_{mes_str}_{ano_2}",
    ]

    # 1) Acesso direto, preservando o nome original.
    for campo in candidatos:
        if campo in row:
            return _to_float(row.get(campo)), campo, "direto"

    # 2) Comparação case-insensitive com strip.
    candidatos_lower = {c.lower() for c in candidatos}
    for campo, valor in (row or {}).items():
        campo_txt = str(campo or "").strip()
        if campo_txt.lower() in candidatos_lower:
            return _to_float(valor), campo_txt, "case_insensitive"

    # 3) Comparação normalizada: aceita M 06 2026, M-06-2026 etc.
    candidatos_norm = {
        _normalizar_campo_consumo(c)
        for c in candidatos
    }

    for campo, valor in (row or {}).items():
        campo_norm = _normalizar_campo_consumo(campo)
        if campo_norm in candidatos_norm:
            return _to_float(valor), str(campo), "normalizado"

    # 4) Fallback por regex sobre qualquer coluna que pareça consumo mensal.
    # Ex.: m_06_2026, M_06_26, M 06 2026.
    padrao = re.compile(r"^m[_\s\-/]*(\d{1,2})[_\s\-/]*(\d{2}|\d{4})$", re.IGNORECASE)
    for campo, valor in (row or {}).items():
        campo_norm = _normalizar_campo_consumo(campo)
        match = padrao.match(campo_norm)
        if not match:
            continue

        mes_campo = int(match.group(1))
        ano_campo = _normalizar_ano_consumo(match.group(2))

        if mes_campo == int(mes) and ano_campo == int(ano):
            return _to_float(valor), str(campo), "regex_consumo_mensal"

    return 0.0, None, "nao_encontrado"


def _get_consumo_mes(row: Dict[str, Any], mes: int, ano: int) -> float:
    valor, _, _ = _get_consumo_mes_origem(row, mes, ano)
    return valor

def _historico_consumo(row: Dict[str, Any]):
    """
    Monta o histórico de consumo a partir de todas as colunas mensais disponíveis
    no snapshot.

    Aceita tanto o padrão antigo/Excel:
      M_06_25

    quanto o padrão novo:
      m_06_2025

    Esse ajuste é importante porque o Aging exportado costuma usar ano com
    2 dígitos no cabeçalho, e antes esses meses eram ignorados na linha do tempo.
    """
    import re

    historico = []
    padrao = re.compile(r"^m_(\d{1,2})_(\d{2}|\d{4})$", re.IGNORECASE)

    for campo, valor in row.items():
        campo_txt = str(campo or "").strip()
        campo_match = _normalizar_campo_consumo(campo_txt)
        match = padrao.match(campo_match)

        if not match:
            continue

        mes = int(match.group(1))
        ano = _normalizar_ano_consumo(match.group(2))

        if ano <= 0 or mes <= 0 or mes > 12:
            continue

        historico.append({
            "ano": ano,
            "mes": mes,
            "periodo": _mes_label(mes, ano),
            "campo": campo_txt,
            "consumo": _round(valor, 4),
        })

    historico.sort(key=lambda x: (x["ano"], x["mes"]))
    return historico


def _historico_sb8_diario(codigo: str, tipo: Optional[str] = None):
    rows = _select_all(
        supabase.table("f_estoque_saldo")
        .select("*")
        .eq("codigo", codigo)
        .order("data_ref")
    )

    por_dia = defaultdict(lambda: {
        "saldo_normal": 0.0,
        "saldo_bruto": 0.0,
        "empenho_lote": 0.0,
        "saldo_quarentena": 0.0,
        "saldo_quarentena_bruto": 0.0,
        "empenho_quarentena": 0.0,
    })

    armazens_validos = _armazens_sb8_normais_por_tipo(tipo)

    for row in rows:
        data_ref = row.get("data_ref")

        if not data_ref:
            continue

        data_key = str(data_ref)[:10]
        armazem = _normalizar_armazem_estoque(row)
        saldo_disponivel = _saldo_disponivel_lote(row)
        saldo_bruto = _saldo_lote_bruto(row)
        empenho = _valor_empenho_lote(row)

        # Quarentena deve aparecer separada, mas NÃO entra no saldo principal.
        if armazem == "98":
            por_dia[data_key]["saldo_quarentena"] += saldo_disponivel
            por_dia[data_key]["saldo_quarentena_bruto"] += saldo_bruto
            por_dia[data_key]["empenho_quarentena"] += empenho
            continue

        # Saldo normal SB8: PA/MR/PPS/novos usam 04 e 07; MP/ME/MI usam 01.
        if armazem not in armazens_validos:
            continue

        por_dia[data_key]["saldo_normal"] += saldo_disponivel
        por_dia[data_key]["saldo_bruto"] += saldo_bruto
        por_dia[data_key]["empenho_lote"] += empenho

    atual = date.today()
    mes_atual = f"{atual.year}-{str(atual.month).zfill(2)}"

    diario = []

    for data_ref, valores in sorted(por_dia.items()):
        if not data_ref.startswith(mes_atual):
            continue

        saldo_normal = valores["saldo_normal"]
        saldo_quarentena = valores["saldo_quarentena"]
        saldo_total_com_quarentena = saldo_normal + saldo_quarentena

        diario.append({
            "data": data_ref,
            # Mantém "saldo" como saldo normal para não distorcer gráfico antigo.
            "saldo": _round(saldo_normal, 4),
            "saldo_normal": _round(saldo_normal, 4),
            "saldo_bruto": _round(valores["saldo_bruto"], 4),
            "empenho_lote": _round(valores["empenho_lote"], 4),
            "saldo_quarentena": _round(saldo_quarentena, 4),
            "quarentena": _round(saldo_quarentena, 4),
            "saldo_quarentena_bruto": _round(valores["saldo_quarentena_bruto"], 4),
            "empenho_quarentena": _round(valores["empenho_quarentena"], 4),
            "saldo_total_com_quarentena": _round(saldo_total_com_quarentena, 4),
            "armazens_normais": sorted(armazens_validos),
            "armazem_quarentena": "98",
        })

    return diario


def _estoque_medio_mensal_sb8(codigo: str, tipo: Optional[str] = None):
    rows = _select_all(
        supabase.table("f_estoque_saldo")
        .select("*")
        .eq("codigo", codigo)
        .order("data_ref")
    )

    saldo_dia = defaultdict(lambda: {
        "saldo_normal": 0.0,
        "saldo_bruto": 0.0,
        "empenho_lote": 0.0,
        "saldo_quarentena": 0.0,
        "saldo_quarentena_bruto": 0.0,
        "empenho_quarentena": 0.0,
    })

    armazens_validos = _armazens_sb8_normais_por_tipo(tipo)

    for row in rows:
        data_ref = row.get("data_ref")

        if not data_ref:
            continue

        data_key = str(data_ref)[:10]
        armazem = _normalizar_armazem_estoque(row)
        saldo_disponivel = _saldo_disponivel_lote(row)
        saldo_bruto = _saldo_lote_bruto(row)
        empenho = _valor_empenho_lote(row)

        # Quarentena separada, fora do estoque médio principal.
        if armazem == "98":
            saldo_dia[data_key]["saldo_quarentena"] += saldo_disponivel
            saldo_dia[data_key]["saldo_quarentena_bruto"] += saldo_bruto
            saldo_dia[data_key]["empenho_quarentena"] += empenho
            continue

        if armazem not in armazens_validos:
            continue

        saldo_dia[data_key]["saldo_normal"] += saldo_disponivel
        saldo_dia[data_key]["saldo_bruto"] += saldo_bruto
        saldo_dia[data_key]["empenho_lote"] += empenho

    por_mes = defaultdict(lambda: {
        "normal": [],
        "bruto": [],
        "empenho": [],
        "quarentena": [],
        "quarentena_bruta": [],
        "empenho_quarentena": [],
        "total_com_quarentena": [],
    })

    for data_ref, valores in saldo_dia.items():
        try:
            ano = int(data_ref[:4])
            mes = int(data_ref[5:7])
        except Exception:
            continue

        saldo_normal = valores["saldo_normal"]
        saldo_quarentena = valores["saldo_quarentena"]
        saldo_total_com_quarentena = saldo_normal + saldo_quarentena

        por_mes[(ano, mes)]["normal"].append(saldo_normal)
        por_mes[(ano, mes)]["bruto"].append(valores["saldo_bruto"])
        por_mes[(ano, mes)]["empenho"].append(valores["empenho_lote"])
        por_mes[(ano, mes)]["quarentena"].append(saldo_quarentena)
        por_mes[(ano, mes)]["quarentena_bruta"].append(valores["saldo_quarentena_bruto"])
        por_mes[(ano, mes)]["empenho_quarentena"].append(valores["empenho_quarentena"])
        por_mes[(ano, mes)]["total_com_quarentena"].append(saldo_total_com_quarentena)

    resultado = []

    def media(lista):
        return sum(lista) / max(1, len(lista))

    for (ano, mes), valores in sorted(por_mes.items()):
        media_normal = media(valores["normal"])
        media_bruto = media(valores["bruto"])
        media_empenho = media(valores["empenho"])
        media_quarentena = media(valores["quarentena"])
        media_quarentena_bruta = media(valores["quarentena_bruta"])
        media_empenho_quarentena = media(valores["empenho_quarentena"])
        media_total_com_quarentena = media(valores["total_com_quarentena"])

        resultado.append({
            "ano": ano,
            "mes": mes,
            "periodo": _mes_label(mes, ano),
            # Mantém estoque_medio como normal/disponível para comparar com demanda.
            "estoque_medio": _round(media_normal, 4),
            "estoque_medio_normal": _round(media_normal, 4),
            "estoque_medio_bruto": _round(media_bruto, 4),
            "empenho_medio_lote": _round(media_empenho, 4),
            "estoque_medio_quarentena": _round(media_quarentena, 4),
            "estoque_medio_quarentena_bruto": _round(media_quarentena_bruta, 4),
            "empenho_medio_quarentena": _round(media_empenho_quarentena, 4),
            "estoque_medio_total_com_quarentena": _round(media_total_com_quarentena, 4),
            "armazens_normais": sorted(armazens_validos),
            "armazem_quarentena": "98",
        })

    return resultado


def _forecast_direto(codigo: str):
    rows = _select_all(
        supabase.table("f_forecast_sop")
        .select("cod_produto, mes, ano, qtd_forecast")
    )

    serie = defaultdict(float)

    for row in rows:
        cod = _normalizar_codigo(row.get("cod_produto"))
        if cod != codigo:
            continue

        ano = int(row.get("ano") or 0)
        mes = int(row.get("mes") or 0)

        if ano <= 0 or mes <= 0:
            continue

        serie[(ano, mes)] += _to_float(row.get("qtd_forecast"))

    return [
        {
            "ano": ano,
            "mes": mes,
            "periodo": _mes_label(mes, ano),
            "forecast": _round(valor, 4),
        }
        for (ano, mes), valor in sorted(serie.items())
    ]


def _forecast_explodido_bom(codigo_comp: str):
    """
    Retorna a série de demanda do insumo via programação/Gantt V1 explodida
    pela BOM em múltiplos níveis.

    Regra atual:
      Programação/Gantt V1 do mês atual, somando L1 + L2
      -> BOM multinível
      -> necessidade do componente.

    Se a programação V1 não for localizada, cai para forecast S&OP como fallback
    para não deixar a tela sem série enquanto validamos a tabela de origem.
    """
    codigo_norm = _normalizar_codigo(codigo_comp)

    if not codigo_norm:
        return []

    programacao_rows, _debug_programacao = _buscar_mrp_v1_l1_l2_rows()
    origem = "mrp_v1_l1_l2_bom"

    if not programacao_rows:
        programacao_rows = _buscar_forecast_sop_rows()
        origem = "forecast_sop_bom_fallback_sem_programacao_v1"

    _, demanda_explodida = _explodir_forecast_multinivel(
        programacao_rows,
        codigos_interesse={codigo_norm},
    )

    serie = defaultdict(float)

    for (codigo, ano, mes), valor in demanda_explodida.items():
        if codigo != codigo_norm:
            continue
        serie[(ano, mes)] += _to_float(valor)

    return [
        {
            "ano": ano,
            "mes": mes,
            "periodo": _mes_label(mes, ano),
            "forecast": _round(valor, 4),
            "origem_demanda": origem,
        }
        for (ano, mes), valor in sorted(serie.items())
    ]

def _forecast_item(codigo: str, tipo: Optional[str]):
    """
    Define a série de demanda futura do item.

    Regra principal:
      - PA/MR usam forecast direto;
      - MP/ME/MI/PI usam programação/Gantt V1 explodida pela BOM.

    Fallback importante:
      - alguns PA/MR/PPS novos ainda podem estar com tipo ERP como
        "A classificar" na d_produtos, mas já possuem forecast direto
        em f_forecast_sop. Nesses casos, usamos o forecast direto mesmo sem
        depender da d_bom_estrutura.

    Isso corrige casos como 52875 / ONE STEP DROP MINI KIT, que tem forecast
    direto, mas não necessariamente está na BOM.
    """
    tipo_norm = str(tipo or "").strip().upper()

    serie_direta = _forecast_direto(codigo)

    if tipo_norm in {"PA", "MR"}:
        return {
            "metodo": "direto",
            "serie": serie_direta,
        }

    serie_bom = _forecast_explodido_bom(codigo)

    if not serie_bom and serie_direta:
        return {
            "metodo": "direto_fallback_tipo_nao_classificado",
            "serie": serie_direta,
        }

    return {
        "metodo": "mrp_v1_l1_l2_bom",
        "serie": serie_bom,
    }


def _comparativo_mensal(estoque_medio, consumo, forecast):
    mapa = {}

    for p in estoque_medio:
        chave = (p["ano"], p["mes"])
        mapa.setdefault(chave, {
            "ano": p["ano"],
            "mes": p["mes"],
            "periodo": p["periodo"],
            "estoque_medio": 0,
            "consumo": 0,
            "forecast": 0,
        })
        mapa[chave]["estoque_medio"] = p["estoque_medio"]

    for p in consumo:
        chave = (p["ano"], p["mes"])
        mapa.setdefault(chave, {
            "ano": p["ano"],
            "mes": p["mes"],
            "periodo": p["periodo"],
            "estoque_medio": 0,
            "consumo": 0,
            "forecast": 0,
        })
        mapa[chave]["consumo"] = p["consumo"]

    for p in forecast:
        chave = (p["ano"], p["mes"])
        mapa.setdefault(chave, {
            "ano": p["ano"],
            "mes": p["mes"],
            "periodo": p["periodo"],
            "estoque_medio": 0,
            "consumo": 0,
            "forecast": 0,
        })
        mapa[chave]["forecast"] = p["forecast"]

    return [
        mapa[k]
        for k in sorted(mapa.keys())
    ]


def _periodo_key_from_date(value: Any):
    if not value:
        return None

    texto = str(value)[:10]

    try:
        ano = int(texto[:4])
        mes = int(texto[5:7])
    except Exception:
        return None

    if ano <= 0 or mes <= 0:
        return None

    return (ano, mes)



def _add_months(ano: int, mes: int, delta: int):
    total = (int(ano) * 12 + (int(mes) - 1)) + int(delta)
    return total // 12, (total % 12) + 1


def _month_key_ge(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return (a[0], a[1]) >= (b[0], b[1])


def _month_key_le(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return (a[0], a[1]) <= (b[0], b[1])


def _iter_months(inicio: tuple[int, int], fim: tuple[int, int]):
    ano, mes = inicio
    while (ano, mes) <= fim:
        yield ano, mes
        ano, mes = _add_months(ano, mes, 1)


def _linha_tempo_estoque(
    item: Dict[str, Any],
    historico_consumo: List[Dict[str, Any]],
    forecast_serie: List[Dict[str, Any]],
    pedidos: List[Dict[str, Any]],
    meses_futuros: int = 6,
):
    """
    Monta a série visual do item para a tela principal da Gestão de Estoque.

    Ajustes importantes:
      - consumo histórico aparece apenas nos meses que existem na base;
      - consumo não é preenchido com 0 no futuro, para não "matar" a linha;
      - demanda/forecast aparece apenas do mês atual em diante;
      - entradas previstas aparecem apenas no horizonte futuro;
      - mantém aliases de campos para compatibilidade com versões diferentes do front:
          consumo / consumo_historico
          demanda / demanda_forecast_bom / forecast
          estoque_mais_pedidos / estoque_pedidos
    """
    hoje = date.today()
    meses_futuros = max(1, min(int(meses_futuros or 6), 24))

    inicio = (2025, 1)
    fim = _add_months(hoje.year, hoje.month, meses_futuros)
    chave_atual = (hoje.year, hoje.month)

    mapa: Dict[tuple[int, int], Dict[str, Any]] = {}

    def ensure(ano: int, mes: int):
        chave = (int(ano), int(mes))
        if chave not in mapa:
            mapa[chave] = {
                "ano": int(ano),
                "mes": int(mes),
                "periodo": _mes_label(int(mes), int(ano)),

                # Campos principais
                "consumo": None,
                "demanda": None,
                "forecast": None,
                "demanda_original": None,
                "forecast_original": None,
                "demanda_restante_mes_atual": None,
                "consumo_mes_atual_descontado": None,
                "entradas_previstas": None,
                "estoque_atual": None,
                "estoque_mais_pedidos": None,
                "estoque_quarentena": None,
                "quarentena": None,
                "saldo_projetado": None,

                # Aliases para compatibilidade com o front
                "consumo_historico": None,
                "demanda_forecast_bom": None,
                "estoque_pedidos": None,
            }
        return mapa[chave]

    # Garante eixo contínuo de jan/2025 até o horizonte escolhido.
    for ano, mes in _iter_months(inicio, fim):
        ensure(ano, mes)

    # Consumo histórico: só preenche meses existentes na base.
    for p in historico_consumo or []:
        ano = int(p.get("ano") or 0)
        mes = int(p.get("mes") or 0)
        chave = (ano, mes)

        if ano <= 0 or mes <= 0:
            continue

        if not _month_key_ge(chave, inicio) or not _month_key_le(chave, fim):
            continue

        valor = _to_float(p.get("consumo"))
        ponto = ensure(ano, mes)

        atual = _to_float(ponto.get("consumo"), default=0.0) if ponto.get("consumo") is not None else 0.0
        novo_valor = atual + valor

        ponto["consumo"] = _round(novo_valor, 4)
        ponto["consumo_historico"] = _round(novo_valor, 4)

    # Demanda/forecast: para a tela de projeção, só faz sentido do mês atual para frente.
    for p in forecast_serie or []:
        ano = int(p.get("ano") or 0)
        mes = int(p.get("mes") or 0)
        chave = (ano, mes)

        if ano <= 0 or mes <= 0:
            continue

        if not _month_key_ge(chave, chave_atual) or not _month_key_le(chave, fim):
            continue

        demanda_original = _to_float(
            _coalesce(
                p.get("forecast"),
                p.get("demanda"),
                p.get("qtd_forecast"),
            )
        )
        demanda = demanda_original
        consumo_descontado = 0.0

        # No mês atual, a linha verde da visão operacional mostra o que ainda
        # falta atender do forecast oficial. O forecast cheio continua exposto
        # nos campos *_original para tooltip/debug e na coluna Previsão mês.
        if chave == chave_atual:
            consumo_descontado = max(0.0, _to_float(item.get("consumo_mes_atual")))
            demanda = _demanda_restante_mes_atual(demanda_original, consumo_descontado)

        ponto = ensure(ano, mes)

        atual = _to_float(ponto.get("demanda"), default=0.0) if ponto.get("demanda") is not None else 0.0
        atual_original = _to_float(ponto.get("demanda_original"), default=0.0) if ponto.get("demanda_original") is not None else 0.0
        novo_valor = atual + demanda
        novo_valor_original = atual_original + demanda_original

        ponto["demanda"] = _round(novo_valor, 4)
        ponto["forecast"] = _round(novo_valor, 4)
        ponto["demanda_forecast_bom"] = _round(novo_valor, 4)
        ponto["demanda_original"] = _round(novo_valor_original, 4)
        ponto["forecast_original"] = _round(novo_valor_original, 4)
        ponto["demanda_restante_mes_atual"] = _round(demanda, 4) if chave == chave_atual else None
        ponto["consumo_mes_atual_descontado"] = _round(consumo_descontado, 4) if chave == chave_atual else None

    # Entradas previstas: compras abertas entram só no mês de entrega.
    for pedido in pedidos or []:
        chave = _periodo_key_from_date(pedido.get("data_prevista_entrega"))
        if not chave:
            continue

        if not _month_key_ge(chave, chave_atual) or not _month_key_le(chave, fim):
            continue

        ano, mes = chave
        ponto = ensure(ano, mes)

        atual = (
            _to_float(ponto.get("entradas_previstas"), default=0.0)
            if ponto.get("entradas_previstas") is not None
            else 0.0
        )
        novo_valor = atual + _to_float(pedido.get("quantidade_pendente"))
        ponto["entradas_previstas"] = _round(novo_valor, 4)

    saldo_atual = _to_float(
        item.get("estoque_atual_volume"),
        default=_to_float(item.get("saldo")),
    )
    estoque_com_pedidos = _to_float(
        item.get("estoque_mais_entradas_volume"),
        default=_to_float(item.get("estoque_mais_pedidos")),
    )

    saldo_projetado = saldo_atual
    resultado = []

    for chave in sorted(mapa.keys()):
        ponto = mapa[chave]

        # Estoque atual é uma fotografia do momento atual, não uma série histórica
        # repetida. Mantemos o valor apenas no mês atual para o front exibir como
        # barra/referência pontual.
        if chave == chave_atual:
            ponto["estoque_atual"] = _round(saldo_atual, 4)
            ponto["estoque_mais_pedidos"] = _round(estoque_com_pedidos, 4)
            ponto["estoque_pedidos"] = _round(estoque_com_pedidos, 4)
            ponto["estoque_quarentena"] = _round(item.get("saldo_quarentena"), 4)
            ponto["quarentena"] = _round(item.get("saldo_quarentena"), 4)

        # Projeção só do mês atual em diante.
        if chave >= chave_atual:
            saldo_projetado = (
                saldo_projetado
                + _to_float(ponto.get("entradas_previstas"))
                - _to_float(ponto.get("demanda"))
            )
            ponto["saldo_projetado"] = _round(saldo_projetado, 4)

        resultado.append(ponto)

    return resultado





# ─── Fast path Insumos ───────────────────────────────────────────────────────
# A visão de Insumos não precisa montar o universo inteiro de PA/MR + produtos
# oficiais toda vez que a tabela abre. O gargalo da tela vinha daí: para escopo
# insumos, o backend passava pelo _build_base completo, lendo Aging inteiro,
# d_produtos, SB8, compras, MPS, BOM e faturamento. Aqui montamos só os
# componentes reais da BOM, mantendo a regra validada de quarentena 98.
_BUILD_INSUMOS_FAST_CACHE: Dict[str, Any] = {
    "key": None,
    "created_at": 0.0,
    "data": None,
}
_BUILD_INSUMOS_FAST_CACHE_LOCK = Lock()


def _buscar_consumo_latest_por_codigos(codigos: List[str]) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """Busca o último snapshot da posição/Aging somente para os códigos pedidos."""
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)})
    snapshot = _latest_consumo_snapshot()
    if not codigos_norm:
        return [], snapshot

    rows: List[Dict[str, Any]] = []
    for chunk in _chunks_lista(codigos_norm, 400):
        try:
            query = supabase.table("f_consumo_materiais").select("*").in_("codigo", chunk)
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            # Mesmo desempate determinístico das outras buscas de consumo:
            # ver comentário em _buscar_posicao_estoque_latest_por_codigos.
            query = query.order("id", desc=True)
            rows.extend(_select_all(query))
        except Exception:
            continue

    return rows, snapshot


def _classificacao_bom_from_componentes_info(
    componentes_bom_info: Dict[str, Dict[str, Any]],
    codigos: List[str],
) -> Dict[str, Dict[str, Any]]:
    """Monta classificação BOM sem recalcular a estrutura inteira."""
    resultado: Dict[str, Dict[str, Any]] = {}
    for codigo in sorted({_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}):
        comp_info = (componentes_bom_info or {}).get(codigo)
        if not comp_info:
            continue
        linhas_bom = comp_info.get("linhas_bom") or []
        classificacao = _classificacao_bom_dict_from_linhas(linhas_bom)
        classificacao["pais_bom"] = comp_info.get("pais_bom") or []
        classificacao["qtd_pais_bom"] = comp_info.get("qtd_pais_bom") or 0
        classificacao["linha_bom"] = comp_info.get("linha_bom")
        classificacao["tipo_negocio_bom"] = comp_info.get("tipo_negocio_bom")
        classificacao["macro_negocio_bom"] = comp_info.get("macro_negocio_bom")
        classificacao["grupo_gerencial_bom"] = comp_info.get("grupo_gerencial_bom")
        classificacao["tp"] = comp_info.get("tp")
        classificacao["tipo_componente_bom"] = comp_info.get("tp")
        classificacao["descricao_comp"] = comp_info.get("descricao_comp")
        resultado[codigo] = classificacao
    return resultado


def _item_estoque_deve_entrar_em_insumos_consulta(item: Dict[str, Any]) -> bool:
    """
    Inclui na tela de Insumos itens reais da posição de estoque/Aging, mesmo
    quando ainda não estão classificados na BOM.

    Essa regra é para a listagem operacional ficar completa. Ela não transforma
    PA/MR/PPS em insumo; primeiro excluímos produtos acabados/revenda. Depois
    aceitamos MP/ME/MI/MP/ME e itens sem classificação que tenham saldo,
    quarentena, entrada, consumo ou demanda.
    """
    if not item:
        return False

    if _item_eh_intermediario_pi(item):
        return False

    if _item_eh_produto_estoque(item):
        return False

    tipo_norm = _tipo_item_norm(item)
    if tipo_norm in {"PA", "MR", "PPS", "PV", "PA/MR"}:
        return False

    origem_linha = str(item.get("origem_linha_estoque") or "").strip()
    tem_posicao = bool(item.get("tem_posicao_aging")) or origem_linha == "f_consumo_materiais"

    tem_movimento_ou_saldo = any(_to_float(item.get(campo)) > 0 for campo in [
        "saldo",
        "saldo_quarentena",
        "quarentena",
        "qtd_pedidos_abertos",
        "entradas_previstas",
        "consumo_mes_atual",
        "demanda_mes_atual",
        "media_3m",
        "media_6m",
        "media_9m",
        "maior_media",
    ])

    if tipo_norm in {"MP", "ME", "MI", "MP/ME"}:
        return tem_posicao or tem_movimento_ou_saldo

    # Bases antigas podem vir com tipo vazio/A classificar. Se existe posição de
    # estoque e não foi classificado como produto acabado, mantém na consulta de
    # Insumos para não esconder código real do estoque.
    if tipo_norm in {"", "A CLASSIFICAR", "A_CLASSIFICAR", "VALIDAR", "SEM CLASSIFICACAO", "SEM CLASSIFICAÇÃO"}:
        return tem_posicao and tem_movimento_ou_saldo

    return False


def _build_insumos_fast_busca(busca: Optional[str]) -> Dict[str, Any]:
    """
    Monta a base de Insumos sem passar pelo build completo de PA/MR.

    Mantém:
    - universo oficial de insumos via BOM;
    - saldo/consumo do último Aging quando existir;
    - Quarentena 98 via SB8;
    - entradas previstas via compras abertas/FUP;
    - demanda do mês/futura via MRP/BOM.
    """
    termo_raw = str(busca or "").strip()
    termo_norm = _texto_busca_fast_norm(termo_raw)
    termo_codigo = _normalizar_codigo(termo_raw) if re.sub(r"\D", "", termo_raw) else ""

    componentes_bom_info_all = _buscar_componentes_bom_info()
    rows_consumo_all, snapshot_consumo = _buscar_consumo_latest()

    def bate_busca_codigo_texto(codigo: Any, *textos: Any) -> bool:
        codigo_norm = _normalizar_codigo(codigo)

        if termo_codigo and codigo_norm == termo_codigo:
            return True

        texto_item = _texto_busca_fast_norm(" ".join([codigo_norm, *[str(t or "") for t in textos]]))
        if termo_norm and termo_norm in texto_item:
            return True

        # Permite busca por pedaços numéricos sem exigir zero à esquerda.
        if termo_codigo and codigo_norm and termo_codigo in codigo_norm:
            return True

        return False

    codigos_match: set[str] = set()

    for row in rows_consumo_all or []:
        codigo = _normalizar_codigo(row.get("codigo"))
        if not codigo:
            continue
        if bate_busca_codigo_texto(
            codigo,
            row.get("produto"),
            row.get("descricao"),
            row.get("desc_produto"),
            row.get("grupo"),
            row.get("familia"),
            row.get("grupo_gerencial"),
        ):
            codigos_match.add(codigo)

    for codigo, comp_info in (componentes_bom_info_all or {}).items():
        codigo_norm = _normalizar_codigo(codigo or comp_info.get("codigo"))
        if not codigo_norm:
            continue
        if bate_busca_codigo_texto(
            codigo_norm,
            comp_info.get("descricao_comp"),
            comp_info.get("tp"),
            comp_info.get("linha_bom"),
            comp_info.get("grupo_gerencial_bom"),
            " ".join(comp_info.get("pais_bom") or []),
        ):
            codigos_match.add(codigo_norm)

    rows_consumo = [
        row for row in (rows_consumo_all or [])
        if _normalizar_codigo(row.get("codigo")) in codigos_match
    ]
    componentes_bom_info = {
        codigo: comp_info
        for codigo, comp_info in (componentes_bom_info_all or {}).items()
        if _normalizar_codigo(codigo or comp_info.get("codigo")) in codigos_match
    }

    # Se a busca não encontrou nada, devolve base vazia rapidamente.
    if termo_raw and not codigos_match:
        return {
            "snapshot_consumo": snapshot_consumo,
            "snapshot_mrp": None,
            "snapshot_parametros": None,
            "qtd_linhas_consumo_snapshot": 0,
            "qtd_linhas_d_produtos_adicionadas": 0,
            "qtd_d_produtos_relevantes_carregados": 0,
            "qtd_componentes_bom": 0,
            "itens": [],
            "fastpath": "insumos_busca_direta_v25_sem_match",
        }

    rows = _mesclar_consumo_com_componentes_bom(rows_consumo, componentes_bom_info)

    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})
    produtos_all = _buscar_d_produtos_por_codigos(codigos)

    # Insumos: saldo disponível somente no armazém 01. Outros armazéns
    # permanecem rastreáveis, mas não entram em Estoque atual.
    rows = _aplicar_saldo_insumos_somente_armazem_01(rows, produtos_all)

    # Quarentena continua separada e vem apenas do armazém 98.
    rows = _aplicar_quarentena_sb8_98_em_todos_os_itens(rows, produtos_all)

    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})

    compras_raw = _buscar_compras_resumido(codigos)
    entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
        codigos,
        rows,
        produtos_all,
        mapa_pa_pi_bravi={},
        liberacoes_pa_rows=[],
    )
    compras = _combinar_entradas_previstas_por_tipo(
        codigos,
        rows,
        produtos_all,
        compras_raw,
        {},
        mapa_pa_pi_bravi={},
        saldos_pi_bravi={},
    )

    parametros, snapshot_parametros = _buscar_parametros_estoque(codigos)
    custos = _buscar_custos_unitarios(codigos)
    demanda_mes = _buscar_demanda_mes_atual(codigos)
    forecast_futuro = _buscar_forecast_futuro_por_codigo(codigos, produtos_all=produtos_all)
    classificacao_bom = _classificacao_bom_from_componentes_info(componentes_bom_info, codigos)

    itens: List[Dict[str, Any]] = []
    for row in rows:
        item = _montar_item_base(
            row,
            compras,
            parametros,
            custos,
            demanda_mes,
            produtos_all,
            {},
            classificacao_bom,
            forecast_futuro,
            entradas_previstas_serie_por_codigo,
            {},
        )

        codigo_item = _normalizar_codigo(item.get("codigo"))
        comp_info = componentes_bom_info.get(codigo_item) or {}

        # Itens que vieram do snapshot de estoque, mas ainda não estão na BOM ou
        # dimensão, continuam aparecendo na listagem de Insumos como ESTOQUE.
        # Isso evita esconder códigos reais do SB8/Aging na busca operacional.
        if not comp_info and item.get("origem_classificacao") == "NAO_CLASSIFICADO":
            if _item_estoque_deve_entrar_em_insumos_consulta(item):
                item["origem_classificacao"] = "ESTOQUE"
                item["item_mapeado"] = True
                if not _eh_classificado(item.get("grupo_gerencial")):
                    item["grupo_gerencial"] = "Insumos - Estoque/Aging"
                if not _eh_classificado(item.get("modelo_fornecimento")):
                    item["modelo_fornecimento"] = "Insumo com posição de estoque"

        item["entradas_previstas_serie"] = entradas_previstas_serie_por_codigo.get(codigo_item) or []
        item["pedidos_futuros_por_mes"] = item["entradas_previstas_serie"]
        item["faturamento_sd2"] = []
        item["historico_6m"] = []
        item["historico_faturado_sop"] = []
        item["total_6m"] = 0.0
        item["valor_6m"] = 0.0

        item["eh_componente_bom"] = bool(comp_info)
        item["qtd_pais_bom"] = int(comp_info.get("qtd_pais_bom") or 0)
        item["tipo_componente_bom"] = comp_info.get("tp")
        item["eh_intermediario_pi"] = _item_eh_intermediario_pi(item)
        item["excluido_escopo_insumos"] = bool(item.get("eh_intermediario_pi"))
        item["motivo_exclusao_escopo_insumos"] = (
            "PI/produto intermediário não compõe a visão operacional de Insumos"
            if item.get("eh_intermediario_pi") else None
        )
        item["descricao_componente_bom"] = comp_info.get("descricao_comp")
        item["pais_bom"] = comp_info.get("pais_bom") or []
        item["linhas_bom"] = comp_info.get("linhas_bom") or []
        item["linha_bom"] = comp_info.get("linha_bom")

        linha_bom = str(comp_info.get("linha_bom") or "").strip()
        if linha_bom and linha_bom != "A classificar":
            item["tipo_negocio"] = linha_bom
            item["macro_negocio"] = linha_bom
            item["familia"] = linha_bom
            item["segmento"] = linha_bom
            item["grupo_gerencial"] = comp_info.get("grupo_gerencial_bom") or (
                "Insumos - Compartilhados" if linha_bom == "Compartilhado" else f"Insumos - {linha_bom}"
            )
            item["modelo_fornecimento"] = (
                "Insumo de produção compartilhado" if linha_bom == "Compartilhado" else "Insumo de produção"
            )
            item["origem_classificacao"] = "BOM"

        item["status_visual"] = _status_visual_item(item)
        if _item_eh_insumo_estoque(item):
            itens.append(item)

    itens.sort(
        key=lambda x: (
            x.get("status") != "RUPTURA",
            x.get("status") != "CRITICO",
            x.get("cobertura_futura_dias", 0),
            str(x.get("codigo") or ""),
        )
    )

    return {
        "snapshot_consumo": snapshot_consumo,
        "snapshot_mrp": snapshot_parametros,
        "snapshot_parametros": snapshot_parametros,
        "qtd_linhas_consumo_snapshot": len(rows_consumo or []),
        "qtd_linhas_d_produtos_adicionadas": max(0, len(rows) - len(rows_consumo or [])),
        "qtd_d_produtos_relevantes_carregados": len(produtos_all),
        "qtd_componentes_bom": len(componentes_bom_info),
        "itens": itens,
        "fastpath": "insumos_busca_direta_v25",
    }





# ─── Hotfix v27: busca de insumos não pode depender do build completo ─────────
def _buscar_consumo_latest_por_busca_light_v27(busca: Optional[str], limite: int = 400) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Busca operacional para a tabela de Insumos.

    A versão anterior da busca lia todo o Aging e toda a BOM antes de filtrar.
    Em máquina/cache frio, a tela ficava presa em "Buscando itens da tabela".
    Aqui buscamos direto no último snapshot por código/descrição e limitamos o recorte.
    """
    termo = str(busca or "").strip()
    termo_norm = _texto_busca_fast_norm(termo)
    codigo_norm = _normalizar_codigo(termo) if re.sub(r"\D", "", termo) else ""
    snapshot = _latest_consumo_snapshot()

    if not termo:
        return [], snapshot

    por_codigo: Dict[str, Dict[str, Any]] = {}

    def add_rows(rows: List[Dict[str, Any]]):
        for row in rows or []:
            codigo = _normalizar_codigo(row.get("codigo"))
            if codigo and codigo not in por_codigo:
                por_codigo[codigo] = row

    def query_coluna_ilike(coluna: str, valor: str):
        if not valor:
            return
        try:
            query = supabase.table("f_consumo_materiais").select("*")
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            res = query.order("id", desc=True).ilike(coluna, f"%{valor}%").limit(limite).execute()
            add_rows(res.data or [])
        except Exception:
            # Algumas bases antigas podem não ter todos os campos de descrição.
            return

    def query_codigo_exato(codigo: str):
        if not codigo:
            return
        try:
            query = supabase.table("f_consumo_materiais").select("*")
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            res = query.order("id", desc=True).eq("codigo", codigo).limit(limite).execute()
            add_rows(res.data or [])
        except Exception:
            return

    if codigo_norm:
        query_codigo_exato(codigo_norm)

    # V_perf_2026_07_08: antes, cada coluna (codigo, produto, descricao,
    # desc_produto, grupo, familia, grupo_gerencial) virava uma chamada de
    # rede separada ao Supabase, em sequência — até 7 idas e voltas por busca.
    # Combinamos tudo numa única consulta com OR entre as colunas, cortando
    # para 1 chamada (mais a exata por código, que já é rápida/indexada).
    colunas_ilike: List[Tuple[str, str]] = []
    if codigo_norm:
        colunas_ilike.append(("codigo", codigo_norm.lstrip("0") or codigo_norm))
    for coluna in ["produto", "descricao", "desc_produto", "grupo", "familia", "grupo_gerencial"]:
        colunas_ilike.append((coluna, termo))

    or_filtro = ",".join(f"{coluna}.ilike.%{valor}%" for coluna, valor in colunas_ilike if valor)

    if or_filtro:
        try:
            query = supabase.table("f_consumo_materiais").select("*")
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            res = query.order("id", desc=True).or_(or_filtro).limit(limite).execute()
            add_rows(res.data or [])
        except Exception:
            # Fallback: se o .or_ falhar (ex.: base antiga sem alguma coluna),
            # volta pro caminho coluna a coluna, mais lento porém mais tolerante.
            for coluna, valor in colunas_ilike:
                query_coluna_ilike(coluna, valor)

    # Fallback controlado: se o banco não aceitou ilike em nenhuma coluna,
    # lê o snapshot e filtra em Python, mas para no limite para não travar.
    if not por_codigo:
        try:
            query = supabase.table("f_consumo_materiais").select("*")
            if snapshot:
                query = query.eq("data_snapshot", snapshot)
            query = query.order("id", desc=True)
            rows = _select_all(query)
            filtrados = []
            for row in rows or []:
                codigo = _normalizar_codigo(row.get("codigo"))
                texto = _texto_busca_fast_norm(" ".join([
                    codigo,
                    str(row.get("produto") or ""),
                    str(row.get("descricao") or ""),
                    str(row.get("desc_produto") or ""),
                    str(row.get("grupo") or ""),
                    str(row.get("familia") or ""),
                    str(row.get("grupo_gerencial") or ""),
                ]))
                if termo_norm and termo_norm in texto:
                    filtrados.append(row)
                    if len(filtrados) >= limite:
                        break
            add_rows(filtrados)
        except Exception:
            pass

    return list(por_codigo.values())[:limite], snapshot


def _buscar_componentes_bom_info_busca_light_v27(busca: Optional[str], codigos_base: Optional[List[str]] = None, limite: int = 500) -> Dict[str, Dict[str, Any]]:
    """Busca componentes da BOM só para o termo/códigos encontrados, sem atravessar a estrutura inteira.

    V_perf_2026_07_08: antes, isso fazia de 1 a 3 chamadas de rede separadas ao
    Supabase (.in_ + .ilike x2) a cada busca digitada na tela. Como a
    d_bom_estrutura já fica em cache local (_buscar_bom_estrutura_rows_raw,
    5 min de TTL, ~600 linhas — pequeno o suficiente pra filtrar em memória),
    filtramos aqui direto no cache, sem nenhuma ida à rede. Resultado idêntico,
    só sem o tempo de rede repetido.
    """
    termo = str(busca or "").strip()
    termo_norm = _texto_busca_fast_norm(termo)
    codigos_norm = sorted({_normalizar_codigo(c) for c in (codigos_base or []) if _normalizar_codigo(c)})
    codigos_set = set(codigos_norm)

    rows_coletadas: List[Dict[str, Any]] = []
    vistos = set()

    def add_rows(rows: List[Dict[str, Any]]):
        for row in rows or []:
            key = (
                _normalizar_codigo(row.get("codigo_pai")),
                _normalizar_codigo(row.get("codigo_comp")),
                str(row.get("descricao_comp") or ""),
            )
            if key in vistos:
                continue
            vistos.add(key)
            rows_coletadas.append(row)
            if len(rows_coletadas) >= limite:
                break

    try:
        todas_rows = _buscar_bom_estrutura_rows_raw()
    except Exception:
        todas_rows = []

    if codigos_set:
        add_rows([r for r in todas_rows if _normalizar_codigo(r.get("codigo_comp")) in codigos_set])

    if termo and len(rows_coletadas) < limite:
        candidatas = [
            r for r in todas_rows
            if termo_norm in _texto_busca_fast_norm(str(r.get("codigo_comp") or ""))
            or termo_norm in _texto_busca_fast_norm(str(r.get("descricao_comp") or ""))
        ]
        add_rows(candidatas)

    componentes: Dict[str, Dict[str, Any]] = {}
    for row in rows_coletadas:
        comp = _normalizar_codigo(row.get("codigo_comp"))
        pai = _normalizar_codigo(row.get("codigo_pai"))
        if not comp:
            continue

        linha = _linha_bom_from_texto(" ".join([
            str(row.get("tipo_pai") or ""),
            str(row.get("descricao_pai") or ""),
        ])) or "A classificar"

        atual = componentes.setdefault(comp, {
            "codigo": comp,
            "descricao_comp": row.get("descricao_comp"),
            "tp": row.get("tp"),
            "pais_bom": [],
            "linhas_bom": [],
            "qtd_pais_bom": 0,
            "linha_bom": linha,
            "tipo_negocio_bom": linha,
            "macro_negocio_bom": linha,
            "grupo_gerencial_bom": "Insumos - Estoque/Aging" if linha == "A classificar" else f"Insumos - {linha}",
        })

        if pai and pai not in atual["pais_bom"]:
            atual["pais_bom"].append(pai)
        if linha and linha not in atual["linhas_bom"]:
            atual["linhas_bom"].append(linha)

        atual["qtd_pais_bom"] = len(atual["pais_bom"])
        if len(set(atual["linhas_bom"]) - {"A classificar"}) > 1:
            atual["linha_bom"] = "Compartilhado"
            atual["tipo_negocio_bom"] = "Compartilhado"
            atual["macro_negocio_bom"] = "Compartilhado"
            atual["grupo_gerencial_bom"] = "Insumos - Compartilhados"
        elif atual["linhas_bom"]:
            linha_final = next((l for l in atual["linhas_bom"] if l != "A classificar"), atual["linhas_bom"][0])
            atual["linha_bom"] = linha_final
            atual["tipo_negocio_bom"] = linha_final
            atual["macro_negocio_bom"] = linha_final
            atual["grupo_gerencial_bom"] = "Insumos - Estoque/Aging" if linha_final == "A classificar" else f"Insumos - {linha_final}"

    return componentes


def _build_insumos_fast_busca_light_v27(busca: Optional[str]) -> Dict[str, Any]:
    """
    Busca rápida para a tabela de Insumos.

    Importante: esta rotina é usada somente quando há termo de busca/filtro por texto.
    Ela prioriza abrir a tela rápido. O detalhe do item continua buscando a série completa
    quando a linha é selecionada.
    """
    termo_raw = str(busca or "").strip()
    termo_norm = _texto_busca_fast_norm(termo_raw)

    # Se a máquina já tem cache quente, filtra em memória: caminho ideal.
    cached = _BUILD_INSUMOS_FAST_CACHE.get("data")
    if isinstance(cached, dict) and cached.get("itens"):
        itens_cache = _filtrar_itens(cached.get("itens") or [], busca=termo_raw, classificacao_cadastro="MAPEADOS")
        if itens_cache:
            retorno = dict(cached)
            retorno["itens"] = itens_cache
            retorno["fastpath"] = "insumos_busca_cache_quente_v27"
            return retorno

    rows_consumo, snapshot_consumo = _buscar_consumo_latest_por_busca_light_v27(termo_raw)
    codigos_consumo = sorted({_normalizar_codigo(r.get("codigo")) for r in rows_consumo if _normalizar_codigo(r.get("codigo"))})
    componentes_bom_info = _buscar_componentes_bom_info_busca_light_v27(termo_raw, codigos_consumo)

    # Consolida códigos encontrados em Aging + BOM direta.
    codigos_match = sorted(set(codigos_consumo) | {_normalizar_codigo(c) for c in componentes_bom_info.keys() if _normalizar_codigo(c)})

    if termo_raw and not codigos_match:
        return {
            "snapshot_consumo": snapshot_consumo,
            "snapshot_mrp": None,
            "snapshot_parametros": None,
            "qtd_linhas_consumo_snapshot": 0,
            "qtd_linhas_d_produtos_adicionadas": 0,
            "qtd_d_produtos_relevantes_carregados": 0,
            "qtd_componentes_bom": 0,
            "itens": [],
            "fastpath": "insumos_busca_light_v27_sem_match",
        }

    rows = _mesclar_consumo_com_componentes_bom(rows_consumo, componentes_bom_info)
    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})
    produtos_all = _buscar_d_produtos_por_codigos(codigos)

    # Insumos: saldo disponível somente no armazém 01. Outros armazéns
    # permanecem rastreáveis, mas não entram em Estoque atual.
    rows = _aplicar_saldo_insumos_somente_armazem_01(rows, produtos_all)

    # Quarentena continua separada e vem apenas do armazém 98.
    rows = _aplicar_quarentena_sb8_98_em_todos_os_itens(rows, produtos_all)
    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})

    compras_raw = _buscar_compras_resumido(codigos)
    entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
        codigos,
        rows,
        produtos_all,
        mapa_pa_pi_bravi={},
        liberacoes_pa_rows=[],
    )
    compras = _combinar_entradas_previstas_por_tipo(
        codigos,
        rows,
        produtos_all,
        compras_raw,
        {},
        mapa_pa_pi_bravi={},
        saldos_pi_bravi={},
    )
    parametros, snapshot_parametros = _buscar_parametros_estoque(codigos)
    custos = _buscar_custos_unitarios(codigos)

    # Busca rápida com termo: calcula demanda somente para os códigos do recorte.
    # Antes esta rotina zerava demanda_mes/forecast_futuro para não pesar a abertura
    # da tela. Isso fazia itens encontrados pela busca, como 71991, aparecerem com
    # Previsão mês = 0 na tabela, embora o detalhe/linha verde já mostrasse a
    # Demanda MPS/BOM correta. Como aqui o universo já está reduzido pelo termo
    # pesquisado, é seguro explodir MPS/BOM apenas desses códigos.
    demanda_mes = _buscar_demanda_mes_atual(codigos)
    forecast_futuro = _buscar_forecast_futuro_por_codigo(codigos, produtos_all=produtos_all)
    classificacao_bom = _classificacao_bom_from_componentes_info(componentes_bom_info, codigos)

    itens: List[Dict[str, Any]] = []
    for row in rows:
        item = _montar_item_base(
            row,
            compras,
            parametros,
            custos,
            demanda_mes,
            produtos_all,
            {},
            classificacao_bom,
            forecast_futuro,
            entradas_previstas_serie_por_codigo,
            {},
        )

        codigo_item = _normalizar_codigo(item.get("codigo"))
        comp_info = componentes_bom_info.get(codigo_item) or {}

        if not comp_info and item.get("origem_classificacao") == "NAO_CLASSIFICADO":
            if _item_estoque_deve_entrar_em_insumos_consulta(item):
                item["origem_classificacao"] = "ESTOQUE"
                item["item_mapeado"] = True
                if not _eh_classificado(item.get("grupo_gerencial")):
                    item["grupo_gerencial"] = "Insumos - Estoque/Aging"
                if not _eh_classificado(item.get("modelo_fornecimento")):
                    item["modelo_fornecimento"] = "Insumo com posição de estoque"

        item["entradas_previstas_serie"] = entradas_previstas_serie_por_codigo.get(codigo_item) or []
        item["pedidos_futuros_por_mes"] = item["entradas_previstas_serie"]
        item["faturamento_sd2"] = []
        item["historico_6m"] = []
        item["historico_faturado_sop"] = []
        item["total_6m"] = 0.0
        item["valor_6m"] = 0.0
        item["eh_componente_bom"] = bool(comp_info)
        item["qtd_pais_bom"] = int(comp_info.get("qtd_pais_bom") or 0)
        item["tipo_componente_bom"] = comp_info.get("tp")
        item["eh_intermediario_pi"] = _item_eh_intermediario_pi(item)
        item["excluido_escopo_insumos"] = bool(item.get("eh_intermediario_pi"))
        item["motivo_exclusao_escopo_insumos"] = (
            "PI/produto intermediário não compõe a visão operacional de Insumos"
            if item.get("eh_intermediario_pi") else None
        )
        item["descricao_componente_bom"] = comp_info.get("descricao_comp")
        item["pais_bom"] = comp_info.get("pais_bom") or []
        item["linhas_bom"] = comp_info.get("linhas_bom") or []
        item["linha_bom"] = comp_info.get("linha_bom")

        linha_bom = str(comp_info.get("linha_bom") or "").strip()
        if linha_bom and linha_bom != "A classificar":
            item["tipo_negocio"] = linha_bom
            item["macro_negocio"] = linha_bom
            item["familia"] = linha_bom
            item["segmento"] = linha_bom
            item["grupo_gerencial"] = comp_info.get("grupo_gerencial_bom") or (
                "Insumos - Compartilhados" if linha_bom == "Compartilhado" else f"Insumos - {linha_bom}"
            )
            item["modelo_fornecimento"] = (
                "Insumo de produção compartilhado" if linha_bom == "Compartilhado" else "Insumo de produção"
            )
            item["origem_classificacao"] = "BOM"

        item["status_visual"] = _status_visual_item(item)

        # Filtra novamente em Python para garantir que fallback amplo não traga ruído.
        texto_item = _texto_busca_fast_norm(" ".join([
            str(item.get("codigo") or ""),
            str(item.get("produto") or ""),
            str(item.get("descricao_componente_bom") or ""),
            str(item.get("grupo_gerencial") or ""),
            str(item.get("tipo_negocio") or ""),
        ]))
        if termo_norm and termo_norm not in texto_item:
            continue

        if _item_eh_insumo_estoque(item):
            itens.append(item)

    itens.sort(key=lambda x: (str(x.get("codigo") or ""), str(x.get("produto") or "")))

    return {
        "snapshot_consumo": snapshot_consumo,
        "snapshot_mrp": snapshot_parametros,
        "snapshot_parametros": snapshot_parametros,
        "qtd_linhas_consumo_snapshot": len(rows_consumo or []),
        "qtd_linhas_d_produtos_adicionadas": max(0, len(rows) - len(rows_consumo or [])),
        "qtd_d_produtos_relevantes_carregados": len(produtos_all),
        "qtd_componentes_bom": len(componentes_bom_info),
        "itens": itens,
        "fastpath": "insumos_busca_light_v27_sem_build_completo",
    }



def _build_insumos_fast() -> Dict[str, Any]:
    """
    Monta a base de Insumos sem passar pelo build completo de PA/MR.

    Mantém:
    - universo oficial de insumos via BOM;
    - saldo/consumo do último Aging quando existir;
    - Quarentena 98 via SB8;
    - entradas previstas via compras abertas/FUP;
    - demanda do mês/futura via MRP/BOM.
    """
    componentes_bom_info = _buscar_componentes_bom_info()

    # Correção v22:
    # O fast path anterior buscava posição/Aging apenas dos códigos presentes
    # na BOM. Isso deixava a tela rápida, mas escondia itens que existem no
    # estoque e ainda não estão amarrados na estrutura/cadastro gerencial.
    # Para a Gestão de Estoque, a listagem precisa ser completa: parte do último
    # snapshot de posição e adiciona componentes da BOM que não aparecerem no
    # snapshot. Assim buscas como "tubete" mostram todos os códigos em estoque.
    rows_consumo, snapshot_consumo = _buscar_consumo_latest()
    rows = _mesclar_consumo_com_componentes_bom(rows_consumo, componentes_bom_info)

    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})
    produtos_all = _buscar_d_produtos_por_codigos(codigos)

    # Insumos: saldo disponível somente no armazém 01. Outros armazéns
    # permanecem rastreáveis, mas não entram em Estoque atual.
    rows = _aplicar_saldo_insumos_somente_armazem_01(rows, produtos_all)

    # Quarentena continua separada e vem apenas do armazém 98.
    rows = _aplicar_quarentena_sb8_98_em_todos_os_itens(rows, produtos_all)

    codigos = sorted({_normalizar_codigo(r.get("codigo")) for r in rows if _normalizar_codigo(r.get("codigo"))})

    compras_raw = _buscar_compras_resumido(codigos)
    entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
        codigos,
        rows,
        produtos_all,
        mapa_pa_pi_bravi={},
        liberacoes_pa_rows=[],
    )
    compras = _combinar_entradas_previstas_por_tipo(
        codigos,
        rows,
        produtos_all,
        compras_raw,
        {},
        mapa_pa_pi_bravi={},
        saldos_pi_bravi={},
    )

    parametros, snapshot_parametros = _buscar_parametros_estoque(codigos)
    custos = _buscar_custos_unitarios(codigos)
    demanda_mes = _buscar_demanda_mes_atual(codigos)
    forecast_futuro = _buscar_forecast_futuro_por_codigo(codigos, produtos_all=produtos_all)
    classificacao_bom = _classificacao_bom_from_componentes_info(componentes_bom_info, codigos)

    itens: List[Dict[str, Any]] = []
    for row in rows:
        item = _montar_item_base(
            row,
            compras,
            parametros,
            custos,
            demanda_mes,
            produtos_all,
            {},
            classificacao_bom,
            forecast_futuro,
            entradas_previstas_serie_por_codigo,
            {},
        )

        codigo_item = _normalizar_codigo(item.get("codigo"))
        comp_info = componentes_bom_info.get(codigo_item) or {}

        # Itens que vieram do snapshot de estoque, mas ainda não estão na BOM ou
        # dimensão, continuam aparecendo na listagem de Insumos como ESTOQUE.
        # Isso evita esconder códigos reais do SB8/Aging na busca operacional.
        if not comp_info and item.get("origem_classificacao") == "NAO_CLASSIFICADO":
            if _item_estoque_deve_entrar_em_insumos_consulta(item):
                item["origem_classificacao"] = "ESTOQUE"
                item["item_mapeado"] = True
                if not _eh_classificado(item.get("grupo_gerencial")):
                    item["grupo_gerencial"] = "Insumos - Estoque/Aging"
                if not _eh_classificado(item.get("modelo_fornecimento")):
                    item["modelo_fornecimento"] = "Insumo com posição de estoque"

        item["entradas_previstas_serie"] = entradas_previstas_serie_por_codigo.get(codigo_item) or []
        item["pedidos_futuros_por_mes"] = item["entradas_previstas_serie"]
        item["faturamento_sd2"] = []
        item["historico_6m"] = []
        item["historico_faturado_sop"] = []
        item["total_6m"] = 0.0
        item["valor_6m"] = 0.0

        item["eh_componente_bom"] = bool(comp_info)
        item["qtd_pais_bom"] = int(comp_info.get("qtd_pais_bom") or 0)
        item["tipo_componente_bom"] = comp_info.get("tp")
        item["eh_intermediario_pi"] = _item_eh_intermediario_pi(item)
        item["excluido_escopo_insumos"] = bool(item.get("eh_intermediario_pi"))
        item["motivo_exclusao_escopo_insumos"] = (
            "PI/produto intermediário não compõe a visão operacional de Insumos"
            if item.get("eh_intermediario_pi") else None
        )
        item["descricao_componente_bom"] = comp_info.get("descricao_comp")
        item["pais_bom"] = comp_info.get("pais_bom") or []
        item["linhas_bom"] = comp_info.get("linhas_bom") or []
        item["linha_bom"] = comp_info.get("linha_bom")

        linha_bom = str(comp_info.get("linha_bom") or "").strip()
        if linha_bom and linha_bom != "A classificar":
            item["tipo_negocio"] = linha_bom
            item["macro_negocio"] = linha_bom
            item["familia"] = linha_bom
            item["segmento"] = linha_bom
            item["grupo_gerencial"] = comp_info.get("grupo_gerencial_bom") or (
                "Insumos - Compartilhados" if linha_bom == "Compartilhado" else f"Insumos - {linha_bom}"
            )
            item["modelo_fornecimento"] = (
                "Insumo de produção compartilhado" if linha_bom == "Compartilhado" else "Insumo de produção"
            )
            item["origem_classificacao"] = "BOM"

        item["status_visual"] = _status_visual_item(item)
        if _item_eh_insumo_estoque(item):
            itens.append(item)

    itens.sort(
        key=lambda x: (
            x.get("status") != "RUPTURA",
            x.get("status") != "CRITICO",
            x.get("cobertura_futura_dias", 0),
            str(x.get("codigo") or ""),
        )
    )

    return {
        "snapshot_consumo": snapshot_consumo,
        "snapshot_mrp": snapshot_parametros,
        "snapshot_parametros": snapshot_parametros,
        "qtd_linhas_consumo_snapshot": len(rows_consumo or []),
        "qtd_linhas_d_produtos_adicionadas": max(0, len(rows) - len(rows_consumo or [])),
        "qtd_d_produtos_relevantes_carregados": len(produtos_all),
        "qtd_componentes_bom": len(componentes_bom_info),
        "itens": itens,
        "fastpath": "insumos_componentes_bom_sem_build_pa_mr",
    }


def _build_insumos_fast_cached(force_refresh: bool = False) -> Dict[str, Any]:
    try:
        snapshot_consumo = _latest_consumo_snapshot() or "sem_posicao"
    except Exception:
        snapshot_consumo = "sem_posicao"

    try:
        snapshot_sb8 = _latest_sb8_snapshot() or "sem_sb8"
    except Exception:
        snapshot_sb8 = "sem_sb8"

    try:
        marker_mps = _latest_mps_cache_marker()
    except Exception:
        marker_mps = "sem_mps"

    try:
        marker_parametros = _latest_parametros_estoque_atualizacao() or "sem_parametros"
    except Exception:
        marker_parametros = "sem_parametros"

    cache_key = f"{VERSAO_AGING_ESTOQUE}|insumos_fast|posicao:{snapshot_consumo}|sb8:{snapshot_sb8}|mps:{marker_mps}|param:{marker_parametros}|{date.today().isoformat()}"
    now = time.time()

    cached_key = _BUILD_INSUMOS_FAST_CACHE.get("key")
    cached_at = float(_BUILD_INSUMOS_FAST_CACHE.get("created_at") or 0)
    cached_data = _BUILD_INSUMOS_FAST_CACHE.get("data")

    if _cache_base_valido(cached_data, cached_key, cache_key, cached_at, now=now, force_refresh=force_refresh):
        return cached_data

    with _BUILD_INSUMOS_FAST_CACHE_LOCK:
        now = time.time()
        cached_key = _BUILD_INSUMOS_FAST_CACHE.get("key")
        cached_at = float(_BUILD_INSUMOS_FAST_CACHE.get("created_at") or 0)
        cached_data = _BUILD_INSUMOS_FAST_CACHE.get("data")

        if _cache_base_valido(cached_data, cached_key, cache_key, cached_at, now=now, force_refresh=force_refresh):
            return cached_data

        base = _build_insumos_fast()
        _BUILD_INSUMOS_FAST_CACHE["key"] = cache_key
        _BUILD_INSUMOS_FAST_CACHE["created_at"] = now
        _BUILD_INSUMOS_FAST_CACHE["data"] = base
        return base



# ─── Fast path PA/MR oficial ─────────────────────────────────────────────────
# Depois que a d_produtos virou uma dimensão mestre completa, o Dashboard PA/MR
# não deve montar a base inteira de insumos/Aging/BOM. Para o escopo produtos,
# usamos somente os SKUs oficiais com ativo_analise=True na Dimensão Produtos.
_BUILD_PRODUTOS_FAST_CACHE: Dict[str, Any] = {
    "key": None,
    "created_at": 0.0,
    "data": None,
}
_BUILD_PRODUTOS_FAST_CACHE_LOCK = Lock()


def _buscar_demanda_mes_atual_produtos_fast(codigos: List[str]) -> Dict[str, Dict[str, Any]]:
    """Demanda direta do mês atual para PA/MR sem explosão BOM/MRP."""
    codigos_set = {_normalizar_codigo(c) for c in (codigos or []) if _normalizar_codigo(c)}
    hoje = date.today()
    demanda = {
        codigo: {
            "demanda_direta_mes_atual": 0.0,
            "demanda_bom_mes_atual": 0.0,
            "origem_demanda_bom": "forecast_direto_pa_mr_fastpath",
            "debug_programacao_v1": {
                "fonte_demanda": "forecast_direto_pa_mr_fastpath",
                "tabela": "f_forecast_sop",
                "qtd_linhas_normalizadas": 0,
                "mes_base": f"{hoje.year}-{str(hoje.month).zfill(2)}",
            },
        }
        for codigo in codigos_set
    }

    if not codigos_set:
        return demanda

    try:
        rows = _buscar_forecast_sop_rows(hoje.year, hoje.month)
    except Exception:
        rows = []

    qtd_linhas = 0
    for row in rows or []:
        codigo = _normalizar_codigo(row.get("cod_produto"))
        if codigo not in codigos_set:
            continue
        qtd = _to_float(row.get("qtd_forecast"))
        demanda[codigo]["demanda_direta_mes_atual"] += qtd
        qtd_linhas += 1

    for codigo in demanda:
        demanda[codigo]["debug_programacao_v1"]["qtd_linhas_normalizadas"] = qtd_linhas

    return demanda


def _texto_busca_fast_norm(value: Any) -> str:
    texto = str(value or "").strip().upper()
    if not texto:
        return ""
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(ch for ch in texto if unicodedata.category(ch) != "Mn")
    texto = re.sub(r"[^A-Z0-9]+", " ", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def _buscar_produtos_ativos_por_busca_fast(busca: Optional[str]) -> Dict[str, dict]:
    """
    Filtra PA/MR oficiais por código/descrição sem montar a base inteira.

    Esta função lê apenas os produtos marcados como ativo_analise=True na
    d_produtos e reduz o universo antes de buscar SB8, compras, MPS/liberação,
    forecast e faturamento. Assim uma busca como "one step" não espera o build
    completo dos 177+ SKUs de PA/MR.
    """
    termo_raw = str(busca or "").strip()
    produtos_ativos = _buscar_d_produtos_ativos_analise()

    if not termo_raw:
        return produtos_ativos

    termo_norm = _texto_busca_fast_norm(termo_raw)
    termo_codigo = _normalizar_codigo(termo_raw) if re.sub(r"\D", "", termo_raw) else ""

    filtrados: Dict[str, dict] = {}
    for codigo, produto in produtos_ativos.items():
        codigo_norm = _normalizar_codigo(codigo or produto.get("cod_produto"))
        descricao = produto.get("desc_produto") or produto.get("descricao") or produto.get("produto") or ""
        concatenado = produto.get("concatenado_produto") or ""
        texto_item = _texto_busca_fast_norm(" ".join([codigo_norm, str(descricao), str(concatenado)]))

        if termo_codigo and codigo_norm == termo_codigo:
            filtrados[codigo_norm] = produto
            continue

        if termo_norm and termo_norm in texto_item:
            filtrados[codigo_norm] = produto

    return filtrados


def _build_produtos_oficiais_fast_from_produtos(
    produtos_ativos: Dict[str, dict],
    fastpath_label: str = "pa_mr_oficial_ativo_analise",
) -> Dict[str, Any]:
    """Monta PA/MR oficiais para um universo já filtrado de produtos."""
    produtos_ativos = produtos_ativos or {}
    codigos = sorted(produtos_ativos.keys())

    rows = [
        _linha_consumo_sintetica_d_produtos(codigo, produto_dim)
        for codigo, produto_dim in produtos_ativos.items()
    ]

    # Fast path PA/MR/PPS: usa a posição de estoque mais recente como saldo
    # de fallback quando a última foto da SB8 não trouxer linha 04/07 para o SKU.
    # Isso mantém a regra: SB8 do dia 04/07 primeiro; posição do dia como fallback;
    # nunca buscar saldo 04/07 de uma data antiga.
    posicao_latest = _buscar_posicao_estoque_latest_por_codigos(codigos)
    for row in rows:
        codigo = _normalizar_codigo(row.get("codigo"))
        pos = posicao_latest.get(codigo) or {}
        if not pos:
            continue
        row["saldo"] = _to_float(pos.get("saldo"))
        row["__saldo_posicao_latest"] = _to_float(pos.get("saldo"))
        row["__data_posicao_latest"] = pos.get("data_snapshot")
        row["__tem_posicao_latest"] = True

    # Saldo oficial de PA/MR/PPS: SB8 código exato, 04/07 e quarentena 98.
    rows = _aplicar_saldo_sb8_exato_produtos_tela(rows, produtos_ativos)

    codigos_set = set(codigos)
    codigos_pi_bravi = sorted({
        _normalizar_codigo(pi)
        for pa, pis in BRAVI_PA_PI_STATIC_MAP.items()
        if pa in codigos_set
        for pi in (pis or [])
        if _normalizar_codigo(pi)
    })
    codigos_compra_consulta = sorted(set(codigos + codigos_pi_bravi))

    compras_raw = _buscar_compras_resumido(codigos_compra_consulta)
    mapa_pa_pi_bravi = _mapear_pa_para_pi_bravi(codigos, produtos_all=produtos_ativos, rows=rows)
    liberacoes_pa_rows = _buscar_liberacoes_previstas_pa_rows(codigos, produtos_all=produtos_ativos)
    liberacoes_pa = _resumir_liberacoes_previstas_pa_rows(liberacoes_pa_rows)
    saldos_pi_bravi = _buscar_saldo_pi_bravi_resumido(mapa_pa_pi_bravi)
    entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
        codigos,
        rows,
        produtos_ativos,
        mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        liberacoes_pa_rows=liberacoes_pa_rows,
    )
    compras = _combinar_entradas_previstas_por_tipo(
        codigos,
        rows,
        produtos_ativos,
        compras_raw,
        liberacoes_pa,
        mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        saldos_pi_bravi=saldos_pi_bravi,
    )

    parametros, snapshot_parametros = _buscar_parametros_estoque(codigos)
    custos = _buscar_custos_unitarios(codigos)
    demanda_mes = _buscar_demanda_mes_atual_produtos_fast(codigos)
    forecast_futuro = _buscar_forecast_futuro_por_codigo(codigos, produtos_all=produtos_ativos)
    vendas = _buscar_faturamento_ytd(codigos)
    faturamento_6m_por_codigo = _buscar_historico_operacional_ultimos_6m_por_codigo(codigos)

    itens: List[Dict[str, Any]] = []
    for row in rows:
        item = _montar_item_base(
            row,
            compras,
            parametros,
            custos,
            demanda_mes,
            produtos_ativos,
            vendas,
            {},
            forecast_futuro,
            entradas_previstas_serie_por_codigo,
            faturamento_6m_por_codigo,
        )
        codigo_item = _normalizar_codigo(item.get("codigo"))
        historico_6m = faturamento_6m_por_codigo.get(codigo_item, [])
        item["entradas_previstas_serie"] = entradas_previstas_serie_por_codigo.get(codigo_item) or []
        item["pedidos_futuros_por_mes"] = item["entradas_previstas_serie"]
        item["faturamento_sd2"] = historico_6m
        item["historico_6m"] = historico_6m
        item["historico_faturado_sop"] = historico_6m
        item["total_6m"] = _round(sum(_to_float(p.get("faturamento_qtd")) for p in historico_6m), 4)
        item["valor_6m"] = _round(sum(_to_float(p.get("faturamento_valor")) for p in historico_6m), 2)
        item["eh_componente_bom"] = False
        item["qtd_pais_bom"] = 0
        item["tipo_componente_bom"] = None
        item["descricao_componente_bom"] = None
        item["pais_bom"] = []
        item["status_visual"] = _status_visual_item(item)
        itens.append(item)

    itens.sort(
        key=lambda x: (
            str(x.get("status_portfolio") or ""),
            str(x.get("tipo_negocio") or ""),
            str(x.get("codigo") or ""),
        )
    )

    return {
        "snapshot_consumo": None,
        "snapshot_mrp": snapshot_parametros,
        "snapshot_parametros": snapshot_parametros,
        "qtd_linhas_consumo_snapshot": 0,
        "qtd_linhas_d_produtos_adicionadas": len(itens),
        "qtd_d_produtos_relevantes_carregados": len(produtos_ativos),
        "qtd_componentes_bom": 0,
        "itens": itens,
        "fastpath": fastpath_label,
    }


def _build_produtos_oficiais_fast() -> Dict[str, Any]:
    """
    Monta somente PA/MR oficiais para o Dashboard/Gestão de Produtos.

    Não lê f_consumo_materiais inteira, não explode BOM e não carrega 46k SKUs.
    Isso evita 502/timeout no Fly quando o usuário está no escopo PA/MR.
    """
    produtos_ativos = _buscar_d_produtos_ativos_analise()
    return _build_produtos_oficiais_fast_from_produtos(
        produtos_ativos,
        fastpath_label="pa_mr_oficial_ativo_analise",
    )

def _build_produtos_oficiais_fast_cached(force_refresh: bool = False) -> Dict[str, Any]:
    try:
        sb8_snapshot = _latest_sb8_snapshot() or "sem_sb8"
    except Exception:
        sb8_snapshot = "sem_sb8"
    try:
        posicao_snapshot = _latest_consumo_snapshot() or "sem_posicao"
    except Exception:
        posicao_snapshot = "sem_posicao"

    try:
        marker_mps = _latest_mps_cache_marker()
    except Exception:
        marker_mps = "sem_mps"

    cache_key = f"{VERSAO_AGING_ESTOQUE}|pa_mr_oficial|sb8:{sb8_snapshot}|posicao:{posicao_snapshot}|mps:{marker_mps}|{date.today().isoformat()}"
    now = time.time()

    cached_key = _BUILD_PRODUTOS_FAST_CACHE.get("key")
    cached_at = float(_BUILD_PRODUTOS_FAST_CACHE.get("created_at") or 0)
    cached_data = _BUILD_PRODUTOS_FAST_CACHE.get("data")

    if _cache_base_valido(
        cached_data,
        cached_key,
        cache_key,
        cached_at,
        now=now,
        force_refresh=force_refresh,
    ):
        return cached_data

    with _BUILD_PRODUTOS_FAST_CACHE_LOCK:
        now = time.time()
        cached_key = _BUILD_PRODUTOS_FAST_CACHE.get("key")
        cached_at = float(_BUILD_PRODUTOS_FAST_CACHE.get("created_at") or 0)
        cached_data = _BUILD_PRODUTOS_FAST_CACHE.get("data")

        if _cache_base_valido(
            cached_data,
            cached_key,
            cache_key,
            cached_at,
            now=now,
            force_refresh=force_refresh,
        ):
            return cached_data

        base = _build_produtos_oficiais_fast()
        _BUILD_PRODUTOS_FAST_CACHE["key"] = cache_key
        _BUILD_PRODUTOS_FAST_CACHE["created_at"] = now
        _BUILD_PRODUTOS_FAST_CACHE["data"] = base
        return base


def _base_por_escopo_para_endpoint(escopo: Optional[str], force_refresh: bool = False) -> tuple[Dict[str, Any], str]:
    escopo_norm = _normalizar_escopo_estoque(escopo)
    if escopo_norm == "produtos":
        return _build_produtos_oficiais_fast_cached(force_refresh=force_refresh), escopo_norm
    if escopo_norm == "insumos":
        return _build_insumos_fast_cached(force_refresh=force_refresh), escopo_norm
    # Para escopo=todos, mantém o cache completo. A tela operacional deve preferir
    # produtos/insumos para não disparar build pesado sem necessidade.
    return _build_base_cached(force_refresh=force_refresh), escopo_norm


@router.get("/bravi/serie")
def serie_bravi(
    granularidade: str = Query("mensal"),
):
    """
    Série operacional consolidada dos itens Bravi.

    Universo:
      - mesmo universo usado pela tabela da Gestão de Estoque:
        itens com transferencia_bravi = "Sim" na base atual.

    Séries retornadas:
      - estoque: f_estoque_saldo
      - entradas_previstas: f_compras_abertas
      - faturamento_qtd/faturamento_valor: f_sd2_saidas
      - consumo: f_consumo_materiais, somente mensal porque a base de consumo do Aging é mensal
    """
    try:
        granularidade_norm = _normalizar_granularidade(granularidade)
        base = _build_base_cached()
        ctx = _buscar_codigos_bravi_da_base(base)

        codigos = ctx["codigos"]
        itens_bravi = ctx["itens"]
        tipos_por_codigo = ctx["tipos_por_codigo"]

        rows_consumo, snapshot_consumo = _buscar_consumo_latest()
        codigos_set = set(codigos)
        rows_consumo_bravi = [
            row for row in rows_consumo
            if _normalizar_codigo(row.get("codigo")) in codigos_set
        ]

        estoque_serie = _buscar_estoque_periodo(
            codigos,
            tipos_por_codigo=tipos_por_codigo,
            granularidade=granularidade_norm,
        )
        compras_serie = _buscar_entradas_previstas_periodo_por_tipo(
            codigos,
            tipos_por_codigo=tipos_por_codigo,
            granularidade=granularidade_norm,
        )
        faturamento_serie = _buscar_faturamento_sd2_periodo(
            codigos,
            granularidade=granularidade_norm,
        )
        consumo_serie = _consumo_mensal_por_rows(
            rows_consumo_bravi,
            granularidade=granularidade_norm,
        )

        serie = _merge_series_periodo(
            estoque_serie,
            compras_serie,
            faturamento_serie,
            consumo_serie,
        )

        return {
            "granularidade": granularidade_norm,
            "data_snapshot_consumo": snapshot_consumo,
            "total_itens_bravi": len(itens_bravi),
            "codigos_bravi": codigos,
            "resumo": {
                "estoque_atual": _round(sum(_to_float(i.get("saldo")) for i in itens_bravi), 4),
                "pedidos_abertos": _round(sum(_to_float(i.get("qtd_pedidos_abertos")) for i in itens_bravi), 4),
                "faturamento_ytd_qtd": _round(sum(_to_float(i.get("faturamento_ytd_qtd")) for i in itens_bravi), 4),
                "faturamento_ytd_valor": _round(sum(_to_float(i.get("faturamento_ytd_valor")) for i in itens_bravi), 2),
                "criticos": sum(1 for i in itens_bravi if i.get("status") in {"RUPTURA", "CRITICO"}),
                "excesso": sum(1 for i in itens_bravi if i.get("status") == "EXCESSO"),
            },
            "serie": serie,
            "debug": {
                "qtd_estoque_pontos": len(estoque_serie),
                "qtd_compras_pontos": len(compras_serie),
                "qtd_faturamento_pontos": len(faturamento_serie),
                "qtd_consumo_pontos": len(consumo_serie),
                "observacao_consumo": (
                    "Consumo do Aging vem mensal em f_consumo_materiais; "
                    "por isso consumo diário/semanal não é preenchido neste endpoint."
                ),
            },
            "backend_versao": VERSAO_AGING_ESTOQUE,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))






@router.get("/produtos/serie")
def serie_produtos(
    granularidade: str = Query("mensal"),
    codigo: Optional[str] = Query(None),
):
    """
    Série operacional consolidada dos PA/MR/produtos da tela Gestão de Estoque.

    Compatível com o front atual:
      GET /aging-estoque/produtos/serie?granularidade=mensal

    Séries retornadas:
      - estoque: SB8/posição conforme regra do escopo de PA/MR;
      - entradas previstas: liberações previstas para PA e pedidos de compra para MR;
      - faturamento: SD2;
      - consumo: mantido por compatibilidade, mas não é o foco de PA/MR.
    """
    try:
        granularidade_norm = _normalizar_granularidade(granularidade)
        codigo_norm = _normalizar_codigo(codigo) if codigo else ""

        # Caminho rápido para série por item PA/MR.
        # Evita chamar /item/{codigo}, que monta detalhe completo e pode demorar muito.
        if codigo_norm:
            codigos = [codigo_norm]

            rows_consumo, snapshot_consumo = _buscar_consumo_latest()
            rows_consumo_item = [
                row for row in rows_consumo
                if _normalizar_codigo(row.get("codigo")) == codigo_norm
            ]

            produtos_all = _buscar_d_produtos(codigos, filtrar_por_codigos=True)
            row_ref = rows_consumo_item[0] if rows_consumo_item else {"codigo": codigo_norm}
            tipo = _tipo_produto_erp_por_codigo(codigo_norm, row=row_ref, produtos_all=produtos_all)
            tipos_por_codigo = {codigo_norm: tipo}

            estoque_serie = _buscar_estoque_periodo(
                codigos,
                tipos_por_codigo=tipos_por_codigo,
                granularidade=granularidade_norm,
            )
            compras_serie = _buscar_entradas_previstas_periodo_por_tipo(
                codigos,
                tipos_por_codigo=tipos_por_codigo,
                granularidade=granularidade_norm,
            )
            faturamento_serie = _buscar_faturamento_sd2_periodo(
                codigos,
                granularidade=granularidade_norm,
            )
            consumo_serie = _consumo_mensal_por_rows(
                rows_consumo_item,
                granularidade=granularidade_norm,
            )

            forecast_info = _forecast_item(codigo_norm, tipo)
            forecast_serie = []

            # Para PA/MR, o forecast do gráfico por item precisa vir do PA vendido.
            # O front desenha a série "Forecast / demanda" pelo campo demanda.
            if granularidade_norm == "mensal":
                for ponto_forecast in forecast_info.get("serie") or []:
                    ano = int(ponto_forecast.get("ano") or 0)
                    mes = int(ponto_forecast.get("mes") or 0)
                    valor_forecast = _to_float(ponto_forecast.get("forecast"))

                    if ano <= 0 or mes <= 0 or valor_forecast == 0:
                        continue

                    info = _periodo_from_data(date(ano, mes, 1), "mensal")
                    ponto = _empty_periodo_row(info)
                    ponto["demanda"] = _round(valor_forecast, 4)
                    forecast_serie.append(ponto)

            serie = _merge_series_periodo(
                estoque_serie,
                compras_serie,
                faturamento_serie,
                consumo_serie,
                forecast_serie,
            )

            saldos_sb8 = _buscar_ultimo_saldo_sb8(codigos, tipos_por_codigo=tipos_por_codigo)
            saldo_info = saldos_sb8.get(codigo_norm, {})

            serie = _corrigir_estoque_serie_item_pa_mr(
                serie,
                saldo_info=saldo_info,
                granularidade=granularidade_norm,
            )

            mapa_pa_pi_bravi = _mapear_pa_para_pi_bravi(codigos, produtos_all=produtos_all, rows=rows_consumo_item or [row_ref])
            codigos_pi_bravi = sorted({
                _normalizar_codigo(pi)
                for pis in mapa_pa_pi_bravi.values()
                for pi in (pis or [])
                if _normalizar_codigo(pi)
            })
            compras_raw = _buscar_compras_resumido(sorted(set(codigos + codigos_pi_bravi)))
            liberacoes_pa = _buscar_liberacoes_previstas_pa_resumido(codigos, produtos_all=produtos_all)
            saldos_pi_bravi = _buscar_saldo_pi_bravi_resumido(mapa_pa_pi_bravi)
            compras_resumo = _combinar_entradas_previstas_por_tipo(
                codigos,
                rows_consumo_item or [row_ref],
                produtos_all,
                compras_raw,
                liberacoes_pa,
                mapa_pa_pi_bravi=mapa_pa_pi_bravi,
                saldos_pi_bravi=saldos_pi_bravi,
            )
            compra_item = compras_resumo.get(codigo_norm, {})

            venda_item = _buscar_faturamento_ytd(codigos).get(codigo_norm, {})
            produto_dim = produtos_all.get(codigo_norm, {})

            return {
                "granularidade": granularidade_norm,
                "data_snapshot_consumo": snapshot_consumo,
                "total_itens_produtos": 1,
                "codigos_produtos": codigos,
                "total_itens_bravi": 1,
                "codigos_bravi": codigos,
                "item": {
                    "codigo": codigo_norm,
                    "produto": produto_dim.get("desc_produto") or row_ref.get("desc_produto") or row_ref.get("produto"),
                    "tipo": tipo,
                },
                "resumo": {
                    "estoque_atual": _round(_to_float(saldo_info.get("saldo")), 4),
                    "pedidos_abertos": _round(_to_float(compra_item.get("qtd_pedidos_abertos")), 4),
                    "faturamento_ytd_qtd": _round(_to_float(venda_item.get("faturamento_ytd_qtd")), 4),
                    "faturamento_ytd_valor": _round(_to_float(venda_item.get("faturamento_ytd_valor")), 2),
                    "criticos": 0,
                    "excesso": 0,
                },
                "serie": serie,
                "debug": {
                    "modo": "item_pa_mr_rapido",
                    "codigo": codigo_norm,
                    "tipo": tipo,
                    "qtd_estoque_pontos": len(estoque_serie),
                    "qtd_entradas_pontos": len(compras_serie),
                    "qtd_faturamento_pontos": len(faturamento_serie),
                    "qtd_consumo_pontos": len(consumo_serie),
                    "qtd_forecast_pontos": len(forecast_serie),
                    "forecast_metodo": forecast_info.get("metodo"),
                    "regra_estoque_serie": "serie_pa_mr_usa_saldo_info_resumo_mes_atual",
                    "saldo_info": saldo_info,
                },
                "backend_versao": VERSAO_AGING_ESTOQUE,
            }

        serie_cache_key = f"{VERSAO_AGING_ESTOQUE}|produtos_serie|{granularidade_norm}|{date.today().isoformat()}"
        if _cache_simples_valido(_SERIE_PRODUTOS_CACHE, serie_cache_key, SERIE_PRODUTOS_CACHE_TTL_SECONDS):
            return _SERIE_PRODUTOS_CACHE.get("data")

        base = _build_produtos_oficiais_fast_cached()
        ctx = _buscar_codigos_produtos_da_base(base)

        codigos = ctx["codigos"]
        itens_produtos = ctx["itens"]
        tipos_por_codigo = ctx["tipos_por_codigo"]

        rows_consumo_produtos = []
        snapshot_consumo = base.get("snapshot_consumo")

        estoque_serie = _buscar_estoque_periodo(
            codigos,
            tipos_por_codigo=tipos_por_codigo,
            granularidade=granularidade_norm,
        )
        compras_serie = _buscar_entradas_previstas_periodo_por_tipo(
            codigos,
            tipos_por_codigo=tipos_por_codigo,
            granularidade=granularidade_norm,
        )
        faturamento_serie = _buscar_faturamento_sd2_periodo(
            codigos,
            granularidade=granularidade_norm,
        )
        consumo_serie = _consumo_mensal_por_rows(
            rows_consumo_produtos,
            granularidade=granularidade_norm,
        )

        serie = _merge_series_periodo(
            estoque_serie,
            compras_serie,
            faturamento_serie,
            consumo_serie,
        )

        resposta = {
            "granularidade": granularidade_norm,
            "data_snapshot_consumo": snapshot_consumo,
            "total_itens_produtos": len(itens_produtos),
            "codigos_produtos": codigos,
            # Mantém campos antigos para compatibilidade com o tipo do front.
            "total_itens_bravi": len(itens_produtos),
            "codigos_bravi": codigos,
            "resumo": {
                "estoque_atual": _round(sum(max(0, _to_float(i.get("saldo"))) for i in itens_produtos), 4),
                "pedidos_abertos": _round(sum(_to_float(i.get("qtd_pedidos_abertos")) for i in itens_produtos), 4),
                "faturamento_ytd_qtd": _round(sum(_to_float(i.get("faturamento_ytd_qtd")) for i in itens_produtos), 4),
                "faturamento_ytd_valor": _round(sum(_to_float(i.get("faturamento_ytd_valor")) for i in itens_produtos), 2),
                "criticos": sum(1 for i in itens_produtos if _status_visual_item(i) == "VERMELHO"),
                "excesso": sum(1 for i in itens_produtos if i.get("status") == "EXCESSO"),
            },
            "serie": serie,
            "debug": {
                "modo": "produtos_pa_mr_oficiais_cached",
                "qtd_itens_produtos": len(itens_produtos),
                "qtd_codigos": len(codigos),
                "qtd_estoque_pontos": len(estoque_serie),
                "qtd_entradas_pontos": len(compras_serie),
                "qtd_faturamento_pontos": len(faturamento_serie),
                "qtd_consumo_pontos": len(consumo_serie),
                "observacao": "Endpoint criado para o gráfico PA/MR; substitui a chamada antiga que retornava 404.",
                "cache_ttl_segundos": SERIE_PRODUTOS_CACHE_TTL_SECONDS,
            },
            "backend_versao": VERSAO_AGING_ESTOQUE,
        }
        _SERIE_PRODUTOS_CACHE["key"] = serie_cache_key
        _SERIE_PRODUTOS_CACHE["created_at"] = time.time()
        _SERIE_PRODUTOS_CACHE["data"] = resposta
        return resposta

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/debug-sb8/{codigo}")
def debug_sb8_codigo(codigo: str):
    """
    Diagnóstico seguro da SB8/f_estoque_saldo por código.

    Não altera cálculo nenhum. Serve para validar de onde a coluna Quarentena 98
    está vindo e comparar com o Excel.
    """
    try:
        codigo_norm = _normalizar_codigo(codigo)

        # Usa a mesma busca robusta do cálculo da tela para diagnosticar
        # ambientes que gravaram o código como codigo/produto/cod_produto.
        rows = _select_all_estoque_saldo_por_codigos([codigo_norm], "*")

        linhas = []

        total_normal_04_07 = 0.0
        total_quarentena_98 = 0.0
        total_outros_armazens = 0.0

        for row in rows or []:
            armazem_norm = _normalizar_armazem_estoque(row)
            saldo_bruto = _saldo_lote_bruto(row)
            empenho = _valor_empenho_lote(row)
            saldo_disponivel = _saldo_disponivel_lote(row)

            if armazem_norm == "98":
                # No armazém 98, saldo_disponivel pode estar 0 por não estar liberado;
                # para quarentena mostramos o saldo físico da SB8.
                total_quarentena_98 += max(_to_float(saldo_bruto), _to_float(saldo_disponivel))
            elif armazem_norm in {"04", "07"}:
                total_normal_04_07 += saldo_disponivel
            else:
                total_outros_armazens += saldo_disponivel

            linhas.append({
                "codigo": _normalizar_codigo(row.get("codigo") or row.get("produto")),
                "descricao": row.get("descricao") or row.get("produto_descricao") or row.get("desc_produto"),
                "armazem_raw": row.get("armazem"),
                "armazem_norm": armazem_norm,
                "data_ref": row.get("data_ref"),
                "data": row.get("data"),
                "lote": row.get("lote"),
                "saldo_lote": _round(saldo_bruto, 4),
                "empenho": _round(empenho, 4),
                "saldo_disponivel": _round(saldo_disponivel, 4),
            })

        return {
            "codigo": codigo_norm,
            "qtd_linhas": len(linhas),
            "totais_diagnostico": {
                "normal_04_07": _round(total_normal_04_07, 4),
                "quarentena_98": _round(total_quarentena_98, 4),
                "outros_armazens": _round(total_outros_armazens, 4),
            },
            "linhas": sorted(linhas, key=lambda x: (str(x.get("armazem_norm") or ""), str(x.get("data_ref") or ""), str(x.get("lote") or ""))),
            "backend_versao": VERSAO_AGING_ESTOQUE,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug-programacao-v1")
def debug_programacao_v1():
    """
    Diagnóstico da fonte usada para demanda de insumos.

    Esperado:
      - encontrar a tabela de programação/Gantt;
      - filtrar V1 do mês atual;
      - somar L1 + L2 por SKU/mês;
      - retornar linhas normalizadas no formato cod_produto/ano/mes/qtd_forecast.
    """
    try:
        rows, debug = _buscar_mrp_v1_l1_l2_rows()

        return {
            "router": "aging_estoque",
            "versao": VERSAO_AGING_ESTOQUE,
            "regra": "V1 do mês atual; meses atuais/futuros; soma L1 + L2; explode BOM para insumos.",
            "qtd_linhas_normalizadas": len(rows),
            "debug": debug,
            "amostra": rows[:20],
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug-bom/{codigo}")
def debug_bom(codigo: str):
    """
    Endpoint temporário de diagnóstico da explosão multinível.

    Uso:
      /aging-estoque/debug-bom/08191

    Ele testa apenas:
      Forecast S&OP -> BOM multinível -> código informado

    Se este endpoint trouxer série e /item/{codigo} não trouxer, o problema está
    na montagem do detalhe. Se este endpoint vier vazio, o problema está na
    explosão Python ou nos dados disponíveis para o backend.
    """
    try:
        codigo_norm = _normalizar_codigo(codigo)

        programacao_rows, debug_programacao = _buscar_mrp_v1_l1_l2_rows()
        origem_debug = "mrp_v1_l1_l2_bom"

        if not programacao_rows:
            programacao_rows = _buscar_forecast_sop_rows()
            origem_debug = "forecast_sop_bom_fallback_sem_programacao_v1"

        filhos_por_pai = _buscar_bom_filhos()

        # Diagnóstico direto: pais que possuem o código informado como componente.
        pais_diretos = []
        for pai, filhos in filhos_por_pai.items():
            for filho in filhos:
                if filho.get("codigo_comp") == codigo_norm:
                    pais_diretos.append({
                        "codigo_pai": pai,
                        "codigo_comp": codigo_norm,
                        "quantidade": _round(filho.get("quantidade"), 8),
                        "descricao_comp": filho.get("descricao_comp"),
                        "tp": filho.get("tp"),
                    })

        demanda_direta, demanda_explodida = _explodir_forecast_multinivel(
            programacao_rows,
            codigos_interesse={codigo_norm},
        )

        serie = []

        for (cod, ano, mes), valor in sorted(demanda_explodida.items()):
            if cod != codigo_norm:
                continue

            serie.append({
                "codigo": cod,
                "ano": ano,
                "mes": mes,
                "periodo": _mes_label(mes, ano),
                "forecast": _round(valor, 8),
            })

        return {
            "codigo": codigo_norm,
            "metodo": origem_debug,
            "qtd_linhas_programacao_ou_fallback": len(programacao_rows),
            "debug_programacao_v1": debug_programacao,
            "qtd_pais_bom": len(filhos_por_pai),
            "qtd_pais_diretos_do_item": len(pais_diretos),
            "pais_diretos_do_item": pais_diretos[:50],
            "qtd_pontos_demanda": len(serie),
            "serie": serie,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/resumo")
def resumo_aging(
    escopo: Optional[str] = Query("todos"),
    status: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    busca: Optional[str] = Query(None),
    tipo_negocio: Optional[str] = Query(None),
    status_portfolio: Optional[str] = Query(None),
    transferencia_bravi: Optional[str] = Query(None),
    modelo_fornecimento: Optional[str] = Query(None),
    grupo_gerencial: Optional[str] = Query(None),
    classificacao_cadastro: Optional[str] = Query("MAPEADOS"),
    semaforo: Optional[str] = Query(None),
    status_plano: Optional[str] = Query(None),
    alerta_previsao: Optional[str] = Query(None),
    descontinuado: Optional[str] = Query(None),
    _t: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    try:
        tem_filtro_operacional = any([
            status, tipo, busca, tipo_negocio, status_portfolio,
            transferencia_bravi, modelo_fornecimento, grupo_gerencial,
            semaforo, status_plano, alerta_previsao, descontinuado,
            classificacao_cadastro and classificacao_cadastro != "MAPEADOS",
        ])
        # Hotfix v17: o front envia force_refresh=true em cascata. Como a chave
        # do cache já muda por snapshot/upload, endpoints de leitura não devem
        # forçar rebuild pesado. Isso evita prender as máquinas no Fly.
        force_refresh_base = False
        base, escopo_norm = _base_por_escopo_para_endpoint(escopo, force_refresh=force_refresh_base)
        itens_full = base["itens"] if escopo_norm == "produtos" else _filtrar_por_escopo_estoque(base["itens"], escopo_norm)

        itens = _filtrar_itens(
            itens_full,
            status=status,
            tipo=tipo,
            busca=busca,
            tipo_negocio=tipo_negocio,
            status_portfolio=status_portfolio,
            transferencia_bravi=transferencia_bravi,
            modelo_fornecimento=modelo_fornecimento,
            grupo_gerencial=grupo_gerencial,
            classificacao_cadastro=classificacao_cadastro,
            semaforo=semaforo,
            status_plano=status_plano,
            alerta_previsao=alerta_previsao,
            descontinuado=descontinuado,
        )

        def _tem_demanda_cobertura(item):
            return (
                _to_float(item.get("demanda_mes_atual")) > 0
                or _to_float(item.get("movimento_6m_status")) > 0
                or _to_float(item.get("demanda_base_status")) > 0
            )

        def _cobertura_status_item(item):
            return _to_float(
                _coalesce(
                    item.get("cobertura_meses_status"),
                    item.get("cobertura_meses_atual"),
                )
            )

        faixas = [
            ("0 a 1 mês", lambda x: _tem_demanda_cobertura(x) and _cobertura_status_item(x) < 1),
            ("1 a 1,5 mês", lambda x: _tem_demanda_cobertura(x) and 1 <= _cobertura_status_item(x) < 1.5),
            ("1,5 a 3 meses", lambda x: _tem_demanda_cobertura(x) and 1.5 <= _cobertura_status_item(x) <= 3),
            ("Excesso > 3 meses", lambda x: _tem_demanda_cobertura(x) and _cobertura_status_item(x) > 3),
            ("Sem consumo", lambda x: not _tem_demanda_cobertura(x)),
        ]

        faixas_cobertura = []
        for nome, fn in faixas:
            subset_faixa = [item for item in itens if fn(item)]
            subset_preview = sorted(
                subset_faixa,
                key=lambda item: (
                    _to_float(item.get("cobertura_meses_status") or item.get("cobertura_meses_atual")),
                    -_to_float(item.get("demanda_base_status") or item.get("demanda_mes_atual")),
                    str(item.get("codigo") or ""),
                ),
            )[:12]
            faixas_cobertura.append({
                "faixa": nome,
                "itens": len(subset_faixa),
                "amostra_itens": [
                    {
                        "codigo": item.get("codigo"),
                        "produto": item.get("produto"),
                        "saldo": item.get("saldo"),
                        "entradas_previstas": item.get("entradas_previstas"),
                        "entradas_mes_atual": item.get("entradas_mes_atual"),
                        "demanda_mes_atual": item.get("demanda_mes_atual"),
                        "demanda_base_status": item.get("demanda_base_status"),
                        "movimento_6m_status": item.get("movimento_6m_status"),
                        "cobertura_meses_status": item.get("cobertura_meses_status"),
                        "cobertura_meses_futura": item.get("cobertura_meses_futura"),
                        "metodo_cobertura": item.get("metodo_cobertura"),
                    }
                    for item in subset_preview
                ],
            })

        tipos = sorted({str(i.get("tipo") or "Sem tipo") for i in itens})

        por_tipo = []

        for tipo_item in tipos:
            subset = [i for i in itens if str(i.get("tipo") or "Sem tipo") == tipo_item]
            por_tipo.append({
                "tipo": tipo_item,
                "itens": len(subset),
                "criticos": sum(1 for i in subset if i["status"] in {"RUPTURA", "CRITICO"}),
                "excesso": sum(1 for i in subset if i["status"] == "EXCESSO"),
                "saldo": _round(sum(i["saldo"] for i in subset)),
            })

        return {
            "escopo": escopo_norm,
            "escopos_disponiveis": ["produtos", "insumos", "todos"],
            "data_snapshot_consumo": base["snapshot_consumo"],
            "data_snapshot_mrp": base["snapshot_mrp"],
            "qtd_linhas_consumo_snapshot": base.get("qtd_linhas_consumo_snapshot"),
            "qtd_linhas_d_produtos_adicionadas": base.get("qtd_linhas_d_produtos_adicionadas"),
            "qtd_d_produtos_relevantes_carregados": base.get("qtd_d_produtos_relevantes_carregados"),
            "qtd_componentes_bom": base.get("qtd_componentes_bom"),
            "resumo": _montar_resumo(itens),
            "faixas_cobertura": faixas_cobertura,
            "por_tipo": por_tipo,
            "saude_negocios": _montar_saude_negocios(_filtrar_itens(itens_full, classificacao_cadastro="MAPEADOS")),
            "opcoes": _opcoes_filtro(_filtrar_itens(itens_full, classificacao_cadastro="MAPEADOS")),
            "top_excesso": sorted(itens, key=lambda x: x["gap_volume"], reverse=True)[:10],
            "top_criticos": [
                i for i in itens
                if _status_visual_item(i) == "VERMELHO"
            ][:10],
            "top_descontinuados": [
                i for i in itens
                if i.get("status_estoque") == "DESCONTINUADO_COM_SALDO"
            ][:10],
            "top_transferencia_bravi": [
                i for i in itens
                if str(i.get("transferencia_bravi") or "").strip() == "Sim"
            ][:10],
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/itens")
def itens_aging(
    escopo: Optional[str] = Query("todos"),
    page: int = Query(1),
    page_size: int = Query(100),
    status: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    busca: Optional[str] = Query(None),
    tipo_negocio: Optional[str] = Query(None),
    status_portfolio: Optional[str] = Query(None),
    transferencia_bravi: Optional[str] = Query(None),
    modelo_fornecimento: Optional[str] = Query(None),
    grupo_gerencial: Optional[str] = Query(None),
    grupo: Optional[str] = Query(None),
    curva_a: Optional[str] = Query(None),
    classificacao_cadastro: Optional[str] = Query("MAPEADOS"),
    semaforo: Optional[str] = Query(None),
    status_plano: Optional[str] = Query(None),
    alerta_previsao: Optional[str] = Query(None),
    descontinuado: Optional[str] = Query(None),
    sort_key: Optional[str] = Query(None),
    sort_direction: Optional[str] = Query("desc"),
    _t: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    try:
        escopo_norm_preview = _normalizar_escopo_estoque(escopo)
        page_size_solicitado = int(page_size or 100)

        # Hotfix v17: bloqueia a chamada legado mais perigosa do front:
        # /aging-estoque/itens?escopo=todos&page_size=5000&force_refresh=true.
        # Ela era usada só para montar visão auxiliar, mas segurava conexão por
        # minutos e fazia o Fly atingir 50 conexões simultâneas por máquina.
        if escopo_norm_preview == "todos" and page_size_solicitado >= BULK_TODOS_PAGE_SIZE_LIMITE:
            cached_data = _BUILD_BASE_CACHE.get("data")
            if not cached_data:
                return {
                    "escopo": "todos",
                    "escopos_disponiveis": ["produtos", "insumos", "todos"],
                    "page": max(1, page),
                    "page_size": MAX_PAGE_SIZE_TABELA,
                    "total": 0,
                    "total_pages": 1,
                    "itens": [],
                    "opcoes": {},
                    "warning": "bulk_todos_bloqueado_para_evitar_saturacao; use escopo=produtos/insumos ou paginação menor",
                    "fastpath": "hotfix_v17_sem_build_pesado",
                }
            # Se já houver cache quente, reaproveita sem rebuild e só limita paginação.
            force_refresh = False
            page_size = MAX_PAGE_SIZE_TABELA

        tem_filtro_tabela = any([
            status, tipo, busca, tipo_negocio, status_portfolio,
            transferencia_bravi, modelo_fornecimento, grupo_gerencial,
            semaforo, status_plano, alerta_previsao, descontinuado,
            classificacao_cadastro and classificacao_cadastro != "MAPEADOS",
            sort_key, page and int(page) != 1,
        ])
        # Hotfix v17: endpoints de tabela nunca forçam rebuild. A chave do cache
        # já considera snapshots/uploads; force_refresh vindo do front vira apenas
        # filtro/paginação em memória.
        force_refresh_base = False

        # Fast path v25: busca PA/MR e Insumos não deve montar o escopo inteiro antes de filtrar.
        # Reduzimos primeiro o universo pelo termo digitado e só então enriquecemos os códigos encontrados.
        busca_texto = str(busca or "").strip()
        usar_fastpath_busca_produtos = escopo_norm_preview == "produtos" and bool(busca_texto)
        usar_fastpath_busca_insumos = escopo_norm_preview == "insumos" and bool(busca_texto)

        if usar_fastpath_busca_produtos:
            escopo_norm = "produtos"
            produtos_filtrados = _buscar_produtos_ativos_por_busca_fast(busca_texto)
            base = _build_produtos_oficiais_fast_from_produtos(
                produtos_filtrados,
                fastpath_label="pa_mr_busca_direta_v25",
            )
            itens_base_escopo = base["itens"]
        elif usar_fastpath_busca_insumos:
            escopo_norm = "insumos"
            base = _build_insumos_fast_busca_light_v27(busca_texto)
            itens_base_escopo = _filtrar_por_escopo_estoque(base["itens"], escopo_norm)
        else:
            base, escopo_norm = _base_por_escopo_para_endpoint(escopo, force_refresh=force_refresh_base)
            itens_base_escopo = base["itens"] if escopo_norm == "produtos" else _filtrar_por_escopo_estoque(base["itens"], escopo_norm)

        itens = _filtrar_itens(
            itens_base_escopo,
            status=status,
            tipo=tipo,
            busca=busca,
            tipo_negocio=tipo_negocio,
            status_portfolio=status_portfolio,
            transferencia_bravi=transferencia_bravi,
            modelo_fornecimento=modelo_fornecimento,
            grupo_gerencial=grupo_gerencial,
            grupo=grupo,
            curva_a=curva_a,
            classificacao_cadastro=classificacao_cadastro,
            semaforo=semaforo,
            status_plano=status_plano,
            alerta_previsao=alerta_previsao,
            descontinuado=descontinuado,
        )

        campos_ordenaveis = {
            "saldo",
            "qtd_pedidos_abertos",
            "estoque_mais_pedidos",
            "maior_media",
            "lead_time_dias",
            "qtd_minima",
            "estoque_ideal",
            "dias_em_estoque",
            "cobertura_dias",
            "cobertura_meses_atual",
            "cobertura_futura_dias",
            "cobertura_meses_futura",
            "cobertura_consumo_lt",
            "gap_volume",
            "custo_unitario",
            "estoque_atual_valor",
            "pedidos_abertos_valor",
            "estoque_mais_pedidos_valor",
            "maior_media_valor",
            "consumo_durante_lt",
            "consumo_durante_lt_valor",
            "estoque_ideal_valor",
            "gap_valor",
            "demanda_mes_atual",
            "consumo_mes_atual",
            "previsto_vs_consumido_pct",
            "perc_mes_decorrido",
            "desvio_ritmo_pct",
            "saldo_quarentena",
            "faturamento_ytd_qtd",
            "faturamento_ytd_valor",
        }

        if sort_key in campos_ordenaveis:
            reverse = str(sort_direction or "desc").lower() != "asc"
            itens = sorted(
                itens,
                key=lambda item: _to_float(item.get(sort_key)),
                reverse=reverse,
            )

        total = len(itens)

        page = max(1, page)
        page_size = min(max(10, page_size), MAX_PAGE_SIZE_TABELA)

        start = (page - 1) * page_size
        end = start + page_size

        return {
            "escopo": escopo_norm,
            "escopos_disponiveis": ["produtos", "insumos", "todos"],
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": ceil(total / page_size) if page_size else 1,
            "itens": itens[start:end],
            "opcoes": _opcoes_filtro(_filtrar_itens(itens_base_escopo, classificacao_cadastro="MAPEADOS")),
            "backend_versao": VERSAO_AGING_ESTOQUE,
            "fastpath": base.get("fastpath"),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug-compras-fup/{codigo}")
def debug_compras_fup_codigo(codigo: str):
    """Debug rápido para validar se a planilha de FUP foi importada e cruzou."""
    codigo_norm = _normalizar_codigo(codigo)

    try:
        compras = _select_all_por_codigos(
            "f_compras_abertas",
            "produto_codigo",
            [codigo_norm],
            "*",
        )
    except Exception as e:
        compras = []
        erro_compras = str(e)[:300]
    else:
        erro_compras = None

    try:
        fups = _buscar_compras_fup_por_codigo(codigo_norm)
        erro_fup = None
    except Exception as e:
        fups = []
        erro_fup = str(e)[:300]

    matches = []
    for compra in compras or []:
        qtd = _to_float(compra.get("quantidade_pendente"))
        if qtd <= 0:
            continue
        fup = _melhor_fup_para_pedido(compra, fups)
        matches.append({
            "pedido_numero": compra.get("pedido_numero"),
            "pedido_item": compra.get("pedido_item"),
            "sc_numero": compra.get("sc_numero"),
            "sc_item": compra.get("sc_item"),
            "quantidade_pendente": _round(qtd, 4),
            "data_prevista_entrega": _data_prevista_compra(compra),
            "match_fup": bool(fup),
            "comentario_fup": (fup or {}).get("comentario_fup"),
            "nova_previsao_fup": (fup or {}).get("nova_previsao_fup"),
            "status_fup": (fup or {}).get("status_fup"),
            "aba_fup": (fup or {}).get("aba_origem"),
            "arquivo_fup": (fup or {}).get("arquivo_origem"),
        })

    return {
        "codigo": codigo_norm,
        "backend_versao": VERSAO_AGING_ESTOQUE,
        "qtd_compras_abertas": len(compras or []),
        "qtd_fup_codigo": len(fups or []),
        "erro_compras": erro_compras,
        "erro_fup": erro_fup,
        "fups": (fups or [])[:20],
        "matches": matches[:30],
    }


@router.get("/item/{codigo}")
def detalhe_item(
    codigo: str,
    meses_futuros: int = Query(6, ge=1, le=24),
    granularidade: str = Query("mensal"),
):
    try:
        codigo_norm = _normalizar_codigo(codigo)

        rows, snapshot_consumo = _buscar_consumo_latest()

        row_item = None

        for row in rows:
            if _normalizar_codigo(row.get("codigo")) == codigo_norm:
                row_item = row
                break

        produtos_all = _buscar_d_produtos_por_codigos([codigo_norm])
        produto_dim_direto = produtos_all.get(codigo_norm)

        if not row_item and produto_dim_direto:
            row_item = _linha_consumo_sintetica_d_produtos(codigo_norm, produto_dim_direto)
            row_item = _aplicar_saldo_sb8_em_linhas_sinteticas(
                [row_item],
                {codigo_norm: produto_dim_direto},
            )[0]

        if not row_item:
            raise HTTPException(status_code=404, detail="Item não encontrado.")

        row_item = _aplicar_saldo_sb8_em_produtos(
            [dict(row_item)],
            produtos_all,
        )[0]
        row_item = _aplicar_quarentena_sb8_98_em_todos_os_itens(
            [dict(row_item)],
            produtos_all,
        )[0]
        row_item = _aplicar_saldo_insumos_somente_armazem_01(
            [dict(row_item)],
            produtos_all,
        )[0]

        mapa_pa_pi_bravi = _mapear_pa_para_pi_bravi([codigo_norm], produtos_all=produtos_all, rows=[row_item])
        codigos_pi_bravi = sorted({
            _normalizar_codigo(pi)
            for pis in mapa_pa_pi_bravi.values()
            for pi in (pis or [])
            if _normalizar_codigo(pi)
        })
        codigos_compra_consulta = sorted(set([codigo_norm] + codigos_pi_bravi))
        compras_raw = _buscar_compras_resumido(codigos_compra_consulta)
        liberacoes_pa = _buscar_liberacoes_previstas_pa_resumido([codigo_norm], produtos_all=produtos_all)
        saldos_pi_bravi = _buscar_saldo_pi_bravi_resumido(mapa_pa_pi_bravi)
        compras_resumo = _combinar_entradas_previstas_por_tipo(
            [codigo_norm],
            [row_item],
            produtos_all,
            compras_raw,
            liberacoes_pa,
            mapa_pa_pi_bravi=mapa_pa_pi_bravi,
            saldos_pi_bravi=saldos_pi_bravi,
        )
        parametros, snapshot_mrp = _buscar_parametros_estoque([codigo_norm])
        custos = _buscar_custos_unitarios([codigo_norm])
        demanda_mes = _buscar_demanda_mes_atual([codigo_norm])
        produtos = {codigo_norm: produto_dim_direto} if produto_dim_direto else _buscar_d_produtos([codigo_norm], filtrar_por_codigos=True)
        classificacao_bom = _buscar_classificacao_bom([codigo_norm], produtos_all)
        vendas = _buscar_faturamento_ytd([codigo_norm])
        faturamento_6m_por_codigo = _buscar_historico_operacional_ultimos_6m_por_codigo([codigo_norm])
        entradas_previstas_serie_por_codigo = _buscar_entradas_previstas_serie_por_codigo(
            [codigo_norm],
            [row_item],
            produtos_all,
            mapa_pa_pi_bravi=mapa_pa_pi_bravi,
        )
        forecast_futuro_item = _buscar_forecast_futuro_por_codigo([codigo_norm], produtos_all=produtos_all)

        item = _montar_item_base(
            row_item,
            compras_resumo,
            parametros,
            custos,
            demanda_mes,
            produtos,
            vendas,
            classificacao_bom,
            forecast_futuro_item,
            entradas_previstas_serie_por_codigo,
            faturamento_6m_por_codigo,
        )

        historico_6m = faturamento_6m_por_codigo.get(codigo_norm, [])
        item["faturamento_sd2"] = historico_6m
        item["historico_6m"] = historico_6m
        item["historico_faturado_sop"] = historico_6m
        item["total_6m"] = _round(sum(_to_float(p.get("faturamento_qtd")) for p in historico_6m), 4)
        item["valor_6m"] = _round(sum(_to_float(p.get("faturamento_valor")) for p in historico_6m), 2)

        componentes_bom_info = _buscar_componentes_bom_info()
        comp_info = componentes_bom_info.get(codigo_norm)

        item["eh_componente_bom"] = bool(comp_info)
        item["qtd_pais_bom"] = int((comp_info or {}).get("qtd_pais_bom") or 0)
        item["tipo_componente_bom"] = (comp_info or {}).get("tp")
        item["descricao_componente_bom"] = (comp_info or {}).get("descricao_comp")
        item["pais_bom"] = (comp_info or {}).get("pais_bom") or []
        item["linhas_bom"] = (comp_info or {}).get("linhas_bom") or []
        item["linha_bom"] = (comp_info or {}).get("linha_bom")

        # Segurança final: para insumos, a classificação visual deve vir do pai da BOM.
        # Produto acabado/revenda continua usando d_produtos.
        if comp_info:
            linha_bom = str((comp_info or {}).get("linha_bom") or "").strip()
            if linha_bom and linha_bom != "A classificar":
                item["tipo_negocio"] = linha_bom
                item["macro_negocio"] = linha_bom
                item["familia"] = linha_bom
                item["segmento"] = linha_bom
                item["grupo_gerencial"] = (comp_info or {}).get("grupo_gerencial_bom") or (
                    "Insumos - Compartilhados" if linha_bom == "Compartilhado" else f"Insumos - {linha_bom}"
                )
                item["modelo_fornecimento"] = (
                    "Insumo de produção compartilhado" if linha_bom == "Compartilhado" else "Insumo de produção"
                )
                item["origem_classificacao"] = "BOM"

        # O gráfico principal não pode ficar dependente de consultas auxiliares.
        # Por isso, a série de consumo vem direto da f_consumo_materiais e as partes
        # opcionais ficam protegidas por try/except. Antes, uma falha em SB8 ou forecast
        # derrubava o detalhe inteiro e o front ficava só com a linha da tabela, sem série.
        historico_consumo = _historico_consumo(row_item)

        ano_atual = date.today().year
        consumo_ano_atual = _round(
            sum(
                _to_float(p.get("consumo"))
                for p in historico_consumo
                if int(p.get("ano") or 0) == ano_atual
            ),
            4,
        )

        historicos_com_valor = [
            p for p in historico_consumo
            if _to_float(p.get("consumo")) > 0
        ]
        ultimo_mes_consumo = (
            max(historicos_com_valor, key=lambda p: (int(p.get("ano") or 0), int(p.get("mes") or 0)))
            if historicos_com_valor
            else None
        )

        try:
            pedidos = _buscar_entradas_previstas_detalhadas(codigo_norm, item.get("tipo"))
        except Exception:
            pedidos = []

        try:
            historico_sb8_diario = _historico_sb8_diario(codigo_norm, item.get("tipo"))
        except Exception:
            historico_sb8_diario = []

        try:
            estoque_medio_mensal = _estoque_medio_mensal_sb8(codigo_norm, item.get("tipo"))
        except Exception:
            estoque_medio_mensal = []

        try:
            forecast_info = _forecast_item(codigo_norm, item.get("tipo"))
            forecast_serie = forecast_info.get("serie", [])
        except Exception:
            forecast_info = {"metodo": "indisponivel", "serie": []}
            forecast_serie = []

        try:
            comparativo_mensal = _comparativo_mensal(
                estoque_medio_mensal,
                historico_consumo,
                forecast_serie,
            )
        except Exception:
            comparativo_mensal = []

        linha_tempo_estoque = _linha_tempo_estoque(
            item,
            historico_consumo,
            forecast_serie,
            pedidos,
            meses_futuros=meses_futuros,
        )

        granularidade_norm = _normalizar_granularidade(granularidade)

        try:
            faturamento_sd2 = _buscar_faturamento_sd2_periodo(
                [codigo_norm],
                granularidade=granularidade_norm,
            )
        except Exception:
            faturamento_sd2 = []

        try:
            entradas_previstas_serie = _buscar_entradas_previstas_periodo_por_tipo(
                [codigo_norm],
                tipos_por_codigo={codigo_norm: item.get("tipo")},
                granularidade=granularidade_norm,
            )
        except Exception:
            entradas_previstas_serie = []

        try:
            estoque_operacional_serie = _buscar_estoque_periodo(
                [codigo_norm],
                tipos_por_codigo={codigo_norm: item.get("tipo")},
                granularidade=granularidade_norm,
            )
        except Exception:
            estoque_operacional_serie = []

        serie_operacional = _merge_series_periodo(
            estoque_operacional_serie,
            entradas_previstas_serie,
            faturamento_sd2,
        )

        item.update({
            "data_snapshot_consumo": snapshot_consumo,
            "data_snapshot_mrp": snapshot_mrp,
            "pedidos": pedidos,
            "qtd_pedidos_abertos_detalhe": _round(sum(_to_float(p.get("quantidade_pendente")) for p in pedidos), 4),
            "qtd_pedidos_atrasados": _somar_pedidos_atrasados(pedidos),
            "pedidos_em_atraso": _somar_pedidos_atrasados(pedidos),
            "qtd_pedidos_no_prazo": _round(sum(_to_float(p.get("quantidade_pendente")) for p in pedidos if not p.get("em_atraso")), 4),

            "historico_consumo": historico_consumo,
            "consumo_ano_atual": consumo_ano_atual,
            "consumo_historico_ano_atual": consumo_ano_atual,
            "ultimo_mes_consumo": ultimo_mes_consumo,
            "historico_sb8_diario": historico_sb8_diario,
            "estoque_medio_mensal": estoque_medio_mensal,

            "forecast_metodo": forecast_info["metodo"],
            "forecast": forecast_serie,

            "comparativo_mensal": comparativo_mensal,
            "linha_tempo_estoque": linha_tempo_estoque,

            "granularidade_operacional": granularidade_norm,
            "faturamento_sd2": faturamento_sd2,
            "entradas_previstas_serie": entradas_previstas_serie,
            "estoque_operacional_serie": estoque_operacional_serie,
            "serie_operacional": serie_operacional,

            # Marcador para confirmar no JSON que o Fly está com esta versão.
            "backend_versao": VERSAO_AGING_ESTOQUE,
            "debug_qtd_fup_codigo": len(_buscar_compras_fup_por_codigo(codigo_norm)),
            "debug_tem_fup_comentario": any(bool(p.get("comentario_fup")) for p in pedidos or []),
            "debug_qtd_historico_consumo": len(historico_consumo),
            "debug_qtd_forecast": len(forecast_serie),
            "debug_qtd_linha_tempo": len(linha_tempo_estoque),
            "debug_regra_unidade_bom": "x100_apenas_ao_sair_de_intermediario_tubete_prep",
        })

        return item

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))