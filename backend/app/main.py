from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
import logging
import threading
import time

from app.routers import (
    upload,
    overview,
    dados,
    producao,
    overview_producao,
    ops,
    chat,
    chat_context,
    calendario_paradas,
    ajustes_compras_ops,
    mrp,
    aging_estoque,
    usuarios,
    faturamento,
    desvios,
    liberacao_executiva,
)
from app.auth import usuario_logado

logger = logging.getLogger("uvicorn.error")

# ────────────────────────────────────────────────────────────
# Aquecimento automático do cache da Gestão de Estoque.
#
# Antes disso, o cache pesado (_BUILD_BASE_CACHE etc. em aging_estoque.py)
# só era construído quando um USUÁRIO de verdade abria a tela e batia num
# cache frio/expirado -- ou seja, a pessoa com azar de chegar primeiro
# pagava o build pesado (e se duas pessoas caíssem nesse momento, a segunda
# ficava na fila do lock esperando a primeira). Isso é o principal motivo
# da Gestão de Estoque "travar" quando tem gente usando ao mesmo tempo.
#
# Rodando esse aquecimento sozinho, em background, a cada poucos minutos,
# quem paga o build pesado é sempre essa thread -- nunca uma requisição de
# usuário. O intervalo é curto o bastante pra pegar upload novo rápido
# (a cache_key muda sozinha quando há snapshot novo) e longo o bastante
# pra não gerar carga extra perceptível no Supabase.
_PREAQUECIMENTO_INTERVALO_SEGUNDOS = 5 * 60


def _loop_preaquecimento_cache_aging_estoque() -> None:
    # Pequeno atraso inicial pra deixar o processo terminar de subir
    # (imports, conexões) antes da primeira rodada de build pesado.
    time.sleep(5)

    while True:
        try:
            resultado = aging_estoque.preaquecer_todos_caches_aging_estoque(force_refresh=False)
            if not resultado.get("ok"):
                logger.warning("Aquecimento de cache (Gestão de Estoque) com avisos: %s", resultado.get("erros"))
        except Exception as e:
            # Nunca deixa o loop morrer por causa de um erro pontual
            # (ex.: Supabase fora do ar por alguns segundos).
            logger.warning("Falha no aquecimento automático de cache: %s", str(e)[:300])

        try:
            # Mantém o gráfico "Demanda vs Disponibilidade" da Overview batendo
            # com o card do Rastreamento de Lotes (ver overview.py,
            # atualizar_cache_reconciliacao_mes_atual). Roda só aqui, em
            # background -- nunca dentro de uma requisição de usuário.
            overview.atualizar_cache_reconciliacao_mes_atual()
        except Exception as e:
            logger.warning("Falha ao atualizar cache de reconciliação da Overview: %s", str(e)[:300])

        time.sleep(_PREAQUECIMENTO_INTERVALO_SEGUNDOS)


def _agendar_preaquecimento_cache() -> None:
    thread = threading.Thread(
        target=_loop_preaquecimento_cache_aging_estoque,
        name="preaquecimento-cache-aging-estoque",
        daemon=True,
    )
    thread.start()

# docs_url/redoc_url/openapi_url desligados aqui: recriamos os três abaixo
# exigindo login, em vez de deixar o FastAPI publicá-los sem proteção.
app = FastAPI(
    title="DFL S&OP API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://analyticspcp.com.br",
        "https://www.analyticspcp.com.br",
        "https://dfl-dashboard.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Todas as rotas abaixo passam a exigir um token válido (Authorization: Bearer <token>).
# usuarios.router não entra aqui porque já faz sua própria checagem por endpoint
# (login-only em /me, admin-only nos demais).
_auth = [Depends(usuario_logado)]

app.include_router(upload.router, dependencies=_auth)
app.include_router(overview.router, dependencies=_auth)
app.include_router(overview_producao.router, dependencies=_auth)
app.include_router(dados.router, dependencies=_auth)
app.include_router(producao.router, dependencies=_auth)
app.include_router(ops.router, dependencies=_auth)
app.include_router(chat.router, dependencies=_auth)
app.include_router(chat_context.router, dependencies=_auth)
app.include_router(calendario_paradas.router, dependencies=_auth)
app.include_router(ajustes_compras_ops.router, dependencies=_auth)
app.include_router(mrp.router, dependencies=_auth)
app.include_router(aging_estoque.router, dependencies=_auth)
app.include_router(usuarios.router)
app.include_router(faturamento.router, dependencies=_auth)
app.include_router(desvios.router, dependencies=_auth)
app.include_router(liberacao_executiva.router, dependencies=_auth)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
def iniciar_preaquecimento_cache_em_background():
    # daemon=True: a thread não impede o processo de encerrar (ex.: durante
    # deploy/restart do Fly). Não bloqueia o startup do app -- a API já
    # começa a responder mesmo enquanto o primeiro build pesado roda.
    _agendar_preaquecimento_cache()


# ────────────────────────────────────────────────────────────
# Documentação da API — mesma proteção das demais rotas.
# Precisa estar logado (qualquer usuário) para ver /docs, /redoc
# e o schema em /openapi.json. Antes disso tudo era público.
# ────────────────────────────────────────────────────────────

@app.get("/openapi.json", include_in_schema=False)
async def openapi_protegido(perfil: dict = Depends(usuario_logado)):
    return JSONResponse(
        get_openapi(title=app.title, version=app.version, routes=app.routes)
    )


@app.get("/docs", include_in_schema=False)
async def swagger_docs_protegido(perfil: dict = Depends(usuario_logado)):
    return get_swagger_ui_html(openapi_url="/openapi.json", title=f"{app.title} - Docs")


@app.get("/redoc", include_in_schema=False)
async def redoc_protegido(perfil: dict = Depends(usuario_logado)):
    return get_redoc_html(openapi_url="/openapi.json", title=f"{app.title} - ReDoc")