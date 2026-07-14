-- ============================================================
-- 006: Fecha de novo o acesso público que tinha sido reaberto
-- ============================================================
--
-- Contexto: a migration 004_restrict_rls_authenticated.sql já tinha
-- corrigido exatamente este problema (policies "using (true)" sem
-- restrição de role, que deixavam 10 tabelas acessíveis via anon key
-- sem nenhum login). Comparando com um dump real do banco de produção
-- feito em 14/07/2026, essas policies abertas ainda estavam ativas --
-- ou seja, a correção da migration 004 nunca chegou a ser aplicada de
-- fato em produção (só existia no código). Esta migration reaplica a
-- mesma correção direto, e documenta que ela foi executada.
--
-- Confirmado (de novo) que o frontend nunca usa supabase.from(...)
-- para essas tabelas -- todo acesso passa pela API (service_role,
-- que sempre ignora RLS). Fechar isso não afeta a aplicação.

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
-- Verificação de rotina: nunca mais deixar passar sem notar.
-- Rode esta query de vez em quando (ou antes de cada release) --
-- qualquer linha retornada aqui é uma policy pública sem querer:
--
--   select schemaname, tablename, policyname, roles, qual
--   from pg_policies
--   where schemaname = 'public'
--     and roles = '{public}'
--     and qual = 'true'
--   order by tablename;
-- ============================================================