-- Fotos (pasta photo/) de pacientes e de profissionais: só JPG ou PNG, pela extensão do arquivo e pelo tipo
-- informado no envio. A tela já recusa outros tipos; isto fecha o envio feito direto pela API.
-- Documentos e anexos (outras pastas) continuam aceitando os tipos de antes.
CREATE FUNCTION private.photo_ok(p_name text, p_metadata jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT split_part(p_name, '/', 3) <> 'photo'
    OR (lower(p_name) ~ '\.(jpe?g|png)$' AND coalesce(p_metadata->>'mimetype', 'image/jpeg') IN ('image/jpeg', 'image/png'))
$$;
REVOKE ALL ON FUNCTION private.photo_ok(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.photo_ok(text, jsonb) TO authenticated;

DROP POLICY "arquivos de pacientes: envio" ON storage.objects;
CREATE POLICY "arquivos de pacientes: envio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-documents' AND private.patient_of_path(name) IS NOT NULL
    AND private.has_permission('patients.manage') AND private.photo_ok(name, metadata));

DROP POLICY "gestão envia arquivos dos profissionais" ON storage.objects;
CREATE POLICY "gestão envia arquivos dos profissionais" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) IN ('photo', 'files') AND private.has_permission('professionals.manage')
    AND private.professional_file_owner(name) IS NOT NULL AND private.photo_ok(name, metadata));
