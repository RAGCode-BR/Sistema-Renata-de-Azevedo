-- Bloco 14: verificação em duas etapas (código de app autenticador, TOTP do Supabase Auth).
--
-- - Qualquer pessoa da equipe pode ativar para a própria conta.
-- - Configurações → "Exigir para Proprietária e Gerência" (desligado por padrão). Ligado, quem tem um
--   desses perfis e entrou só com a senha (sessão aal1) fica SEM NENHUMA permissão no banco até digitar o
--   código (sessão aal2). A regra está nas funções de acesso (has_permission, has_role, is_staff,
--   current_professional_id), usadas por todas as políticas e funções; não depende da tela.
-- - Só liga quem já está com a sessão verificada (evita trancar a clínica para fora).

ALTER TABLE public.clinic_settings ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;

-- A sessão atende à exigência? (Perfis Paciente, Recepção, Financeiro e Profissional não são obrigados.)
CREATE FUNCTION private.mfa_ok() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT auth.jwt()->>'aal'), '') = 'aal2'
    OR NOT coalesce((SELECT s.require_mfa FROM public.clinic_settings s LIMIT 1), false)
    OR NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = (SELECT auth.uid()) AND r.role IN ('owner', 'manager'))
$$;

CREATE OR REPLACE FUNCTION private.has_role(wanted text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND p.active AND r.role = wanted
  ) AND private.mfa_ok()
$$;

CREATE OR REPLACE FUNCTION private.has_permission(wanted text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    JOIN public.role_permissions rp ON rp.role = r.role
    WHERE r.user_id = auth.uid() AND p.active AND rp.permission = wanted
  ) AND private.mfa_ok()
$$;

CREATE OR REPLACE FUNCTION private.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid() AND p.active AND r.role <> 'patient'
  ) AND private.mfa_ok()
$$;

CREATE OR REPLACE FUNCTION private.current_professional_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.professional_id FROM public.profiles p
  WHERE p.id = auth.uid() AND p.active AND private.mfa_ok()
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'professional')
$$;

CREATE FUNCTION private.has_verified_factor() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  found boolean := false;
BEGIN
  -- auth.mfa_factors só existe no Supabase (no banco local de testes, não há fatores).
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified')$q$ INTO found;
  END IF;
  RETURN found;
END $$;

-- Perfis continuam aparecendo (a tela precisa saber quem é); as permissões só com a exigência atendida.
-- "mfa": ok | verify (tem código cadastrado, falta digitar) | enroll (precisa cadastrar o app autenticador).
CREATE OR REPLACE FUNCTION public.my_access() RETURNS jsonb
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
      WHERE r.user_id = auth.uid() AND p.active AND private.mfa_ok()
    ), '[]'::jsonb),
    'mfa', CASE
      WHEN private.mfa_ok() THEN 'ok'
      WHEN private.has_verified_factor() THEN 'verify'
      ELSE 'enroll' END
  )
$$;

-- Ligar/desligar a exigência (Configurações). Ligar exige que a própria sessão já esteja verificada.
CREATE FUNCTION public.set_mfa_required(p_required boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  IF p_required AND coalesce(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Ative a verificação em duas etapas na sua conta (menu da conta) e entre com o código antes de exigir para a equipe.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.clinic_settings SET require_mfa = coalesce(p_required, false), updated_at = now() WHERE id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type) VALUES (auth.uid(), CASE WHEN p_required THEN 'mfa_required_on' ELSE 'mfa_required_off' END, 'clinic_settings');
END $$;

REVOKE ALL ON FUNCTION private.mfa_ok(), private.has_verified_factor() FROM PUBLIC, anon;
-- As políticas chamam as funções de acesso com o usuário conectado, e elas chamam mfa_ok.
GRANT EXECUTE ON FUNCTION private.mfa_ok(), private.has_verified_factor() TO authenticated;
REVOKE ALL ON FUNCTION public.set_mfa_required(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_mfa_required(boolean) TO authenticated;
