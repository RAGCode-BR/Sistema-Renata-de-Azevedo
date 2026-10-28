-- Mensagem e áudio do WhatsApp viram somente tarefa revisada por pessoa autorizada.
-- O áudio só é transcrito pela profissional responsável, com as mesmas regras do assistente de IA.
BEGIN;
INSERT INTO public.professionals (id, name) VALUES
 ('00000000-0000-4000-8000-0000000d7001', 'Teste Tarefa WhatsApp Prof'),
 ('00000000-0000-4000-8000-0000000d7011', 'Teste Tarefa WhatsApp Outra Prof');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
 ('00000000-0000-4000-8000-0000000d7002', 'teste-tarefa-whatsapp-owner@example.test', '{"roles":["owner"]}', '{"name":"Teste Owner"}'),
 ('00000000-0000-4000-8000-0000000d7003', 'teste-tarefa-whatsapp-prof@example.test',
  '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000d7001"}', '{"name":"Teste Prof"}'),
 ('00000000-0000-4000-8000-0000000d7012', 'teste-tarefa-whatsapp-outra@example.test',
  '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000d7011"}', '{"name":"Teste Outra"}'),
 ('00000000-0000-4000-8000-0000000d7013', 'teste-tarefa-whatsapp-recepcao@example.test', '{"roles":["reception"]}', '{"name":"Teste Recepção"}'),
 ('00000000-0000-4000-8000-0000000d7014', 'teste-tarefa-whatsapp-paciente@example.test', '{"roles":["patient"]}', '{"name":"Teste Paciente"}');
INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000d7004', 'Teste Tarefa WhatsApp Paciente');
INSERT INTO public.patient_professionals (patient_id, professional_id) VALUES
 ('00000000-0000-4000-8000-0000000d7004', '00000000-0000-4000-8000-0000000d7001');
INSERT INTO public.leads (id, name, stage_id) VALUES
 ('00000000-0000-4000-8000-0000000d7007', 'Teste Lead Convertido',
  (SELECT id FROM public.lead_stages WHERE kind = 'open' ORDER BY position LIMIT 1));
INSERT INTO public.whatsapp_messages (id, direction, phone, kind, body, patient_id, wamid, status, audio_media_id)
VALUES ('00000000-0000-4000-8000-0000000d7005', 'in', '55219999991111', 'inbound', 'Ler dez páginas por dia',
  '00000000-0000-4000-8000-0000000d7004', 'teste-texto-d7005', 'received', NULL),
 ('00000000-0000-4000-8000-0000000d7006', 'in', '55219999991111', 'inbound', '[audio]',
  '00000000-0000-4000-8000-0000000d7004', 'teste-audio-d7006', 'received', 'media-d7006');
INSERT INTO public.whatsapp_messages (id, direction, phone, kind, body, lead_id, wamid, status)
VALUES ('00000000-0000-4000-8000-0000000d7008', 'in', '55219999992222', 'inbound', 'Mensagem antes da conversão',
 '00000000-0000-4000-8000-0000000d7007', 'teste-conversao-d7008', 'received');
UPDATE public.leads SET patient_id = '00000000-0000-4000-8000-0000000d7004'
WHERE id = '00000000-0000-4000-8000-0000000d7007';
UPDATE public.ai_settings SET enabled = false WHERE id;

-- Profissional responsável: vê as mensagens; sem a IA liberada, não transcreve.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ DECLARE saved uuid; BEGIN
  IF (SELECT count(*) FROM public.patient_whatsapp_task_sources('00000000-0000-4000-8000-0000000d7004')) <> 3 THEN
    RAISE EXCEPTION 'FALHA: profissional não vê mensagens do próprio paciente'; END IF;
  BEGIN
    PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio transcrito com a IA desligada';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%IA está desligada%' THEN RAISE EXCEPTION 'FALHA: motivo inesperado: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_patient_activity_from_whatsapp(NULL, '00000000-0000-4000-8000-0000000d7004',
      'Áudio', 'Revisado', NULL, NULL, '[]'::jsonb, '00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio sem transcrição aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  saved := public.save_patient_activity_from_whatsapp(NULL, '00000000-0000-4000-8000-0000000d7004',
    'Leitura diária', 'Ler dez páginas por dia', NULL, NULL, '[]'::jsonb, '00000000-0000-4000-8000-0000000d7005');
END $$;
RESET ROLE;

-- IA ligada, sem termo e sem consentimento: ainda recusa; com os dois, libera.
UPDATE public.ai_settings SET enabled = true, monthly_limit_usd = 50 WHERE id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio transcrito sem o termo da profissional';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%termo%' THEN RAISE EXCEPTION 'FALHA: motivo inesperado: %', SQLERRM; END IF;
  END;
END $$;
RESET ROLE;
INSERT INTO public.ai_professional_terms (professional_id, terms_version)
SELECT '00000000-0000-4000-8000-0000000d7001', terms_version FROM public.ai_settings;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio transcrito sem o consentimento do paciente';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%consentimento%' THEN RAISE EXCEPTION 'FALHA: motivo inesperado: %', SQLERRM; END IF;
  END;
END $$;
RESET ROLE;
INSERT INTO public.ai_patient_consents (patient_id) VALUES ('00000000-0000-4000-8000-0000000d7004');

-- Proprietária, outra profissional, Recepção e paciente: nenhum transcreve.
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  who uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['00000000-0000-4000-8000-0000000d7002', '00000000-0000-4000-8000-0000000d7012',
      '00000000-0000-4000-8000-0000000d7013', '00000000-0000-4000-8000-0000000d7014']::uuid[] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
      RAISE EXCEPTION 'FALHA: % transcreveu áudio de paciente', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- Outra profissional, Recepção e paciente também não leem as mensagens do paciente.
  FOREACH who IN ARRAY ARRAY['00000000-0000-4000-8000-0000000d7012', '00000000-0000-4000-8000-0000000d7013',
      '00000000-0000-4000-8000-0000000d7014']::uuid[] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM * FROM public.patient_whatsapp_task_sources('00000000-0000-4000-8000-0000000d7004');
      RAISE EXCEPTION 'FALHA: % leu as mensagens do paciente', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

-- Profissional responsável com tudo liberado: um pedido por vez; funções internas fechadas.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ BEGIN
  IF public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006') <> 'media-d7006' THEN
    RAISE EXCEPTION 'FALHA: mídia não encontrada'; END IF;
  BEGIN
    PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: dois pedidos de transcrição ao mesmo tempo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.finish_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006', 'Falso', 'x', 1, 0);
    RAISE EXCEPTION 'FALHA: conta logada gravou transcrição';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.attach_whatsapp_audio('teste-audio-d7006', 'outra-midia');
    RAISE EXCEPTION 'FALHA: conta logada trocou a mídia do áudio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- A Edge Function grava o texto e o custo.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.finish_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006', 'Fazer caminhada curta',
  'gpt-4o-mini-transcribe', 30, 0.003);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ DECLARE saved uuid; BEGIN
  IF (SELECT transcript FROM public.patient_whatsapp_task_sources('00000000-0000-4000-8000-0000000d7004')
      WHERE id = '00000000-0000-4000-8000-0000000d7006') IS DISTINCT FROM 'Fazer caminhada curta' THEN
    RAISE EXCEPTION 'FALHA: transcrição não aparece para a profissional'; END IF;
  BEGIN
    PERFORM public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio transcrito (e cobrado) duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  saved := public.save_patient_activity_from_whatsapp(NULL, '00000000-0000-4000-8000-0000000d7004',
    'Caminhada', 'Fazer caminhada curta', NULL, NULL, '[]'::jsonb, '00000000-0000-4000-8000-0000000d7006');
END $$;

-- Recepção (lê as conversas) não alcança o texto transcrito.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7013","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.whatsapp_audio_transcripts;
    RAISE EXCEPTION 'FALHA: Recepção leu a tabela de transcrições';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE audio_transcript IS NOT NULL) THEN
    RAISE EXCEPTION 'FALHA: transcrição gravada na tabela de mensagens'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patient_activities WHERE
    source_whatsapp_message_id = '00000000-0000-4000-8000-0000000d7005' AND title = 'Leitura diária')
    OR NOT EXISTS (SELECT 1 FROM public.patient_activities WHERE
    source_whatsapp_message_id = '00000000-0000-4000-8000-0000000d7006' AND title = 'Caminhada') THEN
    RAISE EXCEPTION 'FALHA: fonte da tarefa não foi registrada'; END IF;
  IF private.ai_month_cost() < 0.003 THEN RAISE EXCEPTION 'FALHA: custo da transcrição fora do limite mensal da IA'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clinical_access_log WHERE action = 'whatsapp_audio'
      AND target_id = '00000000-0000-4000-8000-0000000d7006' AND actor_user_id = '00000000-0000-4000-8000-0000000d7003') THEN
    RAISE EXCEPTION 'FALHA: transcrição sem registro no acesso clínico'; END IF;
  IF (SELECT delete_after FROM public.whatsapp_audio_transcripts WHERE message_id = '00000000-0000-4000-8000-0000000d7006') IS NULL THEN
    RAISE EXCEPTION 'FALHA: transcrição sem prazo de guarda'; END IF;
  -- Prazo vencido: o texto é apagado.
  UPDATE public.whatsapp_audio_transcripts SET delete_after = now() - interval '1 minute'
  WHERE message_id = '00000000-0000-4000-8000-0000000d7006';
  PERFORM private.purge_whatsapp_audio_transcripts();
  IF (SELECT transcript FROM public.whatsapp_audio_transcripts WHERE message_id = '00000000-0000-4000-8000-0000000d7006') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: transcrição não foi apagada no fim do prazo'; END IF;
END $$;

SELECT 'Tarefas do WhatsApp: transcrição com as regras da IA e permissões passaram.' AS resultado;
ROLLBACK;
