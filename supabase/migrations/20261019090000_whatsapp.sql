-- Bloco 10.2: WhatsApp Business Platform (API oficial da Meta). Preparado; envia só quando as
-- credenciais estiverem cadastradas E alguém ativar os envios em Configurações.
--
-- - Paciente com autorização (whatsapp_opt_in) recebe pedido de confirmação (padrão 48 h antes, com
--   botões Confirmar / Preciso remarcar) e lembrete (padrão 2 h antes; on-line leva o link do Meet).
-- - "Confirmar" confirma a sessão; "Preciso remarcar" avisa a equipe e cria tarefa para o responsável padrão.
-- - Equipe com aviso ligado recebe "nova tarefa" com link (sem o conteúdo da tarefa).
-- - Mensagem recebida: de paciente vai para Conversas; de número desconhecido vira lead (WhatsApp direto).
-- - Resposta livre só dentro da janela de 24 h desde a última mensagem da pessoa (regra da Meta).
-- - Nada clínico vai pelo WhatsApp. Tudo fica em whatsapp_messages (envios, entregas, leituras, recebidas).

INSERT INTO public.role_permissions (role, permission) VALUES
  ('owner', 'messages.manage'), ('manager', 'messages.manage'), ('reception', 'messages.manage');

ALTER TABLE public.patients ADD COLUMN whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN whatsapp_opt_in_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN whatsapp_phone text, ADD COLUMN whatsapp_notify boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_settings
  ADD COLUMN whatsapp_confirm_hours integer NOT NULL DEFAULT 48 CHECK (whatsapp_confirm_hours BETWEEN 0 AND 168),
  ADD COLUMN whatsapp_reminder_hours integer NOT NULL DEFAULT 2 CHECK (whatsapp_reminder_hours BETWEEN 0 AND 48);
ALTER TABLE public.integration_state ADD COLUMN config jsonb NOT NULL DEFAULT '{}';
INSERT INTO public.integration_state (key) VALUES ('whatsapp');

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('task_assigned', 'task_done', 'task_comment', 'lead_new', 'lead_assigned', 'message_new'));

-- Número no formato do WhatsApp (só dígitos, com 55 para números brasileiros sem DDI).
CREATE FUNCTION private.whatsapp_number(phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN length(d) IN (10, 11) THEN '55' || d WHEN length(d) BETWEEN 12 AND 15 THEN d END
  FROM (SELECT regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS d) digits
$$;

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('out', 'in')),
  phone text NOT NULL CHECK (phone ~ '^[0-9]{12,15}$'),
  kind text NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'task', 'reply', 'free', 'inbound')),
  template text,
  params jsonb NOT NULL DEFAULT '[]',
  body text NOT NULL CHECK (length(body) <= 4096),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  wamid text UNIQUE,
  context_wamid text,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX whatsapp_messages_phone_idx ON public.whatsapp_messages (phone, created_at);
CREATE INDEX whatsapp_messages_queued_idx ON public.whatsapp_messages (created_at) WHERE status = 'queued';
-- Um pedido de confirmação e um lembrete por sessão.
CREATE UNIQUE INDEX whatsapp_messages_once ON public.whatsapp_messages (appointment_id, kind)
  WHERE kind IN ('confirmation', 'reminder') AND appointment_id IS NOT NULL;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_messages FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_messages TO authenticated;
CREATE POLICY "WhatsApp: equipe de atendimento lê" ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (private.has_permission('messages.manage'));

-- Textos (iguais aos modelos a cadastrar na Meta) ----------------------------------------------

CREATE FUNCTION private.when_label(moment timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (ARRAY['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'])[extract(isodow FROM local)::int]
    || ', ' || to_char(local, 'DD/MM') || ' às ' || to_char(local, 'HH24:MI')
  FROM (SELECT moment AT TIME ZONE 'America/Sao_Paulo' AS local) x
$$;

CREATE FUNCTION private.first_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT split_part(trim(coalesce(name, '')), ' ', 1) $$;

CREATE FUNCTION private.whatsapp_render(template text, params jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE template
    WHEN 'confirmacao_sessao' THEN format('Olá, %s! Sua sessão com %s está marcada para %s. Podemos confirmar?', params->>0, params->>1, params->>2)
    WHEN 'lembrete_sessao' THEN format('Olá, %s! Lembrete: sua sessão com %s é %s. Atendimento: %s.', params->>0, params->>1, params->>2, params->>3)
    WHEN 'aviso_tarefa' THEN format('Você tem uma nova tarefa no sistema da clínica Renata de Azevedo. Acesse: %s', params->>0)
  END
$$;

-- Agendamento dos envios (pg_cron, a cada 5 min) ------------------------------------------------

CREATE FUNCTION private.whatsapp_enqueue_due() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  settings public.clinic_settings;
  queued integer := 0;
  added integer;
  row record;
  params jsonb;
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.integration_state WHERE key = 'whatsapp'), false) THEN RETURN 0; END IF;
  SELECT * INTO settings FROM public.clinic_settings LIMIT 1;

  IF settings.whatsapp_confirm_hours > 0 THEN
    FOR row IN
      SELECT a.id, a.starts_at, p.id AS patient_id, p.name, p.phone, pr.name AS professional
      FROM public.appointments a JOIN public.patients p ON p.id = a.patient_id JOIN public.professionals pr ON pr.id = a.professional_id
      WHERE a.status = 'scheduled' AND a.starts_at > now() + interval '1 hour'
        AND a.starts_at <= now() + make_interval(hours => settings.whatsapp_confirm_hours)
        AND p.whatsapp_opt_in AND private.whatsapp_number(p.phone) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.appointment_id = a.id AND m.kind = 'confirmation')
    LOOP
      params := jsonb_build_array(private.first_name(row.name), row.professional, private.when_label(row.starts_at));
      INSERT INTO public.whatsapp_messages (direction, phone, kind, template, params, body, patient_id, appointment_id, status, created_by)
      VALUES ('out', private.whatsapp_number(row.phone), 'confirmation', 'confirmacao_sessao', params,
        private.whatsapp_render('confirmacao_sessao', params), row.patient_id, row.id, 'queued', NULL);
      UPDATE public.appointments SET status = 'awaiting_confirmation', updated_at = now() WHERE id = row.id AND status = 'scheduled';
      queued := queued + 1;
    END LOOP;
  END IF;

  IF settings.whatsapp_reminder_hours > 0 THEN
    FOR row IN
      SELECT a.id, a.starts_at, a.modality, a.meeting_url, p.id AS patient_id, p.name, p.phone, pr.name AS professional
      FROM public.appointments a JOIN public.patients p ON p.id = a.patient_id JOIN public.professionals pr ON pr.id = a.professional_id
      WHERE a.status IN ('scheduled', 'awaiting_confirmation', 'confirmed') AND a.starts_at > now()
        AND a.starts_at <= now() + make_interval(hours => settings.whatsapp_reminder_hours)
        AND p.whatsapp_opt_in AND private.whatsapp_number(p.phone) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.appointment_id = a.id AND m.kind = 'reminder')
    LOOP
      params := jsonb_build_array(private.first_name(row.name), row.professional, private.when_label(row.starts_at),
        CASE WHEN row.modality = 'online' THEN 'on-line' || coalesce(', link: ' || row.meeting_url, '') ELSE 'presencial' END);
      INSERT INTO public.whatsapp_messages (direction, phone, kind, template, params, body, patient_id, appointment_id, status, created_by)
      VALUES ('out', private.whatsapp_number(row.phone), 'reminder', 'lembrete_sessao', params,
        private.whatsapp_render('lembrete_sessao', params), row.patient_id, row.id, 'queued', NULL);
      queued := queued + 1;
    END LOOP;
  END IF;
  RETURN queued;
END $$;

-- Aviso de tarefa para quem ligou o aviso no WhatsApp.
CREATE FUNCTION private.whatsapp_task_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  person public.profiles;
  state public.integration_state;
  params jsonb;
BEGIN
  IF NEW.kind <> 'task_assigned' THEN RETURN NEW; END IF;
  SELECT * INTO state FROM public.integration_state WHERE key = 'whatsapp';
  SELECT * INTO person FROM public.profiles WHERE id = NEW.user_id;
  IF NOT coalesce(state.enabled, false) OR NOT person.whatsapp_notify OR private.whatsapp_number(person.whatsapp_phone) IS NULL THEN RETURN NEW; END IF;
  params := jsonb_build_array(coalesce(nullif(state.config->>'app_url', ''), 'o sistema da clínica') || coalesce(NEW.link, ''));
  INSERT INTO public.whatsapp_messages (direction, phone, kind, template, params, body, profile_id, status, created_by)
  VALUES ('out', private.whatsapp_number(person.whatsapp_phone), 'task', 'aviso_tarefa', params,
    private.whatsapp_render('aviso_tarefa', params), person.id, 'queued', NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_whatsapp AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.whatsapp_task_notice();

CREATE FUNCTION private.run_whatsapp() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target text;
  secret text;
BEGIN
  PERFORM private.whatsapp_enqueue_due();
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE status = 'queued' AND attempts < 5) THEN RETURN; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_send_url'$q$ INTO target;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_send_secret'$q$ INTO secret;
  IF target IS NULL OR secret IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3::jsonb)'
    USING target, jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret), '{}';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('whatsapp', '*/5 * * * *', 'SELECT private.run_whatsapp()');
  END IF;
END $$;

-- Recebimento (só a Edge Function whatsapp-webhook, com a chave de serviço) ---------------------

CREATE FUNCTION public.whatsapp_status(p_wamid text, p_status text, p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.whatsapp_messages SET status = p_status, error = coalesce(left(p_error, 500), error)
  WHERE wamid = p_wamid AND direction = 'out' AND p_status IN ('sent', 'delivered', 'read', 'failed')
    -- Não volta de "lida" para "entregue" se os avisos chegarem fora de ordem.
    AND array_position(ARRAY['queued', 'sent', 'delivered', 'read'], status) <= coalesce(array_position(ARRAY['queued', 'sent', 'delivered', 'read'], p_status), 99)
$$;

-- Mensagem recebida. p_button: resposta de botão ('CONFIRMAR' ou 'REMARCAR'), quando houver.
CREATE FUNCTION public.whatsapp_inbound(p_phone text, p_name text, p_wamid text, p_text text, p_button text, p_context_wamid text)
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
      INSERT INTO public.whatsapp_messages (direction, phone, kind, body, patient_id, appointment_id, status, created_by)
      VALUES ('out', v_phone, 'reply', answer, appointment.patient_id, appointment.id, 'queued', NULL);
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

-- Interface ------------------------------------------------------------------------------------

-- Conversas: um item por número, com o nome do paciente, lead ou pessoa da equipe.
CREATE FUNCTION public.whatsapp_conversations()
RETURNS TABLE (phone text, name text, kind text, ref_id uuid, last_body text, last_at timestamptz, last_direction text,
  last_inbound_at timestamptz, unanswered boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('messages.manage');
  RETURN QUERY
  WITH last AS (
    SELECT DISTINCT ON (m.phone) m.phone, m.body, m.created_at, m.direction FROM public.whatsapp_messages m
    ORDER BY m.phone, m.created_at DESC
  )
  SELECT l.phone,
    coalesce(pa.name, ld.name, pf.name, '+' || l.phone),
    CASE WHEN pa.id IS NOT NULL THEN 'patient' WHEN ld.id IS NOT NULL THEN 'lead' WHEN pf.id IS NOT NULL THEN 'staff' ELSE 'unknown' END,
    coalesce(pa.id, ld.id, pf.id), l.body, l.created_at, l.direction,
    (SELECT max(m.created_at) FROM public.whatsapp_messages m WHERE m.phone = l.phone AND m.direction = 'in'),
    l.direction = 'in'
  FROM last l
  LEFT JOIN LATERAL (SELECT p.id, p.name FROM public.patients p WHERE private.phone_key(p.phone) = private.phone_key(l.phone) LIMIT 1) pa ON true
  LEFT JOIN LATERAL (SELECT x.id, x.name FROM public.leads x WHERE x.phone_key = private.phone_key(l.phone) AND pa.id IS NULL
    ORDER BY x.created_at DESC LIMIT 1) ld ON true
  LEFT JOIN LATERAL (SELECT f.id, f.name FROM public.profiles f WHERE private.phone_key(f.whatsapp_phone) = private.phone_key(l.phone) LIMIT 1) pf ON true
  ORDER BY l.created_at DESC;
END $$;

-- Resposta livre: só dentro de 24 h da última mensagem recebida desse número.
CREATE FUNCTION public.queue_whatsapp_reply(p_phone text, p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := private.whatsapp_number(p_phone);
  created uuid;
BEGIN
  PERFORM private.require_permission('messages.manage');
  IF length(trim(coalesce(p_text, ''))) = 0 THEN RAISE EXCEPTION 'Escreva a mensagem.' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.phone = v_phone AND m.direction = 'in' AND m.created_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'Fora da janela de 24 horas: o WhatsApp só permite mensagens livres até 24 h depois da última mensagem da pessoa.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.whatsapp_messages (direction, phone, kind, body, patient_id, lead_id, status)
  SELECT 'out', v_phone, 'free', left(trim(p_text), 4096), m.patient_id, m.lead_id, 'queued'
  FROM public.whatsapp_messages m WHERE m.phone = v_phone AND m.direction = 'in' ORDER BY m.created_at DESC LIMIT 1
  RETURNING id INTO created;
  RETURN created;
END $$;

-- Autorização do paciente (LGPD): só com telefone.
CREATE FUNCTION public.set_patient_whatsapp(p_patient_id uuid, p_opt_in boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('patients.manage');
  IF p_opt_in AND private.whatsapp_number((SELECT phone FROM public.patients WHERE id = p_patient_id)) IS NULL THEN
    RAISE EXCEPTION 'Para autorizar o WhatsApp, cadastre um celular com DDD.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.patients SET whatsapp_opt_in = p_opt_in,
    whatsapp_opt_in_at = CASE WHEN p_opt_in AND NOT whatsapp_opt_in THEN now() WHEN NOT p_opt_in THEN NULL ELSE whatsapp_opt_in_at END
  WHERE id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
END $$;

-- Aviso de tarefas no WhatsApp da própria pessoa.
CREATE FUNCTION public.set_my_whatsapp(p_phone text, p_notify boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  IF p_notify AND private.whatsapp_number(p_phone) IS NULL THEN
    RAISE EXCEPTION 'Informe um celular com DDD.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.profiles SET whatsapp_phone = nullif(trim(p_phone), ''), whatsapp_notify = p_notify WHERE id = auth.uid();
END $$;

CREATE FUNCTION public.my_whatsapp() RETURNS TABLE (phone text, notify boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT whatsapp_phone, whatsapp_notify FROM public.profiles WHERE id = auth.uid()
$$;

-- Ativar envios e endereço do sistema (para os links): quem gerencia configurações.
CREATE FUNCTION public.set_whatsapp_settings(p_enabled boolean, p_app_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  IF nullif(trim(p_app_url), '') IS NOT NULL AND trim(p_app_url) !~ '^https?://' THEN
    RAISE EXCEPTION 'O endereço do sistema deve começar com https://' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.integration_state SET enabled = p_enabled,
    config = jsonb_build_object('app_url', rtrim(coalesce(trim(p_app_url), ''), '/')), updated_at = now()
  WHERE key = 'whatsapp';
  INSERT INTO public.audit_log (actor_user_id, action, entity_type) VALUES (auth.uid(), CASE WHEN p_enabled THEN 'enable' ELSE 'disable' END, 'whatsapp');
END $$;

CREATE FUNCTION public.whatsapp_state()
RETURNS TABLE (enabled boolean, app_url text, last_run_at timestamptz, last_error text, queued bigint, failed_today bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (private.has_permission('settings.manage') OR private.has_permission('messages.manage')) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.enabled, s.config->>'app_url', s.last_run_at, s.last_error,
    (SELECT count(*) FROM public.whatsapp_messages m WHERE m.status = 'queued'),
    (SELECT count(*) FROM public.whatsapp_messages m WHERE m.status = 'failed' AND m.created_at > now() - interval '1 day')
  FROM public.integration_state s WHERE s.key = 'whatsapp';
END $$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.whatsapp_number(text), private.when_label(timestamptz), private.first_name(text),
  private.whatsapp_render(text, jsonb), private.whatsapp_enqueue_due(), private.whatsapp_task_notice(), private.run_whatsapp()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_status(text, text, text), public.whatsapp_inbound(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_status(text, text, text), public.whatsapp_inbound(text, text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_conversations(), public.queue_whatsapp_reply(text, text), public.set_patient_whatsapp(uuid, boolean),
  public.set_my_whatsapp(text, boolean), public.my_whatsapp(), public.set_whatsapp_settings(boolean, text), public.whatsapp_state()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversations(), public.queue_whatsapp_reply(text, text), public.set_patient_whatsapp(uuid, boolean),
  public.set_my_whatsapp(text, boolean), public.my_whatsapp(), public.set_whatsapp_settings(boolean, text), public.whatsapp_state()
  TO authenticated;
