-- Em uma exclusão em cascata, o paciente já não existe quando o vínculo é apagado.
-- Não se cria evento de saída para um cadastro que está sendo excluído.
CREATE OR REPLACE FUNCTION private.record_patient_professional_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.patients WHERE id = OLD.patient_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.patient_professional_events (patient_id, professional_id, kind, actor_user_id)
  VALUES (CASE WHEN TG_OP = 'INSERT' THEN NEW.patient_id ELSE OLD.patient_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.professional_id ELSE OLD.professional_id END,
    CASE WHEN TG_OP = 'INSERT' THEN 'entry' ELSE 'exit' END, auth.uid());
  RETURN CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
END $$;
