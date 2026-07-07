-- ============================================================
-- 004: Fecha o acesso direto via anon/authenticated key
-- ============================================================
--
-- Contexto:
-- As policies criadas em 002_storage_rls.sql eram "using (true)" sem
-- restrição de role. Isso significa que qualquer requisição usando a
-- anon key (que fica visível no bundle do frontend) conseguia ler e
-- escrever essas tabelas direto no Supabase, sem passar pela API.
--
-- Confirmado que o frontend NUNCA usa supabase.from(...) para essas
-- tabelas — todo acesso a dado passa pela API (FastAPI), que usa a
-- service_role key. A service_role sempre ignora RLS (BYPASSRLS),
-- então remover as policies de anon/authenticated abaixo não quebra
-- nada da aplicação: só fecha o acesso direto de fora.
--
-- Depois desta migration: RLS continua habilitado e SEM nenhuma
-- policy para anon/authenticated nessas tabelas -> acesso negado por
-- padrão para qualquer client que não seja a service_role.

drop policy if exists "Public read all" on d_produtos;
drop policy if exists "Public read all" on f_orcado_liberacao;
drop policy if exists "Public read all" on f_forecast_sop;
drop policy if exists "Public read all" on f_sd2_saidas;
drop policy if exists "Public read all" on f_sd3_entradas;
drop policy if exists "Public read all" on f_estoque;
drop policy if exists "Public read all" on f_producao_real;
drop policy if exists "Public read all" on f_mps_liberacoes;
drop policy if exists "Public read all" on f_mps_producao;
drop policy if exists "Public read all" on upload_log;

drop policy if exists "Service insert" on d_produtos;
drop policy if exists "Service insert" on f_orcado_liberacao;
drop policy if exists "Service insert" on f_forecast_sop;
drop policy if exists "Service insert" on f_sd2_saidas;
drop policy if exists "Service insert" on f_sd3_entradas;
drop policy if exists "Service insert" on f_estoque;
drop policy if exists "Service insert" on f_producao_real;
drop policy if exists "Service insert" on f_mps_liberacoes;
drop policy if exists "Service insert" on f_mps_producao;
drop policy if exists "Service insert" on upload_log;

drop policy if exists "Service delete" on d_produtos;
drop policy if exists "Service delete" on f_orcado_liberacao;
drop policy if exists "Service delete" on f_forecast_sop;
drop policy if exists "Service delete" on f_sd2_saidas;
drop policy if exists "Service delete" on f_sd3_entradas;
drop policy if exists "Service delete" on f_estoque;
drop policy if exists "Service delete" on f_producao_real;
drop policy if exists "Service delete" on f_mps_liberacoes;
drop policy if exists "Service delete" on f_mps_producao;

-- Garantia extra (defesa em profundidade): revoga qualquer grant
-- direto de tabela que porventura exista para anon/authenticated,
-- além das policies de RLS.
revoke all on d_produtos          from anon, authenticated;
revoke all on f_orcado_liberacao  from anon, authenticated;
revoke all on f_forecast_sop      from anon, authenticated;
revoke all on f_sd2_saidas        from anon, authenticated;
revoke all on f_sd3_entradas      from anon, authenticated;
revoke all on f_estoque           from anon, authenticated;
revoke all on f_producao_real     from anon, authenticated;
revoke all on f_mps_liberacoes    from anon, authenticated;
revoke all on f_mps_producao      from anon, authenticated;
revoke all on upload_log          from anon, authenticated;

-- ============================================================
-- IMPORTANTE — leia antes de rodar em produção
-- ============================================================
-- Esta migration só cobre as tabelas que existem nos arquivos
-- 001_initial_schema.sql / 002_storage_rls.sql / 003_fix_estoque.sql.
--
-- O código dos routers (desvios, mrp, calendario_paradas,
-- ajustes_compras_ops, aging_estoque, liberacao_executiva, usuarios_app,
-- faturamento, ops) referencia tabelas que NÃO aparecem em nenhuma
-- migration deste projeto — provavelmente foram criadas direto no
-- SQL Editor do Supabase ao longo do tempo.
--
-- Isso significa que eu não tenho visibilidade das policies atuais
-- dessas tabelas a partir do código. Especialmente importante:
-- usuarios_app (login e permissões dos usuários).
--
-- Antes de considerar o banco fechado de verdade, entre no
-- Supabase Studio > Authentication > Policies (ou rode a query abaixo
-- no SQL Editor) e confira se alguma dessas tabelas também está com
-- "using (true)" sem restrição de role:
--
--   select schemaname, tablename, policyname, roles, qual
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename;
--
-- Qualquer policy que aparecer com roles = {public} e qual = "true"
-- tem o mesmo problema resolvido aqui e deve ser tratada do mesmo jeito
-- (drop da policy pública + revoke de anon/authenticated).
