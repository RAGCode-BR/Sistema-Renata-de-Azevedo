# Sistema Renata de Azevedo

Sistema da clínica Renata de Azevedo: atendimento, prontuário, financeiro, tarefas, comercial e relatórios, com aplicativo da equipe e portal do paciente.

| Parte | Pasta | O que é |
| --- | --- | --- |
| Sistema da equipe e portal do paciente | `web/` | React + TypeScript (Vite), publicado na Cloudflare. O portal abre em `#/portal`. |
| Aplicativo da equipe | `mobile/` | Expo (React Native) para iOS e Android. |
| Banco, regras e funções | `supabase/` | Migrações, regras de acesso (RLS), Edge Functions e testes do banco. |
| Código compartilhado | `shared/` | Acesso aos dados, tipos, permissões e formatação, usados pela web e pelo app. |
| Testes automáticos | `tests/` | Roteiros no navegador, integrações e banco local ([tests/README.md](tests/README.md)). |
| Documentação | `docs/` | Ver o índice abaixo. |

`index.html` e `assets/` na raiz são a demonstração estática antiga, com dados fictícios. Não fazem parte do sistema publicado (a pasta `assets/` também guarda a fonte, o CSS base e o logotipo usados pelo sistema).

## Documentação

- [Módulos](docs/modulos.md): como cada parte funciona.
- [Configurações pendentes](docs/configuracoes-pendentes.md): tudo o que falta configurar antes do uso real, numa lista só.
- [Matriz de acesso](docs/matriz-de-acesso.md): o que cada perfil vê e faz.
- [Segurança e LGPD](docs/seguranca-lgpd.md): como os dados são protegidos, o que é testado e os riscos conhecidos.
- [Homologação](docs/homologacao.md): roteiro para a equipe validar o sistema com dados fictícios.
- [Guia rápido da equipe](docs/guia-rapido.md): o essencial de cada perfil.
- [Lojas de aplicativos](docs/lojas.md): preparação do app para Google Play e App Store.
- [Publicação](docs/publicacao.md): passo a passo para colocar no ar (só com autorização).

## Arquitetura

```
Navegador / app (React) ──supabase-js──▶ Supabase (São Paulo)
                                         ├─ Auth: login (sem cadastro público), código por e-mail (portal), verificação em duas etapas
                                         ├─ Banco + RLS: quem vê e altera o quê (todas as regras ficam aqui)
                                         ├─ Storage: arquivos privados, abertos só por link temporário
                                         ├─ Edge Functions: o que precisa da chave de serviço (contas, Google, WhatsApp, IA, push, e-mails)
                                         └─ pg_cron: rotinas (sincronizações, lembretes, limpezas)
Cloudflare: publica só a interface compilada (web/dist)
```

A interface usa a chave **pública** do Supabase. Por isso **toda regra de acesso está no banco**: esconder um item do menu não protege nada. A interface nunca recebe a chave de serviço, tokens de terceiros nem o registro de auditoria.

## Iniciar localmente

Requisito: Node.js 22.12+.

```sh
npm install
cp .env.example .env   # URL e chave pública do projeto (Project Settings → API)
npm run dev            # http://localhost:5173 (portal: http://localhost:5173/#/portal)
```

Não há banco local para o dia a dia: o desenvolvimento usa o próprio projeto do Supabase. **Nunca** coloque a chave *secret*/*service_role* no `.env`: tudo que começa com `VITE_` vai para o navegador.

Aplicativo: ver [docs/modulos.md → Aplicativo da equipe](docs/modulos.md#aplicativo-da-equipe-bloco-12).

## Supabase

Projeto **RenatadeAzevedo_Projeto** (região São Paulo). Os comandos usam o Supabase CLI do projeto (`npx supabase login` uma vez por computador).

| Comando | O que faz |
| --- | --- |
| `npm run db:push` | Aplica as migrações novas de `supabase/migrations`. |
| `npm run functions:deploy` | Publica as Edge Functions. |
| `npm run test:db` | Testes do banco no projeto real, numa transação desfeita no final: permissões, segurança e integridade financeira. |
| `npm run db:types` | Gera os tipos TypeScript do banco em `shared/database.types.ts`. |

- **Migrações:** crie um arquivo novo com `npx supabase migration new descricao`; não edite migrações já aplicadas. Antes de aplicar, rode `npm run test:banco-local` em `tests/` (aplica tudo num Postgres temporário). Toda tabela nova precisa de RLS e de políticas próprias.
- **Automático:** a GitHub Action `.github/workflows/supabase.yml` aplica migrações, publica as Edge Functions e roda os testes do banco a cada push na `main` que mexa em `supabase/`. Precisa dos segredos `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` no repositório.
- **Login:** configuração em `supabase/config.toml` (sem cadastro público, senha mínima de 10 caracteres, código de 6 dígitos no portal). No projeto real, os ajustes de e-mail ficam no painel (ver [configurações pendentes](docs/configuracoes-pendentes.md)).

## Testes

```sh
cd tests && npm install
node run.mjs                 # tudo: banco, telas, app, portal, verificação em duas etapas e integrações
node run.mjs agenda portal   # só alguns roteiros
npm run test:banco-local     # migrações e testes do banco num Postgres temporário (inclui pagamentos simultâneos)
```

Detalhes em [tests/README.md](tests/README.md). Os roteiros criam e apagam os próprios dados de teste e entram com uma conta de teste temporária, nunca com a conta de uma pessoa real.

## Publicação

O sistema está em `https://sistema-renata-de-azevedo.ragcodebr.workers.dev/` (Cloudflare Workers, plano gratuito; configuração em `wrangler.jsonc`). Build: `npm run build`; publicação: `npm run deploy` ou integração do painel da Cloudflare com o GitHub, com as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

- Cabeçalhos de segurança (CSP) em `web/public/_headers`: só liberam conexões com o projeto Supabase. Em domínio próprio, deixe desligados o *Rocket Loader* e a *Email Obfuscation* da Cloudflare.
- Política de privacidade pública: `/privacidade.html` (rascunho para revisão jurídica).
- Passo a passo completo, incluindo lojas: [docs/publicacao.md](docs/publicacao.md).
