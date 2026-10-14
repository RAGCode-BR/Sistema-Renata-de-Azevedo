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

Não há cadastro público. A administração cria e exclui contas na página **Usuários**, que chama as Edge Functions `admin-create-user` e `admin-delete-user`. Para criar, a função:
1. Confere se quem chamou é administração ativa.
2. Cria a conta no Supabase Auth, com o papel em `app_metadata`.
3. O gatilho `on_auth_user_created` cria o perfil.

Uma conta sem papel, criada fora da função, não tem acesso a nada.

**Excluir** remove a conta e o acesso na hora, e fica registrado em `audit_log`:
- Ninguém exclui a própria conta, o que garante que sempre reste uma administração.
- Prontuários e sessões continuam guardados, porque pertencem à profissional (`professionals`), não à conta. A profissional pode receber uma conta nova depois.

**A primeira conta de administração** precisa ser criada por fora, uma única vez. Em **Authentication → Users → Add user** (com *Auto Confirm User*), defina em *app_metadata* `{"role": "admin"}` e o nome em *user_metadata* `{"name": "..."}`.

**Desativar uma conta** (`profiles.active = false`) corta o acesso na hora, porque as políticas conferem isso a cada consulta.

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

| Função | Acesso |
| --- | --- |
| Administração (Bárbara e Mari) | Usuários, profissionais, pacientes, agenda e visão das conexões Google. Sem acesso às evoluções clínicas. |
| Profissional (Renata e demais) | Seus pacientes, suas sessões e as próprias evoluções. Futuramente, a autorização da própria conta Google. |

O registro de criações vai para `audit_log`, preenchido por gatilhos no banco.

## Agenda Google

O banco já separa contas Google de calendários e permite vários calendários por profissional. Também há uma tabela que liga sessões a eventos do Google, necessária para a sincronização nos dois sentidos.

**Nenhuma conta Google está conectada ainda.** A autorização OAuth, a sincronização e o tratamento de conflitos ficarão em Edge Functions. Os tokens ficam em `google_accounts`, que a interface não consegue ler.

## Próximas etapas antes de uso real

1. Confirmar os e-mails de Bárbara, Mari, Renata e das demais profissionais para criar suas contas.
2. Configurar o Google Cloud e implementar a autorização individual e a sincronização da agenda.
3. Completar edição e encerramento dos cadastros, recuperação de acesso e cópias de segurança (plano Pro do Supabase).
4. Revisar permissões e testar com a equipe antes de inserir dados de pacientes reais.
