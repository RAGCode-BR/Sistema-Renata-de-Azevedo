# Módulos do sistema

Como cada parte funciona e o que precisa ser configurado. Lista única do que falta configurar: [configuracoes-pendentes.md](configuracoes-pendentes.md). Quem vê o quê: [matriz-de-acesso.md](matriz-de-acesso.md). Resultado da revisão integrada: [auditoria-jornada.md](auditoria-jornada.md).

## Navegação e usabilidade (módulo 9)

- O cabeçalho oferece **Buscar página** (atalho `Ctrl/⌘ + K`) para abrir diretamente qualquer página disponível ao perfil conectado; a busca aceita nomes com ou sem acentos.
- No celular, **Início**, **Agenda**, **Pacientes** e **Tarefas** ficam na barra inferior quando disponíveis. **Mais** reúne os demais módulos com rótulos legíveis. As páginas do módulo atual continuam nas abas sob o cabeçalho.
- A interface mantém a identidade em vinho, creme e branco. A navegação foi conferida em larguras de computador e celular no `npm run dev`.

## Usuários

Não há cadastro público. Quem tem a permissão **gerenciar usuários** (hoje, só Proprietário(a)) cria, edita e exclui contas na página **Usuários**.

- **Criar:** a Edge Function `admin-create-user` cria a conta no Supabase Auth, com os perfis em `app_metadata.roles`. O gatilho `on_auth_user_created` cria o perfil e os perfis de acesso. Uma conta sem perfis, criada fora da função, não tem acesso a nada.
- **Editar** perfis, profissional vinculada e situação (ativa/inativa): função do banco `set_user_access`. Desativar corta o acesso na hora, porque as políticas conferem isso a cada consulta.
- **Excluir:** Edge Function `admin-delete-user`. Prontuários e sessões continuam guardados, porque pertencem à profissional (`professionals`), não à conta.
- **Regras, aplicadas no banco e nas funções:**
  - Ninguém exclui ou desativa a própria conta, nem tira de si o perfil de Proprietário(a).
  - Sempre resta ao menos um(a) Proprietário(a) ativo(a).
  - O perfil Profissional exige uma profissional vinculada, e cada profissional tem no máximo uma conta.
  - Criações, alterações de perfis e exclusões vão para `audit_log`.

**A primeira conta** precisa ser criada por fora, uma única vez. Em **Authentication → Users → Add user** (com *Auto Confirm User*), defina em *app_metadata* `{"roles": ["owner"]}` e o nome em *user_metadata* `{"name": "..."}`.

## Profissionais

- O cadastro reúne nome e e-mail obrigatórios, foto JPG/PNG, especialidade, etiquetas, cor, situação, comissões, horário de atendimento e anexos. A cor identifica a profissional na lista e na agenda diária.
- **Possui acesso ao sistema?** cria imediatamente uma conta com perfil Profissional e senha inicial, vinculada ao cadastro, quando marcada na criação. Em cadastros existentes, o controle ativa ou desativa a conta vinculada. A criação de acesso exige permissão para gerenciar usuários.
- **Comissionar atendimentos** habilita o repasse de sessões ainda não fechado; o percentual é definido em **Financeiro → Repasses**. Fechamentos anteriores preservam seus valores. **Comissionar vendas** registra a preferência, mas o cálculo automático de vendas ainda não está implementado.
- **Igual ao da clínica** registra a preferência de horário. A agenda ainda não dispõe de escala de trabalho cadastrada; a disponibilidade considera sessões e bloqueios.
- Fotos e anexos ficam em armazenamento privado. Anexos aceitam os formatos indicados no formulário, até 10 MB cada, e são acessíveis somente a quem gerencia profissionais.

## Painel inicial

A página **Início** é a primeira depois do login e mostra só dados reais, filtrados pelas permissões de cada perfil:
- **Quem vê a agenda geral** (Proprietário(a), Gerente, Recepção): sessões de hoje e dos próximos 7 dias, pacientes ativos, profissionais em atividade, a próxima sessão e as evoluções pendentes **por profissional**, sem acesso ao conteúdo.
- **Profissional:** a própria agenda e as próprias evoluções pendentes. Cada uma é um atalho que abre o prontuário já na paciente e na sessão (`#/prontuarios?paciente=…&sessao=…`).
- **Evolução pendente:** sessão que já terminou, não foi cancelada nem marcada como falta, e não tem evolução ligada a ela (`clinical_notes.appointment_id`). Vem da função `pending_clinical_notes()`, que informa só a existência da pendência, nunca o texto do prontuário.
- **Fora do painel por enquanto:** indicadores de financeiro, CRM e tarefas, que entram junto com esses módulos.

## Agenda

Visões de **Dia** (uma coluna por profissional), **Semana**, **Mês** e **Disponibilidade**, com filtros por profissional e especialidade e acesso direto por data. Disponibilidade compara data, horário e duração com sessões, bloqueios da clínica e compromissos sincronizados do Google; mostra quem está sem conflito sem expor detalhes dos bloqueios. Ainda não há cadastro de horário de trabalho de cada profissional, portanto “sem conflito” precisa ser confirmado com a escala. Clicar num horário livre abre uma sessão nova (ou um bloqueio, para a profissional); clicar numa sessão abre os detalhes, as ações e o histórico.

- **Situações:** Agendada, Aguardando confirmação, Confirmada, Realizada, Paciente faltou, Cancelada pelo paciente, Cancelada pela clínica e Remarcada. Cancelamento, falta e remarcação são coisas diferentes.
- **Ações** (funções do banco; a interface não altera `appointments` diretamente):
  - `set_appointment_status`: confirmar, aguardar confirmação, registrar presença ou falta (só depois do início) e corrigir a situação.
  - `cancel_appointment`: com motivo e opção de cancelar também as próximas da série.
  - `reschedule_appointment`: a sessão original fica "Remarcada" e uma nova, ligada a ela, ocupa o novo horário.
  - `create_appointment_series`: semanal, quinzenal ou mensal, de 2 a 52 sessões. Se alguma data tiver conflito, nenhuma é criada e a mensagem diz qual data impediu.
- **Quem pode:** a gerência (`appointments.manage`) mexe em qualquer agenda; a profissional, na própria. Séries e sessões novas são da gerência.
- **Conflitos, no banco:** uma profissional não tem duas sessões ativas no mesmo horário, nem sessão sobre um bloqueio (e vice-versa).
- **Bloqueios:** com motivo opcionalmente **privado**, que só a profissional e quem bloqueou veem; os demais veem "Horário bloqueado". A tabela só é acessada pelas funções `list_schedule_blocks`, `create_schedule_block` e `delete_schedule_block`.
- **Histórico:** toda criação e mudança de situação vai para `appointment_events` (por gatilho), com quem fez e quando.
- **Pendências no Início:** sessão passada ainda agendada/confirmada é **presença não registrada**; sessão **realizada** sem evolução é **evolução pendente**.
- **Tipo de atendimento** (individual, casal, família, grupo, avaliação) é separado da **modalidade** (presencial/on-line).
- **Fora deste bloco:** lista de espera e o segundo paciente na terapia de casal.

## Pacientes

- **Lista** com busca (nome, nome social, e-mail ou telefone) e filtro por situação: em acompanhamento, pausado, alta, encerrado.
- **Página do paciente** (`#/pacientes?id=…`), com abas:
  - **Visão geral:** cadastro, acompanhamento, responsável legal e observações administrativas.
  - **Sessões:** realizadas, faltas, canceladas pelo paciente, próximas e histórico.
  - **Documentos.**
  - **Prontuário:** atalho só para a profissional responsável.
  - **Financeiro:** chega com o módulo financeiro.
- **Cadastro:** só dados administrativos. Nascimento de menor de idade pede o responsável legal; CPF é opcional, validado e único.
- **Gravação:** pela função `save_patient`, que cria ou edita e acerta os vínculos com profissionais numa transação, e só funciona para quem tem `patients.manage`. Tirar uma profissional do vínculo tira dela o acesso ao paciente; o que ela registrou continua guardado. Criações e edições vão para `audit_log`.
- **Documentos administrativos:**
  - Ficam no bucket **privado** `patient-documents`, em `patients/<id do paciente>/`. São PDF, imagem ou Word, até 10 MB.
  - Lê quem vê o paciente; envia e exclui quem tem `patients.manage`.
  - São abertos só por **link temporário** de 60 segundos.
  - Documentos clínicos ficam com o prontuário, não aqui.

## Prontuário

**Princípio:** o conteúdo clínico não é lido nem gravado direto nas tabelas, e ninguém tem acesso direto a elas. Tudo passa por funções do banco que exigem a **profissional responsável** (perfil Profissional com o paciente na carteira) e registram o acesso em `clinical_access_log`: aberturas, exportações e documentos abertos. Nem Proprietário(a) nem Gerente leem o conteúdo; quem gerencia usuários vê só **quem** acessou e quando.

- **Evolução:**
  - Rascunho editável: cada alteração guarda a versão anterior em `clinical_note_revisions`.
  - Editor com negrito, itálico, listas e prévia; o mesmo formato aparece no histórico e na exportação. O conteúdo é guardado como texto, sem HTML executável.
  - Finalizada: imutável, travada por gatilho no banco.
  - Correção: só por **retificação**, que é um novo registro finalizado, ligado ao original e com motivo. O original continua visível.
- **Anotações pessoais:** da profissional, editáveis, fora do prontuário formal e da exportação.
- **Conceitualização de caso:**
  - O modelo da clínica separa modalidade, motivo da procura e hipóteses diagnósticas.
  - Cada profissional pode criar modelos próprios ("Meus modelos").
  - As seções ficam copiadas na conceitualização, então mudar o modelo não altera o que já foi escrito. Cada alteração guarda a versão anterior.
  - O documento da Gabriela pode virar um modelo quando estiver disponível.
- **Documentos clínicos:**
  - Ficam no bucket privado `clinical-documents`, que não tem leitura direta.
  - O link de 60 segundos vem da Edge Function `clinical-document-url`, que confere a autoria e registra a abertura.
  - Não são excluídos: seguem a guarda do prontuário.
- **Exportação** (`#/prontuario-impressao?paciente=…`): evoluções finalizadas, retificações e conceitualização, para imprimir ou salvar em PDF pelo navegador. Fica registrada.
- **Controle de preenchimento** (página **Controle de prontuários**, para quem vê a agenda geral):
  - Cada sessão realizada aparece como Pendente, Incompleto (rascunho), Finalizado ou Finalizado fora do prazo, e "atrasada" quando o prazo venceu sem finalização.
  - O prazo fica em **Configurações** (padrão de 48 h após a sessão).
- **Assinatura:** a finalização registra quem finalizou e quando. Assinatura digital com certificado (ICP-Brasil), se exigida, é uma etapa posterior.

## Financeiro

**Quem vê o quê:**

| Perfil | Acesso |
|---|---|
| Proprietário(a) e Financeiro | Tudo: visão geral, cobranças, despesas, repasses e preços |
| Gerente e Recepção | Cobranças e pagamentos, inadimplência e tabela de preços (só leitura). Não veem resultado, despesas nem repasses |
| Profissional | Só as cobranças das próprias sessões (sem valores de caixa) e o próprio repasse |

Cobranças, pagamentos, alocações e repasses não têm acesso direto às tabelas. Tudo passa por funções do banco, que fazem as somas e aplicam as regras.

- **Preços:** na hora de cobrar vale, nesta ordem:
  1. valor combinado com o paciente (aba Financeiro do paciente);
  2. profissional + tipo de sessão;
  3. profissional;
  4. tipo de sessão;
  5. padrão da clínica.

  Sem preço, a cobrança fica como **Valor a definir** e continua em aberto até alguém definir o valor.
- **Cobrança automática:** é criada quando a sessão vira **Realizada** (100%), **Falta** (padrão 100%) ou **cancelamento pelo paciente com menos de 24 h** (padrão 100%). Os percentuais e o prazo ficam em **Configurações**. Cancelamento pela clínica não cobra. Corrigir a situação da sessão não duplica a cobrança. Competência e vencimento seguem a data da sessão.
- **Pagamento:** PIX, dinheiro, débito, crédito ou transferência. Quita as cobranças marcadas, na ordem do vencimento. O que sobra vira **crédito do paciente** e é abatido sozinho das próximas cobranças, o que atende pacotes e pagamentos adiantados.
- **Estorno e cancelamento:** pedem motivo e ficam na auditoria. O estorno reabre as cobranças que o pagamento quitava. Ao cancelar uma cobrança, o que já foi pago volta a ser crédito.
- **Repasse:**
  - É o percentual da profissional sobre o valor **recebido** no mês pelas sessões dela.
  - O fechamento só é possível em meses encerrados e congela a base, o percentual e o valor.
- **Visão geral:**
  - O faturado conta pela data da sessão (competência). O recebido, as despesas pagas e os repasses contam pela data do caixa.
  - Resultado de caixa = recebido − despesas pagas − repasses.
  - Cada indicador traz a comparação com o mês anterior e com o mesmo mês do ano passado.
  - O gráfico de entradas e saídas mostra os 12 meses e pode ser visto também em tabela.
- **Despesas:** cada uma tem categoria e centro de custo, e as duas listas podem ser editadas em **Despesas**. Os centros de custo iniciais são Administrativo, Atendimento clínico, Comercial e marketing.
- **Previsão:** em **Relatório financeiro → Previsão**, os saldos das cobranças em aberto e as despesas não pagas aparecem por mês de vencimento nos próximos 12 meses. Valores vencidos ficam separados. A previsão usa somente lançamentos existentes; sessões ainda não cobradas e repasses futuros não entram.
- **Comparação das despesas:** o relatório por categoria e centro de custo mostra a participação no período escolhido e a variação percentual em relação ao mesmo período do ano anterior, inclusive categorias que deixaram de ter lançamentos.
- **Fica para depois:** recibos e nota fiscal, importação do Yampa/Clinical Experts, conciliação bancária e PIX automático.

## Tarefas dos pacientes

No menu **Tarefas**, a profissional vinculada escolhe um paciente da sua carteira, escreve título e orientações, define um prazo opcional e envia. A Proprietária usa a mesma página, vê todas as tarefas e respostas e escolhe uma profissional vinculada ao criar uma tarefa. O paciente (ou responsável com acesso ativo) vê, responde e conclui a tarefa no portal. O portal exige vínculo ativo e aceite dos termos.

O módulo de pendências internas foi retirado do sistema web e do aplicativo. Pedidos do portal continuam na ficha do paciente e avisam a equipe; retornos comerciais ficam no contato; remarcações do WhatsApp avisam a equipe com acesso à agenda. Registros legados no banco não foram apagados.

### Mensagens do WhatsApp como origem de tarefas (módulo 7)

Na criação da tarefa, depois de escolher o paciente, a profissional responsável ou a proprietária pode selecionar uma mensagem recebida no número oficial da clínica. O texto preenche **um rascunho editável** de título e orientações; a tarefa só chega ao paciente após revisão e envio humano. A origem fica vinculada à tarefa no banco. Áudios recebidos aparecem na mesma lista e podem ser transcritos sob demanda, sem criação automática da tarefa. O checklist e a conclusão pelo paciente continuam no portal. As pendências internas da equipe permanecem fora do sistema.

A transcrição de áudio depende de `WHATSAPP_TOKEN` e `OPENAI_API_KEY` configurados como segredos do projeto Supabase e da função `patient-task-audio` implantada. O áudio é baixado da Meta e enviado à API de transcrição da OpenAI somente quando a pessoa autorizada clicar em **Transcrever áudio**; a transcrição é guardada na mensagem e deve ser conferida antes do uso. Áudios de até 25 MB são aceitos. O número oficial e o webhook do WhatsApp ainda precisam ser configurados na Meta para receber mensagens reais.

## Comercial (CRM)

Substitui o Converte no controle de contatos, funil e campanhas. É usado por Proprietário(a), Gerente e Recepção (`crm.view` e `crm.manage`); profissionais não acessam. As alterações nos leads passam por funções do banco, que registram cada passo na linha do tempo do lead (`lead_activities`).

- **Lead:**
  - Dados: nome, telefone/WhatsApp, e-mail, origem, campanha, interesse (serviços do site), local (on-line ou unidade), profissional desejada, responsável e observações.
  - Ao digitar telefone ou e-mail, o sistema avisa se já existe lead ou paciente com o mesmo contato (telefone comparado com e sem o 55).
- **Funil** (página **Funil**):
  - Quadro por etapa, em que arrastar o cartão muda a etapa, ou lista com filtros por responsável, origem e busca.
  - Etapas: Novo contato → Em atendimento → Primeira consulta agendada → Convertido, ou Perdido. As etapas podem ser editadas.
  - "Perdido" exige motivo (preço, horário, não respondeu, escolheu outro lugar, outro).
  - "Convertido" só acontece pela **conversão em paciente**: ela cria o cadastro (ou liga a um paciente com o mesmo contato), com a profissional, a origem e a campanha.
- **Avaliações antes da conversão:** no lead, **Agendar avaliação** reserva um horário na agenda da profissional e move o contato para **Primeira consulta agendada**. A avaliação pode ser marcada como compareceu, faltou ou cancelada; o resultado fica no histórico e alimenta os indicadores comerciais. Uma reserva futura vira sessão de avaliação ao converter o lead, sem duplicar o horário. Se o lead for ligado a um paciente existente, as profissionais escolhidas são acrescentadas aos vínculos desse paciente. Reservas ainda não criam cobrança nem prontuário.
- **Contatos e retorno:**
  - Cada ligação, mensagem, e-mail ou conversa é registrada no lead.
  - **Retornos** no Funil mostra os contatos pendentes em ordem de data e horário, com responsável e atraso destacado.
  - O retorno pode ser reagendado ou cancelado; ao registrar uma ligação, mensagem, e-mail ou reunião, ele é concluído automaticamente. O histórico guarda agendamento, conclusão e cancelamento.
  - Após a conversão, a aba **Histórico** da ficha do paciente reúne os contatos comerciais, cadastro, documentos, sessões e pagamentos. Cada tipo de dado segue sua permissão; o conteúdo clínico continua no prontuário.
- **Campanhas:**
  - Nome, canal, período, investimento (lançado à mão) e código para o link do anúncio (`utm_campaign`).
  - Resultados desde o início da campanha: leads, convertidos, compareceram à sessão, custo por lead, custo por paciente e faturamento.
  - O faturamento só aparece para quem vê cobranças ou o financeiro.
- **Painel comercial:**
  - Os leads que entraram no mês, acompanhados até hoje: convertidos, taxa de conversão, compareceram, faturamento e tempo médio até o primeiro contato.
  - Novos pacientes de todas as origens.
  - Por origem, por etapa, motivos de perda e mês a mês, com comparação com o mês anterior e com o mesmo mês do ano anterior.
  - **Carteira por profissional:** total de pacientes vinculados hoje e entradas/saídas no mês. O histórico de movimentações começa na ativação desse controle; vínculos anteriores entram no total atual.
  - O Início mostra os novos pacientes do mês e a conversão.
- **Formulário do site** (Edge Function pública `lead-capture`):
  - Os códigos ficam em **Configurações do comercial**: um rastreador para o cabeçalho (guarda por 30 dias as UTMs do anúncio) e o formulário, para um bloco "HTML personalizado" do WordPress.
  - Proteções:
    - aceita só as origens de `LEAD_ALLOWED_ORIGINS` (padrão: `renatadeazevedo.com.br`, com e sem www);
    - campo-isca e tempo mínimo de preenchimento contra robôs;
    - consentimento obrigatório (LGPD);
    - no máximo 5 envios aceitos por IP por hora e 300 por dia (o IP é guardado só como hash).
  - Um contato repetido vira registro no lead que já existe, sem duplicar.
  - O responsável padrão recebe um aviso no sino.
- **Importação de planilha** (ex.: exportação do Converte): arquivo CSV com vírgula ou ponto e vírgula.
  - As colunas são reconhecidas pelo título e podem ser ajustadas antes de importar. Datas no formato dd/mm/aaaa são aceitas.
  - Pula contatos que já existem e cria as campanhas citadas na planilha.
  - Situações como "perdido" ou "convertido" são reconhecidas.
- **LGPD:** uma rotina diária (`pg_cron`, 4h30) anonimiza leads perdidos sem nenhuma atividade há 12 meses e apaga o registro de envios com mais de 30 dias.
- **Origem do paciente:** o cadastro do paciente ganhou "Como conheceu a clínica". Ela vem do lead na conversão ou é escolhida à mão.
- **Fica para depois:**
  - atendimento automático com IA e caixa de entrada do WhatsApp (Blocos 10 e 11, que exigem a conta oficial do WhatsApp Business Platform);
  - investimento puxado automaticamente do Meta Ads e do Google Ads (Bloco 10);
  - proteção extra contra robôs com Cloudflare Turnstile, se aparecer spam.

## Relatórios

O módulo **Relatórios** reúne o que já estava espalhado e acrescenta comparativos e exportação. As contas são feitas no banco (funções `report_*`), e cada função confere a permissão de quem pede.

| Relatório | Quem vê |
|---|---|
| Operacional (sessões, pacientes, prontuários, tarefas) | Quem vê a agenda geral; a profissional vê **Meus números**, só os próprios |
| Financeiro: DRE, por profissional, despesas, repasses | Proprietário(a) e Financeiro (`finance.view`) |
| Financeiro: formas de pagamento e inadimplência | Quem vê cobranças (`billing.view`), inclusive Gerente e Recepção |
| Comercial | Quem acessa o Comercial (`crm.view`) |
| Desempenho: pacientes, conversão, carteiras, motivos de saída e indicadores financeiros | Quem acessa o Comercial (`crm.view`); CAC e LTV somente com acesso a cobranças ou financeiro |
| Comparativo anual | Todos os acima; cada indicador aparece só para quem pode vê-lo |

- **Operacional:**
  - **Sessões** por profissional, tipo ou modalidade: marcadas, realizadas, faltas, cancelamentos (do paciente, tardios, da clínica), remarcadas, sem presença registrada e horas atendidas.
  - **Taxa de faltas** = faltas ÷ (realizadas + faltas). O cancelamento tardio usa a antecedência da política de cobrança.
  - **Pacientes:** situação atual e cadastros no período.
  - **Retenção:** dos pacientes cuja primeira sessão realizada caiu no período, quantos tiveram outra sessão realizada 4 e 12 semanas depois ou mais. Só entra na conta quem já teve esse tempo.
  - **Prontuários:** percentual de evoluções finalizadas no prazo, sem conteúdo clínico.
  - **Tarefas:** criadas, concluídas no prazo e atrasadas.
- **Financeiro:**
  - **DRE simplificada** mês a mês: competência (faturado, descontos, despesas por categoria e repasses fechados) e caixa (recebido, despesas pagas e repasses pagos).
  - **Faturado e recebido** por profissional e tipo de sessão.
  - **Recebimentos** por forma de pagamento.
  - **Inadimplência** por paciente, por faixa de atraso (a vencer, até 30, de 31 a 60 e mais de 60 dias).
  - **Despesas** por categoria e por centro de custo, com o peso de cada um no total.
  - **Repasses** mês a mês.
- **Comercial:** leads do período por origem e por campanha (investimento, custo por lead, custo por paciente, faturamento e retorno), etapas e motivos de perda.
- **Desempenho (módulo 6):** filtro por período, equipe inteira ou profissional e origem comercial; novos pacientes cadastrados no período, pacientes que tiveram acompanhamento encerrado no período, motivos de saída, conversão de leads por profissional, carteira atual, entradas, saídas e crescimento percentual. O cadastro exige motivo quando muda para alta ou inativo. Os encerramentos só são contabilizados desde 27/10/2026, quando o histórico começou. O crescimento usa abertura da carteira no primeiro dia, entradas e saídas do período; antes de 27/10/2026 aparece sem cálculo. Um paciente vinculado a duas profissionais consta nas duas carteiras, mas uma vez no total da equipe. Leads sem profissional preferida entram no total, mas não na comparação individual.
  - **CAC estimado:** orçamento total cadastrado das campanhas com leads criados no recorte ÷ leads dessas campanhas que viraram pacientes até hoje. O orçamento não é gasto efetivo por data; para obter CAC real será preciso registrar desembolsos por campanha e período.
  - **LTV observado:** total de pagamentos não estornados recebidos até hoje dos pacientes cadastrados no recorte ÷ número desses pacientes. É média histórica recebida, não projeção de receita futura. Com filtro de profissional, são considerados pacientes vinculados hoje ou historicamente; a receita do paciente não é repartida entre profissionais.
- **Comparativo anual:**
  - Dois anos no acumulado até o mesmo mês: faturado, recebido, despesas pagas, resultado de caixa, sessões, taxa de faltas, novos pacientes, leads e conversão.
  - Cada indicador traz a variação e o gráfico mês a mês, que também pode ser visto em tabela.
  - **Não há histórico anterior ao sistema:** 2025 e os meses sem uso aparecem zerados.
- **Em todos:** período (este mês, mês passado, trimestre, ano, ano passado ou outro), filtro por profissional quando cabe, **Exportar CSV** (ponto e vírgula e vírgula decimal, abre direto no Excel) e **Imprimir/PDF** (o layout de impressão esconde menus e filtros).
- **Desempenho:** medido com cerca de 60 mil sessões e 30 mil cobranças. Os relatórios respondem em até cerca de 0,5 s; a inadimplência leva cerca de 1,4 s no pior caso (30 mil cobranças em aberto).
- **Fica para depois:** ocupação da agenda (exige cadastrar o horário de trabalho de cada profissional) e exportação em .xlsx. O envio automático de relatórios por e-mail não será feito.

## Google Agenda e Google Meet (Bloco 10.1)

**Situação:** tudo pronto e testado com um Google simulado. A integração **liga quando as credenciais do Google forem cadastradas**. Até lá, a página Google Agenda e as funções avisam que a integração ainda não foi configurada.

**Como funciona**

- **Conexão:** cada profissional conecta a própria conta Google (OAuth) na página **Google Agenda**.
  - O token de acesso contínuo fica **cifrado** (AES-256-GCM) em `google_accounts`, que a interface não lê.
  - A profissional escolhe para qual calendário as sessões vão e quais calendários informam horário ocupado.
- **Envio das sessões:** vão para o calendário de destino.
  - Sessões **on-line** ganham link do **Google Meet**, que fica salvo na sessão ("Entrar no Google Meet" na agenda).
  - Remarcar atualiza o evento; cancelar ou excluir remove o evento do Google.
  - O título do evento segue **Configurações → Google Agenda**. O padrão é só as iniciais do paciente (LGPD); nada clínico vai para o Google.
- **Ocupado:** os compromissos pessoais dos calendários marcados aparecem na agenda da clínica como "Compromisso no Google Agenda", sem título.
  - Novas sessões e remarcações sobre um compromisso sincronizado são recusadas. Sessões marcadas antes de um compromisso pessoal aparecer no Google podem continuar sendo confirmadas ou finalizadas.
  - Mudanças feitas no Google atualizam os horários ocupados na próxima sincronização; não alteram as sessões já marcadas na clínica.
- **Sincronização:** fila `calendar_sync_queue`, alimentada por gatilhos nas sessões.
  - O `pg_cron` chama a função `google-sync` a cada 5 minutos, via `pg_net`, com o segredo guardado no Vault. Isso só acontece depois que alguma conta é conectada.
  - Também há o botão "Sincronizar agora". Falhas são tentadas até 5 vezes e aparecem na página.
- **Desconectar:** remove do Google os eventos criados pelo sistema, revoga a autorização e apaga a conta conectada.
- **Funções:** `google-oauth-start`, `google-oauth-callback`, `google-sync` e `google-disconnect`.

**O que já está configurado no Supabase:** os segredos internos `GOOGLE_TOKEN_KEY` (chave da cifra) e `GOOGLE_SYNC_SECRET`, gerados aleatoriamente, e as entradas `google_sync_url` e `google_sync_secret` no Vault. **Não troque a `GOOGLE_TOKEN_KEY`**: os tokens já gravados deixariam de abrir.

**O que falta você configurar (uma vez)**

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto (ex.: "Sistema Renata de Azevedo").
2. Em **APIs e serviços → Biblioteca**, ative a **Google Calendar API**.
3. Em **Tela de consentimento OAuth**, configure:
   - tipo **Externo** (ou **Interno**, se a clínica usar Google Workspace e todas as profissionais tiverem conta do domínio);
   - nome do app, e-mail de suporte e domínio do sistema;
   - escopos: `openid`, `email`, `.../auth/calendar.events` e `.../auth/calendar.calendarlist.readonly`.
   - No modo **Teste**, cadastre como usuários de teste os e-mails Google das profissionais (até 100). Para uso sem limite, publique o app; o Google pode pedir verificação por causa dos escopos de agenda.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha o tipo **Aplicativo da Web** e informe:
   - URI de redirecionamento autorizado: `https://qnchebjrgnfgszrzlyue.supabase.co/functions/v1/google-oauth-callback`;
   - origem JavaScript autorizada: o endereço do sistema na Cloudflare.
5. Cadastre os segredos no Supabase (terminal, na pasta do projeto). Não cole os valores em chats ou e-mails:
   ```
   npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... APP_URL=https://endereco-do-sistema
   ```
   `APP_URL` é para onde a profissional volta depois de autorizar.
6. Teste com uma profissional: Google Agenda → **Conectar minha conta Google** → autorizar. Depois crie uma sessão on-line e confira o evento com Meet no Google.

## WhatsApp (Bloco 10.2)

**Situação:** tudo pronto e testado com a API da Meta simulada. Nada é enviado enquanto as credenciais não forem cadastradas **e** alguém marcar **Configurações → WhatsApp → Ativar envios**. O número ainda não foi definido; ele só entra nas credenciais, não no código.

**Como funciona** (API oficial: WhatsApp Business Platform/Cloud API; nada de automação do WhatsApp Web)

- **Pacientes:**
  - Só recebem mensagens os que **autorizaram** no cadastro ("Aceita receber confirmações e lembretes pelo WhatsApp"). Para isso, o celular precisa ter DDD.
  - **Pedido de confirmação**, por padrão 48 h antes, com os botões "Confirmar" e "Preciso remarcar". A sessão passa a "aguardando confirmação".
    - "Confirmar" confirma a sessão na agenda e envia uma resposta automática. Se a sessão já tiver sido cancelada, nada muda.
    - "Preciso remarcar" cria uma tarefa urgente para o responsável padrão do Comercial e avisa a equipe.
  - **Lembrete**, por padrão 2 h antes. Em sessão on-line, leva o link do Google Meet.
  - Os horários de envio ficam em Configurações; 0 desliga.
- **Equipe:** em "Avisos no WhatsApp" (menu da conta), cada pessoa liga o aviso de nova tarefa no próprio celular. A mensagem traz só um link para o sistema, nunca o conteúdo da tarefa.
- **Mensagens recebidas:** aparecem em **Atendimento → WhatsApp** (Proprietário(a), Gerente e Recepção; permissão `messages.manage`).
  - Número de paciente: a mensagem fica ligada ao cadastro.
  - Número desconhecido: vira **lead "WhatsApp direto"** no Comercial (ou entra no lead em aberto do mesmo número).
  - A equipe é avisada no sino, no máximo uma vez por hora por conversa.
- **Respostas da equipe:** texto livre só até **24 h** depois da última mensagem da pessoa, que é a regra da Meta. Fora disso, só os modelos aprovados.
- **Registro:** cada envio guarda a situação (na fila, enviada, entregue, lida, não enviada). Falhas são tentadas até 5 vezes.
- **Funcionamento interno:**
  - Funções `whatsapp-send` (envia a fila; chamada pelo `pg_cron` a cada 5 minutos, com segredo do Vault) e `whatsapp-webhook` (recebe da Meta).
  - O webhook confere a assinatura `X-Hub-Signature-256` com o App Secret e trata os botões e as mensagens no banco (`whatsapp_inbound`).
- **LGPD:** a autorização fica registrada com data e as mensagens não levam conteúdo clínico.

**O que já está configurado no Supabase:** o segredo interno `WHATSAPP_SEND_SECRET` e as entradas `whatsapp_send_url` e `whatsapp_send_secret` no Vault.

**O que falta você configurar (quando o número estiver definido)**

1. **Número:**
   - Use um número que **não** esteja em uso no aplicativo WhatsApp (comum ou Business) do celular. O número do site pode ser migrado, mas deixa de funcionar no aplicativo do celular.
   - Também pode ser um número novo. As conversas passam a ser atendidas pela tela WhatsApp do sistema.
2. **Meta:**
   - No [Meta for Developers](https://developers.facebook.com/), crie um app do tipo **Business** ligado ao Gerenciador de Negócios da clínica e adicione o produto **WhatsApp**.
   - Faça a verificação da empresa no Gerenciador de Negócios, se for pedida.
3. Em **WhatsApp → Configuração da API**, adicione o número e anote o **ID do número de telefone**.
4. **Token:** no Gerenciador de Negócios, em Usuários do sistema, crie um usuário do sistema com acesso ao app e gere um **token permanente**, com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
5. **Modelos:** em **Gerenciador do WhatsApp → Modelos de mensagem**, crie os 3 modelos na categoria **Utilidade**, idioma **Português (BR)**, exatamente como em Configurações → WhatsApp → "Modelos para cadastrar na Meta":
   - `confirmacao_sessao`, com 2 botões de **resposta rápida**: "Confirmar" (1º) e "Preciso remarcar" (2º);
   - `lembrete_sessao`;
   - `aviso_tarefa`.
6. **Segredos no Supabase:** escolha uma palavra secreta para o webhook (`WHATSAPP_VERIFY_TOKEN`) e copie o **App Secret** (Configurações do app → Básico). Depois rode:
   ```
   npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
   ```
7. **Webhook** (WhatsApp → Configuração):
   - URL de retorno: `https://qnchebjrgnfgszrzlyue.supabase.co/functions/v1/whatsapp-webhook`;
   - token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`;
   - assine o campo **messages**.
8. **Ativar e testar:**
   - Em Configurações → WhatsApp, informe o endereço do sistema (para os links) e marque **Ativar envios**.
   - Teste com um paciente de teste autorizado e uma sessão marcada para daqui a 1 dia.

## Assistente de IA (Bloco 11)

**Situação:** pronto e testado com a API da Anthropic simulada. **Entregue desligado.** Pelo documento da clínica, a IA só entra depois da revisão jurídica e com o prontuário já em uso.

**Como funciona** (aba **Assistente de IA** no prontuário de cada paciente)

- **Três autorizações:** a IA só funciona com as três ao mesmo tempo.
  1. A Proprietária liga a IA em Configurações, com **limite mensal de custo** obrigatório.
  2. A profissional aceita o **termo de uso** (versão registrada).
  3. O **paciente tem consentimento específico** registrado pela profissional responsável. O consentimento pode ser revogado; revogar apaga as transcrições e os rascunhos guardados.
- **Entrada:** colar a transcrição ou enviar o arquivo exportado do tl;dv ou do Google Meet (.txt, .vtt ou .srt; numeração e horários são removidos).
- **Ocultação antes do envio:** nome (e partes do nome, com e sem acento), nome social, responsável, CPF, telefones, e-mails, endereço, CEP e os **outros nomes** que a profissional informar (cônjuge, familiares) viram marcadores. Os testes conferem que nada disso chega ao fornecedor.
- **Chamada à IA:**
  - Edge Function `ai-draft`, com o SDK oficial (`@anthropic-ai/sdk`).
  - Modelo `claude-opus-5-5` (troca pelo segredo `AI_MODEL`), esforço alto e resposta em **formato JSON fixo**.
  - Fallback automático (`fallbacks: "default"`) se o modelo recusar o pedido.
- **O que volta:** resumo, tópicos, rascunho de evolução (temas trabalhados, intervenções realizadas, observações relevantes, combinados e próximos passos) e o que falta completar. Sugestões administrativas não são exibidas.
- **Regras conferidas pelo sistema** (além das instruções dadas à IA):
  - cada item precisa de um **trecho literal da transcrição**, senão é descartado;
  - itens com diagnóstico, CID, transtorno, prescrição, medicação ou dose são descartados;
  - os itens descartados aparecem como avisos na revisão.
- **Revisão:**
  - A profissional vê o rascunho ao lado da transcrição (com o trecho de origem destacado), marca os itens que entram e edita o texto.
  - "Usar como rascunho de evolução" cria um **rascunho** em Evoluções, com o selo "rascunho de IA". Ele só vale quando ela **finalizar**.
- **Rastro:**
  - A evolução guarda de qual rascunho de IA nasceu.
  - Cada uso registra profissional, data, modelo, tokens e custo.
  - Cada abertura entra no registro de acesso clínico.
- **Guarda:**
  - A transcrição e o rascunho são apagados **7 dias** (configurável) depois de a evolução ser finalizada ou o rascunho descartado, e no máximo 30 dias depois do envio.
  - A limpeza é diária, pelo `pg_cron`. Ficam só os dados de uso e custo.

**Custos**

- O custo de cada uso é calculado com os tokens informados pela API e o preço de tabela: Claude Opus 5.5 custa US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída (tabela de 06/10/2026, conferir em https://www.anthropic.com/pricing).
- Uma sessão de 50 minutos tem algo como 8 a 12 mil palavras. Pela tabela, isso daria cerca de 15 a 20 mil tokens de entrada e 2 a 6 mil de saída, ou seja, centavos de dólar por uso. O valor exato aparece depois de cada uso.
- O total do mês fica em Configurações → Assistente de IA. Ao atingir o limite, o assistente para até o mês seguinte.
- A fatura oficial é a do fornecedor.

**Para ligar (depois da revisão jurídica)**

1. **Termo do paciente:** revisar com o jurídico o modelo de termo de consentimento (aba Assistente de IA → Registrar consentimento → Modelo de termo).
2. **Contrato com a Anthropic:**
   - Criar a conta comercial na Anthropic (console.anthropic.com).
   - Formalizar o contrato de proteção de dados e as condições de retenção e de não uso para treinamento. Há transferência internacional de dados: LGPD, art. 33.
3. **Chave da API:** gerar a chave e cadastrá-la sem colar em chats:
   ```
   npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue ANTHROPIC_API_KEY=...
   ```
4. **Ativar:** em Configurações → Assistente de IA, definir o limite mensal (US$) e o prazo de guarda, e ligar.
5. **Profissionais:** cada uma aceita o termo de uso na primeira vez e registra o consentimento de cada paciente antes de usar.

**Fica para depois:** integração direta com o tl;dv. A API deles ainda está em versão "alpha" e o acesso exige plano pago.

## Aplicativo da equipe (Bloco 12)

**Situação:** pronto e testado na versão web do aplicativo (tela de celular, contra o Supabase real). Push, biometria e cofre do aparelho só podem ser conferidos num celular de verdade.

- **Projeto:** pasta `mobile/`, com Expo SDK 58 e React Native. Nome "Renata de Azevedo, Equipe", identificador `br.com.renatadeazevedo.equipe`.
- **Mesmas regras do sistema:** usa a mesma conta, o mesmo Supabase e as mesmas permissões (RLS). Não existe acesso a mais pelo aplicativo.
- **Código compartilhado:** `shared/api.ts` (chamadas ao Supabase), `shared/format.ts` e `shared/types.ts` servem ao sistema web e ao aplicativo.

**O que o aplicativo faz**

- **Início:** sessões do dia, pendências de evolução (profissional) e cobranças vencidas.
- **Agenda:** dia e semana; abrir a sessão, confirmar, registrar presença ou falta; link do Meet.
- **Pacientes:** busca e ficha resumida com Ligar e WhatsApp.
- **Tarefas (Proprietária e Profissional):** criar orientações para pacientes e acompanhar as respostas.
- **Mais:** avisos, cobranças em aberto com registro de pagamento (quem tem permissão de financeiro) e "Meu repasse" (profissional).
- **Prontuário no celular:** só as pendências e o **rascunho** da evolução. Finalizar e ver o histórico completo continua no computador.

**Segurança**

- A sessão fica no cofre do aparelho (Keychain/Keystore).
- O aplicativo **trava depois de 5 minutos** em segundo plano e destrava com biometria ou senha.
- Sem uso por **30 dias**, a pessoa precisa entrar de novo.
- Notificação com o celular bloqueado mostra só um **texto genérico** ("Você recebeu uma tarefa."), sem nome de paciente ou de lead.

**Para testar no celular (Expo Go)**

1. Instale o **Expo Go** no celular (App Store ou Google Play).
2. No computador, dentro de `mobile/`, copie `.env.example` para `.env` e preencha a URL e a chave **pública** do Supabase (as mesmas do sistema web).
3. Rode `npm install` e depois `npx expo start`. Leia o QR code com a câmera (iPhone) ou com o Expo Go (Android). O celular precisa estar na mesma rede do computador.

No Expo Go dá para testar tudo, menos o push (a Expo exige um build próprio para isso).

**O que já está configurado no Supabase:** a função `push-send`, o segredo interno `PUSH_SEND_SECRET`, as entradas `push_send_url` e `push_send_secret` no Vault e o agendamento `push` (a cada minuto). O envio fica **desligado** até alguém ligar em Configurações → Aplicativo da equipe.

**O que falta você configurar (para publicar e ter push)**

1. **Conta na Expo:** crie a conta em expo.dev. Dentro de `mobile/`, rode `npx eas-cli login` e depois `npx eas-cli init`. O comando grava o `projectId` em `app.json` (`extra.eas.projectId`); sem ele, o aplicativo não registra o aparelho para push.
2. **Lojas:**
   - Apple Developer (US$ 99/ano) para iPhone.
   - Google Play Console (US$ 25, uma vez) para Android.
   - Para uso só da equipe, a distribuição pode ser interna: TestFlight e teste interno do Google Play.
3. **Build:** `npx eas-cli build --platform ios` e `npx eas-cli build --platform android`. A EAS pede e guarda as credenciais de push da Apple e do Firebase.
4. **Envio autenticado (opcional):** se ativar "Enhanced security for push" na Expo, gere um token de acesso e cadastre:
   ```
   npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue EXPO_ACCESS_TOKEN=...
   ```
5. **Ligar:** em Configurações → Aplicativo da equipe, marque **Enviar avisos para o celular**. O painel mostra quantos aparelhos estão registrados e o último erro de envio.

**Fica para o Bloco 14:** ícone e tela de abertura próprios (hoje são os padrões do modelo da Expo) e a publicação nas lojas.

## Portal do paciente (Bloco 13)

**Situação:** pronto e testado contra o Supabase real. **Entregue desligado.**

- **Formato:** portal web separado do sistema da equipe, no mesmo projeto (`web/src/portal/`).
  - Abre em `#/portal`, ou sozinho num endereço que comece com `portal.` (ex.: `portal.renatadeazevedo.com.br`).
  - Funciona no navegador do celular; não precisa instalar nada.

**Formulários, exercícios e escalas (módulo 8):** a profissional cria modelos em **Pacientes → Formulários e escalas**, com perguntas de texto, número, escolha ou escala pontuável, e os envia aos pacientes da própria carteira. O paciente ou responsável responde em **Formulários** no portal; cada envio aceita uma resposta e mantém uma cópia das perguntas do momento do envio. Escalas somam o índice das alternativas a partir de zero, com opção de inverter perguntas; a pontuação não traz diagnóstico, faixas de interpretação ou normas automáticas. A profissional vê respostas e pontuação na aba **Formulários** do prontuário, e elas entram na exportação do prontuário. A proprietária e a equipe administrativa não acessam esse conteúdo clínico. A publicação como aplicativo nas lojas ainda depende de um projeto e distribuição próprios; o portal funciona no navegador do celular.
- **Por que não um app nas lojas:** o paciente usa poucas vezes por mês. Um app exigiria instalação e revisão da Apple e do Google, e misturá-lo ao app da equipe aumentaria o risco de vazamento.

**Como funciona**

- **Acesso só por convite:**
  - Na ficha do paciente, aba **Portal**, quem gerencia pacientes libera o acesso para o e-mail do paciente ou do responsável.
  - Paciente menor de 18 anos: o acesso é do responsável. Uma mesma pessoa pode acompanhar mais de um paciente (ex.: dois filhos).
  - "Encerrar acesso" corta tudo na hora.
- **Entrada sem senha:**
  - A pessoa informa o e-mail e recebe um **código de 6 dígitos** (vale 10 minutos).
  - A resposta é a mesma exista ou não a conta, para não revelar quem é paciente.
- **Primeiro acesso:** a pessoa aceita os **termos de uso e o aviso de privacidade**, com a versão registrada. O texto é um **rascunho para revisão jurídica**, em `web/src/portal/terms.ts`.
- **Telas do paciente:**
  - **Início:** próxima sessão e quanto está em aberto.
  - **Sessões:**
    - próximas e do último ano;
    - **Confirmar presença**, que grava na agenda;
    - **Preciso remarcar ou cancelar**: não mexe na agenda, cria uma tarefa para a equipe entrar em contato;
    - o link do Meet aparece 1 hora antes da sessão on-line.
  - **Atividades:** orientações da profissional, prazo opcional, resposta e conclusão pelo paciente ou responsável com acesso ativo.
  - **Financeiro:**
    - cobranças em aberto, com o saldo depois de pagamentos parciais;
    - pagamentos recebidos, sem as observações internas;
    - instruções de pagamento escritas pela clínica;
    - botão **Já paguei**, que cria uma tarefa para o financeiro conferir. O pagamento continua sendo registrado pelo financeiro.
  - **Documentos:** só os que a clínica compartilhou, abertos por link de 60 segundos. Cada download fica registrado.
  - **Avisos:** sessão marcada, remarcada ou cancelada (uma série semanal vira um aviso só), nova cobrança e novo documento.
- **Na ficha do paciente (equipe), aba Portal:**
  - quem tem acesso, último acesso e aceite dos termos;
  - documentos compartilhados e se o paciente já abriu;
  - pedidos feitos pelo portal, com link para a tarefa.
  - Compartilhar documentos: quem gerencia pacientes ou a profissional responsável.
  - Os documentos do portal ficam num armazenamento **separado** do prontuário e dos documentos administrativos.
- **Segurança:**
  - O paciente não lê nenhuma tabela diretamente. Tudo passa pelas funções `portal_*`, que conferem o vínculo da conta com o paciente, o portal ligado e o aceite dos termos.
  - O teste do banco (`npm run test:db`) entra como paciente, tenta ler **todas** as tabelas e chamar **todas** as funções da equipe, e falha se alguma devolver dados.
  - O prontuário nunca aparece no portal.
  - Contas de paciente não entram no sistema nem no aplicativo da equipe, e não aparecem em Usuários.

**O que já está configurado no Supabase:**
- funções `portal-invite`, `portal-document-url` e `portal-email-send`;
- segredo interno `PORTAL_EMAIL_SECRET`;
- entradas `portal_email_url` e `portal_email_secret` no Vault;
- agendamento `portal-email` (a cada minuto).

**O que falta você configurar**

1. **E-mail de envio dos códigos (obrigatório antes de uso real):**
   - O envio padrão do Supabase só entrega para os membros do projeto e poucas mensagens por hora.
   - Crie uma conta num serviço de e-mail. A sugestão é o Resend (resend.com), que também serve para os avisos do item 5.
   - Verifique o domínio `renatadeazevedo.com.br` nesse serviço, cadastrando os registros DNS indicados.
   - No painel do Supabase, em **Authentication → Emails → SMTP Settings**, informe servidor, usuário, senha e o remetente (ex.: `portal@renatadeazevedo.com.br`).
2. **Modelo do e-mail do código:**
   - Em **Authentication → Emails → Templates → Magic Link**, use o assunto "Seu código de acesso ao portal" e cole o conteúdo de `supabase/templates/codigo-de-acesso.html`. Ele mostra o código, não um link.
   - Em **Authentication → Providers → Email**, deixe o código com **6 dígitos** e validade de **600 segundos**.
   - No ambiente local, isso já vem de `supabase/config.toml`.
3. **Endereço:** crie o subdomínio `portal.renatadeazevedo.com.br` apontando para o mesmo projeto do sistema na Cloudflare (domínio personalizado). Sem ele, o portal funciona em `https://<endereço do sistema>/#/portal`.
4. **Ligar:**
   - Em **Configurações → Portal do paciente**, informe o endereço e as instruções de pagamento (ex.: chave PIX).
   - Escolha quem recebe os pedidos e marque **Ligar o portal do paciente**.
   - Teste primeiro com um paciente de teste.
5. **Avisos por e-mail (opcional):** gere uma chave da API no Resend e cadastre, sem colar em chats:
   ```
   npx supabase secrets set --project-ref qnchebjrgnfgszrzlyue RESEND_API_KEY=... PORTAL_EMAIL_FROM="Clínica Renata de Azevedo <portal@renatadeazevedo.com.br>"
   ```
   Depois marque **Avisar por e-mail** em Configurações. O e-mail é genérico ("há uma novidade no portal") e vai no máximo um por hora por pessoa.
6. **Revisão jurídica:** dos termos do portal e do caso de pacientes adolescentes (hoje, menor de 18 anos só tem acesso pelo responsável). Se o texto mudar, a versão em `private.portal_terms_version()` precisa mudar numa nova migração, e todos aceitam de novo.

**Fica para depois:** agendamento pelo próprio paciente, envio de arquivos pelo paciente, pagamento por PIX automático, recibos e um aplicativo do paciente nas lojas.

## Verificação em duas etapas (Bloco 14)

- **Para quem:** qualquer pessoa da equipe ativa na própria conta, em **menu da conta → Verificação em duas etapas**. Depois de ativar, o sistema e o app pedem o código do app autenticador (Google Authenticator, Microsoft Authenticator, 1Password…) depois da senha.
- **Exigência para Proprietária e Gerência:** em **Configurações → Segurança**. Esses perfis veem o financeiro e todos os pacientes.
  - Ligada, quem tem um desses perfis e entrou só com a senha fica **sem nenhuma permissão no banco** até digitar o código. A regra está nas funções de acesso do banco, não só na tela.
  - Na primeira entrada depois de ligar, quem ainda não cadastrou o app vê o QR code para cadastrar.
  - Só é possível ligar com a própria sessão já verificada, para ninguém trancar a clínica para fora.
- **No aplicativo da equipe:** pede o código depois da senha. O cadastro do app autenticador é feito pelo computador, porque o QR code precisa ser lido pelo celular.
- **Trocou de celular:** desative e ative de novo pelo menu da conta. Se a pessoa perdeu o celular, quem gerencia usuários pode remover o fator pelo painel do Supabase (**Authentication → Users → a conta → MFA factors**).
- **Testes automáticos:** a mesma varredura feita com a conta de paciente é feita com a Proprietária sem o código, e nada passa.
