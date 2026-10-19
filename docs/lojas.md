# Lojas de aplicativos (aplicativo da equipe)

Preparação do app "Renata de Azevedo, Equipe" (`br.com.renatadeazevedo.equipe`) para Google Play e App Store. **Distribuição decidida: privada**, só para a equipe. A publicação acontece só com autorização ([publicação](publicacao.md)).

## O que já está pronto no projeto

| Item | Onde |
| --- | --- |
| Ícone (monograma "RA" na fonte da marca, dourado sobre vinho), ícone adaptativo do Android e tela de abertura (logotipo, modo claro e escuro) | `mobile/assets/` (gerados por `node mobile/scripts/gerar-icones.mjs`) |
| Ícone 512 px e imagem de destaque 1024 × 500 para o Google Play | `mobile/store/` |
| Perfis de build e envio (`preview` interno, `production` com numeração automática; Android vai para o teste interno como rascunho) | `mobile/eas.json` |
| Declaração de criptografia (só HTTPS, sem criptografia própria: dispensa documentação de exportação) | `app.json` → `ios.config.usesNonExemptEncryption: false` |
| Permissões: só biometria (texto explicativo do Face ID) e notificações; permissões de microfone, armazenamento e sobreposição bloqueadas | `app.json` |
| Política de privacidade pública | `/privacidade.html` no endereço do sistema (link também na tela de entrada do app) |
| Só iPhone (sem layout próprio de iPad: dispensa capturas de iPad; no iPad o app abre em modo de compatibilidade) | `app.json` → `ios.supportsTablet: false` |
| `expo-doctor` sem problemas, lint e TypeScript limpos | `cd mobile && npx expo-doctor && npm run lint && npx tsc --noEmit` |

## Contas (a clínica cria)

- **Expo:** expo.dev (gratuito para o volume da clínica). Em `mobile/`: `npx eas-cli@latest login` e `npx eas-cli@latest init`.
- **Apple Developer Program:** US$ 99/ano. Prefira conta de **organização** (em nome da clínica, exige número D-U-N-S, gratuito): o app aparece com o nome da clínica.
- **Google Play Console:** US$ 25, uma vez. Também prefira **organização** (D-U-N-S): contas pessoais novas precisam de um teste fechado com 12 pessoas por 14 dias antes de qualquer publicação em produção; contas de organização não.

## Distribuição privada

- **Android: teste interno do Google Play.** Até 100 pessoas, por lista de e-mails (contas Google). Cada pessoa aceita o convite pelo link e instala pela Play Store. Atualizações chegam como as de qualquer app.
- **iPhone: app não listado na App Store.** Passa pela revisão normal da Apple; depois, pede-se a distribuição não listada pelo formulário da Apple ("Unlisted App Distribution"). O app só é encontrado pelo link direto, não aparece em buscas e não expira (diferente do TestFlight, cujas versões valem 90 dias). Para a fase de testes, use o TestFlight.

## Textos da loja (PT-BR)

- **Nome:** Renata de Azevedo, Equipe
- **Subtítulo (Apple, até 30 caracteres):** App da equipe da clínica
- **Descrição curta (Google, até 80):** Agenda, pacientes e tarefas da equipe da clínica Renata de Azevedo.
- **Descrição:**

  > Aplicativo de uso exclusivo da equipe da clínica Renata de Azevedo Psicologia & Coaching. O acesso é feito com a conta criada pela clínica; não há cadastro aberto.
  >
  > • Agenda do dia e da semana, com confirmação de sessões, presença e link do atendimento on-line
  > • Pacientes da sua carteira, com contato rápido
  > • Tarefas e avisos da equipe, com notificações
  > • Cobranças em aberto e registro de pagamentos (para quem tem acesso)
  > • Rascunho de evolução logo após a sessão (a finalização é feita no computador)
  >
  > Segurança: o acesso segue o perfil de cada pessoa, o app trava após 5 minutos em segundo plano (digital, rosto ou senha) e as notificações não mostram dados de pacientes na tela bloqueada.

- **Categoria:** Negócios (Apple: Business; Google: Empresas). Evite "Medicina": exige mais documentação e não descreve um app de gestão interna.
- **Palavras-chave (Apple):** clínica, agenda, equipe, psicologia, tarefas
- **URL de suporte:** o endereço do sistema (ou o site da clínica). **URL de privacidade:** `https://<endereço do sistema>/privacidade.html`.
- **Classificação etária:** sem conteúdo sensível (questionário com "não" em tudo).

## Formulários de privacidade

**Apple (App Privacy)** e **Google (Segurança dos dados)** perguntam o que o app coleta e envia. Respostas sugeridas (revisar com o jurídico):

| Dado | Coletado? | Para quê | Ligado à pessoa? | Rastreamento/publicidade? |
| --- | --- | --- | --- | --- |
| Nome e e-mail da pessoa da equipe | Sim | Funcionalidade do app (login) | Sim | Não |
| Dados de saúde (agenda e rascunhos de evolução de pacientes) | Sim | Funcionalidade do app | Sim | Não |
| Contato de pacientes (telefone, e-mail) | Sim | Funcionalidade do app | Sim | Não |
| Identificador do aparelho para notificações | Sim | Funcionalidade do app | Sim | Não |
| Localização, contatos do celular, fotos, histórico de navegação, dados de uso para análise | Não | — | — | — |

- **Google, perguntas extras:** dados criptografados em trânsito: **sim**. A pessoa pode pedir exclusão: **sim** (pela clínica; ver a política). Dados compartilhados com terceiros: **não** (os fornecedores que operam o serviço em nome da clínica não contam como "compartilhamento" no formulário do Google).
- **Apple:** "Data Used to Track You": **nenhum**.

## Revisão da Apple: conta de demonstração

A Apple precisa entrar no app. Antes do envio:

1. Crie os dados fictícios (`node tests/homologacao/rodar.mjs criar`) e um cadastro de profissional "Profissional Demonstração" vinculado a alguns pacientes fictícios.
2. Crie em **Usuários** uma conta `revisao-loja@…` com os perfis **Profissional** (vinculada à Profissional Demonstração) e **Recepção**, para a revisão ver agenda, pacientes, tarefas e cobranças. Não use Proprietária nem Gerência: com a verificação em duas etapas exigida, a revisão não conseguiria entrar.
3. Informe e-mail e senha no campo **Sign-In Information** do App Store Connect, com a nota: *"Aplicativo interno da equipe da clínica; contas criadas pela clínica. A conta de demonstração contém apenas dados fictícios."*
4. Depois da aprovação, desative a conta e, quando a homologação acabar, apague os dados fictícios.

## Capturas de tela

- **iPhone:** tela de 6,9" (1320 × 2868) ou 6,5" (1284 × 2778), de 3 a 10 imagens.
- **Android:** ao menos 2 capturas de celular.
- **Sugestão de telas**, com dados fictícios: Início, Agenda do dia, Sessão aberta, Ficha do paciente, Tarefas, Bloqueio do app. Tirar no build de teste (preview), com a conta de demonstração.

## Builds e envio (com autorização)

```sh
cd mobile
npx eas-cli@latest build --platform android --profile preview      # APK para teste rápido (link de instalação)
npx eas-cli@latest build --platform all --profile production       # versões das lojas
npx eas-cli@latest submit --platform android --profile production  # vai para o teste interno, como rascunho
npx eas-cli@latest submit --platform ios --profile production      # vai para o App Store Connect (TestFlight)
```

A EAS cria e guarda os certificados (Apple) e a chave de assinatura (Android). Na primeira vez, ela pede o login da Apple. Para o Google, é preciso uma conta de serviço do Google Cloud com acesso ao Play Console (arquivo JSON, nunca no repositório).
