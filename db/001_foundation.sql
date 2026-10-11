BEGIN;

CREATE TABLE IF NOT EXISTS professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'professional')),
  professional_id uuid UNIQUE REFERENCES professionals(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'professional') = (professional_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  email text,
  birth_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_professionals (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id),
  PRIMARY KEY (patient_id, professional_id)
);
CREATE INDEX IF NOT EXISTS patient_professionals_prof_idx ON patient_professionals (professional_id);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  professional_id uuid NOT NULL REFERENCES professionals(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'missed', 'cancelled')),
  modality text NOT NULL DEFAULT 'presencial' CHECK (modality IN ('presencial', 'online')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS appointments_prof_time_idx ON appointments (professional_id, starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  professional_id uuid NOT NULL REFERENCES professionals(id),
  appointment_id uuid REFERENCES appointments(id),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_notes_patient_prof_idx ON clinical_notes (patient_id, professional_id);

CREATE TABLE IF NOT EXISTS google_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_subject text NOT NULL,
  google_email text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  refresh_token_tag bytea NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_subject)
);

CREATE TABLE IF NOT EXISTS google_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_account_id uuid NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id),
  google_calendar_id text NOT NULL,
  display_name text NOT NULL,
  access_role text NOT NULL CHECK (access_role IN ('owner', 'writer', 'reader', 'freeBusyReader')),
  selected boolean NOT NULL DEFAULT false,
  sync_token text,
  last_synced_at timestamptz,
  UNIQUE (google_account_id, google_calendar_id)
);
CREATE INDEX IF NOT EXISTS google_calendars_prof_idx ON google_calendars (professional_id);

CREATE TABLE IF NOT EXISTS calendar_event_links (
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  google_calendar_id uuid NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  google_etag text,
  last_synced_at timestamptz,
  PRIMARY KEY (appointment_id, google_calendar_id),
  UNIQUE (google_calendar_id, google_event_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
