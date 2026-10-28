# Segurança e LGPD

Como os dados da clínica são protegidos, o que é testado automaticamente e o que ainda é risco conhecido.

## Como a proteção funciona

- **Regras no banco, não na tela.** O navegador e o app usam a chave pública do Supabase; quem decide o que cada pessoa vê é o banco (RLS e funções). Toda tabela tem RLS; o schema `private` (funções auxiliares) não é exposto.
- **Funções chamadas pela tela** (agenda, financeiro, portal…) rodam com privilégio, mas cada uma confere a permissão de quem chama logo no início. São as 117 funções que o verificador do Supabase lista como "executáveis por contas logadas": é o desenho esperado, e a varredura automática (abaixo) prova que nenhuma entrega dados a quem não deve.
- **Chaves e tokens** (chave de serviço, Google, WhatsApp, Anthropic, Resend, Expo) ficam só nos segredos do Supabase e no Vault. A varredura do pacote compilado confirma que nada disso vai para o navegador ou para o app.
- **Arquivos** (documentos administrativos, clínicos e do portal) ficam em armazenamento privado e só abrem por link de 60 segundos, gerado depois da checagem de permissão; aberturas de documentos clínicos e do portal ficam registradas.
- **Prontuário:** só a profissional responsável; cada abertura vai para o registro de acesso clínico. Evoluções finalizadas não podem ser alteradas (só retificadas).
- **Login:** sem cadastro público; senha mínima de 10 caracteres; verificação em duas etapas retirada da tela a pedido da clínica em 28/10/2026; portal do paciente por código no e-mail.
- **Aplicativo:** sessão no cofre do aparelho; trava após 5 minutos em segundo plano; sai após 30 dias sem uso; notificação com texto genérico na tela bloqueada.
- **Navegador:** cabeçalhos de segurança (`web/public/_headers`) com CSP que só permite conexões com o projeto Supabase, HSTS e bloqueio de incorporação em outros sites.

## O que é testado automaticamente

| Teste | Onde | O que garante |
| --- | --- | --- |
| Permissões por perfil | `supabase/tests/permissions.sql` | Cada perfil vê e altera só o que pode; prontuário só da responsável; portal só do próprio paciente; verificação em duas etapas bloqueia tudo sem o código. |
| Varredura | dentro de `permissions.sql` | Entrando como **paciente** e como **Proprietária sem o código**: todas as tabelas e todas as funções da equipe; nenhuma devolve dados. |
| Estrutura | `supabase/tests/seguranca.sql` | RLS em todas as tabelas; nada para visitante não logado (tabelas, funções, sequências); funções privilegiadas com `search_path` fixo; arquivos privados; matriz de permissões igual à [documentada](matriz-de-acesso.md). |
| Integridade financeira | `supabase/tests/financeiro.sql` | Pagamento parcial, quitação, crédito, estorno, ajuste, cancelamento, cobrança automática e "valor a definir"; nenhuma distribuição além do devido em **todos** os lançamentos do banco; painéis e relatórios iguais à soma dos lançamentos. |
| Atividades dos pacientes | `supabase/tests/atividades_pacientes.sql` | A profissional responsável e a Proprietária criam e veem as atividades e respostas; a Proprietária deve selecionar uma profissional vinculada. O paciente com acesso ativo ao portal e termos aceitos vê e conclui as próprias. Outras pessoas não leem a tabela diretamente. |
| Pagamentos simultâneos | `tests/db-local` | Dois registros do mesmo pagamento ao mesmo tempo não pagam a cobrança duas vezes. |
| Funções publicadas | `tests/integracao/funcoes-publicadas.mjs` | Toda Edge Function recusa chamada sem login, sem segredo ou de outro site. |
| Telas | `tests/e2e` | Fluxos de cada módulo e do portal no navegador, contra o banco real, com limpeza dos dados de teste. |

Os testes do banco rodam a cada publicação de mudanças em `supabase/` (GitHub Action) e com `npm run test:db`.

## Revisão do verificador do Supabase (Bloco 14)

`npx supabase db advisors --linked` apontou 130 alertas. Situação:

- **Corrigidos (11):** 3 funções auxiliares sem `search_path` fixo; 4 regras que recalculavam o usuário a cada linha; 4 regras duplicadas de leitura no financeiro. O teste de segurança achou ainda as sequências (contadores de id) acessíveis a visitante não logado, também corrigidas.
- **Justificados (119):**
  - 117 funções "executáveis por contas logadas": são as chamadas do sistema, cada uma com checagem própria, cobertas pela varredura.
  - Extensão `pg_net` registrada no schema `public`: as funções dela ficam no schema `net`; movê-la exige apagar e recriar a extensão, sem ganho prático.
  - Proteção contra senhas vazadas: só existe no plano Pro (ver configurações pendentes).

## Falha real encontrada e corrigida nesta revisão

**Pagamentos simultâneos** (migração `20261020110000_financeiro_concorrencia.sql`): dois registros de pagamento ao mesmo tempo para a mesma cobrança (dois cliques, ou app e computador juntos) podiam, juntos, pagar a cobrança duas vezes. O teste reproduziu o problema (cobrança de R$ 100 recebendo R$ 200) e confirma a correção: agora a cobrança fica travada durante o cálculo e o segundo pagamento vira crédito do paciente.

## Cópias de segurança

- **Plano Pro do Supabase:** cópia diária automática (recomendado antes dos dados reais).
- **Enquanto estiver no plano gratuito**, cópia manual periódica, guardada em local seguro e criptografado (contém dados de saúde):
  - com Docker Desktop instalado: `npx supabase db dump --linked -f estrutura.sql` e `npx supabase db dump --linked --data-only -f dados.sql`;
  - ou com as ferramentas do Postgres (`brew install libpq`): `pg_dump "<connection string>" > copia.sql` (a connection string fica em **Project Settings → Database**).
  - Os **arquivos** (documentos) não entram no dump; baixe-os pelo painel (**Storage**) se necessário.

## Em caso de incidente

1. **Conta comprometida:** desative a conta em **Usuários** (corta o acesso na hora) e troque a senhao.
2. **Chave ou token vazado:** gere outro no serviço de origem e atualize com `npx supabase secrets set …`; para a chave do Supabase, gere novas chaves em **Project Settings → API**.
3. **Registro:** o `audit_log` e o registro de acesso clínico mostram quem fez o quê e quando.
4. **LGPD:** incidentes com risco aos titulares devem ser comunicados à ANPD e aos titulares (art. 48). Envolva o encarregado.

## LGPD em resumo

- **Bases legais e textos:** ver a [política de privacidade](../web/public/privacidade.html) (rascunho para revisão jurídica).
- **Minimização:** o Google recebe só as iniciais do paciente (configurável); notificações e e-mails têm texto genérico; o assistente de IA recebe a transcrição com nomes, documentos e contatos ocultados.
- **Retenção:** transcrições da IA e de áudios do WhatsApp apagadas em até 30 dias; contatos comerciais anonimizados; prontuário pelo prazo do CFP.
- **Direitos do titular:** exportação do prontuário (PDF) pela profissional; correção pelo cadastro; encerramento de acesso ao portal pela clínica.
- **Transferência internacional:** Supabase (servidores em São Paulo, empresa nos EUA), Cloudflare, Expo, Google, Meta, Anthropic e Resend, conforme o que estiver ativado.

## Riscos conhecidos

- **Plano gratuito:** sem cópia automática e com pausa por inatividade.
- **Ferramentas de build do app:** o `npm audit` aponta 25 alertas em ferramentas usadas só para compilar o aplicativo (Expo CLI, Metro, assinatura de código), não no app instalado. Revisar a cada atualização do Expo (`npx expo install --fix`). O sistema web e os testes não têm alertas.
- **Recuperação de senha** depende da administração (ver [configurações pendentes](configuracoes-pendentes.md)).
- **Testes contra o banco real:** os roteiros criam e apagam dados de teste no próprio projeto.
