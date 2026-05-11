"""
Router do PCP Chat — integração com a API da Anthropic.

Recebe mensagem do usuário + histórico + página atual,
busca os dados de contexto e chama claude-sonnet-4-20250514.

A ANTHROPIC_API_KEY deve estar como variável de ambiente no Fly.io:
  fly secrets set ANTHROPIC_API_KEY=sk-ant-...
"""

import os
import json
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase

router = APIRouter(prefix="/chat", tags=["chat"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"


# ─── Schemas ──────────────────────────────────────────────────────────────────

class MensagemHistorico(BaseModel):
    role: str   # "user" | "assistant"
    text: str


class ChatRequest(BaseModel):
    mensagem: str
    pagina: str         # "ordens" | "overview" | "producao" | "geral"
    mes_ref: str | None = None
    historico: list[MensagemHistorico] = []


# ─── Busca de contexto ────────────────────────────────────────────────────────

def _get_mes_atual() -> str:
    from datetime import date
    hoje = date.today()
    return f"{hoje.year}-{str(hoje.month).padStart(2, '0')}" if False else f"{hoje.year}-{hoje.month:02d}"


async def _buscar_contexto_ordens(mes_ref: str) -> dict:
    try:
        res = (
            supabase.table("f_programacao_ops")
            .select("lote, codigo, produto, linha, quantidade, data_fim, data_inicio_fabricacao, op_numero, status")
            .eq("mes_ref", mes_ref)
            .execute()
        )
        ops = res.data or []

        # Busca estoque saldo resumido dos componentes mais críticos
        return {
            "mes_ref": mes_ref,
            "total_ops": len(ops),
            "ops": ops[:80],  # limita para não estourar context window
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_contexto_overview() -> dict:
    try:
        res_fat = supabase.table("f_sd2_saidas").select("mes, ano, quantidade").execute()
        res_lib = supabase.table("f_sd3_entradas").select("mes, ano, quantidade").execute()
        return {
            "saidas": (res_fat.data or [])[:50],
            "entradas": (res_lib.data or [])[:50],
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_contexto_producao() -> dict:
    try:
        res = supabase.table("f_apontamentos").select("lote, etapa, equipamento, qtd_produzida, sku, tipo_evento").limit(100).execute()
        return {"apontamentos": res.data or []}
    except Exception as e:
        return {"erro": str(e)}


async def _montar_contexto(pagina: str, mes_ref: str | None) -> str:
    mes = mes_ref or _get_mes_atual()

    if pagina == "ordens":
        dados = await _buscar_contexto_ordens(mes)
        return f"""Você tem acesso aos dados reais de Ordens de Produção (OPs) do mês {mes}.

DADOS DAS OPs:
{json.dumps(dados, ensure_ascii=False, indent=2)}

Status possíveis:
- "aberta": OP já emitida no Protheus (tem número de OP)
- "ok": pronta para abrir (material disponível)
- "falta": material insuficiente no estoque
- "quarentena": material disponível só no armazém 98 (CQ)
- "sem_bom": produto sem estrutura de materiais cadastrada

Linhas: ENVASE_L1, ENVASE_L2, EMBALAGEM
"""

    if pagina == "overview":
        dados = await _buscar_contexto_overview()
        return f"""Você tem acesso aos dados reais de faturamento e liberações de {mes}.

DADOS:
{json.dumps(dados, ensure_ascii=False, indent=2)}
"""

    if pagina == "producao":
        dados = await _buscar_contexto_producao()
        return f"""Você tem acesso aos dados reais de produção e apontamentos.

DADOS:
{json.dumps(dados, ensure_ascii=False, indent=2)}
"""

    return "Você é o assistente do PCP Analytics. Ainda não há dados carregados para esta página."


# ─── Endpoint principal ───────────────────────────────────────────────────────

@router.post("/mensagem")
async def chat_mensagem(req: ChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY não configurada no servidor.")

    contexto = await _montar_contexto(req.pagina, req.mes_ref)

    system_prompt = f"""Você é o PCP Chat, assistente especializado em Planejamento e Controle da Produção (PCP) de uma indústria farmacêutica que fabrica anestésicos odontológicos (tubetes).

Seu papel é responder perguntas sobre os dados reais da tela atual do sistema PCP Analytics.

{contexto}

REGRAS:
- Responda sempre em português brasileiro
- Seja direto e objetivo — o usuário é um analista de PCP
- Use os dados fornecidos acima para responder com precisão
- Quando listar itens, use marcadores (•) e negrito (**texto**) para destacar o que importa
- Se não souber algo com base nos dados, diga claramente
- Não invente dados — use apenas o que foi fornecido
- Foque no que é acionável: o que pode ser aberto, o que está bloqueado, o que precisa de ação
"""

    # Monta histórico para a API (últimas 10 mensagens para não estourar context)
    messages = []
    for msg in req.historico[-10:]:
        messages.append({
            "role": msg.role,
            "content": msg.text,
        })
    messages.append({
        "role": "user",
        "content": req.mensagem,
    })

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                ANTHROPIC_URL,
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": MODEL,
                    "max_tokens": 1024,
                    "system": system_prompt,
                    "messages": messages,
                },
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Erro na API da Anthropic: {response.text}"
            )

        data = response.json()
        texto = data["content"][0]["text"]

        return {"resposta": texto}

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout na API da Anthropic.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))