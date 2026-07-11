"""
Calcula a Curva ABC (A/B/C) por faturamento real dos últimos 12 meses,
separada por linha de negócio (Anestésicos Injetáveis / PPS / Benzotop),
e grava o resultado em d_produtos.abc_ytm -- a mesma coluna que a tela já
lê hoje (ver "curva_a": gerencial("abc_ytm") em aging_estoque.py).

Regra (validada com o time em 11/07/2026):
  - Corte clássico de Pareto: A até 80% do faturamento acumulado da linha,
    B até 95%, C o resto.
  - O item mais vendido de cada linha é sempre A, mesmo que sozinho já
    ultrapasse 80% (evita o item dominante de uma linha pequena cair
    pra B só pela fórmula de acumulado -- caso real: Benzotop).
  - Descontinuados não entram na classificação.
  - PPS fica como uma linha só, sem separar por Bravi/terceirizado
    (esses continuam identificáveis pela coluna transferencia_bravi,
    só não formam grupo próprio pra fins de ABC).
  - Sem tipo_negocio mapeado, infere a linha pelo nome do produto
    (Benzotop/anestésico injetável conhecido/senão PPS) -- só pra
    códigos que já são relevantes (tipo_negocio bate OU já teve venda
    registrada), nunca pro catálogo inteiro de matéria-prima.
  - Sem faturamento nos últimos 12 meses = Curva C direto.
"""

from datetime import date, datetime, timezone
from collections import defaultdict
import logging

from app.database import supabase

logger = logging.getLogger("uvicorn.error")

LINHAS_CALCULADAS = {"Anestésicos Injetáveis", "PPS", "Benzotop"}
MESES_JANELA = 12

# Quando tipo_negocio não está preenchido em d_produtos, infere a linha pelo
# nome do produto -- baseado nos princípios ativos/marcas de anestésico
# injetável já conhecidos no catálogo. Qualquer coisa com "BENZOTOP" no nome
# é Benzotop. O que sobrar (agulhas, kits, resinas, etc.) cai em PPS, que já
# é a linha "guarda-chuva" comercial nesse catálogo (a maioria dos itens
# mapeados hoje já está em PPS).
PALAVRAS_ANESTESICO_INJETAVEL = [
    "ALPHACAINE", "ARTICAINE", "ARTICAINA", "MEPIADRE", "MEPISV",
    "PRILONEST", "LIDOCAINA", "MEPIVACAINA", "PRILOCAINA", "BUPIVACAINA",
]


def _inferir_linha_por_nome(desc_produto: str) -> str:
    nome = (desc_produto or "").upper()
    if "BENZOTOP" in nome:
        return "Benzotop"
    if any(palavra in nome for palavra in PALAVRAS_ANESTESICO_INJETAVEL):
        return "Anestésicos Injetáveis"
    return "PPS"


def _select_all(query, page_size: int = 1000):
    todos = []
    page = 0
    while True:
        res = query.range(page * page_size, ((page + 1) * page_size) - 1).execute()
        data = res.data or []
        todos.extend(data)
        if len(data) < page_size:
            break
        page += 1
    return todos


def _to_float(valor) -> float:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def _meses_da_janela(hoje: date) -> set[int]:
    """Retorna o conjunto de (ano*100+mes) cobrindo os últimos 12 meses até hoje."""
    chaves = set()
    ano, mes = hoje.year, hoje.month
    for _ in range(MESES_JANELA):
        chaves.add(ano * 100 + mes)
        mes -= 1
        if mes == 0:
            mes = 12
            ano -= 1
    return chaves


def calcular_curva_abc() -> dict:
    hoje = date.today()
    chaves_validas = _meses_da_janela(hoje)

    # 1) Cadastro: tipo_negocio + status + descrição por código.
    produtos_rows = _select_all(
        supabase.table("d_produtos").select(
            "cod_produto, desc_produto, tipo_negocio, status_portfolio, status_original"
        )
    )

    linha_por_codigo: dict[str, str] = {}
    tipo_negocio_original_por_codigo: dict[str, str] = {}
    descontinuado_por_codigo: dict[str, bool] = {}
    desc_produto_por_codigo: dict[str, str] = {}

    for row in produtos_rows:
        codigo = str(row.get("cod_produto") or "").strip()
        if not codigo:
            continue

        tipo_negocio = str(row.get("tipo_negocio") or "").strip()
        tipo_negocio_original_por_codigo[codigo] = tipo_negocio
        desc_produto_por_codigo[codigo] = str(row.get("desc_produto") or "")

        status_txt = f"{row.get('status_portfolio') or ''} {row.get('status_original') or ''}".upper()
        descontinuado_por_codigo[codigo] = "DESCONT" in status_txt

    # 2) Faturamento real dos últimos 12 meses por código.
    saidas_rows = _select_all(
        supabase.table("f_sd2_saidas").select("produto, vlr_total, ano, mes")
    )

    faturamento_por_codigo: dict[str, float] = defaultdict(float)
    for row in saidas_rows:
        ano = int(row.get("ano") or 0)
        mes = int(row.get("mes") or 0)
        if (ano * 100 + mes) not in chaves_validas:
            continue
        codigo = str(row.get("produto") or "").strip()
        if not codigo:
            continue
        faturamento_por_codigo[codigo] += _to_float(row.get("vlr_total"))

    # Escopo relevante: só quem já tem tipo_negocio batendo com uma das 3
    # linhas, OU quem já teve alguma venda registrada em f_sd2_saidas (sinal
    # de que é item comercial de verdade, não matéria-prima/insumo puro).
    # Sem essa restrição, os ~46 mil códigos de d_produtos (a maioria nunca
    # vendida direto) cairiam todo mundo em PPS por padrão -- errado.
    codigos_relevantes = {
        codigo for codigo, tn in tipo_negocio_original_por_codigo.items()
        if tn in LINHAS_CALCULADAS
    } | set(faturamento_por_codigo.keys())

    for codigo in codigos_relevantes:
        tipo_negocio = tipo_negocio_original_por_codigo.get(codigo, "")
        linha_por_codigo[codigo] = (
            tipo_negocio if tipo_negocio in LINHAS_CALCULADAS
            else _inferir_linha_por_nome(desc_produto_por_codigo.get(codigo, ""))
        )

    # 3) Agrupa por linha de negócio. Códigos sem faturamento no período
    # viram C direto (sem entrar na conta de Pareto, que não faz sentido
    # sem valor pra ranquear).
    por_linha: dict[str, list[tuple[str, float]]] = defaultdict(list)
    classificacao_final: dict[str, str] = {}

    for codigo, linha in linha_por_codigo.items():
        if descontinuado_por_codigo.get(codigo):
            continue

        valor = faturamento_por_codigo.get(codigo, 0.0)
        if valor > 0:
            por_linha[linha].append((codigo, valor))
        else:
            classificacao_final[codigo] = "C"

    # 4) Classifica quem tem faturamento, dentro de cada linha.

    for linha, itens in por_linha.items():
        itens_ordenados = sorted(itens, key=lambda x: x[1], reverse=True)
        total_linha = sum(v for _, v in itens_ordenados)
        if total_linha <= 0:
            continue

        acumulado = 0.0
        for posicao, (codigo, valor) in enumerate(itens_ordenados, start=1):
            acumulado += valor
            pct_acumulado = acumulado / total_linha

            if posicao == 1:
                curva = "A"
            elif pct_acumulado <= 0.8:
                curva = "A"
            elif pct_acumulado <= 0.95:
                curva = "B"
            else:
                curva = "C"

            classificacao_final[codigo] = curva

    if not classificacao_final:
        return {"ok": False, "motivo": "Nenhum código classificado (sem faturamento ou sem tipo_negocio mapeado)."}

    # 5) Grava em d_produtos.abc_ytm -- update direto, nunca insert.
    # Todo código aqui já veio de d_produtos (produtos_rows, lá em cima),
    # então a linha sempre já existe -- não precisa (e não deve) tentar
    # criar linha nova. upsert() com payload parcial tentava inserir
    # quando o on_conflict não resolvia certo, e falhava por causa de
    # outras colunas obrigatórias que não estavam nesse payload parcial.
    erros = []
    atualizados = 0
    for codigo, curva in classificacao_final.items():
        try:
            supabase.table("d_produtos").update({"abc_ytm": curva}).eq("cod_produto", codigo).execute()
            atualizados += 1
        except Exception as e:
            if len(erros) < 5:
                erros.append(f"{codigo}: {str(e)[:150]}")

    contagem_por_curva = defaultdict(int)
    for curva in classificacao_final.values():
        contagem_por_curva[curva] += 1

    # Registra a execução em upload_log -- é como o resto do sistema já
    # rastreia "quando cada base rodou pela última vez" (ver overview.py).
    # Reaproveitamos isso pra saber se já passou tempo o bastante pra
    # recalcular de novo (ver main.py), sem precisar de tabela nova.
    try:
        supabase.table("upload_log").insert({
            "base_id": "curva_abc_calculo",
            "processado_em": datetime.now(timezone.utc).isoformat(),
            "status": "sucesso" if len(erros) == 0 else "parcial",
        }).execute()
    except Exception as e:
        logger.warning("Falha ao registrar execução da Curva ABC em upload_log: %s", str(e)[:200])

    contagem_por_linha_final: dict[str, int] = defaultdict(int)
    for codigo in classificacao_final:
        contagem_por_linha_final[linha_por_codigo.get(codigo, "?")] += 1

    return {
        "ok": len(erros) == 0,
        "total_classificados": len(classificacao_final),
        "total_atualizados_no_banco": atualizados,
        "por_curva": dict(contagem_por_curva),
        "por_linha": dict(contagem_por_linha_final),
        "erros": erros[:5],
    }


def deve_recalcular_curva_abc(meses_minimos: int = 6) -> bool:
    """
    True se já passou tempo o bastante desde a última execução registrada
    em upload_log (ou se nunca rodou ainda).
    """
    try:
        res = (
            supabase.table("upload_log")
            .select("processado_em")
            .eq("base_id", "curva_abc_calculo")
            .order("processado_em", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
    except Exception:
        # Se não conseguir checar, prefere rodar a ficar sem classificação nenhuma.
        return True

    if not rows:
        return True

    ultima_execucao_texto = rows[0].get("processado_em")
    if not ultima_execucao_texto:
        return True

    try:
        ultima_execucao = datetime.fromisoformat(str(ultima_execucao_texto).replace("Z", "+00:00"))
    except Exception:
        return True

    limite_dias = meses_minimos * 30
    return (datetime.now(timezone.utc) - ultima_execucao).days >= limite_dias