-- Previsão conservadora por vencimento: apenas saldos de cobranças já lançadas
-- e despesas ainda não pagas. Valores vencidos ficam separados dos meses futuros.
CREATE FUNCTION public.finance_forecast(p_months integer DEFAULT 12)
RETURNS TABLE (month date, expected_in numeric, planned_out numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := private.local_today();
  first_month date := date_trunc('month', private.local_today())::date;
  last_day date;
BEGIN
  PERFORM private.require_permission('finance.view');
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Escolha um período de 1 a 24 meses.' USING ERRCODE = 'P0001';
  END IF;
  last_day := (first_month + make_interval(months => p_months))::date;

  RETURN QUERY
  WITH open_items AS (
    SELECT c.due_date, c.balance AS incoming, 0::numeric AS outgoing
    FROM public.charge_list(NULL, NULL, NULL, true) c
    WHERE c.balance > 0 AND c.due_date < last_day
    UNION ALL
    SELECT e.due_date, 0::numeric, e.amount
    FROM public.expenses e
    WHERE e.paid_at IS NULL AND e.due_date < last_day
  ), totals AS (
    SELECT CASE WHEN item.due_date < today THEN NULL::date ELSE date_trunc('month', item.due_date)::date END AS bucket,
      sum(item.incoming) AS incoming, sum(item.outgoing) AS outgoing
    FROM open_items item GROUP BY 1
  ), buckets AS (
    SELECT NULL::date AS bucket
    UNION ALL
    SELECT (first_month + make_interval(months => n))::date
    FROM generate_series(0, p_months - 1) n
  )
  SELECT b.bucket, coalesce(t.incoming, 0), coalesce(t.outgoing, 0),
    coalesce(t.incoming, 0) - coalesce(t.outgoing, 0)
  FROM buckets b LEFT JOIN totals t ON t.bucket IS NOT DISTINCT FROM b.bucket
  ORDER BY b.bucket NULLS FIRST;
END $$;

REVOKE ALL ON FUNCTION public.finance_forecast(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_forecast(integer) TO authenticated;
