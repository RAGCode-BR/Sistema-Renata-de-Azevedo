-- Transcrição de áudio do WhatsApp do paciente passa a seguir as mesmas regras do assistente de IA.
--
-- Antes: qualquer profissional do paciente (ou a Proprietária) mandava o áudio para transcrição sem conferir
-- IA ligada, limite de custo, termo da profissional e consentimento do paciente; cada clique transcrevia de
-- novo; o texto ficava para sempre em whatsapp_messages, legível pela equipe de atendimento.
-- Agora:
-- - só a profissional responsável, com a IA liberada para o paciente (private.require_ai);
-- - um áudio é transcrito uma vez (pedido em andamento ou já feito é recusado);
-- - o custo entra no limite mensal da IA;
-- - o texto fica numa tabela própria, sem acesso direto, e é apagado no prazo de guarda da IA;
-- - cada transcrição fica no registro de acesso clínico.
-- A coluna antiga whatsapp_messages.audio_transcript não tinha nenhum dado e passa a ficar sempre vazia.

CREATE TABLE public.whatsapp_audio_transcripts (
  message_id uuid PRIMARY KEY REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  transcript text CHECK (length(transcript) <= 12000),
  model text,
  seconds numeric(10,1),
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  delete_after timestamptz,
  deleted_at timestamptz
);
CREATE INDEX whatsapp_audio_transcripts_patient_idx ON public.whatsapp_audio_transcripts (patient_id);
CREATE INDEX whatsapp_audio_transcripts_month_idx ON public.whatsapp_audio_transcripts (created_at);
ALTER TABLE public.whatsapp_audio_transcripts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_audio_transcripts FROM anon, authenticated;

ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_transcricao_fora
  CHECK (audio_transcript IS NULL);

ALTER TABLE public.clinical_access_log DROP CONSTRAINT clinical_access_log_action_check;
ALTER TABLE public.clinical_access_log ADD CONSTRAINT clinical_access_log_action_check
  CHECK (action IN ('view_record', 'export', 'open_document', 'ai_transcript', 'ai_run', 'whatsapp_audio'));

-- O limite mensal da IA soma também as transcrições de áudio.
CREATE OR REPLACE FUNCTION private.ai_month_cost() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(cost_usd) FROM public.ai_runs
      WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')), 0)
    + coalesce((SELECT sum(cost_usd) FROM public.whatsapp_audio_transcripts
      WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')), 0)
$$;

-- Mensagens que podem virar tarefa: o texto da transcrição vem da tabela nova (só a feita e não apagada).
CREATE OR REPLACE FUNCTION public.patient_whatsapp_task_sources(p_patient_id uuid)
RETURNS TABLE (id uuid, body text, audio boolean, transcript text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (private.has_permission('patient_activities.manage_all') OR
    (private.current_professional_id() IS NOT NULL AND private.cares_for(p_patient_id))) THEN
    RAISE EXCEPTION 'Você não tem acesso a este paciente.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT m.id, m.body, m.audio_media_id IS NOT NULL, t.transcript, m.created_at
    FROM public.whatsapp_messages m
    LEFT JOIN public.whatsapp_audio_transcripts t ON t.message_id = m.id AND t.status = 'done' AND t.deleted_at IS NULL
    WHERE m.patient_id = p_patient_id AND m.direction = 'in'
      AND (m.audio_media_id IS NOT NULL OR m.body NOT LIKE '[%]')
    ORDER BY m.created_at DESC LIMIT 50;
END $$;

-- Chamada pela Edge Function patient-task-audio com o token de quem pediu: confere as regras da IA,
-- impede transcrição repetida ou simultânea, registra o acesso e devolve o id do áudio no WhatsApp.
CREATE OR REPLACE FUNCTION public.prepare_patient_whatsapp_audio(p_message_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  message public.whatsapp_messages;
  existing public.whatsapp_audio_transcripts;
  professional uuid;
BEGIN
  SELECT * INTO message FROM public.whatsapp_messages WHERE id = p_message_id;
  IF message.id IS NULL OR message.patient_id IS NULL OR message.audio_media_id IS NULL THEN
    RAISE EXCEPTION 'Áudio não encontrado.' USING ERRCODE = 'P0001'; END IF;
  professional := private.require_ai(message.patient_id);
  SELECT * INTO existing FROM public.whatsapp_audio_transcripts WHERE message_id = message.id FOR UPDATE;
  IF existing.status = 'done' AND existing.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Este áudio já foi transcrito.' USING ERRCODE = 'P0001'; END IF;
  IF existing.status = 'pending' AND existing.created_at > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Este áudio já está sendo transcrito. Aguarde.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.whatsapp_audio_transcripts (message_id, patient_id, professional_id, requested_by)
  VALUES (message.id, message.patient_id, professional, auth.uid())
  ON CONFLICT (message_id) DO UPDATE SET status = 'pending', professional_id = EXCLUDED.professional_id,
    requested_by = EXCLUDED.requested_by, transcript = NULL, model = NULL, seconds = NULL, cost_usd = 0,
    created_at = now(), finished_at = NULL, delete_after = NULL, deleted_at = NULL;
  PERFORM private.log_clinical_access(message.patient_id, 'whatsapp_audio', message.id);
  RETURN message.audio_media_id;
END $$;

-- Só a Edge Function (chave de serviço): grava o texto, o custo e o prazo de guarda.
DROP FUNCTION public.finish_patient_whatsapp_audio(uuid, text);
CREATE FUNCTION public.finish_patient_whatsapp_audio(p_message_id uuid, p_transcript text, p_model text,
  p_seconds numeric, p_cost_usd numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_transcript, ''))) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'Transcrição inválida.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.whatsapp_audio_transcripts SET status = 'done', transcript = trim(p_transcript), model = left(p_model, 100),
    seconds = p_seconds, cost_usd = greatest(coalesce(p_cost_usd, 0), 0), finished_at = now(),
    delete_after = now() + make_interval(days => coalesce((SELECT retention_days FROM public.ai_settings LIMIT 1), 7))
  WHERE message_id = p_message_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de transcrição não encontrado.' USING ERRCODE = 'P0001'; END IF;
END $$;

-- Só a Edge Function: falha na transcrição libera um novo pedido na hora.
CREATE FUNCTION public.fail_patient_whatsapp_audio(p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_audio_transcripts SET status = 'failed', finished_at = now()
  WHERE message_id = p_message_id AND status = 'pending';
END $$;

-- A tarefa criada de um áudio exige a transcrição feita (e ainda guardada).
CREATE OR REPLACE FUNCTION public.save_patient_activity_from_whatsapp(p_id uuid, p_patient_id uuid, p_title text,
  p_instructions text, p_due_date date, p_professional_id uuid, p_checklist jsonb,
  p_message_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved uuid; source public.whatsapp_messages;
BEGIN
  IF NOT (private.has_permission('patient_activities.manage_all') OR
    (private.current_professional_id() IS NOT NULL AND private.cares_for(p_patient_id))) THEN
    RAISE EXCEPTION 'Você não tem acesso a este paciente.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO source FROM public.whatsapp_messages WHERE id = p_message_id AND direction = 'in'
    AND patient_id = p_patient_id;
  IF source.id IS NULL OR (source.audio_media_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_audio_transcripts t
      WHERE t.message_id = source.id AND t.status = 'done' AND t.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Mensagem de origem inválida ou áudio ainda não transcrito.' USING ERRCODE = 'P0001'; END IF;
  saved := public.save_patient_activity_with_checklist(p_id, p_patient_id, p_title,
    p_instructions, p_due_date, p_professional_id, p_checklist);
  UPDATE public.patient_activities SET source_whatsapp_message_id = p_message_id WHERE id = saved;
  RETURN saved;
END $$;

-- Guarda: apaga o texto no prazo e destrava pedidos que ficaram pela metade.
CREATE FUNCTION private.purge_whatsapp_audio_transcripts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.whatsapp_audio_transcripts SET transcript = NULL, deleted_at = now()
  WHERE deleted_at IS NULL AND delete_after <= now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  UPDATE public.whatsapp_audio_transcripts SET status = 'failed', finished_at = now()
  WHERE status = 'pending' AND created_at < now() - interval '1 hour';
  RETURN affected;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ia-limpeza-audios', '20 4 * * *', 'SELECT private.purge_whatsapp_audio_transcripts()');
  END IF;
END $$;

REVOKE ALL ON FUNCTION private.purge_whatsapp_audio_transcripts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_patient_whatsapp_audio(uuid, text, text, numeric, numeric),
  public.fail_patient_whatsapp_audio(uuid), public.prepare_patient_whatsapp_audio(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_patient_whatsapp_audio(uuid, text, text, numeric, numeric),
  public.fail_patient_whatsapp_audio(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_patient_whatsapp_audio(uuid) TO authenticated;
