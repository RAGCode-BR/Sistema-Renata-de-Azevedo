-- Fechar de novo o repasse de um mês já fechado: mensagem clara em vez do erro técnico da chave única.
CREATE OR REPLACE FUNCTION public.close_payout(p_professional_id uuid, p_month date, p_paid_at date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  start date := date_trunc('month', p_month)::date;
  rate numeric;
  base numeric;
  created uuid;
BEGIN
  PERFORM private.require_permission('finance.manage');
  IF NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id AND commission_sessions) THEN
    RAISE EXCEPTION 'Ative a comissão por atendimentos no cadastro da profissional.' USING ERRCODE = 'P0001';
  END IF;
  SELECT percent INTO rate FROM public.payout_settings WHERE professional_id = p_professional_id;
  IF rate IS NULL THEN
    RAISE EXCEPTION 'Defina o percentual de repasse desta profissional antes.' USING ERRCODE = 'P0001';
  END IF;
  IF start >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Só é possível fechar meses já encerrados.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payouts WHERE professional_id = p_professional_id AND month = start) THEN
    RAISE EXCEPTION 'O repasse deste mês já foi fechado.' USING ERRCODE = 'P0001';
  END IF;
  base := private.received_for(p_professional_id, start);
  INSERT INTO public.payouts (professional_id, month, received_base, percent, amount, paid_at)
  VALUES (p_professional_id, start, base, rate, round(base * rate / 100, 2), coalesce(p_paid_at, (now() AT TIME ZONE 'America/Sao_Paulo')::date))
  RETURNING id INTO created;
  RETURN created;
EXCEPTION WHEN unique_violation THEN
  -- Dois fechamentos ao mesmo tempo: o segundo encontra o primeiro já gravado.
  RAISE EXCEPTION 'O repasse deste mês já foi fechado.' USING ERRCODE = 'P0001';
END $$;
