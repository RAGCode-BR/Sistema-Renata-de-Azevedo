(function (App) {
  const PERGUNTAS = [
    ["Como agendar uma sessão?", "Clique em “Agendar sessão” ou em qualquer horário livre da grade, em Hoje ou na Agenda. Dá para repetir a sessão toda semana por 4, 8 ou 12 semanas. Se a profissional já tiver alguém no horário, o sistema avisa."],
    ["Como confirmar uma sessão?", "Em Hoje, as sessões de hoje e do próximo dia útil que ainda não foram confirmadas aparecem em Pendências. Marque a caixa ao lado do nome. Também dá para clicar na sessão e usar “Confirmar”. O link “Lembrar pelo WhatsApp” abre uma mensagem pronta para o paciente."],
    ["O que é “registrar presença”?", "Depois do horário, a sessão fica esperando você dizer se o paciente veio ou faltou. Clique nela e escolha “Marcar como realizada” ou “Faltou”. Só as sessões realizadas entram no financeiro."],
    ["Onde escrevo a evolução?", "Em Prontuários aparecem as sessões realizadas que ainda não têm evolução. Também dá para escrever pela própria sessão ou pelo prontuário do paciente."],
    ["Como registro um pagamento?", "Em Financeiro, na aba Sessões, clique em “Registrar pagamento”, informe a forma e a data. Se registrar por engano, use “Desfazer”."],
    ["Errei uma ação. Dá para voltar?", "Quase toda ação mostra um aviso no rodapé da tela com o botão “Desfazer”, que fica disponível por alguns segundos."],
    ["Onde ficam os dados?", "Por enquanto, só neste navegador e neste computador. Em Configurações você baixa uma cópia e restaura quando precisar. Quando o sistema ganhar servidor e login, os dados passam a ficar guardados com segurança e acessíveis de qualquer lugar."]
  ];

  function render(el) {
    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Ajuda</h1>
          <p class="lead">Respostas rápidas para o dia a dia.</p>
        </div>
      </section>
      <section class="panel faq">
        ${PERGUNTAS.map(([p, r]) => `<details><summary>${p}</summary><p>${r}</p></details>`).join("")}
      </section>`;
  }

  App.views.ajuda = { titulo: "Ajuda", render };
})(window.App);
