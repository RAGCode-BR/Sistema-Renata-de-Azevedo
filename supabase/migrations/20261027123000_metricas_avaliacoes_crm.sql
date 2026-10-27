-- O comparecimento da avaliação de um lead também deve aparecer no painel e nos relatórios.
CREATE OR REPLACE FUNCTION public.crm_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
  result jsonb;
BEGIN
  PERFORM private.require_permission('crm.view');
  PERFORM private.check_period(p_from, p_to);
  WITH cohort AS (
    SELECT l.*, s.kind AS stage_kind,
      (EXISTS (SELECT 1 FROM public.lead_assessments la WHERE la.lead_id = l.id AND la.status = 'attended')
        OR EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed')) AS attended,
      coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL), 0) AS revenue
    FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'leads', (SELECT count(*) FROM cohort),
    'converted', (SELECT count(*) FROM cohort WHERE stage_kind = 'won'),
    'lost', (SELECT count(*) FROM cohort WHERE stage_kind = 'lost'),
    'open', (SELECT count(*) FROM cohort WHERE stage_kind = 'open'),
    'attended', (SELECT count(*) FROM cohort WHERE attended),
    'revenue', CASE WHEN money_ok THEN (SELECT coalesce(sum(revenue), 0) FROM cohort) END,
    'avg_first_contact_hours', (SELECT round((avg(extract(epoch FROM first_contact_at - created_at)) / 3600)::numeric, 1)
      FROM cohort WHERE first_contact_at IS NOT NULL),
    'new_patients', (SELECT count(*) FROM public.patients p WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to),
    'by_source', coalesce((SELECT jsonb_agg(x ORDER BY x.leads DESC) FROM (
      SELECT coalesce(src.name, 'Sem origem') AS name, count(*) AS leads,
        count(*) FILTER (WHERE c.stage_kind = 'won') AS converted, count(*) FILTER (WHERE c.stage_kind = 'lost') AS lost,
        count(*) FILTER (WHERE c.attended) AS attended,
        CASE WHEN money_ok THEN sum(c.revenue) END AS revenue
      FROM cohort c LEFT JOIN public.lead_sources src ON src.id = c.source_id GROUP BY src.name) x), '[]'),
    'loss_reasons', coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC) FROM (
      SELECT coalesce(r.name, 'Sem motivo') AS name, count(*) AS count
      FROM cohort c LEFT JOIN public.lead_loss_reasons r ON r.id = c.loss_reason_id WHERE c.stage_kind = 'lost' GROUP BY r.name) x), '[]'),
    'stages', coalesce((SELECT jsonb_agg(x ORDER BY x.position) FROM (
      SELECT s.name, s.kind, s.position, count(c.id) AS count
      FROM public.lead_stages s LEFT JOIN cohort c ON c.stage_id = s.id WHERE s.active OR c.id IS NOT NULL
      GROUP BY s.id, s.name, s.kind, s.position) x), '[]')
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.report_campaigns(p_from date, p_to date)
RETURNS TABLE (id uuid, name text, source_name text, budget numeric, leads bigint, converted bigint,
  lost bigint, attended bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
BEGIN
  PERFORM private.require_permission('crm.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT c.id, c.name, s.name, c.budget, count(l.id),
    count(l.id) FILTER (WHERE st.kind = 'won'), count(l.id) FILTER (WHERE st.kind = 'lost'),
    count(l.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.lead_assessments la
      WHERE la.lead_id = l.id AND la.status = 'attended') OR EXISTS
      (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed')),
    CASE WHEN money_ok THEN coalesce(sum((SELECT sum(p.amount) FROM public.payments p
      WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL)), 0) END
  FROM public.campaigns c LEFT JOIN public.lead_sources s ON s.id = c.source_id
  JOIN public.leads l ON l.campaign_id = c.id AND private.local_date(l.created_at) BETWEEN p_from AND p_to
  LEFT JOIN public.lead_stages st ON st.id = l.stage_id
  GROUP BY c.id, s.name ORDER BY count(l.id) DESC, c.name;
END $$;

-- Uma reserva ativa só sai da etapa de avaliação quando vira paciente.
CREATE FUNCTION private.keep_lead_assessment_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id
    AND EXISTS (SELECT 1 FROM public.lead_assessments WHERE lead_id = OLD.id AND status = 'scheduled')
    AND (SELECT kind FROM public.lead_stages WHERE id = NEW.stage_id) <> 'won'
    AND (SELECT name FROM public.lead_stages WHERE id = NEW.stage_id) <> 'Primeira consulta agendada' THEN
    RAISE EXCEPTION 'Cancele a avaliação antes de mudar a etapa.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_keep_assessment_stage BEFORE UPDATE OF stage_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.keep_lead_assessment_stage();
REVOKE ALL ON FUNCTION private.keep_lead_assessment_stage() FROM PUBLIC, anon, authenticated;
