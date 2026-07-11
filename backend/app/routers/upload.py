from fastapi import APIRouter, Query, HTTPException, UploadFile, File, BackgroundTasks
from app.database import supabase
from pydantic import BaseModel
from typing import Any
import io
import uuid
import re
import pandas as pd
from datetime import date, datetime, timedelta

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
    process_mps_producao_file,
    process_mps_liberacoes_file,
    process_bom_estrutura,
    process_lotes_teoricos,
    process_estoque_saldo,
    process_programacao_ops,
    process_liberacoes_previstas_sku,
    process_apontamentos,
    process_liberacao_diaria,
    process_compras_abertas,
    process_compras_fup,
    process_calendario_paradas,
    process_consumo_materiais,
    process_mrp_demanda,
    process_desvios_lotes,
    process_parametros_estoque,
    process_lead_time_estoque,
    process_qtd_minima_estoque,
    process_custo_unitario,
    process_d_clientes,
)

router = APIRouter(prefix="/upload", tags=["upload"])

BASES = {
    "d_produtos":          (process_d_produtos,          0, 0,    None),
    "d_clientes":          (process_d_clientes,          0, 0,    None),
    "orcado_liberacao":    (process_orcado_liberacao,    0, 0,    None),
    "orcado_faturamento":  (process_orcado_faturamento,  0, 0,    None),
    "forecast_sop":        (process_forecast_sop,        0, 0,    None),
    "sd2_saidas":          (process_sd2_saidas,          0, 2,    ["Produto", "Quantidade", "Armazem", "Grupo"]),
    "sd3_entradas":        (process_sd3_entradas,        0, 2,    ["Produto", "Quantidade", "Armazem", "Grupo"]),
    "estoque":             (process_estoque,             0, 2,    ["Produto", "Armazem", "Data Saldo"]),
    "producao_real":       (process_producao_real,       0, 0,    None),
    "entradas_previstas":  (process_entradas_previstas,  0, None, None),
}

BASES_ESPECIAIS = {
    "mps_producao":              process_mps_producao_file,
    "mps_liberacoes":            process_mps_liberacoes_file,
    "bom_estrutura":             process_bom_estrutura,
    "lotes_teoricos":            process_lotes_teoricos,
    "d_lotes_teoricos":          process_lotes_teoricos,
    "estoque_saldo":             process_estoque_saldo,
    "programacao_ops":           process_programacao_ops,
    "liberacoes_previstas_sku":  process_liberacoes_previstas_sku,
    "apontamentos":              process_apontamentos,
    "liberacao_diaria":          process_liberacao_diaria,
    "desvios_lotes":             process_desvios_lotes,
    "compras_abertas":           process_compras_abertas,
    "compras_fup":                process_compras_fup,
    "followup_compras":           process_compras_fup,
    "fup_compras":                process_compras_fup,
    "calendario_paradas":        process_calendario_paradas,
    "consumo_materiais":         process_consumo_materiais,
    "mrp_demanda":               process_mrp_demanda,

    "parametros_estoque":         process_parametros_estoque,
    "leadtime_moq":               process_parametros_estoque,
    "lead_time_moq":              process_parametros_estoque,

    "lead_time_estoque":          process_lead_time_estoque,
    "d_lead_time_estoque":        process_lead_time_estoque,
    "qtd_minima_estoque":         process_qtd_minima_estoque,
    "d_qtd_minima_estoque":       process_qtd_minima_estoque,

    "custo_unitario":             process_custo_unitario,
    "d_custo_unitario":           process_custo_unitario,
}


# ─────────────────────────────────────────────────────────────
# Helpers gerais
# ─────────────────────────────────────────────────────────────

def _detectar_header(conteudo, sheet, default_header, colunas_chave):
    if default_header is None:
        return None

    if not colunas_chave:
        return default_header

    melhor_h = None
    melhor_match = 0

    for h in range(0, 8):
        try:
            df_test = pd.read_excel(
                io.BytesIO(conteudo),
                sheet_name=sheet,
                header=h,
                nrows=0,
            )

            cols = [str(c).strip() for c in df_test.columns]

            n_match = sum(
                1 for chave in colunas_chave
                if any(chave == c for c in cols)
            )

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


def _ler_excel(conteudo, sheet, header):
    return pd.read_excel(
        io.BytesIO(conteudo),
        sheet_name=sheet,
        header=header,
    )


def _arquivo_parece_fup_compras(conteudo: bytes, filename: str | None = None) -> bool:
    """
    Detecta a planilha de reunião/FUP de compras.

    Isso permite que, se o usuário subir a planilha da reunião Supply no card
    antigo de Compras em Aberto, o backend grave a camada f_compras_fup em vez
    de tentar processar como RELPC/Protheus.
    """
    nome = str(filename or "").lower()
    if not nome.endswith((".xlsx", ".xlsm", ".xls")):
        return False

    def norm_col(value: Any) -> str:
        texto = str(value or "").strip().upper()
        texto = (
            texto.replace("Á", "A")
            .replace("À", "A")
            .replace("Â", "A")
            .replace("Ã", "A")
            .replace("É", "E")
            .replace("Ê", "E")
            .replace("Í", "I")
            .replace("Ó", "O")
            .replace("Ô", "O")
            .replace("Õ", "O")
            .replace("Ú", "U")
            .replace("Ç", "C")
        )
        for ch in [" ", ".", "-", "_", "/"]:
            texto = texto.replace(ch, "")
        return texto

    try:
        excel = pd.ExcelFile(io.BytesIO(conteudo))
    except Exception:
        return False

    abas_detalhes = [aba for aba in excel.sheet_names if str(aba or "").strip().lower().replace(" ", "").startswith("detalhes")]
    if not abas_detalhes:
        return False

    for aba in abas_detalhes:
        for h in range(0, 15):
            try:
                df_test = pd.read_excel(io.BytesIO(conteudo), sheet_name=aba, header=h, nrows=0)
                cols = {norm_col(c) for c in df_test.columns}
                tem_produto = "PRODUTOCODIGO" in cols
                tem_pedido = "PEDIDONUMERO" in cols or "SCNUMERO" in cols
                tem_comentario = "COLUNA1" in cols or "COMENTARIOFUP" in cols or "COMENTARIO" in cols
                if tem_produto and tem_pedido and tem_comentario:
                    return True
            except Exception:
                continue

    return False


def _normalizar_nome_coluna(value: Any) -> str:
    texto = str(value or "").strip().upper()
    texto = (
        texto.replace("Á", "A")
        .replace("À", "A")
        .replace("Â", "A")
        .replace("Ã", "A")
        .replace("É", "E")
        .replace("Ê", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ô", "O")
        .replace("Õ", "O")
        .replace("Ú", "U")
        .replace("Ç", "C")
    )
    texto = texto.replace("_", " ")
    texto = " ".join(texto.split())
    return texto


def _parse_data_apontamento(value: Any):
    """
    Converte a DATA INICIAL do relatório Cogtive.

    O arquivo pode vir assim:
      - datetime do Excel;
      - serial Excel com decimal, exemplo 46024.6550462963;
      - texto em formato brasileiro/ISO.

    Retorna datetime ou None.
    """
    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.to_pydatetime()

    if isinstance(value, datetime):
        return value

    # Excel serial date.
    if isinstance(value, (int, float)):
        try:
            numero = float(value)
            # Intervalo amplo para datas Excel modernas.
            if 20000 <= numero <= 70000:
                return pd.to_datetime(numero, unit="D", origin="1899-12-30").to_pydatetime()
        except Exception:
            return None

    texto = str(value).strip()

    if not texto:
        return None

    # String numérica serial Excel.
    try:
        numero = float(texto.replace(",", "."))
        if 20000 <= numero <= 70000:
            return pd.to_datetime(numero, unit="D", origin="1899-12-30").to_pydatetime()
    except Exception:
        pass

    # ISO / BR / formatos comuns.
    try:
        dt = pd.to_datetime(texto, dayfirst=True, errors="coerce")
        if pd.isna(dt):
            return None
        return dt.to_pydatetime()
    except Exception:
        return None


def _ler_dataframe_apontamentos_para_detectar_periodo(conteudo: bytes, filename: str) -> pd.DataFrame:
    """
    Lê o arquivo de apontamentos encontrando automaticamente a linha real do cabeçalho.

    O relatório Cogtive vem com linhas de título antes da tabela, por exemplo:
      RELATÓRIO DE APONTAMENTOS
      ...
      ID | DATA INICIAL | DATA FINAL | EQUIPAMENTO | ...

    Por isso NÃO podemos usar header=0 fixo.
    """
    nome = str(filename or "").lower()

    if nome.endswith(".csv"):
        try:
            df_csv = pd.read_csv(io.BytesIO(conteudo), sep=None, engine="python")
        except Exception:
            df_csv = pd.read_csv(io.BytesIO(conteudo), sep=";")

        # CSV normalmente já vem sem título acima, mas mantemos fallback.
        return df_csv

    def _score_colunas(cols) -> int:
        cols_norm = {_normalizar_nome_coluna(c) for c in cols}
        obrigatorias = {
            "DATA INICIAL",
            "DATA FINAL",
            "EQUIPAMENTO",
            "LOTE",
            "PRODUTO",
            "SKU",
            "QUANTIDADE PRODUZIDA",
            "TIPO DE EVENTO",
        }
        return sum(1 for c in obrigatorias if c in cols_norm)

    melhor_df = None
    melhor_score = -1
    melhor_header = None

    # O relatório costuma ter o cabeçalho por volta da linha 6,
    # mas deixamos flexível para evitar quebrar com exportações diferentes.
    for h in range(0, 20):
        try:
            df_test = pd.read_excel(
                io.BytesIO(conteudo),
                sheet_name=0,
                header=h,
                nrows=0,
            )

            score = _score_colunas(df_test.columns)

            if score > melhor_score:
                melhor_score = score
                melhor_header = h

            if score >= 5:
                melhor_df = pd.read_excel(
                    io.BytesIO(conteudo),
                    sheet_name=0,
                    header=h,
                )
                break

        except Exception:
            continue

    if melhor_df is not None:
        return melhor_df

    # Fallback adicional: procura uma linha que contenha LOTE e DATA INICIAL.
    try:
        bruto = pd.read_excel(
            io.BytesIO(conteudo),
            sheet_name=0,
            header=None,
            nrows=30,
        )

        for idx, row in bruto.iterrows():
            valores = [_normalizar_nome_coluna(v) for v in row.tolist()]
            if "LOTE" in valores and "DATA INICIAL" in valores:
                return pd.read_excel(
                    io.BytesIO(conteudo),
                    sheet_name=0,
                    header=int(idx),
                )
    except Exception:
        pass

    # Último fallback para manter a mensagem de erro explicativa.
    return pd.read_excel(io.BytesIO(conteudo), sheet_name=0, header=melhor_header or 0)


def _detectar_periodos_apontamentos(conteudo: bytes, filename: str) -> dict:
    """
    Detecta os meses presentes no arquivo de apontamentos.

    Não usa DATA INICIO, porque essa coluna não existe no arquivo atual.
    A referência oficial é DATA INICIAL.
    """
    try:
        df = _ler_dataframe_apontamentos_para_detectar_periodo(conteudo, filename)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Não foi possível ler o arquivo de apontamentos: {str(e)[:250]}",
        )

    if df.empty:
        raise HTTPException(status_code=422, detail="Arquivo de apontamentos vazio.")

    colunas_norm = {_normalizar_nome_coluna(c): c for c in df.columns}

    candidatos_data = [
        "DATA INICIAL",
        "DATA INICIAL ",
        "DATA HORA INICIAL",
        "INICIO",
        "DATA",
    ]

    coluna_data = None
    for candidato in candidatos_data:
        col = colunas_norm.get(_normalizar_nome_coluna(candidato))
        if col is not None:
            coluna_data = col
            break

    if coluna_data is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Não encontrei a coluna DATA INICIAL no arquivo de apontamentos mesmo tentando localizar o cabeçalho nas primeiras 20 linhas. "
                f"Colunas encontradas: {', '.join(str(c) for c in list(df.columns)[:20])}"
            ),
        )

    datas = []
    for value in df[coluna_data].dropna().tolist():
        dt = _parse_data_apontamento(value)
        if dt:
            datas.append(dt)

    if not datas:
        raise HTTPException(
            status_code=422,
            detail="Encontrei a coluna DATA INICIAL, mas não consegui interpretar nenhuma data válida.",
        )

    meses = sorted({(dt.year, dt.month) for dt in datas})

    return {
        "coluna_data": str(coluna_data),
        "meses": meses,
        "primeira_data": min(datas).date().isoformat(),
        "ultima_data": max(datas).date().isoformat(),
        "linhas_arquivo": int(len(df)),
        "datas_validas": int(len(datas)),
    }


def _inicio_fim_mes(ano: int, mes: int) -> tuple[date, date]:
    inicio = date(int(ano), int(mes), 1)

    if int(mes) == 12:
        fim = date(int(ano) + 1, 1, 1)
    else:
        fim = date(int(ano), int(mes) + 1, 1)

    return inicio, fim


def _excel_serial(date_value: date) -> float:
    return float((pd.Timestamp(date_value) - pd.Timestamp("1899-12-30")).days)


def _delete_apontamentos_mes(ano: int, mes: int) -> dict:
    """
    Remove somente os apontamentos do mês identificado no arquivo.

    Principal filtro: data_inicial em formato data/timestamp.
    Fallback: data_inicial em serial Excel, caso algum upload antigo tenha salvo assim.
    """
    inicio, fim = _inicio_fim_mes(ano, mes)
    removidos_estimado = 0
    erros_delete = []

    # 1) Formato normal: data_inicial timestamp/date/texto ISO.
    try:
        res = (
            supabase.table("f_apontamentos")
            .delete()
            .gte("data_inicial", inicio.isoformat())
            .lt("data_inicial", fim.isoformat())
            .execute()
        )
        removidos_estimado += len(res.data or [])
    except Exception as e:
        erros_delete.append(f"delete_iso: {str(e)[:180]}")

    # 2) Fallback para bases antigas onde data_inicial pode ter sido salvo como serial Excel.
    try:
        serial_inicio = _excel_serial(inicio)
        serial_fim = _excel_serial(fim)

        res = (
            supabase.table("f_apontamentos")
            .delete()
            .gte("data_inicial", serial_inicio)
            .lt("data_inicial", serial_fim)
            .execute()
        )
        removidos_estimado += len(res.data or [])
    except Exception as e:
        # Não trava o upload. Esse fallback pode falhar se a coluna for timestamp.
        erros_delete.append(f"delete_serial: {str(e)[:180]}")

    return {
        "ano": ano,
        "mes": mes,
        "inicio": inicio.isoformat(),
        "fim_exclusivo": fim.isoformat(),
        "removidos_estimado": removidos_estimado,
        "avisos_delete": erros_delete[:3],
    }


def _replace_month_apontamentos(conteudo: bytes, filename: str) -> dict:
    """
    Carga mensal segura para apontamentos.

    Fluxo:
      1. Lê o arquivo e identifica os meses pela DATA INICIAL.
      2. Se o arquivo tiver mais de um mês, substitui todos os meses presentes.
      3. Só depois chama o processador atual de apontamentos.
      4. Retorna apenas resumo, sem tentar listar 156 mil linhas.
    """
    info_periodo = _detectar_periodos_apontamentos(conteudo, filename)
    meses = info_periodo["meses"]

    deletes = []
    for ano, mes in meses:
        deletes.append(_delete_apontamentos_mes(ano, mes))

    total, erros = process_apontamentos(conteudo, filename)

    return {
        "total": total,
        "erros": erros or [],
        "modo_carga": "replace_month",
        "periodos_substituidos": [
            {"ano": ano, "mes": mes, "mes_ref": f"{ano}-{str(mes).zfill(2)}"}
            for ano, mes in meses
        ],
        "primeira_data_arquivo": info_periodo["primeira_data"],
        "ultima_data_arquivo": info_periodo["ultima_data"],
        "linhas_arquivo": info_periodo["linhas_arquivo"],
        "datas_validas": info_periodo["datas_validas"],
        "coluna_data_usada": info_periodo["coluna_data"],
        "deletes": deletes,
    }



# ─────────────────────────────────────────────────────────────
# Uploads comerciais de Faturamento
# Bases novas:
#   - faturados                  -> public.f_faturados
#   - prepedidos_pendentes        -> public.f_prepedidos_pendentes
#   - prepedidos_emitidos         -> public.f_prepedidos_emitidos
#
# Observação importante:
# Essas rotinas ficam aqui no upload.py para não mexer nos processadores
# que já estão funcionando em etl/processors.
# ─────────────────────────────────────────────────────────────

def _is_nullish(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _clean_text(value: Any) -> str | None:
    if _is_nullish(value):
        return None

    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.isoformat()

    texto = str(value).strip()
    if texto.lower() in {"nan", "nat", "none", "null"}:
        return None

    return texto


def _clean_code(value: Any) -> str | None:
    """
    Normaliza códigos vindos do Excel/Protheus.

    Exemplos:
      000087      -> 87
      87.0        -> 87
      005462      -> 5462
      2512D1144   -> 2512D1144

    Isso mantém compatibilidade com o padrão já usado no resto da ferramenta,
    onde o join de cliente/produto normalmente remove zeros à esquerda.
    """
    texto = _clean_text(value)
    if not texto:
        return None

    texto = texto.strip()

    try:
        # Só converte quando for numérico puro.
        if re.fullmatch(r"\d+([.,]0+)?", texto):
            return str(int(float(texto.replace(",", "."))))
    except Exception:
        pass

    if texto.endswith(".0"):
        texto = texto[:-2]

    return texto


def _clean_number(value: Any) -> float | None:
    if _is_nullish(value):
        return None

    if isinstance(value, (int, float)):
        try:
            if pd.isna(value):
                return None
        except Exception:
            pass
        return float(value)

    texto = str(value).strip()
    if not texto or texto.lower() in {"nan", "nat", "none", "null"}:
        return None

    texto = (
        texto.replace("R$", "")
        .replace("%", "")
        .replace("\u00a0", " ")
        .strip()
    )

    # Padrão brasileiro: 1.000,13 / 14.156,00000
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    else:
        # Padrão americano ou inteiro simples.
        texto = texto.replace(" ", "")

    try:
        return float(texto)
    except Exception:
        return None


def _clean_date(value: Any) -> str | None:
    if _is_nullish(value):
        return None

    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.date().isoformat()

    if isinstance(value, datetime):
        return value.date().isoformat()

    if isinstance(value, date):
        return value.isoformat()

    # Serial Excel.
    if isinstance(value, (int, float)):
        try:
            numero = float(value)
            if 20000 <= numero <= 70000:
                dt = pd.to_datetime(numero, unit="D", origin="1899-12-30", errors="coerce")
                if pd.isna(dt):
                    return None
                return dt.date().isoformat()
        except Exception:
            pass

    texto = str(value).strip()
    if not texto or texto.lower() in {"nan", "nat", "none", "null"}:
        return None

    try:
        numero = float(texto.replace(",", "."))
        if 20000 <= numero <= 70000:
            dt = pd.to_datetime(numero, unit="D", origin="1899-12-30", errors="coerce")
            if not pd.isna(dt):
                return dt.date().isoformat()
    except Exception:
        pass

    dt = pd.to_datetime(texto, dayfirst=True, errors="coerce")
    if pd.isna(dt):
        return None

    return dt.date().isoformat()


def _year_month_from_date(data_iso: str | None) -> tuple[int | None, int | None, str | None]:
    if not data_iso:
        return None, None, None

    try:
        ano = int(str(data_iso)[:4])
        mes = int(str(data_iso)[5:7])
        return ano, mes, f"{ano}-{str(mes).zfill(2)}"
    except Exception:
        return None, None, None


def _get_value(row: pd.Series, *keys: str) -> Any:
    """
    Lê uma coluna tolerando diferença de acento, espaço e caixa.
    Primeiro tenta o nome exato para preservar casos como TOTAL x Total.
    """
    if row is None:
        return None

    for key in keys:
        if key in row.index:
            return row.get(key)

    mapa_norm = {
        _normalizar_nome_coluna(col): col
        for col in row.index
    }

    for key in keys:
        col = mapa_norm.get(_normalizar_nome_coluna(key))
        if col is not None:
            return row.get(col)

    return None


def _detectar_header_browse(
    conteudo: bytes,
    filename: str,
    colunas_chave: list[str],
    sheet_name: int | str = 0,
) -> int:
    """
    Relatórios 'Listagem do Browse' costumam vir assim:
      linha 1: título
      linha 2: cabeçalho real

    A função detecta automaticamente para evitar quebrar se uma exportação
    vier com o cabeçalho direto na primeira linha.
    """
    nome = str(filename or "").lower()

    if nome.endswith(".csv"):
        return 0

    melhor_h = 1
    melhor_score = -1

    chaves_norm = {_normalizar_nome_coluna(c) for c in colunas_chave}

    for h in range(0, 8):
        try:
            df_test = pd.read_excel(
                io.BytesIO(conteudo),
                sheet_name=sheet_name,
                header=h,
                nrows=0,
            )
            cols_norm = {_normalizar_nome_coluna(c) for c in df_test.columns}
            score = sum(1 for c in chaves_norm if c in cols_norm)

            if score > melhor_score:
                melhor_score = score
                melhor_h = h

            if score == len(chaves_norm):
                return h
        except Exception:
            continue

    return melhor_h


def _ler_browse_excel(
    conteudo: bytes,
    filename: str,
    colunas_chave: list[str],
) -> tuple[pd.DataFrame, int]:
    nome = str(filename or "").lower()

    if nome.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(conteudo), sep=None, engine="python")
        except Exception:
            df = pd.read_csv(io.BytesIO(conteudo), sep=";")
        return df, 0

    header = _detectar_header_browse(conteudo, filename, colunas_chave)

    df = pd.read_excel(
        io.BytesIO(conteudo),
        sheet_name=0,
        header=header,
    )

    # Remove linhas totalmente vazias.
    df = df.dropna(how="all").copy()

    return df, header


def _validar_colunas_browse(df: pd.DataFrame, obrigatorias: list[str], nome_base: str):
    cols_norm = {_normalizar_nome_coluna(c) for c in df.columns}
    faltantes = [
        col for col in obrigatorias
        if _normalizar_nome_coluna(col) not in cols_norm
    ]

    if faltantes:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Arquivo de {nome_base} não está no layout esperado. "
                f"Colunas obrigatórias ausentes: {', '.join(faltantes)}. "
                f"Colunas encontradas: {', '.join(str(c) for c in list(df.columns)[:40])}"
            ),
        )


def _delete_all_table(table_name: str):
    """
    Delete total seguro para tabelas com id bigserial.
    Usado apenas nas 3 novas bases comerciais, que são snapshots exportados do ERP.
    """
    try:
        supabase.table(table_name).delete().gt("id", 0).execute()
    except Exception as e:
        raise Exception(f"Erro ao limpar tabela {table_name}: {str(e)[:300]}")


def _insert_rows_chunked(table_name: str, rows: list[dict[str, Any]], chunk_size: int = 500) -> int:
    inseridos = 0

    for start in range(0, len(rows), chunk_size):
        chunk = rows[start:start + chunk_size]

        try:
            res = supabase.table(table_name).insert(chunk).execute()
            inseridos += len(res.data or chunk)
        except Exception as e:
            raise Exception(
                f"Erro ao inserir registros em {table_name} "
                f"(linhas {start + 1} a {start + len(chunk)}): {str(e)[:500]}"
            )

    return inseridos


def _replace_table_rows(table_name: str, rows: list[dict[str, Any]]) -> int:
    _delete_all_table(table_name)

    if not rows:
        return 0

    return _insert_rows_chunked(table_name, rows)


def process_faturados_file(conteudo: bytes, filename: str):
    """
    Processa a base Faturados exportada do Protheus.

    Endpoint:
      POST /upload/faturados

    Tabela destino:
      public.f_faturados
    """
    colunas_chave = ["CLIENTE", "PRODUTO", "QUANTIDADE", "TOTAL", "Emissao", "Documento"]
    df, header = _ler_browse_excel(conteudo, filename, colunas_chave)

    _validar_colunas_browse(
        df,
        ["CLIENTE", "PRODUTO", "QUANTIDADE", "TOTAL", "Emissao"],
        "Faturados",
    )

    rows: list[dict[str, Any]] = []

    for idx, row in df.iterrows():
        cliente = _clean_code(_get_value(row, "CLIENTE"))
        produto = _clean_code(_get_value(row, "PRODUTO"))
        documento = _clean_code(_get_value(row, "Documento"))
        emissao = _clean_date(_get_value(row, "Emissao"))

        quantidade = _clean_number(_get_value(row, "QUANTIDADE"))
        total = _clean_number(_get_value(row, "TOTAL"))

        # Ignora linhas vazias/residuais.
        if not any([cliente, produto, documento, emissao, quantidade, total]):
            continue

        ano, mes, ano_mes = _year_month_from_date(emissao)

        rows.append({
            "arquivo_origem": filename,
            "linha_excel": int(idx) + int(header) + 2,

            "cliente": cliente,
            "razao_social": _clean_text(_get_value(row, "RAZAOSOCIAL")),
            "estado": _clean_text(_get_value(row, "EST")),
            "regiao": _clean_code(_get_value(row, "REGIAO")),
            "vendedor": _clean_code(_get_value(row, "VENDEDOR")),
            "vendedor_resp": _clean_code(_get_value(row, "VEND.RESP.")),
            "nome_vendedor_resp": _clean_text(_get_value(row, "NOMEVEND.RESP.")),
            "empenho": _clean_text(_get_value(row, "EMPENHO")),

            "grupo": _clean_code(_get_value(row, "GRUPO")),
            "produto": produto,
            "descricao": _clean_text(_get_value(row, "DECRICAO", "DESCRICAO")),

            "qtd_prepedido": _clean_number(_get_value(row, "QTDPRE-PEDIDO")),
            "quantidade": quantidade,
            "preco": _clean_number(_get_value(row, "PRECO")),
            "total": total,
            "valor_ipi": _clean_number(_get_value(row, "ValorIPI")),
            "valor_frete": _clean_number(_get_value(row, "ValorFrt")),
            "icms_retido": _clean_number(_get_value(row, "ICMSRetido")),
            "despesa": _clean_number(_get_value(row, "Despesa")),
            "seguro": _clean_number(_get_value(row, "Seguro")),
            "valor_icms": _clean_number(_get_value(row, "ValorICMS")),
            "total_final": _clean_number(_get_value(row, "Total")),

            "documento": documento,
            "emissao": emissao,
            "pedido": _clean_code(_get_value(row, "Pedido")),
            "emissao_ped": _clean_date(_get_value(row, "EmissaoPED")),
            "lote": _clean_text(_get_value(row, "Lote")),
            "prepedido": _clean_code(_get_value(row, "Prepedido")),
            "emissao_preped": _clean_date(_get_value(row, "EmissaoPrePed")),
            "saldo_preped": _clean_number(_get_value(row, "SaldoPrePed")),
            "origem": _clean_code(_get_value(row, "Origem")),
            "operacao": _clean_code(_get_value(row, "OPERACAO")),

            "cofins": _clean_number(_get_value(row, "COFINS")),
            "pis": _clean_number(_get_value(row, "PIS")),

            "dt_entrega": _clean_date(_get_value(row, "DTEntrega")),
            "moeda": _clean_text(_get_value(row, "MOEDA")),
            "cotacao": _clean_number(_get_value(row, "COTACAO")),

            "desc_cabecalho": _clean_number(_get_value(row, "DESC.CABECALHO")),
            "desc_item": _clean_number(_get_value(row, "DESC.ITEM")),
            "markup": _clean_number(_get_value(row, "MARKUP")),
            "cond_pagto": _clean_code(_get_value(row, "COND.PAGTO")),
            "setor": _clean_code(_get_value(row, "SETOR")),
            "obs4": _clean_text(_get_value(row, "OBS4")),
            "obs": _clean_text(_get_value(row, "OBS")),
            "desc_preped": _clean_text(_get_value(row, "DESC.PREPED")),
            "filial": _clean_code(_get_value(row, "FILIAL")),
            "obs_produto": _clean_text(_get_value(row, "OBS.PRODUTO")),

            "ano": ano,
            "mes": mes,
            "ano_mes": ano_mes,
        })

    total = _replace_table_rows("f_faturados", rows)

    return total, []


def _process_prepedidos_file(
    conteudo: bytes,
    filename: str,
    table_name: str,
    nome_base: str,
):
    """
    Processa Pré-pedidos Pendentes ou Emitidos.

    As duas exportações têm o mesmo layout.
    """
    colunas_chave = ["STATUS", "PREPEDIDO", "EMISSAO", "CLIENTE", "PRODUTO", "QUANT", "SALDO"]
    df, header = _ler_browse_excel(conteudo, filename, colunas_chave)

    _validar_colunas_browse(
        df,
        ["STATUS", "PREPEDIDO", "EMISSAO", "CLIENTE", "PRODUTO", "QUANT", "SALDO"],
        nome_base,
    )

    rows: list[dict[str, Any]] = []

    for idx, row in df.iterrows():
        prepedido = _clean_code(_get_value(row, "PREPEDIDO"))
        cliente = _clean_code(_get_value(row, "CLIENTE"))
        produto = _clean_code(_get_value(row, "PRODUTO"))
        emissao = _clean_date(_get_value(row, "EMISSAO"))
        entrega = _clean_date(_get_value(row, "ENTREGA"))

        quant = _clean_number(_get_value(row, "QUANT"))
        total = _clean_number(_get_value(row, "TOTAL"))
        saldo = _clean_number(_get_value(row, "SALDO"))

        # Ignora linhas vazias/residuais.
        if not any([prepedido, cliente, produto, emissao, quant, total, saldo]):
            continue

        ano, mes, ano_mes = _year_month_from_date(emissao)
        ano_entrega, mes_entrega, ano_mes_entrega = _year_month_from_date(entrega)

        rows.append({
            "arquivo_origem": filename,
            "linha_excel": int(idx) + int(header) + 2,

            "status": _clean_text(_get_value(row, "STATUS")),
            "prepedido": prepedido,
            "emissao": emissao,
            "origem": _clean_code(_get_value(row, "ORIGEM")),
            "regiao": _clean_code(_get_value(row, "REGIAO")),
            "cliente": cliente,
            "nome": _clean_text(_get_value(row, "NOME")),

            "operacao": _clean_code(_get_value(row, "OPERACAO")),
            "tabela": _clean_code(_get_value(row, "TABELA")),
            "vendedor": _clean_code(_get_value(row, "VENDEDOR")),

            "grupo": _clean_code(_get_value(row, "GRUPO")),
            "produto": produto,
            "descricao": _clean_text(_get_value(row, "DESCRICAO")),

            "quant": quant,
            "prcunit": _clean_number(_get_value(row, "PRCUNIT")),
            "total": total,
            "saldo": saldo,

            "lote": _clean_text(_get_value(row, "LOTE")),
            "dt_validade": _clean_date(_get_value(row, "DTVALIDADE")),
            "pedorig": _clean_code(_get_value(row, "PEDORIG")),
            "emissao_ped": _clean_date(_get_value(row, "EMISSAO_PED")),
            "entrega": entrega,

            "estoque": _clean_number(_get_value(row, "ESTOQUE")),
            "moeda": _clean_text(_get_value(row, "MOEDA")),
            "cotacao": _clean_number(_get_value(row, "COTACAO")),
            "total_rs": _clean_number(_get_value(row, "TOTAL R$")),

            "desc_cabecalho": _clean_number(_get_value(row, "DESC.CABECALHO")),
            "desc_item": _clean_number(_get_value(row, "DESC.ITEM")),
            "markup": _clean_number(_get_value(row, "MARKUP")),
            "setor": _clean_code(_get_value(row, "SETOR")),

            "sit_estq": _clean_text(_get_value(row, "Sit.Estq.", "SIT.ESTQ.", "SIT ESTQ")),
            "sit_fin": _clean_text(_get_value(row, "Sit.Fin.", "SIT.FIN.", "SIT FIN")),
            "obs": _clean_text(_get_value(row, "OBS")),
            "obs4": _clean_text(_get_value(row, "OBS4")),
            "custo_medio": _clean_number(_get_value(row, "CUSTO MEDIO")),
            "margem_bruta": _clean_number(_get_value(row, "MARGEM BRUTA")),
            "filial": _clean_code(_get_value(row, "FILIAL")),
            "obs_produto": _clean_text(_get_value(row, "OBS.PRODUTO")),
            "id_transferencia": _clean_code(_get_value(row, "ID.TRANSFERENCIA")),
            "nf_transferencia": _clean_code(_get_value(row, "NF.TRANSFERENCIA")),

            "ano": ano,
            "mes": mes,
            "ano_mes": ano_mes,
            "ano_entrega": ano_entrega,
            "mes_entrega": mes_entrega,
            "ano_mes_entrega": ano_mes_entrega,
        })

    total = _replace_table_rows(table_name, rows)

    return total, []


def process_prepedidos_pendentes_file(conteudo: bytes, filename: str):
    """
    Endpoint:
      POST /upload/prepedidos_pendentes

    Tabela destino:
      public.f_prepedidos_pendentes
    """
    return _process_prepedidos_file(
        conteudo=conteudo,
        filename=filename,
        table_name="f_prepedidos_pendentes",
        nome_base="Pré-pedidos pendentes",
    )


def process_prepedidos_emitidos_file(conteudo: bytes, filename: str):
    """
    Endpoint:
      POST /upload/prepedidos_emitidos

    Tabela destino:
      public.f_prepedidos_emitidos
    """
    return _process_prepedidos_file(
        conteudo=conteudo,
        filename=filename,
        table_name="f_prepedidos_emitidos",
        nome_base="Pré-pedidos emitidos",
    )




def _detectar_sheet_e_header_benzotop(conteudo: bytes) -> tuple[str | int, int]:
    """Localiza a aba/cabeçalho da planilha CAPACIDADE X FORECAST BENZOTOP."""
    try:
        excel = pd.ExcelFile(io.BytesIO(conteudo))
        sheets = excel.sheet_names
    except Exception:
        return 0, 0

    candidatos = [s for s in sheets if "BENZOTOP" in str(s or "").upper()]
    if not candidatos:
        candidatos = sheets or [0]

    chaves = {
        _normalizar_nome_coluna("DATA LIBERAÇÃO"),
        _normalizar_nome_coluna("MÊS LIBERAÇÃO"),
        _normalizar_nome_coluna("ANO LIBERAÇÃO"),
        _normalizar_nome_coluna("PRODUÇÃO DIA"),
    }

    melhor_sheet = candidatos[0]
    melhor_header = 0
    melhor_score = -1

    for sheet in candidatos:
        for header in range(0, 12):
            try:
                df_test = pd.read_excel(io.BytesIO(conteudo), sheet_name=sheet, header=header, nrows=0)
                cols = {_normalizar_nome_coluna(c) for c in df_test.columns}
                score = sum(1 for c in chaves if c in cols)
                if score > melhor_score:
                    melhor_score = score
                    melhor_sheet = sheet
                    melhor_header = header
                if score == len(chaves):
                    return sheet, header
            except Exception:
                continue

    return melhor_sheet, melhor_header


def process_benzotop_liberacao_file(conteudo: bytes, filename: str):
    """Processa a planilha CAPACIDADE X FORECAST BENZOTOP.

    Endpoint sugerido:
      POST /upload/benzotop_liberacao

    Tabela destino:
      public.f_benzotop_liberacao

    Regra de negócio:
      Para o PA 52749 - BENZOTOP - T.FRUTTI 30G, a entrada prevista vem da soma
      de PRODUÇÃO DIA por MÊS LIBERAÇÃO / ANO LIBERAÇÃO.
    """
    sheet, header = _detectar_sheet_e_header_benzotop(conteudo)

    try:
        df = pd.read_excel(io.BytesIO(conteudo), sheet_name=sheet, header=header)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Não foi possível ler a planilha Benzotop: {str(e)[:250]}")

    if df.empty:
        return 0, ["Arquivo Benzotop vazio."]

    _validar_colunas_browse(
        df,
        ["DATA LIBERAÇÃO", "MÊS LIBERAÇÃO", "ANO LIBERAÇÃO", "PRODUÇÃO DIA"],
        "Capacidade x Forecast Benzotop",
    )

    upload_id = str(uuid.uuid4())
    hoje = date.today().isoformat()
    rows: list[dict[str, Any]] = []

    for idx, row in df.iterrows():
        producao_dia = _clean_number(_get_value(row, "PRODUÇÃO DIA", "PRODUCAO DIA")) or 0.0

        # Ignora linhas auxiliares/tabelas dinâmicas no lado direito e dias sem produção.
        if producao_dia <= 0:
            continue

        data_liberacao = _clean_date(_get_value(row, "DATA LIBERAÇÃO", "DATA LIBERACAO"))
        data_envase = _clean_date(_get_value(row, "DATA ENVASE"))

        mes_liberacao = int(_clean_number(_get_value(row, "MÊS LIBERAÇÃO", "MES LIBERAÇÃO", "MES LIBERACAO")) or 0)
        ano_liberacao = int(_clean_number(_get_value(row, "ANO LIBERAÇÃO", "ANO LIBERACAO")) or 0)
        mes_envase = int(_clean_number(_get_value(row, "MÊS ENVASE", "MES ENVASE")) or 0)
        ano_envase = int(_clean_number(_get_value(row, "ANO ENVASE")) or 0)

        # Fallback pela data, caso mês/ano venha vazio no arquivo.
        if (mes_liberacao <= 0 or ano_liberacao <= 0) and data_liberacao:
            try:
                dt = datetime.fromisoformat(str(data_liberacao)[:10])
                mes_liberacao = mes_liberacao or dt.month
                ano_liberacao = ano_liberacao or dt.year
            except Exception:
                pass

        if mes_liberacao <= 0 or mes_liberacao > 12 or ano_liberacao <= 0:
            continue

        rows.append({
            "upload_id": upload_id,
            "data_ref": hoje,
            "arquivo_origem": filename,
            "aba_origem": str(sheet),
            "codigo_pa": "52749",
            "descricao_pa": "BENZOTOP - T.FRUTTI 30G",
            "dia_semana": _clean_text(_get_value(row, "DIA DA SEMANA")),
            "data_envase": data_envase,
            "data_liberacao": data_liberacao,
            "mes_envase": mes_envase or None,
            "mes_liberacao": mes_liberacao,
            "ano_envase": ano_envase or None,
            "ano_liberacao": ano_liberacao,
            "parada": _clean_text(_get_value(row, "PARADA")),
            "producao_dia": producao_dia,
        })

    total = _insert_rows_chunked("f_benzotop_liberacao", rows) if rows else 0

    return total, []


# Registra as novas bases sem alterar a estrutura já existente de BASES_ESPECIAIS.
BASES_ESPECIAIS.update({
    "faturados": process_faturados_file,
    "prepedidos_pendentes": process_prepedidos_pendentes_file,
    "prepedidos_emitidos": process_prepedidos_emitidos_file,

    # Planilha específica do Benzotop 30G: CAPACIDADE X FORECAST BENZOTOP.
    "benzotop_liberacao": process_benzotop_liberacao_file,
    "liberacao_benzotop": process_benzotop_liberacao_file,
    "capacidade_forecast_benzotop": process_benzotop_liberacao_file,
})



def _recalcular_cache_aging_estoque_background(base_id: str, log_id: str | None = None) -> None:
    """
    Recalcula os caches da Gestão de Estoque (produtos, insumos, base completa)
    logo depois que um upload termina com sucesso -- sem esperar o próximo
    ciclo da thread de aquecimento em background (até 5 min de atraso).

    Motivo: sem isso, existe uma janela de até 5 min em que a fonte de dado já
    está atualizada (upload concluído) mas a conta pesada da tela ainda não
    foi refeita -- e nada avisa o navegador disso, porque a "versão" que ele
    monitora já reflete a data do upload, não se o cache já foi reconstruído.
    Quem abrisse a tela nessa janela via número desatualizado, sem nenhum
    aviso, e só um F5 na hora certa "corrigia" por coincidência.

    Roda em background (chamado via BackgroundTasks), não bloqueia a resposta
    do upload. Se falhar, só loga -- nunca derruba o upload em si.
    """
    try:
        from app.routers.aging_estoque import preaquecer_todos_caches_aging_estoque

        resultado = preaquecer_todos_caches_aging_estoque(force_refresh=True)

        if log_id:
            try:
                supabase.table("upload_log").update({
                    "cache_aging_estoque_status": "sucesso" if resultado.get("ok") else "sucesso_com_avisos",
                }).eq("id", log_id).execute()
            except Exception:
                pass
    except Exception as e:
        if log_id:
            try:
                supabase.table("upload_log").update({
                    "cache_aging_estoque_status": f"erro: {str(e)[:200]}",
                }).eq("id", log_id).execute()
            except Exception:
                pass


async def _recalcular_cache_ordens_background(base_id: str, log_id: str | None = None) -> dict:
    """
    Atualiza o snapshot de Ordens no backend depois que a Programação mensal entra.

    Objetivo:
      - a pessoa sobe Programação em um PC;
      - o backend recalcula o cache de Ordens;
      - outro PC, ao atualizar a tela, já pega o novo snapshot.

    Não bloqueia a resposta do upload. Se falhar, grava aviso no upload_log,
    mas não derruba a API nem deixa status processando.
    """
    if base_id != "programacao_ops":
        return {"status": "ignorado", "base_id": base_id}

    try:
        from app.routers.ops import recalcular_caches_ops_padrao

        resultado = await recalcular_caches_ops_padrao()

        if log_id:
            try:
                supabase.table("upload_log").update({
                    "cache_ordens_status": "sucesso",
                    "cache_ordens_resultado": resultado,
                }).eq("id", log_id).execute()
            except Exception:
                pass

        return {"status": "sucesso", "resultado": resultado}

    except Exception as e:
        erro = str(e)[:500]

        if log_id:
            try:
                supabase.table("upload_log").update({
                    "cache_ordens_status": "erro",
                    "cache_ordens_resultado": {"erro": erro},
                }).eq("id", log_id).execute()
            except Exception:
                pass

        return {"status": "erro", "erro": erro}


# ─────────────────────────────────────────────────────────────
# Upload principal
# ─────────────────────────────────────────────────────────────

TAMANHO_MAXIMO_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB


def _sanitizar_nome_arquivo(nome: str) -> str:
    """
    Remove separadores de caminho e caracteres fora do esperado pra um nome
    de arquivo, antes de usar no storage_path. Sem isso, um nome de arquivo
    com "/" ou ".." nele podia interferir no caminho salvo no Storage.
    """
    nome = (nome or "arquivo").strip()
    nome = nome.replace("/", "_").replace("\\", "_")
    nome = re.sub(r"\.\.+", ".", nome)
    nome = re.sub(r"[^A-Za-z0-9._\-]", "_", nome)
    return nome[:200] or "arquivo"


@router.post("/{base_id}")
async def upload_base(
    base_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    modo: str | None = Query(
        default=None,
        description=(
            "Para apontamentos: replace_month substitui somente o(s) mês(es) "
            "identificado(s) pela DATA INICIAL."
        ),
    ),
):
    if base_id not in BASES and base_id not in BASES_ESPECIAIS:
        raise HTTPException(
            status_code=404,
            detail=f"Base '{base_id}' não encontrada."
        )

    conteudo = await file.read()

    if len(conteudo) > TAMANHO_MAXIMO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Arquivo maior que o limite de "
                f"{TAMANHO_MAXIMO_UPLOAD_BYTES // (1024 * 1024)}MB."
            ),
        )

    nome_arquivo_seguro = _sanitizar_nome_arquivo(file.filename)
    storage_path = f"{base_id}/{uuid.uuid4()}_{nome_arquivo_seguro}"

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
        metadata_extra = {}

        if base_id == "apontamentos":
            # Novo padrão: apontamentos sempre entram como carga mensal substitutiva.
            # Para manter compatibilidade, append ainda pode ser usado explicitamente:
            # /upload/apontamentos?modo=append
            modo_apontamentos = str(modo or "replace_month").strip().lower()

            if modo_apontamentos in {"replace_month", "replace-mês", "replace_mes", "mensal"}:
                resultado = _replace_month_apontamentos(conteudo, file.filename)
                total = resultado["total"]
                erros = resultado["erros"]
                metadata_extra = {
                    "modo_carga": resultado["modo_carga"],
                    "periodos_substituidos": resultado["periodos_substituidos"],
                    "primeira_data_arquivo": resultado["primeira_data_arquivo"],
                    "ultima_data_arquivo": resultado["ultima_data_arquivo"],
                    "linhas_arquivo": resultado["linhas_arquivo"],
                    "datas_validas": resultado["datas_validas"],
                    "coluna_data_usada": resultado["coluna_data_usada"],
                    "deletes": resultado["deletes"],
                }
            else:
                total, erros = process_apontamentos(conteudo, file.filename)
                metadata_extra = {"modo_carga": "append"}

        elif base_id in BASES_ESPECIAIS:
            # Atalho operacional: se a planilha da reunião Supply/FUP for subida
            # no card antigo de Compras em Aberto, processa como FUP.
            # Assim não precisa criar outro card no front para conseguir atualizar
            # comentários de acompanhamento.
            if base_id == "compras_abertas" and _arquivo_parece_fup_compras(conteudo, file.filename):
                total, erros = process_compras_fup(conteudo, file.filename)
                metadata_extra = {
                    "modo_carga": "compras_fup_detectado_automaticamente",
                    "base_id_efetivo": "compras_fup",
                    "observacao": "Arquivo com abas Detalhes* e Coluna1 processado como Follow-up de Compras."
                }
            else:
                processador_especial = BASES_ESPECIAIS[base_id]
                total, erros = processador_especial(conteudo, file.filename)

        else:
            processador, sheet, header_default, colunas_chave = BASES[base_id]

            header = _detectar_header(
                conteudo,
                sheet,
                header_default,
                colunas_chave,
            )

            df = _ler_excel(conteudo, sheet, header)

            total, erros = processador(df)

        status_final = "sucesso" if not erros else "erro"

        supabase.table("upload_log").update({
            "status":          status_final,
            "total_registros": total,
            "erros":           erros[:20] if erros else None,
        }).eq("id", log_id).execute()

        cache_ordens_status = None

        if status_final == "sucesso" and base_id == "programacao_ops":
            cache_ordens_status = "agendado_background"
            background_tasks.add_task(
                _recalcular_cache_ordens_background,
                base_id,
                log_id,
            )

        # Roda pra qualquer base, não só as de estoque: mais barato disparar
        # um recálculo a mais de vez em quando do que deixar alguém ver
        # número desatualizado depois de um upload sem perceber.
        if status_final == "sucesso":
            background_tasks.add_task(
                _recalcular_cache_aging_estoque_background,
                base_id,
                log_id,
            )

        # Resposta pequena. Importante: o front não deve buscar/listar a f_apontamentos inteira depois.
        return {
            "status":         "sucesso" if not erros else "erro_parcial",
            "total_inserido": total,
            "erros":          (erros or [])[:20],
            "storage_path":   storage_path,
            "log_id":         log_id,
            "cache_ordens_status": cache_ordens_status,
            **metadata_extra,
        }

    except HTTPException:
        supabase.table("upload_log").update({
            "status": "erro",
            "erros":  ["Erro de validação no upload."],
        }).eq("id", log_id).execute()
        raise

    except Exception as e:
        supabase.table("upload_log").update({
            "status": "erro",
            "erros":  [str(e)],
        }).eq("id", log_id).execute()

        raise HTTPException(
            status_code=422,
            detail=str(e)
        )


# ─────────────────────────────────────────────────────────────
# Logs/status
# ─────────────────────────────────────────────────────────────

@router.get("/log")
def listar_logs():
    res = (
        supabase.table("upload_log")
        .select("*")
        .order("processado_em", desc=True)
        .limit(50)
        .execute()
    )

    return res.data


@router.get("/status/{base_id}")
def status_base(base_id: str):
    res = (
        supabase.table("upload_log")
        .select("*")
        .eq("base_id", base_id)
        .order("processado_em", desc=True)
        .limit(1)
        .execute()
    )

    return res.data[0] if res.data else {"status": "sem_dados"}


@router.get("/ultima-atualizacao/{base_id}")
def ultima_atualizacao(base_id: str):
    res = (
        supabase.table("upload_log")
        .select("processado_em, status")
        .eq("base_id", base_id)
        .eq("status", "sucesso")
        .order("processado_em", desc=True)
        .limit(1)
        .execute()
    )

    if not res.data:
        return {
            "base_id": base_id,
            "ultima_atualizacao": None
        }

    return {
        "base_id": base_id,
        "ultima_atualizacao": res.data[0]["processado_em"]
    }


@router.get("/apontamentos/resumo")
def resumo_apontamentos(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
):
    """
    Resumo leve para a tela de Bases.
    Evita listar a f_apontamentos inteira.
    """
    try:
        query = supabase.table("f_apontamentos").select("id", count="exact")

        if ano and mes:
            inicio, fim = _inicio_fim_mes(ano, mes)
            query = query.gte("data_inicial", inicio.isoformat()).lt("data_inicial", fim.isoformat())

        res = query.limit(1).execute()

        return {
            "ano": ano,
            "mes": mes,
            "total": res.count or 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))