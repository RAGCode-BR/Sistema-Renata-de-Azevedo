-- Resultados preenchidos acompanham a exportação formal do prontuário da própria profissional.
CREATE OR REPLACE FUNCTION public.export_clinical_record(p_patient_id uuid, p_with_formulation boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE professional uuid := private.require_author_of(p_patient_id);
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
      FROM public.case_formulations f WHERE f.patient_id = p_patient_id AND f.professional_id = professional) END,
    'forms', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'description', a.description, 'kind', a.kind,
      'questions', a.questions, 'answers', a.answers, 'score', a.score,
      'score_max', a.score_max, 'completed_at', a.completed_at) ORDER BY a.completed_at DESC)
      FROM public.patient_form_assignments a WHERE a.patient_id = p_patient_id
        AND a.professional_id = professional AND a.status = 'completed'), '[]'::jsonb)
  );
END $$;
