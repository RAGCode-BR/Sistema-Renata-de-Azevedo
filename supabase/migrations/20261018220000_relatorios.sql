-- Bloco 9: relatórios. Só leitura: funções que somam no banco e conferem a permissão de quem pede.
--
-- Quem vê:
-- - Operacional (sessões, pacientes, prontuários, tarefas): quem vê a agenda geral; a profissional, só
--   os próprios números ("Meus números").
-- - Financeiro completo (DRE, faturamento por profissional, despesas, repasses): finance.view.
-- - Inadimplência e formas de pagamento: billing.view (inclui Gerente e Recepção).
-- - Comercial: crm.view.
-- - Comparativo anual: cada linha aparece só para quem pode ver aquele dado (o resto vem nulo).
-- Datas no fuso da clínica (America/Sao_Paulo). Taxa de faltas = faltas ÷ (realizadas + faltas).

CREATE FUNCTION private.local_date(moment timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT (moment AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- Profissional cujos números a pessoa pode ver: com a agenda geral, a escolhida (nula = todas);
-- senão, só a própria. Sem nenhum dos dois, sem acesso.
CREATE FUNCTION private.report_scope(wanted uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  own uuid := private.current_professional_id();
BEGIN
  IF private.has_permission('appointments.view_all') THEN RETURN wanted; END IF;
  IF own IS NOT NULL THEN RETURN own; END IF;
  RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
END $$;

CREATE FUNCTION private.check_period(p_from date, p_to date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 3700 THEN
    RAISE EXCEPTION 'Período inválido (até 10 anos).' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Operacional -----------------------------------------------------------------------------------

-- Sessões do período por profissional, tipo e modalidade. Cancelamento tardio: pelo paciente, com o
-- cancelamento registrado dentro da antecedência mínima da política de cobrança.
CREATE FUNCTION public.report_sessions(p_from date, p_to date, p_professional_id uuid DEFAULT NULL)
RETURNS TABLE (
  professional_id uuid, professional_name text, session_type text, modality text,
  total bigint, completed bigint, missed bigint, cancelled_by_patient bigint, late_cancel bigint, cancelled_by_clinic bigint,
  rescheduled bigint, unrecorded bigint, upcoming bigint, completed_minutes bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  scope uuid := private.report_scope(p_professional_id);
  late_hours integer := (SELECT late_cancel_hours FROM public.clinic_settings LIMIT 1);
BEGIN
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT a.professional_id, pr.name, a.session_type, a.modality, count(*),
    count(*) FILTER (WHERE a.status = 'completed'),
    count(*) FILTER (WHERE a.status = 'missed'),
    count(*) FILTER (WHERE a.status = 'cancelled_by_patient'),
    count(*) FILTER (WHERE a.status = 'cancelled_by_patient' AND (
      SELECT max(e.created_at) FROM public.appointment_events e WHERE e.appointment_id = a.id AND e.to_status = 'cancelled_by_patient'
    ) > a.starts_at - make_interval(hours => late_hours)),
    count(*) FILTER (WHERE a.status = 'cancelled_by_clinic'),
    count(*) FILTER (WHERE a.status = 'rescheduled'),
    count(*) FILTER (WHERE a.status IN ('scheduled', 'awaiting_confirmation', 'confirmed') AND a.ends_at <= now()),
    count(*) FILTER (WHERE a.status IN ('scheduled', 'awaiting_confirmation', 'confirmed') AND a.ends_at > now()),
    coalesce(sum(extract(epoch FROM a.ends_at - a.starts_at) / 60) FILTER (WHERE a.status = 'completed'), 0)::bigint
  FROM public.appointments a JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE private.local_date(a.starts_at) BETWEEN p_from AND p_to AND (scope IS NULL OR a.professional_id = scope)
  GROUP BY a.professional_id, pr.name, a.session_type, a.modality
  ORDER BY pr.name, a.session_type, a.modality;
END $$;

-- Pacientes: situação atual, cadastros no período e retenção. Retenção: dos pacientes cuja primeira
-- sessão realizada com a profissional caiu no período, quantos tiveram outra sessão realizada 4 (e 12)
-- semanas ou mais depois. Só entra na conta quem já teve tempo para isso.
CREATE FUNCTION public.report_patients(p_from date, p_to date, p_professional_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  scope uuid := private.report_scope(p_professional_id);
  result jsonb;
BEGIN
  PERFORM private.check_period(p_from, p_to);
  WITH visible AS (
    SELECT p.* FROM public.patients p
    WHERE scope IS NULL OR EXISTS (SELECT 1 FROM public.patient_professionals pp WHERE pp.patient_id = p.id AND pp.professional_id = scope)
  ),
  firsts AS (
    SELECT a.patient_id, a.professional_id, min(a.starts_at) AS first_at
    FROM public.appointments a WHERE a.status = 'completed' AND (scope IS NULL OR a.professional_id = scope)
    GROUP BY a.patient_id, a.professional_id
  ),
  cohort AS (
    SELECT f.*, pr.name AS professional_name,
      EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = f.patient_id AND a.professional_id = f.professional_id
        AND a.status = 'completed' AND a.starts_at >= f.first_at + interval '28 days') AS kept_4,
      EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = f.patient_id AND a.professional_id = f.professional_id
        AND a.status = 'completed' AND a.starts_at >= f.first_at + interval '84 days') AS kept_12
    FROM firsts f JOIN public.professionals pr ON pr.id = f.professional_id
    WHERE private.local_date(f.first_at) BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'status', (SELECT jsonb_build_object(
      'active', count(*) FILTER (WHERE status = 'active'), 'paused', count(*) FILTER (WHERE status = 'paused'),
      'discharged', count(*) FILTER (WHERE status = 'discharged'), 'inactive', count(*) FILTER (WHERE status = 'inactive')) FROM visible),
    'registered', (SELECT count(*) FROM visible WHERE private.local_date(created_at) BETWEEN p_from AND p_to),
    'retention', coalesce((SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT c.professional_id, c.professional_name AS name, count(*) AS started,
        count(*) FILTER (WHERE c.first_at <= now() - interval '28 days') AS eligible_4,
        count(*) FILTER (WHERE c.first_at <= now() - interval '28 days' AND c.kept_4) AS kept_4,
        count(*) FILTER (WHERE c.first_at <= now() - interval '84 days') AS eligible_12,
        count(*) FILTER (WHERE c.first_at <= now() - interval '84 days' AND c.kept_12) AS kept_12
      FROM cohort c GROUP BY c.professional_id, c.professional_name) x), '[]')
  ) INTO result;
  RETURN result;
END $$;

-- Tarefas por responsável: criadas e concluídas no período, no prazo, e o que está aberto e atrasado agora.
-- Quem acompanha a equipe vê todos; os demais, só as próprias.
CREATE FUNCTION public.report_tasks(p_from date, p_to date)
RETURNS TABLE (assignee_id uuid, assignee_name text, created bigint, done bigint, done_on_time bigint, open_now bigint, overdue_now bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  team boolean := private.has_permission('tasks.manage');
BEGIN
  PERFORM private.require_staff();
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT t.assignee_id, coalesce(p.name, 'Sem responsável'),
    count(*) FILTER (WHERE private.local_date(t.created_at) BETWEEN p_from AND p_to),
    count(*) FILTER (WHERE t.status = 'done' AND private.local_date(t.completed_at) BETWEEN p_from AND p_to),
    count(*) FILTER (WHERE t.status = 'done' AND private.local_date(t.completed_at) BETWEEN p_from AND p_to
      AND (t.due_date IS NULL OR private.local_date(t.completed_at) <= t.due_date)),
    count(*) FILTER (WHERE t.status IN ('todo', 'doing')),
    count(*) FILTER (WHERE t.status IN ('todo', 'doing') AND t.due_date < private.local_today())
  FROM public.tasks t LEFT JOIN public.profiles p ON p.id = t.assignee_id
  WHERE team OR t.assignee_id = auth.uid()
  GROUP BY t.assignee_id, p.name
  HAVING count(*) FILTER (WHERE private.local_date(t.created_at) BETWEEN p_from AND p_to) > 0
    OR count(*) FILTER (WHERE t.status = 'done' AND private.local_date(t.completed_at) BETWEEN p_from AND p_to) > 0
    OR count(*) FILTER (WHERE t.status IN ('todo', 'doing')) > 0
  ORDER BY 2;
END $$;

-- Financeiro ------------------------------------------------------------------------------------

-- DRE simplificada mês a mês. Competência: faturado, descontos, despesas e repasses do mês de referência.
-- Caixa: recebido, despesas pagas e repasses pagos no mês. Despesas por categoria (competência) em jsonb.
CREATE FUNCTION public.report_dre(p_from date, p_to date)
RETURNS TABLE (
  month date, billed numeric, discounts numeric, received numeric, expenses_competence numeric, expenses_paid numeric,
  payouts_competence numeric, payouts_paid numeric, categories jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  WITH months AS (
    SELECT generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date AS start
  )
  SELECT m.start,
    coalesce((SELECT sum(c.amount) FROM public.charges c WHERE c.cancelled_at IS NULL
      AND date_trunc('month', c.competence_date) = m.start), 0),
    coalesce((SELECT sum(c.discount) FROM public.charges c WHERE c.cancelled_at IS NULL
      AND date_trunc('month', c.competence_date) = m.start), 0),
    coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.reversed_at IS NULL AND date_trunc('month', p.received_at) = m.start), 0),
    coalesce((SELECT sum(e.amount) FROM public.expenses e WHERE date_trunc('month', e.competence_date) = m.start), 0),
    coalesce((SELECT sum(e.amount) FROM public.expenses e WHERE date_trunc('month', e.paid_at) = m.start), 0),
    coalesce((SELECT sum(po.amount) FROM public.payouts po WHERE po.month = m.start), 0),
    coalesce((SELECT sum(po.amount) FROM public.payouts po WHERE date_trunc('month', po.paid_at) = m.start), 0),
    coalesce((SELECT jsonb_object_agg(x.name, x.amount) FROM (
      SELECT fc.name, sum(e.amount) AS amount FROM public.expenses e JOIN public.finance_categories fc ON fc.id = e.category_id
      WHERE date_trunc('month', e.competence_date) = m.start GROUP BY fc.name) x), '{}')
  FROM months m ORDER BY m.start;
END $$;

-- Faturado (competência) e recebido (caixa) por profissional e tipo de sessão. Cobrança avulsa: tipo nulo.
CREATE FUNCTION public.report_revenue(p_from date, p_to date)
RETURNS TABLE (professional_id uuid, professional_name text, session_type text, charges bigint, billed numeric, received numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  WITH keyed AS (
    SELECT c.id, c.professional_id, a.session_type, c.amount - c.discount AS net, c.competence_date, c.cancelled_at
    FROM public.charges c LEFT JOIN public.appointments a ON a.id = c.appointment_id
  ),
  facts AS (
    SELECT k.professional_id, k.session_type, 1 AS n, k.net AS billed, 0::numeric AS received FROM keyed k
    WHERE k.cancelled_at IS NULL AND k.competence_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT k.professional_id, k.session_type, 0, 0, al.amount
    FROM public.payment_allocations al JOIN public.payments p ON p.id = al.payment_id JOIN keyed k ON k.id = al.charge_id
    WHERE p.reversed_at IS NULL AND p.received_at BETWEEN p_from AND p_to
  )
  SELECT f.professional_id, pr.name, f.session_type, sum(f.n)::bigint, sum(f.billed), sum(f.received)
  FROM facts f LEFT JOIN public.professionals pr ON pr.id = f.professional_id
  GROUP BY f.professional_id, pr.name, f.session_type
  ORDER BY 2 NULLS LAST, 3 NULLS LAST;
END $$;

CREATE FUNCTION public.report_payment_methods(p_from date, p_to date)
RETURNS TABLE (method text, payments bigint, amount numeric, reversed numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT p.method, count(*) FILTER (WHERE p.reversed_at IS NULL), coalesce(sum(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0),
    coalesce(sum(p.amount) FILTER (WHERE p.reversed_at IS NOT NULL), 0)
  FROM public.payments p WHERE p.received_at BETWEEN p_from AND p_to
  GROUP BY p.method ORDER BY 3 DESC;
END $$;

-- Inadimplência hoje por paciente, por faixa de atraso (dias desde o vencimento).
CREATE FUNCTION public.report_aging()
RETURNS TABLE (
  patient_id uuid, patient_name text, phone text, not_due numeric, up_to_30 numeric, up_to_60 numeric, over_60 numeric,
  total numeric, oldest_due date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('billing.view');
  RETURN QUERY
  SELECT c.patient_id, c.patient_name, p.phone,
    coalesce(sum(c.balance) FILTER (WHERE c.due_date >= private.local_today()), 0),
    coalesce(sum(c.balance) FILTER (WHERE private.local_today() - c.due_date BETWEEN 1 AND 30), 0),
    coalesce(sum(c.balance) FILTER (WHERE private.local_today() - c.due_date BETWEEN 31 AND 60), 0),
    coalesce(sum(c.balance) FILTER (WHERE private.local_today() - c.due_date > 60), 0),
    sum(c.balance), min(c.due_date)
  FROM public.charge_list(NULL, NULL, NULL, true) c JOIN public.patients p ON p.id = c.patient_id
  WHERE c.balance > 0
  GROUP BY c.patient_id, c.patient_name, p.phone
  ORDER BY min(c.due_date);
END $$;

-- Despesas do período por categoria e centro de custo (competência e pagas).
CREATE FUNCTION public.report_expenses(p_from date, p_to date)
RETURNS TABLE (dimension text, name text, competence numeric, paid numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT 'category'::text, fc.name,
    coalesce(sum(e.amount) FILTER (WHERE e.competence_date BETWEEN p_from AND p_to), 0),
    coalesce(sum(e.amount) FILTER (WHERE e.paid_at BETWEEN p_from AND p_to), 0)
  FROM public.expenses e JOIN public.finance_categories fc ON fc.id = e.category_id
  WHERE e.competence_date BETWEEN p_from AND p_to OR e.paid_at BETWEEN p_from AND p_to GROUP BY fc.name
  UNION ALL
  SELECT 'cost_center'::text, cc.name,
    coalesce(sum(e.amount) FILTER (WHERE e.competence_date BETWEEN p_from AND p_to), 0),
    coalesce(sum(e.amount) FILTER (WHERE e.paid_at BETWEEN p_from AND p_to), 0)
  FROM public.expenses e JOIN public.cost_centers cc ON cc.id = e.cost_center_id
  WHERE e.competence_date BETWEEN p_from AND p_to OR e.paid_at BETWEEN p_from AND p_to GROUP BY cc.name
  ORDER BY 1, 3 DESC;
END $$;

-- Repasses mês a mês (mesmo cálculo do demonstrativo; meses abertos são prévia).
CREATE FUNCTION public.report_payouts(p_from date, p_to date)
RETURNS TABLE (month date, professional_id uuid, professional_name text, received numeric, percent numeric, payout numeric, paid_at date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT m.start, s.professional_id, s.professional_name, s.received, s.percent, s.payout, s.paid_at
  FROM generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') AS m_raw
  CROSS JOIN LATERAL (SELECT m_raw::date AS start) m
  CROSS JOIN LATERAL public.payout_statement(m.start) s
  WHERE s.received > 0 OR s.paid_at IS NOT NULL
  ORDER BY m.start, s.professional_name;
END $$;

-- Comercial -------------------------------------------------------------------------------------

-- Campanhas com os leads que entraram no período (investimento é o total da campanha).
CREATE FUNCTION public.report_campaigns(p_from date, p_to date)
RETURNS TABLE (
  id uuid, name text, source_name text, budget numeric, leads bigint, converted bigint, lost bigint, attended bigint, revenue numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  money_ok boolean := private.has_permission('billing.view') OR private.has_permission('finance.view');
BEGIN
  PERFORM private.require_permission('crm.view');
  PERFORM private.check_period(p_from, p_to);
  RETURN QUERY
  SELECT c.id, c.name, s.name, c.budget, count(l.id),
    count(l.id) FILTER (WHERE st.kind = 'won'), count(l.id) FILTER (WHERE st.kind = 'lost'),
    count(l.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = l.patient_id AND a.status = 'completed')),
    CASE WHEN money_ok THEN coalesce(sum((SELECT sum(p.amount) FROM public.payments p WHERE p.patient_id = l.patient_id AND p.reversed_at IS NULL)), 0) END
  FROM public.campaigns c
  LEFT JOIN public.lead_sources s ON s.id = c.source_id
  JOIN public.leads l ON l.campaign_id = c.id AND private.local_date(l.created_at) BETWEEN p_from AND p_to
  LEFT JOIN public.lead_stages st ON st.id = l.stage_id
  GROUP BY c.id, s.name
  ORDER BY count(l.id) DESC, c.name;
END $$;

-- Comparativo anual -----------------------------------------------------------------------------

-- Indicadores mês a mês de um ano. Cada grupo vem nulo para quem não pode vê-lo; a profissional sem
-- agenda geral vê as próprias sessões e os próprios pacientes novos.
CREATE FUNCTION public.report_year(p_year integer)
RETURNS TABLE (
  month date, billed numeric, received numeric, expenses_paid numeric, cash_result numeric,
  completed bigint, missed bigint, cancelled bigint, new_patients bigint, leads bigint, converted bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  finance boolean := private.has_permission('finance.view');
  all_sessions boolean := private.has_permission('appointments.view_all');
  own uuid := private.current_professional_id();
  sessions boolean := all_sessions OR own IS NOT NULL;
  crm boolean := private.has_permission('crm.view');
BEGIN
  PERFORM private.require_staff();
  IF p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Ano inválido.' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY
  WITH months AS (SELECT generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date AS start),
  appts AS (
    SELECT date_trunc('month', private.local_date(a.starts_at))::date AS start, a.status FROM public.appointments a
    WHERE sessions AND extract(year FROM private.local_date(a.starts_at)) = p_year AND (all_sessions OR a.professional_id = own)
  ),
  pay AS (
    SELECT date_trunc('month', p.received_at)::date AS start, sum(p.amount) AS amount FROM public.payments p
    WHERE finance AND p.reversed_at IS NULL AND extract(year FROM p.received_at) = p_year GROUP BY 1
  ),
  bill AS (
    SELECT date_trunc('month', c.competence_date)::date AS start, sum(c.amount - c.discount) AS amount FROM public.charges c
    WHERE finance AND c.cancelled_at IS NULL AND extract(year FROM c.competence_date) = p_year GROUP BY 1
  ),
  spent AS (
    SELECT x.start, sum(x.amount) AS amount FROM (
      SELECT date_trunc('month', e.paid_at)::date AS start, e.amount FROM public.expenses e WHERE finance AND extract(year FROM e.paid_at) = p_year
      UNION ALL
      SELECT date_trunc('month', po.paid_at)::date, po.amount FROM public.payouts po WHERE finance AND extract(year FROM po.paid_at) = p_year
    ) x GROUP BY x.start
  ),
  expense AS (
    SELECT date_trunc('month', e.paid_at)::date AS start, sum(e.amount) AS amount FROM public.expenses e
    WHERE finance AND extract(year FROM e.paid_at) = p_year GROUP BY 1
  )
  SELECT m.start,
    CASE WHEN finance THEN coalesce(bi.amount, 0) END, CASE WHEN finance THEN coalesce(pa.amount, 0) END,
    CASE WHEN finance THEN coalesce(ex.amount, 0) END, CASE WHEN finance THEN coalesce(pa.amount, 0) - coalesce(sp.amount, 0) END,
    CASE WHEN sessions THEN (SELECT count(*) FROM appts x WHERE x.start = m.start AND x.status = 'completed') END,
    CASE WHEN sessions THEN (SELECT count(*) FROM appts x WHERE x.start = m.start AND x.status = 'missed') END,
    CASE WHEN sessions THEN (SELECT count(*) FROM appts x WHERE x.start = m.start AND x.status IN ('cancelled_by_patient', 'cancelled_by_clinic')) END,
    CASE WHEN sessions THEN (SELECT count(*) FROM public.patients p WHERE date_trunc('month', private.local_date(p.created_at)) = m.start
      AND (all_sessions OR EXISTS (SELECT 1 FROM public.patient_professionals pp WHERE pp.patient_id = p.id AND pp.professional_id = own))) END,
    CASE WHEN crm THEN (SELECT count(*) FROM public.leads l WHERE date_trunc('month', private.local_date(l.created_at)) = m.start) END,
    CASE WHEN crm THEN (SELECT count(*) FROM public.leads l JOIN public.lead_stages s ON s.id = l.stage_id
      WHERE s.kind = 'won' AND date_trunc('month', private.local_date(l.created_at)) = m.start) END
  FROM months m LEFT JOIN pay pa ON pa.start = m.start LEFT JOIN bill bi ON bi.start = m.start
  LEFT JOIN spent sp ON sp.start = m.start LEFT JOIN expense ex ON ex.start = m.start
  ORDER BY m.start;
END $$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.local_date(timestamptz), private.report_scope(uuid), private.check_period(date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_sessions(date, date, uuid), public.report_patients(date, date, uuid),
  public.report_tasks(date, date), public.report_dre(date, date), public.report_revenue(date, date),
  public.report_payment_methods(date, date), public.report_aging(), public.report_expenses(date, date),
  public.report_payouts(date, date), public.report_campaigns(date, date), public.report_year(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_sessions(date, date, uuid), public.report_patients(date, date, uuid),
  public.report_tasks(date, date), public.report_dre(date, date), public.report_revenue(date, date),
  public.report_payment_methods(date, date), public.report_aging(), public.report_expenses(date, date),
  public.report_payouts(date, date), public.report_campaigns(date, date), public.report_year(integer)
  TO authenticated;
