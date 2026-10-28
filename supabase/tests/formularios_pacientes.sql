-- Modelo, atribuição, resposta, pontuação e acesso clínico. Tudo revertido.
BEGIN;
INSERT INTO public.professionals (id, name) VALUES
 ('00000000-0000-4000-8000-0000000d8001', 'Teste Form Prof A'),
 ('00000000-0000-4000-8000-0000000d8002', 'Teste Form Prof B');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
 ('00000000-0000-4000-8000-0000000d8003','teste-form-prof@example.test',
  '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000d8001"}','{"name":"Teste Prof"}'),
 ('00000000-0000-4000-8000-0000000d8004','teste-form-paciente@example.test',
  '{"roles":["patient"]}','{"name":"Teste Paciente"}'),
 ('00000000-0000-4000-8000-0000000d8005','teste-form-owner@example.test',
  '{"roles":["owner"]}','{"name":"Teste Owner"}'),
 ('00000000-0000-4000-8000-0000000d8006','teste-form-outra-prof@example.test',
  '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000d8002"}','{"name":"Outra Prof"}');
INSERT INTO public.patients (id, name) VALUES
 ('00000000-0000-4000-8000-0000000d8007','Teste Form Paciente'),
 ('00000000-0000-4000-8000-0000000d8008','Teste Outro Paciente');
INSERT INTO public.patient_professionals (patient_id, professional_id) VALUES
 ('00000000-0000-4000-8000-0000000d8007','00000000-0000-4000-8000-0000000d8001'),
 ('00000000-0000-4000-8000-0000000d8008','00000000-0000-4000-8000-0000000d8002');
UPDATE public.clinic_settings SET portal_enabled = true WHERE id;
INSERT INTO public.portal_access (patient_id, user_id, relationship)
VALUES ('00000000-0000-4000-8000-0000000d8007','00000000-0000-4000-8000-0000000d8004','self');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d8003","role":"authenticated"}', true);
DO $$ DECLARE template uuid; assignment uuid; cancelled uuid; BEGIN
  template := public.save_patient_form_template(NULL, 'Escala de teste', 'Marque cada resposta.', 'scale',
    '[{"id":"q1","label":"Primeira pergunta","type":"scale","required":true,"options":["Nunca","Às vezes","Sempre"],"reverse":false},
      {"id":"q2","label":"Segunda pergunta","type":"scale","required":true,"options":["Nunca","Às vezes","Sempre"],"reverse":true}]'::jsonb);
  assignment := public.assign_patient_form(template, '00000000-0000-4000-8000-0000000d8007', current_date + 7);
  cancelled := public.assign_patient_form(template, '00000000-0000-4000-8000-0000000d8007', NULL);
  PERFORM public.cancel_patient_form(cancelled);
  PERFORM set_config('teste.form', assignment::text, true);
  IF (SELECT count(*) FROM public.patient_form_assignments_list()) <> 2 OR
     (SELECT status FROM public.patient_form_assignments_list() WHERE id = cancelled) <> 'cancelled' THEN
    RAISE EXCEPTION 'FALHA: envio ou cancelamento não listado'; END IF;
  BEGIN
    PERFORM public.assign_patient_form(template, '00000000-0000-4000-8000-0000000d8008', NULL);
    RAISE EXCEPTION 'FALHA: envio a paciente de outra carteira';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- "obrigatória" fora de verdadeiro/falso travaria o envio do paciente: recusado ao salvar o modelo.
  BEGIN
    PERFORM public.save_patient_form_template(NULL, 'Modelo inválido', '', 'form',
      '[{"id":"q1","label":"Pergunta","type":"text","required":"sim"}]'::jsonb);
    RAISE EXCEPTION 'FALHA: modelo com "required" que não é verdadeiro/falso';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d8004","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.portal_patient_forms('00000000-0000-4000-8000-0000000d8007');
    RAISE EXCEPTION 'FALHA: portal aberto antes dos termos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.portal_accept_terms((public.portal_me())->>'terms_version');
  IF (SELECT count(*) FROM public.portal_patient_forms('00000000-0000-4000-8000-0000000d8007')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: formulário não aparece no portal'; END IF;
  BEGIN
    PERFORM public.portal_submit_patient_form(current_setting('teste.form')::uuid, '{"q1":"2"}'::jsonb);
    RAISE EXCEPTION 'FALHA: resposta obrigatória ausente';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_submit_patient_form(current_setting('teste.form')::uuid, '{"q1":"9","q2":"0"}'::jsonb);
    RAISE EXCEPTION 'FALHA: opção inexistente aceita';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  PERFORM public.portal_submit_patient_form(current_setting('teste.form')::uuid, '{"q1":"2","q2":"0"}'::jsonb);
  IF (SELECT score FROM public.portal_patient_forms('00000000-0000-4000-8000-0000000d8007')) <> 4 THEN
    RAISE EXCEPTION 'FALHA: cálculo da escala reversa'; END IF;
  BEGIN
    PERFORM public.portal_submit_patient_form(current_setting('teste.form')::uuid, '{"q1":"0","q2":"0"}'::jsonb);
    RAISE EXCEPTION 'FALHA: segunda resposta aceita';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM * FROM public.portal_patient_forms('00000000-0000-4000-8000-0000000d8008');
    RAISE EXCEPTION 'FALHA: acesso a outro paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.patient_form_assignments;
    RAISE EXCEPTION 'FALHA: acesso direto à tabela';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d8005","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.clinical_patient_form_results('00000000-0000-4000-8000-0000000d8007');
    RAISE EXCEPTION 'FALHA: proprietária viu resultado clínico';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d8003","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT score FROM public.clinical_patient_form_results('00000000-0000-4000-8000-0000000d8007')) <> 4 THEN
    RAISE EXCEPTION 'FALHA: prontuário não mostra resultado'; END IF;
  IF jsonb_array_length(public.export_clinical_record('00000000-0000-4000-8000-0000000d8007')->'forms') <> 1 THEN
    RAISE EXCEPTION 'FALHA: exportação não contém resultado'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d8006","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.clinical_patient_form_results('00000000-0000-4000-8000-0000000d8007');
    RAISE EXCEPTION 'FALHA: outra profissional viu resultado clínico';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Formulários e escalas dos pacientes passaram.' AS resultado;
ROLLBACK;
