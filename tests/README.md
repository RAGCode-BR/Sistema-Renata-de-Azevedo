# Testes automáticos

Tudo roda contra o projeto Supabase do `.env` da raiz. Os roteiros criam os próprios dados de teste (contas `@example.test`, pacientes "… E2E") e a limpeza roda depois de cada roteiro, inclusive arquivos.

## Preparação (uma vez)

```sh
cd tests
npm install
npx supabase login     # se ainda não fez neste computador (a chave de serviço é obtida pela CLI, nunca impressa)
```

Requisitos: Google Chrome instalado (ou `CHROME_PATH`); o app da equipe precisa de `npm install` em `mobile/`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `node run.mjs` | Tudo: banco, telas, app, portal, verificação em duas etapas e integrações. Sobe o sistema local se não estiver rodando. |
| `node run.mjs agenda portal` | Só os roteiros cujo nome contém essas palavras. |
| `node run.mjs --sem-app --sem-integracao` | Só banco e telas do sistema web. |
| `npm run test:banco-local` | Aplica todas as migrações num Postgres temporário e roda os testes do banco, inclusive pagamentos simultâneos. Use **antes** de aplicar uma migração nova. |
| `node homologacao/rodar.mjs criar` ou `limpar` | Dados fictícios para a homologação com a equipe ([docs/homologacao.md](../docs/homologacao.md)). |

Registros e capturas de cada rodada ficam em `tests/.saida/` (fora do Git). Com `VERBOSE=1`, a saída de cada roteiro aparece na tela.

## Roteiros

| Nome | Arquivo | Cobre |
| --- | --- | --- |
| banco | `supabase/tests/*.sql` | Permissões (com varredura), segurança da estrutura e integridade financeira |
| geral | `e2e/00-geral.mjs` | Login, menus, painel e páginas principais |
| usuarios | `e2e/01-usuarios.mjs` | Contas, perfis, desativação |
| painel | `e2e/02-painel.mjs` | Indicadores do início por perfil |
| agenda | `e2e/03-agenda.mjs` | Sessões, séries, conflitos, bloqueios |
| pacientes | `e2e/04-pacientes.mjs` | Cadastro, documentos administrativos |
| prontuario | `e2e/05-prontuario.mjs` | Evoluções, finalização, exportação, sigilo |
| financeiro | `e2e/06-financeiro.mjs` | Cobranças, pagamentos, despesas, repasses |
| tarefas | `e2e/07-tarefas.mjs` | Tarefas, recorrências, avisos |
| comercial | `e2e/08-comercial.mjs` | Funil, campanhas, importação de leads |
| relatorios | `e2e/09-relatorios.mjs` | Relatórios e comparativo |
| app | `e2e/12-app-equipe.mjs` | Aplicativo da equipe (versão web, tela de celular) |
| portal | `e2e/13-portal.mjs` | Portal do paciente de ponta a ponta |
| verificacao | `e2e/14-verificacao.mjs` | Verificação em duas etapas (ativar, exigir, entrar com código) |
| funcoes | `integracao/funcoes-publicadas.mjs` | Edge Functions publicadas recusam acesso indevido |
| integracao-* | `integracao/*.mjs` | Google, WhatsApp, IA e portal com as funções rodando localmente (Deno) e os serviços externos simulados |

## Cuidados

- Os roteiros entram com uma **conta de teste temporária** de Proprietária, criada e apagada pelo `run.mjs`; nunca com a conta de uma pessoa real.
- Com a verificação em duas etapas **exigida** (Configurações → Segurança), os roteiros de tela não rodam: o `run.mjs` avisa e para.
- Rodam no banco real: evite rodar durante o atendimento com dados reais. A limpeza apaga só o que tem nomes e e-mails de teste.
