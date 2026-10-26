BEGIN;

INSERT INTO public.professionals (id, name) VALUES
  ('11111111-0000-4000-8000-000000000001', 'Profissional Atividade A'),
  ('11111111-0000-4000-8000-000000000002', 'Profissional Atividade B');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('11111111-0000-4000-8000-000000000011', 'atividade-a@example.test',
    '{"roles":["professional"],"professional_id":"11111111-0000-4000-8000-000000000001"}', '{"name":"Profissional A"}'),
  ('11111111-0000-4000-8000-000000000012', 'atividade-b@example.test',
    '{"roles":["professional"],"professional_id":"11111111-0000-4000-8000-000000000002"}', '{"name":"Profissional B"}'),
  ('11111111-0000-4000-8000-000000000013', 'atividade-paciente@example.test',
    '{"roles":["patient"]}', '{"name":"Paciente Atividade"}'),
  ('11111111-0000-4000-8000-000000000014', 'atividade-dona@example.test',
    '{"roles":["owner"]}', '{"name":"Proprietária"}');
INSERT INTO public.patients (id, name) VALUES
  ('11111111-0000-4000-8000-000000000021', 'Paciente Atividade'),
  ('11111111-0000-4000-8000-000000000022', 'Outro Paciente');
INSERT INTO public.patient_professionals (patient_id, professional_id) VALUES
  ('11111111-0000-4000-8000-000000000021', '11111111-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000022', '11111111-0000-4000-8000-000000000002');
UPDATE public.clinic_settings SET portal_enabled = true WHERE id;
INSERT INTO public.portal_access (patient_id, user_id, relationship) VALUES
  ('11111111-0000-4000-8000-000000000021', '11111111-0000-4000-8000-000000000013', 'self');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000011","role":"authenticated"}', true);
DO $$ DECLARE activity uuid; BEGIN
  IF (SELECT count(*) FROM public.patient_activity_patients()) <> 1 THEN RAISE EXCEPTION 'FALHA: seleção de pacientes da profissional'; END IF;
  activity := public.save_patient_activity_with_checklist(NULL, '11111111-0000-4000-8000-000000000021',
    'Respiração', 'Pratique por cinco minutos.', current_date + 7, NULL,
    '[{"id":"22222222-0000-4000-8000-000000000001","text":"Praticar por cinco minutos"},
      {"id":"22222222-0000-4000-8000-000000000002","text":"Anotar como me senti"}]'::jsonb);
  PERFORM set_config('teste.atividade', activity::text, true);
  IF (SELECT count(*) FROM public.patient_activity_list()) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional não vê atividade própria'; END IF;
  IF (SELECT jsonb_array_length(checklist) FROM public.patient_activity_list() WHERE id = activity) <> 2 THEN
    RAISE EXCEPTION 'FALHA: checklist não chegou à profissional'; END IF;
  BEGIN
    PERFORM public.save_patient_activity(NULL, '11111111-0000-4000-8000-000000000022', 'Outra', 'Segredo', NULL);
    RAISE EXCEPTION 'FALHA: profissional criou atividade para paciente de outra carteira';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000012","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.patient_activity_patients() WHERE id = '11111111-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'FALHA: profissional viu paciente de outra carteira';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_activity_list()) THEN RAISE EXCEPTION 'FALHA: profissional viu atividade de outra'; END IF;
  BEGIN
    PERFORM public.cancel_patient_activity(current_setting('teste.atividade')::uuid);
    RAISE EXCEPTION 'FALHA: profissional cancelou atividade de outra';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000014","role":"authenticated"}', true);
DO $$ DECLARE owner_activity uuid; BEGIN
  IF (SELECT count(*) FROM public.patient_activity_patients()) <> 2 THEN
    RAISE EXCEPTION 'FALHA: proprietária não vê todos os pacientes'; END IF;
  IF (SELECT count(*) FROM public.patient_activity_professionals('11111111-0000-4000-8000-000000000022')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: proprietária não vê profissional vinculada'; END IF;
  IF (SELECT count(*) FROM public.patient_activity_list()) <> 1 THEN
    RAISE EXCEPTION 'FALHA: proprietária não vê tarefa real'; END IF;
  owner_activity := public.save_patient_activity(NULL, '11111111-0000-4000-8000-000000000022',
    'Sono', 'Anote o horário de dormir.', NULL, '11111111-0000-4000-8000-000000000002');
  IF (SELECT count(*) FROM public.patient_activity_list()) <> 2 THEN
    RAISE EXCEPTION 'FALHA: proprietária não criou tarefa real'; END IF;
  BEGIN
    PERFORM public.save_patient_activity(NULL, '11111111-0000-4000-8000-000000000021',
      'Inválida', 'Vínculo incorreto.', NULL, '11111111-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'FALHA: proprietária atribuiu profissional sem vínculo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.cancel_patient_activity(owner_activity);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000013","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.portal_patient_activities('11111111-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'FALHA: portal mostrou atividade antes dos termos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.portal_accept_terms((public.portal_me())->>'terms_version');
  IF (SELECT count(*) FROM public.portal_patient_activities('11111111-0000-4000-8000-000000000021')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: paciente não vê sua atividade';
  END IF;
  IF (SELECT jsonb_array_length(checklist) FROM public.portal_patient_activities('11111111-0000-4000-8000-000000000021')) <> 2 THEN
    RAISE EXCEPTION 'FALHA: paciente não vê checklist'; END IF;
  BEGIN
    PERFORM * FROM public.portal_patient_activities('11111111-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'FALHA: paciente viu atividade de outro';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.portal_complete_patient_activity(current_setting('teste.atividade')::uuid, 'Antes de fazer os itens');
    RAISE EXCEPTION 'FALHA: paciente concluiu sem checklist';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.portal_complete_patient_activity_item(current_setting('teste.atividade')::uuid,
    '22222222-0000-4000-8000-000000000001');
  BEGIN
    PERFORM public.portal_complete_patient_activity_item(current_setting('teste.atividade')::uuid,
      '22222222-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FALHA: paciente marcou item duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.portal_complete_patient_activity_item(current_setting('teste.atividade')::uuid,
    '22222222-0000-4000-8000-000000000002');
  PERFORM public.portal_complete_patient_activity(current_setting('teste.atividade')::uuid, 'Consegui praticar.');
  BEGIN
    PERFORM public.portal_complete_patient_activity(current_setting('teste.atividade')::uuid, 'Resposta repetida');
    RAISE EXCEPTION 'FALHA: paciente concluiu duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM 1 FROM public.patient_activities;
    RAISE EXCEPTION 'FALHA: paciente leu tabela diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000011","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT patient_response FROM public.patient_activity_list() WHERE id = current_setting('teste.atividade')::uuid) <> 'Consegui praticar.' THEN
    RAISE EXCEPTION 'FALHA: profissional não recebeu resposta';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements((SELECT checklist FROM public.patient_activity_list()
    WHERE id = current_setting('teste.atividade')::uuid)) item WHERE item->>'completed_at' IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'FALHA: profissional não vê itens concluídos'; END IF;
  BEGIN
    PERFORM public.save_patient_activity(current_setting('teste.atividade')::uuid, '11111111-0000-4000-8000-000000000021', 'Mudança', 'Depois', NULL);
    RAISE EXCEPTION 'FALHA: atividade concluída foi editada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT 'Atividades dos pacientes: permissões e conclusão passaram.' AS resultado;
ROLLBACK;
