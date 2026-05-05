from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import upload, overview, dados, producao

app = FastAPI(
    title="DFL S&OP API",
    version="1.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(overview.router)
app.include_router(dados.router)
app.include_router(producao.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
