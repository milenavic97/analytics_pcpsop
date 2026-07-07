from collections import defaultdict
from typing import Any
from datetime import date, datetime
from calendar import monthrange
import hashlib
import re

from fastapi import APIRouter, Query

from app.database import supabase

router = APIRouter(
    prefix="/faturamento",
    tags=["Faturamento"],
)

BLOCOS_ANESTESICOS = {
    "101", "102", "103", "104", "105", "106",
    "107", "108", "109", "110", "111", "112",
    "113", "114", "115", "116",
    "0101", "0102", "0103", "0104", "0105", "0106",
    "0107", "0108", "0109", "0110", "0111", "0112",
    "0113", "0114", "0115", "0116",
}

NOMES_ANESTESICOS = {
    "ALPHACAINE",
    "ALPHACAINE 80",
    "ARTICAINE",
    "ARTICAINE 200",
    "MEPIADRE",
    "MEPISV",
    "PRILONEST",
    "LIDOCAINE",
    "LIDOCAINA",
    "PRILONEST",
}

MESES = {
    1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr",
    5: "Mai", 6: "Jun", 7: "Jul", 8: "Ago",
    9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
}


def _select_all(table: str, filters: dict | None = None, page_size: int = 1000):
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        query = supabase.table(table).select("*")
        if filters:
            for col, val in filters.items():
                query = query.eq(col, val)
        resp = query.range(start, start + page_size - 1).execute()
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def _select_all_safe(tables: list[str], filters: dict | None = None, page_size: int = 1000):
    """Tenta carregar a primeira tabela disponível. Útil enquanto a dimensão de clientes ainda está sendo padronizada."""
    for table in tables:
        try:
            rows = _select_all(table, filters=filters, page_size=page_size)
            return rows
        except Exception:
            continue
    return []


def _to_float(valor):
    try:
        if valor is None or valor == "":
            return 0.0
        if isinstance(valor, str):
            valor = valor.strip()
            if "," in valor:
                valor = valor.replace(".", "").replace(",", ".")
        return float(valor)
    except Exception:
        return 0.0


def _normaliza_codigo(valor) -> str:
    texto = str(valor or "").strip()
    if texto.endswith(".0"):
        texto = texto[:-2]
    try:
        return str(int(float(texto)))
    except Exception:
        return texto


def _normaliza_texto(valor):
    return (
        str(valor or "").strip().upper()
        .replace("Á", "A").replace("À", "A").replace("Â", "A").replace("Ã", "A")
        .replace("É", "E").replace("Ê", "E").replace("Í", "I")
        .replace("Ó", "O").replace("Ô", "O").replace("Õ", "O")
        .replace("Ú", "U").replace("Ç", "C")
    )


def _normaliza_grupo(grupo):
    grupo_txt = (
        str(grupo or "").strip().upper()
        .replace(".", "").replace("-", "").replace(" ", "")
    )
    try:
        grupo_int = str(int(float(grupo_txt)))
    except Exception:
        grupo_int = grupo_txt
    return grupo_txt, grupo_int


def _pick(row: dict, *keys, default=""):
    """Lê campos já normalizados ou colunas brutas vindas do Excel."""
    if not row:
        return default
    row_norm = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        key_norm = str(key).strip().lower()
        if key_norm in row_norm and row_norm[key_norm] not in [None, ""]:
            return row_norm[key_norm]
    return default


def _eh_anestesico(grupo=None, familia=None, descricao=None, linha=None):
    linha_norm = _normaliza_texto(linha)
    desc_norm = _normaliza_texto(descricao)
    familia_norm = _normaliza_texto(familia)

    # Fonte preferencial: linha da d_produtos
    if "INJETAVEL" in linha_norm or "ANEST" in linha_norm:
        return True
    if linha_norm == "PPS" or "PPS" in linha_norm:
        return False
    if "BRAVI" in linha_norm or "FUTURA" in linha_norm:
        return False

    grupo_txt, grupo_int = _normaliza_grupo(grupo)
    if grupo_txt in BLOCOS_ANESTESICOS or grupo_int in BLOCOS_ANESTESICOS:
        return True

    if familia_norm in NOMES_ANESTESICOS:
        return True
    if any(nome in desc_norm for nome in NOMES_ANESTESICOS):
        return True

    return False


def _eh_pps(linha=None, descricao=None, grupo=None):
    linha_norm = _normaliza_texto(linha)
    desc_norm = _normaliza_texto(descricao)
    grupo_norm, _ = _normaliza_grupo(grupo)
    if "PPS" in linha_norm or "PPS" in desc_norm:
        return True
    # fallback conservador: alguns cadastros vêm sem linha; não força todo não-anestésico como PPS.
    if grupo_norm.startswith("02") and not _eh_anestesico(grupo=grupo, descricao=descricao, linha=linha):
        return True
    return False


def _eh_bravi(linha=None, descricao=None, produto=None):
    linha_norm = _normaliza_texto(linha)
    desc_norm = _normaliza_texto(descricao)
    produto_norm = _normaliza_texto(produto)
    return (
        "BRAVI" in linha_norm
        or "FUTURA" in linha_norm
        or "BRAVI" in desc_norm
        or "FUTURA" in desc_norm
        or "BRAVI" in produto_norm
        or "FUTURA" in produto_norm
    )


def _escopo_ok(escopo: str, grupo=None, familia=None, descricao=None, linha=None, produto=None):
    escopo_norm = _normaliza_texto(escopo).replace(" ", "_")
    if escopo_norm in ["TODOS", "ALL", ""]:
        return True
    if escopo_norm in ["ANESTESICOS", "ANESTESICOS_INJETAVEIS", "ANESTESICOS_INJETAVEIS"]:
        return _eh_anestesico(grupo=grupo, familia=familia, descricao=descricao, linha=linha)
    if escopo_norm == "PPS":
        return _eh_pps(linha=linha, descricao=descricao, grupo=grupo)
    if escopo_norm == "BRAVI":
        return _eh_bravi(linha=linha, descricao=descricao, produto=produto)
    return True





def _produto_filtro_ok(filtro: str | None, produto: str = "", descricao: str = "", grupo: str = "", linha: str = "") -> bool:
    """Filtro livre por código, descrição, grupo ou linha do produto."""
    filtro_txt = str(filtro or "").strip()
    if not filtro_txt:
        return True

    filtro_norm = _normaliza_texto(filtro_txt)
    filtro_cod = _normaliza_codigo(filtro_txt)

    campos = [
        _normaliza_codigo(produto),
        _normaliza_texto(produto),
        _normaliza_texto(descricao),
        _normaliza_texto(grupo),
        _normaliza_texto(linha),
    ]

    if filtro_cod and any(filtro_cod in campo for campo in campos if campo):
        return True

    return any(filtro_norm in campo for campo in campos if campo)


def _label_escopo(escopo: str):
    escopo_norm = _normaliza_texto(escopo).replace(" ", "_")
    if escopo_norm in ["ANESTESICOS", "ANESTESICOS_INJETAVEIS"]:
        return "Anestésicos Injetáveis"
    if escopo_norm == "PPS":
        return "PPS"
    if escopo_norm == "BRAVI":
        return "Bravi"
    return "Todos"


def _classe_abc(acumulado_pct: float):
    if acumulado_pct <= 80:
        return "A"
    if acumulado_pct <= 95:
        return "B"
    return "C"


def _carregar_dimensao_produtos() -> dict:
    mapa: dict[str, dict[str, Any]] = {}
    try:
        rows = _select_all("d_produtos")
        for r in rows:
            cod = _normaliza_codigo(_pick(r, "cod_produto", "produto", "codigo", "Código", "Cod Produto"))
            if not cod:
                continue
            mapa[cod] = {
                "grupo": str(_pick(r, "grupo", "Grupo") or "").strip(),
                "linha": str(_pick(r, "linha", "Linha") or "").strip(),
                "desc_produto": str(_pick(r, "desc_produto", "descricao", "Descrição", "Desc Produto") or "").strip(),
            }
    except Exception:
        pass
    return mapa


def _carregar_dimensao_clientes() -> dict:
    """
    Join faturamento/SD2.cliente -> d_clientes.codigo.
    Mantém compatibilidade com a versão anterior e adiciona campos úteis
    para ranking geográfico e país estimado.
    """
    mapa: dict[str, dict[str, Any]] = {}
    rows = _select_all_safe(["d_clientes", "dclientes", "d_clientes_protheus"])

    for r in rows:
        codigo = _normaliza_codigo(_pick(r, "codigo", "Codigo", "Codigo      ", "cod_cliente", "cliente"))
        if not codigo:
            continue
        # Como as bases processadas têm apenas o código do cliente, a V1 consolida por código.
        # Quando houver loja nas bases processadas, o join pode evoluir para código + loja.
        if codigo in mapa:
            continue

        mapa[codigo] = {
            "codigo": codigo,
            "loja": str(_pick(r, "loja", "Loja", "Loja        ") or "").strip(),
            "nome": str(_pick(r, "nome", "Nome", "Nome        ") or "").strip(),
            "nome_fantasia": str(_pick(r, "nome_fantasia", "n_fantasia", "N Fantasia", "N Fantasia  ") or "").strip(),
            "tipo_cliente": str(_pick(r, "tipo_cliente", "tipo", "Tipo", "Tipo        ") or "").strip(),
            "estado": str(_pick(r, "estado", "uf", "Estado", "Estado      ") or "").strip(),
            "municipio": str(_pick(r, "municipio", "Municipio", "Municipio   ") or "").strip(),
            "regiao": str(_pick(r, "regiao", "Regiao", "Regiao      ") or "").strip(),
            "desc_regiao": str(_pick(r, "desc_regiao", "Desc.Região", "Desc.Regiao", "Desc.Região ") or "").strip(),
            "cnpj_cpf": str(_pick(r, "cnpj_cpf", "CNPJ/CPF", "CNPJ/CPF    ") or "").strip(),
            "endereco": str(_pick(r, "endereco", "Endereco", "Endereco    ") or "").strip(),
            "bairro": str(_pick(r, "bairro", "Bairro", "Bairro      ") or "").strip(),
            "end_entrega": str(_pick(r, "end_entrega", "End.Entrega", "End.Entrega ") or "").strip(),
            "end_cobranca": str(_pick(r, "end_cobranca", "End.Cobranca", "End.Cobranca") or "").strip(),
            "ddi": str(_pick(r, "ddi", "DDI", "DDI         ") or "").strip(),
            "pais_estimado": str(_pick(r, "pais_estimado", "pais", "País", "Pais") or "").strip(),
            "confianca_pais": str(_pick(r, "confianca_pais", "confianca", "Confiança País") or "").strip(),
            "base_inferencia_pais": str(_pick(r, "base_inferencia_pais", "base_pais") or "").strip(),
        }
    return mapa



def _parse_date_iso(valor: Any):
    if not valor:
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    try:
        texto = str(valor).strip()
        if not texto:
            return None
        return datetime.fromisoformat(texto[:10]).date()
    except Exception:
        try:
            dt = datetime.strptime(str(valor)[:10], "%Y-%m-%d")
            return dt.date()
        except Exception:
            return None


def _to_int(valor) -> int:
    try:
        if valor is None or valor == "":
            return 0
        if isinstance(valor, str):
            valor = valor.strip()
            if not valor:
                return 0
            if "," in valor:
                valor = valor.replace(".", "").replace(",", ".")
        return int(float(valor))
    except Exception:
        return 0


def _montar_entrada_prepedidos_dia_mes(emitidos_rows: list[dict], ano: int) -> tuple[list[dict], dict]:
    """
    Matriz mês x dia com quantidade de pré-pedidos emitidos.

    Fonte:
    - f_prepedidos_emitidos
    - data: coluna emissao
    - contagem: pré-pedidos distintos
    - quantidade: soma de quant apenas como apoio/tooltip
    - valor: não inferido; só soma total_rs/total quando vier informado
    """
    por_dia = defaultdict(lambda: {"prepedidos": set(), "quantidade": 0.0, "valor_informado": 0.0})
    por_mes = defaultdict(lambda: {"prepedidos": set(), "quantidade": 0.0, "valor_informado": 0.0})

    linhas_lidas = 0
    linhas_com_emissao = 0
    menor_emissao = None
    maior_emissao = None

    for idx, row in enumerate(emitidos_rows or []):
        linhas_lidas += 1

        emissao = _parse_date_iso(_pick(row, "emissao", "data_emissao", "dt_emissao"))
        if not emissao:
            continue

        linhas_com_emissao += 1

        if emissao.year != int(ano):
            continue

        if menor_emissao is None or emissao < menor_emissao:
            menor_emissao = emissao
        if maior_emissao is None or emissao > maior_emissao:
            maior_emissao = emissao

        prepedido = _normaliza_codigo(_pick(row, "prepedido", "pre_pedido", "pré-pedido", "pre pedido"))
        if not prepedido:
            # Não costuma acontecer, mas evita perder a linha se o pré-pedido vier vazio.
            prepedido = f"LINHA-{idx + 1}"

        quantidade = _to_float(_pick(row, "quant", "quantidade", "qtd"))
        valor = _to_float(_pick(row, "total_rs", "total", "valor"))

        chave = (emissao.month, emissao.day)

        por_dia[chave]["prepedidos"].add(prepedido)
        por_dia[chave]["quantidade"] += quantidade
        por_dia[chave]["valor_informado"] += valor

        por_mes[emissao.month]["prepedidos"].add(prepedido)
        por_mes[emissao.month]["quantidade"] += quantidade
        por_mes[emissao.month]["valor_informado"] += valor

    max_pre_dia = max([len(v["prepedidos"]) for v in por_dia.values()] or [0])

    matriz = []

    for mes in range(1, 13):
        ultimo_dia = monthrange(int(ano), mes)[1]
        dias = []

        for dia in range(1, 32):
            existe = dia <= ultimo_dia
            vals = por_dia.get((mes, dia), {"prepedidos": set(), "quantidade": 0.0, "valor_informado": 0.0})

            qtd_pre = len(vals["prepedidos"]) if existe else None
            intensidade = (
                round((qtd_pre / max_pre_dia) * 100, 1)
                if existe and max_pre_dia > 0 and qtd_pre is not None
                else 0.0
            )

            dias.append({
                "dia": dia,
                "existe_no_mes": existe,
                "prepedidos": qtd_pre,
                "quantidade": round(vals["quantidade"], 2) if existe else None,
                "valor_informado": round(vals["valor_informado"], 2) if existe else None,
                "intensidade_pct": intensidade,
            })

        vals_mes = por_mes.get(mes, {"prepedidos": set(), "quantidade": 0.0, "valor_informado": 0.0})

        matriz.append({
            "mes": mes,
            "mes_nome": MESES.get(mes, str(mes)),
            "dias": dias,
            "total_prepedidos": len(vals_mes["prepedidos"]),
            "total_quantidade": round(vals_mes["quantidade"], 2),
            "valor_informado": round(vals_mes["valor_informado"], 2),
            "media_diaria_prepedidos": round(len(vals_mes["prepedidos"]) / ultimo_dia, 2),
        })

    debug = {
        "fonte": "f_prepedidos_emitidos",
        "ano": int(ano),
        "linhas_lidas": linhas_lidas,
        "linhas_com_emissao": linhas_com_emissao,
        "prepedidos_distintos_ano": len({p for vals in por_mes.values() for p in vals["prepedidos"]}),
        "dias_com_movimento": len(por_dia),
        "max_prepedidos_dia": max_pre_dia,
        "menor_emissao_ano": menor_emissao.isoformat() if menor_emissao else None,
        "maior_emissao_ano": maior_emissao.isoformat() if maior_emissao else None,
    }

    return matriz, debug



def _dias_entre(data_inicio: Any, data_fim: Any) -> int | None:
    inicio = _parse_date_iso(data_inicio)
    fim = _parse_date_iso(data_fim)
    if not inicio or not fim:
        return None
    try:
        return (fim - inicio).days
    except Exception:
        return None


def _bucket_dias(dias: int | None) -> str:
    if dias is None:
        return "Sem data"
    if dias <= 7:
        return "0 a 7 dias"
    if dias <= 15:
        return "8 a 15 dias"
    if dias <= 30:
        return "16 a 30 dias"
    if dias <= 60:
        return "31 a 60 dias"
    return "Acima de 60 dias"


def _mesmo_mes(data_a: Any, data_b: Any) -> bool:
    a = _parse_date_iso(data_a)
    b = _parse_date_iso(data_b)
    if not a or not b:
        return False
    return a.year == b.year and a.month == b.month


def _data_mes_anterior(data_a: Any, data_b: Any) -> bool:
    a = _parse_date_iso(data_a)
    b = _parse_date_iso(data_b)
    if not a or not b:
        return False
    return (a.year, a.month) < (b.year, b.month)


def _prepedido_no_fim_do_mes(data_preped: Any, data_fat: Any) -> bool:
    pre = _parse_date_iso(data_preped)
    fat = _parse_date_iso(data_fat)
    if not pre or not fat:
        return False
    return pre.year == fat.year and pre.month == fat.month and pre.day >= 21


def _media_mediana(lista: list[int]) -> tuple[float, float]:
    valores = sorted([v for v in lista if v is not None])
    if not valores:
        return 0.0, 0.0
    media = sum(valores) / len(valores)
    meio = len(valores) // 2
    if len(valores) % 2:
        mediana = float(valores[meio])
    else:
        mediana = (valores[meio - 1] + valores[meio]) / 2
    return media, mediana


def _inferir_pais_cliente(dim_cli: dict | None, estado_fallback: str = "", tipo_fallback: str = "") -> tuple[str, str, str]:
    """
    País estimado a partir da dimensão de clientes.
    Regra conservadora:
      - UF brasileira => Brasil;
      - UF EX / tipo Exportacao => tenta inferir pelo cadastro;
      - sem match => Exterior - revisar.
    """
    dim_cli = dim_cli or {}

    pais_salvo = str(dim_cli.get("pais_estimado") or "").strip()
    if pais_salvo:
        return (
            pais_salvo,
            str(dim_cli.get("confianca_pais") or "alta").strip() or "alta",
            str(dim_cli.get("base_inferencia_pais") or "d_clientes.pais_estimado").strip() or "d_clientes.pais_estimado",
        )

    estado = _normaliza_texto(dim_cli.get("estado") or estado_fallback)
    tipo = _normaliza_texto(dim_cli.get("tipo_cliente") or tipo_fallback)

    if estado and estado not in {"EX", "EXT", "EXTERIOR"} and "EXPORT" not in tipo:
        return "Brasil", "alta", "Estado diferente de EX"

    texto = " ".join([
        str(dim_cli.get("municipio") or ""),
        str(dim_cli.get("endereco") or ""),
        str(dim_cli.get("bairro") or ""),
        str(dim_cli.get("end_entrega") or ""),
        str(dim_cli.get("end_cobranca") or ""),
        str(dim_cli.get("nome") or ""),
        str(dim_cli.get("nome_fantasia") or ""),
    ])
    texto_norm = _normaliza_texto(texto)

    # Termos vistos em cadastros de clientes EX. A lista é propositalmente simples,
    # para dar uma leitura executiva de país sem depender de uma coluna oficial ainda.
    padroes = [
        ("EL SALVADOR", "El Salvador"),
        ("SAN SALVADOR", "El Salvador"),
        ("FRANCA", "França"),
        ("SARCELLES", "França"),
        ("REINO UNIDO", "Reino Unido"),
        ("LONDRES", "Reino Unido"),
        ("LONDON", "Reino Unido"),
        (" UK", "Reino Unido"),
        ("ESTADOS UNIDOS", "Estados Unidos"),
        ("EST.UN", "Estados Unidos"),
        ("UNITED STATES", "Estados Unidos"),
        ("USA", "Estados Unidos"),
        ("CHICAGO", "Estados Unidos"),
        ("ILLINOIS", "Estados Unidos"),
        ("DHAKA", "Bangladesh"),
        ("BANGLADESH", "Bangladesh"),
        ("PHNOM PENH", "Camboja"),
        ("CAMB", "Camboja"),
        ("LUANDA", "Angola"),
        ("ANGOLA", "Angola"),
        ("MARR", "Marrocos"),
        ("MARROC", "Marrocos"),
        ("DUBAI", "Emirados Árabes"),
        ("EM. ARAB", "Emirados Árabes"),
        ("EMIRADOS", "Emirados Árabes"),
        ("COLOMBIA", "Colômbia"),
        ("BOGOTA", "Colômbia"),
        ("CALI", "Colômbia"),
        ("MEDELLIN", "Colômbia"),
        ("AUSTR", "Áustria"),
        ("RUSSIA", "Rússia"),
        ("MOSCOW", "Rússia"),
        ("CHILE", "Chile"),
        ("SANTIAGO", "Chile"),
        ("PARAGUAI", "Paraguai"),
        ("PARAGUAY", "Paraguai"),
        ("ASUNCION", "Paraguai"),
        ("CIDADE DO LESTE", "Paraguai"),
        ("CIUDAD DEL ESTE", "Paraguai"),
        ("URUGUAI", "Uruguai"),
        ("URUGUAY", "Uruguai"),
        ("MONTEVIDEO", "Uruguai"),
        ("BOLIV", "Bolívia"),
        ("COCHABAMBA", "Bolívia"),
        ("PERU", "Peru"),
        ("ECUADOR", "Equador"),
        ("QUITO", "Equador"),
        ("SANTO DOMINGO", "República Dominicana"),
        ("DOMINIC", "República Dominicana"),
        ("MEXICO", "México"),
        ("TURQUIA", "Turquia"),
        ("TURKEY", "Turquia"),
        ("ITALIA", "Itália"),
        ("ITALY", "Itália"),
        ("GRECIA", "Grécia"),
        ("GREECE", "Grécia"),
        ("ATHENS", "Grécia"),
        ("ATENAS", "Grécia"),
        ("ARGEL", "Argélia"),
        ("TLEMCEN", "Argélia"),
        ("EGITO", "Egito"),
        ("EGYPT", "Egito"),
        ("ALEXANDRIA", "Egito"),
        ("IRAQUE", "Iraque"),
        ("IRAQ", "Iraque"),
        ("LIBANO", "Líbano"),
        ("LEBANON", "Líbano"),
        ("SIRIA", "Síria"),
        ("DAMASCUS", "Síria"),
        ("JORDANIA", "Jordânia"),
        ("AMMAN", "Jordânia"),
        ("TAILANDIA", "Tailândia"),
        ("BANGKOK", "Tailândia"),
        ("ISRAEL", "Israel"),
        ("GEORGIA", "Geórgia"),
        ("TBILISI", "Geórgia"),
        ("ALBANIA", "Albânia"),
        ("TIRANA", "Albânia"),
        ("UCRANI", "Ucrânia"),
        ("UKRAINE", "Ucrânia"),
        ("KAZA", "Cazaquistão"),
        ("AZERBAIJAO", "Azerbaijão"),
        ("BAKU", "Azerbaijão"),
        ("LITHUANIA", "Lituânia"),
        ("LITUANIA", "Lituânia"),
        ("ADEN", "Iêmen"),
        ("YEMEN", "Iêmen"),
        ("SRI LANKA", "Sri Lanka"),
        ("COTONOU", "Benin"),
        ("BENIN", "Benin"),
        ("ULAANBAATAR", "Mongólia"),
        ("MONGOL", "Mongólia"),
        ("SINGAP", "Singapura"),
        ("UBI AVENUE", "Singapura"),
        ("GUADALUPE", "Guadalupe"),
        ("POINTEAPITRE", "Guadalupe"),
    ]

    for termo, pais in padroes:
        if termo in texto_norm:
            return pais, "estimada", f"Cadastro de clientes · termo '{termo}'"

    ddi = re.sub(r"\D", "", str(dim_cli.get("ddi") or ""))
    ddi_map = {
        "1": "Estados Unidos",
        "7": "Rússia",
        "20": "Egito",
        "27": "África do Sul",
        "30": "Grécia",
        "33": "França",
        "34": "Espanha",
        "39": "Itália",
        "41": "Suíça",
        "44": "Reino Unido",
        "48": "Polônia",
        "49": "Alemanha",
        "51": "Peru",
        "52": "México",
        "54": "Argentina",
        "56": "Chile",
        "57": "Colômbia",
        "58": "Venezuela",
        "62": "Indonésia",
        "63": "Filipinas",
        "65": "Singapura",
        "66": "Tailândia",
        "84": "Vietnã",
        "90": "Turquia",
        "94": "Sri Lanka",
        "98": "Irã",
        "211": "Sudão do Sul",
        "212": "Marrocos",
        "213": "Argélia",
        "216": "Tunísia",
        "218": "Líbia",
        "229": "Benin",
        "233": "Gana",
        "234": "Nigéria",
        "244": "Angola",
        "249": "Sudão",
        "261": "Madagascar",
        "351": "Portugal",
        "357": "Chipre",
        "359": "Bulgária",
        "370": "Lituânia",
        "374": "Armênia",
        "380": "Ucrânia",
        "502": "Guatemala",
        "503": "El Salvador",
        "504": "Honduras",
        "505": "Nicarágua",
        "506": "Costa Rica",
        "507": "Panamá",
        "591": "Bolívia",
        "593": "Equador",
        "595": "Paraguai",
        "598": "Uruguai",
        "855": "Camboja",
        "880": "Bangladesh",
        "961": "Líbano",
        "962": "Jordânia",
        "963": "Síria",
        "964": "Iraque",
        "965": "Kuwait",
        "966": "Arábia Saudita",
        "968": "Omã",
        "971": "Emirados Árabes",
        "972": "Israel",
        "974": "Catar",
        "976": "Mongólia",
        "994": "Azerbaijão",
        "995": "Geórgia",
    }

    if ddi and ddi in ddi_map:
        return ddi_map[ddi], "estimada", f"DDI {ddi}"

    if estado in {"EX", "EXT", "EXTERIOR"} or "EXPORT" in tipo:
        return "Exterior - revisar", "baixa", "Estado EX sem país identificado"

    return "Não informado", "baixa", "Cadastro sem país/UF"


def _valor_pendente(row: dict) -> tuple[float, float]:
    quant_original = _to_float(_pick(row, "quant", "quantidade", "qtd"))
    saldo = _to_float(_pick(row, "saldo"))
    qtd_pendente = saldo if saldo > 0 else quant_original

    preco = _to_float(_pick(row, "prcunit", "preco", "preço"))
    total = _to_float(_pick(row, "total_rs", "total", "valor"))

    if qtd_pendente > 0 and preco > 0:
        return qtd_pendente, qtd_pendente * preco

    if qtd_pendente > 0 and quant_original > 0 and total > 0:
        return qtd_pendente, total * (qtd_pendente / quant_original)

    return qtd_pendente, total


def _valor_prepedido_emitido(row: dict) -> tuple[float, float]:
    """
    Valor/quantidade de entrada de pré-pedido.
    Usado para a visão mês a mês de demanda comercial emitida.
    """
    quantidade = _to_float(_pick(row, "quant", "quantidade", "qtd"))
    preco = _to_float(_pick(row, "prcunit", "preco", "preço"))
    total = _to_float(_pick(row, "total_rs", "total", "valor"))

    if quantidade > 0 and preco > 0:
        return quantidade, quantidade * preco

    return quantidade, total



def _ano_mes_linha_faturamento(row: dict) -> tuple[int | None, int | None]:
    """
    Identifica ano e mês de uma linha de faturamento.
    Usa os campos derivados quando existirem e cai para a data de emissão.
    """
    ano_val = int(_to_float(_pick(row, "ano"))) if _pick(row, "ano") not in [None, ""] else 0
    mes_val = int(_to_float(_pick(row, "mes"))) if _pick(row, "mes") not in [None, ""] else 0

    if ano_val > 0 and 1 <= mes_val <= 12:
        return ano_val, mes_val

    data_ref = _parse_date_iso(_pick(row, "emissao", "data", "dt_emissao"))
    if data_ref:
        return data_ref.year, data_ref.month

    return None, None


def _linha_faturamento_passou_filtros(
    row: dict,
    escopo: str,
    produto_filtro: str | None,
    dim_produtos: dict,
) -> tuple[bool, str, str, str, str]:
    """
    Centraliza a regra de escopo/produto para reaproveitar em análises históricas.
    Retorna: ok, produto, grupo, descricao, linha.
    """
    produto_cod = _normaliza_codigo(_pick(row, "produto", "cod_produto", "codigo"))
    grupo_raw = str(_pick(row, "grupo", "Grupo") or "").strip()
    descricao = str(_pick(row, "descricao", "desc_produto", "Descrição", "Desc Produto") or "").strip()

    dim_prod = dim_produtos.get(produto_cod, {})
    grupo = dim_prod.get("grupo") or grupo_raw
    linha = dim_prod.get("linha") or "Não classificado"
    if dim_prod.get("desc_produto"):
        descricao = dim_prod["desc_produto"]

    if not _escopo_ok(escopo, grupo=grupo, descricao=descricao, linha=linha, produto=produto_cod):
        return False, produto_cod, grupo, descricao, linha

    if not _produto_filtro_ok(produto_filtro, produto=produto_cod, descricao=descricao, grupo=grupo, linha=linha):
        return False, produto_cod, grupo, descricao, linha

    return True, produto_cod, grupo, descricao, linha


@router.get("/resumo")
def resumo_faturamento(
    ano: int = Query(2026),
    bloco: str = Query("TODOS"),
    produto: str | None = Query(default=None),
):
    escopo = bloco or "TODOS"
    produto_filtro = str(produto or "").strip()

    dim_produtos = _carregar_dimensao_produtos()
    dim_clientes = _carregar_dimensao_clientes()

    # Carrega f_faturados completa para permitir visão histórica anual e comparação com o ano anterior.
    # A carga de cada tela continua filtrada pelo ano selecionado em real_rows.
    faturados_all_rows = _select_all_safe(["f_faturados"])
    usando_faturados = len(faturados_all_rows) > 0
    faturados_rows = [
        r for r in faturados_all_rows
        if _ano_mes_linha_faturamento(r)[0] == int(ano)
    ] if usando_faturados else []
    sd2_rows = [] if usando_faturados else _select_all("f_sd2_saidas", {"ano": ano})
    real_rows = faturados_rows if usando_faturados else sd2_rows
    fonte_faturamento = "f_faturados" if usando_faturados else "f_sd2_saidas"

    forecast_rows = _select_all_safe(["f_forecast_sop"], {"ano": ano})
    orcado_rows = _select_all_safe(["f_orcado_faturamento"], {"ano": ano})
    pendentes_rows = _select_all_safe(["f_prepedidos_pendentes"])
    emitidos_rows = _select_all_safe(["f_prepedidos_emitidos"])

    entrada_prepedidos_dia_mes, entrada_prepedidos_debug = _montar_entrada_prepedidos_dia_mes(
        emitidos_rows,
        int(ano),
    )

    total_valor = 0.0
    total_qtd = 0.0
    total_registros = 0

    meses = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "forecast": 0.0, "orcado": 0.0, "clientes": set(), "produtos": set()})
    clientes = defaultdict(lambda: {
        "faturamento": 0.0,
        "quantidade": 0.0,
        "produtos": set(),
        "registros": 0,
        "nome": "",
        "nome_fantasia": "",
        "tipo_cliente": "",
        "estado": "",
        "municipio": "",
        "regiao": "",
        "desc_regiao": "",
        "pais_estimado": "",
        "confianca_pais": "",
    })
    produtos = defaultdict(lambda: {
        "faturamento": 0.0,
        "quantidade": 0.0,
        "forecast": 0.0,
        "orcado": 0.0,
        "clientes": set(),
        "registros": 0,
        "descricao": "",
        "grupo": "",
        "linha": "",
    })
    linhas = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set(), "produtos": set()})
    estados = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set()})
    paises = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set(), "confianca_baixa": 0})
    tipos_clientes = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set()})

    total_forecast = 0.0
    total_orcado = 0.0

    # Histórico anual e mês contra ano anterior.
    # Usa f_faturados completa quando disponível; no fallback SD2, usa apenas o ano selecionado.
    historico_rows = faturados_all_rows if usando_faturados else real_rows
    historico_anos = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "registros": 0, "clientes": set(), "produtos": set(), "ultimo_mes": 0})
    historico_linhas_ano = defaultdict(lambda: defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set(), "produtos": set()}))
    historico_paises_ano = defaultdict(lambda: defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0, "clientes": set(), "produtos": set(), "confianca_baixa": 0}))
    meses_ano_anterior = defaultdict(lambda: {"faturamento": 0.0, "quantidade": 0.0})
    ano_ref = int(ano)
    ano_anterior = ano_ref - 1

    for r_hist in historico_rows:
        ok_hist, produto_hist, _grupo_hist, _desc_hist, linha_hist = _linha_faturamento_passou_filtros(
            r_hist,
            escopo,
            produto_filtro,
            dim_produtos,
        )
        if not ok_hist:
            continue

        ano_hist, mes_hist = _ano_mes_linha_faturamento(r_hist)
        if not ano_hist or not mes_hist or mes_hist < 1 or mes_hist > 12:
            continue

        valor_hist = _to_float(_pick(r_hist, "total", "total_final", "vlr_total", "valor"))
        qtd_hist = _to_float(_pick(r_hist, "quantidade", "qtd"))
        if valor_hist == 0 and qtd_hist == 0:
            continue

        if 2022 <= int(ano_hist) <= ano_ref:
            cliente_hist = _normaliza_codigo(_pick(r_hist, "cliente", "cod_cliente"))
            historico_anos[int(ano_hist)]["faturamento"] += valor_hist
            historico_anos[int(ano_hist)]["quantidade"] += qtd_hist
            historico_anos[int(ano_hist)]["registros"] += 1
            historico_anos[int(ano_hist)]["ultimo_mes"] = max(int(historico_anos[int(ano_hist)]["ultimo_mes"] or 0), int(mes_hist))
            if cliente_hist:
                historico_anos[int(ano_hist)]["clientes"].add(cliente_hist)
            if produto_hist:
                historico_anos[int(ano_hist)]["produtos"].add(produto_hist)

            linha_hist_label = linha_hist or "Não classificado"
            historico_linhas_ano[int(ano_hist)][linha_hist_label]["faturamento"] += valor_hist
            historico_linhas_ano[int(ano_hist)][linha_hist_label]["quantidade"] += qtd_hist
            if cliente_hist:
                historico_linhas_ano[int(ano_hist)][linha_hist_label]["clientes"].add(cliente_hist)
            if produto_hist:
                historico_linhas_ano[int(ano_hist)][linha_hist_label]["produtos"].add(produto_hist)

            dim_cli_hist = dim_clientes.get(cliente_hist, {})
            estado_hist = str(_pick(r_hist, "estado", "uf", "est") or "").strip()
            tipo_hist = dim_cli_hist.get("tipo_cliente") or ""
            pais_hist, confianca_hist, _base_hist = _inferir_pais_cliente(
                dim_cli_hist,
                estado_fallback=estado_hist,
                tipo_fallback=tipo_hist,
            )
            pais_hist_label = pais_hist or "Não informado"
            historico_paises_ano[int(ano_hist)][pais_hist_label]["faturamento"] += valor_hist
            historico_paises_ano[int(ano_hist)][pais_hist_label]["quantidade"] += qtd_hist
            if cliente_hist:
                historico_paises_ano[int(ano_hist)][pais_hist_label]["clientes"].add(cliente_hist)
            if produto_hist:
                historico_paises_ano[int(ano_hist)][pais_hist_label]["produtos"].add(produto_hist)
            if confianca_hist == "baixa":
                historico_paises_ano[int(ano_hist)][pais_hist_label]["confianca_baixa"] += 1

        if int(ano_hist) == ano_anterior:
            meses_ano_anterior[int(mes_hist)]["faturamento"] += valor_hist
            meses_ano_anterior[int(mes_hist)]["quantidade"] += qtd_hist

    # Forecast S&OP e Orçado continuam por quantidade, como já era na tela.
    for r in forecast_rows:
        produto_fc = _normaliza_codigo(_pick(r, "cod_produto", "produto", "codigo"))
        grupo_raw_fc = str(_pick(r, "grupo", "Grupo") or "").strip()
        descricao_fc = str(_pick(r, "desc_produto", "descricao", "Descricao Produto", "Descricao") or "").strip()

        dim_prod = dim_produtos.get(produto_fc, {})
        grupo_fc = dim_prod.get("grupo") or grupo_raw_fc
        linha_fc = dim_prod.get("linha") or "Não classificado"
        if dim_prod.get("desc_produto"):
            descricao_fc = dim_prod["desc_produto"]

        if not _escopo_ok(escopo, grupo=grupo_fc, descricao=descricao_fc, linha=linha_fc, produto=produto_fc):
            continue
        if not _produto_filtro_ok(produto_filtro, produto=produto_fc, descricao=descricao_fc, grupo=grupo_fc, linha=linha_fc):
            continue

        mes_fc = int(_to_float(_pick(r, "mes", "Mês")))
        if mes_fc < 1 or mes_fc > 12:
            continue

        qtd_forecast = _to_float(_pick(r, "qtd_forecast", "forecast", "qtd_caixas", "quantidade"))
        if qtd_forecast <= 0:
            continue

        total_forecast += qtd_forecast
        meses[mes_fc]["forecast"] += qtd_forecast
        produtos[produto_fc]["forecast"] += qtd_forecast
        produtos[produto_fc]["descricao"] = descricao_fc or produtos[produto_fc]["descricao"] or "-"
        produtos[produto_fc]["grupo"] = grupo_fc or produtos[produto_fc]["grupo"] or "-"
        produtos[produto_fc]["linha"] = linha_fc or produtos[produto_fc]["linha"] or "Não classificado"

    for r in orcado_rows:
        produto_orc = _normaliza_codigo(_pick(r, "cod_produto", "produto", "codigo"))
        grupo_raw_orc = str(_pick(r, "grupo", "Grupo") or "").strip()
        descricao_orc = str(_pick(r, "desc_produto", "descricao", "Descricao Produto", "Descricao") or "").strip()

        dim_prod = dim_produtos.get(produto_orc, {})
        grupo_orc = dim_prod.get("grupo") or grupo_raw_orc
        linha_orc = dim_prod.get("linha") or "Não classificado"
        if dim_prod.get("desc_produto"):
            descricao_orc = dim_prod["desc_produto"]

        if not _escopo_ok(escopo, grupo=grupo_orc, descricao=descricao_orc, linha=linha_orc, produto=produto_orc):
            continue
        if not _produto_filtro_ok(produto_filtro, produto=produto_orc, descricao=descricao_orc, grupo=grupo_orc, linha=linha_orc):
            continue

        mes_orc = int(_to_float(_pick(r, "mes", "Mês")))
        if mes_orc < 1 or mes_orc > 12:
            continue

        qtd_orcado = _to_float(_pick(r, "qtd_caixas", "orcado", "orçado", "quantidade"))
        if qtd_orcado <= 0:
            continue

        total_orcado += qtd_orcado
        meses[mes_orc]["orcado"] += qtd_orcado
        produtos[produto_orc]["orcado"] += qtd_orcado
        produtos[produto_orc]["descricao"] = descricao_orc or produtos[produto_orc]["descricao"] or "-"
        produtos[produto_orc]["grupo"] = grupo_orc or produtos[produto_orc]["grupo"] or "-"
        produtos[produto_orc]["linha"] = linha_orc or produtos[produto_orc]["linha"] or "Não classificado"

    # Ciclo comercial: entrada do pré-pedido/pedido x faturamento.
    dias_preped_ped: list[int] = []
    dias_preped_fat: list[int] = []
    dias_ped_fat: list[int] = []
    ciclo_aging = defaultdict(lambda: {"registros": 0, "faturamento": 0.0, "quantidade": 0.0})
    ciclo_origem = defaultdict(lambda: {"registros": 0, "faturamento": 0.0, "quantidade": 0.0})
    atendimento_mensal = defaultdict(lambda: {
        # Visão mês a mês de atendimento da demanda identificada.
        # Demanda do mês = faturado de pré-pedidos emitidos no próprio mês + carteira pendente hoje emitida naquele mês.
        # Isso evita distorção quando a base de pré-pedidos emitidos não é histórico completo.
        "demanda_mes_valor": 0.0,
        "demanda_mes_quantidade": 0.0,
        "prepedidos_demanda": set(),
        "clientes_entrada": set(),
        "faturamento_total": 0.0,
        "faturamento_quantidade": 0.0,
        "faturamento_prepedido_mesmo_mes": 0.0,
        "faturamento_prepedido_mesmo_mes_quantidade": 0.0,
        "faturamento_carteira_anterior": 0.0,
        "faturamento_sem_classificacao": 0.0,
        "carteira_pendente_mes_valor": 0.0,
        "carteira_pendente_mes_quantidade": 0.0,
        "carteira_pendente_prepedidos": set(),
        "carteira_pendente_clientes": set(),
    })
    faturamento_com_prepedido = 0.0
    faturamento_prepedido_mesmo_mes = 0.0
    faturamento_prepedido_mes_anterior = 0.0
    faturamento_prepedido_fim_mes = 0.0

    for r in real_rows:
        produto_cod = _normaliza_codigo(_pick(r, "produto", "cod_produto", "codigo"))
        grupo_raw = str(_pick(r, "grupo", "Grupo") or "").strip()
        descricao = str(_pick(r, "descricao", "desc_produto", "Descrição", "Desc Produto") or "").strip()
        cliente_cod = _normaliza_codigo(_pick(r, "cliente", "cod_cliente"))

        dim_prod = dim_produtos.get(produto_cod, {})
        grupo = dim_prod.get("grupo") or grupo_raw
        linha = dim_prod.get("linha") or "Não classificado"
        if dim_prod.get("desc_produto"):
            descricao = dim_prod["desc_produto"]

        if not _escopo_ok(escopo, grupo=grupo, descricao=descricao, linha=linha, produto=produto_cod):
            continue
        if not _produto_filtro_ok(produto_filtro, produto=produto_cod, descricao=descricao, grupo=grupo, linha=linha):
            continue

        mes = int(_to_float(_pick(r, "mes")))
        if mes < 1 or mes > 12:
            continue

        quantidade = _to_float(_pick(r, "quantidade", "qtd"))
        valor = _to_float(_pick(r, "total", "total_final", "vlr_total", "valor"))
        if quantidade == 0 and valor == 0:
            continue

        dim_cli = dim_clientes.get(cliente_cod, {})
        nome_cliente = dim_cli.get("nome") or dim_cli.get("nome_fantasia") or _pick(r, "razao_social", "nome") or (f"Cliente {cliente_cod}" if cliente_cod else "Sem cliente")
        fantasia = dim_cli.get("nome_fantasia") or nome_cliente
        tipo_cliente = dim_cli.get("tipo_cliente") or "Não informado"
        estado = dim_cli.get("estado") or str(_pick(r, "estado", "uf", "est") or "").strip() or "Não informado"
        municipio = dim_cli.get("municipio") or "Não informado"
        regiao = dim_cli.get("regiao") or str(_pick(r, "regiao") or "").strip() or "Não informado"
        desc_regiao = dim_cli.get("desc_regiao") or "Não informado"
        pais_estimado, confianca_pais, _base_pais = _inferir_pais_cliente(dim_cli, estado_fallback=estado, tipo_fallback=tipo_cliente)

        total_valor += valor
        total_qtd += quantidade
        total_registros += 1

        meses[mes]["valor"] += valor
        meses[mes]["quantidade"] += quantidade
        meses[mes]["clientes"].add(cliente_cod)
        meses[mes]["produtos"].add(produto_cod)

        clientes[cliente_cod]["faturamento"] += valor
        clientes[cliente_cod]["quantidade"] += quantidade
        clientes[cliente_cod]["produtos"].add(produto_cod)
        clientes[cliente_cod]["registros"] += 1
        clientes[cliente_cod]["nome"] = nome_cliente
        clientes[cliente_cod]["nome_fantasia"] = fantasia
        clientes[cliente_cod]["tipo_cliente"] = tipo_cliente
        clientes[cliente_cod]["estado"] = estado
        clientes[cliente_cod]["municipio"] = municipio
        clientes[cliente_cod]["regiao"] = regiao
        clientes[cliente_cod]["desc_regiao"] = desc_regiao
        clientes[cliente_cod]["pais_estimado"] = pais_estimado
        clientes[cliente_cod]["confianca_pais"] = confianca_pais

        produtos[produto_cod]["faturamento"] += valor
        produtos[produto_cod]["quantidade"] += quantidade
        produtos[produto_cod]["clientes"].add(cliente_cod)
        produtos[produto_cod]["registros"] += 1
        produtos[produto_cod]["descricao"] = descricao
        produtos[produto_cod]["grupo"] = grupo or "-"
        produtos[produto_cod]["linha"] = linha or "Não classificado"

        linha_label = linha or "Não classificado"
        linhas[linha_label]["faturamento"] += valor
        linhas[linha_label]["quantidade"] += quantidade
        linhas[linha_label]["clientes"].add(cliente_cod)
        linhas[linha_label]["produtos"].add(produto_cod)

        estados[estado]["faturamento"] += valor
        estados[estado]["quantidade"] += quantidade
        estados[estado]["clientes"].add(cliente_cod)

        paises[pais_estimado]["faturamento"] += valor
        paises[pais_estimado]["quantidade"] += quantidade
        paises[pais_estimado]["clientes"].add(cliente_cod)
        if confianca_pais == "baixa":
            paises[pais_estimado]["confianca_baixa"] += 1

        tipos_clientes[tipo_cliente]["faturamento"] += valor
        tipos_clientes[tipo_cliente]["quantidade"] += quantidade
        tipos_clientes[tipo_cliente]["clientes"].add(cliente_cod)

        if usando_faturados:
            data_fat = _pick(r, "emissao")
            data_preped = _pick(r, "emissao_preped")
            data_ped = _pick(r, "emissao_ped")
            dias_pre = _dias_entre(data_preped, data_fat)
            dias_ped = _dias_entre(data_ped, data_fat)
            dias_pre_ped = _dias_entre(data_preped, data_ped)

            atendimento_mensal[mes]["faturamento_total"] += valor
            atendimento_mensal[mes]["faturamento_quantidade"] += quantidade

            if dias_pre_ped is not None:
                dias_preped_ped.append(dias_pre_ped)

            if dias_pre is not None:
                dias_preped_fat.append(dias_pre)
                bucket = _bucket_dias(dias_pre)
                ciclo_aging[bucket]["registros"] += 1
                ciclo_aging[bucket]["faturamento"] += valor
                ciclo_aging[bucket]["quantidade"] += quantidade
                faturamento_com_prepedido += valor

                if _mesmo_mes(data_preped, data_fat):
                    ciclo_origem["Pré-pedido do mesmo mês"]["registros"] += 1
                    ciclo_origem["Pré-pedido do mesmo mês"]["faturamento"] += valor
                    ciclo_origem["Pré-pedido do mesmo mês"]["quantidade"] += quantidade
                    atendimento_mensal[mes]["faturamento_prepedido_mesmo_mes"] += valor
                    atendimento_mensal[mes]["faturamento_prepedido_mesmo_mes_quantidade"] += quantidade
                    atendimento_mensal[mes]["demanda_mes_valor"] += valor
                    atendimento_mensal[mes]["demanda_mes_quantidade"] += quantidade
                    prepedido_cod_fat = _normaliza_codigo(_pick(r, "prepedido"))
                    if prepedido_cod_fat:
                        atendimento_mensal[mes]["prepedidos_demanda"].add(prepedido_cod_fat)
                    if cliente_cod:
                        atendimento_mensal[mes]["clientes_entrada"].add(cliente_cod)
                    faturamento_prepedido_mesmo_mes += valor
                elif _data_mes_anterior(data_preped, data_fat):
                    ciclo_origem["Carteira de meses anteriores"]["registros"] += 1
                    ciclo_origem["Carteira de meses anteriores"]["faturamento"] += valor
                    ciclo_origem["Carteira de meses anteriores"]["quantidade"] += quantidade
                    atendimento_mensal[mes]["faturamento_carteira_anterior"] += valor
                    faturamento_prepedido_mes_anterior += valor
                else:
                    ciclo_origem["Sem classificação de mês"]["registros"] += 1
                    ciclo_origem["Sem classificação de mês"]["faturamento"] += valor
                    ciclo_origem["Sem classificação de mês"]["quantidade"] += quantidade
                    atendimento_mensal[mes]["faturamento_sem_classificacao"] += valor

                if _prepedido_no_fim_do_mes(data_preped, data_fat):
                    faturamento_prepedido_fim_mes += valor

            if dias_ped is not None:
                dias_ped_fat.append(dias_ped)

    # A base f_prepedidos_emitidos foi mantida apenas como referência de carga.
    # Para a visão de atendimento mês a mês, a entrada usada é a demanda identificada:
    # faturado de pré-pedidos emitidos no mesmo mês + carteira pendente hoje emitida no mês.
    # Isso evita % de atendimento distorcido quando f_prepedidos_emitidos não representa o histórico completo.

    clientes_ativos = len([c for c, v in clientes.items() if c and (v["faturamento"] or v["quantidade"])])
    produtos_ativos = len([p for p, v in produtos.items() if p and (v["faturamento"] or v["quantidade"])])

    # Carteira pendente: snapshot aberto atual; não restringe pelo ano do faturamento.
    pendentes_status = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "clientes": set()})
    pendentes_aging = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "clientes": set()})
    pendentes_entrega = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "clientes": set()})
    pendentes_mes_emissao = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "clientes": set(), "ordem": 999})
    pendentes_clientes = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "produtos": set(), "nome": "", "estado": "", "pais_estimado": ""})
    pendentes_produtos = defaultdict(lambda: {"valor": 0.0, "quantidade": 0.0, "prepedidos": set(), "clientes": set(), "descricao": "", "linha": "", "grupo": ""})

    carteira_valor = 0.0
    carteira_qtd = 0.0
    carteira_prepedidos = set()
    carteira_clientes = set()
    carteira_produtos = set()
    carteira_vencida_valor = 0.0
    carteira_vencida_qtd = 0.0
    hoje = date.today()

    for r in pendentes_rows:
        produto_p = _normaliza_codigo(_pick(r, "produto", "cod_produto", "codigo"))
        grupo_raw_p = str(_pick(r, "grupo", "Grupo") or "").strip()
        descricao_p = str(_pick(r, "descricao", "desc_produto", "Descrição") or "").strip()
        cliente_p = _normaliza_codigo(_pick(r, "cliente", "cod_cliente"))

        dim_prod = dim_produtos.get(produto_p, {})
        grupo_p = dim_prod.get("grupo") or grupo_raw_p
        linha_p = dim_prod.get("linha") or "Não classificado"
        if dim_prod.get("desc_produto"):
            descricao_p = dim_prod["desc_produto"]

        if not _escopo_ok(escopo, grupo=grupo_p, descricao=descricao_p, linha=linha_p, produto=produto_p):
            continue
        if not _produto_filtro_ok(produto_filtro, produto=produto_p, descricao=descricao_p, grupo=grupo_p, linha=linha_p):
            continue

        qtd_pendente, valor_pendente = _valor_pendente(r)
        if qtd_pendente == 0 and valor_pendente == 0:
            continue

        prepedido_p = _normaliza_codigo(_pick(r, "prepedido")) or "-"
        status_p = str(_pick(r, "status") or "Não informado").strip() or "Não informado"
        emissao_p = _pick(r, "emissao")
        entrega_p = _parse_date_iso(_pick(r, "entrega"))
        dias_aberto = _dias_entre(emissao_p, hoje)
        bucket_aberto = _bucket_dias(dias_aberto)

        if entrega_p is None:
            status_entrega = "Sem data de entrega"
        elif entrega_p < hoje:
            status_entrega = "Entrega vencida"
        else:
            status_entrega = "Entrega futura"

        dim_cli = dim_clientes.get(cliente_p, {})
        nome_p = dim_cli.get("nome_fantasia") or dim_cli.get("nome") or str(_pick(r, "nome") or "") or (f"Cliente {cliente_p}" if cliente_p else "Sem cliente")
        estado_p = dim_cli.get("estado") or "Não informado"
        pais_p, _conf_pais, _base_pais = _inferir_pais_cliente(dim_cli, estado_fallback=estado_p, tipo_fallback=dim_cli.get("tipo_cliente") or "")

        carteira_valor += valor_pendente
        carteira_qtd += qtd_pendente
        carteira_prepedidos.add(prepedido_p)
        carteira_clientes.add(cliente_p)
        carteira_produtos.add(produto_p)

        emissao_p_dt = _parse_date_iso(emissao_p)
        if emissao_p_dt is None:
            mes_emissao_label = "Sem data"
            mes_emissao_ordem = 998
        elif emissao_p_dt.year < int(ano):
            mes_emissao_label = "Anos anteriores"
            mes_emissao_ordem = 0
        elif emissao_p_dt.year == int(ano):
            mes_emissao_label = MESES[emissao_p_dt.month]
            mes_emissao_ordem = emissao_p_dt.month
        else:
            mes_emissao_label = f"{MESES[emissao_p_dt.month]}/{emissao_p_dt.year}"
            mes_emissao_ordem = 500 + emissao_p_dt.month

        pendentes_mes_emissao[mes_emissao_label]["valor"] += valor_pendente
        pendentes_mes_emissao[mes_emissao_label]["quantidade"] += qtd_pendente
        pendentes_mes_emissao[mes_emissao_label]["prepedidos"].add(prepedido_p)
        pendentes_mes_emissao[mes_emissao_label]["clientes"].add(cliente_p)
        pendentes_mes_emissao[mes_emissao_label]["ordem"] = min(pendentes_mes_emissao[mes_emissao_label].get("ordem", mes_emissao_ordem), mes_emissao_ordem)

        if status_entrega == "Entrega vencida":
            carteira_vencida_valor += valor_pendente
            carteira_vencida_qtd += qtd_pendente

        emissao_p_dt = _parse_date_iso(emissao_p)
        if emissao_p_dt and emissao_p_dt.year == int(ano):
            mes_emissao_p = emissao_p_dt.month
            atendimento_mensal[mes_emissao_p]["carteira_pendente_mes_valor"] += valor_pendente
            atendimento_mensal[mes_emissao_p]["carteira_pendente_mes_quantidade"] += qtd_pendente
            atendimento_mensal[mes_emissao_p]["demanda_mes_valor"] += valor_pendente
            atendimento_mensal[mes_emissao_p]["demanda_mes_quantidade"] += qtd_pendente
            atendimento_mensal[mes_emissao_p]["carteira_pendente_prepedidos"].add(prepedido_p)
            atendimento_mensal[mes_emissao_p]["prepedidos_demanda"].add(prepedido_p)
            if cliente_p:
                atendimento_mensal[mes_emissao_p]["carteira_pendente_clientes"].add(cliente_p)
                atendimento_mensal[mes_emissao_p]["clientes_entrada"].add(cliente_p)

        pendentes_status[status_p]["valor"] += valor_pendente
        pendentes_status[status_p]["quantidade"] += qtd_pendente
        pendentes_status[status_p]["prepedidos"].add(prepedido_p)
        pendentes_status[status_p]["clientes"].add(cliente_p)

        pendentes_aging[bucket_aberto]["valor"] += valor_pendente
        pendentes_aging[bucket_aberto]["quantidade"] += qtd_pendente
        pendentes_aging[bucket_aberto]["prepedidos"].add(prepedido_p)
        pendentes_aging[bucket_aberto]["clientes"].add(cliente_p)

        pendentes_entrega[status_entrega]["valor"] += valor_pendente
        pendentes_entrega[status_entrega]["quantidade"] += qtd_pendente
        pendentes_entrega[status_entrega]["prepedidos"].add(prepedido_p)
        pendentes_entrega[status_entrega]["clientes"].add(cliente_p)

        pendentes_clientes[cliente_p]["valor"] += valor_pendente
        pendentes_clientes[cliente_p]["quantidade"] += qtd_pendente
        pendentes_clientes[cliente_p]["prepedidos"].add(prepedido_p)
        pendentes_clientes[cliente_p]["produtos"].add(produto_p)
        pendentes_clientes[cliente_p]["nome"] = nome_p
        pendentes_clientes[cliente_p]["estado"] = estado_p
        pendentes_clientes[cliente_p]["pais_estimado"] = pais_p

        pendentes_produtos[produto_p]["valor"] += valor_pendente
        pendentes_produtos[produto_p]["quantidade"] += qtd_pendente
        pendentes_produtos[produto_p]["prepedidos"].add(prepedido_p)
        pendentes_produtos[produto_p]["clientes"].add(cliente_p)
        pendentes_produtos[produto_p]["descricao"] = descricao_p or pendentes_produtos[produto_p]["descricao"] or "-"
        pendentes_produtos[produto_p]["linha"] = linha_p or pendentes_produtos[produto_p]["linha"] or "Não classificado"
        pendentes_produtos[produto_p]["grupo"] = grupo_p or pendentes_produtos[produto_p]["grupo"] or "-"

    clientes_lista = []
    acumulado_valor = 0.0
    acumulado_qtd = 0.0
    clientes_ordenados_valor = sorted(clientes.items(), key=lambda kv: kv[1]["faturamento"], reverse=True)

    rank_qtd = {}
    running_qtd = 0.0
    for idx, (cod, vals) in enumerate(sorted(clientes.items(), key=lambda kv: kv[1]["quantidade"], reverse=True), start=1):
        running_qtd += vals["quantidade"]
        pct_qtd = (running_qtd / total_qtd * 100) if total_qtd > 0 else 0.0
        rank_qtd[cod] = {
            "rank_qtd": idx,
            "acumulado_qtd_pct": pct_qtd,
            "abc_qtd": _classe_abc(pct_qtd),
        }

    for idx, (cod, vals) in enumerate(clientes_ordenados_valor, start=1):
        faturamento = vals["faturamento"]
        quantidade = vals["quantidade"]
        acumulado_valor += faturamento
        acumulado_qtd += quantidade
        acumulado_valor_pct = (acumulado_valor / total_valor * 100) if total_valor > 0 else 0.0
        qtd_info = rank_qtd.get(cod, {})
        clientes_lista.append({
            "rank_valor": idx,
            "rank_qtd": qtd_info.get("rank_qtd", idx),
            "cliente": cod or "-",
            "nome": vals["nome"] or "Sem cliente",
            "nome_fantasia": vals["nome_fantasia"] or vals["nome"] or "Sem cliente",
            "tipo_cliente": vals["tipo_cliente"] or "Não informado",
            "estado": vals["estado"] or "Não informado",
            "municipio": vals["municipio"] or "Não informado",
            "regiao": vals["regiao"] or "Não informado",
            "desc_regiao": vals["desc_regiao"] or "Não informado",
            "pais_estimado": vals["pais_estimado"] or "Não informado",
            "confianca_pais": vals["confianca_pais"] or "baixa",
            "faturamento": round(faturamento, 2),
            "quantidade": round(quantidade, 2),
            "preco_medio": round(faturamento / quantidade, 2) if quantidade > 0 else 0.0,
            "produtos": len(vals["produtos"]),
            "registros": vals["registros"],
            "participacao_valor_pct": round((faturamento / total_valor * 100) if total_valor > 0 else 0.0, 2),
            "participacao_qtd_pct": round((quantidade / total_qtd * 100) if total_qtd > 0 else 0.0, 2),
            "acumulado_valor_pct": round(acumulado_valor_pct, 2),
            "acumulado_qtd_pct": round(qtd_info.get("acumulado_qtd_pct", 0.0), 2),
            "abc_valor": _classe_abc(acumulado_valor_pct),
            "abc_qtd": qtd_info.get("abc_qtd", "C"),
        })

    produtos_lista = []
    for produto_cod, vals in produtos.items():
        quantidade = vals["quantidade"]
        faturamento = vals["faturamento"]
        forecast_qtd = vals.get("forecast", 0.0)
        orcado_qtd = vals.get("orcado", 0.0)
        produtos_lista.append({
            "produto": produto_cod or "-",
            "descricao": vals["descricao"] or "-",
            "grupo": vals["grupo"] or "-",
            "linha": vals["linha"] or "Não classificado",
            "faturamento": round(faturamento, 2),
            "quantidade": round(quantidade, 2),
            "forecast": round(forecast_qtd, 2),
            "orcado": round(orcado_qtd, 2),
            "delta_forecast": round(quantidade - forecast_qtd, 2),
            "delta_orcado": round(quantidade - orcado_qtd, 2),
            "atingimento_forecast_pct": round((quantidade / forecast_qtd * 100) if forecast_qtd > 0 else 0.0, 2),
            "atingimento_orcado_pct": round((quantidade / orcado_qtd * 100) if orcado_qtd > 0 else 0.0, 2),
            "preco_medio": round(faturamento / quantidade, 2) if quantidade > 0 else 0.0,
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((faturamento / total_valor * 100) if total_valor > 0 else 0.0, 2),
        })
    produtos_lista_completa = sorted(produtos_lista, key=lambda x: (x["faturamento"], x.get("forecast", 0), x.get("orcado", 0)), reverse=True)
    produtos_lista = produtos_lista_completa[:300]

    meses_lista = []
    for mes in range(1, 13):
        vals = meses[mes]
        valor = vals["valor"]
        qtd = vals["quantidade"]
        forecast_mes = vals.get("forecast", 0.0)
        orcado_mes = vals.get("orcado", 0.0)
        meses_lista.append({
            "mes": mes,
            "mes_nome": MESES[mes],
            "faturamento": round(valor, 2),
            "quantidade": round(qtd, 2),
            "forecast": round(forecast_mes, 2),
            "orcado": round(orcado_mes, 2),
            "faturamento_ano_anterior": round(meses_ano_anterior[mes]["faturamento"], 2),
            "quantidade_ano_anterior": round(meses_ano_anterior[mes]["quantidade"], 2),
            "delta_faturamento_ano_anterior": round(valor - meses_ano_anterior[mes]["faturamento"], 2),
            "delta_forecast": round(qtd - forecast_mes, 2),
            "delta_orcado": round(qtd - orcado_mes, 2),
            "atingimento_forecast_pct": round((qtd / forecast_mes * 100) if forecast_mes > 0 else 0.0, 2),
            "atingimento_orcado_pct": round((qtd / orcado_mes * 100) if orcado_mes > 0 else 0.0, 2),
            "clientes": len(vals["clientes"]),
            "produtos": len(vals["produtos"]),
            "preco_medio": round(valor / qtd, 2) if qtd > 0 else 0.0,
        })

    linhas_lista = sorted([
        {
            "linha": linha or "Não classificado",
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "clientes": len(vals["clientes"]),
            "produtos": len(vals["produtos"]),
            "participacao_valor_pct": round((vals["faturamento"] / total_valor * 100) if total_valor > 0 else 0.0, 2),
        }
        for linha, vals in linhas.items()
    ], key=lambda x: x["faturamento"], reverse=True)

    estados_lista = sorted([
        {
            "estado": estado or "Não informado",
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["faturamento"] / total_valor * 100) if total_valor > 0 else 0.0, 2),
        }
        for estado, vals in estados.items()
    ], key=lambda x: x["faturamento"], reverse=True)[:30]

    paises_lista = sorted([
        {
            "pais": pais or "Não informado",
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["faturamento"] / total_valor * 100) if total_valor > 0 else 0.0, 2),
            "confianca_baixa": vals.get("confianca_baixa", 0),
        }
        for pais, vals in paises.items()
    ], key=lambda x: x["faturamento"], reverse=True)[:30]

    tipos_clientes_lista = sorted([
        {
            "tipo_cliente": tipo or "Não informado",
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["faturamento"] / total_valor * 100) if total_valor > 0 else 0.0, 2),
        }
        for tipo, vals in tipos_clientes.items()
    ], key=lambda x: x["faturamento"], reverse=True)

    top_cliente = clientes_lista[0] if clientes_lista else None

    def _resumo_abc_valor(itens: list[dict[str, Any]], campo_nome: str) -> list[dict[str, Any]]:
        total_itens = len(itens)
        total_base = sum(_to_float(item.get("faturamento")) for item in itens)
        acumulado_base = 0.0
        classes = {
            "A": {"classe": "A", "qtd": 0, "faturamento": 0.0, "quantidade": 0.0, "nomes": [], "detalhes": []},
            "B": {"classe": "B", "qtd": 0, "faturamento": 0.0, "quantidade": 0.0, "nomes": [], "detalhes": []},
            "C": {"classe": "C", "qtd": 0, "faturamento": 0.0, "quantidade": 0.0, "nomes": [], "detalhes": []},
        }

        for item in sorted(itens, key=lambda x: _to_float(x.get("faturamento")), reverse=True):
            valor_item = _to_float(item.get("faturamento"))
            quantidade_item = _to_float(item.get("quantidade"))
            acumulado_base += valor_item
            acumulado_pct = (acumulado_base / total_base * 100) if total_base > 0 else 0.0
            classe = _classe_abc(acumulado_pct)

            nome_item = str(
                item.get(campo_nome)
                or item.get("nome_fantasia")
                or item.get("descricao")
                or item.get("produto")
                or item.get("cliente")
                or "-"
            )
            codigo_item = str(item.get("cliente") or item.get("produto") or "").strip()

            classes[classe]["qtd"] += 1
            classes[classe]["faturamento"] += valor_item
            classes[classe]["quantidade"] += quantidade_item

            if len(classes[classe]["nomes"]) < 8:
                classes[classe]["nomes"].append(nome_item)

            if len(classes[classe]["detalhes"]) < 8:
                classes[classe]["detalhes"].append({
                    "codigo": codigo_item,
                    "nome": nome_item,
                    "descricao": str(item.get("descricao") or nome_item),
                    "faturamento": round(valor_item, 2),
                    "quantidade": round(quantidade_item, 2),
                    "participacao_faturamento_pct": round((valor_item / total_base * 100) if total_base > 0 else 0.0, 2),
                })

        saida = []
        for classe in ["A", "B", "C"]:
            vals = classes[classe]
            saida.append({
                "classe": classe,
                "qtd": vals["qtd"],
                "faturamento": round(vals["faturamento"], 2),
                "quantidade": round(vals["quantidade"], 2),
                "participacao_qtd_pct": round((vals["qtd"] / total_itens * 100) if total_itens > 0 else 0.0, 2),
                "participacao_faturamento_pct": round((vals["faturamento"] / total_base * 100) if total_base > 0 else 0.0, 2),
                "exemplos": vals["nomes"],
                "detalhes": vals["detalhes"],
            })
        return saida

    abc_clientes_valor = _resumo_abc_valor(clientes_lista, "nome_fantasia")
    abc_produtos_valor = _resumo_abc_valor(produtos_lista_completa, "descricao")

    anos_lista = []
    anos_com_dado = sorted([
        int(y) for y, vals in historico_anos.items()
        if vals["faturamento"] or vals["quantidade"] or int(y) == ano_ref
    ])
    if anos_com_dado:
        inicio_ano = max(2022, min(anos_com_dado))
        fim_ano = max(ano_ref, max(anos_com_dado))
        anos_iter = range(inicio_ano, fim_ano + 1)
    else:
        anos_iter = [ano_ref]

    ano_corrente_calendario = date.today().year
    for y in anos_iter:
        vals = historico_anos.get(int(y), {"faturamento": 0.0, "quantidade": 0.0, "registros": 0, "clientes": set(), "produtos": set(), "ultimo_mes": 0})
        ultimo_mes = int(vals.get("ultimo_mes") or 0)
        is_ytd = int(y) == ano_corrente_calendario and ultimo_mes < 12
        anos_lista.append({
            "ano": int(y),
            "ano_label": f"{int(y)} YTD" if is_ytd else str(int(y)),
            "faturamento": round(vals.get("faturamento", 0.0), 2),
            "quantidade": round(vals.get("quantidade", 0.0), 2),
            "clientes": len(vals.get("clientes", set()) or set()),
            "produtos": len(vals.get("produtos", set()) or set()),
            "registros": int(vals.get("registros", 0) or 0),
            "ultimo_mes": ultimo_mes,
            "periodo": f"YTD até {MESES.get(ultimo_mes, '')}" if is_ytd and ultimo_mes else "Ano fechado",
            "is_ytd": is_ytd,
        })

    linhas_prioritarias = [
        "ANESTÉSICO INJETÁVEL",
        "ANESTESICO INJETAVEL",
        "PPS",
        "BENZOTOP",
        "NÃO CLASSIFICADO",
        "NAO CLASSIFICADO",
    ]

    def _ordem_linha_mix(nome: str) -> tuple[int, str]:
        norm = _normaliza_texto(nome)
        if "ANEST" in norm or "INJETAVEL" in norm:
            return (0, nome)
        if "PPS" in norm:
            return (1, nome)
        if "BENZOTOP" in norm:
            return (2, nome)
        if "NAO CLASSIFICADO" in norm or "NÃO CLASSIFICADO" in nome.upper():
            return (98, nome)
        return (50, nome)

    linhas_mix_nomes = sorted({
        str(linha or "Não classificado")
        for ano_mix, linhas_mix in historico_linhas_ano.items()
        for linha in linhas_mix.keys()
    }, key=_ordem_linha_mix)

    mix_linha_ano = []
    for item_ano in anos_lista:
        y = int(item_ano["ano"])
        total_ano_linhas = sum(vals["faturamento"] for vals in historico_linhas_ano.get(y, {}).values())
        linhas_ano_lista = []
        for linha_nome in linhas_mix_nomes:
            vals_linha = historico_linhas_ano.get(y, {}).get(linha_nome, {})
            fat_linha = _to_float(vals_linha.get("faturamento"))
            qtd_linha = _to_float(vals_linha.get("quantidade"))
            linhas_ano_lista.append({
                "linha": linha_nome,
                "faturamento": round(fat_linha, 2),
                "quantidade": round(qtd_linha, 2),
                "participacao_valor_pct": round((fat_linha / total_ano_linhas * 100) if total_ano_linhas > 0 else 0.0, 2),
                "clientes": len(vals_linha.get("clientes", set()) or set()) if vals_linha else 0,
                "produtos": len(vals_linha.get("produtos", set()) or set()) if vals_linha else 0,
            })
        mix_linha_ano.append({
            "ano": y,
            "ano_label": item_ano.get("ano_label") or str(y),
            "periodo": item_ano.get("periodo") or "Ano fechado",
            "total_faturamento": round(total_ano_linhas, 2),
            "linhas": linhas_ano_lista,
        })


    # Heatmap de país estimado por ano.
    # Mantém Brasil quando existir e seleciona os países de maior relevância histórica para não virar uma tabela imensa.
    totais_paises_historico = defaultdict(float)
    for _ano_pais, mapa_paises in historico_paises_ano.items():
        for pais_nome, vals_pais in mapa_paises.items():
            totais_paises_historico[pais_nome] += _to_float(vals_pais.get("faturamento"))

    paises_com_dado = [
        pais for pais, valor in totais_paises_historico.items()
        if valor > 0 and pais and _normaliza_texto(pais) not in {"NAO INFORMADO", "NÃO INFORMADO", "-"}
    ]

    def _ordem_pais_mix(nome: str) -> tuple[int, float, str]:
        norm = _normaliza_texto(nome)
        if norm == "BRASIL":
            return (0, -totais_paises_historico.get(nome, 0.0), nome)
        if "REVISAR" in norm:
            return (98, -totais_paises_historico.get(nome, 0.0), nome)
        return (10, -totais_paises_historico.get(nome, 0.0), nome)

    paises_mix_nomes = sorted(paises_com_dado, key=_ordem_pais_mix)[:10]

    mix_pais_ano = []
    for item_ano in anos_lista:
        y = int(item_ano["ano"])
        total_ano_paises = sum(vals["faturamento"] for vals in historico_paises_ano.get(y, {}).values())
        paises_ano_lista = []
        outros_fat = 0.0
        outros_qtd = 0.0
        outros_clientes = set()
        outros_produtos = set()
        outros_confianca_baixa = 0

        for pais_nome, vals_pais in historico_paises_ano.get(y, {}).items():
            if pais_nome in paises_mix_nomes:
                continue
            outros_fat += _to_float(vals_pais.get("faturamento"))
            outros_qtd += _to_float(vals_pais.get("quantidade"))
            outros_clientes.update(vals_pais.get("clientes", set()) or set())
            outros_produtos.update(vals_pais.get("produtos", set()) or set())
            outros_confianca_baixa += int(vals_pais.get("confianca_baixa") or 0)

        for pais_nome in paises_mix_nomes:
            vals_pais = historico_paises_ano.get(y, {}).get(pais_nome, {})
            fat_pais = _to_float(vals_pais.get("faturamento"))
            qtd_pais = _to_float(vals_pais.get("quantidade"))
            paises_ano_lista.append({
                "pais": pais_nome,
                "faturamento": round(fat_pais, 2),
                "quantidade": round(qtd_pais, 2),
                "participacao_valor_pct": round((fat_pais / total_ano_paises * 100) if total_ano_paises > 0 else 0.0, 2),
                "clientes": len(vals_pais.get("clientes", set()) or set()) if vals_pais else 0,
                "produtos": len(vals_pais.get("produtos", set()) or set()) if vals_pais else 0,
                "confianca_baixa": int(vals_pais.get("confianca_baixa") or 0) if vals_pais else 0,
            })

        if outros_fat > 0:
            paises_ano_lista.append({
                "pais": "Outros países",
                "faturamento": round(outros_fat, 2),
                "quantidade": round(outros_qtd, 2),
                "participacao_valor_pct": round((outros_fat / total_ano_paises * 100) if total_ano_paises > 0 else 0.0, 2),
                "clientes": len(outros_clientes),
                "produtos": len(outros_produtos),
                "confianca_baixa": outros_confianca_baixa,
            })

        mix_pais_ano.append({
            "ano": y,
            "ano_label": item_ano.get("ano_label") or str(y),
            "periodo": item_ano.get("periodo") or "Ano fechado",
            "total_faturamento": round(total_ano_paises, 2),
            "paises": paises_ano_lista,
        })

    media_pre_ped, mediana_pre_ped = _media_mediana(dias_preped_ped)
    media_pre, mediana_pre = _media_mediana(dias_preped_fat)
    media_ped, mediana_ped = _media_mediana(dias_ped_fat)
    total_ciclo_registros = len(dias_preped_fat)

    ciclo_aging_ordem = ["0 a 7 dias", "8 a 15 dias", "16 a 30 dias", "31 a 60 dias", "Acima de 60 dias", "Sem data"]
    ciclo_aging_lista = []
    for bucket in ciclo_aging_ordem:
        vals = ciclo_aging.get(bucket)
        if not vals:
            continue
        ciclo_aging_lista.append({
            "faixa": bucket,
            "registros": vals["registros"],
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "participacao_valor_pct": round((vals["faturamento"] / faturamento_com_prepedido * 100) if faturamento_com_prepedido > 0 else 0.0, 2),
        })

    ciclo_origem_lista = sorted([
        {
            "origem": origem,
            "registros": vals["registros"],
            "faturamento": round(vals["faturamento"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "participacao_valor_pct": round((vals["faturamento"] / faturamento_com_prepedido * 100) if faturamento_com_prepedido > 0 else 0.0, 2),
        }
        for origem, vals in ciclo_origem.items()
    ], key=lambda x: x["faturamento"], reverse=True)

    atendimento_mensal_lista = []
    for mes in range(1, 13):
        vals = atendimento_mensal[mes]
        demanda_mes = vals["demanda_mes_valor"]
        faturado_mesmo_mes = vals["faturamento_prepedido_mesmo_mes"]
        em_aberto_hoje = vals["carteira_pendente_mes_valor"]
        atendimento_pct = (faturado_mesmo_mes / demanda_mes * 100) if demanda_mes > 0 else 0.0
        atendimento_mensal_lista.append({
            "mes": mes,
            "mes_nome": MESES[mes],
            # Mantém os nomes antigos para compatibilidade com o front,
            # mas agora o conceito é demanda identificada no mês.
            "prepedidos_emitidos_valor": round(demanda_mes, 2),
            "prepedidos_emitidos_quantidade": round(vals["demanda_mes_quantidade"], 2),
            "prepedidos_emitidos": len(vals["prepedidos_demanda"]),
            "clientes_entrada": len(vals["clientes_entrada"]),
            "faturamento_total": round(vals["faturamento_total"], 2),
            "faturamento_quantidade": round(vals["faturamento_quantidade"], 2),
            "faturamento_prepedido_mesmo_mes": round(faturado_mesmo_mes, 2),
            "faturamento_carteira_anterior": round(vals["faturamento_carteira_anterior"], 2),
            "faturamento_sem_classificacao": round(vals["faturamento_sem_classificacao"], 2),
            "saldo_nao_atendido_estimado": round(em_aberto_hoje, 2),
            "atendimento_mes_pct": round(min(max(atendimento_pct, 0.0), 100.0), 2),
        })

    pendentes_status_lista = sorted([
        {
            "status": status,
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
        }
        for status, vals in pendentes_status.items()
    ], key=lambda x: x["valor"], reverse=True)

    bucket_ordem = {nome: idx for idx, nome in enumerate(["0 a 7 dias", "8 a 15 dias", "16 a 30 dias", "31 a 60 dias", "Acima de 60 dias", "Sem data"])}
    pendentes_aging_lista = sorted([
        {
            "faixa": faixa,
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
        }
        for faixa, vals in pendentes_aging.items()
    ], key=lambda x: bucket_ordem.get(x["faixa"], 99))

    pendentes_mes_emissao_lista = sorted([
        {
            "mes": mes_label,
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "clientes": len([c for c in vals["clientes"] if c]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
            "ordem": vals.get("ordem", 999),
        }
        for mes_label, vals in pendentes_mes_emissao.items()
    ], key=lambda x: x.get("ordem", 999))

    faturamento_origem_mensal_lista = []
    for mes in range(1, 13):
        vals = atendimento_mensal[mes]
        faturamento_total_mes = vals["faturamento_total"]
        carteira_anterior_mes = vals["faturamento_carteira_anterior"]
        mesmo_mes = vals["faturamento_prepedido_mesmo_mes"]
        sem_classificacao = vals["faturamento_sem_classificacao"]
        faturamento_origem_mensal_lista.append({
            "mes": mes,
            "mes_nome": MESES[mes],
            "faturamento_total": round(faturamento_total_mes, 2),
            "faturamento_prepedido_mesmo_mes": round(mesmo_mes, 2),
            "faturamento_carteira_anterior": round(carteira_anterior_mes, 2),
            "faturamento_sem_classificacao": round(sem_classificacao, 2),
            "pct_carteira_anterior": round((carteira_anterior_mes / faturamento_total_mes * 100) if faturamento_total_mes > 0 else 0.0, 2),
            "pct_prepedido_mesmo_mes": round((mesmo_mes / faturamento_total_mes * 100) if faturamento_total_mes > 0 else 0.0, 2),
        })

    pendentes_entrega_lista = sorted([
        {
            "status": status,
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
        }
        for status, vals in pendentes_entrega.items()
    ], key=lambda x: x["valor"], reverse=True)

    pendentes_clientes_lista = sorted([
        {
            "cliente": cliente or "-",
            "nome": vals["nome"] or "Sem cliente",
            "estado": vals["estado"] or "Não informado",
            "pais_estimado": vals["pais_estimado"] or "Não informado",
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "produtos": len(vals["produtos"]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
        }
        for cliente, vals in pendentes_clientes.items()
    ], key=lambda x: x["valor"], reverse=True)[:50]

    pendentes_produtos_lista = sorted([
        {
            "produto": produto or "-",
            "descricao": vals["descricao"] or "-",
            "linha": vals["linha"] or "Não classificado",
            "grupo": vals["grupo"] or "-",
            "valor": round(vals["valor"], 2),
            "quantidade": round(vals["quantidade"], 2),
            "prepedidos": len(vals["prepedidos"]),
            "clientes": len(vals["clientes"]),
            "participacao_valor_pct": round((vals["valor"] / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
        }
        for produto, vals in pendentes_produtos.items()
    ], key=lambda x: x["valor"], reverse=True)[:80]

    return {
        "ano": ano,
        "bloco": escopo,
        "escopo_label": _label_escopo(escopo),
        "cards": {
            "faturamento_total": round(total_valor, 2),
            "quantidade_total": round(total_qtd, 2),
            "forecast_total": round(total_forecast, 2),
            "orcado_total": round(total_orcado, 2),
            "delta_forecast": round(total_qtd - total_forecast, 2),
            "delta_orcado": round(total_qtd - total_orcado, 2),
            "atingimento_forecast_pct": round((total_qtd / total_forecast * 100) if total_forecast > 0 else 0.0, 2),
            "atingimento_orcado_pct": round((total_qtd / total_orcado * 100) if total_orcado > 0 else 0.0, 2),
            "clientes_ativos": clientes_ativos,
            "produtos_ativos": produtos_ativos,
            "ticket_medio_cliente": round(total_valor / clientes_ativos, 2) if clientes_ativos > 0 else 0.0,
            "preco_medio": round(total_valor / total_qtd, 2) if total_qtd > 0 else 0.0,
            "registros": total_registros,
            "top_cliente_nome": top_cliente["nome_fantasia"] if top_cliente else "-",
            "top_cliente_participacao_pct": top_cliente["participacao_valor_pct"] if top_cliente else 0.0,
            "media_dias_preped_pedido": round(media_pre_ped, 1),
            "mediana_dias_preped_pedido": round(mediana_pre_ped, 1),
            "media_dias_preped_faturamento": round(media_pre, 1),
            "mediana_dias_preped_faturamento": round(mediana_pre, 1),
            "media_dias_pedido_faturamento": round(media_ped, 1),
            "mediana_dias_pedido_faturamento": round(mediana_ped, 1),
            "pct_faturado_ate_7_dias": round((len([d for d in dias_preped_fat if d <= 7]) / total_ciclo_registros * 100) if total_ciclo_registros > 0 else 0.0, 2),
            "pct_faturado_acima_30_dias": round((len([d for d in dias_preped_fat if d > 30]) / total_ciclo_registros * 100) if total_ciclo_registros > 0 else 0.0, 2),
            "faturamento_com_prepedido": round(faturamento_com_prepedido, 2),
            "faturamento_prepedido_mesmo_mes": round(faturamento_prepedido_mesmo_mes, 2),
            "faturamento_prepedido_mes_anterior": round(faturamento_prepedido_mes_anterior, 2),
            "faturamento_prepedido_fim_mes": round(faturamento_prepedido_fim_mes, 2),
            "pct_faturamento_prepedido_fim_mes": round((faturamento_prepedido_fim_mes / faturamento_com_prepedido * 100) if faturamento_com_prepedido > 0 else 0.0, 2),
            "carteira_pendente_valor": round(carteira_valor, 2),
            "carteira_pendente_quantidade": round(carteira_qtd, 2),
            "prepedidos_pendentes": len(carteira_prepedidos),
            "clientes_pendentes": len([c for c in carteira_clientes if c]),
            "produtos_pendentes": len([p for p in carteira_produtos if p]),
            "carteira_vencida_valor": round(carteira_vencida_valor, 2),
            "carteira_vencida_quantidade": round(carteira_vencida_qtd, 2),
            "pct_carteira_vencida_valor": round((carteira_vencida_valor / carteira_valor * 100) if carteira_valor > 0 else 0.0, 2),
            "registros_faturados_base": len(faturados_rows),
            "registros_prepedidos_pendentes_base": len(pendentes_rows),
            "registros_prepedidos_emitidos_base": len(emitidos_rows),
        },
        "meses": meses_lista,
        "anos": anos_lista,
        "clientes": clientes_lista[:1000],
        "produtos": produtos_lista,
        "linhas": linhas_lista,
        "estados": estados_lista,
        "paises": paises_lista,
        "tipos_clientes": tipos_clientes_lista,
        "abc_clientes_valor": abc_clientes_valor,
        "abc_produtos_valor": abc_produtos_valor,
        "mix_linha_ano": mix_linha_ano,
        "mix_pais_ano": mix_pais_ano,
        "ciclo_aging": ciclo_aging_lista,
        "ciclo_origem": ciclo_origem_lista,
        "atendimento_mensal": atendimento_mensal_lista,
        "faturamento_origem_mensal": faturamento_origem_mensal_lista,
        "entrada_prepedidos_dia_mes": entrada_prepedidos_dia_mes,
        "pendentes_status": pendentes_status_lista,
        "pendentes_aging": pendentes_aging_lista,
        "pendentes_mes_emissao": pendentes_mes_emissao_lista,
        "pendentes_entrega": pendentes_entrega_lista,
        "pendentes_clientes": pendentes_clientes_lista,
        "pendentes_produtos": pendentes_produtos_lista,
        "meta": {
            "join_clientes": "d_clientes" if dim_clientes else "sem dimensão de clientes",
            "qtd_clientes_dimensao": len(dim_clientes),
            "observacao": "Join por código do cliente. País é estimado a partir da dClientes para registros com Estado EX/exportação.",
            "produto_filtro": produto_filtro,
            "fonte_faturamento": fonte_faturamento,
            "fonte_pedidos": "f_faturados.emissao_preped/emissao_ped" if usando_faturados else "indisponível sem f_faturados",
            "fonte_carteira_pendente": "f_prepedidos_pendentes" if pendentes_rows else "sem base carregada",
            "entrada_prepedidos_debug": entrada_prepedidos_debug,
        },
    }


@router.get("/entrada-prepedidos-heatmap")
def entrada_prepedidos_heatmap(
    ano: int = Query(2026),
):
    emitidos_rows = _select_all_safe(["f_prepedidos_emitidos"])
    matriz, debug = _montar_entrada_prepedidos_dia_mes(emitidos_rows, int(ano))

    return {
        "ano": int(ano),
        "entrada_prepedidos_dia_mes": matriz,
        "debug": debug,
    }


# ─────────────────────────────────────────────────────────────
# Cache persistente do Faturamento
# ─────────────────────────────────────────────────────────────
# Usa a tabela cache_overview já existente como cache genérico do app:
#   chave text primary key
#   versao_base text
#   payload jsonb
#   atualizado_em timestamptz

FATURAMENTO_CACHE_LOGIC_VERSION = "faturamento-cache-v201-heatmap-emitidos"

FATURAMENTO_CACHE_BASES = [
    "sd2_saidas",
    "faturados",
    "prepedidos_pendentes",
    "prepedidos_emitidos",
    "forecast_sop",
    "orcado_faturamento",
    "d_clientes",
    "d_produtos",
]


def _faturamento_produto_cache(produto: Any) -> str:
    texto = str(produto or "").strip()
    if not texto:
        return ""

    texto = _normaliza_texto(texto).lower()
    texto = re.sub(r"\s+", " ", texto)

    return texto[:140]


def _faturamento_produto_hash(produto: str) -> str:
    if not produto:
        return "sem_produto"

    digest = hashlib.md5(produto.encode("utf-8")).hexdigest()[:10]
    return f"produto_{digest}"


def _faturamento_bloco_cache(bloco: Any) -> str:
    texto = _normaliza_texto(bloco).replace(" ", "_")
    if texto in {"", "TODOS", "ALL"}:
        return "TODOS"
    if texto in {"ANESTESICOS", "ANESTESICOS_INJETAVEIS"}:
        return "ANESTESICOS"
    if texto == "PPS":
        return "PPS"
    if texto == "BRAVI":
        return "BRAVI"
    return "TODOS"


def _faturamento_upload_versions() -> dict[str, str | None]:
    try:
        res = (
            supabase.table("upload_log")
            .select("base_id, processado_em, status")
            .eq("status", "sucesso")
            .order("processado_em", desc=True)
            .limit(500)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []

    latest: dict[str, str | None] = {base: None for base in FATURAMENTO_CACHE_BASES}

    for row in rows:
        base_id = str(row.get("base_id") or "").strip()
        if base_id not in latest:
            continue
        if latest[base_id]:
            continue

        latest[base_id] = str(row.get("processado_em") or "") or None

    return latest


def _faturamento_cache_chave(
    ano: int | None = None,
    bloco: Any = "TODOS",
    produto: Any = None,
) -> str:
    ano_ref = int(ano or date.today().year)
    bloco_norm = _faturamento_bloco_cache(bloco)
    produto_norm = _faturamento_produto_cache(produto)
    produto_key = _faturamento_produto_hash(produto_norm)

    return f"faturamento_{ano_ref}_{bloco_norm}_{produto_key}"


def _faturamento_cache_version(
    ano: int | None = None,
    bloco: Any = "TODOS",
    produto: Any = None,
) -> tuple[str, dict[str, str | None]]:
    ano_ref = int(ano or date.today().year)
    bloco_norm = _faturamento_bloco_cache(bloco)
    produto_norm = _faturamento_produto_cache(produto)
    versions = _faturamento_upload_versions()

    partes = [
        FATURAMENTO_CACHE_LOGIC_VERSION,
        f"ano:{ano_ref}",
        f"bloco:{bloco_norm}",
        f"produto:{_faturamento_produto_hash(produto_norm)}",
    ]

    for base_id in FATURAMENTO_CACHE_BASES:
        partes.append(f"{base_id}:{versions.get(base_id) or '-'}")

    return "|".join(partes), versions


def _faturamento_ultima_atualizacao(versions: dict[str, str | None]) -> str | None:
    datas = [v for v in versions.values() if v]
    return max(datas) if datas else None


def _read_cache_faturamento(chave: str) -> dict[str, Any] | None:
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


def _write_cache_faturamento(chave: str, payload: dict[str, Any], versao_base: str) -> dict[str, Any]:
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


async def recalcular_cache_faturamento(
    ano: int | None = None,
    bloco: str = "TODOS",
    produto: str | None = None,
) -> dict[str, Any]:
    ano_ref = int(ano or date.today().year)
    bloco_norm = _faturamento_bloco_cache(bloco)
    produto_norm = _faturamento_produto_cache(produto)

    chave = _faturamento_cache_chave(ano_ref, bloco_norm, produto_norm)
    versao_base, versions = _faturamento_cache_version(ano_ref, bloco_norm, produto_norm)

    payload = resumo_faturamento(
        ano=ano_ref,
        bloco=bloco_norm,
        produto=produto_norm or None,
    )

    if not isinstance(payload, dict):
        payload = dict(payload)

    registro = _write_cache_faturamento(chave, payload, versao_base)

    return {
        "chave": chave,
        "ano": ano_ref,
        "bloco": bloco_norm,
        "produto": produto_norm or None,
        "versao_base": versao_base,
        "from_cache": False,
        "atualizado_em": registro.get("atualizado_em"),
        "ultima_atualizacao": _faturamento_ultima_atualizacao(versions),
        "payload": payload,
    }


async def recalcular_caches_faturamento_padrao(
    ano: int | None = None,
) -> dict[str, Any]:
    ano_ref = int(ano or date.today().year)
    resultados: dict[str, Any] = {}

    # Cache padrão da tela inicial. Filtros específicos são calculados sob demanda.
    for bloco in ["TODOS"]:
        try:
            resultados[bloco] = await recalcular_cache_faturamento(
                ano=ano_ref,
                bloco=bloco,
                produto=None,
            )
        except Exception as e:
            resultados[bloco] = {
                "status": "erro",
                "detail": str(e)[:300],
            }

    return {
        "status": "ok",
        "ano": ano_ref,
        "resultados": resultados,
    }


@router.get("/cache/versao")
async def get_faturamento_cache_versao(
    ano: int | None = Query(default=None),
    bloco: str = Query(default="TODOS"),
    produto: str | None = Query(default=None),
):
    ano = ano or date.today().year
    bloco_norm = _faturamento_bloco_cache(bloco)
    produto_norm = _faturamento_produto_cache(produto)
    chave = _faturamento_cache_chave(ano, bloco_norm, produto_norm)
    versao_base, versions = _faturamento_cache_version(ano, bloco_norm, produto_norm)
    cache = _read_cache_faturamento(chave)

    return {
        "chave": chave,
        "ano": int(ano),
        "bloco": bloco_norm,
        "produto": produto_norm or None,
        "versao_base": versao_base,
        "cache_disponivel": bool(cache and cache.get("versao_base") == versao_base),
        "cache_versao": cache.get("versao_base") if cache else None,
        "cache_atualizado_em": cache.get("atualizado_em") if cache else None,
        "ultima_atualizacao": _faturamento_ultima_atualizacao(versions),
        "bases": versions,
    }


@router.get("/cache")
async def get_faturamento_cache(
    ano: int | None = Query(default=None),
    bloco: str = Query(default="TODOS"),
    produto: str | None = Query(default=None),
    force: bool = Query(default=False),
):
    ano = ano or date.today().year
    bloco_norm = _faturamento_bloco_cache(bloco)
    produto_norm = _faturamento_produto_cache(produto)

    chave = _faturamento_cache_chave(ano, bloco_norm, produto_norm)
    versao_base, versions = _faturamento_cache_version(ano, bloco_norm, produto_norm)
    cache = _read_cache_faturamento(chave)

    if (
        not force
        and cache
        and cache.get("versao_base") == versao_base
        and cache.get("payload") is not None
    ):
        return {
            "chave": chave,
            "ano": int(ano),
            "bloco": bloco_norm,
            "produto": produto_norm or None,
            "versao_base": versao_base,
            "from_cache": True,
            "atualizado_em": cache.get("atualizado_em"),
            "ultima_atualizacao": _faturamento_ultima_atualizacao(versions),
            "payload": cache.get("payload"),
        }

    return await recalcular_cache_faturamento(
        ano=int(ano),
        bloco=bloco_norm,
        produto=produto_norm or None,
    )


@router.post("/cache/recalcular")
async def post_faturamento_cache_recalcular(
    ano: int | None = Query(default=None),
    bloco: str = Query(default="TODOS"),
    produto: str | None = Query(default=None),
):
    ano = ano or date.today().year
    return await recalcular_cache_faturamento(
        ano=ano,
        bloco=bloco,
        produto=produto,
    )


@router.post("/cache/recalcular-padrao")
async def post_faturamento_cache_recalcular_padrao(
    ano: int | None = Query(default=None),
):
    ano = ano or date.today().year
    return await recalcular_caches_faturamento_padrao(ano=ano)