-- Bloco 10.1: Google Agenda e Google Meet (preparado; liga quando as credenciais do Google forem configuradas).
--
-- - Cada profissional conecta a própria conta Google (Edge Functions google-oauth-*). O token fica
--   cifrado em google_accounts, que a interface não lê.
-- - Sessões vão para o calendário escolhido como destino (push_target). Sessão on-line ganha link do
--   Google Meet, guardado em appointments.meeting_url. O título do evento segue a configuração da clínica
--   (padrão: só as iniciais do paciente, por privacidade).
-- - Os calendários marcados (selected) informam horários ocupados, sem título (google_busy), que a agenda mostra.
-- - Alterações feitas no Google não mudam as sessões: a agenda do sistema é a fonte.
-- - Fila calendar_sync_queue: gatilhos enfileiram, a função google-sync processa (a cada 5 min pelo
--   pg_cron, quando a integração estiver ativa, ou pelo botão "Sincronizar agora").

ALTER TABLE public.appointments ADD COLUMN meeting_url text CHECK (meeting_url ~ '^https://');
ALTER TABLE public.google_calendars ADD COLUMN push_target boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX google_calendars_one_target ON public.google_calendars (professional_id) WHERE push_target;
ALTER TABLE public.clinic_settings ADD COLUMN google_event_title text NOT NULL DEFAULT 'initials'
  CHECK (google_event_title IN ('initials', 'generic', 'full'));

CREATE TABLE public.calendar_sync_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('upsert', 'delete')),
  appointment_id uuid,
  google_calendar_id uuid NOT NULL REFERENCES public.google_calendars(id) ON DELETE CASCADE,
  google_event_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX calendar_sync_queue_pending ON public.calendar_sync_queue (created_at) WHERE done_at IS NULL;

CREATE TABLE public.google_busy (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  google_calendar_id uuid NOT NULL REFERENCES public.google_calendars(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at)
);
CREATE INDEX google_busy_professional_idx ON public.google_busy (professional_id, starts_at);

-- Estado das integrações (ativa, última execução, último erro). Sem segredos.
CREATE TABLE public.integration_state (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.integration_state (key) VALUES ('google');

ALTER TABLE public.calendar_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_busy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_sync_queue, public.google_busy, public.integration_state FROM anon, authenticated;
GRANT SELECT ON public.google_busy TO authenticated;
CREATE POLICY "ocupado no Google: quem vê a agenda da profissional" ON public.google_busy FOR SELECT TO authenticated
  USING (private.sees_schedule_of(professional_id));

-- Fila ------------------------------------------------------------------------------------------

CREATE FUNCTION private.enqueue_upsert(appointment uuid, professional uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.calendar_sync_queue (action, appointment_id, google_calendar_id)
  SELECT 'upsert', appointment, gc.id FROM public.google_calendars gc
  WHERE gc.professional_id = professional AND gc.push_target
    AND NOT EXISTS (SELECT 1 FROM public.calendar_sync_queue q WHERE q.done_at IS NULL AND q.action = 'upsert'
      AND q.appointment_id = appointment AND q.google_calendar_id = gc.id)
$$;

CREATE FUNCTION private.enqueue_unlink(appointment uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.calendar_sync_queue (action, appointment_id, google_calendar_id, google_event_id)
  SELECT 'delete', appointment, l.google_calendar_id, l.google_event_id FROM public.calendar_event_links l WHERE l.appointment_id = appointment
$$;

CREATE FUNCTION private.appointment_calendar_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Antes de apagar: os vínculos com o Google somem em cascata.
    PERFORM private.enqueue_unlink(OLD.id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.professional_id IS DISTINCT FROM OLD.professional_id THEN
    PERFORM private.enqueue_unlink(NEW.id);
  END IF;
  PERFORM private.enqueue_upsert(NEW.id, NEW.professional_id);
  RETURN NEW;
END $$;

CREATE TRIGGER appointments_calendar_sync AFTER INSERT OR UPDATE OF starts_at, ends_at, status, modality, patient_id, professional_id, session_type
  ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.appointment_calendar_sync();
CREATE TRIGGER appointments_calendar_unlink BEFORE DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.appointment_calendar_sync();

-- Funções da interface ---------------------------------------------------------------------------

DROP FUNCTION public.list_google_calendars();
CREATE FUNCTION public.list_google_calendars()
RETURNS TABLE (
  id uuid, professional_id uuid, display_name text, access_role text, selected boolean, push_target boolean,
  last_synced_at timestamptz, google_account_id uuid, google_email text, professional_name text, can_edit boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT gc.id, gc.professional_id, gc.display_name, gc.access_role, gc.selected, gc.push_target, gc.last_synced_at,
    ga.id, ga.google_email, pr.name, ga.user_id = auth.uid()
  FROM public.google_calendars gc
  JOIN public.google_accounts ga ON ga.id = gc.google_account_id
  JOIN public.professionals pr ON pr.id = gc.professional_id
  WHERE private.has_permission('calendars.view_all') OR gc.professional_id = private.current_professional_id()
  ORDER BY pr.name, ga.google_email, gc.display_name
$$;

-- Só a dona da conta Google escolhe o que mostrar e para onde enviar. Ao trocar o destino, as sessões
-- futuras são reenviadas e as do destino antigo, removidas de lá.
CREATE FUNCTION private.apply_google_calendar(owner_id uuid, p_id uuid, p_selected boolean, p_push_target boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cal public.google_calendars;
BEGIN
  SELECT gc.* INTO cal FROM public.google_calendars gc JOIN public.google_accounts ga ON ga.id = gc.google_account_id
  WHERE gc.id = p_id AND ga.user_id = owner_id;
  IF cal.id IS NULL THEN RAISE EXCEPTION 'Calendário não encontrado na sua conta.' USING ERRCODE = 'P0001'; END IF;
  IF p_push_target AND cal.access_role NOT IN ('owner', 'writer') THEN
    RAISE EXCEPTION 'Este calendário é só de leitura; escolha um em que você possa criar eventos.' USING ERRCODE = 'P0001';
  END IF;

  IF p_push_target AND NOT cal.push_target THEN
    INSERT INTO public.calendar_sync_queue (action, appointment_id, google_calendar_id, google_event_id)
    SELECT 'delete', l.appointment_id, l.google_calendar_id, l.google_event_id FROM public.calendar_event_links l
    JOIN public.google_calendars old ON old.id = l.google_calendar_id WHERE old.professional_id = cal.professional_id AND old.push_target;
    UPDATE public.google_calendars SET push_target = false WHERE professional_id = cal.professional_id AND push_target;
  ELSIF NOT p_push_target AND cal.push_target THEN
    INSERT INTO public.calendar_sync_queue (action, appointment_id, google_calendar_id, google_event_id)
    SELECT 'delete', l.appointment_id, l.google_calendar_id, l.google_event_id FROM public.calendar_event_links l WHERE l.google_calendar_id = cal.id;
  END IF;

  UPDATE public.google_calendars SET selected = p_selected, push_target = p_push_target WHERE id = p_id;
  IF NOT p_selected THEN DELETE FROM public.google_busy WHERE google_calendar_id = p_id; END IF;
  IF p_push_target AND NOT cal.push_target THEN
    PERFORM private.enqueue_upsert(a.id, a.professional_id) FROM public.appointments a
    WHERE a.professional_id = cal.professional_id AND a.ends_at > now() AND a.starts_at < now() + interval '180 days'
      AND private.occupies_slot(a.status);
  END IF;
END $$;

CREATE FUNCTION public.set_google_calendar(p_id uuid, p_selected boolean, p_push_target boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.apply_google_calendar(auth.uid(), p_id, p_selected, p_push_target)
$$;

-- Usada só pela função google-oauth-callback (chave de serviço) ao conectar a conta.
CREATE FUNCTION public.set_google_calendar_as_owner(p_user_id uuid, p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.apply_google_calendar(p_user_id, p_id, true, true)
$$;

-- Situação da sincronização (para a página Google Agenda).
CREATE FUNCTION public.google_sync_status()
RETURNS TABLE (enabled boolean, last_run_at timestamptz, last_error text, pending bigint, failing bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  own uuid := private.current_professional_id();
  everyone boolean := private.has_permission('calendars.view_all');
BEGIN
  IF NOT everyone AND own IS NULL THEN RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.enabled, s.last_run_at, CASE WHEN everyone THEN s.last_error END,
    (SELECT count(*) FROM public.calendar_sync_queue q JOIN public.google_calendars gc ON gc.id = q.google_calendar_id
      WHERE q.done_at IS NULL AND q.attempts < 5 AND (everyone OR gc.professional_id = own)),
    (SELECT count(*) FROM public.calendar_sync_queue q JOIN public.google_calendars gc ON gc.id = q.google_calendar_id
      WHERE q.done_at IS NULL AND q.attempts >= 5 AND (everyone OR gc.professional_id = own))
  FROM public.integration_state s WHERE s.key = 'google';
END $$;

-- Execução automática ------------------------------------------------------------------------------
-- O pg_cron chama a função google-sync com o segredo guardado no Vault (google_sync_url e
-- google_sync_secret). Nada acontece enquanto a integração não estiver ativa (primeira conta conectada).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
END $$;

CREATE FUNCTION private.run_google_sync() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target text;
  secret text;
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.integration_state WHERE key = 'google'), false) THEN RETURN; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_sync_url'$q$ INTO target;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_sync_secret'$q$ INTO secret;
  IF target IS NULL OR secret IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3::jsonb)'
    USING target, jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret), '{}';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('google-sync', '*/5 * * * *', 'SELECT private.run_google_sync()');
  END IF;
END $$;

REVOKE ALL ON FUNCTION private.enqueue_upsert(uuid, uuid), private.enqueue_unlink(uuid), private.appointment_calendar_sync(),
  private.run_google_sync(), private.apply_google_calendar(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_google_calendar_as_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_google_calendar_as_owner(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.list_google_calendars(), public.set_google_calendar(uuid, boolean, boolean), public.google_sync_status()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_google_calendars(), public.set_google_calendar(uuid, boolean, boolean), public.google_sync_status()
  TO authenticated;
