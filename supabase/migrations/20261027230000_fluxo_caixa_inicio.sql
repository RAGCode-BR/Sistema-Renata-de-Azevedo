-- Fluxo de caixa do Início (dia, semana, mês ou ano). Mesma conta do resultado de caixa da Visão geral
-- financeira (finance_summary): entradas = pagamentos recebidos (sem estornados); saídas = despesas pagas e
-- repasses pagos; saldo = entradas − saídas. Agrupado por dia ou por mês para o gráfico.
-- Só para quem vê o financeiro (Proprietária e Financeiro).
CREATE FUNCTION public.cash_flow(p_from date, p_to date, p_bucket text)
RETURNS TABLE (bucket date, received numeric, expenses_paid numeric, payouts_paid numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_permission('finance.view');
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Escolha um período de até um ano.' USING ERRCODE = 'P0001';
  END IF;
  IF p_bucket NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'Agrupamento inválido.' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  WITH buckets AS (
    SELECT generate_series(date_trunc(p_bucket, p_from::timestamp), date_trunc(p_bucket, p_to::timestamp),
      CASE p_bucket WHEN 'day' THEN interval '1 day' ELSE interval '1 month' END)::date AS start
  )
  SELECT b.start,
    coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.reversed_at IS NULL
      AND p.received_at BETWEEN p_from AND p_to AND date_trunc(p_bucket, p.received_at::timestamp)::date = b.start), 0),
    coalesce((SELECT sum(e.amount) FROM public.expenses e
      WHERE e.paid_at BETWEEN p_from AND p_to AND date_trunc(p_bucket, e.paid_at::timestamp)::date = b.start), 0),
    coalesce((SELECT sum(po.amount) FROM public.payouts po
      WHERE po.paid_at BETWEEN p_from AND p_to AND date_trunc(p_bucket, po.paid_at::timestamp)::date = b.start), 0)
  FROM buckets b ORDER BY b.start;
END $$;

REVOKE ALL ON FUNCTION public.cash_flow(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_flow(date, date, text) TO authenticated;
