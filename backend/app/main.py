from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

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