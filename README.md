# DFL S&OP Dashboard

Dashboard operacional para S&OP — Overview, Produção e gestão de bases de dados.

## Stack

| Camada   | Tecnologia                    |
|----------|-------------------------------|
| Frontend | React 18 + TypeScript + Vite  |
| Estilo   | Tailwind CSS                  |
| Gráficos | Recharts                      |
| Backend  | Python FastAPI                |
| Banco    | Supabase (PostgreSQL)         |
| Storage  | Supabase Storage              |
| Deploy   | Fly.io (backend) + Vercel (frontend) |

## Estrutura

```
dfl-dashboard/
├── frontend/                  # React app
│   └── src/
│       ├── components/        # layout/, ui/, charts/
│       ├── pages/             # Login, Overview, Dados, Producao
│       ├── services/          # api.ts
│       ├── data/              # bases.ts (config das bases)
│       ├── types/             # index.ts
│       └── utils/             # formatters.ts
├── backend/                   # FastAPI
│   ├── app/
│   │   ├── routers/           # upload.py, overview.py, dados.py
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── etl/
│   │   └── processors.py      # ETL de cada base
│   ├── Dockerfile
│   └── fly.toml
└── supabase/
    └── migrations/            # DDL + RLS + Storage
```

## Setup Rápido

### 1. Supabase
Execute as migrations no SQL Editor do Supabase:
```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_storage_rls.sql
```

### 2. Backend
```bash
cd backend
cp .env.example .env        # preencha as chaves do Supabase
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:8080
npm install
npm run dev
```

Acesse: http://localhost:5173

### 4. Deploy Backend (Fly.io)
```bash
cd backend
fly launch          # primeira vez
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_ANON_KEY=...
fly deploy
```

## Bases de dados disponíveis

| Base                 | Rota upload         | Filtros aplicados                              |
|----------------------|---------------------|------------------------------------------------|
| Dimensão Produtos    | POST /upload/d_produtos        | —                                |
| Orçado Liberações    | POST /upload/orcado_liberacao  | —                                |
| Forecast S&OP        | POST /upload/forecast_sop      | —                                |
| Vendas (SD2)         | POST /upload/sd2_saidas        | Armazém 04/07, grupos anest., sem AVULSO |
| Entradas (SD3)       | POST /upload/sd3_entradas      | TP 499, Armazém 04/07, grupos anest., sem AVULSO, sem Estornado |
| Estoque              | POST /upload/estoque           | —                                |
| Produção             | POST /upload/producao_real     | —                                |

## Convenções

- **Sem emojis** — sempre ícones Lucide React
- **Unidade base**: tubetes (÷ 500 = caixas)
- **Cores**: `success` verde · `danger` vermelho · `warning` amarelo · `brand` azul
- **Autenticação**: desabilitada por enquanto — plugar Supabase Auth quando pronto
