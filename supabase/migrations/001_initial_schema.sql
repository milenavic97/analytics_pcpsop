-- ============================================================
-- DFL S&OP Dashboard — Schema inicial
-- ============================================================

-- Extensões
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- DIMENSÕES
-- ────────────────────────────────────────────────────────────

create table if not exists d_produtos (
  cod_produto     text primary key,
  desc_produto    text not null,
  grupo           text not null,
  mercado         text not null check (mercado in ('NACIONAL','EXPORTAÇÃO','PI')),
  created_at      timestamptz default now()
);

create table if not exists d_grupos (
  grupo   text primary key,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- FATOS
-- ────────────────────────────────────────────────────────────

-- Orçado de liberações (calendário de liberações previstas)
create table if not exists f_orcado_liberacao (
  id              uuid primary key default uuid_generate_v4(),
  mes             int not null check (mes between 1 and 12),
  ano             int not null default 2026,
  linha           text not null check (linha in ('L1','L2')),
  qtd_tubetes     numeric not null,
  qtd_caixas      numeric generated always as (qtd_tubetes / 500) stored,
  heranca_2025    boolean default false,
  created_at      timestamptz default now()
);

-- Forecast S&OP (wide → long na carga)
create table if not exists f_forecast_sop (
  id              uuid primary key default uuid_generate_v4(),
  cod_produto     text references d_produtos(cod_produto),
  desc_produto    text,
  grupo           text,
  familia         text,
  mes             int not null,
  ano             int not null default 2026,
  qtd_forecast    numeric not null default 0,
  created_at      timestamptz default now()
);

-- Vendas realizadas (SD2 filtrada)
create table if not exists f_sd2_saidas (
  id              uuid primary key default uuid_generate_v4(),
  produto         text,
  descricao       text,
  quantidade      numeric not null,
  vlr_total       numeric,
  armazem         text,
  grupo           text,
  cliente         text,
  emissao         date not null,
  mes             int generated always as (extract(month from emissao)::int) stored,
  ano             int generated always as (extract(year  from emissao)::int) stored,
  created_at      timestamptz default now()
);

-- Entradas reais (SD3 filtrada — TP Mov 499, armazém 04/07)
create table if not exists f_sd3_entradas (
  id              uuid primary key default uuid_generate_v4(),
  produto         text,
  descr_prod      text,
  lote            text,
  quantidade      numeric not null,
  armazem         text,
  grupo           text,
  dt_emissao      date not null,
  custo           numeric,
  mes             int generated always as (extract(month from dt_emissao)::int) stored,
  ano             int generated always as (extract(year  from dt_emissao)::int) stored,
  created_at      timestamptz default now()
);

-- Estoque início do mês
create table if not exists f_estoque (
  id              uuid primary key default uuid_generate_v4(),
  mes             int not null,
  ano             int not null default 2026,
  produto         text,
  descricao       text,
  grupo           text,
  armazem         text,
  qtd             numeric not null default 0,
  created_at      timestamptz default now(),
  unique(mes, ano, produto, armazem)
);

-- Relatório de produção (apontamentos)
create table if not exists f_producao_real (
  id              uuid primary key default uuid_generate_v4(),
  equipamento     text,
  tipo_evento     text,
  evento          text,
  produto         text,
  lote            text,
  data_inicial    timestamptz,
  data_final      timestamptz,
  duracao_h       numeric,
  qtd_produzida   numeric default 0,
  qtd_rejeitada   numeric default 0,
  mes             int,
  ano             int,
  created_at      timestamptz default now()
);

-- MPS Liberações (do GANTT — horas planejadas por dia/linha)
create table if not exists f_mps_liberacoes (
  id              uuid primary key default uuid_generate_v4(),
  versao          text not null,
  mes             int not null,
  ano             int not null default 2026,
  linha           text not null check (linha in ('L1','L2')),
  qtd_caixas      numeric not null,
  created_at      timestamptz default now()
);

-- MPS Produção (horas produtivas planejadas por dia/linha)
create table if not exists f_mps_producao (
  id              uuid primary key default uuid_generate_v4(),
  versao          text not null,
  data_dia        date not null,
  linha           text not null check (linha in ('L1','L2')),
  horas_producao  numeric not null default 0,
  horas_parada    numeric not null default 0,
  comentario      text,
  mes             int generated always as (extract(month from data_dia)::int) stored,
  ano             int generated always as (extract(year  from data_dia)::int) stored,
  created_at      timestamptz default now(),
  unique(versao, data_dia, linha)
);

-- Entradas planejadas (MPS disponibilidade por linha/mês)
create table if not exists f_entradas_planejado (
  id              uuid primary key default uuid_generate_v4(),
  versao          text not null,
  mes             int not null,
  ano             int not null default 2026,
  linha           text not null,
  qtd_planejado   numeric not null,
  created_at      timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- CONTROLE DE UPLOADS
-- ────────────────────────────────────────────────────────────

create table if not exists upload_log (
  id              uuid primary key default uuid_generate_v4(),
  base_id         text not null,   -- ex: 'orcado_liberacao', 'forecast_sop'
  nome_arquivo    text not null,
  storage_path    text,
  status          text not null check (status in ('processando','sucesso','erro')),
  total_registros int,
  erros           jsonb,
  processado_em   timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- ÍNDICES
-- ────────────────────────────────────────────────────────────

create index if not exists idx_sd2_emissao    on f_sd2_saidas(emissao);
create index if not exists idx_sd2_grupo      on f_sd2_saidas(grupo);
create index if not exists idx_sd3_dt_emissao on f_sd3_entradas(dt_emissao);
create index if not exists idx_sd3_grupo      on f_sd3_entradas(grupo);
create index if not exists idx_estoque_mes    on f_estoque(mes, ano);
create index if not exists idx_producao_data  on f_producao_real(data_inicial);
create index if not exists idx_forecast_mes   on f_forecast_sop(mes, ano);
create index if not exists idx_mps_prod_data  on f_mps_producao(data_dia, linha);
