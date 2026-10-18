-- Sessão realizada sem preço cadastrado gera cobrança de R$ 0 "valor a definir". Antes ela aparecia
-- como paga (saldo zero) e sumia das cobranças em aberto. Agora fica marcada até alguém definir o valor.

ALTER TABLE public.charges ADD COLUMN price_pending boolean NOT NULL DEFAULT false;
UPDATE public.charges SET price_pending = true
WHERE appointment_id IS NOT NULL AND amount = 0 AND description LIKE '% — valor a definir';

CREATE OR REPLACE FUNCTION private.sync_appointment_charge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  settings public.clinic_settings;
  percent integer := 0;
  price numeric;
  value numeric;
  existing public.charges;
  day date := (NEW.starts_at AT TIME ZONE 'America/Sao_Paulo')::date;
  label text;
BEGIN
  SELECT * INTO settings FROM public.clinic_settings LIMIT 1;
  percent := CASE
    WHEN NEW.status = 'completed' THEN 100
    WHEN NEW.status = 'missed' THEN settings.missed_charge_percent
    WHEN NEW.status = 'cancelled_by_patient' AND NEW.starts_at - now() < make_interval(hours => settings.late_cancel_hours)
      THEN settings.late_cancel_charge_percent
    ELSE 0 END;
  SELECT * INTO existing FROM public.charges WHERE appointment_id = NEW.id;

  IF percent = 0 THEN
    IF existing.id IS NOT NULL AND existing.cancelled_at IS NULL THEN
      DELETE FROM public.payment_allocations WHERE charge_id = existing.id;
      UPDATE public.charges SET cancelled_at = now(), cancellation_reason = 'Sessão sem cobrança após mudança de situação',
        updated_at = now() WHERE id = existing.id;
    END IF;
    RETURN NEW;
  END IF;

  price := private.session_price(NEW.patient_id, NEW.professional_id, NEW.session_type);
  value := round(coalesce(price, 0) * percent / 100.0, 2);
  label := CASE NEW.status WHEN 'completed' THEN 'Sessão' WHEN 'missed' THEN 'Falta'
    ELSE 'Cancelamento tardio' END || ' de ' || to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
    || CASE WHEN percent < 100 THEN ' (' || percent || '%)' ELSE '' END
    || CASE WHEN price IS NULL THEN ' — valor a definir' ELSE '' END;

  IF existing.id IS NULL THEN
    INSERT INTO public.charges (patient_id, professional_id, appointment_id, description, competence_date, due_date, amount, price_pending)
    VALUES (NEW.patient_id, NEW.professional_id, NEW.id, label, day, day, value, price IS NULL)
    RETURNING * INTO existing;
  ELSIF existing.cancelled_at IS NOT NULL THEN
    UPDATE public.charges SET cancelled_at = NULL, cancellation_reason = NULL, description = label, amount = value,
      discount = least(discount, value), price_pending = price IS NULL, updated_at = now() WHERE id = existing.id;
  -- Valor já definido à mão (price_pending desligado) não é sobrescrito por uma tabela ainda vazia.
  ELSIF price IS NOT NULL AND existing.amount <> value
    AND private.charge_paid(existing.id) <= value - least(existing.discount, value) THEN
    UPDATE public.charges SET description = label, amount = value, discount = least(discount, value), price_pending = false,
      updated_at = now() WHERE id = existing.id;
  END IF;
  PERFORM private.apply_credit(existing.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.update_charge(p_id uuid, p_amount numeric, p_discount numeric, p_due_date date, p_description text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.manage');
  IF NOT EXISTS (SELECT 1 FROM public.charges WHERE id = p_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou cancelada.' USING ERRCODE = 'P0001';
  END IF;
  IF round(p_amount, 2) - round(coalesce(p_discount, 0), 2) < private.charge_paid(p_id) THEN
    RAISE EXCEPTION 'O valor não pode ficar menor do que o já recebido. Estorne o pagamento antes.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.charges SET amount = round(p_amount, 2), discount = round(coalesce(p_discount, 0), 2),
    due_date = coalesce(p_due_date, due_date),
    description = replace(coalesce(nullif(trim(p_description), ''), description), ' — valor a definir', ''),
    price_pending = false, updated_at = now()
  WHERE id = p_id;
  PERFORM private.apply_credit(p_id);
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'update', 'charge', p_id);
END $$;

-- Nova situação 'unpriced' (valor a definir), que conta como em aberto.
CREATE OR REPLACE FUNCTION public.charge_list(p_from date, p_to date, p_patient_id uuid DEFAULT NULL, p_open boolean DEFAULT false)
RETURNS TABLE (
  id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, appointment_id uuid,
  description text, competence_date date, due_date date, amount numeric, discount numeric, paid numeric, balance numeric,
  status text, cancelled_at timestamptz, cancellation_reason text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.patient_id, p.name, c.professional_id, pr.name, c.appointment_id, c.description, c.competence_date,
    c.due_date, c.amount, c.discount, paid.value, c.amount - c.discount - paid.value,
    CASE WHEN c.cancelled_at IS NOT NULL THEN 'cancelled'
      WHEN c.price_pending THEN 'unpriced'
      WHEN c.amount - c.discount - paid.value <= 0 THEN 'paid'
      WHEN c.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
      WHEN paid.value > 0 THEN 'partial'
      ELSE 'pending' END,
    c.cancelled_at, c.cancellation_reason, c.created_at
  FROM public.charges c
  JOIN public.patients p ON p.id = c.patient_id
  LEFT JOIN public.professionals pr ON pr.id = c.professional_id
  CROSS JOIN LATERAL (SELECT private.charge_paid(c.id) AS value) paid
  WHERE (private.has_permission('billing.view')
      OR (c.professional_id IS NOT NULL AND c.professional_id = private.current_professional_id()))
    AND (p_patient_id IS NULL OR c.patient_id = p_patient_id)
    AND (CASE WHEN p_open THEN c.cancelled_at IS NULL AND (c.price_pending OR c.amount - c.discount - paid.value > 0)
      ELSE c.competence_date >= p_from AND c.competence_date <= p_to END)
  ORDER BY c.competence_date DESC, c.created_at DESC
$$;
