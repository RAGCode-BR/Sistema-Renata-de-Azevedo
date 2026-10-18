-- Bloco 6: financeiro.
--
-- * Cobrança (charges): uma por sessão no máximo, criada sozinha quando a sessão vira realizada (ou
--   falta / cancelamento tardio, conforme a política em clinic_settings). Cobranças manuais também.
-- * Pagamento (payments) é separado da cobrança e distribuído por payment_allocations: uma cobrança
--   aceita vários pagamentos e um pagamento quita várias cobranças. O que sobra é crédito do paciente,
--   abatido sozinho nas cobranças seguintes (pacotes / pagamento antecipado).
-- * Situação calculada, nunca digitada: pendente, parcial, paga, vencida, cancelada.
-- * Competência (data da sessão) ≠ caixa (data do recebimento): faturamento e fluxo de caixa são
--   relatórios diferentes.
-- * Despesas com categoria e centro de custo; repasses por percentual sobre o valor recebido no mês.
--
-- Permissões: billing.* (cobranças e pagamentos: Proprietário(a), Gerente, Recepção, Financeiro);
-- finance.* (despesas, resultado, repasses, preços: Proprietário(a) e Financeiro). A profissional vê
-- só as cobranças dos próprios atendimentos e o próprio repasse.

-- Permissões ---------------------------------------------------------------------------------

DELETE FROM public.role_permissions WHERE role = 'manager' AND permission = 'finance.view';
INSERT INTO public.role_permissions (role, permission) VALUES
  ('owner', 'billing.view'), ('owner', 'billing.manage'),
  ('manager', 'billing.view'), ('manager', 'billing.manage'),
  ('reception', 'billing.view'), ('reception', 'billing.manage'),
  ('finance', 'billing.view'), ('finance', 'billing.manage')
ON CONFLICT DO NOTHING;

-- Política de cobrança (Configurações) --------------------------------------------------------

ALTER TABLE public.clinic_settings
  ADD COLUMN missed_charge_percent integer NOT NULL DEFAULT 100 CHECK (missed_charge_percent BETWEEN 0 AND 100),
  ADD COLUMN late_cancel_hours integer NOT NULL DEFAULT 24 CHECK (late_cancel_hours BETWEEN 0 AND 168),
  ADD COLUMN late_cancel_charge_percent integer NOT NULL DEFAULT 100 CHECK (late_cancel_charge_percent BETWEEN 0 AND 100);

-- Preços -------------------------------------------------------------------------------------

-- Escopo: profissional (nulo = clínica toda) × tipo de atendimento (nulo = qualquer tipo).
CREATE TABLE public.session_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid REFERENCES public.professionals(id),
  session_type text CHECK (session_type IN ('individual', 'couple', 'family', 'group', 'assessment')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX session_prices_scope_idx ON public.session_prices
  (coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(session_type, ''));

-- Valor combinado com o paciente (tem prioridade sobre a tabela).
CREATE TABLE public.patient_prices (
  patient_id uuid PRIMARY KEY REFERENCES public.patients(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION private.session_price(patient uuid, professional uuid, kind text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT amount FROM public.patient_prices WHERE patient_id = patient),
    (SELECT amount FROM public.session_prices WHERE professional_id = professional AND session_type = kind),
    (SELECT amount FROM public.session_prices WHERE professional_id = professional AND session_type IS NULL),
    (SELECT amount FROM public.session_prices WHERE professional_id IS NULL AND session_type = kind),
    (SELECT amount FROM public.session_prices WHERE professional_id IS NULL AND session_type IS NULL)
  )
$$;

-- Cobranças e pagamentos ---------------------------------------------------------------------

CREATE TABLE public.charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  professional_id uuid REFERENCES public.professionals(id),
  appointment_id uuid UNIQUE REFERENCES public.appointments(id),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  competence_date date NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= amount),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX charges_patient_idx ON public.charges (patient_id, competence_date);
CREATE INDEX charges_competence_idx ON public.charges (competence_date);
CREATE INDEX charges_professional_idx ON public.charges (professional_id, competence_date);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('pix', 'cash', 'debit', 'credit', 'transfer')),
  received_at date NOT NULL,
  notes text,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL))
);
CREATE INDEX payments_patient_idx ON public.payments (patient_id, received_at);
CREATE INDEX payments_received_idx ON public.payments (received_at);

CREATE TABLE public.payment_allocations (
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES public.charges(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, charge_id)
);
CREATE INDEX payment_allocations_charge_idx ON public.payment_allocations (charge_id);

-- Garantia contra lançamento duplicado ou inconsistente, conferida a cada distribuição gravada:
-- nenhum pagamento distribui mais do que recebeu, nenhuma cobrança recebe mais do que vale,
-- pagamento estornado e cobrança cancelada não têm distribuição, e paciente é sempre o mesmo.
CREATE FUNCTION private.check_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  payment public.payments;
  charge public.charges;
BEGIN
  SELECT * INTO payment FROM public.payments WHERE id = NEW.payment_id;
  SELECT * INTO charge FROM public.charges WHERE id = NEW.charge_id;
  IF payment.id IS NULL OR charge.id IS NULL THEN RETURN NULL; END IF;
  IF payment.patient_id <> charge.patient_id THEN
    RAISE EXCEPTION 'Pagamento e cobrança de pacientes diferentes.' USING ERRCODE = 'P0001';
  END IF;
  IF payment.reversed_at IS NOT NULL OR charge.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento estornado ou cobrança cancelada não recebem valores.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT sum(amount) FROM public.payment_allocations WHERE payment_id = NEW.payment_id) > payment.amount THEN
    RAISE EXCEPTION 'O pagamento foi distribuído além do valor recebido.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT sum(amount) FROM public.payment_allocations WHERE charge_id = NEW.charge_id) > charge.amount - charge.discount THEN
    RAISE EXCEPTION 'A cobrança recebeu mais do que o valor devido.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payment_allocations_check AFTER INSERT OR UPDATE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION private.check_allocation();

CREATE FUNCTION private.charge_paid(charge uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id WHERE a.charge_id = charge AND p.reversed_at IS NULL
$$;

-- Crédito: recebido e não distribuído.
CREATE FUNCTION private.patient_credit(patient uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(amount) FROM public.payments WHERE patient_id = patient AND reversed_at IS NULL), 0)
    - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a JOIN public.payments p ON p.id = a.payment_id
        WHERE p.patient_id = patient AND p.reversed_at IS NULL), 0)
$$;

-- Usa o crédito do paciente (pagamentos mais antigos primeiro) para abater a cobrança.
CREATE FUNCTION private.apply_credit(charge uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.charges;
  open_amount numeric;
  available record;
  applied numeric := 0;
  portion numeric;
BEGIN
  SELECT * INTO target FROM public.charges WHERE id = charge;
  IF target.id IS NULL OR target.cancelled_at IS NOT NULL THEN RETURN 0; END IF;
  open_amount := target.amount - target.discount - private.charge_paid(charge);
  FOR available IN
    SELECT p.id, p.amount - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.payment_id = p.id), 0) AS remaining
    FROM public.payments p WHERE p.patient_id = target.patient_id AND p.reversed_at IS NULL
    ORDER BY p.received_at, p.created_at
  LOOP
    EXIT WHEN open_amount <= 0;
    CONTINUE WHEN available.remaining <= 0;
    portion := least(open_amount, available.remaining);
    INSERT INTO public.payment_allocations (payment_id, charge_id, amount) VALUES (available.id, charge, portion)
    ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount = public.payment_allocations.amount + EXCLUDED.amount;
    open_amount := open_amount - portion;
    applied := applied + portion;
  END LOOP;
  RETURN applied;
END $$;

-- Cobrança automática a partir da sessão -------------------------------------------------------
-- Realizada: 100%. Falta: % da política. Cancelada pelo paciente com menos de X horas: % da política.
-- Demais situações: sem cobrança (uma cobrança automática existente é cancelada e o que foi pago
-- volta a ser crédito). Valor a definir quando não há preço cadastrado.

CREATE FUNCTION private.sync_appointment_charge() RETURNS trigger
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
    INSERT INTO public.charges (patient_id, professional_id, appointment_id, description, competence_date, due_date, amount)
    VALUES (NEW.patient_id, NEW.professional_id, NEW.id, label, day, day, value)
    RETURNING * INTO existing;
  ELSIF existing.cancelled_at IS NOT NULL THEN
    UPDATE public.charges SET cancelled_at = NULL, cancellation_reason = NULL, description = label, amount = value,
      discount = least(discount, value), updated_at = now() WHERE id = existing.id;
  ELSIF existing.amount <> value AND private.charge_paid(existing.id) <= value - least(existing.discount, value) THEN
    UPDATE public.charges SET description = label, amount = value, discount = least(discount, value), updated_at = now()
    WHERE id = existing.id;
  END IF;
  PERFORM private.apply_credit(existing.id);
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_charge AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION private.sync_appointment_charge();

-- Despesas ------------------------------------------------------------------------------------

CREATE TABLE public.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO public.cost_centers (name) VALUES ('Administrativo'), ('Atendimento clínico'), ('Comercial e marketing');
INSERT INTO public.finance_categories (name) VALUES ('Aluguel'), ('Salários e pró-labore'), ('Impostos'), ('Marketing'),
  ('Sistemas'), ('Materiais'), ('Outros');

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  supplier text,
  category_id uuid NOT NULL REFERENCES public.finance_categories(id),
  cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  competence_date date NOT NULL,
  due_date date NOT NULL,
  paid_at date,
  method text CHECK (method IN ('pix', 'cash', 'debit', 'credit', 'transfer', 'boleto')),
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_competence_idx ON public.expenses (competence_date);
CREATE INDEX expenses_paid_idx ON public.expenses (paid_at);

-- Repasses ------------------------------------------------------------------------------------

-- Percentual da profissional sobre o valor recebido (tabela própria: colegas não veem).
CREATE TABLE public.payout_settings (
  professional_id uuid PRIMARY KEY REFERENCES public.professionals(id),
  percent numeric(5,2) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Fechamento do mês: valores congelados no momento do pagamento do repasse.
CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  received_base numeric(12,2) NOT NULL,
  percent numeric(5,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid_at date NOT NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professional_id, month)
);

-- Auditoria das criações financeiras.
CREATE TRIGGER audit_charges AFTER INSERT ON public.charges FOR EACH ROW EXECUTE FUNCTION private.audit_insert('charge');
CREATE TRIGGER audit_payments AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION private.audit_insert('payment');
CREATE TRIGGER audit_expenses AFTER INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.audit_insert('expense');
CREATE TRIGGER audit_expenses_update AFTER UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.audit_update('expense');
CREATE TRIGGER audit_payouts AFTER INSERT ON public.payouts FOR EACH ROW EXECUTE FUNCTION private.audit_insert('payout');

-- Acesso direto às tabelas ----------------------------------------------------------------------
-- Cobranças, pagamentos e repasses só por funções (somas e regras no banco). Despesas, categorias,
-- centros de custo e preços: tabela com RLS por permissão.

ALTER TABLE public.session_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.session_prices, public.patient_prices, public.charges, public.payments, public.payment_allocations,
  public.cost_centers, public.finance_categories, public.expenses, public.payout_settings, public.payouts FROM anon;
REVOKE ALL ON public.charges, public.payments, public.payment_allocations, public.payout_settings, public.payouts,
  public.patient_prices FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.session_prices, public.cost_centers, public.finance_categories, public.expenses
  FROM authenticated;

CREATE POLICY "preços: quem vê cobranças lê" ON public.session_prices FOR SELECT TO authenticated
  USING (private.has_permission('billing.view') OR private.has_permission('finance.view'));
CREATE POLICY "preços: quem gerencia o financeiro altera" ON public.session_prices FOR ALL TO authenticated
  USING (private.has_permission('finance.manage')) WITH CHECK (private.has_permission('finance.manage'));
CREATE POLICY "centros de custo: financeiro lê" ON public.cost_centers FOR SELECT TO authenticated
  USING (private.has_permission('finance.view'));
CREATE POLICY "centros de custo: financeiro altera" ON public.cost_centers FOR ALL TO authenticated
  USING (private.has_permission('finance.manage')) WITH CHECK (private.has_permission('finance.manage'));
CREATE POLICY "categorias: financeiro lê" ON public.finance_categories FOR SELECT TO authenticated
  USING (private.has_permission('finance.view'));
CREATE POLICY "categorias: financeiro altera" ON public.finance_categories FOR ALL TO authenticated
  USING (private.has_permission('finance.manage')) WITH CHECK (private.has_permission('finance.manage'));
CREATE POLICY "despesas: financeiro lê" ON public.expenses FOR SELECT TO authenticated
  USING (private.has_permission('finance.view'));
CREATE POLICY "despesas: financeiro lança" ON public.expenses FOR ALL TO authenticated
  USING (private.has_permission('finance.manage')) WITH CHECK (private.has_permission('finance.manage'));

-- Funções: cobranças e pagamentos ------------------------------------------------------------

-- Situação calculada de cada cobrança. Quem tem billing.view vê todas; a profissional, as dos
-- próprios atendimentos (só leitura). p_open: só as que ainda têm saldo, de qualquer data.
CREATE FUNCTION public.charge_list(p_from date, p_to date, p_patient_id uuid DEFAULT NULL, p_open boolean DEFAULT false)
RETURNS TABLE (
  id uuid, patient_id uuid, patient_name text, professional_id uuid, professional_name text, appointment_id uuid,
  description text, competence_date date, due_date date, amount numeric, discount numeric, paid numeric, balance numeric,
  status text, cancelled_at timestamptz, cancellation_reason text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.patient_id, p.name, c.professional_id, pr.name, c.appointment_id, c.description, c.competence_date,
    c.due_date, c.amount, c.discount, paid.value, c.amount - c.discount - paid.value,
    CASE WHEN c.cancelled_at IS NOT NULL THEN 'cancelled'
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
    AND (CASE WHEN p_open THEN c.cancelled_at IS NULL AND c.amount - c.discount - paid.value > 0
      ELSE c.competence_date >= p_from AND c.competence_date <= p_to END)
  ORDER BY c.competence_date DESC, c.created_at DESC
$$;

CREATE FUNCTION public.payment_list(p_from date, p_to date, p_patient_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, patient_id uuid, patient_name text, amount numeric, allocated numeric, method text, received_at date,
  notes text, reversed_at timestamptz, reversal_reason text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission('billing.view') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pay.id, pay.patient_id, p.name, pay.amount,
    coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.payment_id = pay.id), 0),
    pay.method, pay.received_at, pay.notes, pay.reversed_at, pay.reversal_reason, pay.created_at
  FROM public.payments pay JOIN public.patients p ON p.id = pay.patient_id
  WHERE (p_patient_id IS NULL OR pay.patient_id = p_patient_id)
    AND (p_patient_id IS NOT NULL OR (pay.received_at >= p_from AND pay.received_at <= p_to))
  ORDER BY pay.received_at DESC, pay.created_at DESC;
END $$;

CREATE FUNCTION public.patient_credit(p_patient_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission('billing.view') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN private.patient_credit(p_patient_id);
END $$;

CREATE FUNCTION private.require_permission(wanted text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(wanted) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Registra um pagamento e o distribui pelas cobranças escolhidas, na ordem; o que sobrar vira crédito.
CREATE FUNCTION public.register_payment(
  p_patient_id uuid, p_amount numeric, p_method text, p_received_at date, p_charge_ids uuid[], p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  payment uuid;
  remaining numeric := p_amount;
  target uuid;
  open_amount numeric;
  portion numeric;
BEGIN
  PERFORM private.require_permission('billing.manage');
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF p_received_at IS NULL OR p_received_at > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Informe a data do recebimento (não pode ser futura).' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.payments (patient_id, amount, method, received_at, notes)
  VALUES (p_patient_id, round(p_amount, 2), p_method, p_received_at, nullif(trim(p_notes), ''))
  RETURNING id INTO payment;

  FOREACH target IN ARRAY coalesce(p_charge_ids, ARRAY[]::uuid[]) LOOP
    EXIT WHEN remaining <= 0;
    SELECT c.amount - c.discount - private.charge_paid(c.id) INTO open_amount
    FROM public.charges c WHERE c.id = target AND c.patient_id = p_patient_id AND c.cancelled_at IS NULL;
    IF open_amount IS NULL THEN
      RAISE EXCEPTION 'Cobrança inválida para este paciente.' USING ERRCODE = 'P0001';
    END IF;
    CONTINUE WHEN open_amount <= 0;
    portion := least(open_amount, remaining);
    INSERT INTO public.payment_allocations (payment_id, charge_id, amount) VALUES (payment, target, portion);
    remaining := remaining - portion;
  END LOOP;
  RETURN payment;
END $$;

-- Estorno: o pagamento continua no histórico, marcado; as cobranças voltam a ficar em aberto.
CREATE FUNCTION public.reverse_payment(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.manage');
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo do estorno.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_id AND reversed_at IS NULL) THEN
    RAISE EXCEPTION 'Pagamento não encontrado ou já estornado.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.payment_allocations WHERE payment_id = p_id;
  UPDATE public.payments SET reversed_at = now(), reversal_reason = trim(p_reason) WHERE id = p_id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'reverse', 'payment', p_id);
END $$;

CREATE FUNCTION public.apply_patient_credit(p_charge_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.manage');
  RETURN private.apply_credit(p_charge_id);
END $$;

-- Cobrança manual (ex.: pacote, taxa, documento). Abate crédito disponível.
CREATE FUNCTION public.create_charge(
  p_patient_id uuid, p_professional_id uuid, p_description text, p_amount numeric, p_competence_date date, p_due_date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  created uuid;
BEGIN
  PERFORM private.require_permission('billing.manage');
  INSERT INTO public.charges (patient_id, professional_id, description, competence_date, due_date, amount)
  VALUES (p_patient_id, p_professional_id, trim(p_description), p_competence_date, coalesce(p_due_date, p_competence_date), round(p_amount, 2))
  RETURNING id INTO created;
  PERFORM private.apply_credit(created);
  RETURN created;
END $$;

-- Ajuste de valor, desconto, vencimento ou descrição. Não pode ficar abaixo do que já foi pago.
CREATE FUNCTION public.update_charge(p_id uuid, p_amount numeric, p_discount numeric, p_due_date date, p_description text)
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
    due_date = coalesce(p_due_date, due_date), description = coalesce(nullif(trim(p_description), ''), description), updated_at = now()
  WHERE id = p_id;
  PERFORM private.apply_credit(p_id);
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'update', 'charge', p_id);
END $$;

-- Cancelamento: o que já tinha sido pago volta a ser crédito do paciente.
CREATE FUNCTION public.cancel_charge(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.manage');
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.charges WHERE id = p_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Cobrança não encontrada ou já cancelada.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.payment_allocations WHERE charge_id = p_id;
  UPDATE public.charges SET cancelled_at = now(), cancellation_reason = trim(p_reason), updated_at = now() WHERE id = p_id;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id) VALUES (auth.uid(), 'cancel', 'charge', p_id);
END $$;

-- Preço combinado com um paciente (nulo remove).
CREATE FUNCTION public.set_patient_price(p_patient_id uuid, p_amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.manage');
  IF p_amount IS NULL THEN
    DELETE FROM public.patient_prices WHERE patient_id = p_patient_id;
  ELSE
    INSERT INTO public.patient_prices (patient_id, amount) VALUES (p_patient_id, round(p_amount, 2))
    ON CONFLICT (patient_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
  END IF;
END $$;

CREATE FUNCTION public.patient_price(p_patient_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (private.has_permission('billing.view') OR private.has_permission('finance.view')) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT amount FROM public.patient_prices WHERE patient_id = p_patient_id);
END $$;

-- Funções: repasses e relatórios -------------------------------------------------------------

-- Valor recebido no mês (pela data do recebimento) que pertence a cada profissional.
CREATE FUNCTION private.received_for(professional uuid, month date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id JOIN public.charges c ON c.id = a.charge_id
  WHERE c.professional_id = professional AND p.reversed_at IS NULL
    AND p.received_at >= month AND p.received_at < (month + interval '1 month')::date
$$;

-- Demonstrativo do mês. Financeiro vê todas; a profissional, só o próprio.
CREATE FUNCTION public.payout_statement(p_month date)
RETURNS TABLE (
  professional_id uuid, professional_name text, received numeric, percent numeric, payout numeric,
  paid_amount numeric, paid_at date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH month AS (SELECT date_trunc('month', p_month)::date AS start)
  SELECT pr.id, pr.name, coalesce(po.received_base, private.received_for(pr.id, m.start)),
    coalesce(po.percent, ps.percent), coalesce(po.amount, round(private.received_for(pr.id, m.start) * ps.percent / 100, 2)),
    po.amount, po.paid_at
  FROM public.professionals pr CROSS JOIN month m
  LEFT JOIN public.payout_settings ps ON ps.professional_id = pr.id
  LEFT JOIN public.payouts po ON po.professional_id = pr.id AND po.month = m.start
  WHERE (private.has_permission('finance.view') OR pr.id = private.current_professional_id())
    AND (pr.active OR po.id IS NOT NULL OR private.received_for(pr.id, m.start) > 0)
  ORDER BY pr.name
$$;

CREATE FUNCTION public.set_payout_percent(p_professional_id uuid, p_percent numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.manage');
  IF p_percent IS NULL THEN
    DELETE FROM public.payout_settings WHERE professional_id = p_professional_id;
  ELSE
    INSERT INTO public.payout_settings (professional_id, percent) VALUES (p_professional_id, p_percent)
    ON CONFLICT (professional_id) DO UPDATE SET percent = EXCLUDED.percent, updated_at = now();
  END IF;
END $$;

-- Fecha o repasse do mês: congela base, percentual e valor e registra o pagamento.
CREATE FUNCTION public.close_payout(p_professional_id uuid, p_month date, p_paid_at date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  start date := date_trunc('month', p_month)::date;
  rate numeric;
  base numeric;
  created uuid;
BEGIN
  PERFORM private.require_permission('finance.manage');
  SELECT percent INTO rate FROM public.payout_settings WHERE professional_id = p_professional_id;
  IF rate IS NULL THEN
    RAISE EXCEPTION 'Defina o percentual de repasse desta profissional antes.' USING ERRCODE = 'P0001';
  END IF;
  IF start >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Só é possível fechar meses já encerrados.' USING ERRCODE = 'P0001';
  END IF;
  base := private.received_for(p_professional_id, start);
  INSERT INTO public.payouts (professional_id, month, received_base, percent, amount, paid_at)
  VALUES (p_professional_id, start, base, rate, round(base * rate / 100, 2), coalesce(p_paid_at, (now() AT TIME ZONE 'America/Sao_Paulo')::date))
  RETURNING id INTO created;
  RETURN created;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'O repasse deste mês já foi fechado.' USING ERRCODE = 'P0001';
END $$;

-- Mês a mês de um ano: faturamento (competência), recebido (caixa), despesas por competência e pagas,
-- repasses pagos e resultado de caixa. Mais o que está em aberto hoje.
CREATE FUNCTION public.finance_summary(p_year integer)
RETURNS TABLE (
  month date, billed numeric, received numeric, expenses_competence numeric, expenses_paid numeric,
  payouts_paid numeric, cash_result numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  RETURN QUERY
  WITH months AS (SELECT generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date AS start),
  figures AS (
    SELECT m.start,
      coalesce((SELECT sum(c.amount - c.discount) FROM public.charges c WHERE c.cancelled_at IS NULL
        AND c.competence_date >= m.start AND c.competence_date < (m.start + interval '1 month')::date), 0) AS billed,
      coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.reversed_at IS NULL
        AND p.received_at >= m.start AND p.received_at < (m.start + interval '1 month')::date), 0) AS received,
      coalesce((SELECT sum(e.amount) FROM public.expenses e
        WHERE e.competence_date >= m.start AND e.competence_date < (m.start + interval '1 month')::date), 0) AS expenses_competence,
      coalesce((SELECT sum(e.amount) FROM public.expenses e
        WHERE e.paid_at >= m.start AND e.paid_at < (m.start + interval '1 month')::date), 0) AS expenses_paid,
      coalesce((SELECT sum(po.amount) FROM public.payouts po
        WHERE po.paid_at >= m.start AND po.paid_at < (m.start + interval '1 month')::date), 0) AS payouts_paid
    FROM months m
  )
  SELECT f.start, f.billed, f.received, f.expenses_competence, f.expenses_paid, f.payouts_paid,
    f.received - f.expenses_paid - f.payouts_paid
  FROM figures f ORDER BY f.start;
END $$;

-- Despesas do ano por centro de custo e por categoria (competência).
CREATE FUNCTION public.expense_breakdown(p_year integer)
RETURNS TABLE (dimension text, name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  RETURN QUERY
  SELECT 'cost_center'::text, cc.name, sum(e.amount) FROM public.expenses e JOIN public.cost_centers cc ON cc.id = e.cost_center_id
  WHERE extract(year FROM e.competence_date) = p_year GROUP BY cc.name
  UNION ALL
  SELECT 'category'::text, fc.name, sum(e.amount) FROM public.expenses e JOIN public.finance_categories fc ON fc.id = e.category_id
  WHERE extract(year FROM e.competence_date) = p_year GROUP BY fc.name
  ORDER BY 1, 3 DESC;
END $$;

-- Em aberto agora (a receber e vencido), para o painel e a visão geral.
CREATE FUNCTION public.receivables_now()
RETURNS TABLE (open_amount numeric, overdue_amount numeric, overdue_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(c.balance), 0), coalesce(sum(c.balance) FILTER (WHERE c.status = 'overdue'), 0),
    count(*) FILTER (WHERE c.status = 'overdue')
  FROM public.charge_list(NULL, NULL, NULL, true) c
  WHERE private.has_permission('billing.view')
$$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.charge_list(date, date, uuid, boolean), public.payment_list(date, date, uuid),
  public.patient_credit(uuid), public.register_payment(uuid, numeric, text, date, uuid[], text),
  public.reverse_payment(uuid, text), public.apply_patient_credit(uuid),
  public.create_charge(uuid, uuid, text, numeric, date, date), public.update_charge(uuid, numeric, numeric, date, text),
  public.cancel_charge(uuid, text), public.set_patient_price(uuid, numeric), public.patient_price(uuid),
  public.payout_statement(date), public.set_payout_percent(uuid, numeric), public.close_payout(uuid, date, date),
  public.finance_summary(integer), public.expense_breakdown(integer), public.receivables_now()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charge_list(date, date, uuid, boolean), public.payment_list(date, date, uuid),
  public.patient_credit(uuid), public.register_payment(uuid, numeric, text, date, uuid[], text),
  public.reverse_payment(uuid, text), public.apply_patient_credit(uuid),
  public.create_charge(uuid, uuid, text, numeric, date, date), public.update_charge(uuid, numeric, numeric, date, text),
  public.cancel_charge(uuid, text), public.set_patient_price(uuid, numeric), public.patient_price(uuid),
  public.payout_statement(date), public.set_payout_percent(uuid, numeric), public.close_payout(uuid, date, date),
  public.finance_summary(integer), public.expense_breakdown(integer), public.receivables_now()
  TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(text), private.has_permission(text), private.is_staff(),
  private.current_professional_id(), private.cares_for(uuid), private.occupies_slot(text),
  private.sees_schedule_of(uuid), private.manages_schedule_of(uuid), private.patient_of_path(text),
  private.sees_patient(uuid), private.professional_of_path(text) TO authenticated;
