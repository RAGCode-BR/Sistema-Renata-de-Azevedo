-- Homologação: pacientes, sessões, cobranças, tarefas e contatos FICTÍCIOS para a equipe testar.
-- Tudo marcado com [HOMOLOGAÇÃO] (observação administrativa / título / nome) e removido por limpar.sql.
-- Uso: node tests/homologacao/rodar.mjs criar
DO $$
DECLARE
  pros uuid[] := ARRAY(SELECT id FROM public.professionals WHERE active ORDER BY name);
  names text[] := ARRAY['Ana Teste Silva', 'Bruno Teste Souza', 'Carla Teste Lima', 'Daniel Teste Rocha',
    'Elisa Teste Costa', 'Fábio Teste Alves', 'Gabriela Teste Dias', 'Heitor Teste Nunes'];
  patient uuid;
  pro uuid;
  appt uuid;
  base timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  i int;
BEGIN
  IF cardinality(pros) = 0 THEN RAISE EXCEPTION 'Cadastre ao menos uma profissional ativa antes de criar os dados de homologação.'; END IF;
  IF EXISTS (SELECT 1 FROM public.patients WHERE admin_notes LIKE '[HOMOLOGAÇÃO]%') THEN
    RAISE EXCEPTION 'Os dados de homologação já existem. Rode "limpar" antes de criar de novo.';
  END IF;
  FOR i IN 1..array_length(names, 1) LOOP
    pro := pros[1 + (i - 1) % cardinality(pros)];
    INSERT INTO public.patients (name, phone, email, birth_date, admin_notes, whatsapp_opt_in)
    VALUES (names[i], '+5511900000' || lpad(i::text, 3, '0'), 'paciente-ficticio-' || i || '@example.test',
      CASE WHEN i = 8 THEN (now() - interval '15 years')::date ELSE (now() - make_interval(years => 25 + i * 3))::date END,
      '[HOMOLOGAÇÃO] Paciente fictício para testes. Apagado antes do uso real.', false)
    RETURNING id INTO patient;
    IF i = 8 THEN
      UPDATE public.patients SET guardian_name = 'Responsável Teste Nunes', guardian_relationship = 'Mãe',
        guardian_email = 'responsavel-ficticio@example.test' WHERE id = patient;
    END IF;
    INSERT INTO public.patient_professionals VALUES (patient, pro);

    -- Duas sessões passadas (uma realizada; falta para os pacientes 3 e 6) e duas futuras.
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at, modality)
    VALUES (patient, pro, base - make_interval(days => 7 + i) + make_interval(hours => 8 + i), base - make_interval(days => 7 + i) + make_interval(hours => 8 + i, mins => 50), 'presencial')
    RETURNING id INTO appt;
    UPDATE public.appointments SET status = 'completed' WHERE id = appt;
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at, modality)
    VALUES (patient, pro, base - make_interval(days => i) + make_interval(hours => 8 + i), base - make_interval(days => i) + make_interval(hours => 8 + i, mins => 50), 'online')
    RETURNING id INTO appt;
    UPDATE public.appointments SET status = CASE WHEN i IN (3, 6) THEN 'missed' ELSE 'completed' END WHERE id = appt;
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at, modality) VALUES
      (patient, pro, base + make_interval(days => i % 5 + 1, hours => 8 + i), base + make_interval(days => i % 5 + 1, hours => 8 + i, mins => 50), CASE WHEN i % 2 = 0 THEN 'online' ELSE 'presencial' END),
      (patient, pro, base + make_interval(days => i % 5 + 8, hours => 8 + i), base + make_interval(days => i % 5 + 8, hours => 8 + i, mins => 50), 'presencial');
  END LOOP;

  INSERT INTO public.tasks (title, description, priority, due_date, created_by) VALUES
    ('[HOMOLOGAÇÃO] Conferir agenda da semana', 'Tarefa fictícia para testes.', 'normal', (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL),
    ('[HOMOLOGAÇÃO] Ligar para paciente que faltou', 'Tarefa fictícia para testes.', 'high', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1, NULL);

  INSERT INTO public.leads (name, phone, stage_id, created_by)
  SELECT n, '+5511911111' || lpad(k::text, 3, '0'), (SELECT id FROM public.lead_stages WHERE kind = 'open' ORDER BY position LIMIT 1), NULL
  FROM unnest(ARRAY['Contato Teste Um [HOMOLOGAÇÃO]', 'Contato Teste Dois [HOMOLOGAÇÃO]', 'Contato Teste Três [HOMOLOGAÇÃO]']) WITH ORDINALITY AS t(n, k);
END $$;

SELECT (SELECT count(*) FROM public.patients WHERE admin_notes LIKE '[HOMOLOGAÇÃO]%') AS pacientes,
  (SELECT count(*) FROM public.appointments a JOIN public.patients p ON p.id = a.patient_id WHERE p.admin_notes LIKE '[HOMOLOGAÇÃO]%') AS sessoes,
  (SELECT count(*) FROM public.charges c JOIN public.patients p ON p.id = c.patient_id WHERE p.admin_notes LIKE '[HOMOLOGAÇÃO]%') AS cobrancas,
  (SELECT count(*) FROM public.leads WHERE name LIKE '%[HOMOLOGAÇÃO]') AS contatos;
