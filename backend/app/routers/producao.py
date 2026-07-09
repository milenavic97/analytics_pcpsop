from fastapi import APIRouter, HTTPException, Query, Response
from app.database import supabase
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict
from datetime import date, datetime, timedelta
from calendar import monthrange
import time
import unicodedata
import re

router = APIRouter(prefix="/producao", tags=["producao"])

TUBETES_POR_CAIXA = 500.0

# Cache simples em memória por máquina Fly.
# Ajuda muito porque o dashboard de produção consulta f_apontamentos, que é uma tabela grande.
_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SEGUNDOS = 120


def _cache_key(prefixo: str, *partes: Any) -> str:
    return prefixo + ":" + ":".join(str(p) for p in partes)


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


# ─────────────────────────────────────────────────────────────
# Utilitários
# ─────────────────────────────────────────────────────────────

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
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)

        texto = str(value).strip()
        if not texto:
            return default

        if "," in texto:
            texto = texto.replace(".", "").replace(",", ".")

        return int(float(texto))
    except Exception:
        return default


def _normalizar_texto(value: Any) -> str:
    return str(value or "").strip()


def _sem_acento(value: Any) -> str:
    """
    Normaliza texto para comparações sem depender de acento.

    Ex.:
      PRODUÇÃO -> PRODUCAO
      MÁQ 1 -> MAQ 1
    """
    texto = _normalizar_texto(value)
    texto = unicodedata.normalize("NFKD", texto)
    return "".join(ch for ch in texto if not unicodedata.combining(ch))


def _upper(value: Any) -> str:
    return _sem_acento(value).upper()


def _normalizar_codigo(value: Any) -> str:
    texto = _normalizar_texto(value)
    if texto.endswith(".0"):
        texto = texto[:-2]
    return texto.zfill(5) if texto.isdigit() else texto


def _get(row: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in row and row.get(key) is not None:
            return row.get(key)
    return default


def _select_all(query, page_size: int = 1000) -> List[Dict[str, Any]]:
    """
    Lê todos os registros paginando pelo Supabase.

    Importante: o Supabase/PostgREST normalmente limita cada resposta a 1.000 linhas.
    Se pedirmos page_size maior, ele pode devolver só 1.000 linhas e o loop antigo entendia
    errado que a consulta tinha acabado. Isso fazia a produção realizada pegar só o começo
    da f_apontamentos, praticamente só janeiro.
    """
    todos: List[Dict[str, Any]] = []
    page_size = min(max(int(page_size or 1000), 1), 1000)
    page = 0

    while True:
        inicio = page * page_size
        fim = inicio + page_size - 1
        res = query.range(inicio, fim).execute()
        data = res.data or []

        if not data:
            break

        todos.extend(data)

        if len(data) < page_size:
            break

        page += 1

    return todos


def _parse_datetime(value: Any) -> Optional[datetime]:
    """
    Converte datas de forma segura para datetime SEM timezone.

    Por que isso importa:
      - o Supabase pode devolver data_inicial como 2026-03-13T15:45:08+00:00
        (timezone-aware);
      - os limites do dashboard são datetime(ano, mes, dia) sem timezone;
      - comparar aware x naive em Python gera erro e fazia o realizado ficar vazio.

    Regra:
      - mantém o horário;
      - remove apenas tzinfo para permitir filtro mensal/anual em Python.
    """
    def sem_timezone(dt: datetime) -> datetime:
        if dt.tzinfo is not None:
            return dt.replace(tzinfo=None)
        return dt

    if value is None:
        return None

    if isinstance(value, datetime):
        return sem_timezone(value)

    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    # O relatório de apontamentos do Cogtive/Excel pode chegar no Supabase como serial do Excel,
    # exemplo: 46156.92564814815.
    if isinstance(value, (int, float)):
        try:
            numero = float(value)
            if 30000 <= numero <= 70000:
                return datetime(1899, 12, 30) + timedelta(days=numero)
        except Exception:
            pass

    texto = str(value).strip()
    if not texto:
        return None

    texto_serial = texto.replace(",", ".")
    texto_num = texto_serial.replace(".", "", 1)
    if texto_num.isdigit():
        try:
            numero = float(texto_serial)
            if 30000 <= numero <= 70000:
                return datetime(1899, 12, 30) + timedelta(days=numero)
        except Exception:
            pass

    texto_iso = texto.replace("Z", "+00:00")
    try:
        return sem_timezone(datetime.fromisoformat(texto_iso))
    except Exception:
        pass

    formatos = [
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
    ]

    for formato in formatos:
        try:
            return datetime.strptime(texto, formato)
        except Exception:
            continue

    return None


def _ultima_data_tabela(table: str, column: str) -> Optional[datetime]:
    try:
        res = (
            supabase.table(table)
            .select(column)
            .order(column, desc=True)
            .limit(1)
            .execute()
        )
        data = res.data or []
        if not data:
            return None

        valor = data[0].get(column)
        return _parse_datetime(valor)
    except Exception:
        return None


def _dados_atualizados_em_producao() -> Optional[str]:
    """
    Retorna a última atualização/carga relevante para a página Produção.
    """
    chave_cache = _cache_key("dados_atualizados_em_producao_v118")
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    candidatos = [
        _ultima_data_tabela("f_apontamentos", "created_at"),
        _ultima_data_tabela("f_producao_real", "created_at"),
        _ultima_data_tabela("f_programacao_ops_resumo", "atualizado_em"),
        _ultima_data_tabela("f_programacao_ops", "created_at"),
        _ultima_data_tabela("f_mrp_rodadas", "criado_em"),
        _ultima_data_tabela("f_mrp_alocacoes_dia", "criado_em"),
        _ultima_data_tabela("f_mrp_etapas", "criado_em"),
        _ultima_data_tabela("f_mrp_calendario_dia", "criado_em"),
    ]

    candidatos_validos = [dt for dt in candidatos if dt is not None]

    if not candidatos_validos:
        return _cache_set(chave_cache, None, ttl=60)

    atualizado = max(candidatos_validos)
    return _cache_set(chave_cache, atualizado.isoformat(), ttl=60)


def _mes_label(mes: int, ano: Optional[int] = None) -> str:
    nomes = {
        1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
        7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
    }
    nome = nomes.get(int(mes), str(mes).zfill(2))
    if ano is None:
        return nome
    return f"{nome}/{str(ano)[-2:]}"


def _pct(valor: Any, base: Any) -> float:
    base_float = _to_float(base)
    if base_float == 0:
        return 0.0
    return (_to_float(valor) / base_float) * 100.0


def _periodo_ano_ate_mes(ano: int, mes: int) -> Tuple[datetime, datetime]:
    mes = min(max(int(mes), 1), 12)
    inicio = datetime(int(ano), 1, 1)
    ultimo_dia = monthrange(int(ano), mes)[1]
    fim = datetime(int(ano), mes, ultimo_dia) + timedelta(days=1)
    return inicio, fim


def _periodo_mes(ano: int, mes: int) -> Tuple[datetime, datetime]:
    ultimo_dia = monthrange(int(ano), int(mes))[1]
    inicio = datetime(int(ano), int(mes), 1)
    fim = datetime(int(ano), int(mes), ultimo_dia) + timedelta(days=1)
    return inicio, fim


# ─────────────────────────────────────────────────────────────
# Classificação de envase
# ─────────────────────────────────────────────────────────────

def _linha_envase_from_text(equipamento: Any = None, recurso: Any = None) -> Optional[str]:
    texto = f"{_upper(equipamento)} {_upper(recurso)}"

    if not texto.strip():
        return None

    # Não misturar lavagem/embalagem com envase.
    bloqueios = ["LAVADORA", "LAVAGEM", "FABRIMA", "EMBAL", "ROTUL", "CARTUCH"]
    if any(b in texto for b in bloqueios):
        return None

    # Linha 2
    if (
        "L2" in texto
        or "LINHA 2" in texto
        or "LINHA2" in texto
        or "ENV003" in texto
        or "ENVASADORA 3" in texto
    ):
        return "L2"

    # Linha 1: MAQ 1 + MAQ 2 envasadora.
    if (
        "L1" in texto
        or "LINHA 1" in texto
        or "LINHA1" in texto
        or "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQ. 1" in texto
        or "MÁQ 1" in texto
        or "MÁQ1" in texto
        or "MÁQ. 1" in texto
        or "MAQUINA 1" in texto
        or "MÁQUINA 1" in texto
        or "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQ. 2" in texto
        or "MÁQ 2" in texto
        or "MÁQ2" in texto
        or "MÁQ. 2" in texto
        or "MAQUINA 2" in texto
        or "MÁQUINA 2" in texto
        or "ENV001" in texto
        or "ENV002" in texto
        or "ENVASADORA 1" in texto
        or "ENVASADORA 2" in texto
    ):
        return "L1"

    return None



def _linha_operacional_from_text(equipamento: Any = None, etapa: Any = None, recurso: Any = None) -> Optional[str]:
    """
    Classifica as três visões operacionais do acompanhamento mensal:
      - L1: MÁQ 1 + MÁQ 2 ENVASADORA
      - L2: L2 - ENVASADORA
      - FABRIMA: equipamento/etapa de embalagem na Fabrima
    """
    texto = f"{_upper(equipamento)} {_upper(etapa)} {_upper(recurso)}"

    if not texto.strip():
        return None

    if "FABRIMA" in texto:
        return "FABRIMA"

    if "EMBAL" in texto and "ENVAS" not in texto:
        return "FABRIMA"

    return _linha_envase_from_text(equipamento=equipamento, recurso=recurso)



def _nome_linha(linha: str) -> str:
    if linha == "L1":
        return "Envase — Linha 1"
    if linha == "L2":
        return "Envase — Linha 2"
    if linha == "FABRIMA":
        return "Fabrima"
    return linha or "Sem linha"


def _quantidade_tubetes(row: Dict[str, Any]) -> float:
    return _to_float(_get(
        row,
        "quantidade_produzida",
        "qtd_produzida",
        "quantidade",
        "qtd",
        "quantidade_tubete",
        "quantidade_tubetes",
        "qtd_tubete",
        "qtd_tubetes",
        "quantidade_de_tubete",
        "quantidade_de_tubetes",
        "QUANTIDADE PRODUZIDA",
        "Quantidade Produzida",
        "quantidade produzida",
        "QUANTIDADE DE TUBETE",
        "QUANTIDADE DE TUBETES",
        "Soma de QUANTIDADE PRODUZIDA",
        default=0,
    ))


def _data_referencia_apontamento(row: Dict[str, Any]) -> Optional[datetime]:
    # Regra oficial para a Produção:
    # usar DATA FINAL como referência de mês/dia do realizado.
    #
    # Motivo:
    # - a conferência operacional/Excel foi feita por DATA FINAL;
    # - o volume produzido deve ser atribuído ao mês em que o apontamento foi concluído;
    # - isso evita diferença entre dashboard e dinâmica quando um apontamento cruza virada de dia/mês.
    #
    # Fallback:
    # - se data_final vier vazia em alguma carga, usa data_inicial.
    return _parse_datetime(_get(
        row,
        "data_final",
        "data_fim",
        "fim",
        "DATA FINAL",
        "Data Final",
        "data final",
        "data_inicial",
        "DATA INICIAL",
        "Data Inicial",
        "data inicial",
        "data_hora_inicial",
        "inicio",
        "DATA",
        "data",
        "Data",
        "data_inicio",
        "DATA INICIO",
        "Data Inicio",
        "data inicio",
    ))


def _data_inicio_apontamento(row: Dict[str, Any]) -> Optional[datetime]:
    # Para horário/último apontamento, também usar DATA INICIAL.
    # Mantemos fallbacks só para compatibilidade com cargas antigas/futuras.
    return _parse_datetime(_get(
        row,
        "data_inicial",
        "DATA INICIAL",
        "Data Inicial",
        "data inicial",
        "data_hora_inicial",
        "inicio",
        "data_inicio",
        "DATA INICIO",
        "Data Inicio",
        "data inicio",
        "data",
        "DATA",
        "Data",
    ))


def _data_final_apontamento(row: Dict[str, Any]) -> Optional[datetime]:
    return _parse_datetime(_get(
        row,
        "data_final",
        "data_fim",
        "fim",
        "DATA FINAL",
        "Data Final",
        "data final",
    ))


def _equipamento_apontamento(row: Dict[str, Any]) -> str:
    return _normalizar_texto(_get(
        row,
        "equipamento",
        "EQUIPAMENTO",
        "Equipamento",
        default="",
    ))


def _tipo_evento_apontamento(row: Dict[str, Any]) -> str:
    return _normalizar_texto(_get(
        row,
        "tipo_evento",
        "tipo_de_evento",
        "tipo",
        "TIPO DE EVENTO",
        "Tipo de Evento",
        "tipo de evento",
        default="",
    ))


def _evento_apontamento(row: Dict[str, Any]) -> str:
    return _normalizar_texto(_get(
        row,
        "evento",
        "motivo",
        "descricao_evento",
        "EVENTO",
        "MOTIVO",
        "DESCRIÇÃO EVENTO",
        "DESCRICAO EVENTO",
        default="",
    ))


def _duracao_horas(row: Dict[str, Any]) -> float:
    # Campos já em horas.
    for campo in ["duracao_h", "horas_reais", "horas", "duracao_horas", "tempo_horas"]:
        valor = _to_float(row.get(campo), default=-1)
        if valor >= 0:
            return valor

    # No relatório Cogtive/Excel, DURAÇÃO vem como fração de dia.
    # Ex.: 0,058333 = 1,4 hora. Portanto precisa multiplicar por 24.
    for campo in ["DURAÇÃO", "DURACAO", "duracao", "tempo"]:
        valor = _to_float(row.get(campo), default=-1)
        if valor >= 0:
            if valor <= 10:
                return valor * 24.0
            return valor

    inicio = _data_inicio_apontamento(row) or _parse_datetime(_get(row, "inicio"))
    fim = _data_final_apontamento(row) or _parse_datetime(_get(row, "fim"))

    if inicio and fim and fim >= inicio:
        return (fim - inicio).total_seconds() / 3600.0

    return 0.0


def _is_produtivo_envase(row: Dict[str, Any]) -> bool:
    """
    Regra oficial do realizado de envase.

    Para bater exatamente com a conferência feita no Supabase/Excel:
      - equipamento precisa ser classificado como envase L1 ou L2;
      - tipo_evento precisa ser PRODUÇÃO/PRODUCAO;
      - quantidade considerada é qtd_produzida;
      - caixas = qtd_produzida / 500.

    Não considerar OUTRAS PARADAS mesmo que alguma linha venha com quantidade.
    """
    qtd = _quantidade_tubetes(row)
    if qtd <= 0:
        return False

    tipo = _upper(_tipo_evento_apontamento(row))
    return "PRODUCAO" in tipo


def _is_parada_envase(row: Dict[str, Any]) -> bool:
    tipo = _upper(_tipo_evento_apontamento(row))
    evento = _upper(_evento_apontamento(row))
    texto = f"{tipo} {evento}"

    if not texto.strip():
        return False

    gatilhos = [
        "PARADA", "SETUP", "SET UP", "MANUT", "LIMPEZA", "FALTA", "AGUARD",
        "TROCA", "ORGANIZAÇÃO", "ORGANIZACAO", "QUALIDADE", "CERTIFICAÇÃO",
        "CERTIFICACAO", "PREPARAÇÃO", "PREPARACAO", "REUNIÃO", "REUNIAO",
        "TREINAMENTO", "FÉRIAS", "FERIAS",
    ]

    return any(g in texto for g in gatilhos) and not _is_produtivo_envase(row)


# ─────────────────────────────────────────────────────────────
# Cargas
# ─────────────────────────────────────────────────────────────

def _carregar_produtos_map() -> Dict[str, Dict[str, str]]:
    chave = _cache_key("produtos_map")
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("d_produtos")
            .select("cod_produto,codigo,codigo_produto,descricao,produto,grupo_descricao,grupo")
        )
    except Exception:
        try:
            rows = _select_all(supabase.table("d_produtos").select("*"))
        except Exception:
            return {}

    mapa: Dict[str, Dict[str, str]] = {}
    for row in rows:
        codigo = _normalizar_codigo(_get(row, "cod_produto", "codigo", "codigo_produto"))
        if not codigo:
            continue

        mapa[codigo] = {
            "codigo": codigo,
            "produto": _normalizar_texto(_get(row, "descricao", "produto", default="")),
            "grupo": _normalizar_texto(_get(row, "grupo_descricao", "grupo", default="Sem grupo")) or "Sem grupo",
        }

    return _cache_set(chave, mapa, ttl=1800)


# Colunas reais gravadas pelo process_apontamentos atual.
# Importante: o campo de quantidade na tabela é qtd_produzida, não quantidade_produzida.
APONTAMENTOS_SELECT = (
    "data_inicial,data_final,duracao_h,equipamento,ordem,lote,produto,sku,"
    "qtd_produzida,tipo_evento,evento,etapa,situacao"
)

# Fallback para cargas antigas, caso exista uma versão antiga da tabela/processor.
APONTAMENTOS_SELECT_LEGADO = (
    "data_inicial,data_final,duracao,equipamento,ordem,lote,produto,sku,"
    "quantidade_produzida,tipo_evento,evento"
)


def _excel_serial(dt: datetime) -> float:
    base = datetime(1899, 12, 30)
    return (dt - base).total_seconds() / 86400.0


def _query_apontamentos_por_data(inicio_iso: str, fim_iso: str) -> List[Dict[str, Any]]:
    """
    Busca apontamentos de envase usando filtro de data no banco.

    Regra oficial do realizado:
      - filtrar pelo mês/ano da DATA FINAL;
      - fallback em Python usa _data_referencia_apontamento, que também prioriza data_final.

    Isso faz o dashboard bater com a dinâmica operacional feita na base de apontamentos.
    """
    inicio_dt = _parse_datetime(inicio_iso)
    fim_dt = _parse_datetime(fim_iso)
    inicio_query = inicio_dt.isoformat() if inicio_dt else inicio_iso
    fim_query = fim_dt.isoformat() if fim_dt else fim_iso

    def _filtrar_periodo_python(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        saida: List[Dict[str, Any]] = []

        for row in rows or []:
            dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
            if not dt:
                continue

            if inicio_dt and dt < inicio_dt:
                continue

            if fim_dt and dt >= fim_dt:
                continue

            saida.append(row)

        return saida

    erros: List[str] = []

    # Fonte principal: schema atual + filtro de data no banco.
    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT)
            .gte("data_final", inicio_query)
            .lt("data_final", fim_query)
            .ilike("equipamento", "%ENVASADORA%"),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception as e:
        erros.append(f"schema_atual_com_data: {str(e)[:180]}")

    # Fallback legado: sem filtro de data no PostgREST, só se a consulta principal falhar.
    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT)
            .ilike("equipamento", "%ENVASADORA%"),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception as e:
        erros.append(f"schema_atual_sem_data: {str(e)[:180]}")

    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT_LEGADO)
            .ilike("equipamento", "%ENVASADORA%"),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception as e:
        erros.append(f"schema_legado_sem_data: {str(e)[:180]}")

    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select("*")
            .ilike("equipamento", "%ENVASADORA%"),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception as e:
        erros.append(f"select_all_sem_data: {str(e)[:180]}")

    print("[producao] f_apontamentos sem linhas de envase para período. Tentativas:", " | ".join(erros))
    return []

def _query_apontamentos_fabrima_por_data(inicio_iso: str, fim_iso: str) -> List[Dict[str, Any]]:
    """
    Busca apontamentos de Fabrima/embalagem para a aba Acompanhamento do Mês.

    Usa filtro de data no banco para não varrer a tabela inteira.
    """
    inicio_dt = _parse_datetime(inicio_iso)
    fim_dt = _parse_datetime(fim_iso)
    inicio_query = inicio_dt.isoformat() if inicio_dt else inicio_iso
    fim_query = fim_dt.isoformat() if fim_dt else fim_iso

    def _filtrar(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        saida: List[Dict[str, Any]] = []

        for row in rows or []:
            equipamento = _equipamento_apontamento(row)
            etapa = _normalizar_texto(_get(row, "etapa", "ETAPA", default=""))
            linha = _linha_operacional_from_text(equipamento=equipamento, etapa=etapa)

            if linha != "FABRIMA":
                continue

            dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
            if not dt:
                continue

            if inicio_dt and dt < inicio_dt:
                continue

            if fim_dt and dt >= fim_dt:
                continue

            saida.append(row)

        return saida

    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT)
            .gte("data_final", inicio_query)
            .lt("data_final", fim_query)
            .ilike("equipamento", "%FABRIMA%"),
            page_size=1000,
        )
        return _filtrar(rows)
    except Exception:
        try:
            rows = _select_all(
                supabase.table("f_apontamentos")
                .select("*")
                .gte("data_final", inicio_query)
                .lt("data_final", fim_query)
                .ilike("equipamento", "%FABRIMA%"),
                page_size=1000,
            )
            return _filtrar(rows)
        except Exception:
            return []

def _carregar_apontamentos_periodo(ano: int, mes_final: int) -> List[Dict[str, Any]]:
    chave = _cache_key("apontamentos_periodo_v119_data_final", ano, mes_final)
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    inicio, fim = _periodo_ano_ate_mes(ano, mes_final)
    inicio_iso = inicio.date().isoformat()
    fim_iso = fim.date().isoformat()

    rows = _query_apontamentos_por_data(inicio_iso, fim_iso)

    saida: List[Dict[str, Any]] = []
    for row in rows:
        dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
        if not dt:
            continue

        if dt.year == int(ano) and 1 <= dt.month <= int(mes_final):
            saida.append(row)

    # Cache curto o suficiente para não atrapalhar a operação,
    # mas evita recalcular a mesma base a cada clique/troca de aba.
    return _cache_set(chave, saida, ttl=120)

def _carregar_apontamentos_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    # Não cachear apontamentos: acompanhamento mensal deve atualizar logo após nova carga.
    inicio, fim = _periodo_mes(ano, mes)
    inicio_iso = inicio.date().isoformat()
    fim_iso = fim.date().isoformat()

    rows = _query_apontamentos_por_data(inicio_iso, fim_iso)

    saida: List[Dict[str, Any]] = []
    for row in rows:
        dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
        if not dt:
            continue
        if dt.year == int(ano) and dt.month == int(mes):
            saida.append(row)

    return saida


def _mes_ref(ano: int, mes: int) -> str:
    return f"{int(ano)}-{int(mes):02d}"


def _carregar_programacao_ops_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    """
    Busca a programação detalhada usada na página Ordens de Produção.

    Mantida como fallback e para debug, mas o planejado principal da Produção
    deve vir de f_programacao_ops_resumo.meta_mes_tubetes.
    """
    mes_ref = _mes_ref(ano, mes)

    try:
        rows = _select_all(
            supabase.table("f_programacao_ops")
            .select("*")
            .eq("mes_ref", mes_ref)
            .order("data_inicio_fabricacao")
            .order("data_fim")
            .order("lote")
            .order("codigo"),
            page_size=1000,
        )
    except Exception:
        rows = []

    return rows


def _carregar_programacao_ops_resumo_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    """
    Busca o resumo oficial da programação de envase.

    Fonte correta para o planejado do dashboard Produção:
      f_programacao_ops_resumo.meta_mes_tubetes / 500

    A tabela é alimentada no upload da Programação Mensal lendo a célula L4
    das abas ENVASE LINHA 1 e ENVASE LINHA 2.
    """
    mes_ref = _mes_ref(ano, mes)

    try:
        return _select_all(
            supabase.table("f_programacao_ops_resumo")
            .select(
                "mes_ref,linha,meta_mes_tubetes,prog_mes_tubetes,"
                "dif_mes_tubetes,arquivo_origem,atualizado_em"
            )
            .eq("mes_ref", mes_ref),
            page_size=1000,
        )
    except Exception:
        return []



def _versao_mps_num(value: Any) -> int:
    texto = _upper(value).replace("V", "").strip()
    try:
        return int(float(texto))
    except Exception:
        return 0


def _carregar_mps_liberacoes_atual_ano(ano: int) -> Tuple[Dict[Tuple[str, int], float], Optional[str]]:
    """
    Carrega o MPS versionado mais recente do ano para completar o planejado anual.

    Uso na Produção:
      - se o mês já tem Programação Mensal em f_programacao_ops_resumo, usa a Programação;
      - se o mês ainda não tem Programação Mensal, usa o MPS mais recente.

    Fonte:
      f_mps_liberacoes
        versao, mes_revisao, mes, ano, linha, qtd_caixas

    Critério do MPS ativo:
      maior mes_revisao do ano e, dentro dele, maior versão.
      Ex.: Jun/V3.
    """
    chave = _cache_key("mps_liberacoes_atual_ano", ano)
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_mps_liberacoes")
            .select("*")
            .eq("ano", int(ano)),
            page_size=1000,
        )
    except Exception:
        rows = []

    if not rows:
        return _cache_set(chave, ({}, None), ttl=300)

    mes_revisao_max = max(_to_int(_get(row, "mes_revisao", "MES_REVISAO", default=0)) for row in rows)
    rows_revisao = [
        row for row in rows
        if _to_int(_get(row, "mes_revisao", "MES_REVISAO", default=0)) == mes_revisao_max
    ]

    versao_max = max(_versao_mps_num(_get(row, "versao", "VERSAO", default=0)) for row in rows_revisao)
    rows_versao = [
        row for row in rows_revisao
        if _versao_mps_num(_get(row, "versao", "VERSAO", default=0)) == versao_max
    ]

    mapa: Dict[Tuple[str, int], float] = defaultdict(float)

    for row in rows_versao:
        linha_raw = _upper(_get(row, "linha", "LINHA", default=""))
        linha = _linha_envase_from_text(recurso=linha_raw) or linha_raw

        if linha_raw in {"L1", "ENVASE_L1", "LINHA 1", "LINHA1", "1"}:
            linha = "L1"
        elif linha_raw in {"L2", "ENVASE_L2", "LINHA 2", "LINHA2", "2"}:
            linha = "L2"

        if linha not in {"L1", "L2"}:
            continue

        mes = _to_int(_get(row, "mes", "MES", default=0))
        if mes < 1 or mes > 12:
            continue

        qtd_caixas = _to_float(_get(row, "qtd_caixas", "quantidade_caixas", "qtd", "quantidade", default=0))
        if qtd_caixas <= 0:
            continue

        mapa[(linha, mes)] += qtd_caixas

    fonte = f"MPS {_mes_label(mes_revisao_max)}/V{versao_max}" if mes_revisao_max and versao_max else "MPS"

    return _cache_set(chave, (dict(mapa), fonte), ttl=300)



def _data_planejada_programacao(row: Dict[str, Any], ano: int, mes: int) -> date:
    # Para acompanhamento do mês, a data mais útil é a DATA FIM da programação:
    # um mesmo lote pode produzir em mais de um dia, mas deve aparecer como um
    # único planejado na data de conclusão planejada.
    for campo in ["data_fim", "data_termino", "data_inicio_fabricacao", "data_lavagem_emb", "data_lavagem_pesagem"]:
        dt = _parse_datetime(row.get(campo))
        if dt:
            return dt.date()
    return date(int(ano), int(mes), 1)


def _carregar_planejado_envase_mes(ano: int, mes: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Planejado de envase por mês/linha.

    Regra oficial da Produção:
      1) Se existir Programação Mensal para o mês:
         usa f_programacao_ops_resumo.meta_mes_tubetes / 500.
      2) Se ainda NÃO existir Programação Mensal para o mês:
         usa o MPS versionado mais recente em f_mps_liberacoes.
      3) Fallback final:
         usa soma das OPs detalhadas em f_programacao_ops.

    Com isso, o gráfico fica Jan-Dez:
      - meses já programados: Programação;
      - meses futuros ainda sem programação: MPS.
    """
    mes_ref = _mes_ref(ano, mes)
    saida: List[Dict[str, Any]] = []
    linhas_preenchidas: set[str] = set()

    # 1) Fonte preferencial: Programação Mensal / META MÊS - TUBETES.
    resumo_rows = _carregar_programacao_ops_resumo_mes(ano, mes)

    for row in resumo_rows:
        linha_raw = _normalizar_texto(_get(row, "linha", "LINHA", default=""))
        linha_raw_upper = _upper(linha_raw)
        linha = _linha_envase_from_text(recurso=linha_raw) or linha_raw_upper

        if linha_raw_upper in {"L1", "ENVASE_L1"}:
            linha = "L1"
        elif linha_raw_upper in {"L2", "ENVASE_L2"}:
            linha = "L2"

        if linha not in {"L1", "L2"}:
            continue

        qtd_tb = _to_float(_get(row, "meta_mes_tubetes", "META_MES_TUBETES", default=0))
        if qtd_tb <= 0:
            continue

        saida.append({
            "ano": int(ano),
            "mes": int(mes),
            "mes_ref": mes_ref,
            "data": date(int(ano), int(mes), 1).isoformat(),
            "dia": 1,
            "linha": linha,
            "linha_nome": _nome_linha(linha),
            "lote": None,
            "op": None,
            "codigo": None,
            "produto": "META MÊS - TUBETES",
            "grupo": "Programação mensal",
            "qtd_tubetes": qtd_tb,
            "qtd_caixas": qtd_tb / TUBETES_POR_CAIXA,
            "recurso": linha_raw,
            "meta_mes_tubetes": qtd_tb,
            "prog_mes_tubetes": _to_float(_get(row, "prog_mes_tubetes", default=0)),
            "dif_mes_tubetes": _to_float(_get(row, "dif_mes_tubetes", default=0)),
            "arquivo_origem": _normalizar_texto(_get(row, "arquivo_origem", default="")),
            "atualizado_em": _normalizar_texto(_get(row, "atualizado_em", default="")),
            "origem_planejado": "programacao_mensal_meta_mes",
        })
        linhas_preenchidas.add(linha)

    # 2) Completa linhas/meses ainda sem Programação Mensal usando MPS versionado.
    mps_mapa, mps_fonte = _carregar_mps_liberacoes_atual_ano(ano)

    for linha in ["L1", "L2"]:
        if linha in linhas_preenchidas:
            continue

        qtd_cx = _to_float(mps_mapa.get((linha, int(mes)), 0))
        if qtd_cx <= 0:
            continue

        saida.append({
            "ano": int(ano),
            "mes": int(mes),
            "mes_ref": mes_ref,
            "data": date(int(ano), int(mes), 1).isoformat(),
            "dia": 1,
            "linha": linha,
            "linha_nome": _nome_linha(linha),
            "lote": None,
            "op": None,
            "codigo": None,
            "produto": mps_fonte or "MPS versionado",
            "grupo": "MPS versionado",
            "qtd_tubetes": qtd_cx * TUBETES_POR_CAIXA,
            "qtd_caixas": qtd_cx,
            "recurso": linha,
            "origem_planejado": "mps_versionado_mais_recente",
            "fonte_mps": mps_fonte,
        })
        linhas_preenchidas.add(linha)

    # Se já tem Programação/MPS para pelo menos uma linha, retorna.
    # Mantemos o fallback de OPs só para meses realmente sem nenhuma fonte.
    if saida:
        return saida, mes_ref

    # 3) Fallback final: soma das OPs detalhadas em f_programacao_ops.
    rows = _carregar_programacao_ops_mes(ano, mes)

    for row in rows:
        linha_raw = _normalizar_texto(_get(row, "linha", "LINHA", "recurso", default=""))
        linha = _linha_envase_from_text(recurso=linha_raw)
        if linha not in {"L1", "L2"}:
            continue

        qtd_tb = _to_float(_get(
            row,
            "quantidade",
            "quantidade_programada",
            "qtd_tubetes",
            "quantidade_tubetes",
            "qtd_tubete",
            "quantidade_tubete",
            "QUANTIDADE",
            "QTD TUBETES",
            default=0,
        ))
        if qtd_tb <= 0:
            continue

        data_prod = _data_planejada_programacao(row, ano, mes)
        codigo = _normalizar_codigo(_get(row, "codigo", "codigo_produto", "cod_produto"))

        saida.append({
            "ano": int(ano),
            "mes": int(mes),
            "mes_ref": mes_ref,
            "data": data_prod.isoformat(),
            "dia": data_prod.day,
            "linha": linha,
            "linha_nome": _nome_linha(linha),
            "lote": _normalizar_texto(_get(row, "lote", "LOTE")),
            "op": _normalizar_texto(_get(row, "op_numero", "op", "ordem", "OP")),
            "codigo": codigo,
            "produto": _normalizar_texto(_get(row, "produto", "descricao_produto", "descricao", default="")),
            "grupo": "Programação OPs",
            "qtd_tubetes": qtd_tb,
            "qtd_caixas": qtd_tb / TUBETES_POR_CAIXA,
            "recurso": linha_raw,
            "origem_planejado": "fallback_f_programacao_ops_soma_ops",
        })

    return saida, mes_ref


def _carregar_planejado_envase_periodo(ano: int, mes_final: int) -> Tuple[List[Dict[str, Any]], Dict[int, Optional[str]]]:
    saida: List[Dict[str, Any]] = []
    programacoes: Dict[int, Optional[str]] = {}

    # Dashboard é ano fechado Jan-Dez.
    for mes in range(1, int(mes_final) + 1):
        rows, mes_ref = _carregar_planejado_envase_mes(ano, mes)
        saida.extend(rows)
        programacoes[mes] = mes_ref

    return saida, programacoes


def _carregar_orcado_liberacao_periodo(ano: int) -> Dict[Tuple[str, int], float]:
    """
    Carrega o orçado anual por linha/mês para usar como linha no gráfico de Produção.

    Fonte esperada:
      f_orcado_liberacao

    Observação:
      Em algumas versões antigas, a coluna se chama qtd_tubetes mesmo quando a tela
      já exibe caixas. Para não quebrar histórico:
        - se existir qtd_caixas, usa direto;
        - se vier qtd_tubetes muito alto, converte por 500;
        - se vier valor pequeno, assume que já está em caixas.
    """
    chave = _cache_key("orcado_liberacao_periodo", ano)
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_orcado_liberacao")
            .select("*")
            .eq("ano", int(ano)),
            page_size=1000,
        )
    except Exception:
        rows = []

    mapa: Dict[Tuple[str, int], float] = defaultdict(float)

    for row in rows:
        linha_raw = _upper(_get(row, "linha", "LINHA", default=""))
        linha = _linha_envase_from_text(recurso=linha_raw) or linha_raw

        if linha_raw in {"L1", "ENVASE_L1", "LINHA 1", "LINHA1", "1"}:
            linha = "L1"
        elif linha_raw in {"L2", "ENVASE_L2", "LINHA 2", "LINHA2", "2"}:
            linha = "L2"

        if linha not in {"L1", "L2"}:
            continue

        mes = _to_int(_get(row, "mes", "MES", default=0))
        if mes < 1 or mes > 12:
            continue

        qtd_caixas = _to_float(_get(row, "qtd_caixas", "quantidade_caixas", default=0))

        if qtd_caixas <= 0:
            qtd_base = _to_float(_get(row, "qtd_tubetes", "quantidade", "qtd", default=0))
            if qtd_base > 100000:
                qtd_caixas = qtd_base / TUBETES_POR_CAIXA
            else:
                qtd_caixas = qtd_base

        if qtd_caixas <= 0:
            continue

        mapa[(linha, mes)] += qtd_caixas

    return _cache_set(chave, dict(mapa), ttl=300)


def _label_mes_ano(ano: Any, mes: Any) -> str:
    ano_int = _to_int(ano)
    mes_int = _to_int(mes)

    if mes_int < 1 or mes_int > 12 or ano_int <= 0:
        return ""

    return f"{_mes_label(mes_int)}/{ano_int}"


def _mes_ano_from_mes_ref(mes_ref: Any) -> Tuple[int, int]:
    texto = _normalizar_texto(mes_ref)
    match = re.search(r"(\d{4})[-/](\d{1,2})", texto)

    if not match:
        return 0, 0

    return _to_int(match.group(1)), _to_int(match.group(2))


def _keys_liberacao(row: Dict[str, Any]) -> List[str]:
    """
    Chaves usadas para casar acompanhamento x MPS/programação.

    Prioridade operacional:
      - lote é a principal chave;
      - OP entra como fallback;
      - o par lote|op ajuda quando existir repetição de lote em contextos diferentes.
    """
    lote = _upper(_get(row, "lote", "LOTE", default=""))
    op = _upper(_get(row, "op", "op_numero", "ordem", "OP", "ORDEM", default=""))

    keys: List[str] = []

    if lote:
        keys.append(f"LOTE::{lote}")

    if op:
        keys.append(f"OP::{op}")

    if lote and op:
        keys.append(f"LOTE_OP::{lote}::{op}")

    return keys


def _carregar_ultima_rodada_mrp_mps(ano: int) -> Optional[Dict[str, Any]]:
    """
    Retorna a última rodada MPS/Gantt disponível do ano.

    Fonte nova/oficial:
      f_mrp_rodadas

    Critério:
      - nome = MPS, quando existir;
      - maior mês de referência;
      - maior versão;
      - maior criado_em como desempate.

    Observação:
      f_mps_liberacoes é uma tabela antiga/agregada e não deve ser usada para
      mês de liberação por lote/OP.
    """
    chave_cache = _cache_key("ultima_rodada_mrp_mps_v121", ano)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_mrp_rodadas")
            .select("id,nome,mes,ano,versao,status,criado_em")
            .eq("ano", int(ano)),
            page_size=1000,
        )
    except Exception:
        rows = []

    if not rows:
        return _cache_set(chave_cache, None, ttl=60)

    rows_mps = [row for row in rows if _upper(_get(row, "nome", "NOME", default="")) == "MPS"]
    candidatos = rows_mps or rows

    def _sort_rodada(row: Dict[str, Any]) -> Tuple[int, int, str]:
        return (
            _to_int(_get(row, "mes", "MES", default=0)),
            _to_int(_get(row, "versao", "VERSAO", default=0)),
            str(_get(row, "criado_em", "CRIADO_EM", default="")),
        )

    rodada = sorted(candidatos, key=_sort_rodada, reverse=True)[0]
    return _cache_set(chave_cache, rodada, ttl=300)


def _carregar_mrp_etapas_ultima_rodada(ano: int) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Carrega as etapas da última rodada MPS/Gantt.

    Fonte:
      f_mrp_etapas

    Campos usados:
      lote, op, data_fim, data_pa, mes_liberacao, ano_liberacao
    """
    rodada = _carregar_ultima_rodada_mrp_mps(ano)
    rodada_id = _get(rodada or {}, "id", "ID", default=None)

    if not rodada_id:
        return [], rodada

    chave_cache = _cache_key("mrp_etapas_ultima_rodada_v121", ano, rodada_id)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached, rodada

    try:
        rows = _select_all(
            supabase.table("f_mrp_etapas")
            .select(
                "rodada_id,lote,op,codigo_produto,descricao_produto,etapa,recurso,"
                "linha_origem,data_inicio,data_fim,data_pa,qtd_planejada,sequencia,"
                "status,origem,mes_producao,ano_producao,mes_liberacao,ano_liberacao,"
                "mes_lib_manual"
            )
            .eq("rodada_id", str(rodada_id)),
            page_size=1000,
        )
    except Exception:
        rows = []

    return _cache_set(chave_cache, rows, ttl=300), rodada


def _label_liberacao_from_mrp_etapa(row: Dict[str, Any], ano_default: int) -> Tuple[str, Tuple[int, int, str]]:
    """
    Define o mês de liberação oficial de uma etapa/lote no Gantt novo.

    Prioridade:
      1. ano_liberacao + mes_liberacao;
      2. data_pa;
      3. data_fim.

    Retorna:
      label, chave_ordenacao
    """
    ano_lib = _to_int(_get(row, "ano_liberacao", "ANO_LIBERACAO", default=0))
    mes_lib = _to_int(_get(row, "mes_liberacao", "MES_LIBERACAO", default=0))

    if ano_lib <= 0:
        ano_lib = int(ano_default)

    if 1 <= mes_lib <= 12:
        label = _label_mes_ano(ano_lib, mes_lib)
        return label, (ano_lib, mes_lib, "mes_liberacao")

    for campo in ["data_pa", "DATA_PA", "data_fim", "DATA_FIM"]:
        dt = _parse_datetime(_get(row, campo, default=None))
        if dt:
            label = _label_mes_ano(dt.year, dt.month)
            return label, (dt.year, dt.month, campo)

    return "", (0, 0, "")


def _carregar_mapa_mes_liberacao(ano: int) -> Dict[str, str]:
    """
    Monta mapa de mês de liberação por lote/OP para a aba Acompanhamento do Mês.

    Fonte principal/oficial:
      f_mrp_rodadas + f_mrp_etapas da última rodada MPS/Gantt disponível.

    Regra:
      - usar mes_liberacao/ano_liberacao da f_mrp_etapas;
      - se mes_liberacao estiver vazio, usar data_pa;
      - se data_pa estiver vazia, usar data_fim;
      - se o lote/OP não existir no Gantt novo, usar f_programacao_ops.mes_ref como fallback.

    Isso corrige casos em que o lote estava na V1/Gantt antigo em Jun/2026,
    mas na última rodada MPS/Gantt passou a liberar em Jul/2026.
    """
    chave_cache = _cache_key("mapa_mes_liberacao_v121_mrp_etapas", ano)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    mapa: Dict[str, str] = {}

    # 1) Fonte principal: última rodada do Gantt/MRP novo.
    rows_mrp, rodada = _carregar_mrp_etapas_ultima_rodada(ano)

    candidatos: Dict[str, Tuple[Tuple[int, int, str], str]] = {}

    for row in rows_mrp:
        label, ordem = _label_liberacao_from_mrp_etapa(row, ano)

        if not label:
            continue

        lote = _get(row, "lote", "LOTE", default="")
        op = _get(row, "op", "OP", "ordem", "ORDEM", default="")
        base_row = {"lote": lote, "op": op}

        for key in _keys_liberacao(base_row):
            atual = candidatos.get(key)

            # Para o mesmo lote/OP, fica com a maior liberação encontrada na rodada.
            # Isso evita pegar uma etapa intermediária quando existir uma data/liberação final.
            if atual is None or ordem > atual[0]:
                candidatos[key] = (ordem, label)

    for key, (_ordem, label) in candidatos.items():
        mapa[key] = label

    # 2) Fallback pela programação mensal detalhada antiga.
    # Só entra se o lote/OP não foi encontrado na f_mrp_etapas.
    try:
        rows_prog = _select_all(
            supabase.table("f_programacao_ops")
            .select("*"),
            page_size=1000,
        )
    except Exception:
        rows_prog = []

    for row in rows_prog:
        mes_ref = _get(row, "mes_ref", "MES_REF", default="")
        ano_ref, mes_ref_num = _mes_ano_from_mes_ref(mes_ref)

        if ano_ref != int(ano):
            continue

        label = _label_mes_ano(ano_ref, mes_ref_num)

        if not label:
            continue

        for key in _keys_liberacao({
            "lote": _get(row, "lote", "LOTE", default=""),
            "op": _get(row, "op_numero", "op", "ordem", "OP", "ORDEM", default=""),
        }):
            mapa.setdefault(key, label)

    return _cache_set(chave_cache, mapa, ttl=300)


def _quantidade_programada_ops(row: Dict[str, Any]) -> float:
    return _to_float(_get(
        row,
        "quantidade",
        "quantidade_programada",
        "qtd_tubetes",
        "quantidade_tubetes",
        "qtd_tubete",
        "quantidade_tubete",
        "QUANTIDADE",
        "QTD TUBETES",
        default=0,
    ))


def _divisor_caixas_linha(linha: Any) -> float:
    """
    Conversão operacional para exibição em caixas.

    Envase L1/L2:
      1 caixa = 500 tubetes

    Fabrima:
      1 caixa = 50 unidades/tubetes no acompanhamento de embalagem.
    """
    return 50.0 if _upper(linha) == "FABRIMA" else float(TUBETES_POR_CAIXA)


def _tubetes_para_caixas_linha(qtd_tubetes: Any, linha: Any) -> float:
    divisor = _divisor_caixas_linha(linha)
    if divisor <= 0:
        divisor = float(TUBETES_POR_CAIXA)
    return _to_float(qtd_tubetes) / divisor


def _planejado_para_caixas_linha(qtd_planejada: Any, linha: Any) -> float:
    """
    Conversão do PLANEJADO exibido na aba Acompanhamento.

    Envase: programação vem em tubetes, então /500.
    Fabrima: a quantidade da Programação/Embalagem já vem em caixas operacionais.
    Portanto não dividir por 50, senão 288 vira 6 cx e distorce a análise.
    """
    if _upper(linha) == "FABRIMA":
        return _to_float(qtd_planejada)

    return _to_float(qtd_planejada) / float(TUBETES_POR_CAIXA)


def _is_retrabalho_programacao(row: Dict[str, Any]) -> bool:
    texto = " ".join([
        _upper(_get(row, "linha", "LINHA", default="")),
        _upper(_get(row, "recurso", "RECURSO", default="")),
        _upper(_get(row, "equipamento", "EQUIPAMENTO", default="")),
        _upper(_get(row, "etapa", "ETAPA", default="")),
        _upper(_get(row, "setor", "SETOR", default="")),
        _upper(_get(row, "produto", "PRODUTO", default="")),
    ])
    return "RETRAB" in texto


def _keys_liberacao_linha(row: Dict[str, Any], linha: Any) -> List[str]:
    """
    Chaves de lote/OP considerando a linha operacional.
    Evita que uma OP/lote de Envase e a mesma OP/lote na Fabrima se misturem.
    """
    linha_norm = _upper(linha)
    keys = []

    if linha_norm:
        for key in _keys_liberacao(row):
            keys.append(f"LINHA::{linha_norm}::{key}")

    keys.extend(_keys_liberacao(row))
    return keys


def _carregar_mapa_qtd_planejada_lote(ano: int) -> Dict[str, float]:
    """
    Monta mapa de quantidade planejada por lote/OP usando o Gantt da Programação.

    Fonte:
      f_programacao_ops

    Regra:
      - soma a coluna quantidade da programação;
      - considera apenas mes_ref do ano selecionado;
      - chave principal é lote;
      - OP entra como fallback;
      - também grava chave por linha operacional para não misturar Envase x Fabrima.

    Observação:
      a quantidade é em tubetes/unidades. A conversão para caixas depende da linha:
      Envase /500; Fabrima /50.
    """
    chave_cache = _cache_key("mapa_qtd_planejada_lote_v95", ano)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_programacao_ops")
            .select("*"),
            page_size=1000,
        )
    except Exception:
        rows = []

    mapa: Dict[str, float] = defaultdict(float)

    for row in rows:
        mes_ref = _get(row, "mes_ref", "MES_REF", default="")
        ano_ref, _mes_ref_num = _mes_ano_from_mes_ref(mes_ref)

        if ano_ref != int(ano):
            continue

        qtd_tb = _quantidade_programada_ops(row)
        if qtd_tb <= 0:
            continue

        linha = _linha_operacional_programacao(row)

        if linha == "FABRIMA" and _is_retrabalho_programacao(row):
            continue

        lote = _upper(_get(row, "lote", "LOTE", default=""))
        op = _upper(_get(row, "op_numero", "op", "ordem", "OP", "ORDEM", default=""))

        base_row = {"lote": lote, "op": op}

        # Chaves por linha são a fonte principal.
        if linha:
            for key in _keys_liberacao(base_row):
                mapa[f"LINHA::{linha}::{key}"] += qtd_tb

        # Chaves antigas ficam como fallback para não quebrar histórico sem linha.
        for key in _keys_liberacao(base_row):
            mapa[key] += qtd_tb

    return _cache_set(chave_cache, dict(mapa), ttl=300)


def _carregar_mapa_data_planejada_lote(ano: int) -> Dict[str, str]:
    """
    Data planejada por lote/OP para a aba Acompanhamento do Mês.

    Regra:
      - usa f_programacao_ops;
      - prioriza data_fim da programação;
      - grava chave por linha operacional e fallback sem linha;
      - se houver mais de uma data para o mesmo lote/OP, mantém a maior data.
    """
    chave_cache = _cache_key("mapa_data_planejada_lote_v95", ano)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_programacao_ops")
            .select("*"),
            page_size=1000,
        )
    except Exception:
        rows = []

    mapa: Dict[str, str] = {}

    def escolher_maior(chave: str, data_iso: str) -> None:
        if not data_iso:
            return
        atual = mapa.get(chave)
        if not atual or data_iso > atual:
            mapa[chave] = data_iso

    for row in rows:
        mes_ref = _get(row, "mes_ref", "MES_REF", default="")
        ano_ref, mes_ref_num = _mes_ano_from_mes_ref(mes_ref)

        if ano_ref != int(ano):
            continue

        data_prog = _data_planejada_programacao(row, ano_ref, mes_ref_num or 1)
        data_iso = data_prog.isoformat() if data_prog else ""

        if not data_iso:
            continue

        linha = _linha_operacional_programacao(row)

        if linha == "FABRIMA" and _is_retrabalho_programacao(row):
            continue

        lote = _upper(_get(row, "lote", "LOTE", default=""))
        op = _upper(_get(row, "op_numero", "op", "ordem", "OP", "ORDEM", default=""))
        base_row = {"lote": lote, "op": op}

        if linha:
            for key in _keys_liberacao(base_row):
                escolher_maior(f"LINHA::{linha}::{key}", data_iso)

        for key in _keys_liberacao(base_row):
            escolher_maior(key, data_iso)

    return _cache_set(chave_cache, mapa, ttl=300)


def _carregar_fabrima_sb8_98_por_lote() -> Dict[str, float]:
    """
    Quantidade confiável da Fabrima pelo estoque em quarentena/armazém 98.

    O relatório de apontamento da Fabrima pode contar retrabalho novamente.
    Por isso, para quantidade produzida da Fabrima no acompanhamento, usamos a SB8
    do armazém 98 por lote, quando disponível.
    """
    chave_cache = _cache_key("fabrima_sb8_98_por_lote_v96")
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    try:
        ult = (
            supabase.table("f_estoque_saldo")
            .select("data_ref")
            .eq("armazem", "98")
            .order("data_ref", desc=True)
            .limit(1)
            .execute()
        )
        data_ref = (ult.data or [{}])[0].get("data_ref")
    except Exception:
        data_ref = None

    if not data_ref:
        return _cache_set(chave_cache, {}, ttl=60)

    try:
        rows = _select_all(
            supabase.table("f_estoque_saldo")
            .select("codigo,descricao,armazem,lote,saldo_lote,saldo_bruto,empenho_lote,data_ref")
            .eq("data_ref", data_ref)
            .eq("armazem", "98"),
            page_size=1000,
        )
    except Exception:
        rows = []

    mapa: Dict[str, float] = defaultdict(float)

    for row in rows:
        lote = _upper(_get(row, "lote", "LOTE", default=""))
        if not lote:
            continue

        # Para representar o volume que entrou/passou no armazém 98,
        # saldo_bruto é mais fiel que disponível quando houver empenho.
        qtd = max(
            _to_float(_get(row, "saldo_bruto", "SALDO_BRUTO", default=0)),
            _to_float(_get(row, "saldo_lote", "SALDO_LOTE", default=0)),
        )

        if qtd > 0:
            mapa[lote] += qtd

    return _cache_set(chave_cache, dict(mapa), ttl=60)


def _is_armazem_liberado_sd3(armazem: Any) -> bool:
    """
    Armazéns considerados como liberação efetiva para PA.

    Regra operacional:
      - 04/07 = estoque liberado/disponível;
      - 98 = quarentena, não entra como liberado.
    """
    texto = _normalizar_texto(armazem).strip()
    texto_digits = texto.zfill(2) if texto.isdigit() else texto.upper()

    if texto_digits in {"04", "07"}:
        return True

    return False


def _carregar_fabrima_sd3_liberado_por_lote(ano: int) -> Dict[str, Dict[str, Any]]:
    """
    Quantidade liberada oficial por lote, vinda da SD3.

    Uso:
      - a Fabrima continua listando os lotes que passaram pela embalagem via Cogtive;
      - a quantidade exibida passa a ser a quantidade liberada na SD3;
      - se não houver SD3 liberada para o lote, a tela mostra "—".

    Fonte:
      f_sd3_entradas

    Observação:
      A coluna quantidade da SD3 já vem em caixas de PA.
      A tela também exibe a conversão gerencial em tubetes usando *500.
    """
    chave_cache = _cache_key("fabrima_sd3_liberado_por_lote_v123_caixas", ano)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    try:
        rows = _select_all(
            supabase.table("f_sd3_entradas")
            .select("produto,descr_prod,lote,quantidade,armazem,grupo,dt_emissao,mes,ano")
            .gte("ano", int(ano) - 1)
            .lte("ano", int(ano) + 1),
            page_size=1000,
        )
    except Exception:
        try:
            rows = _select_all(
                supabase.table("f_sd3_entradas")
                .select("produto,descr_prod,lote,quantidade,armazem,grupo,dt_emissao,mes,ano"),
                page_size=1000,
            )
        except Exception:
            rows = []

    mapa: Dict[str, Dict[str, Any]] = {}

    for row in rows or []:
        lote = _upper(_get(row, "lote", "LOTE", default=""))
        if not lote:
            continue

        if not _is_armazem_liberado_sd3(_get(row, "armazem", "ARMAZEM", default="")):
            continue

        qtd = _to_float(_get(row, "quantidade", "QUANTIDADE", default=0))
        if qtd <= 0:
            continue

        dt = _parse_datetime(_get(row, "dt_emissao", "DT_EMISSAO", default=None))
        data_iso = dt.date().isoformat() if dt else None

        item = mapa.setdefault(
            lote,
            {
                "lote": lote,
                "qtd_liberada_tubetes": 0.0,
                "qtd_liberada_caixas": 0.0,
                "data_liberacao": None,
                "armazens": set(),
                "produtos": set(),
                "grupos": set(),
            },
        )

        # A SD3 já vem em caixas de PA.
        # Pode haver mais de uma linha para o mesmo lote; portanto somamos as caixas
        # e calculamos tubetes apenas como conversão gerencial.
        item["qtd_liberada_caixas"] += qtd
        item["qtd_liberada_tubetes"] = item["qtd_liberada_caixas"] * TUBETES_POR_CAIXA

        if data_iso and (not item.get("data_liberacao") or data_iso > str(item.get("data_liberacao"))):
            item["data_liberacao"] = data_iso

        armazem = _normalizar_texto(_get(row, "armazem", "ARMAZEM", default=""))
        produto = _normalizar_texto(_get(row, "produto", "PRODUTO", "descr_prod", "DESCR_PROD", default=""))
        grupo = _normalizar_texto(_get(row, "grupo", "GRUPO", default=""))

        if armazem:
            item["armazens"].add(armazem)
        if produto:
            item["produtos"].add(produto)
        if grupo:
            item["grupos"].add(grupo)

    saida: Dict[str, Dict[str, Any]] = {}

    for lote, item in mapa.items():
        saida[lote] = {
            **item,
            "qtd_liberada_tubetes": round(_to_float(item.get("qtd_liberada_tubetes")), 1),
            "qtd_liberada_caixas": round(_to_float(item.get("qtd_liberada_caixas")), 1),
            "armazens": ", ".join(sorted(item.get("armazens") or [])),
            "produtos": ", ".join(sorted(item.get("produtos") or [])),
            "grupos": ", ".join(sorted(item.get("grupos") or [])),
        }

    return _cache_set(chave_cache, saida, ttl=300)


def _linha_operacional_programacao(row: Dict[str, Any]) -> Optional[str]:
    texto = " ".join([
        _upper(_get(row, "linha", "LINHA", default="")),
        _upper(_get(row, "recurso", "RECURSO", default="")),
        _upper(_get(row, "equipamento", "EQUIPAMENTO", default="")),
        _upper(_get(row, "etapa", "ETAPA", default="")),
        _upper(_get(row, "setor", "SETOR", default="")),
    ])

    if "FABRIMA" in texto or ("EMBAL" in texto and "ENVAS" not in texto):
        return "FABRIMA"

    linha = _linha_envase_from_text(
        equipamento=_get(row, "equipamento", "EQUIPAMENTO", default=""),
        recurso=_get(row, "linha", "LINHA", "recurso", "RECURSO", default=""),
    )

    if linha in {"L1", "L2"}:
        return linha

    linha_raw = _upper(_get(row, "linha", "LINHA", default=""))
    if linha_raw in {"L1", "ENVASE_L1", "LINHA 1", "LINHA1"}:
        return "L1"
    if linha_raw in {"L2", "ENVASE_L2", "LINHA 2", "LINHA2"}:
        return "L2"

    return None


def _cutoff_mtd(ano: int, mes: int) -> date:
    hoje = date.today()
    inicio_mes = date(int(ano), int(mes), 1)
    fim_mes = date(int(ano), int(mes), monthrange(int(ano), int(mes))[1])

    if hoje < inicio_mes:
        return inicio_mes - timedelta(days=1)

    if hoje > fim_mes:
        return fim_mes

    return hoje


def _carregar_planejado_mtd_operacional(ano: int, mes: int) -> Dict[str, float]:
    """
    Planejado do mês até hoje (MTD) para Acompanhamento do Mês.

    Fonte:
      f_programacao_ops

    Regra:
      - usa mes_ref do mês selecionado;
      - usa a data do Gantt/programação para cortar até hoje;
      - soma quantidade em tubetes por linha operacional: L1, L2 e FABRIMA.
    """
    chave_cache = _cache_key("planejado_mtd_operacional_v95", ano, mes)
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    mes_ref = _mes_ref(ano, mes)
    corte = _cutoff_mtd(ano, mes)

    try:
        rows = _select_all(
            supabase.table("f_programacao_ops")
            .select("*")
            .eq("mes_ref", mes_ref),
            page_size=1000,
        )
    except Exception:
        rows = []

    mapa: Dict[str, float] = defaultdict(float)

    for row in rows:
        linha = _linha_operacional_programacao(row)
        if linha not in {"L1", "L2", "FABRIMA"}:
            continue

        if linha == "FABRIMA" and _is_retrabalho_programacao(row):
            continue

        data_prog = _data_planejada_programacao(row, ano, mes)
        if data_prog > corte:
            continue

        qtd_tb = _quantidade_programada_ops(row)
        if qtd_tb <= 0:
            continue

        mapa[linha] += qtd_tb

    return _cache_set(chave_cache, dict(mapa), ttl=300)



def _buscar_qtd_planejada_lote(row: Dict[str, Any], mapa_qtd_planejada: Dict[str, float]) -> float:
    linha = row.get("linha")

    for key in _keys_liberacao_linha(row, linha):
        qtd = _to_float(mapa_qtd_planejada.get(key, 0))
        if qtd > 0:
            return qtd

    return 0.0


def _buscar_data_planejada_lote(row: Dict[str, Any], mapa_data_planejada: Dict[str, str]) -> Optional[str]:
    linha = row.get("linha")

    for key in _keys_liberacao_linha(row, linha):
        data_iso = mapa_data_planejada.get(key)
        if data_iso:
            return data_iso

    return None



def _buscar_mes_liberacao(row: Dict[str, Any], mapa_mes_liberacao: Dict[str, str]) -> str:
    for key in _keys_liberacao(row):
        if mapa_mes_liberacao.get(key):
            return mapa_mes_liberacao[key]

    return "—"




# ─────────────────────────────────────────────────────────────
# Transformação apontamentos
# ─────────────────────────────────────────────────────────────

def _registro_envase_real(row: Dict[str, Any], produtos_map: Dict[str, Dict[str, str]]) -> Optional[Dict[str, Any]]:
    data_ref = _data_referencia_apontamento(row)
    inicio = _data_inicio_apontamento(row) or data_ref
    if not inicio:
        return None
    if not data_ref:
        data_ref = inicio

    equipamento = _equipamento_apontamento(row)
    linha = _linha_envase_from_text(equipamento=equipamento)
    if linha not in {"L1", "L2"}:
        return None

    if not _is_produtivo_envase(row):
        return None

    sku = _normalizar_codigo(_get(row, "sku", "SKU", "codigo", "produto_codigo", "cod_produto"))
    produto_info = produtos_map.get(sku, {})
    qtd_tb = _quantidade_tubetes(row)
    fim = _data_final_apontamento(row) or inicio

    data_exibicao = fim or inicio or data_ref

    return {
        # Mantém ano/mês pela DATA INICIAL para buscar o mês operacional,
        # mas a data exibida no Acompanhamento passa a ser DATA FINAL.
        "ano": data_ref.year,
        "mes": data_ref.month,
        "data": data_exibicao.date().isoformat(),
        "dia": data_exibicao.day,
        "data_inicial": inicio.isoformat(),
        "data_final": fim.isoformat(),
        "hora_inicio": inicio.strftime("%H:%M"),
        "linha": linha,
        "linha_nome": _nome_linha(linha),
        "equipamento": equipamento,
        "lote": _normalizar_texto(_get(row, "lote", "LOTE")),
        "op": _normalizar_texto(_get(row, "ordem", "op", "ORDEM", "OP")),
        "codigo": sku,
        "produto": _normalizar_texto(_get(row, "produto", "PRODUTO", default="")) or produto_info.get("produto") or "",
        "grupo": produto_info.get("grupo") or _normalizar_texto(_get(row, "produto", "PRODUTO", default="")) or "Sem grupo",
        "qtd_tubetes": qtd_tb,
        "qtd_caixas": _tubetes_para_caixas_linha(qtd_tb, linha),
        "tipo_evento": _tipo_evento_apontamento(row),
    }


def _registro_parada_envase(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    data_ref = _data_referencia_apontamento(row)
    inicio = _data_inicio_apontamento(row) or data_ref
    if not inicio:
        return None
    if not data_ref:
        data_ref = inicio

    equipamento = _equipamento_apontamento(row)
    linha = _linha_envase_from_text(equipamento=equipamento)
    if linha not in {"L1", "L2"}:
        return None

    if not _is_parada_envase(row):
        return None

    motivo = _evento_apontamento(row)
    tipo = _tipo_evento_apontamento(row)

    return {
        "ano": data_ref.year,
        "mes": data_ref.month,
        "data": data_ref.date().isoformat(),
        "dia": data_ref.day,
        "linha": linha,
        "linha_nome": _nome_linha(linha),
        "equipamento": equipamento,
        "tipo_evento": tipo,
        "motivo": motivo or tipo or "Sem motivo informado",
        "horas": _duracao_horas(row),
    }


def _registros_envase_periodo(ano: int, mes_final: int) -> List[Dict[str, Any]]:
    produtos_map = _carregar_produtos_map()
    rows = _carregar_apontamentos_periodo(ano, mes_final)
    saida: List[Dict[str, Any]] = []

    for row in rows:
        registro = _registro_envase_real(row, produtos_map)
        if registro:
            saida.append(registro)

    return saida


def _paradas_envase_periodo(ano: int, mes_final: int) -> List[Dict[str, Any]]:
    rows = _carregar_apontamentos_periodo(ano, mes_final)
    saida: List[Dict[str, Any]] = []

    for row in rows:
        registro = _registro_parada_envase(row)
        if registro:
            saida.append(registro)

    return saida


def _registros_envase_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    produtos_map = _carregar_produtos_map()
    rows = _carregar_apontamentos_mes(ano, mes)
    saida: List[Dict[str, Any]] = []

    for row in rows:
        registro = _registro_envase_real(row, produtos_map)
        if registro:
            saida.append(registro)

    return saida



def _carregar_apontamentos_operacional_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    """
    Carrega apontamentos para a aba Acompanhamento do Mês:
      - Envase L1/L2 pelos critérios atuais de envase;
      - Fabrima/embalagem por equipamento FABRIMA.
    """
    chave = _cache_key("apontamentos_operacional_mes_v123_fabrima_sd3_caixas", ano, mes)
    cached = _cache_get(chave)
    if cached is not None:
        return cached

    inicio, fim = _periodo_mes(ano, mes)
    inicio_iso = inicio.date().isoformat()
    fim_iso = fim.date().isoformat()

    envase_rows = _query_apontamentos_por_data(inicio_iso, fim_iso)
    fabrima_rows = _query_apontamentos_fabrima_por_data(inicio_iso, fim_iso)

    rows = envase_rows + fabrima_rows
    saida: List[Dict[str, Any]] = []

    vistos = set()
    for row in rows:
        dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
        if not dt:
            continue

        if dt.year != int(ano) or dt.month != int(mes):
            continue

        chave_linha = (
            str(row.get("data_inicial")),
            str(row.get("data_final")),
            str(row.get("equipamento")),
            str(row.get("ordem")),
            str(row.get("lote")),
            str(row.get("sku")),
            str(row.get("qtd_produzida")),
        )

        if chave_linha in vistos:
            continue

        vistos.add(chave_linha)
        saida.append(row)

    # Cache bem curto: esta aba precisa refletir apontamento recém-subido.
    return _cache_set(chave, saida, ttl=15)

def _registro_operacional_real(row: Dict[str, Any], produtos_map: Dict[str, Dict[str, str]]) -> Optional[Dict[str, Any]]:
    data_ref = _data_referencia_apontamento(row)
    inicio = _data_inicio_apontamento(row) or data_ref

    if not inicio:
        return None

    if not data_ref:
        data_ref = inicio

    equipamento = _equipamento_apontamento(row)
    etapa = _normalizar_texto(_get(row, "etapa", "ETAPA", default=""))
    linha = _linha_operacional_from_text(equipamento=equipamento, etapa=etapa)

    if linha not in {"L1", "L2", "FABRIMA"}:
        return None

    if not _is_produtivo_envase(row):
        return None

    sku = _normalizar_codigo(_get(row, "sku", "SKU", "codigo", "produto_codigo", "cod_produto"))
    produto_info = produtos_map.get(sku, {})
    qtd_tb = _quantidade_tubetes(row)
    fim = _data_final_apontamento(row) or inicio

    data_exibicao = fim or inicio or data_ref

    return {
        # Mantém ano/mês pela DATA INICIAL para buscar o mês operacional,
        # mas a data exibida no Acompanhamento passa a ser DATA FINAL.
        "ano": data_ref.year,
        "mes": data_ref.month,
        "data": data_exibicao.date().isoformat(),
        "dia": data_exibicao.day,
        "data_inicial": inicio.isoformat(),
        "data_final": fim.isoformat(),
        "hora_inicio": inicio.strftime("%H:%M"),
        "linha": linha,
        "linha_nome": _nome_linha(linha),
        "equipamento": equipamento,
        "lote": _normalizar_texto(_get(row, "lote", "LOTE")),
        "op": _normalizar_texto(_get(row, "ordem", "op", "ORDEM", "OP")),
        "codigo": sku,
        "produto": _normalizar_texto(_get(row, "produto", "PRODUTO", default="")) or produto_info.get("produto") or "",
        "grupo": produto_info.get("grupo") or _normalizar_texto(_get(row, "produto", "PRODUTO", default="")) or "Sem grupo",
        "qtd_tubetes": qtd_tb,
        "qtd_caixas": _tubetes_para_caixas_linha(qtd_tb, linha),
        "tipo_evento": _tipo_evento_apontamento(row),
    }


def _registros_operacional_mes(ano: int, mes: int) -> List[Dict[str, Any]]:
    produtos_map = _carregar_produtos_map()
    rows = _carregar_apontamentos_operacional_mes(ano, mes)
    saida: List[Dict[str, Any]] = []

    for row in rows:
        registro = _registro_operacional_real(row, produtos_map)
        if registro:
            saida.append(registro)

    return saida



# ─────────────────────────────────────────────────────────────
# Agregações
# ─────────────────────────────────────────────────────────────

def _filtrar_linha(rows: List[Dict[str, Any]], linha: str) -> List[Dict[str, Any]]:
    linha_norm = _upper(linha)
    if linha_norm in {"", "TODAS", "TODOS"}:
        return rows
    if linha_norm in {"L1", "L2", "FABRIMA"}:
        return [r for r in rows if r.get("linha") == linha_norm]
    return rows


def _somar(rows: List[Dict[str, Any]], key: str) -> float:
    return sum(_to_float(row.get(key)) for row in rows)


def _agregar_meses(
    ano: int,
    mes_final: int,
    planejado: List[Dict[str, Any]],
    realizados: List[Dict[str, Any]],
    orcado_por_mes: Optional[Dict[int, float]] = None,
) -> List[Dict[str, Any]]:
    # Dashboard de produção é ano fechado: Jan a Dez.
    mapa: Dict[int, Dict[str, Any]] = {}
    orcado_por_mes = orcado_por_mes or {}

    for mes in range(1, 13):
        mapa[mes] = {
            "mes": mes,
            "mes_label": _mes_label(mes),
            "planejado_cx": 0.0,
            "realizado_cx": 0.0,
            "orcado_cx": _to_float(orcado_por_mes.get(mes, 0)),
            "gap_cx": 0.0,
            "aderencia_pct": 0.0,
        }

    for row in planejado:
        mes = _to_int(row.get("mes_producao") or row.get("mes"))
        if mes in mapa:
            mapa[mes]["planejado_cx"] += _to_float(row.get("qtd_caixas"))

    for row in realizados:
        mes = _to_int(row.get("mes"))
        if mes in mapa:
            mapa[mes]["realizado_cx"] += _to_float(row.get("qtd_caixas"))

    saida = []
    for mes in range(1, 13):
        row = mapa[mes]
        planejado_cx = row["planejado_cx"]
        realizado_cx = row["realizado_cx"]
        orcado_cx = row["orcado_cx"]
        saida.append({
            **row,
            "planejado_cx": round(planejado_cx, 1),
            "realizado_cx": round(realizado_cx, 1),
            "orcado_cx": round(orcado_cx, 1),
            "gap_cx": round(realizado_cx - planejado_cx, 1),
            "aderencia_pct": round(_pct(realizado_cx, planejado_cx), 1),
        })

    return saida


def _agregar_meses_por_linha(
    ano: int,
    planejado: List[Dict[str, Any]],
    realizados: List[Dict[str, Any]],
    orcado_por_linha_mes: Optional[Dict[Tuple[str, int], float]] = None,
) -> List[Dict[str, Any]]:
    saida: List[Dict[str, Any]] = []
    orcado_por_linha_mes = orcado_por_linha_mes or {}

    for linha in ["L1", "L2"]:
        p = [row for row in planejado if row.get("linha") == linha]
        r = [row for row in realizados if row.get("linha") == linha]
        orcado_mes = {
            mes: _to_float(orcado_por_linha_mes.get((linha, mes), 0))
            for mes in range(1, 13)
        }
        saida.append({
            "linha": linha,
            "nome": _nome_linha(linha),
            "meses": _agregar_meses(ano, 12, p, r, orcado_por_mes=orcado_mes),
        })
    return saida


def _mes_corte_operacional(ano: int) -> int:
    """
    Mês usado para separar realizado já ocorrido x plano futuro.

    - Ano passado: considera ano fechado (12).
    - Ano futuro: não há realizado ainda (0), então tendência = plano do ano.
    - Ano atual: usa o mês corrente.
    """
    hoje = date.today()
    ano_int = int(ano)

    if ano_int < hoje.year:
        return 12
    if ano_int > hoje.year:
        return 0

    return min(max(int(hoje.month), 1), 12)


def _calcular_tendencia_ano_linha(meses: List[Dict[str, Any]], ano: int) -> Dict[str, float]:
    """
    Calcula o plano atualizado/tendência anual da linha.

    Regra gerencial:
      tendência ano = realizado dos meses já fechados
                    + realizado do mês atual até hoje
                    + saldo planejado do mês atual
                    + planejamento/MPS dos meses futuros

    Como o dashboard mensal não tem ainda o plano diário por dia restante,
    o saldo do mês atual usa o fallback:
      max(planejado_mês - realizado_mês, 0)

    Isso evita que o card 'Planejado ano' pareça um plano estático maior que o orçado,
    mesmo quando já houve perda real nos meses passados.
    """
    mes_corte = _mes_corte_operacional(ano)

    planejado_ano = 0.0
    realizado_ano_disponivel = 0.0
    realizado_ate_corte = 0.0
    realizado_meses_fechados = 0.0
    planejado_restante = 0.0
    saldo_mes_atual = 0.0
    plano_futuro = 0.0

    for item in meses or []:
        mes = _to_int(item.get("mes"))
        planejado = _to_float(item.get("planejado_cx"))
        realizado = _to_float(item.get("realizado_cx"))

        planejado_ano += planejado
        realizado_ano_disponivel += realizado

        if mes_corte <= 0:
            # Ano futuro: tudo ainda é plano.
            planejado_restante += planejado
            plano_futuro += planejado
            continue

        if mes < mes_corte:
            realizado_meses_fechados += realizado
            realizado_ate_corte += realizado
            continue

        if mes == mes_corte:
            realizado_ate_corte += realizado
            saldo = max(planejado - realizado, 0.0)
            saldo_mes_atual += saldo
            planejado_restante += saldo
            continue

        if mes > mes_corte:
            planejado_restante += planejado
            plano_futuro += planejado

    tendencia = realizado_ate_corte + planejado_restante

    return {
        "mes_corte": float(mes_corte),
        "planejado_ano_cx": planejado_ano,
        "realizado_ano_disponivel_cx": realizado_ano_disponivel,
        "realizado_ate_corte_cx": realizado_ate_corte,
        "realizado_meses_fechados_cx": realizado_meses_fechados,
        "saldo_mes_atual_cx": saldo_mes_atual,
        "plano_futuro_cx": plano_futuro,
        "planejado_restante_ano_cx": planejado_restante,
        "tendencia_ano_cx": tendencia,
        "plano_atualizado_cx": tendencia,
    }


def _enriquecer_linhas_com_tendencia(
    por_linha: List[Dict[str, Any]],
    por_mes_linha: List[Dict[str, Any]],
    ano: int,
) -> List[Dict[str, Any]]:
    meses_por_linha = {
        item.get("linha"): item.get("meses") or []
        for item in por_mes_linha or []
    }

    saida: List[Dict[str, Any]] = []

    for row in por_linha or []:
        linha = row.get("linha")
        tendencia = _calcular_tendencia_ano_linha(meses_por_linha.get(linha, []), ano)
        orcado = _to_float(row.get("orcado_cx"))
        tendencia_cx = _to_float(tendencia.get("tendencia_ano_cx"))

        saida.append({
            **row,
            "planejado_original_ano_cx": round(_to_float(tendencia.get("planejado_ano_cx")), 1),
            "planejado_restante_ano_cx": round(_to_float(tendencia.get("planejado_restante_ano_cx")), 1),
            "realizado_ate_corte_cx": round(_to_float(tendencia.get("realizado_ate_corte_cx")), 1),
            "saldo_mes_atual_cx": round(_to_float(tendencia.get("saldo_mes_atual_cx")), 1),
            "plano_futuro_cx": round(_to_float(tendencia.get("plano_futuro_cx")), 1),
            "tendencia_ano_cx": round(tendencia_cx, 1),
            "plano_atualizado_cx": round(tendencia_cx, 1),
            "gap_tendencia_orcado_cx": round(tendencia_cx - orcado, 1) if orcado else 0.0,
            "mes_corte_tendencia": _to_int(tendencia.get("mes_corte")),
        })

    return saida


def _agregar_linhas(planejado: List[Dict[str, Any]], realizados: List[Dict[str, Any]], paradas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    saida = []

    for linha in ["L1", "L2"]:
        p = [r for r in planejado if r.get("linha") == linha]
        r = [x for x in realizados if x.get("linha") == linha]
        ps = [x for x in paradas if x.get("linha") == linha]

        planejado_cx = _somar(p, "qtd_caixas")
        realizado_cx = _somar(r, "qtd_caixas")
        horas_paradas = _somar(ps, "horas")

        # Principal ofensor da linha.
        top_linha = _top_ofensores(ps, limit=1)

        saida.append({
            "linha": linha,
            "nome": _nome_linha(linha),
            "planejado_cx": round(planejado_cx, 1),
            "realizado_cx": round(realizado_cx, 1),
            "gap_cx": round(realizado_cx - planejado_cx, 1),
            "aderencia_pct": round(_pct(realizado_cx, planejado_cx), 1),
            "horas_paradas": round(horas_paradas, 1),
            "lotes": len({x.get("lote") for x in r if x.get("lote")}),
            "principal_ofensor": top_linha[0] if top_linha else None,
        })

    return saida


def _top_ofensores(paradas: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    mapa: Dict[str, Dict[str, Any]] = {}

    for row in paradas:
        motivo = row.get("motivo") or row.get("tipo_evento") or "Sem motivo informado"
        chave = str(motivo).strip()[:140] or "Sem motivo informado"

        if chave not in mapa:
            mapa[chave] = {
                "motivo": chave,
                "horas": 0.0,
                "ocorrencias": 0,
                "linhas": set(),
            }

        mapa[chave]["horas"] += _to_float(row.get("horas"))
        mapa[chave]["ocorrencias"] += 1
        if row.get("linha"):
            mapa[chave]["linhas"].add(row.get("linha"))

    saida = []
    for row in mapa.values():
        saida.append({
            "motivo": row["motivo"],
            "horas": round(row["horas"], 1),
            "ocorrencias": row["ocorrencias"],
            "linhas": ", ".join(sorted(row["linhas"])),
        })

    saida.sort(key=lambda x: x["horas"], reverse=True)
    return saida[:limit]


def _top_ofensores_por_linha(paradas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    saida = []
    for linha in ["L1", "L2"]:
        subset = [row for row in paradas if row.get("linha") == linha]
        for item in _top_ofensores(subset, limit=5):
            saida.append({
                **item,
                "linha": linha,
                "linha_nome": _nome_linha(linha),
            })
    return saida


def _producao_por_grupo(realizados: List[Dict[str, Any]], limit: int = 12) -> List[Dict[str, Any]]:
    mapa: Dict[str, Dict[str, Any]] = {}

    for row in realizados:
        grupo = row.get("grupo") or "Sem grupo"
        if grupo not in mapa:
            mapa[grupo] = {
                "grupo": grupo,
                "realizado_cx": 0.0,
                "lotes": set(),
            }

        mapa[grupo]["realizado_cx"] += _to_float(row.get("qtd_caixas"))
        if row.get("lote"):
            mapa[grupo]["lotes"].add(row.get("lote"))

    saida = []
    for row in mapa.values():
        saida.append({
            "grupo": row["grupo"],
            "realizado_cx": round(row["realizado_cx"], 1),
            "lotes": len(row["lotes"]),
        })

    saida.sort(key=lambda x: x["realizado_cx"], reverse=True)
    return saida[:limit]


def _agregar_acompanhamento(
    realizados: List[Dict[str, Any]],
    busca: Optional[str] = None,
    mapa_mes_liberacao: Optional[Dict[str, str]] = None,
    mapa_qtd_planejada: Optional[Dict[str, float]] = None,
    mapa_data_planejada: Optional[Dict[str, str]] = None,
    planejado_mtd_por_linha: Optional[Dict[str, float]] = None,
    mapa_fabrima_sd3_liberada: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    termo = _upper(busca)
    mapa_mes_liberacao = mapa_mes_liberacao or {}
    mapa_qtd_planejada = mapa_qtd_planejada or {}
    mapa_data_planejada = mapa_data_planejada or {}
    planejado_mtd_por_linha = planejado_mtd_por_linha or {}
    mapa_fabrima_sd3_liberada = mapa_fabrima_sd3_liberada or {}
    ordem_linhas = ["L1", "L2", "FABRIMA"]
    grupos: Dict[str, Dict[Tuple[str, str, str, str], Dict[str, Any]]] = {
        "L1": {},
        "L2": {},
        "FABRIMA": {},
    }

    for row in realizados:
        linha = row.get("linha")
        if linha not in grupos:
            continue

        if termo:
            texto_busca = " ".join([
                _upper(row.get("lote")),
                _upper(row.get("op")),
                _upper(row.get("produto")),
                _upper(row.get("codigo")),
                _upper(row.get("equipamento")),
            ])
            if termo not in texto_busca:
                continue

        # Acompanhamento deve consolidar o mesmo lote/OP em TODAS as linhas:
        # Envase L1, Envase L2 e Fabrima.
        #
        # Antes a data fazia parte da chave e o mesmo lote aparecia em várias linhas,
        # repetindo a quantidade planejada. Agora, se tiver lote ou OP, a chave é
        # somente lote/OP, para somar todos os apontamentos daquele mesmo lote.
        lote_key = row.get("lote") or ""
        op_key = row.get("op") or ""

        if linha == "FABRIMA" and lote_key:
            # Na Fabrima, retrabalho pode gerar outra OP para o mesmo lote.
            # A visão correta é "o lote que passou", então consolida por lote.
            chave = (lote_key,)
        elif lote_key or op_key:
            chave = (
                lote_key,
                op_key,
            )
        else:
            # Fallback de segurança para apontamentos sem lote/OP.
            chave = (
                row.get("data") or "",
                row.get("equipamento") or "",
                row.get("codigo") or "",
                row.get("produto") or "",
            )

        if chave not in grupos[linha]:
            data_planejada = _buscar_data_planejada_lote(row, mapa_data_planejada)

            # A coluna DATA do acompanhamento deve mostrar a DATA FINAL real do
            # último apontamento do lote/OP. A data planejada fica separada.
            data_base = row.get("data") or data_planejada

            qtd_planejada_tb = (
                0.0
                if linha == "FABRIMA"
                else _buscar_qtd_planejada_lote(row, mapa_qtd_planejada)
            )

            grupos[linha][chave] = {
                "data": data_base,
                "dia": _to_int(str(data_base)[8:10]) if data_base else _to_int(row.get("dia")),
                "data_planejada": data_planejada,
                "data_real_inicio": row.get("data"),
                "data_real_fim": row.get("data"),
                "lote": row.get("lote"),
                "op": row.get("op"),
                "codigo": row.get("codigo"),
                "produto": row.get("produto"),
                "grupo": row.get("grupo"),
                "equipamentos": set(),
                "qtd_tubetes": 0.0,
                "qtd_caixas": 0.0,
                "primeiro_apontamento": row.get("data_inicial"),
                "ultimo_apontamento": row.get("data_final") or row.get("data_inicial"),
                "registros": 0,
                "mes_liberacao": _buscar_mes_liberacao(row, mapa_mes_liberacao),
                "qtd_planejada_tubetes": qtd_planejada_tb,
                "qtd_planejada_caixas": _planejado_para_caixas_linha(qtd_planejada_tb, linha),
            }

        atual = grupos[linha][chave]

        if linha != "FABRIMA":
            atual["qtd_tubetes"] += _to_float(row.get("qtd_tubetes"))
            atual["qtd_caixas"] += _to_float(row.get("qtd_caixas"))

        atual["registros"] += 1

        if row.get("data"):
            if not atual.get("data_real_inicio") or str(row.get("data")) < str(atual.get("data_real_inicio")):
                atual["data_real_inicio"] = row.get("data")
            if not atual.get("data_real_fim") or str(row.get("data")) > str(atual.get("data_real_fim")):
                atual["data_real_fim"] = row.get("data")

        # Sempre usa a maior DATA FINAL real como data exibida da linha.
        # Isso evita esconder lotes que continuam rodando no dia atual.
        if atual.get("data_real_fim"):
            atual["data"] = atual.get("data_real_fim")
            atual["dia"] = _to_int(str(atual.get("data_real_fim"))[8:10])

        if row.get("equipamento"):
            atual["equipamentos"].add(row.get("equipamento"))

        mes_liberacao = _buscar_mes_liberacao(row, mapa_mes_liberacao)
        if mes_liberacao and mes_liberacao != "—" and (not atual.get("mes_liberacao") or atual.get("mes_liberacao") == "—"):
            atual["mes_liberacao"] = mes_liberacao

        qtd_planejada_tb = (
            0.0
            if linha == "FABRIMA"
            else _buscar_qtd_planejada_lote(row, mapa_qtd_planejada)
        )
        if qtd_planejada_tb > 0 and _to_float(atual.get("qtd_planejada_tubetes")) <= 0:
            atual["qtd_planejada_tubetes"] = qtd_planejada_tb
            atual["qtd_planejada_caixas"] = _planejado_para_caixas_linha(qtd_planejada_tb, linha)

        if row.get("data_inicial") and str(row.get("data_inicial")) < str(atual.get("primeiro_apontamento") or row.get("data_inicial")):
            atual["primeiro_apontamento"] = row.get("data_inicial")

        if row.get("data_final") and str(row.get("data_final")) > str(atual.get("ultimo_apontamento") or row.get("data_final")):
            atual["ultimo_apontamento"] = row.get("data_final")

    cards = []
    secoes = []

    for linha in ordem_linhas:
        linhas = []
        for item in grupos[linha].values():
            if linha == "FABRIMA":
                lote_norm = _upper(item.get("lote"))
                liberacao = mapa_fabrima_sd3_liberada.get(lote_norm)

                # A Fabrima mostra o lote que passou pela embalagem via Cogtive,
                # mas a quantidade oficial vem da SD3/liberação.
                # Se ainda não liberou, a quantidade fica zerada no backend e o front mostra "—".
                if liberacao:
                    qtd_lib_cx = _to_float(liberacao.get("qtd_liberada_caixas"))
                    qtd_lib_tb = qtd_lib_cx * TUBETES_POR_CAIXA
                    item["qtd_tubetes"] = qtd_lib_tb
                    item["qtd_caixas"] = qtd_lib_cx
                    item["tem_liberacao_sd3"] = qtd_lib_cx > 0
                    item["data_liberacao"] = liberacao.get("data_liberacao")
                    item["armazem_liberacao"] = liberacao.get("armazens")
                    item["qtd_liberada_tubetes"] = qtd_lib_tb
                    item["qtd_liberada_caixas"] = qtd_lib_cx
                else:
                    item["qtd_tubetes"] = 0.0
                    item["qtd_caixas"] = 0.0
                    item["tem_liberacao_sd3"] = False
                    item["data_liberacao"] = None
                    item["armazem_liberacao"] = None
                    item["qtd_liberada_tubetes"] = 0.0
                    item["qtd_liberada_caixas"] = 0.0

            qtd_cx = _to_float(item.get("qtd_caixas"))
            tem_liberacao_sd3 = bool(item.get("tem_liberacao_sd3"))
            linhas.append({
                **item,
                "equipamentos": ", ".join(sorted(item["equipamentos"])),
                "qtd_tubetes": round(_to_float(item.get("qtd_tubetes")), 1),
                "qtd_caixas": round(qtd_cx, 1),
                "qtd_liberada_tubetes": round(_to_float(item.get("qtd_liberada_tubetes")), 1),
                "qtd_liberada_caixas": round(_to_float(item.get("qtd_liberada_caixas")), 1),
                "tem_liberacao_sd3": tem_liberacao_sd3,
                "qtd_planejada_tubetes": round(_to_float(item.get("qtd_planejada_tubetes")), 1),
                "qtd_planejada_caixas": round(_to_float(item.get("qtd_planejada_caixas")), 1),
                "status": (
                    "Liberado" if linha == "FABRIMA" and tem_liberacao_sd3
                    else "Aguardando liberação" if linha == "FABRIMA"
                    else "Envasado" if qtd_cx > 0
                    else "Sem quantidade"
                ),
            })

        linhas.sort(key=lambda x: (x.get("data") or "", x.get("ultimo_apontamento") or "", x.get("lote") or ""))

        ultimo_com_qtd = None
        for item in linhas:
            if linha == "FABRIMA":
                ultimo_com_qtd = item
            elif _to_float(item.get("qtd_caixas")) > 0:
                ultimo_com_qtd = item

        total_cx = sum(_to_float(item.get("qtd_caixas")) for item in linhas)
        total_tb = sum(_to_float(item.get("qtd_tubetes")) for item in linhas)

        planejado_mtd_tb = 0.0 if linha == "FABRIMA" else _to_float(planejado_mtd_por_linha.get(linha, 0))
        planejado_mtd_cx = 0.0 if linha == "FABRIMA" else _planejado_para_caixas_linha(planejado_mtd_tb, linha)
        realizado_mtd_tb = total_tb
        realizado_mtd_cx = total_cx

        cards.append({
            "linha": linha,
            "nome": _nome_linha(linha),
            "ultimo_lote": ultimo_com_qtd.get("lote") if ultimo_com_qtd else "—",
            "ultima_data": ultimo_com_qtd.get("data") if ultimo_com_qtd else None,
            "total_caixas": round(total_cx, 1),
            "total_tubetes": round(total_tb, 1),
            "lotes": len({item.get("lote") for item in linhas if item.get("lote")}),
            "planejado_mtd_tubetes": round(planejado_mtd_tb, 1),
            "planejado_mtd_caixas": round(planejado_mtd_cx, 1),
            "realizado_mtd_tubetes": round(realizado_mtd_tb, 1),
            "realizado_mtd_caixas": round(realizado_mtd_cx, 1),
            "atingimento_mtd_pct": (
                round(_pct(realizado_mtd_cx, planejado_mtd_cx), 1)
                if linha == "FABRIMA" and planejado_mtd_cx > 0
                else round(_pct(realizado_mtd_tb, planejado_mtd_tb), 1) if planejado_mtd_tb > 0 else 0.0
            ),
        })

        secoes.append({
            "linha": linha,
            "nome": _nome_linha(linha),
            "tipo": "Fabrima" if linha == "FABRIMA" else "Envase",
            "total_caixas": round(total_cx, 1),
            "total_tubetes": round(total_tb, 1),
            "lotes": len({item.get("lote") for item in linhas if item.get("lote")}),
            "planejado_mtd_tubetes": 0.0 if linha == "FABRIMA" else round(_to_float(planejado_mtd_por_linha.get(linha, 0)), 1),
            "planejado_mtd_caixas": 0.0 if linha == "FABRIMA" else round(_planejado_para_caixas_linha(_to_float(planejado_mtd_por_linha.get(linha, 0)), linha), 1),
            "realizado_mtd_tubetes": round(total_tb, 1),
            "realizado_mtd_caixas": round(total_cx, 1),
            "atingimento_mtd_pct": 0.0 if linha == "FABRIMA" else (
                round(_pct(total_tb, _to_float(planejado_mtd_por_linha.get(linha, 0))), 1)
                if _to_float(planejado_mtd_por_linha.get(linha, 0)) > 0
                else 0.0
            ),
            "linhas": linhas,
        })

    return {"cards": cards, "secoes": secoes}


def _macro_categoria_parada(row: Dict[str, Any]) -> str:
    motivo = _upper(row.get("motivo"))
    tipo = _upper(row.get("tipo_evento"))
    equipamento = _upper(row.get("equipamento"))
    texto = f"{motivo} {tipo} {equipamento}"

    if "MICROPARADA" in texto or "MICRO PARADA" in texto:
        return "Microparadas / instabilidade"

    if "SETUP" in texto or "SET UP" in texto or "TROCA DE LOTE" in texto or "TROCA LOTE" in texto or "LOTE CURTO" in texto:
        return "Setup e troca de lote"

    if "LIMPEZA" in texto or "ORGANIZA" in texto or "TROCA DE TURNO" in texto or "TURNO" in texto:
        return "Limpeza / organização"

    if "MANUT" in texto or "QUEBRA" in texto or "CABEÇOTE" in texto or "CABECOTE" in texto or "FECHAMENTO" in texto or "SENSOR" in texto or "FALHA" in texto:
        return "Manutenção e falha de equipamento"

    if "AJUSTE" in texto or "QUALIDADE" in texto or "INSPE" in texto or "REJEI" in texto or "PARAMENT" in texto or "REGUL" in texto:
        return "Qualidade / ajuste técnico"

    if "FALTA" in texto or "AGUARD" in texto or "ESPER" in texto or "LIBERA" in texto or "MATERIAL" in texto or "OPERADOR" in texto:
        return "Falta ou espera de recurso"

    if "REUNI" in texto or "TREIN" in texto or "PARADA PROGRAMADA" in texto or "PROGRAMADA" in texto or "DDS" in texto:
        return "Programadas / administrativas"

    return "Não classificado"


def _maquina_operacional_parada(row: Dict[str, Any]) -> str:
    equipamento = _upper(row.get("equipamento"))
    linha = _upper(row.get("linha"))

    if "MAQ 1" in equipamento or "MAQ1" in equipamento or "MÁQ 1" in equipamento or "MÁQ1" in equipamento or "ENVASADORA 1" in equipamento:
        return "MÁQ 1 ENVASADORA"

    if "MAQ 2" in equipamento or "MAQ2" in equipamento or "MÁQ 2" in equipamento or "MÁQ2" in equipamento or "ENVASADORA 2" in equipamento:
        return "MÁQ 2 ENVASADORA"

    if linha == "L2" or "L2" in equipamento or "ENVASADORA 3" in equipamento:
        return "L2 - ENVASADORA"

    if linha == "L1":
        return "Linha 1 - não detalhado"

    return _normalizar_texto(row.get("equipamento")) or "Sem equipamento"


def _faixa_duracao_parada(horas: float) -> str:
    minutos = _to_float(horas) * 60.0

    if minutos <= 2:
        return "0–2 min"
    if minutos <= 5:
        return "2–5 min"
    if minutos <= 15:
        return "5–15 min"
    if minutos <= 60:
        return "15–60 min"
    return ">60 min"


def _ordem_faixa_duracao(faixa: str) -> int:
    ordem = {
        "0–2 min": 1,
        "2–5 min": 2,
        "5–15 min": 3,
        "15–60 min": 4,
        ">60 min": 5,
    }
    return ordem.get(faixa, 99)


def _percentil(valores: List[float], p: float) -> float:
    if not valores:
        return 0.0

    ordenados = sorted(valores)
    if len(ordenados) == 1:
        return ordenados[0]

    pos = (len(ordenados) - 1) * p
    baixo = int(pos)
    alto = min(baixo + 1, len(ordenados) - 1)
    frac = pos - baixo

    return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * frac


def _taxa_caixas_hora(row: Dict[str, Any]) -> float:
    """
    Taxa aproximada para converter hora parada em caixa potencial perdida.

    Regra inicial:
      - L1 tem duas envasadoras: por máquina, usar ~13,5 cx/h;
      - L1 sem máquina detalhada: usar linha cheia ~27 cx/h;
      - L2: uma envasadora, usar ~24 cx/h.

    Isso é estimativa gerencial para priorização, não medição contábil/OEE oficial.
    """
    linha = _upper(row.get("linha"))
    maquina = _maquina_operacional_parada(row)

    if linha == "L2":
        return 24.0

    if linha == "L1" and maquina in {"MÁQ 1 ENVASADORA", "MÁQ 2 ENVASADORA"}:
        return 13.5

    if linha == "L1":
        return 27.0

    return 0.0


def _gap_ytd_por_linha(ano: int, mes_final: int) -> Dict[str, float]:
    planejado, _programacoes = _carregar_planejado_envase_periodo(ano, 12)
    realizados = _registros_envase_periodo(ano, mes_final)

    planejado_ytd: Dict[str, float] = defaultdict(float)
    realizado_ytd: Dict[str, float] = defaultdict(float)

    for row in planejado:
        mes = _to_int(row.get("mes"))
        linha = row.get("linha")
        if linha in {"L1", "L2"} and 1 <= mes <= int(mes_final):
            planejado_ytd[linha] += _to_float(row.get("qtd_caixas"))

    for row in realizados:
        linha = row.get("linha")
        if linha in {"L1", "L2"}:
            realizado_ytd[linha] += _to_float(row.get("qtd_caixas"))

    return {
        "L1": max(0.0, planejado_ytd["L1"] - realizado_ytd["L1"]),
        "L2": max(0.0, planejado_ytd["L2"] - realizado_ytd["L2"]),
    }


def _agregar_perdas(
    paradas: List[Dict[str, Any]],
    gap_por_linha: Dict[str, float],
) -> Dict[str, Any]:
    enriched: List[Dict[str, Any]] = []

    for row in paradas:
        horas = max(0.0, _to_float(row.get("horas")))
        if horas <= 0:
            continue

        linha = row.get("linha") or "Sem linha"
        macro = _macro_categoria_parada(row)
        maquina = _maquina_operacional_parada(row)
        faixa = _faixa_duracao_parada(horas)
        taxa = _taxa_caixas_hora(row)
        caixas_potenciais = horas * taxa
        gap_linha = _to_float(gap_por_linha.get(linha, 0))
        pct_gap = _pct(caixas_potenciais, gap_linha) if gap_linha > 0 else 0

        enriched.append({
            **row,
            "macro_categoria": macro,
            "maquina": maquina,
            "faixa_duracao": faixa,
            "duracao_min": horas * 60,
            "caixas_potenciais": caixas_potenciais,
            "pct_gap_explicado": pct_gap,
        })

    horas_total = _somar(enriched, "horas")
    ocorrencias_total = len(enriched)
    dias_total = len({row.get("data") for row in enriched if row.get("data")})
    caixas_potenciais_total = _somar(enriched, "caixas_potenciais")
    gap_total = _to_float(gap_por_linha.get("L1", 0)) + _to_float(gap_por_linha.get("L2", 0))

    def agrupar(chaves: List[str]) -> List[Dict[str, Any]]:
        grupos: Dict[Tuple[Any, ...], Dict[str, Any]] = {}

        for row in enriched:
            chave = tuple(row.get(c) for c in chaves)

            if chave not in grupos:
                item = {campo: row.get(campo) for campo in chaves}
                item.update({
                    "horas": 0.0,
                    "ocorrencias": 0,
                    "dias_set": set(),
                    "duracoes_min": [],
                    "caixas_potenciais": 0.0,
                    "gap_referencia": 0.0,
                })
                grupos[chave] = item

            atual = grupos[chave]
            atual["horas"] += _to_float(row.get("horas"))
            atual["ocorrencias"] += 1
            atual["caixas_potenciais"] += _to_float(row.get("caixas_potenciais"))
            atual["duracoes_min"].append(_to_float(row.get("duracao_min")))
            if row.get("data"):
                atual["dias_set"].add(row.get("data"))

            linha = row.get("linha")
            atual["gap_referencia"] += _to_float(gap_por_linha.get(linha, 0))

        saida = []

        for item in grupos.values():
            duracoes = item.pop("duracoes_min")
            dias_set = item.pop("dias_set")
            dias = len(dias_set)
            horas = _to_float(item.get("horas"))
            ocorrencias = _to_int(item.get("ocorrencias"))
            caixas_potenciais = _to_float(item.get("caixas_potenciais"))

            # Para % gap, usar gap total quando grupo mistura linhas; por linha, usa gap da linha.
            linha_item = item.get("linha")
            if linha_item in {"L1", "L2"}:
                gap_ref = _to_float(gap_por_linha.get(linha_item, 0))
            else:
                gap_ref = gap_total

            saida.append({
                **item,
                "horas": round(horas, 1),
                "ocorrencias": ocorrencias,
                "dias": dias,
                "media_min": round((sum(duracoes) / len(duracoes)) if duracoes else 0, 1),
                "mediana_min": round(_percentil(duracoes, 0.5), 1),
                "p90_min": round(_percentil(duracoes, 0.9), 1),
                "min_por_dia": round((horas * 60 / dias) if dias else 0, 1),
                "caixas_potenciais": round(caixas_potenciais, 1),
                "pct_gap_explicado": round(_pct(caixas_potenciais, gap_ref), 1) if gap_ref > 0 else 0.0,
            })

        saida.sort(key=lambda x: _to_float(x.get("horas")), reverse=True)
        return saida

    pareto_macro = agrupar(["macro_categoria"])
    pareto_maquina = agrupar(["linha", "maquina"])
    tabela_causas = agrupar(["macro_categoria", "motivo", "linha", "maquina", "equipamento"])

    # Distribuição de duração por macro.
    mapa_dist: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in enriched:
        chave = (row.get("macro_categoria"), row.get("faixa_duracao"))
        if chave not in mapa_dist:
            mapa_dist[chave] = {
                "macro_categoria": row.get("macro_categoria"),
                "faixa_duracao": row.get("faixa_duracao"),
                "horas": 0.0,
                "ocorrencias": 0,
            }
        mapa_dist[chave]["horas"] += _to_float(row.get("horas"))
        mapa_dist[chave]["ocorrencias"] += 1

    distribuicao_duracao = [
        {
            **item,
            "horas": round(_to_float(item.get("horas")), 1),
            "ocorrencias": _to_int(item.get("ocorrencias")),
        }
        for item in mapa_dist.values()
    ]
    distribuicao_duracao.sort(key=lambda x: (str(x.get("macro_categoria")), _ordem_faixa_duracao(str(x.get("faixa_duracao")))))

    return {
        "cards": {
            "horas_paradas": round(horas_total, 1),
            "ocorrencias": ocorrencias_total,
            "dias_com_parada": dias_total,
            "media_min": round((horas_total * 60 / ocorrencias_total) if ocorrencias_total else 0, 1),
            "caixas_potenciais": round(caixas_potenciais_total, 1),
            "gap_ytd": round(gap_total, 1),
            "pct_gap_explicado": round(_pct(caixas_potenciais_total, gap_total), 1) if gap_total > 0 else 0.0,
        },
        "pareto_macro": pareto_macro[:12],
        "pareto_maquina": pareto_maquina[:12],
        "distribuicao_duracao": distribuicao_duracao,
        "tabela_causas": tabela_causas[:80],
    }


# ─────────────────────────────────────────────────────────────
# Excelência operacional — análise de paradas por equipamento
# ─────────────────────────────────────────────────────────────

VERSAO_EXCELENCIA_OPERACIONAL = "v126_sem_barra_v1"


def _query_apontamentos_operacionais_por_data(inicio_iso: str, fim_iso: str) -> List[Dict[str, Any]]:
    """
    Busca apontamentos de todos os equipamentos físicos operacionais no período.

    Diferente da rotina antiga de perdas, esta análise não pode buscar só ENVASADORA,
    porque a visão de excelência operacional também precisa enxergar:
      - lavadoras;
      - Bausch / rotuladora;
      - Fabrima / embaladora.

    A filtragem de equipamento físico acontece depois, em _classificar_equipamento_excelencia.
    """
    inicio_dt = _parse_datetime(inicio_iso)
    fim_dt = _parse_datetime(fim_iso)
    inicio_query = inicio_dt.isoformat() if inicio_dt else inicio_iso
    fim_query = fim_dt.isoformat() if fim_dt else fim_iso

    def _filtrar_periodo_python(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        saida: List[Dict[str, Any]] = []
        for row in rows or []:
            dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
            if not dt:
                continue
            if inicio_dt and dt < inicio_dt:
                continue
            if fim_dt and dt >= fim_dt:
                continue
            saida.append(row)
        return saida

    # Fonte principal: schema atual + filtro de data no banco.
    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT)
            .gte("data_final", inicio_query)
            .lt("data_final", fim_query),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception:
        pass

    # Fallback legado.
    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select(APONTAMENTOS_SELECT_LEGADO),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception:
        pass

    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select("*"),
            page_size=1000,
        )
        return _filtrar_periodo_python(rows)
    except Exception:
        return []


def _classificar_equipamento_excelencia(equipamento: Any) -> Dict[str, Any]:
    """
    Mapa operacional validado para a visão principal.

    Regra:
      - entram apenas equipamentos físicos;
      - apontamentos administrativos/apoio ficam fora da visão principal;
      - linha de fabricação de envase:
          L1 = MÁQ 1 + MÁQ 2 ENVASADORA
          L2 = L2 - ENVASADORA
      - embalagem:
          Bausch = rotuladora
          Fabrima = embaladora
    """
    original = _normalizar_texto(equipamento)
    texto = _upper(original)

    if not texto:
        return {
            "incluir": False,
            "motivo_exclusao": "sem_equipamento",
            "equipamento_original": original,
        }

    if (
        "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQUINA 1" in texto
        or "MÁQ 1" in original.upper()
    ) and "ENVAS" in texto:
        return {
            "incluir": True,
            "area": "Envase",
            "linha": "L1",
            "linha_nome": "Linha 1",
            "equipamento": "MÁQ 1 ENVASADORA",
            "tipo_equipamento": "Envasadora",
            "etapa": "Envase",
            "ordem": 10,
            "equipamento_original": original,
        }

    if (
        "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQUINA 2" in texto
        or "MÁQ 2" in original.upper()
    ) and "ENVAS" in texto:
        return {
            "incluir": True,
            "area": "Envase",
            "linha": "L1",
            "linha_nome": "Linha 1",
            "equipamento": "MÁQ 2 ENVASADORA",
            "tipo_equipamento": "Envasadora",
            "etapa": "Envase",
            "ordem": 20,
            "equipamento_original": original,
        }

    if "L2" in texto and "ENVAS" in texto:
        return {
            "incluir": True,
            "area": "Envase",
            "linha": "L2",
            "linha_nome": "Linha 2",
            "equipamento": "L2 - ENVASADORA",
            "tipo_equipamento": "Envasadora",
            "etapa": "Envase",
            "ordem": 30,
            "equipamento_original": original,
        }

    if "L1" in texto and "LAV" in texto:
        return {
            "incluir": True,
            "area": "Lavagem",
            "linha": "L1",
            "linha_nome": "Linha 1",
            "equipamento": "L1 LAVADORA",
            "tipo_equipamento": "Lavadora",
            "etapa": "Lavagem",
            "ordem": 40,
            "equipamento_original": original,
        }

    if "L2" in texto and "LAV" in texto:
        return {
            "incluir": True,
            "area": "Lavagem",
            "linha": "L2",
            "linha_nome": "Linha 2",
            "equipamento": "L2 LAVADORA",
            "tipo_equipamento": "Lavadora",
            "etapa": "Lavagem",
            "ordem": 50,
            "equipamento_original": original,
        }

    if "BAUSCH" in texto:
        return {
            "incluir": True,
            "area": "Embalagem",
            "linha": "EMBALAGEM",
            "linha_nome": "Embalagem",
            "equipamento": "BAUSCH",
            "tipo_equipamento": "Rotuladora",
            "etapa": "Rotulagem",
            "ordem": 60,
            "equipamento_original": original,
        }

    if "FABRIMA" in texto:
        return {
            "incluir": True,
            "area": "Embalagem",
            "linha": "EMBALAGEM",
            "linha_nome": "Embalagem",
            "equipamento": "FABRIMA",
            "tipo_equipamento": "Embaladora",
            "etapa": "Embalagem",
            "ordem": 70,
            "equipamento_original": original,
        }

    return {
        "incluir": False,
        "motivo_exclusao": "administrativo_apoio_ou_nao_operacional",
        "equipamento_original": original,
    }


def _classificar_evento_excelencia(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classifica a natureza do apontamento para não misturar programadas com perda real.

    naturezas:
      - producao
      - programada
      - nao_programada
      - sem_programacao

    A matriz de criticidade deve usar apenas nao_programada.
    """
    tipo = _upper(row.get("tipo_evento"))
    evento = _upper(row.get("evento"))
    texto = f"{tipo} {evento}"

    if "PRODUCAO" in tipo and "FIM" not in evento:
        return {
            "natureza": "producao",
            "natureza_label": "Produção",
            "macro_causa": "Produção",
            "criticidade_aplicavel": False,
        }

    if "HORAS DESPROGRAMADAS" in texto or "FERIAS COLETIVAS" in texto:
        return {
            "natureza": "sem_programacao",
            "natureza_label": "Sem programação / calendário",
            "macro_causa": "Sem programação / calendário",
            "criticidade_aplicavel": False,
        }

    if (
        "SETUP" in tipo
        or "SET UP" in texto
        or "TROCA DE LOTE" in texto
        or "TROCA LOTE" in texto
    ):
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Setup / troca de lote",
            "criticidade_aplicavel": False,
        }

    if (
        "FIM DE LOTE" in tipo
        or "FIM DE PRODUCAO" in texto
        or "FIM DO CICLO" in texto
        or "FINAL DE LOTE" in texto
    ):
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Fim de lote / ciclo",
            "criticidade_aplicavel": False,
        }

    if (
        "MEDIA FILL" in texto
        or "VALIDACAO" in texto
        or "CERTIFICACAO" in texto
        or "AQUAFILL" in texto
        or "PREPARACAO DA AREA" in texto
    ):
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Validação / qualificação",
            "criticidade_aplicavel": False,
        }

    if "MANUTENCAO PREVENTIVA" in texto:
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Manutenção preventiva",
            "criticidade_aplicavel": False,
        }

    if (
        "LIMPEZA DE TROCA DE TURNO" in texto
        or "TROCA DE TURNO" in texto
        or "PARAMENTACAO" in texto
        or "HIGIENE" in texto
        or "REFEICAO" in texto
    ):
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Limpeza / troca de turno",
            "criticidade_aplicavel": False,
        }

    if "REUNIAO" in texto or "TREINAMENTO" in texto or "DDS" in texto:
        return {
            "natureza": "programada",
            "natureza_label": "Parada programada",
            "macro_causa": "Atividade planejada",
            "criticidade_aplicavel": False,
        }

    # Não programadas — matriz e ranking de perdas reais.
    if "MICROPARADA" in texto or "MICRO PARADA" in texto:
        macro = "Microparadas"
    elif (
        "FALTA" in texto
        or "AGUARD" in texto
        or "ESPER" in texto
        or "ORDEM DE PRODUCAO" in texto
        or "MATERIAL" in texto
        or "OPERADOR" in texto
        or "INSUMO" in texto
        or "TUBETE ROTULADO" in texto
        or "UTILIDADE" in texto
    ):
        macro = "Falta / espera"
    elif (
        "MANUT" in texto
        or "FALHA" in texto
        or "QUEBRA" in texto
        or "CABEÇOTE" in texto
        or "CABECOTE" in texto
        or "SENSOR" in texto
        or "DRIVE" in texto
        or "VACUO" in texto
        or "AUTOCLAVE" in texto
        or "HVAC" in texto
        or "AR COMPRIMIDO" in texto
        or "AGUA" in texto
    ):
        macro = "Manutenção / ajuste máquina"
    elif (
        "QUALIDADE" in texto
        or "REJEI" in texto
        or "REVISAO" in texto
        or "TOLERANCIA" in texto
        or "VOLUME" in texto
        or "BOLHA" in texto
    ):
        macro = "Qualidade / perdas produto"
    elif (
        "ROTUL" in texto
        or "RIBBON" in texto
        or "BOBINA" in texto
        or "PVC" in texto
        or "BERCO" in texto
        or "EMBAL" in texto
    ):
        macro = "Embalagem / materiais"
    else:
        macro = "Operacional / outros"

    return {
        "natureza": "nao_programada",
        "natureza_label": "Parada não programada",
        "macro_causa": macro,
        "criticidade_aplicavel": True,
    }



def _horas_apontamento_excelencia(
    row: Dict[str, Any],
    inicio: Optional[datetime] = None,
    fim: Optional[datetime] = None,
) -> float:
    """
    Duração operacional da análise de excelência.

    Correção v100:
    - o upload antigo salvou duracao_h multiplicado por 24 em alguns arquivos;
    - para esta análise, a fonte mais segura é DATA FINAL - DATA INICIAL;
    - se alguma linha não tiver data final válida, cai para duracao_h;
    - se duracao_h vier inflado e não houver data final, aplica fallback /24.
    """
    inicio = inicio or _data_inicio_apontamento(row) or _data_referencia_apontamento(row)
    fim = fim or _data_final_apontamento(row)

    if inicio and fim and fim > inicio:
        horas = (fim - inicio).total_seconds() / 3600.0
        if horas >= 0:
            return horas

    n = _to_float(_get(row, "duracao_h", "duracao", "DURAÇÃO", default=0))
    if n <= 0:
        return 0.0

    # Fallback de segurança para dados já gravados inflados por x24.
    # Ex.: 404 h em um único apontamento/dia geralmente representa 16,8 h * 24.
    if n > 48:
        n_div = n / 24.0
        if 0 < n_div <= 48:
            return n_div

    return n


def _split_registro_excelencia_por_dia(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Divide apontamentos longos por dia para a barra diária.

    Exemplo:
      Férias coletivas 01/06 00:00 até 08/06 06:00
      vira vários pontos diários, em vez de jogar 174h no dia 01/06.

    Isso deixa a visão diária coerente por equipamento.
    """
    inicio = _parse_datetime(row.get("data_inicial"))
    fim = _parse_datetime(row.get("data_final"))

    horas_total = _to_float(row.get("horas"))

    if not inicio or not fim or fim <= inicio or horas_total <= 0:
        return [row]

    partes: List[Dict[str, Any]] = []
    atual = inicio

    while atual < fim:
        proximo_dia = datetime.combine((atual.date() + timedelta(days=1)), datetime.min.time())
        fim_slice = min(fim, proximo_dia)
        horas_slice = max(0.0, (fim_slice - atual).total_seconds() / 3600.0)

        if horas_slice > 0:
            item = dict(row)
            item["data"] = atual.date().isoformat()
            item["ano"] = atual.year
            item["mes"] = atual.month
            item["dia"] = atual.day
            item["horas"] = horas_slice
            item["minutos"] = horas_slice * 60.0
            partes.append(item)

        atual = fim_slice

    return partes or [row]


def _faixa_criticidade_excelencia(ocorrencias_por_dia: float, media_min: float, max_freq: float, max_media: float) -> str:
    alta_freq = ocorrencias_por_dia >= max_freq * 0.45 if max_freq > 0 else False
    alta_duracao = media_min >= max_media * 0.45 if max_media > 0 else False

    if alta_freq and alta_duracao:
        return "crítico estrutural"
    if alta_freq:
        return "crônico / repetitivo"
    if alta_duracao:
        return "pontual grave"
    return "monitorar"


def _agregar_excelencia_operacional(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    registros: List[Dict[str, Any]] = []
    excluidos = defaultdict(int)

    for row in rows or []:
        equip_info = _classificar_equipamento_excelencia(row.get("equipamento"))
        if not equip_info.get("incluir"):
            excluidos[equip_info.get("motivo_exclusao") or "excluido"] += 1
            continue

        dt = _data_referencia_apontamento(row) or _data_inicio_apontamento(row)
        inicio = _data_inicio_apontamento(row) or dt
        fim = _data_final_apontamento(row)

        if not dt:
            excluidos["sem_data"] += 1
            continue

        situacao = _upper(row.get("situacao"))
        if situacao and situacao != "APONTAMENTO NORMAL":
            excluidos["situacao_nao_normal"] += 1
            continue

        horas = _horas_apontamento_excelencia(row, inicio=inicio, fim=fim)
        if horas < 0:
            horas = 0.0

        evento_info = _classificar_evento_excelencia(row)

        registros.append({
            "data": dt.date().isoformat(),
            "ano": dt.year,
            "mes": dt.month,
            "dia": dt.day,
            "data_inicial": inicio.isoformat() if inicio else None,
            "data_final": fim.isoformat() if fim else None,
            "area": equip_info.get("area"),
            "linha": equip_info.get("linha"),
            "linha_nome": equip_info.get("linha_nome"),
            "equipamento": equip_info.get("equipamento"),
            "equipamento_original": equip_info.get("equipamento_original"),
            "tipo_equipamento": equip_info.get("tipo_equipamento"),
            "etapa": equip_info.get("etapa"),
            "ordem_equipamento": equip_info.get("ordem"),
            "tipo_evento": _normalizar_texto(row.get("tipo_evento")),
            "evento": _normalizar_texto(row.get("evento")),
            "natureza": evento_info.get("natureza"),
            "natureza_label": evento_info.get("natureza_label"),
            "macro_causa": evento_info.get("macro_causa"),
            "criticidade_aplicavel": bool(evento_info.get("criticidade_aplicavel")),
            "horas": horas,
            "minutos": horas * 60.0,
            "situacao": _normalizar_texto(row.get("situacao")),
            "ordem": row.get("ordem"),
            "lote": row.get("lote"),
            "produto": row.get("produto"),
            "sku": row.get("sku"),
        })

    def _novo_bucket_base(extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        base = {
            "horas_producao": 0.0,
            "horas_programadas": 0.0,
            "horas_setup_real": 0.0,
            "horas_troca_turno_real": 0.0,
            "horas_programadas_detalhe_map": {},
            "horas_nao_programadas": 0.0,
            "horas_sem_programacao": 0.0,
            "horas_total": 0.0,
            "ocorrencias_total": 0,
            "ocorrencias_nao_programadas": 0,
            "dias_set": set(),
        }
        if extra:
            base.update(extra)
        return base

    def _acumular(bucket: Dict[str, Any], row: Dict[str, Any]):
        horas = _to_float(row.get("horas"))
        natureza = row.get("natureza")
        bucket["horas_total"] += horas
        bucket["ocorrencias_total"] += 1
        if row.get("data"):
            bucket["dias_set"].add(row.get("data"))

        if natureza == "producao":
            bucket["horas_producao"] += horas
        elif natureza == "programada":
            bucket["horas_programadas"] += horas
            macro = _upper(row.get("macro_causa"))
            if "SETUP" in macro or "TROCA DE LOTE" in macro:
                bucket["horas_setup_real"] += horas
            if "TROCA DE TURNO" in macro or "LIMPEZA" in macro or "PARAMENTACAO" in macro:
                bucket["horas_troca_turno_real"] += horas

            detalhe_map = bucket.setdefault("horas_programadas_detalhe_map", {})
            macro_label = row.get("macro_causa") or "Programada"
            evento_label = row.get("evento") or macro_label
            detalhe_key = f"{macro_label}||{evento_label}"
            detalhe = detalhe_map.setdefault(detalhe_key, {
                "macro_causa": macro_label,
                "evento": evento_label,
                "horas": 0.0,
                "ocorrencias": 0,
            })
            detalhe["horas"] += horas
            detalhe["ocorrencias"] += 1
        elif natureza == "nao_programada":
            bucket["horas_nao_programadas"] += horas
            bucket["ocorrencias_nao_programadas"] += 1
        elif natureza == "sem_programacao":
            bucket["horas_sem_programacao"] += horas

    def _fechar_bucket(bucket: Dict[str, Any]) -> Dict[str, Any]:
        dias = len(bucket.pop("dias_set", set()))
        horas_total = _to_float(bucket.get("horas_total"))
        horas_prod = _to_float(bucket.get("horas_producao"))
        horas_nao_prog = _to_float(bucket.get("horas_nao_programadas"))
        detalhe_map = bucket.pop("horas_programadas_detalhe_map", {}) or {}
        detalhes_programadas = sorted(
            [
                {
                    "macro_causa": item.get("macro_causa"),
                    "evento": item.get("evento"),
                    "horas": round(_to_float(item.get("horas")), 2),
                    "ocorrencias": int(item.get("ocorrencias") or 0),
                }
                for item in detalhe_map.values()
                if _to_float(item.get("horas")) > 0
            ],
            key=lambda x: _to_float(x.get("horas")),
            reverse=True,
        )[:8]

        bucket.update({
            "horas_producao": round(_to_float(bucket.get("horas_producao")), 2),
            "horas_programadas": round(_to_float(bucket.get("horas_programadas")), 2),
            "horas_setup_real": round(_to_float(bucket.get("horas_setup_real")), 2),
            "horas_troca_turno_real": round(_to_float(bucket.get("horas_troca_turno_real")), 2),
            "programadas_detalhe": detalhes_programadas,
            "horas_nao_programadas": round(_to_float(bucket.get("horas_nao_programadas")), 2),
            "horas_sem_programacao": round(_to_float(bucket.get("horas_sem_programacao")), 2),
            "horas_total": round(horas_total, 2),
            "dias": dias,
            "pct_produtivo_sobre_apontado": round(_pct(horas_prod, horas_total), 1) if horas_total > 0 else 0.0,
            "pct_nao_programada_sobre_apontado": round(_pct(horas_nao_prog, horas_total), 1) if horas_total > 0 else 0.0,
        })
        return bucket

    cards = _novo_bucket_base()
    por_equipamento: Dict[str, Dict[str, Any]] = {}
    por_area: Dict[str, Dict[str, Any]] = {}
    por_dia_equipamento: Dict[Tuple[str, str], Dict[str, Any]] = {}
    por_macro_nao_prog: Dict[str, Dict[str, Any]] = {}
    por_causa_nao_prog: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for row in registros:
        _acumular(cards, row)

        equip_key = row.get("equipamento") or "Sem equipamento"
        if equip_key not in por_equipamento:
            por_equipamento[equip_key] = _novo_bucket_base({
                "equipamento": equip_key,
                "area": row.get("area"),
                "linha": row.get("linha"),
                "linha_nome": row.get("linha_nome"),
                "tipo_equipamento": row.get("tipo_equipamento"),
                "etapa": row.get("etapa"),
                "ordem_equipamento": row.get("ordem_equipamento"),
            })
        _acumular(por_equipamento[equip_key], row)

        area_key = row.get("area") or "Sem área"
        if area_key not in por_area:
            por_area[area_key] = _novo_bucket_base({"area": area_key})
        _acumular(por_area[area_key], row)

        # Para a barra diária, eventos que atravessam mais de um dia são rateados
        # pelo tempo real dentro de cada dia.
        for row_dia in _split_registro_excelencia_por_dia(row):
            dia_key = (row_dia.get("data"), equip_key)
            if dia_key not in por_dia_equipamento:
                por_dia_equipamento[dia_key] = _novo_bucket_base({
                    "data": row_dia.get("data"),
                    "dia": row_dia.get("dia"),
                    "equipamento": equip_key,
                    "area": row_dia.get("area"),
                    "linha": row_dia.get("linha"),
                    "linha_nome": row_dia.get("linha_nome"),
                    "tipo_equipamento": row_dia.get("tipo_equipamento"),
                    "ordem_equipamento": row_dia.get("ordem_equipamento"),
                })
            _acumular(por_dia_equipamento[dia_key], row_dia)

        if row.get("natureza") == "nao_programada":
            macro_key = row.get("macro_causa") or "Não classificado"
            if macro_key not in por_macro_nao_prog:
                por_macro_nao_prog[macro_key] = {
                    "macro_causa": macro_key,
                    "horas": 0.0,
                    "ocorrencias": 0,
                    "dias_set": set(),
                    "duracoes_min": [],
                }
            macro = por_macro_nao_prog[macro_key]
            macro["horas"] += _to_float(row.get("horas"))
            macro["ocorrencias"] += 1
            macro["duracoes_min"].append(_to_float(row.get("minutos")))
            if row.get("data"):
                macro["dias_set"].add(row.get("data"))

            causa_key = (macro_key, row.get("evento") or "Sem evento", equip_key)
            if causa_key not in por_causa_nao_prog:
                por_causa_nao_prog[causa_key] = {
                    "macro_causa": macro_key,
                    "evento": row.get("evento") or "Sem evento",
                    "equipamento": equip_key,
                    "area": row.get("area"),
                    "linha": row.get("linha"),
                    "horas": 0.0,
                    "ocorrencias": 0,
                    "dias_set": set(),
                    "duracoes_min": [],
                }
            causa = por_causa_nao_prog[causa_key]
            causa["horas"] += _to_float(row.get("horas"))
            causa["ocorrencias"] += 1
            causa["duracoes_min"].append(_to_float(row.get("minutos")))
            if row.get("data"):
                causa["dias_set"].add(row.get("data"))

    cards_final = _fechar_bucket(cards)

    ranking_equipamentos = [_fechar_bucket(v) for v in por_equipamento.values()]
    ranking_equipamentos.sort(key=lambda x: (_to_float(x.get("horas_nao_programadas")), _to_float(x.get("horas_total"))), reverse=True)

    resumo_area = [_fechar_bucket(v) for v in por_area.values()]
    resumo_area.sort(key=lambda x: _to_float(x.get("horas_nao_programadas")), reverse=True)

    diario_equipamento = [_fechar_bucket(v) for v in por_dia_equipamento.values()]
    diario_equipamento.sort(key=lambda x: (str(x.get("data")), _to_int(x.get("ordem_equipamento"))))

    def _fechar_agrupamento_nao_prog(item: Dict[str, Any]) -> Dict[str, Any]:
        duracoes = item.pop("duracoes_min", [])
        dias_set = item.pop("dias_set", set())
        dias = len(dias_set)
        horas = _to_float(item.get("horas"))
        ocorrencias = _to_int(item.get("ocorrencias"))
        media_min = (sum(duracoes) / len(duracoes)) if duracoes else 0.0
        ocorr_dia = ocorrencias / max(1, dias)
        return {
            **item,
            "horas": round(horas, 2),
            "ocorrencias": ocorrencias,
            "dias": dias,
            "ocorrencias_por_dia": round(ocorr_dia, 2),
            "media_min": round(media_min, 1),
            "mediana_min": round(_percentil(duracoes, 0.5), 1) if duracoes else 0.0,
            "p90_min": round(_percentil(duracoes, 0.9), 1) if duracoes else 0.0,
        }

    matriz = [_fechar_agrupamento_nao_prog(v) for v in por_macro_nao_prog.values()]
    max_freq = max([_to_float(x.get("ocorrencias_por_dia")) for x in matriz] or [0])
    max_media = max([_to_float(x.get("media_min")) for x in matriz] or [0])
    for item in matriz:
        item["quadrante"] = _faixa_criticidade_excelencia(
            _to_float(item.get("ocorrencias_por_dia")),
            _to_float(item.get("media_min")),
            max_freq,
            max_media,
        )
    matriz.sort(key=lambda x: _to_float(x.get("horas")), reverse=True)

    pareto_causas = [_fechar_agrupamento_nao_prog(v) for v in por_causa_nao_prog.values()]
    pareto_causas.sort(key=lambda x: _to_float(x.get("horas")), reverse=True)

    top_equipamento = ranking_equipamentos[0] if ranking_equipamentos else None
    top_causa = matriz[0] if matriz else None
    cards_final.update({
        "top_equipamento_perda": top_equipamento.get("equipamento") if top_equipamento else None,
        "top_equipamento_horas_nao_programadas": top_equipamento.get("horas_nao_programadas") if top_equipamento else 0.0,
        "top_causa_perda": top_causa.get("macro_causa") if top_causa else None,
        "top_causa_horas": top_causa.get("horas") if top_causa else 0.0,
    })

    return {
        "versao": VERSAO_EXCELENCIA_OPERACIONAL,
        "cards": cards_final,
        "resumo_area": resumo_area,
        "ranking_equipamentos": ranking_equipamentos,
        "matriz_nao_programadas": matriz,
        "pareto_causas_nao_programadas": pareto_causas[:120],
        "diario_equipamento": diario_equipamento,
        "debug": {
            "registros_operacionais": len(registros),
            "registros_excluidos": dict(excluidos),
            "criterio": "Somente equipamentos físicos; duração calculada por DATA FINAL - DATA INICIAL; situação não normal excluída; matriz usa apenas paradas não programadas.",
        },
    }




# ─────────────────────────────────────────────────────────────
# Rotas
# ─────────────────────────────────────────────────────────────

@router.get("/debug-versao")
def debug_versao_producao():
    return {
        "router": "producao",
        "versao": "producao_v126_sem_barra_v1",
        "arquivo": "app/routers/producao.py",
        "status": "router de produção corrigido: realizado por DATA FINAL e tendência anual/plano atualizado no dashboard.",
    }


@router.get("/debug-apontamentos-envase")
def debug_apontamentos_envase(
    ano: int | None = Query(default=None),
):
    try:
        ano = ano or date.today().year
        inicio = datetime(int(ano), 1, 1)
        fim = datetime(int(ano) + 1, 1, 1)
        rows = _query_apontamentos_por_data(inicio.date().isoformat(), fim.date().isoformat())

        por_mes = defaultdict(int)
        por_equip = defaultdict(int)
        exemplos = []

        for row in rows:
            dt = _data_referencia_apontamento(row)
            if dt and dt.year == int(ano):
                por_mes[dt.month] += 1
            equip = _equipamento_apontamento(row) or "Sem equipamento"
            por_equip[equip] += 1
            if len(exemplos) < 5:
                exemplos.append(row)

        return {
            "ano": ano,
            "linhas_lidas": len(rows),
            "por_mes": {str(k): v for k, v in sorted(por_mes.items())},
            "top_equipamentos": [
                {"equipamento": k, "registros": v}
                for k, v in sorted(por_equip.items(), key=lambda item: item[1], reverse=True)[:10]
            ],
            "exemplos": exemplos,
            "criterio": "f_apontamentos filtrada por equipamento ilike %ENVASADORA% e data_final no ano; fallback por data_inicial se data_final estiver vazia.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug-planejado-programacao")
def debug_planejado_programacao(
    ano: int | None = Query(default=None),
):
    try:
        ano = ano or date.today().year
        planejado, programacoes_por_mes = _carregar_planejado_envase_periodo(ano, 12)
        por_mes_linha = defaultdict(lambda: defaultdict(float))
        exemplos = []

        for row in planejado:
            mes = _to_int(row.get("mes"))
            linha = row.get("linha") or "SEM_LINHA"
            por_mes_linha[mes][linha] += _to_float(row.get("qtd_caixas"))
            if len(exemplos) < 10:
                exemplos.append(row)

        return {
            "ano": ano,
            "programacoes_por_mes": programacoes_por_mes,
                "mps_fonte_atual": _carregar_mps_liberacoes_atual_ano(ano)[1],
            "linhas_planejadas": len(planejado),
            "por_mes_linha_cx": {
                str(mes): {linha: round(valor, 1) for linha, valor in sorted(linhas.items())}
                for mes, linhas in sorted(por_mes_linha.items())
            },
            "exemplos": exemplos,
            "criterio": "f_programacao_ops_resumo por mes_ref YYYY-MM; meta_mes_tubetes / 500 = caixas. Se não houver resumo, fallback pela soma de f_programacao_ops.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug-realizado-envase")
def debug_realizado_envase(
    ano: int | None = Query(default=None),
):
    """
    Debug para validar o realizado da Produção contra o Excel/Supabase.

    Esperado para Jan/2026, com a base apontamentoatual_1906:
      L1 ≈ 14.848,1 cx
      L2 ≈ 5.058,6 cx
    """
    try:
        ano = ano or date.today().year
        produtos_map = _carregar_produtos_map()
        apontamentos = _carregar_apontamentos_periodo(ano, 12)

        por_mes_linha: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        por_mes_equip: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        exemplos: List[Dict[str, Any]] = []
        rows_produtivas = 0

        for row in apontamentos:
            real = _registro_envase_real(row, produtos_map)
            if not real:
                continue

            rows_produtivas += 1
            mes = _to_int(real.get("mes"))
            linha = str(real.get("linha") or "SEM_LINHA")
            equipamento = str(real.get("equipamento") or "SEM_EQUIP")
            caixas = _to_float(real.get("qtd_caixas"))

            por_mes_linha[mes][linha] += caixas
            por_mes_equip[mes][equipamento] += caixas

            if len(exemplos) < 10:
                exemplos.append({
                    "mes": mes,
                    "linha": linha,
                    "equipamento": equipamento,
                    "data": real.get("data"),
                    "lote": real.get("lote"),
                    "tipo_evento": real.get("tipo_evento"),
                    "qtd_caixas": round(caixas, 3),
                })

        return {
            "ano": ano,
            "apontamentos_envase_lidos": len(apontamentos),
            "rows_produtivas": rows_produtivas,
            "por_mes_linha_cx": {
                str(mes): {linha: round(valor, 3) for linha, valor in sorted(linhas.items())}
                for mes, linhas in sorted(por_mes_linha.items())
            },
            "por_mes_equipamento_cx": {
                str(mes): {equip: round(valor, 3) for equip, valor in sorted(equips.items())}
                for mes, equips in sorted(por_mes_equip.items())
            },
            "exemplos": exemplos,
            "criterio": "DATA FINAL + tipo_evento PRODUÇÃO/PRODUCAO + equipamento ENVASADORA + qtd_produzida/500; L1 = MÁQ 1 + MÁQ 2; L2 = L2 - ENVASADORA.",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/cache")
async def cache_producao(
    tipo: str = Query(default="dashboard"),
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
    linha: str = Query(default="TODAS"),
    busca: Optional[str] = Query(default=None),
    force: bool = Query(default=False),
    _t: Optional[str] = Query(default=None),
):
    """
    Compatibilidade com o front otimizado da Produção.

    O front atual chama /producao/cache?tipo=dashboard|acompanhamento|perdas.
    A v84 tinha /dashboard, /acompanhamento e /perdas, mas não tinha /cache,
    por isso a tela retornava 404 Not Found.

    Este endpoint encapsula as rotas existentes e mantém cache rápido em memória
    por máquina Fly. Se force=true, recalcula.
    """
    ano = ano or date.today().year
    mes = mes or date.today().month
    tipo_norm = _upper(tipo).lower()
    linha_norm = _upper(linha) or "TODAS"

    chave_cache = _cache_key(
        "producao_cache_endpoint_v120_plano_atualizado",
        tipo_norm,
        int(ano),
        int(mes),
        linha_norm,
        _upper(busca or ""),
    )

    if not force:
        cached = _cache_get(chave_cache)
        if cached is not None:
            return {
                "from_cache": True,
                "tipo": tipo_norm,
                "ano": int(ano),
                "mes": int(mes),
                "linha": "TODAS",
                "payload": cached,
            }

    try:
        if tipo_norm == "dashboard":
            payload = dashboard_producao(
                ano=int(ano),
                mes=int(mes),
                linha=linha_norm,
            )

        elif tipo_norm == "acompanhamento":
            payload = acompanhamento_producao(
                ano=int(ano),
                mes=int(mes),
                linha=linha_norm,
                busca=busca,
            )

        elif tipo_norm == "perdas":
            payload = perdas_producao(
                ano=int(ano),
                mes_final=int(mes),
                linha=linha_norm,
            )

        else:
            raise HTTPException(
                status_code=400,
                detail="Tipo de cache inválido. Use dashboard, acompanhamento ou perdas.",
            )

        ttl_cache = 15 if tipo_norm == "acompanhamento" else 300
        _cache_set(chave_cache, payload, ttl=ttl_cache)

        return {
            "from_cache": False,
            "tipo": tipo_norm,
            "ano": int(ano),
            "mes": int(mes),
            "linha": linha_norm,
            "payload": payload,
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



def _linha_planejamento_excelencia(row: Dict[str, Any]) -> Optional[str]:
    texto = " ".join([
        _upper(_get(row, "linha", "LINHA", default="")),
        _upper(_get(row, "recurso", "RECURSO", default="")),
        _upper(_get(row, "equipamento", "EQUIPAMENTO", default="")),
    ])

    if texto in {"L1", "LINHA 1", "LINHA1", "ENVASE_L1"} or "LINHA 1" in texto or "ENVASE_L1" in texto:
        return "L1"
    if texto in {"L2", "LINHA 2", "LINHA2", "ENVASE_L2"} or "LINHA 2" in texto or "ENVASE_L2" in texto:
        return "L2"

    linha = _linha_envase_from_text(
        equipamento=_get(row, "equipamento", "EQUIPAMENTO", default=""),
        recurso=_get(row, "linha", "LINHA", "recurso", "RECURSO", default=""),
    )
    if linha in {"L1", "L2"}:
        return linha

    return None


def _normalizar_recurso_mrp_calendario(valor: Any) -> Optional[str]:
    texto = _upper(valor)

    if not texto:
        return None

    if texto in {"L1", "LINHA 1", "LINHA1", "ENVASE_L1"} or "LINHA 1" in texto:
        return "L1"

    if texto in {"L2", "LINHA 2", "LINHA2", "ENVASE_L2"} or "LINHA 2" in texto:
        return "L2"

    if "FABRIMA" in texto or "EMBAL" in texto:
        return "FABRIMA"

    return None


def _linha_nome_calendario_mrp(recurso: str) -> str:
    if recurso == "L1":
        return "Linha 1"
    if recurso == "L2":
        return "Linha 2"
    if recurso == "FABRIMA":
        return "Fabrima"
    return recurso


def _limpar_comentario_calendario_mrp(texto: Any) -> Optional[str]:
    if texto is None:
        return None

    bruto = str(texto).strip()
    if not bruto:
        return None

    # Comentário encadeado do Excel costuma vir com um texto grande e a parte útil depois de "Comentário:".
    marker = "Comentário:"
    if marker in bruto:
        bruto = bruto.split(marker, 1)[-1].strip()

    linhas = []
    for parte in bruto.replace("\r", "\n").split("\n"):
        item = parte.strip()
        if not item:
            continue

        upper = _upper(item)
        if "COMENTARIO ENCADEADO" in upper:
            continue
        if "SUA VERSAO DO EXCEL" in upper:
            continue
        if "GO.MICROSOFT" in upper:
            continue

        # remove autor no início, ex.: "Camila Batista:"
        item = re.sub(r"^[A-Za-zÀ-ÿ ]+:\s*", "", item).strip()

        if item:
            linhas.append(item)

    comentario = " | ".join(linhas).strip()
    return comentario or None


def _buscar_rodadas_mps_mais_recentes_por_mes(ano: int, mes: int, periodo_saida: str) -> List[Dict[str, Any]]:
    if periodo_saida == "ytd":
        meses = list(range(1, int(mes) + 1))
    else:
        meses = [int(mes)]

    rodadas: List[Dict[str, Any]] = []

    for mes_ref in meses:
        try:
            rows = _select_all(
                supabase.table("f_mrp_rodadas")
                .select("id,nome,mes,ano,versao,status,criado_em")
                .eq("ano", int(ano))
                .eq("mes", int(mes_ref))
                .eq("nome", "MPS"),
                page_size=1000,
            )
        except Exception:
            rows = []

        if not rows:
            continue

        rows_ordenadas = sorted(
            rows,
            key=lambda r: (
                _to_int(_get(r, "versao", "VERSAO", default=0)),
                str(_get(r, "criado_em", "CRIADO_EM", default="")),
            ),
            reverse=True,
        )

        rodadas.append(rows_ordenadas[0])

    return rodadas


def _carregar_planejamento_gantt_excelencia(
    ano: int,
    mes: int,
    periodo_saida: str,
) -> List[Dict[str, Any]]:
    """
    Calendário planejado vindo do Gantt/MRP atual.

    Fonte principal:
    - f_mrp_rodadas: escolhe sempre a maior versão do mês.
    - f_mrp_calendario_dia: se existir e tiver linhas, usa horas + comentário do calendário.
    - fallback: f_mrp_alocacoes_dia, usando horas_disponiveis_dia.

    Observação:
    - f_mps_producao ficou como fluxo antigo, não é mais fonte principal.
    """
    chave_cache = _cache_key(
        "planejamento_gantt_excelencia_v115_mrp",
        int(ano),
        int(mes),
        periodo_saida,
    )
    cached = _cache_get(chave_cache)
    if cached is not None:
        return cached

    if periodo_saida == "ytd":
        inicio, fim = _periodo_ano_ate_mes(ano, mes)
    else:
        inicio, fim = _periodo_mes(ano, mes)

    rodadas = _buscar_rodadas_mps_mais_recentes_por_mes(
        ano=int(ano),
        mes=int(mes),
        periodo_saida=periodo_saida,
    )

    if not rodadas:
        return _cache_set(chave_cache, [], ttl=300)

    planejamento_por_chave: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for rodada in rodadas:
        rodada_id = _get(rodada, "id", "ID", default=None)
        rodada_mes = _to_int(_get(rodada, "mes", "MES", default=0))
        rodada_ano = _to_int(_get(rodada, "ano", "ANO", default=0))
        rodada_versao = _to_int(_get(rodada, "versao", "VERSAO", default=0))

        if not rodada_id:
            continue

        rows_calendario: List[Dict[str, Any]] = []

        # 1) Fonte nova com comentários, quando existir/preenchida.
        try:
            rows_calendario = _select_all(
                supabase.table("f_mrp_calendario_dia")
                .select("rodada_id,recurso,data,horas_disponiveis_dia,horas_indisponiveis_planejadas,comentario_calendario,origem_aba")
                .eq("rodada_id", str(rodada_id))
                .gte("data", inicio.date().isoformat())
                .lt("data", fim.date().isoformat()),
                page_size=1000,
            )
        except Exception:
            rows_calendario = []

        if rows_calendario:
            for row in rows_calendario:
                dt = _parse_datetime(_get(row, "data", "DATA", default=None))
                recurso = _normalizar_recurso_mrp_calendario(_get(row, "recurso", "RECURSO", default=None))

                if not dt or recurso not in {"L1", "L2", "FABRIMA"}:
                    continue

                data_iso = dt.date().isoformat()
                horas_disp = _to_float(_get(row, "horas_disponiveis_dia", "HORAS_DISPONIVEIS_DIA", default=0))
                horas_indisp = _to_float(_get(row, "horas_indisponiveis_planejadas", "HORAS_INDISPONIVEIS_PLANEJADAS", default=max(0, 24 - horas_disp)))
                comentario = _limpar_comentario_calendario_mrp(_get(row, "comentario_calendario", "COMENTARIO_CALENDARIO", default=None))

                planejamento_por_chave[(data_iso, recurso)] = {
                    "data": data_iso,
                    "dia": dt.day,
                    "linha": recurso,
                    "linha_nome": _linha_nome_calendario_mrp(recurso),
                    "horas_planejadas_gantt": round(max(0.0, horas_disp), 2),
                    "horas_parada_gantt": round(max(0.0, horas_indisp), 2),
                    "versao": str(rodada_versao),
                    "versao_num": rodada_versao,
                    "rodada_id": str(rodada_id),
                    "comentario": comentario,
                    "fonte": "f_mrp_calendario_dia",
                }

            continue

        # 2) Fallback atual: alocações diárias do Gantt/MRP.
        try:
            rows_alocacoes = _select_all(
                supabase.table("f_mrp_alocacoes_dia")
                .select("rodada_id,recurso,data,horas_alocadas,horas_disponiveis_dia,origem")
                .eq("rodada_id", str(rodada_id))
                .gte("data", inicio.date().isoformat())
                .lt("data", fim.date().isoformat()),
                page_size=10000,
            )
        except Exception:
            rows_alocacoes = []

        agrupado: Dict[Tuple[str, str], Dict[str, Any]] = {}

        for row in rows_alocacoes or []:
            dt = _parse_datetime(_get(row, "data", "DATA", default=None))
            recurso = _normalizar_recurso_mrp_calendario(_get(row, "recurso", "RECURSO", default=None))

            if not dt or recurso not in {"L1", "L2", "FABRIMA"}:
                continue

            data_iso = dt.date().isoformat()
            chave = (data_iso, recurso)

            item = agrupado.setdefault(
                chave,
                {
                    "data": data_iso,
                    "dia": dt.day,
                    "linha": recurso,
                    "linha_nome": _linha_nome_calendario_mrp(recurso),
                    "horas_alocadas": 0.0,
                    "horas_disponiveis_dia": 0.0,
                    "linhas": 0,
                },
            )

            item["horas_alocadas"] += _to_float(_get(row, "horas_alocadas", "HORAS_ALOCADAS", default=0))
            item["horas_disponiveis_dia"] = max(
                _to_float(item.get("horas_disponiveis_dia")),
                _to_float(_get(row, "horas_disponiveis_dia", "HORAS_DISPONIVEIS_DIA", default=0)),
            )
            item["linhas"] += 1

        for (data_iso, recurso), row in agrupado.items():
            dt = _parse_datetime(data_iso)
            if not dt:
                continue

            horas_disp = max(0.0, min(24.0, _to_float(row.get("horas_disponiveis_dia"))))
            horas_indisp = max(0.0, 24.0 - horas_disp)

            comentario = None
            if horas_indisp > 0.001:
                comentario = "Calendário planejado do Gantt"

            planejamento_por_chave[(data_iso, recurso)] = {
                "data": data_iso,
                "dia": dt.day,
                "linha": recurso,
                "linha_nome": _linha_nome_calendario_mrp(recurso),
                "horas_planejadas_gantt": round(horas_disp, 2),
                "horas_parada_gantt": round(horas_indisp, 2),
                "versao": str(rodada_versao),
                "versao_num": rodada_versao,
                "rodada_id": str(rodada_id),
                "comentario": comentario,
                "fonte": "f_mrp_alocacoes_dia",
            }

    planejamento = sorted(
        planejamento_por_chave.values(),
        key=lambda x: (str(x.get("data")), str(x.get("linha"))),
    )

    return _cache_set(chave_cache, planejamento, ttl=300)


@router.get("/excelencia-operacional")
def excelencia_operacional_producao(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
    periodo: str = Query(default="mes", description="Use mes ou ytd."),
):
    """
    Primeira entrega do painel de excelência operacional.

    - considera equipamentos físicos operacionais;
    - separa produção, paradas programadas, paradas não programadas e sem programação;
    - matriz de criticidade usa somente paradas não programadas;
    - retorna também a capacidade planejada diária do Gantt/MPS por linha.
    """
    try:
        ano = ano or date.today().year
        mes = mes or date.today().month
        periodo_norm = _upper(periodo) or "MES"
        mes = max(1, min(12, int(mes)))

        if periodo_norm in {"YTD", "ANO", "ACUMULADO"}:
            inicio, fim = _periodo_ano_ate_mes(ano, mes)
            periodo_label = f"Jan–{_mes_label(mes)}/{ano}"
            periodo_saida = "ytd"
        else:
            inicio, fim = _periodo_mes(ano, mes)
            periodo_label = _mes_label(mes, ano)
            periodo_saida = "mes"

        cache_key = _cache_key("excelencia_operacional_v1", ano, mes, periodo_saida, VERSAO_EXCELENCIA_OPERACIONAL)
        cached = _cache_get(cache_key)
        if cached:
            return {**cached, "from_cache": True}

        rows = _query_apontamentos_operacionais_por_data(inicio.isoformat(), fim.isoformat())
        payload = _agregar_excelencia_operacional(rows)
        planejamento_diario = _carregar_planejamento_gantt_excelencia(
            ano=int(ano),
            mes=int(mes),
            periodo_saida=periodo_saida,
        )
        payload.update({
            "from_cache": False,
            "ano": int(ano),
            "mes": int(mes),
            "periodo": periodo_saida,
            "atualizado_em": _dados_atualizados_em_producao(),
            "periodo_label": periodo_label,
            "data_inicio": inicio.date().isoformat(),
            "data_fim_exclusivo": fim.date().isoformat(),
            "planejamento_diario": planejamento_diario,
        })

        _cache_set(cache_key, payload, ttl=300)
        return payload

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/perdas")
def perdas_producao(
    ano: int | None = Query(default=None),
    mes_final: int | None = Query(default=None),
    linha: str = Query(default="TODAS"),
):
    try:
        ano = ano or date.today().year
        mes_final = mes_final or date.today().month
        linha_norm = _upper(linha) or "TODAS"
        if linha_norm not in {"TODAS", "L1", "L2"}:
            linha_norm = "TODAS"

        mes_final = max(1, min(12, int(mes_final)))

        paradas = _paradas_envase_periodo(ano, mes_final)
        paradas = _filtrar_linha(paradas, linha_norm)

        gap_por_linha = _gap_ytd_por_linha(ano, mes_final)

        if linha_norm in {"L1", "L2"}:
            gap_por_linha = {
                "L1": gap_por_linha.get("L1", 0) if linha_norm == "L1" else 0,
                "L2": gap_por_linha.get("L2", 0) if linha_norm == "L2" else 0,
            }

        analise = _agregar_perdas(paradas, gap_por_linha)

        return {
            "ano": ano,
            "mes_final": mes_final,
            "periodo_label": f"Jan–{_mes_label(mes_final)}/{ano}",
            "linha": linha_norm,
            **analise,
            "debug": {
                "paradas_rows": len(paradas),
                "gap_por_linha": gap_por_linha,
                "criterio": "Paradas de envase YTD, macro categorias por regra textual, impacto em caixas estimado por taxa teórica de linha/máquina.",
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/dashboard")
def dashboard_producao(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
    linha: str = Query(default="TODAS"),
):
    try:
        ano = ano or date.today().year
        mes = mes or date.today().month
        # Dashboard é ano fechado. O mês continua existindo no contrato para não quebrar o front,
        # mas a visão gerencial sempre carrega Jan-Dez do ano selecionado.
        linha_norm = _upper(linha) or "TODAS"
        if linha_norm not in {"TODAS", "L1", "L2"}:
            linha_norm = "TODAS"

        planejado, programacoes_por_mes = _carregar_planejado_envase_periodo(ano, 12)
        orcado_por_linha_mes = _carregar_orcado_liberacao_periodo(ano)

        # f_apontamentos é a parte pesada. Carrega uma vez só e separa realizado/parada no mesmo loop.
        produtos_map = _carregar_produtos_map()
        apontamentos = _carregar_apontamentos_periodo(ano, 12)
        realizados: List[Dict[str, Any]] = []
        paradas: List[Dict[str, Any]] = []

        for row in apontamentos:
            real = _registro_envase_real(row, produtos_map)
            if real:
                realizados.append(real)
                continue

            parada = _registro_parada_envase(row)
            if parada:
                paradas.append(parada)

        planejado_filtrado = _filtrar_linha(planejado, linha_norm)
        realizados_filtrado = _filtrar_linha(realizados, linha_norm)
        paradas_filtrado = _filtrar_linha(paradas, linha_norm)

        linhas_orcado = ["L1", "L2"] if linha_norm == "TODAS" else [linha_norm]
        orcado_filtrado_linha_mes = {
            (lin, mes): valor
            for (lin, mes), valor in orcado_por_linha_mes.items()
            if lin in linhas_orcado
        }
        orcado_filtrado_mes: Dict[int, float] = defaultdict(float)
        for (_, mes_orcado), valor in orcado_filtrado_linha_mes.items():
            orcado_filtrado_mes[mes_orcado] += _to_float(valor)

        planejado_cx = _somar(planejado_filtrado, "qtd_caixas")
        realizado_cx = _somar(realizados_filtrado, "qtd_caixas")
        horas_paradas = _somar(paradas_filtrado, "horas")
        top_ofensores = _top_ofensores(paradas_filtrado)

        por_mes_resposta = _agregar_meses(
            ano,
            12,
            planejado_filtrado,
            realizados_filtrado,
            orcado_por_mes=dict(orcado_filtrado_mes),
        )
        por_mes_linha_resposta = _agregar_meses_por_linha(
            ano,
            planejado_filtrado,
            realizados_filtrado,
            orcado_por_linha_mes=orcado_filtrado_linha_mes,
        )
        por_linha_base = _agregar_linhas(planejado_filtrado, realizados_filtrado, paradas_filtrado)

        # Adiciona tendência/plano atualizado anual por linha.
        # O front usa isso para substituir o card "Planejado ano" estático.
        orcado_por_linha_total: Dict[str, float] = defaultdict(float)
        for (lin, _mes_orcado), valor in orcado_filtrado_linha_mes.items():
            orcado_por_linha_total[lin] += _to_float(valor)

        for linha_item in por_linha_base:
            lin = str(linha_item.get("linha") or "")
            linha_item["orcado_cx"] = round(_to_float(orcado_por_linha_total.get(lin, 0)), 1)

        por_linha_resposta = _enriquecer_linhas_com_tendencia(
            por_linha_base,
            por_mes_linha_resposta,
            ano,
        )

        tendencia_total_cx = sum(_to_float(row.get("tendencia_ano_cx")) for row in por_linha_resposta)

        resposta = {
            "ano": ano,
            "mes_final": 12,
            "periodo_label": f"Jan–Dez/{ano}",
            "linha": linha_norm,
            "atualizado_em": _dados_atualizados_em_producao(),
            "resumo": {
                "planejado_cx": round(planejado_cx, 1),
                "plano_atualizado_cx": round(tendencia_total_cx, 1),
                "tendencia_ano_cx": round(tendencia_total_cx, 1),
                "realizado_cx": round(realizado_cx, 1),
                "gap_cx": round(realizado_cx - planejado_cx, 1),
                "aderencia_pct": round(_pct(realizado_cx, planejado_cx), 1),
                "horas_paradas": round(horas_paradas, 1),
                "lotes_envasados": len({r.get("lote") for r in realizados_filtrado if r.get("lote")}),
                "principal_ofensor": top_ofensores[0] if top_ofensores else None,
            },
            "por_mes": por_mes_resposta,
            "por_mes_linha": por_mes_linha_resposta,
            "por_linha": por_linha_resposta,
            "top_ofensores": top_ofensores,
            "top_ofensores_por_linha": _top_ofensores_por_linha(paradas_filtrado),
            "por_grupo": _producao_por_grupo(realizados_filtrado),
            "debug": {
                "planejado_rows": len(planejado_filtrado),
                "realizados_rows": len(realizados_filtrado),
                "paradas_rows": len(paradas_filtrado),
                "programacoes_por_mes": programacoes_por_mes,
                "mps_fonte_atual": _carregar_mps_liberacoes_atual_ano(ano)[1],
                "orcado_por_linha_mes": {
                    f"{linha_orcado}-{mes_orcado}": round(valor, 1)
                    for (linha_orcado, mes_orcado), valor in sorted(orcado_filtrado_linha_mes.items())
                },
                "criterio_planejado": "f_programacao_ops_resumo.meta_mes_tubetes / 500. Tabela alimentada no upload da Programação Mensal lendo L4 das abas ENVASE LINHA 1/2. Fallback pela soma de f_programacao_ops se o mês ainda não tiver resumo.",
                "criterio_plano_atualizado": "Tendência ano = realizado dos meses fechados + realizado MTD + saldo planejado do mês atual + Programação/MPS dos meses futuros.",
                "criterio_realizado": "f_apontamentos do ano inteiro por DATA FINAL; apontamentos produtivos em equipamentos de envase L1/L2; qtd_produzida / 500 = caixas.",
                "criterio_paradas": "f_apontamentos do ano inteiro; paradas/setup/manutenção/limpeza em equipamentos de envase L1/L2.",
            },
        }

        return resposta

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/acompanhamento")
def acompanhamento_producao(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
    linha: str = Query(default="TODAS"),
    busca: Optional[str] = Query(default=None),
):
    try:
        ano = ano or date.today().year
        mes = mes or date.today().month
        linha_norm = _upper(linha) or "TODAS"
        if linha_norm not in {"TODAS", "L1", "L2", "FABRIMA"}:
            linha_norm = "TODAS"

        realizados = _registros_operacional_mes(ano, mes)

        # A aba Acompanhamento do Mês é uma visão paralela:
        # sempre mostra L1, L2 e Fabrima lado a lado.
        # O filtro global de linha é usado no Dashboard/Paradas, mas aqui não deve
        # zerar as outras colunas quando o usuário deixou "Envase — Linha 2" selecionado.
        realizados = _filtrar_linha(realizados, "TODAS")

        mapa_mes_liberacao = _carregar_mapa_mes_liberacao(ano)
        mapa_qtd_planejada = _carregar_mapa_qtd_planejada_lote(ano)
        mapa_data_planejada = _carregar_mapa_data_planejada_lote(ano)
        planejado_mtd_por_linha = _carregar_planejado_mtd_operacional(ano, mes)

        # Fabrima:
        # a lista de lotes vem do Cogtive/apontamentos,
        # mas a quantidade oficial exibida vem da SD3/liberação.
        mapa_fabrima_sd3_liberada = _carregar_fabrima_sd3_liberado_por_lote(ano)

        acompanhamento = _agregar_acompanhamento(
            realizados,
            busca=busca,
            mapa_mes_liberacao=mapa_mes_liberacao,
            mapa_qtd_planejada=mapa_qtd_planejada,
            mapa_data_planejada=mapa_data_planejada,
            planejado_mtd_por_linha=planejado_mtd_por_linha,
            mapa_fabrima_sd3_liberada=mapa_fabrima_sd3_liberada,
        )

        return {
            "ano": ano,
            "mes": mes,
            "mes_label": _mes_label(mes),
            "linha": linha_norm,
            "busca": busca,
            "atualizado_em": _dados_atualizados_em_producao(),
            **acompanhamento,
            "debug": {
                "realizados_rows": len(realizados),
                "criterio": "f_apontamentos do mês; Envase mostra quantidade realizada/planejada; Fabrima lista lotes apontados na embalagem e usa quantidade liberada pela SD3 quando existir; data exibida pela DATA FINAL real.",
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))