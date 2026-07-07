"""
Router de contexto para o PCP Chat.
Endpoints auxiliares que buscam dados reais do banco para alimentar o chat com IA.
"""

from fastapi import APIRouter, Query
from app.database import supabase

router = APIRouter(prefix="/chat-context", tags=["chat-context"])


def _select_all(query, page_size: int = 1000) -> list:
    rows = []
    start = 0
    while True:
        res = query.range(start, start + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


@router.get("/estoque-produto")
def get_estoque_produto(cod_produto: str = Query(..., description="Código do produto")):
    """
    Retorna o saldo disponível do produto por armazém,
    usando o snapshot mais recente da f_estoque_saldo.
    """

    # Normaliza o código (remove zeros à esquerda e .0)
    cod = str(cod_produto).strip()
    if cod.endswith(".0"):
        cod = cod[:-2]
    try:
        cod_int = str(int(float(cod))).zfill(5)
    except Exception:
        cod_int = cod.zfill(5)

    # Busca todos os snapshots disponíveis (ordenados por data)
    snapshots_res = (
        supabase.table("f_estoque_saldo")
        .select("snapshot_id, data_ref")
        .eq("codigo", cod_int)
        .order("data_ref", desc=True)
        .limit(1)
        .execute()
    )

    if not snapshots_res.data:
        # Tenta sem zfill
        snapshots_res = (
            supabase.table("f_estoque_saldo")
            .select("snapshot_id, data_ref")
            .eq("codigo", cod)
            .order("data_ref", desc=True)
            .limit(1)
            .execute()
        )

    if not snapshots_res.data:
        return {
            "cod_produto": cod_int,
            "snapshot_mais_recente": None,
            "data_ref": None,
            "armazens": [],
            "total_disponivel": 0,
            "mensagem": f"Nenhum registro encontrado para o produto {cod_int} na base de estoque (SB8).",
        }

    snapshot_id = snapshots_res.data[0]["snapshot_id"]
    data_ref = snapshots_res.data[0]["data_ref"]

    # Busca todos os registros desse snapshot para o produto
    rows = _select_all(
        supabase.table("f_estoque_saldo")
        .select("codigo, descricao, armazem, saldo_lote, saldo_bruto, empenho_lote, lote, data_validade")
        .eq("snapshot_id", snapshot_id)
        .eq("codigo", cod_int)
    )

    if not rows:
        rows = _select_all(
            supabase.table("f_estoque_saldo")
            .select("codigo, descricao, armazem, saldo_lote, saldo_bruto, empenho_lote, lote, data_validade")
            .eq("snapshot_id", snapshot_id)
            .eq("codigo", cod)
        )

    # Agrupa por armazém
    por_armazem: dict[str, dict] = {}
    descricao = ""

    for r in rows:
        arm = str(r.get("armazem") or "").strip()
        saldo = float(r.get("saldo_lote") or 0)
        bruto = float(r.get("saldo_bruto") or 0)
        empenho = float(r.get("empenho_lote") or 0)

        if not descricao and r.get("descricao"):
            descricao = str(r["descricao"]).strip()

        if arm not in por_armazem:
            por_armazem[arm] = {
                "armazem": arm,
                "saldo_disponivel": 0.0,
                "saldo_bruto": 0.0,
                "empenho": 0.0,
                "lotes": [],
            }

        por_armazem[arm]["saldo_disponivel"] += saldo
        por_armazem[arm]["saldo_bruto"] += bruto
        por_armazem[arm]["empenho"] += empenho

        lote = str(r.get("lote") or "").strip()
        validade = str(r.get("data_validade") or "").strip()
        if lote:
            por_armazem[arm]["lotes"].append({
                "lote": lote,
                "saldo_disponivel": round(saldo, 3),
                "data_validade": validade or None,
            })

    armazens = sorted(por_armazem.values(), key=lambda x: x["armazem"])
    total = sum(a["saldo_disponivel"] for a in armazens)

    # Nome amigável dos armazéns
    NOMES_ARMAZEM = {
        "01": "01 — Matéria-Prima (disponível)",
        "98": "98 — Quarentena (CQ)",
        "04": "04 — PA Linha 1",
        "07": "07 — PA Linha 2",
    }

    for a in armazens:
        a["armazem_nome"] = NOMES_ARMAZEM.get(a["armazem"], f"Armazém {a['armazem']}")
        a["saldo_disponivel"] = round(a["saldo_disponivel"], 3)
        a["saldo_bruto"] = round(a["saldo_bruto"], 3)
        a["empenho"] = round(a["empenho"], 3)

    return {
        "cod_produto": cod_int,
        "descricao": descricao,
        "snapshot_mais_recente": snapshot_id,
        "data_ref": data_ref,
        "armazens": armazens,
        "total_disponivel": round(total, 3),
    }