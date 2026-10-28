CREATE OR REPLACE FUNCTION public.set_staff_username(p_user_id uuid, p_username text) RETURNS void
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
