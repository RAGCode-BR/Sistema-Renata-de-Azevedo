-- Bloco 12: notificações push do aplicativo da equipe (serviço de push da Expo). Preparado; envia só
-- quando alguém ligar em Configurações e houver aparelhos registrados.
--
-- - Cada aviso do sino (notifications) gera um push para os aparelhos da pessoa.
-- - O texto que aparece na tela bloqueada é GENÉRICO por tipo (sem título de tarefa, nome de paciente
--   ou lead); o detalhe só aparece dentro do aplicativo, depois do desbloqueio.
-- - Aparelho que deixou de existir (DeviceNotRegistered) é removido no envio.

INSERT INTO public.integration_state (key) VALUES ('push');

CREATE TABLE public.push_devices (
  token text PRIMARY KEY CHECK (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON public.push_devices (user_id);

CREATE TABLE public.push_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  token text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  ticket_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX push_outbox_queued_idx ON public.push_outbox (created_at) WHERE status = 'queued';

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices, public.push_outbox FROM anon, authenticated;
GRANT SELECT ON public.push_devices TO authenticated;
CREATE POLICY "aparelhos: só os próprios" ON public.push_devices FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Texto genérico por tipo de aviso (o que aparece com o celular bloqueado).
CREATE FUNCTION private.push_text(kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE kind
    WHEN 'task_assigned' THEN 'Você recebeu uma tarefa.'
    WHEN 'task_done' THEN 'Uma tarefa que você criou foi concluída.'
    WHEN 'task_comment' THEN 'Novo comentário em uma tarefa.'
    WHEN 'lead_new' THEN 'Novo contato no Comercial.'
    WHEN 'lead_assigned' THEN 'Um lead foi passado para você.'
    WHEN 'message_new' THEN 'Nova mensagem no WhatsApp da clínica.'
    ELSE 'Você tem um novo aviso.' END
$$;

CREATE FUNCTION private.push_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.integration_state WHERE key = 'push'), false) THEN RETURN NEW; END IF;
  INSERT INTO public.push_outbox (notification_id, token, title, body, link)
  SELECT NEW.id, d.token, 'Renata de Azevedo', private.push_text(NEW.kind), NEW.link
  FROM public.push_devices d WHERE d.user_id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.push_enqueue();

CREATE FUNCTION private.run_push() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target text;
  secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.push_outbox WHERE status = 'queued' AND attempts < 5) THEN RETURN; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_send_url'$q$ INTO target;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_send_secret'$q$ INTO secret;
  IF target IS NULL OR secret IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3::jsonb)'
    USING target, jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', secret), '{}';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('push', '* * * * *', 'SELECT private.run_push()');
  END IF;
END $$;

-- Aplicativo: registra/remove o aparelho da pessoa conectada.
CREATE FUNCTION public.register_push_device(p_token text, p_platform text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  INSERT INTO public.push_devices (token, user_id, platform) VALUES (p_token, auth.uid(), p_platform)
  ON CONFLICT (token) DO UPDATE SET user_id = auth.uid(), platform = EXCLUDED.platform, last_seen_at = now();
END $$;

CREATE FUNCTION public.unregister_push_device(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.push_devices WHERE token = p_token AND user_id = auth.uid()
$$;

-- Configuração (quem gerencia configurações).
CREATE FUNCTION public.set_push_enabled(p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  UPDATE public.integration_state SET enabled = p_enabled, updated_at = now() WHERE key = 'push';
END $$;

CREATE FUNCTION public.push_state() RETURNS TABLE (enabled boolean, devices bigint, last_run_at timestamptz, last_error text, queued bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('settings.manage');
  RETURN QUERY
  SELECT s.enabled, (SELECT count(*) FROM public.push_devices), s.last_run_at, s.last_error,
    (SELECT count(*) FROM public.push_outbox o WHERE o.status = 'queued')
  FROM public.integration_state s WHERE s.key = 'push';
END $$;

REVOKE ALL ON FUNCTION private.push_text(text), private.push_enqueue(), private.run_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_push_device(text, text), public.unregister_push_device(text), public.set_push_enabled(boolean),
  public.push_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text), public.unregister_push_device(text), public.set_push_enabled(boolean),
  public.push_state() TO authenticated;
