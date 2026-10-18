-- Teste das permissões (RLS). Rodar com: npm run test:db
-- Tudo acontece numa transação desfeita no final (ROLLBACK): nenhum dado fica no banco.
-- Cada verificação que falhar interrompe o teste com uma mensagem "FALHA: ...".
-- Roda no banco real: contagens positivas olham só os registros de teste; "deve ver zero" olha a tabela inteira.
BEGIN;

-- Cenário --------------------------------------------------------------------------------------
-- Profissionais A, B e R (R = a Proprietária que também atende, como a Renata).
-- Paciente P é da A; paciente Q é da R. Cada uma tem uma evolução.
INSERT INTO public.professionals (id, name) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Teste Profissional A'),
  ('00000000-0000-4000-8000-00000000000b', 'Teste Profissional B'),
  ('00000000-0000-4000-8000-00000000000c', 'Teste Profissional R');

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'teste-dona@example.test', '{"roles":["owner"]}', '{"name":"Teste Dona"}'),
  ('00000000-0000-4000-8000-0000000000d3', 'teste-dona-atende@example.test',
   '{"roles":["owner","professional"],"professional_id":"00000000-0000-4000-8000-00000000000c"}', '{"name":"Teste Dona que Atende"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'teste-gerente@example.test', '{"roles":["manager"]}', '{"name":"Teste Gerente"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'teste-recepcao@example.test', '{"roles":["reception"]}', '{"name":"Teste Recepção"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'teste-financeiro@example.test', '{"roles":["finance"]}', '{"name":"Teste Financeiro"}'),
  ('00000000-0000-4000-8000-0000000000a1', 'teste-a@example.test',
   '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-00000000000a"}', '{"name":"Teste A"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'teste-b@example.test',
   '{"roles":["professional"],"professional_id":"00000000-0000-4000-8000-00000000000b"}', '{"name":"Teste B"}'),
  ('00000000-0000-4000-8000-0000000000c1', 'teste-paciente@example.test', '{"roles":["patient"]}', '{"name":"Teste Paciente"}'),
  ('00000000-0000-4000-8000-0000000000e1', 'teste-sem-perfil@example.test', '{}', '{}');

-- Como o Supabase Auth faz: conta gravada primeiro, perfis preenchidos depois.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000d2', 'teste-perfil-depois@example.test', '{"provider":"email"}', '{"name":"Teste Perfil Depois"}');
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"roles":["manager"]}'
WHERE id = '00000000-0000-4000-8000-0000000000d2';

INSERT INTO public.patients (id, name) VALUES
  ('00000000-0000-4000-8000-0000000000f1', 'Teste Paciente P'),
  ('00000000-0000-4000-8000-0000000000f4', 'Teste Paciente Q');
INSERT INTO public.patient_professionals VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c');
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at) VALUES
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   '2030-01-07 12:00+00', '2030-01-07 12:50+00'),
  -- Sessão já realizada e sem evolução: deve aparecer como pendente.
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   '2020-01-06 12:00+00', '2020-01-06 12:50+00');
-- Evolução pendente é só de sessão realizada.
UPDATE public.appointments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-0000000000c3';
INSERT INTO public.clinical_notes (patient_id, professional_id, body) VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', 'Evolução da A.'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', 'Evolução da R.');

DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE email LIKE 'teste-%') <> 9 THEN
    RAISE EXCEPTION 'FALHA: perfis criados pelo gatilho (esperado 9; a conta sem perfis não ganha acesso)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000000d2' AND role = 'manager') THEN
    RAISE EXCEPTION 'FALHA: perfis não foram criados quando chegaram depois da conta';
  END IF;
  IF (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000000d3') <> 2 THEN
    RAISE EXCEPTION 'FALHA: Proprietária que atende deveria ter dois perfis';
  END IF;
  BEGIN
    INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
      ('00000000-0000-4000-8000-0000000000e9', 'teste-prof-sem-vinculo@example.test', '{"roles":["professional"]}');
    RAISE EXCEPTION 'FALHA: perfil Profissional aceito sem profissional vinculada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;

-- Sem login (chave pública sozinha): nenhuma tabela pode ser lida.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.patients;
    RAISE EXCEPTION 'FALHA: sem login foi possível ler pacientes';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.user_roles;
    RAISE EXCEPTION 'FALHA: sem login foi possível ler perfis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Proprietária: tudo o que é administrativo; nenhum prontuário.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients WHERE name LIKE 'Teste Paciente %') <> 2 THEN RAISE EXCEPTION 'FALHA: Proprietária deveria ver todos os pacientes'; END IF;
  IF (SELECT count(*) FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 1 THEN RAISE EXCEPTION 'FALHA: Proprietária deveria ver a agenda'; END IF;
  BEGIN
    PERFORM 1 FROM public.clinical_notes;
    RAISE EXCEPTION 'FALHA: Proprietária leu a tabela de prontuários diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Proprietária abriu prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.profiles WHERE email LIKE 'teste-%') <> 9 THEN RAISE EXCEPTION 'FALHA: Proprietária deveria ver as contas'; END IF;
  IF NOT (public.my_access()->'permissions') ? 'users.manage' THEN RAISE EXCEPTION 'FALHA: my_access sem users.manage para a Proprietária'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pending_clinical_notes() WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3') THEN
    RAISE EXCEPTION 'FALHA: Proprietária deveria ver a evolução pendente (sem o conteúdo)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pending_clinical_notes() WHERE appointment_id = '00000000-0000-4000-8000-0000000000c2') THEN
    RAISE EXCEPTION 'FALHA: sessão futura aparece como evolução pendente';
  END IF;
  BEGIN
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2030-01-07 12:25+00', '2030-01-07 13:00+00');
    RAISE EXCEPTION 'FALHA: sessões sobrepostas foram aceitas';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000b', '2030-01-08 12:00+00', '2030-01-08 12:50+00');
    RAISE EXCEPTION 'FALHA: sessão com profissional não vinculada foi aceita';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.clinical_notes (patient_id, professional_id, body) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', 'Tentativa da Proprietária.');
    RAISE EXCEPTION 'FALHA: Proprietária registrou evolução';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-0000000000e2', 'owner');
    RAISE EXCEPTION 'FALHA: perfil gravado direto na tabela, sem set_user_access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Proprietária que também atende (caso da Renata): visão administrativa + só o próprio prontuário.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients WHERE name LIKE 'Teste Paciente %') <> 2 THEN RAISE EXCEPTION 'FALHA: Proprietária que atende deveria ver todos os pacientes'; END IF;
  IF jsonb_array_length(public.clinical_record('00000000-0000-4000-8000-0000000000f4')->'notes') <> 1
    OR public.clinical_record('00000000-0000-4000-8000-0000000000f4')->'notes'->0->>'body' <> 'Evolução da R.' THEN
    RAISE EXCEPTION 'FALHA: Proprietária que atende deveria ver só a própria evolução';
  END IF;
  PERFORM public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f4', NULL, 'evolution', 'Nova evolução da R.');
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Proprietária que atende abriu prontuário de paciente de outra profissional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Intrusão da R.');
    RAISE EXCEPTION 'FALHA: Proprietária que atende escreveu no prontuário de paciente de outra profissional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Gerente: operação (agenda, pacientes, profissionais); sem usuários e sem prontuários.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients WHERE name LIKE 'Teste Paciente %') <> 2 THEN RAISE EXCEPTION 'FALHA: Gerente deveria ver todos os pacientes'; END IF;
  IF (SELECT count(*) FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 1 THEN RAISE EXCEPTION 'FALHA: Gerente deveria ver a agenda'; END IF;
  BEGIN
    PERFORM 1 FROM public.clinical_notes;
    RAISE EXCEPTION 'FALHA: Gerente leu a tabela de prontuários diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Gerente abriu prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'FALHA: Gerente deveria ver só a própria conta'; END IF;
  INSERT INTO public.professionals (name) VALUES ('Teste Cadastrada pela Gerente');
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000f2', ARRAY['owner'], NULL, true);
    RAISE EXCEPTION 'FALHA: Gerente alterou perfis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Recepção (pronta para depois): pacientes e agenda; sem profissionais e sem prontuários.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients WHERE name LIKE 'Teste Paciente %') <> 2 THEN RAISE EXCEPTION 'FALHA: Recepção deveria ver os pacientes'; END IF;
  IF (SELECT count(*) FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 1 THEN RAISE EXCEPTION 'FALHA: Recepção deveria ver a agenda'; END IF;
  BEGIN
    PERFORM 1 FROM public.clinical_notes;
    RAISE EXCEPTION 'FALHA: Recepção leu a tabela de prontuários diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Recepção abriu prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.create_patient('Teste Cadastrado pela Recepção', '', '', NULL, ARRAY['00000000-0000-4000-8000-00000000000a'::uuid]);
  BEGIN
    INSERT INTO public.professionals (name) VALUES ('Tentativa da Recepção');
    RAISE EXCEPTION 'FALHA: Recepção cadastrou profissional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Financeiro (pronto para depois): nada clínico nem operacional por enquanto.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 0 THEN RAISE EXCEPTION 'FALHA: Financeiro viu pacientes'; END IF;
  BEGIN
    PERFORM 1 FROM public.clinical_notes;
    RAISE EXCEPTION 'FALHA: Financeiro leu a tabela de prontuários diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Financeiro abriu prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.pending_clinical_notes()) <> 0 THEN RAISE EXCEPTION 'FALHA: Financeiro viu pendências de prontuário'; END IF;
  IF (SELECT count(*) FROM public.professionals) = 0 THEN RAISE EXCEPTION 'FALHA: Financeiro (equipe) deveria ver profissionais'; END IF;
END $$;
RESET ROLE;

-- Profissional A: a própria carteira e as próprias evoluções.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE
  note uuid;
BEGIN
  IF (SELECT count(*) FROM public.patients WHERE name LIKE 'Teste Paciente %') <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver só o próprio paciente'; END IF;
  IF jsonb_array_length(public.clinical_record('00000000-0000-4000-8000-0000000000f1')->'notes') <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver só a própria evolução'; END IF;
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver só a própria conta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pending_clinical_notes() WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3') THEN
    RAISE EXCEPTION 'FALHA: profissional A deveria ver a própria evolução pendente';
  END IF;
  note := public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c3', 'evolution', 'Evolução da sessão pendente.');
  IF NOT EXISTS (SELECT 1 FROM public.pending_clinical_notes() WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3' AND note_status = 'draft') THEN
    RAISE EXCEPTION 'FALHA: rascunho deveria manter a sessão pendente (como rascunho)';
  END IF;
  PERFORM public.finalize_clinical_note(note);
  IF EXISTS (SELECT 1 FROM public.pending_clinical_notes() WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3') THEN
    RAISE EXCEPTION 'FALHA: evolução finalizada continuou pendente';
  END IF;
  BEGIN
    INSERT INTO public.patients (name) VALUES ('Paciente criado pela profissional');
    RAISE EXCEPTION 'FALHA: profissional cadastrou paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Profissional B: nada da A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu paciente de outra'; END IF;
  IF (SELECT count(*) FROM public.appointments) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu agenda de outra'; END IF;
  BEGIN
    PERFORM 1 FROM public.clinical_notes;
    RAISE EXCEPTION 'FALHA: profissional B leu a tabela de prontuários diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.clinical_record('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: profissional B abriu prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.pending_clinical_notes()) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu pendências de outra'; END IF;
  BEGIN
    PERFORM public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Intrusão.');
    RAISE EXCEPTION 'FALHA: profissional B escreveu no prontuário da A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Prontuário e conceitualização (Bloco 5) -----------------------------------------------------
-- Profissional A: rascunho com versões, finalização, retificação, anotação pessoal, exportação,
-- conceitualização, modelo próprio e documento clínico.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE
  draft uuid;
  fix uuid;
  record jsonb;
  exported jsonb;
  document uuid;
BEGIN
  draft := public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Rascunho 1');
  PERFORM public.save_clinical_note(draft, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Rascunho 2');
  IF (SELECT count(*) FROM public.clinical_note_revisions(draft)) <> 1
    OR (SELECT body FROM public.clinical_note_revisions(draft)) <> 'Rascunho 1' THEN
    RAISE EXCEPTION 'FALHA: alteração do rascunho não guardou a versão anterior';
  END IF;
  PERFORM public.finalize_clinical_note(draft);
  BEGIN
    PERFORM public.save_clinical_note(draft, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Alteração indevida');
    RAISE EXCEPTION 'FALHA: evolução finalizada foi alterada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_clinical_note(draft);
    RAISE EXCEPTION 'FALHA: evolução finalizada foi apagada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  fix := public.rectify_clinical_note(draft, 'Rascunho 2 corrigido', 'Erro de digitação');
  record := public.clinical_record('00000000-0000-4000-8000-0000000000f1');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(record->'notes') n
    WHERE (n->>'id')::uuid = draft AND n->>'body' = 'Rascunho 2' AND (n->>'rectified_by')::uuid = fix) THEN
    RAISE EXCEPTION 'FALHA: original retificado deveria continuar igual e apontar a retificação';
  END IF;

  PERFORM public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', NULL, 'personal', 'Nota pessoal da A');
  PERFORM public.save_clinical_note(NULL, '00000000-0000-4000-8000-0000000000f1', NULL, 'evolution', 'Rascunho não finalizado');
  exported := public.export_clinical_record('00000000-0000-4000-8000-0000000000f1');
  IF exported::text LIKE '%Nota pessoal da A%' OR exported::text LIKE '%Rascunho não finalizado%' THEN
    RAISE EXCEPTION 'FALHA: exportação incluiu anotação pessoal ou rascunho';
  END IF;
  IF exported::text NOT LIKE '%Rascunho 2 corrigido%' THEN
    RAISE EXCEPTION 'FALHA: exportação sem a retificação';
  END IF;

  PERFORM public.save_case_formulation('00000000-0000-4000-8000-0000000000f1', 'Modelo da clínica',
    '[{"key":"motivo","label":"Motivo da procura"}]', '{"motivo":"Primeira versão"}');
  PERFORM public.save_case_formulation('00000000-0000-4000-8000-0000000000f1', 'Modelo da clínica',
    '[{"key":"motivo","label":"Motivo da procura"}]', '{"motivo":"Segunda versão"}');
  record := public.clinical_record('00000000-0000-4000-8000-0000000000f1');
  IF record->'formulation'->'content'->>'motivo' <> 'Segunda versão' OR (record->'formulation'->>'revisions')::int <> 1 THEN
    RAISE EXCEPTION 'FALHA: conceitualização não salvou a versão anterior';
  END IF;

  INSERT INTO public.case_formulation_templates (professional_id, name, sections)
  VALUES ('00000000-0000-4000-8000-00000000000a', 'Modelo da A', '[{"key":"x","label":"X"}]');
  IF (SELECT count(*) FROM public.case_formulation_templates) <> 2 THEN
    RAISE EXCEPTION 'FALHA: profissional deveria ver o modelo da clínica e o próprio';
  END IF;

  INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-documents',
    'patients/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-00000000000a/laudo.pdf');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-documents',
      'patients/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-00000000000b/laudo.pdf');
    RAISE EXCEPTION 'FALHA: documento clínico enviado na pasta de outra profissional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'clinical-documents') <> 0 THEN
    RAISE EXCEPTION 'FALHA: documento clínico lido direto do Storage';
  END IF;
  document := public.register_clinical_document('00000000-0000-4000-8000-0000000000f1', 'Laudo',
    'patients/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-00000000000a/laudo.pdf', 1000, 'application/pdf');
  IF public.authorize_clinical_document(document) NOT LIKE 'patients/%/laudo.pdf' THEN
    RAISE EXCEPTION 'FALHA: autora deveria conseguir abrir o próprio documento clínico';
  END IF;
  PERFORM set_config('teste.documento', document::text, true);
END $$;
RESET ROLE;

-- Profissional B: não abre o documento clínico da A nem vê o modelo dela.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.authorize_clinical_document(current_setting('teste.documento')::uuid);
    RAISE EXCEPTION 'FALHA: profissional B abriu documento clínico da A';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.case_formulation_templates) <> 1 THEN
    RAISE EXCEPTION 'FALHA: profissional B viu o modelo de conceitualização da A';
  END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-documents',
      'patients/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-00000000000b/x.pdf');
    RAISE EXCEPTION 'FALHA: profissional B enviou documento clínico de paciente da A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Gerente: acompanha a situação de preenchimento, sem conteúdo; não vê a auditoria nem muda o prazo.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT note_status FROM public.clinical_note_status('2020-01-01', '2020-12-31')
      WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3') <> 'final_late' THEN
    RAISE EXCEPTION 'FALHA: sessão de 2020 finalizada agora deveria aparecer como finalizada fora do prazo';
  END IF;
  IF (SELECT count(*) FROM public.clinical_access_log) <> 0 THEN
    RAISE EXCEPTION 'FALHA: Gerente viu a auditoria de acesso ao prontuário';
  END IF;
  UPDATE public.clinic_settings SET note_deadline_hours = 1;
  IF (SELECT note_deadline_hours FROM public.clinic_settings) = 1 THEN
    RAISE EXCEPTION 'FALHA: Gerente alterou o prazo do prontuário';
  END IF;
END $$;
RESET ROLE;

-- Proprietária: vê QUEM acessou e quando (sem conteúdo) e altera o prazo.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clinical_access_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000000a1' AND action = 'view_record')
    OR NOT EXISTS (SELECT 1 FROM public.clinical_access_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000000a1' AND action = 'export')
    OR NOT EXISTS (SELECT 1 FROM public.clinical_access_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000000a1' AND action = 'open_document') THEN
    RAISE EXCEPTION 'FALHA: aberturas, exportação e documento não ficaram na auditoria de acesso';
  END IF;
  UPDATE public.clinic_settings SET note_deadline_hours = 72;
  IF (SELECT note_deadline_hours FROM public.clinic_settings) <> 72 THEN
    RAISE EXCEPTION 'FALHA: Proprietária não alterou o prazo do prontuário';
  END IF;
  IF (SELECT count(*) FROM public.case_formulation_templates) <> 0 THEN
    RAISE EXCEPTION 'FALHA: quem não atende viu modelos de conceitualização';
  END IF;
END $$;
RESET ROLE;

-- Agenda (Bloco 3) -----------------------------------------------------------------------------
-- Gerente: situação, remarcação, série recorrente, cancelamento da série e bloqueios.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$
DECLARE
  moved uuid;
  series uuid;
  first_of_series uuid;
BEGIN
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c2', 'confirmed');
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 'confirmed' THEN
    RAISE EXCEPTION 'FALHA: Gerente não confirmou a sessão';
  END IF;
  BEGIN
    PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c2', 'completed');
    RAISE EXCEPTION 'FALHA: presença registrada em sessão futura';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;

  UPDATE public.appointments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-0000000000c2';
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 'confirmed' THEN
    RAISE EXCEPTION 'FALHA: sessão alterada direto na tabela, sem as funções';
  END IF;

  moved := public.reschedule_appointment('00000000-0000-4000-8000-0000000000c2', '2030-01-14 12:00+00', '2030-01-14 12:50+00');
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000000c2') <> 'rescheduled'
    OR (SELECT rescheduled_from FROM public.appointments WHERE id = moved) <> '00000000-0000-4000-8000-0000000000c2' THEN
    RAISE EXCEPTION 'FALHA: remarcação não ligou a sessão nova à original';
  END IF;
  BEGIN
    PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c2', 'confirmed');
    RAISE EXCEPTION 'FALHA: sessão remarcada foi alterada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.appointment_events WHERE appointment_id = '00000000-0000-4000-8000-0000000000c2'
    AND action = 'status_changed' AND to_status = 'rescheduled') THEN
    RAISE EXCEPTION 'FALHA: remarcação não ficou no histórico';
  END IF;

  -- Série com conflito (cai na sessão remarcada para 14/01): nada é criado.
  BEGIN
    PERFORM public.create_appointment_series('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
      '2030-01-07 12:00+00', '2030-01-07 12:50+00', 'presencial', 'individual', 'weekly', 3);
    RAISE EXCEPTION 'FALHA: série com conflito foi aceita';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE professional_id = '00000000-0000-4000-8000-00000000000a'
    AND starts_at = '2030-01-07 12:00+00' AND status = 'scheduled') THEN
    RAISE EXCEPTION 'FALHA: série com conflito deixou sessões criadas';
  END IF;

  series := public.create_appointment_series('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
    '2030-02-04 12:00+00', '2030-02-04 12:50+00', 'online', 'couple', 'weekly', 4);
  IF (SELECT count(*) FROM public.appointments WHERE series_id = series AND session_type = 'couple') <> 4 THEN
    RAISE EXCEPTION 'FALHA: série semanal não criou 4 sessões';
  END IF;
  SELECT id INTO first_of_series FROM public.appointments WHERE series_id = series ORDER BY starts_at LIMIT 1;
  IF public.cancel_appointment(first_of_series, 'patient', 'Viagem', true) <> 4 THEN
    RAISE EXCEPTION 'FALHA: cancelar "esta e as próximas" não cancelou a série';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE series_id = series
    AND (status <> 'cancelled_by_patient' OR cancellation_reason <> 'Viagem')) THEN
    RAISE EXCEPTION 'FALHA: cancelamento sem a situação ou o motivo certos';
  END IF;

  -- Bloqueio com motivo privado, criado pela gerência para a profissional A.
  PERFORM public.create_schedule_block('00000000-0000-4000-8000-00000000000a', '2030-03-04 12:00+00', '2030-03-04 13:00+00', 'Consulta médica', true);
  BEGIN
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2030-03-04 12:30+00', '2030-03-04 13:20+00');
    RAISE EXCEPTION 'FALHA: sessão agendada sobre um bloqueio';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_schedule_block('00000000-0000-4000-8000-00000000000a', '2030-01-14 12:30+00', '2030-01-14 13:30+00', NULL, false);
    RAISE EXCEPTION 'FALHA: bloqueio criado sobre uma sessão';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF (SELECT reason FROM public.list_schedule_blocks('2030-03-01', '2030-03-31')) IS DISTINCT FROM 'Consulta médica' THEN
    RAISE EXCEPTION 'FALHA: quem criou o bloqueio deveria ver o motivo';
  END IF;
END $$;
RESET ROLE;

-- Recepção vê o bloqueio, mas não o motivo privado; nem lê a tabela de bloqueios diretamente.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.list_schedule_blocks('2030-03-01', '2030-03-31')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: Recepção deveria ver o horário bloqueado';
  END IF;
  IF (SELECT reason FROM public.list_schedule_blocks('2030-03-01', '2030-03-31')) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: Recepção viu o motivo privado do bloqueio';
  END IF;
  BEGIN
    PERFORM 1 FROM public.schedule_blocks;
    RAISE EXCEPTION 'FALHA: tabela de bloqueios lida diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Profissional A: vê o motivo do próprio bloqueio, registra falta na própria sessão, bloqueia a
-- própria agenda, mas não a de outra profissional.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT reason FROM public.list_schedule_blocks('2030-03-01', '2030-03-31')) IS DISTINCT FROM 'Consulta médica' THEN
    RAISE EXCEPTION 'FALHA: profissional deveria ver o motivo do próprio bloqueio';
  END IF;
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c3', 'missed');
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c3', 'completed');
  PERFORM public.create_schedule_block('00000000-0000-4000-8000-00000000000a', '2030-04-01 12:00+00', '2030-04-01 18:00+00', 'Congresso', false);
  BEGIN
    PERFORM public.create_schedule_block('00000000-0000-4000-8000-00000000000b', '2030-04-01 12:00+00', '2030-04-01 18:00+00', NULL, false);
    RAISE EXCEPTION 'FALHA: profissional bloqueou a agenda de outra';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.appointment_events WHERE appointment_id = '00000000-0000-4000-8000-0000000000c3') < 3 THEN
    RAISE EXCEPTION 'FALHA: profissional deveria ver o histórico da própria sessão';
  END IF;
END $$;
RESET ROLE;

-- Profissional B e Financeiro não alteram sessões de outra profissional.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c3', 'missed');
    RAISE EXCEPTION 'FALHA: profissional B alterou sessão da A';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.appointment_events) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu histórico da A'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.cancel_appointment('00000000-0000-4000-8000-0000000000c3', 'clinic', NULL, false);
    RAISE EXCEPTION 'FALHA: Financeiro cancelou sessão';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- Pacientes e documentos (Bloco 4) ------------------------------------------------------------
-- Recepção cadastra e edita (cadastro completo + vínculos); profissional não.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$
DECLARE
  created uuid;
BEGIN
  created := public.save_patient(NULL, '{"name":"Teste Paciente Novo","cpf":"123.456.789-01","guardian_name":"Mãe Teste","birth_date":"2015-03-02"}',
    ARRAY['00000000-0000-4000-8000-00000000000a'::uuid]);
  IF (SELECT cpf FROM public.patients WHERE id = created) <> '12345678901'
    OR (SELECT guardian_name FROM public.patients WHERE id = created) <> 'Mãe Teste' THEN
    RAISE EXCEPTION 'FALHA: cadastro completo não foi salvo';
  END IF;
  BEGIN
    PERFORM public.save_patient(NULL, '{"name":"Teste CPF Repetido","cpf":"12345678901"}', ARRAY['00000000-0000-4000-8000-00000000000a'::uuid]);
    RAISE EXCEPTION 'FALHA: CPF repetido aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_patient(NULL, '{"name":"Teste CPF Curto","cpf":"123"}', ARRAY['00000000-0000-4000-8000-00000000000a'::uuid]);
    RAISE EXCEPTION 'FALHA: CPF inválido aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.save_patient(created, '{"name":"Teste Paciente Novo","status":"paused"}',
    ARRAY['00000000-0000-4000-8000-00000000000b'::uuid]);
  IF (SELECT status FROM public.patients WHERE id = created) <> 'paused'
    OR (SELECT array_agg(professional_id) FROM public.patient_professionals WHERE patient_id = created)
       <> ARRAY['00000000-0000-4000-8000-00000000000b'::uuid] THEN
    RAISE EXCEPTION 'FALHA: edição não trocou situação e vínculos';
  END IF;
  IF (SELECT cpf FROM public.patients WHERE id = created) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: campo apagado na edição continuou salvo';
  END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.save_patient('00000000-0000-4000-8000-0000000000f1', '{"name":"Alterado pela profissional"}',
      ARRAY['00000000-0000-4000-8000-00000000000a'::uuid]);
    RAISE EXCEPTION 'FALHA: profissional editou o cadastro do paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Documentos: a gerência envia; quem vê o paciente lê; os demais, nada.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  INSERT INTO public.patient_documents (patient_id, title, category, storage_path)
  VALUES ('00000000-0000-4000-8000-0000000000f1', 'Contrato', 'contract', 'patients/00000000-0000-4000-8000-0000000000f1/contrato.pdf');
  INSERT INTO storage.objects (bucket_id, name) VALUES ('patient-documents', 'patients/00000000-0000-4000-8000-0000000000f1/contrato.pdf');
  BEGIN
    INSERT INTO public.patient_documents (patient_id, title, category, storage_path)
    VALUES ('00000000-0000-4000-8000-0000000000f1', 'Caminho errado', 'other', 'patients/00000000-0000-4000-8000-0000000000f4/x.pdf');
    RAISE EXCEPTION 'FALHA: documento apontando para a pasta de outro paciente';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('patient-documents', 'outra-pasta/x.pdf');
    RAISE EXCEPTION 'FALHA: arquivo fora da pasta de um paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patient_documents WHERE patient_id = '00000000-0000-4000-8000-0000000000f1') <> 1
    OR (SELECT count(*) FROM storage.objects WHERE name LIKE 'patients/00000000-0000-4000-8000-0000000000f1/%') <> 1 THEN
    RAISE EXCEPTION 'FALHA: profissional responsável deveria ver o documento do paciente';
  END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('patient-documents', 'patients/00000000-0000-4000-8000-0000000000f1/da-profissional.pdf');
    RAISE EXCEPTION 'FALHA: profissional enviou documento administrativo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patient_documents) <> 0 OR (SELECT count(*) FROM storage.objects WHERE bucket_id = 'patient-documents') <> 0 THEN
    RAISE EXCEPTION 'FALHA: profissional B viu documentos de paciente de outra';
  END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patient_documents) <> 0 THEN RAISE EXCEPTION 'FALHA: Financeiro viu documentos de pacientes'; END IF;
END $$;
RESET ROLE;

-- Financeiro (Bloco 6) ------------------------------------------------------------------------
-- Sem preço cadastrado: cobrança "valor a definir" fica em aberto (não como paga) até ser ajustada.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$
DECLARE
  row record;
BEGIN
  INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at) VALUES
    ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2025-02-10 12:00+00', '2025-02-10 12:50+00');
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c9', 'completed');
  SELECT * INTO row FROM public.charge_list(NULL, NULL, NULL, true) WHERE appointment_id = '00000000-0000-4000-8000-0000000000c9';
  IF row.id IS NULL OR row.status <> 'unpriced' OR row.amount <> 0 THEN
    RAISE EXCEPTION 'FALHA: cobrança sem preço deveria ficar em aberto como "valor a definir" (veio %)', row.status;
  END IF;
  PERFORM public.update_charge(row.id, 250, 0, NULL, row.description);
  SELECT * INTO row FROM public.charge_list('2025-02-01', '2025-02-28') WHERE id = row.id;
  IF row.status = 'unpriced' OR row.balance <> 250 OR row.description LIKE '%valor a definir%' THEN
    RAISE EXCEPTION 'FALHA: ajuste do valor deveria tirar a cobrança de "valor a definir"';
  END IF;
  PERFORM public.cancel_charge(row.id, 'Teste');
END $$;
RESET ROLE;

-- Preço padrão da clínica e repasse de 60% da profissional A (Proprietária).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  INSERT INTO public.session_prices (professional_id, session_type, amount) VALUES (NULL, NULL, 300);
  PERFORM public.set_payout_percent('00000000-0000-4000-8000-00000000000a', 60);
END $$;
RESET ROLE;

-- Gerente registra duas sessões passadas como realizadas: cada uma gera uma cobrança de R$ 300.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at) VALUES
    ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2025-03-10 12:00+00', '2025-03-10 12:50+00'),
    ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2025-03-17 12:00+00', '2025-03-17 12:50+00');
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c5', 'completed');
  -- Correções de situação não duplicam a cobrança.
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c5', 'missed');
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c5', 'completed');
  IF (SELECT count(*) FROM public.charge_list('2025-03-01', '2025-03-31') WHERE appointment_id = '00000000-0000-4000-8000-0000000000c5') <> 1
    OR (SELECT amount FROM public.charge_list('2025-03-01', '2025-03-31') WHERE appointment_id = '00000000-0000-4000-8000-0000000000c5') <> 300 THEN
    RAISE EXCEPTION 'FALHA: sessão realizada deveria ter exatamente uma cobrança de R$ 300';
  END IF;
  BEGIN
    PERFORM 1 FROM public.charges;
    RAISE EXCEPTION 'FALHA: tabela de cobranças lida diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.finance_summary(2025);
    RAISE EXCEPTION 'FALHA: Gerente viu o resultado financeiro';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.expenses) <> 0 THEN RAISE EXCEPTION 'FALHA: Gerente viu despesas'; END IF;
END $$;
RESET ROLE;

-- Recepção: pagamento parcial (150), depois 200 (quita e sobra 50 de crédito), crédito abatido na
-- sessão seguinte, estorno e cancelamento.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$
DECLARE
  first_charge uuid;
  second_charge uuid;
  second_payment uuid;
  row record;
BEGIN
  SELECT id INTO first_charge FROM public.charge_list('2025-03-01', '2025-03-31') WHERE appointment_id = '00000000-0000-4000-8000-0000000000c5';
  PERFORM public.register_payment('00000000-0000-4000-8000-0000000000f1', 150, 'pix', '2025-03-10', ARRAY[first_charge], NULL);
  SELECT * INTO row FROM public.charge_list('2025-03-01', '2025-03-31') WHERE id = first_charge;
  IF row.paid <> 150 OR row.balance <> 150 THEN RAISE EXCEPTION 'FALHA: pagamento parcial (esperado 150 pago e 150 em aberto)'; END IF;

  second_payment := public.register_payment('00000000-0000-4000-8000-0000000000f1', 200, 'cash', '2025-03-20', ARRAY[first_charge], NULL);
  SELECT * INTO row FROM public.charge_list('2025-03-01', '2025-03-31') WHERE id = first_charge;
  IF row.status <> 'paid' OR public.patient_credit('00000000-0000-4000-8000-0000000000f1') <> 50 THEN
    RAISE EXCEPTION 'FALHA: segundo pagamento deveria quitar a cobrança e deixar 50 de crédito';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
  PERFORM public.set_appointment_status('00000000-0000-4000-8000-0000000000c6', 'completed');
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
  SELECT * INTO row FROM public.charge_list('2025-03-01', '2025-03-31') WHERE appointment_id = '00000000-0000-4000-8000-0000000000c6';
  second_charge := row.id;
  IF row.paid <> 50 OR row.balance <> 250 OR public.patient_credit('00000000-0000-4000-8000-0000000000f1') <> 0 THEN
    RAISE EXCEPTION 'FALHA: crédito de 50 deveria abater a cobrança seguinte';
  END IF;

  PERFORM public.reverse_payment(second_payment, 'Lançado em duplicidade');
  IF (SELECT balance FROM public.charge_list('2025-03-01', '2025-03-31') WHERE id = first_charge) <> 150
    OR (SELECT paid FROM public.charge_list('2025-03-01', '2025-03-31') WHERE id = second_charge) <> 0 THEN
    RAISE EXCEPTION 'FALHA: estorno deveria reabrir o saldo das cobranças';
  END IF;
  PERFORM public.cancel_charge(second_charge, 'Sessão cortesia');
  IF (SELECT status FROM public.charge_list('2025-03-01', '2025-03-31') WHERE id = second_charge) <> 'cancelled' THEN
    RAISE EXCEPTION 'FALHA: cobrança não foi cancelada';
  END IF;
  BEGIN
    PERFORM public.payout_statement('2025-03-01');
    IF (SELECT count(*) FROM public.payout_statement('2025-03-01')) <> 0 THEN
      RAISE EXCEPTION 'FALHA: Recepção viu repasses';
    END IF;
  END;
END $$;
RESET ROLE;

-- Nenhuma distribuição além do recebido (proteção no banco, mesmo fora das funções).
DO $$ BEGIN
  BEGIN
    INSERT INTO public.payment_allocations (payment_id, charge_id, amount)
    SELECT p.id, c.id, 1000 FROM public.payments p, public.charges c
    WHERE p.patient_id = '00000000-0000-4000-8000-0000000000f1' AND p.reversed_at IS NULL
      AND c.appointment_id = '00000000-0000-4000-8000-0000000000c5'
    ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount = 1000;
    RAISE EXCEPTION 'FALHA: distribuição maior que o pagamento foi aceita';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;

-- Financeiro: resultado do mês, despesa e fechamento do repasse (60% de 150 recebidos = 90).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT billed FROM public.finance_summary(2025) WHERE month = '2025-03-01') <> 300
    OR (SELECT received FROM public.finance_summary(2025) WHERE month = '2025-03-01') <> 150 THEN
    RAISE EXCEPTION 'FALHA: março/2025 deveria ter 300 faturados e 150 recebidos';
  END IF;
  INSERT INTO public.expenses (description, category_id, cost_center_id, amount, competence_date, due_date, paid_at)
  SELECT 'Aluguel de teste', fc.id, cc.id, 2000, '2025-03-01', '2025-03-05', '2025-03-05'
  FROM public.finance_categories fc, public.cost_centers cc WHERE fc.name = 'Aluguel' AND cc.name = 'Administrativo';
  IF (SELECT payout FROM public.payout_statement('2025-03-01') WHERE professional_id = '00000000-0000-4000-8000-00000000000a') <> 90 THEN
    RAISE EXCEPTION 'FALHA: repasse deveria ser 60%% de 150 = 90';
  END IF;
  PERFORM public.close_payout('00000000-0000-4000-8000-00000000000a', '2025-03-01', '2025-04-05');
  BEGIN
    PERFORM public.close_payout('00000000-0000-4000-8000-00000000000a', '2025-03-01', '2025-04-05');
    RAISE EXCEPTION 'FALHA: repasse do mesmo mês fechado duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  IF (SELECT cash_result FROM public.finance_summary(2025) WHERE month = '2025-03-01') <> -1850 THEN
    RAISE EXCEPTION 'FALHA: resultado de caixa de março deveria ser 150 - 2000 = -1850';
  END IF;
END $$;
RESET ROLE;

-- Profissionais: A vê as próprias cobranças e o próprio repasse; B, nada da A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.charge_list('2025-03-01', '2025-03-31')) <> 2 THEN
    RAISE EXCEPTION 'FALHA: profissional A deveria ver as cobranças dos próprios atendimentos';
  END IF;
  IF (SELECT count(*) FROM public.payout_statement('2025-03-01')) <> 1
    OR (SELECT payout FROM public.payout_statement('2025-03-01')) <> 90 THEN
    RAISE EXCEPTION 'FALHA: profissional A deveria ver só o próprio repasse';
  END IF;
  BEGIN
    PERFORM public.payment_list('2025-03-01', '2025-03-31');
    RAISE EXCEPTION 'FALHA: profissional viu a lista de pagamentos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.charge_list('2025-03-01', '2025-03-31')) <> 0 THEN
    RAISE EXCEPTION 'FALHA: profissional B viu cobranças da A';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_statement('2025-03-01') WHERE professional_id = '00000000-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FALHA: profissional B viu o repasse da A';
  END IF;
  BEGIN
    PERFORM public.register_payment('00000000-0000-4000-8000-0000000000f1', 10, 'pix', '2025-03-10', NULL, NULL);
    RAISE EXCEPTION 'FALHA: profissional registrou pagamento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Paciente (portal futuro) e conta sem perfis: nenhum acesso à área da equipe.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.professionals) <> 0 THEN RAISE EXCEPTION 'FALHA: perfil Paciente viu profissionais'; END IF;
  IF (SELECT count(*) FROM public.patients) <> 0 THEN RAISE EXCEPTION 'FALHA: perfil Paciente viu pacientes'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.professionals) <> 0 THEN RAISE EXCEPTION 'FALHA: conta sem perfis viu profissionais'; END IF;
END $$;
RESET ROLE;

-- Alteração de perfis (set_user_access), como Proprietária.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000e2', ARRAY['reception'], NULL, true);
  IF (SELECT array_agg(role::text) FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000000e2') <> ARRAY['reception'] THEN
    RAISE EXCEPTION 'FALHA: perfis não foram trocados';
  END IF;
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000d1', ARRAY['manager'], NULL, true);
    RAISE EXCEPTION 'FALHA: Proprietária removeu o próprio perfil de Proprietária';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000d1', ARRAY['owner'], NULL, false);
    RAISE EXCEPTION 'FALHA: Proprietária desativou a própria conta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000f2', ARRAY['professional'], NULL, true);
    RAISE EXCEPTION 'FALHA: perfil Profissional aceito sem profissional vinculada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000f2', ARRAY['professional'], '00000000-0000-4000-8000-00000000000a', true);
    RAISE EXCEPTION 'FALHA: duas contas para a mesma profissional';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  -- Desativar a profissional B corta o acesso dela na hora.
  PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000b1', ARRAY['professional'], '00000000-0000-4000-8000-00000000000b', false);
  -- A outra Proprietária pode perder o perfil, pois esta continua.
  PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000d3', ARRAY['professional'], '00000000-0000-4000-8000-00000000000c', true);
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.audit_log WHERE action = 'update_access') < 3 THEN
    RAISE EXCEPTION 'FALHA: alterações de perfis não foram registradas na auditoria';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF private.is_staff() THEN RAISE EXCEPTION 'FALHA: conta desativada continuou com acesso'; END IF;
  IF (SELECT count(*) FROM public.professionals) <> 0 THEN RAISE EXCEPTION 'FALHA: conta desativada continuou vendo profissionais'; END IF;
END $$;
RESET ROLE;

-- Última Proprietária: mesmo que outro perfil ganhe "gerenciar usuários", não pode removê-la.
INSERT INTO public.role_permissions (role, permission) VALUES ('manager', 'users.manage');
UPDATE public.profiles SET active = true WHERE id = '00000000-0000-4000-8000-0000000000d2';
DELETE FROM public.user_roles WHERE role = 'owner' AND user_id NOT IN (
  '00000000-0000-4000-8000-0000000000d1'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_user_access('00000000-0000-4000-8000-0000000000d1', ARRAY['manager'], NULL, true);
    RAISE EXCEPTION 'FALHA: a última Proprietária perdeu o perfil';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT 'Todas as verificações de permissão passaram.' AS resultado;
ROLLBACK;
