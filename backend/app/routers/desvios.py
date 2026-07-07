import csv
import io
import unicodedata

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Response

from app.database import supabase
from etl.processors import process_desvios_lotes

router = APIRouter(prefix="/desvios", tags=["desvios"])


def normaliza_lote(valor) -> str:
    lote = str(valor or "").strip().upper().replace(" ", "")

    if lote.endswith(".0"):
        lote = lote[:-2]

    return lote


def normaliza_serial(valor) -> str:
    serial = str(valor or "").strip()

    if serial.endswith(".0"):
        serial = serial[:-2]

    return serial


def normaliza_texto(valor) -> str:
    texto = str(valor or "").strip().upper()

    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))

    return texto


def _destino_display(valor) -> str:
    destino = str(valor or "").strip()

    if not destino or destino in ["-", "—"]:
        return "-"

    return destino


def _match_destino(valor, filtro: str | None) -> bool:
    filtro_norm = normaliza_texto(filtro)

    if not filtro_norm or filtro_norm in ["TODOS", "TODAS", "ALL"]:
        return True

    destino_norm = normaliza_texto(valor)

    if filtro_norm in ["SEM DESTINO", "SEM_DESTINO", "VAZIO", "-"]:
        return not destino_norm or destino_norm in ["-", "—"]

    # Permite usar filtro=descartado mesmo se no Interact vier
    # "Descartado", "Descarte", "Lote descartado" etc.
    if filtro_norm in ["DESCARTADO", "DESCARTE", "DESCARTADOS"]:
        return "DESCART" in destino_norm

    return filtro_norm in destino_norm


def _match_situacao(valor, filtro: str | None) -> bool:
    filtro_norm = normaliza_texto(filtro)

    if not filtro_norm or filtro_norm in ["TODOS", "TODAS", "ALL"]:
        return True

    valor_norm = normaliza_texto(valor)

    if filtro_norm in ["ABERTO", "ABERTOS"]:
        return valor_norm == "ABERTO"

    if filtro_norm in ["FECHADO", "FECHADOS"]:
        return valor_norm == "FECHADO"

    return filtro_norm in valor_norm


def _filtrar_historico_desvios(
    historico: list[dict],
    situacao: str | None = "Todos",
    destino: str | None = "Todos",
    serials: str | None = None,
) -> list[dict]:
    serials_set = set()

    if serials:
        serials_set = {
            normaliza_serial(s)
            for s in str(serials).split(",")
            if normaliza_serial(s)
        }

    filtrado = []

    for item in historico:
        serial = normaliza_serial(item.get("serial"))

        if serials_set and serial not in serials_set:
            continue

        if not _match_situacao(item.get("situacao_historico"), situacao):
            continue

        if not _match_destino(item.get("destino"), destino):
            continue

        filtrado.append(item)

    return filtrado


def _resumo_destinos_historico(historico: list[dict]) -> list[dict]:
    agrupado: dict[str, int] = {}

    for item in historico:
        destino = _destino_display(item.get("destino"))
        agrupado[destino] = agrupado.get(destino, 0) + 1

    return [
        {"destino": destino, "total": total}
        for destino, total in sorted(
            agrupado.items(),
            key=lambda x: (-x[1], x[0]),
        )
    ]


def _montar_historico_anual_base(ano: int) -> dict:
    """
    Monta o histórico anual bruto, sem aplicar filtros de tela.
    """
    snapshot_id_atual, atuais = get_snapshot_atual()

    snapshots = select_all(
        "desvios_snapshots",
        order_col="data_upload",
        desc=True,
    )

    if not snapshots:
        return {
            "ano": ano,
            "snapshot_id_atual": snapshot_id_atual,
            "ultima_carga": None,
            "total_desvios": 0,
            "abertos": 0,
            "fechados": 0,
            "data": [],
        }

    ano_txt = str(ano)
    registros_ano = []

    for r in snapshots:
        serial = normaliza_serial(r.get("serial"))
        data_upload = str(r.get("data_upload") or "")

        if ano_txt in serial or data_upload.startswith(ano_txt):
            registros_ano.append(r)

    liberacao_por_lote = _buscar_liberacao_por_lote()

    serials_abertos = {
        normaliza_serial(r.get("serial"))
        for r in atuais
        if normaliza_serial(r.get("serial"))
    }

    ultima_carga_atual = atuais[0].get("data_upload") if atuais else None

    historico = _agrupar_desvios(
        registros=registros_ano,
        liberacao_por_lote=liberacao_por_lote,
        incluir_historico_uploads=True,
        serials_abertos=serials_abertos,
        ultima_carga_atual=ultima_carga_atual,
    )

    return {
        "ano": ano,
        "snapshot_id_atual": snapshot_id_atual,
        "ultima_carga": ultima_carga_atual,
        "total_desvios": len(historico),
        "abertos": len([d for d in historico if d.get("situacao_historico") == "Aberto"]),
        "fechados": len([d for d in historico if d.get("situacao_historico") == "Fechado"]),
        "data": historico,
    }



def select_all(
    table: str,
    order_col: str | None = "data_upload",
    desc: bool = True,
    filters: dict | None = None,
    page_size: int = 1000,
):
    rows = []
    start = 0

    while True:
        q = supabase.table(table).select("*")

        if filters:
            for col, val in filters.items():
                q = q.eq(col, val)

        if order_col:
            q = q.order(order_col, desc=desc)

        resp = q.range(start, start + page_size - 1).execute()
        batch = resp.data or []

        rows.extend(batch)

        if len(batch) < page_size:
            break

        start += page_size

    return rows


def get_snapshot_atual():
    snapshots = select_all(
        "desvios_snapshots",
        order_col="data_upload",
        desc=True,
    )

    if not snapshots:
        return None, []

    snapshot_id_atual = snapshots[0].get("snapshot_id")

    atuais = [
        r for r in snapshots
        if r.get("snapshot_id") == snapshot_id_atual
    ]

    return snapshot_id_atual, atuais


def get_snapshots_recentes_ids(limit: int = 2) -> list[str]:
    snapshots = select_all(
        "desvios_snapshots",
        order_col="data_upload",
        desc=True,
    )

    ids = []
    vistos = set()

    for row in snapshots:
        sid = row.get("snapshot_id")

        if not sid or sid in vistos:
            continue

        vistos.add(sid)
        ids.append(sid)

        if len(ids) >= limit:
            break

    return ids


def get_snapshot_por_id(snapshot_id: str | None) -> list[dict]:
    if not snapshot_id:
        return []

    return select_all(
        "desvios_snapshots",
        order_col=None,
        filters={"snapshot_id": snapshot_id},
    )


def _eventos_ajustados_ultimo_upload(
    snapshot_id_atual: str | None,
    atuais: list[dict],
    limit: int = 100,
) -> list[dict]:
    """
    Ajusta a leitura dos eventos para ficar mais útil para o usuário.

    Regra:
    - Se um desvio inteiro existia no snapshot anterior e não existe mais no atual,
      mostramos "DESVIO_FECHADO".
    - Nesse caso, não mostramos todos os lotes removidos daquele desvio, porque polui
      a tela e passa a impressão de várias alterações quando, na prática, o NC fechou.
    - Se o desvio continua existindo e apenas um lote saiu, aí sim mantém "LOTE_REMOVIDO".
    """
    if not snapshot_id_atual:
        return []

    eventos_db = select_all(
        "desvios_eventos",
        order_col="data_evento",
        desc=True,
        filters={"snapshot_id": snapshot_id_atual},
    )

    snapshot_ids = get_snapshots_recentes_ids(limit=2)

    if len(snapshot_ids) < 2:
        return eventos_db[:limit]

    snapshot_anterior_id = snapshot_ids[1]
    anterior = get_snapshot_por_id(snapshot_anterior_id)

    atuais_serial = {
        normaliza_serial(r.get("serial"))
        for r in atuais
        if normaliza_serial(r.get("serial"))
    }

    anterior_por_serial: dict[str, list[dict]] = {}

    for row in anterior:
        serial = normaliza_serial(row.get("serial"))

        if not serial:
            continue

        anterior_por_serial.setdefault(serial, []).append(row)

    serials_fechados = sorted([
        serial for serial in anterior_por_serial.keys()
        if serial not in atuais_serial
    ])

    data_upload_atual = None
    if atuais:
        data_upload_atual = atuais[0].get("data_upload")

    eventos_fechamento = []

    for serial in serials_fechados:
        rows_serial = anterior_por_serial.get(serial) or []
        primeiro = rows_serial[0] if rows_serial else {}

        eventos_fechamento.append({
            "snapshot_id": snapshot_id_atual,
            "tipo_evento": "DESVIO_FECHADO",
            "serial": serial,
            "lote": None,
            "descricao": f"Desvio fechado: {serial}",
            "data_evento": data_upload_atual,
            "titulo": primeiro.get("titulo"),
            "estado": primeiro.get("estado"),
            "destino": primeiro.get("destino"),
        })

    eventos_filtrados = []

    for evento in eventos_db:
        tipo = str(evento.get("tipo_evento") or "")
        serial = normaliza_serial(evento.get("serial"))

        # Se o desvio fechou inteiro, não lista cada lote removido dele.
        if tipo == "LOTE_REMOVIDO" and serial in serials_fechados:
            continue

        # Evita duplicar se no futuro o processor também passar a gerar DESVIO_FECHADO.
        if tipo == "DESVIO_FECHADO" and serial in serials_fechados:
            continue

        eventos_filtrados.append(evento)

    return (eventos_fechamento + eventos_filtrados)[:limit]


def _buscar_liberacao_por_lote() -> dict[str, dict]:
    liberacoes = select_all(
        "f_liberacao_diaria",
        order_col=None,
    )

    liberacao_por_lote: dict[str, dict] = {}

    for item in liberacoes:
        lote = normaliza_lote(item.get("lote"))

        if not lote:
            continue

        atual = liberacao_por_lote.get(lote)

        if not atual:
            liberacao_por_lote[lote] = item
            continue

        data_atual = str(atual.get("data_lib") or "")
        data_nova = str(item.get("data_lib") or "")

        if data_nova and (not data_atual or data_nova < data_atual):
            liberacao_por_lote[lote] = item

    return liberacao_por_lote


def _agrupar_desvios(
    registros: list[dict],
    liberacao_por_lote: dict[str, dict],
    incluir_historico_uploads: bool = False,
    serials_abertos: set[str] | None = None,
    ultima_carga_atual: str | None = None,
) -> list[dict]:
    agrupado: dict[str, dict] = {}

    for r in registros:
        serial = normaliza_serial(r.get("serial")) or "-"
        lote = normaliza_lote(r.get("lote"))

        if serial not in agrupado:
            agrupado[serial] = {
                "serial": serial,
                "estado": r.get("estado"),
                "destino": r.get("destino"),
                "setor": r.get("setor"),
                "titulo": r.get("titulo"),
                "dias_desvio": r.get("dias_desvio"),
                "lotes": [],
                "lotes_set": set(),
                "meses_lib": set(),
                "datas_lib": set(),
                "grupos_produto": set(),
                "linhas": set(),
                "qtd_prevista_total": 0.0,
                "primeiro_upload": r.get("data_upload") if incluir_historico_uploads else None,
                "ultimo_upload": r.get("data_upload") if incluir_historico_uploads else None,
            }

        item = agrupado[serial]

        # Como os snapshots costumam vir ordenados por data_upload desc,
        # mantém nos campos principais a informação mais recente encontrada.
        if incluir_historico_uploads:
            data_upload = str(r.get("data_upload") or "")

            if data_upload:
                primeiro = str(item.get("primeiro_upload") or data_upload)
                ultimo = str(item.get("ultimo_upload") or data_upload)

                if data_upload < primeiro:
                    item["primeiro_upload"] = data_upload

                if data_upload > ultimo:
                    item["ultimo_upload"] = data_upload
                    item["estado"] = r.get("estado")
                    item["destino"] = r.get("destino")
                    item["setor"] = r.get("setor")
                    item["titulo"] = r.get("titulo")
                    item["dias_desvio"] = r.get("dias_desvio")

        lib = liberacao_por_lote.get(lote) or {}

        mes = lib.get("mes")
        ano = lib.get("ano")
        data_lib = lib.get("data_lib")
        grupo_produto = lib.get("grupo_produto")
        linha = lib.get("linha")
        qtd_prevista = lib.get("qtd_prevista") or 0

        if lote and lote not in item["lotes_set"]:
            item["lotes_set"].add(lote)
            item["lotes"].append({
                "lote": lote,
                "data_lib": data_lib,
                "mes_lib": mes,
                "ano_lib": ano,
                "grupo_produto": grupo_produto,
                "linha": linha,
                "qtd_prevista": qtd_prevista,
            })

            try:
                item["qtd_prevista_total"] += float(qtd_prevista or 0)
            except Exception:
                pass

        if mes and ano:
            item["meses_lib"].add(f"{str(mes).zfill(2)}/{ano}")

        if data_lib:
            item["datas_lib"].add(str(data_lib))

        if grupo_produto:
            item["grupos_produto"].add(str(grupo_produto))

        if linha:
            item["linhas"].add(str(linha))

    result = []

    for item in agrupado.values():
        lotes_ordenados = sorted(
            item["lotes"],
            key=lambda x: x.get("lote") or "",
        )

        meses_lib = sorted(item["meses_lib"])
        datas_lib = sorted(item["datas_lib"])
        grupos_produto = sorted(item["grupos_produto"])
        linhas = sorted(item["linhas"])

        serial = item["serial"]
        situacao_historico = None
        fechado_detectado_em = None

        if incluir_historico_uploads:
            esta_aberto = serial in (serials_abertos or set())
            situacao_historico = "Aberto" if esta_aberto else "Fechado"
            fechado_detectado_em = None if esta_aberto else ultima_carga_atual

        result.append({
            "serial": serial,
            "estado": item["estado"],
            "destino": item["destino"],
            "setor": item["setor"],
            "titulo": item["titulo"],
            "descricao": item["titulo"],
            "dias_desvio": item["dias_desvio"],
            "qtd_lotes": len(lotes_ordenados),
            "lotes": lotes_ordenados,
            "lotes_texto": ", ".join([l["lote"] for l in lotes_ordenados if l.get("lote")]),
            "meses_lib": meses_lib,
            "meses_lib_texto": ", ".join(meses_lib) if meses_lib else "-",
            "datas_lib": datas_lib,
            "primeira_data_lib": datas_lib[0] if datas_lib else None,
            "grupos_produto": grupos_produto,
            "grupos_produto_texto": ", ".join(grupos_produto) if grupos_produto else "-",
            "linhas": linhas,
            "linhas_texto": ", ".join(linhas) if linhas else "-",
            "qtd_prevista_total": item["qtd_prevista_total"],
            "situacao_historico": situacao_historico,
            "primeiro_upload": item.get("primeiro_upload"),
            "ultimo_upload": item.get("ultimo_upload"),
            "fechado_detectado_em": fechado_detectado_em,
        })

    result = sorted(
        result,
        key=lambda x: (
            0 if x.get("situacao_historico") == "Aberto" else 1,
            str(x.get("primeira_data_lib") or "9999-99-99"),
            str(x.get("serial") or ""),
        ),
    )

    return result


@router.get("/resumo")
def resumo_desvios():
    snapshot_id_atual, atuais = get_snapshot_atual()

    eventos = _eventos_ajustados_ultimo_upload(
        snapshot_id_atual=snapshot_id_atual,
        atuais=atuais,
        limit=100,
    )

    return {
        "snapshot_id": snapshot_id_atual,
        "ultima_carga": atuais[0].get("data_upload") if atuais else None,
        "total_lotes": len(atuais),
        "total_desvios": len(set(r.get("serial") for r in atuais if r.get("serial"))),
        "novos_lotes": len([e for e in eventos if e.get("tipo_evento") == "NOVO_LOTE"]),
        "lotes_removidos": len([e for e in eventos if e.get("tipo_evento") == "LOTE_REMOVIDO"]),
        "desvios_fechados": len([e for e in eventos if e.get("tipo_evento") == "DESVIO_FECHADO"]),
        "novos_desvios": len([e for e in eventos if e.get("tipo_evento") == "NOVO_DESVIO"]),
        "alteracoes": len([
            e for e in eventos
            if e.get("tipo_evento") not in ["NOVO_LOTE", "LOTE_REMOVIDO"]
        ]),
        "eventos": eventos[:20],
    }


@router.get("/eventos")
def listar_eventos(limit: int = 100):
    snapshot_id_atual, atuais = get_snapshot_atual()

    if not snapshot_id_atual:
        return []

    eventos = _eventos_ajustados_ultimo_upload(
        snapshot_id_atual=snapshot_id_atual,
        atuais=atuais,
        limit=limit,
    )

    return eventos[:limit]


@router.get("/snapshots")
def listar_snapshots(limit: int = 100):
    snapshots = select_all(
        "desvios_snapshots",
        order_col="data_upload",
        desc=True,
    )

    grupos = {}

    for r in snapshots:
        sid = r.get("snapshot_id")

        if not sid:
            continue

        if sid not in grupos:
            grupos[sid] = {
                "snapshot_id": sid,
                "data_upload": r.get("data_upload"),
                "arquivo_origem": r.get("arquivo_origem"),
                "total_lotes": 0,
                "total_desvios": set(),
            }

        grupos[sid]["total_lotes"] += 1

        if r.get("serial"):
            grupos[sid]["total_desvios"].add(r.get("serial"))

    result = []

    for item in grupos.values():
        result.append({
            "snapshot_id": item["snapshot_id"],
            "data_upload": item["data_upload"],
            "arquivo_origem": item["arquivo_origem"],
            "total_lotes": item["total_lotes"],
            "total_desvios": len(item["total_desvios"]),
        })

    result = sorted(
        result,
        key=lambda x: str(x.get("data_upload") or ""),
        reverse=True,
    )

    return result[:limit]


@router.get("/atual")
def desvios_atuais():
    snapshot_id_atual, atuais = get_snapshot_atual()

    if not snapshot_id_atual:
        return []

    liberacao_por_lote = _buscar_liberacao_por_lote()

    result = _agrupar_desvios(
        registros=atuais,
        liberacao_por_lote=liberacao_por_lote,
    )

    # Na tela atual, mantém a ordenação operacional original:
    # data de liberação impactada, depois NC.
    result = sorted(
        result,
        key=lambda x: (
            str(x.get("primeira_data_lib") or "9999-99-99"),
            str(x.get("serial") or ""),
        ),
    )

    return result


@router.get("/historico-anual")
def historico_anual(
    ano: int = Query(2026, ge=2020, le=2100),
    situacao: str = Query("Todos"),
    destino: str = Query("Todos"),
):
    """
    Lista todos os desvios que já apareceram no ano, inclusive os que sumiram
    da base atual do Interact.

    Filtros:
    - situacao: Todos / Aberto / Fechado
    - destino: Todos / Aprovado / Reprovado / Descartado / Sem destino

    Observação:
    - destino=Descartado aceita qualquer texto que contenha "DESCART",
      para cobrir variações do Interact.
    """
    base = _montar_historico_anual_base(ano)
    historico = base.get("data") or []

    filtrado = _filtrar_historico_desvios(
        historico=historico,
        situacao=situacao,
        destino=destino,
    )

    return {
        **base,
        "filtros": {
            "situacao": situacao,
            "destino": destino,
        },
        "total_desvios_sem_filtro": len(historico),
        "total_desvios": len(filtrado),
        "abertos": len([d for d in filtrado if d.get("situacao_historico") == "Aberto"]),
        "fechados": len([d for d in filtrado if d.get("situacao_historico") == "Fechado"]),
        "destinos_disponiveis": _resumo_destinos_historico(historico),
        "data": filtrado,
    }


@router.get("/historico-anual/export")
def exportar_historico_anual(
    ano: int = Query(2026, ge=2020, le=2100),
    situacao: str = Query("Todos"),
    destino: str = Query("Todos"),
    serials: str | None = Query(None),
):
    """
    Exporta o histórico anual filtrado ou os NCs selecionados.

    Uso pelo front:
    - para exportar filtrados: chama sem serials;
    - para exportar selecionados: envia serials separados por vírgula.
    """
    base = _montar_historico_anual_base(ano)
    historico = base.get("data") or []

    filtrado = _filtrar_historico_desvios(
        historico=historico,
        situacao=situacao,
        destino=destino,
        serials=serials,
    )

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";", lineterminator="\n")

    writer.writerow([
        "Situacao",
        "Desvio",
        "Estado",
        "Destino",
        "Descricao",
        "Qtd lotes",
        "Lotes",
        "Mes impactado",
        "Linha",
        "Grupo",
        "Qtd prevista",
        "Primeiro upload",
        "Ultimo upload",
        "Fechado detectado em",
        "Setor",
    ])

    for item in filtrado:
        writer.writerow([
            item.get("situacao_historico") or "",
            item.get("serial") or "",
            item.get("estado") or "",
            _destino_display(item.get("destino")),
            item.get("descricao") or item.get("titulo") or "",
            item.get("qtd_lotes") or 0,
            item.get("lotes_texto") or "",
            item.get("meses_lib_texto") or "",
            item.get("linhas_texto") or "",
            item.get("grupos_produto_texto") or "",
            item.get("qtd_prevista_total") or 0,
            item.get("primeiro_upload") or "",
            item.get("ultimo_upload") or "",
            item.get("fechado_detectado_em") or "",
            item.get("setor") or "",
        ])

    csv_text = "\ufeff" + output.getvalue()

    filename = f"historico_desvios_{ano}.csv"

    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.delete("/limpar")
def limpar_desvios():
    erros = []

    tabelas = [
        "f_desvios_lotes",
        "desvios_eventos",
        "desvios_snapshots",
    ]

    for tabela in tabelas:
        try:
            supabase.table(tabela)\
                .delete()\
                .not_.is_("id", "null")\
                .execute()
        except Exception as e:
            erros.append(f"{tabela}: {str(e)[:150]}")

    if erros:
        raise HTTPException(
            status_code=500,
            detail=" | ".join(erros),
        )

    return {
        "ok": True,
        "message": "Dados de desvios apagados com sucesso.",
    }


@router.post("/upload")
async def upload_desvios(file: UploadFile = File(...)):
    try:
        conteudo = await file.read()

        total, erros = process_desvios_lotes(
            conteudo,
            file.filename or "desvios.xlsx",
        )

        return {
            "ok": len(erros) == 0,
            "arquivo": file.filename,
            "total": total,
            "erros": erros,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar desvios: {str(e)}",
        )
