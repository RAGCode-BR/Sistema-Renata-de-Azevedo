-- Motivos e transições administrativas do acompanhamento. Histórico começa nesta migração.
ALTER TABLE public.patients ADD COLUMN exit_reason text CHECK (length(exit_reason) <= 200),
  ADD COLUMN status_changed_at timestamptz;
CREATE TABLE public.patient_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  exit_reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX patient_status_events_date_idx ON public.patient_status_events (changed_at, to_status);
ALTER TABLE public.patient_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_status_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.record_patient_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('discharged', 'inactive') AND
    (NEW.status IS DISTINCT FROM OLD.status OR NEW.exit_reason IS DISTINCT FROM OLD.exit_reason)
    AND nullif(trim(coalesce(NEW.exit_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do encerramento.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    INSERT INTO public.patient_status_events (patient_id, from_status, to_status, exit_reason, actor_user_id)
    VALUES (OLD.id, OLD.status, NEW.status, NEW.exit_reason, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patients_status_history BEFORE UPDATE OF status, exit_reason ON public.patients
  FOR EACH ROW EXECUTE FUNCTION private.record_patient_status();
REVOKE ALL ON FUNCTION private.record_patient_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_patient(p_id uuid, p_data jsonb, p_professional_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  saved uuid;
  v_name text := trim(p_data->>'name');
  v_cpf text := nullif(regexp_replace(coalesce(p_data->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_status text := coalesce(nullif(p_data->>'status', ''), 'active');
  professionals uuid[] := ARRAY(SELECT DISTINCT unnest(p_professional_ids));
  v_contacts jsonb := coalesce(p_data->'additional_contacts', '[]'::jsonb);
  v_emergency jsonb := coalesce(p_data->'emergency_contacts', '[]'::jsonb);
  v_documents jsonb := coalesce(p_data->'identification_documents', '[]'::jsonb);
  v_tags text[] := ARRAY(SELECT left(trim(value), 50) FROM jsonb_array_elements_text(coalesce(p_data->'tags', '[]'::jsonb)) AS value WHERE trim(value) <> '');
BEGIN
  IF NOT private.has_permission('patients.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  IF coalesce(v_name, '') = '' OR coalesce(cardinality(professionals), 0) = 0 THEN
    RAISE EXCEPTION 'Informe nome e profissionais responsáveis.' USING ERRCODE = 'P0001'; END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'CPF inválido.' USING ERRCODE = 'P0001'; END IF;
  IF v_cpf IS NOT NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p.cpf = v_cpf AND p.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'Já existe paciente com este CPF.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(professionals) AS chosen
    WHERE NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = chosen)) THEN
    RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_contacts) <> 'array' OR jsonb_array_length(v_contacts) > 10
    OR jsonb_typeof(v_emergency) <> 'array' OR jsonb_array_length(v_emergency) > 10
    OR jsonb_typeof(v_documents) <> 'array' OR jsonb_array_length(v_documents) > 10
    OR cardinality(v_tags) > 20 THEN
    RAISE EXCEPTION 'Limite de contatos, documentos ou etiquetas excedido.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_contacts) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'type', ''))) = 0
      OR length(trim(coalesce(item->>'number', ''))) = 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_emergency) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'name', ''))) = 0
      OR length(trim(coalesce(item->>'relationship', ''))) = 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_documents) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'type', ''))) = 0
      OR length(trim(coalesce(item->>'number', ''))) = 0) THEN
    RAISE EXCEPTION 'Preencha todos os itens adicionados ao cadastro.' USING ERRCODE = 'P0001'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.patients (name) VALUES (v_name) RETURNING id INTO saved;
  ELSE
    SELECT id INTO saved FROM public.patients WHERE id = p_id;
    IF saved IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  UPDATE public.patients SET
    name = v_name, social_name = nullif(trim(p_data->>'social_name'), ''),
    phone = nullif(trim(p_data->>'phone'), ''), email = nullif(lower(trim(p_data->>'email')), ''),
    birth_date = nullif(p_data->>'birth_date', '')::date, cpf = v_cpf,
    address = nullif(trim(p_data->>'address'), ''), admin_notes = nullif(trim(p_data->>'admin_notes'), ''),
    guardian_name = nullif(trim(p_data->>'guardian_name'), ''),
    guardian_relationship = nullif(trim(p_data->>'guardian_relationship'), ''),
    guardian_phone = nullif(trim(p_data->>'guardian_phone'), ''),
    guardian_email = nullif(lower(trim(p_data->>'guardian_email')), ''),
    sex = nullif(p_data->>'sex', ''), rg = nullif(trim(p_data->>'rg'), ''),
    occupation = nullif(trim(p_data->>'occupation'), ''), marital_status = nullif(p_data->>'marital_status', ''),
    tags = v_tags, additional_contacts = v_contacts, emergency_contacts = v_emergency,
    identification_documents = v_documents,
    address_country = nullif(trim(p_data->>'address_country'), ''),
    address_postal_code = nullif(regexp_replace(coalesce(p_data->>'address_postal_code', ''), '[^0-9]', '', 'g'), ''),
    address_state = nullif(trim(p_data->>'address_state'), ''),
    address_city = nullif(trim(p_data->>'address_city'), ''),
    address_district = nullif(trim(p_data->>'address_district'), ''),
    address_street = nullif(trim(p_data->>'address_street'), ''),
    address_number = nullif(trim(p_data->>'address_number'), ''),
    address_complement = nullif(trim(p_data->>'address_complement'), ''),
    email_opt_in = coalesce((p_data->>'email_opt_in')::boolean, false),
    sms_opt_in = coalesce((p_data->>'sms_opt_in')::boolean, false),
    status = v_status, exit_reason = CASE WHEN v_status IN ('discharged', 'inactive')
      THEN nullif(trim(p_data->>'exit_reason'), '') ELSE NULL END, updated_at = now()
  WHERE id = saved;
  DELETE FROM public.patient_professionals WHERE patient_id = saved AND NOT (professional_id = ANY (professionals));
  INSERT INTO public.patient_professionals (patient_id, professional_id)
  SELECT saved, unnest(professionals) ON CONFLICT DO NOTHING;
  RETURN saved;
END $$;


-- Coorte do período: cadastros e leads criados no intervalo; receitas recebidas até hoje.
-- A carteira usa os eventos desde 27/10/2026; períodos anteriores não têm abertura confiável.
CREATE FUNCTION public.report_performance(p_from date, p_to date,
  p_professional_id uuid DEFAULT NULL, p_source_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  money_ok boolean := private.has_permission('finance.view') OR private.has_permission('billing.view');
  result jsonb;
BEGIN
  PERFORM private.require_permission('crm.view');
  PERFORM private.check_period(p_from, p_to);
  IF p_professional_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id) THEN
    RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001'; END IF;
  IF p_source_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lead_sources WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'Origem inválida.' USING ERRCODE = 'P0001'; END IF;
  WITH cohort_patients AS (
    SELECT p.id FROM public.patients p
    WHERE private.local_date(p.created_at) BETWEEN p_from AND p_to
      AND (p_source_id IS NULL OR p.source_id = p_source_id)
      AND (p_professional_id IS NULL OR EXISTS (
        SELECT 1 FROM public.patient_professionals pp WHERE pp.patient_id = p.id AND pp.professional_id = p_professional_id)
        OR EXISTS (SELECT 1 FROM public.patient_professional_events pe
          WHERE pe.patient_id = p.id AND pe.professional_id = p_professional_id))
  ), cohort_leads AS (
    SELECT l.id, l.patient_id, l.campaign_id, l.preferred_professional_id
    FROM public.leads l WHERE private.local_date(l.created_at) BETWEEN p_from AND p_to
      AND (p_source_id IS NULL OR l.source_id = p_source_id)
      AND (p_professional_id IS NULL OR l.preferred_professional_id = p_professional_id)
  ), exits AS (
    SELECT DISTINCT ON (e.patient_id) e.patient_id, e.exit_reason FROM public.patient_status_events e
    JOIN public.patients p ON p.id = e.patient_id
    WHERE e.to_status IN ('discharged', 'inactive') AND private.local_date(e.changed_at) BETWEEN p_from AND p_to
      AND (p_source_id IS NULL OR p.source_id = p_source_id)
      AND (p_professional_id IS NULL OR EXISTS (
        SELECT 1 FROM public.patient_professionals pp WHERE pp.patient_id = p.id AND pp.professional_id = p_professional_id)
        OR EXISTS (SELECT 1 FROM public.patient_professional_events pe
          WHERE pe.patient_id = p.id AND pe.professional_id = p_professional_id))
    ORDER BY e.patient_id, e.changed_at DESC, e.id DESC
  ), campaigns_used AS (
    SELECT DISTINCT c.id, c.budget FROM public.campaigns c
    JOIN cohort_leads l ON l.campaign_id = c.id
  ), professionals AS (
    SELECT pr.id AS professional_id, pr.name AS professional_name,
      (SELECT count(*) FROM cohort_leads l WHERE l.preferred_professional_id = pr.id) AS leads,
      (SELECT count(*) FROM cohort_leads l WHERE l.preferred_professional_id = pr.id AND l.patient_id IS NOT NULL) AS converted,
      (SELECT count(*) FROM cohort_patients p WHERE EXISTS (SELECT 1 FROM public.patient_professionals pp
        WHERE pp.patient_id = p.id AND pp.professional_id = pr.id) OR EXISTS
        (SELECT 1 FROM public.patient_professional_events pe WHERE pe.patient_id = p.id AND pe.professional_id = pr.id)) AS new_patients,
      (SELECT count(*) FROM exits e WHERE EXISTS (SELECT 1 FROM public.patient_professionals pp
        WHERE pp.patient_id = e.patient_id AND pp.professional_id = pr.id) OR EXISTS
        (SELECT 1 FROM public.patient_professional_events pe WHERE pe.patient_id = e.patient_id AND pe.professional_id = pr.id)) AS ended_patients,
      (SELECT count(*) FROM public.patient_professionals pp JOIN public.patients p ON p.id = pp.patient_id
        WHERE pp.professional_id = pr.id AND (p_source_id IS NULL OR p.source_id = p_source_id)) AS linked_now,
      (SELECT count(*) FROM public.patient_professional_events pe JOIN public.patients p ON p.id = pe.patient_id
        WHERE pe.professional_id = pr.id AND pe.kind = 'entry' AND private.local_date(pe.created_at) BETWEEN p_from AND p_to
        AND (p_source_id IS NULL OR p.source_id = p_source_id)) AS entries,
      (SELECT count(*) FROM public.patient_professional_events pe JOIN public.patients p ON p.id = pe.patient_id
        WHERE pe.professional_id = pr.id AND pe.kind = 'exit' AND private.local_date(pe.created_at) BETWEEN p_from AND p_to
        AND (p_source_id IS NULL OR p.source_id = p_source_id)) AS exits,
      (SELECT coalesce(sum(CASE WHEN pe.kind = 'entry' THEN 1 ELSE -1 END), 0)
        FROM public.patient_professional_events pe JOIN public.patients p ON p.id = pe.patient_id
        WHERE pe.professional_id = pr.id AND private.local_date(pe.created_at) > p_to
        AND (p_source_id IS NULL OR p.source_id = p_source_id)) AS later_net
    FROM public.professionals pr
    WHERE (p_professional_id IS NULL OR pr.id = p_professional_id)
      AND (pr.active OR EXISTS (SELECT 1 FROM public.patient_professionals pp WHERE pp.professional_id = pr.id)
        OR EXISTS (SELECT 1 FROM public.patient_professional_events pe WHERE pe.professional_id = pr.id))
  )
  SELECT jsonb_build_object(
    'new_patients', (SELECT count(*) FROM cohort_patients),
    'ended_patients', (SELECT count(*) FROM exits),
    'leads', (SELECT count(*) FROM cohort_leads),
    'converted', (SELECT count(*) FROM cohort_leads WHERE patient_id IS NOT NULL),
    'financial_available', money_ok,
    'campaign_budget', CASE WHEN money_ok THEN (SELECT sum(budget) FROM campaigns_used) END,
    'campaign_converted', (SELECT count(*) FROM cohort_leads WHERE campaign_id IS NOT NULL AND patient_id IS NOT NULL),
    'estimated_cac', CASE WHEN money_ok THEN
      (SELECT sum(budget) FROM campaigns_used) / nullif((SELECT count(*) FROM cohort_leads
        WHERE campaign_id IS NOT NULL AND patient_id IS NOT NULL), 0) END,
    'observed_ltv', CASE WHEN money_ok THEN
      (SELECT sum(coalesce((SELECT sum(pay.amount) FROM public.payments pay
        WHERE pay.patient_id = cp.id AND pay.reversed_at IS NULL), 0)) /
        nullif(count(*), 0) FROM cohort_patients cp) END,
    'history_from', '2026-10-27',
    'exit_reasons', coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC, x.name) FROM (
      SELECT coalesce(nullif(trim(e.exit_reason), ''), 'Não informado') AS name, count(*) AS count
      FROM exits e GROUP BY 1) x), '[]'::jsonb),
    'professionals', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'professional_id', pr.professional_id, 'professional_name', pr.professional_name,
      'leads', pr.leads, 'converted', pr.converted, 'new_patients', pr.new_patients,
      'ended_patients', pr.ended_patients, 'linked_now', pr.linked_now,
      'entries', pr.entries, 'exits', pr.exits,
      'opening', CASE WHEN p_from >= date '2026-10-27' THEN
        pr.linked_now - pr.later_net - pr.entries + pr.exits END,
      'growth_percent', CASE WHEN p_from >= date '2026-10-27' THEN
        100.0 * (pr.entries - pr.exits) /
          nullif(pr.linked_now - pr.later_net - pr.entries + pr.exits, 0) END
    ) ORDER BY pr.professional_name) FROM professionals pr), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.report_performance(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_performance(date, date, uuid, uuid) TO authenticated;
