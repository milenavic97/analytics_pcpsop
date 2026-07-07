from fastapi import APIRouter, HTTPException
from app.database import supabase
from collections import defaultdict
from datetime import datetime

router = APIRouter(
    prefix="/calendario-paradas",
    tags=["calendario-paradas"]
)


@router.get("/")
async def listar_paradas():
    try:
        res = (
            supabase
            .table("f_calendario_paradas")
            .select("*")
            .order("data")
            .execute()
        )

        return res.data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/resumo")
async def resumo_paradas():
    try:
        res = (
            supabase
            .table("f_calendario_paradas")
            .select("*")
            .execute()
        )

        dados = res.data or []

        total_paradas = len(dados)

        por_linha = defaultdict(int)

        for item in dados:
            linha = item.get("linha") or "OUTROS"
            por_linha[linha] += 1

        proxima = None

        hoje = datetime.now().date()

        futuras = []

        for item in dados:
            try:
                data = datetime.fromisoformat(item["data"]).date()

                if data >= hoje:
                    futuras.append(item)

            except Exception:
                continue

        futuras.sort(key=lambda x: x["data"])

        if futuras:
            proxima = futuras[0]

        return {
            "total_paradas": total_paradas,
            "por_linha": por_linha,
            "proxima_parada": proxima,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def criar_parada(body: dict):
    try:
        supabase.table("f_calendario_paradas")\
            .insert(body)\
            .execute()

        return {"ok": True}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{id}")
async def editar_parada(id: str, body: dict):
    try:
        supabase.table("f_calendario_paradas")\
            .update(body)\
            .eq("id", id)\
            .execute()

        return {"ok": True}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{id}")
async def excluir_parada(id: str):
    try:
        supabase.table("f_calendario_paradas")\
            .delete()\
            .eq("id", id)\
            .execute()

        return {"ok": True}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))