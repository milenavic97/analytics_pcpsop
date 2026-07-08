from fastapi import APIRouter, HTTPException, Query
from app.database import supabase
from collections import defaultdict
from datetime import date, datetime, time
from typing import Any, Optional
import re
import unicodedata

router = APIRouter(prefix="/overview-producao", tags=["overview-producao"])

TUBETES_POR_CAIXA = 500
MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def _select_all(query, page_size: int = 1000) -> list[dict]:
    todos = []
    page = 0

    while True:
        res = query.range(page * page_size, (page + 1) * page_size - 1).execute()
        data = res.data or []
        todos.extend(data)

        if len(data) < page_size:
            break

        page += 1

    return todos


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

        return int(float(str(value).replace(",", ".")))
    except Exception:
        return default


def _pct(numerador: float, denominador: float) -> float:
    if not denominador:
        return 0.0

    return numerador / denominador * 100


def _mes_label(mes: int) -> str:
    if 1 <= mes <= 12:
        return MESES_LABEL[mes - 1]

    return str(mes)


def _normaliza_texto(value: Any) -> str:
    texto = str(value or "").strip().upper()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(char for char in texto if not unicodedata.combining(char))
    texto = re.sub(r"\s+", " ", texto)
    return texto


def _normaliza_codigo(value: Any) -> str:
    texto = str(value or "").strip()

    if texto.endswith(".0"):
        texto = texto[:-2]

    return texto


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.replace(tzinfo=None)

    if isinstance(value, date):
        return datetime.combine(value, time.min)

    texto = str(value).strip()

    if not texto:
        return None

    try:
        return datetime.fromisoformat(texto.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        pass

    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(texto[:19], fmt)
        except Exception:
            continue

    return None


def _first_existing(row: dict, campos: list[str], default: Any = None) -> Any:
    for campo in campos:
        if campo in row and row.get(campo) not in (None, ""):
            return row.get(campo)

    return default


def _linha_padrao(value: Any) -> Optional[str]:
    texto = _normaliza_texto(value)

    if texto in {"L1", "LINHA 1", "LINHA1", "ENVASE_L1", "ENVASE L1"}:
        return "L1"

    if texto in {"L2", "LINHA 2", "LINHA2", "ENVASE_L2", "ENVASE L2"}:
        return "L2"

    if "L2" in texto or "ENV003" in texto or "ENVASADORA 3" in texto or "ENVASADORA3" in texto:
        return "L2"

    if (
        "L1" in texto
        or "ENVASE_L1" in texto
        or "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQUINA 1" in texto
        or "MAQUINA1" in texto
        or "ENV001" in texto
        or "ENVASADORA 1" in texto
        or "ENVASADORA1" in texto
        or "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQUINA 2" in texto
        or "MAQUINA2" in texto
        or "ENV002" in texto
        or "ENVASADORA 2" in texto
        or "ENVASADORA2" in texto
    ):
        return "L1"

    return None


def _linha_from_equipamento(equipamento: Any) -> Optional[str]:
    return _linha_padrao(equipamento)


def _is_producao(tipo_evento: Any) -> bool:
    texto = _normaliza_texto(tipo_evento)
    return "PRODUCAO" in texto or "PRODUÇÃO" in texto


def _grupo_produtos_map() -> dict[str, str]:
    try:
        rows = _select_all(
            supabase.table("d_produtos")
            .select("*")
        )
    except Exception:
        return {}

    mapa = {}

    for row in rows:
        cod = _normaliza_codigo(
            _first_existing(row, ["cod_produto", "codigo", "produto_codigo", "sku"])
        )

        grupo = str(
            _first_existing(row, ["grupo", "grupo_produto", "grupo_descricao", "descricao_grupo"], "Sem grupo")
            or "Sem grupo"
        ).strip() or "Sem grupo"

        if cod:
            mapa[cod] = grupo

    return mapa


def _inferir_grupo_produto(produto: Any, sku: Any, grupo_map: dict[str, str]) -> str:
    sku_norm = _normaliza_codigo(sku)
    produto_norm = _normaliza_codigo(produto)

    if sku_norm and sku_norm in grupo_map:
        return grupo_map[sku_norm]

    if produto_norm and produto_norm in grupo_map:
        return grupo_map[produto_norm]

    return str(produto or sku or "Sem grupo").strip() or "Sem grupo"


def _buscar_rodadas_mes(ano: int, mes: int) -> list[dict]:
    try:
        return _select_all(
            supabase.table("f_mrp_rodadas")
            .select("*")
            .eq("ano", ano)
            .eq("mes", mes)
        )
    except Exception:
        return []


def _rodada_v1_e_atual(ano: int, mes: int) -> tuple[Optional[dict], Optional[dict]]:
    rodadas = _buscar_rodadas_mes(ano, mes)

    if not rodadas:
        return None, None

    rodadas_validas = [
        r for r in rodadas
        if r.get("id") and (_to_int(r.get("versao")) or 0) > 0
    ]

    if not rodadas_validas:
        return None, None

    v1 = None

    for rodada in rodadas_validas:
        if (_to_int(rodada.get("versao")) or 0) == 1:
            v1 = rodada
            break

    atual = sorted(
        rodadas_validas,
        key=lambda r: (
            _to_int(r.get("versao")) or 0,
            str(r.get("criado_em") or r.get("created_at") or ""),
        ),
        reverse=True,
    )[0]

    return v1, atual


def _buscar_etapas_rodada(rodada_id: Optional[str]) -> list[dict]:
    if not rodada_id:
        return []

    try:
        return _select_all(
            supabase.table("f_mrp_etapas")
            .select("*")
            .eq("rodada_id", rodada_id)
        )
    except Exception:
        return []


def _etapas_para_planejado(rows: list[dict], ano: int) -> list[dict]:
    saida = []

    for row in rows:
        mes_prod = _to_int(row.get("mes_producao"))
        ano_prod = _to_int(row.get("ano_producao"))
        linha = _linha_padrao(row.get("recurso") or row.get("linha_origem"))
        qtd_tb = _to_float(row.get("qtd_planejada"))
        horas = _to_float(row.get("duracao_horas"))

        if ano_prod != ano:
            continue

        if mes_prod < 1 or mes_prod > 12:
            continue

        if linha not in {"L1", "L2"}:
            continue

        etapa = _normaliza_texto(row.get("etapa"))

        if etapa and etapa not in {"ENVASE", "PRODUCAO", "PRODUÇÃO"}:
            continue

        produto = str(
            row.get("descricao_produto") or row.get("produto") or "Sem grupo"
        ).strip() or "Sem grupo"

        produto_norm = _normaliza_texto(produto)

        if produto_norm in {"TOTAL", "TOTAIS"}:
            continue

        codigo = _normaliza_codigo(row.get("codigo_produto"))

        if _normaliza_texto(codigo) in {"TOTAL", "TOTAIS"}:
            continue

        if qtd_tb <= 0:
            continue

        saida.append({
            "ano": ano_prod,
            "mes": mes_prod,
            "linha": linha,
            "grupo": produto,
            "produto": produto,
            "codigo": codigo,
            "lote": str(row.get("lote") or "").strip(),
            "op": row.get("op"),
            "qtd_tubetes": qtd_tb,
            "qtd_caixas": qtd_tb / TUBETES_POR_CAIXA,
            "horas": horas,
            "fonte": "f_mrp_etapas",
            "rodada_id": row.get("rodada_id"),
        })

    return saida


def _buscar_planejados_mrp(ano: int, mes_rodada: int) -> tuple[list[dict], list[dict], dict]:
    rodada_v1, rodada_atual = _rodada_v1_e_atual(ano, mes_rodada)

    etapas_v1 = _buscar_etapas_rodada(rodada_v1.get("id") if rodada_v1 else None)
    etapas_atual = _buscar_etapas_rodada(rodada_atual.get("id") if rodada_atual else None)

    planejado_v1 = _etapas_para_planejado(etapas_v1, ano)
    planejado_atual = _etapas_para_planejado(etapas_atual, ano)

    debug = {
        "rodada_v1": rodada_v1,
        "rodada_atual": rodada_atual,
        "etapas_v1_rows": len(etapas_v1),
        "etapas_atual_rows": len(etapas_atual),
    }

    return planejado_v1, planejado_atual, debug


def _buscar_planejados_mrp_anual(ano: int, mes_base: int) -> tuple[list[dict], list[dict], dict]:
    """
    Regra correta da curva anual:
    - planejado_v1_cx: V1 do próprio mês.
    - planejado_atual_cx:
        meses antes do mês selecionado -> V1 do próprio mês;
        mês selecionado em diante -> última versão da rodada do mês selecionado.
    """

    planejado_v1_anual = []
    planejado_atual_anual = []

    debug = {
        "mes_base": mes_base,
        "meses": {},
        "rodada_atual_base": None,
        "etapas_atual_base_rows": 0,
    }

    rodada_v1_base, rodada_atual_base = _rodada_v1_e_atual(ano, mes_base)
    etapas_atual_base = _buscar_etapas_rodada(
        rodada_atual_base.get("id") if rodada_atual_base else None
    )
    planejado_atual_base = _etapas_para_planejado(etapas_atual_base, ano)

    debug["rodada_atual_base"] = rodada_atual_base
    debug["rodada_v1_base"] = rodada_v1_base
    debug["etapas_atual_base_rows"] = len(etapas_atual_base)

    for mes_loop in range(1, 13):
        rodada_v1_mes, rodada_atual_mes = _rodada_v1_e_atual(ano, mes_loop)

        etapas_v1_mes = _buscar_etapas_rodada(
            rodada_v1_mes.get("id") if rodada_v1_mes else None
        )
        planejado_v1_mes = _etapas_para_planejado(etapas_v1_mes, ano)

        planejado_v1_mes_filtrado = [
            row for row in planejado_v1_mes
            if _to_int(row.get("mes")) == mes_loop
        ]

        planejado_v1_anual.extend(planejado_v1_mes_filtrado)

        if mes_loop < mes_base:
            planejado_atual_anual.extend(planejado_v1_mes_filtrado)
            criterio_atual = "V1 do próprio mês"
            rodada_atual_usada = rodada_v1_mes
            etapas_atual_rows = len(etapas_v1_mes)
        else:
            planejado_atual_mes_filtrado = [
                row for row in planejado_atual_base
                if _to_int(row.get("mes")) == mes_loop
            ]

            planejado_atual_anual.extend(planejado_atual_mes_filtrado)
            criterio_atual = "Última versão do mês base"
            rodada_atual_usada = rodada_atual_base
            etapas_atual_rows = len(etapas_atual_base)

        debug["meses"][mes_loop] = {
            "rodada_v1_mes": rodada_v1_mes,
            "rodada_atual_mes": rodada_atual_mes,
            "rodada_atual_usada": rodada_atual_usada,
            "etapas_v1_rows": len(etapas_v1_mes),
            "etapas_atual_rows": etapas_atual_rows,
            "criterio_atual": criterio_atual,
        }

    return planejado_v1_anual, planejado_atual_anual, debug


def _realizado_producao_rows(ano: int, mes: Optional[int] = None) -> list[dict]:
    grupo_map = _grupo_produtos_map()

    try:
        rows = _select_all(
            supabase.table("f_apontamentos")
            .select("*")
        )
    except Exception:
        rows = []

    equipamentos_validos = [
        "L2 - ENVASADORA",
        "MAQ 1 - ENVASADORA",
        "MAQ 2 - ENVASADORA",
        "L2 ENVASADORA",
        "MAQ 1 ENVASADORA",
        "MAQ 2 ENVASADORA",
    ]

    saida = []

    for row in rows:
        equipamento_original = str(row.get("equipamento") or "").strip()
        equipamento = _normaliza_texto(equipamento_original)

        if not any(
            _normaliza_texto(eq) in equipamento
            for eq in equipamentos_validos
        ):
            continue

        if not _is_producao(row.get("tipo_evento")):
            continue

        linha = _linha_from_equipamento(equipamento_original)

        if linha not in {"L1", "L2"}:
            continue

        inicio = _parse_datetime(row.get("data_inicial"))
        fim = _parse_datetime(row.get("data_final"))

        if not inicio or not fim:
            continue

        if inicio.year != ano or fim.year != ano:
            continue

        if mes:
            if inicio.month != mes:
                continue

            if fim.month != mes:
                continue

        qtd_tb = _to_float(
            _first_existing(
                row,
                ["qtd_produzida", "quantidade_produzida", "qtd", "quantidade"]
            )
        )

        if qtd_tb <= 0:
            continue

        produto = row.get("produto")
        sku = _first_existing(
            row,
            ["sku", "codigo", "cod_produto", "produto_codigo"]
        )

        saida.append({
            "ano": inicio.year,
            "mes": inicio.month,
            "data": inicio.date().isoformat(),
            "linha": linha,
            "grupo": _inferir_grupo_produto(produto, sku, grupo_map),
            "produto": produto,
            "sku": _normaliza_codigo(sku),
            "lote": str(row.get("lote") or "").strip(),
            "ordem": str(row.get("ordem") or "").strip(),
            "equipamento": equipamento_original,
            "inicio": inicio,
            "fim": fim,
            "qtd_tubetes": qtd_tb,
            "qtd_caixas": qtd_tb / TUBETES_POR_CAIXA,
            "horas": _to_float(
                _first_existing(row, ["duracao_h", "duracao", "horas"], 0)
            ),
        })

    return saida


def _merge_intervalos(intervalos: list[tuple[datetime, datetime]]) -> float:
    validos = [
        (inicio, fim)
        for inicio, fim in intervalos
        if inicio and fim and fim > inicio
    ]

    if not validos:
        return 0.0

    ordenados = sorted(validos, key=lambda item: item[0])
    consolidados = [ordenados[0]]

    for atual_inicio, atual_fim in ordenados[1:]:
        ultimo_inicio, ultimo_fim = consolidados[-1]

        if atual_inicio <= ultimo_fim:
            consolidados[-1] = (
                ultimo_inicio,
                max(ultimo_fim, atual_fim),
            )
        else:
            consolidados.append((atual_inicio, atual_fim))

    total_segundos = sum(
        (fim - inicio).total_seconds()
        for inicio, fim in consolidados
    )

    return total_segundos / 3600


def _horas_reais_por_linha_mes(realizado_rows: list[dict], mes: int) -> dict[str, float]:
    intervalos_l1 = []
    horas_l2 = 0.0

    for row in realizado_rows:
        if _to_int(row.get("mes")) != mes:
            continue

        linha = row.get("linha")

        if linha == "L1":
            inicio = row.get("inicio")
            fim = row.get("fim")

            if isinstance(inicio, datetime) and isinstance(fim, datetime):
                intervalos_l1.append((inicio, fim))

        elif linha == "L2":
            horas_l2 += _to_float(row.get("horas"))

    return {
        "L1": round(_merge_intervalos(intervalos_l1), 2),
        "L2": round(horas_l2, 2),
    }


def _empty_mes_row(mes: int) -> dict:
    return {
        "mes": mes,
        "mes_label": _mes_label(mes),

        "planejado_v1_cx": 0.0,
        "planejado_atual_cx": 0.0,
        "realizado_cx": 0.0,
        "orcado_cx": 0.0,

        "planejado_v1_tb": 0.0,
        "planejado_atual_tb": 0.0,
        "realizado_tb": 0.0,
        "orcado_tb": 0.0,

        "planejado_v1_horas": 0.0,
        "planejado_atual_horas": 0.0,
        "realizado_horas": 0.0,
        "orcado_horas": 0.0,
    }


def _round_dict(row: dict) -> dict:
    return {
        key: round(value, 2) if isinstance(value, float) else value
        for key, value in row.items()
    }


def _aplicar_metricas(row: dict) -> dict:
    row["gap_vs_v1_cx"] = row["realizado_cx"] - row["planejado_v1_cx"]
    row["gap_vs_atual_cx"] = row["realizado_cx"] - row["planejado_atual_cx"]
    row["aderencia_vs_v1_pct"] = _pct(row["realizado_cx"], row["planejado_v1_cx"])
    row["aderencia_pct"] = _pct(row["realizado_cx"], row["planejado_atual_cx"])

    row["gap_vs_v1_horas"] = row["realizado_horas"] - row["planejado_v1_horas"]
    row["gap_vs_atual_horas"] = row["realizado_horas"] - row["planejado_atual_horas"]
    row["aderencia_vs_v1_horas_pct"] = _pct(row["realizado_horas"], row["planejado_v1_horas"])
    row["aderencia_horas_pct"] = _pct(row["realizado_horas"], row["planejado_atual_horas"])

    return row


@router.get("/health")
def health_overview_producao():
    return {"status": "ok", "router": "overview-producao"}


@router.get("/resumo")
def resumo_overview_producao(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
    linha: Optional[str] = Query(default="TODAS"),
    unidade: Optional[str] = Query(default="CAIXAS"),
):
    try:
        # ano/mes não podem ser default de parâmetro com date.today() — esse valor
        # seria calculado só uma vez, na subida do processo, e ficaria congelado.
        # Resolve aqui dentro, a cada chamada, pra sempre pegar o mês/ano reais.
        ano = ano or date.today().year
        mes = mes or date.today().month

        filtro_linha = str(linha or "TODAS").strip().upper()
        filtro_unidade = str(unidade or "CAIXAS").strip().upper()

        if filtro_linha not in {"TODAS", "L1", "L2"}:
            filtro_linha = "TODAS"

        if filtro_unidade not in {"CAIXAS", "TUBETES", "HORAS"}:
            filtro_unidade = "CAIXAS"

        planejado_v1_volume, planejado_atual_volume, debug_planejado = _buscar_planejados_mrp_anual(ano, mes)
        realizado = _realizado_producao_rows(ano)

        if filtro_linha in {"L1", "L2"}:
            planejado_v1_volume = [row for row in planejado_v1_volume if row.get("linha") == filtro_linha]
            planejado_atual_volume = [row for row in planejado_atual_volume if row.get("linha") == filtro_linha]
            realizado = [row for row in realizado if row.get("linha") == filtro_linha]

        meses = {m: _empty_mes_row(m) for m in range(1, 13)}

        for row in planejado_v1_volume:
            m = _to_int(row.get("mes"))
            if 1 <= m <= 12:
                meses[m]["planejado_v1_cx"] += _to_float(row.get("qtd_caixas"))
                meses[m]["planejado_v1_tb"] += _to_float(row.get("qtd_tubetes"))
                meses[m]["planejado_v1_horas"] += _to_float(row.get("horas"))

        for row in planejado_atual_volume:
            m = _to_int(row.get("mes"))
            if 1 <= m <= 12:
                meses[m]["planejado_atual_cx"] += _to_float(row.get("qtd_caixas"))
                meses[m]["planejado_atual_tb"] += _to_float(row.get("qtd_tubetes"))
                meses[m]["planejado_atual_horas"] += _to_float(row.get("horas"))

        for row in realizado:
            m = _to_int(row.get("mes"))
            if 1 <= m <= 12:
                meses[m]["realizado_cx"] += _to_float(row.get("qtd_caixas"))
                meses[m]["realizado_tb"] += _to_float(row.get("qtd_tubetes"))

        horas_reais_mes = {
            m: _horas_reais_por_linha_mes(realizado, m)
            for m in range(1, 13)
        }

        for m in range(1, 13):
            if filtro_linha == "L1":
                meses[m]["realizado_horas"] = horas_reais_mes[m]["L1"]
            elif filtro_linha == "L2":
                meses[m]["realizado_horas"] = horas_reais_mes[m]["L2"]
            else:
                meses[m]["realizado_horas"] = (
                    horas_reais_mes[m]["L1"] +
                    horas_reais_mes[m]["L2"]
                )

        meses_list = []

        for m in range(1, 13):
            row = _aplicar_metricas(meses[m])
            meses_list.append(_round_dict(row))

        mes_row = _aplicar_metricas({**meses.get(mes, _empty_mes_row(mes))})

        por_linha_map = {
            "L1": {
                "linha": "L1",
                "planejado_v1_cx": 0.0,
                "planejado_atual_cx": 0.0,
                "realizado_cx": 0.0,
                "planejado_v1_horas": 0.0,
                "planejado_atual_horas": 0.0,
                "realizado_horas": 0.0,
            },
            "L2": {
                "linha": "L2",
                "planejado_v1_cx": 0.0,
                "planejado_atual_cx": 0.0,
                "realizado_cx": 0.0,
                "planejado_v1_horas": 0.0,
                "planejado_atual_horas": 0.0,
                "realizado_horas": 0.0,
            },
        }

        for row in planejado_v1_volume:
            if _to_int(row.get("mes")) != mes:
                continue

            lin = row.get("linha")
            if lin in por_linha_map:
                por_linha_map[lin]["planejado_v1_cx"] += _to_float(row.get("qtd_caixas"))
                por_linha_map[lin]["planejado_v1_horas"] += _to_float(row.get("horas"))

        for row in planejado_atual_volume:
            if _to_int(row.get("mes")) != mes:
                continue

            lin = row.get("linha")
            if lin in por_linha_map:
                por_linha_map[lin]["planejado_atual_cx"] += _to_float(row.get("qtd_caixas"))
                por_linha_map[lin]["planejado_atual_horas"] += _to_float(row.get("horas"))

        for row in realizado:
            if _to_int(row.get("mes")) != mes:
                continue

            lin = row.get("linha")
            if lin in por_linha_map:
                por_linha_map[lin]["realizado_cx"] += _to_float(row.get("qtd_caixas"))

        horas_linha_mes = _horas_reais_por_linha_mes(realizado, mes)

        for lin in ["L1", "L2"]:
            por_linha_map[lin]["realizado_horas"] = horas_linha_mes[lin]

        por_linha = []

        for row in por_linha_map.values():
            row = _aplicar_metricas(row)
            row["gap_cx"] = row["gap_vs_atual_cx"]
            row["gap_horas"] = row["gap_vs_atual_horas"]
            por_linha.append(_round_dict(row))

        grupos_map = defaultdict(lambda: {
            "grupo": "",
            "planejado_v1_cx": 0.0,
            "planejado_atual_cx": 0.0,
            "realizado_cx": 0.0,
            "planejado_v1_horas": 0.0,
            "planejado_atual_horas": 0.0,
            "realizado_horas": 0.0,
        })

        for row in planejado_v1_volume:
            if _to_int(row.get("mes")) != mes:
                continue

            grupo = str(row.get("grupo") or row.get("produto") or "Sem grupo").strip() or "Sem grupo"
            grupos_map[grupo]["grupo"] = grupo
            grupos_map[grupo]["planejado_v1_cx"] += _to_float(row.get("qtd_caixas"))
            grupos_map[grupo]["planejado_v1_horas"] += _to_float(row.get("horas"))

        for row in planejado_atual_volume:
            if _to_int(row.get("mes")) != mes:
                continue

            grupo = str(row.get("grupo") or row.get("produto") or "Sem grupo").strip() or "Sem grupo"
            grupos_map[grupo]["grupo"] = grupo
            grupos_map[grupo]["planejado_atual_cx"] += _to_float(row.get("qtd_caixas"))
            grupos_map[grupo]["planejado_atual_horas"] += _to_float(row.get("horas"))

        for row in realizado:
            if _to_int(row.get("mes")) != mes:
                continue

            grupo = str(row.get("grupo") or "Sem grupo").strip() or "Sem grupo"
            grupos_map[grupo]["grupo"] = grupo
            grupos_map[grupo]["realizado_cx"] += _to_float(row.get("qtd_caixas"))
            grupos_map[grupo]["realizado_horas"] += _to_float(row.get("horas"))

        por_grupo = []

        for row in grupos_map.values():
            row = _aplicar_metricas(row)
            row["gap_cx"] = row["gap_vs_atual_cx"]
            row["gap_horas"] = row["gap_vs_atual_horas"]
            por_grupo.append(_round_dict(row))

        por_grupo.sort(key=lambda item: abs(_to_float(item.get("gap_cx"))), reverse=True)

        return {
            "ano": ano,
            "mes": mes,
            "mes_label": _mes_label(mes),
            "linha": filtro_linha,
            "unidade": filtro_unidade,
            "resumo": {
                "planejado_v1_cx": round(mes_row["planejado_v1_cx"]),
                "planejado_atual_cx": round(mes_row["planejado_atual_cx"]),
                "realizado_cx": round(mes_row["realizado_cx"]),
                "gap_cx": round(mes_row["realizado_cx"] - mes_row["planejado_atual_cx"]),
                "gap_vs_v1_cx": round(mes_row["realizado_cx"] - mes_row["planejado_v1_cx"]),
                "aderencia_pct": round(_pct(mes_row["realizado_cx"], mes_row["planejado_atual_cx"]), 1),
                "aderencia_vs_v1_pct": round(_pct(mes_row["realizado_cx"], mes_row["planejado_v1_cx"]), 1),

                "planejado_v1_tb": round(mes_row["planejado_v1_tb"]),
                "planejado_atual_tb": round(mes_row["planejado_atual_tb"]),
                "realizado_tb": round(mes_row["realizado_tb"]),

                "planejado_v1_horas": round(mes_row["planejado_v1_horas"], 2),
                "planejado_atual_horas": round(mes_row["planejado_atual_horas"], 2),
                "realizado_horas": round(mes_row["realizado_horas"], 2),
                "gap_horas": round(mes_row["realizado_horas"] - mes_row["planejado_atual_horas"], 2),
                "aderencia_horas_pct": round(_pct(mes_row["realizado_horas"], mes_row["planejado_atual_horas"]), 1),
            },
            "meses": meses_list,
            "por_linha": por_linha,
            "por_grupo": por_grupo,
            "debug": {
                "fonte_volume_v1": "V1 do próprio mês",
                "fonte_volume_atual": "Meses anteriores: V1 do próprio mês. Mês base em diante: última versão do mês base.",
                "fonte_horas_planejadas": "f_mrp_etapas.duracao_horas",
                "fonte_realizado": "f_apontamentos/Cogtive",
                "planejado_v1_volume_rows": len(planejado_v1_volume),
                "planejado_atual_volume_rows": len(planejado_atual_volume),
                "realizados_rows": len(realizado),
                "debug_planejado": debug_planejado,
                "criterio_volume_v1": "Para cada mês do gráfico, usa a rodada V1 do próprio mês.",
                "criterio_volume_atual": "Para meses anteriores ao mês selecionado, usa V1 do próprio mês. Do mês selecionado em diante, usa a maior versão disponível do mês selecionado.",
                "criterio_horas": "Planejado: f_mrp_etapas.duracao_horas. Realizado L1: união dos intervalos de f_apontamentos/Cogtive para não duplicar MAQ 1 + MAQ 2 em paralelo. Realizado L2: soma de duracao_h registrada no Cogtive.",
                "criterio_realizado": "f_apontamentos/Cogtive, ENVASE e PRODUÇÃO, filtro por data_inicial dentro do mes/ano.",
                "unidades": {
                    "cx": "caixas",
                    "tb": "tubetes",
                    "horas": "horas",
                    "percentuais": "%",
                },
                "observacao_orcado": "Orçado de produção ainda não carregado; campos orcado_* ficam zerados.",
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))