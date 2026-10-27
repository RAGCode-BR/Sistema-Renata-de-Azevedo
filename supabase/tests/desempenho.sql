-- Indicadores financeiros, filtros e motivo de saída; transação revertida.
BEGIN;
INSERT INTO public.professionals (id, name) VALUES
  ('00000000-0000-4000-8000-0000000d6001', 'Teste Desempenho A'),
  ('00000000-0000-4000-8000-0000000d6002', 'Teste Desempenho B');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-4000-8000-0000000d6003', 'teste-desempenho-owner@example.test',
  '{"roles":["owner"]}', '{"name":"Teste Desempenho"}');
INSERT INTO public.lead_sources (id, name) VALUES ('00000000-0000-4000-8000-0000000d6004', 'Teste Desempenho Origem');
INSERT INTO public.campaigns (id, name, source_id, budget) VALUES
  ('00000000-0000-4000-8000-0000000d6005', 'Teste Desempenho Campanha', '00000000-0000-4000-8000-0000000d6004', 100);
INSERT INTO public.patients (id, name, source_id) VALUES
  ('00000000-0000-4000-8000-0000000d6006', 'Teste Desempenho Paciente', '00000000-0000-4000-8000-0000000d6004');
INSERT INTO public.patient_professionals (patient_id, professional_id) VALUES
  ('00000000-0000-4000-8000-0000000d6006', '00000000-0000-4000-8000-0000000d6001');
INSERT INTO public.leads (name, stage_id, source_id, campaign_id, preferred_professional_id, patient_id, converted_at)
VALUES ('Teste Desempenho Lead', (SELECT id FROM public.lead_stages WHERE kind = 'won' LIMIT 1),
  '00000000-0000-4000-8000-0000000d6004', '00000000-0000-4000-8000-0000000d6005',
  '00000000-0000-4000-8000-0000000d6001', '00000000-0000-4000-8000-0000000d6006', now());
INSERT INTO public.payments (patient_id, amount, method, received_at)
VALUES ('00000000-0000-4000-8000-0000000d6006', 150, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d6003","role":"authenticated"}', true);
DO $$
DECLARE r jsonb; today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  BEGIN
    PERFORM public.save_patient('00000000-0000-4000-8000-0000000d6006',
      '{"name":"Teste Desempenho Paciente","status":"discharged"}'::jsonb,
      ARRAY['00000000-0000-4000-8000-0000000d6001']::uuid[]);
    RAISE EXCEPTION 'FALHA: encerramento sem motivo aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.save_patient('00000000-0000-4000-8000-0000000d6006',
    '{"name":"Teste Desempenho Paciente","status":"discharged","exit_reason":"Alta"}'::jsonb,
    ARRAY['00000000-0000-4000-8000-0000000d6001']::uuid[]);
  r := public.report_performance(today, today, '00000000-0000-4000-8000-0000000d6001',
    '00000000-0000-4000-8000-0000000d6004');
  IF (r->>'new_patients')::int <> 1 OR (r->>'ended_patients')::int <> 1
    OR (r->>'converted')::int <> 1 OR (r->>'estimated_cac')::numeric <> 100
    OR (r->>'observed_ltv')::numeric <> 150 OR r->'exit_reasons'->0->>'name' <> 'Alta' THEN
    RAISE EXCEPTION 'FALHA: cálculo: %', r;
  END IF;
  r := public.report_performance(today, today, '00000000-0000-4000-8000-0000000d6002',
    '00000000-0000-4000-8000-0000000d6004');
  IF (r->>'new_patients')::int <> 0 OR (r->>'leads')::int <> 0 OR (r->>'ended_patients')::int <> 0 THEN
    RAISE EXCEPTION 'FALHA: filtro por profissional: %', r;
  END IF;
END $$;
ROLLBACK;
