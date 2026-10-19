-- Remove TUDO o que está ligado aos dados de homologação (pacientes com [HOMOLOGAÇÃO] na observação
-- administrativa, tarefas e contatos marcados), inclusive o que a equipe registrou para eles durante os
-- testes (sessões, evoluções, cobranças, pagamentos, documentos, acessos ao portal).
-- Uso: node tests/homologacao/rodar.mjs limpar   (o script também apaga os arquivos enviados)
CREATE TEMP TABLE alvo AS SELECT id FROM public.patients WHERE admin_notes LIKE '[HOMOLOGAÇÃO]%';
-- Ids de tudo o que sai, para apagar também o registro de auditoria desses dados fictícios.
CREATE TEMP TABLE ids_fict AS
  SELECT id FROM alvo
  UNION SELECT id FROM public.appointments WHERE patient_id IN (SELECT id FROM alvo)
  UNION SELECT id FROM public.charges WHERE patient_id IN (SELECT id FROM alvo)
  UNION SELECT id FROM public.payments WHERE patient_id IN (SELECT id FROM alvo)
  UNION SELECT id FROM public.tasks WHERE patient_id IN (SELECT id FROM alvo) OR title LIKE '[HOMOLOGAÇÃO]%'
  UNION SELECT id FROM public.leads WHERE name LIKE '%[HOMOLOGAÇÃO]' OR patient_id IN (SELECT id FROM alvo)
  UNION SELECT user_id FROM public.portal_access WHERE patient_id IN (SELECT id FROM alvo);

DELETE FROM public.notifications WHERE link IN (
  SELECT '#/tarefas?tarefa=' || t.id FROM public.tasks t WHERE t.patient_id IN (SELECT id FROM alvo) OR t.title LIKE '[HOMOLOGAÇÃO]%'
  UNION SELECT '#/comercial?lead=' || l.id FROM public.leads l WHERE l.name LIKE '%[HOMOLOGAÇÃO]');
DELETE FROM public.portal_requests WHERE patient_id IN (SELECT id FROM alvo);
DELETE FROM public.tasks WHERE patient_id IN (SELECT id FROM alvo) OR title LIKE '[HOMOLOGAÇÃO]%'
  OR lead_id IN (SELECT id FROM public.leads WHERE name LIKE '%[HOMOLOGAÇÃO]');
DELETE FROM public.task_recurrences WHERE title LIKE '[HOMOLOGAÇÃO]%';
DELETE FROM public.leads WHERE name LIKE '%[HOMOLOGAÇÃO]' OR patient_id IN (SELECT id FROM alvo);
DELETE FROM public.whatsapp_messages WHERE patient_id IN (SELECT id FROM alvo);
DELETE FROM public.payment_allocations WHERE payment_id IN (SELECT id FROM public.payments WHERE patient_id IN (SELECT id FROM alvo));
DELETE FROM public.payments WHERE patient_id IN (SELECT id FROM alvo);
DELETE FROM public.charges WHERE patient_id IN (SELECT id FROM alvo);
DELETE FROM public.case_formulations WHERE patient_id IN (SELECT id FROM alvo);
DELETE FROM public.clinical_documents WHERE patient_id IN (SELECT id FROM alvo);
-- Evoluções finalizadas são imutáveis por regra; só para estes pacientes fictícios a trava é desligada e
-- religada dentro da mesma transação.
BEGIN;
ALTER TABLE public.clinical_notes DISABLE TRIGGER clinical_notes_protect;
DELETE FROM public.clinical_notes WHERE patient_id IN (SELECT id FROM alvo);
ALTER TABLE public.clinical_notes ENABLE TRIGGER clinical_notes_protect;
COMMIT;
DELETE FROM public.appointments WHERE patient_id IN (SELECT id FROM alvo);
-- Contas do portal criadas para pacientes fictícios (e-mails @example.test) saem junto.
DELETE FROM auth.users WHERE email LIKE '%@example.test' AND id IN (
  SELECT user_id FROM public.portal_access WHERE patient_id IN (SELECT id FROM alvo));
DELETE FROM public.patients WHERE id IN (SELECT id FROM alvo);
DELETE FROM public.audit_log WHERE entity_id IN (SELECT id FROM ids_fict);

SELECT (SELECT count(*) FROM public.patients WHERE admin_notes LIKE '[HOMOLOGAÇÃO]%') AS pacientes_restantes,
  (SELECT count(*) FROM public.tasks WHERE title LIKE '[HOMOLOGAÇÃO]%') AS tarefas_restantes,
  (SELECT count(*) FROM public.leads WHERE name LIKE '%[HOMOLOGAÇÃO]') AS contatos_restantes;
