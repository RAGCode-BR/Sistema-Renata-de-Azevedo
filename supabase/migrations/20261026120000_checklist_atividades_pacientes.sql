-- Itens opcionais das tarefas, marcados individualmente pelo paciente no portal.
ALTER TABLE public.patient_activities
  ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 20);

CREATE FUNCTION public.save_patient_activity_with_checklist(p_id uuid, p_patient_id uuid, p_title text,
  p_instructions text, p_due_date date, p_professional_id uuid, p_checklist jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved uuid; old_items jsonb; new_items jsonb := '[]'::jsonb; item jsonb;
  item_id text; item_text text; completed text; seen text[] := ARRAY[]::text[];
BEGIN
  IF p_checklist IS NULL OR jsonb_typeof(p_checklist) <> 'array' OR jsonb_array_length(p_checklist) > 20 THEN
    RAISE EXCEPTION 'O checklist deve ter até 20 itens.' USING ERRCODE = 'P0001';
  END IF;
  -- A função original verifica carteira, profissional, situação e campos da tarefa.
  saved := public.save_patient_activity(p_id, p_patient_id, p_title, p_instructions, p_due_date, p_professional_id);
  SELECT a.checklist INTO old_items FROM public.patient_activities a WHERE a.id = saved FOR UPDATE;
  FOR item IN SELECT value FROM jsonb_array_elements(p_checklist) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Item do checklist inválido.' USING ERRCODE = 'P0001'; END IF;
    item_id := coalesce(nullif(item->>'id', ''), gen_random_uuid()::text);
    item_text := trim(coalesce(item->>'text', ''));
    IF item_id !~ '^[0-9a-fA-F-]{36}$' OR length(item_text) NOT BETWEEN 1 AND 200
      OR item_id = ANY(seen) THEN
      RAISE EXCEPTION 'Cada item precisa de um texto de até 200 caracteres.' USING ERRCODE = 'P0001'; END IF;
    seen := array_append(seen, item_id);
    SELECT previous->>'completed_at' INTO completed
      FROM jsonb_array_elements(old_items) previous WHERE previous->>'id' = item_id;
    IF completed IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(old_items) previous
      WHERE previous->>'id' = item_id AND previous->>'text' <> item_text
    ) THEN RAISE EXCEPTION 'Itens concluídos não podem ser alterados.' USING ERRCODE = 'P0001'; END IF;
    new_items := new_items || jsonb_build_array(jsonb_build_object(
      'id', item_id, 'text', item_text, 'completed_at', completed));
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(old_items) previous
    WHERE previous->>'completed_at' IS NOT NULL AND NOT (previous->>'id' = ANY(seen))) THEN
    RAISE EXCEPTION 'Itens concluídos não podem ser removidos.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.patient_activities SET checklist = new_items WHERE id = saved;
  RETURN saved;
END $$;

CREATE FUNCTION public.portal_complete_patient_activity_item(p_id uuid, p_item_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE activity public.patient_activities; item_index integer;
BEGIN
  SELECT * INTO activity FROM public.patient_activities WHERE id = p_id FOR UPDATE;
  IF activity.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.portal_patient(activity.patient_id);
  IF activity.status <> 'assigned' THEN RAISE EXCEPTION 'Tarefa já encerrada.' USING ERRCODE = 'P0001'; END IF;
  SELECT (ordinality - 1)::integer INTO item_index
    FROM jsonb_array_elements(activity.checklist) WITH ORDINALITY AS entry(value, ordinality)
    WHERE value->>'id' = p_item_id AND value->>'completed_at' IS NULL;
  IF item_index IS NULL THEN RAISE EXCEPTION 'Item não encontrado ou já concluído.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.patient_activities SET checklist = jsonb_set(checklist,
    ARRAY[item_index::text, 'completed_at'], to_jsonb(now()::text)), updated_at = now() WHERE id = p_id;
END $$;

DROP FUNCTION public.patient_activity_list(uuid);
CREATE FUNCTION public.patient_activity_list(p_patient_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, title text,
  instructions text, due_date date, status text, patient_response text, completed_at timestamptz,
  created_at timestamptz, checklist jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL AND NOT private.has_permission('patient_activities.manage_all') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT a.id, a.patient_id, p.name, a.professional_id, pr.name, a.title, a.instructions, a.due_date,
    a.status, a.patient_response, a.completed_at, a.created_at, a.checklist
  FROM public.patient_activities a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE ((a.professional_id = professional AND private.cares_for(a.patient_id))
    OR private.has_permission('patient_activities.manage_all'))
    AND (p_patient_id IS NULL OR a.patient_id = p_patient_id)
  ORDER BY a.created_at DESC;
END $$;

DROP FUNCTION public.portal_patient_activities(uuid);
CREATE FUNCTION public.portal_patient_activities(p_patient_id uuid)
RETURNS TABLE (id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, title text,
  instructions text, due_date date, status text, patient_response text, completed_at timestamptz,
  created_at timestamptz, checklist jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT a.id, a.patient_id, p.name, a.professional_id, pr.name, a.title, a.instructions, a.due_date,
    a.status, a.patient_response, a.completed_at, a.created_at, a.checklist
  FROM public.patient_activities a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE a.patient_id = p_patient_id AND a.status <> 'cancelled'
  ORDER BY a.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.portal_complete_patient_activity(p_id uuid, p_response text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE activity public.patient_activities;
BEGIN
  SELECT * INTO activity FROM public.patient_activities WHERE id = p_id FOR UPDATE;
  IF activity.id IS NULL THEN RAISE EXCEPTION 'Atividade não encontrada.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.portal_patient(activity.patient_id);
  IF activity.status <> 'assigned' THEN RAISE EXCEPTION 'Atividade já encerrada.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(activity.checklist) item WHERE item->>'completed_at' IS NULL) THEN
    RAISE EXCEPTION 'Conclua todos os itens do checklist antes de finalizar a tarefa.' USING ERRCODE = 'P0001'; END IF;
  IF length(coalesce(p_response, '')) > 4000 THEN RAISE EXCEPTION 'Resposta muito longa.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.patient_activities SET status = 'completed', patient_response = nullif(trim(p_response), ''),
    completed_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT p.id, 'portal', 'Paciente concluiu uma tarefa.', '#/tarefas'
  FROM public.profiles p WHERE p.professional_id = activity.professional_id AND p.active;
END $$;

REVOKE ALL ON FUNCTION public.save_patient_activity_with_checklist(uuid, uuid, text, text, date, uuid, jsonb),
  public.portal_complete_patient_activity_item(uuid, text), public.patient_activity_list(uuid),
  public.portal_patient_activities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_patient_activity_with_checklist(uuid, uuid, text, text, date, uuid, jsonb),
  public.portal_complete_patient_activity_item(uuid, text), public.patient_activity_list(uuid),
  public.portal_patient_activities(uuid) TO authenticated;
