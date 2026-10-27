-- Fontes de tarefas para pacientes vindas do número oficial da clínica.
-- Áudio é transcrito apenas quando uma profissional autorizada solicita; envio da tarefa exige revisão humana.
ALTER TABLE public.whatsapp_messages ADD COLUMN audio_media_id text,
  ADD COLUMN audio_transcript text CHECK (length(audio_transcript) <= 12000);
ALTER TABLE public.patient_activities ADD COLUMN source_whatsapp_message_id uuid
  REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL;
CREATE INDEX patient_activities_whatsapp_source_idx ON public.patient_activities (source_whatsapp_message_id)
  WHERE source_whatsapp_message_id IS NOT NULL;

CREATE FUNCTION public.attach_whatsapp_audio(p_wamid text, p_media_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501'; END IF;
  IF length(coalesce(p_media_id, '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Áudio inválido.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.whatsapp_messages SET audio_media_id = p_media_id
  WHERE wamid = p_wamid AND direction = 'in' AND body = '[audio]';
END $$;

CREATE FUNCTION public.patient_whatsapp_task_sources(p_patient_id uuid)
RETURNS TABLE (id uuid, body text, audio boolean, transcript text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (private.has_permission('patient_activities.manage_all') OR
    (private.current_professional_id() IS NOT NULL AND private.cares_for(p_patient_id))) THEN
    RAISE EXCEPTION 'Você não tem acesso a este paciente.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT m.id, m.body, m.audio_media_id IS NOT NULL, m.audio_transcript, m.created_at
    FROM public.whatsapp_messages m WHERE m.patient_id = p_patient_id AND m.direction = 'in'
      AND (m.audio_media_id IS NOT NULL OR m.body NOT LIKE '[%]')
    ORDER BY m.created_at DESC LIMIT 50;
END $$;

CREATE FUNCTION public.prepare_patient_whatsapp_audio(p_message_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE message public.whatsapp_messages;
BEGIN
  SELECT * INTO message FROM public.whatsapp_messages WHERE id = p_message_id;
  IF message.id IS NULL OR message.patient_id IS NULL OR message.audio_media_id IS NULL THEN
    RAISE EXCEPTION 'Áudio não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF NOT (private.has_permission('patient_activities.manage_all') OR
    (private.current_professional_id() IS NOT NULL AND private.cares_for(message.patient_id))) THEN
    RAISE EXCEPTION 'Você não tem acesso a este paciente.' USING ERRCODE = '42501'; END IF;
  RETURN message.audio_media_id;
END $$;

CREATE FUNCTION public.finish_patient_whatsapp_audio(p_message_id uuid, p_transcript text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_transcript, ''))) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'Transcrição inválida.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.whatsapp_messages SET audio_transcript = trim(p_transcript)
  WHERE id = p_message_id AND audio_media_id IS NOT NULL AND direction = 'in';
  IF NOT FOUND THEN RAISE EXCEPTION 'Áudio não encontrado.' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE FUNCTION public.save_patient_activity_from_whatsapp(p_id uuid, p_patient_id uuid, p_title text,
  p_instructions text, p_due_date date, p_professional_id uuid, p_checklist jsonb,
  p_message_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved uuid; source public.whatsapp_messages;
BEGIN
  SELECT * INTO source FROM public.whatsapp_messages WHERE id = p_message_id AND direction = 'in'
    AND patient_id = p_patient_id;
  IF source.id IS NULL OR (source.audio_media_id IS NOT NULL AND source.audio_transcript IS NULL) THEN
    RAISE EXCEPTION 'Mensagem de origem inválida ou áudio ainda não transcrito.' USING ERRCODE = 'P0001'; END IF;
  saved := public.save_patient_activity_with_checklist(p_id, p_patient_id, p_title,
    p_instructions, p_due_date, p_professional_id, p_checklist);
  UPDATE public.patient_activities SET source_whatsapp_message_id = p_message_id WHERE id = saved;
  RETURN saved;
END $$;

REVOKE ALL ON FUNCTION public.attach_whatsapp_audio(text, text),
  public.patient_whatsapp_task_sources(uuid), public.prepare_patient_whatsapp_audio(uuid),
  public.finish_patient_whatsapp_audio(uuid, text),
  public.save_patient_activity_from_whatsapp(uuid, uuid, text, text, date, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_whatsapp_audio(text, text),
  public.finish_patient_whatsapp_audio(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.patient_whatsapp_task_sources(uuid),
  public.prepare_patient_whatsapp_audio(uuid),
  public.save_patient_activity_from_whatsapp(uuid, uuid, text, text, date, uuid, jsonb, uuid) TO authenticated;
