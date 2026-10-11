(function (App) {
  const { d, esc, q, ui } = App;
  const estado = { busca: "", status: "ativo", prof: "todas" };
  const ficha = { aba: "proximas" };

  function resumo(p) {
    const sessoes = q.sessoesPaciente(p.id);
    const futuras = sessoes.filter((s) => ["agendada", "confirmada"].includes(q.statusDe(s)));
    const passadas = sessoes.filter((s) => s.status === "realizada");
    const aberto = passadas.filter((s) => !s.pago).reduce((t, s) => t + s.valor, 0);
    return { sessoes, proxima: futuras[0], ultima: passadas[passadas.length - 1], aberto, futuras, passadas };
  }

  function lista(el) {
    const termo = App.semAcento(estado.busca.trim());
    const pacientes = App.db.pacientes
      .filter((p) => estado.status === "todos" || p.status === estado.status)
      .filter((p) => estado.prof === "todas" || p.profissionalId === estado.prof)
      .filter((p) => !termo || App.semAcento(`${p.nome} ${p.telefone} ${p.email}`).includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const contagem = { ativo: 0, inativo: 0 };
    App.db.pacientes.forEach((p) => contagem[p.status]++);

    const linhas = pacientes.map((p) => {
      const r = resumo(p);
      const idade = d.idade(p.nascimento);
      return `<tr class="link" data-href="#/pacientes/${p.id}">
        <td><a href="#/pacientes/${p.id}">${esc(p.nome)}</a><span class="sub">${idade ? `${idade} anos, ` : ""}${esc(p.modalidade)}</span></td>
        <td class="muted">${esc(q.prof(p.profissionalId)?.nome || "")}</td>
        <td>${r.proxima ? `${d.curta(r.proxima.data)} às ${d.hh(r.proxima.hora)}` : `<span class="muted">sem sessão marcada</span>`}</td>
        <td class="muted">${r.ultima ? d.curta(r.ultima.data) : ""}</td>
        <td class="num">${r.aberto ? `<span class="st st-aberto">${App.dinheiro(r.aberto)}</span>` : `<span class="muted">em dia</span>`}</td>
      </tr>`;
    }).join("");

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Pacientes</h1>
          <p class="lead">${App.plural(contagem.ativo, "paciente em acompanhamento", "pacientes em acompanhamento")}${contagem.inativo ? `, ${contagem.inativo} com acompanhamento encerrado` : ""}.</p>
        </div>
        <div class="tools">
          <button class="button" type="button" data-action="novo-paciente">Novo paciente</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div class="tabs" role="tablist">
            ${[["ativo", "Em acompanhamento"], ["inativo", "Encerrados"], ["todos", "Todos"]].map(([v, t]) => `<button class="tab${estado.status === v ? " on" : ""}" type="button" data-status="${v}">${t}</button>`).join("")}
          </div>
          <div class="tools">
            <select class="input compact" id="filtro-prof" aria-label="Profissional">${ui.opcoes([["todas", "Todas as profissionais"], ...App.db.profissionais.map((p) => [p.id, p.nome])], estado.prof)}</select>
            <label class="search"><input id="busca-pac" type="search" placeholder="Nome, telefone ou e-mail" aria-label="Procurar paciente" value="${esc(estado.busca)}"></label>
          </div>
        </div>
        <div class="table-wrap">
          ${pacientes.length ? `<table class="table">
            <thead><tr><th>Paciente</th><th>Profissional</th><th>Próxima sessão</th><th>Última sessão</th><th class="num">Pagamentos</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table>` : ui.vazio(termo ? `Nenhum paciente encontrado para “${esc(estado.busca.trim())}”.` : "Nenhum paciente nesta lista.", `<button class="button" type="button" data-action="novo-paciente">Cadastrar paciente</button>`)}
        </div>
      </section>`;

    el.querySelectorAll("[data-status]").forEach((b) => (b.onclick = () => { estado.status = b.dataset.status; lista(el); }));
    el.querySelector("#filtro-prof").onchange = (e) => { estado.prof = e.target.value; lista(el); };
    const busca = el.querySelector("#busca-pac");
    busca.oninput = () => {
      estado.busca = busca.value;
      lista(el);
      const novo = el.querySelector("#busca-pac");
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    };
  }

  function detalhe(el, id) {
    const p = q.paciente(id);
    if (!p) {
      el.innerHTML = ui.vazio("Paciente não encontrado.", `<a class="button" href="#/pacientes">Voltar para pacientes</a>`);
      return;
    }
    const r = resumo(p);
    const prof = q.prof(p.profissionalId);
    const idade = d.idade(p.nascimento);
    const historico = r.sessoes.filter((s) => !r.futuras.includes(s)).reverse();
    const lista = ficha.aba === "proximas" ? r.futuras : historico;
    const faltas = r.sessoes.filter((s) => s.status === "falta").length;

    const linhas = lista.map((s) => `
      <tr class="link" data-action="abrir-sessao" data-id="${s.id}">
        <td>${d.curta(s.data)}<span class="sub">${d.hh(s.hora)}</span></td>
        <td class="muted">${esc(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""))}, ${esc(s.modalidade)}</td>
        <td>${ui.status(s)}</td>
        <td class="num">${s.status === "realizada" ? (s.pago ? `<span class="st st-pago">pago</span>` : `<span class="st st-aberto">${App.dinheiro(s.valor)} em aberto</span>`) : `<span class="muted">${App.dinheiro(s.valor)}</span>`}</td>
      </tr>`).join("");

    el.innerHTML = `
      <a class="back" href="#/pacientes">Pacientes</a>
      <section class="heading">
        <div>
          <h1>${esc(p.nome)}</h1>
          <p class="lead">${idade ? `${idade} anos. ` : ""}${p.status === "ativo" ? "Em acompanhamento" : "Acompanhamento encerrado"}${prof ? ` com ${esc(App.primeiroNome(prof.nome))}` : ""} desde ${d.nomeMes(p.desde.slice(0, 7)).toLowerCase()}.</p>
        </div>
        <div class="tools">
          <a class="button ghost" href="#/prontuarios/${p.id}">Prontuário</a>
          ${p.status === "ativo" ? `<button class="button" type="button" data-action="nova-sessao" data-paciente="${p.id}">Agendar sessão</button>` : ""}
        </div>
      </section>

      <section class="numbers">
        <div class="number"><strong>${r.passadas.length}</strong><span>sessões realizadas</span></div>
        <div class="number"><strong>${faltas}</strong><span>${faltas === 1 ? "falta" : "faltas"}</span></div>
        <div class="number"><strong>${r.proxima ? d.hh(r.proxima.hora) : "—"}</strong><span>${r.proxima ? `próxima sessão, ${d.relativa(r.proxima.data)}` : "sem sessão marcada"}</span></div>
        <div class="number"><strong>${App.dinheiro(r.aberto).replace(",00", "")}</strong><span>em aberto</span></div>
      </section>

      <div class="content">
        <section class="panel">
          <div class="panel-head">
            <h2>Sessões</h2>
            <div class="tabs">
              <button class="tab${ficha.aba === "proximas" ? " on" : ""}" type="button" data-aba="proximas">Próximas (${r.futuras.length})</button>
              <button class="tab${ficha.aba === "historico" ? " on" : ""}" type="button" data-aba="historico">Histórico (${historico.length})</button>
            </div>
          </div>
          <div class="table-wrap">
            ${lista.length ? `<table class="table"><tbody>${linhas}</tbody></table>` : ui.vazio(ficha.aba === "proximas" ? "Nenhuma sessão marcada." : "Ainda não há histórico.", ficha.aba === "proximas" && p.status === "ativo" ? `<button class="button" type="button" data-action="nova-sessao" data-paciente="${p.id}">Agendar sessão</button>` : "")}
          </div>
        </section>

        <aside class="side">
          <section class="panel">
            <div class="panel-head"><h2>Dados</h2><button class="link-btn" type="button" data-action="editar-paciente" data-id="${p.id}">Editar</button></div>
            <div class="panel-body">
              <dl class="facts">
                <dt>Telefone</dt><dd>${p.telefone ? `${esc(p.telefone)}<br><a class="link-btn" target="_blank" rel="noopener" href="${App.actions.linkWhats(p, `Olá, ${App.primeiroNome(p.nome)}!`)}">Abrir no WhatsApp</a>` : "—"}</dd>
                <dt>E-mail</dt><dd>${p.email ? `<a class="link-btn plain" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : "—"}</dd>
                <dt>Nascimento</dt><dd>${p.nascimento ? d.numerica(p.nascimento) : "—"}</dd>
                <dt>Modalidade</dt><dd>${esc(p.modalidade)}</dd>
                <dt>Valor</dt><dd>${App.dinheiro(p.valor)} por sessão</dd>
                <dt>Motivo</dt><dd>${esc(p.queixa || "—")}</dd>
                ${p.observacoes ? `<dt>Observações</dt><dd class="pre">${esc(p.observacoes)}</dd>` : ""}
              </dl>
            </div>
          </section>
          <button class="link-btn${p.status === "ativo" ? " danger" : ""}" type="button" data-action="arquivar-paciente" data-id="${p.id}">
            ${p.status === "ativo" ? "Encerrar acompanhamento" : "Reativar acompanhamento"}
          </button>
        </aside>
      </div>`;

    el.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => { ficha.aba = b.dataset.aba; detalhe(el, id); }));
  }

  App.views.pacientes = {
    titulo: "Pacientes",
    render(el, id) {
      if (id) detalhe(el, id);
      else {
        ficha.aba = "proximas";
        lista(el);
      }
    }
  };
})(window.App);
