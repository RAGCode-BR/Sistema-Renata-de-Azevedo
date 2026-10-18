-- Bloco 3: agenda completa.
--
-- * 8 situações de sessão (cancelamento pelo paciente ≠ pela clínica ≠ falta ≠ remarcação).
-- * Histórico de cada sessão (appointment_events), gravado por gatilho: nenhuma mudança escapa.
-- * Mudanças só por funções com as regras dentro: situação, cancelamento (inclusive da série),
--   remarcação e criação de séries recorrentes. A interface não altera appointments diretamente.
-- * Bloqueios de horário com motivo opcionalmente privado; não é possível agendar sobre um bloqueio.
-- * Tipo de atendimento (individual, casal…) separado da modalidade (presencial/on-line).
-- * Especialidade das profissionais, para filtrar a agenda.
-- Datas exibidas nas mensagens usam o fuso da clínica (America/Sao_Paulo).

-- Situações -----------------------------------------------------------------------------------

ALTER TABLE public.appointments DROP CONSTRAINT appointments_status_check;
UPDATE public.appointments SET status = 'cancelled_by_clinic' WHERE status = 'cancelled';
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check CHECK (status IN (
  'scheduled', 'awaiting_confirmation', 'confirmed', 'completed', 'missed',
  'cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled'
));

-- Canceladas e remarcadas liberam o horário.
CREATE FUNCTION private.occupies_slot(status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT status NOT IN ('cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled')
$$;

ALTER TABLE public.appointments DROP CONSTRAINT appointments_no_overlap;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
  professional_id WITH =, tstzrange(starts_at, ends_at) WITH &&
) WHERE (status NOT IN ('cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled'));

ALTER TABLE public.appointments
  ADD COLUMN session_type text NOT NULL DEFAULT 'individual'
    CHECK (session_type IN ('individual', 'couple', 'family', 'group', 'assessment')),
  ADD COLUMN series_id uuid,
  ADD COLUMN rescheduled_from uuid REFERENCES public.appointments(id),
  ADD COLUMN cancellation_reason text;
CREATE INDEX appointments_series_idx ON public.appointments (series_id) WHERE series_id IS NOT NULL;

ALTER TABLE public.professionals ADD COLUMN specialty text;

-- Editar profissionais (nome, e-mail, especialidade, situação): quem gerencia profissionais.
CREATE POLICY "quem gerencia profissionais edita" ON public.professionals
  FOR UPDATE TO authenticated
  USING (private.has_permission('professionals.manage'))
  WITH CHECK (private.has_permission('professionals.manage'));

-- Histórico ------------------------------------------------------------------------------------

CREATE TABLE public.appointment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'status_changed', 'updated')),
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_events_appointment_idx ON public.appointment_events (appointment_id, created_at);

CREATE FUNCTION private.record_appointment_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.appointment_events (appointment_id, action, to_status, actor_user_id)
    VALUES (NEW.id, 'created', NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.appointment_events (appointment_id, action, from_status, to_status, reason, actor_user_id)
    VALUES (NEW.id, 'status_changed', OLD.status, NEW.status, NEW.cancellation_reason, auth.uid());
  ELSIF (NEW.modality, NEW.session_type) IS DISTINCT FROM (OLD.modality, OLD.session_type) THEN
    INSERT INTO public.appointment_events (appointment_id, action, actor_user_id)
    VALUES (NEW.id, 'updated', auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_history AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.record_appointment_event();

-- Sessões já existentes ganham o registro de criação.
INSERT INTO public.appointment_events (appointment_id, action, to_status, actor_user_id, created_at)
SELECT id, 'created', status, created_by, created_at FROM public.appointments;

ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.appointment_events FROM authenticated;
CREATE POLICY "histórico: de quem vê a sessão" ON public.appointment_events
  FOR SELECT TO authenticated USING (
    private.has_permission('appointments.view_all')
    OR EXISTS (SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id AND a.professional_id = private.current_professional_id())
  );

-- Bloqueios ------------------------------------------------------------------------------------
-- Acesso só pelas funções abaixo: o motivo privado não pode vazar por uma consulta direta.

CREATE TABLE public.schedule_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  reason_private boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX schedule_blocks_prof_time_idx ON public.schedule_blocks (professional_id, starts_at);
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_blocks FROM anon, authenticated;

CREATE TRIGGER audit_schedule_blocks AFTER INSERT ON public.schedule_blocks
  FOR EACH ROW EXECUTE FUNCTION private.audit_insert('schedule_block');

-- Sessão × bloqueio: nenhum dos dois pode ser criado em cima do outro. A trava por profissional
-- evita que uma sessão e um bloqueio simultâneos passem pela checagem ao mesmo tempo.
CREATE FUNCTION private.check_block_conflict() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.professional_id::text));
  IF TG_TABLE_NAME = 'appointments' THEN
    IF private.occupies_slot(NEW.status) AND EXISTS (
      SELECT 1 FROM public.schedule_blocks b
      WHERE b.professional_id = NEW.professional_id AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at
    ) THEN
      RAISE EXCEPTION 'Horário bloqueado na agenda desta profissional.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.professional_id = NEW.professional_id AND private.occupies_slot(a.status)
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Já existe sessão nesse horário. Remarque ou cancele a sessão antes de bloquear.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_check_block BEFORE INSERT OR UPDATE OF starts_at, ends_at, professional_id, status
  ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.check_block_conflict();
CREATE TRIGGER schedule_blocks_check_conflict BEFORE INSERT OR UPDATE ON public.schedule_blocks
  FOR EACH ROW EXECUTE FUNCTION private.check_block_conflict();

-- Quem vê e quem mexe na agenda de uma profissional: a gerência ou ela mesma.
-- coalesce: para quem não é profissional, "professional = current_professional_id()" é NULL, e uma
-- checagem "IF NOT (... OR NULL)" não dispararia. Estas funções nunca devolvem NULL.
CREATE FUNCTION private.sees_schedule_of(professional uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(private.has_permission('appointments.view_all') OR professional = private.current_professional_id(), false)
$$;

CREATE FUNCTION private.manages_schedule_of(professional uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(private.has_permission('appointments.manage') OR professional = private.current_professional_id(), false)
$$;

-- Bloqueios visíveis a quem vê a agenda (geral ou a própria). O motivo privado só aparece para a
-- profissional do bloqueio e para quem o criou; os demais veem só "horário bloqueado".
CREATE FUNCTION public.list_schedule_blocks(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  id uuid, professional_id uuid, professional_name text, starts_at timestamptz, ends_at timestamptz,
  reason text, reason_private boolean, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT b.id, b.professional_id, pr.name, b.starts_at, b.ends_at,
    CASE WHEN NOT b.reason_private OR b.professional_id = private.current_professional_id() OR b.created_by = auth.uid()
      THEN b.reason END,
    b.reason_private,
    private.manages_schedule_of(b.professional_id)
  FROM public.schedule_blocks b JOIN public.professionals pr ON pr.id = b.professional_id
  WHERE b.starts_at < p_to AND b.ends_at > p_from
    AND private.sees_schedule_of(b.professional_id)
  ORDER BY b.starts_at
$$;

CREATE FUNCTION public.create_schedule_block(
  p_professional_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text, p_reason_private boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  created uuid;
BEGIN
  IF NOT private.manages_schedule_of(p_professional_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'O fim do bloqueio precisa ser depois do início.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.schedule_blocks (professional_id, starts_at, ends_at, reason, reason_private)
  VALUES (p_professional_id, p_starts_at, p_ends_at, nullif(trim(p_reason), ''), coalesce(p_reason_private, false))
  RETURNING id INTO created;
  RETURN created;
END $$;

CREATE FUNCTION public.delete_schedule_block(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid;
BEGIN
  SELECT professional_id INTO professional FROM public.schedule_blocks WHERE id = p_id;
  IF professional IS NULL THEN
    RAISE EXCEPTION 'Bloqueio não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.manages_schedule_of(professional) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.schedule_blocks WHERE id = p_id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'delete', 'schedule_block', p_id);
END $$;

-- Ações sobre sessões --------------------------------------------------------------------------

-- Situação (confirmar, aguardar confirmação, presença, falta, cancelar, reativar).
-- Presença e falta só depois do início; sessões remarcadas são definitivas (a nova continua a história).
CREATE FUNCTION public.set_appointment_status(p_id uuid, p_status text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.appointments;
BEGIN
  SELECT * INTO current FROM public.appointments WHERE id = p_id;
  IF current.id IS NULL OR NOT private.sees_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Sessão não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.manages_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('scheduled', 'awaiting_confirmation', 'confirmed', 'completed', 'missed',
                      'cancelled_by_patient', 'cancelled_by_clinic') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  IF current.status = 'rescheduled' THEN
    RAISE EXCEPTION 'Esta sessão foi remarcada; altere a nova sessão.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IN ('completed', 'missed') AND current.starts_at > now() THEN
    RAISE EXCEPTION 'Presença e falta só podem ser registradas depois do início da sessão.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.appointments SET
    status = p_status,
    cancellation_reason = CASE WHEN p_status IN ('cancelled_by_patient', 'cancelled_by_clinic')
      THEN nullif(trim(p_reason), '') END,
    updated_at = now()
  WHERE id = p_id;
END $$;

-- Cancela a sessão e, se pedido, as próximas da mesma série que ainda ocupam horário.
CREATE FUNCTION public.cancel_appointment(p_id uuid, p_by text, p_reason text, p_following boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.appointments;
  next_status text;
  affected integer := 0;
  item record;
BEGIN
  IF p_by NOT IN ('patient', 'clinic') THEN
    RAISE EXCEPTION 'Informe quem cancelou.' USING ERRCODE = 'P0001';
  END IF;
  next_status := CASE p_by WHEN 'patient' THEN 'cancelled_by_patient' ELSE 'cancelled_by_clinic' END;
  SELECT * INTO current FROM public.appointments WHERE id = p_id;
  IF current.id IS NULL OR NOT private.sees_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Sessão não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.manages_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  FOR item IN
    SELECT id FROM public.appointments
    WHERE id = p_id OR (p_following AND current.series_id IS NOT NULL AND series_id = current.series_id
      AND starts_at > current.starts_at AND private.occupies_slot(status) AND status NOT IN ('completed', 'missed'))
    ORDER BY starts_at
  LOOP
    PERFORM public.set_appointment_status(item.id, next_status, p_reason);
    affected := affected + 1;
  END LOOP;
  RETURN affected;
END $$;

-- Remarca: a sessão original fica "remarcada" e uma nova sessão (ligada a ela) ocupa o novo horário.
CREATE FUNCTION public.reschedule_appointment(p_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.appointments;
  created uuid;
BEGIN
  SELECT * INTO current FROM public.appointments WHERE id = p_id;
  IF current.id IS NULL OR NOT private.sees_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Sessão não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.manages_schedule_of(current.professional_id) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF current.status NOT IN ('scheduled', 'awaiting_confirmation', 'confirmed') THEN
    RAISE EXCEPTION 'Só sessões ainda não realizadas podem ser remarcadas.' USING ERRCODE = 'P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'O horário final precisa ser posterior ao inicial.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.appointments SET status = 'rescheduled', updated_at = now() WHERE id = p_id;
  INSERT INTO public.appointments
    (patient_id, professional_id, starts_at, ends_at, modality, session_type, series_id, rescheduled_from, created_by)
  VALUES (current.patient_id, current.professional_id, p_starts_at, p_ends_at, current.modality,
    current.session_type, current.series_id, current.id, auth.uid())
  RETURNING id INTO created;
  RETURN created;
END $$;

-- Série recorrente: cria todas as sessões ou nenhuma. Em conflito, diz qual data impediu.
CREATE FUNCTION public.create_appointment_series(
  p_patient_id uuid, p_professional_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_modality text, p_session_type text, p_frequency text, p_count integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  series uuid := gen_random_uuid();
  step interval;
  occurrence integer;
  starts timestamptz;
BEGIN
  IF NOT private.has_permission('appointments.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF p_count IS NULL OR p_count < 2 OR p_count > 52 THEN
    RAISE EXCEPTION 'Escolha de 2 a 52 sessões na série.' USING ERRCODE = 'P0001';
  END IF;
  step := CASE p_frequency WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
    WHEN 'monthly' THEN interval '1 month' END;
  IF step IS NULL THEN
    RAISE EXCEPTION 'Frequência inválida.' USING ERRCODE = 'P0001';
  END IF;

  FOR occurrence IN 0 .. p_count - 1 LOOP
    starts := p_starts_at + step * occurrence;
    BEGIN
      INSERT INTO public.appointments
        (patient_id, professional_id, starts_at, ends_at, modality, session_type, series_id, created_by)
      VALUES (p_patient_id, p_professional_id, starts, starts + (p_ends_at - p_starts_at),
        p_modality, coalesce(p_session_type, 'individual'), series, auth.uid());
    EXCEPTION
      WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Conflito em %: já existe sessão nesse horário. Nenhuma sessão da série foi criada.',
          to_char(starts AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') USING ERRCODE = 'P0001';
      WHEN raise_exception THEN
        RAISE EXCEPTION 'Conflito em %: %. Nenhuma sessão da série foi criada.',
          to_char(starts AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'), rtrim(SQLERRM, '.') USING ERRCODE = 'P0001';
    END;
  END LOOP;
  RETURN series;
END $$;

-- Evolução pendente agora é só de sessão realizada; sessão passada ainda "agendada/confirmada"
-- é presença não registrada (consultada direto em appointments pela interface).
CREATE OR REPLACE FUNCTION public.pending_clinical_notes()
RETURNS TABLE (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz,
  patient_id uuid, patient_name text, professional_id uuid, professional_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.starts_at, a.ends_at, a.patient_id, p.name, a.professional_id, pr.name
  FROM public.appointments a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE a.status = 'completed'
    AND NOT EXISTS (SELECT 1 FROM public.clinical_notes n WHERE n.appointment_id = a.id)
    AND (private.has_permission('appointments.view_all') OR a.professional_id = private.current_professional_id())
  ORDER BY a.starts_at
$$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.list_schedule_blocks(timestamptz, timestamptz),
  public.create_schedule_block(uuid, timestamptz, timestamptz, text, boolean),
  public.delete_schedule_block(uuid),
  public.set_appointment_status(uuid, text, text),
  public.cancel_appointment(uuid, text, text, boolean),
  public.reschedule_appointment(uuid, timestamptz, timestamptz),
  public.create_appointment_series(uuid, uuid, timestamptz, timestamptz, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_schedule_blocks(timestamptz, timestamptz),
  public.create_schedule_block(uuid, timestamptz, timestamptz, text, boolean),
  public.delete_schedule_block(uuid),
  public.set_appointment_status(uuid, text, text),
  public.cancel_appointment(uuid, text, text, boolean),
  public.reschedule_appointment(uuid, timestamptz, timestamptz),
  public.create_appointment_series(uuid, uuid, timestamptz, timestamptz, text, text, text, integer)
  TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(text), private.has_permission(text), private.is_staff(),
  private.current_professional_id(), private.cares_for(uuid), private.occupies_slot(text),
  private.sees_schedule_of(uuid), private.manages_schedule_of(uuid) TO authenticated;
