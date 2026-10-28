-- Modelos de formulário: "required" e "reverse" só como verdadeiro/falso, para o envio do paciente não falhar.
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
    -- "obrigatória" e "invertida" são lidas como verdadeiro/falso ao enviar: outro tipo travaria o paciente.
    IF (q ? 'required' AND jsonb_typeof(q->'required') <> 'boolean') OR (q ? 'reverse' AND jsonb_typeof(q->'reverse') <> 'boolean') THEN
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
