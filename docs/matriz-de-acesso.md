# Matriz de acesso

Quem vê e faz o quê. **A regra vale no banco** (RLS e funções em `supabase/migrations`); o menu só esconde o que a pessoa não pode usar.

- O teste automático `supabase/tests/seguranca.sql` falha se a tabela de permissões do banco ficar diferente desta matriz. Para mudar uma permissão, mude a migração, o teste e este documento juntos.
- Uma pessoa pode ter vários perfis (ex.: Renata = Proprietária + Profissional); as permissões se somam.
- A verificação em duas etapas foi retirada da tela a pedido da clínica em 28/10/2026. No banco, a exigência continua existindo, desligada (`clinic_settings.require_mfa = false`).

## Perfis

| Perfil | Em uma frase |
| --- | --- |
| Proprietária | Administração completa e tarefas reais dos pacientes, inclusive criação, edição e respostas. |
| Gerência | Operação da clínica (agenda, pacientes, cobranças e comercial), sem usuários, configurações e resultado financeiro. |
| Recepção | Agenda, pacientes, cobranças, comercial e WhatsApp. |
| Financeiro | Cobranças, despesas, resultado e repasses. |
| Profissional | Os próprios pacientes, a própria agenda, o próprio prontuário e o próprio repasse. |
| Paciente | Só o portal: as próprias sessões, cobranças e documentos compartilhados. Não entra no sistema nem no app da equipe. |

## Permissões por perfil (tabela `role_permissions`)

| Permissão | O que libera | Proprietária | Gerência | Recepção | Financeiro |
| --- | --- | :-: | :-: | :-: | :-: |
| `users.manage` | Usuários (criar, editar perfis, desativar, excluir) | ✔ | | | |
| `settings.manage` | Configurações (prontuário, cobrança, Google, WhatsApp, IA, push, portal, segurança) | ✔ | | | |
| `professionals.manage` | Cadastro de profissionais | ✔ | ✔ | | |
| `patients.view_all` | Todos os pacientes | ✔ | ✔ | ✔ | |
| `patients.manage` | Cadastrar e editar pacientes; documentos administrativos; acesso ao portal | ✔ | ✔ | ✔ | |
| `appointments.view_all` | Agenda de todas as profissionais; controle de prontuários (só a situação, sem conteúdo) | ✔ | ✔ | ✔ | |
| `appointments.manage` | Marcar, remarcar, cancelar e registrar presença de qualquer profissional | ✔ | ✔ | ✔ | |
| `calendars.view_all` | Calendários do Google de todas | ✔ | ✔ | | |
| `billing.view` | Cobranças e pagamentos | ✔ | ✔ | ✔ | ✔ |
| `billing.manage` | Lançar cobranças e registrar pagamentos | ✔ | ✔ | ✔ | ✔ |
| `finance.view` | Visão geral financeira, despesas, repasses, DRE | ✔ | | | ✔ |
| `finance.manage` | Lançar despesas, preços e repasses | ✔ | | | ✔ |
| `tasks.manage` | Permissão legada de registros internos; módulo retirado da interface | ✔ | ✔ | | |
| `patient_activities.manage_all` | Ver e gerir tarefas e respostas de todos os pacientes; escolher uma profissional vinculada | ✔ | | | |
| `crm.view` | Comercial (funil, campanhas, painel) | ✔ | ✔ | ✔ | |
| `crm.manage` | Configurar o comercial | ✔ | ✔ | ✔ | |
| `messages.manage` | Conversas do WhatsApp | ✔ | ✔ | ✔ | |

**Profissional** não tem permissões de cargo: o acesso vem do vínculo com cada paciente (profissional responsável).

## Regras que não seguem o cargo

- **Prontuário:** só a profissional responsável lê e escreve as evoluções dos próprios pacientes. Nem a Proprietária nem a Gerência leem o prontuário de outra profissional; elas veem só a situação (pendente, finalizado, fora do prazo). Cada abertura fica registrada.
- **Tarefas dos pacientes (exceção decidida pela clínica em 27/10/2026):** a Proprietária vê e edita o conteúdo das tarefas de todas as profissionais, inclusive orientações e respostas do paciente. A Gerência e as demais funções não veem.
- **Formulários e escalas no portal (decidido pela clínica em 27/10/2026):** o paciente (ou responsável) vê as próprias respostas e a pontuação das escalas logo ao enviar, antes da devolutiva.
- **Mensagens de WhatsApp do lead (decidido pela clínica em 27/10/2026):** ao converter o lead em paciente, as mensagens recebidas durante o contato comercial passam a constar no paciente e ficam visíveis para a profissional responsável (por exemplo, ao criar tarefas a partir do WhatsApp).
- **Assistente de IA:** só a profissional responsável, com o termo dela aceito e o consentimento do paciente registrado.
- **Portal:** o paciente (ou responsável) vê só os pacientes vinculados à própria conta; acesso revogado corta tudo na hora.
- **Contas:** ninguém exclui ou desativa a própria conta; sempre resta uma Proprietária ativa.

## Telas por perfil (sistema web)

| Módulo → tela | Proprietária | Gerência | Recepção | Financeiro | Profissional |
| --- | :-: | :-: | :-: | :-: | :-: |
| Início | ✔ | ✔ | ✔ | ✔ | ✔ (o seu dia) |
| Atendimento → Agenda / Google Agenda | ✔ | ✔ | ✔ | tela vazia (sem acesso às sessões) | ✔ (a sua) |
| Atendimento → WhatsApp | ✔ | ✔ | ✔ | | |
| Pacientes → Pacientes | ✔ | ✔ | ✔ | | ✔ (os seus) |
| Pacientes → Prontuários | | | | | ✔ |
| Pacientes → Controle de prontuários | ✔ | ✔ | ✔ | | |
| Equipe → Profissionais | ✔ | ✔ | | | |
| Equipe → Usuários | ✔ | | | | |
| Comercial | ✔ | ✔ | ✔ | | |
| Relatórios → Operacional | ✔ | ✔ | ✔ | | Meus números |
| Relatórios → Financeiro | ✔ | ✔ | ✔ | ✔ | |
| Relatórios → Comercial | ✔ | ✔ | ✔ | | |
| Tarefas → Tarefas enviadas aos pacientes | ✔ (todos) | | | | ✔ (própria carteira) |
| Financeiro → Visão geral, Despesas, Repasses | ✔ | | | ✔ | Meu repasse |
| Financeiro → Cobranças | ✔ | ✔ | ✔ | ✔ | ✔ (dos seus pacientes) |
| Financeiro → Preços | ✔ | ✔ | ✔ | ✔ | |
| Configurações | ✔ | | | | |

O aplicativo da equipe segue as mesmas permissões, com menos telas (ver [módulos](modulos.md#aplicativo-da-equipe-bloco-12)).

## Como é testado

- `supabase/tests/permissions.sql`: cada perfil tenta ver e alterar o que pode e o que não pode, inclusive prontuários, portal e verificação em duas etapas. Inclui uma **varredura** que entra como paciente (e como Proprietária sem o código) e tenta ler todas as tabelas e chamar todas as funções da equipe.
- `supabase/tests/seguranca.sql`: estrutura (RLS em todas as tabelas, nada para visitante não logado, matriz igual a este documento).
- Roteiros no navegador (`tests/e2e`): menus e telas de cada perfil.
