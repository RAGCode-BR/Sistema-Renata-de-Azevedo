-- Nome de usuário exclusivo para a equipe. Pacientes continuam entrando por código.
ALTER TABLE public.profiles ADD COLUMN username text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9._-]{2,31}$');
CREATE UNIQUE INDEX profiles_username_unique ON public.profiles (username) WHERE username IS NOT NULL;

-- Atribui logins às contas existentes sem alterar senhas ou endereços de e-mail.
WITH bases AS (
  SELECT p.id,
    left(lower(regexp_replace(split_part(p.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), 23) AS base
  FROM public.profiles p
  WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role <> 'patient')
), candidates AS (
  SELECT id, CASE WHEN base ~ '^[a-z][a-z0-9._-]{2,22}$' THEN base
    ELSE 'usuario' END AS base FROM bases
), chosen AS (
  SELECT id, CASE WHEN count(*) OVER (PARTITION BY base) = 1 THEN base
    ELSE left(base, 23) || '_' || left(replace(id::text, '-', ''), 8) END AS username
  FROM candidates
)
UPDATE public.profiles p SET username = c.username FROM chosen c WHERE p.id = c.id;

-- Contas futuras: o login vem dos metadados protegidos da criação administrativa.
-- Para contas antigas criadas por scripts, gera um identificador exclusivo legível.
CREATE FUNCTION private.assign_staff_username() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  roles jsonb;
  supplied text;
  base text;
BEGIN
  SELECT raw_app_meta_data->'roles', lower(raw_app_meta_data->>'username')
    INTO roles, supplied FROM auth.users WHERE id = NEW.id;
  IF roles IS NULL OR roles = '["patient"]'::jsonb THEN RETURN NEW; END IF;
  IF supplied IS NOT NULL AND supplied <> '' THEN
    NEW.username := supplied;
  ELSE
    base := left(lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), 22);
    IF base !~ '^[a-z][a-z0-9._-]{2,21}$' THEN base := 'usuario'; END IF;
    NEW.username := base || '_' || left(replace(NEW.id::text, '-', ''), 8);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.assign_staff_username() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assign_staff_username BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.assign_staff_username();

-- A Proprietária pode trocar o login de uma conta; o índice garante exclusividade.
CREATE FUNCTION public.set_staff_username(p_user_id uuid, p_username text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  normalized text := lower(trim(p_username));
BEGIN
  PERFORM private.require_permission('users.manage');
  IF normalized IS NULL OR normalized !~ '^[a-z][a-z0-9._-]{2,31}$' THEN
    RAISE EXCEPTION 'Use de 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. Comece com uma letra.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.profiles SET username = normalized
    WHERE id = p_user_id AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role <> 'patient');
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta da equipe não encontrada.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
    VALUES (auth.uid(), 'change_username', 'user', p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.set_staff_username(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_username(uuid, text) TO authenticated;
