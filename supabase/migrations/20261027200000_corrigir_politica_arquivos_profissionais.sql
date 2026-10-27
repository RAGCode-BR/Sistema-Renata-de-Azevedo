-- O Storage avalia a política de objetos em um papel próprio; a checagem cruzada
-- de RLS em professionals recusava o envio mesmo após o cadastro ser salvo.
-- O caminho estruturado e a permissão de gestão bastam: quem pode gerenciar
-- profissionais tem acesso a todos os seus arquivos.
DROP POLICY "equipe lê fotos dos profissionais" ON storage.objects;
DROP POLICY "gestão lê anexos dos profissionais" ON storage.objects;
DROP POLICY "gestão envia arquivos dos profissionais" ON storage.objects;
DROP POLICY "gestão remove arquivos dos profissionais" ON storage.objects;

CREATE POLICY "equipe lê fotos dos profissionais" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) = 'photo' AND private.is_staff()
    AND private.professional_file_owner(name) IS NOT NULL);
CREATE POLICY "gestão lê anexos dos profissionais" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) = 'files' AND private.has_permission('professionals.manage')
    AND private.professional_file_owner(name) IS NOT NULL);
CREATE POLICY "gestão envia arquivos dos profissionais" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'professional-files'
    AND split_part(name, '/', 3) IN ('photo', 'files') AND private.has_permission('professionals.manage')
    AND private.professional_file_owner(name) IS NOT NULL);
CREATE POLICY "gestão remove arquivos dos profissionais" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'professional-files'
    AND private.has_permission('professionals.manage')
    AND private.professional_file_owner(name) IS NOT NULL);
