-- Histórico administrativo de entrada e saída de pacientes da carteira de cada profissional.
-- Registra mudanças a partir desta migração; vínculos antigos aparecem no total atual.
CREATE TABLE public.patient_professional_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  kind text NOT NULL CHECK (kind IN ('entry', 'exit')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_professional_events_patient_time ON public.patient_professional_events (patient_id, created_at DESC);
CREATE INDEX patient_professional_events_prof_time ON public.patient_professional_events (professional_id, created_at DESC);
ALTER TABLE public.patient_professional_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_professional_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.record_patient_professional_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.patient_professional_events (patient_id, professional_id, kind, actor_user_id)
  VALUES (CASE WHEN TG_OP = 'INSERT' THEN NEW.patient_id ELSE OLD.patient_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.professional_id ELSE OLD.professional_id END,
    CASE WHEN TG_OP = 'INSERT' THEN 'entry' ELSE 'exit' END, auth.uid());
  RETURN CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
END $$;
CREATE TRIGGER patient_professionals_entry AFTER INSERT ON public.patient_professionals
  FOR EACH ROW EXECUTE FUNCTION private.record_patient_professional_event();
CREATE TRIGGER patient_professionals_exit AFTER DELETE ON public.patient_professionals
  FOR EACH ROW EXECUTE FUNCTION private.record_patient_professional_event();
REVOKE ALL ON FUNCTION private.record_patient_professional_event() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.patient_professional_history(p_patient_id uuid)
RETURNS TABLE (id bigint, professional_id uuid, professional_name text, kind text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT e.id, e.professional_id, p.name, e.kind, e.created_at
  FROM public.patient_professional_events e JOIN public.professionals p ON p.id = e.professional_id
  WHERE e.patient_id = p_patient_id ORDER BY e.created_at DESC, e.id DESC;
END $$;

CREATE FUNCTION public.crm_professional_flow(p_from date, p_to date)
RETURNS TABLE (professional_id uuid, professional_name text, linked_now bigint, entries bigint, exits bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT p.id, p.name,
    (SELECT count(*) FROM public.patient_professionals pp WHERE pp.professional_id = p.id),
    (SELECT count(*) FROM public.patient_professional_events e WHERE e.professional_id = p.id
      AND e.kind = 'entry' AND private.local_date(e.created_at) BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.patient_professional_events e WHERE e.professional_id = p.id
      AND e.kind = 'exit' AND private.local_date(e.created_at) BETWEEN p_from AND p_to)
  FROM public.professionals p
  WHERE p.active OR EXISTS (SELECT 1 FROM public.patient_professionals pp WHERE pp.professional_id = p.id)
    OR EXISTS (SELECT 1 FROM public.patient_professional_events e WHERE e.professional_id = p.id
      AND private.local_date(e.created_at) BETWEEN p_from AND p_to)
  ORDER BY p.name;
END $$;

REVOKE ALL ON FUNCTION public.patient_professional_history(uuid), public.crm_professional_flow(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_professional_history(uuid), public.crm_professional_flow(date, date) TO authenticated;
