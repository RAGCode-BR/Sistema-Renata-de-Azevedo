-- Cenário de teste do Bloco 9 (mês passado). Removido por cleanup-e2e.sql.
INSERT INTO public.professionals (id, name) VALUES ('00000000-0000-4000-8000-00000000e901', 'Teste Relatório Prof');
INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-00000000e902', 'Paciente Relatório E2E');
INSERT INTO public.patient_professionals VALUES ('00000000-0000-4000-8000-00000000e902', '00000000-0000-4000-8000-00000000e901');
WITH base AS (SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month' AS m)
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at, status)
SELECT ('00000000-0000-4000-8000-00000000e91' || n)::uuid, '00000000-0000-4000-8000-00000000e902', '00000000-0000-4000-8000-00000000e901',
  (base.m + (n * 7 + 2) * interval '1 day' + interval '10 hours') AT TIME ZONE 'America/Sao_Paulo',
  (base.m + (n * 7 + 2) * interval '1 day' + interval '10 hours 50 minutes') AT TIME ZONE 'America/Sao_Paulo',
  (ARRAY['completed', 'completed', 'missed'])[n]
FROM base, generate_series(1, 3) n;
INSERT INTO public.charges (id, patient_id, professional_id, appointment_id, description, competence_date, due_date, amount)
SELECT ('00000000-0000-4000-8000-00000000e92' || right(a.id::text, 1))::uuid, a.patient_id, a.professional_id, a.id, 'Sessão teste relatório',
  (a.starts_at AT TIME ZONE 'America/Sao_Paulo')::date, (a.starts_at AT TIME ZONE 'America/Sao_Paulo')::date, 250
FROM public.appointments a WHERE a.patient_id = '00000000-0000-4000-8000-00000000e902' AND a.status = 'completed';
INSERT INTO public.payments (id, patient_id, amount, method, received_at)
SELECT '00000000-0000-4000-8000-00000000e931', '00000000-0000-4000-8000-00000000e902', 250, 'pix', min(competence_date)
FROM public.charges WHERE patient_id = '00000000-0000-4000-8000-00000000e902';
INSERT INTO public.payment_allocations (payment_id, charge_id, amount)
SELECT '00000000-0000-4000-8000-00000000e931', id, 250 FROM public.charges WHERE patient_id = '00000000-0000-4000-8000-00000000e902' ORDER BY competence_date LIMIT 1;
INSERT INTO public.expenses (description, category_id, cost_center_id, amount, competence_date, due_date, paid_at)
SELECT 'Relatório E2E despesa', (SELECT id FROM public.finance_categories WHERE name = 'Sistemas'), (SELECT id FROM public.cost_centers WHERE name = 'Administrativo'),
  120, d, d, d FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month' + interval '9 days')::date AS d) x;
SELECT (SELECT count(*) FROM public.appointments WHERE patient_id = '00000000-0000-4000-8000-00000000e902') AS sessoes,
  (SELECT count(*) FROM public.charges WHERE patient_id = '00000000-0000-4000-8000-00000000e902') AS cobrancas;
