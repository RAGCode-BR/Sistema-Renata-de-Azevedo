(function (App) {
  const { d, esc, q, ui } = App;
  const estado = { semana: null, prof: "todas" };

  function render(el) {
    if (!estado.semana) estado.semana = d.segunda(d.diaUtil(d.hoje()));
    const dias = d.semana(estado.semana);
    const hoje = d.hoje();
    const filtro = (s) => estado.prof === "todas" || s.profissionalId === estado.prof;
    const profs = q.profsAtivos();

    const colunas = dias.map((iso) => {
      const sessoes = q.sessoesDia(iso).filter(filtro);
      return {
        titulo: d.curta(iso),
        sub: iso === hoje ? `hoje, ${App.plural(sessoes.length, "sessão", "sessões")}` : App.plural(sessoes.length, "sessão", "sessões"),
        data: iso,
        profId: estado.prof === "todas" ? "" : estado.prof,
        sessoes
      };
    });

    const total = colunas.reduce((t, c) => t + c.sessoes.length, 0);
    const aConfirmar = colunas.flatMap((c) => c.sessoes).filter((s) => q.statusDe(s) === "agendada").length;
    const fim = d.parse(dias[4]);
    const intervalo = `${d.parse(dias[0]).getDate()} a ${fim.getDate()} de ${fim.toLocaleDateString("pt-BR", { month: "long" })}`;

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Agenda</h1>
          <p class="lead">Semana de ${intervalo}. ${App.plural(total, "sessão marcada", "sessões marcadas")}${aConfirmar ? `, ${aConfirmar} a confirmar` : ""}.</p>
        </div>
        <div class="tools">
          <select class="input compact" id="filtro-prof" aria-label="Profissional">
            ${ui.opcoes([["todas", "Todas as profissionais"], ...profs.map((p) => [p.id, p.nome])], estado.prof)}
          </select>
          <button class="button" type="button" data-action="nova-sessao" ${estado.prof !== "todas" ? `data-prof="${estado.prof}"` : ""}>Agendar sessão</button>
        </div>
      </section>

      <section class="agenda week">
        <div class="agenda-header">
          <div class="pager">
            <button class="link-btn" type="button" data-semana="-7">Semana anterior</button>
            <button class="link-btn" type="button" data-semana="0"${estado.semana === d.segunda(d.diaUtil(hoje)) ? " disabled" : ""}>Esta semana</button>
            <button class="link-btn" type="button" data-semana="7">Próxima semana</button>
          </div>
          <input class="input compact" type="date" id="ir-data" value="${estado.semana}" aria-label="Ir para a data">
        </div>
        <div class="grid-wrap">${ui.grade({ colunas, mostrarProf: estado.prof === "todas" && profs.length > 1 })}</div>
        <div class="agenda-footer">${ui.legenda()}</div>
      </section>`;

    el.querySelector("#filtro-prof").onchange = (e) => {
      estado.prof = e.target.value;
      render(el);
    };
    el.querySelectorAll("[data-semana]").forEach((b) => {
      b.onclick = () => {
        const n = Number(b.dataset.semana);
        estado.semana = n === 0 ? d.segunda(d.diaUtil(hoje)) : d.somar(estado.semana, n);
        render(el);
      };
    });
    el.querySelector("#ir-data").onchange = (e) => {
      if (!e.target.value) return;
      estado.semana = d.segunda(d.diaUtil(e.target.value));
      render(el);
    };
  }

  App.views.agenda = { titulo: "Agenda", render };
})(window.App);
