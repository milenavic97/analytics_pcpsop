from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import supabase

router = APIRouter(
    prefix="/ajustes-compras-ops",
    tags=["ajustes-compras-ops"],
)


class AjusteCompraOP(BaseModel):
    op_id: str
    lote: Optional[str] = None
    codigo_op: Optional[str] = None
    codigo_comp: str
    pedido_numero: Optional[str] = None
    sc_numero: Optional[str] = None
    qtd_negociada: float = 0
    data_negociada: Optional[str] = None
    observacao: Optional[str] = None


@router.get("")
async def listar_ajustes():
    try:
        res = (
            supabase
            .table("f_ajustes_compras_ops")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )

        return res.data or []

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def salvar_ajuste(body: AjusteCompraOP):
    try:
        payload = body.dict()

        existente = (
            supabase
            .table("f_ajustes_compras_ops")
            .select("id")
            .eq("op_id", body.op_id)
            .eq("codigo_comp", body.codigo_comp)
            .eq("pedido_numero", body.pedido_numero)
            .execute()
        )

        if existente.data:
            ajuste_id = existente.data[0]["id"]

            supabase.table("f_ajustes_compras_ops").update(payload).eq(
                "id",
                ajuste_id
            ).execute()

            return {
                "ok": True,
                "id": ajuste_id,
                "updated": True,
            }

        res = (
            supabase
            .table("f_ajustes_compras_ops")
            .insert(payload)
            .execute()
        )

        return {
            "ok": True,
            "data": res.data,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{ajuste_id}")
async def excluir_ajuste(ajuste_id: str):
    try:
        supabase.table("f_ajustes_compras_ops").delete().eq(
            "id",
            ajuste_id
        ).execute()

        return {"ok": True}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))