-- Mensagem e áudio do WhatsApp viram somente tarefa revisada por pessoa autorizada.
BEGIN;
INSERT INTO public.professionals (id, name) VALUES ('00000000-0000-4000-8000-0000000d7001', 'Teste Tarefa WhatsApp Prof');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
 ('00000000-0000-4000-8000-0000000d7002', 'teste-tarefa-whatsapp-owner@example.test', '{"roles":["owner"]}', '{"name":"Teste Owner"}'),
 ('00000000-0000-4000-8000-0000000d7003', 'teste-tarefa-whatsapp-prof@example.test',
  '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-0000000d7001"}', '{"name":"Teste Prof"}');
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
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000d7003","role":"authenticated"}', true);
DO $$ DECLARE saved uuid; BEGIN
  IF (SELECT count(*) FROM public.patient_whatsapp_task_sources('00000000-0000-4000-8000-0000000d7004')) <> 3 THEN
    RAISE EXCEPTION 'FALHA: profissional não vê mensagens do próprio paciente'; END IF;
  IF public.prepare_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006') <> 'media-d7006' THEN
    RAISE EXCEPTION 'FALHA: mídia não encontrada'; END IF;
  BEGIN
    PERFORM public.save_patient_activity_from_whatsapp(NULL, '00000000-0000-4000-8000-0000000d7004',
      'Áudio', 'Revisado', NULL, NULL, '[]'::jsonb, '00000000-0000-4000-8000-0000000d7006');
    RAISE EXCEPTION 'FALHA: áudio sem transcrição aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF; END;
  saved := public.save_patient_activity_from_whatsapp(NULL, '00000000-0000-4000-8000-0000000d7004',
    'Leitura diária', 'Ler dez páginas por dia', NULL, NULL, '[]'::jsonb, '00000000-0000-4000-8000-0000000d7005');
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.finish_patient_whatsapp_audio('00000000-0000-4000-8000-0000000d7006', 'Fazer caminhada curta');
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patient_activities WHERE
    source_whatsapp_message_id = '00000000-0000-4000-8000-0000000d7005' AND title = 'Leitura diária') THEN
    RAISE EXCEPTION 'FALHA: fonte da tarefa não foi registrada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE id = '00000000-0000-4000-8000-0000000d7006'
    AND audio_transcript = 'Fazer caminhada curta') THEN RAISE EXCEPTION 'FALHA: transcrição não foi guardada'; END IF;
END $$;
ROLLBACK;
