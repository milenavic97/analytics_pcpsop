from fastapi import APIRouter
from app.database import supabase
from datetime import date
import re

router = APIRouter(prefix="/overview", tags=["overview"])

TUBETES_POR_CAIXA = 500
MES_ATUAL = date.today().month
ANO_ATUAL = date.today().year
LINHAS = ("L1", "L2")


def _select_all(query) -> list:
    """Pagina automaticamente queries do Supabase de 1.000 em 1.000."""
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


def _linha_from_lote(lote: str | None) -> str | None:
    """
    Regra do PCP:
    o primeiro número depois de uma letra no lote indica a linha.
    1 = L1, 2 = L2.
    Exemplos válidos: 2601C2001 -> L2, ABC1... -> L1.
    """
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


# ─── Orçado de Faturamento ───────────────────────────────────────────────────

@router.get("/orcado-faturamento")
async def get_orcado_faturamento():
    rows = _select_all(
        supabase.table("f_orcado_faturamento")
        .select("mes, ano, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )

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
async def get_orcado_faturamento_detalhe():
    """
    Detalhe do orçado de faturamento usando d_produtos como fonte oficial de grupo.

    Regra:
    f_orcado_faturamento.cod_produto -> d_produtos.cod_produto -> d_produtos.grupo

    O grupo vindo de f_orcado_faturamento só fica como fallback quando o produto
    não existir na dimensão, para não perder volume no total.
    """
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
        .eq("ano", ANO_ATUAL)
    )

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



# ─── Projeção de Faturamento (Real + S&OP) ───────────────────────────────────

@router.get("/projecao-faturamento")
async def get_projecao_faturamento():
    ultimo_mes_fechado = MES_ATUAL - 1

    rows_sd2 = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, quantidade")
        .eq("ano", ANO_ATUAL)
    )
    rows_fc = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, qtd_forecast")
        .eq("ano", ANO_ATUAL)
    )
    rows_orc = _select_all(
        supabase.table("f_orcado_faturamento")
        .select("mes, ano, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )

    real: dict[int, float] = {}
    for r in rows_sd2:
        mes = int(r["mes"])
        real[mes] = real.get(mes, 0.0) + _to_float(r.get("quantidade"))

    forecast: dict[int, float] = {}
    for r in rows_fc:
        mes = int(r["mes"])
        forecast[mes] = forecast.get(mes, 0.0) + _to_float(r.get("qtd_forecast"))

    orcado: dict[int, float] = {}
    for r in rows_orc:
        mes = int(r["mes"])
        orcado[mes] = orcado.get(mes, 0.0) + _to_float(r.get("qtd_caixas"))

    total_real = sum(v for mes, v in real.items() if mes <= ultimo_mes_fechado)
    total_forecast = sum(v for mes, v in forecast.items() if mes >= MES_ATUAL)
    total_projetado = total_real + total_forecast
    total_orcado = sum(orcado.values())

    meses_list = []
    for mes in range(1, 13):
        meses_list.append({
            "mes": mes,
            "real": round(real.get(mes, 0.0)) if mes <= ultimo_mes_fechado else None,
            "forecast": round(forecast.get(mes, 0.0)) if mes >= MES_ATUAL else None,
            "orcado": round(orcado.get(mes, 0.0)),
        })

    return {
        "total_real": round(total_real),
        "total_forecast": round(total_forecast),
        "total_projetado": round(total_projetado),
        "total_orcado": round(total_orcado),
        "pct_atingimento": round(total_projetado / total_orcado * 100, 1) if total_orcado else 0,
        "delta_caixas": round(total_projetado - total_orcado),
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "meses": meses_list,
    }


# ─── Orçado de Liberações ────────────────────────────────────────────────────

@router.get("/orcado-liberacao")
async def get_orcado_liberacao():
    rows = _select_all(
        supabase.table("f_orcado_liberacao")
        .select("*")
        .eq("ano", ANO_ATUAL)
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


# ─── Liberações Reais + Previstas ─────────────────────────────────────────────

@router.get("/projecao-liberacoes")
async def get_projecao_liberacoes():
    """
    Retorna a projeção de liberações em caixas.

    Regras:
    - Realizado: f_sd3_entradas, meses fechados, linha extraída do lote.
    - Planejado: f_entradas_previstas, todos os meses por linha.
    - Previsto do card: f_entradas_previstas do mês atual em diante.
    - Orçado: f_orcado_liberacao convertido de tubetes para caixas, por linha.
    """
    ultimo_mes_fechado = MES_ATUAL - 1

    rows_sd3 = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, quantidade, lote")
        .eq("ano", ANO_ATUAL)
    )
    rows_prev = _select_all(
        supabase.table("f_entradas_previstas")
        .select("mes, ano, linha, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )
    rows_orc = _select_all(
        supabase.table("f_orcado_liberacao")
        .select("mes, ano, linha, qtd_tubetes")
        .eq("ano", ANO_ATUAL)
    )

    real_linha = {linha: {} for linha in LINHAS}
    planejado_linha = {linha: {} for linha in LINHAS}
    orcado_linha = {linha: {} for linha in LINHAS}

    for r in rows_sd3:
        linha = _linha_from_lote(r.get("lote"))
        if linha not in LINHAS:
            continue
        mes = int(r["mes"])
        real_linha[linha][mes] = real_linha[linha].get(mes, 0.0) + _to_float(r.get("quantidade"))

    for r in rows_prev:
        linha = str(r.get("linha") or "").strip().upper()
        if linha not in LINHAS:
            continue
        mes = int(r["mes"])
        planejado_linha[linha][mes] = planejado_linha[linha].get(mes, 0.0) + _to_float(r.get("qtd_caixas"))

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
    total_previsto = sum(
        qtd
        for linha in LINHAS
        for mes, qtd in planejado_linha[linha].items()
        if mes >= MES_ATUAL
    )
    total_projetado = total_real + total_previsto
    total_orcado = sum(
        qtd
        for linha in LINHAS
        for qtd in orcado_linha[linha].values()
    )

    meses_list = []
    linhas_list = []

    for mes in range(1, 13):
        real_mes = 0.0
        previsto_mes = 0.0
        orcado_mes = 0.0

        for linha in LINHAS:
            realizado = real_linha[linha].get(mes, 0.0)
            planejado = planejado_linha[linha].get(mes, 0.0)
            orcado = orcado_linha[linha].get(mes, 0.0)

            real_val = round(realizado) if mes <= ultimo_mes_fechado else None
            previsto_val = round(planejado) if mes >= MES_ATUAL else None
            atingimento = round(realizado / planejado * 100, 1) if mes <= ultimo_mes_fechado and planejado else None

            linhas_list.append({
                "mes": mes,
                "linha": linha,
                "realizado": real_val,
                "planejado": round(planejado),
                "previsto": previsto_val,
                "orcado": round(orcado),
                "atingimento": atingimento,
            })

            if mes <= ultimo_mes_fechado:
                real_mes += realizado
            if mes >= MES_ATUAL:
                previsto_mes += planejado
            orcado_mes += orcado

        meses_list.append({
            "mes": mes,
            "real": round(real_mes) if mes <= ultimo_mes_fechado else None,
            "previsto": round(previsto_mes) if mes >= MES_ATUAL else None,
            "orcado": round(orcado_mes),
        })

    return {
        "total_real": round(total_real),
        "total_previsto": round(total_previsto),
        "total_projetado": round(total_projetado),
        "total_orcado": round(total_orcado),
        "pct_atingimento": round(total_projetado / total_orcado * 100, 1) if total_orcado else 0,
        "delta_caixas": round(total_projetado - total_orcado),
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "meses": meses_list,
        "linhas": linhas_list,
    }




# ─── Demanda vs. Disponibilidade mensal ──────────────────────────────────────

@router.get("/disponibilidade-mensal")
async def get_disponibilidade_mensal():
    ultimo_mes_fechado = MES_ATUAL - 1

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

    rows_estoque = _select_all(
        supabase.table("f_estoque")
        .select("mes, ano, produto, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )
    rows_sd3 = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, produto, grupo, quantidade")
        .eq("ano", ANO_ATUAL)
    )
    rows_prev = _select_all(
        supabase.table("f_entradas_previstas")
        .select("mes, ano, grupo, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )
    rows_sd2 = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, produto, grupo, quantidade")
        .eq("ano", ANO_ATUAL)
    )
    rows_forecast = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, cod_produto, grupo, qtd_forecast")
        .eq("ano", ANO_ATUAL)
    )

    estoque_real: dict[int, float] = {}
    estoque_por_grupo_real: dict[int, dict[str, float]] = {}

    entradas_reais: dict[int, float] = {}
    entradas_reais_por_grupo: dict[int, dict[str, float]] = {}

    entradas_previstas: dict[int, float] = {}
    entradas_previstas_por_grupo: dict[int, dict[str, float]] = {}

    saidas_reais: dict[int, float] = {}
    saidas_reais_por_grupo: dict[int, dict[str, float]] = {}

    forecast: dict[int, float] = {}
    forecast_por_grupo: dict[int, dict[str, float]] = {}

    produtos_estoque_sem_dimensao: set[str] = set()
    produtos_entradas_sem_dimensao: set[str] = set()
    produtos_saidas_sem_dimensao: set[str] = set()
    produtos_forecast_sem_dimensao: set[str] = set()

    for r in rows_estoque:
        mes = int(r["mes"])
        qtd = _to_float(r.get("qtd_caixas"))
        grupo = grupo_por_produto(r.get("produto"), None, produtos_estoque_sem_dimensao)

        soma_dict(estoque_real, mes, qtd)
        soma_grupo(estoque_por_grupo_real, mes, grupo, qtd)

    for r in rows_sd3:
        mes = int(r["mes"])
        qtd = _to_float(r.get("quantidade"))
        grupo = grupo_por_produto(r.get("produto"), r.get("grupo"), produtos_entradas_sem_dimensao)

        soma_dict(entradas_reais, mes, qtd)
        soma_grupo(entradas_reais_por_grupo, mes, grupo, qtd)

    for r in rows_prev:
        mes = int(r["mes"])
        qtd = _to_float(r.get("qtd_caixas"))
        grupo = str(r.get("grupo") or "Sem grupo").strip() or "Sem grupo"

        soma_dict(entradas_previstas, mes, qtd)
        soma_grupo(entradas_previstas_por_grupo, mes, grupo, qtd)

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

    meses_list = []

    estoque_total_anterior: float | None = None
    estoque_grupo_anterior: dict[str, float] = {}
    entrada_total_anterior = 0.0
    entrada_grupo_anterior: dict[str, float] = {}
    saida_total_anterior = 0.0
    saida_grupo_anterior: dict[str, float] = {}

    for mes in range(1, 13):
        tem_estoque_real = mes in estoque_real

        if tem_estoque_real and mes <= MES_ATUAL:
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
            "mes_label": ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][mes - 1],
            "estoque_inicio": round(estoque_inicio),
            "estoque_inicio_tipo": estoque_tipo,
            "estoque_inicio_por_grupo": grupos_para_lista(estoque_grupo_base, estoque_inicio),
            "entradas": round(entradas),
            "entradas_tipo": entradas_tipo,
            "entradas_por_grupo": grupos_para_lista(entradas_grupo, entradas),
            "saidas": round(saidas),
            "saidas_tipo": saidas_tipo,
            "saidas_por_grupo": grupos_para_lista(saidas_grupo, saidas),
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
        "ano": ANO_ATUAL,
        "mes_atual": MES_ATUAL,
        "ultimo_mes_fechado": ultimo_mes_fechado,
        "meses": meses_list,
        "debug_produtos_estoque_sem_dimensao": sorted(produtos_estoque_sem_dimensao),
        "debug_produtos_entradas_sem_dimensao": sorted(produtos_entradas_sem_dimensao),
        "debug_produtos_saidas_sem_dimensao": sorted(produtos_saidas_sem_dimensao),
        "debug_produtos_forecast_sem_dimensao": sorted(produtos_forecast_sem_dimensao),
    }


@router.get("/entradas-reais-mensal")
async def get_entradas_reais_mensal():
    rows = _select_all(
        supabase.table("f_sd3_entradas")
        .select("mes, ano, quantidade")
        .eq("ano", ANO_ATUAL)
    )
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("quantidade"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/forecast-mensal")
async def get_forecast_mensal():
    rows = _select_all(
        supabase.table("f_forecast_sop")
        .select("mes, ano, qtd_forecast")
        .eq("ano", ANO_ATUAL)
    )
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("qtd_forecast"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/vendas-reais-mensal")
async def get_vendas_reais_mensal():
    rows = _select_all(
        supabase.table("f_sd2_saidas")
        .select("mes, ano, quantidade")
        .eq("ano", ANO_ATUAL)
    )
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("quantidade"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]


@router.get("/estoque-mensal")
async def get_estoque_mensal():
    rows = _select_all(
        supabase.table("f_estoque")
        .select("mes, ano, qtd_caixas")
        .eq("ano", ANO_ATUAL)
    )
    meses: dict[int, float] = {}
    for r in rows:
        mes = int(r["mes"])
        meses[mes] = meses.get(mes, 0.0) + _to_float(r.get("qtd_caixas"))
    return [{"mes": m, "qtd_caixas": round(q)} for m, q in sorted(meses.items())]
