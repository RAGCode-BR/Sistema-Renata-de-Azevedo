# Homologação com a equipe

Validação do sistema por quem vai usá-lo, **antes de cadastrar pacientes reais**, no próprio projeto, com dados **fictícios** que são apagados no final.

## Preparação (quem administra)

1. Criar as contas de quem vai testar em **Usuários**, com os perfis reais de cada pessoa (Proprietária, Gerência, Recepção, Financeiro, Profissional). Cada profissional precisa estar vinculada ao seu cadastro em **Profissionais**.
2. Criar os dados fictícios: `node tests/homologacao/rodar.mjs criar`. São 8 pacientes ("Ana Teste Silva" etc., um deles menor de idade com responsável), 4 sessões cada (passadas e futuras), cobranças automáticas, 2 tarefas e 3 contatos no Comercial. Tudo fica marcado com `[HOMOLOGAÇÃO]`.
3. Combinar um período (sugestão: 1 a 2 semanas) e um lugar para anotar problemas (modelo abaixo).
4. Pedir a cada pessoa que use **só os pacientes fictícios** e **não registre dados reais** de pacientes.

## Roteiro por perfil

Cada item: faça, confira o resultado e anote qualquer coisa estranha, confusa ou lenta.

### Todos

- [ ] Entrar no sistema e no aplicativo do celular (Expo Go ou build de teste) com a própria conta.
- [ ] Trocar a senha; ativar a verificação em duas etapas (menu da conta) e entrar de novo com o código.
- [ ] Conferir que o menu mostra só o que faz sentido para a sua função ([matriz de acesso](matriz-de-acesso.md)).
- [ ] Conferir os avisos no sino e abrir a página relacionada. Tarefas da equipe permanecem fora do sistema.

### Recepção e Gerência

- [ ] Agenda: marcar sessão (avulsa e semanal), remarcar, cancelar, registrar presença e falta.
- [ ] Ver o aviso de horário em conflito ao tentar marcar duas sessões no mesmo horário.
- [ ] Pacientes: cadastrar um paciente fictício novo (use e-mail `…@example.test`), editar, enviar um documento administrativo.
- [ ] Cobranças: registrar pagamento parcial e depois o restante; conferir o saldo.
- [ ] Comercial: mover um contato no funil, registrar contato, converter em paciente.
- [ ] Portal: liberar o acesso de um paciente fictício com o **seu próprio e-mail** e entrar no portal (`#/portal`) para ver o que o paciente vê.
- [ ] Relatórios: conferir se os números batem com o que foi feito.

### Financeiro

- [ ] Cobranças: pagamento parcial, quitação, estorno, desconto, cancelamento; conferir o saldo e o crédito do paciente.
- [ ] Despesas: lançar; conferir a visão geral e o DRE do mês.
- [ ] Preços: cadastrar o preço de uma profissional e ver a cobrança automática de uma sessão realizada.
- [ ] Repasses: conferir o repasse do mês.

### Profissionais

- [ ] Ver só os próprios pacientes e a própria agenda.
- [ ] Prontuário: escrever e finalizar uma evolução de sessão realizada; tentar alterar a finalizada (só retificação); exportar em PDF.
- [ ] Conceitualização de caso e documentos clínicos de um paciente fictício.
- [ ] No celular: ver o dia, confirmar sessão, salvar rascunho de evolução.
- [ ] Criar uma tarefa com checklist para paciente fictício, acessar o portal com a conta dele, marcar os itens concluídos, responder e concluir; conferir a resposta no sistema e no app da profissional.
- [ ] Enviar um formulário ou escala ao paciente fictício, responder pelo portal e conferir o resultado no prontuário.
- [ ] Conferir "Meu repasse" e "Meus números".

### Proprietária

- [ ] Tudo acima que for da sua rotina, mais: Usuários (criar, mudar perfil, desativar e reativar uma conta de teste), Configurações.
- [ ] Conferir que **não** vê o prontuário de outra profissional (só a situação, em Controle de prontuários).
- [ ] Ligar **Configurações → Segurança → Exigir verificação em duas etapas** e confirmar que a Gerência precisa do código para entrar.

## Como anotar problemas

Para cada problema: **quem** (perfil), **onde** (tela), **o que fez**, **o que esperava**, **o que aconteceu**, e uma captura de tela se possível. Exemplo:

> Recepção · Agenda · Remarquei a sessão da Ana Teste para quinta 15h · Esperava ver na quinta · Continuou na terça (captura anexa)

## Encerramento (antes do uso real)

1. Corrigir e retestar os problemas anotados.
2. Apagar os dados fictícios, inclusive o que a equipe registrou para eles: `node tests/homologacao/rodar.mjs limpar`. O resultado precisa mostrar **zero restantes**.
3. Excluir ou ajustar as contas de teste em **Usuários**; desligar e religar integrações conforme o uso real.
4. Rodar os testes automáticos uma última vez (`cd tests && node run.mjs`).
5. Concluir os itens de [configurações pendentes](configuracoes-pendentes.md).
