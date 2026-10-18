-- Bloco 5: prontuário e conceitualização de caso.
--
-- Princípio: o conteúdo clínico NÃO é lido nem gravado direto nas tabelas. Tudo passa por funções
-- que conferem a autoria (profissional responsável, com o paciente na carteira) e registram o acesso
-- em clinical_access_log. Assim a auditoria de leitura não pode ser contornada pela interface.
--
-- * Evolução: rascunho (editável, com versões guardadas) → finalizada (imutável). Correção só por
--   retificação: um novo registro ligado ao original, com motivo; o original continua visível.
-- * Anotação pessoal: da profissional, fora do prontuário formal e da exportação.
-- * Prazo de preenchimento (clinic_settings): Pendente, Rascunho, Finalizado, Finalizado fora do prazo.
-- * Conceitualização: modelo configurável (da clínica ou da profissional), conteúdo por seção e versões.
-- * Documentos clínicos: bucket privado próprio; o link é gerado por uma Edge Function que registra a abertura.
-- Assinatura: a finalização registra quem finalizou e quando (identificação no sistema). Assinatura
-- digital com certificado (ICP-Brasil), se exigida, fica para uma etapa posterior.

-- Configurações da clínica ---------------------------------------------------------------------

CREATE TABLE public.clinic_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  note_deadline_hours integer NOT NULL DEFAULT 48 CHECK (note_deadline_hours BETWEEN 1 AND 720),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.clinic_settings DEFAULT VALUES;
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_settings FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.clinic_settings FROM authenticated;
CREATE POLICY "equipe lê as configurações" ON public.clinic_settings
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "quem gerencia configurações altera" ON public.clinic_settings
  FOR UPDATE TO authenticated USING (private.has_permission('settings.manage')) WITH CHECK (private.has_permission('settings.manage'));
-- Configuração não tem id uuid: a alteração fica registrada sem entity_id.
CREATE FUNCTION private.audit_settings_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (actor_user_id, action, entity_type) VALUES (auth.uid(), 'update', 'clinic_settings');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_clinic_settings AFTER UPDATE ON public.clinic_settings
  FOR EACH ROW EXECUTE FUNCTION private.audit_settings_update();

-- Evoluções ------------------------------------------------------------------------------------

ALTER TABLE public.clinical_notes
  ADD COLUMN kind text NOT NULL DEFAULT 'evolution' CHECK (kind IN ('evolution', 'personal')),
  ADD COLUMN status text NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final')),
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN rectifies_id uuid REFERENCES public.clinical_notes(id),
  ADD COLUMN rectification_reason text;
UPDATE public.clinical_notes SET finalized_at = created_at;
ALTER TABLE public.clinical_notes ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.clinical_notes
  ADD CONSTRAINT clinical_notes_finalized CHECK ((status = 'final') = (finalized_at IS NOT NULL)),
  ADD CONSTRAINT clinical_notes_personal CHECK (kind = 'evolution'
    OR (status = 'draft' AND appointment_id IS NULL AND rectifies_id IS NULL)),
  ADD CONSTRAINT clinical_notes_rectification CHECK ((rectifies_id IS NULL) = (rectification_reason IS NULL));
CREATE INDEX clinical_notes_rectifies_idx ON public.clinical_notes (rectifies_id) WHERE rectifies_id IS NOT NULL;

CREATE TABLE public.clinical_note_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES public.clinical_notes(id) ON DELETE CASCADE,
  body text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clinical_note_revisions_note_idx ON public.clinical_note_revisions (note_id, saved_at);

-- Defesa em profundidade: mesmo por fora das funções, evolução finalizada não muda nem some,
-- e cada alteração de rascunho guarda o texto anterior.
CREATE FUNCTION private.protect_clinical_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind = 'evolution' AND OLD.status = 'final' THEN
      RAISE EXCEPTION 'Registros finalizados do prontuário não podem ser apagados.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'Evolução finalizada não pode ser alterada; use a retificação.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    INSERT INTO public.clinical_note_revisions (note_id, body) VALUES (OLD.id, OLD.body);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_notes_protect BEFORE UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION private.protect_clinical_note();

-- Registro de acesso ao conteúdo clínico (quem abriu, exportou ou baixou o quê, e quando).
CREATE TABLE public.clinical_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('view_record', 'export', 'open_document')),
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clinical_access_log_patient_idx ON public.clinical_access_log (patient_id, created_at);

-- Conceitualização de caso ----------------------------------------------------------------------

-- Modelo: lista de seções [{key, label, hint}]. professional_id nulo = modelo da clínica.
CREATE TABLE public.case_formulation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid REFERENCES public.professionals(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  sections jsonb NOT NULL CHECK (jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Modelo inicial com os campos pedidos pela clínica. Modalidade, motivo da procura e hipóteses
-- diagnósticas ficam em seções separadas (são coisas diferentes). Cada profissional pode criar o
-- próprio modelo a partir deste (ou importar o da Gabriela, quando houver).
INSERT INTO public.case_formulation_templates (name, sections) VALUES ('Modelo da clínica', '[
  {"key": "modalidade", "label": "Modalidade do acompanhamento", "hint": "Individual, casal, família…; presencial ou on-line; frequência."},
  {"key": "motivo", "label": "Motivo da procura e queixa principal", "hint": "Nas palavras da pessoa, quando possível."},
  {"key": "contexto", "label": "Contexto relevante", "hint": "Família, trabalho, rede de apoio, eventos recentes."},
  {"key": "historico", "label": "Histórico clínico", "hint": "Tratamentos anteriores, medicações, internações."},
  {"key": "hipoteses", "label": "Hipóteses clínicas e diagnósticas", "hint": "Quando apropriado. Hipóteses, não conclusões."},
  {"key": "predisponentes", "label": "Fatores predisponentes", "hint": ""},
  {"key": "mantenedores", "label": "Fatores mantenedores", "hint": ""},
  {"key": "objetivos", "label": "Objetivos terapêuticos", "hint": "Combinados com a pessoa atendida."},
  {"key": "estrategias", "label": "Estratégias e intervenções", "hint": ""},
  {"key": "evolucao", "label": "Evolução do caso", "hint": "Síntese periódica do percurso."},
  {"key": "livre", "label": "Notas livres", "hint": ""}
]');

ALTER TABLE public.case_formulation_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_formulation_templates FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.case_formulation_templates FROM authenticated;
CREATE POLICY "modelos: da clínica e os próprios" ON public.case_formulation_templates
  FOR SELECT TO authenticated
  USING (private.current_professional_id() IS NOT NULL
    AND (professional_id IS NULL OR professional_id = private.current_professional_id()));
CREATE POLICY "modelos: a profissional cria os próprios" ON public.case_formulation_templates
  FOR INSERT TO authenticated WITH CHECK (professional_id = private.current_professional_id());
CREATE POLICY "modelos: a profissional altera os próprios" ON public.case_formulation_templates
  FOR UPDATE TO authenticated
  USING (professional_id = private.current_professional_id()) WITH CHECK (professional_id = private.current_professional_id());
CREATE POLICY "modelos: a profissional exclui os próprios" ON public.case_formulation_templates
  FOR DELETE TO authenticated USING (professional_id = private.current_professional_id());

-- Uma conceitualização por paciente e profissional; as seções usadas ficam copiadas junto, para que
-- mudar o modelo depois não altere o que já foi escrito.
CREATE TABLE public.case_formulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  template_name text NOT NULL,
  sections jsonb NOT NULL,
  content jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, professional_id)
);

CREATE TABLE public.case_formulation_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  formulation_id uuid NOT NULL REFERENCES public.case_formulations(id) ON DELETE CASCADE,
  sections jsonb NOT NULL,
  content jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION private.keep_formulation_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.content, NEW.sections) IS DISTINCT FROM (OLD.content, OLD.sections) THEN
    INSERT INTO public.case_formulation_revisions (formulation_id, sections, content, saved_at)
    VALUES (OLD.id, OLD.sections, OLD.content, OLD.updated_at);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER case_formulations_revision BEFORE UPDATE ON public.case_formulations
  FOR EACH ROW EXECUTE FUNCTION private.keep_formulation_revision();

-- Documentos clínicos ---------------------------------------------------------------------------
-- Arquivo em clinical-documents/patients/<paciente>/<profissional>/<arquivo>. Só a profissional autora
-- envia; ninguém lê o arquivo direto do Storage: o link vem da Edge Function clinical-document-url.
-- Não há exclusão: documentos clínicos seguem a guarda do prontuário.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinical-documents', 'clinical-documents', false, 10485760, ARRAY[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.clinical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  professional_id uuid NOT NULL REFERENCES public.professionals(id),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path LIKE 'patients/' || patient_id || '/' || professional_id || '/%')
);

CREATE FUNCTION private.professional_of_path(path text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN split_part(path, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN split_part(path, '/', 3)::uuid END
$$;

CREATE POLICY "documentos clínicos: a profissional envia para os próprios pacientes" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clinical-documents'
    AND private.professional_of_path(name) = private.current_professional_id()
    AND coalesce(private.cares_for(private.patient_of_path(name)), false));

-- Tabelas clínicas: nenhum acesso direto. Leitura e escrita só pelas funções abaixo.
ALTER TABLE public.clinical_note_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_formulation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY "profissional vê as próprias evoluções" ON public.clinical_notes;
DROP POLICY "profissional registra evoluções dos seus pacientes" ON public.clinical_notes;
REVOKE ALL ON public.clinical_notes, public.clinical_note_revisions, public.case_formulations,
  public.case_formulation_revisions, public.clinical_documents FROM anon, authenticated;
REVOKE ALL ON public.clinical_access_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.clinical_access_log FROM authenticated;
-- Quem gerencia usuários pode auditar QUEM acessou (não o conteúdo).
CREATE POLICY "auditoria de acesso: quem gerencia usuários" ON public.clinical_access_log
  FOR SELECT TO authenticated USING (private.has_permission('users.manage'));

-- Funções do prontuário --------------------------------------------------------------------------

-- Autoria: perfil Profissional com o paciente na carteira. Lança erro de permissão caso contrário.
CREATE FUNCTION private.require_author_of(patient uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.current_professional_id();
BEGIN
  IF professional IS NULL OR NOT coalesce(private.cares_for(patient), false) THEN
    RAISE EXCEPTION 'O prontuário é visível apenas para a profissional responsável.' USING ERRCODE = '42501';
  END IF;
  RETURN professional;
END $$;

CREATE FUNCTION private.log_clinical_access(patient uuid, act text, target uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.clinical_access_log (actor_user_id, patient_id, action, target_id) VALUES (auth.uid(), patient, act, target)
$$;

-- Prontuário de um paciente para a profissional responsável: evoluções (com versões e retificações),
-- anotações pessoais, conceitualização e documentos clínicos. Registra o acesso.
CREATE FUNCTION public.clinical_record(p_patient_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
BEGIN
  PERFORM private.log_clinical_access(p_patient_id, 'view_record', NULL);
  RETURN jsonb_build_object(
    'notes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'status', n.status, 'body', n.body, 'appointment_id', n.appointment_id,
        'appointment_starts_at', a.starts_at, 'created_at', n.created_at, 'updated_at', n.updated_at,
        'finalized_at', n.finalized_at, 'rectifies_id', n.rectifies_id, 'rectification_reason', n.rectification_reason,
        'rectified_by', (SELECT r.id FROM public.clinical_notes r WHERE r.rectifies_id = n.id ORDER BY r.created_at DESC LIMIT 1),
        'revisions', (SELECT count(*) FROM public.clinical_note_revisions v WHERE v.note_id = n.id)
      ) ORDER BY coalesce(a.starts_at, n.created_at) DESC, n.created_at DESC)
      FROM public.clinical_notes n LEFT JOIN public.appointments a ON a.id = n.appointment_id
      WHERE n.patient_id = p_patient_id AND n.professional_id = professional
    ), '[]'::jsonb),
    'formulation', (
      SELECT jsonb_build_object('id', f.id, 'template_name', f.template_name, 'sections', f.sections, 'content', f.content,
        'updated_at', f.updated_at, 'revisions', (SELECT count(*) FROM public.case_formulation_revisions v WHERE v.formulation_id = f.id))
      FROM public.case_formulations f WHERE f.patient_id = p_patient_id AND f.professional_id = professional
    ),
    'documents', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'size_bytes', d.size_bytes,
        'mime_type', d.mime_type, 'created_at', d.created_at) ORDER BY d.created_at DESC)
      FROM public.clinical_documents d WHERE d.patient_id = p_patient_id AND d.professional_id = professional
    ), '[]'::jsonb)
  );
END $$;

-- Versões anteriores de um rascunho (texto salvo antes de cada alteração).
CREATE FUNCTION public.clinical_note_revisions(p_note_id uuid) RETURNS TABLE (body text, saved_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  patient uuid;
BEGIN
  SELECT n.patient_id INTO patient FROM public.clinical_notes n
  WHERE n.id = p_note_id AND n.professional_id = private.current_professional_id();
  IF patient IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.require_author_of(patient);
  RETURN QUERY SELECT v.body, v.saved_at FROM public.clinical_note_revisions v WHERE v.note_id = p_note_id ORDER BY v.saved_at DESC;
END $$;

-- Cria (p_id nulo) ou altera um rascunho de evolução ou uma anotação pessoal.
CREATE FUNCTION public.save_clinical_note(
  p_id uuid, p_patient_id uuid, p_appointment_id uuid, p_kind text, p_body text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
  saved uuid;
BEGIN
  IF coalesce(trim(p_body), '') = '' THEN
    RAISE EXCEPTION 'Escreva o registro antes de salvar.' USING ERRCODE = 'P0001';
  END IF;
  IF p_kind NOT IN ('evolution', 'personal') THEN
    RAISE EXCEPTION 'Tipo de registro inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF p_kind = 'evolution' AND p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments a WHERE a.id = p_appointment_id AND a.patient_id = p_patient_id
      AND a.professional_id = professional AND a.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'A sessão precisa ser sua, deste paciente e estar marcada como realizada.' USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.clinical_notes (patient_id, professional_id, appointment_id, kind, status, body)
    VALUES (p_patient_id, professional, CASE WHEN p_kind = 'evolution' THEN p_appointment_id END, p_kind, 'draft', trim(p_body))
    RETURNING id INTO saved;
  ELSE
    UPDATE public.clinical_notes SET body = trim(p_body),
      appointment_id = CASE WHEN p_kind = 'evolution' THEN p_appointment_id END
    WHERE id = p_id AND patient_id = p_patient_id AND professional_id = professional AND kind = p_kind AND status = 'draft'
    RETURNING id INTO saved;
    IF saved IS NULL THEN
      RAISE EXCEPTION 'Rascunho não encontrado (evoluções finalizadas só podem ser retificadas).' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN saved;
END $$;

-- Finaliza um rascunho de evolução: a partir daqui, o texto não muda mais.
CREATE FUNCTION public.finalize_clinical_note(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  note public.clinical_notes;
BEGIN
  SELECT * INTO note FROM public.clinical_notes WHERE id = p_id AND professional_id = private.current_professional_id();
  IF note.id IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.require_author_of(note.patient_id);
  IF note.kind <> 'evolution' OR note.status <> 'draft' THEN
    RAISE EXCEPTION 'Só rascunhos de evolução podem ser finalizados.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.clinical_notes SET status = 'final', finalized_at = now() WHERE id = p_id;
END $$;

-- Retificação: novo registro finalizado, ligado ao original, com o motivo. O original não muda.
CREATE FUNCTION public.rectify_clinical_note(p_id uuid, p_body text, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  original public.clinical_notes;
  created uuid;
BEGIN
  SELECT * INTO original FROM public.clinical_notes WHERE id = p_id AND professional_id = private.current_professional_id();
  IF original.id IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.require_author_of(original.patient_id);
  IF original.kind <> 'evolution' OR original.status <> 'final' THEN
    RAISE EXCEPTION 'Só evoluções finalizadas são retificadas; rascunhos podem ser editados.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(trim(p_body), '') = '' OR coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Informe o texto corrigido e o motivo da retificação.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.clinical_notes
    (patient_id, professional_id, appointment_id, kind, status, finalized_at, body, rectifies_id, rectification_reason)
  VALUES (original.patient_id, original.professional_id, original.appointment_id, 'evolution', 'final', now(),
    trim(p_body), original.id, trim(p_reason))
  RETURNING id INTO created;
  RETURN created;
END $$;

-- Descarta um rascunho de evolução ou apaga uma anotação pessoal (evoluções finalizadas, nunca).
CREATE FUNCTION public.delete_clinical_note(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  note public.clinical_notes;
BEGIN
  SELECT * INTO note FROM public.clinical_notes WHERE id = p_id AND professional_id = private.current_professional_id();
  IF note.id IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.require_author_of(note.patient_id);
  DELETE FROM public.clinical_notes WHERE id = p_id;
END $$;

-- Conceitualização: cria ou atualiza (cada alteração guarda a versão anterior).
CREATE FUNCTION public.save_case_formulation(p_patient_id uuid, p_template_name text, p_sections jsonb, p_content jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
  saved uuid;
BEGIN
  IF jsonb_typeof(p_sections) <> 'array' OR jsonb_array_length(p_sections) = 0 OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'Conceitualização inválida.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.case_formulations (patient_id, professional_id, template_name, sections, content)
  VALUES (p_patient_id, professional, coalesce(nullif(trim(p_template_name), ''), 'Modelo'), p_sections, p_content)
  ON CONFLICT (patient_id, professional_id) DO UPDATE
    SET template_name = EXCLUDED.template_name, sections = EXCLUDED.sections, content = EXCLUDED.content
  RETURNING id INTO saved;
  RETURN saved;
END $$;

-- Registra um documento clínico já enviado ao Storage pela profissional autora.
CREATE FUNCTION public.register_clinical_document(
  p_patient_id uuid, p_title text, p_storage_path text, p_size_bytes bigint, p_mime_type text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
  created uuid;
BEGIN
  INSERT INTO public.clinical_documents (patient_id, professional_id, title, storage_path, size_bytes, mime_type)
  VALUES (p_patient_id, professional, trim(p_title), p_storage_path, p_size_bytes, p_mime_type)
  RETURNING id INTO created;
  RETURN created;
END $$;

-- Usada pela Edge Function clinical-document-url (com o token de quem pediu): confere a autoria,
-- registra a abertura e devolve o caminho do arquivo para gerar o link temporário.
CREATE FUNCTION public.authorize_clinical_document(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  document public.clinical_documents;
BEGIN
  SELECT * INTO document FROM public.clinical_documents WHERE id = p_id;
  IF document.id IS NULL OR document.professional_id IS DISTINCT FROM private.current_professional_id() THEN
    RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.require_author_of(document.patient_id);
  PERFORM private.log_clinical_access(document.patient_id, 'open_document', document.id);
  RETURN document.storage_path;
END $$;

-- Exportação do prontuário formal (evoluções finalizadas e retificações, conceitualização opcional).
-- Anotações pessoais e rascunhos ficam de fora. Registra a exportação.
CREATE FUNCTION public.export_clinical_record(p_patient_id uuid, p_with_formulation boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  professional uuid := private.require_author_of(p_patient_id);
BEGIN
  PERFORM private.log_clinical_access(p_patient_id, 'export', NULL);
  RETURN jsonb_build_object(
    'patient', (SELECT jsonb_build_object('name', p.name, 'birth_date', p.birth_date) FROM public.patients p WHERE p.id = p_patient_id),
    'professional', (SELECT pr.name FROM public.professionals pr WHERE pr.id = professional),
    'exported_at', now(),
    'notes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'finalized_at', n.finalized_at,
        'appointment_starts_at', a.starts_at, 'rectifies_id', n.rectifies_id, 'rectification_reason', n.rectification_reason)
        ORDER BY coalesce(a.starts_at, n.finalized_at), n.finalized_at)
      FROM public.clinical_notes n LEFT JOIN public.appointments a ON a.id = n.appointment_id
      WHERE n.patient_id = p_patient_id AND n.professional_id = professional AND n.kind = 'evolution' AND n.status = 'final'
    ), '[]'::jsonb),
    'formulation', CASE WHEN p_with_formulation THEN (
      SELECT jsonb_build_object('template_name', f.template_name, 'sections', f.sections, 'content', f.content, 'updated_at', f.updated_at)
      FROM public.case_formulations f WHERE f.patient_id = p_patient_id AND f.professional_id = professional) END
  );
END $$;

-- Situação de preenchimento das sessões realizadas, sem conteúdo clínico:
-- pending (sem evolução), draft (só rascunho), final, final_late (finalizada depois do prazo).
-- Gerência vê a clínica toda; a profissional, as próprias.
CREATE FUNCTION public.clinical_note_status(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz, patient_id uuid, patient_name text,
  professional_id uuid, professional_name text, note_status text, deadline_at timestamptz, overdue boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH settings AS (SELECT note_deadline_hours FROM public.clinic_settings LIMIT 1),
  sessions AS (
    SELECT a.*, a.ends_at + make_interval(hours => (SELECT note_deadline_hours FROM settings)) AS deadline,
      (SELECT min(n.finalized_at) FROM public.clinical_notes n
        WHERE n.appointment_id = a.id AND n.kind = 'evolution' AND n.status = 'final' AND n.rectifies_id IS NULL) AS finalized,
      EXISTS (SELECT 1 FROM public.clinical_notes n
        WHERE n.appointment_id = a.id AND n.kind = 'evolution' AND n.status = 'draft') AS has_draft
    FROM public.appointments a
    WHERE a.status = 'completed' AND a.starts_at >= p_from AND a.starts_at < p_to
      AND private.sees_schedule_of(a.professional_id)
  )
  SELECT s.id, s.starts_at, s.ends_at, s.patient_id, p.name, s.professional_id, pr.name,
    CASE WHEN s.finalized IS NOT NULL THEN CASE WHEN s.finalized > s.deadline THEN 'final_late' ELSE 'final' END
      WHEN s.has_draft THEN 'draft' ELSE 'pending' END,
    s.deadline,
    s.finalized IS NULL AND now() > s.deadline
  FROM sessions s JOIN public.patients p ON p.id = s.patient_id JOIN public.professionals pr ON pr.id = s.professional_id
  ORDER BY s.starts_at DESC
$$;

-- Evolução pendente: sessão realizada sem evolução FINALIZADA (rascunho ainda conta como pendente).
DROP FUNCTION public.pending_clinical_notes();
CREATE FUNCTION public.pending_clinical_notes()
RETURNS TABLE (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz, patient_id uuid, patient_name text,
  professional_id uuid, professional_name text, note_status text, overdue boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.appointment_id, s.starts_at, s.ends_at, s.patient_id, s.patient_name, s.professional_id,
    s.professional_name, s.note_status, s.overdue
  FROM public.clinical_note_status('-infinity', 'infinity') s
  WHERE s.note_status IN ('pending', 'draft')
  ORDER BY s.starts_at
$$;

-- Permissões ----------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.clinical_record(uuid), public.clinical_note_revisions(uuid),
  public.save_clinical_note(uuid, uuid, uuid, text, text), public.finalize_clinical_note(uuid),
  public.rectify_clinical_note(uuid, text, text), public.delete_clinical_note(uuid),
  public.save_case_formulation(uuid, text, jsonb, jsonb),
  public.register_clinical_document(uuid, text, text, bigint, text), public.authorize_clinical_document(uuid),
  public.export_clinical_record(uuid, boolean), public.clinical_note_status(timestamptz, timestamptz),
  public.pending_clinical_notes()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinical_record(uuid), public.clinical_note_revisions(uuid),
  public.save_clinical_note(uuid, uuid, uuid, text, text), public.finalize_clinical_note(uuid),
  public.rectify_clinical_note(uuid, text, text), public.delete_clinical_note(uuid),
  public.save_case_formulation(uuid, text, jsonb, jsonb),
  public.register_clinical_document(uuid, text, text, bigint, text), public.authorize_clinical_document(uuid),
  public.export_clinical_record(uuid, boolean), public.clinical_note_status(timestamptz, timestamptz),
  public.pending_clinical_notes()
  TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(text), private.has_permission(text), private.is_staff(),
  private.current_professional_id(), private.cares_for(uuid), private.occupies_slot(text),
  private.sees_schedule_of(uuid), private.manages_schedule_of(uuid), private.patient_of_path(text),
  private.sees_patient(uuid), private.professional_of_path(text) TO authenticated;
