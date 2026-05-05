from fastapi import APIRouter, Query, HTTPException
from app.database import supabase
from pydantic import BaseModel
from typing import Any

router = APIRouter(prefix="/dados", tags=["dados"])

TABELAS_PERMITIDAS = {
    "d_produtos":          "d_produtos",
    "orcado_liberacao":    "f_orcado_liberacao",
    "orcado_faturamento":  "f_orcado_faturamento",
    "forecast_sop":        "f_forecast_sop",
    "sd2_saidas":          "f_sd2_saidas",
    "sd3_entradas":        "f_sd3_entradas",
    "entradas_previstas":  "f_entradas_previstas",
    "estoque":             "f_estoque",
    "producao_real":       "f_producao_real",
    "mps_producao":        "f_mps_producao",
    "mps_liberacoes":      "f_mps_liberacoes",
}

PK_MAP = {
    "d_produtos": "cod_produto",
}

def get_pk(tabela: str) -> str:
    return PK_MAP.get(tabela, "id")


@router.get("/{tabela}")
async def listar_dados(
    tabela: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    if tabela not in TABELAS_PERMITIDAS:
        raise HTTPException(status_code=404, detail=f"Base '{tabela}' não encontrada.")
    nome_tabela = TABELAS_PERMITIDAS[tabela]
    offset = (page - 1) * per_page
    res = (
        supabase.table(nome_tabela)
        .select("*", count="exact")
        .range(offset, offset + per_page - 1)
        .execute()
    )
    return {"data": res.data, "total": res.count or 0, "page": page, "per_page": per_page}


class UpsertBody(BaseModel):
    dados: dict[str, Any]


@router.post("/{tabela}")
async def inserir(tabela: str, body: UpsertBody):
    if tabela not in TABELAS_PERMITIDAS:
        raise HTTPException(status_code=404, detail=f"Base '{tabela}' não encontrada.")
    nome_tabela = TABELAS_PERMITIDAS[tabela]
    try:
        supabase.table(nome_tabela).insert(body.dados).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.put("/{tabela}/{pk_value}")
async def atualizar(tabela: str, pk_value: str, body: UpsertBody):
    if tabela not in TABELAS_PERMITIDAS:
        raise HTTPException(status_code=404, detail=f"Base '{tabela}' não encontrada.")
    nome_tabela = TABELAS_PERMITIDAS[tabela]
    pk = get_pk(tabela)
    try:
        supabase.table(nome_tabela).update(body.dados).eq(pk, pk_value).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.delete("/{tabela}")
async def excluir(tabela: str, ids: list[str] = Query(...)):
    if tabela not in TABELAS_PERMITIDAS:
        raise HTTPException(status_code=404, detail=f"Base '{tabela}' não encontrada.")
    nome_tabela = TABELAS_PERMITIDAS[tabela]
    pk = get_pk(tabela)
    try:
        supabase.table(nome_tabela).delete().in_(pk, ids).execute()
        return {"ok": True, "excluidos": len(ids)}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))