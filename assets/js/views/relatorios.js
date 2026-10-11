(function (App) {
  const { d, esc, q, ui } = App;

  function meses(n) {
    const atual = d.hoje().slice(0, 7);
    return Array.from({ length: n }, (_, i) => d.somarMes(atual, i - n + 1));
  }

  function dadosMes(mes) {
    const doMes = App.db.sessoes.filter((s) => s.data.startsWith(mes) && s.data <= d.hoje());
    const realizadas = doMes.filter((s) => s.status === "realizada").length;
    const faltas = doMes.filter((s) => s.status === "falta").length;
    const canceladas = doMes.filter((s) => s.status === "cancelada").length;
    const recebido = App.db.sessoes.filter((s) => s.pago && s.pagoEm?.startsWith(mes)).reduce((t, s) => t + s.valor, 0);
    const despesas = App.db.despesas.filter((x) => x.data.startsWith(mes)).reduce((t, x) => t + x.valor, 0);
    const novos = App.db.pacientes.filter((p) => p.desde?.startsWith(mes)).length;
    const taxaFaltas = realizadas + faltas ? Math.round((faltas / (realizadas + faltas)) * 100) : 0;
    return { mes, realizadas, faltas, canceladas, recebido, despesas, novos, taxaFaltas };
  }

  function render(el) {
    const linhas = meses(6).map(dadosMes);
    const maior = Math.max(...linhas.map((l) => Math.max(l.recebido, l.despesas)), 1);
    const atual = linhas[linhas.length - 1];

    const porProf = App.db.profissionais.map((p) => {
      const doMes = App.db.sessoes.filter((s) => s.profissionalId === p.id && s.data.startsWith(atual.mes) && s.data <= d.hoje());
      return {
        nome: p.nome,
        realizadas: doMes.filter((s) => s.status === "realizada").length,
        faltas: doMes.filter((s) => s.status === "falta").length,
        recebido: doMes.filter((s) => s.pago).reduce((t, s) => t + s.valor, 0),
        pacientes: App.db.pacientes.filter((x) => x.profissionalId === p.id && x.status === "ativo").length
      };
    });

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Relatórios</h1>
          <p class="lead">Últimos seis meses, até hoje.</p>
        </div>
        <div class="tools"><button class="button ghost" type="button" id="exportar-csv">Baixar planilha (CSV)</button></div>
      </section>

      <section class="panel spaced">
        <div class="panel-head"><h2>Mês a mês</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Mês</th><th class="num">Realizadas</th><th class="num">Faltas</th><th class="num">Canceladas</th><th class="num">Novos pacientes</th><th>Recebido e despesas</th></tr></thead>
            <tbody>
              ${linhas.map((l) => `<tr>
                <td>${d.nomeMes(l.mes)}</td>
                <td class="num">${l.realizadas}</td>
                <td class="num">${l.faltas} <span class="muted">(${l.taxaFaltas}%)</span></td>
                <td class="num">${l.canceladas}</td>
                <td class="num">${l.novos}</td>
                <td class="bars-cell">
                  <div class="bar-row"><span class="bar in" style="width:${(l.recebido / maior) * 100}%"></span><span>${App.dinheiro(l.recebido)}</span></div>
                  <div class="bar-row"><span class="bar out" style="width:${(l.despesas / maior) * 100}%"></span><span class="muted">${App.dinheiro(l.despesas)}</span></div>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="agenda-footer">
          <span class="key"><i class="bar-key in"></i>recebido</span>
          <span class="key"><i class="bar-key out"></i>despesas</span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Por profissional em ${d.nomeMes(atual.mes).split(" ")[0].toLowerCase()}</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Profissional</th><th class="num">Pacientes ativos</th><th class="num">Realizadas</th><th class="num">Faltas</th><th class="num">Recebido</th></tr></thead>
            <tbody>${porProf.map((p) => `<tr>
              <td>${esc(p.nome)}</td><td class="num">${p.pacientes}</td><td class="num">${p.realizadas}</td><td class="num">${p.faltas}</td><td class="num">${App.dinheiro(p.recebido)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>`;

    el.querySelector("#exportar-csv").onclick = () => {
      const cabecalho = ["Mês", "Realizadas", "Faltas", "Canceladas", "Novos pacientes", "Recebido", "Despesas"];
      const csv = [cabecalho, ...linhas.map((l) => [l.mes, l.realizadas, l.faltas, l.canceladas, l.novos, l.recebido.toFixed(2).replace(".", ","), l.despesas.toFixed(2).replace(".", ",")])]
        .map((r) => r.join(";")).join("\n");
      ui.baixar(`relatorio-${atual.mes}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    };
  }

  App.views.relatorios = { titulo: "Relatórios", render };
})(window.App);
