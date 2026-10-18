-- A resposta automática nasce na mesma transação da mensagem recebida (mesmo now()); com o relógio
-- real ela fica depois, e a conversa não aparece como "aguardando resposta".
CREATE OR REPLACE FUNCTION public.whatsapp_inbound(p_phone text, p_name text, p_wamid text, p_text text, p_button text, p_context_wamid text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := private.whatsapp_number(p_phone);
  patient public.patients;
  lead uuid;
  original public.whatsapp_messages;
  appointment public.appointments;
  owner uuid := (SELECT default_owner_id FROM public.crm_settings LIMIT 1);
  message uuid;
  outcome text := 'stored';
  answer text;
  task uuid;
BEGIN
  IF v_phone IS NULL THEN RETURN 'invalid'; END IF;
  INSERT INTO public.whatsapp_messages (direction, phone, kind, body, wamid, context_wamid, status, created_by)
  VALUES ('in', v_phone, 'inbound', left(coalesce(nullif(p_text, ''), p_button, '[mensagem sem texto]'), 4096), p_wamid, p_context_wamid, 'received', NULL)
  ON CONFLICT (wamid) DO NOTHING
  RETURNING id INTO message;
  IF message IS NULL THEN RETURN 'duplicate'; END IF;

  SELECT * INTO patient FROM public.patients p WHERE private.phone_key(p.phone) = private.phone_key(v_phone)
  ORDER BY p.whatsapp_opt_in DESC, p.created_at LIMIT 1;

  -- Resposta aos botões do pedido de confirmação.
  IF p_context_wamid IS NOT NULL THEN
    SELECT * INTO original FROM public.whatsapp_messages WHERE wamid = p_context_wamid AND kind = 'confirmation';
  END IF;
  IF original.id IS NOT NULL AND upper(coalesce(p_button, '')) IN ('CONFIRMAR', 'REMARCAR') THEN
    SELECT * INTO appointment FROM public.appointments WHERE id = original.appointment_id;
    IF upper(p_button) = 'CONFIRMAR' AND appointment.status IN ('scheduled', 'awaiting_confirmation') AND appointment.starts_at > now() THEN
      UPDATE public.appointments SET status = 'confirmed', updated_at = now() WHERE id = appointment.id;
      answer := 'Obrigado! Sua sessão está confirmada. Até lá!';
      outcome := 'confirmed';
    ELSIF upper(p_button) = 'REMARCAR' AND appointment.id IS NOT NULL THEN
      answer := 'Combinado! Nossa equipe vai falar com você para remarcar.';
      outcome := 'reschedule';
      IF owner IS NOT NULL THEN
        INSERT INTO public.tasks (title, description, assignee_id, priority, due_date, created_by)
        VALUES ('Remarcar sessão de ' || private.first_name((SELECT name FROM public.patients WHERE id = appointment.patient_id)),
          'Pedido pelo WhatsApp para a sessão de ' || private.when_label(appointment.starts_at) || '.', owner, 'high', private.local_today(), NULL)
        RETURNING id INTO task;
        INSERT INTO public.task_events (task_id, actor_id, kind, body) VALUES (task, NULL, 'created', 'Pedido de remarcação pelo WhatsApp');
        PERFORM private.notify(owner, 'task_assigned', 'Nova tarefa: remarcar sessão (WhatsApp)', task);
      END IF;
    END IF;
    UPDATE public.whatsapp_messages SET patient_id = appointment.patient_id, appointment_id = appointment.id WHERE id = message;
    IF answer IS NOT NULL THEN
      INSERT INTO public.whatsapp_messages (direction, phone, kind, body, patient_id, appointment_id, status, created_by, created_at)
      VALUES ('out', v_phone, 'reply', answer, appointment.patient_id, appointment.id, 'queued', NULL, clock_timestamp());
    END IF;
  ELSIF patient.id IS NOT NULL THEN
    UPDATE public.whatsapp_messages SET patient_id = patient.id WHERE id = message;
  ELSE
    -- Número desconhecido: lead (WhatsApp direto) ou novo contato num lead em aberto.
    SELECT l.id INTO lead FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE s.kind = 'open' AND l.anonymized_at IS NULL AND l.phone_key = private.phone_key(v_phone) ORDER BY l.created_at DESC LIMIT 1;
    IF lead IS NULL THEN
      INSERT INTO public.leads (name, phone, source_id, stage_id, owner_id, created_by)
      VALUES (left(coalesce(nullif(trim(p_name), ''), '+' || v_phone), 200), '+' || v_phone,
        (SELECT id FROM public.lead_sources WHERE name = 'WhatsApp direto'), private.first_open_stage(), owner, NULL)
      RETURNING id INTO lead;
      INSERT INTO public.lead_activities (lead_id, kind, body) VALUES (lead, 'created', 'Primeira mensagem pelo WhatsApp');
      outcome := 'lead';
    END IF;
    INSERT INTO public.lead_activities (lead_id, kind, body) VALUES (lead, 'message', left(coalesce(nullif(p_text, ''), p_button), 4000));
    UPDATE public.leads SET last_activity_at = now() WHERE id = lead;
    UPDATE public.whatsapp_messages SET lead_id = lead WHERE id = message;
  END IF;

  -- Avisa a equipe de atendimento (uma vez por conversa a cada hora, para não lotar o sino).
  IF outcome IN ('stored', 'lead', 'reschedule') AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_messages m WHERE m.phone = v_phone AND m.direction = 'in' AND m.id <> message
      AND m.created_at > now() - interval '1 hour') THEN
    INSERT INTO public.notifications (user_id, kind, title, link)
    SELECT DISTINCT p.id, 'message_new', 'Nova mensagem no WhatsApp: ' || coalesce(patient.name, nullif(trim(p_name), ''), '+' || v_phone),
      '#/conversas?telefone=' || v_phone
    FROM public.profiles p WHERE private.user_can(p.id, 'messages.manage');
  END IF;
  RETURN outcome;
END $$;
