-- Bloco 14 (integridade financeira): pagamentos registrados ao mesmo tempo.
--
-- As somas que impedem distribuir além do devido eram feitas sem travar a cobrança. Duas transações
-- simultâneas (ex.: dois cliques em "Registrar pagamento", ou o app e o computador juntos) não enxergavam
-- uma à outra e as duas passavam. Agora a cobrança (e o pagamento) ficam travados durante o cálculo: a
-- segunda espera a primeira e vê o saldo atualizado. Mesmas regras, mesmas mensagens.

CREATE OR REPLACE FUNCTION private.check_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  payment public.payments;
  charge public.charges;
BEGIN
  -- Trava a cobrança e o pagamento: outra distribuição para eles espera esta transação terminar, e as
  -- somas abaixo (consultas novas) já enxergam o que a outra gravou.
  SELECT * INTO charge FROM public.charges WHERE id = NEW.charge_id FOR UPDATE;
  SELECT * INTO payment FROM public.payments WHERE id = NEW.payment_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION private.apply_credit(charge uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.charges;
  open_amount numeric;
  available record;
  applied numeric := 0;
  portion numeric;
BEGIN
  SELECT * INTO target FROM public.charges WHERE id = charge FOR UPDATE;
  IF target.id IS NULL OR target.cancelled_at IS NOT NULL THEN RETURN 0; END IF;
  -- Créditos do paciente travados na mesma ordem em todo lugar (data, criação).
  PERFORM 1 FROM public.payments p WHERE p.patient_id = target.patient_id AND p.reversed_at IS NULL
  ORDER BY p.received_at, p.created_at, p.id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.register_payment(
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
    -- Trava antes de calcular o saldo: dois registros simultâneos para a mesma cobrança não somam além do devido.
    PERFORM 1 FROM public.charges WHERE id = target FOR UPDATE;
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
