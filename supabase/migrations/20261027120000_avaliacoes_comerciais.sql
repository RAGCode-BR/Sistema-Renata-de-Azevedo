-- Uma avaliação pode ser reservada para um lead antes de sua conversão em paciente.
-- A reserva ocupa a agenda sem criar cobrança ou prontuário antecipadamente.
CREATE TABLE public.lead_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  block_id uuid UNIQUE REFERENCES public.schedule_blocks(id) ON DELETE SET NULL,
  appointment_id uuid UNIQUE REFERENCES public.appointments(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'attended', 'missed', 'cancelled', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX lead_assessments_one_scheduled ON public.lead_assessments (lead_id) WHERE status = 'scheduled';
CREATE INDEX lead_assessments_lead_time ON public.lead_assessments (lead_id, starts_at DESC);
ALTER TABLE public.lead_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_assessments FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lead_assessment_list(p_lead_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, lead_id uuid, professional_id uuid, professional_name text, starts_at timestamptz,
  ends_at timestamptz, status text, appointment_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT a.id, a.lead_id, a.professional_id, p.name, a.starts_at, a.ends_at, a.status, a.appointment_id
  FROM public.lead_assessments a JOIN public.professionals p ON p.id = a.professional_id
  WHERE p_lead_id IS NULL OR a.lead_id = p_lead_id
  ORDER BY a.starts_at DESC;
END $$;

CREATE FUNCTION public.schedule_lead_assessment(p_lead_id uuid, p_professional_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead public.leads;
  block uuid;
  created uuid;
  assessment_stage uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  PERFORM private.require_permission('appointments.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF lead.id IS NULL OR lead.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lead não encontrado ou já convertido.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id AND active) THEN
    RAISE EXCEPTION 'Escolha uma profissional ativa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_starts_at <= now()
      OR p_ends_at <= p_starts_at OR p_ends_at > p_starts_at + interval '3 hours' THEN
    RAISE EXCEPTION 'Informe um horário futuro e duração de até 3 horas.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_assessments WHERE lead_id = p_lead_id AND status = 'scheduled') THEN
    RAISE EXCEPTION 'Cancele a avaliação atual antes de agendar outra.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.google_busy g WHERE g.professional_id = p_professional_id
    AND g.starts_at < p_ends_at AND g.ends_at > p_starts_at) THEN
    RAISE EXCEPTION 'Compromisso no Google Agenda neste horário. Escolha outro horário.' USING ERRCODE = 'P0001';
  END IF;
  block := public.create_schedule_block(p_professional_id, p_starts_at, p_ends_at,
    'Avaliação · ' || lead.name, false);
  INSERT INTO public.lead_assessments (lead_id, professional_id, block_id, starts_at, ends_at)
  VALUES (p_lead_id, p_professional_id, block, p_starts_at, p_ends_at) RETURNING id INTO created;
  SELECT id INTO assessment_stage FROM public.lead_stages WHERE kind = 'open' AND name = 'Primeira consulta agendada' LIMIT 1;
  IF assessment_stage IS NOT NULL AND lead.stage_id IS DISTINCT FROM assessment_stage THEN
    UPDATE public.leads SET stage_id = assessment_stage, preferred_professional_id = p_professional_id,
      last_activity_at = now(), updated_at = now() WHERE id = p_lead_id;
    PERFORM private.lead_log(p_lead_id, 'stage', NULL,
      (SELECT name FROM public.lead_stages WHERE id = lead.stage_id), 'Primeira consulta agendada');
  ELSE
    UPDATE public.leads SET preferred_professional_id = p_professional_id,
      last_activity_at = now(), updated_at = now() WHERE id = p_lead_id;
  END IF;
  PERFORM private.lead_log(p_lead_id, 'assessment_scheduled', NULL, NULL,
    to_char(p_starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
  RETURN created;
END $$;

CREATE FUNCTION public.set_lead_assessment_status(p_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  assessment public.lead_assessments;
BEGIN
  PERFORM private.require_permission('crm.manage');
  PERFORM private.require_permission('appointments.manage');
  SELECT * INTO assessment FROM public.lead_assessments WHERE id = p_id FOR UPDATE;
  IF assessment.id IS NULL OR assessment.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Avaliação não encontrada ou já encerrada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('attended', 'missed', 'cancelled') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status <> 'cancelled' AND assessment.ends_at > now() THEN
    RAISE EXCEPTION 'Registre o resultado após o término da avaliação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.lead_assessments SET status = p_status, updated_at = now() WHERE id = p_id;
  IF p_status = 'cancelled' AND assessment.block_id IS NOT NULL THEN
    DELETE FROM public.schedule_blocks WHERE id = assessment.block_id;
  END IF;
  PERFORM private.lead_log(assessment.lead_id,
    CASE p_status WHEN 'attended' THEN 'assessment_attended' WHEN 'missed' THEN 'assessment_missed'
      ELSE 'assessment_cancelled' END, NULL, NULL, NULL);
  UPDATE public.leads SET last_activity_at = now(), updated_at = now() WHERE id = assessment.lead_id;
END $$;

-- Evita apagar a reserva pela tela genérica de bloqueios; a ação do CRM mantém o histórico.
CREATE OR REPLACE FUNCTION public.delete_schedule_block(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_assessments WHERE block_id = p_id AND status = 'scheduled') THEN
    RAISE EXCEPTION 'Cancele esta avaliação pelo Comercial.' USING ERRCODE = 'P0001';
  END IF;
  SELECT professional_id INTO professional FROM public.schedule_blocks WHERE id = p_id;
  IF professional IS NULL THEN RAISE EXCEPTION 'Bloqueio não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF NOT private.manages_schedule_of(professional) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.schedule_blocks WHERE id = p_id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'delete', 'schedule_block', p_id);
END $$;

-- Ao converter, conserva as profissionais já ligadas ao paciente e acrescenta as escolhidas.
-- Uma avaliação futura reservada vira uma sessão real do paciente na mesma transação.
CREATE OR REPLACE FUNCTION public.convert_lead(p_id uuid, p_patient_id uuid, p_professional_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead public.leads;
  patient uuid := p_patient_id;
  professionals uuid[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_professional_ids, '{}')));
  assessment public.lead_assessments;
  booked uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  PERFORM private.require_permission('patients.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id FOR UPDATE;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF lead.patient_id IS NOT NULL THEN RAISE EXCEPTION 'Este lead já virou paciente.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO assessment FROM public.lead_assessments WHERE lead_id = p_id AND status = 'scheduled' FOR UPDATE;
  IF assessment.id IS NOT NULL AND NOT assessment.professional_id = ANY(professionals) THEN
    professionals := array_append(professionals, assessment.professional_id);
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(professionals) chosen WHERE NOT EXISTS
    (SELECT 1 FROM public.professionals WHERE id = chosen AND active)) THEN
    RAISE EXCEPTION 'Profissional inválida.' USING ERRCODE = 'P0001';
  END IF;
  IF patient IS NULL THEN
    IF cardinality(professionals) = 0 THEN
      RAISE EXCEPTION 'Escolha a profissional responsável.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.patients (name, phone, email, source_id, campaign_id)
    VALUES (lead.name, lead.phone, lead.email, lead.source_id, lead.campaign_id) RETURNING id INTO patient;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = patient) THEN
      RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.patients SET source_id = coalesce(source_id, lead.source_id),
      campaign_id = coalesce(campaign_id, lead.campaign_id) WHERE id = patient;
  END IF;
  INSERT INTO public.patient_professionals (patient_id, professional_id)
  SELECT patient, unnest(professionals) ON CONFLICT DO NOTHING;
  IF assessment.id IS NOT NULL AND assessment.starts_at > now() THEN
    DELETE FROM public.schedule_blocks WHERE id = assessment.block_id;
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at, session_type)
    VALUES (patient, assessment.professional_id, assessment.starts_at, assessment.ends_at, 'assessment')
    RETURNING id INTO booked;
    UPDATE public.lead_assessments SET status = 'converted', appointment_id = booked,
      block_id = NULL, updated_at = now() WHERE id = assessment.id;
  END IF;
  UPDATE public.leads SET patient_id = patient, converted_at = now(), stage_id = private.stage_of_kind('won'),
    loss_reason_id = NULL, updated_at = now(), last_activity_at = now() WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'converted', NULL,
    (SELECT name FROM public.lead_stages WHERE id = lead.stage_id), NULL);
  RETURN patient;
END $$;

-- Comparecimento de avaliação anterior à conversão também conta na campanha, sem duplicar paciente.
CREATE OR REPLACE FUNCTION public.campaign_stats()
RETURNS TABLE (id uuid, name text, source_id uuid, source_name text, utm_campaign text, starts_on date,
  ends_on date, budget numeric, notes text, active boolean, leads bigint, converted bigint, attended bigint,
  revenue numeric, cost_per_lead numeric, cost_per_patient numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT c.id, c.name, c.source_id, s.name, c.utm_campaign, c.starts_on, c.ends_on, c.budget, c.notes, c.active,
    count(l.id), count(l.id) FILTER (WHERE st.kind = 'won'),
    count(l.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.lead_assessments la
      WHERE la.lead_id = l.id AND la.status = 'attended') OR EXISTS
      (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed')),
    CASE WHEN money_ok THEN coalesce(sum((SELECT sum(p.amount) FROM public.payments p
      WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL)), 0) END,
    CASE WHEN count(l.id) > 0 THEN round(c.budget / count(l.id), 2) END,
    CASE WHEN count(l.id) FILTER (WHERE st.kind = 'won') > 0
      THEN round(c.budget / count(l.id) FILTER (WHERE st.kind = 'won'), 2) END
  FROM public.campaigns c LEFT JOIN public.lead_sources s ON s.id = c.source_id
  LEFT JOIN public.leads l ON l.campaign_id = c.id LEFT JOIN public.lead_stages st ON st.id = l.stage_id
  GROUP BY c.id, s.name ORDER BY c.active DESC, c.starts_on DESC NULLS LAST, c.name;
END $$;

ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_kind_check;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_kind_check CHECK (kind IN
  ('created', 'edited', 'assigned', 'stage', 'converted', 'call', 'message', 'email', 'meeting', 'note',
   'followup', 'followup_done', 'followup_cancelled', 'site', 'assessment_scheduled',
   'assessment_attended', 'assessment_missed', 'assessment_cancelled'));

REVOKE ALL ON FUNCTION public.lead_assessment_list(uuid), public.schedule_lead_assessment(uuid, uuid, timestamptz, timestamptz),
  public.set_lead_assessment_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_assessment_list(uuid), public.schedule_lead_assessment(uuid, uuid, timestamptz, timestamptz),
  public.set_lead_assessment_status(uuid, text) TO authenticated;
