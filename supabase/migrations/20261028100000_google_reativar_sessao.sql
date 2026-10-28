-- Reativar uma sessão cancelada (a situação volta a ocupar o horário) também confere o Google Agenda.
-- Mudanças entre situações que já ocupam o horário (agendada → confirmada → realizada) continuam livres,
-- mesmo se um evento pessoal tiver sido criado no Google depois da sessão.
CREATE OR REPLACE FUNCTION private.check_google_busy_conflict() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.occupies_slot(NEW.status) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND private.occupies_slot(OLD.status) AND NEW.starts_at = OLD.starts_at
    AND NEW.ends_at = OLD.ends_at AND NEW.professional_id = OLD.professional_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.google_busy g
    WHERE g.professional_id = NEW.professional_id
      AND g.starts_at < NEW.ends_at AND g.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Compromisso no Google Agenda neste horário. Escolha outro horário.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER appointments_google_busy_conflict ON public.appointments;
CREATE TRIGGER appointments_google_busy_conflict
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, professional_id, status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.check_google_busy_conflict();
