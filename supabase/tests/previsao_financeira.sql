-- Previsão por vencimento: pagamento parcial, vencidos, saídas e permissões.
BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000f4c01', 'previsao-financeiro@example.test', '{"roles":["finance"]}', '{"name":"Teste Previsao"}'),
  ('00000000-0000-4000-8000-0000000f4c02', 'previsao-recepcao@example.test', '{"roles":["reception"]}', '{"name":"Teste Recepcao"}');
INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000f4c03', 'Paciente Previsao');

CREATE TEMP TABLE forecast_before (month date, expected_in numeric, planned_out numeric, net numeric);
GRANT ALL ON forecast_before TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f4c01","role":"authenticated"}', true);
INSERT INTO forecast_before SELECT * FROM public.finance_forecast(12);
RESET ROLE;

INSERT INTO public.charges (id, patient_id, description, competence_date, due_date, amount) VALUES
  ('00000000-0000-4000-8000-0000000f4c04', '00000000-0000-4000-8000-0000000f4c03', 'Cobrança futura teste', private.local_today(), private.local_today() + 40, 300),
  ('00000000-0000-4000-8000-0000000f4c05', '00000000-0000-4000-8000-0000000f4c03', 'Cobrança vencida teste', private.local_today(), private.local_today() - 5, 50);
INSERT INTO public.expenses (description, category_id, cost_center_id, amount, competence_date, due_date) VALUES
  ('Despesa futura teste', (SELECT id FROM public.finance_categories LIMIT 1), (SELECT id FROM public.cost_centers LIMIT 1), 80, private.local_today(), private.local_today() + 40),
  ('Despesa vencida teste', (SELECT id FROM public.finance_categories LIMIT 1), (SELECT id FROM public.cost_centers LIMIT 1), 30, private.local_today(), private.local_today() - 5);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f4c01","role":"authenticated"}', true);
SELECT public.register_payment('00000000-0000-4000-8000-0000000f4c03', 100, 'pix', private.local_today(),
  ARRAY['00000000-0000-4000-8000-0000000f4c04']::uuid[], NULL);
DO $$
DECLARE
  due_month date := date_trunc('month', private.local_today() + 40)::date;
  future_in numeric; future_out numeric; late_in numeric; late_out numeric;
BEGIN
  SELECT f.expected_in - b.expected_in, f.planned_out - b.planned_out INTO future_in, future_out
  FROM public.finance_forecast(12) f JOIN forecast_before b ON b.month = f.month WHERE f.month = due_month;
  SELECT f.expected_in - b.expected_in, f.planned_out - b.planned_out INTO late_in, late_out
  FROM public.finance_forecast(12) f JOIN forecast_before b ON b.month IS NULL AND f.month IS NULL;
  IF future_in <> 200 OR future_out <> 80 OR late_in <> 50 OR late_out <> 30 THEN
    RAISE EXCEPTION 'FALHA: previsão futura (%, %) e vencida (%, %)', future_in, future_out, late_in, late_out;
  END IF;
  IF (SELECT count(*) FROM public.finance_forecast(12)) <> 13 THEN
    RAISE EXCEPTION 'FALHA: previsão deve ter vencidos e 12 meses';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f4c02","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.finance_forecast(12);
    RAISE EXCEPTION 'FALHA: recepção viu previsão completa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
