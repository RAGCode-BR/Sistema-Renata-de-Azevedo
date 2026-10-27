-- Mensagens recebidas durante o contato comercial passam a constar no paciente após conversão.
UPDATE public.whatsapp_messages m SET patient_id = l.patient_id
FROM public.leads l WHERE m.lead_id = l.id AND m.direction = 'in'
  AND m.patient_id IS NULL AND l.patient_id IS NOT NULL;

CREATE FUNCTION private.link_whatsapp_messages_on_conversion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.patient_id IS NOT NULL AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    UPDATE public.whatsapp_messages SET patient_id = NEW.patient_id
    WHERE lead_id = NEW.id AND direction = 'in' AND patient_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_link_whatsapp_messages AFTER UPDATE OF patient_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.link_whatsapp_messages_on_conversion();
REVOKE ALL ON FUNCTION private.link_whatsapp_messages_on_conversion() FROM PUBLIC, anon, authenticated;
