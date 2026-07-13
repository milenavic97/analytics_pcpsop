"""
Integração automática com a API da Cogtive pra apontamentos de produção.

Substitui o processo manual de: entrar na Cogtive, extrair o relatório,
subir o arquivo na ferramenta. Busca direto da API e grava em
f_apontamentos, reaproveitando a mesma lógica de "substituir por mês"
que já existe pro upload manual (backend/app/routers/upload.py).

Sempre busca do dia 01/01 do ano atual até hoje, e substitui os meses
cobertos por esse período -- igual ao processo manual, que sobe a base
do ano inteiro e deixa o sistema sobrescrever.
"""

from datetime import date, datetime, timezone
import time
import logging
import uuid

import httpx

from app.config import settings
from app.database import supabase
from app.routers.upload import _delete_apontamentos_mes, _inicio_fim_mes
from etl.processors import _chunk_insert

logger = logging.getLogger("uvicorn.error")

COGTIVE_BASE_URL = "https://api.cogtive.com.br"
PAGE_SIZE = 1000
TIMEOUT_SEGUNDOS = 60


def _classifica_etapa(equipamento: str) -> str:
    e = (equipamento or "").upper()
    if "LAVADORA" in e:
        return "LAVAGEM"
    if "ENVASADORA" in e or "ENVASE" in e or " ENV" in f" {e}":
        return "ENVASE"
    if "FABRIMA" in e or "BAUSCH" in e or "EMBAL" in e:
        return "EMBALAGEM"
    return "OUTRO"


def _unidades_configuradas() -> list[int]:
    bruto = settings.cogtive_unidades or ""
    unidades = []
    for parte in bruto.split(","):
        parte = parte.strip()
        if parte.isdigit():
            unidades.append(int(parte))
    return unidades


def _buscar_pagina_cogtive(
    client: httpx.Client,
    unidades: list[int],
    data_inicio_iso: str,
    data_fim_iso: str,
    offset: int,
) -> dict:
    params = [("StartDate", data_inicio_iso), ("EndDate", data_fim_iso),
              ("Limit", PAGE_SIZE), ("Offset", offset)]
    for u in unidades:
        params.append(("IndustrialUnityIds", u))

    ultimo_erro = None
    for tentativa in range(3):
        try:
            resp = client.get("/v1/notes", params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            ultimo_erro = e
            if tentativa < 2:
                time.sleep(2)

    raise RuntimeError(f"Falha ao buscar apontamentos na Cogtive: {ultimo_erro}")


def _transformar_nota_cogtive(nota: dict) -> dict | None:
    """
    Converte um registro da API (schema Note) no mesmo formato de linha
    usado por etl.processors.process_apontamentos (o que vem do Excel).

    Mesma regra do processo manual: sem lote vinculado, ignora a linha
    (eventos de equipamento sem lote/OP associado não entram na base de
    rastreamento de lotes).
    """
    batch = nota.get("Batch")
    if not batch:
        return None

    lote = str(batch.get("SecondaryNumber") or "").strip()
    if not lote:
        return None

    data_inicial = nota.get("StartDate")
    if not data_inicial:
        return None

    equipamento = str((nota.get("Equipment") or {}).get("Name") or "")
    produto = (batch.get("Product") or {})
    evento = nota.get("Event") or {}

    data_final = nota.get("EndDate")
    duracao_h = 0.0
    if data_inicial and data_final:
        try:
            ini = datetime.fromisoformat(data_inicial)
            fim = datetime.fromisoformat(data_final)
            if fim > ini:
                duracao_h = max(0.0, (fim - ini).total_seconds() / 3600.0)
        except Exception:
            duracao_h = 0.0

    return {
        "data_inicial": data_inicial,
        "data_final": data_final,
        "duracao_h": duracao_h,
        "tag": str(nota.get("Id") or ""),
        "equipamento": equipamento,
        "etapa": _classifica_etapa(equipamento),
        "ordem": str(batch.get("Number") or ""),
        "lote": lote,
        "produto": str(produto.get("Name") or ""),
        "sku": str(produto.get("Sku") or ""),
        "qtd_produzida": float(nota.get("ProductionCount") or 0),
        "qtd_rejeitada": float(nota.get("RejectCount") or 0),
        "tipo_evento": str(evento.get("Name") or ""),
        "evento": str(evento.get("Class") or ""),
        "situacao": str(nota.get("Status") or ""),
    }


def sincronizar_apontamentos_cogtive(escopo_completo: bool = True) -> dict:
    """
    Busca da API da Cogtive os apontamentos de produção e substitui os
    meses cobertos em f_apontamentos -- mesmo comportamento do upload
    manual com modo=replace_month, só que disparado sozinho (ver
    app/main.py).

    escopo_completo=True: busca do dia 01/01 do ano atual até hoje (mais
    lento, mas pega qualquer correção retroativa antiga -- ver rodada das
    6h em app/main.py).
    escopo_completo=False: busca só do mês atual + mês anterior até hoje
    (mais rápido, cobre o caso comum de correção recente -- rodadas das
    12h/18h).
    """
    if not settings.cogtive_api_token:
        return {"ok": False, "motivo": "COGTIVE_API_TOKEN não configurado."}

    unidades = _unidades_configuradas()
    if not unidades:
        return {"ok": False, "motivo": "Nenhuma unidade industrial configurada (COGTIVE_UNIDADES)."}

    hoje = date.today()

    if escopo_completo:
        data_inicio = date(hoje.year, 1, 1)
        primeiro_mes_substituido = 1
    else:
        mes_anterior = hoje.month - 1 if hoje.month > 1 else 12
        ano_mes_anterior = hoje.year if hoje.month > 1 else hoje.year - 1
        data_inicio = date(ano_mes_anterior, mes_anterior, 1)
        primeiro_mes_substituido = mes_anterior if ano_mes_anterior == hoje.year else 1

    from datetime import timedelta
    data_fim_exclusiva = datetime.combine(hoje, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)

    data_inicio_iso = datetime.combine(data_inicio, datetime.min.time(), tzinfo=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    data_fim_iso = data_fim_exclusiva.strftime("%Y-%m-%dT%H:%M:%SZ")

    registros: list[dict] = []
    ignorados_sem_lote = 0
    total_api = None

    headers = {"Authorization": f"Bearer {settings.cogtive_api_token}", "accept": "application/json"}

    with httpx.Client(base_url=COGTIVE_BASE_URL, headers=headers, timeout=TIMEOUT_SEGUNDOS) as client:
        offset = 0
        while True:
            pagina = _buscar_pagina_cogtive(client, unidades, data_inicio_iso, data_fim_iso, offset)
            dados = pagina.get("Data") or pagina.get("data") or []
            meta = pagina.get("Meta") or pagina.get("meta") or {}
            total_api = meta.get("Total", meta.get("total", total_api))

            if not dados:
                break

            for nota in dados:
                registro = _transformar_nota_cogtive(nota)
                if registro is None:
                    ignorados_sem_lote += 1
                    continue
                registros.append(registro)

            retornado = meta.get("Returned", meta.get("returned", len(dados)))
            offset += retornado

            if retornado < PAGE_SIZE:
                break
            if total_api is not None and offset >= total_api:
                break

    if not registros:
        return {
            "ok": False,
            "motivo": "Nenhum apontamento válido retornado pela API nesse período.",
            "total_api": total_api,
            "ignorados_sem_lote": ignorados_sem_lote,
        }

    # Substitui só os meses realmente cobertos pela busca (ano inteiro ou
    # janela recente), igual ao upload manual faz com o arquivo enviado.
    deletes = []
    for mes_ref in range(primeiro_mes_substituido, hoje.month + 1):
        deletes.append(_delete_apontamentos_mes(hoje.year, mes_ref))

    erros_insert = _chunk_insert("f_apontamentos", registros)
    total_inseridos = len(registros) - len(erros_insert)

    # Registra a sincronização em upload_log -- mesma tabela que o upload
    # manual usa. É daqui que a Overview/Rastreamento de Lotes lê o relógio
    # "Dados de produção atualizados em"; sem esse registro, esse relógio
    # nunca avançava sozinho, mesmo com a sincronização automática rodando
    # de verdade a cada ciclo (só um upload manual antigo aparecia ali).
    try:
        supabase.table("upload_log").insert({
            "id": str(uuid.uuid4()),
            "base_id": "apontamentos",
            "nome_arquivo": "Sincronização automática Cogtive",
            "status": "sucesso" if not erros_insert else "erro_parcial",
            "total_inserido": total_inseridos,
            "erros": (erros_insert or [])[:20],
        }).execute()
    except Exception as e:
        # Nunca deixa uma falha aqui derrubar a sincronização em si -- o
        # dado já foi gravado em f_apontamentos, só o registro de log que
        # não entrou.
        logger.warning("Falha ao registrar sincronização Cogtive em upload_log: %s", str(e)[:300])

    return {
        "ok": True,
        "escopo_completo": escopo_completo,
        "total_api": total_api,
        "total_inseridos": total_inseridos,
        "ignorados_sem_lote": ignorados_sem_lote,
        "erros_insert": erros_insert[:5],
        "meses_substituidos": [f"{hoje.year}-{str(m).zfill(2)}" for m in range(primeiro_mes_substituido, hoje.month + 1)],
        "periodo_buscado": {"inicio": data_inicio_iso, "fim": data_fim_iso},
    }