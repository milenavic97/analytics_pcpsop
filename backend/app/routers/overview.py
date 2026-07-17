from fastapi import APIRouter, Query, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.auth import exigir_admin
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from threading import Lock, Event
from typing import Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import asyncio
import re
import time
import unicodedata

router = APIRouter(prefix="/overview", tags=["overview"])

TUBETES_POR_CAIXA = 500
LINHAS = ("L1", "L2")


TZ_BR = ZoneInfo("America/Sao_Paulo")


def _agora_br() -> datetime:
    """Data/hora oficial da ferramenta no fuso de Brasília/São Paulo."""
    return datetime.now(TZ_BR)


def _hoje_br() -> date:
    """Data oficial da ferramenta no fuso de Brasília/São Paulo."""
    return _agora_br().date()


def _iso_br(value: datetime | None = None) -> str:
    """Timestamp ISO com offset -03:00 para evitar ambiguidade no front."""
    dt = value or _agora_br()
    if dt.tzinfo is None:
        # Histórico do backend usava utcnow() sem timezone; se vier naïve, trata como UTC.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ_BR).isoformat()


def _normalizar_timestamp_para_br(value) -> str | None:
    """
    Normaliza timestamps vindos do Supabase/upload_log para ISO em America/Sao_Paulo.

    Regras:
      - valor com Z/+00:00: converte de UTC para BR;
      - valor sem timezone: assume UTC, porque vários uploads antigos gravavam utcnow() naïve;
      - valor inválido: retorna o texto original para não quebrar versão/cache.
    """
    if value is None:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    bruto = texto.replace("Z", "+00:00")

    try:
        dt = datetime.fromisoformat(bruto)
    except Exception:
        return texto

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return dt.astimezone(TZ_BR).isoformat()


def _mes_atual() -> int:
    """Mês corrente, recalculado a cada chamada no fuso America/Sao_Paulo."""
    return _hoje_br().month


def _ano_atual() -> int:
    """Ano corrente, recalculado a cada chamada no fuso America/Sao_Paulo."""
    return _hoje_br().year
MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

# A Overview é uma visão específica de ANESTÉSICOS.
# O banco pode estar corporativo, mas estes endpoints continuam filtrando apenas anestésicos.
GRUPOS_ANESTESICOS_NOME = {
    "ALPHACAINE",
    "ALPHACAINE 80",
    "ARTICAINE",
    "ARTICAINE 200",
    "MEPIADRE",
    "MEPISV",
    "PRILONEST",
}

GRUPOS_ANESTESICOS_CODIGO = {
    "101", "102", "103", "104", "105", "106",
    "107", "108", "109", "110", "111", "112",
    "113", "114", "115", "116",
    "0101", "0102", "0103", "0104", "0105", "0106",
    "0107", "0108", "0109", "0110", "0111", "0112",
    "0113", "0114", "0115", "0116",
}



def _select_all(query) -> list:
    todos = []
    page = 0
    page_size = 1000

    while True:
        res = query.range(page * page_size, (page + 1) * page_size - 1).execute()
        data = res.data or []
        todos.extend(data)

        if len(data) < page_size:
            break

        page += 1

    return todos


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_cod_produto(value) -> str:
    if value is None:
        return ""

    raw = str(value).strip().upper()
    if not raw:
        return ""

    if raw.endswith(".0"):
        raw = raw[:-2]

    return re.sub(r"[^A-Z0-9]", "", raw)


def _filtro_ativo(valor: str | None) -> bool:
    texto = str(valor or "").strip()
    return bool(texto and texto.upper() not in {"TODOS", "TODAS", "ALL"})


def _normaliza_filtro(valor: str | None) -> str:
    return str(valor or "").strip().upper()


def _normaliza_grupo_nome(value) -> str:
    return str(value or "").strip().upper()


def _normaliza_grupo_codigo(value) -> str:
    texto = str(value or "").strip()
    if texto.endswith(".0"):
        texto = texto[:-2]
    try:
        return str(int(float(texto)))
    except Exception:
        return texto


def _is_grupo_anestesico_nome(value) -> bool:
    return _normaliza_grupo_nome(value) in GRUPOS_ANESTESICOS_NOME


def _is_grupo_anestesico_codigo(value) -> bool:
    grupo = _normaliza_grupo_codigo(value)
    return grupo in GRUPOS_ANESTESICOS_CODIGO or grupo.zfill(4) in GRUPOS_ANESTESICOS_CODIGO


def _filtrar_anestesicos_por_grupo_nome(rows: list[dict], campo: str = "grupo") -> list[dict]:
    return [r for r in rows if _is_grupo_anestesico_nome(r.get(campo))]


def _filtrar_anestesicos_por_grupo_codigo(rows: list[dict], campo: str = "grupo") -> list[dict]:
    return [r for r in rows if _is_grupo_anestesico_codigo(r.get(campo))]




def _dimensao_produtos() -> list[dict]:
    try:
        return _select_all(
            supabase.table("d_produtos")
            .select("cod_produto, grupo, familia, segmento, linha, mercado, status_portfolio")
        )
    except Exception:
        return []


def _normaliza_armazem_estoque(value) -> str:
    texto = str(value or "").strip()

    if texto.endswith(".0"):
        texto = texto[:-2]

    try:
        return str(int(float(texto))).zfill(2)
    except Exception:
        return texto.zfill(2)


def _parse_data_ref(value):
    if not value:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    try:
        return date.fromisoformat(texto[:10])
    except Exception:
        return None


def _codigos_anestesicos_dimensao(produtos: list[dict] | None = None) -> tuple[set[str], dict[str, str]]:
    """
    Retorna os SKUs de anestésicos pela d_produtos e um mapa código -> grupo.

    A SB8 é corporativa. Por isso a Overview precisa filtrar aqui apenas os PAs
    de anestésicos que pertencem aos grupos oficiais da página.
    """
    if produtos is None:
        produtos = _dimensao_produtos()

    codigos: set[str] = set()
    grupo_por_codigo: dict[str, str] = {}

    for p in produtos:
        cod = _normalize_cod_produto(p.get("cod_produto"))
        if not cod:
            continue

        grupo_raw = p.get("grupo")
        grupo_nome = _normaliza_grupo_nome(grupo_raw)
        grupo_codigo = _normaliza_grupo_codigo(grupo_raw)

        grupo_label = str(grupo_raw or "Sem grupo").strip() or "Sem grupo"
        grupo_por_codigo[cod] = grupo_label

        if (
            grupo_nome in GRUPOS_ANESTESICOS_NOME
            or grupo_codigo in GRUPOS_ANESTESICOS_CODIGO
            or grupo_codigo.zfill(4) in GRUPOS_ANESTESICOS_CODIGO
        ):
            codigos.add(cod)

    return codigos, grupo_por_codigo


def _estoque_inicial_sb8_por_mes(
    produtos: list[dict] | None = None,
    armazens_pa: set[str] | None = None,
    ano_base: int | None = None,
) -> tuple[dict[int, float], dict[int, dict[str, float]], dict]:
    """
    Estoque inicial mensal pela SB8/f_estoque_saldo.

    Regra:
      - Junho/2026 usa fixo 2026-06-02, porque foi a primeira carga SB8
        com PA + todos os armazéns;
      - Demais meses usam a menor data_ref disponível no mês;
      - Filtra somente PA/anestésicos pela d_produtos;
      - Filtra armazéns PA da Overview: 04 e 07;
      - Exclui produtos AVULSO da composição.
    """
    if armazens_pa is None:
        armazens_pa = {"04", "07"}

    ano_ref = ano_base or _ano_atual()

    codigos_anest, grupo_por_codigo = _codigos_anestesicos_dimensao(produtos)

    if not codigos_anest:
        return {}, {}, {
            "fonte": "f_estoque_saldo",
            "motivo": "sem_codigos_anestesicos_dimensao",
            "datas_por_mes": {},
        }

    try:
        rows = _select_all(
            supabase.table("f_estoque_saldo")
            .select("data_ref, codigo, descricao, armazem, saldo_lote")
        )
    except Exception:
        return {}, {}, {
            "fonte": "f_estoque_saldo",
            "motivo": "erro_consulta_f_estoque_saldo",
            "datas_por_mes": {},
        }

    linhas_validas = []
    primeira_data_por_mes: dict[int, date] = {}

    data_junho_2026 = date(2026, 6, 2)

    for r in rows:
        data_ref = _parse_data_ref(r.get("data_ref"))
        if not data_ref or data_ref.year != ano_ref:
            continue

        mes = data_ref.month
        if not (1 <= mes <= 12):
            continue

        armazem = _normaliza_armazem_estoque(r.get("armazem"))
        if armazem not in armazens_pa:
            continue

        codigo = _normalize_cod_produto(r.get("codigo"))
        if codigo not in codigos_anest:
            continue

        descricao = str(r.get("descricao") or "").strip().upper()
        if "AVULSO" in descricao:
            continue

        saldo = _to_float(r.get("saldo_lote"))
        if saldo <= 0:
            continue

        linhas_validas.append((mes, data_ref, codigo, saldo))

        # Exceção temporária: Junho/2026 precisa ficar fixo em 02/06.
        if ano_ref == 2026 and mes == 6:
            if data_ref == data_junho_2026:
                primeira_data_por_mes[mes] = data_junho_2026
            elif primeira_data_por_mes.get(mes) != data_junho_2026:
                atual = primeira_data_por_mes.get(mes)
                if atual is None or data_ref < atual:
                    primeira_data_por_mes[mes] = data_ref
            continue

        atual = primeira_data_por_mes.get(mes)
        if atual is None or data_ref < atual:
            primeira_data_por_mes[mes] = data_ref

    estoque_mes: dict[int, float] = {}
    estoque_grupo_mes: dict[int, dict[str, float]] = {}

    for mes, data_ref, codigo, saldo in linhas_validas:
        if primeira_data_por_mes.get(mes) != data_ref:
            continue

        grupo = grupo_por_codigo.get(codigo, "Sem grupo")

        estoque_mes[mes] = estoque_mes.get(mes, 0.0) + saldo

        if mes not in estoque_grupo_mes:
            estoque_grupo_mes[mes] = {}

        estoque_grupo_mes[mes][grupo] = estoque_grupo_mes[mes].get(grupo, 0.0) + saldo

    return estoque_mes, estoque_grupo_mes, {
        "fonte": "f_estoque_saldo",
        "datas_por_mes": {
            mes: data.isoformat()
            for mes, data in sorted(primeira_data_por_mes.items())
            if mes in estoque_mes
        },
        "armazens_pa": sorted(armazens_pa),
        "exclui_avulso": True,
        "hardcode_junho_2026": "2026-06-02",
    }


def _estoque_f_estoque_por_mes(
    produtos: list[dict] | None = None,
    ano_base: int | None = None,
) -> tuple[dict[int, float], dict[int, dict[str, float]], dict]:
    """
    Fallback legado: usa f_estoque caso ainda não exista SB8 para algum mês.
    """
    if produtos is None:
        produtos = _dimensao_produtos()

    ano_ref = ano_base or _ano_atual()

    _, grupo_por_codigo = _codigos_anestesicos_dimensao(produtos)

    try:
        rows = _select_all(
            supabase.table("f_estoque")
            .select("mes, ano, produto, qtd_caixas")
            .eq("ano", ano_ref)
        )
    except Exception:
        return {}, {}, {"fonte": "f_estoque", "motivo": "erro_consulta_f_estoque"}

    estoque_mes: dict[int, float] = {}
    estoque_grupo_mes: dict[int, dict[str, float]] = {}

    for r in rows:
        mes = _to_int(r.get("mes"))
        if not (1 <= mes <= 12):
            continue

        codigo = _normalize_cod_produto(r.get("produto"))
        grupo = grupo_por_codigo.get(codigo, "Sem grupo")
        qtd = _to_float(r.get("qtd_caixas"))

        estoque_mes[mes] = estoque_mes.get(mes, 0.0) + qtd

        if mes not in estoque_grupo_mes:
            estoque_grupo_mes[mes] = {}

        estoque_grupo_mes[mes][grupo] = estoque_grupo_mes[mes].get(grupo, 0.0) + qtd

    return estoque_mes, estoque_grupo_mes, {"fonte": "f_estoque"}


def _estoque_inicial_overview_por_mes(
    produtos: list[dict] | None = None,
    ano_base: int | None = None,
) -> tuple[dict[int, float], dict[int, dict[str, float]], dict]:
    """
    Fonte oficial do estoque inicial da Overview:
      1) SB8/f_estoque_saldo;
      2) fallback f_estoque para meses que ainda não existem na SB8.

    Importante: esta função só substitui a leitura do estoque inicial.
    Não altera faturamento, S&OP, liberações nem rastreamento.
    """
    ano_ref = ano_base or _ano_atual()

    estoque_sb8, grupo_sb8, debug_sb8 = _estoque_inicial_sb8_por_mes(produtos, ano_base=ano_ref)
    estoque_legado, grupo_legado, debug_legado = _estoque_f_estoque_por_mes(produtos, ano_base=ano_ref)

    estoque_final = dict(estoque_legado)
    grupo_final = {
        mes: dict(grupos)
        for mes, grupos in grupo_legado.items()
    }

    for mes, qtd in estoque_sb8.items():
        estoque_final[mes] = qtd
        grupo_final[mes] = dict(grupo_sb8.get(mes, {}))

    return estoque_final, grupo_final, {
        "fonte_preferencial": "f_estoque_saldo",
        "fonte_fallback": "f_estoque",
        "sb8": debug_sb8,
        "fallback": debug_legado,
        "meses_sb8": sorted(estoque_sb8.keys()),
        "meses_fallback": sorted(set(estoque_legado.keys()) - set(estoque_sb8.keys())),
    }



def _codigos_produtos_filtrados(
    linha: str | None = None,
    familia: str | None = None,
    segmento: str | None = None,
    grupo: str | None = None,
    mercado: str | None = None,
    status_portfolio: str | None = None,
) -> set[str] | None:
    """
    Mantido por compatibilidade com o front antigo.
    A Overview NÃO deve virar corporativa: ela é fixa em anestésicos.
    O filtro real é aplicado por grupo nas próprias tabelas fato:
      - forecast/orçado: grupo textual dos anestésicos
      - SD2: grupo numérico 0101 a 0116
      - SD3/estoque/MPS: já vêm filtrados/processados para anestésicos
    """
    return None

def _filtrar_rows_por_produto(rows: list[dict], codigos: set[str] | None, campo: str) -> list[dict]:
    if codigos is None:
        return rows

    return [
        r for r in rows
        if _normalize_cod_produto(r.get(campo)) in codigos
    ]


@router.get("/filtros-produtos")
def get_filtros_produtos():
    rows = _dimensao_produtos()

    def valores(campo: str) -> list[str]:
        return sorted({
            str(r.get(campo) or "").strip()
            for r in rows
            if str(r.get(campo) or "").strip()
        })

    return {
        "linha": valores("linha"),
        "familia": valores("familia"),
        "segmento": valores("segmento"),
        "grupo": valores("grupo"),
        "mercado": valores("mercado"),
        "status_portfolio": valores("status_portfolio"),
    }


def _linha_from_lote(lote: str | None) -> str | None:
    if not lote:
        return None

    match = re.search(r"[A-Za-z](\d)", str(lote).strip())
    if not match:
        return None

    if match.group(1) == "1":
        return "L1"
    if match.group(1) == "2":
        return "L2"

    return None


def _versao_num(valor) -> int:
    """
    Normaliza a versão do MPS.

    Aceita formatos como:
      - 4
      - 4.0
      - V4
      - V4 ATUAL
      - 4 ATUAL

    Isso evita ignorar a versão atual quando a tela/arquivo marca a linha como ATUAL.
    """
    texto = str(valor or "").strip().upper()

    if not texto:
        return 0

    match = re.search(r"(\d+)", texto)
    if not match:
        return 0

    try:
        return int(match.group(1))
    except Exception:
        return 0


def _get_mps_liberacoes_raw() -> list:
    return _select_all(
        supabase.table("f_mps_liberacoes")
        .select("mes_revisao, mes, ano, linha, versao, qtd_caixas")
        .eq("ano", _ano_atual())
    )


def _get_mps_por_revisao(rows_mps: list | None = None):
    if rows_mps is None:
        rows_mps = _get_mps_liberacoes_raw()

    dados: dict[int, dict[str, dict[int, dict[int, float]]]] = {}

    for r in rows_mps:
        linha = str(r.get("linha") or "").strip().upper()
        if linha not in LINHAS:
            continue

        mes_revisao_raw = r.get("mes_revisao")
        if mes_revisao_raw is None:
            mes_revisao_raw = r.get("mes")

        try:
            mes_revisao = int(mes_revisao_raw)
            mes_planejado = int(r["mes"])
        except Exception:
            continue

        if not (1 <= mes_revisao <= 12 and 1 <= mes_planejado <= 12):
            continue

        versao = _versao_num(r.get("versao"))
        if versao <= 0:
            continue

        qtd = _to_float(r.get("qtd_caixas"))

        dados.setdefault(mes_revisao, {linha: {} for linha in LINHAS})
        dados[mes_revisao].setdefault(linha, {})
        dados[mes_revisao][linha].setdefault(mes_planejado, {})
        dados[mes_revisao][linha][mes_planejado][versao] = (
            dados[mes_revisao][linha][mes_planejado].get(versao, 0.0) + qtd
        )

    return dados


def _ultima_versao_da_revisao(dados_mps: dict, mes_revisao: int) -> int | None:
    versoes: set[int] = set()

    revisao = dados_mps.get(mes_revisao, {})
    for linha in LINHAS:
        for versoes_mes in revisao.get(linha, {}).values():
            versoes.update(versoes_mes.keys())

    return max(versoes) if versoes else None


def _rodada_logica_atual(dados_mps: dict) -> tuple[int, int] | None:
    """
    Regra correta da Overview / MPS:
      - Para o mês atual e meses futuros, usa SEMPRE a última versão do mês atual.
      - Exemplo: se estamos em maio e existe Maio V4, usa Maio/V4 para maio em diante.
      - Não deve pegar Junho/V1 só porque junho é uma revisão maior.
    """
    mes_revisao_atual = _mes_atual()

    if mes_revisao_atual not in dados_mps:
        return None

    versao_atual = _ultima_versao_da_revisao(dados_mps, mes_revisao_atual)

    if versao_atual is None:
        return None

    return mes_revisao_atual, versao_atual


def _valor_mps(
    dados_mps: dict,
    mes_revisao: int,
    linha: str,
    mes_planejado: int,
    versao: int | None,
) -> float:
    if versao is None:
        return 0.0

    return _to_float(
        dados_mps
        .get(mes_revisao, {})
        .get(linha, {})
        .get(mes_planejado, {})
        .get(versao, 0.0)
    )


def _get_entradas_previstas_fallback() -> dict[str, dict[int, float]]:
    rows_prev = _select_all(
        supabase.table("f_entradas_previstas")
        .select("mes, ano, linha, qtd_caixas")
        .eq("ano", _ano_atual())
    )

    fallback_linha = {linha: {} for linha in LINHAS}

    for r in rows_prev:
        linha = str(r.get("linha") or "").strip().upper()
        if linha not in LINHAS:
            continue

        mes = int(r["mes"])
        fallback_linha[linha][mes] = fallback_linha[linha].get(mes, 0.0) + _to_float(r.get("qtd_caixas"))

    return fallback_linha



def _to_int(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(str(value).replace(",", ".")))
    except Exception:
        return default


def _linha_from_recurso(value) -> str | None:
    texto = str(value or "").strip().upper()

    if not texto:
        return None

    if "L2" in texto or "ENV003" in texto or "ENVASADORA 3" in texto or "ENVASADORA3" in texto:
        return "L2"

    if (
        "L1" in texto
        or "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQUINA 1" in texto
        or "MAQUINA1" in texto
        or "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQUINA 2" in texto
        or "MAQUINA2" in texto
        or "ENV001" in texto
        or "ENV002" in texto
        or "ENVASADORA 1" in texto
        or "ENVASADORA1" in texto
        or "ENVASADORA 2" in texto
        or "ENVASADORA2" in texto
    ):
        return "L1"

    return None


def _buscar_rodada_mrp_atual() -> dict | None:
    """
    Fonte validada da tela MPS: f_mrp_rodadas + f_mrp_etapas.

    Regra correta para a Overview:
      - usa a última versão da rodada do mês atual/analisado;
      - essa mesma rodada projeta o mês atual e os meses futuros;
      - não deve buscar uma eventual rodada futura só por ela ter mês maior.

    Exemplo: estando em Jun/2026, usa Jun/2026 Vn para Jun-Dez.
    Quando virar Jul/2026, passa a usar Jul/2026 Vn para Jul-Dez.
    """
    try:
        rows = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", _ano_atual())
        )
    except Exception:
        return None

    rodadas_validas = [
        r for r in rows
        if r.get("id") and _versao_num(r.get("versao")) > 0 and _to_int(r.get("mes")) > 0
    ]

    if not rodadas_validas:
        return None

    # Preferência absoluta: rodada do mês atual.
    # Fallback: última revisão anterior disponível, nunca uma revisão futura.
    candidatas = [r for r in rodadas_validas if _to_int(r.get("mes")) == _mes_atual()]
    if not candidatas:
        candidatas = [r for r in rodadas_validas if _to_int(r.get("mes")) <= _mes_atual()]
    if not candidatas:
        candidatas = rodadas_validas

    return sorted(
        candidatas,
        key=lambda r: (
            _versao_num(r.get("versao")),
            str(r.get("criado_em") or r.get("created_at") or ""),
        ),
        reverse=True,
    )[0]


def _agregar_etapas_mrp_por_rodada_id(rodada_id: str | None) -> dict[str, dict[int, float]]:
    """
    Agrega a estrutura do Gantt/MPS em caixas por linha e mês de liberação.

    Esta é a fonte oficial para liberações previstas na Overview quando a
    informação vem da tela MPS/Gantt:
      - f_mrp_rodadas define a versão;
      - f_mrp_etapas contém os lotes/etapas da versão;
      - usa MÊS LIBERAÇÃO / ANO LIBERAÇÃO como competência;
      - converte qtd_planejada de tubetes para caixas.
    """
    entradas_linha: dict[str, dict[int, float]] = {linha: {} for linha in LINHAS}

    if not rodada_id:
        return entradas_linha

    try:
        etapas = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada_id)
        )
    except Exception:
        return entradas_linha

    for row in etapas:
        mes_lib = _to_int(
            row.get("mes_liberacao")
            or row.get("mes_lib")
            or row.get("mes_producao")
            or row.get("mes")
        )
        ano_lib = _to_int(
            row.get("ano_liberacao")
            or row.get("ano_lib")
            or row.get("ano_producao")
            or row.get("ano"),
            _ano_atual(),
        )

        if ano_lib != _ano_atual() or not (1 <= mes_lib <= 12):
            continue

        etapa = str(row.get("etapa") or "").strip().upper()
        if etapa and etapa not in {"ENVASE", "PRODUCAO", "PRODUÇÃO"}:
            continue

        recurso = row.get("recurso") or row.get("linha_origem") or row.get("linha")
        linha = _linha_from_recurso(recurso)
        if linha not in LINHAS:
            continue

        produto = str(
            row.get("descricao_produto")
            or row.get("produto")
            or row.get("grupo")
            or ""
        ).strip().upper()
        codigo = str(
            row.get("codigo_produto")
            or row.get("cod_produto")
            or ""
        ).strip().upper()

        if produto in {"TOTAL", "TOTAIS"} or codigo in {"TOTAL", "TOTAIS"}:
            continue
        if "AG AVULSO" in produto or produto == "AVULSO":
            continue

        qtd_tubetes = _to_float(
            row.get("qtd_planejada")
            or row.get("quantidade")
            or row.get("qtd")
        )
        if qtd_tubetes <= 0:
            continue

        entradas_linha[linha][mes_lib] = (
            entradas_linha[linha].get(mes_lib, 0.0)
            + (qtd_tubetes / TUBETES_POR_CAIXA)
        )

    return entradas_linha




def _parse_data_overview(value):
    if not value:
        return None
    texto = str(value).strip()
    if not texto:
        return None
    try:
        return date.fromisoformat(texto[:10])
    except Exception:
        pass
    try:
        partes = texto[:10].split("/")
        if len(partes) == 3:
            dia, mes, ano = [int(x) for x in partes]
            return date(ano, mes, dia)
    except Exception:
        pass
    return None


def _normaliza_lote_overview(value) -> str:
    return str(value or "").strip().upper()


def _normaliza_texto_overview(value) -> str:
    texto = str(value or "").strip().upper()
    if not texto:
        return ""
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", texto)


def _primeiro_valor_overview(row: dict, campos: list[str]):
    for campo in campos:
        valor = row.get(campo)
        if valor is not None and str(valor).strip() != "":
            return valor
    return None


def _competencia_liberacao_overview(row: dict) -> tuple[int | None, int | None]:
    mes = _to_int(
        row.get("mes_liberacao")
        or row.get("mes_lib")
        or row.get("mes_competencia_liberacao")
        or row.get("mes_producao")
        or row.get("mes"),
        None,
    )
    ano = _to_int(
        row.get("ano_liberacao")
        or row.get("ano_lib")
        or row.get("ano_competencia_liberacao")
        or row.get("ano_producao")
        or row.get("ano"),
        _ano_atual(),
    )
    if not mes:
        data_ref = _parse_data_overview(
            row.get("data_pa")
            or row.get("data_liberacao")
            or row.get("data_liberacao_prevista")
            or row.get("dt_liberacao")
            or row.get("data_prevista_liberacao")
        )
        if data_ref:
            mes = data_ref.month
            ano = data_ref.year
    return mes, ano


def _is_etapa_plano_overview(row: dict) -> bool:
    etapa = _normaliza_texto_overview(row.get("etapa"))
    if not etapa:
        return True
    if etapa in {"ENVASE", "PRODUCAO", "PRODUÇÃO", "LIBERACAO", "LIBERAÇÃO", "MPS", "PLANO"}:
        return True
    return any(p in etapa for p in ["ENVASE", "PRODU", "LIBERA"])


def _qtd_planejada_cx_overview(row: dict) -> float:
    qtd_raw = _primeiro_valor_overview(row, [
        "qtd_planejada",
        "quantidade",
        "qtd",
        "qtd_tubetes",
        "tubetes",
    ])
    qtd = _to_float(qtd_raw)
    if qtd <= 0:
        return 0.0

    # f_mrp_etapas geralmente salva em tubetes. Quando vier uma base antiga em cx,
    # deixa o número pequeno passar como caixas.
    if qtd > 10000:
        return qtd / TUBETES_POR_CAIXA
    return qtd


def _linha_from_mrp_row_overview(row: dict) -> str | None:
    recurso = _primeiro_valor_overview(row, [
        "recurso",
        "linha_origem",
        "linha",
        "linha_producao",
        "equipamento",
        "maquina",
    ])
    linha = _linha_from_recurso(recurso)
    if linha in LINHAS:
        return linha

    texto = str(recurso or "").strip().upper()
    if texto in LINHAS:
        return texto

    lote = _normaliza_lote_overview(_primeiro_valor_overview(row, [
        "lote",
        "lote_op",
        "numero_lote",
        "num_lote",
        "ordem",
        "op",
        "ordem_producao",
    ]))
    return _linha_from_lote(lote)


def _montar_lotes_mrp_overview(rodada: dict | None) -> dict[str, dict]:
    """Mapa lote -> dados agregados por lote para uma rodada do MPS/Gantt."""
    if not rodada or not rodada.get("id"):
        return {}

    try:
        etapas = _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada.get("id"))
        )
    except Exception:
        return {}

    por_lote: dict[str, dict] = {}

    for row in etapas:
        if not _is_etapa_plano_overview(row):
            continue

        mes_lib, ano_lib = _competencia_liberacao_overview(row)
        if ano_lib != _ano_atual() or not mes_lib or not (1 <= mes_lib <= 12):
            continue

        linha = _linha_from_mrp_row_overview(row)
        if linha not in LINHAS:
            continue

        lote = _normaliza_lote_overview(_primeiro_valor_overview(row, [
            "lote",
            "lote_op",
            "numero_lote",
            "num_lote",
            "ordem",
            "op",
            "ordem_producao",
        ]))
        if not lote:
            continue

        produto_txt = _normaliza_texto_overview(
            row.get("descricao_produto") or row.get("produto") or row.get("grupo")
        )
        codigo_txt = _normalize_cod_produto(
            row.get("codigo_produto") or row.get("cod_produto") or row.get("sku")
        )
        if produto_txt in {"TOTAL", "TOTAIS"} or codigo_txt in {"TOTAL", "TOTAIS"}:
            continue
        if "AG AVULSO" in produto_txt or produto_txt == "AVULSO":
            continue

        qtd_cx = _qtd_planejada_cx_overview(row)
        if qtd_cx <= 0:
            continue

        item = por_lote.get(lote)
        if not item:
            item = {
                "lote": lote,
                "linha": linha,
                "mes": mes_lib,
                "ano": ano_lib,
                "qtd_cx": 0.0,
            }
            por_lote[lote] = item

        item["qtd_cx"] += qtd_cx

        # Se houver duplicidade entre etapas, mantém a competência mais baixa do lote.
        if mes_lib < _to_int(item.get("mes"), mes_lib):
            item["mes"] = mes_lib
            item["ano"] = ano_lib

    return por_lote


def _eh_reprovacao_descarte_overview(row: dict) -> bool:
    texto = " ".join([
        _normaliza_texto_overview(row.get("destino")),
        _normaliza_texto_overview(row.get("estado")),
        _normaliza_texto_overview(row.get("titulo")),
    ])
    return any(termo in texto for termo in [
        "REPROV",
        "DESCART",
        "DESCARTE",
        "REJEIT",
        "SUCATA",
        "DESTRUI",
    ])


def _rows_desvios_snapshot_atual_overview() -> list[dict]:
    """
    Fonte oficial da Overview/Rastreamento para desvios atuais.

    Esta função replica a regra da página Monitor de Desvios > Desvios atuais:
    - lê a última fotografia carregada em desvios_snapshots;
    - retorna somente as linhas do snapshot_id mais recente;
    - NÃO lê histórico antigo;
    - NÃO mantém fallback de desvio fechado.

    Se amanhã um desvio sair da carga atual, ele sai daqui e some da Overview.
    """
    try:
        snapshots = _select_all(
            supabase.table("desvios_snapshots")
            .select("snapshot_id, lote, serial, titulo, setor, estado, dias_desvio, destino, data_upload")
            .order("data_upload", desc=True)
        )
    except Exception:
        return []

    if not snapshots:
        return []

    snapshot_id_atual = snapshots[0].get("snapshot_id")

    if not snapshot_id_atual:
        return snapshots

    return [
        r for r in snapshots
        if r.get("snapshot_id") == snapshot_id_atual
    ]


def _lotes_reprovacao_desvio_overview() -> set[str]:
    """
    Lotes com reprovação/descarte na posição ATUAL da aba de desvios.

    Usa somente a última fotografia de desvios_snapshots, que é a mesma fonte
    da página de Desvios atuais.
    """
    lotes: set[str] = set()

    rows = _rows_desvios_snapshot_atual_overview()

    for r in rows:
        lote = _normaliza_lote_overview(r.get("lote"))
        if lote and _eh_reprovacao_descarte_overview(r):
            lotes.add(lote)

    return lotes


def _sd3_lote_mes_atual_overview() -> dict[str, float]:
    try:
        rows = _select_all(
            supabase.table("f_sd3_entradas")
            .select("lote, quantidade, mes, ano")
            .eq("ano", _ano_atual())
            .eq("mes", _mes_atual())
        )
    except Exception:
        return {}

    por_lote: dict[str, float] = {}
    for r in rows:
        lote = _normaliza_lote_overview(r.get("lote"))
        if not lote:
            continue
        por_lote[lote] = por_lote.get(lote, 0.0) + _to_float(r.get("quantidade"))
    return por_lote


def _estoque_quarentena_por_lote() -> dict[str, float]:
    """
    Saldo em quarentena (armazém 98 da SB8/f_estoque_saldo) por lote, no
    snapshot mais recente disponível.

    Usado pro Rastreamento de Lotes: um lote que já passou por
    envase/embalagem e está fisicamente parado em quarentena (aguardando
    liberação/CQ) já tem o rendimento real conhecido -- é diferente de um
    lote ainda em produção, que só tem a quantidade PLANEJADA como
    estimativa. Contar o planejado pra um lote já em quarentena ignora
    perda/ganho de rendimento que já aconteceu de verdade e só ainda não
    foi lançada como liberação formal.

    Nunca levanta exceção -- se a tabela falhar por qualquer motivo, o
    resto do cálculo segue normalmente sem esse ajuste (usa o planejado).
    """
    try:
        ultima_data_ref = (
            supabase.table("f_estoque_saldo")
            .select("data_ref")
            .eq("armazem", "98")
            .order("data_ref", desc=True)
            .limit(1)
            .execute()
        )
        rows_data_ref = ultima_data_ref.data or []
        if not rows_data_ref:
            return {}
        data_ref_mais_recente = rows_data_ref[0].get("data_ref")

        rows = _select_all(
            supabase.table("f_estoque_saldo")
            .select("lote, saldo_lote")
            .eq("armazem", "98")
            .eq("data_ref", data_ref_mais_recente)
        )
    except Exception:
        return {}

    por_lote: dict[str, float] = {}
    for r in rows:
        lote = _normaliza_lote_overview(r.get("lote"))
        if not lote:
            continue
        por_lote[lote] = por_lote.get(lote, 0.0) + _to_float(r.get("saldo_lote"))
    return por_lote


# ────────────────────────────────────────────────────────────
# Cache passivo do total "Plano atualizado" já reconciliado do mês atual
# (mesma conta do card do Rastreamento de Lotes / Ver conciliação).
#
# _planejamento_liberacao_mes_atual_ajustado_por_linha() soma por LINHA, direto
# das rodadas de MRP -- caminho de dado separado da reconciliação por LOTE
# usada em get_rastreamento_lotes(), então os dois podem divergir por 1 cx de
# arredondamento (ex.: gráfico "Demanda vs Disponibilidade" em 16.874 vs o
# card já reconciliado em 16.873).
#
# IMPORTANTE (aprendido na marra): get_rastreamento_lotes() é uma função pesada
# (~2200 linhas, várias consultas). Chamá-la de dentro de uma requisição normal
# (ex.: toda vez que a Overview monta o gráfico) já causou uma instabilidade
# real em produção -- números errados aparecendo por causa da carga extra.
# Por isso este cache é só de LEITURA aqui: quem escreve nele é exclusivamente
# a thread de aquecimento em background (ver app/main.py), nunca uma
# requisição de usuário. Se ainda não tiver rodado (ex.: logo depois de um
# deploy), a leitura simplesmente não encontra nada e a função segue com o
# total bruto por linha, sem ajuste -- nunca trava esperando, nunca quebra.
_MES_ATUAL_RECONCILIADO_CACHE: dict = {"chave": None, "valor": None}
_MES_ATUAL_RECONCILIADO_LOCK = Lock()


def _versao_reconciliacao_mes_atual() -> str:
    """
    Versão leve dos dados que afetam o valor reconciliado do mês atual.

    Antes, a chave desse cache era só "{ano}-{mes}" -- sem nenhuma noção de
    versão de dado. Isso fazia o valor "Plano atualizado" (usado na barra do
    mês atual do gráfico Demanda vs Disponibilidade) ficar congelado com o
    valor de antes de um upload novo de SD3 até a thread de aquecimento em
    background rodar de novo (que pode demorar), mesmo com o Rastreamento de
    Lotes já mostrando o dado certo (esse sim, versionado corretamente desde
    o fix em _versao_dados_rastreamento_lotes). Reaproveita a mesma fonte de
    versão (upload_log) já usada lá.
    """
    versions = _rastreamento_upload_versions()
    return "|".join(f"{base}:{versions.get(base) or '-'}" for base in RASTREAMENTO_CACHE_BASES)


def atualizar_cache_reconciliacao_mes_atual() -> Optional[float]:
    """
    Recalcula e guarda o valor reconciliado do mês atual (só em memória,
    local a este processo -- NÃO grava na tabela cache_overview).

    Chamado SÓ pela thread de aquecimento em background (app/main.py), nunca
    dentro de uma requisição HTTP normal -- ver aviso acima.

    Importante (decisão consciente): cheguei a fazer essa função reaproveitar
    recalcular_cache_rastreamento_lotes (que grava o payload inteiro na
    tabela cache_overview do Supabase) pra também esquentar o cache oficial
    do painel "Lotes de [mês]". Revertido: isso faz a thread de background
    escrever um payload grande no banco a cada poucos minutos, competindo
    pela mesma conexão HTTP/2 compartilhada com requisições de usuários reais
    -- justamente o tipo de concorrência que dispara o bug intermitente do
    httpx/HTTP2 (KeyError em _response_closed). Prefiro manter esta função
    só de LEITURA (sem escrita extra no banco), aceitando que o painel de
    lotes continue esquentando do jeito antigo, a correr esse risco.
    """
    chave = f"{_ano_atual()}-{_mes_atual()}-{_versao_reconciliacao_mes_atual()}"
    valor = None

    for tentativa in range(3):
        try:
            # Mesmo motivo do fix em _planejamento_liberacao_mes_atual_ajustado_por_linha:
            # force=False precisa vir explícito, senão essa chamada direta
            # (fora de uma requisição HTTP) recebe o objeto Query(...) cru
            # como valor de "force" -- que é "verdadeiro" em Python, fazendo
            # o cache ser ignorado e recalculando tudo do zero (pesado) a
            # cada 30s, pra sempre, sem necessidade nenhuma.
            rastreamento = get_rastreamento_lotes(mes=None, ano=None, force=False)
            valor_bruto = rastreamento.get("mes_cx_plano_atual_tendencia")
            valor = float(valor_bruto) if valor_bruto is not None else None
            break
        except Exception:
            valor = None
            if tentativa < 2:
                time.sleep(2)

    if valor is not None:
        with _MES_ATUAL_RECONCILIADO_LOCK:
            _MES_ATUAL_RECONCILIADO_CACHE["chave"] = chave
            _MES_ATUAL_RECONCILIADO_CACHE["valor"] = valor

    return valor


def _ler_cache_reconciliacao_mes_atual() -> Optional[float]:
    """Leitura pura, sem calcular nada -- segura pra chamar de dentro de
    qualquer requisição (é só um dict.get()). Agora exige que a versão dos
    dados bata também, não só ano/mês -- ver _versao_reconciliacao_mes_atual."""
    chave_esperada = f"{_ano_atual()}-{_mes_atual()}-{_versao_reconciliacao_mes_atual()}"
    with _MES_ATUAL_RECONCILIADO_LOCK:
        if _MES_ATUAL_RECONCILIADO_CACHE.get("chave") != chave_esperada:
            return None
        return _MES_ATUAL_RECONCILIADO_CACHE.get("valor")


def _planejamento_liberacao_mes_atual_ajustado_por_linha() -> dict[str, float]:
    """
    Valor correto do mês atual para a Overview, por linha (L1/L2).

    Antes, essa função tinha sua PRÓPRIA leitura de MRP/SD3 (via
    _montar_lotes_mrp_overview + _sd3_lote_mes_atual_overview), separada da
    lista oficial de lotes usada pelo Rastreamento de Lotes/card "Plano
    Atualizado" (get_rastreamento_lotes). As duas fontes divergiam --
    principalmente pra lotes atrasados de meses anteriores que a tabela
    oficial "puxa" pro mês atual (via rows_gantt_ano_atual_global) mas que
    essa função aqui nunca via, porque filtrava estritamente por
    mes/ano == mês atual na rodada. Isso fazia o total agregado bater
    (via ajuste por delta), mas a ABERTURA por linha (L1/L2) ficar errada,
    porque o delta de reconciliação era jogado inteiro numa única linha,
    mesmo quando a causa real (lote atrasado, observação manual, promoção)
    era de outra linha.

    Agora deriva a conta por linha da MESMA lista de lotes que
    get_rastreamento_lotes() usa e retorna (campo "lotes") -- é
    literalmente a mesma fonte que gera mes_cx_plano_atual_tendencia, então
    total e composição por linha nunca mais divergem por construção.
    """
    try:
        # Mesmo cuidado de sempre: force=False explícito (ver comentário
        # histórico abaixo, no bloco de fallback) evita o bug de Query(...)
        # cru quando chamada direto em Python.
        rastreamento_atual = get_rastreamento_lotes(mes=None, ano=None, force=False)
    except Exception:
        rastreamento_atual = None

    if not rastreamento_atual:
        return {}

    lotes_do_mes = rastreamento_atual.get("lotes") or []
    if not lotes_do_mes:
        return {}

    totais = {linha: 0.0 for linha in LINHAS}

    for item in lotes_do_mes:
        lote = item.get("lote")
        linha = item.get("linha") if item.get("linha") in LINHAS else _linha_from_lote(lote)
        if linha not in LINHAS:
            continue

        # Observação manual ativa ou promovido pra outro mês: já saiu da
        # conta padrão do mês (foi pro card "Outros"/pro mês de destino) --
        # não conta aqui, senão contaria 2x (uma vez em "Outros", outra vez
        # aqui como se ainda fosse pendência normal do mês).
        if item.get("observacao_manual") or item.get("promovido_para"):
            continue

        # Reprovado/descartado: já é perda contabilizada à parte
        # (reprovação/desvio), nunca conta como pendência normal do mês.
        if item.get("desvio_reprovacao"):
            continue

        if item.get("check_liberado"):
            totais[linha] += _to_float(item.get("qtd_liberada_cx"))
        else:
            # Usa qtd_tendencia_atual_cx (não qtd_prevista_cx): reflete o
            # plano atual de verdade, incluindo a troca por saldo de
            # quarentena quando o lote já estiver fisicamente parado lá
            # (ver _estoque_quarentena_por_lote) -- qtd_prevista_cx fica
            # reservado pro V1 congelado, nunca deve mudar por isso. Cobre
            # tanto o lote normal do mês quanto o promovido PRA DENTRO
            # (migration 010), que já vem com esse campo preenchido igual.
            totais[linha] += _to_float(item.get("qtd_tendencia_atual_cx"))

    # Rede de segurança: se ainda sobrar uma diferença pequena (ex.:
    # arredondamento, ou alguma causa de "outros" que não é por lote
    # individual) entre a soma por linha e o valor oficial do card, distribui
    # PROPORCIONALMENTE entre as linhas com valor -- nunca joga tudo numa
    # linha só, que foi exatamente o bug que fazia o tooltip "Abertura por
    # linha" mostrar número de uma linha completamente errado.
    total_bruto_linhas = sum(totais.values())
    valor_reconciliado = rastreamento_atual.get("mes_cx_plano_atual_tendencia")
    valor_reconciliado = float(valor_reconciliado) if valor_reconciliado is not None else None

    if valor_reconciliado is not None and total_bruto_linhas > 0:
        delta = round(valor_reconciliado) - round(total_bruto_linhas)
        if delta != 0:
            for linha in LINHAS:
                parte = delta * (totais[linha] / total_bruto_linhas)
                totais[linha] = max(totais[linha] + parte, 0.0)

    return totais

def _entradas_previstas_mrp_por_linha() -> dict[str, dict[int, float]]:
    """
    Entradas projetadas da Overview vindas da mesma lógica da tela MPS.

    Regra consolidada:
      - mês atual: usa plano atualizado AJUSTADO (real dos lotes do MPS + saldo do MPS - perdas/desvios);
      - meses futuros: usa a última versão da rodada do mês atual, lendo os meses futuros dentro dela.

    Isso evita que gráficos por linha continuem mostrando o valor bruto da V1
    no mês atual, como L1 + L2 = 6.884 cx em Jun/2026.
    """
    rodada = _buscar_rodada_mrp_atual()
    entradas = _agregar_etapas_mrp_por_rodada_id(rodada.get("id") if rodada else None)

    # Força o mês atual em TODOS os gráficos/consumos da Overview a usar o mesmo
    # valor ajustado do Rastreamento, e não o MPS bruto/V1.
    ajustado_mes_atual = _planejamento_liberacao_mes_atual_ajustado_por_linha()
    if ajustado_mes_atual:
        for linha in LINHAS:
            entradas.setdefault(linha, {})[_mes_atual()] = ajustado_mes_atual.get(linha, 0.0)

    return entradas



def _selecionar_rodadas_mrp_por_mes() -> tuple[dict[int, dict], dict[int, dict], dict | None]:
    """
    Seleciona as rodadas do Gantt/MPS seguindo a mesma regra lógica da Overview:

      - meses fechados: usa a maior versão da revisão do próprio mês;
      - V1: usa a versão 1 da revisão do próprio mês, quando existir;
      - mês atual e futuros: usa a rodada atual da Overview
        (última versão da rodada do mês atual/analisado, conforme _buscar_rodada_mrp_atual).

    Retorna:
      latest_por_mes, v1_por_mes, rodada_atual
    """
    try:
        rodadas = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", _ano_atual())
        )
    except Exception:
        return {}, {}, None

    latest_por_mes: dict[int, dict] = {}
    v1_por_mes: dict[int, dict] = {}

    for r in rodadas:
        mes_revisao = _to_int(r.get("mes"))
        versao = _versao_num(r.get("versao"))

        if not r.get("id") or not (1 <= mes_revisao <= 12) or versao <= 0:
            continue

        atual = latest_por_mes.get(mes_revisao)
        if (
            not atual
            or versao > _versao_num(atual.get("versao"))
            or (
                versao == _versao_num(atual.get("versao"))
                and str(r.get("criado_em") or r.get("created_at") or "")
                > str(atual.get("criado_em") or atual.get("created_at") or "")
            )
        ):
            latest_por_mes[mes_revisao] = r

        if versao == 1:
            atual_v1 = v1_por_mes.get(mes_revisao)
            if (
                not atual_v1
                or str(r.get("criado_em") or r.get("created_at") or "")
                > str(atual_v1.get("criado_em") or atual_v1.get("created_at") or "")
            ):
                v1_por_mes[mes_revisao] = r

    return latest_por_mes, v1_por_mes, _buscar_rodada_mrp_atual()


def _rodada_label(rodada: dict | None) -> str | None:
    if not rodada:
        return None

    mes = _to_int(rodada.get("mes"))
    versao = _versao_num(rodada.get("versao"))

    if not (1 <= mes <= 12) or versao <= 0:
        return None

    return f"{MES_LABELS[mes - 1]}/V{versao}"


def _planejamento_liberacoes_para_modal():
    """
    Planejamento do modal de Liberações Reais + Previstas.

    Fonte principal:
      Gantt/MPS versionado (f_mrp_rodadas + f_mrp_etapas).

    Regra:
      - meses fechados: revisão do próprio mês, maior versão;
      - mês atual e futuros: rodada atual da Overview;
      - V1: revisão do próprio mês, versão 1, quando existir;
      - fallback: f_entradas_previstas somente se ainda não houver Gantt/MPS
        para aquele mês/linha.
    """
    fallback = _get_entradas_previstas_fallback()

    latest_por_mes, v1_por_mes, rodada_atual = _selecionar_rodadas_mrp_por_mes()
    planejado_mes_atual_ajustado = _planejamento_liberacao_mes_atual_ajustado_por_linha()

    cache_rodada: dict[str, dict[str, dict[int, float]]] = {}

    def valores_rodada(rodada: dict | None) -> dict[str, dict[int, float]]:
        rodada_id = str(rodada.get("id")) if rodada and rodada.get("id") else ""

        if not rodada_id:
            return {linha: {} for linha in LINHAS}

        if rodada_id not in cache_rodada:
            cache_rodada[rodada_id] = _agregar_etapas_mrp_por_rodada_id(rodada_id)

        return cache_rodada[rodada_id]

    planejado_linha = {linha: {} for linha in LINHAS}
    planejado_v1_linha = {linha: {} for linha in LINHAS}
    versao_planejada_linha = {linha: {} for linha in LINHAS}

    for mes in range(1, 13):
        if mes >= _mes_atual() and rodada_atual is not None:
            rodada_planejada = rodada_atual
        else:
            rodada_planejada = latest_por_mes.get(mes)

        rodada_v1 = v1_por_mes.get(mes) if mes <= _mes_atual() else None

        valores_planejados = valores_rodada(rodada_planejada)
        valores_v1 = valores_rodada(rodada_v1)

        versao_label = _rodada_label(rodada_planejada)

        for linha in LINHAS:
            planejado = valores_planejados.get(linha, {}).get(mes, 0.0)
            planejado_v1 = valores_v1.get(linha, {}).get(mes, 0.0)

            if mes == _mes_atual() and planejado_mes_atual_ajustado:
                planejado = planejado_mes_atual_ajustado.get(linha, 0.0)
                versao_label_linha = f"{versao_label} ajustado" if versao_label else "MPS atual ajustado"
            elif planejado <= 0:
                planejado = fallback[linha].get(mes, 0.0)
                planejado_v1 = 0.0
                versao_label_linha = None
            else:
                versao_label_linha = versao_label

            planejado_linha[linha][mes] = planejado
            planejado_v1_linha[linha][mes] = planejado_v1
            versao_planejada_linha[linha][mes] = versao_label_linha

    return planejado_linha, planejado_v1_linha, versao_planejada_linha



def _entradas_previstas_para_disponibilidade_por_linha() -> dict[str, dict[int, float]]:
    """
    Barras cinzas futuras da Overview.

    Meses fechados continuam usando SD3 real. Para mês atual/futuros, a fonte
    correta é a mesma da tela MPS: f_mrp_rodadas + f_mrp_etapas, sempre pela
    última versão da rodada do mês atual/analisado.
    """
    fallback = _get_entradas_previstas_fallback()
    entradas_mrp = _entradas_previstas_mrp_por_linha()
    planejado_mes_atual_ajustado = _planejamento_liberacao_mes_atual_ajustado_por_linha()

    entradas_linha: dict[str, dict[int, float]] = {linha: {} for linha in LINHAS}

    for mes in range(1, 13):
        for linha in LINHAS:
            qtd = 0.0

            if mes >= _mes_atual():
                if mes == _mes_atual() and planejado_mes_atual_ajustado:
                    qtd = planejado_mes_atual_ajustado.get(linha, 0.0)
                else:
                    qtd = entradas_mrp.get(linha, {}).get(mes, 0.0)

            if qtd <= 0:
                qtd = fallback[linha].get(mes, 0.0)

            entradas_linha[linha][mes] = qtd

    return entradas_linha


def _entradas_previstas_para_disponibilidade() -> dict[int, float]:
    entradas_linha = _entradas_previstas_para_disponibilidade_por_linha()

    return {
        mes: sum(entradas_linha[linha].get(mes, 0.0) for linha in LINHAS)
        for mes in range(1, 13)
    }


@router.get("/orcado-faturamento")
def get_orcado_faturamento(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    rows = _select_all(
        supabase.table("f_orcado_faturamento")
        .select("mes, ano, cod_produto, grupo, qtd_caixas")
        .eq("ano", _ano_atual())
    )
    rows = _filtrar_anestesicos_por_grupo_nome(rows, "grupo")

    total = sum(_to_float(r.get("qtd_caixas")) for r in rows)

    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("qtd_caixas"))

    return {
        "total_caixas": round(total),
        "total_tubetes": round(total * TUBETES_POR_CAIXA),
        "meses": [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())],
    }


@router.get("/orcado-faturamento-detalhe")
def get_orcado_faturamento_detalhe(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    produtos = _select_all(
        supabase.table("d_produtos")
        .select("cod_produto, grupo")
    )

    grupo_oficial = {
        _normalize_cod_produto(p.get("cod_produto")): str(p.get("grupo") or "Sem grupo").strip()
        for p in produtos
        if _normalize_cod_produto(p.get("cod_produto"))
    }

    rows = _select_all(
        supabase.table("f_orcado_faturamento")
        .select("cod_produto, mes, ano, grupo, qtd_caixas")
        .eq("ano", _ano_atual())
    )
    rows = _filtrar_anestesicos_por_grupo_nome(rows, "grupo")

    grupos: dict[str, float] = {}
    meses_grupos: dict[int, dict[str, float]] = {}
    total = 0.0
    produtos_sem_dimensao: set[str] = set()

    for r in rows:
        cod_produto = _normalize_cod_produto(r.get("cod_produto"))
        grupo = grupo_oficial.get(cod_produto)

        if not grupo:
            grupo = str(r.get("grupo") or "Sem grupo").strip() or "Sem grupo"
            if cod_produto:
                produtos_sem_dimensao.add(cod_produto)

        mes = int(r["mes"])
        qtd = _to_float(r.get("qtd_caixas"))

        total += qtd
        grupos[grupo] = grupos.get(grupo, 0.0) + qtd

        if mes not in meses_grupos:
            meses_grupos[mes] = {}
        meses_grupos[mes][grupo] = meses_grupos[mes].get(grupo, 0.0) + qtd

    ranking_pairs = sorted(grupos.items(), key=lambda x: x[1], reverse=True)
    ranking = [
        {
            "grupo": grupo,
            "qtd_caixas": round(qtd),
            "pct": round(qtd / total * 100, 1) if total else 0,
        }
        for grupo, qtd in ranking_pairs
    ]
    grupos_ordenados = [r["grupo"] for r in ranking]

    meses_list = []
    for mes in range(1, 13):
        entry = {"mes": mes}
        for grupo in grupos_ordenados:
            entry[grupo] = round(meses_grupos.get(mes, {}).get(grupo, 0.0))
        meses_list.append(entry)

    return {
        "total_caixas": round(total),
        "qtd_grupos": len(grupos_ordenados),
        "top_grupo": ranking[0] if ranking else None,
        "ranking_grupos": ranking,
        "meses": meses_list,
        "grupos": grupos_ordenados,
        "debug_produtos_sem_dimensao": sorted(produtos_sem_dimensao),
    }


@router.get("/projecao-faturamento")
def get_projecao_faturamento(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    """
    Card Faturamento Real + S&OP.

    Regra correta da Overview:
      - Meses anteriores ao mês atual: usa SD2 realizado.
      - Mês atual e meses futuros: usa Forecast S&OP.

    Assim, quando vira o mês e ainda não existe SD2 do mês novo,
    o card não fica "aguardando base". Ele fecha Jan-Mês anterior com SD2
    e projeta mês atual-Dez com Forecast.
    """
    ultimo_mes_fechado = _mes_atual() - 1
    mes_inicio_forecast = _mes_atual()

    rows_sd2 = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, produto, grupo, quantidade")
        .eq("ano", _ano_atual())
    )
    rows_fc = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, cod_produto, grupo, qtd_forecast")
        .eq("ano", _ano_atual())
    )
    rows_orc = _select_all(
        supabase.table("f_orcado_faturamento")
        .select("mes, ano, cod_produto, grupo, qtd_caixas")
        .eq("ano", _ano_atual())
    )

    rows_sd2 = _filtrar_anestesicos_por_grupo_codigo(rows_sd2, "grupo")
    rows_fc = _filtrar_anestesicos_por_grupo_nome(rows_fc, "grupo")
    rows_orc = _filtrar_anestesicos_por_grupo_nome(rows_orc, "grupo")

    real: dict[int, float] = {}
    for r in rows_sd2:
        mes = _to_int(r.get("mes"))
        if not (1 <= mes <= 12):
            continue
        real[mes] = real.get(mes, 0.0) + _to_float(r.get("quantidade"))

    forecast: dict[int, float] = {}
    for r in rows_fc:
        mes = _to_int(r.get("mes"))
        if not (1 <= mes <= 12):
            continue
        forecast[mes] = forecast.get(mes, 0.0) + _to_float(r.get("qtd_forecast"))

    orcado: dict[int, float] = {}
    for r in rows_orc:
        mes = _to_int(r.get("mes"))
        if not (1 <= mes <= 12):
            continue
        orcado[mes] = orcado.get(mes, 0.0) + _to_float(r.get("qtd_caixas"))

    # Para trás = SD2. Mês atual em diante = Forecast S&OP.
    total_real = sum(
        qtd
        for mes, qtd in real.items()
        if mes <= ultimo_mes_fechado
    )
    total_real_mes_atual = real.get(_mes_atual(), 0.0)
    total_forecast = sum(
        qtd
        for mes, qtd in forecast.items()
        if mes >= mes_inicio_forecast
    )
    total_projetado = total_real + total_forecast
    total_orcado = sum(orcado.values())

    meses_list = []
    for mes in range(1, 13):
        meses_list.append({
            "mes": mes,
            "real": round(real.get(mes, 0.0)) if mes <= ultimo_mes_fechado else None,
            "real_mes_atual": round(real.get(mes, 0.0)) if mes == _mes_atual() else None,
            "forecast": round(forecast.get(mes, 0.0)) if mes >= mes_inicio_forecast else None,
            "orcado": round(orcado.get(mes, 0.0)),
        })

    return {
        "total_real": round(total_real),
        "total_real_mes_atual": round(total_real_mes_atual),
        "total_forecast": round(total_forecast),
        "total_projetado": round(total_projetado),
        "total_orcado": round(total_orcado),
        "pct_atingimento": round(total_projetado / total_orcado * 100, 1) if total_orcado else 0,
        "delta_caixas": round(total_projetado - total_orcado),
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "mes_atual": _mes_atual(),
        "mes_inicio_forecast": mes_inicio_forecast,
        "meses": meses_list,
    }


@router.get("/orcado-liberacao")
def get_orcado_liberacao():
    rows = _select_all(
        supabase.table("f_orcado_liberacao")
        .select("*")
        .eq("ano", _ano_atual())
    )

    meses: dict[int, dict] = {}
    heranca = {"L1": 0.0, "L2": 0.0}

    for r in rows:
        mes = int(r["mes"])
        linha = str(r["linha"])
        qtd = _to_float(r.get("qtd_tubetes"))

        if r.get("heranca_2025"):
            heranca[linha] += qtd
        else:
            if mes not in meses:
                meses[mes] = {"mes": mes, "L1": 0.0, "L2": 0.0}
            meses[mes][linha] += qtd

    for linha, qtd in heranca.items():
        if 1 not in meses:
            meses[1] = {"mes": 1, "L1": 0.0, "L2": 0.0}
        meses[1][linha] += qtd
        meses[1][f"{linha}_heranca"] = qtd

    resultado = sorted(meses.values(), key=lambda x: x["mes"])
    total_l1 = sum(_to_float(m.get("L1")) for m in resultado)
    total_l2 = sum(_to_float(m.get("L2")) for m in resultado)
    heranca_total = heranca["L1"] + heranca["L2"]
    total_tubetes = total_l1 + total_l2

    return {
        "meses": resultado,
        "total_l1_tubetes": total_l1,
        "total_l2_tubetes": total_l2,
        "total_tubetes": total_tubetes,
        "total_l1_caixas": round(total_l1 / TUBETES_POR_CAIXA),
        "total_l2_caixas": round(total_l2 / TUBETES_POR_CAIXA),
        "total_caixas": round(total_tubetes / TUBETES_POR_CAIXA),
        "heranca_2025_tubetes": heranca_total,
        "heranca_2025_caixas": round(heranca_total / TUBETES_POR_CAIXA),
        "producao_2026_caixas": round((total_tubetes - heranca_total) / TUBETES_POR_CAIXA),
    }


@router.get("/projecao-liberacoes")
def get_projecao_liberacoes():
    """
    Dados do modal "Liberações Reais + Previstas".

    Antes, esta rota recalculava tudo do zero a cada abertura do modal --
    inclusive puxando o ano inteiro de f_sd3_entradas linha por linha --
    mesmo esse MESMO cálculo já sendo feito e cacheado como parte do
    payload de /overview/resumo (ver _montar_payload_overview_resumo).
    Isso deixava o modal visivelmente lento, principalmente em horários
    de maior carga no servidor (ex.: sincronização pesada da Cogtive).

    Agora: se o cache da Overview estiver atual (mesma checagem de
    versão usada em GET /overview/resumo), serve o campo
    "projecao_liberacoes" desse cache direto -- sem nenhuma consulta ao
    banco, resposta quase instantânea. Só recalcula do zero (mesmo
    resultado de antes, só mais lento) se o cache estiver ausente ou
    desatualizado -- então a confiabilidade dos números não muda em
    nada, só passa a ser servida via cache quando o cache já está válido
    de qualquer forma para a Overview.
    """
    versao_base, _versions = _overview_cache_version()
    cache = _read_cache_overview()

    if cache and cache.get("payload") is not None and cache.get("versao_base") == versao_base:
        projecao_cacheada = (cache.get("payload") or {}).get("projecao_liberacoes")
        if projecao_cacheada is not None:
            return projecao_cacheada

    return _calcular_projecao_liberacoes()


def _calcular_projecao_liberacoes() -> dict:
    ultimo_mes_fechado = _mes_atual() - 1

    rows_sd3 = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, quantidade, lote")
        .eq("ano", _ano_atual())
    )

    rows_orc = _select_all(
        supabase.table("f_orcado_liberacao")
        .select("mes, ano, linha, qtd_tubetes")
        .eq("ano", _ano_atual())
    )

    real_linha = {linha: {} for linha in LINHAS}
    orcado_linha = {linha: {} for linha in LINHAS}

    planejado_linha, planejado_v1_linha, versao_planejada_linha = _planejamento_liberacoes_para_modal()

    # Garante que o gráfico de Liberações por linha use o Jun ajustado
    # (e não V1 bruto) no mês atual.
    planejado_mes_atual_ajustado = _planejamento_liberacao_mes_atual_ajustado_por_linha()
    if planejado_mes_atual_ajustado:
        for linha in LINHAS:
            planejado_linha.setdefault(linha, {})[_mes_atual()] = planejado_mes_atual_ajustado.get(linha, 0.0)
            versao_planejada_linha.setdefault(linha, {})[_mes_atual()] = "MPS atual ajustado"

    rodada_atual = _buscar_rodada_mrp_atual()
    versao_previsto_atual = _rodada_label(rodada_atual)

    for r in rows_sd3:
        linha = _linha_from_lote(r.get("lote"))
        if linha not in LINHAS:
            continue

        mes = int(r["mes"])
        real_linha[linha][mes] = real_linha[linha].get(mes, 0.0) + _to_float(r.get("quantidade"))

    for r in rows_orc:
        linha = str(r.get("linha") or "").strip().upper()
        if linha not in LINHAS:
            continue

        mes = int(r["mes"])
        qtd_caixas = _to_float(r.get("qtd_tubetes")) / TUBETES_POR_CAIXA
        orcado_linha[linha][mes] = orcado_linha[linha].get(mes, 0.0) + qtd_caixas

    total_real = sum(
        qtd
        for linha in LINHAS
        for mes, qtd in real_linha[linha].items()
        if mes <= ultimo_mes_fechado
    )

    total_real_mes_atual = sum(
        qtd
        for linha in LINHAS
        for mes, qtd in real_linha[linha].items()
        if mes == _mes_atual()
    )

    total_orcado = sum(
        qtd
        for linha in LINHAS
        for qtd in orcado_linha[linha].values()
    )

    meses_list = []
    linhas_list = []
    total_previsto = 0.0

    for mes in range(1, 13):
        real_mes = 0.0
        previsto_mes = 0.0
        orcado_mes = 0.0

        for linha in LINHAS:
            realizado = real_linha[linha].get(mes, 0.0)
            planejado = planejado_linha[linha].get(mes, 0.0)
            planejado_v1 = planejado_v1_linha[linha].get(mes, 0.0)
            versao_planejada = versao_planejada_linha[linha].get(mes)
            orcado = orcado_linha[linha].get(mes, 0.0)

            real_val = round(realizado) if mes <= ultimo_mes_fechado else None
            real_mes_atual_val = round(realizado) if mes == _mes_atual() else None
            previsto_val = round(planejado) if mes >= _mes_atual() else None

            atingimento = (
                round(realizado / planejado * 100, 1)
                if mes <= ultimo_mes_fechado and planejado
                else None
            )

            linhas_list.append({
                "mes": mes,
                "linha": linha,
                "realizado": real_val,
                "realizado_mes_atual": real_mes_atual_val,
                "planejado": round(planejado),
                "planejado_v1": round(planejado_v1) if planejado_v1 else None,
                "versao_planejada": versao_planejada,
                "previsto": previsto_val,
                "orcado": round(orcado),
                "atingimento": atingimento,
            })

            if mes <= ultimo_mes_fechado:
                real_mes += realizado

            if mes >= _mes_atual():
                previsto_mes += planejado
                total_previsto += planejado

            orcado_mes += orcado

        meses_list.append({
            "mes": mes,
            "real": round(real_mes) if mes <= ultimo_mes_fechado else None,
            "real_mes_atual": round(total_real_mes_atual) if mes == _mes_atual() else None,
            "previsto": round(previsto_mes) if mes >= _mes_atual() else None,
            "orcado": round(orcado_mes),
        })

    total_projetado_final = total_real + total_previsto

    realizado_label = (
        f"Jan – {MES_LABELS[ultimo_mes_fechado - 1]} fechado"
        if ultimo_mes_fechado >= 1
        else "Sem mês fechado"
    )
    previsto_label = f"{MES_LABELS[_mes_atual() - 1]} – Dez pelo Gantt/MPS"
    previsto_detalhe = (
        f"Fonte: Gantt/MPS versionado · {versao_previsto_atual}"
        if versao_previsto_atual
        else "Fonte: Gantt/MPS versionado"
    )

    return {
        "total_real": round(total_real),
        "total_real_mes_atual": round(total_real_mes_atual),
        "total_previsto": round(total_previsto),
        "total_projetado": round(total_projetado_final),
        "total_orcado": round(total_orcado),
        "pct_atingimento": round(total_projetado_final / total_orcado * 100, 1) if total_orcado else 0,
        "delta_caixas": round(total_projetado_final - total_orcado),
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "mes_atual": _mes_atual(),
        "mes_inicio_previsto": _mes_atual(),
        "fonte_previsto": "Gantt/MPS",
        "fonte_previsto_detalhe": previsto_detalhe,
        "versao_previsto_atual": versao_previsto_atual,
        "realizado_label": realizado_label,
        "previsto_label": previsto_label,
        "projecao_label": "Realizado + previsto",
        "meses": meses_list,
        "linhas": linhas_list,
    }



@router.get("/disponibilidade-mensal")
def get_disponibilidade_mensal(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
):
    mes_analise = mes or _mes_atual()
    ano_analise = ano or _ano_atual()
    ultimo_mes_fechado = mes_analise - 1

    produtos = _select_all(
        supabase.table("d_produtos")
        .select("cod_produto, grupo")
    )

    grupo_oficial = {
        _normalize_cod_produto(p.get("cod_produto")): str(p.get("grupo") or "Sem grupo").strip()
        for p in produtos
        if _normalize_cod_produto(p.get("cod_produto"))
    }

    def grupo_por_produto(cod_produto_raw, grupo_fallback=None, debug_set: set[str] | None = None) -> str:
        cod_produto = _normalize_cod_produto(cod_produto_raw)
        grupo = grupo_oficial.get(cod_produto)

        if grupo:
            return grupo

        if debug_set is not None and cod_produto:
            debug_set.add(cod_produto)

        fallback = str(grupo_fallback or "").strip()
        return fallback if fallback else "Sem grupo"

    def soma_dict(destino: dict[int, float], mes: int, qtd: float):
        destino[mes] = destino.get(mes, 0.0) + qtd

    def soma_grupo(destino: dict[int, dict[str, float]], mes: int, grupo: str, qtd: float):
        if mes not in destino:
            destino[mes] = {}
        destino[mes][grupo] = destino[mes].get(grupo, 0.0) + qtd

    def grupos_para_lista(grupos_raw: dict[str, float], total_forcado: float | None = None) -> list[dict]:
        positivos = {
            grupo: qtd
            for grupo, qtd in grupos_raw.items()
            if qtd > 0.0001
        }

        soma_positivos = sum(positivos.values())

        if total_forcado is not None and soma_positivos > 0:
            fator = max(total_forcado, 0.0) / soma_positivos
            positivos = {grupo: qtd * fator for grupo, qtd in positivos.items()}

        total = sum(positivos.values())

        return [
            {
                "grupo": grupo,
                "qtd_caixas": round(qtd),
                "pct": round(qtd / total * 100, 1) if total else 0,
            }
            for grupo, qtd in sorted(positivos.items(), key=lambda item: item[1], reverse=True)
        ]

    estoque_real, estoque_por_grupo_real, debug_estoque_inicial = _estoque_inicial_overview_por_mes(produtos, ano_base=ano_analise)

    rows_sd3 = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, produto, grupo, quantidade, lote")
        .eq("ano", ano_analise)
    )
    rows_sd2 = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, produto, grupo, quantidade")
        .eq("ano", ano_analise)
    )
    rows_forecast = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, cod_produto, grupo, qtd_forecast")
        .eq("ano", ano_analise)
    )

    # Liberação diária planejada — calcula Previsto até Hoje (MTD)
    rows_liberacao_diaria = _select_all(
        supabase.table("f_liberacao_diaria")
        .select("data_lib, grupo_produto, qtd_prevista")
        .eq("ano", ano_analise)
        .eq("mes", mes_analise)
    )

    # Overview fixa em anestésicos:
    # - estoque e SD3 já são processados como anestésicos nas bases específicas;
    # - SD2 é corporativa, então filtra por grupo numérico 0101 a 0116;
    # - forecast é corporativo, então filtra pelos grupos textuais dos anestésicos.
    rows_sd2 = _filtrar_anestesicos_por_grupo_codigo(rows_sd2, "grupo")
    rows_forecast = _filtrar_anestesicos_por_grupo_nome(rows_forecast, "grupo")

    # f_entradas_previstas por grupo para o mês atual
    rows_prev_grupo = _select_all(
        supabase.table("f_entradas_previstas")
        .select("mes, ano, grupo, qtd_caixas")
        .eq("ano", ano_analise)
        .eq("mes", mes_analise)
    )
    entradas_previstas_por_grupo_mes_atual: dict[str, float] = {}
    for r in rows_prev_grupo:
        grupo = str(r.get("grupo") or "Sem grupo").strip()
        qtd = _to_float(r.get("qtd_caixas"))
        entradas_previstas_por_grupo_mes_atual[grupo] = (
            entradas_previstas_por_grupo_mes_atual.get(grupo, 0.0) + qtd
        )

    entradas_reais: dict[int, float] = {}
    entradas_reais_por_grupo: dict[int, dict[str, float]] = {}
    entradas_reais_por_linha: dict[str, dict[int, float]] = {linha: {} for linha in LINHAS}

    entradas_previstas_por_linha = _entradas_previstas_para_disponibilidade_por_linha()

    # Segurança adicional: o mês atual na disponibilidade mensal também deve usar
    # o plano ajustado por linha. Isso corrige o detalhe que somava L1 + L2 = 6.884
    # para Jun/2026 mesmo depois de ajustar o card anual.
    ajustado_mes_atual_disp = _planejamento_liberacao_mes_atual_ajustado_por_linha()
    if ajustado_mes_atual_disp:
        for linha in LINHAS:
            entradas_previstas_por_linha.setdefault(linha, {})[_mes_atual()] = ajustado_mes_atual_disp.get(linha, 0.0)

    entradas_previstas = {
        mes: sum(entradas_previstas_por_linha[linha].get(mes, 0.0) for linha in LINHAS)
        for mes in range(1, 13)
    }

    # Garantia final, sem condição nenhuma no meio: o mês atual SEMPRE bate
    # com o card "Lotes de [mês]" (Rastreamento de Lotes), busca ao vivo,
    # não importa se o ajuste por linha acima deu certo ou não. Isso evita
    # cair de volta no valor cru (sem descontar reprovação/atraso/rendimento/
    # outros) sempre que "ajustado_mes_atual_disp" vier vazio por qualquer
    # motivo (rodada não encontrada, exceção silenciosa, etc.) -- este bloco
    # não depende de nenhuma condição anterior ter funcionado.
    try:
        rastreamento_mes_atual_disp = get_rastreamento_lotes(mes=None, ano=None, force=False)
        valor_card_mes_atual = rastreamento_mes_atual_disp.get("mes_cx_plano_atual_tendencia")
        valor_card_mes_atual = float(valor_card_mes_atual) if valor_card_mes_atual is not None else None
    except Exception:
        valor_card_mes_atual = None

    if valor_card_mes_atual is not None:
        entradas_previstas[_mes_atual()] = valor_card_mes_atual

    entradas_previstas_por_grupo: dict[int, dict[str, float]] = {}

    saidas_reais: dict[int, float] = {}
    saidas_reais_por_grupo: dict[int, dict[str, float]] = {}

    forecast: dict[int, float] = {}
    forecast_por_grupo: dict[int, dict[str, float]] = {}

    # Calcula entradas_previstas_mtd a partir de f_liberacao_diaria
    hoje = _hoje_br()
    entradas_previstas_mtd = 0.0
    entradas_previstas_mtd_por_grupo: dict[str, float] = {}
    for r in rows_liberacao_diaria:
        try:
            data_lib = date.fromisoformat(str(r.get("data_lib"))[:10])
        except Exception:
            continue
        if data_lib > hoje:
            continue
        # Ignora lotes de meses anteriores — só conta competência do mês atual
        if data_lib.month != mes_analise or data_lib.year != ano_analise:
            continue
        grupo = str(r.get("grupo_produto") or "Sem grupo").strip()
        qtd = _to_float(r.get("qtd_prevista"))
        entradas_previstas_mtd += qtd
        entradas_previstas_mtd_por_grupo[grupo] = (
            entradas_previstas_mtd_por_grupo.get(grupo, 0.0) + qtd
        )

    produtos_estoque_sem_dimensao: set[str] = set()
    produtos_entradas_sem_dimensao: set[str] = set()
    produtos_saidas_sem_dimensao: set[str] = set()
    produtos_forecast_sem_dimensao: set[str] = set()

    for r in rows_sd3:
        mes = int(r["mes"])
        qtd = _to_float(r.get("quantidade"))
        grupo = grupo_por_produto(r.get("produto"), r.get("grupo"), produtos_entradas_sem_dimensao)
        linha = _linha_from_lote(r.get("lote"))

        soma_dict(entradas_reais, mes, qtd)
        soma_grupo(entradas_reais_por_grupo, mes, grupo, qtd)

        if linha in LINHAS:
            entradas_reais_por_linha[linha][mes] = entradas_reais_por_linha[linha].get(mes, 0.0) + qtd

    for r in rows_sd2:
        mes = int(r["mes"])
        qtd = _to_float(r.get("quantidade"))
        grupo = grupo_por_produto(r.get("produto"), r.get("grupo"), produtos_saidas_sem_dimensao)

        soma_dict(saidas_reais, mes, qtd)
        soma_grupo(saidas_reais_por_grupo, mes, grupo, qtd)

    for r in rows_forecast:
        mes = int(r["mes"])
        qtd = _to_float(r.get("qtd_forecast"))
        grupo = grupo_por_produto(r.get("cod_produto"), r.get("grupo"), produtos_forecast_sem_dimensao)

        soma_dict(forecast, mes, qtd)
        soma_grupo(forecast_por_grupo, mes, grupo, qtd)

    def entrada_do_mes(mes: int) -> tuple[float, str, dict[str, float]]:
        if mes <= ultimo_mes_fechado:
            return (
                entradas_reais.get(mes, 0.0),
                "real",
                entradas_reais_por_grupo.get(mes, {}),
            )
        return (
            entradas_previstas.get(mes, 0.0),
            "previsto",
            entradas_previstas_por_grupo.get(mes, {}),
        )

    def saida_do_mes(mes: int) -> tuple[float, str, dict[str, float]]:
        if mes <= ultimo_mes_fechado:
            return (
                saidas_reais.get(mes, 0.0),
                "real",
                saidas_reais_por_grupo.get(mes, {}),
            )

        return (
            forecast.get(mes, 0.0),
            "forecast",
            forecast_por_grupo.get(mes, {}),
        )

    def entradas_linhas_do_mes(mes: int) -> dict[str, int]:
        if mes <= ultimo_mes_fechado:
            return {
                linha: round(entradas_reais_por_linha[linha].get(mes, 0.0))
                for linha in LINHAS
            }

        return {
            linha: round(entradas_previstas_por_linha[linha].get(mes, 0.0))
            for linha in LINHAS
        }

    def entradas_real_mes_atual_linhas(mes: int) -> dict[str, int] | None:
        if mes != mes_analise:
            return None

        return {
            linha: round(entradas_reais_por_linha[linha].get(mes, 0.0))
            for linha in LINHAS
        }

    def saidas_real_mes_atual(mes: int) -> int | None:
        if mes != mes_analise:
            return None

        return round(saidas_reais.get(mes, 0.0))

    def saidas_real_mes_atual_por_grupo(mes: int) -> list[dict] | None:
        if mes != mes_analise:
            return None

        real_mes = saidas_reais.get(mes, 0.0)
        grupos_mes = saidas_reais_por_grupo.get(mes, {})

        return grupos_para_lista(grupos_mes, real_mes)

    meses_list = []

    estoque_total_anterior: float | None = None
    estoque_grupo_anterior: dict[str, float] = {}
    entrada_total_anterior = 0.0
    entrada_grupo_anterior: dict[str, float] = {}
    saida_total_anterior = 0.0
    saida_grupo_anterior: dict[str, float] = {}

    for mes in range(1, 13):
        tem_estoque_real = mes in estoque_real

        if tem_estoque_real and mes <= _mes_atual():
            estoque_grupo_base = dict(estoque_por_grupo_real.get(mes, {}))
            estoque_inicio = estoque_real.get(mes, sum(estoque_grupo_base.values()))
            estoque_tipo = "real"
        elif mes == 1:
            estoque_grupo_base = dict(estoque_por_grupo_real.get(1, {}))
            estoque_inicio = estoque_real.get(1, sum(estoque_grupo_base.values()))
            estoque_tipo = "real" if tem_estoque_real else "projetado"
        else:
            base_total = estoque_total_anterior or 0.0
            estoque_inicio = max(0.0, base_total + entrada_total_anterior - saida_total_anterior)
            estoque_tipo = "projetado"

            grupos = set(estoque_grupo_anterior) | set(entrada_grupo_anterior) | set(saida_grupo_anterior)
            estoque_grupo_base = {}
            for grupo in grupos:
                estoque_grupo_base[grupo] = (
                    estoque_grupo_anterior.get(grupo, 0.0)
                    + entrada_grupo_anterior.get(grupo, 0.0)
                    - saida_grupo_anterior.get(grupo, 0.0)
                )

        entradas, entradas_tipo, entradas_grupo = entrada_do_mes(mes)
        saidas, saidas_tipo, saidas_grupo = saida_do_mes(mes)

        disponibilidade_total = estoque_inicio + entradas
        saldo_final = disponibilidade_total - saidas

        meses_list.append({
            "mes": mes,
            "mes_label": MES_LABELS[mes - 1],
            "estoque_inicio": round(estoque_inicio),
            "estoque_inicio_tipo": estoque_tipo,
            "estoque_inicio_por_grupo": grupos_para_lista(estoque_grupo_base, estoque_inicio),
            "entradas": round(entradas),
            "entradas_tipo": entradas_tipo,
            "entradas_linhas": entradas_linhas_do_mes(mes),
            "entradas_real_mes_atual": round(entradas_reais.get(mes, 0.0)) if mes == mes_analise else None,
            "entradas_previstas_mtd": round(entradas_previstas_mtd) if mes == mes_analise else None,
            "entradas_previstas_mtd_por_grupo": grupos_para_lista(
                entradas_previstas_mtd_por_grupo, entradas_previstas_mtd
            ) if mes == mes_analise else None,
            "entradas_real_mes_atual_linhas": entradas_real_mes_atual_linhas(mes),
            # entradas reais do mês atual por grupo (SD3)
            "entradas_real_mes_atual_por_grupo": grupos_para_lista(
                entradas_reais_por_grupo.get(mes, {}),
                entradas_reais.get(mes, 0.0)
            ) if mes == mes_analise else None,
            # entradas previstas do mês atual por grupo (f_entradas_previstas)
            "entradas_previstas_por_grupo_mes_atual": grupos_para_lista(
                entradas_previstas_por_grupo_mes_atual
            ) if mes == mes_analise else None,
            "entradas_por_grupo": grupos_para_lista(entradas_grupo, entradas),
            "saidas": round(saidas),
            "saidas_tipo": saidas_tipo,
            "saidas_por_grupo": grupos_para_lista(saidas_grupo, saidas),
            "saidas_real_mes_atual": saidas_real_mes_atual(mes),
            "saidas_real_mes_atual_por_grupo": saidas_real_mes_atual_por_grupo(mes),
            "disponibilidade_total": round(disponibilidade_total),
            "saldo_final": round(saldo_final),
        })

        estoque_total_anterior = estoque_inicio
        estoque_grupo_anterior = dict(estoque_grupo_base)
        entrada_total_anterior = entradas
        entrada_grupo_anterior = dict(entradas_grupo)
        saida_total_anterior = saidas
        saida_grupo_anterior = dict(saidas_grupo)

    return {
        "ano": ano_analise,
        "mes_atual": mes_analise,
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "entradas_previstas_mtd": round(entradas_previstas_mtd),
        "entradas_previstas_mtd_por_grupo": grupos_para_lista(
            entradas_previstas_mtd_por_grupo, entradas_previstas_mtd
        ),
        "meses": meses_list,
        "debug_estoque_inicial": debug_estoque_inicial,
        "debug_produtos_estoque_sem_dimensao": sorted(produtos_estoque_sem_dimensao),
        "debug_produtos_entradas_sem_dimensao": sorted(produtos_entradas_sem_dimensao),
        "debug_produtos_saidas_sem_dimensao": sorted(produtos_saidas_sem_dimensao),
        "debug_produtos_forecast_sem_dimensao": sorted(produtos_forecast_sem_dimensao),
    }


@router.get("/entradas-reais-mensal")
def get_entradas_reais_mensal(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    rows = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, produto, quantidade")
        .eq("ano", _ano_atual())
    )
    # SD3 já é carregada/processada como anestésicos.
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("quantidade"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/forecast-mensal")
def get_forecast_mensal(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    rows = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, cod_produto, grupo, qtd_forecast")
        .eq("ano", _ano_atual())
    )
    rows = _filtrar_anestesicos_por_grupo_nome(rows, "grupo")
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("qtd_forecast"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/vendas-reais-mensal")
def get_vendas_reais_mensal(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    rows = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, produto, grupo, quantidade")
        .eq("ano", _ano_atual())
    )
    rows = _filtrar_anestesicos_por_grupo_codigo(rows, "grupo")
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("quantidade"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/estoque-mensal")
def get_estoque_mensal(
    linha: str | None = Query(default=None),
    familia: str | None = Query(default=None),
    segmento: str | None = Query(default=None),
    grupo: str | None = Query(default=None),
    mercado: str | None = Query(default=None),
    status_portfolio: str | None = Query(default=None),
):
    meses, _, debug_estoque = _estoque_inicial_overview_por_mes()

    return [
        {
            "mes": m,
            "qtd_caixas": round(q),
            "fonte": "f_estoque_saldo" if m in debug_estoque.get("meses_sb8", []) else "f_estoque",
            "data_ref": debug_estoque.get("sb8", {}).get("datas_por_mes", {}).get(m),
        }
        for m, q in sorted(meses.items())
    ]


@router.get("/atendimento-sku")
def get_atendimento_sku():
    """
    Retorna liberações previstas e reais por SKU para o mês atual.
    Prevista: f_liberacoes_previstas_sku (mes atual, ano atual)
    Real: f_sd3_entradas (mes atual, ano atual) agrupado por produto
    Demanda: f_forecast_sop (mes atual, ano atual) agrupado por produto
    """
    # Lib. previstas por SKU
    rows_prev = _select_all(
        supabase.table("f_liberacoes_previstas_sku")
        .select("cod_produto, descricao, grupo, linha, qtd_caixas, estoque_inicial")
        .eq("ano", _ano_atual())
        .eq("mes", _mes_atual())
    )

    # Lib. reais por produto (SD3 do mês atual)
    rows_real = _select_all(
        supabase.table("f_sd3_entradas")
        .select("produto, grupo, quantidade")
        .eq("ano", _ano_atual())
        .eq("mes", _mes_atual())
    )

    # Demanda por produto (forecast do mês atual)
    rows_demanda = _select_all(
        supabase.table("f_forecast_sop")
        .select("cod_produto, grupo, qtd_forecast")
        .eq("ano", _ano_atual())
        .eq("mes", _mes_atual())
    )
    rows_demanda = _filtrar_anestesicos_por_grupo_nome(rows_demanda, "grupo")

    # Monta mapa de lib. prevista + estoque por cod_produto
    prev_map: dict[str, dict] = {}
    for r in rows_prev:
        cod = _normalize_cod_produto(r.get("cod_produto"))
        if not cod:
            continue
        if cod not in prev_map:
            prev_map[cod] = {
                "cod_produto": cod,
                "descricao": str(r.get("descricao") or "").strip(),
                "grupo": str(r.get("grupo") or "Sem grupo").strip(),
                "L1": 0.0,
                "L2": 0.0,
                "estoque_inicial": 0.0,
            }
        linha = str(r.get("linha") or "").strip().upper()
        qtd = _to_float(r.get("qtd_caixas"))
        est = _to_float(r.get("estoque_inicial"))
        if linha == "L1":
            prev_map[cod]["L1"] += qtd
            prev_map[cod]["estoque_inicial"] += est
        elif linha == "L2":
            prev_map[cod]["L2"] += qtd
        elif linha == "EST":
            # Produto sem linha — só estoque
            prev_map[cod]["estoque_inicial"] += est

    # Monta mapa de lib. real por cod_produto
    real_map: dict[str, float] = {}
    for r in rows_real:
        cod = _normalize_cod_produto(r.get("produto"))
        if not cod:
            continue
        real_map[cod] = real_map.get(cod, 0.0) + _to_float(r.get("quantidade"))

    # Monta mapa de demanda por cod_produto
    demanda_map: dict[str, float] = {}
    for r in rows_demanda:
        cod = _normalize_cod_produto(r.get("cod_produto"))
        if not cod:
            continue
        demanda_map[cod] = demanda_map.get(cod, 0.0) + _to_float(r.get("qtd_forecast"))

    # Agrupa por grupo > SKU
    grupos: dict[str, list] = {}
    for cod, info in prev_map.items():
        grupo = info["grupo"]
        lib_prevista = info["L1"] + info["L2"]
        lib_real = real_map.get(cod, 0.0)
        demanda = demanda_map.get(cod, 0.0)
        estoque_inicial = info.get("estoque_inicial", 0.0)
        vs_pct = round(lib_real / lib_prevista * 100) if lib_prevista > 0 else None

        if grupo not in grupos:
            grupos[grupo] = []

        grupos[grupo].append({
            "cod_produto": cod,
            "descricao": info["descricao"],
            "lib_l1": round(info["L1"]),
            "lib_l2": round(info["L2"]),
            "lib_prevista": round(lib_prevista),
            "lib_real": round(lib_real),
            "vs_pct": vs_pct,
            "demanda": round(demanda),
        })

    # Ordena SKUs por lib_prevista desc
    resultado = []
    for grupo, skus in sorted(grupos.items()):
        skus_sorted = sorted(skus, key=lambda x: x["lib_prevista"], reverse=True)
        resultado.append({
            "grupo": grupo,
            "skus": skus_sorted,
        })

    return {
        "ano": _ano_atual(),
        "mes": _mes_atual(),
        "grupos": resultado,
    }


# Em vez de um tempo fixo, a invalidação do cache acompanha a última
# atualização das bases que realmente alimentam esse painel (SD3/liberações
# reais, apontamento de produção, desvios/NC, MPS/Gantt). Se nenhuma delas
# mudou desde o último cálculo, reaproveita -- não importa há quanto tempo
# foi. Se qualquer uma mudar (ex.: você sobe uma SD3 nova), a versão muda e
# recalcula na próxima chamada. A checagem de versão em si é barata (só
# MAX(criado_em) em cada tabela), mas ainda cacheamos por 20s pra não bater
# nelas a cada request.
_RASTREAMENTO_LOTES_VERSAO_CACHE_TTL_SEGUNDOS = 20
_RASTREAMENTO_LOTES_VERSAO_CACHE: dict = {"criado_em": 0.0, "versao": None}
_RASTREAMENTO_LOTES_VERSAO_LOCK = Lock()

# Guarda-chuva de segurança: mesmo com a versão estável, não deixa o cache
# viver pra sempre (cobre o caso raro de alguma fonte de dado mudar por um
# caminho que não rastreamos aqui).
_RASTREAMENTO_LOTES_CACHE_TTL_SEGUNDOS = 30 * 60


def _versao_dados_rastreamento_lotes() -> str:
    agora = time.time()

    with _RASTREAMENTO_LOTES_VERSAO_LOCK:
        cache = _RASTREAMENTO_LOTES_VERSAO_CACHE
        if cache.get("versao") is not None and (agora - float(cache.get("criado_em") or 0)) <= _RASTREAMENTO_LOTES_VERSAO_CACHE_TTL_SEGUNDOS:
            return cache["versao"]

    # Antes: lia direto f_sd3_entradas/f_apontamentos/desvios_snapshots pela
    # coluna "criado_em" via _ultima_atualizacao_tabela. Só que f_sd3_entradas
    # não tem coluna criado_em (o insert em etl/processors.py só grava
    # produto/descr_prod/lote/quantidade/armazem/grupo/dt_emissao/custo), e
    # "desvios_snapshots" nem é o nome real da tabela de desvios (é
    # f_desvios_lotes). Como _ultima_atualizacao_tabela engole qualquer
    # exceção e devolve None, essas duas partes da versão ficavam travadas em
    # "-" para sempre -- ou seja, subir uma SD3 nova NUNCA mudava a versão, e
    # o cache do Rastreamento de Lotes só via dado novo depois do TTL de 30min
    # estourar (nunca na hora, mesmo clicando em "Atualizar").
    # Troca para a mesma fonte já correta usada por /rastreamento-lotes-cache/versao:
    # upload_log (base_id/processado_em), com mrp_rodadas/mrp_etapas lidos direto.
    versions = _rastreamento_upload_versions()
    # Observações manuais (ver migration 008) não passam pelo upload_log --
    # sem isso aqui, marcar/remover uma observação num lote nunca mudava
    # essa versão, e o card/gráfico do mês atual continuavam servindo o
    # cálculo de antes da edição indefinidamente (em qualquer máquina que
    # não tivesse recebido o force=true direto do clique em "Salvar").
    versao_obs_manuais = _ultima_atualizacao_tabela("f_lotes_observacoes_manuais", "criado_em")
    # Promoções de lote (ver migration 010) têm o mesmo problema: criar ou
    # remover uma promoção não passa pelo upload_log, então sem isso aqui
    # o mês de destino (e o de origem) continuavam servindo o cálculo de
    # antes da promoção indefinidamente.
    versao_promocoes = _ultima_atualizacao_tabela("f_lotes_promocoes_mes", "criado_em")
    # De-para de lote (ver migration 011): idem -- criar/remover um alias
    # não passa pelo upload_log.
    versao_alias = _ultima_atualizacao_tabela("f_lotes_alias", "criado_em")
    # Ajuste manual de caixas planejadas (ver migration 012): idem.
    versao_ajuste_planejado = _ultima_atualizacao_tabela("f_lotes_ajuste_planejado", "criado_em")
    versao = "|".join(f"{base}:{versions.get(base) or '-'}" for base in RASTREAMENTO_CACHE_BASES)
    versao = (
        f"{versao}|obs_manuais:{versao_obs_manuais or '-'}"
        f"|promocoes:{versao_promocoes or '-'}"
        f"|alias:{versao_alias or '-'}"
        f"|ajuste_planejado:{versao_ajuste_planejado or '-'}"
    )

    with _RASTREAMENTO_LOTES_VERSAO_LOCK:
        _RASTREAMENTO_LOTES_VERSAO_CACHE["criado_em"] = agora
        _RASTREAMENTO_LOTES_VERSAO_CACHE["versao"] = versao

    return versao


_RASTREAMENTO_LOTES_CACHE: dict = {}
_RASTREAMENTO_LOTES_LOCK = Lock()

# Deduplicação de chamadas concorrentes: _calcular_rastreamento_lotes_impl é
# pesada (pode levar de 20s a mais de 1 minuto). Sem isso, se 5-6 chamadas
# pra chaves iguais chegassem juntas (ex.: a Overview inteira carregando de
# uma vez, ou a rotina de 30s coincidindo com uso real), cada uma calculava
# por conta própria, ao mesmo tempo -- foi exatamente isso que derrubou as
# duas máquinas (memória/CPU esgotando com N cálculos pesados simultâneos
# pra cima da mesma informação). Agora, só a PRIMEIRA chamada de uma chave
# calcula de verdade; as outras que chegarem enquanto isso esperam o
# resultado dela em vez de calcular de novo.
_RASTREAMENTO_LOTES_EM_ANDAMENTO: dict[str, Event] = {}
_RASTREAMENTO_LOTES_RESULTADO_EM_ANDAMENTO: dict[str, dict] = {}
_RASTREAMENTO_LOTES_EM_ANDAMENTO_LOCK = Lock()
_RASTREAMENTO_LOTES_ESPERA_MAX_SEGUNDOS = 150


@router.get("/rastreamento-lotes")
def get_rastreamento_lotes(
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
    force: bool = Query(default=False),
):
    """
    Wrapper com cache em cima de _calcular_rastreamento_lotes_impl, que é
    pesada (~2200 linhas, várias consultas). Sem isso, cada pessoa que abre
    a Overview quase ao mesmo tempo paga o cálculo do zero de novo.

    A invalidação acompanha a última atualização das bases que alimentam
    esse painel (SD3/liberações reais, apontamento, desvios/NC, MPS/Gantt),
    não um tempo fixo -- ver _versao_dados_rastreamento_lotes. Enquanto
    nenhuma dessas bases mudar, reaproveita o mesmo resultado; assim que
    alguma mudar (ex.: você sobe uma SD3 nova), recalcula na próxima chamada.
    Isso também deixa a thread de aquecimento em background e o uso real
    sempre "se encontrarem": o cache não expira sozinho no meio do caminho.

    force=True (usado pelo botão "Atualizar" do Rastreamento no front):
    pula a leitura do cache e recalcula na hora, mesmo que a chave de versão
    não tenha mudado. Antes, o front já mandava esse parâmetro (e um
    comentário lá dizia "essa chamada ignora cache de propósito"), mas o
    endpoint nunca aceitou esse parâmetro -- FastAPI descarta silenciosamente
    query params não declarados, então "Atualizar" nunca forçava nada de
    verdade, só reaproveitava o mesmo cache de qualquer chamada normal.
    """
    mes_ref = mes if mes is not None else _mes_atual()
    ano_ref = ano if ano is not None else _ano_atual()
    versao = _versao_dados_rastreamento_lotes()
    chave = f"{ano_ref}-{mes_ref}-{versao}"
    agora = time.time()

    if not force:
        with _RASTREAMENTO_LOTES_LOCK:
            cache = _RASTREAMENTO_LOTES_CACHE.get(chave)
            if cache is not None and (agora - cache[0]) <= _RASTREAMENTO_LOTES_CACHE_TTL_SEGUNDOS:
                return cache[1]

    # Alguém mais já está calculando essa MESMA chave agora? Espera o
    # resultado dela em vez de calcular de novo em paralelo.
    with _RASTREAMENTO_LOTES_EM_ANDAMENTO_LOCK:
        evento_existente = _RASTREAMENTO_LOTES_EM_ANDAMENTO.get(chave)
        sou_eu_quem_calcula = evento_existente is None
        if sou_eu_quem_calcula:
            evento_existente = Event()
            _RASTREAMENTO_LOTES_EM_ANDAMENTO[chave] = evento_existente

    if not sou_eu_quem_calcula:
        concluiu_a_tempo = evento_existente.wait(timeout=_RASTREAMENTO_LOTES_ESPERA_MAX_SEGUNDOS)
        if concluiu_a_tempo:
            resultado_de_outra_chamada = _RASTREAMENTO_LOTES_RESULTADO_EM_ANDAMENTO.get(chave)
            if resultado_de_outra_chamada is not None:
                return resultado_de_outra_chamada
        # Timeout ou a outra chamada falhou sem deixar resultado: cai pro
        # cálculo normal abaixo como último recurso, em vez de travar pra
        # sempre esperando algo que não vai vir.

    try:
        resultado = _calcular_rastreamento_lotes_impl(mes, ano)

        with _RASTREAMENTO_LOTES_LOCK:
            _RASTREAMENTO_LOTES_CACHE[chave] = (agora, resultado)

            # A chave inclui a versão dos dados, então uma mudança de versão
            # sempre gera uma entrada nova -- sem limpar as antigas, o dicionário
            # cresceria sem limite ao longo de dias/semanas. Faxina oportunista:
            # só roda quando o dict já está grande, e só remove o que já venceu
            # pelo guarda-chuva de segurança.
            if len(_RASTREAMENTO_LOTES_CACHE) > 50:
                expirados = [
                    k for k, (criado_em, _) in _RASTREAMENTO_LOTES_CACHE.items()
                    if (agora - criado_em) > _RASTREAMENTO_LOTES_CACHE_TTL_SEGUNDOS
                ]
                for k in expirados:
                    _RASTREAMENTO_LOTES_CACHE.pop(k, None)

        if sou_eu_quem_calcula:
            with _RASTREAMENTO_LOTES_EM_ANDAMENTO_LOCK:
                _RASTREAMENTO_LOTES_RESULTADO_EM_ANDAMENTO[chave] = resultado

        return resultado
    finally:
        if sou_eu_quem_calcula:
            evento_existente.set()
            with _RASTREAMENTO_LOTES_EM_ANDAMENTO_LOCK:
                _RASTREAMENTO_LOTES_EM_ANDAMENTO.pop(chave, None)


# Nada de lista fixa por ano: o card "Perdas por desvio (ano)" agora busca
# ao vivo, direto da mesma função que já alimenta a tela "Histórico de
# desvios do ano" (desvios.py) -- ela já junta TODOS os snapshots do ano
# (não só o mais recente), então pega certinho os desvios fechados também,
# não só os que ainda aparecem na foto atual. Sem chamada HTTP: é a mesma
# função Python, chamada direto (sem risco de import circular -- desvios.py
# não importa nada de overview.py).
from app.routers import desvios as _desvios_router  # noqa: E402


def _normalizar_lote_desvio_simples(value: Any) -> str:
    texto = str(value or "").strip().upper()
    if texto.endswith(".0"):
        texto = texto[:-2]
    invalidos = {"", "-", "--", "N/A", "NA", "NAN", "NONE", "NULL"}
    return "" if texto in invalidos else texto


def _qtd_oficial_descarte_cx_simples(value: Any) -> int | None:
    qtd = _to_float(value, default=0.0)
    if qtd <= 0:
        return None
    if qtd > 10000:
        return round(qtd / 500.0)
    return round(qtd)


def _qtd_sd3_por_lote_simples(ano: int, lotes: set[str]) -> dict[str, float]:
    """
    Busca rápida na SD3, escopada só aos lotes informados -- não é uma
    varredura pesada, é uma consulta filtrada por lote + ano.
    """
    lotes_norm = {l for l in lotes if l}
    if not lotes_norm:
        return {}

    try:
        rows = _select_all(
            supabase.table("f_sd3_entradas")
            .select("*")
            .eq("ano", ano)
            .in_("lote", sorted(lotes_norm))
        )
    except Exception:
        rows = []

    resultado: dict[str, float] = {}
    for row in rows:
        lote = _normalizar_lote_desvio_simples(row.get("lote"))
        if lote not in lotes_norm:
            continue

        qtd = _to_float(
            row.get("quantidade")
            or row.get("qtd")
            or row.get("qtd_movimento")
            or row.get("quantidade_liberada")
            or row.get("qtd_liberada")
            or row.get("qtd_entrada")
            or row.get("qtd_cx")
            or row.get("caixas")
        )
        if qtd <= 0:
            continue

        qtd_cx = round(qtd / 500.0) if qtd > 10000 else round(qtd)
        resultado[lote] = resultado.get(lote, 0.0) + qtd_cx

    return resultado


@router.get("/lotes-descartados-ano")
def get_lotes_descartados_ano(ano: int | None = Query(default=None)):
    """
    Card "Perdas por desvio (ano)" da versão Executivo -- automático agora,
    sem lista fixa por ano. Reaproveita a mesma agregação que já alimenta a
    tela "Histórico de desvios do ano" (desvios.py -- junta TODOS os
    snapshots do ano, não só o atual, então pega desvio fechado também) e
    filtra pelos grupos com destino Descartado, pegando a união dos lotes
    (um lote não conta duas vezes mesmo se aparecer em mais de um desvio).

    Quantidade: tenta SD3 (liberado real) primeiro; se o lote ainda não foi
    liberado (SD3 vazio), usa a quantidade prevista que o próprio histórico
    de desvios já carrega por lote; se nem isso, cai pro padrão de 600 cx.
    """
    ano_ref = ano or date.today().year

    try:
        historico = _desvios_router._montar_historico_anual_base(ano_ref)
    except Exception:
        return {"ano": ano_ref, "total_cx": 0, "qtd_lotes": 0, "itens": []}

    grupos = historico.get("data") or []

    lotes_info: dict[str, dict[str, Any]] = {}
    for grupo in grupos:
        destino_txt = str(grupo.get("destino") or "").strip().upper()
        if "DESCART" not in destino_txt:
            continue

        serial = str(grupo.get("serial") or "").strip()
        nc = "" if serial in {"", "-"} else serial
        titulo = str(grupo.get("titulo") or "").strip()

        for lote_info in (grupo.get("lotes") or []):
            lote = _normalizar_lote_desvio_simples(lote_info.get("lote"))
            if not lote or lote in lotes_info:
                continue
            lotes_info[lote] = {
                "nc": nc,
                "motivo": titulo,
                "qtd_prevista": lote_info.get("qtd_prevista"),
            }

    qtd_sd3 = _qtd_sd3_por_lote_simples(ano_ref, set(lotes_info.keys()))

    itens: list[dict[str, Any]] = []
    total_cx = 0

    for lote, info in lotes_info.items():
        qtd_cx = round(qtd_sd3.get(lote, 0.0))
        if qtd_cx <= 0:
            qtd_cx = _qtd_oficial_descarte_cx_simples(info.get("qtd_prevista")) or 600

        total_cx += qtd_cx
        itens.append({
            "lote": lote,
            "nc": info["nc"],
            "motivo": info["motivo"],
            "destino": "Reprovado - Destino: Descarte",
            "qtd_cx": qtd_cx,
        })

    itens.sort(key=lambda x: -_to_float(x.get("qtd_cx")))

    return {
        "ano": ano_ref,
        "total_cx": round(total_cx),
        "qtd_lotes": len(itens),
        "itens": itens,
    }


def _qtd_sd3_por_lote_ano(ano: int) -> dict[str, float]:
    """
    Soma o liberado na SD3 por lote, ano inteiro -- uma consulta só, sem
    filtrar por lote (evita lista enorme no IN(...) e ainda é rápido).
    """
    try:
        rows = _select_all(
            supabase.table("f_sd3_entradas")
            .select("*")
            .eq("ano", ano)
        )
    except Exception:
        rows = []

    resultado: dict[str, float] = {}
    for row in rows:
        lote = _normalizar_lote_desvio_simples(row.get("lote"))
        if not lote:
            continue

        qtd = _to_float(
            row.get("quantidade")
            or row.get("qtd")
            or row.get("qtd_movimento")
            or row.get("quantidade_liberada")
            or row.get("qtd_liberada")
            or row.get("qtd_entrada")
            or row.get("qtd_cx")
            or row.get("caixas")
        )
        if qtd <= 0:
            continue

        qtd_cx = round(qtd / 500.0) if qtd > 10000 else round(qtd)
        resultado[lote] = resultado.get(lote, 0.0) + qtd_cx

    return resultado


@router.get("/rendimento-ano")
def get_rendimento_ano(ano: int | None = Query(default=None)):
    """
    Card/detalhe de Rendimento (ganho/perda) da versão Executivo -- compara
    direto quantidade planejada no Gantt/MPS (mesma rodada validada da tela
    MPS: f_mrp_rodadas + f_mrp_etapas) vs quantidade liberada na SD3, lote a
    lote, pro ano inteiro. Rápido de propósito: só 2 consultas no total
    (uma no Gantt, uma na SD3) -- nunca roda o rastreamento de lotes mês a
    mês, que foi o que travou as tentativas anteriores da cascata.
    """
    ano_ref = ano or _ano_atual()

    if ano_ref != _ano_atual():
        return {"ano": ano_ref, "ganho_cx": 0, "perda_cx": 0, "liquido_cx": 0, "qtd_lotes": 0, "itens": []}

    rodada = _buscar_rodada_mrp_atual()
    planejado_por_lote = _montar_lotes_mrp_overview(rodada)
    liberado_por_lote = _qtd_sd3_por_lote_ano(ano_ref)

    itens: list[dict[str, Any]] = []
    ganho_total = 0.0
    perda_total = 0.0

    for lote, info in planejado_por_lote.items():
        qtd_planejada = round(_to_float(info.get("qtd_cx")))
        qtd_liberada = round(liberado_por_lote.get(lote, 0.0))

        # Só entra na conta se já foi liberado -- lote ainda não liberado não
        # é ganho nem perda de rendimento, é só "ainda não chegou lá".
        if qtd_liberada <= 0 or qtd_planejada <= 0:
            continue

        delta = qtd_liberada - qtd_planejada
        if delta == 0:
            continue

        if delta > 0:
            ganho_total += delta
        else:
            perda_total += abs(delta)

        itens.append({
            "lote": lote,
            "qtd_planejada_cx": qtd_planejada,
            "qtd_liberada_cx": qtd_liberada,
            "delta_cx": delta,
        })

    itens.sort(key=lambda x: x["delta_cx"])

    return {
        "ano": ano_ref,
        "ganho_cx": round(ganho_total),
        "perda_cx": round(perda_total),
        "liquido_cx": round(ganho_total - perda_total),
        "qtd_lotes": len(itens),
        "itens": itens,
    }


@router.get("/causas-anuais")
def get_overview_causas_anuais(
    ano: int | None = Query(default=None),
    mes_atual: int | None = Query(default=None, ge=1, le=12),
):
    """
    Cascata "Causas da Variação Anual" (versão Executivo) -- soma direto no
    servidor, numa chamada só, o que antes o front fazia em N idas e voltas
    (uma por mês) e só somava depois no navegador. Mesma lógica/dado já
    validado hoje no Rastreamento de Lotes (mes_perdas_vs_v1_por_causa) --
    NÃO usa nada de liberacao_executiva.py.

    Regra de negócio (definida com o usuário):
      - Reprov. lote e Rendimento (perda/ganho) são causas fechadas/auditáveis,
        cada uma com detalhe por lote pronto pro modal (NC, motivo, setor,
        destino pra reprovação; previsto vs liberado SD3 pra rendimento).
      - "Atraso de produção / Ajuste de plano" é o residual: tudo que sobra da
        diferença anual depois de tirar as duas causas já fechadas. A abertura
        fina dessa parte (quanto é atraso real de produção parado vs ajuste de
        calendário/paradas planejadas, cruzando com a Cogtive) fica pra uma
        próxima entrega -- combinado explicitamente que isso demora mais.
    """
    ano_ref = ano or _ano_atual()
    mes_ref = mes_atual or _mes_atual()

    reprovacao_total = 0.0
    perda_rendimento_total = 0.0
    ganho_rendimento_total = 0.0
    meses_somados = 0

    lotes_reprovacao: dict[str, dict] = {}
    lotes_rendimento: dict[str, dict] = {}

    meses_a_buscar = list(range(1, mes_ref + 1))
    payloads_por_mes: dict[int, dict] = {}

    # Busca os meses em paralelo (thread pool) -- são consultas ao Supabase,
    # que liberam o GIL durante I/O, então isso realmente roda concorrente e
    # não sequencial. Antes, mesmo já sendo 1 chamada só pro front, o loop
    # aqui dentro do backend rodava mês a mês, um esperando o outro terminar;
    # se algum mês estivesse com cache frio, a soma inteira ficava lenta.
    with ThreadPoolExecutor(max_workers=min(8, len(meses_a_buscar)) or 1) as executor:
        futuros = {
            executor.submit(get_rastreamento_lotes, mes=mes, ano=ano_ref): mes
            for mes in meses_a_buscar
        }
        for futuro in as_completed(futuros):
            mes = futuros[futuro]
            try:
                payload = futuro.result()
            except Exception:
                continue
            if isinstance(payload, dict):
                payloads_por_mes[mes] = payload

    for mes in meses_a_buscar:
        payload = payloads_por_mes.get(mes)
        if not payload:
            continue

        causas = payload.get("mes_perdas_vs_v1_por_causa") or {}
        reprovacao_total += abs(_to_float(causas.get("reprovacao_desvio")))
        perda_rendimento_total += abs(_to_float(causas.get("rendimento")))
        ganho_rendimento_total += abs(_to_float(causas.get("ganho_rendimento")))
        meses_somados += 1

        for item in (payload.get("lotes") or []):
            lote = item.get("lote")
            if not lote:
                continue

            status = str(item.get("status_gap") or "")

            if status == "Reprovação/desvio" and lote not in lotes_reprovacao:
                lotes_reprovacao[lote] = {
                    "lote": lote,
                    "grupo": item.get("grupo"),
                    "produto": item.get("sku_pa"),
                    "qtd_prevista_cx": round(_to_float(item.get("qtd_prevista_cx"))),
                    "qtd_perda_cx": round(_to_float(item.get("qtd_gap_cx"))),
                    "nc": item.get("desvio_serial"),
                    "motivo": item.get("desvio_titulo"),
                    "setor": item.get("desvio_setor"),
                    "destino": item.get("desvio_destino_consolidado") or item.get("desvio_destino"),
                    "estado": item.get("desvio_estado"),
                    "dias_desvio": item.get("desvio_dias"),
                }

            if status == "Perda por rendimento" and lote not in lotes_rendimento:
                lotes_rendimento[lote] = {
                    "lote": lote,
                    "tipo": "perda",
                    "grupo": item.get("grupo"),
                    "produto": item.get("sku_pa"),
                    "qtd_prevista_cx": round(_to_float(item.get("qtd_prevista_cx"))),
                    "qtd_liberada_cx": round(_to_float(item.get("qtd_liberada_cx"))),
                    "delta_cx": -round(abs(_to_float(item.get("qtd_perda_rendimento_cx")))),
                }
            elif (
                _to_float(item.get("qtd_liberada_cx")) > _to_float(item.get("qtd_prevista_cx")) > 0
                and lote not in lotes_rendimento
            ):
                lotes_rendimento[lote] = {
                    "lote": lote,
                    "tipo": "ganho",
                    "grupo": item.get("grupo"),
                    "produto": item.get("sku_pa"),
                    "qtd_prevista_cx": round(_to_float(item.get("qtd_prevista_cx"))),
                    "qtd_liberada_cx": round(_to_float(item.get("qtd_liberada_cx"))),
                    "delta_cx": round(_to_float(item.get("qtd_liberada_cx")) - _to_float(item.get("qtd_prevista_cx"))),
                }

    return {
        "ano": ano_ref,
        "mes_atual": mes_ref,
        "meses_somados": meses_somados,
        "reprovacao_desvio_cx": round(reprovacao_total),
        "perda_rendimento_cx": round(perda_rendimento_total),
        "ganho_rendimento_cx": round(ganho_rendimento_total),
        "qtd_lotes_reprovacao": len(lotes_reprovacao),
        "lotes_reprovacao": sorted(
            lotes_reprovacao.values(), key=lambda x: -_to_float(x.get("qtd_perda_cx"))
        ),
        "lotes_rendimento": sorted(
            lotes_rendimento.values(), key=lambda x: _to_float(x.get("delta_cx"))
        ),
    }


# ────────────────────────────────────────────────────────────
# Observações manuais de lotes do mês corrente (ver migration
# 008_lotes_observacoes_manuais.sql para o racional completo).
# ────────────────────────────────────────────────────────────

def _normaliza_lote_modulo(value) -> str:
    """
    Cópia, no nível do módulo, da mesma normalização de lote usada dentro
    de _calcular_rastreamento_lotes_impl (que define sua própria
    normaliza_lote local, só visível ali dentro). Os endpoints de
    observação manual (abaixo) e _lotes_observacoes_manuais_mes precisam
    dessa função antes daquele ponto do arquivo -- causou um NameError em
    produção (normaliza_lote não definida) até essa cópia existir.
    """
    return str(value or "").strip().upper()


def _lotes_alias_mapa() -> dict[str, str]:
    """
    Lote ERRADO normalizado -> lote CORRETO normalizado (ver migration
    011_lotes_alias.sql). É uma tabela pequena e global (não filtra por
    mes/ano) -- pode ser lida uma vez por cálculo e reaproveitada. Nunca
    levanta exceção -- se a tabela falhar por qualquer motivo, o resto do
    cálculo segue normalmente sem esse ajuste (usa o código como veio).
    """
    try:
        linhas = _select_all(
            supabase.table("f_lotes_alias").select("lote_errado, lote_correto")
        )
    except Exception:
        return {}

    mapa: dict[str, str] = {}
    for linha in linhas:
        errado = _normaliza_lote_modulo(linha.get("lote_errado"))
        correto = _normaliza_lote_modulo(linha.get("lote_correto"))
        if errado and correto:
            mapa[errado] = correto
    return mapa


def _resolver_alias_lote(lote: str, mapa_alias: dict[str, str]) -> str:
    """Aplica o de-para se existir; senão devolve o código como veio."""
    return mapa_alias.get(lote, lote)


def _lotes_ajuste_planejado_mes(mes: int, ano: int) -> dict[str, float]:
    """Lote normalizado -> quantidade de caixas ajustada manualmente (ver
    migration 012), só para mes/ano pedidos. Nunca levanta exceção -- se a
    tabela falhar por qualquer motivo, o resto do cálculo segue
    normalmente sem esse ajuste."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_ajuste_planejado")
            .select("lote, qtd_caixas")
            .eq("mes", mes)
            .eq("ano", ano)
        )
    except Exception:
        return {}

    resultado: dict[str, float] = {}
    for linha in linhas:
        lote = _normaliza_lote_modulo(linha.get("lote"))
        qtd = linha.get("qtd_caixas")
        if lote and qtd is not None:
            resultado[lote] = _to_float(qtd)
    return resultado


def _lotes_observacoes_manuais_mes(mes: int, ano: int) -> dict[str, str]:
    """Lote normalizado -> motivo da observação manual, só para mes/ano
    pedidos. Nunca levanta exceção -- se a tabela falhar por qualquer
    motivo, o resto do cálculo segue normalmente sem esse ajuste."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_observacoes_manuais")
            .select("lote, motivo")
            .eq("mes", mes)
            .eq("ano", ano)
        )
    except Exception:
        return {}

    resultado: dict[str, str] = {}
    for linha in linhas:
        lote = _normaliza_lote_modulo(linha.get("lote"))
        motivo = str(linha.get("motivo") or "").strip()
        if lote and motivo:
            resultado[lote] = motivo
    return resultado


def _lotes_promovidos_origem_mes(mes: int, ano: int) -> dict[str, dict]:
    """Lote normalizado -> {mes_destino, ano_destino} pras promoções em que
    (mes, ano) é o mês de ORIGEM (ver migration 009). Usado quando a tela
    está olhando o mês de onde o lote saiu -- ele continua aparecendo ali,
    só que tagueado como "Promovido para [destino]" e fora da contagem de
    pendência/atraso daquele mês. Nunca levanta exceção."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_promocoes_mes")
            .select("lote, mes_destino, ano_destino")
            .eq("mes_origem", mes)
            .eq("ano_origem", ano)
        )
    except Exception:
        return {}

    resultado: dict[str, dict] = {}
    for linha in linhas:
        lote = _normaliza_lote_modulo(linha.get("lote"))
        if lote:
            resultado[lote] = {
                "mes_destino": linha.get("mes_destino"),
                "ano_destino": linha.get("ano_destino"),
            }
    return resultado


def _lotes_promovidos_destino_mes(mes: int, ano: int) -> dict[str, dict]:
    """Lote normalizado -> {mes_origem, ano_origem, qtd_caixas, grupo} pras
    promoções em que (mes, ano) é o mês de DESTINO. Usado quando a tela
    está olhando o mês pra onde o lote foi promovido -- ele passa a
    contar de verdade no Plano Atualizado desse mês, como planejamento
    novo. Nunca levanta exceção."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_promocoes_mes")
            .select("lote, mes_origem, ano_origem, qtd_caixas, grupo")
            .eq("mes_destino", mes)
            .eq("ano_destino", ano)
        )
    except Exception:
        return {}

    resultado: dict[str, dict] = {}
    for linha in linhas:
        lote = _normaliza_lote_modulo(linha.get("lote"))
        if lote:
            resultado[lote] = {
                "mes_origem": linha.get("mes_origem"),
                "ano_origem": linha.get("ano_origem"),
                "qtd_caixas": linha.get("qtd_caixas"),
                "grupo": linha.get("grupo"),
            }
    return resultado


class LoteObservacaoManualInput(BaseModel):
    lote: str
    mes: int
    ano: int
    motivo: str


@router.post("/lotes-observacao-manual")
def criar_lotes_observacao_manual(
    payload: LoteObservacaoManualInput,
    perfil: dict = Depends(exigir_admin),
):
    """
    Marca um lote do mês/ano informado com uma observação manual (ex.:
    "Aguardando aprovação regulatória X"). Restrito a admin/permissão de
    Configurações (ver app/auth.py:exigir_admin).

    O lote passa a: (1) mostrar essa observação no lugar do destino padrão
    na tela; (2) sair das causas padrão (saldo/atraso) da visão mensal;
    (3) entrar no card "Outros" -- só enquanto ainda não tiver produção
    real registrada no mês (ver _calcular_rastreamento_lotes_impl). Assim
    que o lote for liberado de verdade, o efeito para sozinho de contar,
    sem precisar remover esta linha.
    """
    lote = _normaliza_lote_modulo(payload.lote)
    if not lote:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    motivo = payload.motivo.strip()
    if not motivo:
        raise HTTPException(status_code=400, detail="Motivo é obrigatório.")

    if not (1 <= payload.mes <= 12):
        raise HTTPException(status_code=400, detail="Mês inválido.")

    try:
        supabase.table("f_lotes_observacoes_manuais").upsert(
            {
                "lote": lote,
                "mes": payload.mes,
                "ano": payload.ano,
                "motivo": motivo,
                "criado_por": perfil.get("email") or perfil.get("usuario") or perfil.get("nome"),
            },
            on_conflict="lote,mes,ano",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar observação: {str(e)[:300]}")

    return {"status": "ok", "lote": lote, "mes": payload.mes, "ano": payload.ano}


@router.delete("/lotes-observacao-manual/{lote}")
def remover_lotes_observacao_manual(
    lote: str,
    mes: int = Query(...),
    ano: int = Query(...),
    perfil: dict = Depends(exigir_admin),
):
    """Remove a observação manual de um lote. Restrito a admin/permissão
    de Configurações (ver app/auth.py:exigir_admin)."""
    lote_norm = _normaliza_lote_modulo(lote)
    if not lote_norm:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    try:
        (
            supabase.table("f_lotes_observacoes_manuais")
            .delete()
            .eq("lote", lote_norm)
            .eq("mes", mes)
            .eq("ano", ano)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover observação: {str(e)[:300]}")

    return {"status": "ok"}


# ────────────────────────────────────────────────────────────
# Lotes adicionados manualmente ao Rastreamento (ver migration
# 009_lotes_manuais_rastreamento.sql para o racional completo).
# ────────────────────────────────────────────────────────────

def _lotes_manuais_rastreamento_mes(mes: int, ano: int) -> list[dict]:
    """Lista de lotes adicionados manualmente pro mes/ano pedido. Nunca
    levanta exceção -- se a tabela falhar por qualquer motivo, o resto do
    cálculo segue normalmente sem esses lotes."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_manuais_rastreamento")
            .select("lote, grupo, qtd_caixas, data_liberacao, motivo")
            .eq("mes", mes)
            .eq("ano", ano)
        )
    except Exception:
        return []

    resultado = []
    for linha in linhas:
        lote = _normaliza_lote_modulo(linha.get("lote"))
        qtd = _to_float(linha.get("qtd_caixas"))
        if lote and qtd > 0:
            resultado.append({
                "lote": lote,
                "grupo": str(linha.get("grupo") or "").strip() or None,
                "qtd_caixas": qtd,
                "data_liberacao": linha.get("data_liberacao"),
                "motivo": linha.get("motivo"),
            })
    return resultado


class LoteManualRastreamentoInput(BaseModel):
    lote: str
    mes: int
    ano: int
    grupo: str | None = None
    qtd_caixas: float
    data_liberacao: str | None = None
    motivo: str | None = None


@router.post("/lotes-manuais-rastreamento")
def criar_lote_manual_rastreamento(
    payload: LoteManualRastreamentoInput,
    perfil: dict = Depends(exigir_admin),
):
    """
    Adiciona um lote manualmente ao Rastreamento de Lotes do mês/ano
    informado -- pro caso oposto da observação manual: um lote que o
    sistema automático (Gantt/MPS/rodada MRP) não está enxergando, mas que
    já foi/vai ser liberado de verdade. Restrito a admin/permissão de
    Configurações (ver app/auth.py:exigir_admin).

    Entra como uma linha a mais na tabela "Lotes de [mês]", já marcado
    como liberado, e soma nas caixas realizadas do mês -- reflete também
    no card "Plano Atualizado" e na barra do mês atual da Overview.
    """
    lote = _normaliza_lote_modulo(payload.lote)
    if not lote:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    if payload.qtd_caixas <= 0:
        raise HTTPException(status_code=400, detail="Quantidade de caixas deve ser maior que zero.")

    if not (1 <= payload.mes <= 12):
        raise HTTPException(status_code=400, detail="Mês inválido.")

    try:
        supabase.table("f_lotes_manuais_rastreamento").upsert(
            {
                "lote": lote,
                "mes": payload.mes,
                "ano": payload.ano,
                "grupo": (payload.grupo or "").strip() or None,
                "qtd_caixas": payload.qtd_caixas,
                "data_liberacao": payload.data_liberacao,
                "motivo": (payload.motivo or "").strip() or None,
                "criado_por": perfil.get("email") or perfil.get("usuario") or perfil.get("nome"),
            },
            on_conflict="lote,mes,ano",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar lote manual: {str(e)[:300]}")

    return {"status": "ok", "lote": lote, "mes": payload.mes, "ano": payload.ano}


@router.delete("/lotes-manuais-rastreamento/{lote}")
def remover_lote_manual_rastreamento(
    lote: str,
    mes: int = Query(...),
    ano: int = Query(...),
    perfil: dict = Depends(exigir_admin),
):
    """Remove um lote adicionado manualmente ao Rastreamento. Restrito a
    admin/permissão de Configurações (ver app/auth.py:exigir_admin)."""
    lote_norm = _normaliza_lote_modulo(lote)
    if not lote_norm:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    try:
        (
            supabase.table("f_lotes_manuais_rastreamento")
            .delete()
            .eq("lote", lote_norm)
            .eq("mes", mes)
            .eq("ano", ano)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover lote manual: {str(e)[:300]}")

    return {"status": "ok"}


# ────────────────────────────────────────────────────────────
# Promoção de lote pro mês corrente (ver migration
# 010_lotes_promocoes_mes.sql para o racional completo).
# ────────────────────────────────────────────────────────────

class LotePromoverInput(BaseModel):
    lote: str
    mes_origem: int
    ano_origem: int
    qtd_caixas: float
    grupo: str | None = None


@router.post("/lotes-promover-mes-atual")
def promover_lote_mes_atual(
    payload: LotePromoverInput,
    perfil: dict = Depends(exigir_admin),
):
    """
    Move a expectativa de entrega de um lote que ficou parado num mês
    anterior (não liberado, mas também não reprovado/descartado) pro mês
    corrente. Restrito a admin/permissão de Configurações (ver
    app/auth.py:exigir_admin).

    Efeito (ver _calcular_rastreamento_lotes_impl):
      - no mês de ORIGEM: o lote continua na tabela, tagueado como
        "Promovido para [mês/ano destino]", e sai da contagem de
        pendência/atraso aberta daquele mês (mesmo card "Outros" da
        observação manual);
      - no mês de DESTINO (sempre o mês corrente, calculado aqui -- nunca
        confia em mes/ano vindo do front pra isso): o lote passa a
        aparecer também lá e conta de verdade no Plano Atualizado, como
        planejamento novo.

    O "Planejado V1" (congelado) nunca muda em nenhum dos dois meses --
    só o Plano Atualizado.

    Bloqueia promoção de lote já reprovado/descartado (ver
    _lotes_reprovacao_desvio_overview) -- esses são perdas resolvidas,
    não fazem sentido "voltar à vida" num mês novo.
    """
    lote = _normaliza_lote_modulo(payload.lote)
    if not lote:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    if not (1 <= payload.mes_origem <= 12):
        raise HTTPException(status_code=400, detail="Mês de origem inválido.")

    if payload.qtd_caixas <= 0:
        raise HTTPException(status_code=400, detail="Quantidade de caixas deve ser maior que zero.")

    try:
        lotes_reprovados_ou_descartados = _lotes_reprovacao_desvio_overview()
    except Exception:
        lotes_reprovados_ou_descartados = set()

    if lote in lotes_reprovados_ou_descartados:
        raise HTTPException(
            status_code=400,
            detail="Lote reprovado/descartado não pode ser promovido -- essa perda já está resolvida.",
        )

    mes_destino = _mes_atual()
    ano_destino = _ano_atual()

    if payload.mes_origem == mes_destino and payload.ano_origem == ano_destino:
        raise HTTPException(status_code=400, detail="Lote já está no mês corrente.")

    try:
        supabase.table("f_lotes_promocoes_mes").upsert(
            {
                "lote": lote,
                "mes_origem": payload.mes_origem,
                "ano_origem": payload.ano_origem,
                "mes_destino": mes_destino,
                "ano_destino": ano_destino,
                "qtd_caixas": payload.qtd_caixas,
                "grupo": (payload.grupo or "").strip() or None,
                "promovido_por": perfil.get("email") or perfil.get("usuario") or perfil.get("nome"),
            },
            on_conflict="lote,mes_origem,ano_origem",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao promover lote: {str(e)[:300]}")

    return {
        "status": "ok",
        "lote": lote,
        "mes_origem": payload.mes_origem,
        "ano_origem": payload.ano_origem,
        "mes_destino": mes_destino,
        "ano_destino": ano_destino,
    }


@router.delete("/lotes-promover-mes-atual/{lote}")
def remover_promocao_lote(
    lote: str,
    mes_origem: int = Query(...),
    ano_origem: int = Query(...),
    perfil: dict = Depends(exigir_admin),
):
    """Desfaz a promoção de um lote, devolvendo ele pro mês de origem
    normal. Restrito a admin/permissão de Configurações (ver
    app/auth.py:exigir_admin)."""
    lote_norm = _normaliza_lote_modulo(lote)
    if not lote_norm:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    try:
        (
            supabase.table("f_lotes_promocoes_mes")
            .delete()
            .eq("lote", lote_norm)
            .eq("mes_origem", mes_origem)
            .eq("ano_origem", ano_origem)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover promoção: {str(e)[:300]}")

    return {"status": "ok"}


# ────────────────────────────────────────────────────────────
# De-para de código de lote (ver migration 011_lotes_alias.sql
# para o racional completo).
# ────────────────────────────────────────────────────────────

class LoteAliasInput(BaseModel):
    lote_errado: str
    lote_correto: str


@router.get("/lotes-alias")
def listar_lotes_alias(perfil: dict = Depends(exigir_admin)):
    """Lista todos os de-paras cadastrados. Restrito a admin/permissão de
    Configurações (ver app/auth.py:exigir_admin)."""
    try:
        linhas = _select_all(
            supabase.table("f_lotes_alias")
            .select("lote_errado, lote_correto, criado_por, criado_em")
            .order("criado_em", desc=True)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao listar de-paras: {str(e)[:300]}")

    return {"alias": linhas}


@router.post("/lotes-alias")
def criar_lote_alias(
    payload: LoteAliasInput,
    perfil: dict = Depends(exigir_admin),
):
    """
    Cadastra um de-para permanente: toda vez que "lote_errado" aparecer em
    qualquer base (apontamento, SD3, desvio, etc.), o sistema passa a
    tratar como se fosse "lote_correto" (o código do planejamento) daqui
    pra frente -- em todas as telas, não só na Overview. Restrito a
    admin/permissão de Configurações (ver app/auth.py:exigir_admin).

    Não corrige o dado bruto em nenhuma tabela de origem -- só ensina o
    backend a "casar" os dois códigos na hora de juntar informação.
    """
    lote_errado = _normaliza_lote_modulo(payload.lote_errado)
    lote_correto = _normaliza_lote_modulo(payload.lote_correto)

    if not lote_errado or not lote_correto:
        raise HTTPException(status_code=400, detail="Os dois códigos de lote são obrigatórios.")

    if lote_errado == lote_correto:
        raise HTTPException(status_code=400, detail="Os códigos são iguais -- não faz sentido criar um de-para.")

    try:
        supabase.table("f_lotes_alias").upsert(
            {
                "lote_errado": lote_errado,
                "lote_correto": lote_correto,
                "criado_por": perfil.get("email") or perfil.get("usuario") or perfil.get("nome"),
            },
            on_conflict="lote_errado",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar de-para: {str(e)[:300]}")

    return {"status": "ok", "lote_errado": lote_errado, "lote_correto": lote_correto}


@router.delete("/lotes-alias/{lote_errado}")
def remover_lote_alias(
    lote_errado: str,
    perfil: dict = Depends(exigir_admin),
):
    """Remove um de-para. Restrito a admin/permissão de Configurações
    (ver app/auth.py:exigir_admin)."""
    lote_norm = _normaliza_lote_modulo(lote_errado)
    if not lote_norm:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    try:
        supabase.table("f_lotes_alias").delete().eq("lote_errado", lote_norm).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover de-para: {str(e)[:300]}")

    return {"status": "ok"}


# ────────────────────────────────────────────────────────────
# Ajuste manual de caixas planejadas por lote (ver migration
# 012_lotes_ajuste_planejado.sql para o racional completo).
# ────────────────────────────────────────────────────────────

class LoteAjustePlanejadoInput(BaseModel):
    lote: str
    mes: int
    ano: int
    qtd_caixas: float


@router.post("/lotes-ajuste-planejado")
def criar_lote_ajuste_planejado(
    payload: LoteAjustePlanejadoInput,
    perfil: dict = Depends(exigir_admin),
):
    """
    Ajusta manualmente a quantidade de caixas planejadas exibida/usada
    pra um lote específico do mês (ex.: rendimento esperado menor que o
    planejado original, decidido antes da liberação). Restrito a
    admin/permissão de Configurações (ver app/auth.py:exigir_admin).

    O "Planejado V1" (congelado) NUNCA muda -- só a coluna "Caixas
    Planejadas" exibida e o Plano Atualizado do mês. Se o lote também
    tiver saldo em quarentena (mais concreto, fisicamente contado), a
    quarentena tem prioridade sobre este ajuste manual.
    """
    lote = _normaliza_lote_modulo(payload.lote)
    if not lote:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    if not (1 <= payload.mes <= 12):
        raise HTTPException(status_code=400, detail="Mês inválido.")

    if payload.qtd_caixas < 0:
        raise HTTPException(status_code=400, detail="Quantidade não pode ser negativa.")

    try:
        supabase.table("f_lotes_ajuste_planejado").upsert(
            {
                "lote": lote,
                "mes": payload.mes,
                "ano": payload.ano,
                "qtd_caixas": payload.qtd_caixas,
                "criado_por": perfil.get("email") or perfil.get("usuario") or perfil.get("nome"),
            },
            on_conflict="lote,mes,ano",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar ajuste: {str(e)[:300]}")

    return {"status": "ok", "lote": lote, "mes": payload.mes, "ano": payload.ano}


@router.delete("/lotes-ajuste-planejado/{lote}")
def remover_lote_ajuste_planejado(
    lote: str,
    mes: int = Query(...),
    ano: int = Query(...),
    perfil: dict = Depends(exigir_admin),
):
    """Remove o ajuste manual, voltando o lote a usar o planejado
    original. Restrito a admin/permissão de Configurações (ver
    app/auth.py:exigir_admin)."""
    lote_norm = _normaliza_lote_modulo(lote)
    if not lote_norm:
        raise HTTPException(status_code=400, detail="Lote inválido.")

    try:
        (
            supabase.table("f_lotes_ajuste_planejado")
            .delete()
            .eq("lote", lote_norm)
            .eq("mes", mes)
            .eq("ano", ano)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover ajuste: {str(e)[:300]}")

    return {"status": "ok"}


def _calcular_rastreamento_lotes_impl(
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
):
    """
    Rastreamento operacional dos lotes do mês atual.

    Fonte do plano:
      - f_mrp_rodadas: sempre a rodada de maior mês e maior versão do ano atual;
      - f_mrp_etapas: lotes da rodada atual, usando mês/ano de liberação.

    Fonte do realizado:
      - f_apontamentos: avanço operacional por etapa;
      - f_sd3_entradas: liberação real por lote;
      - f_desvios_lotes: desvios/NC ativos por lote.

    Regras:
      - A lista de lotes vem da versão MAIS ATUAL do MPS/MRP, não mais da V1/f_liberacao_diaria.
      - Lista e projetadas usam MÊS LIBERAÇÃO / ANO LIBERAÇÃO.
      - Previsto até hoje usa literalmente data_lib V1 <= hoje.
      - Visão mensal compara V1 do mês versus plano atual/tendência do mês.
      - Plano atual/tendência do mês:
          lote já liberado usa SD3 real;
          lote ainda não liberado e mantido no mês usa quantidade da versão atual;
          lote reprogramado/saiu do mês conta como perda produção.
      - Cards explicam perdas e status aberto do mês, sem antecipar lote futuro no MTD.
    """
    from datetime import date as date_cls
    import time as _time_mod
    import logging as _logging_mod
    _logger_tempo = _logging_mod.getLogger("uvicorn")
    _t0 = _time_mod.time()
    _marcas_tempo = []
    def _marcar(nome: str):
        decorrido = round(_time_mod.time() - _t0, 2)
        _marcas_tempo.append((nome, decorrido))
        _logger_tempo.warning("TEMPO rastreamento-lotes mes=%s ano=%s [%s] em %ss", mes, ano, nome, decorrido)

    hoje = _hoje_br()
    hoje_iso = hoje.isoformat()

    mes_analise = mes or _mes_atual()
    ano_analise = ano or _ano_atual()

    # Observações manuais (ver migration 008_lotes_observacoes_manuais.sql e
    # os endpoints POST/DELETE /overview/lotes-observacao-manual logo acima
    # desta função): mecanismo sempre restrito ao mês corrente de verdade --
    # nunca afeta uma consulta de mês passado/futuro, mesmo que exista uma
    # linha cadastrada para outro mes/ano (não deveria existir, mas essa
    # checagem é a garantia). Buscado aqui, cedo, pra já poder tagueado cada
    # lote no loop logo abaixo; a checagem de "ainda ativa" (sem produção
    # real lançada) é feita mais abaixo, depois que sd3_lote_map existe.
    observacoes_manuais_mes: dict[str, str] = {}
    if mes_analise == _mes_atual() and ano_analise == _ano_atual():
        observacoes_manuais_mes = _lotes_observacoes_manuais_mes(mes_analise, ano_analise)

    # Saldo em quarentena (armazém 98) por lote -- só faz sentido pro mês
    # corrente (é sempre uma "foto" de agora, não existe "quarentena de
    # março" retroativa). Ver _estoque_quarentena_por_lote.
    estoque_quarentena_lote: dict[str, float] = {}
    if mes_analise == _mes_atual() and ano_analise == _ano_atual():
        estoque_quarentena_lote = _estoque_quarentena_por_lote()

    # Ajuste manual de caixas planejadas (ver migration 012) -- ao contrário
    # da quarentena, não é restrito ao mês corrente: faz sentido ajustar um
    # lote de um mês futuro/passado também (decisão tomada antes da
    # liberação, não depende de "foto de agora").
    ajustes_planejado_mes = _lotes_ajuste_planejado_mes(mes_analise, ano_analise)

    # Lotes adicionados manualmente (ver migration 009 e os endpoints
    # POST/DELETE /overview/lotes-manuais-rastreamento logo acima desta
    # função). Ao contrário da observação manual, não é restrito ao mês
    # corrente -- faz sentido cadastrar num mês fechado também, ex.: um
    # lote liberado que só entrou na planilha de controle depois.
    lotes_manuais_mes = _lotes_manuais_rastreamento_mes(mes_analise, ano_analise)
    lotes_manuais_por_codigo = {item["lote"]: item for item in lotes_manuais_mes}

    # Promoções de lote pro mês corrente (ver migration 010 e os endpoints
    # POST/DELETE /overview/lotes-promover-mes-atual). Duas direções, não é
    # a mesma coisa: um lote pode ter sido promovido PRA FORA deste mes/ano
    # (era daqui, foi pra outro mês -- some da pendência daqui) ou PRA
    # DENTRO deste mes/ano (veio de outro mês -- passa a contar aqui).
    lotes_promovidos_para_fora = _lotes_promovidos_origem_mes(mes_analise, ano_analise)
    lotes_promovidos_para_dentro = _lotes_promovidos_destino_mes(mes_analise, ano_analise)

    # De-para de código de lote (ver migration 011_lotes_alias.sql):
    # buscado uma vez aqui, aplicado em TODO lugar que normaliza um código
    # de lote nesta função (via normaliza_lote logo abaixo) -- assim um
    # erro de digitação no apontamento real (Cogtive) não impede o lote de
    # "casar" com o planejamento (Gantt/MPS/MRP).
    lotes_alias_mapa = _lotes_alias_mapa()

    ESTADOS_DESVIO_FECHADOS = {
        "CONCLUIDO",
        "CONCLUÍDO",
        "FINALIZADO",
        "ENCERRADO",
        "CANCELADO",
        "CANCELADA",
    }

    ETAPAS_PLANO_VALIDAS = {
        "",
        "ENVASE",
        "PRODUCAO",
        "PRODUÇÃO",
        "LIBERACAO",
        "LIBERAÇÃO",
        "MPS",
        "PLANO",
    }

    def normaliza_lote(value) -> str:
        bruto = str(value or "").strip().upper()
        # Aplica o de-para (migration 011): se "bruto" for um código
        # conhecido como errado, troca pelo código correto do
        # planejamento -- em TODA chamada desta função, sem precisar
        # tratar em cada um dos vários lugares que normalizam lote nesta
        # função.
        return lotes_alias_mapa.get(bruto, bruto)

    def normaliza_sku(value) -> str:
        texto = str(value or "").strip()
        if texto.endswith(".0"):
            texto = texto[:-2]
        return texto

    def normaliza_texto(value) -> str:
        return str(value or "").strip()

    def normaliza_estado_desvio(value) -> str:
        return str(value or "").strip().upper()

    def normaliza_data(value):
        if not value:
            return None

        texto = str(value).strip()
        if not texto:
            return None

        # ISO: 2026-05-19 ou 2026-05-19T...
        try:
            return date_cls.fromisoformat(texto[:10])
        except Exception:
            pass

        # BR: 19/05/2026
        try:
            partes = texto[:10].split("/")
            if len(partes) == 3:
                dia, mes, ano = [int(x) for x in partes]
                return date_cls(ano, mes, dia)
        except Exception:
            pass

        return None

    def data_str(value):
        data = normaliza_data(value)
        return data.isoformat() if data else None

    def data_label(value):
        data = normaliza_data(value)
        return data.strftime("%d/%m") if data else None

    def mes_int(value):
        return _to_int(value, None)

    def ano_int(value):
        return _to_int(value, _ano_atual())

    def status_operacional_lote(item: dict) -> str:
        if item.get("check_liberado"):
            return "Liberado"
        if item.get("em_desvio"):
            return "Em desvio"
        if item.get("check_embalagem"):
            return "Em embalagem"
        if item.get("check_envase"):
            return "Em envase"
        if item.get("check_lavagem"):
            return "Em lavagem"
        return "Não iniciado"

    def primeiro_valor(row: dict, campos: list[str]):
        for campo in campos:
            valor = row.get(campo)
            if valor is not None and str(valor).strip() != "":
                return valor
        return None

    def linha_from_row(row: dict) -> str | None:
        valor = primeiro_valor(row, [
            "linha",
            "linha_origem",
            "linha_producao",
            "recurso",
            "equipamento",
            "maquina",
        ])
        linha = _linha_from_recurso(valor)
        if linha in LINHAS:
            return linha

        texto = str(valor or "").strip().upper()
        if texto in LINHAS:
            return texto

        lote = normaliza_lote(primeiro_valor(row, ["lote", "lote_op", "numero_lote"]))
        return _linha_from_lote(lote)

    def grupo_from_row(row: dict) -> str:
        grupo = primeiro_valor(row, [
            "grupo_produto",
            "grupo",
            "grupo_pai",
            "familia",
            "produto_grupo",
            "descricao_produto",  # campo salvo pelo importador MPS do mrp.py
        ])
        grupo_txt = str(grupo or "").strip()
        return grupo_txt if grupo_txt else "Sem grupo"

    def codigo_from_row(row: dict) -> str:
        return normaliza_sku(primeiro_valor(row, [
            "codigo_produto",
            "cod_produto",
            "sku",
            "produto_codigo",
            "codigo",
        ]))

    def descricao_from_row(row: dict) -> str:
        return normaliza_texto(primeiro_valor(row, [
            "descricao_produto",
            "desc_produto",
            "produto",
            "descricao",
            "grupo",
        ]))

    def qtd_planejada_cx_from_row(row: dict) -> float:
        """
        Na f_mrp_etapas, qtd_planejada costuma estar em tubetes.
        Quando existir campo explicitamente em caixas, usa ele.
        """
        qtd_cx = primeiro_valor(row, [
            "qtd_caixas",
            "qtd_planejada_caixas",
            "qtd_prevista_cx",
            "caixas",
        ])
        if qtd_cx is not None:
            return _to_float(qtd_cx)

        qtd_tb = primeiro_valor(row, [
            "qtd_planejada",
            "quantidade_planejada",
            "qtd_tubetes",
            "quantidade",
            "qtd",
        ])
        return _to_float(qtd_tb) / TUBETES_POR_CAIXA

    def data_liberacao_from_row(row: dict):
        """
        Data operacional de liberação.

        IMPORTANTE:
        Esta data NÃO define a competência da liberação.
        Ela serve apenas para calcular o previsto até hoje dentro do mês de liberação.
        A competência oficial é MÊS LIBERAÇÃO / ANO LIBERAÇÃO.
        """
        data = primeiro_valor(row, [
            "data_pa",           # campo real salvo pela importação MPS
            "data_lib",
            "data_liberacao",
            "data_liberacao_prevista",
            "dt_liberacao",
            "data_prevista_liberacao",
            "data_fim",
            "data_inicio",
        ])
        parsed = normaliza_data(data)
        if parsed:
            return parsed

        mes, ano = competencia_liberacao_from_row(row)
        if mes and 1 <= mes <= 12 and ano:
            try:
                return date_cls(ano, mes, 1)
            except Exception:
                return None

        return None

    def competencia_liberacao_from_row(row: dict) -> tuple[int | None, int | None]:
        """
        Competência oficial da liberação.

        Regra de negócio validada:
          - Disponibilidade, entradas projetadas e rastreamento usam MÊS LIBERAÇÃO / ANO LIBERAÇÃO.
          - DATA LIB. não muda a competência; ela só ordena e calcula o MTD.

        Exemplo:
          DATA LIB. = 19/05 e MÊS LIBERAÇÃO = 6
          => entra em junho, não em maio.
        """
        mes = mes_int(primeiro_valor(row, [
            "mes_liberacao",
            "mes_lib",
            "mes_competencia_liberacao",
            "mes_competencia",
            "mes",
        ]))
        ano = ano_int(primeiro_valor(row, [
            "ano_liberacao",
            "ano_lib",
            "ano_competencia_liberacao",
            "ano_competencia",
            "ano",
        ]))

        if mes and 1 <= mes <= 12 and ano:
            return mes, ano

        # Fallback apenas para bases antigas sem MÊS LIBERAÇÃO.
        data = normaliza_data(primeiro_valor(row, [
            "data_lib",
            "data_liberacao",
            "data_liberacao_prevista",
            "dt_liberacao",
            "data_prevista_liberacao",
        ]))
        if data:
            return data.month, data.year

        return None, None

    def is_etapa_plano_valida(row: dict) -> bool:
        etapa = str(row.get("etapa") or "").strip().upper()
        if etapa in ETAPAS_PLANO_VALIDAS:
            return True

        # Se a etapa vier muito detalhada, mantém apenas o que representa produção/liberação,
        # evitando duplicar lavagem/embalagem no plano.
        if "ENVASE" in etapa or "PRODU" in etapa or "LIBERA" in etapa:
            return True

        return False

    def montar_gantt_atual_mrp() -> list[dict]:
        """
        Monta a lista planejada do rastreamento a partir da rodada MRP/MPS atual.
        Retorna rows compatíveis com a estrutura antiga do Gantt.
        """
        rodada = _buscar_rodada_mrp_atual()
        if not rodada or not rodada.get("id"):
            return []

        rodada_id = rodada.get("id")

        try:
            etapas = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("rodada_id", rodada_id)
            )
        except Exception:
            return []

        por_lote: dict[str, dict] = {}

        for row in etapas:
            if not is_etapa_plano_valida(row):
                continue

            mes_lib, ano_lib = competencia_liberacao_from_row(row)
            if ano_lib != ano_analise or mes_lib != mes_analise:
                continue

            data_lib = data_liberacao_from_row(row)
            if not data_lib:
                continue

            linha = linha_from_row(row)
            if linha not in LINHAS:
                continue

            lote = normaliza_lote(primeiro_valor(row, [
                "lote",
                "lote_op",
                "numero_lote",
                "num_lote",
                "ordem",
                "op",
                "ordem_producao",
            ]))
            if not lote:
                continue

            produto_txt = descricao_from_row(row).upper()
            codigo_txt = codigo_from_row(row).upper()
            if produto_txt in {"TOTAL", "TOTAIS"} or codigo_txt in {"TOTAL", "TOTAIS"}:
                continue
            if "AG AVULSO" in produto_txt or produto_txt == "AVULSO":
                continue

            qtd_cx = qtd_planejada_cx_from_row(row)
            if qtd_cx <= 0:
                continue

            item = por_lote.get(lote)
            if not item:
                item = {
                    "lote": lote,
                    "grupo_produto": grupo_from_row(row),
                    "codigo": codigo_from_row(row),
                    "qtd_prevista": 0.0,
                    "data_lib": data_lib.isoformat(),
                    "data_inicio": data_str(primeiro_valor(row, [
                        "data_inicio",
                        "data_inicio_prevista",
                        "dt_inicio",
                    ])),
                    "data_fim": data_str(primeiro_valor(row, [
                        "data_fim",
                        "data_fim_prevista",
                        "dt_fim",
                    ])),
                    "linha": linha,
                    "mes": mes_lib,
                    "ano": ano_lib,
                    "rodada_id": rodada_id,
                    "rodada_mes": rodada.get("mes"),
                    "rodada_versao": rodada.get("versao"),
                }
                por_lote[lote] = item

            item["qtd_prevista"] += qtd_cx

            # Mantém a data de liberação mais cedo se houver duplicidade.
            data_atual = normaliza_data(item.get("data_lib"))
            if data_atual is None or data_lib < data_atual:
                item["data_lib"] = data_lib.isoformat()

            if not item.get("grupo_produto") or item.get("grupo_produto") == "Sem grupo":
                item["grupo_produto"] = grupo_from_row(row)

            if not item.get("codigo"):
                item["codigo"] = codigo_from_row(row)

        return list(por_lote.values())

    def montar_gantt_ano_mrp() -> list[dict]:
        """
        Gantt/plano anual da rodada atual.
        Usado para conciliar SD3 fora do mês atual e mostrar de qual previsão o lote veio.
        """
        rodada = _buscar_rodada_mrp_atual()
        if not rodada or not rodada.get("id"):
            return []

        rodada_id = rodada.get("id")

        try:
            etapas = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("rodada_id", rodada_id)
            )
        except Exception:
            return []

        por_lote: dict[str, dict] = {}

        for row in etapas:
            if not is_etapa_plano_valida(row):
                continue

            mes_lib, ano_lib = competencia_liberacao_from_row(row)
            if ano_lib != ano_analise or not mes_lib or not (1 <= mes_lib <= 12):
                continue

            data_lib = data_liberacao_from_row(row)
            if not data_lib:
                continue

            linha = linha_from_row(row)
            if linha not in LINHAS:
                continue

            lote = normaliza_lote(primeiro_valor(row, [
                "lote",
                "lote_op",
                "numero_lote",
                "num_lote",
                "ordem",
                "op",
                "ordem_producao",
            ]))
            if not lote:
                continue

            produto_txt = descricao_from_row(row).upper()
            codigo_txt = codigo_from_row(row).upper()
            if produto_txt in {"TOTAL", "TOTAIS"} or codigo_txt in {"TOTAL", "TOTAIS"}:
                continue
            if "AG AVULSO" in produto_txt or produto_txt == "AVULSO":
                continue

            qtd_cx = qtd_planejada_cx_from_row(row)
            if qtd_cx <= 0:
                continue

            item = por_lote.get(lote)
            if not item:
                item = {
                    "lote": lote,
                    "grupo_produto": grupo_from_row(row),
                    "codigo": codigo_from_row(row),
                    "qtd_prevista": 0.0,
                    "data_lib": data_lib.isoformat(),
                    "data_inicio": data_str(primeiro_valor(row, [
                        "data_inicio",
                        "data_inicio_prevista",
                        "dt_inicio",
                    ])),
                    "data_fim": data_str(primeiro_valor(row, [
                        "data_fim",
                        "data_fim_prevista",
                        "dt_fim",
                    ])),
                    "linha": linha,
                    "mes": mes_lib,
                    "ano": ano_lib,
                    "rodada_id": rodada_id,
                    "rodada_mes": rodada.get("mes"),
                    "rodada_versao": rodada.get("versao"),
                }
                por_lote[lote] = item

            item["qtd_prevista"] += qtd_cx

            data_atual = normaliza_data(item.get("data_lib"))
            if data_atual is None or data_lib < data_atual:
                item["data_lib"] = data_lib.isoformat()

        return list(por_lote.values())

    def buscar_rodada_mrp_v1_mes() -> dict | None:
        """
        Baseline congelado do rastreamento.

        Regra V2:
          - o universo da página é sempre a V1 do mês analisado;
          - a rodada mais atual serve apenas para identificar reprogramação/atraso;
          - se não existir V1, usa a menor versão disponível do mês como fallback;
          - se nem isso existir, usa a rodada atual para não deixar a tela vazia.
        """
        try:
            rodadas = _select_all(
                supabase.table("f_mrp_rodadas")
                .select("*")
                .eq("ano", ano_analise)
                .eq("mes", mes_analise)
            )
        except Exception:
            return None

        validas = [
            r for r in rodadas
            if r.get("id") and _versao_num(r.get("versao")) > 0
        ]

        if not validas:
            return None

        v1s = [r for r in validas if _versao_num(r.get("versao")) == 1]
        if v1s:
            return sorted(
                v1s,
                key=lambda r: str(r.get("criado_em") or r.get("created_at") or ""),
                reverse=True,
            )[0]

        # fallback: menor versão disponível do mês
        return sorted(
            validas,
            key=lambda r: (
                _versao_num(r.get("versao")),
                str(r.get("criado_em") or r.get("created_at") or ""),
            ),
        )[0]

    def buscar_rodada_mrp_atual_mes() -> dict | None:
        """
        Versão atual do mês analisado.

        Para o rastreamento mensal, a comparação deve ser V1 do mesmo mês
        versus a maior versão disponível daquele próprio mês. Não pode usar a
        rodada global mais recente, porque quando virar uma V3/V4 de outro mês
        isso desmonta a leitura de junho.
        """
        try:
            rodadas = _select_all(
                supabase.table("f_mrp_rodadas")
                .select("*")
                .eq("ano", ano_analise)
                .eq("mes", mes_analise)
            )
        except Exception:
            return None

        validas = [
            r for r in rodadas
            if r.get("id") and _versao_num(r.get("versao")) > 0
        ]

        if not validas:
            return None

        return sorted(
            validas,
            key=lambda r: (
                _versao_num(r.get("versao")),
                str(r.get("criado_em") or r.get("created_at") or ""),
            ),
            reverse=True,
        )[0]

    def montar_gantt_mrp_por_rodada(rodada: dict | None) -> list[dict]:
        """Monta o plano por lote para uma rodada específica do Gantt/MPS."""
        if not rodada or not rodada.get("id"):
            return []

        rodada_id = rodada.get("id")

        try:
            etapas = _select_all(
                supabase.table("f_mrp_etapas")
                .select("*")
                .eq("rodada_id", rodada_id)
            )
        except Exception:
            return []

        por_lote: dict[str, dict] = {}

        for row in etapas:
            if not is_etapa_plano_valida(row):
                continue

            mes_lib, ano_lib = competencia_liberacao_from_row(row)
            if ano_lib != ano_analise or not mes_lib or not (1 <= mes_lib <= 12):
                continue

            data_lib = data_liberacao_from_row(row)
            if not data_lib:
                continue

            linha = linha_from_row(row)
            if linha not in LINHAS:
                continue

            lote = normaliza_lote(primeiro_valor(row, [
                "lote",
                "lote_op",
                "numero_lote",
                "num_lote",
                "ordem",
                "op",
                "ordem_producao",
            ]))
            if not lote:
                continue

            produto_txt = descricao_from_row(row).upper()
            codigo_txt = codigo_from_row(row).upper()
            if produto_txt in {"TOTAL", "TOTAIS"} or codigo_txt in {"TOTAL", "TOTAIS"}:
                continue
            if "AG AVULSO" in produto_txt or produto_txt == "AVULSO":
                continue

            qtd_cx = qtd_planejada_cx_from_row(row)
            if qtd_cx <= 0:
                continue

            item = por_lote.get(lote)
            if not item:
                item = {
                    "lote": lote,
                    "grupo_produto": grupo_from_row(row),
                    "codigo": codigo_from_row(row),
                    "qtd_prevista": 0.0,
                    "data_lib": data_lib.isoformat(),
                    "data_inicio": data_str(primeiro_valor(row, [
                        "data_inicio",
                        "data_inicio_prevista",
                        "dt_inicio",
                    ])),
                    "data_fim": data_str(primeiro_valor(row, [
                        "data_fim",
                        "data_fim_prevista",
                        "dt_fim",
                    ])),
                    "linha": linha,
                    "mes": mes_lib,
                    "ano": ano_lib,
                    "rodada_id": rodada_id,
                    "rodada_mes": rodada.get("mes"),
                    "rodada_versao": rodada.get("versao"),
                }
                por_lote[lote] = item

            item["qtd_prevista"] += qtd_cx

            data_atual = normaliza_data(item.get("data_lib"))
            if data_atual is None or data_lib < data_atual:
                item["data_lib"] = data_lib.isoformat()

            if not item.get("grupo_produto") or item.get("grupo_produto") == "Sem grupo":
                item["grupo_produto"] = grupo_from_row(row)

            if not item.get("codigo"):
                item["codigo"] = codigo_from_row(row)

        return list(por_lote.values())

    rodada_baseline_v1 = buscar_rodada_mrp_v1_mes()

    # Duas leituras diferentes são necessárias aqui:
    # 1) rodada_atual_mrp_mes: maior versão do próprio mês analisado.
    #    Mantém o plano atualizado de Junho como Junho, sem puxar Julho para a tela.
    # 2) rodada_atual_mrp_global: rodada operacional mais recente.
    #    Serve só para detectar lote da V1 de Junho que hoje foi jogado para Julho.
    rodada_atual_mrp_mes = buscar_rodada_mrp_atual_mes()
    rodada_atual_mrp_global = _buscar_rodada_mrp_atual()
    rodada_atual_mrp = rodada_atual_mrp_mes or rodada_atual_mrp_global

    rows_gantt_ano_atual = montar_gantt_mrp_por_rodada(rodada_atual_mrp)
    rows_gantt_ano_atual_global = montar_gantt_mrp_por_rodada(rodada_atual_mrp_global)
    if not rows_gantt_ano_atual_global:
        rows_gantt_ano_atual_global = rows_gantt_ano_atual

    rows_gantt_ano = montar_gantt_mrp_por_rodada(rodada_baseline_v1)

    fonte_baseline = "Gantt/MPS V1" if rodada_baseline_v1 else "Gantt/MPS atual"

    # Se não houver V1 do mês, usa a rodada atual como fallback.
    if not rows_gantt_ano:
        rows_gantt_ano = rows_gantt_ano_atual
        fonte_baseline = "Gantt/MPS atual (fallback sem V1)"

    rows_gantt = [
        r for r in rows_gantt_ano
        if normaliza_lote(r.get("lote"))
        and mes_int(r.get("mes")) == mes_analise
        and ano_int(r.get("ano")) == ano_analise
    ]

    # Fallback de segurança: se ainda não houver MRP/MPS versionado no banco,
    # usa o Gantt antigo para não deixar a tela vazia.
    if not rows_gantt:
        rows_gantt_ano = _select_all(
            supabase.table("f_liberacao_diaria")
            .select("lote, grupo_produto, qtd_prevista, data_lib, data_inicio, data_fim, linha, mes, ano")
            .eq("ano", ano_analise)
            .not_.is_("lote", "null")
        )
        rows_gantt_ano_atual = rows_gantt_ano
        fonte_baseline = "Liberação diária antiga (fallback)"

        rows_gantt = [
            r for r in rows_gantt_ano
            if normaliza_lote(r.get("lote"))
            and mes_int(r.get("mes")) == mes_analise
            and ano_int(r.get("ano")) == ano_analise
        ]

    # Relatório de apontamentos completo.
    # Usa PRODUÇÃO para avanço das etapas e usa PARADAS/ocorrências para explicar
    # os dias de atraso no modal de Perda Produção.
    #
    # Importante: a tela MPS usa a base de produção real/apontamento para a
    # conciliação em cascata. Para não dar falso "0 ocorrência", juntamos as duas
    # fontes quando existirem:
    #   - f_apontamentos: melhor para etapa/lote e avanço operacional;
    #   - f_producao_real: melhor para paradas por equipamento/dia, igual ao MPS.
    try:
        _marcar("inicio_fetches_apontamentos")
        rows_apt_base = _select_all(
            supabase.table("f_apontamentos")
            .select("lote, etapa, qtd_produzida, equipamento, ordem, sku, data_inicial, data_final, duracao_h, tipo_evento, evento, situacao")
        )
    except Exception:
        rows_apt_base = []

    for _r in rows_apt_base:
        _r["fonte_evento"] = _r.get("fonte_evento") or "f_apontamentos"

    # Fonte igual ao MPS: o relatório de produção/apontamento importado no MPS
    # é salvo em f_mrp_producao_real por rodada. Essa é a base que alimenta
    # a relatório de apontamento do MPS e contém as paradas com recurso,
    # equipamento, motivo/evento, data/hora e duração.
    rodada_atual_id = (rodada_atual_mrp or {}).get("id")
    try:
        if rodada_atual_id:
            rows_mrp_producao_real = _select_all(
                supabase.table("f_mrp_producao_real")
                .select("rodada_id,recurso,lote,op,codigo_produto,descricao_produto,equipamento,data_real_inicio,hora_inicio,data_real_fim,hora_fim,horas_reais,qtd_real,tipo_evento,evento")
                .eq("rodada_id", rodada_atual_id)
            )
        else:
            rows_mrp_producao_real = []
    except Exception:
        rows_mrp_producao_real = []

    rows_mrp_producao_real_norm = []
    for _r in rows_mrp_producao_real:
        rows_mrp_producao_real_norm.append({
            "lote": _r.get("lote"),
            "etapa": _r.get("etapa"),
            "qtd_produzida": _r.get("qtd_real"),
            "equipamento": _r.get("equipamento"),
            "ordem": _r.get("op"),
            "sku": _r.get("codigo_produto"),
            "produto": _r.get("descricao_produto"),
            "recurso": _r.get("recurso"),
            "data_inicial": _r.get("data_real_inicio"),
            "hora_inicio": _r.get("hora_inicio"),
            "data_final": _r.get("data_real_fim"),
            "hora_fim": _r.get("hora_fim"),
            "duracao_h": _r.get("horas_reais"),
            "tipo_evento": _r.get("tipo_evento"),
            "evento": _r.get("evento"),
            "situacao": _r.get("situacao"),
            "fonte_evento": "f_mrp_producao_real",
        })

    # Fallback antigo: mantém f_apontamentos para status/lote e só complementa
    # paradas com a base do MPS. Não usa f_producao_real porque ela pode estar
    # desatualizada em relação ao MPS.
    rows_apt_all = rows_apt_base + rows_mrp_producao_real_norm

    rows_apt = [
        r for r in rows_apt_base
        if str(r.get("tipo_evento") or "").strip().upper() == "PRODUÇÃO"
        and _to_float(r.get("qtd_produzida")) > 0
    ]

    # SD3 do mês atual — tudo que realmente liberou/entrou no mês atual.
    rows_sd3 = _select_all(
        supabase.table("f_sd3_entradas")
        .select("produto, grupo, quantidade, lote, mes, ano, dt_emissao")
        .eq("ano", ano_analise)
        .eq("mes", mes_analise)
    )

    # Base de desvios / NC por lote.
    #
    # Regra correta da Overview/Rastreamento:
    # 1) Desvios atuais:
    #    lê a última fotografia da aba de Desvios (desvios_snapshots).
    #    Tudo que está ali aparece como "Em desvio" ou "Reprovado/descartado".
    #
    # 2) Desvios históricos:
    #    lê snapshots antigos SOMENTE para reprovação/descarte.
    #    Isso mantém no card os lotes que foram reprovados/descartados, mesmo
    #    depois que o NC foi fechado e saiu dos desvios atuais.
    #
    # 3) Desvio fechado sem reprovação/descarte:
    #    não entra na Overview.
    rows_desvios_snapshot_atual = _rows_desvios_snapshot_atual_overview()
    fonte_desvios_atual = "desvios_snapshots_atual"
    rows_desvios = rows_desvios_snapshot_atual

    try:
        rows_desvios_historico = _select_all(
            supabase.table("desvios_snapshots")
            .select("snapshot_id, lote, serial, titulo, setor, estado, dias_desvio, destino, data_upload")
            .order("data_upload", desc=True)
        )
    except Exception:
        rows_desvios_historico = []

    def normaliza_status_local(value) -> str:
        texto = str(value or "").strip().upper()
        if not texto:
            return ""
        texto = unicodedata.normalize("NFKD", texto)
        texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
        texto = re.sub(r"\s+", " ", texto)
        return texto

    def eh_reprovacao_ou_descarte(row: dict) -> bool:
        texto = " ".join([
            normaliza_status_local(row.get("destino")),
            normaliza_status_local(row.get("estado")),
            normaliza_status_local(row.get("titulo")),
        ]).strip()

        return any(termo in texto for termo in [
            "REPROV",
            "DESCART",
            "DESCARTE",
            "REJEIT",
            "SUCATA",
            "DESTRUI",
        ])

    def chave_desvio(row: dict) -> tuple[str, str, str, str]:
        return (
            normaliza_lote(row.get("lote")),
            normaliza_texto(row.get("serial")),
            normaliza_status_local(row.get("destino")),
            normaliza_status_local(row.get("titulo")),
        )

    desvios_lote_map: dict[str, list[dict]] = {}
    chaves_atuais: set[tuple[str, str, str, str]] = set()

    for r in rows_desvios:
        lote_desvio = normaliza_lote(r.get("lote"))
        if not lote_desvio:
            continue

        # Se está na fotografia atual da aba de Desvios, deve aparecer no Rastreamento.
        # Não filtramos por estado aqui; o estado/destino apenas define a classificação.
        desvio_item = {
            "lote": lote_desvio,
            "serial": normaliza_texto(r.get("serial")),
            "titulo": normaliza_texto(r.get("titulo")),
            "setor": normaliza_texto(r.get("setor")),
            "data_criacao": data_str(r.get("data_criacao")),
            "estado": normaliza_texto(r.get("estado")),
            "dias_desvio": _to_float(r.get("dias_desvio"), 0),
            "destino": normaliza_texto(r.get("destino")),
            "historico_fechado": False,
            "fonte_desvio": fonte_desvios_atual,
        }

        chaves_atuais.add(chave_desvio(desvio_item))
        desvios_lote_map.setdefault(lote_desvio, []).append(desvio_item)

    # Histórico qualificado:
    # mantém reprovação/descarte encontrado em qualquer snapshot do ano,
    # mesmo que o lote também tenha um desvio diferente aberto na posição
    # atual -- os dois fatos convivem, e desvio_reprovacao (mais abaixo)
    # já garante que reprovação/descarte tem prioridade sobre "Em desvio".
    chaves_historicas_reprovacao: set[tuple[str, str, str, str]] = set()

    for r in rows_desvios_historico:
        if not eh_reprovacao_ou_descarte(r):
            continue

        lote_desvio = normaliza_lote(r.get("lote"))
        if not lote_desvio:
            continue

        chave = chave_desvio(r)

        # Se o desvio/lote já está na fotografia atual, a posição atual manda.
        if chave in chaves_atuais or chave in chaves_historicas_reprovacao:
            continue

        # Se o mesmo lote já tem exatamente esse desvio na fotografia atual,
        # não duplica (chave já cobre isso acima). Só isso é motivo de pular --
        # não pulamos mais só porque o lote aparece na base atual por outro
        # motivo: um lote pode ter um desvio novo aberto hoje e, ao mesmo
        # tempo, já ter sido oficialmente reprovado/descartado no passado.
        # Os dois são fatos verdadeiros e o lote precisa contar como
        # reprovação/descarte de qualquer forma (ver desvio_reprovacao logo
        # abaixo, que já prioriza corretamente "Reprovação/desvio" sobre
        # "Em desvio" quando ambos existem).

        chaves_historicas_reprovacao.add(chave)

        desvio_item = {
            "lote": lote_desvio,
            "serial": normaliza_texto(r.get("serial")),
            "titulo": normaliza_texto(r.get("titulo")),
            "setor": normaliza_texto(r.get("setor")),
            "data_criacao": None,
            "estado": normaliza_texto(r.get("estado")) or "Fechado",
            "dias_desvio": _to_float(r.get("dias_desvio"), 0),
            "destino": normaliza_texto(r.get("destino")) or "Reprovado/descartado",
            "data_upload": data_str(r.get("data_upload")),
            "snapshot_id": r.get("snapshot_id"),
            "historico_fechado": True,
            "situacao_historico": "Fechado",
            "fonte_desvio": "histórico reprovado/descartado",
        }

        desvios_lote_map.setdefault(lote_desvio, []).append(desvio_item)

    for lote_desvio, lista in desvios_lote_map.items():
        lista.sort(
            key=lambda item: (
                0 if eh_reprovacao_ou_descarte(item) else 1,
                1 if item.get("historico_fechado") else 0,
                -_to_float(item.get("dias_desvio"), 0),
                str(item.get("serial") or ""),
            )
        )

    def normaliza_status_texto(value) -> str:
        """
        Normaliza destino/estado/título para comparar status sem depender de
        acento, caixa alta/baixa ou variações pequenas de escrita.
        """
        texto = str(value or "").strip().upper()
        if not texto:
            return ""

        texto = unicodedata.normalize("NFKD", texto)
        texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
        texto = re.sub(r"\s+", " ", texto)
        return texto

    def prioridade_desvio(item: dict | None) -> tuple[int, float, str]:
        """
        Define qual desvio manda no status consolidado do lote.

        Regra:
          1. Reprovado prevalece sobre aprovado;
          2. Em análise/pendente/aberto vem antes de aprovado;
          3. Aprovado só aparece como principal se não existir situação pior.

        Importante: isso NÃO remove os demais desvios. A lista `desvios`
        continua inteira para o tooltip/detalhe do lote.
        """
        if not item:
            return (9, 0.0, "")

        destino = normaliza_status_texto(item.get("destino"))
        estado = normaliza_status_texto(item.get("estado"))
        titulo = normaliza_status_texto(item.get("titulo"))
        texto = " ".join([destino, estado, titulo]).strip()

        if (
            "REPROV" in destino
            or "REPROV" in texto
            or "DESCART" in destino
            or "DESCART" in texto
            or "DESCARTE" in destino
            or "DESCARTE" in texto
            or "REJEIT" in texto
            or "SUCATA" in texto
            or "DESTRUI" in texto
        ):
            prioridade = 0
        elif (
            "EM ANALISE" in texto
            or "ANALISE" in texto
            or "PENDENTE" in texto
            or "PEND" in texto
            or "ABERTO" in texto
            or "TRATAMENTO" in texto
            or "INVESTIG" in texto
        ):
            prioridade = 1
        elif "APROV" in destino:
            prioridade = 2
        elif destino:
            prioridade = 3
        else:
            prioridade = 4

        dias = _to_float(item.get("dias_desvio"), 0)
        serial = str(item.get("serial") or "")
        return (prioridade, -dias, serial)

    def desvio_principal(lista_desvios: list[dict] | None) -> dict | None:
        if not lista_desvios:
            return None

        return sorted(lista_desvios, key=prioridade_desvio)[0]

    def desvio_destino_consolidado(lista_desvios: list[dict] | None) -> str | None:
        principal = desvio_principal(lista_desvios)
        if not principal:
            return None

        destino = normaliza_texto(principal.get("destino"))
        return destino if destino else None

    def desvio_seriais(lista_desvios: list[dict] | None) -> list[str]:
        if not lista_desvios:
            return []

        seriais = []
        vistos = set()

        for item in lista_desvios:
            serial = normaliza_texto(item.get("serial"))
            if serial and serial not in vistos:
                vistos.add(serial)
                seriais.append(serial)

        return seriais

    def construir_mapa_previsoes_por_lote(rows: list[dict]) -> dict[str, list[dict]]:
        mapa: dict[str, list[dict]] = {}

        for r in rows:
            lote_gantt = normaliza_lote(r.get("lote"))
            if not lote_gantt:
                continue

            data_lib = normaliza_data(r.get("data_lib"))
            item = {
                "lote": lote_gantt,
                "grupo_previsto": str(r.get("grupo_produto") or "").strip(),
                "qtd_prevista_cx": round(_to_float(r.get("qtd_prevista"))),
                "data_lib_prevista": data_lib.isoformat() if data_lib else None,
                "data_inicio_prevista": data_str(r.get("data_inicio")),
                "data_fim_prevista": data_str(r.get("data_fim")),
                "linha_prevista": str(r.get("linha") or "").strip(),
                "mes_previsto": mes_int(r.get("mes")),
                "ano_previsto": ano_int(r.get("ano")),
                "gantt_mes_atual": (
                    mes_int(r.get("mes")) == mes_analise
                    and ano_int(r.get("ano")) == ano_analise
                ),
                "rodada_id": r.get("rodada_id"),
                "rodada_mes": r.get("rodada_mes"),
                "rodada_versao": r.get("rodada_versao"),
            }
            mapa.setdefault(lote_gantt, []).append(item)

        for lista in mapa.values():
            lista.sort(key=lambda x: (
                x.get("ano_previsto") or 9999,
                x.get("mes_previsto") or 99,
                x.get("data_lib_prevista") or "9999-12-31",
            ))

        return mapa

    # Mapa V1 = baseline do mês.
    # Mapa atual do mês = usado para plano atualizado/tendência do mês escolhido.
    # Mapa global = usado apenas para detectar reprogramação para mês futuro
    # quando se está olhando mês fechado (ex.: V1 de Jun jogada para Jul na rodada atual).
    gantt_lotes_ano_map = construir_mapa_previsoes_por_lote(rows_gantt_ano)
    gantt_atual_lotes_ano_map = construir_mapa_previsoes_por_lote(rows_gantt_ano_atual)
    gantt_global_lotes_ano_map = construir_mapa_previsoes_por_lote(rows_gantt_ano_atual_global)

    # Mapa SD3 por lote: lote → qtd liberada no mês atual.
    sd3_lote_map: dict[str, float] = {}
    sd3_produto_map: dict[str, float] = {}
    sd3_lote_info: dict[str, dict] = {}

    for r in rows_sd3:
        lote_sd3 = normaliza_lote(r.get("lote"))
        produto_sd3 = normaliza_sku(r.get("produto"))
        grupo_sd3 = str(r.get("grupo") or "Sem grupo").strip()
        qtd = _to_float(r.get("quantidade"))

        if lote_sd3:
            sd3_lote_map[lote_sd3] = sd3_lote_map.get(lote_sd3, 0.0) + qtd
            dt_emissao_sd3 = str(r.get("dt_emissao") or "").strip() or None

            if lote_sd3 not in sd3_lote_info:
                sd3_lote_info[lote_sd3] = {
                    "lote": lote_sd3,
                    "produto": produto_sd3,
                    "grupo": grupo_sd3,
                    "qtd_cx": 0.0,
                    "dt_emissao": dt_emissao_sd3,
                }

            sd3_lote_info[lote_sd3]["qtd_cx"] += qtd
            if produto_sd3 and not sd3_lote_info[lote_sd3].get("produto"):
                sd3_lote_info[lote_sd3]["produto"] = produto_sd3
            if grupo_sd3 and grupo_sd3 != "Sem grupo":
                sd3_lote_info[lote_sd3]["grupo"] = grupo_sd3

        if produto_sd3:
            sd3_produto_map[produto_sd3] = sd3_produto_map.get(produto_sd3, 0.0) + qtd

    # Lotes que liberaram na SD3 no mês atual, mas não pertencem ao plano válido da versão atual.
    lotes_fora_gantt = []
    for lote_sd3, info_sd3 in sd3_lote_info.items():
        previsoes = gantt_lotes_ano_map.get(lote_sd3, [])
        pertence_ao_gantt_mes_atual = any(p.get("gantt_mes_atual") for p in previsoes)

        if pertence_ao_gantt_mes_atual:
            continue

        previsto = previsoes[0] if previsoes else {}
        desvios = desvios_lote_map.get(lote_sd3, [])
        desvio = desvio_principal(desvios)
        seriais_desvio = desvio_seriais(desvios)

        lotes_fora_gantt.append({
            "lote": lote_sd3,
            "produto": info_sd3.get("produto"),
            "grupo": info_sd3.get("grupo"),
            "qtd_cx": round(info_sd3.get("qtd_cx", 0.0)),
            "dt_emissao": info_sd3.get("dt_emissao"),
            "qtd_prevista_cx": previsto.get("qtd_prevista_cx", 0),
            "data_lib_prevista": previsto.get("data_lib_prevista"),
            "data_inicio_prevista": previsto.get("data_inicio_prevista"),
            "data_fim_prevista": previsto.get("data_fim_prevista"),
            "linha_prevista": previsto.get("linha_prevista"),
            "mes_previsto": previsto.get("mes_previsto"),
            "ano_previsto": previsto.get("ano_previsto"),
            "grupo_previsto": previsto.get("grupo_previsto"),
            "motivo": (
                "Lote não encontrado no plano atual"
                if not previsoes
                else "Lote previsto no plano atual fora do mês atual"
            ),
            "em_desvio": bool(desvios),
            "qtd_desvios": len(desvios),
            "desvios": desvios,
            "desvio_seriais": seriais_desvio,
            "desvio_serial": desvio.get("serial") if desvio else None,
            "desvio_titulo": desvio.get("titulo") if desvio else None,
            "desvio_estado": desvio.get("estado") if desvio else None,
            "desvio_dias": round(_to_float(desvio.get("dias_desvio"))) if desvio else None,
            "desvio_setor": desvio.get("setor") if desvio else None,
            "desvio_destino": desvio.get("destino") if desvio else None,
            "desvio_destino_consolidado": desvio_destino_consolidado(desvios),
        })

    lotes_fora_gantt.sort(key=lambda x: (
        x.get("data_lib_prevista") or "9999-12-31",
        x.get("lote") or "",
    ))

    # Mapa de apontamentos por lote.
    apt_map: dict[str, dict] = {}
    ORDEM_ETAPA = {"LAVAGEM": 1, "ENVASE": 2, "EMBALAGEM": 3}

    for r in rows_apt:
        lote = normaliza_lote(r.get("lote"))
        if not lote:
            continue

        etapa = str(r.get("etapa") or "").strip().upper()
        if etapa not in ORDEM_ETAPA:
            continue

        qtd = _to_float(r.get("qtd_produzida"))
        sku = normaliza_sku(r.get("sku"))
        equip = str(r.get("equipamento") or "").strip()
        ordem = str(r.get("ordem") or "").strip()

        if lote not in apt_map:
            apt_map[lote] = {}

        if etapa not in apt_map[lote]:
            apt_map[lote][etapa] = {
                "qtd": 0.0,
                "equipamento": equip,
                "ordem": ordem,
                "sku": sku,
            }

        apt_map[lote][etapa]["qtd"] += qtd

        if equip:
            apt_map[lote][etapa]["equipamento"] = equip
        if ordem:
            apt_map[lote][etapa]["ordem"] = ordem
        if sku:
            apt_map[lote][etapa]["sku"] = sku

    # Eventos do relatório de apontamento.
    # V18: para o modal de Perda Produção, replica a lógica do MPS/cascata:
    # - produção continua sendo buscada por lote, para achar o último fim real;
    # - paradas NÃO são buscadas por lote, porque no relatório da Cogtive a parada
    #   muitas vezes fica como evento de equipamento/linha, sem casar no lote.
    #   Por isso a análise usa linha + janela de datas entre o fim previsto V1
    #   e o fim atual/reprogramado.
    apt_eventos_lote_map: dict[str, list[dict]] = {}
    paradas_por_linha_data: dict[str, dict[str, list[dict]]] = {}
    paradas_por_data: dict[str, list[dict]] = {}

    def _parse_dt_apontamento(value):
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time())

        texto = str(value).strip()
        if not texto:
            return None

        # Supabase normalmente devolve ISO. Mantém fallback para formatos BR.
        tentativas = [
            texto,
            texto.replace("Z", "+00:00"),
            texto[:19],
        ]
        for raw in tentativas:
            try:
                dt = datetime.fromisoformat(raw)
                return dt.replace(tzinfo=None)
            except Exception:
                pass

        for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
            try:
                return datetime.strptime(texto, fmt)
            except Exception:
                pass

        data_only = normaliza_data(texto)
        if data_only:
            return datetime.combine(data_only, datetime.min.time())
        return None

    def _date_iso(dt):
        return dt.date().isoformat() if dt else None

    def _hora_iso(dt):
        return dt.strftime("%H:%M:%S") if dt else None

    def _datas_entre(inicio: date | None, fim: date | None) -> list[str]:
        if not inicio and not fim:
            return []
        if inicio and not fim:
            return [inicio.isoformat()]
        if fim and not inicio:
            return [fim.isoformat()]

        ini = min(inicio, fim)
        f = max(inicio, fim)
        dias = []
        atual = ini
        while atual <= f:
            dias.append(atual.isoformat())
            atual += timedelta(days=1)
        return dias

    def _evento_apontamento(ev: dict) -> dict | None:
        dt_ini = _parse_dt_apontamento(ev.get("data_inicial"))
        dt_fim = _parse_dt_apontamento(ev.get("data_final")) or dt_ini
        if not dt_ini and not dt_fim:
            return None

        equipamento_txt = str(ev.get("equipamento") or "").strip()
        tipo_evento_txt = str(ev.get("tipo_evento") or "").strip()
        evento_txt = str(ev.get("evento") or "").strip()
        etapa_txt = str(ev.get("etapa") or "").strip()
        situacao_txt = str(ev.get("situacao") or "").strip()
        recurso_raw = str(ev.get("recurso") or "").strip().upper()
        linha_ev = recurso_raw if recurso_raw in LINHAS else _linha_from_recurso(equipamento_txt)
        hora_inicio_raw = str(ev.get("hora_inicio") or "").strip()
        hora_fim_raw = str(ev.get("hora_fim") or "").strip()

        tipo_evento_norm = normaliza_status_local(tipo_evento_txt)
        # A Cogtive costuma classificar paradas como evento diferente de PRODUÇÃO.
        # Também cobre nomes explícitos de parada/manutenção/setup/falta etc.
        texto_evento = normaliza_status_local(" ".join([tipo_evento_txt, evento_txt, situacao_txt]))
        is_parada = tipo_evento_norm != "PRODUCAO" or any(term in texto_evento for term in [
            "PARADA", "MANUT", "SETUP", "LIMPEZA", "FALTA", "AGUARD", "QUEBRA", "REGULAGEM", "INTERV",
        ])

        return {
            "data_inicial": _date_iso(dt_ini or dt_fim),
            "data_final": _date_iso(dt_fim or dt_ini),
            "hora_inicio": hora_inicio_raw or _hora_iso(dt_ini),
            "hora_fim": hora_fim_raw or _hora_iso(dt_fim),
            "tipo_evento": tipo_evento_txt or None,
            "evento": evento_txt or None,
            "equipamento": equipamento_txt or None,
            "recurso": linha_ev,
            "etapa": etapa_txt or None,
            "duracao_h": round(_to_float(ev.get("duracao_h")), 2),
            "duracao_horas": round(_to_float(ev.get("duracao_h")), 2),
            "situacao": situacao_txt or None,
            "qtd_produzida": round(_to_float(ev.get("qtd_produzida"))),
            "fonte_evento": ev.get("fonte_evento"),
            "is_parada": is_parada,
        }

    for ev in rows_apt_all:
        item_ev = _evento_apontamento(ev)
        if not item_ev:
            continue

        lote_ev = normaliza_lote(ev.get("lote"))
        if lote_ev:
            apt_eventos_lote_map.setdefault(lote_ev, []).append(item_ev)

        if item_ev.get("is_parada"):
            data_ini = normaliza_data(item_ev.get("data_inicial"))
            data_fim = normaliza_data(item_ev.get("data_final")) or data_ini
            dias_evento = _datas_entre(data_ini, data_fim)
            linha_ev = item_ev.get("recurso")

            for dia_ev in dias_evento:
                paradas_por_data.setdefault(dia_ev, []).append(item_ev)
                if linha_ev in LINHAS:
                    paradas_por_linha_data.setdefault(linha_ev, {}).setdefault(dia_ev, []).append(item_ev)

    for lote_ev in apt_eventos_lote_map:
        apt_eventos_lote_map[lote_ev].sort(key=lambda x: (
            x.get("data_inicial") or "9999-12-31",
            x.get("hora_inicio") or "99:99:99",
            x.get("evento") or "",
        ))

    def _paradas_cascata_periodo(linha_ref: str | None, data_inicio_ref: date | None, data_fim_ref: date | None) -> list[dict]:
        """
        Busca paradas como o MPS faz na conciliação em cascata: por linha/recurso
        e janela operacional, não por lote. Se não houver linha mapeada, ou se a
        linha não retornar nada, usa fallback por dia para não esconder paradas
        registradas no apontamento.
        """
        dias = _datas_entre(data_inicio_ref, data_fim_ref)
        if not dias:
            return []

        paradas = []
        vistos = set()

        def _add(lista: list[dict]):
            for p in lista:
                chave = (
                    p.get("data_inicial"),
                    p.get("hora_inicio"),
                    p.get("data_final"),
                    p.get("hora_fim"),
                    p.get("equipamento"),
                    p.get("evento"),
                    p.get("tipo_evento"),
                )
                if chave in vistos:
                    continue
                vistos.add(chave)
                paradas.append(p)

        if linha_ref in LINHAS:
            for dia_ref in dias:
                _add(paradas_por_linha_data.get(linha_ref, {}).get(dia_ref, []))

        # Fallback controlado: se a linha não trouxe nada, mostra paradas do dia.
        # Isso evita o falso "0 ocorrência" quando o apontamento da parada não veio
        # amarrado a uma envasadora/linha identificável.
        if not paradas:
            for dia_ref in dias:
                _add(paradas_por_data.get(dia_ref, []))

        paradas.sort(key=lambda x: (
            x.get("data_inicial") or "9999-12-31",
            x.get("hora_inicio") or "99:99:99",
            x.get("equipamento") or "",
            x.get("evento") or "",
        ))
        return paradas

    def _paradas_cascata_dia_fim_previsto(linha_ref: str | None, data_ref: date | None) -> list[dict]:
        """
        Modal de Perda Produção no mesmo espírito da conciliação do MPS:
        mostra as paradas do dia do fim previsto anterior/V1, por linha/recurso.
        Se a linha não retornar nada, mostra as paradas do dia inteiro para evitar
        falso zero quando o apontamento não veio amarrado a uma envasadora.
        """
        if not data_ref:
            return []

        dia_ref = data_ref.isoformat()
        paradas = []
        vistos = set()

        def _add(lista: list[dict]):
            for p in lista:
                chave = (
                    p.get("data_inicial"),
                    p.get("hora_inicio"),
                    p.get("data_final"),
                    p.get("hora_fim"),
                    p.get("equipamento"),
                    p.get("evento"),
                    p.get("tipo_evento"),
                    p.get("fonte_evento"),
                )
                if chave in vistos:
                    continue
                vistos.add(chave)
                paradas.append(p)

        if linha_ref in LINHAS:
            _add(paradas_por_linha_data.get(linha_ref, {}).get(dia_ref, []))

        if not paradas:
            _add(paradas_por_data.get(dia_ref, []))

        paradas.sort(key=lambda x: (
            x.get("data_inicial") or "9999-12-31",
            x.get("hora_inicio") or "99:99:99",
            x.get("equipamento") or "",
            x.get("evento") or "",
            x.get("fonte_evento") or "",
        ))
        return paradas

    _marcar("fim_fetches_inicio_loop_lotes")
    resultado = []

    for r in rows_gantt:
        lote = normaliza_lote(r.get("lote"))
        if not lote:
            continue

        grupo = str(r.get("grupo_produto") or "").strip()
        qtd_prevista_cx_float = _to_float(r.get("qtd_prevista"))
        qtd_prevista_cx = round(qtd_prevista_cx_float)
        qtd_prevista_tb = qtd_prevista_cx * TUBETES_POR_CAIXA

        data_lib = data_str(r.get("data_lib"))
        data_lib_display = data_label(r.get("data_lib"))
        data_inicio = data_str(r.get("data_inicio"))
        data_fim = data_str(r.get("data_fim"))

        apts = apt_map.get(lote, {})

        check_lavagem = apts.get("LAVAGEM", {}).get("qtd", 0) > 0
        check_envase = apts.get("ENVASE", {}).get("qtd", 0) > 0
        check_embalagem = apts.get("EMBALAGEM", {}).get("qtd", 0) > 0

        sku_pa = apts.get("EMBALAGEM", {}).get("sku", "")

        qtd_liberada_cx_float = sd3_lote_map.get(lote, 0.0)
        qtd_liberada_cx = round(qtd_liberada_cx_float)
        check_liberado = qtd_liberada_cx_float > 0
        qtd_gap_cx = max(qtd_prevista_cx - qtd_liberada_cx, 0)
        # Mantém uma versão em float do gap (sem arredondar por lote) para os
        # cards que somam vários lotes de uma vez ("Embalados não liberados",
        # "Perda Rendimento" etc.) -- somar valores JÁ arredondados por lote
        # pode divergir em 1 cx do total real, exatamente o mesmo tipo de
        # acúmulo de round() que já foi corrigido em mtd_cx_liberado/
        # total_cx_liberado. Ver _soma_gap_status/_soma_mes_gap_status abaixo.
        qtd_gap_cx_float = max(qtd_prevista_cx_float - qtd_liberada_cx_float, 0.0)

        desvios = desvios_lote_map.get(lote, [])
        desvio = desvio_principal(desvios)
        seriais_desvio = desvio_seriais(desvios)
        destino_consolidado = desvio_destino_consolidado(desvios)
        desvio_reprovacao = any(eh_reprovacao_ou_descarte(d) for d in desvios)
        tem_desvio_atual_aberto = any(not d.get("historico_fechado") for d in desvios)
        em_desvio = tem_desvio_atual_aberto and not check_liberado

        equipamento_atual = None
        ordem_op = None

        for etapa in ["EMBALAGEM", "ENVASE", "LAVAGEM"]:
            if etapa in apts:
                equipamento_atual = apts[etapa].get("equipamento")
                ordem_op = apts[etapa].get("ordem")
                break

        qtd_produzida_tb = round(
            apts.get("ENVASE", {}).get("qtd", 0)
            or apts.get("EMBALAGEM", {}).get("qtd", 0)
            or apts.get("LAVAGEM", {}).get("qtd", 0)
        )
        qtd_produzida_cx = round(qtd_produzida_tb / TUBETES_POR_CAIXA)

        atrasado = False
        if data_lib and not check_liberado:
            try:
                atrasado = date_cls.fromisoformat(data_lib) < hoje
            except Exception:
                pass

        previsoes_atuais = gantt_atual_lotes_ano_map.get(lote, [])
        previsoes_globais = gantt_global_lotes_ano_map.get(lote, [])

        previsoes_atuais_mes = [
            p for p in previsoes_atuais
            if p.get("mes_previsto") == mes_analise
            and p.get("ano_previsto") == ano_analise
        ]
        previsoes_futuras_mes = [
            p for p in previsoes_atuais
            if (p.get("ano_previsto") or 0, p.get("mes_previsto") or 0) > (ano_analise, mes_analise)
        ]
        previsoes_futuras_global = [
            p for p in previsoes_globais
            if (p.get("ano_previsto") or 0, p.get("mes_previsto") or 0) > (ano_analise, mes_analise)
        ]
        previsoes_futuras = previsoes_futuras_global or previsoes_futuras_mes

        previsao_atual_ref = (
            previsoes_atuais_mes[0]
            if previsoes_atuais_mes
            else (previsoes_futuras[0] if previsoes_futuras else None)
        )

        # Regra simples e direta para mês fechado:
        # se o lote estava na V1 do mês analisado e na rodada operacional atual
        # aparece em mês futuro, ele é reprogramado/perda produção do mês de origem.
        # Não precisa esperar data_lib e não pode ficar preso como "Em desvio"
        # salvo quando já houver reprovação/descarte.
        reprogramado = bool(previsoes_futuras) and not check_liberado
        saiu_do_plano_atual = not bool(previsoes_atuais_mes) and not check_liberado
        tem_etapa_producao = check_lavagem or check_envase or check_embalagem

        # Atraso de produção na V2 do rastreamento:
        # se o lote estava na V1 do mês analisado, mas na rodada atual foi jogado
        # para mês futuro ou saiu do mês, ele precisa explicar perda do mês agora.
        # Não esperamos a data_lib original chegar, porque a própria reprogramação
        # já confirma que aquele volume não será liberado dentro do mês planejado.
        #
        # Um lote reprogramado conta como perda de produção mesmo que ainda esteja
        # em desvio aberto (sem resultado): só sai dessa conta se o desvio for
        # resolvido como reprovação (desvio_reprovacao), que sempre tem prioridade.
        # As outras duas causas (saiu do plano sem reprogramação, ou atrasado sem
        # etapa de produção) continuam exigindo que o lote não esteja em desvio.
        atraso_producao = (
            not check_liberado
            and not desvio_reprovacao
            and (
                reprogramado
                or (not em_desvio and saiu_do_plano_atual and not tem_etapa_producao)
                or (not em_desvio and atrasado and not tem_etapa_producao)
            )
        )

        # Perda por rendimento: caixas previstas V1 menos caixas liberadas
        # (SD3), OU -- se ainda não liberou -- menos a melhor referência
        # disponível de quantidade real esperada: quarentena (saldo físico
        # já contado, prioridade) ou, na falta dela, o ajuste manual (ver
        # migration 012, estimativa decidida antes da liberação). O
        # rendimento (real ou estimado) já é conhecido antes da liberação
        # formal; sem isso, o lote ficava contando o valor cheio do V1 no
        # Plano Atualizado até a liberação formal entrar na SD3. Ganho de
        # rendimento continua só positivo/pós-liberação (linha separada
        # mais abaixo) -- aqui só a perda.
        qtd_quarentena_lote = estoque_quarentena_lote.get(lote) if not check_liberado else None
        qtd_referencia_pendente = (
            qtd_quarentena_lote if qtd_quarentena_lote is not None
            else ajustes_planejado_mes.get(lote) if not check_liberado
            else None
        )
        qtd_perda_rendimento_cx = (
            max(qtd_prevista_cx - qtd_liberada_cx, 0)
            if check_liberado
            else max(qtd_prevista_cx - round(qtd_referencia_pendente), 0)
            if qtd_referencia_pendente is not None
            else 0
        )
        # Mesmo racional do qtd_gap_cx_float acima: versão em float, sem
        # arredondar por lote, para os cards que somam vários lotes.
        qtd_perda_rendimento_cx_float = (
            max(qtd_prevista_cx_float - qtd_liberada_cx_float, 0.0)
            if check_liberado
            else max(qtd_prevista_cx_float - qtd_referencia_pendente, 0.0)
            if qtd_referencia_pendente is not None
            else 0.0
        )
        perda_rendimento = qtd_perda_rendimento_cx > 0

        # Para o filtro e alerta "Previsto até hoje", vale literalmente a data prevista V1.
        # Lote reprogramado para mês futuro só entra no MTD quando a data_lib V1 já chegou.
        # Ex.: se estava previsto em 29/06 e hoje é 18/06, ainda não deve entrar em
        # "deveriam ter liberado até hoje", mesmo que já tenha sido jogado para julho.
        considerar_previsto_ate_hoje = False
        if data_lib:
            try:
                considerar_previsto_ate_hoje = date_cls.fromisoformat(data_lib) <= hoje
            except Exception:
                considerar_previsto_ate_hoje = False

        if check_liberado and perda_rendimento:
            status_gap = "Perda por rendimento"
        elif check_liberado:
            status_gap = "Liberado"
        elif desvio_reprovacao:
            status_gap = "Reprovação/desvio"
        elif atraso_producao:
            status_gap = "Atraso de produção"
        elif em_desvio:
            status_gap = "Em desvio"
        elif check_embalagem:
            status_gap = "Em embalagem"
        elif check_envase:
            status_gap = "Em envase"
        elif check_lavagem:
            status_gap = "Em lavagem"
        else:
            status_gap = "Não iniciado"

        motivo_gap = None
        if reprogramado and previsao_atual_ref:
            mes_destino = previsao_atual_ref.get("mes_previsto")
            ano_destino = previsao_atual_ref.get("ano_previsto")
            if mes_destino and ano_destino:
                motivo_gap = f"Reprogramado para {MES_LABELS[int(mes_destino) - 1]}/{ano_destino}"
        elif saiu_do_plano_atual and not check_liberado:
            motivo_gap = "Saiu do plano atual"
        elif perda_rendimento:
            motivo_gap = "Liberado abaixo do previsto V1"

        item = {
            "lote": lote,
            "grupo": grupo,
            "qtd_prevista_tb": qtd_prevista_tb,
            "qtd_prevista_cx": qtd_prevista_cx,
            "qtd_prevista_cx_float": qtd_prevista_cx_float,
            "qtd_produzida_tb": qtd_produzida_tb,
            "qtd_produzida_cx": qtd_produzida_cx,
            "qtd_liberada_cx": qtd_liberada_cx,
            "qtd_quarentena_cx": round(estoque_quarentena_lote.get(lote, 0.0)) if lote in estoque_quarentena_lote else None,
            "qtd_gap_cx": qtd_gap_cx,
            "qtd_gap_cx_float": qtd_gap_cx_float,
            "qtd_perda_rendimento_cx": qtd_perda_rendimento_cx,
            "qtd_perda_rendimento_cx_float": qtd_perda_rendimento_cx_float,
            "considerar_previsto_ate_hoje": considerar_previsto_ate_hoje,
            "sku_pa": sku_pa or None,
            "linha": r.get("linha"),
            "data_lib": data_lib,
            "data_lib_display": data_lib_display,
            "data_inicio": data_inicio,
            "data_fim": data_fim,
            "check_lavagem": check_lavagem,
            "check_envase": check_envase,
            "check_embalagem": check_embalagem,
            "check_liberado": check_liberado,
            "atrasado": atrasado,
            "equipamento_atual": equipamento_atual,
            "ordem_op": ordem_op,
            "em_desvio": em_desvio,
            "qtd_desvios": len(desvios),
            "desvios": desvios,
            "desvio_seriais": seriais_desvio,
            "desvio_serial": desvio.get("serial") if desvio else None,
            "desvio_titulo": desvio.get("titulo") if desvio else None,
            "desvio_estado": desvio.get("estado") if desvio else None,
            "desvio_dias": round(_to_float(desvio.get("dias_desvio"))) if desvio else None,
            "desvio_setor": desvio.get("setor") if desvio else None,
            "desvio_destino": desvio.get("destino") if desvio else None,
            "desvio_destino_consolidado": destino_consolidado,
            "desvio_reprovacao": desvio_reprovacao,
            "desvio_historico_fechado": bool(desvio.get("historico_fechado")) if desvio else False,
            "desvio_fonte": desvio.get("fonte_desvio") if desvio else None,
            "reprogramado": reprogramado,
            "atraso_producao": atraso_producao,
            "perda_rendimento": perda_rendimento,
            "status_gap": status_gap,
            "motivo_gap": motivo_gap,
            "data_lib_atual": previsao_atual_ref.get("data_lib_prevista") if previsao_atual_ref else None,
            "data_fim_atual": previsao_atual_ref.get("data_fim_prevista") if previsao_atual_ref else None,
            "mes_previsto_atual": previsao_atual_ref.get("mes_previsto") if previsao_atual_ref else None,
            "ano_previsto_atual": previsao_atual_ref.get("ano_previsto") if previsao_atual_ref else None,
            "esta_no_plano_atual_mes": bool(previsoes_atuais_mes),
            "qtd_prevista_atual_cx": round(sum(_to_float(p.get("qtd_prevista_cx")) for p in previsoes_atuais_mes)) if previsoes_atuais_mes else 0,
            "qtd_prevista_ajustada_cx": round(ajustes_planejado_mes[lote]) if lote in ajustes_planejado_mes else None,
            "qtd_tendencia_atual_cx": (
                qtd_liberada_cx if check_liberado
                # Quarentena (saldo físico contado) tem prioridade sobre o
                # ajuste manual (estimativa) -- ver migration 012.
                else round(estoque_quarentena_lote[lote]) if (lote in estoque_quarentena_lote and sd3_lote_map.get(lote, 0.0) <= 0)
                else round(ajustes_planejado_mes[lote]) if lote in ajustes_planejado_mes
                else (round(sum(_to_float(p.get("qtd_prevista_cx")) for p in previsoes_atuais_mes)) if previsoes_atuais_mes else 0)
            ),
            "rodada_atual_id": previsao_atual_ref.get("rodada_id") if previsao_atual_ref else None,
            "rodada_atual_mes": previsao_atual_ref.get("rodada_mes") if previsao_atual_ref else None,
            "rodada_atual_versao": previsao_atual_ref.get("rodada_versao") if previsao_atual_ref else None,
            "fonte_baseline": fonte_baseline,
            "rodada_id": r.get("rodada_id"),
            "rodada_mes": r.get("rodada_mes"),
            "rodada_versao": r.get("rodada_versao"),
        }
        item["status_operacional"] = status_operacional_lote(item)

        # Observação manual (ver migration 008): só sobrescreve o destino
        # exibido e o motivo enquanto ainda estiver "ativa" (sem produção
        # real no mês) -- assim que o lote liberar de verdade, some sozinho
        # sem precisar remover o cadastro (a linha na tabela pode continuar
        # existindo, só para de fazer efeito).
        observacao_manual_lote = observacoes_manuais_mes.get(lote)
        if observacao_manual_lote and sd3_lote_map.get(lote, 0.0) <= 0:
            item["observacao_manual"] = observacao_manual_lote
            item["desvio_destino_consolidado"] = observacao_manual_lote
            item["destino"] = observacao_manual_lote
            item["destino_produto_insumo"] = observacao_manual_lote
            # Zera a data de liberação exibida: o lote não entra na conta
            # do mês, então mostrar uma data prevista dentro do mês (que
            # não vai acontecer) confundiria quem está lendo a tabela.
            item["data_lib"] = None
            item["data_lib_display"] = None

        # Promoção pro mês corrente (ver migration 010): o lote saiu daqui,
        # continua aparecendo na tabela só pra registro/consulta, mas com
        # uma tag fixa em vez do status normal -- a exclusão da pendência
        # de verdade acontece mais abaixo, junto do ajuste do plano atual.
        promocao_saida = lotes_promovidos_para_fora.get(lote)
        if promocao_saida and sd3_lote_map.get(lote, 0.0) <= 0:
            mes_dest = promocao_saida.get("mes_destino")
            ano_dest = promocao_saida.get("ano_destino")
            tag_promovido = (
                f"Promovido para {MES_LABELS[int(mes_dest) - 1]}/{ano_dest}"
                if mes_dest and ano_dest else "Promovido para outro mês"
            )
            item["promovido_para"] = tag_promovido
            item["desvio_destino_consolidado"] = tag_promovido
            item["destino"] = tag_promovido
            item["destino_produto_insumo"] = tag_promovido
            item["data_lib"] = None
            item["data_lib_display"] = None

        resultado.append(item)

    # Lotes adicionados manualmente (ver migration 009): entram como uma
    # linha a mais, já marcados como liberados -- não vieram do Gantt/MPS,
    # então usam um item "sintético" com os campos que a tela/agregações
    # realmente precisam, o resto fica None/False (não se aplica a um
    # lote fora do plano automático).
    for lote_manual, dados_manual in lotes_manuais_por_codigo.items():
        qtd_cx = round(dados_manual["qtd_caixas"])
        data_lib_manual = dados_manual.get("data_liberacao")
        item_manual = {
            "lote": lote_manual,
            "grupo": dados_manual.get("grupo"),
            "qtd_prevista_tb": qtd_cx * TUBETES_POR_CAIXA,
            "qtd_prevista_cx": qtd_cx,
            "qtd_prevista_cx_float": dados_manual["qtd_caixas"],
            "qtd_produzida_tb": qtd_cx * TUBETES_POR_CAIXA,
            "qtd_produzida_cx": qtd_cx,
            "qtd_liberada_cx": qtd_cx,
            "qtd_gap_cx": 0,
            "qtd_gap_cx_float": 0.0,
            "qtd_perda_rendimento_cx": 0,
            "qtd_perda_rendimento_cx_float": 0.0,
            "considerar_previsto_ate_hoje": True,
            "sku_pa": None,
            "linha": None,
            "data_lib": data_lib_manual,
            "data_lib_display": data_lib_manual,
            "data_inicio": None,
            "data_fim": None,
            "check_lavagem": True,
            "check_envase": True,
            "check_embalagem": True,
            "check_liberado": True,
            "atrasado": False,
            "equipamento_atual": None,
            "ordem_op": None,
            "em_desvio": False,
            "qtd_desvios": 0,
            "desvios": [],
            "desvio_seriais": [],
            "desvio_serial": None,
            "desvio_titulo": None,
            "desvio_estado": None,
            "desvio_dias": None,
            "desvio_setor": None,
            "desvio_destino": None,
            "desvio_destino_consolidado": dados_manual.get("motivo") or "Adicionado manualmente",
            "desvio_reprovacao": False,
            "desvio_historico_fechado": False,
            "desvio_fonte": None,
            "reprogramado": False,
            "atraso_producao": False,
            "perda_rendimento": False,
            "status_gap": "Liberado (adicionado manualmente)",
            "motivo_gap": dados_manual.get("motivo") or "Lote adicionado manualmente ao rastreamento.",
            "data_lib_atual": None,
            "data_fim_atual": None,
            "mes_previsto_atual": mes_analise,
            "ano_previsto_atual": ano_analise,
            "esta_no_plano_atual_mes": False,
            "qtd_prevista_atual_cx": 0,
            "qtd_tendencia_atual_cx": qtd_cx,
            "rodada_atual_id": None,
            "rodada_atual_mes": None,
            "rodada_atual_versao": None,
            "fonte_baseline": "manual",
            "rodada_id": None,
            "rodada_mes": None,
            "rodada_versao": None,
            "lote_manual": True,
            "destino": dados_manual.get("motivo") or "Adicionado manualmente",
            "destino_produto_insumo": dados_manual.get("motivo") or "Adicionado manualmente",
        }
        item_manual["status_operacional"] = status_operacional_lote(item_manual)
        resultado.append(item_manual)

        # Soma direto no mapa de SD3 (mesma fonte que mes_cx_realizado e
        # total_cx_liberado já leem mais abaixo) -- assim o lote manual
        # conta como "real" pro mês sem precisar duplicar lógica de
        # agregação em vários lugares separados.
        sd3_lote_map[lote_manual] = sd3_lote_map.get(lote_manual, 0.0) + dados_manual["qtd_caixas"]

    # Promoção pro mês corrente (ver migration 010): lote que veio de outro
    # mês (não liberado, mas também não reprovado/descartado -- checado na
    # criação da promoção) entra como item sintético, do mesmo jeito que
    # lote manual acima, só que continua PENDENTE (não conta como já
    # liberado -- ele ainda precisa ser produzido/liberado de verdade,
    # só que agora dentro da expectativa deste mês em vez do mês antigo).
    for lote_promovido, dados_promocao in lotes_promovidos_para_dentro.items():
        if lote_promovido in lotes_manuais_por_codigo:
            continue  # já coberto como lote manual, evita duplicar linha

        qtd_cx_promovido = round(_to_float(dados_promocao.get("qtd_caixas")))
        mes_orig = dados_promocao.get("mes_origem")
        ano_orig = dados_promocao.get("ano_origem")
        tag_promovido_de = (
            f"Promovido de {MES_LABELS[int(mes_orig) - 1]}/{ano_orig}"
            if mes_orig and ano_orig else "Promovido de outro mês"
        )
        # O progresso físico real (lavagem/envase/embalagem) não reseta só
        # porque a expectativa de entrega mudou de mês -- um lote promovido
        # já pode ter passado por várias etapas no mês de origem. Busca o
        # mesmo apt_map (apontamentos por lote) que qualquer lote normal
        # usa aqui embaixo, só "check_liberado" continua sempre False (é
        # literalmente o motivo dele estar pendente e ter sido promovido).
        apts_promovido = apt_map.get(lote_promovido, {})
        check_lavagem_promovido = apts_promovido.get("LAVAGEM", {}).get("qtd", 0) > 0
        check_envase_promovido = apts_promovido.get("ENVASE", {}).get("qtd", 0) > 0
        check_embalagem_promovido = apts_promovido.get("EMBALAGEM", {}).get("qtd", 0) > 0
        sku_pa_promovido = apts_promovido.get("EMBALAGEM", {}).get("sku", "") or None

        # Mesma prioridade usada pro lote normal (ver bloco de perda de
        # rendimento mais acima): quarentena (saldo físico, mais concreta)
        # tem prioridade sobre o ajuste manual (estimativa) -- ver
        # migrations não numerada de quarentena e 012_lotes_ajuste_planejado.
        # Faltava aqui porque o lote promovido é montado num bloco de
        # código totalmente separado do loop normal.
        qtd_ajustada_promovido = ajustes_planejado_mes.get(lote_promovido)
        qtd_referencia_promovido = (
            estoque_quarentena_lote[lote_promovido] if lote_promovido in estoque_quarentena_lote
            else qtd_ajustada_promovido if qtd_ajustada_promovido is not None
            else None
        )
        qtd_tendencia_promovido = (
            round(qtd_referencia_promovido) if qtd_referencia_promovido is not None
            else qtd_cx_promovido
        )
        qtd_perda_rendimento_promovido = (
            max(qtd_cx_promovido - qtd_tendencia_promovido, 0)
            if qtd_referencia_promovido is not None else 0
        )
        item_promovido = {
            "lote": lote_promovido,
            "grupo": dados_promocao.get("grupo"),
            "qtd_prevista_tb": qtd_cx_promovido * TUBETES_POR_CAIXA,
            "qtd_prevista_cx": qtd_cx_promovido,
            "qtd_prevista_cx_float": _to_float(dados_promocao.get("qtd_caixas")),
            "qtd_produzida_tb": 0,
            "qtd_produzida_cx": 0,
            "qtd_liberada_cx": 0,
            "qtd_gap_cx": 0,
            "qtd_gap_cx_float": 0.0,
            "qtd_perda_rendimento_cx": qtd_perda_rendimento_promovido,
            "qtd_perda_rendimento_cx_float": float(qtd_perda_rendimento_promovido),
            "considerar_previsto_ate_hoje": True,
            "sku_pa": sku_pa_promovido,
            "linha": None,
            "data_lib": None,
            "data_lib_display": None,
            "data_inicio": None,
            "data_fim": None,
            "check_lavagem": check_lavagem_promovido,
            "check_envase": check_envase_promovido,
            "check_embalagem": check_embalagem_promovido,
            "check_liberado": False,
            "atrasado": False,
            "equipamento_atual": None,
            "ordem_op": None,
            "em_desvio": False,
            "qtd_desvios": 0,
            "desvios": [],
            "desvio_seriais": [],
            "desvio_serial": None,
            "desvio_titulo": None,
            "desvio_estado": None,
            "desvio_dias": None,
            "desvio_setor": None,
            "desvio_destino": None,
            "desvio_destino_consolidado": tag_promovido_de,
            "desvio_reprovacao": False,
            "desvio_historico_fechado": False,
            "desvio_fonte": None,
            "reprogramado": False,
            "atraso_producao": False,
            "perda_rendimento": qtd_perda_rendimento_promovido > 0,
            "status_gap": tag_promovido_de,
            "motivo_gap": f"Lote {tag_promovido_de.lower()}.",
            "data_lib_atual": None,
            "data_fim_atual": None,
            "mes_previsto_atual": mes_analise,
            "ano_previsto_atual": ano_analise,
            "esta_no_plano_atual_mes": True,
            "qtd_prevista_atual_cx": qtd_cx_promovido,
            "qtd_prevista_ajustada_cx": round(qtd_ajustada_promovido) if qtd_ajustada_promovido is not None else None,
            "qtd_tendencia_atual_cx": qtd_tendencia_promovido,
            "rodada_atual_id": None,
            "rodada_atual_mes": None,
            "rodada_atual_versao": None,
            "fonte_baseline": "promovido",
            "rodada_id": None,
            "rodada_mes": None,
            "rodada_versao": None,
            "promovido_de": tag_promovido_de,
            "destino": tag_promovido_de,
            "destino_produto_insumo": tag_promovido_de,
        }
        item_promovido["status_operacional"] = status_operacional_lote(item_promovido)
        resultado.append(item_promovido)

    _marcar("fim_loop_lotes")

    resultado.sort(key=lambda x: (
        0 if (x.get("em_desvio") and x.get("atrasado") and not x.get("check_liberado")) else
        1 if (x.get("atrasado") and not x.get("check_liberado")) else
        2,
        x.get("data_lib") or "9999-12-31",
        x.get("lote") or "",
    ))

    lotes_mtd = [
        r for r in resultado
        if r.get("considerar_previsto_ate_hoje")
    ]

    lotes_futuros = [
        r for r in resultado
        if not r["data_lib"] or r["data_lib"] > hoje_iso
    ]

    mtd_cx_previsto = sum(r["qtd_prevista_cx"] for r in lotes_mtd)
    # Soma floats e arredonda só no final — evita acúmulo de round() por lote
    mtd_cx_liberado = round(sum(
        sd3_lote_map.get(normaliza_lote(r.get("lote")), 0.0)
        for r in lotes_mtd
    ))
    mtd_cx_gap = max(mtd_cx_previsto - mtd_cx_liberado, 0)

    # Totais por causa usando exatamente o status principal de cada lote.
    # Isso evita dupla contagem: um lote reprovado ou em desvio pode ter passado por envase,
    # mas ele deve aparecer só na causa prioritária.
    def _soma_gap_status(status: str) -> float:
        return sum(
            r["qtd_gap_cx_float"]
            for r in lotes_mtd
            if r.get("status_gap") == status
            and not r.get("check_liberado")
        )

    # Etapa física do lote (embalagem/envase/lavagem/não iniciado), calculada
    # de forma independente de estar ou não em desvio aberto -- diferente do
    # status_gap (usado pro badge/filtro de cada linha na tabela), que hoje
    # classifica um lote em desvio aberto só como "Em desvio", escondendo em
    # qual etapa ele realmente está. Um lote já embalado que caiu em desvio
    # continua contando como "embalado" pros cards por etapa; o card mostra
    # à parte quantos daquela etapa estão em desvio.
    def _etapa_fisica_lote(item: dict) -> str | None:
        if item.get("check_liberado"):
            return None
        if item.get("desvio_reprovacao"):
            return None
        if item.get("reprogramado") or item.get("atraso_producao"):
            return None
        if item.get("check_embalagem"):
            return "embalagem"
        if item.get("check_envase"):
            return "envase"
        if item.get("check_lavagem"):
            return "lavagem"
        return "nao_iniciado"

    def _soma_etapa_fisica(lotes: list[dict], etapa: str, apenas_em_desvio: bool = False) -> float:
        total = 0.0
        for item in lotes:
            if _etapa_fisica_lote(item) != etapa:
                continue
            if apenas_em_desvio and not item.get("em_desvio"):
                continue
            # Lote com observação manual ativa (ex.: "aguardando aprovação
            # ANVISA") ou promovido pra outro mês já saiu da conta do Plano
            # Atualizado (vai pro card "Outros") -- sem isso aqui, os cards
            # de status físico (Embalados/Envasados/Lavados/Não iniciados)
            # continuavam somando o lote e nunca fechavam com o total de
            # "Plano Atualizado" (13.365), ficando maior por causa dos
            # lotes que já saíram da conta principal.
            if item.get("observacao_manual") or item.get("promovido_para"):
                continue
            total += _to_float(
                item.get("qtd_gap_cx_float")
                if item.get("qtd_gap_cx_float") is not None
                else item.get("qtd_prevista_cx_float", item.get("qtd_prevista_cx", 0))
            )
        return total

    mtd_reprovacao_desvio = _soma_gap_status("Reprovação/desvio")
    mtd_desvio_aberto = _soma_gap_status("Em desvio")

    # Compatibilidade com o front antigo: `desvio` continua existindo,
    # mas a tela nova separa `reprovacao_desvio` de desvio aberto.
    mtd_desvio = mtd_reprovacao_desvio + mtd_desvio_aberto

    mtd_atraso_producao = _soma_gap_status("Atraso de produção")

    mtd_perda_rendimento = sum(
        r.get("qtd_perda_rendimento_cx_float", 0.0)
        for r in lotes_mtd
        if r.get("qtd_perda_rendimento_cx_float", 0.0) > 0
    )

    mtd_embalagem = _soma_etapa_fisica(lotes_mtd, "embalagem")
    mtd_embalagem_em_desvio = _soma_etapa_fisica(lotes_mtd, "embalagem", apenas_em_desvio=True)
    mtd_envase = _soma_etapa_fisica(lotes_mtd, "envase")
    mtd_envase_em_desvio = _soma_etapa_fisica(lotes_mtd, "envase", apenas_em_desvio=True)
    mtd_lavagem = _soma_etapa_fisica(lotes_mtd, "lavagem")
    mtd_lavagem_em_desvio = _soma_etapa_fisica(lotes_mtd, "lavagem", apenas_em_desvio=True)
    mtd_nao_iniciado = _soma_etapa_fisica(lotes_mtd, "nao_iniciado")
    mtd_nao_iniciado_em_desvio = _soma_etapa_fisica(lotes_mtd, "nao_iniciado", apenas_em_desvio=True)

    # Total "em desvio aberto" agora é só informativo (soma das 4 etapas acima
    # que também estão em desvio) -- não entra mais somado à parte na
    # reconciliação, pra não contar o mesmo lote duas vezes (uma na etapa,
    # outra em "desvio aberto").
    mtd_desvio_aberto = (
        mtd_embalagem_em_desvio
        + mtd_envase_em_desvio
        + mtd_lavagem_em_desvio
        + mtd_nao_iniciado_em_desvio
    )

    # Total oficial do alerta:
    # Faltam = previsto até hoje - liberado até hoje.
    # Esta é a conta executiva exibida no topo e precisa ser a referência final.
    mtd_cx_gap_oficial = max(mtd_cx_previsto - mtd_cx_liberado, 0)

    # Total operacional dos cards por causa.
    # A classificação é por status único do lote, mas pode sobrar pequena diferença
    # por arredondamento de tubetes/centos/caixas entre o total oficial e a soma
    # dos lotes/status. Para apresentação e conciliação, os cards devem fechar
    # exatamente com o alerta superior.
    mtd_cx_gap_operacional_bruto = round(
        mtd_reprovacao_desvio
        + mtd_atraso_producao
        + mtd_perda_rendimento
        + mtd_embalagem
        + mtd_envase
        + mtd_lavagem
        + mtd_nao_iniciado
    )

    diferenca_conciliacao = round(mtd_cx_gap_oficial - mtd_cx_gap_operacional_bruto)

    if diferenca_conciliacao:
        # O resíduo é ajuste de arredondamento, não uma nova causa operacional.
        # Ajusta primeiro o maior card operacional em andamento, normalmente Envase,
        # para preservar as causas fechadas/auditáveis: reprovação, desvio, atraso e rendimento.
        causas_ajustaveis = [
            ("envase", mtd_envase),
            ("embalagem", mtd_embalagem),
            ("lavagem", mtd_lavagem),
            ("nao_iniciado", mtd_nao_iniciado),
        ]

        causa_alvo = next((nome for nome, valor in causas_ajustaveis if valor + diferenca_conciliacao >= 0 and valor > 0), None)

        if causa_alvo == "envase":
            mtd_envase += diferenca_conciliacao
        elif causa_alvo == "embalagem":
            mtd_embalagem += diferenca_conciliacao
        elif causa_alvo == "lavagem":
            mtd_lavagem += diferenca_conciliacao
        elif causa_alvo == "nao_iniciado":
            mtd_nao_iniciado += diferenca_conciliacao
        else:
            # Fallback raro: evita deixar o topo diferente dos cards se só houver
            # causas fechadas. Usa envase como ajuste neutro operacional.
            mtd_envase = max(mtd_envase + diferenca_conciliacao, 0)

    mtd_cx_gap_operacional = round(
        mtd_reprovacao_desvio
        + mtd_atraso_producao
        + mtd_perda_rendimento
        + mtd_embalagem
        + mtd_envase
        + mtd_lavagem
        + mtd_nao_iniciado
    )

    # Visão mensal executiva: V1 do mês versus plano atual/tendência.
    # Esta visão NÃO depende da data_lib <= hoje; ela mostra o impacto esperado no mês fechado.
    lotes_mes = resultado

    def _soma_mes_gap_status(status: str) -> float:
        return sum(
            r["qtd_gap_cx_float"]
            for r in lotes_mes
            if r.get("status_gap") == status
            and not r.get("check_liberado")
        )

    mes_reprovacao_desvio = _soma_mes_gap_status("Reprovação/desvio")
    mes_atraso_producao = _soma_mes_gap_status("Atraso de produção")
    # Filtra pelo valor calculado (qtd_perda_rendimento_cx_float > 0), não
    # pelo texto de status_gap: um lote ainda não liberado, mas já com
    # perda por quarentena (armazém 98), continua com o status normal dele
    # (ex.: "Em embalagem") -- só o card de perda de rendimento precisa
    # saber da perda, não a coluna Status da tabela.
    mes_perda_rendimento = sum(
        r.get("qtd_perda_rendimento_cx_float", 0.0)
        for r in lotes_mes
        if r.get("qtd_perda_rendimento_cx_float", 0.0) > 0
    )
    mes_embalagem = _soma_etapa_fisica(lotes_mes, "embalagem")
    mes_embalagem_em_desvio = _soma_etapa_fisica(lotes_mes, "embalagem", apenas_em_desvio=True)
    mes_envase = _soma_etapa_fisica(lotes_mes, "envase")
    mes_envase_em_desvio = _soma_etapa_fisica(lotes_mes, "envase", apenas_em_desvio=True)
    mes_lavagem = _soma_etapa_fisica(lotes_mes, "lavagem")
    mes_lavagem_em_desvio = _soma_etapa_fisica(lotes_mes, "lavagem", apenas_em_desvio=True)
    mes_nao_iniciado = _soma_etapa_fisica(lotes_mes, "nao_iniciado")
    mes_nao_iniciado_em_desvio = _soma_etapa_fisica(lotes_mes, "nao_iniciado", apenas_em_desvio=True)

    # Idem ao mtd_desvio_aberto acima: agora é só informativo, soma das 4
    # etapas que também estão em desvio -- não entra somado à parte em
    # nenhuma reconciliação (mes_cx_perdas_brutas_vs_v1/mes_cx_diferenca_vs_v1
    # já nem usam mes_desvio_aberto, só as causas fechadas + rendimento).
    mes_desvio_aberto = (
        mes_embalagem_em_desvio
        + mes_envase_em_desvio
        + mes_lavagem_em_desvio
        + mes_nao_iniciado_em_desvio
    )

    # Plano atual puro = total da versão atual para o mês analisado.
    # Tendência atual = tudo que já liberou na SD3 + o que a versão atual ainda prevê
    # para o mês e ainda não liberou. Isso inclui lotes novos da versão atual, mesmo
    # que não existissem na V1.
    mes_cx_previsto_v1 = round(sum(r["qtd_prevista_cx"] for r in lotes_mes))

    plano_atual_mes_map: dict[str, float] = {}
    for r_atual in rows_gantt_ano_atual:
        lote_atual = normaliza_lote(r_atual.get("lote"))
        if not lote_atual:
            continue
        if mes_int(r_atual.get("mes")) != mes_analise or ano_int(r_atual.get("ano")) != ano_analise:
            continue
        plano_atual_mes_map[lote_atual] = plano_atual_mes_map.get(lote_atual, 0.0) + _to_float(r_atual.get("qtd_prevista"))

    # Quarentena (armazém 98): um lote que já passou por envase/embalagem e
    # está fisicamente parado ali já tem o rendimento real conhecido -- usa
    # essa quantidade em vez da planejada (o rendimento real, positivo ou
    # negativo, já aconteceu de verdade, só ainda não virou liberação
    # formal). Só vale pra quem ainda não liberou -- assim que liberar, o
    # real da SD3 (mais abaixo) já assume sozinho.
    for lote_quarentena, qtd_quarentena in estoque_quarentena_lote.items():
        if lote_quarentena not in plano_atual_mes_map:
            continue
        if sd3_lote_map.get(lote_quarentena, 0.0) > 0:
            continue
        plano_atual_mes_map[lote_quarentena] = qtd_quarentena

    # Promoção pro mês corrente (ver migration 010), lado DESTINO: soma a
    # quantidade do lote promovido no plano atual deste mês, como se fosse
    # planejamento novo -- flui pelas mesmas contas de saldo/pendência
    # daqui pra baixo, sem precisar de ajuste especial (só entra igual
    # qualquer outro lote ainda não liberado do mês). Pula quem também é
    # lote manual (já contado como real via sd3_lote_map, evita somar 2x).
    for lote_promovido, dados_promocao in lotes_promovidos_para_dentro.items():
        if lote_promovido in lotes_manuais_por_codigo:
            continue
        # Mesma prioridade do item exibido na tabela: quarentena (saldo
        # físico) > ajuste manual (migration 012) > quantidade original da
        # promoção -- sem isso, editar "Caixas Planejadas" de um lote
        # promovido não refletia no Plano Atualizado do mês.
        qtd_promocao_map = (
            estoque_quarentena_lote[lote_promovido] if lote_promovido in estoque_quarentena_lote
            else ajustes_planejado_mes[lote_promovido] if lote_promovido in ajustes_planejado_mes
            else _to_float(dados_promocao.get("qtd_caixas"))
        )
        plano_atual_mes_map[lote_promovido] = plano_atual_mes_map.get(lote_promovido, 0.0) + qtd_promocao_map

    # "Ativa" = ainda sem produção real lançada no mês (observacoes_manuais_mes
    # já foi buscado lá no início da função, antes do loop de lotes, pra dar
    # tempo de tagueado cada item); assim que o lote liberar de verdade
    # (sd3_lote_map > 0), o efeito para sozinho de contar, sem precisar
    # remover a observação.
    lotes_com_observacao_manual_ativa = {
        lote for lote in observacoes_manuais_mes
        if sd3_lote_map.get(lote, 0.0) <= 0
    }

    # Promoção pro mês corrente (ver migration 010), lado ORIGEM: mesmo
    # racional da observação manual -- "ativa" enquanto o lote ainda não
    # tiver produção real lançada no mês de origem. Reaproveita o mesmo
    # card "Outros" (é literalmente isso: saiu da conta padrão do mês por
    # um motivo que não é reprovação/atraso/rendimento padrão).
    lotes_promovidos_para_fora_ativos = {
        lote for lote in lotes_promovidos_para_fora
        if sd3_lote_map.get(lote, 0.0) <= 0
    }

    # Quantidade que sai do plano atual (saldo/atraso) e vai para o card
    # "Outros" -- some da conta normal antes de qualquer soma/saldo usar
    # plano_atual_mes_map daqui pra baixo, então cobre tanto o "plano atual
    # puro" quanto o saldo bruto de uma vez só.
    #
    # IMPORTANTE: soma pela quantidade V1/exibida de cada lote (qtd_prevista_cx,
    # a mesma que aparece na coluna "Caixas Planejadas"), não pelo valor bruto
    # em plano_atual_mes_map. Achamos um caso real (5 lotes "aguardando
    # ANVISA" somando 1.360 cx na coluna, mas o card Outros mostrando 1.450)
    # -- a rodada MRP atual tinha uma quantidade diferente da V1 exibida pra
    # pelo menos um desses lotes (provavelmente linha duplicada/atualização
    # de rodada), fazendo o card branco "Outros" divergir do que a pessoa vê
    # na tabela. Usar a quantidade exibida garante que os dois sempre batem.
    qtd_exibida_por_lote = {item["lote"]: _to_float(item.get("qtd_prevista_cx")) for item in lotes_mes}
    mes_cx_outros_card = round(sum(
        qtd_exibida_por_lote.get(lote, plano_atual_mes_map.get(lote, 0.0))
        for lote in lotes_com_observacao_manual_ativa | lotes_promovidos_para_fora_ativos
    ))
    for lote in lotes_com_observacao_manual_ativa | lotes_promovidos_para_fora_ativos:
        plano_atual_mes_map.pop(lote, None)

    # Real usado na visão mensal: somente liberações de lotes ligados ao Gantt/MPS
    # de junho (V1 ou versão atual do mês). Entradas reais fora do plano do mês
    # não entram nesta conciliação, para o número bater com a régua operacional.
    lotes_v1_mes_set = {normaliza_lote(r.get("lote")) for r in lotes_mes if normaliza_lote(r.get("lote"))}
    lotes_plano_atual_mes_set = set(plano_atual_mes_map.keys())
    # Lotes manuais (ver migration 009) não vêm do Gantt/MPS, então não
    # entrariam em nenhum dos dois conjuntos acima -- sem isso aqui,
    # mes_cx_realizado ignoraria a soma que já colocamos em sd3_lote_map
    # lá no fim do loop principal.
    lotes_real_elegiveis_mes = lotes_v1_mes_set | lotes_plano_atual_mes_set | set(lotes_manuais_por_codigo.keys())

    mes_cx_realizado = round(sum(
        _to_float(qtd_real)
        for lote_real, qtd_real in sd3_lote_map.items()
        if lote_real in lotes_real_elegiveis_mes
    ))
    mes_cx_plano_atual_puro = round(sum(plano_atual_mes_map.values()))

    # Saldo bruto da versão atual: lotes ainda não liberados que continuam no MPS do mês.
    # Importante: o MPS pode continuar com o bloco cheio mesmo quando a Qualidade/Desvios
    # já indicou perda/reprovação. Para a visão executiva, o "Planejado liberação atualizado"
    # precisa descontar automaticamente essas perdas, senão a conta com a V1 não fecha.
    mes_saldo_tendencia_bruto = sum(
        qtd_atual
        for lote_atual, qtd_atual in plano_atual_mes_map.items()
        if sd3_lote_map.get(lote_atual, 0.0) <= 0
    )

    mes_desconto_reprovacao_plano_atual = 0.0
    for r_mes in lotes_mes:
        lote_mes = normaliza_lote(r_mes.get("lote"))
        if not lote_mes:
            continue
        if r_mes.get("check_liberado"):
            continue
        if not (r_mes.get("desvio_reprovacao") or str(r_mes.get("status_gap") or "") == "Reprovação/desvio"):
            continue

        saldo_lote_atual = _to_float(plano_atual_mes_map.get(lote_mes, 0.0))
        if saldo_lote_atual <= 0:
            continue

        # Deduz no máximo o saldo que ainda está no MPS atual e no máximo a perda/gap do lote.
        mes_desconto_reprovacao_plano_atual += min(
            saldo_lote_atual,
            _to_float(r_mes.get("qtd_gap_cx", 0.0)),
        )

    mes_cx_desconto_reprovacao_plano_atual = round(mes_desconto_reprovacao_plano_atual)
    mes_cx_saldo_tendencia_bruto = round(mes_saldo_tendencia_bruto)
    mes_cx_saldo_tendencia = max(
        mes_cx_saldo_tendencia_bruto - mes_cx_desconto_reprovacao_plano_atual,
        0,
    )
    mes_cx_plano_atual_tendencia = round(mes_cx_realizado + mes_cx_saldo_tendencia)
    mes_cx_diferenca_vs_v1 = round(mes_cx_previsto_v1 - mes_cx_plano_atual_tendencia)

    # Conciliação mensal V1 x plano atualizado/tendência.
    # A diferença líquida nem sempre é igual à soma bruta das perdas, porque a
    # versão atual pode ter acrescentado lotes ou aumentado quantidades.
    # Fórmula auditável:
    #   V1 = plano atualizado/tendência + reduções/perdas - acréscimos do plano atual
    v1_mes_map: dict[str, float] = {}
    resultado_por_lote: dict[str, dict] = {}
    for r_mes in lotes_mes:
        lote_mes = normaliza_lote(r_mes.get("lote"))
        if not lote_mes:
            continue
        v1_mes_map[lote_mes] = v1_mes_map.get(lote_mes, 0.0) + _to_float(r_mes.get("qtd_prevista_cx_float", r_mes.get("qtd_prevista_cx")))
        resultado_por_lote[lote_mes] = r_mes

    tendencia_mes_map: dict[str, float] = {}
    for lote_atual, qtd_atual in plano_atual_mes_map.items():
        real_lote = _to_float(sd3_lote_map.get(lote_atual, 0.0))
        tendencia_mes_map[lote_atual] = real_lote if real_lote > 0 else _to_float(qtd_atual)

    # Lotes da V1 que já liberaram também entram pelo real, mesmo que tenham
    # saído da versão atual. Mas liberações reais totalmente fora do Gantt/MPS
    # do mês ficam fora desta conciliação.
    for lote_real, qtd_real in sd3_lote_map.items():
        if lote_real in lotes_real_elegiveis_mes and _to_float(qtd_real) > 0:
            tendencia_mes_map[lote_real] = _to_float(qtd_real)

    mes_reducao_reprovacao_desvio = 0.0
    mes_reducao_atraso_producao = 0.0
    mes_reducao_rendimento = 0.0
    mes_reducao_outras = 0.0
    mes_acrescimo_plano_atual = 0.0
    mes_ganho_rendimento = 0.0

    for lote_mes in sorted(set(v1_mes_map) | set(tendencia_mes_map)):
        qtd_v1_lote = _to_float(v1_mes_map.get(lote_mes, 0.0))
        qtd_tendencia_lote = _to_float(tendencia_mes_map.get(lote_mes, 0.0))

        reducao_lote = max(qtd_v1_lote - qtd_tendencia_lote, 0.0)
        acrescimo_lote = max(qtd_tendencia_lote - qtd_v1_lote, 0.0)

        real_lote = _to_float(sd3_lote_map.get(lote_mes, 0.0))
        if qtd_v1_lote > 0 and real_lote > qtd_v1_lote:
            # Ganhou rendimento na liberação real frente à V1.
            # Mostra separado para não misturar com acréscimo de plano/novos lotes.
            mes_ganho_rendimento += max(real_lote - qtd_v1_lote, 0.0)
        else:
            mes_acrescimo_plano_atual += acrescimo_lote

        if reducao_lote <= 0:
            continue

        r_mes = resultado_por_lote.get(lote_mes, {})
        status_gap_lote = str(r_mes.get("status_gap") or "")

        if status_gap_lote == "Atraso de produção" or r_mes.get("reprogramado") or r_mes.get("atraso_producao"):
            mes_reducao_atraso_producao += reducao_lote
        elif status_gap_lote == "Reprovação/desvio" or r_mes.get("desvio_reprovacao"):
            mes_reducao_reprovacao_desvio += reducao_lote
        elif status_gap_lote == "Perda por rendimento" or r_mes.get("check_liberado") or r_mes.get("perda_rendimento"):
            mes_reducao_rendimento += reducao_lote
        else:
            # Mantém rastreabilidade sem forçar uma causa incorreta. Se aparecer
            # valor aqui, o front mostra como ajuste/outros na conciliação.
            mes_reducao_outras += reducao_lote

    # Cards mensais exibidos no topo: são os principais movimentos explicativos.
    # Reprovação/desvio vem da classificação operacional do lote e também é deduzida
    # do plano atualizado quando o MPS ainda mantém o bloco cheio.
    mes_cx_reprovacao_desvio_card = round(mes_reprovacao_desvio)
    mes_cx_atraso_producao_card = round(mes_atraso_producao)
    mes_cx_perda_rendimento_card = round(mes_perda_rendimento)
    mes_cx_ganho_rendimento = round(mes_ganho_rendimento)

    # Mantém estes campos por compatibilidade, mas o front não exibe mais o
    # card de acréscimo de plano atual.
    mes_cx_acrescimo_plano_atual = 0
    mes_cx_perdas_brutas_vs_v1 = round(
        mes_cx_reprovacao_desvio_card
        + mes_cx_atraso_producao_card
        + mes_cx_perda_rendimento_card
    )
    mes_cx_reconciliado_v1 = mes_cx_previsto_v1

    total_cx_previsto = sum(r["qtd_prevista_cx"] for r in resultado)
    # Soma em float antes de arredondar — evita acúmulo de erros de round() por lote
    total_cx_sd3_mes = round(sum(sd3_lote_map.values()))
    # total_cx_liberado: soma os floats dos lotes do plano de maio e arredonda só no final
    # (evita +1 por acúmulo de round() individual por lote)
    total_cx_liberado = round(sum(
        sd3_lote_map.get(normaliza_lote(r.get("lote")), 0.0)
        for r in resultado
    ))
    total_cx_fora_gantt = sum(r["qtd_cx"] for r in lotes_fora_gantt)

    total_lotes_desvio = sum(1 for r in resultado if r.get("em_desvio"))
    total_cx_desvio = sum(
        r["qtd_gap_cx"]
        for r in resultado
        if r.get("em_desvio") and not r.get("check_liberado")
    )

    rodada_ref = rodada_baseline_v1 or rodada_atual_mrp

    atraso_producao_lotes = []
    for r in resultado:
        if not (r.get("atraso_producao") or r.get("reprogramado") or r.get("status_gap") == "Atraso de produção"):
            continue

        lote_atraso = normaliza_lote(r.get("lote"))
        previsoes_atuais_atraso = gantt_global_lotes_ano_map.get(lote_atraso, []) or gantt_atual_lotes_ano_map.get(lote_atraso, [])
        previsoes_mes_atraso = [
            p for p in previsoes_atuais_atraso
            if p.get("mes_previsto") == mes_analise and p.get("ano_previsto") == ano_analise
        ]
        previsoes_futuras_atraso = [
            p for p in previsoes_atuais_atraso
            if (p.get("ano_previsto") or 0, p.get("mes_previsto") or 0) > (ano_analise, mes_analise)
        ]
        previsao_ref_atraso = previsoes_mes_atraso[0] if previsoes_mes_atraso else (previsoes_futuras_atraso[0] if previsoes_futuras_atraso else None)

        destino_mes = r.get("mes_previsto_atual")
        destino_ano = r.get("ano_previsto_atual")
        if destino_mes and destino_ano:
            destino_label = f"{MES_LABELS[int(destino_mes) - 1]}/{destino_ano}"
        else:
            destino_label = None

        eventos_lote_atraso = apt_eventos_lote_map.get(lote_atraso, [])
        datas_eventos_lote = [
            normaliza_data(ev.get("data_final") or ev.get("data_inicial"))
            for ev in eventos_lote_atraso
            if normaliza_data(ev.get("data_final") or ev.get("data_inicial"))
        ]
        data_fim_real_apontamento_dt = max(datas_eventos_lote) if datas_eventos_lote else None
        data_fim_real_apontamento = data_fim_real_apontamento_dt.isoformat() if data_fim_real_apontamento_dt else None

        data_fim_prevista_dt = normaliza_data(r.get("data_fim") or r.get("data_lib"))
        data_fim_atual_dt = normaliza_data(
            (previsao_ref_atraso or {}).get("data_fim_prevista")
            or (previsao_ref_atraso or {}).get("data_lib_prevista")
        )
        data_fim_ref_dt = data_fim_real_apontamento_dt or data_fim_atual_dt or data_fim_prevista_dt

        apontamentos_periodo = []
        for ev in eventos_lote_atraso:
            if ev.get("is_parada"):
                continue
            data_ev = normaliza_data(ev.get("data_inicial") or ev.get("data_final"))
            if not data_ev:
                continue
            if data_fim_prevista_dt and data_fim_ref_dt:
                inicio_periodo = min(data_fim_prevista_dt, data_fim_ref_dt)
                fim_periodo = max(data_fim_prevista_dt, data_fim_ref_dt)
                if not (inicio_periodo <= data_ev <= fim_periodo):
                    continue
            elif data_fim_prevista_dt and data_ev != data_fim_prevista_dt:
                continue
            apontamentos_periodo.append(ev)

        linha_ref_atraso = (
            r.get("linha")
            or (previsao_ref_atraso or {}).get("linha_prevista")
            or _linha_from_lote(lote_atraso)
        )
        # Para a leitura executiva do modal, segue o mesmo raciocínio do MPS:
        # olhar o dia do fim previsto anterior/V1 e trazer paradas por linha/recurso.
        paradas_dia_fim_previsto = _paradas_cascata_dia_fim_previsto(linha_ref_atraso, data_fim_prevista_dt)
        total_horas_parada_dia = round(sum(_to_float(ev.get("duracao_horas", ev.get("duracao_h"))) for ev in paradas_dia_fim_previsto), 2)

        # Mantém compatibilidade com o front antigo: campos *_periodo apontam para
        # o dia do fim previsto V1.
        paradas_periodo = paradas_dia_fim_previsto
        total_horas_parada = total_horas_parada_dia

        if r.get("reprogramado") and destino_label:
            explicacao = f"Reprogramado para {destino_label}. O volume saiu da liberação prevista de {MES_LABELS[mes_analise - 1]}/{ano_analise}."
        elif r.get("motivo_gap"):
            explicacao = str(r.get("motivo_gap"))
        elif r.get("data_lib") and r.get("data_lib") < hoje_iso:
            explicacao = "Data prevista V1 já vencida e lote ainda sem liberação no SD3."
        else:
            explicacao = "Lote previsto na V1 sem liberação confirmada no SD3 e sem permanência equivalente no plano atual do mês."

        if paradas_periodo:
            data_ref_txt = data_fim_prevista_dt.strftime("%d/%m/%Y") if data_fim_prevista_dt else "dia previsto"
            resumo_parada = f"{len(paradas_periodo)} ocorrência(s) de parada no dia {data_ref_txt}, somando {str(total_horas_parada).replace('.', ',')} h."
        else:
            data_ref_txt = data_fim_prevista_dt.strftime("%d/%m/%Y") if data_fim_prevista_dt else "dia previsto"
            resumo_parada = f"Sem parada registrada no relatório de apontamento no dia {data_ref_txt}."

        atraso_producao_lotes.append({
            "lote": r.get("lote"),
            "grupo": r.get("grupo"),
            "linha": linha_ref_atraso,
            "produto": r.get("sku_pa") or r.get("grupo"),
            "qtd_prevista_cx": r.get("qtd_prevista_cx"),
            "qtd_prevista_tb": r.get("qtd_prevista_tb"),
            "qtd_atual_cx": round(sum(_to_float(p.get("qtd_prevista_cx")) for p in previsoes_mes_atraso)) if previsoes_mes_atraso else 0,
            "qtd_futura_cx": round(sum(_to_float(p.get("qtd_prevista_cx")) for p in previsoes_futuras_atraso)) if previsoes_futuras_atraso else 0,
            "data_inicio_prevista": r.get("data_inicio"),
            "data_fim_prevista": r.get("data_fim"),
            "data_lib_prevista": r.get("data_lib"),
            "data_inicio_atual": previsao_ref_atraso.get("data_inicio_prevista") if previsao_ref_atraso else None,
            "data_fim_atual": previsao_ref_atraso.get("data_fim_prevista") if previsao_ref_atraso else None,
            "data_lib_atual": previsao_ref_atraso.get("data_lib_prevista") if previsao_ref_atraso else None,
            "data_fim_real_apontamento": data_fim_real_apontamento,
            "fim_real_fonte": "Relatório de apontamento" if data_fim_real_apontamento else ("MPS atual" if previsao_ref_atraso else None),
            "paradas_periodo": paradas_periodo[:12],
            "qtd_paradas_periodo": len(paradas_periodo),
            "horas_parada_periodo": total_horas_parada,
            "paradas_dia_fim_previsto": paradas_dia_fim_previsto[:12],
            "qtd_paradas_dia_fim_previsto": len(paradas_dia_fim_previsto),
            "horas_paradas_dia_fim_previsto": total_horas_parada_dia,
            "data_referencia_parada": data_fim_prevista_dt.isoformat() if data_fim_prevista_dt else None,
            "apontamentos_periodo": apontamentos_periodo[:5],
            "resumo_parada": resumo_parada,
            "mes_previsto_atual": destino_mes,
            "ano_previsto_atual": destino_ano,
            "status_atual": r.get("status_gap"),
            "motivo": r.get("motivo_gap"),
            "explicacao": explicacao,
            "check_lavagem": r.get("check_lavagem"),
            "check_envase": r.get("check_envase"),
            "check_embalagem": r.get("check_embalagem"),
            "check_liberado": r.get("check_liberado"),
            "em_desvio": r.get("em_desvio"),
            "desvio_reprovacao": r.get("desvio_reprovacao"),
        })

    atraso_producao_lotes.sort(key=lambda x: (
        x.get("data_lib_prevista") or "9999-12-31",
        x.get("lote") or "",
    ))

    # Cálculo simples e direto, só pra conferência: soma o gap dos lotes
    # marcados como reprogramado (e cujo desvio, se houver, não foi
    # resolvido como reprovação). Não usa nenhuma das variáveis de cima,
    # é só um contador cru, fácil de auditar por fora.
    perda_producao_reprogramados_simples = round(sum(
        r["qtd_gap_cx"]
        for r in resultado
        if r.get("reprogramado") and not r.get("desvio_reprovacao")
    ))
    lotes_reprogramados_simples = [
        r.get("lote") for r in resultado
        if r.get("reprogramado") and not r.get("desvio_reprovacao")
    ]

    # Blindagem executiva: o card de Perda Produção nunca pode ficar menor
    # que a soma direta dos lotes da V1 reprogramados para mês futuro.
    # Reprovação/descarte continua fora daqui e permanece no card de Reprovação/Desvio.
    mes_cx_atraso_producao_card = max(
        mes_cx_atraso_producao_card,
        perda_producao_reprogramados_simples,
    )

    # Reconciliação: a "Diferença vs V1" exibida no topo (card "Ver conciliação")
    # tem que bater exatamente com a soma das causas mostradas logo abaixo
    # (reprovação/desvio + atraso de produção + perda de rendimento - ganho de
    # rendimento + outros). Antes, a diferença vinha de um cálculo agregado
    # independente (previsto_v1 - realizado - saldo, cada parcela arredondada
    # em separado), que podia divergir da soma das causas em 1 cx --
    # arredondamento acontecendo em pontos diferentes do cálculo (ex.:
    # mostrava -176 no topo mas 177 cx na causa "Perda rendimento" logo
    # abaixo, sem nenhuma outra causa pra explicar a diferença de 1 cx).
    # Recalculamos aqui, depois que todos os cards de causa já estão no
    # valor final (inclusive a blindagem do atraso de produção acima e o
    # card "Outros" de observações manuais), para os números sempre
    # fecharem entre si.
    # Lotes adicionados manualmente (ver migration 009): somam nas caixas
    # realizadas do mês (feito lá no fim do loop principal, via
    # sd3_lote_map), mas o TOTAL "Plano Atualizado" só sobe de verdade se
    # também entrar aqui na fórmula -- mesmo mecanismo do ganho de
    # rendimento (é subtraído, e subtrair um valor aumenta o total final),
    # só que num campo próprio, pra não misturar com o significado de
    # "ganho de rendimento" (rendimento de produção, um conceito diferente
    # de "lote fora do sistema automático que já foi liberado").
    mes_cx_lotes_manuais_card = round(sum(
        dados_manual["qtd_caixas"] for dados_manual in lotes_manuais_por_codigo.values()
    ))

    mes_cx_diferenca_vs_v1 = round(
        mes_cx_reprovacao_desvio_card
        + mes_cx_atraso_producao_card
        + mes_cx_perda_rendimento_card
        - mes_cx_ganho_rendimento
        - mes_cx_lotes_manuais_card
        + mes_cx_outros_card
    )
    mes_cx_plano_atual_tendencia = mes_cx_previsto_v1 - mes_cx_diferenca_vs_v1

    # O saldo exibido no subtítulo do card ("Real X cx + saldo Y cx") precisa
    # sempre fechar com o total acima -- sem isso, mes_cx_saldo_tendencia
    # ficava com o valor provisório calculado lá em cima (antes da
    # reconciliação/blindagem final), podendo divergir bastante do total já
    # ajustado (ex.: total reconciliado sobe/desce mas o saldo mostrado no
    # subtítulo continuava intocado, fazendo "Real + saldo" não bater com o
    # card principal). Recalculado aqui, no mesmo lugar/momento que o total
    # final, pelas mesmas regras já usadas no frontend como fallback.
    mes_cx_saldo_tendencia = max(mes_cx_plano_atual_tendencia - mes_cx_realizado, 0)

    _marcar("fim_tudo")

    return {
        "mes": mes_analise,
        "ano": ano_analise,
        "fonte_baseline": fonte_baseline,
        "rodada_id": rodada_ref.get("id") if rodada_ref else None,
        "rodada_mes": rodada_ref.get("mes") if rodada_ref else None,
        "rodada_versao": rodada_ref.get("versao") if rodada_ref else None,
        "rodada_atual_id": rodada_atual_mrp.get("id") if rodada_atual_mrp else None,
        "rodada_atual_mes": rodada_atual_mrp.get("mes") if rodada_atual_mrp else None,
        "rodada_atual_versao": rodada_atual_mrp.get("versao") if rodada_atual_mrp else None,
        "total_lotes": len(resultado),
        "total_lotes_mtd": len(lotes_mtd),
        "total_lotes_futuros": len(lotes_futuros),
        "total_lotes_fora_gantt": len(lotes_fora_gantt),
        "total_lotes_desvio": total_lotes_desvio,
        "atraso_producao_lotes": atraso_producao_lotes,

        # Visão mensal executiva: V1 x plano atual/tendência.
        "mes_cx_previsto_v1": mes_cx_previsto_v1,
        "mes_cx_planejado_v1": mes_cx_previsto_v1,
        "mes_cx_realizado": mes_cx_realizado,
        "mes_cx_plano_atual_puro": mes_cx_plano_atual_puro,
        "mes_cx_plano_atual_tendencia": mes_cx_plano_atual_tendencia,
        "mes_cx_diferenca_vs_v1": mes_cx_diferenca_vs_v1,
        "mes_cx_saldo_tendencia": mes_cx_saldo_tendencia,
        "mes_cx_saldo_tendencia_bruto": mes_cx_saldo_tendencia_bruto,
        "mes_cx_desconto_reprovacao_plano_atual": mes_cx_desconto_reprovacao_plano_atual,
        "mes_cx_acrescimo_plano_atual": mes_cx_acrescimo_plano_atual,
        "mes_cx_ganho_rendimento": mes_cx_ganho_rendimento,
        "mes_cx_perdas_brutas_vs_v1": mes_cx_perdas_brutas_vs_v1,
        "mes_cx_reconciliado_v1": mes_cx_reconciliado_v1,
        "perda_producao_reprogramados_simples": perda_producao_reprogramados_simples,
        "lotes_reprogramados_simples": lotes_reprogramados_simples,
        "mes_perdas_vs_v1_por_causa": {
            "reprovacao_desvio": mes_cx_reprovacao_desvio_card,
            "atraso_producao": mes_cx_atraso_producao_card,
            "rendimento": mes_cx_perda_rendimento_card,
            "ganho_rendimento": mes_cx_ganho_rendimento,
            "outros": mes_cx_outros_card,
            "lotes_manuais": mes_cx_lotes_manuais_card,
        },
        "mes_cx_outros_card": mes_cx_outros_card,
        "mes_cx_lotes_manuais_card": mes_cx_lotes_manuais_card,
        "lotes_observacao_manual": [
            {"lote": lote, "motivo": observacoes_manuais_mes[lote]}
            for lote in lotes_com_observacao_manual_ativa
        ],
        "lotes_manuais_rastreamento": [
            {"lote": lote, **dados} for lote, dados in lotes_manuais_por_codigo.items()
        ],
        # Mantém o detalhamento operacional do mês para compatibilidade e auditoria.
        "mes_gap_por_etapa": {
            "desvio": round(mes_reprovacao_desvio + mes_desvio_aberto),
            "reprovacao_desvio": round(mes_reprovacao_desvio),
            "desvio_aberto": round(mes_desvio_aberto),
            "atraso_producao": round(mes_atraso_producao),
            "rendimento": round(mes_perda_rendimento),
            "embalagem": round(mes_embalagem),
            "embalagem_em_desvio": round(mes_embalagem_em_desvio),
            "envase": round(mes_envase),
            "envase_em_desvio": round(mes_envase_em_desvio),
            "lavagem": round(mes_lavagem),
            "lavagem_em_desvio": round(mes_lavagem_em_desvio),
            "nao_iniciado": round(mes_nao_iniciado),
            "nao_iniciado_em_desvio": round(mes_nao_iniciado_em_desvio),
        },

        "total_cx_previsto": total_cx_previsto,
        "total_cx_liberado": total_cx_liberado,
        "total_cx_gap": total_cx_previsto - total_cx_liberado,
        "total_cx_sd3_mes": total_cx_sd3_mes,
        "total_cx_fora_gantt": total_cx_fora_gantt,
        "total_cx_desvio": total_cx_desvio,

        "mtd_cx_previsto": mtd_cx_previsto,
        "mtd_cx_liberado": mtd_cx_liberado,
        "mtd_cx_gap": mtd_cx_gap_oficial,
        "mtd_cx_gap_calculado": mtd_cx_gap,
        "mtd_cx_gap_operacional": mtd_cx_gap_operacional,
        "mtd_cx_gap_operacional_bruto": mtd_cx_gap_operacional_bruto,
        "mtd_cx_gap_ajuste_arredondamento": diferenca_conciliacao,
        "mtd_cx_desvio": mtd_desvio,
        "mtd_gap_por_etapa": {
            "desvio": round(mtd_desvio),
            "reprovacao_desvio": round(mtd_reprovacao_desvio),
            "desvio_aberto": round(mtd_desvio_aberto),
            "atraso_producao": round(mtd_atraso_producao),
            "rendimento": round(mtd_perda_rendimento),
            "embalagem": round(mtd_embalagem),
            "embalagem_em_desvio": round(mtd_embalagem_em_desvio),
            "envase": round(mtd_envase),
            "envase_em_desvio": round(mtd_envase_em_desvio),
            "lavagem": round(mtd_lavagem),
            "lavagem_em_desvio": round(mtd_lavagem_em_desvio),
            "nao_iniciado": round(mtd_nao_iniciado),
            "nao_iniciado_em_desvio": round(mtd_nao_iniciado_em_desvio),
        },

        "lotes_fora_gantt": lotes_fora_gantt,
        "debug_desvios_rastreamento": {
            "fonte_oficial_atual": fonte_desvios_atual,
            "usa_historico_fallback": False,
            "usa_historico_reprovacao_descarte": True,
            "snapshots_atuais_lidos": len(rows_desvios_snapshot_atual),
            "snapshots_historicos_lidos": len(rows_desvios_historico),
            "registros_desvios_atuais_lidos": len(rows_desvios),
            "lotes_com_desvio_no_mapa": len(desvios_lote_map),
            "lotes_com_desvio": sorted(list(desvios_lote_map.keys()))[:200],
            "debug_2605F1032": desvios_lote_map.get("2605F1032", []),
        },
        "lotes": resultado,
    }


# ─────────────────────────────────────────────────────────────
# Cache/Snapshot da Overview
# ─────────────────────────────────────────────────────────────
# Objetivo:
# - A primeira abertura da Overview deve ler um resumo já pronto.
# - Quando uma base relevante muda, a versão muda e o resumo é recalculado.
# - Os endpoints antigos continuam existindo para modais/detalhes/fallback.

OVERVIEW_CACHE_CHAVE = "overview_anestesicos"
OVERVIEW_CACHE_LOGIC_VERSION = "overview-cache-v4-reconciliacao-mes-atual-versionada"

OVERVIEW_CACHE_BASES = [
    "d_produtos",
    "orcado_liberacao",
    "orcado_faturamento",
    "forecast_sop",
    "sd2_saidas",
    "sd3_entradas",
    "estoque",
    "estoque_saldo",
    "entradas_previstas",
    "liberacao_diaria",
    "liberacoes_previstas_sku",
    "mps_liberacoes",
    "mps_producao",
    "mrp_rodadas",
    "mrp_etapas",
    "programacao_ops",
]


def _ultima_atualizacao_tabela(caminho_tabela: str, coluna_data: str = "criado_em") -> str | None:
    """
    Pega o maior timestamp de uma tabela fora do upload_log.

    Usado para tabelas versionadas do MPS/Gantt, porque a importação de rodadas
    grava em f_mrp_rodadas/f_mrp_etapas e não necessariamente atualiza upload_log.
    """
    try:
        res = (
            supabase.table(caminho_tabela)
            .select(coluna_data)
            .order(coluna_data, desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get(coluna_data):
            return str(rows[0].get(coluna_data))
    except Exception:
        return None

    return None


def _overview_upload_versions() -> dict[str, str | None]:
    """
    Lê o upload_log e pega a última atualização das bases que impactam a Overview.

    Mantém consulta pequena para ser usada como verificação rápida de versão.
    """
    try:
        res = (
            supabase.table("upload_log")
            .select("base_id, processado_em, status")
            .eq("status", "sucesso")
            .order("processado_em", desc=True)
            .limit(500)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    latest = {base: None for base in OVERVIEW_CACHE_BASES}

    for row in rows:
        base_id = str(row.get("base_id") or "").strip()
        if base_id not in latest:
            continue
        if latest[base_id]:
            continue
        latest[base_id] = str(row.get("processado_em") or "") or None

    # O MPS/Gantt versionado usado pela Overview vem de f_mrp_rodadas/f_mrp_etapas.
    # Essas tabelas não entram no upload_log das bases antigas, então precisam
    # participar diretamente da versao_base para derrubar cache em todos os PCs.
    if "mrp_rodadas" in latest:
        latest["mrp_rodadas"] = _ultima_atualizacao_tabela("f_mrp_rodadas", "criado_em")
    if "mrp_etapas" in latest:
        latest["mrp_etapas"] = _ultima_atualizacao_tabela("f_mrp_etapas", "criado_em")

    return latest


def _overview_cache_version() -> tuple[str, dict[str, str | None]]:
    versions = _overview_upload_versions()

    # Observações manuais (ver migration 008) não passam pelo upload_log --
    # sem isso aqui, marcar/remover uma observação nunca mudava a "versão"
    # que essa cache observa, e o gráfico/resumo continuavam servindo o
    # snapshot de antes da edição indefinidamente.
    versao_obs_manuais = _ultima_atualizacao_tabela("f_lotes_observacoes_manuais", "criado_em")
    versao_promocoes = _ultima_atualizacao_tabela("f_lotes_promocoes_mes", "criado_em")
    versao_alias = _ultima_atualizacao_tabela("f_lotes_alias", "criado_em")
    versao_ajuste_planejado = _ultima_atualizacao_tabela("f_lotes_ajuste_planejado", "criado_em")

    partes = [
        OVERVIEW_CACHE_LOGIC_VERSION,
        f"ano:{_ano_atual()}",
        f"mes:{_mes_atual()}",
        # Mantém MTD/previsto até hoje sensível à virada do dia.
        f"hoje:{_hoje_br().isoformat()}",
        f"obs_manuais:{versao_obs_manuais or '-'}",
        f"promocoes:{versao_promocoes or '-'}",
        f"alias:{versao_alias or '-'}",
        f"ajuste_planejado:{versao_ajuste_planejado or '-'}",
    ]

    for base in OVERVIEW_CACHE_BASES:
        partes.append(f"{base}:{versions.get(base) or '-'}")

    return "|".join(partes), versions


def _overview_ultima_atualizacao(versions: dict[str, str | None]) -> str | None:
    datas = [v for v in versions.values() if v]
    return _normalizar_timestamp_para_br(max(datas)) if datas else None


def _read_cache_overview(chave: str = OVERVIEW_CACHE_CHAVE) -> dict | None:
    try:
        res = (
            supabase.table("cache_overview")
            .select("chave, versao_base, payload, atualizado_em")
            .eq("chave", chave)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        return res.data[0]
    except Exception:
        return None


def _write_cache_overview(payload: dict, versao_base: str, chave: str = OVERVIEW_CACHE_CHAVE) -> dict:
    registro = {
        "chave": chave,
        "versao_base": versao_base,
        "payload": payload,
        # Timestamp oficial já sai no fuso America/Sao_Paulo com offset (-03:00).
        # Isso impede que o front interprete UTC naïve como hora local e mostre
        # "Dados atualizados em" com 3h de diferença.
        "atualizado_em": _iso_br(),
    }

    try:
        res = (
            supabase.table("cache_overview")
            .upsert(registro, on_conflict="chave")
            .execute()
        )
        if res.data:
            return res.data[0]
    except Exception:
        pass

    # Fallback para ambientes onde upsert/on_conflict esteja diferente.
    try:
        res = (
            supabase.table("cache_overview")
            .update({
                "versao_base": versao_base,
                "payload": payload,
                "atualizado_em": registro["atualizado_em"],
            })
            .eq("chave", chave)
            .execute()
        )
        if res.data:
            return res.data[0]
    except Exception:
        pass

    try:
        res = supabase.table("cache_overview").insert(registro).execute()
        if res.data:
            return res.data[0]
    except Exception:
        pass

    return registro


async def _montar_payload_overview_resumo() -> dict:
    """
    Monta o payload completo usado pela primeira tela da Overview.

    IMPORTANTE:
    As funções de rota têm Query(...) como default; por isso aqui chamamos
    explicitamente com None para evitar passar objetos Query quando usamos
    as funções diretamente no backend.
    """
    orcado_faturamento = get_orcado_faturamento(None, None, None, None, None, None)
    projecao_faturamento = get_projecao_faturamento(None, None, None, None, None, None)
    orcado_liberacao = get_orcado_liberacao()
    projecao_liberacoes = _calcular_projecao_liberacoes()
    estoque_mensal = get_estoque_mensal(None, None, None, None, None, None)
    disponibilidade_mensal = get_disponibilidade_mensal(
        None, None, None, None, None, None, None, None
    )

    versao_base, versions = _overview_cache_version()
    ultima_atualizacao = _overview_ultima_atualizacao(versions)

    return {
        "ano": _ano_atual(),
        "mes_atual": _mes_atual(),
        "versao_base": versao_base,
        "ultima_atualizacao": ultima_atualizacao,
        "gerado_em": _iso_br(),
        "orcado_faturamento": orcado_faturamento,
        "projecao_faturamento": projecao_faturamento,
        "orcado_liberacao": orcado_liberacao,
        "projecao_liberacoes": projecao_liberacoes,
        "estoque_mensal": estoque_mensal,
        "disponibilidade_mensal": disponibilidade_mensal,
    }


async def recalcular_cache_overview() -> dict:
    """
    Recalcula e grava o snapshot da Overview.

    Usado pelo endpoint /overview/resumo/recalcular e pelo upload.py depois
    de bases que impactam a Overview.
    """
    versao_base, versions = _overview_cache_version()
    payload = await _montar_payload_overview_resumo()
    registro = _write_cache_overview(payload, versao_base)

    return {
        "chave": OVERVIEW_CACHE_CHAVE,
        "versao_base": versao_base,
        "from_cache": False,
        "atualizado_em": registro.get("atualizado_em"),
        "ultima_atualizacao": _overview_ultima_atualizacao(versions),
        "payload": payload,
    }


def _recalcular_cache_overview_background() -> None:
    """
    Wrapper síncrono (NÃO `async def`) pra rodar recalcular_cache_overview() via
    BackgroundTasks sem travar o event loop principal do servidor.

    recalcular_cache_overview() é uma coroutine, mas por dentro só faz chamadas
    SÍNCRONAS/bloqueantes ao Supabase (não existe I/O assíncrono de verdade nesse
    código). Se passarmos a coroutine direto pra `background_tasks.add_task`, o
    Starlette agenda ela pra rodar no MESMO event loop principal — e como as
    chamadas ao Supabase bloqueiam a thread, isso trava TODAS as outras
    requisições (de qualquer usuário) enquanto o recálculo roda.

    Envolvendo numa função síncrona comum, o Starlette detecta automaticamente
    que não é uma coroutine (`is_async_callable` retorna False) e agenda a
    execução numa threadpool separada (via `run_in_threadpool`), mantendo o
    servidor responsivo pros outros usuários enquanto o recálculo acontece em
    paralelo.
    """
    asyncio.run(recalcular_cache_overview())


@router.get("/resumo/versao")
def get_overview_resumo_versao():
    versao_base, versions = _overview_cache_version()
    cache = _read_cache_overview()

    return {
        "chave": OVERVIEW_CACHE_CHAVE,
        "versao_base": versao_base,
        "cache_disponivel": bool(cache and cache.get("versao_base") == versao_base),
        "cache_existente": bool(cache and cache.get("payload") is not None),
        "cache_desatualizado": bool(cache and cache.get("payload") is not None and cache.get("versao_base") != versao_base),
        "precisa_recalcular": bool(not cache or cache.get("payload") is None or cache.get("versao_base") != versao_base),
        "modo_cache": "strict_no_stale",
        "cache_versao": cache.get("versao_base") if cache else None,
        "cache_atualizado_em": cache.get("atualizado_em") if cache else None,
        "ultima_atualizacao": _overview_ultima_atualizacao(versions),
        "bases": versions,
    }


@router.get("/resumo")
async def get_overview_resumo(
    background_tasks: BackgroundTasks,
    cache_version: str | None = Query(default=None),
    force: bool = Query(default=False),
    allow_stale: bool = Query(default=False),
):
    """
    Retorna o snapshot da Overview sem bloquear a primeira abertura.

    Regra v69 STRICT:
      - se o cache atual estiver pronto, retorna o atual;
      - se a base mudou (upload novo, MPS novo, SB8 nova, forecast novo,
        virada de dia/mês/ano ou mudança de versão lógica), NÃO devolve snapshot
        antigo por padrão;
      - recalcula de forma síncrona e só então responde.

    Motivo:
      A Overview é tela executiva. Ela não pode mostrar disponibilidade/estoque
      inicial antigo enquanto recalcula em background. Foi isso que fazia alguns
      computadores verem Jul/26 com estoque inicial projetado 1.569 cx, enquanto
      o valor oficial recalculado era 530 cx.

    Observação:
      allow_stale continua existindo só como escape técnico explícito. A tela
      normal NÃO deve enviar allow_stale=true. Para reunião, o fluxo certo é
      chamar /overview/resumo/recalcular depois dos uploads da manhã e todos os
      usuários lerem o snapshot oficial já pronto.
    """
    versao_base, versions = _overview_cache_version()
    cache = _read_cache_overview()

    if not force and cache and cache.get("payload") is not None:
        cache_versao = cache.get("versao_base")
        cache_atual = cache_versao == versao_base

        if cache_atual:
            payload = cache.get("payload") or {}

            return {
                "chave": OVERVIEW_CACHE_CHAVE,
                "versao_base": versao_base,
                "from_cache": True,
                "stale": False,
                "cache_atual": True,
                "cache_versao": cache_versao,
                "atualizado_em": cache.get("atualizado_em"),
                "ultima_atualizacao": _overview_ultima_atualizacao(versions),
                "payload": payload,
            }

        if allow_stale:
            # Serve o snapshot antigo agora (não trava a tela do usuário atual),
            # mas dispara o recálculo em background para autocorrigir o cache
            # sem depender de upload nem de chamada manual.
            background_tasks.add_task(_recalcular_cache_overview_background)
            payload = cache.get("payload") or {}

            return {
                "chave": OVERVIEW_CACHE_CHAVE,
                "versao_base": versao_base,
                "from_cache": True,
                "stale": True,
                "cache_atual": False,
                "cache_versao": cache_versao,
                "atualizado_em": cache.get("atualizado_em"),
                "ultima_atualizacao": _overview_ultima_atualizacao(versions),
                "payload": payload,
            }

    return await recalcular_cache_overview()


@router.post("/resumo/recalcular")
async def post_overview_resumo_recalcular():
    return await recalcular_cache_overview()


@router.post("/resumo/preaquecer")
async def post_overview_resumo_preaquecer():
    """Alias semântico para rotina da manhã: recalcula o cache oficial da Overview."""
    return await recalcular_cache_overview()


# ─────────────────────────────────────────────────────────────
# Cache/Snapshot do Rastreamento de Lotes
# ─────────────────────────────────────────────────────────────
# Fica separado do /overview/resumo para não deixar os cards principais lentos.
# Esse bloco muda mais quando há atualização de produção/apontamentos.

RASTREAMENTO_CACHE_BASES = [
    "apontamentos",
    "sd3_entradas",
    "desvios_lotes",
    "mps_liberacoes",
    "mps_producao",
    "mrp_rodadas",
    "mrp_etapas",
    "programacao_ops",
    "liberacao_diaria",
    # Faltava esta: é a base de onde vem o saldo em quarentena (armazém 98
    # da SB8, ver _estoque_quarentena_por_lote). Sem ela aqui, subir uma
    # planilha de estoque nova nunca mudava a "versão dos dados" que o
    # cache do Rastreamento de Lotes observa -- o card "Perda Rendimento"
    # (e o Plano Atualizado) podiam continuar usando o saldo de quarentena
    # de ANTES do upload por tempo indeterminado, até alguma OUTRA base
    # mudar e coincidentemente forçar um recálculo.
    "estoque_saldo",
]


def _rastreamento_cache_chave(mes: int | None = None, ano: int | None = None) -> str:
    mes_ref = mes or _mes_atual()
    ano_ref = ano or _ano_atual()
    return f"rastreamento_lotes_{ano_ref}_{str(mes_ref).zfill(2)}"


def _rastreamento_upload_versions() -> dict[str, str | None]:
    try:
        res = (
            supabase.table("upload_log")
            .select("base_id, processado_em, status")
            .eq("status", "sucesso")
            .order("processado_em", desc=True)
            .limit(500)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    latest = {base: None for base in RASTREAMENTO_CACHE_BASES}

    for row in rows:
        base_id = str(row.get("base_id") or "").strip()
        if base_id not in latest:
            continue
        if latest[base_id]:
            continue
        latest[base_id] = str(row.get("processado_em") or "") or None

    # O MPS/Gantt versionado usado pela Overview vem de f_mrp_rodadas/f_mrp_etapas.
    # Essas tabelas não entram no upload_log das bases antigas, então precisam
    # participar diretamente da versao_base para derrubar cache em todos os PCs.
    if "mrp_rodadas" in latest:
        latest["mrp_rodadas"] = _ultima_atualizacao_tabela("f_mrp_rodadas", "criado_em")
    if "mrp_etapas" in latest:
        latest["mrp_etapas"] = _ultima_atualizacao_tabela("f_mrp_etapas", "criado_em")

    return latest


def _rastreamento_cache_version(mes: int | None = None, ano: int | None = None) -> tuple[str, dict[str, str | None]]:
    mes_ref = mes or _mes_atual()
    ano_ref = ano or _ano_atual()
    versions = _rastreamento_upload_versions()
    versao_obs_manuais = _ultima_atualizacao_tabela("f_lotes_observacoes_manuais", "criado_em")
    versao_promocoes = _ultima_atualizacao_tabela("f_lotes_promocoes_mes", "criado_em")
    versao_alias = _ultima_atualizacao_tabela("f_lotes_alias", "criado_em")
    versao_ajuste_planejado = _ultima_atualizacao_tabela("f_lotes_ajuste_planejado", "criado_em")

    partes = [
        "rastreamento-cache-v9-reprovacao-historica-convive-com-desvio-atual",
        f"ano:{ano_ref}",
        f"mes:{mes_ref}",
        # O rastreamento tem MTD/previsto até hoje; por isso muda na virada do dia.
        f"hoje:{_hoje_br().isoformat()}",
        f"obs_manuais:{versao_obs_manuais or '-'}",
        f"promocoes:{versao_promocoes or '-'}",
        f"alias:{versao_alias or '-'}",
        f"ajuste_planejado:{versao_ajuste_planejado or '-'}",
    ]

    for base in RASTREAMENTO_CACHE_BASES:
        partes.append(f"{base}:{versions.get(base) or '-'}")

    return "|".join(partes), versions


def _rastreamento_ultima_atualizacao(versions: dict[str, str | None]) -> str | None:
    datas = [v for v in versions.values() if v]
    return _normalizar_timestamp_para_br(max(datas)) if datas else None


async def recalcular_cache_rastreamento_lotes(
    mes: int | None = None,
    ano: int | None = None,
) -> dict:
    mes_ref = mes or _mes_atual()
    ano_ref = ano or _ano_atual()
    chave = _rastreamento_cache_chave(mes_ref, ano_ref)
    versao_base, versions = _rastreamento_cache_version(mes_ref, ano_ref)

    payload = get_rastreamento_lotes(mes_ref, ano_ref)

    registro = _write_cache_overview(payload, versao_base, chave=chave)

    return {
        "chave": chave,
        "versao_base": versao_base,
        "from_cache": False,
        "atualizado_em": registro.get("atualizado_em"),
        "ultima_atualizacao": _rastreamento_ultima_atualizacao(versions),
        "payload": payload,
    }


def _recalcular_cache_rastreamento_lotes_background(mes: int | None, ano: int | None) -> None:
    """
    Wrapper síncrono pra recalcular_cache_rastreamento_lotes rodar em threadpool
    via BackgroundTasks, sem travar o event loop principal do servidor.
    Mesmo racional de _recalcular_cache_overview_background — ver docstring lá.
    """
    asyncio.run(recalcular_cache_rastreamento_lotes(mes, ano))


@router.get("/rastreamento-lotes-cache/versao")
def get_rastreamento_lotes_cache_versao(
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
):
    mes_ref = mes or _mes_atual()
    ano_ref = ano or _ano_atual()
    chave = _rastreamento_cache_chave(mes_ref, ano_ref)
    versao_base, versions = _rastreamento_cache_version(mes_ref, ano_ref)
    cache = _read_cache_overview(chave)

    return {
        "chave": chave,
        "mes": mes_ref,
        "ano": ano_ref,
        "versao_base": versao_base,
        "cache_disponivel": bool(cache and cache.get("versao_base") == versao_base),
        "cache_existente": bool(cache and cache.get("payload") is not None),
        "cache_desatualizado": bool(cache and cache.get("payload") is not None and cache.get("versao_base") != versao_base),
        "precisa_recalcular": bool(not cache or cache.get("payload") is None or cache.get("versao_base") != versao_base),
        "modo_cache": "strict_no_stale",
        "cache_versao": cache.get("versao_base") if cache else None,
        "cache_atualizado_em": cache.get("atualizado_em") if cache else None,
        "ultima_atualizacao": _rastreamento_ultima_atualizacao(versions),
        "bases": versions,
    }


@router.get("/rastreamento-lotes-cache")
async def get_rastreamento_lotes_cache(
    background_tasks: BackgroundTasks,
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
    force: bool = Query(default=False),
    allow_stale: bool = Query(default=True),
):
    """
    Retorna o rastreamento sem apagar visualmente os lotes enquanto o novo cache recalcula.

    Regra v68 (ver /overview/resumo para o histórico completo do problema):
      - cache atual pronto: retorna atual;
      - base mudou (upload novo ou virada de dia/mês/ano) e cache está desatualizado:
        retorna o último cache existente na hora, mas dispara recálculo em background;
      - sem cache salvo ou force=true: recalcula de forma síncrona.
    """
    mes_ref = mes or _mes_atual()
    ano_ref = ano or _ano_atual()
    chave = _rastreamento_cache_chave(mes_ref, ano_ref)
    versao_base, versions = _rastreamento_cache_version(mes_ref, ano_ref)
    cache = _read_cache_overview(chave)

    if not force and cache and cache.get("payload") is not None:
        cache_versao = cache.get("versao_base")
        cache_atual = cache_versao == versao_base

        if cache_atual:
            return {
                "chave": chave,
                "versao_base": versao_base,
                "from_cache": True,
                "stale": False,
                "cache_atual": True,
                "cache_versao": cache_versao,
                "atualizado_em": cache.get("atualizado_em"),
                "ultima_atualizacao": _rastreamento_ultima_atualizacao(versions),
                "payload": cache.get("payload"),
            }

        if allow_stale:
            background_tasks.add_task(_recalcular_cache_rastreamento_lotes_background, mes_ref, ano_ref)
            return {
                "chave": chave,
                "versao_base": versao_base,
                "from_cache": True,
                "stale": True,
                "cache_atual": False,
                "cache_versao": cache_versao,
                "atualizado_em": cache.get("atualizado_em"),
                "ultima_atualizacao": _rastreamento_ultima_atualizacao(versions),
                "payload": cache.get("payload"),
            }

    return await recalcular_cache_rastreamento_lotes(mes_ref, ano_ref)


@router.post("/rastreamento-lotes-cache/recalcular")
async def post_rastreamento_lotes_cache_recalcular(
    mes: int | None = Query(default=None, ge=1, le=12),
    ano: int | None = Query(default=None),
):
    return await recalcular_cache_rastreamento_lotes(mes, ano)