(function (App) {
  const { d, esc, q, ui } = App;
  const estado = { mes: null, aba: "sessoes", filtro: "todas" };

  function render(el) {
    if (!estado.mes) estado.mes = d.hoje().slice(0, 7);
    const mes = estado.mes;

    const realizadas = q.ordenar(App.db.sessoes.filter((s) => s.status === "realizada" && s.data.startsWith(mes)));
    const recebido = App.db.sessoes.filter((s) => s.pago && s.pagoEm?.startsWith(mes)).reduce((t, s) => t + s.valor, 0);
    const aReceber = realizadas.filter((s) => !s.pago).reduce((t, s) => t + s.valor, 0);
    const despesas = App.db.despesas.filter((x) => x.data.startsWith(mes)).sort((a, b) => a.data.localeCompare(b.data));
    const totalDespesas = despesas.reduce((t, x) => t + x.valor, 0);

    const visiveis = realizadas.filter((s) => estado.filtro === "todas" || (estado.filtro === "aberto" ? !s.pago : s.pago)).reverse();

    const linhasSessoes = visiveis.map((s) => {
      const p = q.paciente(s.pacienteId);
      const lembrete = p?.telefone
        ? `<a class="link-btn" target="_blank" rel="noopener" href="${App.actions.linkWhats(p, `Olá, ${App.primeiroNome(p.nome)}! Tudo bem? Passando para lembrar do pagamento da sessão de ${d.numerica(s.data)}, no valor de ${App.dinheiro(s.valor)}. Obrigada!`)}">Lembrar</a>`
        : "";
      return `<tr>
        <td>${d.curta(s.data)}<span class="sub">${d.hh(s.hora)}</span></td>
        <td><a href="#/pacientes/${s.pacienteId}">${esc(p?.nome || "")}</a><span class="sub">${esc(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""))}</span></td>
        <td class="num">${App.dinheiro(s.valor)}</td>
        <td>${s.pago ? `<span class="st st-pago">pago em ${d.numerica(s.pagoEm).slice(0, 5)}</span><span class="sub">${esc(s.forma || "")}</span>` : `<span class="st st-aberto">em aberto</span>`}</td>
        <td class="num actions-cell">${s.pago
          ? `<button class="link-btn" type="button" data-action="desfazer-pagamento" data-id="${s.id}">Desfazer</button>`
          : `${lembrete}<button class="link-btn" type="button" data-action="registrar-pagamento" data-id="${s.id}">Registrar pagamento</button>`}</td>
      </tr>`;
    }).join("");

    const linhasDespesas = despesas.map((x) => `<tr>
        <td>${d.numerica(x.data).slice(0, 5)}</td>
        <td>${esc(x.descricao)}</td>
        <td class="num">${App.dinheiro(x.valor)}</td>
        <td>${x.pago ? `<span class="st st-pago">paga</span>` : `<span class="st st-aberto">a pagar</span>`}</td>
        <td class="num actions-cell">
          <button class="link-btn" type="button" data-action="alternar-despesa" data-id="${x.id}">${x.pago ? "Marcar a pagar" : "Marcar como paga"}</button>
          <button class="link-btn" type="button" data-action="nova-despesa" data-id="${x.id}">Editar</button>
          <button class="link-btn danger" type="button" data-action="apagar-despesa" data-id="${x.id}">Apagar</button>
        </td>
      </tr>`).join("");

    const ehMesAtual = mes === d.hoje().slice(0, 7);

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Financeiro</h1>
          <p class="lead">${d.nomeMes(mes)}${ehMesAtual ? ", mês atual" : ""}.</p>
        </div>
        <div class="tools">
          <div class="pager">
            <button class="link-btn" type="button" data-mes="-1">Mês anterior</button>
            <button class="link-btn" type="button" data-mes="0"${ehMesAtual ? " disabled" : ""}>Este mês</button>
            <button class="link-btn" type="button" data-mes="1">Próximo mês</button>
          </div>
          <button class="button" type="button" data-action="nova-despesa">Lançar despesa</button>
        </div>
      </section>

      <section class="numbers">
        <div class="number"><strong>${App.dinheiro(recebido)}</strong><span>recebido no mês</span></div>
        <div class="number"><strong>${App.dinheiro(aReceber)}</strong><span>a receber de sessões do mês</span></div>
        <div class="number"><strong>${App.dinheiro(totalDespesas)}</strong><span>em despesas</span></div>
        <div class="number"><strong>${App.dinheiro(recebido - totalDespesas)}</strong><span>saldo do mês</span></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div class="tabs">
            <button class="tab${estado.aba === "sessoes" ? " on" : ""}" type="button" data-aba="sessoes">Sessões (${realizadas.length})</button>
            <button class="tab${estado.aba === "despesas" ? " on" : ""}" type="button" data-aba="despesas">Despesas (${despesas.length})</button>
          </div>
          ${estado.aba === "sessoes" ? `<select class="input compact" id="filtro-pag" aria-label="Situação do pagamento">
            ${ui.opcoes([["todas", "Todas"], ["aberto", "Em aberto"], ["pagas", "Pagas"]], estado.filtro)}
          </select>` : ""}
        </div>
        <div class="table-wrap">
          ${estado.aba === "sessoes"
            ? (visiveis.length ? `<table class="table"><thead><tr><th>Data</th><th>Paciente</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${linhasSessoes}</tbody></table>` : ui.vazio("Nenhuma sessão realizada com esse filtro neste mês."))
            : (despesas.length ? `<table class="table"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${linhasDespesas}</tbody></table>` : ui.vazio("Nenhuma despesa lançada neste mês.", `<button class="button" type="button" data-action="nova-despesa">Lançar despesa</button>`))}
        </div>
      </section>`;

    el.querySelectorAll("[data-mes]").forEach((b) => (b.onclick = () => {
      const n = Number(b.dataset.mes);
      estado.mes = n === 0 ? d.hoje().slice(0, 7) : d.somarMes(estado.mes, n);
      render(el);
    }));
    el.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => { estado.aba = b.dataset.aba; render(el); }));
    const filtro = el.querySelector("#filtro-pag");
    if (filtro) filtro.onchange = () => { estado.filtro = filtro.value; render(el); };
  }

  App.views.financeiro = { titulo: "Financeiro", render };
})(window.App);
