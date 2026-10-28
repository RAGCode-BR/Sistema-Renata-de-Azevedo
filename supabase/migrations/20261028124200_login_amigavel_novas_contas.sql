CREATE OR REPLACE FUNCTION private.assign_staff_username() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  roles jsonb;
  supplied text;
  base text;
BEGIN
  SELECT raw_app_meta_data->'roles', lower(raw_app_meta_data->>'username')
    INTO roles, supplied FROM auth.users WHERE id = NEW.id;
  IF roles IS NULL OR roles = '["patient"]'::jsonb THEN RETURN NEW; END IF;
  IF supplied IS NOT NULL AND supplied <> '' THEN
    NEW.username := supplied;
  ELSE
    base := left(lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')), 23);
    IF base !~ '^[a-z][a-z0-9._-]{2,22}$' THEN base := 'usuario'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = base) THEN
      NEW.username := base;
    ELSE
      NEW.username := base || '_' || left(replace(NEW.id::text, '-', ''), 8);
    END IF;
  END IF;
  RETURN NEW;
END $$;
