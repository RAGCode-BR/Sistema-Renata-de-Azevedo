-- Integridade financeira. Rodar com: npm run test:db
-- Tudo numa transação desfeita no final (ROLLBACK). Cada falha interrompe com "FALHA: ...".
-- Parte 1: cenários (pagamento parcial, quitação, crédito, estorno, ajuste, cancelamento, cobrança automática,
--          valor a definir) com os valores conferidos a cada passo.
-- Parte 2: conferências que valem para TODOS os lançamentos do banco (inclusive os reais).
-- Parte 3: os totais dos painéis e relatórios batem com a soma dos lançamentos.
-- Pagamentos simultâneos (duas transações) são testados em tests/db-local (precisa de duas conexões).
BEGIN;

-- Cenário ---------------------------------------------------------------------------------------
INSERT INTO public.professionals (id, name) VALUES ('00000000-0000-4000-8000-0000000f1a01', 'Teste Fin Prof');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000f1a02', 'teste-fin@example.test', '{"roles":["finance"]}', '{"name":"Teste Fin"}');
INSERT INTO public.patients (id, name) VALUES
  ('00000000-0000-4000-8000-0000000f1a03', 'Teste Fin Paciente'),
  ('00000000-0000-4000-8000-0000000f1a04', 'Teste Fin Outro Paciente');
INSERT INTO public.patient_professionals VALUES
  ('00000000-0000-4000-8000-0000000f1a03', '00000000-0000-4000-8000-0000000f1a01'),
  ('00000000-0000-4000-8000-0000000f1a04', '00000000-0000-4000-8000-0000000f1a01');
UPDATE public.clinic_settings SET missed_charge_percent = 50, late_cancel_hours = 24, late_cancel_charge_percent = 100 WHERE id;

CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO authenticated;

-- Parte 1: cenários (como o Financeiro) ----------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}', true);
DO $$
DECLARE
  p uuid := '00000000-0000-4000-8000-0000000f1a03';
  c1 uuid; c2 uuid; pay1 uuid; pay2 uuid;
  applied numeric;
  row record;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Cobrança de R$ 300 e pagamento parcial de R$ 150.
  c1 := public.create_charge(p, '00000000-0000-4000-8000-0000000f1a01', 'Teste fin pacote', 300, today, today + 10);
  pay1 := public.register_payment(p, 150, 'pix', today, ARRAY[c1], NULL);
  SELECT * INTO row FROM public.charge_list(NULL, NULL, p, true) WHERE id = c1;
  IF row.paid <> 150 OR row.balance <> 150 OR row.status <> 'partial' THEN RAISE EXCEPTION 'FALHA: pagamento parcial: %', row; END IF;

  -- Pagamento maior que o saldo: quita e o resto vira crédito.
  pay2 := public.register_payment(p, 200, 'cash', today, ARRAY[c1], NULL);
  SELECT * INTO row FROM public.charge_list(today - 1, today + 1, p, false) WHERE id = c1;
  IF row.paid <> 300 OR row.balance <> 0 OR row.status <> 'paid' OR public.patient_credit(p) <> 50 THEN
    RAISE EXCEPTION 'FALHA: quitação com sobra (crédito %): %', public.patient_credit(p), row;
  END IF;

  -- Nova cobrança usa o crédito sozinha.
  c2 := public.create_charge(p, NULL, 'Teste fin taxa', 80, today, today);
  SELECT * INTO row FROM public.charge_list(today - 1, today + 1, p, false) WHERE id = c2;
  IF row.paid <> 50 OR row.balance <> 30 OR public.patient_credit(p) <> 0 THEN RAISE EXCEPTION 'FALHA: uso do crédito: %', row; END IF;

  -- Estorno do pagamento de R$ 200: as cobranças voltam a ficar em aberto, nada de crédito.
  PERFORM public.reverse_payment(pay2, 'Teste de estorno');
  IF (SELECT balance FROM public.charge_list(today - 1, today + 1, p, false) WHERE id = c1) <> 150
    OR (SELECT balance FROM public.charge_list(today - 1, today + 1, p, false) WHERE id = c2) <> 80
    OR public.patient_credit(p) <> 0 THEN
    RAISE EXCEPTION 'FALHA: estorno não devolveu os saldos';
  END IF;
  BEGIN
    PERFORM public.reverse_payment(pay2, 'De novo');
    RAISE EXCEPTION 'FALHA: estorno duplicado aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;

  -- Ajuste abaixo do que já foi pago é recusado; desconto dentro do saldo é aceito.
  BEGIN
    PERFORM public.update_charge(c1, 100, 0, NULL, NULL);
    RAISE EXCEPTION 'FALHA: valor reduzido abaixo do já recebido';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  PERFORM public.update_charge(c1, 300, 50, NULL, NULL);
  IF (SELECT balance FROM public.charge_list(today - 1, today + 1, p, false) WHERE id = c1) <> 100 THEN
    RAISE EXCEPTION 'FALHA: desconto não abateu o saldo';
  END IF;

  -- Cancelamento de cobrança paga em parte: o pago vira crédito, que a outra cobrança aproveita só quando pedido.
  PERFORM public.cancel_charge(c1, 'Teste de cancelamento');
  IF public.patient_credit(p) <> 150 THEN RAISE EXCEPTION 'FALHA: cancelamento não devolveu crédito (%)', public.patient_credit(p); END IF;
  -- Em consultas separadas: a consulta do saldo precisa enxergar o que a aplicação gravou.
  applied := public.apply_patient_credit(c2);
  IF applied <> 80 OR public.patient_credit(p) <> 70 THEN
    RAISE EXCEPTION 'FALHA: aplicar crédito na cobrança de R$ 80 (aplicado %, sobra %)', applied, public.patient_credit(p);
  END IF;

  -- Recusas: valor zero, data futura, cobrança de outro paciente.
  BEGIN
    PERFORM public.register_payment(p, 0, 'pix', today, NULL, NULL);
    RAISE EXCEPTION 'FALHA: pagamento de R$ 0 aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.register_payment(p, 10, 'pix', today + 1, NULL, NULL);
    RAISE EXCEPTION 'FALHA: pagamento com data futura aceito';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.register_payment('00000000-0000-4000-8000-0000000f1a04', 10, 'pix', today, ARRAY[c2], NULL);
    RAISE EXCEPTION 'FALHA: pagamento de um paciente abateu cobrança de outro';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
  INSERT INTO ids VALUES ('c2', c2), ('pay1', pay1);
END $$;
RESET ROLE;

-- Distribuição gravada direto na tabela (fora das funções) também é barrada pelo banco.
DO $$ BEGIN
  BEGIN
    UPDATE public.payment_allocations SET amount = amount + 1000 WHERE payment_id = (SELECT id FROM ids WHERE name = 'pay1');
    RAISE EXCEPTION 'FALHA: distribuição além do valor do pagamento';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;

-- Cobrança automática pela sessão: realizada 100%, falta 50%, sem preço = "valor a definir";
-- sessão desmarcada pela clínica cancela a cobrança e o que foi pago vira crédito.
INSERT INTO public.session_prices (professional_id, session_type, amount) VALUES ('00000000-0000-4000-8000-0000000f1a01', 'individual', 200);
INSERT INTO public.appointments (id, patient_id, professional_id, starts_at, ends_at) VALUES
  ('00000000-0000-4000-8000-0000000f1a11', '00000000-0000-4000-8000-0000000f1a03', '00000000-0000-4000-8000-0000000f1a01', '2026-01-05 12:00+00', '2026-01-05 12:50+00'),
  ('00000000-0000-4000-8000-0000000f1a12', '00000000-0000-4000-8000-0000000f1a03', '00000000-0000-4000-8000-0000000f1a01', '2026-01-12 12:00+00', '2026-01-12 12:50+00'),
  ('00000000-0000-4000-8000-0000000f1a13', '00000000-0000-4000-8000-0000000f1a04', '00000000-0000-4000-8000-0000000f1a01', '2026-01-19 12:00+00', '2026-01-19 12:50+00');
UPDATE public.appointments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-0000000f1a11';
UPDATE public.appointments SET status = 'missed' WHERE id = '00000000-0000-4000-8000-0000000f1a12';
DELETE FROM public.session_prices WHERE professional_id = '00000000-0000-4000-8000-0000000f1a01';
UPDATE public.appointments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-0000000f1a13';
DO $$
DECLARE
  done public.charges;
  missed public.charges;
  unpriced public.charges;
  credit_before numeric := private.patient_credit('00000000-0000-4000-8000-0000000f1a03');
BEGIN
  SELECT * INTO done FROM public.charges WHERE appointment_id = '00000000-0000-4000-8000-0000000f1a11';
  SELECT * INTO missed FROM public.charges WHERE appointment_id = '00000000-0000-4000-8000-0000000f1a12';
  SELECT * INTO unpriced FROM public.charges WHERE appointment_id = '00000000-0000-4000-8000-0000000f1a13';
  -- O crédito de R$ 70 que sobrou da parte 1 abate a primeira cobrança automática.
  IF done.amount <> 200 OR missed.amount <> 100 OR private.charge_paid(done.id) <> 70 OR credit_before <> 0 THEN
    RAISE EXCEPTION 'FALHA: cobranças automáticas (realizada %, falta %, crédito usado %)', done.amount, missed.amount, private.charge_paid(done.id);
  END IF;
  IF NOT unpriced.price_pending OR unpriced.amount <> 0 THEN RAISE EXCEPTION 'FALHA: sessão sem preço deveria ficar "valor a definir"'; END IF;

  UPDATE public.appointments SET status = 'cancelled_by_clinic' WHERE id = '00000000-0000-4000-8000-0000000f1a11';
  SELECT * INTO done FROM public.charges WHERE appointment_id = '00000000-0000-4000-8000-0000000f1a11';
  IF done.cancelled_at IS NULL OR private.charge_paid(done.id) <> 0 OR private.patient_credit('00000000-0000-4000-8000-0000000f1a03') <> 70 THEN
    RAISE EXCEPTION 'FALHA: sessão cancelada pela clínica deveria cancelar a cobrança e devolver R$ 70 de crédito';
  END IF;
END $$;

-- "Valor a definir" aparece como em aberto, nunca como paga (como o Financeiro).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f1a02","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT status FROM public.charge_list(NULL, NULL, '00000000-0000-4000-8000-0000000f1a04', true)
      WHERE appointment_id = '00000000-0000-4000-8000-0000000f1a13') IS DISTINCT FROM 'unpriced' THEN
    RAISE EXCEPTION 'FALHA: cobrança sem preço não aparece como "valor a definir" em aberto';
  END IF;
END $$;
RESET ROLE;

-- Parte 2: conferências em todos os lançamentos do banco ---------------------------------------------
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(p.id::text, ', ') INTO found FROM public.payments p
  WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.payment_id = p.id) > p.amount;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: pagamentos distribuídos além do valor: %', found; END IF;

  SELECT string_agg(c.id::text, ', ') INTO found FROM public.charges c
  WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a JOIN public.payments p ON p.id = a.payment_id
         WHERE a.charge_id = c.id AND p.reversed_at IS NULL) > c.amount - c.discount;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: cobranças recebendo mais do que valem: %', found; END IF;

  SELECT string_agg(DISTINCT a.payment_id::text, ', ') INTO found FROM public.payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id JOIN public.charges c ON c.id = a.charge_id
  WHERE p.reversed_at IS NOT NULL OR c.cancelled_at IS NOT NULL OR p.patient_id <> c.patient_id OR a.amount <= 0;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: distribuições inválidas (estornado, cancelada, outro paciente ou valor <= 0): %', found; END IF;

  SELECT string_agg(c.id::text, ', ') INTO found FROM public.charges c
  WHERE c.amount < 0 OR c.discount < 0 OR c.discount > c.amount;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: cobranças com valor ou desconto inválido: %', found; END IF;

  SELECT string_agg(p.id::text, ', ') INTO found FROM public.payments p
  WHERE p.amount <= 0 OR (p.reversed_at IS NULL) <> (p.reversal_reason IS NULL);
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: pagamentos com valor ou estorno inválido: %', found; END IF;

  SELECT string_agg(appointment_id::text, ', ') INTO found FROM (
    SELECT appointment_id FROM public.charges WHERE appointment_id IS NOT NULL GROUP BY appointment_id HAVING count(*) > 1) d;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'FALHA: sessões com mais de uma cobrança: %', found; END IF;
END $$;

-- Parte 3: totais dos painéis e relatórios = soma dos lançamentos (como a Proprietária) ---------------
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000f1a05', 'teste-fin-dona@example.test', '{"roles":["owner"]}', '{"name":"Teste Fin Dona"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f1a05","role":"authenticated"}', true);
DO $$
DECLARE
  month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  month_end date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date;
  summary record;
  dre record;
  methods numeric;
  revenue numeric;
  allocated numeric;
  open_sum numeric;
BEGIN
  SELECT * INTO summary FROM public.finance_summary(extract(year FROM month_start)::int) s WHERE s.month = month_start;
  SELECT * INTO dre FROM public.report_dre(month_start, month_end);
  SELECT coalesce(sum(amount), 0) INTO methods FROM public.report_payment_methods(month_start, month_end);
  SELECT coalesce(sum(received), 0) INTO revenue FROM public.report_revenue(month_start, month_end);
  RESET ROLE;
  SELECT coalesce(sum(a.amount), 0) INTO allocated FROM public.payment_allocations a JOIN public.payments p ON p.id = a.payment_id
  WHERE p.reversed_at IS NULL AND p.received_at BETWEEN month_start AND month_end;
  IF summary.received <> dre.received OR dre.received <> methods
    OR dre.received <> (SELECT coalesce(sum(amount), 0) FROM public.payments WHERE reversed_at IS NULL AND received_at BETWEEN month_start AND month_end) THEN
    RAISE EXCEPTION 'FALHA: recebido do mês diferente entre painel (%), DRE (%), formas de pagamento (%)', summary.received, dre.received, methods;
  END IF;
  IF summary.billed <> dre.billed - dre.discounts
    OR dre.billed <> (SELECT coalesce(sum(amount), 0) FROM public.charges WHERE cancelled_at IS NULL AND competence_date BETWEEN month_start AND month_end) THEN
    RAISE EXCEPTION 'FALHA: faturado do mês diferente entre painel (%) e DRE (% - %)', summary.billed, dre.billed, dre.discounts;
  END IF;
  IF revenue <> allocated THEN RAISE EXCEPTION 'FALHA: recebido por profissional (%) diferente do distribuído (%)', revenue, allocated; END IF;
  SELECT coalesce(sum(c.amount - c.discount - private.charge_paid(c.id)), 0) INTO open_sum FROM public.charges c
  WHERE c.cancelled_at IS NULL AND c.amount - c.discount - private.charge_paid(c.id) > 0;
  SET LOCAL ROLE authenticated;
  IF (SELECT open_amount FROM public.receivables_now()) <> open_sum THEN
    RAISE EXCEPTION 'FALHA: total a receber do painel (%) diferente da soma dos saldos (%)', (SELECT open_amount FROM public.receivables_now()), open_sum;
  END IF;
END $$;
RESET ROLE;

-- Fluxo de caixa do Início: mesmo total da Visão geral; ano com 12 meses; Gerência não vê.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000f1a06', 'teste-fin-gerente@example.test', '{"roles":["manager"]}', '{"name":"Teste Fin Gerente"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f1a05","role":"authenticated"}', true);
DO $$
DECLARE
  month_start date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  month_end date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) + interval '1 month - 1 day')::date;
  year_start date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  summary record;
  flow record;
BEGIN
  SELECT * INTO summary FROM public.finance_summary(extract(year FROM month_start)::int) s WHERE s.month = month_start;
  SELECT sum(received) AS received, sum(expenses_paid + payouts_paid) AS out INTO flow FROM public.cash_flow(month_start, month_end, 'day');
  IF flow.received <> summary.received OR flow.received - flow.out <> summary.cash_result THEN
    RAISE EXCEPTION 'FALHA: fluxo de caixa do mês (% / %) diferente da Visão geral (% / %)', flow.received, flow.received - flow.out, summary.received, summary.cash_result;
  END IF;
  IF (SELECT count(*) FROM public.cash_flow(month_start, month_end, 'day')) <> extract(day FROM month_end)
    OR (SELECT count(*) FROM public.cash_flow(year_start, (year_start + interval '1 year - 1 day')::date, 'month')) <> 12 THEN
    RAISE EXCEPTION 'FALHA: agrupamento do fluxo de caixa por dia ou mês';
  END IF;
  BEGIN
    PERFORM * FROM public.cash_flow(year_start, (year_start + interval '2 years')::date, 'month');
    RAISE EXCEPTION 'FALHA: fluxo de caixa aceitou período maior que um ano';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000f1a06","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.cash_flow(current_date, current_date, 'day');
    RAISE EXCEPTION 'FALHA: Gerência viu o fluxo de caixa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'Todas as verificações financeiras passaram.' AS resultado;
ROLLBACK;
