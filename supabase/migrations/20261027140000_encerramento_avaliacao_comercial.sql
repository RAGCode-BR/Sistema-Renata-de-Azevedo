-- Resultado da avaliação encerra a etapa "Primeira consulta agendada".
CREATE OR REPLACE FUNCTION public.set_lead_assessment_status(p_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  assessment public.lead_assessments;
  old_stage public.lead_stages;
  active_stage uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  PERFORM private.require_permission('appointments.manage');
  SELECT * INTO assessment FROM public.lead_assessments WHERE id = p_id FOR UPDATE;
  IF assessment.id IS NULL OR assessment.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Avaliação não encontrada ou já encerrada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('attended', 'missed', 'cancelled') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status <> 'cancelled' AND assessment.ends_at > now() THEN
    RAISE EXCEPTION 'Registre o resultado após o término da avaliação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.lead_assessments SET status = p_status, updated_at = now() WHERE id = p_id;
  IF p_status = 'cancelled' AND assessment.block_id IS NOT NULL THEN
    DELETE FROM public.schedule_blocks WHERE id = assessment.block_id;
  END IF;
  PERFORM private.lead_log(assessment.lead_id,
    CASE p_status WHEN 'attended' THEN 'assessment_attended' WHEN 'missed' THEN 'assessment_missed'
      ELSE 'assessment_cancelled' END, NULL, NULL, NULL);
  SELECT s.* INTO old_stage FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE l.id = assessment.lead_id FOR UPDATE OF l;
  SELECT id INTO active_stage FROM public.lead_stages WHERE kind = 'open' AND active
    AND name = 'Em atendimento' LIMIT 1;
  IF old_stage.name = 'Primeira consulta agendada' AND active_stage IS NOT NULL THEN
    UPDATE public.leads SET stage_id = active_stage, last_activity_at = now(), updated_at = now()
      WHERE id = assessment.lead_id;
    PERFORM private.lead_log(assessment.lead_id, 'stage', NULL, old_stage.name, 'Em atendimento');
  ELSE
    UPDATE public.leads SET last_activity_at = now(), updated_at = now() WHERE id = assessment.lead_id;
  END IF;
END $$;

CREATE FUNCTION private.assessment_requires_open_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'scheduled' AND NOT EXISTS (
    SELECT 1 FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE l.id = NEW.lead_id AND l.patient_id IS NULL AND s.kind = 'open') THEN
    RAISE EXCEPTION 'Somente leads em andamento podem ter avaliação agendada.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_assessment_open_stage BEFORE INSERT OR UPDATE OF status ON public.lead_assessments
  FOR EACH ROW EXECUTE FUNCTION private.assessment_requires_open_lead();
REVOKE ALL ON FUNCTION private.assessment_requires_open_lead() FROM PUBLIC, anon, authenticated;
