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
"""

from datetime import date, datetime, timezone
from collections import defaultdict
import logging

from app.database import supabase

logger = logging.getLogger("uvicorn.error")

LINHAS_CALCULADAS = {"Anestésicos Injetáveis", "PPS", "Benzotop"}
MESES_JANELA = 12


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

    # 1) Cadastro: tipo_negocio + status por código.
    produtos_rows = _select_all(
        supabase.table("d_produtos").select(
            "cod_produto, tipo_negocio, status_portfolio, status_original"
        )
    )

    tipo_negocio_por_codigo: dict[str, str] = {}
    descontinuado_por_codigo: dict[str, bool] = {}

    for row in produtos_rows:
        codigo = str(row.get("cod_produto") or "").strip()
        if not codigo:
            continue
        tipo_negocio_por_codigo[codigo] = str(row.get("tipo_negocio") or "").strip()
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

    # 3) Agrupa por linha de negócio, só as 3 que calculamos ABC.
    por_linha: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for codigo, valor in faturamento_por_codigo.items():
        if valor <= 0:
            continue
        if descontinuado_por_codigo.get(codigo):
            continue
        linha = tipo_negocio_por_codigo.get(codigo)
        if linha not in LINHAS_CALCULADAS:
            continue
        por_linha[linha].append((codigo, valor))

    # 4) Classifica dentro de cada linha.
    classificacao_final: dict[str, str] = {}

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

    # 5) Grava em d_produtos.abc_ytm em lotes.
    registros = [
        {"cod_produto": codigo, "abc_ytm": curva}
        for codigo, curva in classificacao_final.items()
    ]

    erros = []
    tamanho_lote = 500
    for i in range(0, len(registros), tamanho_lote):
        lote = registros[i:i + tamanho_lote]
        try:
            supabase.table("d_produtos").upsert(lote, on_conflict="cod_produto").execute()
        except Exception as e:
            erros.append(str(e)[:200])

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

    return {
        "ok": len(erros) == 0,
        "total_classificados": len(classificacao_final),
        "por_curva": dict(contagem_por_curva),
        "por_linha": {linha: len(itens) for linha, itens in por_linha.items()},
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