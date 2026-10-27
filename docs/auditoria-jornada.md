# Auditoria da jornada do paciente — 27/10/2026

Esta revisão compara a jornada descrita na reunião com os fluxos implementados e testados no projeto. Os testes usam contas e pacientes fictícios, removidos pelo roteiro ao final.

| Etapa | Evidência no sistema | Verificação |
| --- | --- | --- |
| Contato comercial | Lead pelo formulário do site, origem/campanha, retorno, avaliação e histórico no Funil | Roteiro `comercial`: passou |
| Avaliação e conversão | A avaliação reserva a agenda; converter o lead cria ou vincula o paciente e transforma uma reserva futura em sessão | Roteiro `comercial`: passou |
| Cadastro e agenda | Dados do paciente, profissionais responsáveis, agendamentos, presença, faltas e remarcações | Roteiros `pacientes` e `agenda`: passaram |
| Prontuário | Registro clínico vinculado à sessão e acesso restrito à profissional | Roteiro `prontuario` e testes de permissões: passaram |
| Financeiro | Cobrança por sessão, pagamento parcial, saldo e crédito sem duplicar recebimento | Roteiro `financeiro` e testes financeiros: passaram |
| Indicadores | Conversão, origem, campanha e novos pacientes no painel e na página inicial | Roteiro `comercial`: passou |
| Portal do paciente | Convite, tarefas com checklist, sessões, cobranças, documentos e avisos | Roteiro `portal`: passou |
| Formulários e escalas | Permissões, envio e cálculo de escala reversa | Teste de banco `formularios_pacientes.sql`: passou; a resposta pela interface ainda precisa de homologação com a equipe |

## Resultado técnico

- `npm run test:e2e -- comercial pacientes agenda financeiro prontuario --sem-app --sem-integracao`: quatro roteiros passaram; o comercial chegou a 17 verificações e falhou no seletor antigo da navegação móvel.
- O seletor foi atualizado para o novo menu **Mais**. `npm run test:e2e -- comercial --sem-app --sem-integracao`: 18 verificações passaram.
- `npm run test:e2e -- portal --sem-app --sem-integracao`: 9 verificações passaram.
- `npm run test:db`: passou, incluindo permissões, segurança, financeiro, tarefas dos pacientes, formulários/escalas e conflitos com Google Agenda.
- Os roteiros de ponta a ponta informaram **zero contas e zero pacientes fictícios restantes** após a limpeza.

## Para a abertura com dados reais

As integrações externas continuam dependendo das contas e credenciais da clínica: Google, WhatsApp, SMTP para o portal e, se usado, assistente de IA. A configuração necessária está em [Configurações pendentes](configuracoes-pendentes.md). A equipe ainda precisa seguir o [roteiro de homologação](homologacao.md), especialmente a resposta a formulários pela interface e a validação visual com a Renata. As tarefas internas da equipe continuam fora do sistema, conforme decisão do proprietário.
