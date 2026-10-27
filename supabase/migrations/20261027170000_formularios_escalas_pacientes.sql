-- Modelos de exercícios, formulários e escalas; respostas ligadas ao paciente e à profissional.
CREATE TABLE public.patient_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  kind text NOT NULL CHECK (kind IN ('exercise', 'form', 'scale')),
  questions jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_form_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.patient_form_templates(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  title text NOT NULL,
  description text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('exercise', 'form', 'scale')),
  questions jsonb NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  answers jsonb,
  score numeric,
  score_max numeric,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  answered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX patient_form_assignments_patient_idx ON public.patient_form_assignments(patient_id, assigned_at DESC);
CREATE INDEX patient_form_assignments_prof_idx ON public.patient_form_assignments(professional_id, assigned_at DESC);
ALTER TABLE public.patient_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_form_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_form_templates, public.patient_form_assignments FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.check_patient_form_questions(p_questions jsonb, p_kind text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE q jsonb; opt jsonb; ids text[] := '{}'; n integer; qtype text;
BEGIN
  IF p_kind NOT IN ('exercise', 'form', 'scale') OR jsonb_typeof(p_questions) <> 'array'
    OR jsonb_array_length(p_questions) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Inclua de 1 a 30 perguntas.' USING ERRCODE = 'P0001'; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(p_questions) LOOP
    qtype := q->>'type';
    IF jsonb_typeof(q) <> 'object' OR coalesce(q->>'id','') = '' OR q->>'id' = ANY(ids)
      OR length(trim(coalesce(q->>'label',''))) NOT BETWEEN 1 AND 300
      OR qtype NOT IN ('text', 'number', 'choice', 'scale') THEN
      RAISE EXCEPTION 'Pergunta inválida ou repetida.' USING ERRCODE = 'P0001'; END IF;
    ids := array_append(ids, q->>'id');
    IF qtype IN ('choice', 'scale') THEN
      IF jsonb_typeof(q->'options') <> 'array' OR jsonb_array_length(q->'options') NOT BETWEEN 2 AND 7 THEN
        RAISE EXCEPTION 'Cada escolha ou escala precisa de 2 a 7 opções.' USING ERRCODE = 'P0001'; END IF;
      FOR opt IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
        IF jsonb_typeof(opt) <> 'string' OR length(trim(opt #>> '{}')) NOT BETWEEN 1 AND 100 THEN
          RAISE EXCEPTION 'Opção inválida.' USING ERRCODE = 'P0001'; END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF p_kind = 'scale' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) q WHERE q->>'type' = 'scale') THEN
    RAISE EXCEPTION 'Uma escala precisa de perguntas pontuáveis.' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE FUNCTION public.patient_form_templates_list() RETURNS TABLE (
  id uuid, title text, description text, kind text, questions jsonb, active boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL THEN RAISE EXCEPTION 'Acesso reservado à profissional.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT t.id, t.title, t.description, t.kind, t.questions, t.active, t.created_at
    FROM public.patient_form_templates t WHERE t.professional_id = professional ORDER BY t.created_at DESC;
END $$;

CREATE FUNCTION public.save_patient_form_template(p_id uuid, p_title text, p_description text,
  p_kind text, p_questions jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id(); saved uuid;
BEGIN
  IF professional IS NULL THEN RAISE EXCEPTION 'Acesso reservado à profissional.' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200 OR length(coalesce(p_description,'')) > 2000 THEN
    RAISE EXCEPTION 'Título ou descrição inválidos.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.check_patient_form_questions(p_questions, p_kind);
  IF p_id IS NULL THEN
    INSERT INTO public.patient_form_templates (professional_id, title, description, kind, questions)
    VALUES (professional, trim(p_title), trim(coalesce(p_description,'')), p_kind, p_questions) RETURNING id INTO saved;
  ELSE
    UPDATE public.patient_form_templates SET title = trim(p_title), description = trim(coalesce(p_description,'')),
      kind = p_kind, questions = p_questions, updated_at = now()
    WHERE id = p_id AND professional_id = professional RETURNING id INTO saved;
    IF saved IS NULL THEN RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN saved;
END $$;

CREATE FUNCTION public.assign_patient_form(p_template_id uuid, p_patient_id uuid, p_due_date date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.require_author_of(p_patient_id); template public.patient_form_templates; saved uuid;
BEGIN
  SELECT * INTO template FROM public.patient_form_templates WHERE id = p_template_id AND professional_id = professional AND active;
  IF template.id IS NULL THEN RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.patient_form_assignments (template_id, patient_id, professional_id, title, description, kind, questions, due_date)
  VALUES (template.id, p_patient_id, professional, template.title, template.description, template.kind, template.questions, p_due_date)
  RETURNING id INTO saved;
  PERFORM private.portal_notify(p_patient_id, 'Novo formulário disponível no portal.', '#/portal/formularios');
  RETURN saved;
END $$;

CREATE FUNCTION public.patient_form_assignments_list(p_patient_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, patient_id uuid, patient_name text, professional_id uuid, title text,
  description text, kind text, questions jsonb, due_date date, status text, answers jsonb,
  score numeric, score_max numeric, assigned_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL THEN RAISE EXCEPTION 'Acesso reservado à profissional.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT a.id, a.patient_id, p.name, a.professional_id, a.title, a.description,
    a.kind, a.questions, a.due_date, a.status, a.answers, a.score, a.score_max, a.assigned_at, a.completed_at
    FROM public.patient_form_assignments a JOIN public.patients p ON p.id = a.patient_id
    WHERE a.professional_id = professional AND (p_patient_id IS NULL OR a.patient_id = p_patient_id)
      AND private.cares_for(a.patient_id) ORDER BY a.assigned_at DESC;
END $$;

CREATE FUNCTION public.portal_patient_forms(p_patient_id uuid)
RETURNS TABLE (id uuid, title text, description text, kind text, questions jsonb,
  due_date date, status text, answers jsonb, score numeric, score_max numeric,
  assigned_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY SELECT a.id, a.title, a.description, a.kind, a.questions,
    a.due_date, a.status, a.answers, a.score, a.score_max, a.assigned_at, a.completed_at
    FROM public.patient_form_assignments a WHERE a.patient_id = p_patient_id AND a.status <> 'cancelled'
    ORDER BY a.assigned_at DESC;
END $$;

CREATE FUNCTION public.portal_submit_patient_form(p_id uuid, p_answers jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE assignment public.patient_form_assignments; q jsonb; answer text; option_index integer;
  total numeric := 0; maximum numeric := 0; options_count integer; qtype text;
BEGIN
  SELECT * INTO assignment FROM public.patient_form_assignments WHERE id = p_id FOR UPDATE;
  IF assignment.id IS NULL THEN RAISE EXCEPTION 'Formulário não encontrado.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.portal_patient(assignment.patient_id);
  IF assignment.status <> 'assigned' THEN RAISE EXCEPTION 'Formulário já encerrado.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_answers) <> 'object' OR (SELECT count(*) FROM jsonb_each(p_answers)) > 30 THEN
    RAISE EXCEPTION 'Respostas inválidas.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_answers) key WHERE NOT EXISTS
    (SELECT 1 FROM jsonb_array_elements(assignment.questions) q WHERE q->>'id' = key)) THEN
    RAISE EXCEPTION 'Resposta para pergunta inexistente.' USING ERRCODE = 'P0001'; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(assignment.questions) LOOP
    qtype := q->>'type'; answer := p_answers->> (q->>'id');
    IF coalesce((q->>'required')::boolean, true) AND nullif(trim(coalesce(answer,'')), '') IS NULL THEN
      RAISE EXCEPTION 'Responda a todas as perguntas obrigatórias.' USING ERRCODE = 'P0001'; END IF;
    IF answer IS NULL OR answer = '' THEN CONTINUE; END IF;
    IF jsonb_typeof(p_answers->(q->>'id')) <> 'string' THEN
      RAISE EXCEPTION 'Resposta inválida.' USING ERRCODE = 'P0001'; END IF;
    IF qtype = 'text' AND length(answer) > 2000 THEN
      RAISE EXCEPTION 'Resposta longa demais.' USING ERRCODE = 'P0001';
    ELSIF qtype = 'number' AND (answer !~ '^-?[0-9]+(\.[0-9]+)?$' OR length(answer) > 20) THEN
      RAISE EXCEPTION 'Número inválido.' USING ERRCODE = 'P0001';
    ELSIF qtype IN ('choice','scale') THEN
      IF answer !~ '^[0-6]$' OR answer::integer >= jsonb_array_length(q->'options') THEN
        RAISE EXCEPTION 'Opção inválida.' USING ERRCODE = 'P0001'; END IF;
      IF qtype = 'scale' THEN
        option_index := answer::integer; options_count := jsonb_array_length(q->'options');
        total := total + CASE WHEN coalesce((q->>'reverse')::boolean, false) THEN options_count - 1 - option_index ELSE option_index END;
        maximum := maximum + options_count - 1;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.patient_form_assignments SET answers = p_answers,
    score = CASE WHEN assignment.kind = 'scale' THEN total END,
    score_max = CASE WHEN assignment.kind = 'scale' THEN maximum END,
    status = 'completed', completed_at = now(), answered_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT p.id, 'portal', 'Paciente respondeu um formulário.', '#/prontuarios?paciente=' || assignment.patient_id
  FROM public.profiles p WHERE p.professional_id = assignment.professional_id AND p.active;
END $$;

CREATE FUNCTION public.clinical_patient_form_results(p_patient_id uuid)
RETURNS TABLE (id uuid, title text, description text, kind text, questions jsonb, answers jsonb,
  score numeric, score_max numeric, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.require_author_of(p_patient_id);
BEGIN
  PERFORM private.log_clinical_access(p_patient_id, 'view_record', NULL);
  RETURN QUERY SELECT a.id, a.title, a.description, a.kind, a.questions, a.answers,
    a.score, a.score_max, a.completed_at FROM public.patient_form_assignments a
    WHERE a.patient_id = p_patient_id AND a.professional_id = professional AND a.status = 'completed'
    ORDER BY a.completed_at DESC;
END $$;

REVOKE ALL ON FUNCTION private.check_patient_form_questions(jsonb, text),
  public.patient_form_templates_list(), public.save_patient_form_template(uuid,text,text,text,jsonb),
  public.assign_patient_form(uuid,uuid,date), public.patient_form_assignments_list(uuid),
  public.portal_patient_forms(uuid), public.portal_submit_patient_form(uuid,jsonb),
  public.clinical_patient_form_results(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.check_patient_form_questions(jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.patient_form_templates_list(),
  public.save_patient_form_template(uuid,text,text,text,jsonb), public.assign_patient_form(uuid,uuid,date),
  public.patient_form_assignments_list(uuid), public.portal_patient_forms(uuid),
  public.portal_submit_patient_form(uuid,jsonb), public.clinical_patient_form_results(uuid) TO authenticated;
