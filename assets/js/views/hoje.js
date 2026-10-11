(function (App) {
  const { d, esc, q, ui } = App;
  const estado = { dia: null, busca: "" };

  function pendencias() {
    const hoje = d.hoje();
    const amanha = d.diaUtil(d.somar(hoje, 1));
    const aConfirmar = q.proximas().filter((s) => s.status === "agendada" && (s.data === hoje || s.data === amanha));
    const aRegistrar = q.aRegistrar();
    const evolucoes = q.evolucoesPendentes();
    const abertas = q.emAberto();
    const totalAberto = abertas.reduce((t, s) => t + s.valor, 0);

    let html = aConfirmar.map((s) => `
      <button class="task" type="button" data-action="confirmar-sessao" data-id="${s.id}">
        <span class="box" aria-hidden="true"></span>
        <span>Confirmar ${esc(q.paciente(s.pacienteId)?.nome)}<p>${d.relativa(s.data)} às ${d.hh(s.hora)}, com ${esc(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""))}</p></span>
      </button>`).join("");

    if (aRegistrar.length) {
      const primeiras = aRegistrar.slice(0, 3);
      html += primeiras.map((s) => `
        <button class="task" type="button" data-action="abrir-sessao" data-id="${s.id}">
          <span class="dot" aria-hidden="true"></span>
          <span>Registrar presença de ${esc(q.paciente(s.pacienteId)?.nome)}<p>${d.relativa(s.data)} às ${d.hh(s.hora)}. Veio ou faltou?</p></span>
        </button>`).join("");
      if (aRegistrar.length > 3) html += `<a class="task" href="#/agenda"><span class="dot" aria-hidden="true"></span><span>Mais ${App.plural(aRegistrar.length - 3, "sessão sem registro", "sessões sem registro")}<p>Abrir a agenda</p></span></a>`;
    }

    if (evolucoes.length) {
      html += `<a class="task" href="#/prontuarios"><span class="dot" aria-hidden="true"></span>
        <span>${App.plural(evolucoes.length, "evolução para escrever", "evoluções para escrever")}<p>Sessões realizadas sem registro no prontuário</p></span></a>`;
    }

    if (abertas.length) {
      html += `<a class="task" href="#/financeiro"><span class="dot" aria-hidden="true"></span>
        <span>${App.plural(abertas.length, "pagamento em aberto", "pagamentos em aberto")}<p>${App.dinheiro(totalAberto)} a receber</p></span></a>`;
    }

    const total = aConfirmar.length + aRegistrar.length + (evolucoes.length ? 1 : 0) + (abertas.length ? 1 : 0);
    return { html: html || `<p class="muted small">Nada pendente. Tudo em dia.</p>`, total };
  }

  function proximaSessao() {
    const s = q.proximas().find((x) => x.data >= d.hoje());
    if (!s) {
      return `<p class="muted">Nenhuma sessão marcada daqui pra frente.</p>
        <button class="button light" type="button" data-action="nova-sessao">Agendar sessão</button>`;
    }
    const p = q.paciente(s.pacienteId);
    return `
      <div class="next-when">Próxima sessão, ${d.relativa(s.data)} às <b>${d.hh(s.hora)}</b></div>
      <h3>${esc(p?.nome)}</h3>
      <p>Com ${esc(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""))}, ${s.modalidade}, ${ui.ROTULO[q.statusDe(s)]}</p>
      <div class="next-actions">
        <a class="button light" href="#/prontuarios/${s.pacienteId}">Abrir prontuário</a>
        <button class="link-btn" type="button" data-action="abrir-sessao" data-id="${s.id}">Detalhes</button>
      </div>`;
  }

  function saudacao() {
    const h = new Date().getHours();
    const periodo = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    const nome = App.primeiroNome(q.profsAtivos()[0]?.nome || "Renata");
    const hoje = d.hoje();
    const deHoje = q.sessoesDia(hoje);
    const faltam = q.proximas().filter((s) => s.data === hoje);

    if (faltam.length) {
      return `${periodo}, ${esc(nome)}. Ainda há <strong>${App.plural(faltam.length, "sessão", "sessões")}</strong> hoje, a próxima às ${d.hh(faltam[0].hora)}.`;
    }
    if (deHoje.length) return `${periodo}, ${esc(nome)}. As sessões de hoje já terminaram.`;
    const proxima = q.proximas()[0];
    return proxima
      ? `${periodo}, ${esc(nome)}. Hoje não há sessões. A próxima é ${d.relativa(proxima.data)} às ${d.hh(proxima.hora)}.`
      : `${periodo}, ${esc(nome)}. Não há sessões marcadas.`;
  }

  function render(el) {
    const hoje = d.hoje();
    if (!estado.dia) estado.dia = d.diaUtil(hoje);
    const semana = d.semana(estado.dia);
    const mes = hoje.slice(0, 7);

    const ativosSemana = App.db.sessoes.filter((s) => semana.includes(s.data) && s.status !== "cancelada").length;
    const vagas = q.vagasSemana();
    const recebido = App.db.sessoes.filter((s) => s.pago && s.pagoEm?.startsWith(mes)).reduce((t, s) => t + s.valor, 0);
    const aReceber = q.emAberto().reduce((t, s) => t + s.valor, 0);
    const doDia = q.sessoesDia(estado.dia);
    const pend = pendencias();

    const colunas = q.profsAtivos().map((p) => {
      const sessoes = doDia.filter((s) => s.profissionalId === p.id);
      return { titulo: p.nome, sub: App.plural(sessoes.length, "sessão", "sessões"), data: estado.dia, profId: p.id, sessoes };
    });

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>${d.longa(hoje)}</h1>
          <p class="lead">${saudacao()}</p>
        </div>
        <div class="tools">
          <label class="search"><input id="busca-hoje" type="search" placeholder="Procurar paciente" aria-label="Procurar paciente na agenda" value="${esc(estado.busca)}"></label>
          <button class="button" type="button" data-action="nova-sessao" data-data="${estado.dia}">Agendar sessão</button>
        </div>
      </section>

      <section class="numbers" aria-label="Resumo">
        <div class="number"><strong>${q.sessoesDia(hoje).length}</strong><span>sessões hoje</span></div>
        <div class="number"><strong>${q.pacientesAtivos().length}</strong><span>pacientes em acompanhamento</span></div>
        <div class="number"><strong>${vagas ? Math.round((ativosSemana / vagas) * 100) : 0}%</strong><span>da semana ocupada, ${ativosSemana} de ${vagas} horários</span></div>
        <div class="number"><strong>${App.dinheiro(recebido).replace(",00", "")}</strong><span>recebidos em ${d.nomeMes(mes).split(" ")[0].toLowerCase()}, faltam ${App.dinheiro(aReceber).replace(",00", "")}</span></div>
      </section>

      <div class="content">
        <section class="agenda" aria-labelledby="agenda-titulo">
          <div class="agenda-header">
            <h2 id="agenda-titulo">${estado.dia === hoje ? "Hoje" : d.longa(estado.dia)}</h2>
            <div class="days" role="tablist" aria-label="Dias da semana">
              ${semana.map((iso) => {
                const ativo = iso === estado.dia;
                const nome = d.parse(iso).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
                return `<button class="day${ativo ? " selected" : ""}${iso === hoje ? " today" : ""}" role="tab" aria-selected="${ativo}" data-dia="${iso}">${nome}<b>${d.parse(iso).getDate()}</b></button>`;
              }).join("")}
            </div>
          </div>
          <div class="grid-wrap">${colunas.length ? ui.grade({ colunas, busca: estado.busca }) : ui.vazio("Nenhuma profissional ativa.", `<a class="button" href="#/profissionais">Ver profissionais</a>`)}</div>
          <div class="agenda-footer">${ui.legenda()}</div>
        </section>

        <aside class="side">
          <section class="next">${proximaSessao()}</section>
          <section class="todo">
            <h2>Pendências <small>${pend.total || ""}</small></h2>
            <div>${pend.html}</div>
          </section>
        </aside>
      </div>`;

    el.querySelectorAll("[data-dia]").forEach((b) => {
      b.onclick = () => {
        estado.dia = b.dataset.dia;
        render(el);
      };
    });

    const busca = el.querySelector("#busca-hoje");
    busca.oninput = () => {
      estado.busca = busca.value;
      const termo = App.semAcento(busca.value.trim());
      el.querySelectorAll(".session").forEach((b) => {
        b.classList.toggle("dim", !!termo && !App.semAcento(b.querySelector("strong").textContent).includes(termo));
      });
    };
  }

  App.views.hoje = { titulo: "Hoje", render };
})(window.App);
