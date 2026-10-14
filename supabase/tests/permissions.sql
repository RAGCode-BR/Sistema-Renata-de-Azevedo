-- Teste das permissões (RLS). Rodar com: npm run test:db
-- Tudo acontece numa transação desfeita no final (ROLLBACK): nenhum dado fica no banco.
-- Cada verificação que falhar interrompe o teste com uma mensagem "FALHA: ...".
BEGIN;

-- Cenário: administração, duas profissionais (A e B), uma conta sem papel, um paciente da A.
INSERT INTO public.professionals (id, name) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Teste Profissional A'),
  ('00000000-0000-4000-8000-00000000000b', 'Teste Profissional B');

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'teste-admin@example.test', '{"role":"admin"}', '{"name":"Teste Admin"}'),
  ('00000000-0000-4000-8000-0000000000a1', 'teste-a@example.test', '{"role":"professional","professional_id":"00000000-0000-4000-8000-00000000000a"}', '{"name":"Teste A"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'teste-b@example.test', '{"role":"professional","professional_id":"00000000-0000-4000-8000-00000000000b"}', '{"name":"Teste B"}'),
  ('00000000-0000-4000-8000-0000000000e1', 'teste-sem-papel@example.test', '{}', '{}');

INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-0000000000f1', 'Teste Paciente');
INSERT INTO public.patient_professionals VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a');
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
   '2030-01-07 12:00+00', '2030-01-07 12:50+00');
INSERT INTO public.clinical_notes (patient_id, professional_id, body) VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', 'Evolução de teste.');

-- Como o Supabase Auth faz: conta gravada primeiro, papel preenchido depois.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000d2', 'teste-papel-depois@example.test', '{"provider":"email"}', '{"name":"Teste Papel Depois"}');
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
WHERE id = '00000000-0000-4000-8000-0000000000d2';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000d2' AND role = 'admin') THEN
    RAISE EXCEPTION 'FALHA: perfil não foi criado quando o papel chegou depois da conta';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE email LIKE 'teste-%') <> 4 THEN
    RAISE EXCEPTION 'FALHA: perfis criados pelo gatilho (esperado 4, a conta sem papel não ganha perfil)';
  END IF;
END $$;

-- Sem login (chave pública sozinha): nenhuma tabela pode ser lida.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.patients;
    RAISE EXCEPTION 'FALHA: sem login foi possível ler pacientes';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Administração: vê pacientes e agenda, NÃO vê prontuários, agenda com regras.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 1 THEN RAISE EXCEPTION 'FALHA: administração deveria ver o paciente'; END IF;
  IF (SELECT count(*) FROM public.appointments) <> 1 THEN RAISE EXCEPTION 'FALHA: administração deveria ver a agenda'; END IF;
  IF (SELECT count(*) FROM public.clinical_notes) <> 0 THEN RAISE EXCEPTION 'FALHA: administração viu prontuários'; END IF;
  IF (SELECT count(*) FROM public.profiles) < 4 THEN RAISE EXCEPTION 'FALHA: administração deveria ver as contas'; END IF;
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
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', 'Tentativa da administração.');
    RAISE EXCEPTION 'FALHA: administração registrou evolução';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Profissional A: vê o próprio paciente e as próprias evoluções; registra evolução.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver o próprio paciente'; END IF;
  IF (SELECT count(*) FROM public.clinical_notes) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver a própria evolução'; END IF;
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'FALHA: profissional A deveria ver só a própria conta'; END IF;
  INSERT INTO public.clinical_notes (patient_id, body) VALUES ('00000000-0000-4000-8000-0000000000f1', 'Nova evolução da A.');
  IF (SELECT professional_id FROM public.clinical_notes WHERE body = 'Nova evolução da A.') <> '00000000-0000-4000-8000-00000000000a' THEN
    RAISE EXCEPTION 'FALHA: evolução não ficou com a profissional da sessão';
  END IF;
  BEGIN
    INSERT INTO public.patients (name) VALUES ('Paciente criado pela profissional');
    RAISE EXCEPTION 'FALHA: profissional cadastrou paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Profissional B: não vê nada da A e não consegue escrever no prontuário do paciente da A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu paciente da A'; END IF;
  IF (SELECT count(*) FROM public.appointments) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu agenda da A'; END IF;
  IF (SELECT count(*) FROM public.clinical_notes) <> 0 THEN RAISE EXCEPTION 'FALHA: profissional B viu prontuário da A'; END IF;
  BEGIN
    INSERT INTO public.clinical_notes (patient_id, body) VALUES ('00000000-0000-4000-8000-0000000000f1', 'Intrusão.');
    RAISE EXCEPTION 'FALHA: profissional B escreveu no prontuário da A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Conta sem papel (ex.: criada fora da Edge Function): nenhum acesso.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.professionals) <> 0 THEN RAISE EXCEPTION 'FALHA: conta sem papel viu profissionais'; END IF;
END $$;
RESET ROLE;

-- Conta desativada perde o acesso na hora.
UPDATE public.profiles SET active = false WHERE id = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.patients) <> 0 THEN RAISE EXCEPTION 'FALHA: conta desativada continuou vendo pacientes'; END IF;
END $$;
RESET ROLE;

SELECT 'Todas as verificações de permissão passaram.' AS resultado;
ROLLBACK;
