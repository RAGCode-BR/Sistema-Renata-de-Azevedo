-- Verificações de segurança da estrutura do banco. Rodar com: npm run test:db
-- Não cria nem altera dados (transação desfeita no final). Cada falha interrompe com "FALHA: ...".
-- Complementa permissions.sql (que testa cada perfil, inclusive a varredura com conta de paciente).
BEGIN;

DO $$
DECLARE
  found text;
BEGIN
  -- 1. Toda tabela do schema public tem RLS ligado.
  SELECT string_agg(c.relname, ', ') INTO found
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: tabelas sem RLS: %', found; END IF;

  -- 2. Visitante não logado (anon) não tem nenhum privilégio em tabelas, views ou sequências do public.
  SELECT string_agg(DISTINCT c.relname, ', ') INTO found
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: anon com acesso a: %', found; END IF;

  -- 3. Visitante não logado não executa nenhuma função dos schemas public e private.
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO found
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private') AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: anon executa: %', found; END IF;

  -- 4. Funções SECURITY DEFINER (rodam com privilégio do dono) têm search_path fixo.
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO found
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private') AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: SECURITY DEFINER sem search_path: %', found; END IF;

  -- 5. O schema private (funções auxiliares) não tem tabelas nem é exposto pela API.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'private' AND c.relkind IN ('r', 'v')) THEN
    RAISE EXCEPTION 'FALHA: há tabelas ou views no schema private';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE') THEN RAISE EXCEPTION 'FALHA: anon usa o schema private'; END IF;

  -- 6. Arquivos: todos os buckets são privados (links só assinados e temporários).
  SELECT string_agg(id, ', ') INTO found FROM storage.buckets WHERE public;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: buckets públicos: %', found; END IF;

  -- 7. Views do public respeitam o RLS de quem consulta (security_invoker).
  SELECT string_agg(c.relname, ', ') INTO found
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'] OR c.reloptions @> ARRAY['security_invoker=on'], false);
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: views sem security_invoker: %', found; END IF;

  -- 8. Funções que só a chave de serviço chama (Edge Functions) não estão liberadas para contas logadas.
  SELECT string_agg(p.proname, ', ') INTO found
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('capture_lead', 'portal_grant_access', 'ai_finish_run', 'set_google_calendar_as_owner',
      'whatsapp_inbound', 'whatsapp_status', 'whatsapp_enqueue_due')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: funções internas liberadas para contas logadas: %', found; END IF;

  -- 9. Perfis e permissões: a tabela role_permissions é exatamente a matriz documentada (docs/matriz-de-acesso.md).
  --    Mudar permissões exige mudar este teste e a matriz juntos.
  -- Profissional e Paciente não têm permissões de cargo: o acesso vem do vínculo com o paciente.
  WITH expected(x) AS (SELECT unnest(ARRAY[
      'owner:appointments.manage', 'owner:appointments.view_all', 'owner:billing.manage', 'owner:billing.view', 'owner:calendars.view_all',
      'owner:crm.manage', 'owner:crm.view', 'owner:finance.manage', 'owner:finance.view', 'owner:messages.manage',
      'owner:patients.manage', 'owner:patients.view_all', 'owner:professionals.manage', 'owner:settings.manage', 'owner:tasks.manage', 'owner:patient_activities.manage_all',
      'owner:users.manage',
      'manager:appointments.manage', 'manager:appointments.view_all', 'manager:billing.manage', 'manager:billing.view', 'manager:calendars.view_all',
      'manager:crm.manage', 'manager:crm.view', 'manager:messages.manage', 'manager:patients.manage', 'manager:patients.view_all',
      'manager:professionals.manage', 'manager:tasks.manage',
      'reception:appointments.manage', 'reception:appointments.view_all', 'reception:billing.manage', 'reception:billing.view', 'reception:crm.manage',
      'reception:crm.view', 'reception:messages.manage', 'reception:patients.manage', 'reception:patients.view_all',
      'finance:billing.manage', 'finance:billing.view', 'finance:finance.manage', 'finance:finance.view'
    ])), actual(x) AS (SELECT role || ':' || permission FROM public.role_permissions)
  SELECT string_agg(d, ', ') INTO found FROM (
    SELECT 'sobrando ' || x AS d FROM (SELECT x FROM actual EXCEPT SELECT x FROM expected) a
    UNION ALL SELECT 'faltando ' || x FROM (SELECT x FROM expected EXCEPT SELECT x FROM actual) b
  ) diff;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: permissões diferentes da matriz documentada: %', found; END IF;
END $$;

SELECT 'Todas as verificações de segurança passaram.' AS resultado;
ROLLBACK;
