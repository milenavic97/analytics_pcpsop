"""
Router de OPs — verifica viabilidade de abertura de ordens de produção
cruzando programação mensal, BOM, estoque de insumos e compras em aberto.

Regras principais:
- OP com número: status "aberta"
- OP sem número: valida componentes da BOM contra estoque real
- Estoque real disponível = saldo_lote - empenho_lote
- MP, ME, MI: armazém 01
- Tipo da Posição de Estoque é prioritário; se não existir, usa tipo da BOM
- MC: armazém 20 conceitual no detalhe, mas saldo vem da Posição de Estoque / f_consumo_materiais
- PI: armazém 02
- Armazém 98: quarentena/CQ, usado como alternativa para MP/ME/MI
- Compras em aberto entram como informação complementar no detalhe do componente
- Compras são consumidas em sequência FIFO das OPs, como saldo futuro
"""

from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta
import re
from typing import Any
from app.database import supabase

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/debug-versao")
def debug_versao_ops():
    return {
        "router": "ops",
        "versao": "debug_2026_06_11_tipo_posicao_estoque_prioritario_v9",
        "arquivo": "app/routers/ops.py",
        "status": "router carregado corretamente",
    }



ARMAZEM_POR_TP = {
    "MP": "01",
    "ME": "01",
    "MI": "01",
    "MC": "20",
    "PI": "02",
}

TPS_GARGALANTES = {"MP", "ME", "MI", "MC"}


def _to_float(value) -> float:
    try:
        if value is None:
            return 0.0

        if isinstance(value, (int, float)):
            return float(value)

        texto = str(value).strip()

        if not texto:
            return 0.0

        # Aceita formato brasileiro vindo de Excel/CSV:
        # 16.660,00 -> 16660.00
        # 456,23 -> 456.23
        if "," in texto:
            texto = texto.replace(".", "").replace(",", ".")

        return float(texto)
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
    """
    Busca a programação do mês.

    A ordem oficial da cascata é garantida em Python por _ordenar_ops_para_cascata,
    espelhando a lógica visual da coluna # da tela:
      1. grupo Embalagem/PA;
      2. grupo Envase/PI;
      3. dentro de cada grupo, ordenar por data.
    """
    res = (
        supabase.table("f_programacao_ops")
        .select("*")
        .eq("mes_ref", mes_ref)
        .order("data_inicio_fabricacao")
        .order("data_fim")
        .order("lote")
        .order("codigo")
        .execute()
    )
    return res.data or []


def _parse_date_for_order(value):
    if not value:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    texto = texto[:10]

    try:
        return datetime.fromisoformat(texto).date()
    except Exception:
        pass

    try:
        return datetime.strptime(texto, "%d/%m/%Y").date()
    except Exception:
        return None


def _tipo_produto_op(linha: str | None) -> str:
    """
    Espelha a regra do front:

      linha EMBALAGEM = PA
      demais linhas = PI

    A coluna # da tela trabalha com duas sequências:
      - uma para Embalagem/PA;
      - outra para Envase/PI.

    Dentro de Envase, L1 e L2 se misturam pela data.
    """
    linha_norm = _normalizar_linha_teorica(linha)

    if linha_norm == "EMBALAGEM":
        return "PA"

    return "PI"


def _data_hashtag_op(op: dict):
    """
    Data usada na lógica da coluna #.

    Espelha o front atual:
      data_inicio_fabricacao || data_fim || "9999-12-31"

    Não usa linha como prioridade dentro do Envase; L1 e L2 se misturam pela data.
    """
    data = _parse_date_for_order(op.get("data_inicio_fabricacao"))
    if data:
        return data

    data = _parse_date_for_order(op.get("data_fim"))
    if data:
        return data

    return None


def _sort_key_op_cascata(op: dict, original_index: int = 0):
    tipo_ordem = 0 if _tipo_produto_op(op.get("linha")) == "PA" else 1
    data = _data_hashtag_op(op)
    fifo = op.get("fifo_posicao")

    try:
        fifo_int = int(fifo) if fifo is not None else 999999
    except Exception:
        fifo_int = 999999

    return (
        tipo_ordem,
        data.isoformat() if data else "9999-12-31",
        fifo_int,
        original_index,
        str(op.get("lote") or ""),
        str(op.get("codigo") or ""),
    )


def _ordenar_ops_para_cascata(ops: list[dict]) -> list[dict]:
    """
    Ordena OPs na mesma lógica da coluna # do front.

    Regra mantida:
      1. Embalagem/PA primeiro;
      2. Envase/PI depois;
      3. dentro de cada grupo, ordenar por data;
      4. dentro de Envase, L1 e L2 se misturam por data.

    Esta ordem também é usada para consumir estoque em cascata.
    """
    return [
        item["op"]
        for item in sorted(
            [{"op": op, "original_index": idx} for idx, op in enumerate(ops or [])],
            key=lambda item: _sort_key_op_cascata(item["op"], item["original_index"]),
        )
    ]


def _atribuir_fifo_posicao(ops: list[dict]) -> list[dict]:
    """
    Atribui a posição # seguindo a mesma lógica visual:
      - contador PA separado;
      - contador PI separado.

    O front ainda pode recalcular visualmente, mas devolver este campo ajuda
    a manter backend, debug e desempate alinhados.
    """
    ordenadas = _ordenar_ops_para_cascata(ops)
    seq_pa = 0
    seq_pi = 0
    resultado = []

    for op in ordenadas:
        novo = dict(op)
        tipo = _tipo_produto_op(novo.get("linha"))

        if tipo == "PA":
            seq_pa += 1
            novo["fifo_posicao"] = seq_pa
            novo["tipo_fifo"] = "PA"
        else:
            seq_pi += 1
            novo["fifo_posicao"] = seq_pi
            novo["tipo_fifo"] = "PI"

        resultado.append(novo)

    return resultado

def _parse_datetime_upload(value):
    """Normaliza possíveis campos de data/hora de carga da programação."""
    if not value:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    # Supabase costuma devolver timestamptz com Z. O fromisoformat precisa do offset explícito.
    texto_iso = texto.replace("Z", "+00:00")

    try:
        return datetime.fromisoformat(texto_iso)
    except Exception:
        pass

    # Fallback para campos salvos como data simples.
    try:
        return datetime.fromisoformat(texto[:10])
    except Exception:
        return None


def _ultima_atualizacao_programacao(ops: list[dict]) -> tuple[str | None, str | None]:
    """
    Descobre a data da última carga/importação da programação mensal.

    A tela de Ordens precisa mostrar quando a base de programação foi atualizada.
    Como diferentes versões do banco podem usar nomes de campos diferentes,
    a função procura primeiro campos típicos de upload/importação e só depois
    cai para updated_at.
    """
    campos_preferencia = [
        "programacao_atualizada_em",
        "upload_em",
        "uploaded_at",
        "data_upload",
        "importado_em",
        "processado_em",
        "created_at",
        "criado_em",
        "updated_at",
        "atualizado_em",
    ]

    for campo in campos_preferencia:
        datas = []
        for op in ops:
            dt = _parse_datetime_upload(op.get(campo))
            if dt:
                datas.append(dt)

        if datas:
            return max(datas).isoformat(), campo

    return None, None

def _normalizar_codigo_produto(value) -> str:
    texto = str(value or "").strip()

    if not texto or texto.lower() in {"nan", "none"}:
        return ""

    try:
        texto = str(int(float(texto)))
    except Exception:
        if texto.endswith(".0"):
            texto = texto[:-2]

    return texto.zfill(5)


def _normalizar_linha_teorica(value) -> str:
    texto = str(value or "").strip().upper()

    if not texto:
        return ""

    texto = texto.replace("-", "_").replace(" ", "_")

    if texto in {"1", "L1", "LINHA_1", "LINHA1", "ENVASE_L1", "ENVASE_LINHA_1", "ENVASELINHA1"}:
        return "L1"

    if texto in {"2", "L2", "LINHA_2", "LINHA2", "ENVASE_L2", "ENVASE_LINHA_2", "ENVASELINHA2"}:
        return "L2"

    if "ENVASE" in texto and "1" in texto:
        return "L1"

    if "ENVASE" in texto and "2" in texto:
        return "L2"

    if "EMBALAGEM" in texto:
        return "EMBALAGEM"

    return texto.replace("_", " ")


def _ativo_bool(value) -> bool:
    if isinstance(value, bool):
        return value

    texto = str(value or "").strip().upper()

    if texto in {"", "SIM", "S", "TRUE", "1", "ATIVO", "YES", "Y"}:
        return True

    return False


def _buscar_lotes_teoricos(codigos_produto: list[str]) -> dict[tuple[str, str], dict]:
    """
    Busca a tabela d_lotes_teoricos e monta um mapa por:
      (codigo_produto, linha)

    Essa base define a quantidade teórica de abertura no Protheus.
    A quantidade programada continua aparecendo na tela, mas o cálculo
    de viabilidade usa a quantidade teórica quando houver cadastro ativo.
    """
    codigos = sorted({
        _normalizar_codigo_produto(c)
        for c in codigos_produto
        if _normalizar_codigo_produto(c)
    })

    if not codigos:
        return {}

    try:
        res = (
            supabase.table("d_lotes_teoricos")
            .select(
                """
                codigo_produto,
                descricao_produto,
                letra_lote,
                linha,
                qtd_teorica_abertura,
                ativo,
                observacao
                """
            )
            .in_("codigo_produto", codigos)
            .execute()
        )
    except Exception:
        return {}

    mapa: dict[tuple[str, str], dict] = {}

    for row in res.data or []:
        if not _ativo_bool(row.get("ativo")):
            continue

        codigo = _normalizar_codigo_produto(row.get("codigo_produto"))
        linha = _normalizar_linha_teorica(row.get("linha"))
        qtd_teorica = _to_float(row.get("qtd_teorica_abertura"))

        if not codigo or not linha or qtd_teorica <= 0:
            continue

        mapa[(codigo, linha)] = {
            "codigo_produto": codigo,
            "descricao_produto": row.get("descricao_produto"),
            "letra_lote": row.get("letra_lote"),
            "linha": linha,
            "qtd_teorica_abertura": qtd_teorica,
            "ativo": True,
            "observacao": row.get("observacao"),
        }

    return mapa


def _aplicar_lote_teorico_op(op: dict, lotes_teoricos: dict[tuple[str, str], dict]) -> dict:
    """
    Mantém a quantidade programada original e cria quantidade_calculo.

    quantidade              = quantidade programada da planilha
    quantidade_programada   = quantidade programada da planilha
    quantidade_teorica      = quantidade teórica para abertura, quando existir
    quantidade_calculo      = quantidade usada para calcular necessidade de material
    """
    novo = dict(op)

    codigo = _normalizar_codigo_produto(op.get("codigo"))
    linha_norm = _normalizar_linha_teorica(op.get("linha"))
    qtd_programada = _to_float(op.get("quantidade"))

    lote_teorico = lotes_teoricos.get((codigo, linha_norm))
    qtd_teorica = _to_float(lote_teorico.get("qtd_teorica_abertura")) if lote_teorico else 0.0
    usa_lote_teorico = bool(lote_teorico and qtd_teorica > 0)

    quantidade_calculo = qtd_teorica if usa_lote_teorico else qtd_programada

    novo["quantidade"] = qtd_programada
    novo["quantidade_programada"] = qtd_programada
    novo["qtd_teorica_abertura"] = qtd_teorica if usa_lote_teorico else None
    novo["quantidade_teorica"] = qtd_teorica if usa_lote_teorico else qtd_programada
    novo["quantidade_calculo"] = quantidade_calculo
    novo["usa_lote_teorico"] = usa_lote_teorico
    novo["lote_teorico_encontrado"] = usa_lote_teorico
    novo["linha_lote_teorico"] = lote_teorico.get("linha") if lote_teorico else linha_norm
    novo["letra_lote_teorico"] = lote_teorico.get("letra_lote") if lote_teorico else None
    novo["observacao_lote_teorico"] = lote_teorico.get("observacao") if lote_teorico else None

    return novo



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



def _buscar_compras_abertas(codigos: list[str]) -> dict[str, list[dict]]:
    """
    Busca compras abertas por componente.

    Correção v7:
    - chaveia os pedidos pelo código normalizado do componente;
    - preserva quantidade_pendente_original para mostrar o total aberto do ERP;
    - quantidade_pendente_restante continua sendo consumida em cascata pelas OPs.
    """
    codigos_norm = sorted({
        _normalizar_codigo_produto(c)
        for c in (codigos or [])
        if _normalizar_codigo_produto(c)
    })

    if not codigos_norm:
        return {}

    compras: dict[str, list[dict]] = {}
    chunk_size = 80

    try:
        for i in range(0, len(codigos_norm), chunk_size):
            chunk = codigos_norm[i:i + chunk_size]
            res = (
                supabase.table("f_compras_abertas")
                .select(
                    """
                    produto_codigo,
                    produto_descricao,
                    quantidade_pendente,
                    data_prevista_entrega,
                    pedido_numero,
                    sc_numero,
                    razao_social_fornecedor,
                    comprador_nome,
                    entrega_status
                    """
                )
                .in_("produto_codigo", chunk)
                .execute()
            )

            for row in res.data or []:
                codigo = _normalizar_codigo_produto(row.get("produto_codigo"))

                if not codigo:
                    continue

                quantidade_pendente = _round(row.get("quantidade_pendente"))

                if quantidade_pendente <= 0:
                    continue

                compras.setdefault(codigo, []).append({
                    "produto_codigo": codigo,
                    "produto_descricao": row.get("produto_descricao"),
                    "quantidade_pendente_original": quantidade_pendente,
                    "quantidade_pendente_restante": quantidade_pendente,
                    "data_prevista_entrega": row.get("data_prevista_entrega"),
                    "pedido_numero": row.get("pedido_numero"),
                    "sc_numero": row.get("sc_numero"),
                    "razao_social_fornecedor": row.get("razao_social_fornecedor"),
                    "comprador_nome": row.get("comprador_nome"),
                    "entrega_status": row.get("entrega_status"),
                })
    except Exception:
        return compras

    for codigo in compras:
        compras[codigo].sort(
            key=lambda x: (
                x.get("data_prevista_entrega") or "9999-12-31",
                x.get("pedido_numero") or "",
                x.get("sc_numero") or "",
            )
        )

    return compras



def _resumo_compras_por_codigo(compras: dict[str, list[dict]]) -> dict[str, dict]:
    """
    Resume compras por código sem depender do consumo em cascata.

    total_original = total em aberto no ERP/relatório de PC/SC.
    total_restante = saldo ainda não alocado pela cascata no momento da chamada.
    """
    resumo: dict[str, dict] = {}

    for codigo_raw, pedidos in (compras or {}).items():
        codigo = _normalizar_codigo_produto(codigo_raw)
        if not codigo:
            continue

        total_original = 0.0
        total_restante = 0.0
        datas_validas = []
        scs = []
        pcs = []

        for pedido in pedidos or []:
            total_original += _to_float(pedido.get("quantidade_pendente_original"))
            total_restante += _to_float(pedido.get("quantidade_pendente_restante"))

            data = str(pedido.get("data_prevista_entrega") or "")[:10]
            if data:
                datas_validas.append(data)

            sc = str(pedido.get("sc_numero") or "").strip()
            pc = str(pedido.get("pedido_numero") or "").strip()
            if sc and sc not in scs:
                scs.append(sc)
            if pc and pc not in pcs:
                pcs.append(pc)

        resumo[codigo] = {
            "total_original": _round(total_original, 4),
            "total_restante": _round(total_restante, 4),
            "menor_data": min(datas_validas) if datas_validas else None,
            "scs": scs,
            "pcs": pcs,
        }

    return resumo


def _resumo_compras_codigo(compras: dict[str, list[dict]], codigo: str) -> dict:
    codigo_norm = _normalizar_codigo_produto(codigo)
    return _resumo_compras_por_codigo(compras).get(codigo_norm, {
        "total_original": 0.0,
        "total_restante": 0.0,
        "menor_data": None,
        "scs": [],
        "pcs": [],
    })

def _select_all_ops(query, page_size: int = 1000):
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


def _get_any_dict(row: dict, campos: list[str], default=None):
    if not row:
        return default

    for campo in campos:
        if campo in row:
            valor = row.get(campo)
            if valor is not None and str(valor).strip() != "":
                return valor

    mapa_lower = {str(k).strip().lower(): k for k in row.keys()}

    for campo in campos:
        chave = mapa_lower.get(str(campo).strip().lower())
        if chave is None:
            continue

        valor = row.get(chave)

        if valor is not None and str(valor).strip() != "":
            return valor

    return default


def _latest_posicao_estoque_snapshot() -> str | None:
    """
    Último snapshot da Posição de Estoque / base de consumo.

    Usado para MC porque esses itens não saem corretamente na SB8/f_estoque_saldo.
    """
    try:
        res = (
            supabase.table("f_consumo_materiais")
            .select("data_snapshot")
            .not_.is_("data_snapshot", "null")
            .order("data_snapshot", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0].get("data_snapshot")
    except Exception:
        return None

    return None


def _buscar_estoque_mc_posicao(codigos_mc: list[str]) -> tuple[dict[tuple, dict], str | None]:
    """
    Busca saldo dos materiais de consumo (MC) na Posição de Estoque.

    Regra:
      - MC passa a travar a OP;
      - MC não usa SB8 como fonte de saldo;
      - saldo vem da f_consumo_materiais, a mesma base da tela Gestão de Estoque;
      - NÃO depende de existir coluna/valor de armazém na tabela;
      - NÃO depende da coluna Tipo estar preenchida na posição;
      - o universo de MC vem da própria BOM da OP: componentes com tp = MC;
      - usa a coluna saldo_lote quando existir, com fallback para saldo;
      - no detalhe da OP, o saldo aparece como saldo_20, porque operacionalmente
        o MC pertence ao armazém 20.
    """
    codigos_norm = sorted({
        _normalizar_codigo_produto(c)
        for c in (codigos_mc or [])
        if _normalizar_codigo_produto(c)
    })

    if not codigos_norm:
        return {}, None

    codigos_set = set(codigos_norm)
    snapshot = _latest_posicao_estoque_snapshot()

    try:
        query = supabase.table("f_consumo_materiais").select("*")

        if snapshot:
            query = query.eq("data_snapshot", snapshot)

        # Importante: não filtramos no Supabase por "codigo".
        # A base pode vir com código sem zero à esquerda ou com nome de campo diferente.
        # Filtramos em Python usando _normalizar_codigo_produto.
        rows = _select_all_ops(query)
    except Exception:
        return {}, snapshot

    estoque: dict[tuple, dict] = {}

    for row in rows or []:
        codigo = _normalizar_codigo_produto(
            _get_any_dict(
                row,
                [
                    "codigo",
                    "Código",
                    "Codigo",
                    "produto_codigo",
                    "cod_produto",
                    "codprod",
                    "Cod Produto",
                    "Cod. Produto",
                ],
            )
        )

        if not codigo or codigo not in codigos_set:
            continue

        saldo = _to_float(
            _get_any_dict(
                row,
                [
                    "saldo_lote",
                    "Saldo Lote",
                    "SALDO LOTE",
                    "saldo",
                    "Saldo",
                    "saldo_disponivel",
                    "saldo_atual",
                    "qtd_saldo",
                ],
                0,
            )
        )

        if saldo <= 0:
            saldo = 0.0

        # Chave conceitual para a OP: MC será mostrado como armazém 20.
        chave = (codigo, "20")

        if chave not in estoque:
            estoque[chave] = {
                "saldo_lote": 0.0,
                "empenho_lote": 0.0,
                "saldo_disponivel": 0.0,
                "origem_estoque": "posicao_estoque_consumo_mc_saldo_lote",
                "data_ref": snapshot,
            }

        estoque[chave]["saldo_lote"] += saldo
        estoque[chave]["saldo_disponivel"] += saldo


    return estoque, snapshot


def _normalizar_tp_ops(value) -> str:
    texto = str(value or "").strip().upper()

    if not texto or texto in {"NAN", "NONE", "NULL"}:
        return ""

    texto = texto.replace(".", "").replace("/", " ").replace("-", " ").strip()

    for tp in ["MC", "MP", "ME", "MI", "PI"]:
        if texto == tp or texto.startswith(tp + " ") or f" {tp} " in f" {texto} ":
            return tp

    return texto[:2] if texto[:2] in {"MC", "MP", "ME", "MI", "PI"} else texto


def _buscar_tipos_posicao_estoque(codigos: list[str]) -> tuple[dict[str, dict], str | None]:
    """
    Busca o tipo oficial da Posição de Estoque para os componentes da OP.

    Regra 2026-06-11:
      - se o componente existir na Posição de Estoque/f_consumo_materiais,
        o tipo da Posição é prioritário;
      - se não existir na Posição, usa o tipo da BOM/estrutura;
      - isso corrige casos como 08931, que na BOM veio como ME, mas na
        Posição de Estoque está como MC e deve usar saldo/armazém 20.
    """
    codigos_norm = sorted({
        _normalizar_codigo_produto(c)
        for c in (codigos or [])
        if _normalizar_codigo_produto(c)
    })

    if not codigos_norm:
        return {}, None

    codigos_set = set(codigos_norm)
    snapshot = _latest_posicao_estoque_snapshot()

    try:
        query = supabase.table("f_consumo_materiais").select("*")

        if snapshot:
            query = query.eq("data_snapshot", snapshot)

        rows = _select_all_ops(query)
    except Exception:
        return {}, snapshot

    tipos: dict[str, dict] = {}
    prioridade_tp = {"MC": 5, "MP": 4, "ME": 3, "MI": 2, "PI": 1}

    for row in rows or []:
        codigo = _normalizar_codigo_produto(
            _get_any_dict(
                row,
                [
                    "codigo",
                    "Código",
                    "Codigo",
                    "produto_codigo",
                    "cod_produto",
                    "codprod",
                    "Cod Produto",
                    "Cod. Produto",
                ],
            )
        )

        if not codigo or codigo not in codigos_set:
            continue

        tipo_raw = _get_any_dict(row, ["tipo", "Tipo", "TP", "tp", "B1_TIPO", "b1_tipo"], "")
        nome_2 = _get_any_dict(row, ["nome_2", "Nome_2", "NOME_2", "tipo_descricao", "Tipo Descricao"], "")
        tp = _normalizar_tp_ops(tipo_raw) or _normalizar_tp_ops(nome_2)

        if not tp:
            continue

        armazem = str(_get_any_dict(row, ["armazem", "Armazem", "Armaz", "armaz", "local"], "") or "").strip()
        if armazem.endswith(".0"):
            armazem = armazem[:-2]
        if armazem.isdigit():
            armazem = armazem.zfill(2)

        saldo = _to_float(
            _get_any_dict(
                row,
                [
                    "saldo_lote",
                    "Saldo Lote",
                    "SALDO LOTE",
                    "saldo",
                    "Saldo",
                    "saldo_disponivel",
                    "saldo_atual",
                    "qtd_saldo",
                ],
                0,
            )
        )

        atual = tipos.get(codigo)
        if atual:
            tp_atual = atual.get("tp") or ""
            if prioridade_tp.get(tp, 0) < prioridade_tp.get(tp_atual, 0):
                continue

        tipos[codigo] = {
            "codigo": codigo,
            "tp": tp,
            "tipo_raw": tipo_raw,
            "nome_2": nome_2,
            "armazem": armazem,
            "saldo_posicao": _round(saldo),
            "data_ref": snapshot,
            "origem_tipo": "posicao_estoque",
        }

    return tipos, snapshot


def _buscar_estoque_mais_recente(codigos: list[str], codigos_mc: list[str] | None = None) -> tuple[dict[tuple, dict], str | None]:
    """
    Busca estoque atual da SB8 para viabilidade das OPs.

    Correção 2026-06-11:
    A versão anterior tentava usar snapshot_id do último registro criado.
    Em alguns uploads isso deixava a página de Ordens pegando um recorte
    incompleto/antigo da SB8. Exemplo real: 71911 aparecia com ~564 CE na tela,
    mas a SB8 atual tinha 456,23 + 16.660,00 = 17.116,23 CE no armazém 01.

    Nova regra para OPs:
      - MP/ME/MI: armazém 01;
      - PI: armazém 02;
      - 98: quarentena/CQ separado;
      - código sempre exato e normalizado;
      - para cada código + armazém, usa a última data_ref disponível daquele par;
      - dentro dessa última data_ref, soma todos os lotes;
      - saldo disponível = saldo_lote - empenho_lote quando o empenho existir.
    """
    codigos_norm = sorted({
        _normalizar_codigo_produto(c)
        for c in (codigos or [])
        if _normalizar_codigo_produto(c)
    })

    if not codigos_norm:
        return {}, None

    armazens_validos = {"01", "02", "98"}

    def _normalizar_armazem_ops(value) -> str:
        texto = str(value or "").strip().upper()
        if texto.endswith(".0"):
            texto = texto[:-2]
        return texto.zfill(2) if texto.isdigit() else texto

    def _valor_saldo_lote_ops(row: dict) -> float:
        return _to_float(
            _get_any_dict(
                row,
                [
                    "saldo_lote",
                    "Saldo Lote",
                    "SALDO LOTE",
                    "saldo",
                    "Saldo",
                    "saldo_disponivel",
                    "saldo_atual",
                    "qtd_saldo",
                ],
                0,
            )
        )

    def _valor_empenho_lote_ops(row: dict) -> float:
        return _to_float(
            _get_any_dict(
                row,
                [
                    "empenho_lote",
                    "Empenho Lote",
                    "Empenho do Lote",
                    "Emp. do Lote",
                    "Emp.Lote",
                    "empenho",
                    "empenhado",
                    "qtd_empenhada",
                    "saldo_empenhado",
                ],
                0,
            )
        )

    rows = []

    # Evita URL muito grande no PostgREST quando há muitos componentes na BOM.
    chunk_size = 80

    try:
        for i in range(0, len(codigos_norm), chunk_size):
            chunk = codigos_norm[i:i + chunk_size]
            query = (
                supabase.table("f_estoque_saldo")
                .select("*")
                .in_("codigo", chunk)
                .in_("armazem", sorted(armazens_validos))
            )
            rows.extend(_select_all_ops(query))
    except Exception:
        rows = []

    # Fallback para bases antigas/processors com nome de código diferente.
    # Lê a tabela e filtra em Python. Só entra se a busca filtrada não trouxer nada.
    if not rows:
        try:
            rows_all = _select_all_ops(
                supabase.table("f_estoque_saldo")
                .select("*")
                .in_("armazem", sorted(armazens_validos))
            )
        except Exception:
            rows_all = []

        codigos_set = set(codigos_norm)
        for row in rows_all or []:
            codigo_row = _normalizar_codigo_produto(
                _get_any_dict(
                    row,
                    ["codigo", "produto", "cod_produto", "produto_codigo", "B8_PRODUTO", "b8_produto"],
                )
            )
            if codigo_row in codigos_set:
                rows.append(row)

    # Agrupa primeiro por código + armazém + data_ref.
    # Depois escolhe a última data_ref por código + armazém.
    por_chave_data: dict[tuple[str, str, str], dict] = {}

    for row in rows or []:
        codigo = _normalizar_codigo_produto(
            _get_any_dict(
                row,
                ["codigo", "produto", "cod_produto", "produto_codigo", "B8_PRODUTO", "b8_produto"],
            )
        )
        armazem = _normalizar_armazem_ops(
            _get_any_dict(row, ["armazem", "armaz", "local", "b8_local", "B8_LOCAL"])
        )
        data_ref_raw = _get_any_dict(row, ["data_ref", "data", "dt_ref", "snapshot_data"])

        if not codigo or codigo not in set(codigos_norm):
            continue

        if armazem not in armazens_validos:
            continue

        if not data_ref_raw:
            continue

        data_ref_key = str(data_ref_raw)[:10]
        chave_data = (codigo, armazem, data_ref_key)

        saldo_lote = _valor_saldo_lote_ops(row)
        empenho_lote = _valor_empenho_lote_ops(row)

        # Se a base já gravou saldo_lote líquido, o empenho tende a estar zero.
        # Se a base trouxe saldo bruto + empenho, descontamos o empenho.
        saldo_disponivel = max(0.0, saldo_lote - empenho_lote)

        if chave_data not in por_chave_data:
            por_chave_data[chave_data] = {
                "saldo_lote": 0.0,
                "empenho_lote": 0.0,
                "saldo_disponivel": 0.0,
                "qtd_lotes": 0,
                "data_ref": data_ref_key,
                "origem_estoque": "sb8_ultima_data_ref_por_codigo_armazem",
            }

        por_chave_data[chave_data]["saldo_lote"] += saldo_lote
        por_chave_data[chave_data]["empenho_lote"] += empenho_lote
        por_chave_data[chave_data]["saldo_disponivel"] += saldo_disponivel
        por_chave_data[chave_data]["qtd_lotes"] += 1

    # Escolhe a última data_ref para cada código + armazém.
    datas_por_chave: dict[tuple[str, str], list[str]] = {}

    for codigo, armazem, data_ref_key in por_chave_data.keys():
        datas_por_chave.setdefault((codigo, armazem), []).append(data_ref_key)

    estoque: dict[tuple, dict] = {}
    datas_usadas = []

    for chave, datas in datas_por_chave.items():
        ultima_data = max(datas)
        codigo, armazem = chave
        valores = por_chave_data.get((codigo, armazem, ultima_data), {})

        estoque[(codigo, armazem)] = {
            "saldo_lote": _round(valores.get("saldo_lote")),
            "empenho_lote": _round(valores.get("empenho_lote")),
            "saldo_disponivel": _round(valores.get("saldo_disponivel")),
            "origem_estoque": valores.get("origem_estoque") or "sb8_ultima_data_ref_por_codigo_armazem",
            "data_ref": ultima_data,
            "qtd_lotes": int(valores.get("qtd_lotes") or 0),
        }
        datas_usadas.append(ultima_data)

    # MC não usa SB8 como fonte de saldo. Para esses itens, o saldo oficial
    # da viabilidade vem da Posição de Estoque / f_consumo_materiais.
    estoque_mc, data_ref_mc = _buscar_estoque_mc_posicao(codigos_mc or [])

    for chave, valores in estoque_mc.items():
        estoque[chave] = valores
        if valores.get("data_ref"):
            datas_usadas.append(str(valores.get("data_ref"))[:10])

    data_ref = max(datas_usadas) if datas_usadas else data_ref_mc

    return estoque, data_ref


def _estoque_por_chave(estoque: dict[tuple, dict], codigo: str, armazem: str) -> dict:
    codigo_norm = _normalizar_codigo_produto(codigo)
    armazem_norm = str(armazem or "").strip()
    if armazem_norm.endswith(".0"):
        armazem_norm = armazem_norm[:-2]
    if armazem_norm.isdigit():
        armazem_norm = armazem_norm.zfill(2)

    item = estoque.get((codigo_norm, armazem_norm), {})
    saldo_lote = _to_float(item.get("saldo_lote"))
    empenho_lote = _to_float(item.get("empenho_lote"))
    saldo_disponivel = _to_float(item.get("saldo_disponivel"))

    return {
        "saldo_lote": max(0.0, saldo_lote),
        "empenho_lote": max(0.0, empenho_lote),
        "saldo_disponivel": max(0.0, saldo_disponivel),
        "origem_estoque": item.get("origem_estoque") or "sb8_estoque_saldo",
        "data_ref": item.get("data_ref"),
        "qtd_lotes": item.get("qtd_lotes"),
    }


def _consumir_estoque(estoque: dict[tuple, dict], codigo: str, armazem: str, quantidade: float) -> float:
    qtd = max(0.0, _to_float(quantidade))
    if qtd <= 0:
        return 0.0

    codigo_norm = _normalizar_codigo_produto(codigo)
    armazem_norm = str(armazem or "").strip()
    if armazem_norm.endswith(".0"):
        armazem_norm = armazem_norm[:-2]
    if armazem_norm.isdigit():
        armazem_norm = armazem_norm.zfill(2)

    chave = (codigo_norm, armazem_norm)

    if chave not in estoque:
        estoque[chave] = {
            "saldo_lote": 0.0,
            "empenho_lote": 0.0,
            "saldo_disponivel": 0.0,
            "origem_estoque": "sem_saldo_encontrado",
            "data_ref": None,
        }

    disponivel = max(0.0, _to_float(estoque[chave].get("saldo_disponivel")))
    consumido = min(disponivel, qtd)

    estoque[chave]["saldo_disponivel"] = max(0.0, disponivel - consumido)

    saldo_lote = max(0.0, _to_float(estoque[chave].get("saldo_lote")))
    estoque[chave]["saldo_lote"] = max(0.0, saldo_lote - consumido)

    return consumido



def _consumir_compras(
    compras_disponiveis: dict[str, list[dict]],
    codigo: str,
    quantidade: float,
) -> dict:
    qtd = max(0.0, _to_float(quantidade))

    if qtd <= 0:
        return {
            "consumido": 0.0,
            "pedidos_usados": [],
            "faltante": 0.0,
        }

    codigo_norm = _normalizar_codigo_produto(codigo)
    pedidos = compras_disponiveis.get(codigo_norm, [])

    consumido_total = 0.0
    usados = []

    for pedido in pedidos:
        disponivel = _to_float(pedido.get("quantidade_pendente_restante"))

        if disponivel <= 0:
            continue

        consumo = min(disponivel, qtd)

        pedido["quantidade_pendente_restante"] = max(0.0, disponivel - consumo)

        qtd -= consumo
        consumido_total += consumo

        usados.append({
            "produto_codigo": pedido.get("produto_codigo"),
            "produto_descricao": pedido.get("produto_descricao"),
            "quantidade_pendente_original": _round(pedido.get("quantidade_pendente_original")),
            "quantidade_pendente_restante": _round(pedido.get("quantidade_pendente_restante")),
            "quantidade_utilizada": _round(consumo),
            "data_prevista_entrega": pedido.get("data_prevista_entrega"),
            "pedido_numero": pedido.get("pedido_numero"),
            "sc_numero": pedido.get("sc_numero"),
            "razao_social_fornecedor": pedido.get("razao_social_fornecedor"),
            "comprador_nome": pedido.get("comprador_nome"),
            "entrega_status": pedido.get("entrega_status"),
        })

        if qtd <= 0:
            break

    return {
        "consumido": _round(consumido_total),
        "pedidos_usados": usados,
        "faltante": _round(qtd),
    }


def _formatar_op_aberta(op: dict) -> dict:
    quantidade_programada = _to_float(op.get("quantidade"))
    quantidade_calculo = _to_float(op.get("quantidade_calculo") or quantidade_programada)
    quantidade_teorica = _to_float(op.get("quantidade_teorica") or quantidade_calculo)

    return {
        "id": op.get("id"),
        "fifo_posicao": op.get("fifo_posicao"),
        "tipo_fifo": op.get("tipo_fifo"),
        "mes_ref": op.get("mes_ref"),
        "lote": op.get("lote"),
        "codigo": op.get("codigo"),
        "produto": op.get("produto", ""),
        "linha": op.get("linha"),
        "quantidade": quantidade_programada,
        "quantidade_programada": quantidade_programada,
        "qtd_teorica_abertura": op.get("qtd_teorica_abertura"),
        "quantidade_teorica": quantidade_teorica,
        "quantidade_calculo": quantidade_calculo,
        "usa_lote_teorico": bool(op.get("usa_lote_teorico")),
        "lote_teorico_encontrado": bool(op.get("lote_teorico_encontrado")),
        "linha_lote_teorico": op.get("linha_lote_teorico"),
        "letra_lote_teorico": op.get("letra_lote_teorico"),
        "observacao_lote_teorico": op.get("observacao_lote_teorico"),
        "data_fim": op.get("data_fim"),
        "op_numero": op.get("op_numero"),
        "status": "aberta",
        "alertas": [],
        "detalhes": [],
        "resumo_faltas": "",
        "qtd_componentes_faltando": 0,
        "qtd_total_faltante": 0,
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
    faltas = [a for a in alertas if a.get("status") in {"falta", "falta_parcial", "compra_fora_prazo"}]
    quarentena = [a for a in alertas if a.get("status") == "quarentena"]

    partes = []

    if faltas:
        itens = []
        for a in faltas[:4]:
            desc = a.get("descricao") or a.get("codigo_comp")
            faltante = _round(a.get("faltante"), 2)
            unidade = a.get("unidade") or "un"
            status = a.get("status")
            if status == "compra_fora_prazo":
                itens.append(f"{_fmt_br(faltante)} {unidade} de {desc} sem compra no prazo")
            else:
                itens.append(f"{_fmt_br(faltante)} {unidade} de {desc}")
        partes.append("Falta " + "; ".join(itens))

    if quarentena:
        itens = []
        for a in quarentena[:3]:
            desc = a.get("descricao") or a.get("codigo_comp")
            faltante = _round(a.get("faltante_fisico_hoje") or a.get("faltante"), 2)
            unidade = a.get("unidade") or "un"
            itens.append(f"{_fmt_br(faltante)} {unidade} de {desc}")
        partes.append("Depende de liberação do CQ para " + "; ".join(itens))

    return ". ".join(partes)


def _parse_iso_date(value: str | None):
    """
    Normaliza datas usadas na comparação de compras x início da OP.

    A base de compras pode chegar tanto em ISO (2026-06-19) quanto em
    formato brasileiro de Excel/CSV (19/06/2026). A versão anterior só
    aceitava ISO; quando a compra vinha como dd/mm/aaaa, ela era tratada
    como sem data válida e acabava sendo classificada como fora do prazo.
    """
    if not value:
        return None

    texto = str(value).strip()
    if not texto:
        return None

    texto10 = texto[:10]

    # ISO / Supabase: 2026-06-19 ou 2026-06-19T...
    try:
        return datetime.fromisoformat(texto10).date()
    except Exception:
        pass

    # Excel/BR: 19/06/2026
    try:
        return datetime.strptime(texto10, "%d/%m/%Y").date()
    except Exception:
        pass

    # Excel/BR curto: 19/06/26
    try:
        return datetime.strptime(texto10, "%d/%m/%y").date()
    except Exception:
        return None



def _classificar_compra_para_op(
    necessario: float,
    saldo_disponivel_ref: float,
    saldo_disponivel_98: float,
    qtd_compra_utilizada: float,
    compras_utilizadas: list[dict],
    data_inicio_fabricacao: str | None,
    leadtime_compra_dias: int = 2,
) -> dict:
    """
    Classifica se a compra ajuda a abrir a OP considerando lead time operacional.

    Regra:
      Data limite de entrega = data_inicio_fabricacao - leadtime_compra_dias

    A compra só conta para abertura da OP se a DATA PREVISTA DE ENTREGA
    for menor ou igual à data limite.
    """

    necessario = _to_float(necessario)
    saldo_base = _to_float(saldo_disponivel_ref) + _to_float(saldo_disponivel_98)
    qtd_compra_utilizada = _to_float(qtd_compra_utilizada)
    saldo_futuro = saldo_base + qtd_compra_utilizada
    eps = 0.0001

    leadtime_compra_dias = max(0, int(_to_float(leadtime_compra_dias)))

    data_inicio = _parse_iso_date(data_inicio_fabricacao)
    data_limite = data_inicio - timedelta(days=leadtime_compra_dias) if data_inicio else None

    compras_ordenadas = sorted(
        compras_utilizadas or [],
        key=lambda x: str(x.get("data_prevista_entrega") or "9999-12-31"),
    )

    compra_total = sum(_to_float(c.get("quantidade_utilizada")) for c in compras_ordenadas)

    qtd_entrega_ate_limite = 0.0
    qtd_entrega_apos_limite = 0.0
    data_entrega_parcial = None

    saldo_acumulado_total = saldo_base
    data_prevista_final = None

    for compra in compras_ordenadas:
        data_entrega_str = str(compra.get("data_prevista_entrega") or "")[:10]
        data_entrega = _parse_iso_date(data_entrega_str)
        qtd_compra = _to_float(compra.get("quantidade_utilizada"))

        if data_limite and data_entrega and data_entrega <= data_limite:
            qtd_entrega_ate_limite += qtd_compra

            if qtd_compra > 0 and data_entrega_parcial is None:
                data_entrega_parcial = data_entrega.isoformat()
        else:
            qtd_entrega_apos_limite += qtd_compra

        saldo_acumulado_total += qtd_compra

        if data_prevista_final is None and (saldo_acumulado_total + eps) >= necessario:
            data_prevista_final = data_entrega.isoformat() if data_entrega else None

    saldo_ate_limite = saldo_base + qtd_entrega_ate_limite
    abre_op = (saldo_ate_limite + eps) >= necessario

    faltante_na_data_limite = max(0.0, necessario - saldo_ate_limite)
    if faltante_na_data_limite <= eps:
        faltante_na_data_limite = 0.0

    datas_validas = [
        str(c.get("data_prevista_entrega") or "")[:10]
        for c in compras_ordenadas
        if c.get("data_prevista_entrega")
    ]
    menor_data = min(datas_validas) if datas_validas else None

    if qtd_compra_utilizada <= eps:
        status_compra = "sem_compra"
        cobre_op = "Não"
    elif abre_op:
        status_compra = "no_prazo"
        cobre_op = "Sim"
    elif (saldo_futuro + eps) >= necessario:
        # Compra cobre a necessidade total, mas só depois da data limite.
        status_compra = "nao_abre"
        cobre_op = "Não"
    else:
        # Nem com compras abertas chega a cobrir a OP.
        status_compra = "nao_cobre"
        cobre_op = "Não"

    return {
        "saldo_futuro": _round(saldo_futuro),
        "coberto_por_compra": (saldo_futuro + eps) >= necessario and qtd_compra_utilizada > eps,
        "abre_no_prazo": abre_op,
        "status_compra": status_compra,
        "menor_data_entrega_compra": menor_data,

        "leadtime_compra_dias": leadtime_compra_dias,
        "data_limite_compra": data_limite.isoformat() if data_limite else None,
        "compra_total": _round(compra_total),
        "data_prevista_final": data_prevista_final,
        "qtd_entrega_ate_limite": _round(qtd_entrega_ate_limite),
        "qtd_entrega_apos_limite": _round(qtd_entrega_apos_limite),
        "data_entrega_parcial": data_entrega_parcial,
        "abre_op": abre_op,
        "cobre_op": cobre_op,
        "faltante_na_data_limite": _round(faltante_na_data_limite),

        # Compatibilidade com o front anterior
        "qtd_compra_ate_inicio": _round(qtd_entrega_ate_limite),
        "qtd_compra_apos_inicio": _round(qtd_entrega_apos_limite),
        "faltante_na_data_op": _round(faltante_na_data_limite),
        "data_cobertura_compra": data_prevista_final,
    }



def _verificar_op(
    op: dict,
    componentes: list[dict],
    estoque: dict[tuple, dict],
    compras_abertas: dict[str, list[dict]],
    leadtime_compra_dias: int = 2,
    compras_total_por_codigo: dict[str, dict] | None = None,
    tipos_posicao_estoque: dict[str, dict] | None = None,
) -> dict:
    quantidade_programada = _to_float(op.get("quantidade"))
    quantidade_op = _to_float(op.get("quantidade_calculo") or op.get("qtd_teorica_abertura") or quantidade_programada)
    quantidade_teorica = _to_float(op.get("quantidade_teorica") or quantidade_op)

    detalhes = []
    tem_falta = False
    tem_quarentena = False
    tem_compra_fora_prazo = False
    tem_compra_no_prazo = False

    compras_total_por_codigo = compras_total_por_codigo or {}
    tipos_posicao_estoque = tipos_posicao_estoque or {}

    for comp in componentes:
        codigo_comp = _normalizar_codigo_produto(comp.get("codigo_comp"))

        tp_bom = _normalizar_tp_ops(comp.get("tp"))
        tipo_posicao_info = tipos_posicao_estoque.get(codigo_comp) or {}
        tp_posicao = _normalizar_tp_ops(tipo_posicao_info.get("tp"))

        # Tipo da Posição de Estoque é prioritário. Se o código não existir lá,
        # usa o tipo da BOM/estrutura.
        tp = tp_posicao or tp_bom
        origem_tipo = "posicao_estoque" if tp_posicao else "bom_estrutura"

        armazem_ref = ARMAZEM_POR_TP.get(tp, ARMAZEM_POR_TP.get(tp_bom, "01"))
        gargalante = tp in TPS_GARGALANTES or tp_bom in TPS_GARGALANTES

        qtd_unit = _to_float(comp.get("quantidade"))
        necessario = round(qtd_unit * quantidade_op, 6)

        desc_comp = comp.get("descricao_comp", "")
        unidade = comp.get("unidade", "")

        estoque_ref = _estoque_por_chave(estoque, codigo_comp, armazem_ref)
        estoque_98 = _estoque_por_chave(estoque, codigo_comp, "98")

        saldo_lote_ref = estoque_ref["saldo_lote"]
        empenho_lote_ref = estoque_ref["empenho_lote"]
        saldo_disponivel_ref = estoque_ref["saldo_disponivel"]

        saldo_lote_98 = estoque_98["saldo_lote"]
        empenho_lote_98 = estoque_98["empenho_lote"]
        saldo_disponivel_98 = estoque_98["saldo_disponivel"] if armazem_ref == "01" else 0.0

        compras_total_info = compras_total_por_codigo.get(codigo_comp) or _resumo_compras_codigo(compras_abertas, codigo_comp)
        compras_abertas_total_codigo = _to_float(compras_total_info.get("total_original"))
        compras_abertas_restante_antes = _to_float(_resumo_compras_codigo(compras_abertas, codigo_comp).get("total_restante"))
        menor_data_compra_total = compras_total_info.get("menor_data")

        faltante_ref = max(0.0, necessario - saldo_disponivel_ref)
        faltante_fisico_hoje = max(0.0, necessario - saldo_disponivel_ref - saldo_disponivel_98)

        if saldo_disponivel_ref >= necessario:
            status_fisico = "ok"
            faltante_fisico_status = 0.0
        elif armazem_ref == "01" and (saldo_disponivel_ref + saldo_disponivel_98) >= necessario:
            status_fisico = "quarentena"
            faltante_fisico_status = faltante_ref
        else:
            status_fisico = "falta"
            faltante_fisico_status = faltante_fisico_hoje

        consumo_ref = 0.0
        consumo_98 = 0.0
        compras_utilizadas = []
        qtd_compra_utilizada = 0.0
        compra_faltante_pos_consumo = faltante_fisico_status

        if gargalante and necessario > 0:
            consumo_ref = _consumir_estoque(estoque, codigo_comp, armazem_ref, necessario)
            restante_para_consumir = max(0.0, necessario - consumo_ref)

            if armazem_ref == "01" and restante_para_consumir > 0:
                consumo_98 = _consumir_estoque(estoque, codigo_comp, "98", restante_para_consumir)

            restante_apos_estoque = max(0.0, necessario - consumo_ref - consumo_98)

            if restante_apos_estoque > 0:
                consumo_compras = _consumir_compras(
                    compras_abertas,
                    codigo_comp,
                    restante_apos_estoque,
                )
                qtd_compra_utilizada = _to_float(consumo_compras.get("consumido"))
                compras_utilizadas = consumo_compras.get("pedidos_usados") or []
                compra_faltante_pos_consumo = _to_float(consumo_compras.get("faltante"))
            else:
                compra_faltante_pos_consumo = 0.0

        saldo_restante_ref = max(0.0, saldo_disponivel_ref - consumo_ref)
        saldo_restante_98 = max(0.0, saldo_disponivel_98 - consumo_98)

        compra_info = _classificar_compra_para_op(
            necessario=necessario,
            saldo_disponivel_ref=saldo_disponivel_ref,
            saldo_disponivel_98=saldo_disponivel_98,
            qtd_compra_utilizada=qtd_compra_utilizada,
            compras_utilizadas=compras_utilizadas,
            data_inicio_fabricacao=op.get("data_inicio_fabricacao"),
            leadtime_compra_dias=leadtime_compra_dias,
        )

        # Status final operacional:
        # - falta física com compra no prazo não deve travar a OP;
        # - compra fora do prazo continua travando;
        # - faltante_total passa a representar faltante após compras no prazo.
        status_comp = status_fisico
        status_operacional = status_fisico
        faltante_apos_compras = max(0.0, compra_faltante_pos_consumo)
        faltante_na_data_limite = _to_float(compra_info.get("faltante_na_data_limite"))

        if status_fisico == "falta":
            if compra_info.get("abre_no_prazo") and faltante_apos_compras <= 0.0001:
                # Compatibilidade com o front atual:
                # compra no prazo não deve aparecer como "Falta Mat.".
                # Mantemos o detalhe gerencial em status_operacional/status_compra,
                # mas o status principal fica ok para não entrar em materiais travando.
                status_comp = "ok"
                status_operacional = "compra_no_prazo"
                faltante_operacional = 0.0
                tem_compra_no_prazo = True
            elif compra_info.get("coberto_por_compra") and faltante_apos_compras <= 0.0001:
                status_comp = "compra_fora_prazo"
                status_operacional = "compra_fora_prazo"
                faltante_operacional = faltante_na_data_limite
                tem_compra_fora_prazo = True
            elif qtd_compra_utilizada > 0:
                status_comp = "falta_parcial"
                status_operacional = "falta_parcial"
                faltante_operacional = faltante_apos_compras
                tem_falta = True
            else:
                status_comp = "falta"
                status_operacional = "falta"
                faltante_operacional = faltante_fisico_hoje
                tem_falta = True
        elif status_fisico == "quarentena":
            faltante_operacional = faltante_fisico_status
            tem_quarentena = True
        else:
            faltante_operacional = 0.0

        compras_no_prazo = _to_float(compra_info.get("qtd_entrega_ate_limite"))
        compras_fora_prazo = _to_float(compra_info.get("qtd_entrega_apos_limite"))

        detalhes.append({
            "codigo_comp": codigo_comp,
            "descricao": desc_comp,
            "tp": tp,
            "tp_bom": tp_bom,
            "tp_posicao_estoque": tp_posicao,
            "origem_tp": origem_tipo,
            "unidade": unidade,
            "necessario": _round(necessario),
            "armazem_ref": armazem_ref,

            "saldo_lote": _round(saldo_lote_ref),
            "empenho_lote": _round(empenho_lote_ref),
            "saldo_disponivel": _round(saldo_disponivel_ref),

            "saldo_lote_98": _round(saldo_lote_98),
            "empenho_lote_98": _round(empenho_lote_98),
            "saldo_disponivel_98": _round(saldo_disponivel_98),

            "saldo_01": _round(saldo_disponivel_ref) if armazem_ref == "01" else 0.0,
            "saldo_02": _round(saldo_disponivel_ref) if armazem_ref == "02" else 0.0,
            "saldo_20": _round(saldo_disponivel_ref) if armazem_ref == "20" else 0.0,
            "saldo_98": _round(saldo_disponivel_98),

            "consumo_01": _round(consumo_ref) if armazem_ref == "01" else 0.0,
            "consumo_02": _round(consumo_ref) if armazem_ref == "02" else 0.0,
            "consumo_20": _round(consumo_ref) if armazem_ref == "20" else 0.0,
            "consumo_98": _round(consumo_98),
            "saldo_restante": _round(saldo_restante_ref),
            "saldo_restante_01": _round(saldo_restante_ref) if armazem_ref == "01" else 0.0,
            "saldo_restante_02": _round(saldo_restante_ref) if armazem_ref == "02" else 0.0,
            "saldo_restante_20": _round(saldo_restante_ref) if armazem_ref == "20" else 0.0,
            "saldo_restante_98": _round(saldo_restante_98),

            "origem_estoque": estoque_ref.get("origem_estoque"),
            "data_ref_estoque": estoque_ref.get("data_ref"),

            # Campos novos de leitura gerencial
            "faltante_fisico_hoje": _round(faltante_fisico_hoje),
            "faltante_apos_compras": _round(faltante_apos_compras),
            "faltante_na_data_limite": _round(faltante_na_data_limite),
            "faltante_operacional": _round(faltante_operacional),

            # Compatibilidade: faltante agora significa o que ainda trava a abertura.
            "faltante": _round(faltante_operacional),
            "status_fisico": status_fisico,
            "status_operacional": status_operacional,
            "status": status_comp,
            "gargalante": gargalante,

            # Compras: separa total ERP x alocado na cascata.
            "compras_abertas": compras_utilizadas,
            "qtd_compras_pendente": _round(qtd_compra_utilizada),
            "qtd_compras_alocada": _round(qtd_compra_utilizada),
            "qtd_compras_total_aberto": _round(compras_abertas_total_codigo),
            "qtd_compras_restante_antes_op": _round(compras_abertas_restante_antes),
            "qtd_compras_no_prazo": _round(compras_no_prazo),
            "qtd_compras_fora_prazo": _round(compras_fora_prazo),
            "menor_data_entrega_total": menor_data_compra_total,
            "faltante_pos_compra": _round(compra_faltante_pos_consumo),
            "saldo_futuro": compra_info["saldo_futuro"],
            "coberto_por_compra": compra_info["coberto_por_compra"],
            "abre_no_prazo": compra_info["abre_no_prazo"],
            "status_compra": compra_info["status_compra"],
            "menor_data_entrega_compra": compra_info["menor_data_entrega_compra"],
            "data_limite_compra": compra_info.get("data_limite_compra"),
            "data_cobertura_compra": compra_info.get("data_cobertura_compra"),
            "leadtime_compra_dias": compra_info.get("leadtime_compra_dias"),
            "cobre_op": compra_info.get("cobre_op"),
        })

    if tem_falta:
        status_op = "falta"
    elif tem_compra_fora_prazo:
        status_op = "compra_fora_prazo"
    elif tem_quarentena:
        status_op = "quarentena"
    elif tem_compra_no_prazo:
        # Para o front atual, OP coberta por compra no prazo fica verde/OK.
        # O detalhe segue em avisos/status_operacional = compra_no_prazo.
        status_op = "ok"
    else:
        status_op = "ok"

    # Compra no prazo não entra em materiais travando; é uma cobertura futura válida.
    alertas = [
        d for d in detalhes
        if d["status"] != "ok" and d.get("gargalante", True)
    ]
    avisos = [
        d for d in detalhes
        if d.get("status_operacional") == "compra_no_prazo" and d.get("gargalante", True)
    ]
    resumo_faltas = _montar_resumo_faltas(alertas)

    return {
        "id": op.get("id"),
        "fifo_posicao": op.get("fifo_posicao"),
        "tipo_fifo": op.get("tipo_fifo"),
        "mes_ref": op.get("mes_ref"),
        "lote": op.get("lote"),
        "codigo": op.get("codigo"),
        "produto": op.get("produto", ""),
        "linha": op.get("linha"),
        "quantidade": quantidade_programada,
        "quantidade_programada": quantidade_programada,
        "qtd_teorica_abertura": op.get("qtd_teorica_abertura"),
        "quantidade_teorica": quantidade_teorica,
        "quantidade_calculo": quantidade_op,
        "usa_lote_teorico": bool(op.get("usa_lote_teorico")),
        "lote_teorico_encontrado": bool(op.get("lote_teorico_encontrado")),
        "linha_lote_teorico": op.get("linha_lote_teorico"),
        "letra_lote_teorico": op.get("letra_lote_teorico"),
        "observacao_lote_teorico": op.get("observacao_lote_teorico"),
        "data_fim": op.get("data_fim"),
        "op_numero": op.get("op_numero"),
        "status": status_op,
        "status_operacional": "compra_no_prazo" if tem_compra_no_prazo and not tem_falta and not tem_compra_fora_prazo and not tem_quarentena else status_op,
        "alertas": alertas,
        "avisos": avisos,
        "detalhes": detalhes,
        "resumo_faltas": resumo_faltas,
        "qtd_componentes_faltando": len([a for a in alertas if a.get("status") in {"falta", "falta_parcial", "compra_fora_prazo"}]),
        "qtd_componentes_cobertos_compra": len(avisos),
        "qtd_total_faltante": _round(sum(_to_float(a.get("faltante")) for a in alertas if a.get("status") in {"falta", "falta_parcial", "compra_fora_prazo"})),
        "qtd_total_faltante_fisico_hoje": _round(sum(_to_float(d.get("faltante_fisico_hoje")) for d in detalhes if d.get("gargalante", True))),
        "qtd_total_compras_no_prazo": _round(sum(_to_float(d.get("qtd_compras_no_prazo")) for d in detalhes if d.get("gargalante", True))),
        "anotacao": op.get("anotacao"),
        "tempo_horas": op.get("tempo_horas"),
        "un_h": op.get("un_h"),
        "observacoes": op.get("observacoes"),
        "data_lavagem_emb": op.get("data_lavagem_emb"),
        "data_lavagem_pesagem": op.get("data_lavagem_pesagem"),
        "data_inicio_fabricacao": op.get("data_inicio_fabricacao"),
        "data_termino": op.get("data_termino"),
    }



def _montar_criticos(todas: list[dict]) -> list[dict]:
    materiais: dict[str, dict] = {}

    STATUS_CRITICOS = {"falta", "falta_parcial", "compra_fora_prazo", "quarentena"}

    for op in todas:
        # Materiais cobertos por compra no prazo não entram como travando abertura.
        if op.get("status") not in ["falta", "falta_parcial", "compra_fora_prazo", "quarentena"]:
            continue

        for comp in op.get("alertas", []):
            if comp.get("status") not in STATUS_CRITICOS:
                continue

            codigo = _normalizar_codigo_produto(comp.get("codigo_comp"))
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
                    "faltante_fisico_hoje_total": 0.0,
                    "faltante_apos_compras_total": 0.0,
                    "necessario_total": 0.0,
                    "status": comp.get("status"),
                    # Compatibilidade com o front atual: esta coluna passa a mostrar total aberto ERP.
                    "qtd_compras_pendente": 0.0,
                    "qtd_compras_total_aberto": 0.0,
                    "qtd_compras_alocada": 0.0,
                    "qtd_compras_no_prazo": 0.0,
                    "qtd_compras_fora_prazo": 0.0,
                    "coberto_por_compra": False,
                    "abre_no_prazo": False,
                    "menor_data_entrega_compra": None,
                    "data_limite_compra": None,
                }

            materiais[codigo]["ops_impactadas"] += 1
            materiais[codigo]["faltante_total"] += _to_float(comp.get("faltante"))
            materiais[codigo]["faltante_fisico_hoje_total"] += _to_float(comp.get("faltante_fisico_hoje"))
            materiais[codigo]["faltante_apos_compras_total"] += _to_float(comp.get("faltante_apos_compras"))
            materiais[codigo]["necessario_total"] += _to_float(comp.get("necessario"))
            materiais[codigo]["qtd_compras_alocada"] += _to_float(comp.get("qtd_compras_alocada"))
            materiais[codigo]["qtd_compras_no_prazo"] += _to_float(comp.get("qtd_compras_no_prazo"))
            materiais[codigo]["qtd_compras_fora_prazo"] += _to_float(comp.get("qtd_compras_fora_prazo"))

            # Total aberto do ERP não deve somar por OP, senão duplica.
            materiais[codigo]["qtd_compras_total_aberto"] = max(
                _to_float(materiais[codigo].get("qtd_compras_total_aberto")),
                _to_float(comp.get("qtd_compras_total_aberto")),
            )
            materiais[codigo]["qtd_compras_pendente"] = materiais[codigo]["qtd_compras_total_aberto"]

            # Prioridade de status: falta > compra fora do prazo > quarentena > falta parcial.
            status_atual = materiais[codigo].get("status")
            status_novo = comp.get("status")
            prioridade = {
                "falta": 4,
                "compra_fora_prazo": 3,
                "falta_parcial": 2,
                "quarentena": 1,
            }
            if prioridade.get(status_novo, 0) > prioridade.get(status_atual, 0):
                materiais[codigo]["status"] = status_novo

            if comp.get("coberto_por_compra"):
                materiais[codigo]["coberto_por_compra"] = True

            if comp.get("abre_no_prazo"):
                materiais[codigo]["abre_no_prazo"] = True

            data_compra = comp.get("menor_data_entrega_compra") or comp.get("menor_data_entrega_total")
            if data_compra:
                atual = materiais[codigo].get("menor_data_entrega_compra")
                materiais[codigo]["menor_data_entrega_compra"] = min(atual, data_compra) if atual else data_compra

            data_limite = comp.get("data_limite_compra")
            if data_limite:
                atual = materiais[codigo].get("data_limite_compra")
                materiais[codigo]["data_limite_compra"] = min(atual, data_limite) if atual else data_limite

    lista = list(materiais.values())

    lista.sort(
        key=lambda x: (
            1 if x.get("status") == "falta" else 0,
            1 if x.get("status") == "compra_fora_prazo" else 0,
            x.get("ops_impactadas", 0),
            x.get("faltante_total", 0),
        ),
        reverse=True,
    )

    for item in lista:
        item["faltante_total"] = _round(item["faltante_total"], 2)
        item["faltante_fisico_hoje_total"] = _round(item["faltante_fisico_hoje_total"], 2)
        item["faltante_apos_compras_total"] = _round(item["faltante_apos_compras_total"], 2)
        item["necessario_total"] = _round(item["necessario_total"], 2)
        item["qtd_compras_pendente"] = _round(item["qtd_compras_pendente"], 2)
        item["qtd_compras_total_aberto"] = _round(item["qtd_compras_total_aberto"], 2)
        item["qtd_compras_alocada"] = _round(item["qtd_compras_alocada"], 2)
        item["qtd_compras_no_prazo"] = _round(item["qtd_compras_no_prazo"], 2)
        item["qtd_compras_fora_prazo"] = _round(item["qtd_compras_fora_prazo"], 2)

    return lista[:20]


@router.get("/viabilidade")
def viabilidade_ops(
    mes_ref: str = Query(..., description="Mês de referência no formato YYYY-MM, ex: 2026-05"),
    linha: str | None = Query(None, description="Filtrar por linha: ENVASE_L1, ENVASE_L2, EMBALAGEM"),
    leadtime_compra_dias: int = Query(2, ge=0, le=30, description="Dias de antecedência necessários entre entrega da compra e início da fabricação"),
):
    ops = _buscar_ops(mes_ref)

    if not ops:
        raise HTTPException(
            status_code=404,
            detail=f"Nenhuma OP encontrada para o mês {mes_ref}. Verifique se o arquivo de programação foi carregado."
        )

    if linha:
        ops = [op for op in ops if op.get("linha") == linha]

    codigos_ops = list({
        str(op.get("codigo") or "").strip()
        for op in ops
        if op.get("codigo")
    })
    lotes_teoricos = _buscar_lotes_teoricos(codigos_ops)
    ops = [_aplicar_lote_teorico_op(op, lotes_teoricos) for op in ops]
    ops = _atribuir_fifo_posicao(ops)

    ops_abertas = _ordenar_ops_para_cascata([op for op in ops if op.get("op_numero")])
    ops_candidatas = _ordenar_ops_para_cascata([op for op in ops if not op.get("op_numero")])

    resultado_abertas = [_formatar_op_aberta(op) for op in ops_abertas]

    codigos_candidatas = list({str(op.get("codigo") or "").strip() for op in ops_candidatas if op.get("codigo")})
    bom = _buscar_bom(codigos_candidatas)

    todos_componentes = set()
    tipos_bom_por_codigo: dict[str, str] = {}

    for comps in bom.values():
        for comp in comps:
            codigo_comp = _normalizar_codigo_produto(comp.get("codigo_comp"))
            if codigo_comp:
                todos_componentes.add(codigo_comp)
                tipos_bom_por_codigo.setdefault(codigo_comp, _normalizar_tp_ops(comp.get("tp")))

    lista_componentes = list(todos_componentes)

    tipos_posicao_estoque, data_tipos_posicao = _buscar_tipos_posicao_estoque(lista_componentes)

    componentes_mc = set()
    for codigo_comp in lista_componentes:
        tp_posicao = _normalizar_tp_ops((tipos_posicao_estoque.get(codigo_comp) or {}).get("tp"))
        tp_bom = _normalizar_tp_ops(tipos_bom_por_codigo.get(codigo_comp))
        tp_final = tp_posicao or tp_bom

        if tp_final == "MC":
            componentes_mc.add(codigo_comp)

    lista_componentes_mc = list(componentes_mc)

    estoque, data_estoque = _buscar_estoque_mais_recente(
        lista_componentes,
        codigos_mc=lista_componentes_mc,
    )

    if data_estoque is None and data_tipos_posicao is not None:
        data_estoque = data_tipos_posicao
    compras_abertas = _buscar_compras_abertas(lista_componentes)
    compras_total_por_codigo = _resumo_compras_por_codigo(compras_abertas)

    resultado_candidatas = []

    for op in ops_candidatas:
        componentes = bom.get(str(op.get("codigo") or "").strip(), [])

        if not componentes:
            resultado_candidatas.append({
                "id": op.get("id"),
                "fifo_posicao": op.get("fifo_posicao"),
                "tipo_fifo": op.get("tipo_fifo"),
                "mes_ref": op.get("mes_ref"),
                "lote": op.get("lote"),
                "codigo": op.get("codigo"),
                "produto": op.get("produto", ""),
                "linha": op.get("linha"),
                "quantidade": _to_float(op.get("quantidade")),
                "quantidade_programada": _to_float(op.get("quantidade_programada") or op.get("quantidade")),
                "qtd_teorica_abertura": op.get("qtd_teorica_abertura"),
                "quantidade_teorica": _to_float(op.get("quantidade_teorica") or op.get("quantidade")),
                "quantidade_calculo": _to_float(op.get("quantidade_calculo") or op.get("quantidade")),
                "usa_lote_teorico": bool(op.get("usa_lote_teorico")),
                "lote_teorico_encontrado": bool(op.get("lote_teorico_encontrado")),
                "linha_lote_teorico": op.get("linha_lote_teorico"),
                "letra_lote_teorico": op.get("letra_lote_teorico"),
                "observacao_lote_teorico": op.get("observacao_lote_teorico"),
                "data_fim": op.get("data_fim"),
                "op_numero": None,
                "status": "sem_bom",
                "alertas": [{
                    "descricao": "Produto não encontrado na estrutura de materiais (BOM).",
                    "status": "sem_bom",
                }],
                "detalhes": [],
                "resumo_faltas": "Produto não encontrado na estrutura de materiais (BOM).",
                "qtd_componentes_faltando": 0,
                "qtd_total_faltante": 0,
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

        resultado_candidatas.append(
            _verificar_op(
                op,
                componentes,
                estoque,
                compras_abertas,
                leadtime_compra_dias=leadtime_compra_dias,
                compras_total_por_codigo=compras_total_por_codigo,
                tipos_posicao_estoque=tipos_posicao_estoque,
            )
        )

    todas = _ordenar_ops_para_cascata(resultado_abertas + resultado_candidatas)

    resumo = {
        "abertas": sum(1 for r in todas if r["status"] == "aberta"),
        "ok": sum(1 for r in todas if r["status"] == "ok"),
        "compra_no_prazo": sum(1 for r in todas if r["status"] == "compra_no_prazo"),
        "compra_fora_prazo": sum(1 for r in todas if r["status"] == "compra_fora_prazo"),
        "quarentena": sum(1 for r in todas if r["status"] == "quarentena"),
        "falta": sum(1 for r in todas if r["status"] in {"falta", "falta_parcial"}),
        "sem_bom": sum(1 for r in todas if r["status"] == "sem_bom"),
    }

    programacao_atualizada_em, campo_programacao_atualizada_em = _ultima_atualizacao_programacao(ops)

    return {
        "mes_ref": mes_ref,
        "data_estoque": data_estoque,
        "data_programacao": programacao_atualizada_em,
        "programacao_atualizada_em": programacao_atualizada_em,
        "ultima_atualizacao_programacao": programacao_atualizada_em,
        "campo_programacao_atualizada_em": campo_programacao_atualizada_em,
        "leadtime_compra_dias": leadtime_compra_dias,
        "lotes_teoricos_aplicados": sum(1 for r in todas if r.get("usa_lote_teorico")),
        "total_ops": len(todas),
        "resumo": resumo,
        "materiais_criticos": _montar_criticos(todas),
        "ops": todas,
        "backend_versao": "ops_tipo_posicao_estoque_prioritario_v9_2026_06_11",
        "debug_ordem_cascata": {
            "regra": "mesma lógica da coluna #: Embalagem/PA primeiro, Envase/PI depois; dentro de cada grupo, ordenar por data; L1 e L2 misturam por data.",
            "primeiras_ops": [
                {
                    "fifo_posicao": r.get("fifo_posicao"),
                    "tipo_fifo": r.get("tipo_fifo"),
                    "lote": r.get("lote"),
                    "linha": r.get("linha"),
                    "codigo": r.get("codigo"),
                    "data_inicio_fabricacao": r.get("data_inicio_fabricacao"),
                    "data_fim": r.get("data_fim"),
                    "status": r.get("status"),
                }
                for r in todas[:10]
            ],
        },
        "debug_mc": {
            "qtd_componentes_mc": len(lista_componentes_mc),
            "componentes_mc": sorted(lista_componentes_mc)[:50],
            "qtd_tipos_posicao_estoque": len(tipos_posicao_estoque),
            "tipos_posicao_exemplos": dict(list(tipos_posicao_estoque.items())[:20]),
            "regra": "Tipo da Posição de Estoque/f_consumo_materiais é prioritário. Se não existir na posição, usa o tipo da BOM. MC usa saldo da posição e armazém conceitual 20.",
        },
    }



@router.delete("/programacao/{mes_ref}")
def excluir_programacao_mes(mes_ref: str):
    """
    Exclui a programação mensal de OPs de um mês específico.

    Uso principal na página de Ordens:
      - quando a programação de um mês foi carregada errada;
      - quando o planejamento mudou totalmente e o usuário quer apagar antes de subir a nova versão.

    Importante:
      - remove apenas f_programacao_ops do mês informado;
      - não remove BOM, estoque, compras ou lotes teóricos;
      - tenta limpar, em best effort, negociações manuais ligadas às OPs apagadas.
    """
    mes_ref = str(mes_ref or "").strip()

    if not re.match(r"^\d{4}-\d{2}$", mes_ref):
        raise HTTPException(
            status_code=422,
            detail="Mês inválido. Use o formato YYYY-MM, por exemplo 2026-06."
        )

    try:
        res_ops = (
            supabase.table("f_programacao_ops")
            .select("id,lote,codigo")
            .eq("mes_ref", mes_ref)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao consultar programação do mês {mes_ref}: {str(e)[:250]}"
        )

    ops_mes = res_ops.data or []
    total_ops = len(ops_mes)

    if total_ops == 0:
        return {
            "ok": True,
            "mes_ref": mes_ref,
            "total_excluido": 0,
            "ajustes_removidos": 0,
            "message": f"Nenhuma programação encontrada para {mes_ref}.",
        }

    ids_ops = [str(op.get("id")) for op in ops_mes if op.get("id")]
    lotes_ops = list({str(op.get("lote") or "").strip() for op in ops_mes if op.get("lote")})

    try:
        (
            supabase.table("f_programacao_ops")
            .delete()
            .eq("mes_ref", mes_ref)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao excluir programação do mês {mes_ref}: {str(e)[:250]}"
        )

    ajustes_removidos = 0

    # Best effort: remove negociações manuais vinculadas às OPs apagadas.
    # Se a tabela não existir no ambiente ou a política bloquear, não impede a exclusão da programação.
    for tabela_ajustes in ["ajustes_compras_ops", "f_ajustes_compras_ops"]:
        try:
            if ids_ops:
                supabase.table(tabela_ajustes).delete().in_("op_id", ids_ops).execute()
                ajustes_removidos += len(ids_ops)
        except Exception:
            pass

        try:
            if lotes_ops:
                supabase.table(tabela_ajustes).delete().in_("lote", lotes_ops).execute()
        except Exception:
            pass

    _delete_cache_ops_mes(mes_ref)

    return {
        "ok": True,
        "mes_ref": mes_ref,
        "total_excluido": total_ops,
        "ajustes_removidos": ajustes_removidos,
        "message": f"Programação de {mes_ref} excluída com sucesso.",
    }

@router.get("/meses")
def meses_disponiveis():
    """
    Lista meses disponíveis sem varrer a tabela inteira.

    Antes este endpoint lia todos os registros de f_programacao_ops só para descobrir
    os meses. Em telas com muitas OPs isso deixava a primeira abertura parecendo
    vazia/lenta. Agora busca uma janela limitada e deduplica em Python.
    """
    try:
        res = (
            supabase.table("f_programacao_ops")
            .select("mes_ref")
            .order("mes_ref", desc=True)
            .limit(5000)
            .execute()
        )

        meses = sorted({
            str(row.get("mes_ref") or "").strip()
            for row in res.data or []
            if row.get("mes_ref")
        }, reverse=True)

        return {"meses": meses[:24]}
    except Exception:
        try:
            return {"meses": _buscar_meses_ops_cache(limit=24)}
        except Exception:
            return {"meses": []}


@router.get("/resumo/{mes_ref}")
def resumo_mes(
    mes_ref: str,
    leadtime_compra_dias: int = Query(2, ge=0, le=30, description="Dias de antecedência necessários entre entrega da compra e início da fabricação"),
):
    ops = _buscar_ops(mes_ref)

    if not ops:
        raise HTTPException(status_code=404, detail=f"Nenhuma OP para o mês {mes_ref}.")

    codigos_ops = list({
        str(op.get("codigo") or "").strip()
        for op in ops
        if op.get("codigo")
    })
    lotes_teoricos = _buscar_lotes_teoricos(codigos_ops)
    ops = [_aplicar_lote_teorico_op(op, lotes_teoricos) for op in ops]
    ops = _atribuir_fifo_posicao(ops)

    ops_abertas = _ordenar_ops_para_cascata([op for op in ops if op.get("op_numero")])
    ops_candidatas = _ordenar_ops_para_cascata([op for op in ops if not op.get("op_numero")])

    codigos = list({str(op.get("codigo") or "").strip() for op in ops_candidatas if op.get("codigo")})
    bom = _buscar_bom(codigos)

    todos_componentes = set()
    tipos_bom_por_codigo: dict[str, str] = {}

    for comps in bom.values():
        for comp in comps:
            codigo_comp = _normalizar_codigo_produto(comp.get("codigo_comp"))
            if codigo_comp:
                todos_componentes.add(codigo_comp)
                tipos_bom_por_codigo.setdefault(codigo_comp, _normalizar_tp_ops(comp.get("tp")))

    lista_componentes = list(todos_componentes)

    tipos_posicao_estoque, data_tipos_posicao = _buscar_tipos_posicao_estoque(lista_componentes)

    componentes_mc = set()
    for codigo_comp in lista_componentes:
        tp_posicao = _normalizar_tp_ops((tipos_posicao_estoque.get(codigo_comp) or {}).get("tp"))
        tp_bom = _normalizar_tp_ops(tipos_bom_por_codigo.get(codigo_comp))
        tp_final = tp_posicao or tp_bom

        if tp_final == "MC":
            componentes_mc.add(codigo_comp)

    lista_componentes_mc = list(componentes_mc)

    estoque, data_estoque = _buscar_estoque_mais_recente(
        lista_componentes,
        codigos_mc=lista_componentes_mc,
    )

    if data_estoque is None and data_tipos_posicao is not None:
        data_estoque = data_tipos_posicao
    compras_abertas = _buscar_compras_abertas(lista_componentes)
    compras_total_por_codigo = _resumo_compras_por_codigo(compras_abertas)

    por_linha: dict[str, dict] = {}

    for op in ops_abertas:
        linha = op.get("linha")
        por_linha.setdefault(linha, {"aberta": 0, "ok": 0, "compra_no_prazo": 0, "compra_fora_prazo": 0, "quarentena": 0, "falta": 0, "falta_parcial": 0, "sem_bom": 0})
        por_linha[linha]["aberta"] += 1

    for op in ops_candidatas:
        linha = op.get("linha")
        por_linha.setdefault(linha, {"aberta": 0, "ok": 0, "compra_no_prazo": 0, "compra_fora_prazo": 0, "quarentena": 0, "falta": 0, "falta_parcial": 0, "sem_bom": 0})

        componentes = bom.get(str(op.get("codigo") or "").strip(), [])

        if not componentes:
            por_linha[linha]["sem_bom"] += 1
            continue

        resultado = _verificar_op(
            op,
            componentes,
            estoque,
            compras_abertas,
            leadtime_compra_dias=leadtime_compra_dias,
            compras_total_por_codigo=compras_total_por_codigo,
            tipos_posicao_estoque=tipos_posicao_estoque,
        )
        por_linha[linha].setdefault(resultado["status"], 0)
        por_linha[linha][resultado["status"]] += 1

    return {
        "mes_ref": mes_ref,
        "data_estoque": data_estoque,
        "leadtime_compra_dias": leadtime_compra_dias,
        "lotes_teoricos_aplicados": sum(1 for op in ops if op.get("usa_lote_teorico")),
        "total_ops": len(ops),
        "por_linha": por_linha,
    }


# ─────────────────────────────────────────────────────────────
# Cache persistente de Ordens / Verificação de OPs
# ─────────────────────────────────────────────────────────────
# Usa a tabela cache_overview como cache genérico do app:
#   chave text primary key
#   versao_base text
#   payload jsonb
#   atualizado_em timestamptz

OPS_CACHE_LOGIC_VERSION = "ops-cache-v61"

OPS_CACHE_BASES = [
    "programacao_ops",
    "bom_estrutura",
    "d_lotes_teoricos",
    "lotes_teoricos",
    "estoque_saldo",
    "estoque",
    "consumo_materiais",
    "compras_abertas",
    "d_produtos",
]


def _ops_mes_ref_cache(mes_ref: Any = None) -> str:
    texto = str(mes_ref or "").strip()

    if re.match(r"^\d{4}-\d{2}$", texto):
        return texto

    try:
        meses = _buscar_meses_ops_cache()
        if meses:
            return meses[0]
    except Exception:
        pass

    hoje = datetime.utcnow()
    return f"{hoje.year}-{str(hoje.month).zfill(2)}"


def _ops_leadtime_cache(leadtime_compra_dias: Any = 2) -> int:
    try:
        return max(0, min(30, int(float(leadtime_compra_dias))))
    except Exception:
        return 2


def _buscar_meses_ops_cache(limit: int = 12) -> list[str]:
    try:
        res = (
            supabase.table("f_programacao_ops")
            .select("mes_ref")
            .order("mes_ref", desc=True)
            .limit(5000)
            .execute()
        )
        meses = sorted({str(row.get("mes_ref") or "").strip() for row in res.data or [] if row.get("mes_ref")}, reverse=True)
        return meses[:limit]
    except Exception:
        return []


def _ops_upload_versions() -> dict[str, str | None]:
    try:
        res = (
            supabase.table("upload_log")
            .select("base_id, processado_em, status")
            .eq("status", "sucesso")
            .order("processado_em", desc=True)
            .limit(600)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    latest: dict[str, str | None] = {base: None for base in OPS_CACHE_BASES}
    aliases = {
        "d_lotes_teoricos": "lotes_teoricos",
        "lotes_teoricos": "d_lotes_teoricos",
    }

    for row in rows:
        base_id = str(row.get("base_id") or "").strip()
        if base_id in latest and not latest[base_id]:
            latest[base_id] = str(row.get("processado_em") or "") or None

        alias = aliases.get(base_id)
        if alias in latest and not latest[alias]:
            latest[alias] = str(row.get("processado_em") or "") or None

    return latest


def _ops_cache_chave(
    mes_ref: Any = None,
    leadtime_compra_dias: Any = 2,
) -> str:
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    mes_key = mes_ref_norm.replace("-", "_")
    return f"ops_viabilidade_{mes_key}_lt{leadtime}"


def _ops_cache_light_chave(
    mes_ref: Any = None,
    leadtime_compra_dias: Any = 2,
) -> str:
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    mes_key = mes_ref_norm.replace("-", "_")
    return f"ops_viabilidade_light_{mes_key}_lt{leadtime}"


def _resumir_alerta_ops_light(alerta: dict) -> dict:
    if not isinstance(alerta, dict):
        return {}

    campos = [
        "codigo_comp",
        "descricao",
        "tp",
        "unidade",
        "necessario",
        "faltante",
        "faltante_fisico_hoje",
        "faltante_apos_compras",
        "faltante_na_data_limite",
        "status",
        "status_operacional",
        "status_compra",
        "abre_no_prazo",
        "coberto_por_compra",
        "saldo_01",
        "saldo_02",
        "saldo_20",
        "saldo_98",
        "qtd_compras_total_aberto",
        "qtd_compras_no_prazo",
        "qtd_compras_fora_prazo",
        "menor_data_entrega_compra",
        "data_limite_compra",
        "cobre_op",
    ]

    return {campo: alerta.get(campo) for campo in campos if campo in alerta}


def _ops_payload_light(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Payload leve para primeira renderização da tela de Ordens.

    O cache completo continua existindo para detalhes dos componentes, exportação e uso posterior.
    Na primeira abertura, a tela precisa da tabela e dos cards rápido; por isso este payload:
      - mantém resumo, materiais críticos e OPs;
      - preserva alertas críticos resumidos para status/gargalo;
      - remove detalhes completos da BOM de cada OP, que são a parte mais pesada.
    """
    if not isinstance(payload, dict):
        return payload

    light = dict(payload)
    ops_light = []

    for op in payload.get("ops") or []:
        if not isinstance(op, dict):
            continue

        novo = {
            k: v
            for k, v in op.items()
            if k not in {"detalhes", "debug", "compras_abertas"}
        }

        alertas = op.get("alertas") if isinstance(op.get("alertas"), list) else []
        avisos = op.get("avisos") if isinstance(op.get("avisos"), list) else []

        novo["alertas"] = [_resumir_alerta_ops_light(a) for a in alertas[:8] if isinstance(a, dict)]
        novo["avisos"] = [_resumir_alerta_ops_light(a) for a in avisos[:8] if isinstance(a, dict)]
        novo["detalhes"] = []
        novo["_detalhes_carregados"] = False
        ops_light.append(novo)

    light["ops"] = ops_light
    light["_cache_light"] = True

    # Campos de debug são úteis para dev, mas pesam na primeira tela.
    light.pop("debug_ordem_cascata", None)
    light.pop("debug_mc", None)

    return light


def _ops_cache_version(
    mes_ref: Any = None,
    leadtime_compra_dias: Any = 2,
) -> tuple[str, dict[str, str | None]]:
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    versions = _ops_upload_versions()

    partes = [
        OPS_CACHE_LOGIC_VERSION,
        f"mes_ref:{mes_ref_norm}",
        f"leadtime:{leadtime}",
    ]

    for base_id in OPS_CACHE_BASES:
        partes.append(f"{base_id}:{versions.get(base_id) or '-'}")

    return "|".join(partes), versions


def _ops_ultima_atualizacao(versions: dict[str, str | None]) -> str | None:
    datas = [v for v in versions.values() if v]
    return max(datas) if datas else None


def _read_cache_ops(chave: str) -> dict[str, Any] | None:
    try:
        res = (
            supabase.table("cache_overview")
            .select("chave, versao_base, payload, atualizado_em")
            .eq("chave", chave)
            .limit(1)
            .execute()
        )

        if not res.data:
            return None

        return res.data[0]
    except Exception:
        return None


def _write_cache_ops(chave: str, payload: dict[str, Any], versao_base: str) -> dict[str, Any]:
    registro = {
        "chave": chave,
        "versao_base": versao_base,
        "payload": payload,
        "atualizado_em": datetime.utcnow().isoformat(),
    }

    try:
        res = (
            supabase.table("cache_overview")
            .upsert(registro, on_conflict="chave")
            .execute()
        )
        if res.data:
            return res.data[0]
    except Exception:
        pass

    try:
        res = (
            supabase.table("cache_overview")
            .update({
                "versao_base": versao_base,
                "payload": payload,
                "atualizado_em": registro["atualizado_em"],
            })
            .eq("chave", chave)
            .execute()
        )
        if res.data:
            return res.data[0]
    except Exception:
        pass

    try:
        res = supabase.table("cache_overview").insert(registro).execute()
        if res.data:
            return res.data[0]
    except Exception:
        pass

    return registro


def _delete_cache_ops_mes(mes_ref: str) -> None:
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    prefixo = f"ops_viabilidade_{mes_ref_norm.replace('-', '_')}"
    try:
        (
            supabase.table("cache_overview")
            .delete()
            .like("chave", f"{prefixo}%")
            .execute()
        )
    except Exception:
        pass


async def recalcular_cache_ops(
    mes_ref: str | None = None,
    leadtime_compra_dias: int = 2,
) -> dict[str, Any]:
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)

    chave = _ops_cache_chave(mes_ref_norm, leadtime)
    versao_base, versions = _ops_cache_version(mes_ref_norm, leadtime)

    payload = await viabilidade_ops(
        mes_ref=mes_ref_norm,
        linha=None,
        leadtime_compra_dias=leadtime,
    )

    if not isinstance(payload, dict):
        payload = dict(payload)

    registro = _write_cache_ops(chave, payload, versao_base)

    # Também grava um snapshot leve para a primeira abertura da tela.
    try:
        _write_cache_ops(
            _ops_cache_light_chave(mes_ref_norm, leadtime),
            _ops_payload_light(payload),
            versao_base,
        )
    except Exception:
        pass

    return {
        "chave": chave,
        "mes_ref": mes_ref_norm,
        "leadtime_compra_dias": leadtime,
        "versao_base": versao_base,
        "from_cache": False,
        "atualizado_em": registro.get("atualizado_em"),
        "ultima_atualizacao": _ops_ultima_atualizacao(versions),
        "payload": payload,
    }


async def recalcular_caches_ops_padrao(
    mes_ref: str | None = None,
    leadtime_compra_dias: int = 2,
) -> dict[str, Any]:
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)

    if mes_ref:
        meses = [_ops_mes_ref_cache(mes_ref)]
    else:
        meses = _buscar_meses_ops_cache(limit=3)

    resultados: dict[str, Any] = {}

    for mes in meses:
        try:
            resultados[mes] = await recalcular_cache_ops(
                mes_ref=mes,
                leadtime_compra_dias=leadtime,
            )
        except Exception as e:
            resultados[mes] = {
                "status": "erro",
                "detail": str(e)[:300],
            }

    return {
        "status": "ok",
        "meses": meses,
        "leadtime_compra_dias": leadtime,
        "resultados": resultados,
    }


@router.get("/cache/versao")
def get_ops_cache_versao(
    mes_ref: str = Query(..., description="Mês de referência YYYY-MM"),
    leadtime_compra_dias: int = Query(2, ge=0, le=30),
):
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    chave = _ops_cache_chave(mes_ref_norm, leadtime)
    versao_base, versions = _ops_cache_version(mes_ref_norm, leadtime)
    cache = _read_cache_ops(chave)

    return {
        "chave": chave,
        "mes_ref": mes_ref_norm,
        "leadtime_compra_dias": leadtime,
        "versao_base": versao_base,
        "cache_disponivel": bool(cache and cache.get("versao_base") == versao_base),
        "cache_versao": cache.get("versao_base") if cache else None,
        "cache_atualizado_em": cache.get("atualizado_em") if cache else None,
        "ultima_atualizacao": _ops_ultima_atualizacao(versions),
        "bases": versions,
    }


@router.get("/cache")
async def get_ops_cache(
    mes_ref: str = Query(..., description="Mês de referência YYYY-MM"),
    leadtime_compra_dias: int = Query(2, ge=0, le=30),
    force: bool = Query(False),
):
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    chave = _ops_cache_chave(mes_ref_norm, leadtime)
    versao_base, versions = _ops_cache_version(mes_ref_norm, leadtime)
    cache = _read_cache_ops(chave)

    if (
        not force
        and cache
        and cache.get("versao_base") == versao_base
        and cache.get("payload") is not None
    ):
        return {
            "chave": chave,
            "mes_ref": mes_ref_norm,
            "leadtime_compra_dias": leadtime,
            "versao_base": versao_base,
            "from_cache": True,
            "atualizado_em": cache.get("atualizado_em"),
            "ultima_atualizacao": _ops_ultima_atualizacao(versions),
            "payload": cache.get("payload"),
        }

    return await recalcular_cache_ops(
        mes_ref=mes_ref_norm,
        leadtime_compra_dias=leadtime,
    )


@router.get("/cache-light")
async def get_ops_cache_light(
    mes_ref: str = Query(..., description="Mês de referência YYYY-MM"),
    leadtime_compra_dias: int = Query(2, ge=0, le=30),
    force: bool = Query(False),
):
    mes_ref_norm = _ops_mes_ref_cache(mes_ref)
    leadtime = _ops_leadtime_cache(leadtime_compra_dias)
    chave_light = _ops_cache_light_chave(mes_ref_norm, leadtime)
    chave_full = _ops_cache_chave(mes_ref_norm, leadtime)
    versao_base, versions = _ops_cache_version(mes_ref_norm, leadtime)

    cache_light = _read_cache_ops(chave_light)

    if (
        not force
        and cache_light
        and cache_light.get("versao_base") == versao_base
        and cache_light.get("payload") is not None
    ):
        return {
            "chave": chave_light,
            "mes_ref": mes_ref_norm,
            "leadtime_compra_dias": leadtime,
            "versao_base": versao_base,
            "from_cache": True,
            "is_light": True,
            "atualizado_em": cache_light.get("atualizado_em"),
            "ultima_atualizacao": _ops_ultima_atualizacao(versions),
            "payload": cache_light.get("payload"),
        }

    cache_full = _read_cache_ops(chave_full)

    if (
        not force
        and cache_full
        and cache_full.get("versao_base") == versao_base
        and cache_full.get("payload") is not None
    ):
        payload_light = _ops_payload_light(cache_full.get("payload") or {})
        registro = _write_cache_ops(chave_light, payload_light, versao_base)
        return {
            "chave": chave_light,
            "mes_ref": mes_ref_norm,
            "leadtime_compra_dias": leadtime,
            "versao_base": versao_base,
            "from_cache": True,
            "is_light": True,
            "atualizado_em": registro.get("atualizado_em"),
            "ultima_atualizacao": _ops_ultima_atualizacao(versions),
            "payload": payload_light,
        }

    recalculado = await recalcular_cache_ops(
        mes_ref=mes_ref_norm,
        leadtime_compra_dias=leadtime,
    )

    payload_light = _ops_payload_light(recalculado.get("payload") or {})
    registro = _write_cache_ops(chave_light, payload_light, versao_base)

    return {
        "chave": chave_light,
        "mes_ref": mes_ref_norm,
        "leadtime_compra_dias": leadtime,
        "versao_base": versao_base,
        "from_cache": False,
        "is_light": True,
        "atualizado_em": registro.get("atualizado_em"),
        "ultima_atualizacao": _ops_ultima_atualizacao(versions),
        "payload": payload_light,
    }


@router.post("/cache/recalcular")
async def post_ops_cache_recalcular(
    mes_ref: str = Query(..., description="Mês de referência YYYY-MM"),
    leadtime_compra_dias: int = Query(2, ge=0, le=30),
):
    return await recalcular_cache_ops(
        mes_ref=mes_ref,
        leadtime_compra_dias=leadtime_compra_dias,
    )


@router.post("/cache/recalcular-padrao")
async def post_ops_cache_recalcular_padrao(
    mes_ref: str | None = Query(default=None),
    leadtime_compra_dias: int = Query(2, ge=0, le=30),
):
    return await recalcular_caches_ops_padrao(
        mes_ref=mes_ref,
        leadtime_compra_dias=leadtime_compra_dias,
    )

