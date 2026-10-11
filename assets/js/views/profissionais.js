(function (App) {
  const { d, esc, q, ui } = App;

  function render(el) {
    const semana = d.semana(d.diaUtil(d.hoje()));
    const vagasPorProf = q.horas().length * 5;

    const linhas = App.db.profissionais.map((p) => {
      const pacientes = App.db.pacientes.filter((x) => x.profissionalId === p.id && x.status === "ativo").length;
      const naSemana = App.db.sessoes.filter((s) => s.profissionalId === p.id && semana.includes(s.data) && s.status !== "cancelada").length;
      return `<tr>
        <td>${esc(p.nome)}<span class="sub">${esc(p.especialidade || "")}</span></td>
        <td class="muted">${esc(p.registro || "—")}</td>
        <td>${p.email ? `<a class="link-btn plain" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : "—"}<span class="sub">${esc(p.telefone || "")}</span></td>
        <td class="num">${pacientes}</td>
        <td class="num">${p.ativo ? `${naSemana} <span class="muted">de ${vagasPorProf}</span>` : `<span class="muted">fora da agenda</span>`}</td>
        <td class="num"><button class="link-btn" type="button" data-action="editar-profissional" data-id="${p.id}">Editar</button></td>
      </tr>`;
    }).join("");

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Profissionais</h1>
          <p class="lead">${App.plural(q.profsAtivos().length, "profissional atendendo", "profissionais atendendo")} na clínica.</p>
        </div>
        <div class="tools"><button class="button" type="button" data-action="novo-profissional">Adicionar profissional</button></div>
      </section>

      <section class="panel">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nome</th><th>Registro</th><th>Contato</th><th class="num">Pacientes</th><th class="num">Sessões nesta semana</th><th></th></tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>
      </section>`;
  }

  App.views.profissionais = { titulo: "Profissionais", render };
})(window.App);
