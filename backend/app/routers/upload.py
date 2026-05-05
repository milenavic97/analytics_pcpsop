"""
Router de upload — recebe o Excel, salva no Storage,
processa via ETL e registra no upload_log.
"""

import io
import uuid
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.database import supabase
from etl.processors import (
    process_d_produtos,
    process_orcado_liberacao,
    process_orcado_faturamento,
    process_forecast_sop,
    process_sd2_saidas,
    process_sd3_entradas,
    process_estoque,
    process_producao_real,
    process_entradas_previstas,
)

router = APIRouter(prefix="/upload", tags=["upload"])

# (processador, sheet, header_default, colunas_chave_pra_detectar_header)
# Quando header_default = None, lê o Excel SEM cabeçalho (todas as linhas viram dados).
# Necessário pra entradas_previstas porque a primeira linha é "LINHA 1 (CAIXAS)" — uma seção,
# não cabeçalho. Se ler com header=0, essa linha vira nome de coluna e o ETL não detecta L1.
BASES = {
    "d_produtos":          (process_d_produtos,          0, 0,    None),
    "orcado_liberacao":    (process_orcado_liberacao,    0, 0,    None),
    "orcado_faturamento":  (process_orcado_faturamento,  0, 0,    None),
    "forecast_sop":        (process_forecast_sop,        0, 0,    None),
    "sd2_saidas":          (process_sd2_saidas,          0, 2,    ["Produto", "Quantidade", "Armazem", "Grupo"]),
    "sd3_entradas":        (process_sd3_entradas,        0, 2,    ["Produto", "Quantidade", "Armazem", "Grupo"]),
    "estoque":             (process_estoque,             0, 2,    ["Produto", "Armazem", "Data Saldo"]),
    "producao_real":       (process_producao_real,       0, 0,    None),
    "entradas_previstas":  (process_entradas_previstas,  0, None, None),
}


def _detectar_header(conteudo: bytes, sheet, default_header: int | None, colunas_chave: list[str] | None) -> int | None:
    """
    Procura em qual linha do Excel as colunas-chave aparecem como cabeçalho.
    Se default_header é None, retorna None (lê o arquivo sem cabeçalho).
    """
    if default_header is None:
        return None
    if not colunas_chave:
        return default_header

    melhor_h = None
    melhor_match = 0

    for h in range(0, 8):
        try:
            df_test = pd.read_excel(io.BytesIO(conteudo), sheet_name=sheet, header=h, nrows=0)
            cols = [str(c).strip() for c in df_test.columns]
            n_match = sum(1 for chave in colunas_chave if any(chave == c for c in cols))

            if n_match == len(colunas_chave):
                return h

            if n_match > melhor_match:
                melhor_match = n_match
                melhor_h = h
        except Exception:
            continue

    if melhor_h is not None and melhor_match >= len(colunas_chave) * 0.75:
        return melhor_h

    return default_header


def _ler_excel(conteudo: bytes, sheet, header: int | None) -> pd.DataFrame:
    return pd.read_excel(io.BytesIO(conteudo), sheet_name=sheet, header=header)


@router.post("/{base_id}")
async def upload_base(base_id: str, file: UploadFile = File(...)):
    if base_id not in BASES:
        raise HTTPException(status_code=404, detail=f"Base '{base_id}' não encontrada.")

    processador, sheet, header_default, colunas_chave = BASES[base_id]
    conteudo = await file.read()

    header = _detectar_header(conteudo, sheet, header_default, colunas_chave)

    storage_path = f"{base_id}/{uuid.uuid4()}_{file.filename}"
    try:
        supabase.storage.from_("uploads").upload(storage_path, conteudo)
    except Exception:
        storage_path = None

    log_id = str(uuid.uuid4())
    supabase.table("upload_log").insert({
        "id":           log_id,
        "base_id":      base_id,
        "nome_arquivo": file.filename,
        "storage_path": storage_path,
        "status":       "processando",
    }).execute()

    try:
        df = _ler_excel(conteudo, sheet, header)
        total, erros = processador(df)

        supabase.table("upload_log").update({
            "status":          "sucesso" if not erros else "erro",
            "total_registros": total,
            "erros":           erros[:20] if erros else None,
        }).eq("id", log_id).execute()

        return {
            "status":         "sucesso" if not erros else "erro_parcial",
            "total_inserido": total,
            "erros":          erros[:20],
            "storage_path":   storage_path,
        }

    except Exception as e:
        supabase.table("upload_log").update({
            "status": "erro",
            "erros":  [str(e)],
        }).eq("id", log_id).execute()
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/log")
async def listar_logs():
    res = (
        supabase.table("upload_log")
        .select("*")
        .order("processado_em", desc=True)
        .limit(50)
        .execute()
    )
    return res.data


@router.get("/status/{base_id}")
async def status_base(base_id: str):
    res = (
        supabase.table("upload_log")
        .select("*")
        .eq("base_id", base_id)
        .order("processado_em", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else {"status": "sem_dados"}