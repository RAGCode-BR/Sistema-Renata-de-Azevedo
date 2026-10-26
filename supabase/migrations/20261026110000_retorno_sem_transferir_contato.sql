-- Agendar um retorno não transfere a responsabilidade pelo contato.
CREATE OR REPLACE FUNCTION public.schedule_lead_followup(p_id uuid, p_due_date date, p_due_time time, p_assignee_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead public.leads;
BEGIN
  PERFORM private.require_permission('crm.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'Informe a data do próximo contato.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.check_assignee(p_assignee_id);
  PERFORM private.check_lead_owner(p_assignee_id);
  UPDATE public.leads SET next_contact_at = p_due_date, updated_at = now() WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'followup', NULL, NULL, p_due_date::text);
  PERFORM private.notify_link(p_assignee_id, 'lead_assigned', 'Retornar contato: ' || lead.name,
    '#/comercial?lead=' || p_id);
  RETURN p_id;
END $$;
