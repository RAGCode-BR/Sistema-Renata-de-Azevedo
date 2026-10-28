# Publicação

Ordem sugerida para colocar o sistema, o portal e o aplicativo em uso. **Cada etapa só com autorização.** Antes de qualquer uma: testes automáticos passando (`cd tests && node run.mjs`) e [configurações pendentes](configuracoes-pendentes.md) revisadas.

## 1. Sistema e portal (Cloudflare)

O endereço atual é `https://sistema-renata-de-azevedo.ragcodebr.workers.dev/`. Em 19/10/2026 a versão no ar já incluía até o Bloco 13 (portal); as mudanças do Bloco 14 (verificação em duas etapas, `/privacidade.html`, CSP que aceita o QR code) entram na próxima publicação. Se a Cloudflare estiver ligada ao GitHub, a publicação acontece a cada push na `main`; senão, pelo terminal:

1. Conferir o `.env` (URL e chave **pública** do Supabase).
2. `npm run deploy` (typecheck, build e `wrangler deploy`). Exige login na Cloudflare (`npx wrangler login`, conta da clínica).
3. Conferências logo depois:
   - abrir o sistema e entrar com uma conta da equipe;
   - abrir `/#/portal` (tela do portal) e `/privacidade.html`;
   - cabeçalhos de segurança: `curl -sI https://<endereço>/ | grep -i content-security-policy`.
4. **Domínios próprios** (opcional): `sistema.renatadeazevedo.com.br` e `portal.renatadeazevedo.com.br` como *Custom Domains* do Worker no painel da Cloudflare. O endereço que começa com `portal.` abre o portal direto.

## 2. Supabase: endereço oficial

- **Authentication → URL Configuration:** *Site URL* e *Redirect URLs* com o endereço oficial. Faça pelo painel: o comando `npx supabase config push` envia **todas** as configurações de login do `supabase/config.toml` e poderia sobrescrever ajustes feitos no painel (SMTP, modelos de e-mail).
- **Segredo `APP_URL`** com o endereço oficial (usado no retorno do Google):
  `npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue APP_URL=https://<endereço>`
- **Configurações → Portal do paciente:** endereço do portal.
- **Configurações → WhatsApp:** endereço do sistema (para os links das mensagens).

## 3. Migrações e funções

Já estão aplicadas no projeto. Mudanças futuras: GitHub Action a cada push na `main` (ou `npm run db:push` e `npm run functions:deploy`), sempre com `npm run test:db` em seguida.

## 4. Aplicativo da equipe

Ver [lojas](lojas.md): contas, build de teste, homologação no celular, builds das lojas, revisão e distribuição privada.

## 5. Abertura para uso real

1. Homologação concluída e dados fictícios apagados (resultado com zero restantes).
2. Supabase Pro ativo (cópias diárias) ou rotina de cópia manual definida.
3. Contas reais criadas; contas de teste e de demonstração desativadas.
4. Integrações ligadas uma a uma, cada uma testada com um paciente fictício antes.
