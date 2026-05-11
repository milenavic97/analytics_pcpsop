"""
Router de OPs — verifica viabilidade de abertura de ordens de produção
cruzando programação mensal, BOM e estoque de insumos.

Regras principais:
- OP com número: status "aberta"
- OP sem número: valida componentes da BOM contra estoque real
- Estoque real disponível = saldo_lote - empenho_lote
- MP, ME, MI: armazém 01
- PI: armazém 02
- Armazém 98: quarentena/CQ, usado como alternativa para MP/ME/MI
- MC: material de consumo — sempre OK (sem verificação de saldo)
         exceto se houver saldo em armazém 98 → quarentena

Acumulação global de saldo (FIFO):
- OPs candidatas são processadas em ordem crescente de data_inicio_fabricacao
- O saldo de cada insumo é descontado à medida que as OPs são verificadas
- fifo_posicao: posição da OP na fila de processamento (1 = primeira)
- gargalo: insumo crítico que impediu a abertura, com saldo que chegou vs necessário
"""

from fastapi import APIRouter, HTTPException, Query
from app.database import supabase

router = APIRouter(prefix="/ops", tags=["ops"])


ARMAZEM_POR_TP = {
    "MP": "01",
    "ME": "01",
    "MI": "01",
    "PI": "02",
}

TP_CONSUMO = {"MC"}


def _to_float(value) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _round(value: float, casas: int = 4) -> float:
    return round(_to_float(value), casas)


def _fmt_br(n: float) -> str:
    if n == int(n):
        return f"{int(n):,}".replace(",", ".")
    partes = f"{n:,.2f}".split(".")
    inteiro = partes[0].replace(",", ".")
    decimal = partes[1].rstrip("0")
    return f"{inteiro},{decimal}" if decimal else inteiro


def _buscar_ops(mes_ref: str) -> list[dict]:
    res = (
        supabase.table("f_programacao_ops")
        .select("*")
        .eq("mes_ref", mes_ref)
        .order("linha")
        .order("data_fim")
        .execute()
    )
    return res.data or []


def _buscar_bom(codigos_pai: list[str]) -> dict[str, list[dict]]:
    if not codigos_pai:
        return {}

    res = (
        supabase.table("d_bom_estrutura")
        .select("codigo_pai, codigo_comp, descricao_comp, tp, quantidade, unidade")
        .in_("codigo_pai", codigos_pai)
        .execute()
    )

    bom: dict[str, list[dict]] = {}
    for row in res.data or []:
        pai = str(row.get("codigo_pai") or "").strip()
        if not pai:
            continue
        bom.setdefault(pai, []).append(row)

    return bom


def _buscar_estoque_mais_recente(codigos: list[str]) -> tuple[dict[tuple, dict], str | None]:
    if not codigos:
        return {}, None

    res_data = (
        supabase.table("f_estoque_saldo")
        .select("data_ref")
        .in_("codigo", codigos)
        .order("data_ref", desc=True)
        .limit(1)
        .execute()
    )

    if not res_data.data:
        return {}, None

    data_ref = res_data.data[0]["data_ref"]

    res = (
        supabase.table("f_estoque_saldo")
        .select("codigo, armazem, saldo_lote, empenho_lote")
        .eq("data_ref", data_ref)
        .in_("codigo", codigos)
        .in_("armazem", ["01", "02", "98"])
        .execute()
    )

    estoque: dict[tuple, dict] = {}
    for row in res.data or []:
        codigo = str(row.get("codigo") or "").strip()
        armazem = str(row.get("armazem") or "").strip()
        if not codigo or not armazem:
            continue

        chave = (codigo, armazem)
        saldo_lote = _to_float(row.get("saldo_lote"))
        empenho_lote = _to_float(row.get("empenho_lote"))
        saldo_disponivel = saldo_lote - empenho_lote

        if chave not in estoque:
            estoque[chave] = {"saldo_lote": 0.0, "empenho_lote": 0.0, "saldo_disponivel": 0.0}

        estoque[chave]["saldo_lote"] += saldo_lote
        estoque[chave]["empenho_lote"] += empenho_lote
        estoque[chave]["saldo_disponivel"] += saldo_disponivel

    return estoque, data_ref


def _formatar_op_aberta(op: dict) -> dict:
    return {
        "id": op.get("id"),
        "mes_ref": op.get("mes_ref"),
        "lote": op.get("lote"),
        "codigo": op.get("codigo"),
        "produto": op.get("produto", ""),
        "linha": op.get("linha"),
        "quantidade": _to_float(op.get("quantidade")),
        "data_fim": op.get("data_fim"),
        "op_numero": op.get("op_numero"),
        "status": "aberta",
        "alertas": [],
        "detalhes": [],
        "resumo_faltas": "",
        "qtd_componentes_faltando": 0,
        "qtd_total_faltante": 0,
        "fifo_posicao": None,
        "gargalo": None,
        "anotacao": op.get("anotacao"),
        "tempo_horas": op.get("tempo_horas"),
        "un_h": op.get("un_h"),
        "observacoes": op.get("observacoes"),
        "data_lavagem_emb": op.get("data_lavagem_emb"),
        "data_lavagem_pesagem": op.get("data_lavagem_pesagem"),
        "data_inicio_fabricacao": op.get("data_inicio_fabricacao"),
        "data_termino": op.get("data_termino"),
    }


def _montar_resumo_faltas(alertas: list[dict]) -> str:
    faltas = [a for a in alertas if a.get("status") == "falta"]
    quarentena = [a for a in alertas if a.get("status") == "quarentena"]
    partes = []

    if faltas:
        itens = []
        for a in faltas[:4]:
            desc = a.get("descricao") or a.get("codigo_comp")
            faltante = _round(a.get("faltante"), 2)
            unidade = a.get("unidade") or "un"
            itens.append(f"{_fmt_br(faltante)} {unidade} de {desc}")
        partes.append("Falta " + "; ".join(itens))

    if quarentena:
        itens = []
        for a in quarentena[:3]:
            desc = a.get("descricao") or a.get("codigo_comp")
            faltante = _round(a.get("faltante"), 2)
            unidade = a.get("unidade") or "un"
            itens.append(f"{_fmt_br(faltante)} {unidade} de {desc}")
        partes.append("Depende de liberação do CQ para " + "; ".join(itens))

    return ". ".join(partes)


def _verificar_op(
    op: dict,
    componentes: list[dict],
    saldo_corrente: dict[tuple, float],
    fifo_posicao: int,
) -> dict:
    """
    Verifica viabilidade de uma OP contra o saldo corrente (FIFO).

    Campos adicionais retornados:
    - fifo_posicao: posição na fila FIFO (1 = primeira a ser processada)
    - gargalo: insumo mais crítico que impediu a abertura:
        { codigo_comp, descricao, tp, unidade, necessario,
          saldo_chegou, saldo_chegou_98, faltante, status }
      None se a OP for OK.
    """
    quantidade_op = _to_float(op.get("quantidade"))

    detalhes = []
    tem_falta = False
    tem_quarentena = False
    gargalo = None

    for comp in componentes:
        tp = str(comp.get("tp") or "").strip().upper()
        armazem_ref = ARMAZEM_POR_TP.get(tp, "01")

        qtd_unit = _to_float(comp.get("quantidade"))
        necessario = round(qtd_unit * quantidade_op, 6)

        codigo_comp = str(comp.get("codigo_comp") or "").strip()
        desc_comp = comp.get("descricao_comp", "")
        unidade = comp.get("unidade", "")

        chave_ref = (codigo_comp, armazem_ref)
        chave_98 = (codigo_comp, "98")

        # ── MC ───────────────────────────────────────────────────────────────
        if tp in TP_CONSUMO:
            saldo_98_mc = saldo_corrente.get(chave_98, 0.0)
            if saldo_98_mc > 0:
                status_comp = "quarentena"
                tem_quarentena = True
            else:
                status_comp = "ok"

            detalhes.append({
                "codigo_comp": codigo_comp,
                "descricao": desc_comp,
                "tp": tp,
                "unidade": unidade,
                "necessario": _round(necessario),
                "armazem_ref": armazem_ref,
                "saldo_lote": 0.0,
                "empenho_lote": 0.0,
                "saldo_disponivel": 0.0,
                "saldo_lote_98": _round(saldo_98_mc),
                "empenho_lote_98": 0.0,
                "saldo_disponivel_98": _round(saldo_98_mc),
                "saldo_01": 0.0,
                "saldo_98": _round(saldo_98_mc),
                "faltante": 0.0,
                "status": status_comp,
            })
            continue

        # ── MP, ME, MI, PI ───────────────────────────────────────────────────
        saldo_ref = saldo_corrente.get(chave_ref, 0.0)
        saldo_98 = saldo_corrente.get(chave_98, 0.0) if armazem_ref == "01" else 0.0

        # Snapshot ANTES do desconto — usado em detalhes e gargalo
        saldo_chegou = saldo_ref
        saldo_chegou_98 = saldo_98
        saldo_restante = saldo_ref - necessario

        faltante_ref = max(0.0, necessario - saldo_ref)
        faltante_total = max(0.0, necessario - saldo_ref - saldo_98)

        if saldo_ref >= necessario:
            status_comp = "ok"
            faltante = 0.0
            saldo_corrente[chave_ref] = saldo_ref - necessario

        elif armazem_ref == "01" and (saldo_ref + saldo_98) >= necessario:
            status_comp = "quarentena"
            faltante = faltante_ref
            tem_quarentena = True
            consumido_98 = necessario - saldo_ref
            saldo_corrente[chave_ref] = 0.0
            saldo_corrente[chave_98] = max(0.0, saldo_98 - consumido_98)

            # Gargalo: quarentena só entra se ainda não há falta
            if gargalo is None or (gargalo.get("status") != "falta" and faltante > _to_float(gargalo.get("faltante"))):
                gargalo = {
                    "codigo_comp": codigo_comp,
                    "descricao": desc_comp,
                    "tp": tp,
                    "unidade": unidade,
                    "necessario": _round(necessario),
                    "saldo_chegou": _round(saldo_chegou),
                    "saldo_chegou_98": _round(saldo_chegou_98),
                    "faltante": _round(faltante),
                    "status": "quarentena",
                }

        else:
            status_comp = "falta"
            faltante = faltante_total
            tem_falta = True
            saldo_corrente[chave_ref] = 0.0
            if armazem_ref == "01":
                saldo_corrente[chave_98] = 0.0

            # Falta sempre sobrescreve quarentena no gargalo; entre faltas, maior faltante vence
            if gargalo is None or gargalo.get("status") != "falta" or faltante > _to_float(gargalo.get("faltante")):
                gargalo = {
                    "codigo_comp": codigo_comp,
                    "descricao": desc_comp,
                    "tp": tp,
                    "unidade": unidade,
                    "necessario": _round(necessario),
                    "saldo_chegou": _round(saldo_chegou),
                    "saldo_chegou_98": _round(saldo_chegou_98),
                    "faltante": _round(faltante),
                    "status": "falta",
                }

        detalhes.append({
            "codigo_comp": codigo_comp,
            "descricao": desc_comp,
            "tp": tp,
            "unidade": unidade,
            "necessario": _round(necessario),
            "armazem_ref": armazem_ref,

            "saldo_atual": _round(saldo_chegou),
            "saldo_restante": _round(saldo_restante),

            "saldo_lote": 0.0,
            "empenho_lote": 0.0,
            "saldo_disponivel": _round(saldo_chegou),
            "saldo_lote_98": _round(saldo_chegou_98),
            "empenho_lote_98": 0.0,
            "saldo_disponivel_98": _round(saldo_chegou_98),
            "saldo_01": _round(saldo_chegou),
            "saldo_98": _round(saldo_chegou_98),
            "faltante": _round(faltante),
            "status": status_comp,
        })

    if tem_falta:
        status_op = "falta"
    elif tem_quarentena:
        status_op = "quarentena"
    else:
        status_op = "ok"
        gargalo = None

    alertas = [d for d in detalhes if d["status"] != "ok"]
    resumo_faltas = _montar_resumo_faltas(alertas)

    return {
        "id": op.get("id"),
        "mes_ref": op.get("mes_ref"),
        "lote": op.get("lote"),
        "codigo": op.get("codigo"),
        "produto": op.get("produto", ""),
        "linha": op.get("linha"),
        "quantidade": quantidade_op,
        "data_fim": op.get("data_fim"),
        "op_numero": op.get("op_numero"),
        "status": status_op,
        "alertas": alertas,
        "detalhes": detalhes,
        "resumo_faltas": resumo_faltas,
        "qtd_componentes_faltando": len([a for a in alertas if a.get("status") == "falta"]),
        "qtd_total_faltante": _round(sum(_to_float(a.get("faltante")) for a in alertas if a.get("status") == "falta")),
        "fifo_posicao": fifo_posicao,
        "gargalo": gargalo,
        "anotacao": op.get("anotacao"),
        "tempo_horas": op.get("tempo_horas"),
        "un_h": op.get("un_h"),
        "observacoes": op.get("observacoes"),
        "data_lavagem_emb": op.get("data_lavagem_emb"),
        "data_lavagem_pesagem": op.get("data_lavagem_pesagem"),
        "data_inicio_fabricacao": op.get("data_inicio_fabricacao"),
        "data_termino": op.get("data_termino"),
    }


def _construir_saldo_corrente(estoque: dict[tuple, dict]) -> dict[tuple, float]:
    return {
        chave: max(0.0, _to_float(dados.get("saldo_disponivel")))
        for chave, dados in estoque.items()
    }


def _ordenar_ops_por_data(ops: list[dict]) -> list[dict]:
    def sort_key(op):
        return op.get("data_inicio_fabricacao") or op.get("data_fim") or "9999-12-31"
    return sorted(ops, key=sort_key)


def _montar_criticos(todas: list[dict]) -> list[dict]:
    materiais: dict[str, dict] = {}

    for op in todas:
        if op.get("status") not in ["falta", "quarentena"]:
            continue

        for comp in op.get("alertas", []):
            codigo = comp.get("codigo_comp")
            if not codigo:
                continue

            if codigo not in materiais:
                materiais[codigo] = {
                    "codigo_comp": codigo,
                    "descricao": comp.get("descricao") or codigo,
                    "tp": comp.get("tp"),
                    "unidade": comp.get("unidade") or "un",
                    "armazem_ref": comp.get("armazem_ref"),
                    "ops_impactadas": 0,
                    "faltante_total": 0.0,
                    "necessario_total": 0.0,
                    "status": comp.get("status"),
                }

            materiais[codigo]["ops_impactadas"] += 1
            materiais[codigo]["faltante_total"] += _to_float(comp.get("faltante"))
            materiais[codigo]["necessario_total"] += _to_float(comp.get("necessario"))

            if comp.get("status") == "falta":
                materiais[codigo]["status"] = "falta"

    lista = list(materiais.values())
    lista.sort(
        key=lambda x: (
            1 if x.get("status") == "falta" else 0,
            x.get("ops_impactadas", 0),
            x.get("faltante_total", 0),
        ),
        reverse=True,
    )

    for item in lista:
        item["faltante_total"] = _round(item["faltante_total"], 2)
        item["necessario_total"] = _round(item["necessario_total"], 2)

    return lista[:20]


@router.get("/viabilidade")
async def viabilidade_ops(
    mes_ref: str = Query(..., description="Mês de referência no formato YYYY-MM, ex: 2026-05"),
    linha: str | None = Query(None, description="Filtrar por linha: ENVASE_L1, ENVASE_L2, EMBALAGEM"),
):
    ops = _buscar_ops(mes_ref)

    if not ops:
        raise HTTPException(
            status_code=404,
            detail=f"Nenhuma OP encontrada para o mês {mes_ref}. Verifique se o arquivo de programação foi carregado."
        )

    if linha:
        ops = [op for op in ops if op.get("linha") == linha]

    ops_abertas = [op for op in ops if op.get("op_numero")]
    ops_candidatas = [op for op in ops if not op.get("op_numero")]

    resultado_abertas = [_formatar_op_aberta(op) for op in ops_abertas]

    codigos_candidatas = list({str(op.get("codigo") or "").strip() for op in ops_candidatas if op.get("codigo")})
    bom = _buscar_bom(codigos_candidatas)

    todos_componentes = set()
    for comps in bom.values():
        for comp in comps:
            if comp.get("codigo_comp"):
                todos_componentes.add(str(comp["codigo_comp"]).strip())

    estoque, data_estoque = _buscar_estoque_mais_recente(list(todos_componentes))
    saldo_corrente = _construir_saldo_corrente(estoque)
    ops_candidatas_ordenadas = _ordenar_ops_por_data(ops_candidatas)

    resultado_candidatas = []

    for fifo_posicao, op in enumerate(ops_candidatas_ordenadas, start=1):
        componentes = bom.get(str(op.get("codigo") or "").strip(), [])

        if not componentes:
            resultado_candidatas.append({
                "id": op.get("id"),
                "mes_ref": op.get("mes_ref"),
                "lote": op.get("lote"),
                "codigo": op.get("codigo"),
                "produto": op.get("produto", ""),
                "linha": op.get("linha"),
                "quantidade": _to_float(op.get("quantidade")),
                "data_fim": op.get("data_fim"),
                "op_numero": None,
                "status": "sem_bom",
                "alertas": [{"descricao": "Produto não encontrado na estrutura de materiais (BOM).", "status": "sem_bom"}],
                "detalhes": [],
                "resumo_faltas": "Produto não encontrado na estrutura de materiais (BOM).",
                "qtd_componentes_faltando": 0,
                "qtd_total_faltante": 0,
                "fifo_posicao": fifo_posicao,
                "gargalo": None,
                "anotacao": op.get("anotacao"),
                "tempo_horas": op.get("tempo_horas"),
                "un_h": op.get("un_h"),
                "observacoes": op.get("observacoes"),
                "data_lavagem_emb": op.get("data_lavagem_emb"),
                "data_lavagem_pesagem": op.get("data_lavagem_pesagem"),
                "data_inicio_fabricacao": op.get("data_inicio_fabricacao"),
                "data_termino": op.get("data_termino"),
            })
            continue

        resultado_candidatas.append(_verificar_op(op, componentes, saldo_corrente, fifo_posicao))

    todas = resultado_abertas + resultado_candidatas

    resumo = {
        "abertas": sum(1 for r in todas if r["status"] == "aberta"),
        "ok": sum(1 for r in todas if r["status"] == "ok"),
        "quarentena": sum(1 for r in todas if r["status"] == "quarentena"),
        "falta": sum(1 for r in todas if r["status"] == "falta"),
        "sem_bom": sum(1 for r in todas if r["status"] == "sem_bom"),
    }

    return {
        "mes_ref": mes_ref,
        "data_estoque": data_estoque,
        "total_ops": len(todas),
        "resumo": resumo,
        "materiais_criticos": _montar_criticos(todas),
        "ops": todas,
    }


@router.get("/meses")
async def meses_disponiveis():
    res = (
        supabase.table("f_programacao_ops")
        .select("mes_ref")
        .order("mes_ref", desc=True)
        .execute()
    )
    meses = list({row["mes_ref"] for row in res.data or []})
    meses.sort(reverse=True)
    return {"meses": meses}


@router.get("/resumo/{mes_ref}")
async def resumo_mes(mes_ref: str):
    ops = _buscar_ops(mes_ref)

    if not ops:
        raise HTTPException(status_code=404, detail=f"Nenhuma OP para o mês {mes_ref}.")

    ops_abertas = [op for op in ops if op.get("op_numero")]
    ops_candidatas = [op for op in ops if not op.get("op_numero")]

    codigos = list({str(op.get("codigo") or "").strip() for op in ops_candidatas if op.get("codigo")})
    bom = _buscar_bom(codigos)

    todos_componentes = set()
    for comps in bom.values():
        for comp in comps:
            if comp.get("codigo_comp"):
                todos_componentes.add(str(comp["codigo_comp"]).strip())

    estoque, data_estoque = _buscar_estoque_mais_recente(list(todos_componentes))
    saldo_corrente = _construir_saldo_corrente(estoque)
    ops_candidatas_ordenadas = _ordenar_ops_por_data(ops_candidatas)

    por_linha: dict[str, dict] = {}

    for op in ops_abertas:
        linha = op.get("linha")
        por_linha.setdefault(linha, {"aberta": 0, "ok": 0, "quarentena": 0, "falta": 0, "sem_bom": 0})
        por_linha[linha]["aberta"] += 1

    for fifo_posicao, op in enumerate(ops_candidatas_ordenadas, start=1):
        linha = op.get("linha")
        por_linha.setdefault(linha, {"aberta": 0, "ok": 0, "quarentena": 0, "falta": 0, "sem_bom": 0})

        componentes = bom.get(str(op.get("codigo") or "").strip(), [])
        if not componentes:
            por_linha[linha]["sem_bom"] += 1
            continue

        resultado = _verificar_op(op, componentes, saldo_corrente, fifo_posicao)
        por_linha[linha][resultado["status"]] += 1

    return {
        "mes_ref": mes_ref,
        "data_estoque": data_estoque,
        "total_ops": len(ops),
        "por_linha": por_linha,
    }