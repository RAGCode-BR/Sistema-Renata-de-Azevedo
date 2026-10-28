-- A comissão das profissionais (commission_sales, commission_sessions) define o repasse (payout_statement e
-- close_payout), mas era gravada junto com o cadastro, por quem gerencia profissionais (a Gerência, que não
-- tem permissão financeira), e sem registro. Agora só quem gerencia o financeiro altera, e cada mudança vai
-- para a auditoria. Gravações sem usuário (migrações, chave de serviço) continuam livres.

CREATE FUNCTION private.guard_professional_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  changed boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.commission_sales OR NEW.commission_sessions
    ELSE NEW.commission_sales IS DISTINCT FROM OLD.commission_sales OR NEW.commission_sessions IS DISTINCT FROM OLD.commission_sessions END;
BEGIN
  IF changed AND auth.uid() IS NOT NULL THEN
    IF NOT private.has_permission('finance.manage') THEN
      RAISE EXCEPTION 'Só quem gerencia o financeiro altera as comissões da profissional.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
    VALUES (auth.uid(), 'update_commission', 'professional', NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER professionals_commission_guard BEFORE INSERT OR UPDATE ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION private.guard_professional_commission();
REVOKE ALL ON FUNCTION private.guard_professional_commission() FROM PUBLIC, anon, authenticated;
