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

-- Tarefas (Bloco 7) ---------------------------------------------------------------------------
-- Datas da recorrência (função pura).
DO $$ BEGIN
  IF private.next_occurrence('monthly', '2026-01-31', '2026-02-10') <> '2026-02-28'
    OR private.next_occurrence('monthly', '2026-01-05', '2026-01-05') <> '2026-02-05'
    OR private.next_occurrence('monthly_last', '2026-01-31', '2026-02-28') <> '2026-03-31'
    OR private.next_occurrence('weekly', '2026-10-05', '2026-10-14') <> '2026-10-19'
    OR private.next_occurrence('weekdays', '2026-10-01', '2026-10-16') <> '2026-10-19'
    OR private.next_occurrence('daily', '2026-10-01', '2026-10-16') <> '2026-10-17'
    OR private.next_occurrence('yearly', '2024-02-29', '2025-03-01') <> '2026-02-28' THEN
    RAISE EXCEPTION 'FALHA: cálculo da próxima data da recorrência';
  END IF;
END $$;

-- Gerente atribui uma tarefa (vencida, ligada ao paciente P) ao Financeiro e uma mensal à Recepção.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$
DECLARE
  task uuid;
  rule uuid;
BEGIN
  IF (SELECT count(*) FROM public.task_assignees() WHERE id IN ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a1')) <> 2 THEN
    RAISE EXCEPTION 'FALHA: Gerente deveria poder atribuir tarefas à equipe';
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_assignees() WHERE id = '00000000-0000-4000-8000-0000000000c1') THEN
    RAISE EXCEPTION 'FALHA: paciente apareceu como responsável possível';
  END IF;
  task := public.save_task(NULL, 'Teste tarefa: ligar para o paciente', 'Remarcar horário', '00000000-0000-4000-8000-0000000000f3',
    'high', private.local_today() - 1, NULL, '00000000-0000-4000-8000-0000000000f1');
  PERFORM set_config('teste.tarefa', task::text, true);
  rule := public.save_recurrence(NULL, 'Teste tarefa mensal', NULL, '00000000-0000-4000-8000-0000000000f2', 'normal', NULL,
    'monthly', '2026-01-05', '09:00');
  PERFORM set_config('teste.regra', rule::text, true);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'FALHA: Gerente não conseguiu criar tarefas (%)', SQLERRM;
END $$;
DO $$
DECLARE
  row record;
BEGIN
  SELECT * INTO row FROM public.task_list('team', true) WHERE recurrence_id = current_setting('teste.regra')::uuid;
  IF row.id IS NULL OR row.due_date < private.local_today() OR extract(day FROM row.due_date) <> 5 OR row.due_time <> '09:00' THEN
    RAISE EXCEPTION 'FALHA: primeira ocorrência da mensal deveria cair no próximo dia 5 a partir de hoje';
  END IF;
  SELECT * INTO row FROM public.task_list('team', true) WHERE id = current_setting('teste.tarefa')::uuid;
  IF NOT row.overdue OR row.patient_name <> 'Teste Paciente P' OR NOT row.can_edit THEN
    RAISE EXCEPTION 'FALHA: Gerente deveria ver a tarefa atrasada, com o paciente, e poder editá-la';
  END IF;
END $$;
RESET ROLE;

-- Financeiro: vê a tarefa recebida (sem o nome do paciente, que não vê), não atribui a outras pessoas,
-- não edita nem cancela a tarefa da Gerente, mas comenta e conclui.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$
DECLARE
  task uuid := current_setting('teste.tarefa')::uuid;
  row record;
BEGIN
  SELECT * INTO row FROM public.task_list('mine', true) WHERE id = task;
  IF row.id IS NULL OR row.patient_name IS NOT NULL OR row.patient_id IS NOT NULL OR row.can_edit OR NOT row.overdue THEN
    RAISE EXCEPTION 'FALHA: Financeiro deveria ver a própria tarefa, atrasada, sem o paciente e sem editar';
  END IF;
  IF (SELECT count(*) FROM public.task_assignees()) <> 1 THEN RAISE EXCEPTION 'FALHA: Financeiro pode atribuir tarefas a outras pessoas'; END IF;
  IF (SELECT overdue FROM public.task_counts()) < 1 OR (SELECT unread FROM public.task_counts()) < 1
    OR (SELECT team_overdue FROM public.task_counts()) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: contagens do Financeiro (atrasadas, avisos não lidos, sem a equipe)';
  END IF;
  BEGIN
    PERFORM public.task_list('team', true);
    RAISE EXCEPTION 'FALHA: Financeiro viu as tarefas da equipe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_task(NULL, 'Teste tarefa indevida', NULL, '00000000-0000-4000-8000-0000000000a1', 'normal', NULL, NULL, NULL);
    RAISE EXCEPTION 'FALHA: Financeiro atribuiu tarefa a outra pessoa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_task(task, 'Teste tarefa alterada', NULL, '00000000-0000-4000-8000-0000000000f3', 'low', NULL, NULL, NULL);
    RAISE EXCEPTION 'FALHA: Financeiro editou tarefa criada pela Gerente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.set_task_status(task, 'cancelled');
    RAISE EXCEPTION 'FALHA: Financeiro cancelou tarefa criada pela Gerente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.tasks;
    RAISE EXCEPTION 'FALHA: tabela de tarefas lida diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'FALHA: Financeiro viu avisos de outras pessoas';
  END IF;
  PERFORM public.save_task(NULL, 'Teste tarefa própria', NULL, '00000000-0000-4000-8000-0000000000f3', 'low', NULL, NULL, NULL);
  PERFORM public.comment_task(task, 'Liguei, sem resposta.');
  PERFORM public.set_task_status(task, 'done');
  PERFORM public.mark_notifications_read(NULL);
  IF (SELECT unread FROM public.task_counts()) <> 0 THEN RAISE EXCEPTION 'FALHA: avisos não foram marcados como lidos'; END IF;
END $$;
RESET ROLE;

-- Profissional B e Paciente não veem a tarefa.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.task_list('mine', false) WHERE title LIKE 'Teste tarefa%')
    OR EXISTS (SELECT 1 FROM public.task_list('created', false) WHERE title LIKE 'Teste tarefa%') THEN
    RAISE EXCEPTION 'FALHA: Profissional B viu tarefas de outras pessoas';
  END IF;
  BEGIN
    PERFORM public.comment_task(current_setting('teste.tarefa')::uuid, 'Intrometido');
    RAISE EXCEPTION 'FALHA: Profissional B comentou em tarefa de outra pessoa';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.task_list('mine', true);
    RAISE EXCEPTION 'FALHA: Paciente acessou tarefas';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Gerente recebe o aviso de conclusão, vê quem concluiu e o histórico (criação, comentário, conclusão).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$
DECLARE
  task uuid := current_setting('teste.tarefa')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'task_done' AND link LIKE '%' || task) THEN
    RAISE EXCEPTION 'FALHA: Gerente não recebeu o aviso de conclusão';
  END IF;
  IF (SELECT completed_by_name FROM public.task_list('team', false, task)) <> 'Teste Financeiro'
    OR (SELECT string_agg(kind, ',' ORDER BY id) FROM public.task_history(task)) <> 'created,comment,status' THEN
    RAISE EXCEPTION 'FALHA: conclusão ou histórico da tarefa';
  END IF;
END $$;
RESET ROLE;

-- Recepção conclui a mensal: a próxima nasce no dia 5 do mês seguinte, só uma em aberto, e a
-- anterior não pode ser reaberta. Com a regra pausada, concluir não gera outra.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$
DECLARE
  rule uuid := current_setting('teste.regra')::uuid;
  first record;
  second uuid;
BEGIN
  SELECT * INTO first FROM public.task_list('mine', true) WHERE recurrence_id = rule;
  second := public.set_task_status(first.id, 'done');
  IF second IS NULL OR (SELECT due_date FROM public.task_list('mine', true, second)) <> (first.due_date + interval '1 month')::date
    OR (SELECT count(*) FROM public.task_list('mine', true) WHERE recurrence_id = rule) <> 1 THEN
    RAISE EXCEPTION 'FALHA: conclusão da mensal deveria gerar a próxima no mês seguinte';
  END IF;
  BEGIN
    PERFORM public.set_task_status(first.id, 'todo');
    RAISE EXCEPTION 'FALHA: ocorrência anterior reaberta com a próxima já criada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_recurrence_active(rule, false);
    RAISE EXCEPTION 'FALHA: Recepção pausou regra criada pela Gerente';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM set_config('teste.segunda', second::text, true);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN PERFORM public.set_recurrence_active(current_setting('teste.regra')::uuid, false); END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$ BEGIN
  IF public.set_task_status(current_setting('teste.segunda')::uuid, 'done') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: regra pausada gerou nova ocorrência';
  END IF;
END $$;
RESET ROLE;

-- Comercial (Bloco 8) --------------------------------------------------------------------------
-- Recepção cadastra o lead, registra contato, agenda retorno e converte em paciente da profissional A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$
DECLARE
  lead uuid;
  lost uuid := (SELECT id FROM public.lead_stages WHERE kind = 'lost');
  won uuid := (SELECT id FROM public.lead_stages WHERE kind = 'won');
  patient uuid;
  task uuid;
BEGIN
  lead := public.save_lead(NULL, jsonb_build_object('name', 'Teste Lead Casal', 'phone', '+55 (21) 98888-0001', 'email', 'Teste-Lead@Example.test',
    'source_id', (SELECT id FROM public.lead_sources WHERE name = 'Instagram'), 'interest', 'Terapia de casal', 'location', 'Botafogo'));
  PERFORM set_config('teste.lead', lead::text, true);
  IF (SELECT stage_id FROM public.leads WHERE id = lead) <> (SELECT id FROM public.lead_stages WHERE kind = 'open' AND active ORDER BY position LIMIT 1)
    OR (SELECT owner_id FROM public.leads WHERE id = lead) <> auth.uid()
    OR (SELECT email FROM public.leads WHERE id = lead) <> 'teste-lead@example.test' THEN
    RAISE EXCEPTION 'FALHA: lead novo deveria entrar na primeira etapa, com quem cadastrou como responsável';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_owners() WHERE id = '00000000-0000-4000-8000-0000000000e2')
    OR EXISTS (SELECT 1 FROM public.crm_owners() WHERE id IN ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a1')) THEN
    RAISE EXCEPTION 'FALHA: responsáveis possíveis do Comercial';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_duplicates('21 98888-0001', NULL) WHERE id = lead) THEN
    RAISE EXCEPTION 'FALHA: duplicidade por telefone (com e sem 55) não encontrada';
  END IF;
  BEGIN
    PERFORM public.move_lead(lead, lost, NULL, NULL);
    RAISE EXCEPTION 'FALHA: lead perdido sem motivo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.move_lead(lead, won, NULL, NULL);
    RAISE EXCEPTION 'FALHA: lead marcado como convertido sem virar paciente';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.add_lead_activity(lead, 'call', 'Primeiro contato');
  IF (SELECT first_contact_at FROM public.leads WHERE id = lead) IS NULL THEN RAISE EXCEPTION 'FALHA: primeiro contato não registrado'; END IF;
  task := public.schedule_lead_followup(lead, private.local_today() + 1, NULL, auth.uid());
  IF (SELECT lead_name FROM public.task_list('mine', true, task)) <> 'Teste Lead Casal' THEN
    RAISE EXCEPTION 'FALHA: tarefa de retorno deveria estar ligada ao lead';
  END IF;
  patient := public.convert_lead(lead, NULL, ARRAY['00000000-0000-4000-8000-00000000000a']::uuid[]);
  IF (SELECT stage_id FROM public.leads WHERE id = lead) <> won
    OR (SELECT source_id FROM public.patients WHERE id = patient) <> (SELECT id FROM public.lead_sources WHERE name = 'Instagram')
    OR NOT EXISTS (SELECT 1 FROM public.patient_professionals WHERE patient_id = patient AND professional_id = '00000000-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FALHA: conversão deveria criar o paciente com a origem e a profissional';
  END IF;
  BEGIN
    PERFORM public.move_lead(lead, (SELECT id FROM public.lead_stages WHERE kind = 'open' AND active ORDER BY position LIMIT 1), NULL, NULL);
    RAISE EXCEPTION 'FALHA: lead convertido voltou para o funil';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  -- Um segundo lead, perdido, para a anonimização.
  lead := public.save_lead(NULL, jsonb_build_object('name', 'Teste Lead Perdido', 'email', 'teste-perdido@example.test'));
  PERFORM public.move_lead(lead, lost, (SELECT id FROM public.lead_loss_reasons WHERE name = 'Preço'), 'Achou caro');
  PERFORM set_config('teste.lead_perdido', lead::text, true);
END $$;
RESET ROLE;

-- Financeiro e profissional não acessam o Comercial; tipo de etapa não muda; nova etapa só aberta.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leads) <> 0 OR (SELECT count(*) FROM public.lead_activities) <> 0 THEN
    RAISE EXCEPTION 'FALHA: Financeiro viu leads';
  END IF;
  BEGIN
    PERFORM public.save_lead(NULL, '{"name":"Teste Indevido","phone":"21999990000"}');
    RAISE EXCEPTION 'FALHA: Financeiro cadastrou lead';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.crm_summary('2000-01-01', '2100-01-01');
    RAISE EXCEPTION 'FALHA: Financeiro viu indicadores comerciais';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leads) <> 0 OR (SELECT count(*) FROM public.campaigns) <> 0 THEN
    RAISE EXCEPTION 'FALHA: profissional viu leads ou campanhas';
  END IF;
  BEGIN
    PERFORM public.capture_lead('{"name":"Teste","phone":"21999990000","consent":true}', 'x');
    RAISE EXCEPTION 'FALHA: usuário comum chamou a captação do site';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$
DECLARE
  summary jsonb;
BEGIN
  BEGIN
    UPDATE public.lead_stages SET kind = 'won' WHERE name = 'Novo contato';
    RAISE EXCEPTION 'FALHA: etapa mudou de tipo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.lead_stages (name, position, kind) VALUES ('Teste etapa perdida 2', 98, 'lost');
    RAISE EXCEPTION 'FALHA: criada segunda etapa de perda';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.campaigns (name, source_id, utm_campaign, budget) VALUES ('Teste campanha', (SELECT id FROM public.lead_sources WHERE name = 'Instagram'), 'teste-campanha', 300);
  PERFORM public.save_lead(current_setting('teste.lead')::uuid, jsonb_build_object('name', 'Teste Lead Casal', 'phone', '21988880001',
    'campaign_id', (SELECT id FROM public.campaigns WHERE name = 'Teste campanha'), 'owner_id', '00000000-0000-4000-8000-0000000000f2'));
  IF (SELECT cost_per_patient FROM public.campaign_stats() WHERE name = 'Teste campanha') <> 300 THEN
    RAISE EXCEPTION 'FALHA: custo por paciente da campanha';
  END IF;
  IF (SELECT sum(leads) FROM public.crm_monthly(extract(year FROM private.local_today())::int)) < 2 THEN
    RAISE EXCEPTION 'FALHA: leads do mês';
  END IF;
  summary := public.crm_summary(private.local_today(), private.local_today());
  IF (summary->>'leads')::int < 2 OR (summary->>'converted')::int < 1 OR (summary->>'lost')::int < 1 OR summary->'revenue' = 'null'::jsonb
    OR NOT summary->'loss_reasons' @> '[{"name":"Preço"}]' THEN
    RAISE EXCEPTION 'FALHA: indicadores comerciais da Gerente (%)', summary;
  END IF;
END $$;
RESET ROLE;

-- Formulário do site (chave de serviço): consentimento obrigatório, origem pela UTM, contato repetido
-- não duplica, e no máximo 5 envios aceitos por IP por hora.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  first uuid;
  again uuid;
BEGIN
  BEGIN
    PERFORM public.capture_lead('{"name":"Teste Site","phone":"21977770001","consent":false}', 'ip-teste');
    RAISE EXCEPTION 'FALHA: lead do site sem consentimento';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  first := public.capture_lead('{"name":"Teste Site","phone":"21977770001","consent":true,"utm_source":"ig","message":"Quero terapia de casal"}', 'ip-teste');
  again := public.capture_lead('{"name":"Teste Site","phone":"(21) 97777-0001","consent":true}', 'ip-teste');
  IF first <> again OR (SELECT source_id FROM public.leads WHERE id = first) <> (SELECT id FROM public.lead_sources WHERE name = 'Instagram')
    OR (SELECT consent_at FROM public.leads WHERE id = first) IS NULL THEN
    RAISE EXCEPTION 'FALHA: captação do site (origem pela UTM, consentimento, sem duplicar)';
  END IF;
  PERFORM public.capture_lead('{"name":"Teste Site 2","email":"teste-site2@example.test","consent":true}', 'ip-teste');
  PERFORM public.capture_lead('{"name":"Teste Site 3","email":"teste-site3@example.test","consent":true}', 'ip-teste');
  PERFORM public.capture_lead('{"name":"Teste Site 4","email":"teste-site4@example.test","consent":true}', 'ip-teste');
  BEGIN
    PERFORM public.capture_lead('{"name":"Teste Site 5","email":"teste-site5@example.test","consent":true}', 'ip-teste');
    RAISE EXCEPTION 'FALHA: limite de envios por IP não aplicado';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- LGPD: lead perdido sem atividade há mais de 12 meses é anonimizado; o convertido não.
UPDATE public.leads SET last_activity_at = now() - interval '13 months' WHERE name IN ('Teste Lead Perdido', 'Teste Lead Casal');
DO $$ BEGIN
  PERFORM private.anonymize_stale_leads();
  IF (SELECT name FROM public.leads WHERE id = current_setting('teste.lead_perdido')::uuid) <> 'Lead anonimizado'
    OR (SELECT email FROM public.leads WHERE id = current_setting('teste.lead_perdido')::uuid) IS NOT NULL
    OR (SELECT name FROM public.leads WHERE id = current_setting('teste.lead')::uuid) <> 'Teste Lead Casal' THEN
    RAISE EXCEPTION 'FALHA: anonimização de leads perdidos';
  END IF;
END $$;

-- Relatórios (Bloco 9) -------------------------------------------------------------------------
-- Cenário conhecido em maio/junho de 2024 (gravado direto, sem os gatilhos de cobrança), com a
-- profissional R e o paciente Q.
INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000002f5', 'Teste Paciente S');
INSERT INTO public.patient_professionals VALUES ('00000000-0000-4000-8000-0000000002f5', '00000000-0000-4000-8000-00000000000c');
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at, status) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-06 13:00+00', '2024-05-06 13:50+00', 'completed'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-13 13:00+00', '2024-05-13 13:50+00', 'completed'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-20 13:00+00', '2024-05-20 13:50+00', 'missed'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-27 13:00+00', '2024-05-27 13:50+00', 'cancelled_by_patient'),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-28 13:00+00', '2024-05-28 13:50+00', 'cancelled_by_patient'),
  ('00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-05-29 13:00+00', '2024-05-29 13:50+00', 'cancelled_by_clinic'),
  ('00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '2024-08-05 13:00+00', '2024-08-05 13:50+00', 'completed'),
  -- Paciente S começa com R em junho e fica só 5 semanas (retido em 4, não em 12).
  ('00000000-0000-4000-8000-000000000208', '00000000-0000-4000-8000-0000000002f5', '00000000-0000-4000-8000-00000000000c', '2024-06-03 13:00+00', '2024-06-03 13:50+00', 'completed'),
  ('00000000-0000-4000-8000-000000000209', '00000000-0000-4000-8000-0000000002f5', '00000000-0000-4000-8000-00000000000c', '2024-07-08 13:00+00', '2024-07-08 13:50+00', 'completed');
DELETE FROM public.appointment_events WHERE appointment_id::text LIKE '00000000-0000-4000-8000-0000000002%';
-- Um cancelamento 2 horas antes (tardio) e outro 3 dias antes.
INSERT INTO public.appointment_events (appointment_id, action, from_status, to_status, created_at) VALUES
  ('00000000-0000-4000-8000-000000000204', 'status_changed', 'scheduled', 'cancelled_by_patient', '2024-05-27 11:00+00'),
  ('00000000-0000-4000-8000-000000000205', 'status_changed', 'scheduled', 'cancelled_by_patient', '2024-05-25 13:00+00');
INSERT INTO public.charges (id, patient_id, professional_id, appointment_id, description, competence_date, due_date, amount, discount, cancelled_at) VALUES
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000201', 'Teste sessão', '2024-05-06', '2024-05-06', 300, 50, NULL),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', NULL, 'Teste relatório', '2024-05-15', '2024-05-15', 100, 0, NULL),
  ('00000000-0000-4000-8000-000000000213', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c', NULL, 'Teste cancelada', '2024-05-20', '2024-05-20', 999, 0, now());
UPDATE public.charges SET cancellation_reason = 'Teste' WHERE id = '00000000-0000-4000-8000-000000000213';
INSERT INTO public.payments (id, patient_id, amount, method, received_at, reversed_at, reversal_reason) VALUES
  ('00000000-0000-4000-8000-000000000221', '00000000-0000-4000-8000-0000000000f4', 200, 'pix', '2024-05-10', NULL, NULL),
  ('00000000-0000-4000-8000-000000000222', '00000000-0000-4000-8000-0000000000f4', 50, 'cash', '2024-06-02', NULL, NULL),
  ('00000000-0000-4000-8000-000000000223', '00000000-0000-4000-8000-0000000000f4', 80, 'credit', '2024-05-12', now(), 'Teste');
INSERT INTO public.payment_allocations (payment_id, charge_id, amount) VALUES
  ('00000000-0000-4000-8000-000000000221', '00000000-0000-4000-8000-000000000211', 200),
  ('00000000-0000-4000-8000-000000000222', '00000000-0000-4000-8000-000000000211', 50);
INSERT INTO public.expenses (description, category_id, cost_center_id, amount, competence_date, due_date, paid_at) VALUES
  ('Teste aluguel', (SELECT id FROM public.finance_categories WHERE name = 'Aluguel'), (SELECT id FROM public.cost_centers WHERE name = 'Administrativo'), 1000, '2024-05-01', '2024-05-05', '2024-05-05'),
  ('Teste anúncio', (SELECT id FROM public.finance_categories WHERE name = 'Marketing'), (SELECT id FROM public.cost_centers WHERE name = 'Comercial e marketing'), 300, '2024-05-20', '2024-06-10', '2024-06-10');
INSERT INTO public.payouts (professional_id, month, received_base, percent, amount, paid_at) VALUES
  ('00000000-0000-4000-8000-00000000000c', '2024-05-01', 200, 60, 120, '2024-06-05');

-- Proprietário(a): totais conferidos.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$
DECLARE
  r record;
  patients jsonb;
BEGIN
  SELECT * INTO r FROM public.report_sessions('2024-05-01', '2024-05-31', '00000000-0000-4000-8000-00000000000c');
  IF r.total <> 6 OR r.completed <> 2 OR r.missed <> 1 OR r.cancelled_by_patient <> 2 OR r.late_cancel <> 1
    OR r.cancelled_by_clinic <> 1 OR r.completed_minutes <> 100 THEN
    RAISE EXCEPTION 'FALHA: relatório de sessões (%)', r;
  END IF;
  patients := public.report_patients('2024-05-01', '2024-05-31', '00000000-0000-4000-8000-00000000000c');
  IF NOT patients->'retention' @> '[{"started":1,"eligible_4":1,"kept_4":1,"eligible_12":1,"kept_12":1}]' THEN
    RAISE EXCEPTION 'FALHA: retenção (%)', patients->'retention';
  END IF;
  patients := public.report_patients('2024-06-01', '2024-06-30', '00000000-0000-4000-8000-00000000000c');
  IF NOT patients->'retention' @> '[{"started":1,"eligible_4":1,"kept_4":1,"eligible_12":1,"kept_12":0}]' THEN
    RAISE EXCEPTION 'FALHA: retenção de 12 semanas (%)', patients->'retention';
  END IF;
  SELECT * INTO r FROM public.report_dre('2024-05-01', '2024-06-30') WHERE month = '2024-05-01';
  IF r.billed <> 400 OR r.discounts <> 50 OR r.received <> 200 OR r.expenses_competence <> 1300 OR r.expenses_paid <> 1000
    OR r.payouts_competence <> 120 OR r.payouts_paid <> 0 OR (r.categories->>'Aluguel')::numeric <> 1000 THEN
    RAISE EXCEPTION 'FALHA: DRE de maio (%)', r;
  END IF;
  SELECT * INTO r FROM public.report_dre('2024-05-01', '2024-06-30') WHERE month = '2024-06-01';
  IF r.received <> 50 OR r.expenses_paid <> 300 OR r.payouts_paid <> 120 THEN RAISE EXCEPTION 'FALHA: DRE de junho (%)', r; END IF;
  IF (SELECT billed FROM public.report_revenue('2024-05-01', '2024-05-31') WHERE professional_id = '00000000-0000-4000-8000-00000000000c' AND session_type = 'individual') <> 250
    OR (SELECT received FROM public.report_revenue('2024-05-01', '2024-05-31') WHERE professional_id = '00000000-0000-4000-8000-00000000000c' AND session_type = 'individual') <> 200
    OR (SELECT billed FROM public.report_revenue('2024-05-01', '2024-05-31') WHERE professional_id = '00000000-0000-4000-8000-00000000000c' AND session_type IS NULL) <> 100 THEN
    RAISE EXCEPTION 'FALHA: faturamento por profissional e tipo';
  END IF;
  IF (SELECT amount FROM public.report_payment_methods('2024-05-01', '2024-05-31') WHERE method = 'pix') <> 200
    OR (SELECT reversed FROM public.report_payment_methods('2024-05-01', '2024-05-31') WHERE method = 'credit') <> 80 THEN
    RAISE EXCEPTION 'FALHA: recebimentos por forma de pagamento';
  END IF;
  SELECT * INTO r FROM public.report_aging() WHERE patient_id = '00000000-0000-4000-8000-0000000000f4';
  IF r.over_60 <> 100 OR r.total <> 100 THEN RAISE EXCEPTION 'FALHA: inadimplência por faixa (%)', r; END IF;
  IF (SELECT paid FROM public.report_expenses('2024-05-01', '2024-05-31') WHERE dimension = 'category' AND name = 'Marketing') <> 0
    OR (SELECT competence FROM public.report_expenses('2024-05-01', '2024-05-31') WHERE dimension = 'cost_center' AND name = 'Comercial e marketing') <> 300 THEN
    RAISE EXCEPTION 'FALHA: despesas por categoria e centro de custo';
  END IF;
  IF (SELECT payout FROM public.report_payouts('2024-05-01', '2024-05-31') WHERE professional_id = '00000000-0000-4000-8000-00000000000c') <> 120 THEN
    RAISE EXCEPTION 'FALHA: repasses do período';
  END IF;
  SELECT * INTO r FROM public.report_year(2024) WHERE month = '2024-05-01';
  IF r.billed <> 350 OR r.received <> 200 OR r.cash_result <> -800 OR r.completed <> 2 OR r.missed <> 1 OR r.cancelled <> 3 THEN
    RAISE EXCEPTION 'FALHA: comparativo anual, maio (%)', r;
  END IF;
  IF (SELECT cash_result FROM public.report_year(2024) WHERE month = '2024-06-01') <> -370 THEN RAISE EXCEPTION 'FALHA: comparativo anual, junho'; END IF;
  BEGIN
    PERFORM public.report_sessions('2024-05-31', '2024-05-01');
    RAISE EXCEPTION 'FALHA: período invertido aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;

-- Gerente: operacional e inadimplência, sem DRE; no comparativo, sem os números de dinheiro.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT completed FROM public.report_sessions('2024-05-01', '2024-05-31', '00000000-0000-4000-8000-00000000000c')) <> 2 THEN
    RAISE EXCEPTION 'FALHA: Gerente deveria ver as sessões';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.report_aging() WHERE patient_id = '00000000-0000-4000-8000-0000000000f4') THEN
    RAISE EXCEPTION 'FALHA: Gerente deveria ver a inadimplência';
  END IF;
  BEGIN
    PERFORM public.report_dre('2024-05-01', '2024-05-31');
    RAISE EXCEPTION 'FALHA: Gerente viu a DRE';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT billed FROM public.report_year(2024) WHERE month = '2024-05-01') IS NOT NULL
    OR (SELECT completed FROM public.report_year(2024) WHERE month = '2024-05-01') <> 2 THEN
    RAISE EXCEPTION 'FALHA: comparativo da Gerente (sem dinheiro, com sessões)';
  END IF;
  PERFORM public.report_campaigns('2024-05-01', '2024-05-31');
END $$;

-- Financeiro: financeiro sim, sessões não. Profissional A: só os próprios números.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT billed FROM public.report_dre('2024-05-01', '2024-05-31')) <> 400 THEN RAISE EXCEPTION 'FALHA: Financeiro deveria ver a DRE'; END IF;
  BEGIN
    PERFORM public.report_sessions('2024-05-01', '2024-05-31');
    RAISE EXCEPTION 'FALHA: Financeiro viu o relatório de sessões';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT completed FROM public.report_year(2024) WHERE month = '2024-05-01') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: Financeiro viu sessões no comparativo';
  END IF;
  BEGIN
    PERFORM public.report_campaigns('2024-05-01', '2024-05-31');
    RAISE EXCEPTION 'FALHA: Financeiro viu o relatório comercial';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.report_sessions('2024-05-01', '2024-05-31', '00000000-0000-4000-8000-00000000000c')) THEN
    RAISE EXCEPTION 'FALHA: profissional A viu as sessões da profissional R';
  END IF;
  IF (SELECT completed FROM public.report_year(2024) WHERE month = '2024-05-01') <> 0
    OR (SELECT billed FROM public.report_year(2024) WHERE month = '2024-05-01') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: comparativo da profissional (só os próprios números, sem dinheiro)';
  END IF;
  BEGIN
    PERFORM public.report_aging();
    RAISE EXCEPTION 'FALHA: profissional viu a inadimplência';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Google Agenda (Bloco 10.1) ---------------------------------------------------------------------
-- Conta Google da profissional A com um calendário próprio (escrita) e um compartilhado (só leitura).
INSERT INTO public.google_accounts (id, user_id, google_subject, google_email, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)
VALUES ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-0000000000a1', 'teste-sub', 'teste-a@gmail.test', '\x00', '\x00', '\x00');
INSERT INTO public.google_calendars (id, google_account_id, professional_id, google_calendar_id, display_name, access_role, selected) VALUES
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-00000000000a', 'primary', 'Teste A', 'owner', true),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-00000000000a', 'feriados', 'Feriados', 'reader', true);
INSERT INTO public.google_busy (professional_id, google_calendar_id, starts_at, ends_at)
VALUES ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000302', '2030-01-08 12:00+00', '2030-01-08 13:00+00');
-- Sessão da A na semana que vem (a fila reenvia as dos próximos 180 dias ao escolher o destino).
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at)
VALUES ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
  date_trunc('hour', now()) + interval '7 days', date_trunc('hour', now()) + interval '7 days 50 minutes');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.list_google_calendars() WHERE can_edit) <> 2 THEN RAISE EXCEPTION 'FALHA: profissional deveria ver os próprios calendários'; END IF;
  BEGIN
    PERFORM public.set_google_calendar('00000000-0000-4000-8000-000000000303', true, true);
    RAISE EXCEPTION 'FALHA: calendário só de leitura virou destino das sessões';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.set_google_calendar('00000000-0000-4000-8000-000000000302', true, true);
  IF (SELECT pending FROM public.google_sync_status()) < 1 THEN RAISE EXCEPTION 'FALHA: sessões futuras deveriam entrar na fila ao escolher o destino'; END IF;
  IF (SELECT count(*) FROM public.google_busy) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional deveria ver o próprio horário ocupado no Google'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.calendar_sync_queue WHERE appointment_id = '00000000-0000-4000-8000-000000000305' AND action = 'upsert' AND done_at IS NULL) THEN
    RAISE EXCEPTION 'FALHA: sessão futura da A não foi para a fila do Google';
  END IF;
  -- Mudanças na sessão não duplicam o pedido pendente; exclusão de sessão já enviada pede a remoção do evento.
  UPDATE public.appointments SET status = 'confirmed' WHERE id = '00000000-0000-4000-8000-0000000000c2';
  UPDATE public.appointments SET modality = 'online' WHERE id = '00000000-0000-4000-8000-0000000000c2';
  IF (SELECT count(*) FROM public.calendar_sync_queue WHERE appointment_id = '00000000-0000-4000-8000-0000000000c2' AND done_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FALHA: fila do Google duplicou o pedido';
  END IF;
  INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at)
  VALUES ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2030-02-04 12:00+00', '2030-02-04 12:50+00');
  INSERT INTO public.calendar_event_links (appointment_id, google_calendar_id, google_event_id)
  VALUES ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000302', 'evento-teste');
  DELETE FROM public.appointments WHERE id = '00000000-0000-4000-8000-000000000304';
  IF NOT EXISTS (SELECT 1 FROM public.calendar_sync_queue WHERE action = 'delete' AND google_event_id = 'evento-teste') THEN
    RAISE EXCEPTION 'FALHA: sessão apagada deveria pedir a remoção do evento no Google';
  END IF;
  PERFORM private.run_google_sync(); -- integração inativa: não faz nada
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.list_google_calendars() WHERE professional_id = '00000000-0000-4000-8000-00000000000a' AND NOT can_edit) <> 2
    OR (SELECT count(*) FROM public.google_busy WHERE professional_id = '00000000-0000-4000-8000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'FALHA: Gerente deveria ver os calendários e o ocupado da A, sem editar';
  END IF;
  BEGIN
    PERFORM public.set_google_calendar('00000000-0000-4000-8000-000000000302', false, false);
    RAISE EXCEPTION 'FALHA: Gerente mudou o calendário Google de outra pessoa';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM 1 FROM public.calendar_sync_queue;
    RAISE EXCEPTION 'FALHA: fila do Google lida diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.list_google_calendars()) OR (SELECT count(*) FROM public.google_busy) <> 0 THEN
    RAISE EXCEPTION 'FALHA: profissional B viu o Google da A';
  END IF;
  BEGIN
    PERFORM public.set_google_calendar_as_owner('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000302');
    RAISE EXCEPTION 'FALHA: usuário comum usou a função reservada ao retorno do Google';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.google_busy) <> 0 THEN RAISE EXCEPTION 'FALHA: Financeiro viu horários do Google'; END IF;
  BEGIN
    PERFORM public.google_sync_status();
    RAISE EXCEPTION 'FALHA: Financeiro viu a sincronização do Google';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- WhatsApp (Bloco 10.2) -------------------------------------------------------------------------
-- Paciente P autorizou o WhatsApp; Q não. Sessões: P amanhã (pede confirmação), P on-line em 1h30
-- (lembrete com link) e Q amanhã (nada, sem autorização).
UPDATE public.patients SET phone = '(21) 98888-7777', whatsapp_opt_in = true, whatsapp_opt_in_at = now() WHERE id = '00000000-0000-4000-8000-0000000000f1';
UPDATE public.patients SET phone = '(21) 97777-6666' WHERE id = '00000000-0000-4000-8000-0000000000f4';
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at, status, modality, meeting_url) VALUES
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   date_trunc('hour', now()) + interval '1 day 3 hours', date_trunc('hour', now()) + interval '1 day 3 hours 50 minutes', 'scheduled', 'presencial', NULL),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   now() + interval '90 minutes', now() + interval '140 minutes', 'confirmed', 'online', 'https://meet.google.com/teste-abc'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c',
   date_trunc('hour', now()) + interval '1 day 5 hours', date_trunc('hour', now()) + interval '1 day 5 hours 50 minutes', 'scheduled', 'presencial', NULL);
DO $$ BEGIN
  IF private.whatsapp_enqueue_due() <> 0 THEN RAISE EXCEPTION 'FALHA: WhatsApp enviou com a integração desativada'; END IF;
  UPDATE public.integration_state SET enabled = true, config = '{"app_url":"https://sistema.example.test"}' WHERE key = 'whatsapp';
  PERFORM private.whatsapp_enqueue_due();
  PERFORM private.whatsapp_enqueue_due();
  IF (SELECT count(*) FROM public.whatsapp_messages WHERE appointment_id::text LIKE '00000000-0000-4000-8000-0000000004%') <> 2 THEN
    RAISE EXCEPTION 'FALHA: agendamento do WhatsApp (2 envios, sem repetir)';
  END IF;
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-000000000401') <> 'awaiting_confirmation'
    OR NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE appointment_id = '00000000-0000-4000-8000-000000000402' AND kind = 'reminder'
      AND body LIKE '%on-line, link: https://meet.google.com/teste-abc%' AND phone = '5521988887777')
    OR EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE appointment_id = '00000000-0000-4000-8000-000000000403') THEN
    RAISE EXCEPTION 'FALHA: confirmação, lembrete com link e respeito à autorização do paciente';
  END IF;
  UPDATE public.whatsapp_messages SET wamid = 'wamid.CONF1', status = 'sent' WHERE appointment_id = '00000000-0000-4000-8000-000000000401' AND kind = 'confirmation';
  UPDATE public.crm_settings SET default_owner_id = '00000000-0000-4000-8000-0000000000f2';
END $$;

-- Profissional A liga o aviso de tarefas no WhatsApp; a Gerente atribui uma tarefa a ela.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.set_my_whatsapp('21 96666-5555', true);
  BEGIN
    PERFORM public.whatsapp_inbound('5521900000000', 'X', 'wamid.X', 'oi', NULL, NULL);
    RAISE EXCEPTION 'FALHA: usuário comum registrou mensagem recebida';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.set_patient_whatsapp('00000000-0000-4000-8000-0000000000f1', false);
    RAISE EXCEPTION 'FALHA: profissional mudou a autorização de WhatsApp do paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.save_task(NULL, 'Teste tarefa WhatsApp', NULL, '00000000-0000-4000-8000-0000000000a1', 'normal', NULL, NULL, NULL);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE kind = 'task' AND phone = '5521966665555'
      AND body LIKE '%https://sistema.example.test#/tarefas?tarefa=%' AND body NOT LIKE '%Teste tarefa WhatsApp%') THEN
    RAISE EXCEPTION 'FALHA: aviso de tarefa no WhatsApp (com link, sem o conteúdo)';
  END IF;
END $$;

-- Respostas (chave de serviço, como a Edge Function whatsapp-webhook).
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF public.whatsapp_inbound('5521988887777', 'P', 'wamid.IN1', NULL, 'CONFIRMAR', 'wamid.CONF1') <> 'confirmed'
    OR public.whatsapp_inbound('5521988887777', 'P', 'wamid.IN1', NULL, 'CONFIRMAR', 'wamid.CONF1') <> 'duplicate' THEN
    RAISE EXCEPTION 'FALHA: botão Confirmar (e mensagem repetida ignorada)';
  END IF;
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-000000000401') <> 'confirmed'
    OR NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE kind = 'reply' AND appointment_id = '00000000-0000-4000-8000-000000000401' AND status = 'queued') THEN
    RAISE EXCEPTION 'FALHA: sessão deveria ficar confirmada, com resposta automática na fila';
  END IF;
  IF (SELECT created_at FROM public.whatsapp_messages WHERE kind = 'reply' AND appointment_id = '00000000-0000-4000-8000-000000000401')
    <= (SELECT created_at FROM public.whatsapp_messages WHERE wamid = 'wamid.IN1') THEN
    RAISE EXCEPTION 'FALHA: resposta automática deveria vir depois da mensagem recebida';
  END IF;
  -- Número desconhecido: vira lead uma vez; a segunda mensagem entra no mesmo lead.
  IF public.whatsapp_inbound('5521955554444', 'Teste Contato WhatsApp', 'wamid.IN2', 'Quero saber valores', NULL, NULL) <> 'lead'
    OR public.whatsapp_inbound('5521955554444', 'Teste Contato WhatsApp', 'wamid.IN3', 'Atende sábado?', NULL, NULL) <> 'stored' THEN
    RAISE EXCEPTION 'FALHA: contato desconhecido deveria virar lead uma vez';
  END IF;
  PERFORM public.whatsapp_status('wamid.CONF1', 'read');
  PERFORM public.whatsapp_status('wamid.CONF1', 'delivered');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leads WHERE phone_key = '21955554444') <> 1
    OR (SELECT source_id FROM public.leads WHERE phone_key = '21955554444') <> (SELECT id FROM public.lead_sources WHERE name = 'WhatsApp direto')
    OR (SELECT count(*) FROM public.lead_activities a JOIN public.leads l ON l.id = a.lead_id WHERE l.phone_key = '21955554444' AND a.kind = 'message') <> 2 THEN
    RAISE EXCEPTION 'FALHA: lead do WhatsApp (origem e mensagens)';
  END IF;
  IF (SELECT status FROM public.whatsapp_messages WHERE wamid = 'wamid.CONF1') <> 'read' THEN RAISE EXCEPTION 'FALHA: situação "lida" voltou para "entregue"'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-0000000000e2' AND kind = 'message_new') THEN
    RAISE EXCEPTION 'FALHA: equipe de atendimento deveria ser avisada da mensagem';
  END IF;
END $$;

-- "Confirmar" atrasado, depois que a clínica cancelou: a sessão continua cancelada.
DO $$ BEGIN
  UPDATE public.appointments SET status = 'cancelled_by_clinic' WHERE id = '00000000-0000-4000-8000-000000000403';
  INSERT INTO public.whatsapp_messages (direction, phone, kind, template, body, patient_id, appointment_id, status, wamid)
  VALUES ('out', '5521977776666', 'confirmation', 'confirmacao_sessao', 'x', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-000000000403', 'sent', 'wamid.CONF3');
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF public.whatsapp_inbound('5521977776666', 'Q', 'wamid.IN5', NULL, 'CONFIRMAR', 'wamid.CONF3') = 'confirmed' THEN
    RAISE EXCEPTION 'FALHA: confirmação aceita para sessão cancelada';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-000000000403') <> 'cancelled_by_clinic' THEN
    RAISE EXCEPTION 'FALHA: sessão cancelada voltou a ficar confirmada';
  END IF;
END $$;

-- Pedido de remarcação: tarefa para o responsável padrão.
DO $$ BEGIN
  UPDATE public.appointments SET status = 'scheduled' WHERE id = '00000000-0000-4000-8000-000000000402';
  INSERT INTO public.whatsapp_messages (direction, phone, kind, template, body, patient_id, appointment_id, status, wamid)
  VALUES ('out', '5521988887777', 'confirmation', 'confirmacao_sessao', 'x', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000402', 'sent', 'wamid.CONF2');
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF public.whatsapp_inbound('5521988887777', 'P', 'wamid.IN4', NULL, 'REMARCAR', 'wamid.CONF2') <> 'reschedule' THEN
    RAISE EXCEPTION 'FALHA: botão Preciso remarcar';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE assignee_id = '00000000-0000-4000-8000-0000000000f2' AND title LIKE 'Remarcar sessão de Teste%') THEN
    RAISE EXCEPTION 'FALHA: pedido de remarcação deveria virar tarefa do responsável padrão';
  END IF;
END $$;

-- Recepção: conversas e resposta dentro da janela de 24 h; Financeiro não vê.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.whatsapp_conversations() WHERE phone IN ('5521988887777', '5521955554444')) <> 2
    OR (SELECT kind FROM public.whatsapp_conversations() WHERE phone = '5521955554444') <> 'lead' THEN
    RAISE EXCEPTION 'FALHA: conversas da recepção';
  END IF;
  PERFORM public.queue_whatsapp_reply('5521955554444', 'Atendemos sim!');
  BEGIN
    PERFORM public.queue_whatsapp_reply('5521911112222', 'Olá');
    RAISE EXCEPTION 'FALHA: mensagem livre fora da janela de 24 h';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_whatsapp_settings(true, 'https://x.test');
    RAISE EXCEPTION 'FALHA: Recepção ativou os envios do WhatsApp';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.whatsapp_messages) <> 0 THEN RAISE EXCEPTION 'FALHA: Financeiro viu mensagens do WhatsApp'; END IF;
  BEGIN
    PERFORM public.whatsapp_conversations();
    RAISE EXCEPTION 'FALHA: Financeiro abriu as conversas';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
UPDATE public.integration_state SET enabled = false, config = '{}' WHERE key = 'whatsapp';
UPDATE public.crm_settings SET default_owner_id = NULL;

-- Inteligência artificial (Bloco 11) -------------------------------------------------------------
-- Desligada por padrão; ligar exige limite mensal; só a Proprietária configura.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_ai_settings(true, NULL, 7);
    RAISE EXCEPTION 'FALHA: IA ligada sem limite mensal';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.set_ai_settings(true, 1, 7);
  BEGIN
    PERFORM public.ai_status('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: Proprietária (sem ser a profissional) viu a IA do prontuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_ai_settings(false, 1, 7);
    RAISE EXCEPTION 'FALHA: Gerente mexeu na configuração da IA';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Profissional A: sem termo e sem consentimento, nada; depois, transcrição e rascunho.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE
  prepared jsonb;
BEGIN
  IF coalesce(public.ai_status('00000000-0000-4000-8000-0000000000f1')->>'blocker', '') NOT LIKE '%termo%' THEN RAISE EXCEPTION 'FALHA: IA sem termo aceito'; END IF;
  BEGIN
    PERFORM public.create_ai_transcript('00000000-0000-4000-8000-0000000000f1', NULL, 'paste', NULL, repeat('Paciente relatou a semana. ', 5), NULL);
    RAISE EXCEPTION 'FALHA: transcrição aceita sem termo e consentimento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.accept_ai_terms();
  IF coalesce(public.ai_status('00000000-0000-4000-8000-0000000000f1')->>'blocker', '') NOT LIKE '%consentimento%' THEN RAISE EXCEPTION 'FALHA: IA sem consentimento do paciente'; END IF;
  PERFORM public.set_ai_consent('00000000-0000-4000-8000-0000000000f1', true, 'Termo assinado em papel');
  IF public.ai_status('00000000-0000-4000-8000-0000000000f1')->>'blocker' IS NOT NULL THEN RAISE EXCEPTION 'FALHA: IA deveria estar liberada'; END IF;
  PERFORM set_config('teste.transcricao', public.create_ai_transcript('00000000-0000-4000-8000-0000000000f1', NULL, 'paste', NULL,
    repeat('Paciente relatou a semana. ', 5), ARRAY['Marido Teste'])::text, true);
  prepared := public.ai_prepare_run(current_setting('teste.transcricao')::uuid);
  IF NOT prepared->'names' @> '["Teste Paciente P", "Marido Teste"]' THEN RAISE EXCEPTION 'FALHA: dados a ocultar (%)', prepared->'names'; END IF;
  PERFORM set_config('teste.execucao', prepared->>'run_id', true);
  BEGIN
    PERFORM public.ai_prepare_run(current_setting('teste.transcricao')::uuid);
    RAISE EXCEPTION 'FALHA: mesma transcrição processada duas vezes ao mesmo tempo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.ai_finish_run((prepared->>'run_id')::uuid, 'done', 'x', 'x', '{}'::jsonb, '[]'::jsonb, NULL, 1, 1, 0::numeric);
    RAISE EXCEPTION 'FALHA: profissional gravou o resultado da IA diretamente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.ai_get_run(current_setting('teste.execucao')::uuid);
    RAISE EXCEPTION 'FALHA: profissional B abriu rascunho de IA da A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.ai_finish_run(current_setting('teste.execucao')::uuid, 'done', 'claude-opus-5-5', 'Paciente relatou a semana.',
    '{"summary":"Resumo"}', '[]', NULL, 1000, 500, 0.014);
END $$;
RESET ROLE;

-- Usar o rascunho cria RASCUNHO de evolução com a origem; nada é publicado sozinho.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE
  note uuid;
BEGIN
  note := public.ai_use_draft(current_setting('teste.execucao')::uuid, 'Temas trabalhados: semana do paciente.');
  PERFORM set_config('teste.nota_ia', note::text, true);
  BEGIN
    PERFORM public.ai_use_draft(current_setting('teste.execucao')::uuid, 'De novo');
    RAISE EXCEPTION 'FALHA: rascunho de IA usado duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.finalize_clinical_note(note);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT ai_run_id FROM public.clinical_notes WHERE id = current_setting('teste.nota_ia')::uuid) <> current_setting('teste.execucao')::uuid THEN
    RAISE EXCEPTION 'FALHA: evolução sem a origem do rascunho de IA';
  END IF;
  IF (SELECT delete_after FROM public.ai_transcripts WHERE id = current_setting('teste.transcricao')::uuid) > now() + interval '7 days 1 minute' THEN
    RAISE EXCEPTION 'FALHA: transcrição deveria sair 7 dias depois da evolução finalizada';
  END IF;
  -- Limpeza: conteúdo vencido sai; ficam uso e custo.
  UPDATE public.ai_transcripts SET delete_after = now() - interval '1 minute' WHERE id = current_setting('teste.transcricao')::uuid;
  PERFORM private.purge_ai_content();
  IF (SELECT content FROM public.ai_transcripts WHERE id = current_setting('teste.transcricao')::uuid) IS NOT NULL
    OR (SELECT result FROM public.ai_runs WHERE id = current_setting('teste.execucao')::uuid) IS NOT NULL
    OR (SELECT cost_usd FROM public.ai_runs WHERE id = current_setting('teste.execucao')::uuid) <> 0.014 THEN
    RAISE EXCEPTION 'FALHA: limpeza das transcrições';
  END IF;
  -- Limite mensal: com o custo do mês acima do limite, a IA bloqueia.
  UPDATE public.ai_runs SET cost_usd = 5 WHERE id = current_setting('teste.execucao')::uuid;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF coalesce(public.ai_status('00000000-0000-4000-8000-0000000000f1')->>'blocker', '') NOT LIKE '%limite%' THEN RAISE EXCEPTION 'FALHA: limite mensal de custo da IA'; END IF;
  -- Revogação apaga o que estiver guardado.
  PERFORM public.set_ai_consent('00000000-0000-4000-8000-0000000000f1', false);
  IF (public.ai_status('00000000-0000-4000-8000-0000000000f1')->>'consent_at') IS NOT NULL THEN RAISE EXCEPTION 'FALHA: consentimento revogado'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.ai_usage(current_date);
    RAISE EXCEPTION 'FALHA: Financeiro viu o uso da IA';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT month_cost FROM public.ai_usage(current_date) LIMIT 1) < 5 THEN RAISE EXCEPTION 'FALHA: custo do mês da IA'; END IF;
END $$;
RESET ROLE;
UPDATE public.ai_settings SET enabled = false, monthly_limit_usd = NULL;

-- Push do aplicativo (Bloco 12) ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.register_push_device('ExponentPushToken[teste-a-1]', 'ios');
  BEGIN
    PERFORM public.register_push_device('token-invalido', 'ios');
    RAISE EXCEPTION 'FALHA: token de push inválido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.set_push_enabled(true);
    RAISE EXCEPTION 'FALHA: profissional ligou o push da clínica';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.register_push_device('ExponentPushToken[teste-paciente]', 'android');
    RAISE EXCEPTION 'FALHA: paciente registrou aparelho no aplicativo da equipe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.push_devices) THEN RAISE EXCEPTION 'FALHA: profissional B viu aparelho de outra pessoa'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN PERFORM public.set_push_enabled(true); END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.save_task(NULL, 'Teste tarefa com nome de paciente Fulana', NULL, '00000000-0000-4000-8000-0000000000a1', 'normal', NULL, NULL, NULL);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.push_outbox WHERE token = 'ExponentPushToken[teste-a-1]' AND body = 'Você recebeu uma tarefa.' AND link LIKE '#/tarefas?tarefa=%')
    OR EXISTS (SELECT 1 FROM public.push_outbox WHERE token = 'ExponentPushToken[teste-a-1]' AND (body LIKE '%Fulana%' OR title LIKE '%Fulana%')) THEN
    RAISE EXCEPTION 'FALHA: push genérico (sem o conteúdo da tarefa) para o aparelho da profissional';
  END IF;
  UPDATE public.integration_state SET enabled = false WHERE key = 'push';
END $$;

-- Portal do paciente (Bloco 13) ---------------------------------------------------------------------
-- Conta C1 (paciente) acessa P (ela mesma). Conta C2 é responsável por Z (menor, da A) e por Q (da R).
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000c4', 'teste-responsavel@example.test', '{"roles":["patient"]}', '{"name":"Teste Responsável"}');
INSERT INTO public.patients (id, name, birth_date, guardian_name) VALUES
  ('00000000-0000-4000-8000-0000000000f5', 'Teste Paciente Z', '2016-03-10', 'Teste Responsável');
INSERT INTO public.patient_professionals VALUES ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000000a');
UPDATE public.clinic_settings SET portal_enabled = true, portal_payment_instructions = 'PIX: chave de teste' WHERE id;
INSERT INTO public.portal_access (patient_id, user_id, relationship) VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c1', 'self'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000c4', 'guardian'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000c4', 'guardian');
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at, modality) VALUES
  ('00000000-0000-4000-8000-0000000013a1', '00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000000a',
   '2030-01-08 12:00+00', '2030-01-08 12:50+00', 'online'),
  ('00000000-0000-4000-8000-0000000013a2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c',
   '2030-01-09 12:00+00', '2030-01-09 12:50+00', 'presencial'),
  ('00000000-0000-4000-8000-0000000013a3', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   '2030-01-10 15:00+00', '2030-01-10 15:50+00', 'presencial');
UPDATE public.appointments SET meeting_url = 'https://meet.google.com/teste-portal' WHERE id = '00000000-0000-4000-8000-0000000013a1';
INSERT INTO public.charges (id, patient_id, professional_id, description, competence_date, due_date, amount) VALUES
  ('00000000-0000-4000-8000-0000000013b1', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   'Teste portal sessão', '2030-01-07', '2030-01-10', 300),
  ('00000000-0000-4000-8000-0000000013b2', '00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000000c',
   'Teste portal sessão Q', '2030-01-09', '2030-01-10', 250);
INSERT INTO public.payments (id, patient_id, amount, method, received_at, notes) VALUES
  ('00000000-0000-4000-8000-0000000013c1', '00000000-0000-4000-8000-0000000000f1', 150, 'pix', '2030-01-07', 'Observação interna do financeiro');
INSERT INTO public.payment_allocations (payment_id, charge_id, amount) VALUES
  ('00000000-0000-4000-8000-0000000013c1', '00000000-0000-4000-8000-0000000013b1', 150);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('portal-documents', 'patients/00000000-0000-4000-8000-0000000000f1/declaracao.pdf'),
  ('portal-documents', 'patients/00000000-0000-4000-8000-0000000000f4/material.pdf'),
  ('portal-documents', 'patients/00000000-0000-4000-8000-0000000000f1/da-profissional-b.pdf');

-- Equipe: a profissional A compartilha com P; a B (não atende P) não consegue.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.share_portal_document('00000000-0000-4000-8000-0000000000f1', 'Teste declaração',
    'patients/00000000-0000-4000-8000-0000000000f1/declaracao.pdf', 1000, 'application/pdf');
  BEGIN
    PERFORM public.share_portal_document('00000000-0000-4000-8000-0000000000f1', 'Sem arquivo',
      'patients/00000000-0000-4000-8000-0000000000f1/nao-existe.pdf', 1000, 'application/pdf');
    RAISE EXCEPTION 'FALHA: documento compartilhado sem arquivo no bucket';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f1', 'novo@example.test', 'self');
    RAISE EXCEPTION 'FALHA: profissional convidou para o portal sem gerenciar pacientes';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.share_portal_document('00000000-0000-4000-8000-0000000000f1', 'Da B',
      'patients/00000000-0000-4000-8000-0000000000f1/da-profissional-b.pdf', 1000, 'application/pdf');
    RAISE EXCEPTION 'FALHA: profissional B compartilhou documento de paciente que não atende';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.portal_documents_for_patient('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: profissional B viu documentos do portal de paciente que não atende';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
-- Recepção compartilha com Q (gerencia pacientes).
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.share_portal_document('00000000-0000-4000-8000-0000000000f4', 'Teste material Q',
    'patients/00000000-0000-4000-8000-0000000000f4/material.pdf', 1000, 'application/pdf');
END $$;

-- Paciente C1, antes de aceitar os termos.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$
DECLARE
  me jsonb := public.portal_me();
BEGIN
  IF NOT (me->>'portal_user')::boolean OR (me->>'terms_accepted')::boolean OR jsonb_array_length(me->'patients') <> 1
    OR me->'patients'->0->>'id' <> '00000000-0000-4000-8000-0000000000f1' THEN
    RAISE EXCEPTION 'FALHA: portal_me da paciente C1: %', me;
  END IF;
  BEGIN
    PERFORM * FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: portal usado sem aceitar os termos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.portal_accept_terms('versao-antiga');
    RAISE EXCEPTION 'FALHA: aceite de termos com versão errada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.portal_accept_terms(me->>'terms_version');
END $$;

-- Paciente C1 depois do aceite: varredura do que a conta alcança fora do portal.
DO $$
DECLARE
  t record;
  f record;
  total bigint;
  result text;
  args text;
  leaked text[] := '{}';
BEGIN
  -- Tabelas: nada, exceto as linhas da própria conta.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p') AND has_table_privilege('authenticated', c.oid, 'SELECT')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO total;
    IF total > 0 AND t.relname NOT IN ('profiles', 'user_roles', 'notifications') THEN leaked := leaked || (t.relname || '=' || total); END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.profiles) <> 1 OR (SELECT count(*) FROM public.user_roles) <> 1
    OR EXISTS (SELECT 1 FROM public.notifications WHERE user_id <> auth.uid()) THEN
    leaked := leaked || 'perfis/avisos de outras contas'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects) THEN leaked := leaked || 'storage.objects'::text; END IF;
  IF leaked <> '{}' THEN RAISE EXCEPTION 'FALHA: paciente leu tabelas da equipe: %', leaked; END IF;

  -- Funções da equipe, chamadas com argumentos vazios: precisam recusar ou não devolver nada.
  FOR f IN SELECT p.oid, p.proname, p.proretset, p.prorettype,
      (SELECT string_agg('NULL::' || format_type(a, NULL), ', ' ORDER BY i) FROM unnest(p.proargtypes) WITH ORDINALITY x(a, i)) AS nulls
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      -- Revisadas: só mexem nos dados da própria conta (ou somam zero sem permissão, conferido abaixo).
      AND p.proname NOT IN ('portal_me', 'my_access', 'mark_notifications_read', 'my_whatsapp', 'unregister_push_device', 'receivables_now')
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    args := coalesce(f.nulls, '');
    BEGIN
      IF f.proretset THEN
        EXECUTE format('SELECT count(*) FROM public.%I(%s)', f.proname, args) INTO total;
        IF total > 0 THEN leaked := leaked || (f.proname || ' devolveu ' || total); END IF;
      ELSIF f.prorettype = 'void'::regtype THEN
        EXECUTE format('SELECT public.%I(%s)', f.proname, args);
        leaked := leaked || (f.proname || ' executou');
      ELSE
        EXECUTE format('SELECT public.%I(%s)::text', f.proname, args) INTO result;
        IF result IS NOT NULL AND result NOT IN ('0', 'false', '[]', '{}', '') THEN leaked := leaked || (f.proname || '=' || left(result, 80)); END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.receivables_now() r WHERE r.open_amount <> 0 OR r.overdue_count <> 0) THEN
    leaked := leaked || 'receivables_now com valores'::text;
  END IF;
  IF leaked <> '{}' THEN RAISE EXCEPTION 'FALHA: paciente alcançou funções da equipe: %', leaked; END IF;
END $$;

-- Paciente C1 no portal: só P; confirma, pede remarcação, vê saldo e baixa documento.
DO $$
DECLARE
  row record;
  path text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f1') a WHERE a.id = '00000000-0000-4000-8000-0000000013a3')
    OR EXISTS (SELECT 1 FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f1') a WHERE a.id = '00000000-0000-4000-8000-0000000000c3') THEN
    RAISE EXCEPTION 'FALHA: sessões de P no portal (a futura aparece; a de 2020 passou de 1 ano)';
  END IF;
  BEGIN
    PERFORM * FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f4');
    RAISE EXCEPTION 'FALHA: paciente C1 viu sessões de Q';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.portal_confirm('00000000-0000-4000-8000-0000000013a2');
    RAISE EXCEPTION 'FALHA: paciente C1 confirmou sessão de Q';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.portal_confirm('00000000-0000-4000-8000-0000000013a3');
  BEGIN
    PERFORM public.portal_confirm('00000000-0000-4000-8000-0000000013a3');
    RAISE EXCEPTION 'FALHA: sessão confirmada duas vezes';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.portal_request_change('00000000-0000-4000-8000-0000000013a3', 'reschedule', 'Posso só à tarde.');
  BEGIN
    PERFORM public.portal_request_change('00000000-0000-4000-8000-0000000013a3', 'cancel', NULL);
    RAISE EXCEPTION 'FALHA: dois pedidos para a mesma sessão';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  SELECT * INTO row FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f1') a WHERE a.id = '00000000-0000-4000-8000-0000000013a3';
  IF row.status <> 'confirmed' OR row.can_request OR NOT row.requested OR row.meeting_url IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: sessão de P depois de confirmar e pedir remarcação: %', row;
  END IF;

  SELECT * INTO row FROM public.portal_charges('00000000-0000-4000-8000-0000000000f1') c WHERE c.id = '00000000-0000-4000-8000-0000000013b1';
  IF row.status <> 'partial' OR row.balance <> 150 OR row.paid <> 150 THEN RAISE EXCEPTION 'FALHA: cobrança de P no portal: %', row; END IF;
  IF EXISTS (SELECT 1 FROM public.portal_charges('00000000-0000-4000-8000-0000000000f1') c WHERE c.id = '00000000-0000-4000-8000-0000000013b2') THEN
    RAISE EXCEPTION 'FALHA: paciente C1 viu cobranças de outro paciente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_payments('00000000-0000-4000-8000-0000000000f1') x WHERE x.id = '00000000-0000-4000-8000-0000000013c1' AND x.amount = 150) THEN
    RAISE EXCEPTION 'FALHA: pagamentos de P no portal';
  END IF;
  PERFORM public.portal_notify_paid('00000000-0000-4000-8000-0000000013b1', 'Paguei o restante por PIX.');
  BEGIN
    PERFORM public.portal_notify_paid('00000000-0000-4000-8000-0000000013b1', NULL);
    RAISE EXCEPTION 'FALHA: aviso de pagamento repetido no mesmo dia';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.portal_notify_paid('00000000-0000-4000-8000-0000000013b2', NULL);
    RAISE EXCEPTION 'FALHA: paciente C1 avisou pagamento de cobrança de Q';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT count(*) FROM public.portal_document_list('00000000-0000-4000-8000-0000000000f1')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: documentos de P no portal';
  END IF;
  SELECT public.portal_document_open(d.id) INTO path FROM public.portal_document_list('00000000-0000-4000-8000-0000000000f1') d;
  IF path <> 'patients/00000000-0000-4000-8000-0000000000f1/declaracao.pdf'
    OR NOT (SELECT downloaded FROM public.portal_document_list('00000000-0000-4000-8000-0000000000f1')) THEN
    RAISE EXCEPTION 'FALHA: download do documento de P (caminho %)', path;
  END IF;

  -- Funções da equipe com o paciente certo também recusam.
  BEGIN
    PERFORM * FROM public.portal_access_list('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: paciente viu a lista de acessos ao portal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.portal_requests_for_patient('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: paciente viu os pedidos pela visão da equipe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f1', 'outra@example.test', 'self');
    RAISE EXCEPTION 'FALHA: paciente convidou outra pessoa para o portal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.portal_grant_access('00000000-0000-4000-8000-0000000000f4', auth.uid(), 'self', auth.uid());
    RAISE EXCEPTION 'FALHA: paciente deu acesso a si mesmo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Os documentos de Q não abrem para C1.
DO $$ BEGIN
  BEGIN
    PERFORM public.portal_document_open((SELECT id FROM public.portal_documents WHERE title = 'Teste material Q'));
    RAISE EXCEPTION 'FALHA: paciente C1 abriu documento de Q';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tasks t JOIN public.portal_requests q ON q.task_id = t.id
      WHERE q.kind = 'reschedule' AND t.title = 'Remarcar sessão de Teste (portal)' AND t.description LIKE '%Posso só à tarde.%')
    OR NOT EXISTS (SELECT 1 FROM public.tasks t JOIN public.portal_requests q ON q.task_id = t.id WHERE q.kind = 'paid')
    OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'task_assigned' AND title LIKE 'Nova tarefa: Remarcar sessão de Teste%'
      AND user_id = '00000000-0000-4000-8000-0000000000f2')
    OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'task_assigned' AND title LIKE 'Nova tarefa: Conferir pagamento%'
      AND user_id = '00000000-0000-4000-8000-0000000000f3') THEN
    RAISE EXCEPTION 'FALHA: pedidos do portal viram tarefa e aviso para a recepção e o financeiro';
  END IF;
  IF (SELECT status FROM public.appointments WHERE id = '00000000-0000-4000-8000-0000000013a3') <> 'confirmed'
    OR NOT EXISTS (SELECT 1 FROM public.appointment_events WHERE appointment_id = '00000000-0000-4000-8000-0000000013a3'
      AND to_status = 'confirmed' AND actor_user_id = '00000000-0000-4000-8000-0000000000c1') THEN
    RAISE EXCEPTION 'FALHA: confirmação pelo portal registrada no histórico da sessão';
  END IF;
END $$;

-- Responsável C2: vê Z e Q, nada de P.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.portal_accept_terms((public.portal_me())->>'terms_version');
  IF jsonb_array_length((public.portal_me())->'patients') <> 2
    OR (SELECT count(*) FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f5')) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f4') a WHERE a.id = '00000000-0000-4000-8000-0000000013a2')
    OR (SELECT count(*) FROM public.portal_document_list('00000000-0000-4000-8000-0000000000f4')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: responsável vê os dois pacientes que acompanha';
  END IF;
  BEGIN
    PERFORM * FROM public.portal_charges('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: responsável viu cobranças de P';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Convites (recepção): regras de idade e de conta da equipe; conta de paciente existente ganha só o vínculo.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
DO $$
DECLARE
  prepared jsonb;
BEGIN
  BEGIN
    PERFORM public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f5', 'menor@example.test', 'self');
    RAISE EXCEPTION 'FALHA: acesso próprio para paciente menor de idade';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f1', 'teste-a@example.test', 'self');
    RAISE EXCEPTION 'FALHA: convite do portal para e-mail de conta da equipe';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f1', 'Teste-Paciente@example.test', 'self');
    RAISE EXCEPTION 'FALHA: convite repetido para quem já tem acesso';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  prepared := public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f5', 'teste-paciente@example.test', 'guardian');
  IF prepared->>'user_id' <> '00000000-0000-4000-8000-0000000000c1' OR prepared->>'name' <> 'Teste Responsável' THEN
    RAISE EXCEPTION 'FALHA: convite para conta de paciente existente: %', prepared;
  END IF;
  prepared := public.portal_prepare_invite('00000000-0000-4000-8000-0000000000f1', 'Nova.Pessoa@Example.test', 'self');
  IF prepared->>'user_id' IS NOT NULL OR prepared->>'email' <> 'nova.pessoa@example.test' THEN
    RAISE EXCEPTION 'FALHA: convite para e-mail novo: %', prepared;
  END IF;
  IF (SELECT count(*) FROM public.portal_access_list('00000000-0000-4000-8000-0000000000f1')) <> 1 THEN
    RAISE EXCEPTION 'FALHA: recepção vê os acessos ao portal de P';
  END IF;
  PERFORM public.revoke_portal_access((SELECT id FROM public.portal_access_list('00000000-0000-4000-8000-0000000000f1')));
  BEGIN
    PERFORM public.set_portal_settings(false, NULL, NULL, NULL, false);
    RAISE EXCEPTION 'FALHA: recepção mudou as configurações do portal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Acesso revogado: C1 perde tudo na hora.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
DO $$ BEGIN
  IF jsonb_array_length((public.portal_me())->'patients') <> 0 THEN RAISE EXCEPTION 'FALHA: acesso revogado continua na lista'; END IF;
  BEGIN
    PERFORM * FROM public.portal_charges('00000000-0000-4000-8000-0000000000f1');
    RAISE EXCEPTION 'FALHA: acesso revogado continuou vendo cobranças';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Avisos: série de sessões vira um aviso; e-mail genérico, um por hora; portal desligado bloqueia tudo.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM public.set_portal_settings(true, 'https://portal.example.test/', 'PIX: chave de teste',
    '00000000-0000-4000-8000-0000000000f2', true);
END $$;
RESET ROLE;
DELETE FROM public.notifications WHERE user_id IN ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c1');
INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at) VALUES
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000000a', '2030-02-04 12:00+00', '2030-02-04 12:50+00'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000000a', '2030-02-11 12:00+00', '2030-02-11 12:50+00'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000000a', '2030-02-18 12:00+00', '2030-02-18 12:50+00'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2030-02-19 12:00+00', '2030-02-19 12:50+00');
UPDATE public.appointments SET status = 'cancelled_by_clinic' WHERE id = '00000000-0000-4000-8000-0000000013a1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-0000000000c4'
      AND title LIKE '3 sessões marcadas, a partir de%' AND link = '#/portal/consultas') <> 1
    OR (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-0000000000c4' AND title LIKE '%cancelada') <> 1
    OR (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-0000000000c1' AND kind = 'portal') <> 0 THEN
    RAISE EXCEPTION 'FALHA: avisos do portal (série agrupada, cancelamento, nada para acesso revogado): %',
      (SELECT string_agg(user_id || ' ' || title, '; ') FROM public.notifications WHERE kind = 'portal');
  END IF;
  IF (SELECT count(*) FROM public.portal_email_outbox WHERE user_id = '00000000-0000-4000-8000-0000000000c4' AND kind = 'notice') <> 1 THEN
    RAISE EXCEPTION 'FALHA: e-mail genérico do portal (um por hora)';
  END IF;
  IF (SELECT portal_assignee_id FROM public.clinic_settings) <> '00000000-0000-4000-8000-0000000000f2'
    OR (SELECT portal_url FROM public.clinic_settings) <> 'https://portal.example.test' THEN
    RAISE EXCEPTION 'FALHA: configurações do portal';
  END IF;
  UPDATE public.clinic_settings SET portal_enabled = false WHERE id;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.portal_appointments('00000000-0000-4000-8000-0000000000f5');
    RAISE EXCEPTION 'FALHA: portal desligado continuou mostrando sessões';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (public.portal_me())->>'payment_instructions' IS NOT NULL THEN RAISE EXCEPTION 'FALHA: portal desligado mostrou instruções de pagamento'; END IF;
END $$;
RESET ROLE;
UPDATE public.integration_state SET enabled = false WHERE key = 'portal_email';

-- Verificação em duas etapas (Bloco 14) ------------------------------------------------------------
-- Exigência ligada: Proprietária que entrou só com a senha (aal1) não alcança nada até digitar o código.
UPDATE public.clinic_settings SET require_mfa = true WHERE id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
DO $$
DECLARE
  access jsonb := public.my_access();
  t record;
  f record;
  total bigint;
  result text;
  args text;
  leaked text[] := '{}';
BEGIN
  IF access->>'mfa' <> 'enroll' OR jsonb_array_length(access->'permissions') <> 0 OR NOT (access->'roles') ? 'owner' THEN
    RAISE EXCEPTION 'FALHA: my_access da Proprietária sem o código: %', access;
  END IF;
  IF private.has_permission('users.manage') OR private.is_staff() OR private.has_role('owner') THEN
    RAISE EXCEPTION 'FALHA: Proprietária sem o código manteve permissões';
  END IF;
  BEGIN
    PERFORM public.set_mfa_required(false);
    RAISE EXCEPTION 'FALHA: Proprietária sem o código desligou a exigência';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Tabelas: nada, exceto as linhas da própria conta.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p') AND has_table_privilege('authenticated', c.oid, 'SELECT')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO total;
    IF total > 0 AND t.relname NOT IN ('profiles', 'user_roles', 'notifications') THEN leaked := leaked || (t.relname || '=' || total); END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.profiles) <> 1 OR (SELECT count(*) FROM public.user_roles) <> 1
    OR EXISTS (SELECT 1 FROM public.notifications WHERE user_id <> auth.uid()) THEN
    leaked := leaked || 'perfis/avisos de outras contas'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects) THEN leaked := leaked || 'storage.objects'::text; END IF;
  IF leaked <> '{}' THEN RAISE EXCEPTION 'FALHA: Proprietária sem o código leu tabelas: %', leaked; END IF;

  -- Funções da equipe, chamadas com argumentos vazios: precisam recusar ou não devolver nada.
  FOR f IN SELECT p.oid, p.proname, p.proretset, p.prorettype,
      (SELECT string_agg('NULL::' || format_type(a, NULL), ', ' ORDER BY i) FROM unnest(p.proargtypes) WITH ORDINALITY x(a, i)) AS nulls
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      -- Revisadas: só mexem nos dados da própria conta (ou somam zero sem permissão, conferido abaixo).
      AND p.proname NOT IN ('portal_me', 'my_access', 'mark_notifications_read', 'my_whatsapp', 'unregister_push_device', 'receivables_now')
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    args := coalesce(f.nulls, '');
    BEGIN
      IF f.proretset THEN
        EXECUTE format('SELECT count(*) FROM public.%I(%s)', f.proname, args) INTO total;
        IF total > 0 THEN leaked := leaked || (f.proname || ' devolveu ' || total); END IF;
      ELSIF f.prorettype = 'void'::regtype THEN
        EXECUTE format('SELECT public.%I(%s)', f.proname, args);
        leaked := leaked || (f.proname || ' executou');
      ELSE
        EXECUTE format('SELECT public.%I(%s)::text', f.proname, args) INTO result;
        IF result IS NOT NULL AND result NOT IN ('0', 'false', '[]', '{}', '') THEN leaked := leaked || (f.proname || '=' || left(result, 80)); END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.receivables_now() r WHERE r.open_amount <> 0 OR r.overdue_count <> 0) THEN
    leaked := leaked || 'receivables_now com valores'::text;
  END IF;
  IF leaked <> '{}' THEN RAISE EXCEPTION 'FALHA: Proprietária sem o código alcançou funções: %', leaked; END IF;
END $$;

-- Proprietária que também atende: sem o código, nem o prontuário dos próprios pacientes.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated","aal":"aal1"}', true);
DO $$ BEGIN
  IF private.current_professional_id() IS NOT NULL OR private.cares_for('00000000-0000-4000-8000-0000000000f4') THEN
    RAISE EXCEPTION 'FALHA: Proprietária que atende viu prontuário sem o código';
  END IF;
END $$;

-- Recepção não é obrigada; Proprietária com o código (aal2) volta a ter tudo.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated","aal":"aal1"}', true);
DO $$ BEGIN
  IF NOT private.is_staff() OR NOT private.has_permission('patients.manage') OR (public.my_access())->>'mfa' <> 'ok' THEN
    RAISE EXCEPTION 'FALHA: Recepção perdeu acesso com a exigência (só vale para Proprietária e Gerência)';
  END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
DO $$ BEGIN
  IF NOT private.has_permission('users.manage') OR (public.my_access())->>'mfa' <> 'ok' THEN
    RAISE EXCEPTION 'FALHA: Proprietária com o código continuou sem acesso';
  END IF;
  PERFORM public.set_mfa_required(false);
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
    PERFORM public.set_mfa_required(true);
    RAISE EXCEPTION 'FALHA: exigência ligada por sessão sem o código';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT require_mfa FROM public.clinic_settings) THEN RAISE EXCEPTION 'FALHA: exigência deveria estar desligada'; END IF;
END $$;

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
