-- Sistema da clínica: tabelas, permissões (RLS) e funções.
--
-- A interface fala direto com o Supabase (supabase-js, chave pública). Por isso TODA regra de acesso
-- está aqui, no banco:
--   * administração: cadastros, agenda e contas; NÃO vê prontuários;
--   * profissional: só os próprios pacientes, sessões e evoluções;
--   * sem login (chave pública sozinha): nada.
-- O login é o Supabase Auth, sem cadastro público (supabase/config.toml); contas são criadas pela
-- Edge Function admin-create-user. Atenção: o Supabase concede acesso padrão às tabelas novas do
-- schema public; toda tabela nova precisa de RLS e de políticas próprias.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Funções auxiliares fora do schema public: não ficam expostas pela API.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Tabelas -------------------------------------------------------------------------------------

CREATE TABLE public.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por conta do Supabase Auth, criada pelo gatilho on_auth_user_created.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'professional')),
  professional_id uuid UNIQUE REFERENCES public.professionals(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'professional') = (professional_id IS NOT NULL))
);

CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  email text,
  birth_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.patient_professionals (
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  PRIMARY KEY (patient_id, professional_id)
);
CREATE INDEX patient_professionals_prof_idx ON public.patient_professionals (professional_id);

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'missed', 'cancelled')),
  modality text NOT NULL DEFAULT 'presencial' CHECK (modality IN ('presencial', 'online')),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Uma profissional não pode ter duas sessões (não canceladas) no mesmo horário.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled')
);
CREATE INDEX appointments_prof_time_idx ON public.appointments (professional_id, starts_at);
CREATE INDEX appointments_patient_idx ON public.appointments (patient_id);

CREATE TABLE public.clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  appointment_id uuid REFERENCES public.appointments(id),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clinical_notes_patient_prof_idx ON public.clinical_notes (patient_id, professional_id);

-- Contas Google: os tokens só serão lidos por Edge Functions (chave de serviço), nunca pela interface.
CREATE TABLE public.google_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_subject text NOT NULL,
  google_email text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  refresh_token_tag bytea NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_subject)
);

CREATE TABLE public.google_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_account_id uuid NOT NULL REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  google_calendar_id text NOT NULL,
  display_name text NOT NULL,
  access_role text NOT NULL CHECK (access_role IN ('owner', 'writer', 'reader', 'freeBusyReader')),
  selected boolean NOT NULL DEFAULT false,
  sync_token text,
  last_synced_at timestamptz,
  UNIQUE (google_account_id, google_calendar_id)
);
CREATE INDEX google_calendars_prof_idx ON public.google_calendars (professional_id);

CREATE TABLE public.calendar_event_links (
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  google_calendar_id uuid NOT NULL REFERENCES public.google_calendars(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  google_etag text,
  last_synced_at timestamptz,
  PRIMARY KEY (appointment_id, google_calendar_id),
  UNIQUE (google_calendar_id, google_event_id)
);

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Quem está acessando ------------------------------------------------------------------------
-- SECURITY DEFINER: leem profiles sem passar pelas políticas (evita recursão), sempre filtrando
-- pelo usuário do token (auth.uid()). Contas inativas não têm papel e, portanto, nenhum acesso.

CREATE FUNCTION private.user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND active
$$;

CREATE FUNCTION private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(private.user_role() = 'admin', false)
$$;

CREATE FUNCTION private.current_professional_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT professional_id FROM public.profiles WHERE id = auth.uid() AND active AND role = 'professional'
$$;

-- O paciente está na carteira da profissional conectada?
CREATE FUNCTION private.cares_for(patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.patient_professionals
    WHERE patient_id = patient AND professional_id = private.current_professional_id()
  )
$$;

ALTER TABLE public.clinical_notes ALTER COLUMN professional_id SET DEFAULT private.current_professional_id();

-- Permissões ---------------------------------------------------------------------------------

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Sem login, nada. Com login, só o que as políticas abaixo liberam.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON public.google_accounts, public.calendar_event_links, public.audit_log FROM authenticated;

CREATE POLICY "equipe vê profissionais" ON public.professionals
  FOR SELECT TO authenticated USING (private.user_role() IS NOT NULL);
CREATE POLICY "administração cadastra profissionais" ON public.professionals
  FOR INSERT TO authenticated WITH CHECK (private.is_admin());

CREATE POLICY "cada um vê a própria conta; administração vê todas" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR private.is_admin());

CREATE POLICY "administração vê todos; profissional vê os seus" ON public.patients
  FOR SELECT TO authenticated USING (private.is_admin() OR private.cares_for(id));
CREATE POLICY "administração cadastra pacientes" ON public.patients
  FOR INSERT TO authenticated WITH CHECK (private.is_admin());

CREATE POLICY "administração vê vínculos; profissional vê os seus" ON public.patient_professionals
  FOR SELECT TO authenticated USING (private.is_admin() OR professional_id = private.current_professional_id());
CREATE POLICY "administração vincula pacientes" ON public.patient_professionals
  FOR INSERT TO authenticated WITH CHECK (private.is_admin());

CREATE POLICY "administração vê a agenda; profissional vê a sua" ON public.appointments
  FOR SELECT TO authenticated USING (private.is_admin() OR professional_id = private.current_professional_id());
CREATE POLICY "administração agenda sessões" ON public.appointments
  FOR INSERT TO authenticated WITH CHECK (private.is_admin());

-- Prontuários: só a profissional responsável, e só de pacientes da própria carteira.
-- Não há política para a administração: ela não lê nem grava evoluções.
CREATE POLICY "profissional vê as próprias evoluções" ON public.clinical_notes
  FOR SELECT TO authenticated
  USING (professional_id = private.current_professional_id() AND private.cares_for(patient_id));
CREATE POLICY "profissional registra evoluções dos seus pacientes" ON public.clinical_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    professional_id = private.current_professional_id()
    AND private.cares_for(patient_id)
    AND (appointment_id IS NULL OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id AND a.patient_id = clinical_notes.patient_id
        AND a.professional_id = clinical_notes.professional_id
    ))
  );

CREATE POLICY "administração vê calendários; profissional vê os seus" ON public.google_calendars
  FOR SELECT TO authenticated USING (private.is_admin() OR professional_id = private.current_professional_id());

-- Regras e registros automáticos ------------------------------------------------------------

-- Mensagem clara (em vez de erro de permissão) quando o paciente não é da profissional.
CREATE FUNCTION private.check_appointment_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_professionals
    WHERE patient_id = NEW.patient_id AND professional_id = NEW.professional_id
  ) THEN
    RAISE EXCEPTION 'Paciente não vinculado à profissional.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_check_link BEFORE INSERT OR UPDATE OF patient_id, professional_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.check_appointment_link();

-- Registro de criações (quem criou o quê). A interface não lê nem altera esta tabela.
CREATE FUNCTION private.audit_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'create', TG_ARGV[0], NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_professionals AFTER INSERT ON public.professionals FOR EACH ROW EXECUTE FUNCTION private.audit_insert('professional');
CREATE TRIGGER audit_profiles AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.audit_insert('user');
CREATE TRIGGER audit_patients AFTER INSERT ON public.patients FOR EACH ROW EXECUTE FUNCTION private.audit_insert('patient');
CREATE TRIGGER audit_appointments AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.audit_insert('appointment');
CREATE TRIGGER audit_clinical_notes AFTER INSERT ON public.clinical_notes FOR EACH ROW EXECUTE FUNCTION private.audit_insert('clinical_note');

-- Cria o perfil de cada conta nova do Auth. O papel vem de app_metadata, que só a chave de serviço
-- (Edge Function) consegue definir; uma conta sem papel não ganha perfil nem acesso.
CREATE FUNCTION private.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.raw_app_meta_data ? 'role' THEN
    INSERT INTO public.profiles (id, name, email, role, professional_id)
    VALUES (
      NEW.id,
      coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'), ''), NEW.email),
      NEW.email,
      NEW.raw_app_meta_data->>'role',
      nullif(NEW.raw_app_meta_data->>'professional_id', '')::uuid
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- Funções chamadas pela interface (supabase.rpc) -------------------------------------------

-- Cadastra o paciente e os vínculos numa única transação. SECURITY INVOKER: as políticas acima
-- continuam valendo (só a administração consegue).
CREATE FUNCTION public.create_patient(
  p_name text, p_phone text, p_email text, p_birth_date date, p_professional_ids uuid[]
) RETURNS public.patients
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  result public.patients;
BEGIN
  IF coalesce(trim(p_name), '') = '' OR coalesce(cardinality(p_professional_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Informe nome e profissionais responsáveis.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.patients (name, phone, email, birth_date)
  VALUES (trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_email), ''), p_birth_date)
  RETURNING * INTO result;
  INSERT INTO public.patient_professionals (patient_id, professional_id)
  SELECT DISTINCT result.id, professional FROM unnest(p_professional_ids) AS professional;
  RETURN result;
END $$;

-- Calendários com o e-mail da conta Google, sem expor a tabela de tokens.
CREATE FUNCTION public.list_google_calendars()
RETURNS TABLE (
  id uuid, professional_id uuid, display_name text, access_role text, selected boolean,
  last_synced_at timestamptz, google_email text, professional_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT gc.id, gc.professional_id, gc.display_name, gc.access_role, gc.selected, gc.last_synced_at,
    ga.google_email, pr.name
  FROM public.google_calendars gc
  JOIN public.google_accounts ga ON ga.id = gc.google_account_id
  JOIN public.professionals pr ON pr.id = gc.professional_id
  WHERE private.is_admin() OR gc.professional_id = private.current_professional_id()
  ORDER BY pr.name, gc.display_name
$$;

REVOKE ALL ON FUNCTION public.create_patient(text, text, text, date, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_google_calendars() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_patient(text, text, text, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_google_calendars() TO authenticated;

-- Funções privadas: só as usadas pelas políticas podem ser executadas por quem está conectado.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.user_role(), private.is_admin(), private.current_professional_id(),
  private.cares_for(uuid) TO authenticated;
