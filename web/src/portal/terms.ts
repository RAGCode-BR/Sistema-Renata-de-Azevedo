// Termos de uso e aviso de privacidade do portal do paciente. RASCUNHO para revisão jurídica.
// Ao mudar o texto, mude também a versão em private.portal_terms_version() (nova migração): todos
// precisam aceitar de novo.
export const TERMS: { title: string; paragraphs: string[] }[] = [
  {
    title: 'O que é o portal',
    paragraphs: [
      'O portal do paciente da clínica Renata de Azevedo mostra suas sessões, atividades propostas pela profissional, cobranças, pagamentos e os documentos que a clínica compartilhar com você. O prontuário e as anotações das profissionais não aparecem no portal.',
      'Pelo portal você pode responder e concluir atividades, confirmar sessões, pedir remarcação ou cancelamento e avisar que fez um pagamento. As respostas das atividades são vistas pela profissional responsável. Os pedidos administrativos são analisados pela equipe, que entra em contato com você. Remarcações e cancelamentos seguem a política da clínica, inclusive quanto a cobranças por cancelamento com pouca antecedência.'
    ]
  },
  {
    title: 'Seu acesso',
    paragraphs: [
      'O acesso é pessoal. Para entrar, você recebe um código no seu e-mail. Não compartilhe esse código: ninguém da clínica vai pedi-lo.',
      'Se você é responsável por um paciente menor de idade, o acesso é seu e você responde pelo uso das informações dele. A clínica pode encerrar o acesso a qualquer momento, por exemplo, ao fim do acompanhamento ou a pedido.'
    ]
  },
  {
    title: 'Seus dados (LGPD)',
    paragraphs: [
      'Os dados exibidos no portal são os que a clínica trata para prestar o atendimento e fazer a cobrança (Lei nº 13.709/2018). O portal registra seus acessos, confirmações, pedidos, atividades e respostas e os documentos que você baixa, para segurança e para o histórico do atendimento.',
      'Os dados ficam em servidores contratados pela clínica, com acesso restrito. Você pode pedir informações, correção ou cópia dos seus dados diretamente à clínica.'
    ]
  },
  {
    title: 'Avisos',
    paragraphs: [
      'Você pode receber e-mails avisando que há uma novidade no portal. Esses e-mails não trazem detalhes do atendimento: para ver, é preciso entrar no portal.',
      'Em situação de urgência, não use o portal. Procure o serviço de emergência mais próximo, ligue 192 (SAMU) ou 188 (CVV).'
    ]
  }
];
