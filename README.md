# Sistema Renata de Azevedo

Este repositório privado agora contém duas partes separadas:

- `index.html` e `assets/`: demonstração estática, com dados fictícios no navegador.
- `web/`, `server/`, `shared/` e `db/`: fundação local do sistema multiusuário, com login e PostgreSQL, toda em TypeScript.
  - `web/`: interface em React (Vite), com o visual da demonstração.
  - `server/`: API em Node.js, que também entrega a interface compilada.
  - `shared/`: formato dos dados trocados entre interface e servidor.
  - `db/`: estrutura do banco PostgreSQL.

O sistema multiusuário ainda é uma base de desenvolvimento. Não está publicado nem conectado ao Google. O [site de demonstração](https://ragcodebr.github.io/sistema-renata-de-azevedo-demo/) continua separado.

## Iniciar localmente

Requisito: Node.js 22.18+. O PostgreSQL vem como dependência do projeto e roda com `npm run db:start`, sem instalação no sistema; os dados ficam em `.data/` (ignorada pelo git). O Node executa os arquivos `.ts` do servidor diretamente; só a interface precisa ser compilada (`npm run build`).

```sh
npm install
npm run db:start
npm run create-admin -- "Nome da administradora" email@exemplo.com
npm run build
npm start
```

Abra `http://127.0.0.1:8787`. O comando `create-admin` gera uma senha inicial e a mostra uma única vez. Para definir a senha, passe-a em `ADMIN_PASSWORD` (`ADMIN_PASSWORD="..." npm run create-admin -- "Nome" email@exemplo.com`). Toda senha precisa ter pelo menos 10 caracteres; a regra fica em `shared/rules.ts`. A administradora pode então cadastrar profissionais e contas individuais pela tela **Contas**. O banco começa vazio; os dados fictícios da demonstração não são importados.

Para trabalhar na interface, deixe `npm start` rodando e, em outro terminal, use `npm run dev`. Abra `http://localhost:5173`: as telas recarregam a cada alteração e as chamadas à API são repassadas ao servidor. Depois de mudar a interface, rode `npm run build` de novo para atualizar o que `npm start` entrega.

`npm run db:start` cria o banco `renata_dev` na primeira vez e reaplica as migrações de `db/` a cada início (elas usam `IF NOT EXISTS`). Para desligar, `npm run db:stop`; para conferir, `npm run db:status`. Depois de reiniciar o Mac, rode `npm run db:start` antes de `npm start`. Para usar um PostgreSQL externo (como o Supabase), defina `DATABASE_URL` e `DATABASE_CA_CERT` no `.env` (veja `.env.example`) e rode `npm run db:migrate` para criar as tabelas. Fora da própria máquina, o servidor exige SSL verificado. A migração `002` ativa o RLS em todas as tabelas, para que a API REST pública do Supabase não acesse nenhum dado. As configurações opcionais estão em `.env.example`; não grave senhas ou chaves no repositório.

## Supabase

O banco definitivo é o projeto **RenatadeAzevedo_Projeto** no Supabase (região São Paulo, `sa-east-1`). Com `DATABASE_URL` no `.env`, `npm start` usa esse banco; sem ela, usa o local.

- O servidor conecta com um usuário próprio, `clinica_app`, sem poderes de administração no Supabase. Ele é dono das tabelas do schema `public` e não precisa da senha do usuário `postgres`.
- A conexão passa pelo *Session pooler* (`aws-1-sa-east-1.pooler.supabase.com:5432`, usuário `clinica_app.<ref do projeto>`) com SSL verificado pelo certificado `Supabase Root 2021 CA`, salvo em `.data/supabase-ca.crt`.
- A API REST pública do Supabase não tem nenhuma permissão nessas tabelas, e o RLS está ativo em todas (migração `002`).
- Para recriar o usuário em outro projeto: `CREATE ROLE clinica_app LOGIN PASSWORD '...'`, `GRANT CONNECT ON DATABASE postgres TO clinica_app` e `GRANT USAGE, CREATE ON SCHEMA public TO clinica_app`. Depois, rode `npm run db:migrate` com a nova `DATABASE_URL`.

## Estrutura de acesso

| Função | Acesso inicial |
| --- | --- |
| Administração (Bárbara e Mari) | Contas, profissionais, pacientes, agenda e visão das conexões Google. Sem acesso às evoluções clínicas. |
| Profissional (Renata e demais) | Seus pacientes, suas sessões, suas próprias evoluções e, futuramente, a autorização da própria conta Google. |

O servidor aplica essas permissões nas rotas da API; esconder um item do menu não é o mecanismo de proteção. Cada conta possui senha própria e sessão em cookie `HttpOnly`. Não há cadastro público de usuários. Os registros de criação e troca de senha vão para `audit_log`.

## Agenda Google

O banco já separa contas Google de calendários e permite vários calendários por profissional. Também existe uma tabela que relaciona sessões internas a eventos Google, necessária para a sincronização nos dois sentidos. **Nenhuma conta Google está conectada ainda**: a tela de agenda informa isso, e a autorização OAuth, seleção de calendários, sincronização e tratamento de conflitos são a próxima etapa. Cada profissional deverá autorizar sua conta; as credenciais OAuth ficarão no servidor, nunca no JavaScript público.

## Próximas etapas antes de uso real

1. Confirmar os e-mails de Bárbara, Mari, Renata e das demais profissionais para criar suas contas.
2. Configurar o projeto Google Cloud e implementar autorização individual, seleção de calendários e sincronização nos dois sentidos.
3. Completar edição/encerramento dos cadastros, recuperação de acesso, cópias de segurança, HTTPS e hospedagem para acesso de vários computadores.
4. Revisar permissões e fazer testes com a equipe antes de inserir dados de pacientes reais.

`npm run typecheck` verifica os tipos do servidor e da interface. `npm test` faz essa verificação e depois cria um banco temporário isolado, testa login, cadastro, conflito de agenda e bloqueio de prontuários para a administração, e remove somente esse banco de teste ao terminar.
