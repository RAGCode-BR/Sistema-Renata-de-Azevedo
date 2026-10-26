-- Campos administrativos do cadastro ampliado; conteúdo clínico continua no prontuário.
ALTER TABLE public.patients
  ADD COLUMN sex text CHECK (sex IN ('female', 'male', 'other', 'undisclosed')),
  ADD COLUMN rg text,
  ADD COLUMN occupation text,
  ADD COLUMN marital_status text CHECK (marital_status IN ('single', 'married', 'stable_union', 'divorced', 'widowed', 'other')),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN additional_contacts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(additional_contacts) = 'array' AND jsonb_array_length(additional_contacts) <= 10),
  ADD COLUMN emergency_contacts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(emergency_contacts) = 'array' AND jsonb_array_length(emergency_contacts) <= 10),
  ADD COLUMN identification_documents jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(identification_documents) = 'array' AND jsonb_array_length(identification_documents) <= 10),
  ADD COLUMN address_country text,
  ADD COLUMN address_postal_code text,
  ADD COLUMN address_state text,
  ADD COLUMN address_city text,
  ADD COLUMN address_district text,
  ADD COLUMN address_street text,
  ADD COLUMN address_number text,
  ADD COLUMN address_complement text,
  ADD COLUMN photo_path text,
  ADD COLUMN email_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN sms_opt_in boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.save_patient(p_id uuid, p_data jsonb, p_professional_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  saved uuid;
  v_name text := trim(p_data->>'name');
  v_cpf text := nullif(regexp_replace(coalesce(p_data->>'cpf', ''), '[^0-9]', '', 'g'), '');
  v_status text := coalesce(nullif(p_data->>'status', ''), 'active');
  professionals uuid[] := ARRAY(SELECT DISTINCT unnest(p_professional_ids));
  v_contacts jsonb := coalesce(p_data->'additional_contacts', '[]'::jsonb);
  v_emergency jsonb := coalesce(p_data->'emergency_contacts', '[]'::jsonb);
  v_documents jsonb := coalesce(p_data->'identification_documents', '[]'::jsonb);
  v_tags text[] := ARRAY(SELECT left(trim(value), 50) FROM jsonb_array_elements_text(coalesce(p_data->'tags', '[]'::jsonb)) AS value WHERE trim(value) <> '');
BEGIN
  IF NOT private.has_permission('patients.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  IF coalesce(v_name, '') = '' OR coalesce(cardinality(professionals), 0) = 0 THEN
    RAISE EXCEPTION 'Informe nome e profissionais responsáveis.' USING ERRCODE = 'P0001'; END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'CPF inválido.' USING ERRCODE = 'P0001'; END IF;
  IF v_cpf IS NOT NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p.cpf = v_cpf AND p.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'Já existe paciente com este CPF.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(professionals) AS chosen
    WHERE NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = chosen)) THEN
    RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(v_contacts) <> 'array' OR jsonb_array_length(v_contacts) > 10
    OR jsonb_typeof(v_emergency) <> 'array' OR jsonb_array_length(v_emergency) > 10
    OR jsonb_typeof(v_documents) <> 'array' OR jsonb_array_length(v_documents) > 10
    OR cardinality(v_tags) > 20 THEN
    RAISE EXCEPTION 'Limite de contatos, documentos ou etiquetas excedido.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_contacts) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'type', ''))) = 0
      OR length(trim(coalesce(item->>'number', ''))) = 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_emergency) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'name', ''))) = 0
      OR length(trim(coalesce(item->>'relationship', ''))) = 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_documents) item WHERE
      jsonb_typeof(item) <> 'object' OR length(trim(coalesce(item->>'type', ''))) = 0
      OR length(trim(coalesce(item->>'number', ''))) = 0) THEN
    RAISE EXCEPTION 'Preencha todos os itens adicionados ao cadastro.' USING ERRCODE = 'P0001'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.patients (name) VALUES (v_name) RETURNING id INTO saved;
  ELSE
    SELECT id INTO saved FROM public.patients WHERE id = p_id;
    IF saved IS NULL THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  UPDATE public.patients SET
    name = v_name, social_name = nullif(trim(p_data->>'social_name'), ''),
    phone = nullif(trim(p_data->>'phone'), ''), email = nullif(lower(trim(p_data->>'email')), ''),
    birth_date = nullif(p_data->>'birth_date', '')::date, cpf = v_cpf,
    address = nullif(trim(p_data->>'address'), ''), admin_notes = nullif(trim(p_data->>'admin_notes'), ''),
    guardian_name = nullif(trim(p_data->>'guardian_name'), ''),
    guardian_relationship = nullif(trim(p_data->>'guardian_relationship'), ''),
    guardian_phone = nullif(trim(p_data->>'guardian_phone'), ''),
    guardian_email = nullif(lower(trim(p_data->>'guardian_email')), ''),
    sex = nullif(p_data->>'sex', ''), rg = nullif(trim(p_data->>'rg'), ''),
    occupation = nullif(trim(p_data->>'occupation'), ''), marital_status = nullif(p_data->>'marital_status', ''),
    tags = v_tags, additional_contacts = v_contacts, emergency_contacts = v_emergency,
    identification_documents = v_documents,
    address_country = nullif(trim(p_data->>'address_country'), ''),
    address_postal_code = nullif(regexp_replace(coalesce(p_data->>'address_postal_code', ''), '[^0-9]', '', 'g'), ''),
    address_state = nullif(trim(p_data->>'address_state'), ''),
    address_city = nullif(trim(p_data->>'address_city'), ''),
    address_district = nullif(trim(p_data->>'address_district'), ''),
    address_street = nullif(trim(p_data->>'address_street'), ''),
    address_number = nullif(trim(p_data->>'address_number'), ''),
    address_complement = nullif(trim(p_data->>'address_complement'), ''),
    email_opt_in = coalesce((p_data->>'email_opt_in')::boolean, false),
    sms_opt_in = coalesce((p_data->>'sms_opt_in')::boolean, false),
    status = v_status, updated_at = now()
  WHERE id = saved;
  DELETE FROM public.patient_professionals WHERE patient_id = saved AND NOT (professional_id = ANY (professionals));
  INSERT INTO public.patient_professionals (patient_id, professional_id)
  SELECT saved, unnest(professionals) ON CONFLICT DO NOTHING;
  RETURN saved;
END $$;

CREATE FUNCTION public.set_patient_photo(p_patient_id uuid, p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission('patients.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501'; END IF;
  IF p_path IS NOT NULL AND (p_path NOT LIKE 'patients/' || p_patient_id::text || '/photo/%') THEN
    RAISE EXCEPTION 'Caminho da foto inválido.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.patients SET photo_path = p_path, updated_at = now() WHERE id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_patient_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_patient_photo(uuid, text) TO authenticated;
