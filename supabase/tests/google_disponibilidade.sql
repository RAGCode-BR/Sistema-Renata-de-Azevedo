-- O Google ocupa o horário para novas sessões, mas não impede ações em sessões anteriores.
BEGIN;
DO $$
DECLARE
  professional uuid := gen_random_uuid();
  patient uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
  account uuid := gen_random_uuid();
  calendar uuid := gen_random_uuid();
  appointment uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.professionals (id, name) VALUES (professional, 'Teste Disponibilidade Google');
  INSERT INTO public.patients (id, name) VALUES (patient, 'Teste Paciente Google');
  INSERT INTO public.patient_professionals (patient_id, professional_id) VALUES (patient, professional);
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (owner, 'teste-disponibilidade-google@example.test', '{"roles":["owner"]}', '{"name":"Teste Disponibilidade"}');
  INSERT INTO public.google_accounts (id, user_id, google_subject, google_email,
    refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)
    VALUES (account, owner, 'teste-subject', 'teste-google@example.test', decode('00', 'hex'), decode('00', 'hex'), decode('00', 'hex'));
  INSERT INTO public.google_calendars (id, google_account_id, professional_id, google_calendar_id,
    display_name, access_role)
    VALUES (calendar, account, professional, 'teste-calendar', 'Agenda pessoal', 'owner');
  INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at)
    VALUES (appointment, patient, professional, '2030-02-05 10:00-03', '2030-02-05 11:00-03');
  INSERT INTO public.google_busy (professional_id, google_calendar_id, starts_at, ends_at)
    VALUES (professional, calendar, '2030-02-05 10:00-03', '2030-02-05 12:00-03');
  UPDATE public.appointments SET status = 'confirmed' WHERE id = appointment;
  BEGIN
    INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at)
      VALUES (patient, professional, '2030-02-05 11:00-03', '2030-02-05 11:50-03');
    RAISE EXCEPTION 'FALHA: sessão criada sobre compromisso pessoal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Compromisso no Google Agenda%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.appointments SET starts_at = '2030-02-05 11:00-03', ends_at = '2030-02-05 11:50-03' WHERE id = appointment;
    RAISE EXCEPTION 'FALHA: sessão movida para compromisso pessoal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Compromisso no Google Agenda%' THEN RAISE; END IF;
  END;
  INSERT INTO public.appointments (patient_id, professional_id, starts_at, ends_at)
    VALUES (patient, professional, '2030-02-05 12:00-03', '2030-02-05 12:50-03');
  -- Cancelar é livre; reativar a sessão cancelada sobre o compromisso pessoal é recusado.
  UPDATE public.appointments SET status = 'cancelled_by_patient' WHERE id = appointment;
  BEGIN
    UPDATE public.appointments SET status = 'scheduled' WHERE id = appointment;
    RAISE EXCEPTION 'FALHA: sessão cancelada reativada sobre compromisso pessoal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Compromisso no Google Agenda%' THEN RAISE; END IF;
  END;
END $$;
SELECT 'Conflito com Google Agenda e edição de sessão existente passaram.' AS resultado;
ROLLBACK;
