-- ============================================================
-- Storage bucket para uploads
-- ============================================================

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

-- Policy: autenticados podem fazer upload
create policy "Authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'uploads');

-- Policy: autenticados podem ler
create policy "Authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'uploads');

-- ============================================================
-- Row Level Security (básico — sem auth por enquanto)
-- ============================================================

-- Habilitar RLS nas tabelas principais
alter table d_produtos          enable row level security;
alter table f_orcado_liberacao  enable row level security;
alter table f_forecast_sop      enable row level security;
alter table f_sd2_saidas        enable row level security;
alter table f_sd3_entradas      enable row level security;
alter table f_estoque           enable row level security;
alter table f_producao_real     enable row level security;
alter table f_mps_liberacoes    enable row level security;
alter table f_mps_producao      enable row level security;
alter table upload_log          enable row level security;

-- Por enquanto: acesso total (sem auth real)
-- Quando ativar Supabase Auth, troque por políticas por usuário/role

create policy "Public read all" on d_produtos         for select using (true);
create policy "Public read all" on f_orcado_liberacao for select using (true);
create policy "Public read all" on f_forecast_sop     for select using (true);
create policy "Public read all" on f_sd2_saidas       for select using (true);
create policy "Public read all" on f_sd3_entradas     for select using (true);
create policy "Public read all" on f_estoque          for select using (true);
create policy "Public read all" on f_producao_real    for select using (true);
create policy "Public read all" on f_mps_liberacoes   for select using (true);
create policy "Public read all" on f_mps_producao     for select using (true);
create policy "Public read all" on upload_log         for select using (true);

create policy "Service insert" on d_produtos         for insert with check (true);
create policy "Service insert" on f_orcado_liberacao for insert with check (true);
create policy "Service insert" on f_forecast_sop     for insert with check (true);
create policy "Service insert" on f_sd2_saidas       for insert with check (true);
create policy "Service insert" on f_sd3_entradas     for insert with check (true);
create policy "Service insert" on f_estoque          for insert with check (true);
create policy "Service insert" on f_producao_real    for insert with check (true);
create policy "Service insert" on f_mps_liberacoes   for insert with check (true);
create policy "Service insert" on f_mps_producao     for insert with check (true);
create policy "Service insert" on upload_log         for insert with check (true);

create policy "Service delete" on d_produtos         for delete using (true);
create policy "Service delete" on f_orcado_liberacao for delete using (true);
create policy "Service delete" on f_forecast_sop     for delete using (true);
create policy "Service delete" on f_sd2_saidas       for delete using (true);
create policy "Service delete" on f_sd3_entradas     for delete using (true);
create policy "Service delete" on f_estoque          for delete using (true);
create policy "Service delete" on f_producao_real    for delete using (true);
create policy "Service delete" on f_mps_liberacoes   for delete using (true);
create policy "Service delete" on f_mps_producao     for delete using (true);
