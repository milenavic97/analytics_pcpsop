"""
ETL — processa cada base e insere no Supabase.
"""

import pandas as pd
from typing import Tuple
from app.database import supabase

TUBETES_POR_CAIXA = 500

GRUPOS_ANEST = {"0101", "0102", "0104", "0107", "0108", "0111"}
GRUPOS_ANEST_NORM = {"101", "102", "104", "107", "108", "111",
                     "0101", "0102", "0104", "0107", "0108", "0111"}

GRUPOS_VALIDOS = {
    "ALPHACAINE", "ALPHACAINE 80", "ARTICAINE", "ARTICAINE 200",
    "MEPIADRE", "MEPISV", "PRILONEST"
}

PRODUTOS_ANEST = {
    '50997','50305','50757','50807','50975','50979','51577','52469','52756','52762','52763','52851',
    '40295','40327','50993','50137','50989','51451','51515','51569','51585','52470','52750','52759',
    '52764','52783','52787','52816','52842','52852','52765','40319','50687','52823','40323','50999',
    '50131','50811','51581','52767','40303','51001','50135','50745','50809','50991','51579','52473',
    '52815','52766','52853','40299','51003','40315',
}

PK_MAP: dict[str, tuple[str, str]] = {
    "d_produtos": ("cod_produto", "VAZIO"),
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _normaliza_grupo(val: str) -> str:
    """Remove zeros à esquerda de códigos de grupo (0101 → 101 e 101 → 101)."""
    v = str(val).strip()
    try:
        return str(int(v))
    except ValueError:
        return v

def _normaliza_armazem(val: str) -> str:
    v = str(val).strip()
    try:
        return str(int(v))
    except ValueError:
        return v

def _limpar_tabela(table: str):
    if table in PK_MAP:
        col, val = PK_MAP[table]
        supabase.table(table).delete().neq(col, val).execute()
    else:
        supabase.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

def _chunk_insert(table: str, records: list[dict], chunk_size: int = 500) -> list[str]:
    erros = []
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        try:
            supabase.table(table).insert(chunk).execute()
        except Exception as e:
            msg = str(e)[:300]
            if "duplicate" in msg.lower() or "unique" in msg.lower():
                erros.append("Registro duplicado encontrado — verifique se o arquivo já foi carregado.")
            elif "foreign key" in msg.lower():
                erros.append("Produto referenciado não existe na dimensão de produtos.")
            elif "not null" in msg.lower():
                erros.append("Campo obrigatório vazio em um ou mais registros.")
            else:
                erros.append(f"Erro ao inserir: {msg}")
    return erros

def _wide_to_long_agregado(
    df: pd.DataFrame,
    fixed_cols: list[str],
    value_col: str,
    group_cols: list[str],
) -> list[dict]:
    """Converte wide→long e agrega por (group_cols) somando value_col."""
    month_cols = [c for c in df.columns if c not in fixed_cols]
    records = []
    for _, row in df.iterrows():
        for col in month_cols:
            try:
                date = pd.to_datetime(col, errors="coerce")
                if pd.isna(date):
                    date = pd.to_datetime(float(col), unit="D", origin="1899-12-30")
                qtd = float(row[col] or 0)
                if qtd == 0:
                    continue
                base = {k: str(row.get(k, "")).strip() for k in fixed_cols}
                base["mes"]     = date.month
                base["ano"]     = date.year
                base[value_col] = qtd
                records.append(base)
            except Exception:
                continue

    if not records:
        return []

    agg_df = pd.DataFrame(records)
    agg_df = agg_df.groupby(group_cols, as_index=False)[value_col].sum()
    return agg_df.to_dict("records")

# ─── d_produtos ──────────────────────────────────────────────────────────────

def process_d_produtos(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]
    df = df.rename(columns={
        "CodProduto":  "cod_produto",
        "DescProduto": "desc_produto",
        "Grupo":       "grupo",
        "Mercado":     "mercado",
    })
    df = df.dropna(subset=["cod_produto"])
    df["cod_produto"] = df["cod_produto"].astype(str).str.strip()

    cols_ok = [c for c in ["cod_produto", "desc_produto", "grupo", "mercado"] if c in df.columns]
    if len(cols_ok) < 4:
        return 0, ["Arquivo fora do formato esperado. Baixe o template e preencha corretamente."]

    records = df[cols_ok].to_dict("records")
    _limpar_tabela("d_produtos")
    erros = _chunk_insert("d_produtos", records)
    return len(records) - len(erros), erros

# ─── f_orcado_liberacao ───────────────────────────────────────────────────────

HERANCA_2025 = {"L1": 3_000_000.0, "L2": 1_298_500.0}
MES_MAP = {
    "Jan": 1, "Fev": 2, "Mar": 3, "Abr": 4, "Mai": 5, "Jun": 6,
    "Jul": 7, "Ago": 8, "Set": 9, "Out": 10, "Nov": 11, "Dez": 12,
}

def process_orcado_liberacao(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]
    df = df[~df.iloc[:, 0].astype(str).str.contains("Liberacao", case=False, na=False)]
    df = df.dropna(subset=[df.columns[0]])

    records = []
    for _, row in df.iterrows():
        mes_label = str(row.iloc[0]).strip()
        mes_num = MES_MAP.get(mes_label)
        if not mes_num:
            continue
        for linha_col, linha_key in [("L1", "L1"), ("L2", "L2")]:
            qtd = float(row.get(linha_col, 0) or 0)
            records.append({
                "mes": mes_num, "ano": 2026,
                "linha": linha_key, "qtd_tubetes": qtd,
                "heranca_2025": False,
            })

    for linha_key, qtd in HERANCA_2025.items():
        records.append({
            "mes": 1, "ano": 2026,
            "linha": linha_key, "qtd_tubetes": qtd,
            "heranca_2025": True,
        })

    _limpar_tabela("f_orcado_liberacao")
    erros = _chunk_insert("f_orcado_liberacao", records)
    return len(records) - len(erros), erros

# ─── f_orcado_faturamento ─────────────────────────────────────────────────────

def process_orcado_faturamento(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]
    fixed = ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família"]
    group_cols = ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família", "mes", "ano"]

    records = _wide_to_long_agregado(df, fixed, "qtd_caixas", group_cols)
    if not records:
        return 0, ["Nenhum dado encontrado. Verifique o formato do arquivo."]

    clean = []
    for r in records:
        clean.append({
            "cod_produto":  str(r.get("Cód. Produto", "")).strip(),
            "desc_produto": str(r.get("Descricao Produto", "")).strip(),
            "grupo":        str(r.get("Grupo de Produto", "")).strip(),
            "familia":      str(r.get("Família", "")).strip(),
            "mes":          int(r["mes"]),
            "ano":          int(r["ano"]),
            "qtd_caixas":   float(r["qtd_caixas"]),
        })

    _limpar_tabela("f_orcado_faturamento")
    erros = _chunk_insert("f_orcado_faturamento", clean)
    return len(clean) - len(erros), erros

# ─── f_forecast_sop ──────────────────────────────────────────────────────────

def process_forecast_sop(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]
    fixed = ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família"]
    group_cols = ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família", "mes", "ano"]

    records = _wide_to_long_agregado(df, fixed, "qtd_forecast", group_cols)
    if not records:
        return 0, ["Nenhum dado encontrado. Verifique o formato do arquivo."]

    clean = []
    for r in records:
        clean.append({
            "cod_produto":  str(r.get("Cód. Produto", "")).strip(),
            "desc_produto": str(r.get("Descricao Produto", "")).strip(),
            "grupo":        str(r.get("Grupo de Produto", "")).strip(),
            "familia":      str(r.get("Família", "")).strip(),
            "mes":          int(r["mes"]),
            "ano":          int(r["ano"]),
            "qtd_forecast": float(r["qtd_forecast"]),
        })

    _limpar_tabela("f_forecast_sop")
    erros = _chunk_insert("f_forecast_sop", clean)
    return len(clean) - len(erros), erros

# ─── f_sd2_saidas ────────────────────────────────────────────────────────────

def process_sd2_saidas(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]

    colunas_necessarias = ["Armazem", "Grupo", "Descricao", "Quantidade"]
    faltando = [c for c in colunas_necessarias if c not in df.columns]
    if faltando:
        return 0, [f"Colunas não encontradas: {', '.join(faltando)}. Verifique o formato."]

    df["_arm"] = df["Armazem"].astype(str).str.strip().apply(_normaliza_armazem)
    df["_grp"] = df["Grupo"].astype(str).str.strip().apply(_normaliza_grupo)

    mask = (
        df["_arm"].isin(["4", "7"])
        & df["_grp"].isin(GRUPOS_ANEST_NORM)
        & ~df["Descricao"].astype(str).str.upper().str.contains("AVULSO", na=False)
    )
    if "Estornado" in df.columns:
        mask &= df["Estornado"].isna()
    df = df[mask].copy()

    if df.empty:
        return 0, ["Nenhum registro encontrado após aplicar os filtros."]

    records = []
    for _, row in df.iterrows():
        try:
            emissao = pd.to_datetime(row.get("Emissao") or row.get("Emissão"), errors="coerce")
            if pd.isna(emissao):
                continue
            records.append({
                "produto":    str(row.get("Produto", "")).strip(),
                "descricao":  str(row.get("Descricao", "")).strip(),
                "quantidade": float(row.get("Quantidade", 0) or 0),
                "vlr_total":  float(row.get("Vlr.Total", 0) or 0),
                "armazem":    str(row.get("Armazem", "")).strip(),
                "grupo":      str(row.get("Grupo", "")).strip(),
                "cliente":    str(row.get("Cliente", "")).strip(),
                "emissao":    emissao.date().isoformat(),
            })
        except Exception:
            continue

    _limpar_tabela("f_sd2_saidas")
    erros = _chunk_insert("f_sd2_saidas", records)
    return len(records) - len(erros), erros

# ─── f_sd3_entradas ──────────────────────────────────────────────────────────

def process_sd3_entradas(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]

    if "TP Movimento" in df.columns:
        df["_tp"] = (
            df["TP Movimento"]
            .astype(str)
            .str.strip()
            .str.replace(r"\.0$", "", regex=True)
        )
        mask_tp = df["_tp"] == "499"
    else:
        mask_tp = pd.Series([True] * len(df), index=df.index)

    colunas_necessarias = ["Armazem", "Grupo", "Descr. Prod"]
    faltando = [c for c in colunas_necessarias if c not in df.columns]
    if faltando:
        return 0, [f"Colunas não encontradas: {', '.join(faltando)}. Verifique o formato."]

    df["_arm"] = df["Armazem"].astype(str).str.strip().apply(_normaliza_armazem)
    df["_grp"] = df["Grupo"].astype(str).str.strip().apply(_normaliza_grupo)
    df["_descr_prod"] = df["Descr. Prod"].astype(str).str.upper()

    mask = (
        mask_tp
        & df["_arm"].isin(["4", "7"])
        & df["_grp"].isin(GRUPOS_ANEST_NORM)
        & ~df["_descr_prod"].str.contains("AVULSO", na=False)
        & ~df["_descr_prod"].str.contains(r"\bAG\b", regex=True, na=False)
    )

    if "Tipo Produto" in df.columns:
        mask &= df["Tipo Produto"].astype(str).str.strip().str.upper().eq("PA")

    if "Estornado" in df.columns:
        mask &= ~df["Estornado"].astype(str).str.strip().str.upper().eq("SIM")

    df = df[mask].copy()

    if df.empty:
        return 0, [
            "Nenhum registro encontrado após aplicar os filtros: "
            "TP Movimento 499, armazéns 04/07, grupos anestésicos, "
            "sem AVULSO, sem AG/amostra grátis, Tipo Produto PA quando existir, e sem estorno."
        ]

    records = []
    for _, row in df.iterrows():
        try:
            dt = pd.to_datetime(row.get("DT Emissao") or row.get("DT Emissão"), errors="coerce")
            if pd.isna(dt):
                continue

            quantidade = float(row.get("Quantidade", 0) or 0)
            if quantidade == 0:
                continue

            produto = str(row.get("Produto", "")).strip().replace(".0", "")
            armazem_norm = _normaliza_armazem(row.get("Armazem", ""))
            armazem_db = "04" if armazem_norm == "4" else "07"

            records.append({
                "produto":    produto,
                "descr_prod": str(row.get("Descr. Prod", "")).strip(),
                "lote":       str(row.get("Lote", "")).strip(),
                "quantidade": quantidade,
                "armazem":    armazem_db,
                "grupo":      str(row.get("Grupo", "")).strip(),
                "dt_emissao": dt.date().isoformat(),
                "custo":      float(row.get("Custo", 0) or 0),
            })
        except Exception:
            continue

    if not records:
        return 0, ["Nenhum registro válido encontrado após converter data e quantidade."]

    _limpar_tabela("f_sd3_entradas")
    erros = _chunk_insert("f_sd3_entradas", records)
    return len(records) - len(erros), erros


# ─── f_estoque ────────────────────────────────────────────────────────────────

def process_estoque(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]

    colunas_necessarias = ["Produto", "Armazem", "Data Saldo", "Qtd.Inic.Mes"]
    faltando = [c for c in colunas_necessarias if c not in df.columns]
    if faltando:
        return 0, [f"Colunas não encontradas: {', '.join(faltando)}. Verifique o formato."]

    df = df.dropna(subset=["Produto", "Armazem", "Data Saldo", "Qtd.Inic.Mes"]).copy()

    df["Produto"] = (
        df["Produto"]
        .astype(str)
        .str.strip()
        .str.replace(r"\.0$", "", regex=True)
    )
    df["_arm"] = df["Armazem"].astype(str).str.strip().apply(_normaliza_armazem)

    mask = (
        df["_arm"].isin(["4", "7"])
        & df["Produto"].isin(PRODUTOS_ANEST)
    )
    df = df[mask].copy()

    if df.empty:
        return 0, ["Nenhum produto anestésico encontrado nos armazéns 04 e 07."]

    def parse_data_saldo(value):
        if pd.isna(value):
            return pd.NaT

        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return pd.to_datetime(float(value), unit="D", origin="1899-12-30", errors="coerce")

        return pd.to_datetime(value, errors="coerce")

    records = []
    for _, row in df.iterrows():
        try:
            data_saldo = parse_data_saldo(row["Data Saldo"])
            if pd.isna(data_saldo):
                continue

            qtd_caixas = float(row["Qtd.Inic.Mes"] or 0)
            if qtd_caixas == 0:
                continue

            armazem_db = "04" if row["_arm"] == "4" else "07"

            records.append({
                "mes":        int(data_saldo.month),
                "ano":        int(data_saldo.year),
                "produto":    str(row["Produto"]).strip(),
                "armazem":    armazem_db,
                "qtd_caixas": qtd_caixas,
            })
        except Exception:
            continue

    if not records:
        return 0, ["Nenhum registro válido encontrado no arquivo de estoque."]

    agg_df = pd.DataFrame(records)
    agg_df = agg_df.groupby(["mes", "ano", "produto", "armazem"], as_index=False)["qtd_caixas"].sum()
    records = agg_df.to_dict("records")

    _limpar_tabela("f_estoque")
    erros = _chunk_insert("f_estoque", records)
    return len(records) - len(erros), erros

# ─── f_producao_real ─────────────────────────────────────────────────────────

def process_producao_real(df: pd.DataFrame) -> Tuple[int, list]:
    df.columns = [str(c).strip() for c in df.columns]

    if "EQUIPAMENTO" not in df.columns:
        return 0, ["Coluna EQUIPAMENTO não encontrada. Verifique se está usando o arquivo correto."]

    df = df.dropna(subset=["EQUIPAMENTO"])

    records = []
    for _, row in df.iterrows():
        try:
            data_ini = pd.to_datetime(row.get("DATA INICIAL"), errors="coerce")
            data_fim = pd.to_datetime(row.get("DATA FINAL"),   errors="coerce")
            records.append({
                "equipamento":   str(row.get("EQUIPAMENTO",        "")).strip(),
                "tipo_evento":   str(row.get("TIPO DE EVENTO",     "")).strip(),
                "evento":        str(row.get("EVENTO",             "")).strip(),
                "produto":       str(row.get("PRODUTO",            "")).strip(),
                "lote":          str(row.get("LOTE",               "")).strip(),
                "data_inicial":  data_ini.isoformat() if not pd.isna(data_ini) else None,
                "data_final":    data_fim.isoformat() if not pd.isna(data_fim) else None,
                "duracao_h":     float(row.get("DURACAO",              0) or 0),
                "qtd_produzida": float(row.get("QUANTIDADE PRODUZIDA", 0) or 0),
                "qtd_rejeitada": float(row.get("QUANTIDADE REJEITADA", 0) or 0),
                "mes":           data_ini.month if not pd.isna(data_ini) else None,
                "ano":           data_ini.year  if not pd.isna(data_ini) else None,
            })
        except Exception:
            continue

    if not records:
        return 0, ["Nenhum registro válido encontrado no arquivo de produção."]

    _limpar_tabela("f_producao_real")
    erros = _chunk_insert("f_producao_real", records)
    return len(records) - len(erros), erros

# ─── f_entradas_previstas ─────────────────────────────────────────────────────
# Formato esperado: arquivo já com SÓ os meses de 2026 (1 a 12).
# Estrutura: seções LINHA 1 (CAIXAS) e LINHA 2 (CAIXAS), com cabeçalho de
# meses na própria linha de seção, e linhas de grupos abaixo (ALPHACAINE etc).
# Linha "TOTAL" é ignorada.

def process_entradas_previstas(df: pd.DataFrame) -> Tuple[int, list]:
    records = []
    linha_atual = None
    meses_cols: list = []

    for _, row in df.iterrows():
        vals = list(row.values)
        primeiro = str(vals[0]).strip() if pd.notna(vals[0]) else ""

        if "LINHA 1" in primeiro.upper() and "LINHA 2" not in primeiro.upper():
            linha_atual = "L1"
            meses_cols = []
            for v in vals[1:]:
                try:
                    meses_cols.append(int(float(v)))
                except Exception:
                    meses_cols.append(None)
            continue

        if "LINHA 2" in primeiro.upper():
            linha_atual = "L2"
            meses_cols = []
            for v in vals[1:]:
                try:
                    meses_cols.append(int(float(v)))
                except Exception:
                    meses_cols.append(None)
            continue

        if primeiro not in GRUPOS_VALIDOS or linha_atual is None:
            continue

        grupo = primeiro
        for col_idx, mes_num in enumerate(meses_cols):
            if mes_num is None:
                continue
            data_idx = col_idx + 1
            if data_idx >= len(vals):
                continue
            try:
                qtd = float(vals[data_idx] or 0)
            except Exception:
                qtd = 0
            if qtd == 0:
                continue
            records.append({
                "linha":      linha_atual,
                "grupo":      grupo,
                "mes":        mes_num,
                "ano":        2026,
                "qtd_caixas": qtd,
            })

    if not records:
        return 0, ["Nenhum dado encontrado. Verifique o formato do arquivo."]

    _limpar_tabela("f_entradas_previstas")
    erros = _chunk_insert("f_entradas_previstas", records)
    return len(records) - len(erros), erros