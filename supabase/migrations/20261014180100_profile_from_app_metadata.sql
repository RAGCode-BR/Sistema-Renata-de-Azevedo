-- O Supabase Auth grava a conta nova e só depois preenche app_metadata (papel e profissional).
-- Por isso o perfil é criado também quando app_metadata é atualizado, uma única vez por conta.
-- Mudanças posteriores de papel não alteram o perfil existente (devem ser feitas em profiles).
CREATE OR REPLACE FUNCTION private.handle_new_user() RETURNS trigger
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
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT OR UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Contas que já receberam papel antes desta correção.
INSERT INTO public.profiles (id, name, email, role, professional_id)
SELECT u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), u.email), u.email,
  u.raw_app_meta_data->>'role', nullif(u.raw_app_meta_data->>'professional_id', '')::uuid
FROM auth.users u
WHERE u.raw_app_meta_data ? 'role'
ON CONFLICT (id) DO NOTHING;
