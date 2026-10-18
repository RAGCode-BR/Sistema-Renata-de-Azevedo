-- Quem pode ser responsável por um lead: pessoas ativas com acesso ao Comercial.
CREATE FUNCTION public.crm_owners() RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT p.id, p.name FROM public.profiles p WHERE private.user_can(p.id, 'crm.view') ORDER BY p.name;
END $$;
REVOKE ALL ON FUNCTION public.crm_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_owners() TO authenticated;
