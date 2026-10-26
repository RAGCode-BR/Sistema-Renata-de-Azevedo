-- Atividades terapêuticas enviadas pela profissional ao paciente no portal.
-- As tarefas administrativas existentes continuam separadas: CRM e pedidos do portal dependem delas.
INSERT INTO public.role_permissions (role, permission) VALUES ('owner', 'patient_activities.manage_all')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION private.portal_terms_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '2026-10-26' $$;

CREATE TABLE public.patient_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instructions text NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 4000),
  due_date date,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  patient_response text CHECK (length(patient_response) <= 4000),
  completed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX patient_activities_professional_idx ON public.patient_activities (professional_id, status, due_date);
CREATE INDEX patient_activities_patient_idx ON public.patient_activities (patient_id, created_at DESC);
ALTER TABLE public.patient_activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_activities FROM anon, authenticated;

CREATE FUNCTION public.patient_activity_patients()
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL AND NOT private.has_permission('patient_activities.manage_all') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.id, p.name FROM public.patient_professionals pp
  JOIN public.patients p ON p.id = pp.patient_id
  WHERE pp.professional_id = professional OR private.has_permission('patient_activities.manage_all')
  GROUP BY p.id, p.name ORDER BY p.name;
END $$;

CREATE FUNCTION public.patient_activity_professionals(p_patient_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL AND NOT private.has_permission('patient_activities.manage_all') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT pr.id, pr.name FROM public.patient_professionals pp
    JOIN public.professionals pr ON pr.id = pp.professional_id
    WHERE pp.patient_id = p_patient_id AND
      (pp.professional_id = professional OR private.has_permission('patient_activities.manage_all'))
    ORDER BY pr.name;
END $$;

CREATE FUNCTION public.patient_activity_list(p_patient_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, title text,
  instructions text, due_date date, status text, patient_response text, completed_at timestamptz,
  created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL AND NOT private.has_permission('patient_activities.manage_all') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.patient_id, p.name, a.professional_id, pr.name, a.title, a.instructions, a.due_date,
    a.status, a.patient_response, a.completed_at, a.created_at
  FROM public.patient_activities a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE ((a.professional_id = professional AND private.cares_for(a.patient_id))
    OR private.has_permission('patient_activities.manage_all'))
    AND (p_patient_id IS NULL OR a.patient_id = p_patient_id)
  ORDER BY a.created_at DESC;
END $$;

CREATE FUNCTION public.save_patient_activity(p_id uuid, p_patient_id uuid, p_title text,
  p_instructions text, p_due_date date DEFAULT NULL, p_professional_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id(); assigned_professional uuid; saved uuid;
BEGIN
  IF private.has_permission('patient_activities.manage_all') THEN
    assigned_professional := p_professional_id;
  ELSE
    assigned_professional := professional;
    IF p_professional_id IS NOT NULL AND p_professional_id <> professional THEN
      RAISE EXCEPTION 'Profissional não autorizado.' USING ERRCODE = '42501'; END IF;
  END IF;
  IF assigned_professional IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.patient_professionals pp WHERE pp.patient_id = p_patient_id
      AND pp.professional_id = assigned_professional
  ) OR (NOT private.has_permission('patient_activities.manage_all') AND NOT private.cares_for(p_patient_id)) THEN
    RAISE EXCEPTION 'Paciente não encontrado na sua carteira.' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 200
    OR length(trim(coalesce(p_instructions, ''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Preencha título e orientações da atividade.' USING ERRCODE = 'P0001';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.patient_activities (patient_id, professional_id, title, instructions, due_date, created_by)
    VALUES (p_patient_id, assigned_professional, trim(p_title), trim(p_instructions), p_due_date, auth.uid())
    RETURNING id INTO saved;
    PERFORM private.portal_notify(p_patient_id, 'Nova atividade disponível no portal.', '#/portal/atividades');
  ELSE
    UPDATE public.patient_activities a
      SET professional_id = assigned_professional, title = trim(p_title), instructions = trim(p_instructions), due_date = p_due_date, updated_at = now()
    WHERE a.id = p_id AND a.patient_id = p_patient_id
      AND (private.has_permission('patient_activities.manage_all') OR a.professional_id = professional)
      AND a.status = 'assigned'
    RETURNING a.id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'Atividade não encontrada ou já encerrada.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN saved;
END $$;

CREATE FUNCTION public.cancel_patient_activity(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  UPDATE public.patient_activities a SET status = 'cancelled', updated_at = now()
  WHERE a.id = p_id AND ((a.professional_id = professional AND private.cares_for(a.patient_id))
    OR private.has_permission('patient_activities.manage_all')) AND a.status = 'assigned';
  IF NOT FOUND THEN RAISE EXCEPTION 'Atividade não encontrada ou já encerrada.' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE FUNCTION public.portal_patient_activities(p_patient_id uuid)
RETURNS TABLE (id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, title text,
  instructions text, due_date date, status text, patient_response text, completed_at timestamptz,
  created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT a.id, a.patient_id, p.name, a.professional_id, pr.name, a.title, a.instructions, a.due_date,
    a.status, a.patient_response, a.completed_at, a.created_at
  FROM public.patient_activities a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE a.patient_id = p_patient_id AND a.status <> 'cancelled'
  ORDER BY a.created_at DESC;
END $$;

CREATE FUNCTION public.portal_complete_patient_activity(p_id uuid, p_response text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE activity public.patient_activities;
BEGIN
  SELECT * INTO activity FROM public.patient_activities WHERE id = p_id FOR UPDATE;
  IF activity.id IS NULL THEN RAISE EXCEPTION 'Atividade não encontrada.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.portal_patient(activity.patient_id);
  IF activity.status <> 'assigned' THEN RAISE EXCEPTION 'Atividade já encerrada.' USING ERRCODE = 'P0001'; END IF;
  IF length(coalesce(p_response, '')) > 4000 THEN RAISE EXCEPTION 'Resposta muito longa.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.patient_activities SET status = 'completed', patient_response = nullif(trim(p_response), ''),
    completed_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT p.id, 'portal', 'Paciente concluiu uma tarefa.', '#/tarefas'
  FROM public.profiles p WHERE p.professional_id = activity.professional_id AND p.active;
END $$;

REVOKE ALL ON FUNCTION public.patient_activity_patients(), public.patient_activity_professionals(uuid), public.patient_activity_list(uuid), public.save_patient_activity(uuid, uuid, text, text, date, uuid),
  public.cancel_patient_activity(uuid), public.portal_patient_activities(uuid),
  public.portal_complete_patient_activity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_activity_patients(), public.patient_activity_professionals(uuid), public.patient_activity_list(uuid), public.save_patient_activity(uuid, uuid, text, text, date, uuid),
  public.cancel_patient_activity(uuid), public.portal_patient_activities(uuid),
  public.portal_complete_patient_activity(uuid, text) TO authenticated;
