-- Bloco 7: tarefas, recorrências, histórico e notificações dentro do sistema.
--
-- Regras:
-- - Proprietário(a) e Gerente (tasks.manage) atribuem tarefas a qualquer pessoa da equipe e
--   acompanham todas. Os demais perfis criam tarefas só para si.
-- - Cada pessoa vê as tarefas que recebeu ou criou. Quem recebe muda a situação e comenta;
--   quem criou (ou tem tasks.manage) também edita.
-- - Recorrência: ao concluir (ou cancelar) uma ocorrência, a próxima é criada na data fixa da
--   regra (mensal do dia 5 concluída no dia 8 → próxima no dia 5 do mês seguinte). Se a data já
--   tiver passado, avança até hoje ou depois, para não nascer atrasada.
-- - Vínculo com paciente é opcional e administrativo; o nome só aparece para quem já vê o paciente.
-- - Tabelas sem acesso direto: tudo passa pelas funções abaixo, que registram o histórico.

INSERT INTO public.role_permissions (role, permission) VALUES ('owner', 'tasks.manage'), ('manager', 'tasks.manage');

CREATE TABLE public.task_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (length(description) <= 4000),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  -- daily: todo dia; weekdays: dias úteis; weekly: mesmo dia da semana da data inicial;
  -- monthly: mesmo dia do mês (ou o último, em meses mais curtos); monthly_last: último dia; yearly.
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekdays', 'weekly', 'monthly', 'monthly_last', 'yearly')),
  starts_on date NOT NULL,
  due_time time,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (length(description) <= 4000),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
  due_date date,
  due_time time,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  recurrence_id uuid REFERENCES public.task_recurrences(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_time IS NULL OR due_date IS NOT NULL),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX tasks_assignee_idx ON public.tasks (assignee_id, status, due_date);
CREATE INDEX tasks_creator_idx ON public.tasks (created_by, status);
CREATE INDEX tasks_recurrence_idx ON public.tasks (recurrence_id) WHERE recurrence_id IS NOT NULL;
-- Uma ocorrência em aberto por regra.
CREATE UNIQUE INDEX tasks_one_open_per_recurrence ON public.tasks (recurrence_id)
  WHERE recurrence_id IS NOT NULL AND status IN ('todo', 'doing');

CREATE TABLE public.task_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'edited', 'assigned', 'status', 'comment')),
  body text CHECK (length(body) <= 2000),
  from_value text,
  to_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON public.task_events (task_id, created_at);

-- Avisos dentro do sistema. Só título e link: nada clínico.
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task_assigned', 'task_done', 'task_comment')),
  title text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_recurrences, public.tasks, public.task_events, public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
CREATE POLICY "notificações: só as próprias" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Auxiliares ---------------------------------------------------------------------------------

CREATE FUNCTION private.local_today() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- Pessoa da equipe com conta ativa.
CREATE FUNCTION private.is_active_staff(person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = person AND p.active AND r.role <> 'patient'
  )
$$;

CREATE FUNCTION private.require_staff() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(private.is_staff(), false) THEN
    RAISE EXCEPTION 'Você não tem acesso a esta área.' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION private.sees_task(t public.tasks) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(t.assignee_id = auth.uid() OR t.created_by = auth.uid() OR private.has_permission('tasks.manage'), false)
$$;

CREATE FUNCTION private.edits_task(t public.tasks) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(t.created_by = auth.uid() OR private.has_permission('tasks.manage'), false)
$$;

-- Quem pode receber a tarefa: com tasks.manage, qualquer pessoa ativa da equipe; sem, só a própria pessoa.
CREATE FUNCTION private.check_assignee(person uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF person IS NULL OR NOT private.is_active_staff(person) THEN
    RAISE EXCEPTION 'Escolha uma pessoa ativa da equipe como responsável.' USING ERRCODE = 'P0001';
  END IF;
  IF person <> auth.uid() AND NOT private.has_permission('tasks.manage') THEN
    RAISE EXCEPTION 'Você pode criar tarefas só para você.' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION private.check_task_patient(patient uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF patient IS NOT NULL AND NOT private.sees_patient(patient) THEN
    RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE FUNCTION private.notify(person uuid, what text, label text, target uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (user_id, kind, title, link)
  SELECT person, what, label, '#/tarefas?tarefa=' || target
  WHERE person IS NOT NULL AND person IS DISTINCT FROM auth.uid() AND private.is_active_staff(person)
$$;

-- Próxima data da regra estritamente depois de `after`.
CREATE FUNCTION private.next_occurrence(freq text, anchor date, after date) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  candidate date;
  month_start date;
  month_days integer;
BEGIN
  IF freq = 'daily' THEN
    RETURN after + 1;
  ELSIF freq = 'weekdays' THEN
    candidate := after + 1;
    WHILE extract(isodow FROM candidate) > 5 LOOP candidate := candidate + 1; END LOOP;
    RETURN candidate;
  ELSIF freq = 'weekly' THEN
    RETURN after + 1 + ((extract(dow FROM anchor)::integer - extract(dow FROM after + 1)::integer + 7) % 7);
  ELSIF freq IN ('monthly', 'monthly_last') THEN
    FOR step IN 0..2 LOOP
      month_start := (date_trunc('month', after) + make_interval(months => step))::date;
      month_days := extract(day FROM (month_start + interval '1 month' - interval '1 day'))::integer;
      candidate := month_start + (CASE WHEN freq = 'monthly_last' THEN month_days
        ELSE least(extract(day FROM anchor)::integer, month_days) END) - 1;
      IF candidate > after THEN RETURN candidate; END IF;
    END LOOP;
  ELSIF freq = 'yearly' THEN
    FOR step IN 0..1 LOOP
      month_start := make_date(extract(year FROM after)::integer + step, extract(month FROM anchor)::integer, 1);
      month_days := extract(day FROM (month_start + interval '1 month' - interval '1 day'))::integer;
      candidate := month_start + least(extract(day FROM anchor)::integer, month_days) - 1;
      IF candidate > after THEN RETURN candidate; END IF;
    END LOOP;
  END IF;
  RAISE EXCEPTION 'Frequência inválida: %', freq;
END $$;

-- Cria a próxima ocorrência de uma regra ativa, se não houver outra em aberto.
CREATE FUNCTION private.spawn_occurrence(rule_id uuid, after date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rule public.task_recurrences;
  due date;
  created uuid;
BEGIN
  SELECT * INTO rule FROM public.task_recurrences WHERE id = rule_id AND active;
  IF rule.id IS NULL OR EXISTS (SELECT 1 FROM public.tasks WHERE recurrence_id = rule_id AND status IN ('todo', 'doing')) THEN
    RETURN NULL;
  END IF;
  due := CASE WHEN after IS NULL THEN rule.starts_on ELSE private.next_occurrence(rule.frequency, rule.starts_on, after) END;
  WHILE due < private.local_today() LOOP
    due := private.next_occurrence(rule.frequency, rule.starts_on, due);
  END LOOP;
  INSERT INTO public.tasks (title, description, assignee_id, priority, due_date, due_time, patient_id, recurrence_id, created_by)
  VALUES (rule.title, rule.description, rule.assignee_id, rule.priority, due, rule.due_time, rule.patient_id, rule.id, rule.created_by)
  RETURNING id INTO created;
  INSERT INTO public.task_events (task_id, actor_id, kind, body) VALUES (created, auth.uid(), 'created', 'Ocorrência de tarefa recorrente');
  PERFORM private.notify(rule.assignee_id, 'task_assigned', 'Nova tarefa: ' || rule.title, created);
  RETURN created;
END $$;

-- Leitura --------------------------------------------------------------------------------------

-- p_scope: 'mine' (recebidas), 'created' (criadas por mim), 'team' (todas; exige tasks.manage).
-- p_open: só a fazer/em andamento; senão, também concluídas e canceladas dos últimos 60 dias.
CREATE FUNCTION public.task_list(p_scope text, p_open boolean DEFAULT true, p_task_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, title text, description text, assignee_id uuid, assignee_name text, created_by uuid, creator_name text,
  priority text, status text, due_date date, due_time time, overdue boolean, patient_id uuid, patient_name text,
  recurrence_id uuid, frequency text, completed_at timestamptz, completed_by_name text, created_at timestamptz,
  can_edit boolean, comments bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  IF p_scope = 'team' THEN PERFORM private.require_permission('tasks.manage'); END IF;
  RETURN QUERY
  SELECT t.id, t.title, t.description, t.assignee_id, a.name, t.created_by, c.name, t.priority, t.status, t.due_date, t.due_time,
    t.status IN ('todo', 'doing') AND t.due_date IS NOT NULL AND (t.due_date < private.local_today()
      OR (t.due_date = private.local_today() AND t.due_time < (now() AT TIME ZONE 'America/Sao_Paulo')::time)),
    CASE WHEN private.sees_patient(t.patient_id) THEN t.patient_id END,
    CASE WHEN private.sees_patient(t.patient_id) THEN pa.name END,
    t.recurrence_id, r.frequency, t.completed_at, d.name, t.created_at, private.edits_task(t),
    (SELECT count(*) FROM public.task_events e WHERE e.task_id = t.id AND e.kind = 'comment')
  FROM public.tasks t
  LEFT JOIN public.profiles a ON a.id = t.assignee_id
  LEFT JOIN public.profiles c ON c.id = t.created_by
  LEFT JOIN public.profiles d ON d.id = t.completed_by
  LEFT JOIN public.patients pa ON pa.id = t.patient_id
  LEFT JOIN public.task_recurrences r ON r.id = t.recurrence_id
  WHERE private.sees_task(t)
    AND (p_task_id IS NULL OR t.id = p_task_id)
    AND (p_task_id IS NOT NULL OR CASE p_scope
      WHEN 'mine' THEN t.assignee_id = auth.uid()
      WHEN 'created' THEN t.created_by = auth.uid()
      ELSE true END)
    AND (p_task_id IS NOT NULL OR (CASE WHEN p_open THEN t.status IN ('todo', 'doing')
      ELSE t.status IN ('todo', 'doing') OR t.updated_at > now() - interval '60 days' END))
  ORDER BY t.status IN ('done', 'cancelled'), t.due_date NULLS LAST, t.due_time NULLS LAST,
    array_position(ARRAY['urgent', 'high', 'normal', 'low'], t.priority), t.created_at;
END $$;

CREATE FUNCTION public.task_history(p_task_id uuid)
RETURNS TABLE (id bigint, actor_name text, kind text, body text, from_value text, to_value text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_task_id AND private.sees_task(t)) THEN
    RAISE EXCEPTION 'Tarefa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT e.id, p.name, e.kind, e.body,
    CASE WHEN e.kind = 'assigned' THEN (SELECT f.name FROM public.profiles f WHERE f.id::text = e.from_value) ELSE e.from_value END,
    CASE WHEN e.kind = 'assigned' THEN (SELECT g.name FROM public.profiles g WHERE g.id::text = e.to_value) ELSE e.to_value END,
    e.created_at
  FROM public.task_events e LEFT JOIN public.profiles p ON p.id = e.actor_id
  WHERE e.task_id = p_task_id ORDER BY e.created_at, e.id;
END $$;

-- Para quem a pessoa pode atribuir tarefas.
CREATE FUNCTION public.task_assignees() RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  RETURN QUERY
  SELECT p.id, p.name FROM public.profiles p
  WHERE private.is_active_staff(p.id) AND (p.id = auth.uid() OR private.has_permission('tasks.manage'))
  ORDER BY p.name;
END $$;

-- Contagens para o sino e o painel (próprias; "team_overdue" só para tasks.manage).
CREATE FUNCTION public.task_counts()
RETURNS TABLE (open_count bigint, due_today bigint, overdue bigint, team_overdue bigint, unread bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  team bigint;
BEGIN
  PERFORM private.require_staff();
  IF private.has_permission('tasks.manage') THEN
    SELECT count(*) INTO team FROM public.task_list('team', true) x WHERE x.overdue;
  END IF;
  RETURN QUERY
  SELECT count(*), count(*) FILTER (WHERE x.due_date = private.local_today() AND NOT x.overdue), count(*) FILTER (WHERE x.overdue),
    team, (SELECT count(*) FROM public.notifications n WHERE n.user_id = auth.uid() AND n.read_at IS NULL)
  FROM public.task_list('mine', true) x;
END $$;

-- Escrita --------------------------------------------------------------------------------------

-- Cria (p_id nulo) ou edita uma tarefa. Edição: quem criou ou quem tem tasks.manage.
CREATE FUNCTION public.save_task(
  p_id uuid, p_title text, p_description text, p_assignee_id uuid, p_priority text,
  p_due_date date, p_due_time time, p_patient_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.tasks;
  saved uuid;
BEGIN
  PERFORM private.require_staff();
  PERFORM private.check_task_patient(p_patient_id);
  IF p_id IS NULL THEN
    PERFORM private.check_assignee(p_assignee_id);
    INSERT INTO public.tasks (title, description, assignee_id, priority, due_date, due_time, patient_id)
    VALUES (trim(p_title), nullif(trim(p_description), ''), p_assignee_id, coalesce(p_priority, 'normal'), p_due_date, p_due_time, p_patient_id)
    RETURNING id INTO saved;
    INSERT INTO public.task_events (task_id, actor_id, kind) VALUES (saved, auth.uid(), 'created');
    PERFORM private.notify(p_assignee_id, 'task_assigned', 'Nova tarefa: ' || trim(p_title), saved);
    RETURN saved;
  END IF;

  SELECT * INTO current FROM public.tasks WHERE id = p_id FOR UPDATE;
  IF current.id IS NULL OR NOT private.sees_task(current) THEN
    RAISE EXCEPTION 'Tarefa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.edits_task(current) THEN
    RAISE EXCEPTION 'Só quem criou a tarefa ou a gerência pode editá-la.' USING ERRCODE = '42501';
  END IF;
  IF p_assignee_id IS DISTINCT FROM current.assignee_id THEN
    PERFORM private.check_assignee(p_assignee_id);
  END IF;
  -- Vínculo com paciente que a pessoa não vê é mantido como está.
  IF current.patient_id IS NOT NULL AND NOT private.sees_patient(current.patient_id) THEN
    p_patient_id := current.patient_id;
  END IF;
  UPDATE public.tasks SET title = trim(p_title), description = nullif(trim(p_description), ''), assignee_id = p_assignee_id,
    priority = coalesce(p_priority, priority), due_date = p_due_date, due_time = p_due_time, patient_id = p_patient_id,
    updated_at = now()
  WHERE id = p_id;
  IF p_assignee_id IS DISTINCT FROM current.assignee_id THEN
    INSERT INTO public.task_events (task_id, actor_id, kind, from_value, to_value)
    VALUES (p_id, auth.uid(), 'assigned', current.assignee_id::text, p_assignee_id::text);
    PERFORM private.notify(p_assignee_id, 'task_assigned', 'Tarefa atribuída a você: ' || trim(p_title), p_id);
  END IF;
  IF (trim(p_title), nullif(trim(p_description), ''), coalesce(p_priority, current.priority), p_due_date, p_due_time, p_patient_id)
    IS DISTINCT FROM (current.title, current.description, current.priority, current.due_date, current.due_time, current.patient_id) THEN
    INSERT INTO public.task_events (task_id, actor_id, kind) VALUES (p_id, auth.uid(), 'edited');
  END IF;
  RETURN p_id;
END $$;

-- Situação: quem recebeu, quem criou ou a gerência. Concluir/cancelar uma recorrente gera a próxima.
CREATE FUNCTION public.set_task_status(p_id uuid, p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.tasks;
  next_task uuid;
BEGIN
  PERFORM private.require_staff();
  IF p_status NOT IN ('todo', 'doing', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO current FROM public.tasks WHERE id = p_id FOR UPDATE;
  IF current.id IS NULL OR NOT private.sees_task(current) THEN
    RAISE EXCEPTION 'Tarefa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_status = 'cancelled' AND NOT private.edits_task(current) THEN
    RAISE EXCEPTION 'Só quem criou a tarefa ou a gerência pode cancelá-la.' USING ERRCODE = '42501';
  END IF;
  IF current.status = p_status THEN RETURN NULL; END IF;
  -- Reabrir uma ocorrência quando a próxima já existe criaria duas em aberto para a mesma regra.
  IF p_status IN ('todo', 'doing') AND current.recurrence_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tasks WHERE recurrence_id = current.recurrence_id AND id <> p_id AND status IN ('todo', 'doing')
  ) THEN
    RAISE EXCEPTION 'A próxima ocorrência desta tarefa já foi criada; use-a em vez de reabrir esta.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tasks SET status = p_status,
    completed_at = CASE WHEN p_status = 'done' THEN now() END,
    completed_by = CASE WHEN p_status = 'done' THEN auth.uid() END,
    updated_at = now()
  WHERE id = p_id;
  INSERT INTO public.task_events (task_id, actor_id, kind, from_value, to_value) VALUES (p_id, auth.uid(), 'status', current.status, p_status);
  IF p_status = 'done' THEN
    PERFORM private.notify(current.created_by, 'task_done', 'Tarefa concluída: ' || current.title, p_id);
  END IF;
  IF p_status IN ('done', 'cancelled') AND current.recurrence_id IS NOT NULL THEN
    next_task := private.spawn_occurrence(current.recurrence_id, coalesce(current.due_date, private.local_today()));
  END IF;
  RETURN next_task;
END $$;

CREATE FUNCTION public.comment_task(p_id uuid, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.tasks;
BEGIN
  PERFORM private.require_staff();
  SELECT * INTO current FROM public.tasks WHERE id = p_id;
  IF current.id IS NULL OR NOT private.sees_task(current) THEN
    RAISE EXCEPTION 'Tarefa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(coalesce(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'Escreva o comentário.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.task_events (task_id, actor_id, kind, body) VALUES (p_id, auth.uid(), 'comment', trim(p_body));
  PERFORM private.notify(current.assignee_id, 'task_comment', 'Comentário em: ' || current.title, p_id);
  IF current.created_by IS DISTINCT FROM current.assignee_id THEN
    PERFORM private.notify(current.created_by, 'task_comment', 'Comentário em: ' || current.title, p_id);
  END IF;
END $$;

-- Regras de recorrência -----------------------------------------------------------------------

CREATE FUNCTION public.recurrence_list()
RETURNS TABLE (
  id uuid, title text, description text, assignee_id uuid, assignee_name text, priority text, patient_id uuid,
  patient_name text, frequency text, starts_on date, due_time time, active boolean, created_by uuid, creator_name text,
  next_due date, can_edit boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_staff();
  RETURN QUERY
  SELECT r.id, r.title, r.description, r.assignee_id, a.name, r.priority,
    CASE WHEN private.sees_patient(r.patient_id) THEN r.patient_id END,
    CASE WHEN private.sees_patient(r.patient_id) THEN pa.name END,
    r.frequency, r.starts_on, r.due_time, r.active, r.created_by, c.name,
    (SELECT t.due_date FROM public.tasks t WHERE t.recurrence_id = r.id AND t.status IN ('todo', 'doing') LIMIT 1),
    coalesce(r.created_by = auth.uid() OR private.has_permission('tasks.manage'), false)
  FROM public.task_recurrences r
  LEFT JOIN public.profiles a ON a.id = r.assignee_id
  LEFT JOIN public.profiles c ON c.id = r.created_by
  LEFT JOIN public.patients pa ON pa.id = r.patient_id
  WHERE coalesce(r.assignee_id = auth.uid() OR r.created_by = auth.uid() OR private.has_permission('tasks.manage'), false)
  ORDER BY r.active DESC, r.title;
END $$;

-- Cria (e gera a primeira ocorrência) ou edita uma regra. A edição vale para as próximas ocorrências;
-- a que está em aberto acompanha título, descrição, responsável e prioridade.
CREATE FUNCTION public.save_recurrence(
  p_id uuid, p_title text, p_description text, p_assignee_id uuid, p_priority text, p_patient_id uuid,
  p_frequency text, p_starts_on date, p_due_time time
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.task_recurrences;
  saved uuid;
BEGIN
  PERFORM private.require_staff();
  PERFORM private.check_task_patient(p_patient_id);
  IF p_starts_on IS NULL THEN
    RAISE EXCEPTION 'Informe a data da primeira ocorrência.' USING ERRCODE = 'P0001';
  END IF;
  IF p_id IS NULL THEN
    PERFORM private.check_assignee(p_assignee_id);
    INSERT INTO public.task_recurrences (title, description, assignee_id, priority, patient_id, frequency, starts_on, due_time)
    VALUES (trim(p_title), nullif(trim(p_description), ''), p_assignee_id, coalesce(p_priority, 'normal'), p_patient_id,
      p_frequency, p_starts_on, p_due_time)
    RETURNING id INTO saved;
    PERFORM private.spawn_occurrence(saved, NULL);
    RETURN saved;
  END IF;

  SELECT * INTO current FROM public.task_recurrences WHERE id = p_id FOR UPDATE;
  IF current.id IS NULL OR NOT coalesce(current.created_by = auth.uid() OR private.has_permission('tasks.manage'), false) THEN
    RAISE EXCEPTION 'Regra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_assignee_id IS DISTINCT FROM current.assignee_id THEN PERFORM private.check_assignee(p_assignee_id); END IF;
  IF current.patient_id IS NOT NULL AND NOT private.sees_patient(current.patient_id) THEN p_patient_id := current.patient_id; END IF;
  UPDATE public.task_recurrences SET title = trim(p_title), description = nullif(trim(p_description), ''),
    assignee_id = p_assignee_id, priority = coalesce(p_priority, priority), patient_id = p_patient_id,
    frequency = p_frequency, starts_on = p_starts_on, due_time = p_due_time, updated_at = now()
  WHERE id = p_id;
  UPDATE public.tasks SET title = trim(p_title), description = nullif(trim(p_description), ''), assignee_id = p_assignee_id,
    priority = coalesce(p_priority, priority), patient_id = p_patient_id, updated_at = now()
  WHERE recurrence_id = p_id AND status IN ('todo', 'doing');
  RETURN p_id;
END $$;

-- Pausar mantém a ocorrência em aberto; retomar cria a próxima se não houver nenhuma.
CREATE FUNCTION public.set_recurrence_active(p_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current public.task_recurrences;
  last_due date;
BEGIN
  PERFORM private.require_staff();
  SELECT * INTO current FROM public.task_recurrences WHERE id = p_id FOR UPDATE;
  IF current.id IS NULL OR NOT coalesce(current.created_by = auth.uid() OR private.has_permission('tasks.manage'), false) THEN
    RAISE EXCEPTION 'Regra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.task_recurrences SET active = p_active, updated_at = now() WHERE id = p_id;
  IF p_active AND NOT current.active THEN
    SELECT max(due_date) INTO last_due FROM public.tasks WHERE recurrence_id = p_id;
    PERFORM private.spawn_occurrence(p_id, last_due);
  END IF;
END $$;

CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.notifications SET read_at = now()
  WHERE user_id = auth.uid() AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids))
$$;

-- Permissões das funções ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.is_active_staff(uuid), private.require_staff(),
  private.sees_task(public.tasks), private.edits_task(public.tasks), private.check_assignee(uuid),
  private.check_task_patient(uuid), private.notify(uuid, text, text, uuid), private.next_occurrence(text, date, date),
  private.spawn_occurrence(uuid, date)
  FROM PUBLIC, anon, authenticated;
-- Data de hoje no fuso da clínica: sem dados, pode ser usada por todos.
REVOKE ALL ON FUNCTION private.local_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.local_today() TO authenticated;
REVOKE ALL ON FUNCTION public.task_list(text, boolean, uuid), public.task_history(uuid), public.task_assignees(),
  public.task_counts(), public.save_task(uuid, text, text, uuid, text, date, time, uuid), public.set_task_status(uuid, text),
  public.comment_task(uuid, text), public.recurrence_list(),
  public.save_recurrence(uuid, text, text, uuid, text, uuid, text, date, time), public.set_recurrence_active(uuid, boolean),
  public.mark_notifications_read(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_list(text, boolean, uuid), public.task_history(uuid), public.task_assignees(),
  public.task_counts(), public.save_task(uuid, text, text, uuid, text, date, time, uuid), public.set_task_status(uuid, text),
  public.comment_task(uuid, text), public.recurrence_list(),
  public.save_recurrence(uuid, text, text, uuid, text, uuid, text, date, time), public.set_recurrence_active(uuid, boolean),
  public.mark_notifications_read(uuid[])
  TO authenticated;
