-- Bloco 2: painel inicial.
--
-- Evoluções pendentes: sessões que já terminaram, não foram canceladas nem marcadas como falta,
-- e ainda não têm evolução ligada a elas (clinical_notes.appointment_id).
-- A gerência acompanha QUAIS sessões estão pendentes sem acesso ao conteúdo dos prontuários:
-- a função só informa a existência do registro, nunca o texto.

CREATE INDEX IF NOT EXISTS clinical_notes_appointment_idx ON public.clinical_notes (appointment_id);

-- Quem vê a agenda geral recebe as pendências de todas; a profissional, só as próprias.
CREATE FUNCTION public.pending_clinical_notes()
RETURNS TABLE (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz,
  patient_id uuid, patient_name text, professional_id uuid, professional_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.starts_at, a.ends_at, a.patient_id, p.name, a.professional_id, pr.name
  FROM public.appointments a
  JOIN public.patients p ON p.id = a.patient_id
  JOIN public.professionals pr ON pr.id = a.professional_id
  WHERE a.ends_at < now()
    AND a.status NOT IN ('cancelled', 'missed')
    AND NOT EXISTS (SELECT 1 FROM public.clinical_notes n WHERE n.appointment_id = a.id)
    AND (private.has_permission('appointments.view_all') OR a.professional_id = private.current_professional_id())
  ORDER BY a.starts_at
$$;

REVOKE ALL ON FUNCTION public.pending_clinical_notes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pending_clinical_notes() TO authenticated;

-- Mensagens com o mesmo rótulo da interface (Proprietário(a)); as regras não mudam.
CREATE OR REPLACE FUNCTION public.set_user_access(
  p_user_id uuid, p_roles text[], p_professional_id uuid, p_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  roles text[] := ARRAY(SELECT DISTINCT unnest(p_roles));
  professional uuid;
  was_active_owner boolean;
BEGIN
  IF NOT private.has_permission('users.manage') THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(cardinality(roles), 0) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um perfil.' USING ERRCODE = 'P0001';
  END IF;
  IF 'patient' = ANY (roles) AND cardinality(roles) > 1 THEN
    RAISE EXCEPTION 'O perfil Paciente não pode ser combinado com perfis da equipe.' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id = auth.uid() AND NOT p_active THEN
    RAISE EXCEPTION 'Você não pode desativar a própria conta.' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = auth.uid() AND private.has_role('owner') AND NOT ('owner' = ANY (roles)) THEN
    RAISE EXCEPTION 'Você não pode remover o próprio perfil de Proprietário(a).' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.active AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'owner')
  INTO was_active_owner FROM public.profiles p WHERE p.id = p_user_id;
  IF was_active_owner AND (NOT p_active OR NOT ('owner' = ANY (roles))) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'owner' AND p.active AND p.id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'É preciso manter ao menos um(a) Proprietário(a) ativo(a).' USING ERRCODE = 'P0001';
  END IF;

  IF 'professional' = ANY (roles) THEN
    IF p_professional_id IS NULL THEN
      RAISE EXCEPTION 'O perfil Profissional exige uma profissional vinculada.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id AND active) THEN
      RAISE EXCEPTION 'Profissional inválido.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE professional_id = p_professional_id AND id <> p_user_id) THEN
      RAISE EXCEPTION 'Esta profissional já tem uma conta.' USING ERRCODE = 'P0001';
    END IF;
    professional := p_professional_id;
  END IF;

  UPDATE public.profiles SET professional_id = professional, active = p_active WHERE id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND NOT (role = ANY (roles));
  INSERT INTO public.user_roles (user_id, role, granted_by)
  SELECT p_user_id, unnest(roles), auth.uid()
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), 'update_access', 'user', p_user_id);
END $$;
