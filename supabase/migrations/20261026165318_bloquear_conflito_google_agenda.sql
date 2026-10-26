-- Compromissos pessoais sincronizados do Google ocupam o horário para novos agendamentos.
-- Alterações de situação de sessões já existentes continuam possíveis, mesmo se um evento pessoal
-- tiver sido criado no Google depois da sessão.
CREATE FUNCTION private.check_google_busy_conflict() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.occupies_slot(NEW.status) AND EXISTS (
    SELECT 1 FROM public.google_busy g
    WHERE g.professional_id = NEW.professional_id
      AND g.starts_at < NEW.ends_at AND g.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Compromisso no Google Agenda neste horário. Escolha outro horário.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_google_busy_conflict
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, professional_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.check_google_busy_conflict();
REVOKE ALL ON FUNCTION private.check_google_busy_conflict() FROM PUBLIC, anon, authenticated;
