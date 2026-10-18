-- Bloco 11: assistente de documentação clínica com IA. ENTREGUE DESLIGADO.
--
-- Regras (do documento da clínica):
-- - A IA não publica nada no prontuário: gera um RASCUNHO que a profissional revisa e finaliza.
-- - Não diagnostica, não prescreve, não inventa: cada item precisa de trecho de origem na transcrição
--   (conferido na Edge Function ai-draft) e itens com diagnóstico/prescrição são descartados.
-- - Uso exige três autorizações: a clínica ligou (Proprietário(a), com limite mensal de custo), a
--   profissional aceitou o termo de uso e o paciente tem consentimento específico registrado.
-- - Só a profissional responsável pelo paciente usa; cada abertura fica no registro de acesso clínico.
-- - Transcrições e rascunhos são apagados: 7 dias (configurável) depois de a evolução ser finalizada
--   ou o rascunho descartado; no máximo 30 dias depois do envio. Ficam só os dados de uso e custo.
-- - Antes do envio, nome, CPF, telefone, e-mail, endereço e nomes extras informados viram marcadores.

CREATE TABLE public.ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  monthly_limit_usd numeric(10,2) CHECK (monthly_limit_usd IS NULL OR monthly_limit_usd > 0),
  retention_days integer NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 30),
  terms_version text NOT NULL DEFAULT 'v1',
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR monthly_limit_usd IS NOT NULL)
);
INSERT INTO public.ai_settings DEFAULT VALUES;

CREATE TABLE public.ai_professional_terms (
  professional_id uuid PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_patient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  notes text CHECK (length(notes) <= 1000),
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX ai_patient_consents_active ON public.ai_patient_consents (patient_id) WHERE revoked_at IS NULL;

CREATE TABLE public.ai_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('paste', 'file')),
  file_name text,
  content text,
  extra_terms text[] NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT now() + interval '30 days',
  deleted_at timestamptz,
  CHECK (deleted_at IS NOT NULL OR length(content) BETWEEN 50 AND 300000)
);

CREATE TABLE public.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.ai_transcripts(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  model text,
  redacted_text text,
  result jsonb,
  warnings jsonb NOT NULL DEFAULT '[]',
  error text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  decision text CHECK (decision IN ('used', 'discarded')),
  note_id uuid REFERENCES public.clinical_notes(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX ai_runs_month_idx ON public.ai_runs (created_at);

-- Rastro no prontuário: a evolução sabe de qual rascunho de IA nasceu.
ALTER TABLE public.clinical_notes ADD COLUMN ai_run_id uuid REFERENCES public.ai_runs(id) ON DELETE SET NULL;

ALTER TABLE public.clinical_access_log DROP CONSTRAINT clinical_access_log_action_check;
ALTER TABLE public.clinical_access_log ADD CONSTRAINT clinical_access_log_action_check
  CHECK (action IN ('view_record', 'export', 'open_document', 'ai_transcript', 'ai_run'));

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_professional_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_patient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_settings, public.ai_professional_terms, public.ai_patient_consents, public.ai_transcripts, public.ai_runs
  FROM anon, authenticated;

-- Auxiliares ------------------------------------------------------------------------------------

CREATE FUNCTION private.ai_month_cost() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.ai_runs
  WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
$$;

-- Por que a IA não pode ser usada agora para este paciente (nulo = pode).
CREATE FUNCTION private.ai_blocker(patient uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  settings public.ai_settings;
  professional uuid := private.current_professional_id();
BEGIN
  SELECT * INTO settings FROM public.ai_settings LIMIT 1;
  IF NOT settings.enabled THEN RETURN 'A IA está desligada na clínica.'; END IF;
  IF professional IS NULL OR NOT coalesce(private.cares_for(patient), false) THEN RETURN 'Só a profissional responsável usa o assistente.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_professional_terms t WHERE t.professional_id = professional AND t.terms_version = settings.terms_version) THEN
    RETURN 'Aceite o termo de uso do assistente antes de usar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_patient_consents c WHERE c.patient_id = patient AND c.revoked_at IS NULL) THEN
    RETURN 'O paciente não tem consentimento registrado para o uso de IA.';
  END IF;
  IF private.ai_month_cost() >= settings.monthly_limit_usd THEN RETURN 'O limite mensal de custo da IA foi atingido.'; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION private.require_ai(patient uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  blocker text := private.ai_blocker(patient);
BEGIN
  IF blocker IS NOT NULL THEN RAISE EXCEPTION '%', blocker USING ERRCODE = '42501'; END IF;
  RETURN private.current_professional_id();
END $$;

-- Interface: situação, termo e consentimento -----------------------------------------------------

CREATE FUNCTION public.ai_status(p_patient_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
  settings public.ai_settings;
  consent public.ai_patient_consents;
BEGIN
  SELECT * INTO settings FROM public.ai_settings LIMIT 1;
  SELECT * INTO consent FROM public.ai_patient_consents WHERE patient_id = p_patient_id AND revoked_at IS NULL;
  RETURN jsonb_build_object(
    'clinic_enabled', settings.enabled,
    'terms_version', settings.terms_version,
    'terms_accepted', EXISTS (SELECT 1 FROM public.ai_professional_terms t WHERE t.professional_id = professional AND t.terms_version = settings.terms_version),
    'consent_at', consent.granted_at,
    'consent_notes', consent.notes,
    'limit_reached', settings.enabled AND private.ai_month_cost() >= settings.monthly_limit_usd,
    'blocker', private.ai_blocker(p_patient_id)
  );
END $$;

CREATE FUNCTION public.accept_ai_terms() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL THEN RAISE EXCEPTION 'Só profissionais aceitam o termo do assistente.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.ai_professional_terms (professional_id, accepted_by, terms_version)
  VALUES (professional, auth.uid(), (SELECT terms_version FROM public.ai_settings LIMIT 1))
  ON CONFLICT (professional_id) DO UPDATE SET accepted_by = EXCLUDED.accepted_by, terms_version = EXCLUDED.terms_version, accepted_at = now();
END $$;

-- Consentimento do paciente: registrado ou revogado pela profissional responsável.
CREATE FUNCTION public.set_ai_consent(p_patient_id uuid, p_granted boolean, p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_author_of(p_patient_id);
  IF p_granted THEN
    INSERT INTO public.ai_patient_consents (patient_id, granted_by, notes) VALUES (p_patient_id, auth.uid(), nullif(trim(p_notes), ''))
    ON CONFLICT (patient_id) WHERE revoked_at IS NULL DO NOTHING;
  ELSE
    UPDATE public.ai_patient_consents SET revoked_at = now(), revoked_by = auth.uid() WHERE patient_id = p_patient_id AND revoked_at IS NULL;
    -- Revogar apaga o que ainda está guardado deste paciente.
    UPDATE public.ai_transcripts SET content = NULL, deleted_at = now() WHERE patient_id = p_patient_id AND deleted_at IS NULL;
    UPDATE public.ai_runs SET redacted_text = NULL, result = NULL WHERE patient_id = p_patient_id;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), CASE WHEN p_granted THEN 'grant' ELSE 'revoke' END, 'ai_consent', p_patient_id);
END $$;

-- Configuração (Proprietário(a)): ligar exige limite mensal.
CREATE FUNCTION public.set_ai_settings(p_enabled boolean, p_monthly_limit_usd numeric, p_retention_days integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  IF p_enabled AND coalesce(p_monthly_limit_usd, 0) <= 0 THEN
    RAISE EXCEPTION 'Defina o limite mensal de custo antes de ligar a IA.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.ai_settings SET enabled = p_enabled, monthly_limit_usd = p_monthly_limit_usd, retention_days = p_retention_days,
    updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_log (actor_user_id, action, entity_type) VALUES (auth.uid(), CASE WHEN p_enabled THEN 'enable' ELSE 'disable' END, 'ai');
END $$;

-- Uso e custo do mês (sem conteúdo clínico).
CREATE FUNCTION public.ai_usage(p_month date)
RETURNS TABLE (enabled boolean, monthly_limit_usd numeric, retention_days integer, month_cost numeric, professional_name text, runs bigint, cost_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  RETURN QUERY
  SELECT s.enabled, s.monthly_limit_usd, s.retention_days,
    (SELECT coalesce(sum(r.cost_usd), 0) FROM public.ai_runs r WHERE date_trunc('month', r.created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', p_month)),
    x.name, x.runs, x.cost
  FROM public.ai_settings s
  LEFT JOIN LATERAL (
    SELECT pr.name, count(r.id) AS runs, coalesce(sum(r.cost_usd), 0) AS cost FROM public.ai_runs r JOIN public.professionals pr ON pr.id = r.professional_id
    WHERE date_trunc('month', r.created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', p_month) GROUP BY pr.name
  ) x ON true;
END $$;

-- Transcrição e execuções --------------------------------------------------------------------------

CREATE FUNCTION public.create_ai_transcript(p_patient_id uuid, p_appointment_id uuid, p_source text, p_file_name text,
  p_content text, p_extra_terms text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_ai(p_patient_id);
  created uuid;
BEGIN
  IF p_appointment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = p_appointment_id
      AND a.patient_id = p_patient_id AND a.professional_id = professional) THEN
    RAISE EXCEPTION 'A sessão precisa ser sua e deste paciente.' USING ERRCODE = 'P0001';
  END IF;
  IF length(coalesce(p_content, '')) < 50 THEN RAISE EXCEPTION 'A transcrição está vazia ou curta demais.' USING ERRCODE = 'P0001'; END IF;
  IF length(p_content) > 300000 THEN RAISE EXCEPTION 'A transcrição passa de 300 mil caracteres.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.ai_transcripts (patient_id, professional_id, appointment_id, source, file_name, content, extra_terms)
  VALUES (p_patient_id, professional, p_appointment_id, p_source, left(p_file_name, 200), p_content,
    ARRAY(SELECT left(trim(t), 100) FROM unnest(coalesce(p_extra_terms, '{}')) t WHERE length(trim(t)) >= 2 LIMIT 30))
  RETURNING id INTO created;
  PERFORM private.log_clinical_access(p_patient_id, 'ai_transcript', created);
  RETURN created;
END $$;

-- Chamada pela Edge Function ai-draft COM O TOKEN da profissional: confere tudo, abre a execução e
-- devolve o texto e os dados a ocultar (nome, CPF, contatos, endereço, responsável, termos extras).
CREATE FUNCTION public.ai_prepare_run(p_transcript_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  transcript public.ai_transcripts;
  patient public.patients;
  professional uuid;
  run uuid;
BEGIN
  SELECT * INTO transcript FROM public.ai_transcripts WHERE id = p_transcript_id AND deleted_at IS NULL;
  IF transcript.id IS NULL THEN RAISE EXCEPTION 'Transcrição não encontrada.' USING ERRCODE = 'P0001'; END IF;
  professional := private.require_ai(transcript.patient_id);
  IF transcript.professional_id <> professional THEN RAISE EXCEPTION 'Transcrição de outra profissional.' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_runs r WHERE r.transcript_id = p_transcript_id AND r.status = 'pending' AND r.created_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'Esta transcrição já está sendo processada.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO patient FROM public.patients WHERE id = transcript.patient_id;
  INSERT INTO public.ai_runs (transcript_id, patient_id, professional_id) VALUES (transcript.id, transcript.patient_id, professional)
  RETURNING id INTO run;
  PERFORM private.log_clinical_access(transcript.patient_id, 'ai_run', run);
  RETURN jsonb_build_object(
    'run_id', run,
    'text', transcript.content,
    'names', to_jsonb(array_remove(ARRAY[patient.name, patient.social_name, patient.guardian_name] || transcript.extra_terms, NULL)),
    'contacts', to_jsonb(array_remove(ARRAY[patient.cpf, patient.phone, patient.email, patient.address, patient.guardian_phone, patient.guardian_email], NULL))
  );
END $$;

-- Resultado (só a Edge Function, com a chave de serviço).
CREATE FUNCTION public.ai_finish_run(p_run_id uuid, p_status text, p_model text, p_redacted_text text, p_result jsonb,
  p_warnings jsonb, p_error text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ai_runs SET status = p_status, model = p_model, redacted_text = p_redacted_text, result = p_result,
    warnings = coalesce(p_warnings, '[]'), error = left(p_error, 500), input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    cost_usd = coalesce(p_cost_usd, 0), finished_at = now()
  WHERE id = p_run_id AND status = 'pending'
$$;

CREATE FUNCTION public.ai_get_run(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  run public.ai_runs;
BEGIN
  SELECT * INTO run FROM public.ai_runs WHERE id = p_run_id;
  IF run.id IS NULL THEN RAISE EXCEPTION 'Rascunho não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF private.require_author_of(run.patient_id) <> run.professional_id THEN RAISE EXCEPTION 'Rascunho de outra profissional.' USING ERRCODE = '42501'; END IF;
  PERFORM private.log_clinical_access(run.patient_id, 'ai_run', run.id);
  RETURN jsonb_build_object('id', run.id, 'status', run.status, 'model', run.model, 'redacted_text', run.redacted_text, 'result', run.result,
    'warnings', run.warnings, 'error', run.error, 'cost_usd', run.cost_usd, 'decision', run.decision, 'note_id', run.note_id,
    'created_at', run.created_at, 'appointment_id', (SELECT appointment_id FROM public.ai_transcripts WHERE id = run.transcript_id));
END $$;

-- Execuções do paciente (sem conteúdo) para a lista e para o selo de origem nas evoluções.
CREATE FUNCTION public.ai_runs_for_patient(p_patient_id uuid)
RETURNS TABLE (id uuid, status text, decision text, note_id uuid, created_at timestamptz, cost_usd numeric, available boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
BEGIN
  RETURN QUERY
  SELECT r.id, r.status, r.decision, r.note_id, r.created_at, r.cost_usd, r.result IS NOT NULL
  FROM public.ai_runs r WHERE r.patient_id = p_patient_id AND r.professional_id = professional ORDER BY r.created_at DESC;
END $$;

-- Usar o rascunho: vira RASCUNHO de evolução (a profissional ainda revisa e finaliza no prontuário).
CREATE FUNCTION public.ai_use_draft(p_run_id uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  run public.ai_runs;
  appointment uuid;
  note uuid;
BEGIN
  SELECT * INTO run FROM public.ai_runs WHERE id = p_run_id FOR UPDATE;
  IF run.id IS NULL OR run.status <> 'done' OR run.result IS NULL THEN RAISE EXCEPTION 'Rascunho indisponível.' USING ERRCODE = 'P0001'; END IF;
  IF private.require_author_of(run.patient_id) <> run.professional_id THEN RAISE EXCEPTION 'Rascunho de outra profissional.' USING ERRCODE = '42501'; END IF;
  IF run.decision IS NOT NULL THEN RAISE EXCEPTION 'Este rascunho já foi usado ou descartado.' USING ERRCODE = 'P0001'; END IF;
  SELECT t.appointment_id INTO appointment FROM public.ai_transcripts t WHERE t.id = run.transcript_id;
  IF appointment IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment AND a.status = 'completed') THEN
    appointment := NULL;
  END IF;
  note := public.save_clinical_note(NULL, run.patient_id, appointment, 'evolution', p_body);
  UPDATE public.clinical_notes SET ai_run_id = run.id WHERE id = note;
  UPDATE public.ai_runs SET decision = 'used', note_id = note WHERE id = run.id;
  RETURN note;
END $$;

CREATE FUNCTION public.ai_discard_run(p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  run public.ai_runs;
BEGIN
  SELECT * INTO run FROM public.ai_runs WHERE id = p_run_id FOR UPDATE;
  IF run.id IS NULL THEN RAISE EXCEPTION 'Rascunho não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF private.require_author_of(run.patient_id) <> run.professional_id THEN RAISE EXCEPTION 'Rascunho de outra profissional.' USING ERRCODE = '42501'; END IF;
  UPDATE public.ai_runs SET decision = 'discarded' WHERE id = run.id AND decision IS NULL;
  UPDATE public.ai_transcripts SET delete_after = least(delete_after, now() + make_interval(days => (SELECT retention_days FROM public.ai_settings LIMIT 1)))
  WHERE id = run.transcript_id;
END $$;

-- Evolução vinda da IA finalizada: a transcrição sai em `retention_days`.
CREATE FUNCTION private.ai_note_finalized() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.ai_run_id IS NOT NULL AND NEW.status = 'final' AND OLD.status = 'draft' THEN
    UPDATE public.ai_transcripts SET delete_after = least(delete_after, now() + make_interval(days => (SELECT retention_days FROM public.ai_settings LIMIT 1)))
    WHERE id = (SELECT transcript_id FROM public.ai_runs WHERE id = NEW.ai_run_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_notes_ai_finalized AFTER UPDATE OF status ON public.clinical_notes FOR EACH ROW EXECUTE FUNCTION private.ai_note_finalized();

-- Limpeza diária: apaga o conteúdo vencido; ficam data, profissional, modelo, tokens e custo.
CREATE FUNCTION private.purge_ai_content() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected integer;
BEGIN
  WITH expired AS (
    UPDATE public.ai_transcripts SET content = NULL, extra_terms = '{}', deleted_at = now()
    WHERE deleted_at IS NULL AND delete_after <= now() RETURNING id
  )
  UPDATE public.ai_runs SET redacted_text = NULL, result = NULL WHERE transcript_id IN (SELECT id FROM expired);
  GET DIAGNOSTICS affected = ROW_COUNT;
  -- Execução que travou (função caiu no meio) não conta como pendente para sempre.
  UPDATE public.ai_runs SET status = 'failed', error = 'Tempo esgotado.', finished_at = now()
  WHERE status = 'pending' AND created_at < now() - interval '1 hour';
  RETURN affected;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ia-limpeza', '15 4 * * *', 'SELECT private.purge_ai_content()');
  END IF;
END $$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.ai_month_cost(), private.ai_blocker(uuid), private.require_ai(uuid), private.ai_note_finalized(),
  private.purge_ai_content() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_finish_run(uuid, text, text, text, jsonb, jsonb, text, integer, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_finish_run(uuid, text, text, text, jsonb, jsonb, text, integer, integer, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.ai_status(uuid), public.accept_ai_terms(), public.set_ai_consent(uuid, boolean, text),
  public.set_ai_settings(boolean, numeric, integer), public.ai_usage(date),
  public.create_ai_transcript(uuid, uuid, text, text, text, text[]), public.ai_prepare_run(uuid), public.ai_get_run(uuid),
  public.ai_runs_for_patient(uuid), public.ai_use_draft(uuid, text), public.ai_discard_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_status(uuid), public.accept_ai_terms(), public.set_ai_consent(uuid, boolean, text),
  public.set_ai_settings(boolean, numeric, integer), public.ai_usage(date),
  public.create_ai_transcript(uuid, uuid, text, text, text, text[]), public.ai_prepare_run(uuid), public.ai_get_run(uuid),
  public.ai_runs_for_patient(uuid), public.ai_use_draft(uuid, text), public.ai_discard_run(uuid) TO authenticated;
