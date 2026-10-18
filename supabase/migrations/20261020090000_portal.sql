-- Bloco 13: portal do paciente.
--
-- - Acesso só por convite da clínica (Edge Function portal-invite). A conta tem só o perfil Paciente,
--   que não passa em nenhuma checagem da equipe (is_staff, has_permission, cares_for).
-- - O vínculo conta ↔ paciente fica em portal_access: o próprio paciente ou o responsável. Uma conta
--   pode acompanhar mais de um paciente (ex.: dois filhos). Revogar tira o acesso na hora.
-- - O paciente não lê nenhuma tabela diretamente: tudo passa pelas funções portal_*, que confirmam o
--   vínculo da conta conectada com o paciente pedido, o portal ligado e o aceite dos termos.
-- - Documentos compartilhados ficam num bucket próprio (portal-documents), separado do prontuário e
--   dos documentos administrativos. O download passa pela Edge Function portal-document-url, que
--   registra cada abertura.
-- - Pedidos do paciente (remarcar, cancelar, "já paguei") viram tarefa para a equipe; nada muda na
--   agenda ou no financeiro sem alguém da clínica.
-- - Avisos por e-mail: texto genérico, sem nome de profissional, horário ou valor. Desligados até a
--   configuração do envio (integration_state 'portal_email').

ALTER TABLE public.clinic_settings
  ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN portal_url text CHECK (portal_url IS NULL OR portal_url ~ '^https?://[^\s]+$'),
  ADD COLUMN portal_payment_instructions text CHECK (length(portal_payment_instructions) <= 2000),
  ADD COLUMN portal_assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

INSERT INTO public.integration_state (key) VALUES ('portal_email');

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('task_assigned', 'task_done', 'task_comment', 'lead_new', 'lead_assigned', 'message_new', 'portal'));

-- Tabelas ----------------------------------------------------------------------------------------

CREATE TABLE public.portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('self', 'guardian')),
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX portal_access_one_active ON public.portal_access (patient_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX portal_access_user_idx ON public.portal_access (user_id) WHERE revoked_at IS NULL;

CREATE TABLE public.portal_terms (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

CREATE TABLE public.portal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint,
  mime_type text,
  shared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK (storage_path LIKE 'patients/' || patient_id || '/%')
);
CREATE INDEX portal_documents_patient_idx ON public.portal_documents (patient_id, created_at);

CREATE TABLE public.portal_document_downloads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.portal_documents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_document_downloads_doc_idx ON public.portal_document_downloads (document_id);

CREATE TABLE public.portal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('reschedule', 'cancel', 'paid')),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  charge_id uuid REFERENCES public.charges(id) ON DELETE SET NULL,
  message text CHECK (length(message) <= 1000),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_requests_patient_idx ON public.portal_requests (patient_id, created_at);

CREATE TABLE public.portal_email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite', 'notice')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX portal_email_outbox_queued_idx ON public.portal_email_outbox (created_at) WHERE status = 'queued';

ALTER TABLE public.portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_document_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_access, public.portal_terms, public.portal_documents, public.portal_document_downloads,
  public.portal_requests, public.portal_email_outbox FROM anon, authenticated;

-- Arquivos: só a equipe que pode compartilhar envia e apaga; ninguém lê direto (links assinados pela
-- Edge Function portal-document-url).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-documents', 'portal-documents', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

-- Quem compartilha documentos com o paciente: quem gerencia pacientes ou a profissional responsável.
CREATE FUNCTION private.can_share_portal(patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT patient IS NOT NULL AND coalesce(private.has_permission('patients.manage') OR private.cares_for(patient), false)
$$;

CREATE POLICY "portal: a equipe envia documentos do paciente" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'portal-documents' AND private.can_share_portal(private.patient_of_path(name)));
CREATE POLICY "portal: a equipe apaga documentos do paciente" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'portal-documents' AND private.can_share_portal(private.patient_of_path(name)));

-- Quem está no portal ----------------------------------------------------------------------------

CREATE FUNCTION private.portal_terms_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '2026-10-20' $$;

-- Conta de paciente ativa (perfil Paciente e conta não desativada).
CREATE FUNCTION private.is_portal_user(person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = person AND p.active AND r.role = 'patient'
  )
$$;

-- Pacientes que a conta conectada acompanha (vínculos não revogados).
CREATE FUNCTION private.portal_patients() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.patient_id FROM public.portal_access a
  WHERE a.user_id = auth.uid() AND a.revoked_at IS NULL AND private.is_portal_user(auth.uid())
$$;

-- Porta de entrada de toda função do portal: portal ligado, vínculo com o paciente e termos aceitos.
CREATE FUNCTION private.portal_patient(wanted uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF wanted IS NULL OR NOT EXISTS (SELECT 1 FROM private.portal_patients() p WHERE p = wanted) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce((SELECT portal_enabled FROM public.clinic_settings LIMIT 1), false) THEN
    RAISE EXCEPTION 'O portal está temporariamente indisponível.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_terms WHERE user_id = auth.uid() AND version = private.portal_terms_version()) THEN
    RAISE EXCEPTION 'Aceite os termos de uso para continuar.' USING ERRCODE = '42501';
  END IF;
  RETURN wanted;
END $$;

-- Avisos ao paciente (sino do portal) e e-mail genérico ------------------------------------------

CREATE FUNCTION private.portal_notify(patient uuid, label text, target text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT a.user_id, 'portal', left(label, 200), target
  FROM public.portal_access a
  WHERE a.patient_id = patient AND a.revoked_at IS NULL AND private.is_portal_user(a.user_id)
    AND coalesce((SELECT portal_enabled FROM public.clinic_settings LIMIT 1), false)
$$;

-- Um e-mail por hora por pessoa, no máximo; o texto é sempre "há uma novidade no portal".
CREATE FUNCTION private.portal_email_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind <> 'portal' OR NOT coalesce((SELECT enabled FROM public.integration_state WHERE key = 'portal_email'), false) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_email_outbox o WHERE o.user_id = NEW.user_id AND o.kind = 'notice'
      AND o.created_at > now() - interval '1 hour') THEN
    INSERT INTO public.portal_email_outbox (user_id, kind) VALUES (NEW.user_id, 'notice');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_portal_email AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.portal_email_enqueue();

-- Sessões marcadas, remarcadas e canceladas. Por comando (não por linha): uma série semanal criada de
-- uma vez vira um aviso só.
CREATE FUNCTION private.portal_appointments_inserted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  row record;
BEGIN
  FOR row IN
    SELECT n.patient_id, count(*) AS total, min(n.starts_at) AS first_at, bool_or(n.rescheduled_from IS NOT NULL) AS moved
    FROM new_rows n WHERE n.starts_at > now() GROUP BY n.patient_id
  LOOP
    PERFORM private.portal_notify(row.patient_id,
      CASE WHEN row.total > 1 THEN row.total || ' sessões marcadas, a partir de ' || private.when_label(row.first_at)
        WHEN row.moved THEN 'Sessão remarcada para ' || private.when_label(row.first_at)
        ELSE 'Nova sessão marcada: ' || private.when_label(row.first_at) END,
      '#/portal/consultas');
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER appointments_portal_inserted AFTER INSERT ON public.appointments
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.portal_appointments_inserted();

CREATE FUNCTION private.portal_appointments_updated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  row record;
BEGIN
  FOR row IN
    SELECT n.patient_id, n.starts_at, n.status AS new_status, o.starts_at AS old_starts_at, o.status AS old_status
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.starts_at > now() AND (n.starts_at <> o.starts_at OR n.status IS DISTINCT FROM o.status)
  LOOP
    IF row.new_status IN ('cancelled_by_clinic', 'cancelled_by_patient') AND row.old_status NOT IN ('cancelled_by_clinic', 'cancelled_by_patient') THEN
      PERFORM private.portal_notify(row.patient_id, 'Sessão de ' || private.when_label(row.starts_at) || ' cancelada', '#/portal/consultas');
    ELSIF row.new_status NOT IN ('cancelled_by_clinic', 'cancelled_by_patient', 'rescheduled') AND row.starts_at <> row.old_starts_at THEN
      PERFORM private.portal_notify(row.patient_id, 'Sessão remarcada para ' || private.when_label(row.starts_at), '#/portal/consultas');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER appointments_portal_updated AFTER UPDATE ON public.appointments
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.portal_appointments_updated();

CREATE FUNCTION private.portal_charge_inserted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cancelled_at IS NULL THEN
    PERFORM private.portal_notify(NEW.patient_id, 'Nova cobrança: ' || NEW.description, '#/portal/financeiro');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER charges_portal_inserted AFTER INSERT ON public.charges
  FOR EACH ROW EXECUTE FUNCTION private.portal_charge_inserted();

-- Tarefa para a equipe a partir de um pedido do paciente. Vai para a pessoa definida em Configurações;
-- sem ninguém definido, fica sem responsável e avisa quem tem a permissão indicada.
CREATE FUNCTION private.portal_task(patient uuid, label text, details text, permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  assignee uuid := (SELECT s.portal_assignee_id FROM public.clinic_settings s LIMIT 1);
  task uuid;
BEGIN
  IF assignee IS NOT NULL AND NOT private.is_active_staff(assignee) THEN assignee := NULL; END IF;
  INSERT INTO public.tasks (title, description, assignee_id, priority, due_date, patient_id, created_by)
  VALUES (left(label, 200), left(details, 4000), assignee, 'high', private.local_today(), patient, NULL)
  RETURNING id INTO task;
  INSERT INTO public.task_events (task_id, actor_id, kind, body) VALUES (task, NULL, 'created', 'Pedido pelo portal do paciente');
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT p.id, 'task_assigned', 'Nova tarefa: ' || left(label, 180), '#/tarefas?tarefa=' || task
  FROM public.profiles p
  WHERE CASE WHEN assignee IS NOT NULL THEN p.id = assignee ELSE private.user_can(p.id, permission) END;
  RETURN task;
END $$;

-- Funções do paciente ------------------------------------------------------------------------------

-- Quem está conectado e o que pode ver. Não exige o aceite dos termos (é daqui que eles são mostrados).
CREATE FUNCTION public.portal_me() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'portal_user', private.is_portal_user(auth.uid()),
    'enabled', coalesce(s.portal_enabled, false),
    'name', pr.name,
    'email', pr.email,
    'terms_version', private.portal_terms_version(),
    'terms_accepted', EXISTS (SELECT 1 FROM public.portal_terms t WHERE t.user_id = auth.uid() AND t.version = private.portal_terms_version()),
    'payment_instructions', CASE WHEN s.portal_enabled THEN s.portal_payment_instructions END,
    'patients', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(trim(p.social_name), ''), p.name),
        'relationship', a.relationship) ORDER BY p.name)
      FROM public.portal_access a JOIN public.patients p ON p.id = a.patient_id
      WHERE a.user_id = auth.uid() AND a.revoked_at IS NULL AND private.is_portal_user(auth.uid())
    ), '[]'::jsonb)
  )
  FROM (SELECT 1) one
  LEFT JOIN public.profiles pr ON pr.id = auth.uid()
  LEFT JOIN public.clinic_settings s ON true
$$;

CREATE FUNCTION public.portal_accept_terms(p_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_portal_user(auth.uid()) OR NOT EXISTS (SELECT 1 FROM private.portal_patients()) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS DISTINCT FROM private.portal_terms_version() THEN
    RAISE EXCEPTION 'Os termos foram atualizados. Recarregue a página.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.portal_terms (user_id, version) VALUES (auth.uid(), p_version) ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'accept_terms', 'portal', auth.uid());
END $$;

-- Sessões do último ano em diante. O link do Meet só aparece de 1 h antes até o fim da sessão.
CREATE FUNCTION public.portal_appointments(p_patient_id uuid)
RETURNS TABLE (id uuid, starts_at timestamptz, ends_at timestamptz, status text, modality text, professional_name text,
  meeting_url text, can_confirm boolean, can_request boolean, requested boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT a.id, a.starts_at, a.ends_at, a.status, a.modality, pr.name,
    CASE WHEN a.modality = 'online' AND a.status IN ('scheduled', 'awaiting_confirmation', 'confirmed')
      AND now() BETWEEN a.starts_at - interval '1 hour' AND a.ends_at THEN a.meeting_url END,
    a.status IN ('scheduled', 'awaiting_confirmation') AND a.starts_at > now(),
    a.status IN ('scheduled', 'awaiting_confirmation', 'confirmed') AND a.starts_at > now() AND r.id IS NULL,
    r.id IS NOT NULL
  FROM public.appointments a
  JOIN public.professionals pr ON pr.id = a.professional_id
  LEFT JOIN LATERAL (SELECT q.id FROM public.portal_requests q WHERE q.appointment_id = a.id LIMIT 1) r ON true
  WHERE a.patient_id = p_patient_id AND a.status <> 'rescheduled' AND a.starts_at > now() - interval '1 year'
  ORDER BY a.starts_at;
END $$;

CREATE FUNCTION public.portal_confirm(p_appointment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  appointment public.appointments;
BEGIN
  SELECT * INTO appointment FROM public.appointments WHERE id = p_appointment_id;
  PERFORM private.portal_patient(appointment.patient_id);
  IF appointment.status NOT IN ('scheduled', 'awaiting_confirmation') OR appointment.starts_at <= now() THEN
    RAISE EXCEPTION 'Esta sessão não pode mais ser confirmada.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.appointments SET status = 'confirmed', updated_at = now() WHERE id = appointment.id;
  INSERT INTO public.appointment_events (appointment_id, action, from_status, to_status, reason, actor_user_id)
  VALUES (appointment.id, 'status_changed', appointment.status, 'confirmed', 'Confirmada pelo portal do paciente', auth.uid());
END $$;

-- Remarcar ou cancelar: não muda a agenda; cria tarefa para a equipe falar com o paciente.
CREATE FUNCTION public.portal_request_change(p_appointment_id uuid, p_kind text, p_message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  appointment public.appointments;
  patient public.patients;
  task uuid;
  message text := nullif(trim(coalesce(p_message, '')), '');
BEGIN
  SELECT * INTO appointment FROM public.appointments WHERE id = p_appointment_id;
  PERFORM private.portal_patient(appointment.patient_id);
  IF p_kind NOT IN ('reschedule', 'cancel') THEN RAISE EXCEPTION 'Pedido inválido.' USING ERRCODE = 'P0001'; END IF;
  IF length(message) > 1000 THEN RAISE EXCEPTION 'A mensagem pode ter até 1000 caracteres.' USING ERRCODE = 'P0001'; END IF;
  IF appointment.status NOT IN ('scheduled', 'awaiting_confirmation', 'confirmed') OR appointment.starts_at <= now() THEN
    RAISE EXCEPTION 'Esta sessão não pode mais ser alterada pelo portal. Fale com a clínica.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portal_requests WHERE appointment_id = appointment.id) THEN
    RAISE EXCEPTION 'Já existe um pedido para esta sessão. A clínica vai entrar em contato.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO patient FROM public.patients WHERE id = appointment.patient_id;
  task := private.portal_task(patient.id,
    CASE p_kind WHEN 'reschedule' THEN 'Remarcar sessão de ' ELSE 'Cancelar sessão de ' END || private.first_name(patient.name) || ' (portal)',
    'Pedido pelo portal do paciente para a sessão de ' || private.when_label(appointment.starts_at) || '.'
      || coalesce(E'\nMensagem: ' || message, ''),
    'appointments.manage');
  INSERT INTO public.portal_requests (patient_id, user_id, kind, appointment_id, message, task_id)
  VALUES (patient.id, auth.uid(), p_kind, appointment.id, message, task);
END $$;

CREATE FUNCTION public.portal_charges(p_patient_id uuid)
RETURNS TABLE (id uuid, description text, competence_date date, due_date date, amount numeric, discount numeric,
  paid numeric, balance numeric, status text, paid_notice_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT c.id, c.description, c.competence_date, c.due_date,
    CASE WHEN c.price_pending THEN NULL ELSE c.amount END, c.discount, pv.value,
    CASE WHEN c.price_pending THEN NULL ELSE greatest(c.amount - c.discount - pv.value, 0) END,
    CASE WHEN c.price_pending THEN 'unpriced'
      WHEN c.amount - c.discount - pv.value <= 0 THEN 'paid'
      WHEN c.due_date < private.local_today() THEN 'overdue'
      WHEN pv.value > 0 THEN 'partial'
      ELSE 'pending' END,
    (SELECT max(q.created_at) FROM public.portal_requests q WHERE q.charge_id = c.id AND q.kind = 'paid')
  FROM public.charges c
  CROSS JOIN LATERAL (SELECT private.charge_paid(c.id) AS value) pv
  WHERE c.patient_id = p_patient_id AND c.cancelled_at IS NULL
  ORDER BY c.due_date DESC, c.created_at DESC;
END $$;

-- Pagamentos recebidos (sem observações internas; estornados não aparecem).
CREATE FUNCTION public.portal_payments(p_patient_id uuid)
RETURNS TABLE (id uuid, received_at date, amount numeric, method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT p.id, p.received_at, p.amount, p.method FROM public.payments p
  WHERE p.patient_id = p_patient_id AND p.reversed_at IS NULL
  ORDER BY p.received_at DESC, p.created_at DESC;
END $$;

-- "Já paguei": avisa o financeiro, que confere e registra o pagamento. Uma vez por dia por cobrança.
CREATE FUNCTION public.portal_notify_paid(p_charge_id uuid, p_message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  charge public.charges;
  patient public.patients;
  task uuid;
  message text := nullif(trim(coalesce(p_message, '')), '');
BEGIN
  SELECT * INTO charge FROM public.charges WHERE id = p_charge_id;
  PERFORM private.portal_patient(charge.patient_id);
  IF length(message) > 1000 THEN RAISE EXCEPTION 'A mensagem pode ter até 1000 caracteres.' USING ERRCODE = 'P0001'; END IF;
  IF charge.cancelled_at IS NOT NULL OR (NOT charge.price_pending AND charge.amount - charge.discount - private.charge_paid(charge.id) <= 0) THEN
    RAISE EXCEPTION 'Esta cobrança não está em aberto.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portal_requests WHERE charge_id = charge.id AND kind = 'paid' AND created_at > now() - interval '1 day') THEN
    RAISE EXCEPTION 'O aviso de pagamento já foi enviado. O financeiro vai conferir.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO patient FROM public.patients WHERE id = charge.patient_id;
  task := private.portal_task(patient.id, 'Conferir pagamento informado por ' || private.first_name(patient.name) || ' (portal)',
    'O paciente informou pelo portal que pagou a cobrança "' || charge.description || '" (vencimento '
      || to_char(charge.due_date, 'DD/MM/YYYY') || '). Confira o recebimento e registre o pagamento no Financeiro.'
      || coalesce(E'\nMensagem: ' || message, ''),
    'finance.manage');
  INSERT INTO public.portal_requests (patient_id, user_id, kind, charge_id, message, task_id)
  VALUES (patient.id, auth.uid(), 'paid', charge.id, message, task);
END $$;

CREATE FUNCTION public.portal_document_list(p_patient_id uuid)
RETURNS TABLE (id uuid, title text, mime_type text, size_bytes bigint, created_at timestamptz, downloaded boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.portal_patient(p_patient_id);
  RETURN QUERY
  SELECT d.id, d.title, d.mime_type, d.size_bytes, d.created_at,
    EXISTS (SELECT 1 FROM public.portal_document_downloads x WHERE x.document_id = d.id AND x.user_id = auth.uid())
  FROM public.portal_documents d
  WHERE d.patient_id = p_patient_id AND d.removed_at IS NULL
  ORDER BY d.created_at DESC;
END $$;

-- Usada pela Edge Function portal-document-url (com o token de quem pediu). O paciente baixa só o que
-- foi compartilhado com ele (e o download fica registrado); a equipe que vê o paciente confere o arquivo.
CREATE FUNCTION public.portal_document_open(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  document public.portal_documents;
BEGIN
  SELECT * INTO document FROM public.portal_documents WHERE id = p_id;
  IF document.id IS NOT NULL AND private.is_staff() AND private.sees_patient(document.patient_id) THEN
    RETURN document.storage_path;
  END IF;
  PERFORM private.portal_patient(document.patient_id);
  IF document.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este documento não está mais disponível.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.portal_document_downloads (document_id, user_id) VALUES (document.id, auth.uid());
  RETURN document.storage_path;
END $$;

-- Funções da equipe --------------------------------------------------------------------------------

CREATE FUNCTION public.portal_access_list(p_patient_id uuid)
RETURNS TABLE (id uuid, user_id uuid, name text, email text, relationship text, invited_at timestamptz, invited_by_name text,
  revoked_at timestamptz, last_sign_in_at timestamptz, terms_accepted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(private.sees_patient(p_patient_id), false) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.user_id, p.name, p.email, a.relationship, a.invited_at, inviter.name, a.revoked_at, u.last_sign_in_at,
    (SELECT t.accepted_at FROM public.portal_terms t WHERE t.user_id = a.user_id AND t.version = private.portal_terms_version())
  FROM public.portal_access a
  JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles inviter ON inviter.id = a.invited_by
  WHERE a.patient_id = p_patient_id
  ORDER BY a.revoked_at NULLS FIRST, a.invited_at DESC;
END $$;

-- Chamada pela Edge Function portal-invite com o token de quem convida: confere permissão e regras e
-- diz se o e-mail já tem conta de paciente (que então só ganha o novo vínculo).
CREATE FUNCTION public.portal_prepare_invite(p_patient_id uuid, p_email text, p_relationship text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  patient public.patients;
  v_email text := lower(trim(coalesce(p_email, '')));
  existing uuid;
BEGIN
  PERFORM private.require_permission('patients.manage');
  SELECT * INTO patient FROM public.patients WHERE id = p_patient_id;
  IF patient.id IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF NOT coalesce((SELECT portal_enabled FROM public.clinic_settings LIMIT 1), false) THEN
    RAISE EXCEPTION 'Ligue o portal em Configurações antes de convidar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE = 'P0001'; END IF;
  IF p_relationship NOT IN ('self', 'guardian') THEN RAISE EXCEPTION 'Informe quem vai acessar.' USING ERRCODE = 'P0001'; END IF;
  IF p_relationship = 'self' AND patient.birth_date IS NOT NULL AND patient.birth_date > (private.local_today() - interval '18 years')::date THEN
    RAISE EXCEPTION 'Paciente menor de 18 anos: o acesso é do responsável.' USING ERRCODE = 'P0001';
  END IF;
  SELECT u.id INTO existing FROM auth.users u WHERE lower(u.email) = v_email;
  IF existing IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = existing AND r.role <> 'patient') THEN
    RAISE EXCEPTION 'Este e-mail é de uma conta da equipe. Use outro e-mail para o portal.' USING ERRCODE = 'P0001';
  END IF;
  IF existing IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = existing AND r.role = 'patient') THEN
    RAISE EXCEPTION 'Este e-mail já tem uma conta sem perfil de paciente. Fale com quem gerencia os usuários.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portal_access a WHERE a.patient_id = patient.id AND a.user_id = existing AND a.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Este e-mail já tem acesso a este paciente.' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('email', v_email, 'user_id', existing,
    'name', CASE WHEN p_relationship = 'guardian' THEN coalesce(nullif(trim(patient.guardian_name), ''), v_email) ELSE patient.name END);
END $$;

-- Só a Edge Function (chave de serviço), depois de portal_prepare_invite e da criação da conta.
CREATE FUNCTION public.portal_grant_access(p_patient_id uuid, p_user_id uuid, p_relationship text, p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  created uuid;
BEGIN
  IF NOT private.is_portal_user(p_user_id) THEN RAISE EXCEPTION 'Conta de paciente inválida.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.portal_access (patient_id, user_id, relationship, invited_by)
  VALUES (p_patient_id, p_user_id, p_relationship, p_actor)
  RETURNING id INTO created;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (p_actor, 'portal_invite', 'patient', p_patient_id);
  IF coalesce((SELECT enabled FROM public.integration_state WHERE key = 'portal_email'), false) THEN
    INSERT INTO public.portal_email_outbox (user_id, kind) VALUES (p_user_id, 'invite');
  END IF;
  RETURN created;
END $$;

CREATE FUNCTION public.revoke_portal_access(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  access public.portal_access;
BEGIN
  PERFORM private.require_permission('patients.manage');
  SELECT * INTO access FROM public.portal_access WHERE id = p_id AND revoked_at IS NULL;
  IF access.id IS NULL THEN RAISE EXCEPTION 'Acesso não encontrado.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.portal_access SET revoked_at = now(), revoked_by = auth.uid() WHERE id = access.id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'portal_revoke', 'patient', access.patient_id);
END $$;

CREATE FUNCTION public.portal_documents_for_patient(p_patient_id uuid)
RETURNS TABLE (id uuid, title text, mime_type text, size_bytes bigint, created_at timestamptz, shared_by_name text,
  downloads bigint, first_download_at timestamptz, can_remove boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(private.sees_patient(p_patient_id), false) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id, d.title, d.mime_type, d.size_bytes, d.created_at, p.name,
    (SELECT count(*) FROM public.portal_document_downloads x WHERE x.document_id = d.id),
    (SELECT min(x.created_at) FROM public.portal_document_downloads x WHERE x.document_id = d.id),
    private.can_share_portal(d.patient_id)
  FROM public.portal_documents d LEFT JOIN public.profiles p ON p.id = d.shared_by
  WHERE d.patient_id = p_patient_id AND d.removed_at IS NULL
  ORDER BY d.created_at DESC;
END $$;

-- Registra o arquivo já enviado ao bucket (o envio confere a permissão pela política do storage).
CREATE FUNCTION public.share_portal_document(p_patient_id uuid, p_title text, p_path text, p_size bigint, p_mime text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  created uuid;
BEGIN
  IF NOT private.can_share_portal(p_patient_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Informe o título do documento.' USING ERRCODE = 'P0001'; END IF;
  IF private.patient_of_path(p_path) IS DISTINCT FROM p_patient_id
    OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'portal-documents' AND o.name = p_path) THEN
    RAISE EXCEPTION 'Arquivo não encontrado. Envie de novo.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.portal_documents (patient_id, title, storage_path, size_bytes, mime_type, shared_by)
  VALUES (p_patient_id, left(trim(p_title), 200), p_path, p_size, p_mime, auth.uid())
  RETURNING id INTO created;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'portal_share', 'patient', p_patient_id);
  PERFORM private.portal_notify(p_patient_id, 'Novo documento: ' || left(trim(p_title), 150), '#/portal/documentos');
  RETURN created;
END $$;

-- Tira o documento do portal e devolve o caminho para o aplicativo apagar o arquivo.
CREATE FUNCTION public.remove_portal_document(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  document public.portal_documents;
BEGIN
  SELECT * INTO document FROM public.portal_documents WHERE id = p_id AND removed_at IS NULL;
  IF document.id IS NULL OR NOT private.can_share_portal(document.patient_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.portal_documents SET removed_at = now(), removed_by = auth.uid() WHERE id = document.id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'portal_unshare', 'patient', document.patient_id);
  RETURN document.storage_path;
END $$;

CREATE FUNCTION public.portal_requests_for_patient(p_patient_id uuid)
RETURNS TABLE (id uuid, kind text, created_at timestamptz, requested_by text, appointment_starts_at timestamptz,
  charge_description text, message text, task_id uuid, task_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(private.sees_patient(p_patient_id), false) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT q.id, q.kind, q.created_at, p.name, a.starts_at, c.description, q.message, q.task_id, t.status
  FROM public.portal_requests q
  LEFT JOIN public.profiles p ON p.id = q.user_id
  LEFT JOIN public.appointments a ON a.id = q.appointment_id
  LEFT JOIN public.charges c ON c.id = q.charge_id
  LEFT JOIN public.tasks t ON t.id = q.task_id
  WHERE q.patient_id = p_patient_id
  ORDER BY q.created_at DESC
  LIMIT 50;
END $$;

-- Configurações (quem gerencia configurações).
CREATE FUNCTION public.set_portal_settings(p_enabled boolean, p_url text, p_payment_instructions text,
  p_assignee_id uuid, p_email_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  url text := nullif(trim(coalesce(p_url, '')), '');
BEGIN
  PERFORM private.require_permission('settings.manage');
  IF url IS NOT NULL AND url !~ '^https?://[^\s]+$' THEN RAISE EXCEPTION 'Endereço do portal inválido.' USING ERRCODE = 'P0001'; END IF;
  IF p_assignee_id IS NOT NULL AND NOT private.is_active_staff(p_assignee_id) THEN
    RAISE EXCEPTION 'Escolha uma pessoa da equipe para os pedidos.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_email_enabled, false) AND url IS NULL THEN
    RAISE EXCEPTION 'Informe o endereço do portal para ligar os avisos por e-mail.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.clinic_settings SET portal_enabled = coalesce(p_enabled, false), portal_url = rtrim(url, '/'),
    portal_payment_instructions = nullif(trim(coalesce(p_payment_instructions, '')), ''), portal_assignee_id = p_assignee_id,
    updated_at = now()
  WHERE id;
  UPDATE public.integration_state SET enabled = coalesce(p_email_enabled, false), updated_at = now() WHERE key = 'portal_email';
END $$;

CREATE FUNCTION public.portal_state()
RETURNS TABLE (enabled boolean, url text, payment_instructions text, assignee_id uuid, email_enabled boolean,
  active_accesses bigint, email_last_run_at timestamptz, email_last_error text, email_queued bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  RETURN QUERY
  SELECT s.portal_enabled, s.portal_url, s.portal_payment_instructions, s.portal_assignee_id, i.enabled,
    (SELECT count(*) FROM public.portal_access a WHERE a.revoked_at IS NULL),
    i.last_run_at, i.last_error, (SELECT count(*) FROM public.portal_email_outbox o WHERE o.status = 'queued')
  FROM public.clinic_settings s, public.integration_state i WHERE i.key = 'portal_email' LIMIT 1;
END $$;

-- Envio dos e-mails (pg_cron chama a Edge Function portal-email-send, como no push e no WhatsApp).
CREATE FUNCTION private.run_portal_email() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target text;
  secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.portal_email_outbox WHERE status = 'queued' AND attempts < 5) THEN RETURN; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'portal_email_url'$q$ INTO target;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'portal_email_secret'$q$ INTO secret;
  IF target IS NULL OR secret IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3::jsonb)'
    USING target, jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret), '{}';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('portal-email', '* * * * *', 'SELECT private.run_portal_email()');
  END IF;
END $$;

-- Permissões das funções -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.can_share_portal(uuid), private.portal_terms_version(), private.is_portal_user(uuid),
  private.portal_patients(), private.portal_patient(uuid), private.portal_notify(uuid, text, text),
  private.portal_email_enqueue(), private.portal_appointments_inserted(), private.portal_appointments_updated(),
  private.portal_charge_inserted(), private.portal_task(uuid, text, text, text), private.run_portal_email()
  FROM PUBLIC, anon, authenticated;
-- As políticas do storage chamam can_share_portal com o usuário conectado.
GRANT EXECUTE ON FUNCTION private.can_share_portal(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_me(), public.portal_accept_terms(text), public.portal_appointments(uuid),
  public.portal_confirm(uuid), public.portal_request_change(uuid, text, text), public.portal_charges(uuid),
  public.portal_payments(uuid), public.portal_notify_paid(uuid, text), public.portal_document_list(uuid),
  public.portal_document_open(uuid), public.portal_access_list(uuid), public.portal_prepare_invite(uuid, text, text),
  public.portal_grant_access(uuid, uuid, text, uuid), public.revoke_portal_access(uuid), public.portal_documents_for_patient(uuid),
  public.share_portal_document(uuid, text, text, bigint, text), public.remove_portal_document(uuid),
  public.portal_requests_for_patient(uuid), public.set_portal_settings(boolean, text, text, uuid, boolean), public.portal_state()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_grant_access(uuid, uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.portal_grant_access(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_me(), public.portal_accept_terms(text), public.portal_appointments(uuid),
  public.portal_confirm(uuid), public.portal_request_change(uuid, text, text), public.portal_charges(uuid),
  public.portal_payments(uuid), public.portal_notify_paid(uuid, text), public.portal_document_list(uuid),
  public.portal_document_open(uuid), public.portal_access_list(uuid), public.portal_prepare_invite(uuid, text, text),
  public.revoke_portal_access(uuid), public.portal_documents_for_patient(uuid),
  public.share_portal_document(uuid, text, text, bigint, text), public.remove_portal_document(uuid),
  public.portal_requests_for_patient(uuid), public.set_portal_settings(boolean, text, text, uuid, boolean), public.portal_state()
  TO authenticated;
