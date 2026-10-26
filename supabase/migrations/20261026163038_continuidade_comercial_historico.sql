-- Acompanhamento de retornos comerciais sem o antigo módulo de tarefas internas.
ALTER TABLE public.leads
  ADD COLUMN next_contact_time time,
  ADD COLUMN next_contact_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_kind_check;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_kind_check
  CHECK (kind IN ('created', 'edited', 'assigned', 'stage', 'converted', 'call', 'message', 'email',
    'meeting', 'note', 'followup', 'followup_done', 'followup_cancelled', 'site'));

-- Dados antigos de retornos encerrados não devem aparecer como pendentes.
UPDATE public.leads l SET next_contact_at = NULL
WHERE next_contact_at IS NOT NULL AND (l.patient_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM public.lead_stages s WHERE s.id = l.stage_id AND s.kind <> 'open'
));

CREATE OR REPLACE FUNCTION public.schedule_lead_followup(p_id uuid, p_due_date date, p_due_time time, p_assignee_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead public.leads;
  target_kind text;
BEGIN
  PERFORM private.require_permission('crm.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id FOR UPDATE;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  SELECT kind INTO target_kind FROM public.lead_stages WHERE id = lead.stage_id;
  IF target_kind <> 'open' OR lead.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este contato comercial já foi encerrado.' USING ERRCODE = 'P0001'; END IF;
  IF p_due_date IS NULL OR p_due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Informe uma data de retorno válida.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.check_lead_owner(p_assignee_id);
  UPDATE public.leads SET next_contact_at = p_due_date, next_contact_time = p_due_time,
    next_contact_owner_id = p_assignee_id, updated_at = now() WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'followup', NULL,
    CASE WHEN lead.next_contact_at IS NOT NULL THEN lead.next_contact_at::text || coalesce(' ' || lead.next_contact_time::text, '') END,
    p_due_date::text || coalesce(' ' || p_due_time::text, ''));
  PERFORM private.notify_link(p_assignee_id, 'lead_assigned', 'Retornar contato: ' || lead.name, '#/comercial?lead=' || p_id);
  RETURN p_id;
END $$;

CREATE FUNCTION public.cancel_lead_followup(p_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead public.leads;
BEGIN
  PERFORM private.require_permission('crm.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id FOR UPDATE;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF lead.next_contact_at IS NULL THEN RETURN; END IF;
  UPDATE public.leads SET next_contact_at = NULL, next_contact_time = NULL,
    next_contact_owner_id = NULL, updated_at = now() WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'followup_cancelled', left(nullif(trim(p_reason), ''), 4000),
    lead.next_contact_at::text || coalesce(' ' || lead.next_contact_time::text, ''), NULL);
END $$;
REVOKE ALL ON FUNCTION public.cancel_lead_followup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_lead_followup(uuid, text) TO authenticated;

-- Um contato real conclui o retorno pendente; uma anotação simples não o conclui.
CREATE OR REPLACE FUNCTION public.add_lead_activity(p_id uuid, p_kind text, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead public.leads;
BEGIN
  PERFORM private.require_permission('crm.manage');
  IF p_kind NOT IN ('call', 'message', 'email', 'meeting', 'note') THEN
    RAISE EXCEPTION 'Tipo de contato inválido.' USING ERRCODE = 'P0001'; END IF;
  IF length(trim(coalesce(p_body, ''))) = 0 AND p_kind = 'note' THEN
    RAISE EXCEPTION 'Escreva a anotação.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO lead FROM public.leads WHERE id = p_id FOR UPDATE;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF p_kind <> 'note' AND lead.next_contact_at IS NOT NULL THEN
    UPDATE public.leads SET next_contact_at = NULL, next_contact_time = NULL,
      next_contact_owner_id = NULL WHERE id = p_id;
    PERFORM private.lead_log(p_id, 'followup_done', NULL,
      lead.next_contact_at::text || coalesce(' ' || lead.next_contact_time::text, ''), NULL);
  END IF;
  UPDATE public.leads SET last_activity_at = now(), updated_at = now(),
    first_contact_at = CASE WHEN p_kind <> 'note' THEN coalesce(first_contact_at, now()) ELSE first_contact_at END
  WHERE id = p_id;
  PERFORM private.lead_log(p_id, p_kind, nullif(trim(p_body), ''), NULL, NULL);
END $$;

-- Mudanças para Convertido/Perdido encerram automaticamente o retorno aberto.
CREATE FUNCTION private.close_terminal_lead_followup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.next_contact_at IS NOT NULL AND (NEW.patient_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.lead_stages s WHERE s.id = NEW.stage_id AND s.kind <> 'open'
  )) THEN
    UPDATE public.leads SET next_contact_at = NULL, next_contact_time = NULL,
      next_contact_owner_id = NULL WHERE id = NEW.id;
    PERFORM private.lead_log(NEW.id, 'followup_cancelled', 'Contato comercial encerrado.',
      NEW.next_contact_at::text || coalesce(' ' || NEW.next_contact_time::text, ''), NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER close_terminal_lead_followup AFTER UPDATE OF stage_id, patient_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION private.close_terminal_lead_followup();
REVOKE ALL ON FUNCTION private.close_terminal_lead_followup() FROM PUBLIC, anon, authenticated;
