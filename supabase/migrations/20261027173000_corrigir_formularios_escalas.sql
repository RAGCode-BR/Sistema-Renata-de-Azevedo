-- Evita ambiguidade entre variável PL/pgSQL e alias SQL nas validações.
CREATE OR REPLACE FUNCTION private.check_patient_form_questions(p_questions jsonb, p_kind text) RETURNS void
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
  IF p_kind = 'scale' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) entry WHERE entry->>'type' = 'scale') THEN
    RAISE EXCEPTION 'Uma escala precisa de perguntas pontuáveis.' USING ERRCODE = 'P0001'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.portal_submit_patient_form(p_id uuid, p_answers jsonb) RETURNS void
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
    (SELECT 1 FROM jsonb_array_elements(assignment.questions) entry WHERE entry->>'id' = key)) THEN
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

