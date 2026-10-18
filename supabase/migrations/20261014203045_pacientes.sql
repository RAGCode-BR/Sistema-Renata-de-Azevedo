-- Bloco 4: pacientes.
--
-- * Cadastro administrativo completo (nome social, CPF, endereço, responsável legal, observações).
--   Nada clínico aqui: prontuário e conceitualização têm tabelas e permissões próprias.
-- * Situação do acompanhamento: em acompanhamento, pausado, alta, encerrado.
-- * save_patient: cria ou edita o paciente e os vínculos com profissionais numa transação.
-- * Documentos administrativos num bucket privado do Storage; leitura só por link temporário.

ALTER TABLE public.patients DROP CONSTRAINT patients_status_check;
ALTER TABLE public.patients ADD CONSTRAINT patients_status_check
  CHECK (status IN ('active', 'paused', 'discharged', 'inactive'));

ALTER TABLE public.patients
  ADD COLUMN social_name text,
  ADD COLUMN cpf text CHECK (cpf ~ '^[0-9]{11}$'),
  ADD COLUMN address text,
  ADD COLUMN admin_notes text,
  ADD COLUMN guardian_name text,
  ADD COLUMN guardian_relationship text,
  ADD COLUMN guardian_phone text,
  ADD COLUMN guardian_email text;
CREATE UNIQUE INDEX patients_cpf_idx ON public.patients (cpf) WHERE cpf IS NOT NULL;

-- Registro de edições do cadastro (criações já são registradas por audit_patients).
CREATE FUNCTION private.audit_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'update', TG_ARGV[0], NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_patients_update AFTER UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION private.audit_update('patient');

-- Cria (p_id nulo) ou edita um paciente. p_data traz os campos do cadastro; p_professional_ids, as
-- profissionais responsáveis (ao menos uma). Tirar uma profissional dos vínculos tira dela o acesso
-- ao paciente; o que ela registrou no prontuário continua guardado.
CREATE FUNCTION public.save_patient(p_id uuid, p_data jsonb, p_professional_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  saved uuid;
  v_name text := trim(p_data->>'name');
  v_cpf text := nullif(regexp_replace(coalesce(p_data->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_status text := coalesce(nullif(p_data->>'status', ''), 'active');
  professionals uuid[] := ARRAY(SELECT DISTINCT unnest(p_professional_ids));
BEGIN
  IF NOT private.has_permission('patients.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_name, '') = '' OR coalesce(cardinality(professionals), 0) = 0 THEN
    RAISE EXCEPTION 'Informe nome e profissionais responsáveis.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'CPF inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cpf IS NOT NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p.cpf = v_cpf AND p.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'Já existe paciente com este CPF.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(professionals) AS chosen
    WHERE NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = chosen)) THEN
    RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.patients (name) VALUES (v_name) RETURNING id INTO saved;
  ELSE
    SELECT id INTO saved FROM public.patients WHERE id = p_id;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.patients SET
    name = v_name,
    social_name = nullif(trim(p_data->>'social_name'), ''),
    phone = nullif(trim(p_data->>'phone'), ''),
    email = nullif(lower(trim(p_data->>'email')), ''),
    birth_date = nullif(p_data->>'birth_date', '')::date,
    cpf = v_cpf,
    address = nullif(trim(p_data->>'address'), ''),
    admin_notes = nullif(trim(p_data->>'admin_notes'), ''),
    guardian_name = nullif(trim(p_data->>'guardian_name'), ''),
    guardian_relationship = nullif(trim(p_data->>'guardian_relationship'), ''),
    guardian_phone = nullif(trim(p_data->>'guardian_phone'), ''),
    guardian_email = nullif(lower(trim(p_data->>'guardian_email')), ''),
    status = v_status,
    updated_at = now()
  WHERE id = saved;

  DELETE FROM public.patient_professionals WHERE patient_id = saved AND NOT (professional_id = ANY (professionals));
  INSERT INTO public.patient_professionals (patient_id, professional_id)
  SELECT saved, unnest(professionals) ON CONFLICT DO NOTHING;
  RETURN saved;
END $$;

REVOKE ALL ON FUNCTION public.save_patient(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_patient(uuid, jsonb, uuid[]) TO authenticated;

-- Documentos administrativos ------------------------------------------------------------------
-- Arquivo em storage: patient-documents/patients/<id do paciente>/<arquivo>.
-- Quem vê o paciente (visão geral ou profissional responsável) lê; quem gerencia pacientes envia
-- e exclui. Documentos clínicos ficam com o prontuário (Bloco 5), não aqui.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('patient-documents', 'patient-documents', false, 10485760, ARRAY[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  category text NOT NULL CHECK (category IN ('identification', 'contract', 'consent', 'report', 'other')),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path LIKE 'patients/' || patient_id || '/%')
);
CREATE INDEX patient_documents_patient_idx ON public.patient_documents (patient_id, created_at);

CREATE TRIGGER audit_patient_documents AFTER INSERT ON public.patient_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_insert('patient_document');

-- Paciente do caminho "patients/<uuid>/…" (nulo se o caminho não seguir o padrão).
CREATE FUNCTION private.patient_of_path(path text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN split_part(path, '/', 1) = 'patients'
    AND split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(path, '/', 2)::uuid END
$$;

CREATE FUNCTION private.sees_patient(patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT patient IS NOT NULL AND coalesce(private.has_permission('patients.view_all') OR private.cares_for(patient), false)
$$;

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_documents FROM anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.patient_documents FROM authenticated;
CREATE POLICY "documentos: quem vê o paciente" ON public.patient_documents
  FOR SELECT TO authenticated USING (private.sees_patient(patient_id));
CREATE POLICY "documentos: quem gerencia pacientes envia" ON public.patient_documents
  FOR INSERT TO authenticated WITH CHECK (private.has_permission('patients.manage'));
CREATE POLICY "documentos: quem gerencia pacientes exclui" ON public.patient_documents
  FOR DELETE TO authenticated USING (private.has_permission('patients.manage'));

CREATE POLICY "arquivos de pacientes: leitura" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'patient-documents' AND private.sees_patient(private.patient_of_path(name)));
CREATE POLICY "arquivos de pacientes: envio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-documents' AND private.patient_of_path(name) IS NOT NULL
    AND private.has_permission('patients.manage'));
CREATE POLICY "arquivos de pacientes: exclusão" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'patient-documents' AND private.has_permission('patients.manage'));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(text), private.has_permission(text), private.is_staff(),
  private.current_professional_id(), private.cares_for(uuid), private.occupies_slot(text),
  private.sees_schedule_of(uuid), private.manages_schedule_of(uuid), private.patient_of_path(text),
  private.sees_patient(uuid) TO authenticated;
