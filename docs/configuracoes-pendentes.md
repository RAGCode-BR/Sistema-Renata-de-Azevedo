# Configurações pendentes antes do uso real

Lista única do que falta configurar. O passo a passo detalhado de cada integração está em [módulos](modulos.md). Marque cada item ao concluir.

## 1. Obrigatório antes de cadastrar pacientes reais

- [ ] **Supabase Pro (US$ 25/mês).** O projeto está no plano gratuito, que **não tem cópia de segurança automática** e **pausa o projeto após 7 dias sem uso**. Também libera a proteção contra senhas vazadas. Até lá, faça cópia manual (ver [segurança](seguranca-lgpd.md#cópias-de-segurança)).
- [ ] **Revisão jurídica** dos textos (todos marcados como rascunho):
  - política de privacidade: `web/public/privacidade.html` (preencher razão social, CNPJ, endereço, encarregado/DPO e prazos);
  - termos do portal do paciente: `web/src/portal/terms.ts` (e a regra para pacientes adolescentes);
  - termo e consentimento do assistente de IA (no próprio sistema, aba Assistente de IA).
- [ ] **Contas da equipe:** definir quem participa e os e-mails; criar em **Usuários** (a Proprietária). Ver [homologação](homologacao.md).
- [ ] **Homologação concluída** e dados fictícios apagados (`node tests/homologacao/rodar.mjs limpar`, resultado com zero restantes).

## 2. Endereços e login

- [ ] **Endereço oficial do sistema.** Hoje: `https://sistema-renata-de-azevedo.ragcodebr.workers.dev/`. Sugestão: `sistema.renatadeazevedo.com.br` (equipe) e `portal.renatadeazevedo.com.br` (pacientes; abre o portal sozinho), como domínios personalizados do mesmo Worker na Cloudflare.
- [ ] **Supabase → Authentication → URL Configuration:** *Site URL* = endereço oficial; *Redirect URLs* = o mesmo endereço (e o do portal).
- [ ] **E-mail de envio (SMTP próprio)** em **Authentication → Emails → SMTP Settings** (sugestão: Resend, com o domínio `renatadeazevedo.com.br` verificado). Sem isso, o envio padrão do Supabase só entrega para membros do projeto, poucas vezes por hora, e **os pacientes não recebem o código do portal**.
- [ ] **Modelo do código do portal:** **Authentication → Emails → Templates → Magic Link** com o conteúdo de `supabase/templates/codigo-de-acesso.html` (assunto "Seu código de acesso ao portal"); em **Providers → Email**, código de 6 dígitos e validade de 600 segundos.
- [ ] **Recuperação de senha pela própria pessoa:** ainda não existe. Hoje, quem esqueceu a senha pede à administração, que redefine em **Authentication → Users** no painel do Supabase. Decidir se entra antes da abertura (exige o SMTP acima).

## 3. Integrações (cada uma desligada até ser configurada)

| Integração | O que falta | Segredos no Supabase |
| --- | --- | --- |
| Google Agenda e Meet | Projeto no Google Cloud, tela de consentimento, credencial OAuth com o retorno `https://qnchebjrgnfgszrzlyue.supabase.co/functions/v1/google-oauth-callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (endereço oficial do sistema) |
| WhatsApp | Número dedicado, app na Meta, 3 modelos aprovados, webhook | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| Assistente de IA | Revisão jurídica, contrato com a Anthropic, limite mensal | `ANTHROPIC_API_KEY` |
| Transcrição de áudios do WhatsApp do paciente | Mesmas regras da IA; contrato com a OpenAI (operadora de dados de saúde) | `OPENAI_API_KEY` (opcionais `TRANSCRIBE_MODEL`, `TRANSCRIBE_USD_PER_MINUTE`) |
| Portal: avisos por e-mail | Conta no Resend com domínio verificado | `RESEND_API_KEY`, `PORTAL_EMAIL_FROM` |
| Formulário de leads do site | Colar o formulário no site; só aceita as origens permitidas | `LEAD_ALLOWED_ORIGINS` (padrão: `renatadeazevedo.com.br`, com e sem www) |
| Push do aplicativo | Conta na Expo e `projectId` (item 4) | `EXPO_ACCESS_TOKEN` (opcional) |

Cadastrar segredos sem colar em chats: `npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue NOME=valor`.
Depois de cada integração, ligar em **Configurações** e testar com um paciente fictício.

## 4. Aplicativo da equipe

- [ ] Conta na Expo; em `mobile/`: `npx eas-cli@latest login` e `npx eas-cli@latest init` (grava o `projectId`).
- [ ] Apple Developer (US$ 99/ano) e Google Play Console (US$ 25, uma vez).
- [ ] Builds, revisão e envio: ver [lojas](lojas.md) e [publicação](publicacao.md).

## 5. Pendente por decisão da clínica

- Importação do Clinical Experts (pacientes, profissionais responsáveis e histórico de sessões).
- Ficam para depois (registrados nos módulos): recibos e nota fiscal, PIX automático e conciliação bancária, agendamento pelo próprio paciente, envio de arquivos pelo paciente, ocupação da agenda, exportação .xlsx, integração direta com o tl;dv.
