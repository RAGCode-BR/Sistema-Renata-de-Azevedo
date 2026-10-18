-- Bloco 1: perfis múltiplos e permissões por ação.
--
-- Antes: cada conta tinha um único papel (administração ou profissional) em profiles.role.
-- Agora: uma pessoa pode ter vários perfis (ex.: Renata = Proprietária + Profissional), e o que cada
-- perfil pode fazer fica em role_permissions. As políticas RLS perguntam "tem a permissão X?".
--
-- O acesso clínico NÃO é uma permissão de cargo: prontuários continuam restritos à profissional
-- responsável e aos pacientes da própria carteira (perfil Profissional + vínculo com o paciente).
-- Nem a Proprietária vê o prontuário de outra profissional.

CREATE DOMAIN public.app_role AS text
  CHECK (VALUE IN ('owner', 'manager', 'reception', 'finance', 'professional', 'patient'));

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);

-- Os mesmos nomes de shared/permissions.ts. Recepção e Financeiro ficam prontos para uso futuro;
-- Paciente não tem permissões administrativas (portal do paciente é uma fase posterior).
INSERT INTO public.role_permissions (role, permission) VALUES
  ('owner', 'users.manage'), ('owner', 'professionals.manage'), ('owner', 'patients.view_all'),
  ('owner', 'patients.manage'), ('owner', 'appointments.view_all'), ('owner', 'appointments.manage'),
  ('owner', 'calendars.view_all'), ('owner', 'finance.view'), ('owner', 'finance.manage'),
  ('owner', 'settings.manage'),
  ('manager', 'professionals.manage'), ('manager', 'patients.view_all'), ('manager', 'patients.manage'),
  ('manager', 'appointments.view_all'), ('manager', 'appointments.manage'), ('manager', 'calendars.view_all'),
  ('manager', 'finance.view'),
  ('reception', 'patients.view_all'), ('reception', 'patients.manage'),
  ('reception', 'appointments.view_all'), ('reception', 'appointments.manage'),
  ('finance', 'finance.view'), ('finance', 'finance.manage');

-- Contas existentes: a administração criada primeiro vira Proprietária; as demais, Gerente.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id,
  CASE
    WHEN p.role = 'professional' THEN 'professional'
    WHEN p.id = (
      SELECT first.id FROM public.profiles first JOIN auth.users u ON u.id = first.id
      WHERE first.role = 'admin' ORDER BY u.created_at LIMIT 1
    ) THEN 'owner'
    ELSE 'manager'
  END
FROM public.profiles p;

-- Quem está acessando ------------------------------------------------------------------------
-- SECURITY DEFINER: leem perfis sem passar pelas políticas (evita recursão), sempre a partir do
-- usuário do token (auth.uid()). Conta inativa não tem perfil válido e, portanto, nenhum acesso.

CREATE FUNCTION private.has_role(wanted text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND p.active AND r.role = wanted
  )
$$;

CREATE FUNCTION private.has_permission(wanted text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    JOIN public.role_permissions rp ON rp.role = r.role
    WHERE r.user_id = auth.uid() AND p.active AND rp.permission = wanted
  )
$$;

-- Equipe: qualquer perfil ativo, exceto Paciente.
CREATE FUNCTION private.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND p.active AND r.role <> 'patient'
  )
$$;

-- A profissional da sessão: exige o perfil Profissional, além do vínculo com o cadastro.
CREATE OR REPLACE FUNCTION private.current_professional_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.professional_id FROM public.profiles p
  WHERE p.id = auth.uid() AND p.active
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'professional')
$$;

-- Políticas ----------------------------------------------------------------------------------

DROP POLICY "equipe vê profissionais" ON public.professionals;
DROP POLICY "administração cadastra profissionais" ON public.professionals;
DROP POLICY "cada um vê a própria conta; administração vê todas" ON public.profiles;
DROP POLICY "administração vê todos; profissional vê os seus" ON public.patients;
DROP POLICY "administração cadastra pacientes" ON public.patients;
DROP POLICY "administração vê vínculos; profissional vê os seus" ON public.patient_professionals;
DROP POLICY "administração vincula pacientes" ON public.patient_professionals;
DROP POLICY "administração vê a agenda; profissional vê a sua" ON public.appointments;
DROP POLICY "administração agenda sessões" ON public.appointments;
DROP POLICY "administração vê calendários; profissional vê os seus" ON public.google_calendars;

CREATE POLICY "equipe vê profissionais" ON public.professionals
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "quem gerencia profissionais cadastra" ON public.professionals
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('professionals.manage'));

CREATE POLICY "cada um vê a própria conta; quem gerencia usuários vê todas" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR private.has_permission('users.manage'));

CREATE POLICY "cada um vê os próprios perfis; quem gerencia usuários vê todos" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.has_permission('users.manage'));

CREATE POLICY "pacientes: visão geral ou carteira da profissional" ON public.patients
  FOR SELECT TO authenticated USING (private.has_permission('patients.view_all') OR private.cares_for(id));
CREATE POLICY "quem gerencia pacientes cadastra" ON public.patients
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('patients.manage'));

CREATE POLICY "vínculos: visão geral ou os da profissional" ON public.patient_professionals
  FOR SELECT TO authenticated
  USING (private.has_permission('patients.view_all') OR professional_id = private.current_professional_id());
CREATE POLICY "quem gerencia pacientes vincula" ON public.patient_professionals
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('patients.manage'));

CREATE POLICY "agenda: geral ou da profissional" ON public.appointments
  FOR SELECT TO authenticated
  USING (private.has_permission('appointments.view_all') OR professional_id = private.current_professional_id());
CREATE POLICY "quem gerencia a agenda agenda sessões" ON public.appointments
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('appointments.manage'));

CREATE POLICY "calendários: todos ou os da profissional" ON public.google_calendars
  FOR SELECT TO authenticated
  USING (private.has_permission('calendars.view_all') OR professional_id = private.current_professional_id());

CREATE OR REPLACE FUNCTION public.list_google_calendars()
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
  WHERE private.has_permission('calendars.view_all') OR gc.professional_id = private.current_professional_id()
  ORDER BY pr.name, gc.display_name
$$;

-- O papel único sai de profiles (os perfis agora ficam em user_roles).
DROP FUNCTION private.is_admin();
DROP FUNCTION private.user_role();
ALTER TABLE public.profiles DROP COLUMN role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_roles, public.role_permissions FROM anon;
-- Perfis só mudam pela função set_user_access (abaixo) ou na criação da conta.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_roles FROM authenticated;
REVOKE ALL ON public.role_permissions FROM authenticated;

-- Contas novas -------------------------------------------------------------------------------
-- A Edge Function admin-create-user grava em app_metadata: roles (lista) e professional_id.
-- Só a chave de serviço define app_metadata; conta sem perfis não ganha acesso.

CREATE OR REPLACE FUNCTION private.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  roles text[];
  professional uuid;
  created uuid;
BEGIN
  IF jsonb_typeof(NEW.raw_app_meta_data->'roles') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(DISTINCT value) INTO roles FROM jsonb_array_elements_text(NEW.raw_app_meta_data->'roles');
  IF roles IS NULL THEN
    RETURN NEW;
  END IF;
  professional := CASE WHEN 'professional' = ANY (roles)
    THEN nullif(NEW.raw_app_meta_data->>'professional_id', '')::uuid END;
  IF 'professional' = ANY (roles) AND professional IS NULL THEN
    RAISE EXCEPTION 'O perfil Profissional exige uma profissional vinculada.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.profiles (id, name, email, professional_id)
  VALUES (NEW.id, coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'), ''), NEW.email), NEW.email, professional)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO created;

  -- Só na criação do perfil: mudanças posteriores de perfis são feitas por set_user_access.
  IF created IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) SELECT created, unnest(roles);
  END IF;
  RETURN NEW;
END $$;

-- Funções chamadas pela interface ------------------------------------------------------------

-- Perfis e permissões de quem está conectado (menu e telas da web e do aplicativo).
CREATE FUNCTION public.my_access() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'roles', coalesce((
      SELECT jsonb_agg(r.role ORDER BY r.role) FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id WHERE r.user_id = auth.uid() AND p.active
    ), '[]'::jsonb),
    'permissions', coalesce((
      SELECT jsonb_agg(DISTINCT rp.permission) FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      JOIN public.role_permissions rp ON rp.role = r.role
      WHERE r.user_id = auth.uid() AND p.active
    ), '[]'::jsonb)
  )
$$;

-- Altera perfis, profissional vinculada e situação (ativa/inativa) de uma conta.
-- Regras: só quem gerencia usuários; ninguém tira de si o perfil de Proprietária nem se desativa;
-- sempre resta ao menos uma Proprietária ativa.
CREATE FUNCTION public.set_user_access(
  p_user_id uuid, p_roles text[], p_professional_id uuid, p_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  roles text[] := ARRAY(SELECT DISTINCT unnest(p_roles));
  professional uuid;
  was_active_owner boolean;
BEGIN
  IF NOT private.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(cardinality(roles), 0) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um perfil.' USING ERRCODE = 'P0001';
  END IF;
  IF 'patient' = ANY (roles) AND cardinality(roles) > 1 THEN
    RAISE EXCEPTION 'O perfil Paciente não pode ser combinado com perfis da equipe.' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id = auth.uid() AND NOT p_active THEN
    RAISE EXCEPTION 'Você não pode desativar a própria conta.' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = auth.uid() AND private.has_role('owner') AND NOT ('owner' = ANY (roles)) THEN
    RAISE EXCEPTION 'Você não pode remover o próprio perfil de Proprietária.' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.active AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'owner')
  INTO was_active_owner FROM public.profiles p WHERE p.id = p_user_id;
  IF was_active_owner AND (NOT p_active OR NOT ('owner' = ANY (roles))) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'owner' AND p.active AND p.id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'É preciso manter ao menos uma Proprietária ativa.' USING ERRCODE = 'P0001';
  END IF;

  IF 'professional' = ANY (roles) THEN
    IF p_professional_id IS NULL THEN
      RAISE EXCEPTION 'O perfil Profissional exige uma profissional vinculada.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id AND active) THEN
      RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE professional_id = p_professional_id AND id <> p_user_id) THEN
      RAISE EXCEPTION 'Esta profissional já tem uma conta.' USING ERRCODE = 'P0001';
    END IF;
    professional := p_professional_id;
  END IF;

  UPDATE public.profiles SET professional_id = professional, active = p_active WHERE id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND NOT (role = ANY (roles));
  INSERT INTO public.user_roles (user_id, role, granted_by)
  SELECT p_user_id, unnest(roles), auth.uid()
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'update_access', 'user', p_user_id);
END $$;

REVOKE ALL ON FUNCTION public.my_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_access(uuid, text[], uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access(uuid, text[], uuid, boolean) TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(text), private.has_permission(text), private.is_staff(),
  private.current_professional_id(), private.cares_for(uuid) TO authenticated;
