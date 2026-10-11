(function (App) {
  const { d, esc, q, ui } = App;
  const estado = { busca: "" };

  function lista(el) {
    const pendentes = q.evolucoesPendentes();
    const termo = App.semAcento(estado.busca.trim());
    const pacientes = App.db.pacientes
      .filter((p) => p.status === "ativo" || App.db.evolucoes.some((e) => e.pacienteId === p.id))
      .filter((p) => !termo || App.semAcento(p.nome).includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const linhasPendentes = pendentes.map((s) => `
      <tr>
        <td>${esc(q.paciente(s.pacienteId)?.nome)}<span class="sub">${d.relativa(s.data)} às ${d.hh(s.hora)}</span></td>
        <td class="muted">${esc(q.prof(s.profissionalId)?.nome || "")}</td>
        <td class="num"><button class="link-btn" type="button" data-action="nova-evolucao" data-paciente="${s.pacienteId}" data-sessao="${s.id}">Escrever evolução</button></td>
      </tr>`).join("");

    const linhas = pacientes.map((p) => {
      const evs = App.db.evolucoes.filter((e) => e.pacienteId === p.id).sort((a, b) => b.data.localeCompare(a.data));
      const falta = pendentes.filter((s) => s.pacienteId === p.id).length;
      return `<tr class="link" data-href="#/prontuarios/${p.id}">
        <td><a href="#/prontuarios/${p.id}">${esc(p.nome)}</a>${p.status === "inativo" ? `<span class="sub">acompanhamento encerrado</span>` : ""}</td>
        <td class="muted">${esc(q.prof(p.profissionalId)?.nome || "")}</td>
        <td>${evs[0] ? d.curta(evs[0].data) : `<span class="muted">nenhuma ainda</span>`}</td>
        <td class="num">${evs.length}${falta ? ` <span class="st st-aberto">+${falta} a escrever</span>` : ""}</td>
      </tr>`;
    }).join("");

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Prontuários</h1>
          <p class="lead">${pendentes.length ? `${App.plural(pendentes.length, "sessão realizada ainda sem evolução", "sessões realizadas ainda sem evolução")} nos últimos 30 dias.` : "Todas as evoluções dos últimos 30 dias estão escritas."}</p>
        </div>
      </section>

      ${pendentes.length ? `
      <section class="panel spaced">
        <div class="panel-head"><h2>Evoluções para escrever</h2></div>
        <div class="table-wrap"><table class="table"><tbody>${linhasPendentes}</tbody></table></div>
      </section>` : ""}

      <section class="panel">
        <div class="panel-head">
          <h2>Pacientes</h2>
          <label class="search"><input id="busca-pront" type="search" placeholder="Procurar paciente" aria-label="Procurar paciente" value="${esc(estado.busca)}"></label>
        </div>
        <div class="table-wrap">
          ${pacientes.length ? `<table class="table">
            <thead><tr><th>Paciente</th><th>Profissional</th><th>Última evolução</th><th class="num">Evoluções</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table>` : ui.vazio("Nenhum prontuário encontrado.")}
        </div>
      </section>`;

    const busca = el.querySelector("#busca-pront");
    busca.oninput = () => {
      estado.busca = busca.value;
      lista(el);
      const novo = el.querySelector("#busca-pront");
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    };
  }

  function detalhe(el, id) {
    const p = q.paciente(id);
    if (!p) {
      el.innerHTML = ui.vazio("Paciente não encontrado.", `<a class="button" href="#/prontuarios">Voltar para prontuários</a>`);
      return;
    }
    const evolucoes = App.db.evolucoes.filter((e) => e.pacienteId === id).sort((a, b) => b.data.localeCompare(a.data));
    const pendentes = q.evolucoesPendentes().filter((s) => s.pacienteId === id);
    const idade = d.idade(p.nascimento);

    const entradas = evolucoes.map((e) => {
      const s = e.sessaoId ? q.sessao(e.sessaoId) : null;
      return `<article class="entry">
        <div class="entry-head">
          <span><strong>${d.longa(e.data)}</strong>${s ? `, sessão das ${d.hh(s.hora)} com ${esc(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""))}` : ", anotação avulsa"}</span>
          <span class="entry-actions">
            <button class="link-btn" type="button" data-action="nova-evolucao" data-id="${e.id}">Editar</button>
            <button class="link-btn danger" type="button" data-action="apagar-evolucao" data-id="${e.id}">Apagar</button>
          </span>
        </div>
        <p>${esc(e.texto)}</p>
      </article>`;
    }).join("");

    el.innerHTML = `
      <a class="back" href="#/prontuarios">Prontuários</a>
      <section class="heading">
        <div>
          <h1>${esc(p.nome)}</h1>
          <p class="lead">${idade ? `${idade} anos, ` : ""}${App.plural(evolucoes.length, "evolução registrada", "evoluções registradas")}. <a class="link-btn" href="#/pacientes/${p.id}">Ver ficha</a></p>
        </div>
        <div class="tools">
          <button class="button" type="button" data-action="nova-evolucao" data-paciente="${p.id}">Escrever evolução</button>
        </div>
      </section>

      <div class="content">
        <section class="panel">
          <div class="panel-head"><h2>Evoluções</h2></div>
          ${pendentes.length ? `<div class="notice-bar">
            ${App.plural(pendentes.length, "sessão sem evolução", "sessões sem evolução")}:
            ${pendentes.map((s) => `<button class="link-btn" type="button" data-action="nova-evolucao" data-paciente="${p.id}" data-sessao="${s.id}">${d.curta(s.data)}</button>`).join(", ")}
          </div>` : ""}
          ${entradas || ui.vazio("Nenhuma evolução escrita ainda.", `<button class="button" type="button" data-action="nova-evolucao" data-paciente="${p.id}">Escrever a primeira</button>`)}
        </section>

        <aside class="side">
          <form class="panel" id="form-anotacoes">
            <div class="panel-head"><h2>Sobre o caso</h2></div>
            <div class="panel-body stack">
              <label class="field"><span>Motivo da procura</span><textarea class="input" name="queixa" rows="3">${esc(p.queixa)}</textarea></label>
              <label class="field"><span>Anotações gerais</span><textarea class="input" name="observacoes" rows="6" placeholder="Histórico, medicação, combinados, contatos importantes.">${esc(p.observacoes)}</textarea></label>
              <div><button class="button light" type="submit">Salvar anotações</button></div>
            </div>
          </form>
        </aside>
      </div>`;

    el.querySelector("#form-anotacoes").onsubmit = (e) => {
      e.preventDefault();
      const f = ui.dadosForm(e.target);
      p.queixa = f.queixa.trim();
      p.observacoes = f.observacoes.trim();
      App.mudar("Anotações salvas.");
    };
  }

  App.views.prontuarios = {
    titulo: "Prontuários",
    render(el, id) {
      if (id) detalhe(el, id);
      else lista(el);
    }
  };
})(window.App);
