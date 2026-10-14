# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipe de uma clínica de psicologia e coaching: a Renata de Azevedo (psicóloga, coach e dona da clínica), as outras profissionais que atendem, gerentes e pessoas da recepção/administração. Usam o sistema no computador do consultório e no celular, com o mesmo peso: entre uma sessão e outra, para conferir o dia, confirmar pacientes, registrar presença, escrever evoluções e acompanhar pagamentos.

## Product Purpose

Gestão do dia a dia da clínica: agenda das profissionais, cadastro de pacientes, prontuário (evoluções e anotações), equipe, financeiro (sessões pagas e em aberto, despesas) e relatórios. Sucesso é a equipe saber, em segundos, o que acontece hoje e o que está pendente, e conseguir agir sem atrito.

## Positioning

Sistema feito sob medida para a clínica da Renata, com a identidade dela (logo manuscrito, vinho, branco e creme), em vez de um software genérico de clínica. Fala a língua do consultório: sessão de 50 minutos, evolução, registrar presença, confirmar pelo WhatsApp.

## Operating Context

- Sessões de 50 minutos em horários cheios, almoço fixo, várias profissionais em paralelo.
- Confirmação e lembretes de sessão e de pagamento pelo WhatsApp.
- Evolução escrita depois de cada sessão realizada.
- Pagamentos por Pix, cartão, transferência e dinheiro.

## Capabilities and Constraints

- HTML, CSS e JavaScript puros, sem framework e sem etapa de build; abre direto do arquivo.
- Telas: Hoje, Agenda, Pacientes (lista e ficha), Prontuários (lista e prontuário), Profissionais, Financeiro, Relatórios, Configurações, Ajuda.
- Dados ficam no localStorage do navegador por enquanto (versão de demonstração). Ainda não há servidor nem login real; o "Sair" só cobre a tela.
- Em aberto: perfis de acesso (recepção não deveria ler prontuário) dependem do servidor.

## Brand Commitments

- Logo manuscrito "Renata de Azevedo | Psicologia & Coaching" em `assets/logo.png` (fundo branco).
- Cores fixadas pela cliente: vinho, branco e creme.
- Referência de estrutura indicada pela cliente: layout do Clínica Experts (barra superior, trilho de ícones à esquerda, submenu de contexto, botão flutuante de criar). A agenda deles NÃO é referência.

## Evidence on Hand

- Dados de demonstração gerados em `assets/js/store.js` (pacientes, sessões, evoluções e despesas fictícios). Não há depoimentos, números reais nem clientes para citar.

## Product Principles

1. O dia de hoje primeiro: o que vem a seguir e o que está pendente aparece antes de qualquer outra coisa.
2. Toda ação reversível: avisos com "Desfazer" em vez de confirmações em excesso.
3. Sigilo do prontuário: o sistema nunca expõe conteúdo clínico onde não precisa.
4. Linguagem de consultório, não de software.

## Accessibility & Inclusion

Uso em celular e computador com o mesmo peso: alvos de toque confortáveis, foco visível pelo teclado, contraste legível sobre o creme.
