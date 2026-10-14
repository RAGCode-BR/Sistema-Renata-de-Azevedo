---
name: Sistema Renata de Azevedo
description: Gestão da clínica de psicologia e coaching, com a identidade vinho, branco e creme da Renata.
colors:
  vinho: "#53102f"
  vinho-escuro: "#3d0b22"
  vinho-claro: "#f5eaef"
  vinho-tom: "#ead6df"
  creme: "#f5efe7"
  creme-fundo: "#efe7dc"
  branco: "#ffffff"
  texto: "#2c2326"
  suave: "#6d6266"
  linha: "#ece4da"
  dourado: "#b98d6c"
  verde: "#3f6b55"
  ambar: "#8f6229"
  perigo: "#9a3f45"
typography:
  headline:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Jost, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Jost, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Jost, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.vinho}"
    textColor: "{colors.branco}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.vinho-escuro}"
  button-light:
    backgroundColor: "{colors.branco}"
    textColor: "{colors.vinho}"
    rounded: "{rounded.pill}"
    height: "42px"
  rail:
    backgroundColor: "{colors.vinho}"
    textColor: "{colors.creme}"
    width: "72px"
  rail-link-active:
    backgroundColor: "{colors.creme}"
    textColor: "{colors.vinho}"
    rounded: "{rounded.md}"
    size: "48px"
  sub-link-active:
    backgroundColor: "{colors.vinho-claro}"
    textColor: "{colors.vinho}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.branco}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.branco}"
    textColor: "{colors.texto}"
    rounded: "{rounded.sm}"
    height: "42px"
---

# Design System: Sistema Renata de Azevedo

## Overview

**Creative North Star: "O consultório de portas abertas"** (proposta; a confirmar com a cliente)

Um sistema de trabalho com a estrutura conhecida dos softwares de clínica (barra superior, trilho de módulos, submenu de contexto e um botão flutuante de criar), vestido com a identidade da Renata: o vinho do trilho segura a marca, o branco organiza o trabalho e o creme dá o fundo calmo. A densidade é de ferramenta, não de site: tudo cabe na tela, e a personalidade aparece em detalhes que respondem ao toque.

A estrutura do Clínica Experts é referência fixada pela cliente; a agenda deles não é. As cores vinho, branco e creme também são fixadas pela cliente.

**Key Characteristics:**
- Trilho vinho com ícones de traço creme; módulo ativo em quadrado creme.
- Superfícies separadas por tom (branco sobre creme), não por borda.
- Uma família, Jost, autohospedada.
- Movimento curto, só como resposta a uma ação ou a um passar de mouse.

## Colors

Restrito: o vinho faz o trabalho da marca e das ações; verde, âmbar e rosado aparecem só quando significam uma situação.

### Primary
- **Vinho da marca** (#53102f): trilho, botão principal, módulo e página ativos, próxima sessão, sessão em andamento.
- **Vinho profundo** (#3d0b22): hover e pressão do botão principal; botão de criar aberto.
- **Vinho véu** (#f5eaef): fundo de item ativo, sessão confirmada na grade, contagens.

### Neutral
- **Creme do consultório** (#f5efe7): chão de todas as telas, campos de busca, botões claros dentro de painéis.
- **Creme fundo** (#efe7dc): faixa de aviso do ambiente.
- **Branco** (#ffffff): barra superior, submenu, painéis, janelas.
- **Tinta quente** (#2c2326): texto principal.
- **Tinta suave** (#6d6266): texto secundário, rótulos.
- **Linha** (#ece4da): só linhas de tabela e da grade da agenda.

### Estados
- **Verde** (#3f6b55): confirmada, pago. **Âmbar** (#8f6229): a confirmar, em aberto, registrar presença. **Perigo** (#9a3f45): falta, apagar, encerrar. **Dourado** (#b98d6c): linha do "agora" na agenda.

**The Vinho Faz o Trabalho Rule.** O vinho aparece em ações e no que está ativo; nunca como decoração.

## Typography

**Body Font:** Jost (com a pilha do sistema como reserva), a mesma família geométrica do "Psicologia & Coaching" do logo.

**Character:** uma voz só, limpa e geométrica, deixando a personalidade para o logo manuscrito.

### Hierarchy
- **Headline** (500, 30px, 1.15): título da tela.
- **Title** (500, 18–24px, 1.3): títulos de painel, nome na próxima sessão, título de janela.
- **Body** (400, 15px, 1.5): texto, tabelas, campos.
- **Label** (400, 13–14px): rótulos de campo, subtítulos, contagens.

**The Sem Caixa Alta Rule.** Nenhum rótulo em maiúsculas espaçadas; tudo em frase normal.

## Layout

Grade de três colunas no computador: trilho de 72px, submenu de 236px (recolhível pelo botão de menu, preferência guardada no navegador) e área de conteúdo com no máximo 1440px, abaixo de uma barra superior de 64px. Em até 1180px o conteúdo vira uma coluna. Em até 860px o trilho vira barra inferior com rótulos, o submenu vira abas roláveis sob a barra superior e a busca abre por um ícone.

## Elevation & Depth

Plano em repouso, com profundidade por tom (branco sobre creme). Sombra só no que flutua ou responde ao mouse.

### Shadow Vocabulary
- **Flutuante** (`0 18px 48px rgba(44,35,38,.16), 0 2px 6px rgba(44,35,38,.06)`): menus, cartão de detalhes, janelas.
- **Sessão erguida** (`0 10px 22px rgba(83,16,47,.14)`): bloco da agenda sob o mouse.
- **Botão de criar** (`0 12px 28px rgba(83,16,47,.3)`): o único elemento flutuante fixo.

## Shapes

Botões, abas e contagens em pílula. Campos e itens de menu com 10–12px, painéis com 18px, janelas com 22px. Blocos de sessão com 10px e sem borda lateral colorida; a situação vem do preenchimento.

## Components

- **Trilho:** ícone 22px em quadrado de 48px; dica com o nome do módulo ao passar o mouse (espera 380ms na primeira, imediata nas seguintes).
- **Submenu:** título do módulo, páginas com contagem (âmbar quando é pendência) e a próxima sessão no rodapé.
- **Barra superior:** menu, logo, busca de pacientes (atalho `/`, setas e Enter), ajuda, sino com pendências urgentes, avatar com menu da conta.
- **Grade da agenda:** colunas por profissional (Hoje) ou por dia (Agenda), almoço em faixa de tom, horário livre mostra "+ Agendar às Xh" ao passar o mouse.
- **Cartão de detalhes:** aparece após 320ms sobre uma sessão, ao lado do bloco, com situação, profissional, modalidade, valor e telefone.
- **Botão de criar:** círculo vinho de 58px; o "+" gira para "×" e o menu sobe com itens escalonados de 30ms.
- **Janela:** entra com escala 0,96 e opacidade em 240ms; aviso no rodapé com "Desfazer".

## Do's and Don'ts

- **Do** usar `cubic-bezier(0.23, 1, 0.32, 1)` e durações de 140–240ms; pressionar reduz para 0,97.
- **Do** proteger efeitos de mouse com `@media (hover: hover) and (pointer: fine)`.
- **Don't** usar gradiente, brilho, vidro, sombra em repouso ou rótulo em caixa alta.
- **Don't** usar borda lateral colorida em cards, itens ou blocos.
- **Don't** pôr o logo (fundo branco, sem transparência) sobre outra cor que não o branco.
