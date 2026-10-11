# Sistema Renata de Azevedo

Este repositório privado agora contém duas partes separadas:

- `index.html` e `assets/`: demonstração estática, com dados fictícios no navegador.
- `system/`, `server/` e `db/`: fundação local do sistema multiusuário, com login e PostgreSQL.

O sistema multiusuário ainda é uma base de desenvolvimento. Não está publicado nem conectado ao Google. O [site de demonstração](https://ragcodebr.github.io/sistema-renata-de-azevedo-demo/) continua separado.

## Iniciar localmente

Requisitos: Node.js 22+ e PostgreSQL 16+ em execução. Neste Mac, ambos já estão instalados.

```sh
npm install
createdb renata_dev
psql -v ON_ERROR_STOP=1 -d renata_dev -f db/001_foundation.sql
npm run create-admin -- "Nome da administradora" email@exemplo.com
npm start
```

Abra `http://127.0.0.1:8787`. O comando `create-admin` gera uma senha inicial e a mostra uma única vez. A administradora pode então cadastrar profissionais e contas individuais pela tela **Contas**. O banco começa vazio; os dados fictícios da demonstração não são importados.

Se o banco já existir, pule `createdb` e aplique a migração apenas uma vez. As configurações opcionais estão em `.env.example`; não grave senhas ou chaves no repositório.

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

`npm test` cria um banco temporário isolado, testa login, cadastro, conflito de agenda e bloqueio de prontuários para a administração, e remove somente esse banco de teste ao terminar.
