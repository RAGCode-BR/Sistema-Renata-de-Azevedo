-- Índices para chaves estrangeiras usadas em filtros, junções e regras de acesso (as demais, que só
-- registram quem criou ou alterou, quase nunca são buscadas e ficam sem índice).
CREATE INDEX IF NOT EXISTS whatsapp_messages_patient_idx ON public.whatsapp_messages (patient_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_lead_idx ON public.whatsapp_messages (lead_id);
CREATE INDEX IF NOT EXISTS clinical_documents_patient_idx ON public.clinical_documents (patient_id);
CREATE INDEX IF NOT EXISTS leads_patient_idx ON public.leads (patient_id);
CREATE INDEX IF NOT EXISTS leads_owner_idx ON public.leads (owner_id);
CREATE INDEX IF NOT EXISTS lead_assessments_professional_idx ON public.lead_assessments (professional_id);
CREATE INDEX IF NOT EXISTS patient_form_assignments_template_idx ON public.patient_form_assignments (template_id);
CREATE INDEX IF NOT EXISTS patient_status_events_patient_idx ON public.patient_status_events (patient_id);
CREATE INDEX IF NOT EXISTS ai_transcripts_patient_idx ON public.ai_transcripts (patient_id);
CREATE INDEX IF NOT EXISTS ai_runs_patient_idx ON public.ai_runs (patient_id);
CREATE INDEX IF NOT EXISTS google_busy_calendar_idx ON public.google_busy (google_calendar_id);
CREATE INDEX IF NOT EXISTS portal_requests_user_idx ON public.portal_requests (user_id);
CREATE INDEX IF NOT EXISTS appointments_rescheduled_from_idx ON public.appointments (rescheduled_from);
