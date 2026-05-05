-- Corrige f_estoque para refletir a estrutura real do SB9 (SCNRIZC0)
-- Qtd já vem em caixas, sem coluna descrição

drop table if exists f_estoque;

create table if not exists f_estoque (
  id          uuid primary key default uuid_generate_v4(),
  mes         int  not null check (mes between 1 and 12),
  ano         int  not null default 2026,
  produto     text not null,
  armazem     text not null check (armazem in ('04','07')),
  qtd_caixas  numeric not null default 0,
  created_at  timestamptz default now(),
  unique(mes, ano, produto, armazem)
);

create index if not exists idx_estoque_mes on f_estoque(mes, ano);

-- RLS
alter table f_estoque enable row level security;
create policy "Public read all" on f_estoque for select using (true);
create policy "Service insert"  on f_estoque for insert with check (true);
create policy "Service delete"  on f_estoque for delete using (true);
