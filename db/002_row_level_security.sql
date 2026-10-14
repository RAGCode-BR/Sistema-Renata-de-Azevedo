-- O Supabase expõe o schema public por uma API REST (PostgREST) acessível com a chave pública
-- do projeto. Com RLS ativo e nenhuma política, essa API não lê nem grava nada nestas tabelas.
-- O servidor da clínica conecta como dono das tabelas e não é afetado. Localmente não muda nada.
BEGIN;

ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

COMMIT;
