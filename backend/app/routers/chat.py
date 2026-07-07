"""
Router do PCP Chat — integração com a API da Anthropic.
"""

import os
import json
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import date

router = APIRouter(prefix="/chat", tags=["chat"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"
BASE_URL = "https://dfl-sop-api.fly.dev"


class MensagemHistorico(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    mensagem: str
    pagina: str
    mes_ref: str | None = None
    historico: list[MensagemHistorico] = []


def _get_mes_atual() -> str:
    hoje = date.today()
    return f"{hoje.year}-{hoje.month:02d}"


async def _buscar_contexto_ordens(mes_ref: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{BASE_URL}/ops/viabilidade",
                params={"mes_ref": mes_ref},
            )
        if response.status_code != 200:
            raise Exception(f"Erro ao buscar OPs: {response.text}")

        data = response.json()

        ops_simplificadas = []
        for op in (data.get("ops") or [])[:60]:
            ops_simplificadas.append({
                "lote": op.get("lote"),
                "produto": op.get("produto"),
                "linha": op.get("linha"),
                "quantidade": op.get("quantidade"),
                "data_fim": op.get("data_fim"),
                "data_inicio_fabricacao": op.get("data_inicio_fabricacao"),
                "op_numero": op.get("op_numero"),
                "status": op.get("status"),
                "fifo_posicao": op.get("fifo_posicao"),
                "resumo_faltas": op.get("resumo_faltas"),
                "gargalo": op.get("gargalo"),
            })

        return {
            "mes_ref": mes_ref,
            "total_ops": data.get("total_ops"),
            "resumo": data.get("resumo"),
            "materiais_criticos": (data.get("materiais_criticos") or [])[:10],
            "ops": ops_simplificadas,
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_contexto_overview() -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res_fat = await client.get(f"{BASE_URL}/overview/projecao-faturamento")
            res_lib = await client.get(f"{BASE_URL}/overview/projecao-liberacoes")
            res_disp = await client.get(f"{BASE_URL}/overview/disponibilidade-mensal")

        return {
            "faturamento": res_fat.json() if res_fat.status_code == 200 else None,
            "liberacoes": res_lib.json() if res_lib.status_code == 200 else None,
            "disponibilidade_mensal": res_disp.json() if res_disp.status_code == 200 else None,
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_contexto_producao() -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res_comp = await client.get(f"{BASE_URL}/producao/mps-comparativo-real-planejado")
            res_l1 = await client.get(f"{BASE_URL}/producao/paradas-pareto", params={"linha": "L1"})
            res_l2 = await client.get(f"{BASE_URL}/producao/paradas-pareto", params={"linha": "L2"})
            res_resumo = await client.get(f"{BASE_URL}/producao/resumo-mensal")

        return {
            "comparativo_mps": res_comp.json() if res_comp.status_code == 200 else None,
            "paradas_l1": res_l1.json() if res_l1.status_code == 200 else None,
            "paradas_l2": res_l2.json() if res_l2.status_code == 200 else None,
            "resumo_mensal": res_resumo.json() if res_resumo.status_code == 200 else None,
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_contexto_atendimento(mes_ref: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res_sku = await client.get(f"{BASE_URL}/overview/atendimento-sku")
            res_rastr = await client.get(f"{BASE_URL}/overview/rastreamento-lotes")

        return {
            "atendimento_sku": res_sku.json() if res_sku.status_code == 200 else None,
            "rastreamento_lotes": res_rastr.json() if res_rastr.status_code == 200 else None,
        }
    except Exception as e:
        return {"erro": str(e)}


async def _buscar_estoque_produto(cod_produto: str) -> dict:
    """Busca saldo de um produto específico por armazém (SB8 mais recente)."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                f"{BASE_URL}/chat-context/estoque-produto",
                params={"cod_produto": cod_produto},
            )
        return res.json() if res.status_code == 200 else {"erro": f"HTTP {res.status_code}"}
    except Exception as e:
        return {"erro": str(e)}


def _detectar_codigo_produto(mensagem: str) -> str | None:
    """Extrai código numérico de produto da mensagem (4-6 dígitos)."""
    import re
    matches = re.findall(r"\b(\d{4,6})\b", mensagem)
    for m in matches:
        try:
            n = int(m)
            if 40000 <= n <= 99999:
                return m
        except Exception:
            pass
    return None


async def _montar_contexto(pagina: str, mes_ref: str | None, mensagem: str = "") -> str:
    mes = mes_ref or _get_mes_atual()

    # Detecta se pergunta sobre estoque de produto específico
    cod_produto = _detectar_codigo_produto(mensagem)
    contexto_estoque = ""
    if cod_produto and any(w in mensagem.lower() for w in ["estoque", "saldo", "tem ", "disponível", "disponivel", "armazém", "armazem", "sb8", "quanto"]):
        dados_estoque = await _buscar_estoque_produto(cod_produto)
        contexto_estoque = f"""

ESTOQUE DO PRODUTO {cod_produto} (SB8 mais recente):
{json.dumps(dados_estoque, ensure_ascii=False, indent=2)}

IMPORTANTE ao responder sobre estoque:
- Mencione a data_ref do snapshot (data da SB8 usada)
- Liste o saldo disponível por armazém (01 = MP disponível, 98 = quarentena/CQ)
- Informe o total disponível
- Se armazém 98 tiver saldo, avise que está em quarentena aguardando liberação do CQ
"""

    if pagina == "ordens":
        dados = await _buscar_contexto_ordens(mes)
        return f"""Você tem acesso aos dados reais de Ordens de Produção (OPs) do mês {mes}.

DADOS COMPLETOS DAS OPs (incluindo status calculado, gargalos e posição FIFO):
{json.dumps(dados, ensure_ascii=False, indent=2)}

EXPLICAÇÃO DOS CAMPOS:
- status "aberta": OP já emitida no Protheus (tem número de OP)
- status "ok": pronta para abrir (material disponível)
- status "falta": material insuficiente no estoque
- status "quarentena": material disponível só no armazém 98 (CQ — aguardando liberação)
- status "sem_bom": produto sem estrutura de materiais cadastrada
- fifo_posicao: posição na fila FIFO (ordenado por data_inicio_fabricacao)
- gargalo: insumo que está bloqueando a OP, com saldo que chegou vs necessário
- resumo_faltas: texto descritivo do que está faltando
- materiais_criticos: ranking dos insumos que mais bloqueiam OPs

Linhas de produção: ENVASE_L1 (Envase L1), ENVASE_L2 (Envase L2), EMBALAGEM
{contexto_estoque}"""

    if pagina == "overview":
        dados_proj = await _buscar_contexto_overview()
        dados_sku = await _buscar_contexto_atendimento(mes)
        return f"""Você tem acesso aos dados reais do Overview do PCP Analytics.

PROJEÇÕES DE FATURAMENTO E LIBERAÇÕES:
{json.dumps(dados_proj, ensure_ascii=False, indent=2)}

ATENDIMENTO SKU E RASTREAMENTO:
{json.dumps(dados_sku, ensure_ascii=False, indent=2)}

EXPLICAÇÃO:
- faturamento: vendas realizadas vs orçado
- liberacoes: liberações de produto acabado vs previsto
- disponibilidade_mensal: % de disponibilidade por mês
- atendimento_sku: liberações previstas vs realizadas por grupo/SKU
- rastreamento_lotes: checkpoints dos lotes (Lavagem → Envase → Embalagem → Liberado)
{contexto_estoque}"""

    if pagina == "producao":
        dados = await _buscar_contexto_producao()
        return f"""Você tem acesso aos dados reais de Produção do PCP Analytics.

DADOS DE PRODUÇÃO:
{json.dumps(dados, ensure_ascii=False, indent=2)}

EXPLICAÇÃO:
- comparativo_mps: MPS planejado vs realizado por linha/mês
- paradas_l1 / paradas_l2: pareto de paradas por motivo (horas perdidas)
- resumo_mensal: OEE, disponibilidade, produção por linha
{contexto_estoque}"""

    dados_ops = await _buscar_contexto_ordens(mes)
    return f"""Você tem acesso aos dados do PCP Analytics.

DADOS DAS OPs DO MÊS {mes}:
{json.dumps(dados_ops, ensure_ascii=False, indent=2)}

Você pode responder sobre OPs, faturamento, liberações e produção.
{contexto_estoque}"""


@router.post("/mensagem")
async def chat_mensagem(req: ChatRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY não configurada no servidor.")

    contexto = await _montar_contexto(req.pagina, req.mes_ref, req.mensagem)

    system_prompt = f"""Você é o PCP Chat, assistente especializado em Planejamento e Controle da Produção (PCP) de uma indústria farmacêutica que fabrica anestésicos odontológicos injetáveis (tubetes).

Seu papel é responder perguntas sobre os dados reais da tela atual do sistema PCP Analytics com precisão e objetividade.

{contexto}

COMO O SISTEMA É ALIMENTADO (use isso para responder perguntas sobre atualização de dados):

Aba ORDENS DE PRODUÇÃO:
• Base "Programação de OPs" — planilha mensal do SharePoint com as OPs do mês (ENVASE L1, ENVASE L2, EMBALAGEM). Subir na aba Dados > Programação OPs.
• Base "Estoque de Insumos (SB8)" — extrair do Protheus o relatório SB8 com saldo de insumos (armazéns 01 e 98) e subir na aba Dados > Estoque Insumos. Esse arquivo alimenta a verificação de viabilidade.
• Após subir ambas as bases, clicar em "Atualizar" na página de Ordens ou recarregar a página.

Aba OVERVIEW:
• Base "SD3 Entradas" — relatório de liberações reais do Protheus (TP499).
• Base "Forecast S&OP" — planilha de forecast mensal.
• Base "Liberação Diária" — Gantt de lotes (liberacaodia.xlsx) com datas previstas por lote.
• Base "Estoque Mensal" — saldo de estoque início do mês por produto.

Aba PRODUÇÃO:
• Base "Produção Real (Cogtive)" — relatório de apontamentos exportado do Cogtive com equipamentos, eventos e durações.

Regra geral: todas as bases são subidas na aba **Dados** do sistema, selecionando a base correspondente e fazendo upload do arquivo Excel/CSV.

REGRAS DE RESPOSTA:
- Responda sempre em português brasileiro
- Seja direto e objetivo — o usuário é um analista de PCP que precisa tomar decisões rápidas
- Use os dados fornecidos acima para responder com precisão — nunca invente números
- Quando listar itens use marcadores (•) e negrito (**texto**) para destacar o que importa
- NÃO use emojis em nenhuma hipótese — responda apenas com texto puro e formatação com • e **negrito**
- Se a pergunta for sobre algo que não está nos dados, diga claramente que não tem essa informação
- Foque no que é acionável: o que pode ser aberto agora, o que está bloqueado e por quê, o que precisa de ação
- Para OPs: sempre mencione o lote, produto, linha e o gargalo quando relevante
- Para materiais críticos: mencione código, descrição e quantas OPs estão bloqueadas
- Para estoque: sempre informe a data da SB8 usada e o saldo por armazém
- Seja conciso — respostas curtas e diretas são melhores que textos longos
"""

    messages = []
    for msg in req.historico[-10:]:
        messages.append({"role": msg.role, "content": msg.text})
    messages.append({"role": "user", "content": req.mensagem})

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
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
        raise HTTPException(status_code=504, detail="Timeout na API da Anthropic. Tente novamente.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))