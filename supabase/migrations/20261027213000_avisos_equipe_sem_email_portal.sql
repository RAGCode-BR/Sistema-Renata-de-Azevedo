-- Avisos internos da equipe sobre pedidos, tarefas e formulários de pacientes usam o tipo 'portal'
-- (desde 20261026100000). O gatilho do e-mail "Novidade no portal do paciente" enfileirava para qualquer
-- conta com esse tipo, então a equipe receberia e-mails do portal quando o envio fosse ligado.
-- Agora o e-mail só vai para contas de paciente. Além disso, o aviso de "já paguei" (finance.manage)
-- leva às Cobranças: a ficha do paciente não abre para o perfil Financeiro.

CREATE OR REPLACE FUNCTION private.portal_email_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind <> 'portal' OR NOT private.is_portal_user(NEW.user_id)
    OR NOT coalesce((SELECT enabled FROM public.integration_state WHERE key = 'portal_email'), false) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_email_outbox o WHERE o.user_id = NEW.user_id AND o.kind = 'notice'
      AND o.created_at > now() - interval '1 hour') THEN
    INSERT INTO public.portal_email_outbox (user_id, kind) VALUES (NEW.user_id, 'notice');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.portal_task(patient uuid, label text, details text, permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE assignee uuid := (SELECT s.portal_assignee_id FROM public.clinic_settings s LIMIT 1);
BEGIN
  IF assignee IS NOT NULL AND NOT private.is_active_staff(assignee) THEN assignee := NULL; END IF;
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT p.id, 'portal', left(label, 200),
    CASE WHEN permission IN ('billing.manage', 'finance.manage') THEN '#/cobrancas' ELSE '#/pacientes?id=' || patient END
  FROM public.profiles p
  WHERE CASE WHEN assignee IS NOT NULL THEN p.id = assignee ELSE private.user_can(p.id, permission) END;
  RETURN NULL;
END $$;
