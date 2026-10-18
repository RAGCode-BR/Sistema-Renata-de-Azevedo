# Sistema Renata de Azevedo

Este repositório público contém duas partes separadas:

- `index.html` e `assets/`: demonstração estática, com dados fictícios no navegador. Não é a aplicação publicada pela Cloudflare.
- O sistema da clínica, em React + TypeScript com **Supabase**:
  - `web/`: interface (Vite), com o visual da demonstração.
  - `supabase/`: banco (migrações), regras de acesso (RLS), Edge Functions e configuração do login.
  - `shared/`: tipos e regras usados pela interface.

O sistema ainda não está conectado ao Google nem usa dados reais de pacientes.

## Arquitetura

```
Navegador (React) ──supabase-js──▶ Supabase
                                   ├─ Auth: login (sem cadastro público)
                                   ├─ Banco + RLS: quem vê e altera o quê
                                   └─ Edge Functions: o que precisa da chave de serviço
Cloudflare: publica só a interface (web/dist)
```

A interface usa a chave **pública** do Supabase. Por isso **toda regra de acesso está no banco**, nas políticas RLS de `supabase/migrations`. Esconder um item do menu não protege nada.

- Sem login, nenhuma tabela pode ser lida.
- A interface nunca recebe a chave de serviço, os tokens do Google nem o registro de auditoria.

## Iniciar localmente

Requisito: Node.js 22.12+.

```sh
npm install
cp .env.example .env   # preencha com a URL e a chave pública do projeto
npm run dev
```

Abra `http://localhost:5173`. Não há banco local: o desenvolvimento usa o próprio projeto do Supabase.

O `.env` tem duas variáveis, as duas públicas:
- `VITE_SUPABASE_URL`: endereço do projeto, em **Project Settings → API**.
- `VITE_SUPABASE_ANON_KEY`: a chave *publishable* (ou *anon*), na mesma tela.

**Nunca** coloque a chave *secret*/*service_role* no `.env`: tudo que começa com `VITE_` vai para o navegador.

## Supabase

Projeto **RenatadeAzevedo_Projeto** (região São Paulo, `sa-east-1`). Os comandos usam o Supabase CLI do projeto (`npx supabase login` uma vez por computador).

| Comando | O que faz |
| --- | --- |
| `npm run db:push` | Aplica as migrações novas de `supabase/migrations`. |
| `npm run functions:deploy` | Publica as Edge Functions (`admin-create-user`, `admin-delete-user`). |
| `npm run test:db` | Testa as permissões (RLS) numa transação desfeita no final, sem deixar dados. |
| `npm run db:types` | Gera os tipos TypeScript do banco em `shared/database.types.ts`. |

- **Migrações:**
  - Para mudar o banco, crie um arquivo novo com `npx supabase migration new descricao`. Não edite migrações já aplicadas.
  - Toda tabela nova precisa de RLS e de políticas próprias: o Supabase concede acesso padrão às tabelas novas do schema `public`.
- **Automático:** a GitHub Action `.github/workflows/supabase.yml` aplica migrações, publica as Edge Functions e roda o teste de permissões a cada push na `main` que mexa em `supabase/`. Ela precisa dos segredos `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` no repositório.
- **Login:** a configuração fica em `supabase/config.toml`: sem cadastro público, senha mínima de 10 caracteres (a mesma de `shared/rules.ts`). Para aplicá-la ao projeto, use `npx supabase config push`.

## Usuários

Não há cadastro público. Quem tem a permissão **gerenciar usuários** (hoje, só Proprietário(a)) cria, edita e exclui contas na página **Usuários**.

- **Criar:** a Edge Function `admin-create-user` cria a conta no Supabase Auth, com os perfis em `app_metadata.roles`. O gatilho `on_auth_user_created` cria o perfil e os perfis de acesso. Uma conta sem perfis, criada fora da função, não tem acesso a nada.
- **Editar** perfis, profissional vinculada e situação (ativa/inativa): função do banco `set_user_access`. Desativar corta o acesso na hora, porque as políticas conferem isso a cada consulta.
- **Excluir:** Edge Function `admin-delete-user`. Prontuários e sessões continuam guardados, porque pertencem à profissional (`professionals`), não à conta.
- **Regras, aplicadas no banco e nas funções:**
  - Ninguém exclui ou desativa a própria conta, nem tira de si o perfil de Proprietário(a).
  - Sempre resta ao menos um(a) Proprietário(a) ativo(a).
  - O perfil Profissional exige uma profissional vinculada, e cada profissional tem no máximo uma conta.
  - Criações, alterações de perfis e exclusões vão para `audit_log`.

**A primeira conta** precisa ser criada por fora, uma única vez. Em **Authentication → Users → Add user** (com *Auto Confirm User*), defina em *app_metadata* `{"roles": ["owner"]}` e o nome em *user_metadata* `{"name": "..."}`.

## Deploy na Cloudflare

A Cloudflare publica apenas a interface compilada, configurada em `wrangler.jsonc`. Funciona no plano gratuito.

- **Pelo painel (integração com o GitHub):**
  - Comando de build: `npm run build`. Comando de implantação: `npx wrangler deploy`.
  - Em **Variáveis de build**, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- **Pelo terminal:** `npm run deploy`.
- **Depois do primeiro deploy:**
  - Coloque o endereço publicado em `site_url` (e em `additional_redirect_urls`) no `supabase/config.toml` e rode `npx supabase config push`.
  - Os cabeçalhos de segurança estão em `web/public/_headers`. A política de segurança (CSP) só libera conexões com o projeto Supabase. Se trocar de projeto, atualize esse arquivo.
  - Em domínio próprio, deixe desligados o *Rocket Loader* e a *Email Obfuscation*, que inserem scripts bloqueados pela CSP.

## Estrutura de acesso

Uma pessoa pode ter **vários perfis** (ex.: Renata = Proprietário(a) + Profissional). Cada perfil soma permissões, definidas na tabela `role_permissions`, com os mesmos nomes de `shared/permissions.ts`. As políticas RLS perguntam "tem a permissão X?".

| Perfil | Acesso |
| --- | --- |
| Proprietário(a) (Renata) | Tudo o que é administrativo, inclusive usuários e configurações. |
| Gerente (Mari, Bárbara) | Agenda geral, pacientes, profissionais e calendários. Sem usuários. |
| Recepção (pronto para uso futuro) | Pacientes e agenda. |
| Financeiro (pronto para uso futuro) | Permissões do financeiro (módulo ainda não criado). |
| Profissional | Os próprios pacientes, a própria agenda e o próprio prontuário. |
| Paciente (fase futura) | Nenhum acesso à área da equipe. |

**Prontuários não seguem o cargo:** só a profissional responsável vê as próprias evoluções, e só de pacientes da própria carteira. Nem Proprietário(a) nem Gerente leem o prontuário de outra profissional.

## Painel inicial

A página **Início** é a primeira depois do login e mostra só dados reais, filtrados pelas permissões de cada perfil:
- **Quem vê a agenda geral** (Proprietário(a), Gerente, Recepção): sessões de hoje e dos próximos 7 dias, pacientes ativos, profissionais em atividade, a próxima sessão e as evoluções pendentes **por profissional**, sem acesso ao conteúdo.
- **Profissional:** a própria agenda e as próprias evoluções pendentes. Cada uma é um atalho que abre o prontuário já na paciente e na sessão (`#/prontuarios?paciente=…&sessao=…`).
- **Evolução pendente:** sessão que já terminou, não foi cancelada nem marcada como falta, e não tem evolução ligada a ela (`clinical_notes.appointment_id`). Vem da função `pending_clinical_notes()`, que informa só a existência da pendência, nunca o texto do prontuário.
- **Fora do painel por enquanto:** indicadores de financeiro, CRM e tarefas, que entram junto com esses módulos.

## Agenda

Visões de **Dia** (uma coluna por profissional), **Semana** e **Mês**, com filtros por profissional e especialidade. Clicar num horário livre abre uma sessão nova (ou um bloqueio, para a profissional); clicar numa sessão abre os detalhes, as ações e o histórico.

- **Situações:** Agendada, Aguardando confirmação, Confirmada, Realizada, Paciente faltou, Cancelada pelo paciente, Cancelada pela clínica e Remarcada. Cancelamento, falta e remarcação são coisas diferentes.
- **Ações** (funções do banco; a interface não altera `appointments` diretamente):
  - `set_appointment_status`: confirmar, aguardar confirmação, registrar presença ou falta (só depois do início) e corrigir a situação.
  - `cancel_appointment`: com motivo e opção de cancelar também as próximas da série.
  - `reschedule_appointment`: a sessão original fica "Remarcada" e uma nova, ligada a ela, ocupa o novo horário.
  - `create_appointment_series`: semanal, quinzenal ou mensal, de 2 a 52 sessões. Se alguma data tiver conflito, nenhuma é criada e a mensagem diz qual data impediu.
- **Quem pode:** a gerência (`appointments.manage`) mexe em qualquer agenda; a profissional, na própria. Séries e sessões novas são da gerência.
- **Conflitos, no banco:** uma profissional não tem duas sessões ativas no mesmo horário, nem sessão sobre um bloqueio (e vice-versa).
- **Bloqueios:** com motivo opcionalmente **privado**, que só a profissional e quem bloqueou veem; os demais veem "Horário bloqueado". A tabela só é acessada pelas funções `list_schedule_blocks`, `create_schedule_block` e `delete_schedule_block`.
- **Histórico:** toda criação e mudança de situação vai para `appointment_events` (por gatilho), com quem fez e quando.
- **Pendências no Início:** sessão passada ainda agendada/confirmada é **presença não registrada**; sessão **realizada** sem evolução é **evolução pendente**.
- **Tipo de atendimento** (individual, casal, família, grupo, avaliação) é separado da **modalidade** (presencial/on-line).
- **Fora deste bloco:** lista de espera e o segundo paciente na terapia de casal.

## Pacientes

- **Lista** com busca (nome, nome social, e-mail ou telefone) e filtro por situação: em acompanhamento, pausado, alta, encerrado.
- **Página do paciente** (`#/pacientes?id=…`), com abas:
  - **Visão geral:** cadastro, acompanhamento, responsável legal e observações administrativas.
  - **Sessões:** realizadas, faltas, canceladas pelo paciente, próximas e histórico.
  - **Documentos.**
  - **Prontuário:** atalho só para a profissional responsável.
  - **Financeiro:** chega com o módulo financeiro.
- **Cadastro:** só dados administrativos. Nascimento de menor de idade pede o responsável legal; CPF é opcional, validado e único.
- **Gravação:** pela função `save_patient`, que cria ou edita e acerta os vínculos com profissionais numa transação, e só funciona para quem tem `patients.manage`. Tirar uma profissional do vínculo tira dela o acesso ao paciente; o que ela registrou continua guardado. Criações e edições vão para `audit_log`.
- **Documentos administrativos:**
  - Ficam no bucket **privado** `patient-documents`, em `patients/<id do paciente>/`. São PDF, imagem ou Word, até 10 MB.
  - Lê quem vê o paciente; envia e exclui quem tem `patients.manage`.
  - São abertos só por **link temporário** de 60 segundos.
  - Documentos clínicos ficam com o prontuário, não aqui.

## Prontuário

**Princípio:** o conteúdo clínico não é lido nem gravado direto nas tabelas, e ninguém tem acesso direto a elas. Tudo passa por funções do banco que exigem a **profissional responsável** (perfil Profissional com o paciente na carteira) e registram o acesso em `clinical_access_log`: aberturas, exportações e documentos abertos. Nem Proprietário(a) nem Gerente leem o conteúdo; quem gerencia usuários vê só **quem** acessou e quando.

- **Evolução:**
  - Rascunho editável: cada alteração guarda a versão anterior em `clinical_note_revisions`.
  - Finalizada: imutável, travada por gatilho no banco.
  - Correção: só por **retificação**, que é um novo registro finalizado, ligado ao original e com motivo. O original continua visível.
- **Anotações pessoais:** da profissional, editáveis, fora do prontuário formal e da exportação.
- **Conceitualização de caso:**
  - O modelo da clínica separa modalidade, motivo da procura e hipóteses diagnósticas.
  - Cada profissional pode criar modelos próprios ("Meus modelos").
  - As seções ficam copiadas na conceitualização, então mudar o modelo não altera o que já foi escrito. Cada alteração guarda a versão anterior.
  - O documento da Gabriela pode virar um modelo quando estiver disponível.
- **Documentos clínicos:**
  - Ficam no bucket privado `clinical-documents`, que não tem leitura direta.
  - O link de 60 segundos vem da Edge Function `clinical-document-url`, que confere a autoria e registra a abertura.
  - Não são excluídos: seguem a guarda do prontuário.
- **Exportação** (`#/prontuario-impressao?paciente=…`): evoluções finalizadas, retificações e conceitualização, para imprimir ou salvar em PDF pelo navegador. Fica registrada.
- **Controle de preenchimento** (página **Controle de prontuários**, para quem vê a agenda geral):
  - Cada sessão realizada aparece como Pendente, Rascunho, Finalizado ou Finalizado fora do prazo, e "atrasada" quando o prazo venceu sem finalização.
  - O prazo fica em **Configurações** (padrão de 48 h após a sessão).
- **Assinatura:** a finalização registra quem finalizou e quando. Assinatura digital com certificado (ICP-Brasil), se exigida, é uma etapa posterior.

## Financeiro

**Quem vê o quê:**

| Perfil | Acesso |
|---|---|
| Proprietário(a) e Financeiro | Tudo: visão geral, cobranças, despesas, repasses e preços |
| Gerente e Recepção | Cobranças e pagamentos, inadimplência e tabela de preços (só leitura). Não veem resultado, despesas nem repasses |
| Profissional | Só as cobranças das próprias sessões (sem valores de caixa) e o próprio repasse |

Cobranças, pagamentos, alocações e repasses não têm acesso direto às tabelas. Tudo passa por funções do banco, que fazem as somas e aplicam as regras.

- **Preços:** na hora de cobrar vale, nesta ordem:
  1. valor combinado com o paciente (aba Financeiro do paciente);
  2. profissional + tipo de sessão;
  3. profissional;
  4. tipo de sessão;
  5. padrão da clínica.

  Sem preço, a cobrança fica como **Valor a definir** e continua em aberto até alguém definir o valor.
- **Cobrança automática:** é criada quando a sessão vira **Realizada** (100%), **Falta** (padrão 100%) ou **cancelamento pelo paciente com menos de 24 h** (padrão 100%). Os percentuais e o prazo ficam em **Configurações**. Cancelamento pela clínica não cobra. Corrigir a situação da sessão não duplica a cobrança. Competência e vencimento seguem a data da sessão.
- **Pagamento:** PIX, dinheiro, débito, crédito ou transferência. Quita as cobranças marcadas, na ordem do vencimento. O que sobra vira **crédito do paciente** e é abatido sozinho das próximas cobranças, o que atende pacotes e pagamentos adiantados.
- **Estorno e cancelamento:** pedem motivo e ficam na auditoria. O estorno reabre as cobranças que o pagamento quitava. Ao cancelar uma cobrança, o que já foi pago volta a ser crédito.
- **Repasse:**
  - É o percentual da profissional sobre o valor **recebido** no mês pelas sessões dela.
  - O fechamento só é possível em meses encerrados e congela a base, o percentual e o valor.
- **Visão geral:**
  - O faturado conta pela data da sessão (competência). O recebido, as despesas pagas e os repasses contam pela data do caixa.
  - Resultado de caixa = recebido − despesas pagas − repasses.
  - Cada indicador traz a comparação com o mês anterior e com o mesmo mês do ano passado.
  - O gráfico de entradas e saídas mostra os 12 meses e pode ser visto também em tabela.
- **Despesas:** cada uma tem categoria e centro de custo, e as duas listas podem ser editadas em **Despesas**. Os centros de custo iniciais são Administrativo, Atendimento clínico, Comercial e marketing.
- **Fica para depois:** recibos e nota fiscal, importação do Yampa/Clinical Experts, conciliação bancária e PIX automático.

## Agenda Google

O banco já separa contas Google de calendários e permite vários calendários por profissional. Também há uma tabela que liga sessões a eventos do Google, necessária para a sincronização nos dois sentidos.

**Nenhuma conta Google está conectada ainda.** A autorização OAuth, a sincronização e o tratamento de conflitos ficarão em Edge Functions. Os tokens ficam em `google_accounts`, que a interface não consegue ler.

## Próximas etapas antes de uso real

1. Confirmar os e-mails de Bárbara, Mari, Renata e das demais profissionais para criar suas contas.
2. Configurar o Google Cloud e implementar a autorização individual e a sincronização da agenda.
3. Completar edição e encerramento dos cadastros, recuperação de acesso e cópias de segurança (plano Pro do Supabase).
4. Revisar permissões e testar com a equipe antes de inserir dados de pacientes reais.
