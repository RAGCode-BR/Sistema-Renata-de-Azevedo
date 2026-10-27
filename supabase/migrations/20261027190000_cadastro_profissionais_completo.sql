-- Cadastro visual e documentos administrativos dos profissionais.
ALTER TABLE public.professionals
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN color text NOT NULL DEFAULT '#7D4B62' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN photo_path text,
  ADD COLUMN commission_sales boolean NOT NULL DEFAULT false,
  ADD COLUMN commission_sessions boolean NOT NULL DEFAULT false,
  ADD COLUMN uses_clinic_hours boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT professionals_tags_limit CHECK (cardinality(tags) <= 20),
  ADD CONSTRAINT professionals_photo_path CHECK (photo_path IS NULL OR photo_path LIKE 'professionals/' || id || '/photo/%');

UPDATE public.professionals p SET commission_sessions = true
  WHERE EXISTS (SELECT 1 FROM public.payout_settings ps WHERE ps.professional_id = p.id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('professional-files', 'professional-files', false, 10485760, ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/ogg', 'video/mp4', 'video/quicktime'
]) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.professional_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  mime_type text,
  uploaded_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path LIKE 'professionals/' || professional_id || '/files/%')
);
CREATE INDEX professional_documents_prof_time ON public.professional_documents(professional_id, created_at DESC);
ALTER TABLE public.professional_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_documents FROM anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.professional_documents FROM authenticated;
CREATE POLICY "gestão vê anexos de profissionais" ON public.professional_documents
  FOR SELECT TO authenticated USING (private.has_permission('professionals.manage'));
CREATE POLICY "gestão envia anexos de profissionais" ON public.professional_documents
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('professionals.manage'));
CREATE POLICY "gestão remove anexos de profissionais" ON public.professional_documents
  FOR DELETE TO authenticated USING (private.has_permission('professionals.manage'));

CREATE FUNCTION private.professional_file_owner(path text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN split_part(path, '/', 1) = 'professionals'
    AND split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(path, '/', 2)::uuid END
$$;
REVOKE ALL ON FUNCTION private.professional_file_owner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.professional_file_owner(text) TO authenticated;

CREATE POLICY "equipe lê fotos dos profissionais" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) = 'photo' AND private.is_staff()
    AND EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = private.professional_file_owner(name)));
CREATE POLICY "gestão lê anexos dos profissionais" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) = 'files' AND private.has_permission('professionals.manage')
    AND EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = private.professional_file_owner(name)));
CREATE POLICY "gestão envia arquivos dos profissionais" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) IN ('photo', 'files') AND private.has_permission('professionals.manage')
    AND EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = private.professional_file_owner(name)));
CREATE POLICY "gestão remove arquivos dos profissionais" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'professional-files'
    AND private.has_permission('professionals.manage')
    AND EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = private.professional_file_owner(name)));

-- O interruptor de atendimentos controla os repasses ainda não fechados.
-- Fechamentos anteriores permanecem com os valores congelados.
CREATE OR REPLACE FUNCTION public.payout_statement(p_month date)
RETURNS TABLE (professional_id uuid, professional_name text, received numeric, percent numeric,
  payout numeric, paid_amount numeric, paid_at date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH month AS (SELECT date_trunc('month', p_month)::date AS start)
  SELECT pr.id, pr.name, coalesce(po.received_base, private.received_for(pr.id, m.start)),
    CASE WHEN po.id IS NOT NULL THEN po.percent WHEN pr.commission_sessions THEN ps.percent ELSE NULL END,
    CASE WHEN po.id IS NOT NULL THEN po.amount WHEN pr.commission_sessions
      THEN round(private.received_for(pr.id, m.start) * ps.percent / 100, 2) ELSE NULL END,
    po.amount, po.paid_at
  FROM public.professionals pr CROSS JOIN month m
  LEFT JOIN public.payout_settings ps ON ps.professional_id = pr.id
  LEFT JOIN public.payouts po ON po.professional_id = pr.id AND po.month = m.start
  WHERE (private.has_permission('finance.view') OR pr.id = private.current_professional_id())
    AND (pr.active OR po.id IS NOT NULL OR private.received_for(pr.id, m.start) > 0)
  ORDER BY pr.name
$$;

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
  base := private.received_for(p_professional_id, start);
  INSERT INTO public.payouts (professional_id, month, received_base, percent, amount, paid_at)
  VALUES (p_professional_id, start, base, rate, round(base * rate / 100, 2), coalesce(p_paid_at, (now() AT TIME ZONE 'America/Sao_Paulo')::date))
  RETURNING id INTO created;
  RETURN created;
END $$;
