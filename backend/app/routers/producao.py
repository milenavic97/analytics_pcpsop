from fastapi import APIRouter
from app.database import supabase
from datetime import date
import re
import unicodedata

router = APIRouter(prefix="/producao", tags=["producao"])

TUBETES_POR_CAIXA = 500
ANO_ATUAL = date.today().year
MES_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


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


def _normaliza_texto(value) -> str:
    texto = str(value or "").strip().upper()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(char for char in texto if not unicodedata.combining(char))
    texto = re.sub(r"\s+", " ", texto)
    return texto


def _linha_from_equipamento(equipamento) -> str | None:
    texto = _normaliza_texto(equipamento)

    if "ENVASADORA" not in texto:
        return None

    if "L2" in texto:
        return "L2"

    if (
        "MAQ 1" in texto
        or "MAQ1" in texto
        or "MAQUINA 1" in texto
        or "MAQUINA1" in texto
        or "MÁQ 1" in texto
    ):
        return "L1"

    if (
        "MAQ 2" in texto
        or "MAQ2" in texto
        or "MAQUINA 2" in texto
        or "MAQUINA2" in texto
        or "MÁQ 2" in texto
    ):
        return "L1"

    return None


def _is_producao(tipo_evento) -> bool:
    return _normaliza_texto(tipo_evento) == "PRODUCAO"


def _pct(numerador: float, denominador: float) -> float:
    if not denominador:
        return 0.0
    return numerador / denominador * 100


def _produtividade(tubetes: float, horas: float) -> float:
    if not horas:
        return 0.0
    return tubetes / horas


@router.get("/resumo-mensal")
async def get_resumo_mensal():
    rows = _select_all(
        supabase.table("f_producao_real")
        .select("mes, ano, equipamento, tipo_evento, evento, duracao_h, qtd_produzida")
        .eq("ano", ANO_ATUAL)
    )

    meses = {
        mes: {
            "mes": mes,
            "mes_label": MES_LABELS[mes - 1],
            "l1_tubetes": 0.0,
            "l2_tubetes": 0.0,
            "l1_caixas": 0.0,
            "l2_caixas": 0.0,
            "l1_horas_produtivas": 0.0,
            "l2_horas_produtivas": 0.0,
            "l1_horas_apontadas": 0.0,
            "l2_horas_apontadas": 0.0,
        }
        for mes in range(1, 13)
    }

    totais = {
        "producao_tubetes": 0.0,
        "producao_caixas": 0.0,
        "horas_produtivas": 0.0,
        "horas_apontadas": 0.0,
        "l1_tubetes": 0.0,
        "l2_tubetes": 0.0,
        "l1_caixas": 0.0,
        "l2_caixas": 0.0,
        "l1_horas_produtivas": 0.0,
        "l2_horas_produtivas": 0.0,
        "l1_horas_apontadas": 0.0,
        "l2_horas_apontadas": 0.0,
    }

    equipamentos_ignorados: dict[str, int] = {}
    eventos_envasadoras: dict[str, float] = {}

    for r in rows:
        linha = _linha_from_equipamento(r.get("equipamento"))

        if linha not in ("L1", "L2"):
            equipamento = str(r.get("equipamento") or "Sem equipamento").strip() or "Sem equipamento"
            equipamentos_ignorados[equipamento] = equipamentos_ignorados.get(equipamento, 0) + 1
            continue

        mes = int(r.get("mes") or 0)
        if mes < 1 or mes > 12:
            continue

        duracao = _to_float(r.get("duracao_h"))
        qtd_produzida = _to_float(r.get("qtd_produzida"))
        is_producao = _is_producao(r.get("tipo_evento"))

        prefixo = "l1" if linha == "L1" else "l2"

        meses[mes][f"{prefixo}_horas_apontadas"] += duracao
        totais["horas_apontadas"] += duracao
        totais[f"{prefixo}_horas_apontadas"] += duracao

        tipo_evento = str(r.get("tipo_evento") or "Sem tipo").strip() or "Sem tipo"
        eventos_envasadoras[tipo_evento] = eventos_envasadoras.get(tipo_evento, 0.0) + duracao

        if is_producao:
            caixas = qtd_produzida / TUBETES_POR_CAIXA

            meses[mes][f"{prefixo}_tubetes"] += qtd_produzida
            meses[mes][f"{prefixo}_caixas"] += caixas
            meses[mes][f"{prefixo}_horas_produtivas"] += duracao

            totais["producao_tubetes"] += qtd_produzida
            totais["producao_caixas"] += caixas
            totais["horas_produtivas"] += duracao

            totais[f"{prefixo}_tubetes"] += qtd_produzida
            totais[f"{prefixo}_caixas"] += caixas
            totais[f"{prefixo}_horas_produtivas"] += duracao

    meses_list = []
    for mes in range(1, 13):
        row = meses[mes]

        l1_horas_prod = row["l1_horas_produtivas"]
        l2_horas_prod = row["l2_horas_produtivas"]
        l1_horas_apont = row["l1_horas_apontadas"]
        l2_horas_apont = row["l2_horas_apontadas"]

        row["l1_tubetes"] = round(row["l1_tubetes"])
        row["l2_tubetes"] = round(row["l2_tubetes"])
        row["l1_caixas"] = round(row["l1_caixas"])
        row["l2_caixas"] = round(row["l2_caixas"])
        row["l1_horas_produtivas"] = round(l1_horas_prod, 2)
        row["l2_horas_produtivas"] = round(l2_horas_prod, 2)
        row["l1_horas_apontadas"] = round(l1_horas_apont, 2)
        row["l2_horas_apontadas"] = round(l2_horas_apont, 2)

        row["l1_tubetes_hora"] = round(_produtividade(row["l1_tubetes"], l1_horas_prod))
        row["l2_tubetes_hora"] = round(_produtividade(row["l2_tubetes"], l2_horas_prod))

        row["l1_aproveitamento_operacional"] = round(_pct(l1_horas_prod, l1_horas_apont), 1)
        row["l2_aproveitamento_operacional"] = round(_pct(l2_horas_prod, l2_horas_apont), 1)

        row["total_tubetes"] = row["l1_tubetes"] + row["l2_tubetes"]
        row["total_caixas"] = row["l1_caixas"] + row["l2_caixas"]
        row["total_horas_produtivas"] = round(l1_horas_prod + l2_horas_prod, 2)
        row["total_horas_apontadas"] = round(l1_horas_apont + l2_horas_apont, 2)

        meses_list.append(row)

    aproveitamento_total = _pct(totais["horas_produtivas"], totais["horas_apontadas"])
    aproveitamento_l1 = _pct(totais["l1_horas_produtivas"], totais["l1_horas_apontadas"])
    aproveitamento_l2 = _pct(totais["l2_horas_produtivas"], totais["l2_horas_apontadas"])

    produtividade_total = _produtividade(totais["producao_tubetes"], totais["horas_produtivas"])
    produtividade_l1 = _produtividade(totais["l1_tubetes"], totais["l1_horas_produtivas"])
    produtividade_l2 = _produtividade(totais["l2_tubetes"], totais["l2_horas_produtivas"])

    eventos_list = [
        {"tipo_evento": tipo, "horas": round(horas, 2)}
        for tipo, horas in sorted(eventos_envasadoras.items(), key=lambda item: item[1], reverse=True)
    ]

    return {
        "ano": ANO_ATUAL,
        "regra_linhas": {
            "L1": ["MÁQ 1 ENVASADORA", "MÁQ 2 ENVASADORA"],
            "L2": ["L2 ENVASADORA"],
        },
        "total_producao_tubetes": round(totais["producao_tubetes"]),
        "total_producao_caixas": round(totais["producao_caixas"]),
        "horas_produtivas": round(totais["horas_produtivas"], 2),
        "horas_apontadas": round(totais["horas_apontadas"], 2),
        "aproveitamento_operacional": round(aproveitamento_total, 1),
        "produtividade_tubetes_hora": round(produtividade_total),
        "l1": {
            "producao_tubetes": round(totais["l1_tubetes"]),
            "producao_caixas": round(totais["l1_caixas"]),
            "horas_produtivas": round(totais["l1_horas_produtivas"], 2),
            "horas_apontadas": round(totais["l1_horas_apontadas"], 2),
            "aproveitamento_operacional": round(aproveitamento_l1, 1),
            "produtividade_tubetes_hora": round(produtividade_l1),
            "mix_pct": round(_pct(totais["l1_tubetes"], totais["producao_tubetes"]), 1),
        },
        "l2": {
            "producao_tubetes": round(totais["l2_tubetes"]),
            "producao_caixas": round(totais["l2_caixas"]),
            "horas_produtivas": round(totais["l2_horas_produtivas"], 2),
            "horas_apontadas": round(totais["l2_horas_apontadas"], 2),
            "aproveitamento_operacional": round(aproveitamento_l2, 1),
            "produtividade_tubetes_hora": round(produtividade_l2),
            "mix_pct": round(_pct(totais["l2_tubetes"], totais["producao_tubetes"]), 1),
        },
        "total_l1_tubetes": round(totais["l1_tubetes"]),
        "total_l2_tubetes": round(totais["l2_tubetes"]),
        "meses": meses_list,
        "eventos_envasadoras": eventos_list,
        "debug_equipamentos_ignorados": equipamentos_ignorados,
    }