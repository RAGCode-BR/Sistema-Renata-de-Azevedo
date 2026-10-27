-- Avaliação de lead na agenda, conversão sem duplicar paciente e métricas de comparecimento.
BEGIN;
INSERT INTO public.professionals (id, name) VALUES ('00000000-0000-4000-8000-0000000c5002', 'Teste Avaliacao Profissional');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000c5001', 'teste-avaliacao-owner@example.test', '{"roles":["owner"]}', '{"name":"Teste Avaliacao"}'),
  ('00000000-0000-4000-8000-0000000c5007', 'teste-avaliacao-prof@example.test',
   '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000c5002"}', '{"name":"Teste Prof"}');
INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000c5003', 'Teste Avaliacao Paciente');
INSERT INTO public.campaigns (id, name, budget) VALUES ('00000000-0000-4000-8000-0000000c5004', 'Teste Avaliacao Campanha', 100);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c5001","role":"authenticated"}', true);
DO $$
DECLARE
  lead_id uuid;
  assessment_id uuid;
  cancelled_lead uuid;
  cancelled_assessment uuid;
  starts timestamptz := now() + interval '8 days';
  found record;
BEGIN
  lead_id := public.save_lead(NULL, jsonb_build_object('name', 'Teste Avaliacao Lead', 'phone', '21999991111',
    'campaign_id', '00000000-0000-4000-8000-0000000c5004'));
  assessment_id := public.schedule_lead_assessment(lead_id, '00000000-0000-4000-8000-0000000c5002',
    starts, starts + interval '50 minutes');
  SELECT * INTO found FROM public.lead_assessment_list(lead_id) WHERE id = assessment_id;
  IF found.status <> 'scheduled' OR found.starts_at <> starts OR
    NOT EXISTS (SELECT 1 FROM public.lead_stages s JOIN public.leads l ON l.stage_id = s.id
      WHERE l.id = lead_id AND s.name = 'Primeira consulta agendada') THEN
    RAISE EXCEPTION 'FALHA: avaliação não ficou agendada no funil';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.list_schedule_blocks(starts, starts + interval '1 hour') b
    WHERE b.reason = 'Avaliação · Teste Avaliacao Lead') THEN
    RAISE EXCEPTION 'FALHA: avaliação não ocupou agenda';
  END IF;
  BEGIN
    PERFORM public.schedule_lead_assessment(lead_id, '00000000-0000-4000-8000-0000000c5002',
      starts + interval '1 day', starts + interval '1 day 50 minutes');
    RAISE EXCEPTION 'FALHA: segunda reserva simultânea aceita';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF public.convert_lead(lead_id, '00000000-0000-4000-8000-0000000c5003',
    ARRAY['00000000-0000-4000-8000-0000000c5002']::uuid[]) <> '00000000-0000-4000-8000-0000000c5003' THEN
    RAISE EXCEPTION 'FALHA: conversão criou outro paciente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_professionals WHERE patient_id = '00000000-0000-4000-8000-0000000c5003'
    AND professional_id = '00000000-0000-4000-8000-0000000c5002') THEN
    RAISE EXCEPTION 'FALHA: profissional não vinculada ao paciente existente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_assessment_list(lead_id) WHERE id = assessment_id
    AND status = 'converted' AND appointment_id IS NOT NULL) OR
    NOT EXISTS (SELECT 1 FROM public.appointments WHERE patient_id = '00000000-0000-4000-8000-0000000c5003'
      AND professional_id = '00000000-0000-4000-8000-0000000c5002'
      AND starts_at = starts AND session_type = 'assessment') THEN
    RAISE EXCEPTION 'FALHA: avaliação não virou sessão';
  END IF;
  cancelled_lead := public.save_lead(NULL, jsonb_build_object('name', 'Teste Avaliacao Cancelada', 'phone', '21999993333'));
  cancelled_assessment := public.schedule_lead_assessment(cancelled_lead, '00000000-0000-4000-8000-0000000c5002',
    starts + interval '1 day', starts + interval '1 day 50 minutes');
  PERFORM public.set_lead_assessment_status(cancelled_assessment, 'cancelled');
  IF NOT EXISTS (SELECT 1 FROM public.lead_assessment_list(cancelled_lead)
    WHERE id = cancelled_assessment AND status = 'cancelled')
    OR EXISTS (SELECT 1 FROM public.list_schedule_blocks(starts + interval '1 day', starts + interval '1 day 2 hours') b
      WHERE b.reason = 'Avaliação · Teste Avaliacao Cancelada')
    OR NOT EXISTS (SELECT 1 FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
      WHERE l.id = cancelled_lead AND s.name = 'Em atendimento') THEN
    RAISE EXCEPTION 'FALHA: cancelar avaliação não liberou agenda ou etapa';
  END IF;
END $$;
RESET ROLE;

INSERT INTO public.leads (id, name, phone, campaign_id, stage_id)
VALUES ('00000000-0000-4000-8000-0000000c5005', 'Teste Avaliacao Compareceu', '21999992222',
  '00000000-0000-4000-8000-0000000c5004',
  (SELECT id FROM public.lead_stages WHERE name = 'Primeira consulta agendada'));
INSERT INTO public.lead_assessments (lead_id, professional_id, starts_at, ends_at, status)
VALUES ('00000000-0000-4000-8000-0000000c5005', '00000000-0000-4000-8000-0000000c5002',
  now() - interval '2 days', now() - interval '2 days' + interval '50 minutes', 'attended');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c5001","role":"authenticated"}', true);
DO $$
DECLARE
  attended bigint;
  dashboard jsonb;
BEGIN
  SELECT c.attended INTO attended FROM public.campaign_stats() c WHERE c.id = '00000000-0000-4000-8000-0000000c5004';
  IF attended <> 1 THEN RAISE EXCEPTION 'FALHA: comparecimento na campanha: %', attended; END IF;
  dashboard := public.crm_summary(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  IF (dashboard->>'attended')::bigint < 1 THEN RAISE EXCEPTION 'FALHA: comparecimento no painel'; END IF;
  SELECT r.attended INTO attended FROM public.report_campaigns(
    date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date) r WHERE r.id = '00000000-0000-4000-8000-0000000c5004';
  IF attended <> 1 THEN RAISE EXCEPTION 'FALHA: comparecimento no relatório: %', attended; END IF;
END $$;
RESET ROLE;

INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000c5006', 'Teste Carteira Temporaria');
INSERT INTO public.patient_professionals (patient_id, professional_id)
VALUES ('00000000-0000-4000-8000-0000000c5006', '00000000-0000-4000-8000-0000000c5002');
DELETE FROM public.patient_professionals WHERE patient_id = '00000000-0000-4000-8000-0000000c5006';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c5001","role":"authenticated"}', true);
DO $$
DECLARE flow record;
BEGIN
  SELECT * INTO flow FROM public.crm_professional_flow(
    date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  WHERE professional_id = '00000000-0000-4000-8000-0000000c5002';
  IF flow.linked_now <> 1 OR flow.entries <> 2 OR flow.exits <> 1 THEN
    RAISE EXCEPTION 'FALHA: movimento da carteira: %', flow;
  END IF;
  IF (SELECT count(*) FROM public.patient_professional_history('00000000-0000-4000-8000-0000000c5006')) <> 2 THEN
    RAISE EXCEPTION 'FALHA: entrada e saída não chegaram ao histórico';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c5007","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.lead_assessment_list(NULL);
    RAISE EXCEPTION 'FALHA: profissional acessou avaliações comerciais';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.crm_professional_flow(current_date - 1, current_date);
    RAISE EXCEPTION 'FALHA: profissional acessou carteira comercial geral';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
