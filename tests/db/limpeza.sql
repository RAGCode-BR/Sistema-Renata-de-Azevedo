-- Remove apenas os dados criados pelos roteiros de teste (nomes e e-mails de teste fixos).
-- {{INICIO}} é preenchido por tests/run.mjs com o horário de início da rodada.
-- Comercial (Bloco 8): leads, campanha, tarefas e avisos de teste; responsável padrão só volta a vazio se era conta de teste.
DELETE FROM public.notifications WHERE link IN (SELECT '#/comercial?lead=' || id FROM public.leads WHERE name LIKE '%E2E')
  OR link IN (SELECT '#/tarefas?tarefa=' || t.id FROM public.tasks t JOIN public.leads l ON l.id = t.lead_id WHERE l.name LIKE '%E2E');
DELETE FROM public.tasks WHERE lead_id IN (SELECT id FROM public.leads WHERE name LIKE '%E2E');
DELETE FROM public.leads WHERE name LIKE '%E2E';
DELETE FROM public.campaigns WHERE name LIKE '%E2E';
UPDATE public.crm_settings SET default_owner_id = NULL
  WHERE default_owner_id IN (SELECT id FROM auth.users WHERE email LIKE '%@example.test');
DELETE FROM public.lead_capture_log WHERE created_at >= '{{INICIO}}';
-- Tarefas (Bloco 7): tarefas e regras de teste e os avisos ligados a elas.
DELETE FROM public.notifications WHERE link IN (SELECT '#/tarefas?tarefa=' || id FROM public.tasks WHERE title IN ('Fechar caixa do mês E2E', 'Conferir agenda E2E'));
DELETE FROM public.tasks WHERE title IN ('Fechar caixa do mês E2E', 'Conferir agenda E2E');
DELETE FROM public.task_recurrences WHERE title IN ('Fechar caixa do mês E2E', 'Conferir agenda E2E');
-- Financeiro (Bloco 6): dados do paciente/profissional de teste.
DELETE FROM public.payment_allocations WHERE payment_id IN (SELECT id FROM public.payments WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E')));
DELETE FROM public.payments WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
DELETE FROM public.charges WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
DELETE FROM public.patient_prices WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
DELETE FROM public.payouts WHERE professional_id IN (SELECT id FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso'));
DELETE FROM public.payout_settings WHERE professional_id IN (SELECT id FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso'));
DELETE FROM public.session_prices WHERE professional_id IN (SELECT id FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso'));
DELETE FROM public.expenses WHERE description IN ('Aluguel teste E2E', 'Relatório E2E despesa');
DELETE FROM public.case_formulations WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
DELETE FROM public.clinical_documents WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
-- Evoluções finalizadas são imutáveis por regra; só para apagar dados de teste, a trava é desligada
-- e religada dentro da mesma transação.
BEGIN;
ALTER TABLE public.clinical_notes DISABLE TRIGGER clinical_notes_protect;
DELETE FROM public.clinical_notes WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
ALTER TABLE public.clinical_notes ENABLE TRIGGER clinical_notes_protect;
COMMIT;
DELETE FROM public.case_formulation_templates WHERE professional_id IN (SELECT id FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso'));
DELETE FROM public.appointments WHERE patient_id IN (SELECT id FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E'));
DELETE FROM public.patients WHERE name IN ('Paciente Exemplo', 'Paciente Painel', 'Paciente Agenda', 'Paciente Ficha', 'Paciente Prontuario', 'Paciente Financeiro', 'Lead Site E2E', 'Paciente Relatório E2E');
-- Auditoria desta rodada feita pelas contas de teste (ou já sem autor): sai antes das contas.
DELETE FROM public.audit_log WHERE created_at >= '{{INICIO}}'
  AND (actor_user_id IS NULL OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@example.test'));
-- Contas de teste: sempre no domínio reservado example.test (nunca é de uma pessoa real).
DELETE FROM auth.users WHERE email LIKE '%@example.test';
DELETE FROM public.schedule_blocks WHERE professional_id IN (SELECT id FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso'));
DELETE FROM public.professionals WHERE name IN ('Teste Renata', 'Teste Mariana', 'Teste Exclusão', 'Teste Permissão', 'Teste Atende', 'Teste Painel', 'Teste Agenda', 'Teste Ficha', 'Teste Prontuario', 'Teste Financeiro', 'Teste Comercial Prof', 'Teste Relatório Prof', 'Teste Acesso');
DELETE FROM public.audit_log WHERE created_at >= '{{INICIO}}' AND actor_user_id IS NULL;
SELECT (SELECT count(*) FROM public.professionals) AS profissionais, (SELECT count(*) FROM public.patients) AS pacientes,
  (SELECT count(*) FROM public.appointments) AS sessoes, (SELECT count(*) FROM public.clinical_notes) AS evolucoes,
  (SELECT string_agg(email, ', ') FROM auth.users) AS contas, (SELECT count(*) FROM public.audit_log) AS auditoria;
