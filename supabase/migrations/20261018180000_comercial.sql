-- Bloco 8: Comercial (CRM) em substituição ao Converte.
--
-- - Leads com origem, campanha, interesse, local, responsável e linha do tempo de contatos.
-- - Funil com etapas editáveis: abertas, uma de ganho (Convertido) e uma de perda (Perdido, com motivo).
-- - Conversão em paciente: cria (ou liga) o cadastro, leva origem e campanha para o paciente.
-- - Campanhas com investimento lançado à mão; métricas cruzam agenda (compareceu) e financeiro (faturou).
-- - Captação pelo formulário do site: só pela Edge Function lead-capture (chave de serviço), com
--   limite de envios por IP e consentimento registrado.
-- - Leads perdidos sem contato há 12 meses são anonimizados (LGPD).
-- Quem usa: Proprietário(a), Gerente e Recepção (crm.view e crm.manage). Profissionais não acessam.

INSERT INTO public.role_permissions (role, permission) VALUES
  ('owner', 'crm.view'), ('owner', 'crm.manage'),
  ('manager', 'crm.view'), ('manager', 'crm.manage'),
  ('reception', 'crm.view'), ('reception', 'crm.manage');

-- Auxiliares ---------------------------------------------------------------------------------

-- Telefone comparável: só dígitos, sem o 55 do Brasil.
CREATE FUNCTION private.phone_key(phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN length(d) IN (12, 13) AND left(d, 2) = '55' THEN substr(d, 3)
    ELSE nullif(d, '') END
  FROM (SELECT regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS d) digits
$$;

-- Permissão de outra pessoa (para escolher responsável).
CREATE FUNCTION private.user_can(person uuid, wanted text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    JOIN public.role_permissions rp ON rp.role = r.role
    WHERE r.user_id = person AND p.active AND rp.permission = wanted
  )
$$;

-- Configuração ---------------------------------------------------------------------------------

CREATE TABLE public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO public.lead_sources (name) VALUES ('Instagram'), ('Facebook'), ('Google'), ('Site'), ('Indicação de paciente'),
  ('Indicação de profissional'), ('WhatsApp direto'), ('Outro');

CREATE TABLE public.lead_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('open', 'won', 'lost')),
  active boolean NOT NULL DEFAULT true,
  CHECK (active OR kind = 'open')
);
CREATE UNIQUE INDEX lead_stages_one_won ON public.lead_stages (kind) WHERE kind IN ('won', 'lost');
INSERT INTO public.lead_stages (name, position, kind) VALUES
  ('Novo contato', 1, 'open'), ('Em atendimento', 2, 'open'), ('Primeira consulta agendada', 3, 'open'),
  ('Convertido', 90, 'won'), ('Perdido', 99, 'lost');

CREATE TABLE public.lead_loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO public.lead_loss_reasons (name) VALUES ('Preço'), ('Horário'), ('Não respondeu'), ('Escolheu outro lugar'), ('Outro');

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  source_id uuid REFERENCES public.lead_sources(id),
  -- Valor do utm_campaign dos links desta campanha (minúsculo), para o formulário do site.
  utm_campaign text UNIQUE CHECK (utm_campaign = lower(trim(utm_campaign)) AND length(utm_campaign) > 0),
  starts_on date,
  ends_on date,
  budget numeric(12,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

-- Uma linha: responsável padrão pelos leads novos (formulário e importação).
CREATE TABLE public.crm_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_settings DEFAULT VALUES;

-- Leads ----------------------------------------------------------------------------------------

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  phone text,
  phone_key text GENERATED ALWAYS AS (private.phone_key(phone)) STORED,
  email text CHECK (email = lower(email)),
  source_id uuid REFERENCES public.lead_sources(id),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  stage_id uuid NOT NULL REFERENCES public.lead_stages(id),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  interest text CHECK (length(interest) <= 120),
  location text CHECK (length(location) <= 120),
  preferred_professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,
  notes text CHECK (length(notes) <= 4000),
  loss_reason_id uuid REFERENCES public.lead_loss_reasons(id),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  converted_at timestamptz,
  next_contact_at date,
  first_contact_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  landing_page text,
  consent_at timestamptz,
  anonymized_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_stage_idx ON public.leads (stage_id);
CREATE INDEX leads_created_idx ON public.leads (created_at);
CREATE INDEX leads_phone_idx ON public.leads (phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX leads_email_idx ON public.leads (email) WHERE email IS NOT NULL;
CREATE INDEX leads_campaign_idx ON public.leads (campaign_id);

CREATE TABLE public.lead_activities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'edited', 'assigned', 'stage', 'converted', 'call', 'message', 'email',
    'meeting', 'note', 'followup', 'site')),
  body text CHECK (length(body) <= 4000),
  from_value text,
  to_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_idx ON public.lead_activities (lead_id, created_at);

-- Envios do formulário do site (só hash do IP), para limitar abuso.
CREATE TABLE public.lead_capture_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_capture_log_idx ON public.lead_capture_log (ip_hash, created_at);

-- Origem do paciente (vem do lead na conversão ou é escolhida no cadastro).
ALTER TABLE public.patients ADD COLUMN source_id uuid REFERENCES public.lead_sources(id),
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

-- Tarefa de retorno ligada ao lead.
ALTER TABLE public.tasks ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Avisos: novos tipos e links para o Comercial.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('task_assigned', 'task_done', 'task_comment', 'lead_new', 'lead_assigned'));

-- Acesso ---------------------------------------------------------------------------------------

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_loss_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_capture_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_sources, public.lead_stages, public.lead_loss_reasons, public.campaigns, public.crm_settings,
  public.leads, public.lead_activities, public.lead_capture_log FROM anon, authenticated;
GRANT SELECT ON public.lead_sources, public.lead_stages, public.lead_loss_reasons, public.campaigns, public.crm_settings,
  public.leads, public.lead_activities TO authenticated;
GRANT INSERT, UPDATE ON public.lead_sources, public.lead_stages, public.lead_loss_reasons, public.campaigns TO authenticated;
GRANT UPDATE (default_owner_id, updated_at) ON public.crm_settings TO authenticated;

CREATE POLICY "origens: comercial e quem vê pacientes leem" ON public.lead_sources FOR SELECT TO authenticated
  USING (private.has_permission('crm.view') OR private.has_permission('patients.view_all'));
CREATE POLICY "origens: comercial cadastra" ON public.lead_sources FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('crm.manage'));
CREATE POLICY "origens: comercial altera" ON public.lead_sources FOR UPDATE TO authenticated
  USING (private.has_permission('crm.manage')) WITH CHECK (private.has_permission('crm.manage'));

CREATE POLICY "etapas: comercial lê" ON public.lead_stages FOR SELECT TO authenticated USING (private.has_permission('crm.view'));
-- Novas etapas são sempre abertas; Convertido e Perdido já existem e só mudam de nome.
CREATE POLICY "etapas: comercial cria abertas" ON public.lead_stages FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('crm.manage') AND kind = 'open');
CREATE POLICY "etapas: comercial altera" ON public.lead_stages FOR UPDATE TO authenticated
  USING (private.has_permission('crm.manage')) WITH CHECK (private.has_permission('crm.manage'));

CREATE POLICY "motivos: comercial lê" ON public.lead_loss_reasons FOR SELECT TO authenticated USING (private.has_permission('crm.view'));
CREATE POLICY "motivos: comercial cadastra" ON public.lead_loss_reasons FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('crm.manage'));
CREATE POLICY "motivos: comercial altera" ON public.lead_loss_reasons FOR UPDATE TO authenticated
  USING (private.has_permission('crm.manage')) WITH CHECK (private.has_permission('crm.manage'));

CREATE POLICY "campanhas: comercial e quem vê pacientes leem" ON public.campaigns FOR SELECT TO authenticated
  USING (private.has_permission('crm.view') OR private.has_permission('patients.view_all'));
CREATE POLICY "campanhas: comercial cadastra" ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('crm.manage'));
CREATE POLICY "campanhas: comercial altera" ON public.campaigns FOR UPDATE TO authenticated
  USING (private.has_permission('crm.manage')) WITH CHECK (private.has_permission('crm.manage'));

CREATE POLICY "config comercial: comercial lê" ON public.crm_settings FOR SELECT TO authenticated USING (private.has_permission('crm.view'));
CREATE POLICY "config comercial: comercial altera" ON public.crm_settings FOR UPDATE TO authenticated
  USING (private.has_permission('crm.manage')) WITH CHECK (private.has_permission('crm.manage')
    AND (default_owner_id IS NULL OR private.user_can(default_owner_id, 'crm.view')));

CREATE POLICY "leads: comercial lê" ON public.leads FOR SELECT TO authenticated USING (private.has_permission('crm.view'));
CREATE POLICY "contatos do lead: comercial lê" ON public.lead_activities FOR SELECT TO authenticated
  USING (private.has_permission('crm.view'));

-- Etapa não muda de tipo.
CREATE FUNCTION private.protect_stage_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'O tipo da etapa não pode mudar.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_stages_kind BEFORE UPDATE ON public.lead_stages FOR EACH ROW EXECUTE FUNCTION private.protect_stage_kind();

-- Funções internas -----------------------------------------------------------------------------

CREATE FUNCTION private.lead_log(lead uuid, what text, note text, before text, after text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.lead_activities (lead_id, actor_id, kind, body, from_value, to_value) VALUES (lead, auth.uid(), what, note, before, after)
$$;

CREATE FUNCTION private.notify_link(person uuid, what text, label text, target text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT person, what, label, target
  WHERE person IS NOT NULL AND person IS DISTINCT FROM auth.uid() AND private.is_active_staff(person)
$$;

CREATE FUNCTION private.first_open_stage() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.lead_stages WHERE kind = 'open' AND active ORDER BY position, name LIMIT 1
$$;

CREATE FUNCTION private.stage_of_kind(wanted text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.lead_stages WHERE kind = wanted LIMIT 1
$$;

CREATE FUNCTION private.check_lead_owner(person uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF person IS NOT NULL AND NOT private.user_can(person, 'crm.view') THEN
    RAISE EXCEPTION 'O responsável precisa ter acesso ao Comercial.' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Funções: leads -------------------------------------------------------------------------------

-- Cria (p_id nulo) ou edita um lead. p_data: name, phone, email, source_id, campaign_id, interest,
-- location, preferred_professional_id, owner_id, notes.
CREATE FUNCTION public.save_lead(p_id uuid, p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.leads;
  saved uuid;
  v_name text := trim(coalesce(p_data->>'name', ''));
  v_phone text := nullif(trim(p_data->>'phone'), '');
  v_email text := nullif(lower(trim(p_data->>'email')), '');
  v_owner uuid := nullif(p_data->>'owner_id', '')::uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  IF v_name = '' THEN RAISE EXCEPTION 'Informe o nome.' USING ERRCODE = 'P0001'; END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN RAISE EXCEPTION 'Informe telefone ou e-mail.' USING ERRCODE = 'P0001'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.check_lead_owner(v_owner);

  IF p_id IS NULL THEN
    INSERT INTO public.leads (name, phone, email, source_id, campaign_id, stage_id, owner_id, interest, location,
      preferred_professional_id, notes)
    VALUES (v_name, v_phone, v_email, nullif(p_data->>'source_id', '')::uuid, nullif(p_data->>'campaign_id', '')::uuid,
      private.first_open_stage(), coalesce(v_owner, auth.uid()), nullif(trim(p_data->>'interest'), ''),
      nullif(trim(p_data->>'location'), ''), nullif(p_data->>'preferred_professional_id', '')::uuid, nullif(trim(p_data->>'notes'), ''))
    RETURNING id INTO saved;
    PERFORM private.lead_log(saved, 'created', NULL, NULL, NULL);
    PERFORM private.notify_link(coalesce(v_owner, auth.uid()), 'lead_assigned', 'Lead para você: ' || v_name, '#/comercial?lead=' || saved);
    RETURN saved;
  END IF;

  SELECT * INTO current FROM public.leads WHERE id = p_id FOR UPDATE;
  IF current.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.leads SET name = v_name, phone = v_phone, email = v_email,
    source_id = nullif(p_data->>'source_id', '')::uuid, campaign_id = nullif(p_data->>'campaign_id', '')::uuid,
    owner_id = v_owner, interest = nullif(trim(p_data->>'interest'), ''), location = nullif(trim(p_data->>'location'), ''),
    preferred_professional_id = nullif(p_data->>'preferred_professional_id', '')::uuid, notes = nullif(trim(p_data->>'notes'), ''),
    updated_at = now()
  WHERE id = p_id;
  IF v_owner IS DISTINCT FROM current.owner_id THEN
    PERFORM private.lead_log(p_id, 'assigned', NULL, (SELECT name FROM public.profiles WHERE id = current.owner_id),
      (SELECT name FROM public.profiles WHERE id = v_owner));
    PERFORM private.notify_link(v_owner, 'lead_assigned', 'Lead para você: ' || v_name, '#/comercial?lead=' || p_id);
  ELSE
    PERFORM private.lead_log(p_id, 'edited', NULL, NULL, NULL);
  END IF;
  RETURN p_id;
END $$;

-- Muda a etapa. Perdido exige motivo; Convertido só pela conversão em paciente; lead convertido não sai.
CREATE FUNCTION public.move_lead(p_id uuid, p_stage_id uuid, p_loss_reason_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.leads;
  target public.lead_stages;
BEGIN
  PERFORM private.require_permission('crm.manage');
  SELECT * INTO current FROM public.leads WHERE id = p_id FOR UPDATE;
  SELECT * INTO target FROM public.lead_stages WHERE id = p_stage_id;
  IF current.id IS NULL OR target.id IS NULL THEN RAISE EXCEPTION 'Lead ou etapa não encontrados.' USING ERRCODE = 'P0001'; END IF;
  IF current.stage_id = target.id THEN RETURN; END IF;
  IF current.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este lead já virou paciente.' USING ERRCODE = 'P0001';
  END IF;
  IF target.kind = 'won' THEN
    RAISE EXCEPTION 'Use "Converter em paciente" para marcar como convertido.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT target.active THEN RAISE EXCEPTION 'Etapa desativada.' USING ERRCODE = 'P0001'; END IF;
  IF target.kind = 'lost' AND p_loss_reason_id IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da perda.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.leads SET stage_id = target.id, loss_reason_id = CASE WHEN target.kind = 'lost' THEN p_loss_reason_id END,
    updated_at = now(), last_activity_at = now()
  WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'stage',
    concat_ws(' · ', CASE WHEN target.kind = 'lost' THEN (SELECT name FROM public.lead_loss_reasons WHERE id = p_loss_reason_id) END,
      nullif(trim(p_note), '')),
    (SELECT name FROM public.lead_stages WHERE id = current.stage_id), target.name);
END $$;

-- Registra um contato (ligação, mensagem, e-mail, reunião) ou anotação.
CREATE FUNCTION public.add_lead_activity(p_id uuid, p_kind text, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.manage');
  IF p_kind NOT IN ('call', 'message', 'email', 'meeting', 'note') THEN RAISE EXCEPTION 'Tipo de contato inválido.' USING ERRCODE = 'P0001'; END IF;
  IF length(trim(coalesce(p_body, ''))) = 0 AND p_kind = 'note' THEN RAISE EXCEPTION 'Escreva a anotação.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.leads SET last_activity_at = now(),
    first_contact_at = CASE WHEN p_kind <> 'note' THEN coalesce(first_contact_at, now()) ELSE first_contact_at END
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.lead_log(p_id, p_kind, nullif(trim(p_body), ''), NULL, NULL);
END $$;

-- Próximo contato: cria uma tarefa ligada ao lead (mesmas regras de atribuição das tarefas).
CREATE FUNCTION public.schedule_lead_followup(p_id uuid, p_due_date date, p_due_time time, p_assignee_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead public.leads;
  created uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'Informe a data do próximo contato.' USING ERRCODE = 'P0001'; END IF;
  PERFORM private.check_assignee(p_assignee_id);
  PERFORM private.check_lead_owner(p_assignee_id);
  INSERT INTO public.tasks (title, description, assignee_id, priority, due_date, due_time, lead_id)
  VALUES ('Retornar contato: ' || lead.name, 'Lead no Comercial.', p_assignee_id, 'normal', p_due_date, p_due_time, p_id)
  RETURNING id INTO created;
  INSERT INTO public.task_events (task_id, actor_id, kind) VALUES (created, auth.uid(), 'created');
  PERFORM private.notify(p_assignee_id, 'task_assigned', 'Nova tarefa: Retornar contato: ' || lead.name, created);
  UPDATE public.leads SET next_contact_at = p_due_date, updated_at = now() WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'followup', NULL, NULL, p_due_date::text);
  RETURN created;
END $$;

-- Converte em paciente: cria o cadastro (com as profissionais escolhidas) ou liga a um existente.
CREATE FUNCTION public.convert_lead(p_id uuid, p_patient_id uuid, p_professional_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead public.leads;
  patient uuid := p_patient_id;
  professionals uuid[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_professional_ids, '{}')));
BEGIN
  PERFORM private.require_permission('crm.manage');
  PERFORM private.require_permission('patients.manage');
  SELECT * INTO lead FROM public.leads WHERE id = p_id FOR UPDATE;
  IF lead.id IS NULL THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF lead.patient_id IS NOT NULL THEN RAISE EXCEPTION 'Este lead já virou paciente.' USING ERRCODE = 'P0001'; END IF;

  IF patient IS NULL THEN
    IF cardinality(professionals) = 0 THEN
      RAISE EXCEPTION 'Escolha a profissional responsável.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(professionals) chosen WHERE NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = chosen AND active)) THEN
      RAISE EXCEPTION 'Profissional inválida.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.patients (name, phone, email, source_id, campaign_id)
    VALUES (lead.name, lead.phone, lead.email, lead.source_id, lead.campaign_id)
    RETURNING id INTO patient;
    INSERT INTO public.patient_professionals (patient_id, professional_id) SELECT patient, unnest(professionals);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = patient) THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.patients SET source_id = coalesce(source_id, lead.source_id), campaign_id = coalesce(campaign_id, lead.campaign_id)
    WHERE id = patient;
  END IF;

  UPDATE public.leads SET patient_id = patient, converted_at = now(), stage_id = private.stage_of_kind('won'),
    loss_reason_id = NULL, updated_at = now(), last_activity_at = now()
  WHERE id = p_id;
  PERFORM private.lead_log(p_id, 'converted', NULL, (SELECT name FROM public.lead_stages WHERE id = lead.stage_id), NULL);
  RETURN patient;
END $$;

-- Leads e pacientes com o mesmo telefone ou e-mail (aviso de duplicidade).
CREATE FUNCTION public.lead_duplicates(p_phone text, p_email text, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (kind text, id uuid, name text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := private.phone_key(p_phone);
  v_email text := nullif(lower(trim(p_email)), '');
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT 'lead'::text, l.id, l.name, s.name FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
  WHERE l.id IS DISTINCT FROM p_exclude AND l.anonymized_at IS NULL
    AND ((v_phone IS NOT NULL AND l.phone_key = v_phone) OR (v_email IS NOT NULL AND l.email = v_email))
  UNION ALL
  SELECT 'patient'::text, p.id, p.name, NULL FROM public.patients p
  WHERE private.sees_patient(p.id)
    AND ((v_phone IS NOT NULL AND private.phone_key(p.phone) = v_phone) OR (v_email IS NOT NULL AND lower(p.email) = v_email))
  LIMIT 10;
END $$;

-- Origem do paciente escolhida no cadastro.
CREATE FUNCTION public.set_patient_origin(p_patient_id uuid, p_source_id uuid, p_campaign_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('patients.manage');
  UPDATE public.patients SET source_id = p_source_id, campaign_id = p_campaign_id, updated_at = now() WHERE id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
END $$;

-- Importação (planilha do Converte ou outra). Cada linha: name, phone, email, source, campaign, stage,
-- created_at, notes. Pula quem já existe (mesmo telefone ou e-mail). Até 5.000 linhas por vez.
CREATE FUNCTION public.import_leads(p_rows jsonb, p_default_source_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  row jsonb;
  v_name text; v_phone text; v_email text; v_source uuid; v_campaign uuid; v_stage public.lead_stages; v_created timestamptz;
  stage_text text;
  inserted integer := 0;
  skipped integer := 0;
  invalid integer := 0;
  owner uuid := (SELECT default_owner_id FROM public.crm_settings LIMIT 1);
  created uuid;
BEGIN
  PERFORM private.require_permission('crm.manage');
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'Envie até 5.000 linhas por vez.' USING ERRCODE = 'P0001';
  END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_name := left(trim(coalesce(row->>'name', '')), 200);
    v_phone := nullif(trim(row->>'phone'), '');
    v_email := nullif(lower(trim(row->>'email')), '');
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN v_email := NULL; END IF;
    IF v_name = '' OR (v_phone IS NULL AND v_email IS NULL) THEN invalid := invalid + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.leads l WHERE (private.phone_key(v_phone) IS NOT NULL AND l.phone_key = private.phone_key(v_phone))
        OR (v_email IS NOT NULL AND l.email = v_email)) THEN
      skipped := skipped + 1; CONTINUE;
    END IF;

    v_source := coalesce((SELECT id FROM public.lead_sources WHERE lower(name) = lower(trim(row->>'source'))), p_default_source_id);
    v_campaign := NULL;
    IF nullif(trim(row->>'campaign'), '') IS NOT NULL THEN
      SELECT id INTO v_campaign FROM public.campaigns WHERE lower(name) = lower(trim(row->>'campaign'));
      IF v_campaign IS NULL THEN
        INSERT INTO public.campaigns (name, source_id) VALUES (trim(row->>'campaign'), v_source) RETURNING id INTO v_campaign;
      END IF;
    END IF;
    stage_text := lower(trim(coalesce(row->>'stage', '')));
    SELECT * INTO v_stage FROM public.lead_stages WHERE lower(name) = stage_text;
    IF v_stage.id IS NULL THEN
      SELECT * INTO v_stage FROM public.lead_stages WHERE kind = CASE
        WHEN stage_text ~ '(perdid|lost|descart|perda)' THEN 'lost'
        WHEN stage_text ~ '(convertid|ganh|won|fechad|cliente|paciente)' THEN 'won'
        ELSE 'open' END
      ORDER BY position LIMIT 1;
    END IF;
    BEGIN
      v_created := nullif(trim(row->>'created_at'), '')::timestamptz;
    EXCEPTION WHEN others THEN v_created := NULL;
    END;

    INSERT INTO public.leads (name, phone, email, source_id, campaign_id, stage_id, owner_id, notes, loss_reason_id, created_at,
      last_activity_at, converted_at)
    VALUES (v_name, v_phone, v_email, v_source, v_campaign, v_stage.id, owner, nullif(left(trim(row->>'notes'), 4000), ''),
      CASE WHEN v_stage.kind = 'lost' THEN (SELECT id FROM public.lead_loss_reasons WHERE name = 'Outro') END,
      coalesce(v_created, now()), coalesce(v_created, now()), CASE WHEN v_stage.kind = 'won' THEN coalesce(v_created, now()) END)
    RETURNING id INTO created;
    PERFORM private.lead_log(created, 'created', 'Importado de planilha', NULL, NULL);
    inserted := inserted + 1;
  END LOOP;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type) VALUES (auth.uid(), 'import', 'leads');
  RETURN jsonb_build_object('inserted', inserted, 'skipped', skipped, 'invalid', invalid);
END $$;

-- Captação pelo site (somente a Edge Function lead-capture, com a chave de serviço).
-- Limite: 5 envios por IP por hora e 300 por dia no total. Contato repetido vira registro no lead existente.
CREATE FUNCTION public.capture_lead(p_data jsonb, p_ip_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := left(trim(coalesce(p_data->>'name', '')), 200);
  v_phone text := nullif(left(trim(p_data->>'phone'), 40), '');
  v_email text := nullif(lower(left(trim(p_data->>'email'), 200)), '');
  v_message text := nullif(left(trim(p_data->>'message'), 2000), '');
  v_utm_source text := nullif(lower(left(trim(p_data->>'utm_source'), 100)), '');
  v_utm_campaign text := nullif(lower(left(trim(p_data->>'utm_campaign'), 100)), '');
  v_campaign public.campaigns;
  v_source uuid;
  existing uuid;
  created uuid;
  owner uuid := (SELECT default_owner_id FROM public.crm_settings LIMIT 1);
BEGIN
  IF coalesce(p_ip_hash, '') = '' THEN RAISE EXCEPTION 'Envio inválido.' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM public.lead_capture_log WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour') >= 5
    OR (SELECT count(*) FROM public.lead_capture_log WHERE created_at > now() - interval '1 day') >= 300 THEN
    RAISE EXCEPTION 'Muitos envios. Tente novamente mais tarde.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.lead_capture_log (ip_hash) VALUES (p_ip_hash);
  IF v_name = '' OR (v_phone IS NULL AND v_email IS NULL) THEN
    RAISE EXCEPTION 'Informe nome e telefone ou e-mail.' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = 'P0001'; END IF;
  IF coalesce((p_data->>'consent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'É preciso concordar com o uso dos dados para contato.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE utm_campaign = v_utm_campaign;
  v_source := coalesce(v_campaign.source_id, (SELECT id FROM public.lead_sources WHERE name = CASE
    WHEN v_utm_source ~ '^(ig|instagram)' THEN 'Instagram'
    WHEN v_utm_source ~ '^(fb|facebook|meta)' THEN 'Facebook'
    WHEN v_utm_source ~ '^(google|gads|adwords)' THEN 'Google'
    ELSE 'Site' END));

  SELECT l.id INTO existing FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
  WHERE s.kind = 'open' AND l.anonymized_at IS NULL
    AND ((private.phone_key(v_phone) IS NOT NULL AND l.phone_key = private.phone_key(v_phone)) OR (v_email IS NOT NULL AND l.email = v_email))
  ORDER BY l.created_at DESC LIMIT 1;
  IF existing IS NOT NULL THEN
    UPDATE public.leads SET last_activity_at = now(), updated_at = now() WHERE id = existing;
    INSERT INTO public.lead_activities (lead_id, kind, body) VALUES (existing, 'site', concat_ws(E'\n', 'Novo envio pelo formulário do site.', v_message));
    PERFORM private.notify_link((SELECT owner_id FROM public.leads WHERE id = existing), 'lead_new', 'Novo contato pelo site: ' || v_name, '#/comercial?lead=' || existing);
    RETURN existing;
  END IF;

  INSERT INTO public.leads (name, phone, email, source_id, campaign_id, stage_id, owner_id, interest, location, notes,
    utm_source, utm_medium, utm_campaign, utm_content, landing_page, consent_at, created_by)
  VALUES (v_name, v_phone, v_email, v_source, v_campaign.id, private.first_open_stage(), owner,
    nullif(left(trim(p_data->>'interest'), 120), ''), nullif(left(trim(p_data->>'location'), 120), ''), v_message,
    v_utm_source, nullif(lower(left(trim(p_data->>'utm_medium'), 100)), ''), v_utm_campaign,
    nullif(left(trim(p_data->>'utm_content'), 200), ''), nullif(left(trim(p_data->>'page'), 500), ''), now(), NULL)
  RETURNING id INTO created;
  INSERT INTO public.lead_activities (lead_id, kind, body) VALUES (created, 'site', 'Contato pelo formulário do site.');
  PERFORM private.notify_link(owner, 'lead_new', 'Novo lead pelo site: ' || v_name, '#/comercial?lead=' || created);
  RETURN created;
END $$;

-- Indicadores ----------------------------------------------------------------------------------

-- Leads criados no período (coorte): quantos viraram pacientes, compareceram e quanto faturaram.
-- Faturamento só aparece para quem vê cobranças ou o financeiro.
CREATE FUNCTION public.crm_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
  result jsonb;
BEGIN
  PERFORM private.require_permission('crm.view');
  WITH cohort AS (
    SELECT l.*, s.kind AS stage_kind,
      EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed') AS attended,
      coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL), 0) AS revenue
    FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'leads', (SELECT count(*) FROM cohort),
    'converted', (SELECT count(*) FROM cohort WHERE stage_kind = 'won'),
    'lost', (SELECT count(*) FROM cohort WHERE stage_kind = 'lost'),
    'open', (SELECT count(*) FROM cohort WHERE stage_kind = 'open'),
    'attended', (SELECT count(*) FROM cohort WHERE attended),
    'revenue', CASE WHEN money_ok THEN (SELECT coalesce(sum(revenue), 0) FROM cohort) END,
    'avg_first_contact_hours', (SELECT round((avg(extract(epoch FROM first_contact_at - created_at)) / 3600)::numeric, 1)
      FROM cohort WHERE first_contact_at IS NOT NULL),
    'new_patients', (SELECT count(*) FROM public.patients p WHERE (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_from AND p_to),
    'by_source', coalesce((SELECT jsonb_agg(x ORDER BY x.leads DESC) FROM (
      SELECT coalesce(src.name, 'Sem origem') AS name, count(*) AS leads,
        count(*) FILTER (WHERE c.stage_kind = 'won') AS converted, count(*) FILTER (WHERE c.stage_kind = 'lost') AS lost,
        count(*) FILTER (WHERE c.attended) AS attended,
        CASE WHEN money_ok THEN sum(c.revenue) END AS revenue
      FROM cohort c LEFT JOIN public.lead_sources src ON src.id = c.source_id GROUP BY src.name) x), '[]'),
    'loss_reasons', coalesce((SELECT jsonb_agg(x ORDER BY x.count DESC) FROM (
      SELECT coalesce(r.name, 'Sem motivo') AS name, count(*) AS count
      FROM cohort c LEFT JOIN public.lead_loss_reasons r ON r.id = c.loss_reason_id WHERE c.stage_kind = 'lost' GROUP BY r.name) x), '[]'),
    'stages', coalesce((SELECT jsonb_agg(x ORDER BY x.position) FROM (
      SELECT s.name, s.kind, s.position, count(c.id) AS count
      FROM public.lead_stages s LEFT JOIN cohort c ON c.stage_id = s.id WHERE s.active OR c.id IS NOT NULL
      GROUP BY s.id, s.name, s.kind, s.position) x), '[]')
  ) INTO result;
  RETURN result;
END $$;

-- Mês a mês: leads, convertidos (dos leads do mês) e novos pacientes (todos os cadastros do mês).
CREATE FUNCTION public.crm_monthly(p_year integer)
RETURNS TABLE (month date, leads bigint, converted bigint, new_patients bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT m.start,
    (SELECT count(*) FROM public.leads l WHERE date_trunc('month', l.created_at AT TIME ZONE 'America/Sao_Paulo')::date = m.start),
    (SELECT count(*) FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
      WHERE s.kind = 'won' AND date_trunc('month', l.created_at AT TIME ZONE 'America/Sao_Paulo')::date = m.start),
    (SELECT count(*) FROM public.patients p WHERE date_trunc('month', p.created_at AT TIME ZONE 'America/Sao_Paulo')::date = m.start)
  FROM (SELECT generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date AS start) m
  ORDER BY m.start;
END $$;

-- Campanhas (desde o início): leads, convertidos, compareceram, faturamento, custo por lead e por paciente.
CREATE FUNCTION public.campaign_stats()
RETURNS TABLE (
  id uuid, name text, source_id uuid, source_name text, utm_campaign text, starts_on date, ends_on date, budget numeric,
  notes text, active boolean, leads bigint, converted bigint, attended bigint, revenue numeric, cost_per_lead numeric,
  cost_per_patient numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
BEGIN
  PERFORM private.require_permission('crm.view');
  RETURN QUERY
  SELECT c.id, c.name, c.source_id, s.name, c.utm_campaign, c.starts_on, c.ends_on, c.budget, c.notes, c.active,
    count(l.id), count(l.id) FILTER (WHERE st.kind = 'won'),
    count(l.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed')),
    CASE WHEN money_ok THEN coalesce(sum((SELECT sum(p.amount) FROM public.payments p WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL)), 0) END,
    CASE WHEN count(l.id) > 0 THEN round(c.budget / count(l.id), 2) END,
    CASE WHEN count(l.id) FILTER (WHERE st.kind = 'won') > 0 THEN round(c.budget / count(l.id) FILTER (WHERE st.kind = 'won'), 2) END
  FROM public.campaigns c
  LEFT JOIN public.lead_sources s ON s.id = c.source_id
  LEFT JOIN public.leads l ON l.campaign_id = c.id
  LEFT JOIN public.lead_stages st ON st.id = l.stage_id
  GROUP BY c.id, s.name
  ORDER BY c.active DESC, c.starts_on DESC NULLS LAST, c.name;
END $$;

-- LGPD: leads perdidos sem nenhuma atividade há 12 meses perdem os dados pessoais.
CREATE FUNCTION private.anonymize_stale_leads() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected integer;
BEGIN
  WITH stale AS (
    SELECT l.id FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
    WHERE s.kind = 'lost' AND l.anonymized_at IS NULL AND l.last_activity_at < now() - interval '12 months'
  ), cleared AS (
    UPDATE public.lead_activities SET body = NULL WHERE lead_id IN (SELECT id FROM stale) RETURNING 1
  )
  UPDATE public.leads SET name = 'Lead anonimizado', phone = NULL, email = NULL, notes = NULL, utm_content = NULL,
    landing_page = NULL, anonymized_at = now()
  WHERE id IN (SELECT id FROM stale);
  GET DIAGNOSTICS affected = ROW_COUNT;
  DELETE FROM public.lead_capture_log WHERE created_at < now() - interval '30 days';
  RETURN affected;
END $$;

-- Agenda diária, quando o pg_cron estiver disponível (no Supabase está).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('anonimizar-leads', '30 4 * * *', 'SELECT private.anonymize_stale_leads()');
  END IF;
END $$;

-- Tarefas: lista passa a trazer o lead (só para quem acessa o Comercial) -------------------------

DROP FUNCTION public.task_list(text, boolean, uuid);
CREATE FUNCTION public.task_list(p_scope text, p_open boolean DEFAULT true, p_task_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, title text, description text, assignee_id uuid, assignee_name text, created_by uuid, creator_name text,
  priority text, status text, due_date date, due_time time, overdue boolean, patient_id uuid, patient_name text,
  recurrence_id uuid, frequency text, completed_at timestamptz, completed_by_name text, created_at timestamptz,
  can_edit boolean, comments bigint, lead_id uuid, lead_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  IF p_scope = 'team' THEN PERFORM private.require_permission('tasks.manage'); END IF;
  RETURN QUERY
  SELECT t.id, t.title, t.description, t.assignee_id, a.name, t.created_by, c.name, t.priority, t.status, t.due_date, t.due_time,
    t.status IN ('todo', 'doing') AND t.due_date IS NOT NULL AND (t.due_date < private.local_today()
      OR (t.due_date = private.local_today() AND t.due_time < (now() AT TIME ZONE 'America/Sao_Paulo')::time)),
    CASE WHEN private.sees_patient(t.patient_id) THEN t.patient_id END,
    CASE WHEN private.sees_patient(t.patient_id) THEN pa.name END,
    t.recurrence_id, r.frequency, t.completed_at, d.name, t.created_at, private.edits_task(t),
    (SELECT count(*) FROM public.task_events e WHERE e.task_id = t.id AND e.kind = 'comment'),
    CASE WHEN private.has_permission('crm.view') THEN t.lead_id END,
    CASE WHEN private.has_permission('crm.view') THEN ld.name END
  FROM public.tasks t
  LEFT JOIN public.profiles a ON a.id = t.assignee_id
  LEFT JOIN public.profiles c ON c.id = t.created_by
  LEFT JOIN public.profiles d ON d.id = t.completed_by
  LEFT JOIN public.patients pa ON pa.id = t.patient_id
  LEFT JOIN public.task_recurrences r ON r.id = t.recurrence_id
  LEFT JOIN public.leads ld ON ld.id = t.lead_id
  WHERE private.sees_task(t)
    AND (p_task_id IS NULL OR t.id = p_task_id)
    AND (p_task_id IS NOT NULL OR CASE p_scope
      WHEN 'mine' THEN t.assignee_id = auth.uid()
      WHEN 'created' THEN t.created_by = auth.uid()
      ELSE true END)
    AND (p_task_id IS NOT NULL OR (CASE WHEN p_open THEN t.status IN ('todo', 'doing')
      ELSE t.status IN ('todo', 'doing') OR t.updated_at > now() - interval '60 days' END))
  ORDER BY t.status IN ('done', 'cancelled'), t.due_date NULLS LAST, t.due_time NULLS LAST,
    array_position(ARRAY['urgent', 'high', 'normal', 'low'], t.priority), t.created_at;
END $$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.phone_key(text), private.user_can(uuid, text), private.lead_log(uuid, text, text, text, text),
  private.notify_link(uuid, text, text, text), private.first_open_stage(), private.stage_of_kind(text),
  private.check_lead_owner(uuid), private.anonymize_stale_leads(), private.protect_stage_kind()
  FROM PUBLIC, anon, authenticated;
-- Usadas pelas políticas e pela coluna calculada.
GRANT EXECUTE ON FUNCTION private.phone_key(text), private.user_can(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.task_list(text, boolean, uuid), public.save_lead(uuid, jsonb),
  public.move_lead(uuid, uuid, uuid, text), public.add_lead_activity(uuid, text, text),
  public.schedule_lead_followup(uuid, date, time, uuid), public.convert_lead(uuid, uuid, uuid[]),
  public.lead_duplicates(text, text, uuid), public.set_patient_origin(uuid, uuid, uuid), public.import_leads(jsonb, uuid),
  public.capture_lead(jsonb, text), public.crm_summary(date, date), public.crm_monthly(integer), public.campaign_stats()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_list(text, boolean, uuid), public.save_lead(uuid, jsonb),
  public.move_lead(uuid, uuid, uuid, text), public.add_lead_activity(uuid, text, text),
  public.schedule_lead_followup(uuid, date, time, uuid), public.convert_lead(uuid, uuid, uuid[]),
  public.lead_duplicates(text, text, uuid), public.set_patient_origin(uuid, uuid, uuid), public.import_leads(jsonb, uuid),
  public.crm_summary(date, date), public.crm_monthly(integer), public.campaign_stats()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_lead(jsonb, text) TO service_role;
