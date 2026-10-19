-- Bloco 14: ajustes apontados pelo verificador do Supabase (supabase db advisors).
-- Nada muda em quem vê ou faz o quê; só a forma das regras.
--
-- 1. Funções auxiliares com search_path fixo (evita que um objeto com o mesmo nome em outro schema seja
--    usado no lugar do esperado).
-- 2. Regras que usam auth.uid() passam a usar (select auth.uid()): o valor é calculado uma vez por
--    consulta, não uma vez por linha.
-- 3. Tabelas do financeiro com uma regra "ALL" (que também valia para leitura) somada à regra de leitura:
--    passam a ter uma regra só de leitura e regras separadas para incluir, alterar e excluir.

ALTER FUNCTION private.occupies_slot(text) SET search_path = '';
ALTER FUNCTION private.patient_of_path(text) SET search_path = '';
ALTER FUNCTION private.professional_of_path(text) SET search_path = '';

ALTER POLICY "cada um vê a própria conta; quem gerencia usuários vê todas" ON public.profiles
  USING (id = (SELECT auth.uid()) OR private.has_permission('users.manage'));
ALTER POLICY "cada um vê os próprios perfis; quem gerencia usuários vê todos" ON public.user_roles
  USING (user_id = (SELECT auth.uid()) OR private.has_permission('users.manage'));
ALTER POLICY "notificações: só as próprias" ON public.notifications
  USING (user_id = (SELECT auth.uid()));
ALTER POLICY "aparelhos: só os próprios" ON public.push_devices
  USING (user_id = (SELECT auth.uid()));

-- Centros de custo, despesas e categorias: lê quem vê ou gerencia o financeiro; altera quem gerencia.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('cost_centers', 'centros de custo: financeiro altera', 'centros de custo: financeiro lê', 'centros de custo'),
    ('expenses', 'despesas: financeiro lança', 'despesas: financeiro lê', 'despesas'),
    ('finance_categories', 'categorias: financeiro altera', 'categorias: financeiro lê', 'categorias')
  ) AS t(tbl, all_policy, read_policy, label)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', item.all_policy, item.tbl);
    EXECUTE format('ALTER POLICY %I ON public.%I USING (private.has_permission(%L) OR private.has_permission(%L))',
      item.read_policy, item.tbl, 'finance.view', 'finance.manage');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (private.has_permission(%L))',
      item.label || ': financeiro inclui', item.tbl, 'finance.manage');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (private.has_permission(%L)) WITH CHECK (private.has_permission(%L))',
      item.label || ': financeiro altera', item.tbl, 'finance.manage', 'finance.manage');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (private.has_permission(%L))',
      item.label || ': financeiro exclui', item.tbl, 'finance.manage');
  END LOOP;
END $$;

-- Preços por profissional: lê quem vê cobranças ou o financeiro; altera quem gerencia o financeiro.
DROP POLICY "preços: quem gerencia o financeiro altera" ON public.session_prices;
ALTER POLICY "preços: quem vê cobranças lê" ON public.session_prices
  USING (private.has_permission('billing.view') OR private.has_permission('finance.view') OR private.has_permission('finance.manage'));
CREATE POLICY "preços: financeiro inclui" ON public.session_prices
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('finance.manage'));
CREATE POLICY "preços: financeiro altera" ON public.session_prices
  FOR UPDATE TO authenticated USING (private.has_permission('finance.manage')) WITH CHECK (private.has_permission('finance.manage'));
CREATE POLICY "preços: financeiro exclui" ON public.session_prices
  FOR DELETE TO authenticated USING (private.has_permission('finance.manage'));
