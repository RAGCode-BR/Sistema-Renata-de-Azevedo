CREATE FUNCTION public.cancel_patient_form(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE assignment public.patient_form_assignments;
BEGIN
  SELECT * INTO assignment FROM public.patient_form_assignments WHERE id = p_id FOR UPDATE;
  IF assignment.id IS NULL THEN RAISE EXCEPTION 'Formulário não encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF private.require_author_of(assignment.patient_id) <> assignment.professional_id OR assignment.status <> 'assigned' THEN
    RAISE EXCEPTION 'Formulário não pode ser cancelado.' USING ERRCODE = '42501'; END IF;
  UPDATE public.patient_form_assignments SET status = 'cancelled' WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.cancel_patient_form(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_patient_form(uuid) TO authenticated;
