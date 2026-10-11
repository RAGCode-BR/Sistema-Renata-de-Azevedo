// Peças de interface compartilhadas: janela, aviso, grade de horários e rótulos.
(function (App) {
  const { d, esc, q } = App;

  const ROTULO = {
    agendada: "a confirmar",
    confirmada: "confirmada",
    realizada: "realizada",
    falta: "faltou",
    cancelada: "cancelada",
    emsessao: "em sessão",
    aregistrar: "registrar presença"
  };

  let timerToast;

  const ui = {
    ROTULO,

    status(s) {
      const st = q.statusDe(s);
      return `<span class="st st-${st}">${ROTULO[st]}</span>`;
    },

    toast(mensagem, desfazer) {
      const el = document.getElementById("toast");
      el.innerHTML = `<span>${esc(mensagem)}</span>${desfazer ? `<button type="button">Desfazer</button>` : ""}`;
      if (desfazer) {
        el.querySelector("button").onclick = () => {
          desfazer();
          el.classList.remove("show");
        };
      }
      el.classList.add("show");
      clearTimeout(timerToast);
      timerToast = setTimeout(() => el.classList.remove("show"), desfazer ? 6000 : 3200);
    },

    // Abre a janela. `montar(el, fechar)` liga os eventos do conteúdo.
    modal({ titulo, corpo, rodape = "", largura, montar }) {
      const dialog = document.getElementById("modal");
      dialog.style.width = largura ? `min(${largura}px, calc(100vw - 32px))` : "";
      dialog.innerHTML = `
        <div class="modal-head">
          <h2>${titulo}</h2>
          <button class="modal-close" type="button" data-fechar>Fechar</button>
        </div>
        <div class="modal-body">${corpo}</div>
        ${rodape ? `<div class="modal-foot">${rodape}</div>` : ""}`;
      const fechar = () => dialog.close();
      dialog.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = fechar));
      if (!dialog.open) dialog.showModal();
      if (montar) montar(dialog, fechar);
      const foco = dialog.querySelector("[autofocus]");
      if (foco) foco.focus();
      return dialog;
    },

    confirmar({ titulo, texto, botao, perigo, aoConfirmar }) {
      ui.modal({
        titulo,
        corpo: `<p class="modal-text">${texto}</p>`,
        rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button>
                 <button class="button${perigo ? " danger" : ""}" type="button" data-ok>${botao}</button>`,
        montar(el, fechar) {
          el.querySelector("[data-ok]").onclick = () => {
            fechar();
            aoConfirmar();
          };
        }
      });
    },

    baixar(nome, conteudo, tipo) {
      const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
      const a = Object.assign(document.createElement("a"), { href: url, download: nome });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    dadosForm(form) {
      return Object.fromEntries(new FormData(form).entries());
    },

    opcoes(lista, selecionado) {
      return lista.map(([valor, texto]) => `<option value="${esc(valor)}"${String(valor) === String(selecionado) ? " selected" : ""}>${esc(texto)}</option>`).join("");
    },

    opcoesHora(selecionada) {
      return ui.opcoes(q.horas().map((h) => [`${d.pad(h)}:00`, `${h}h`]), selecionada);
    },

    opcoesProf(selecionado, incluirInativos) {
      const lista = incluirInativos ? App.db.profissionais : q.profsAtivos();
      return ui.opcoes(lista.map((p) => [p.id, p.nome]), selecionado);
    },

    vazio(texto, acao) {
      return `<div class="empty-state"><p>${texto}</p>${acao || ""}</div>`;
    },

    legenda() {
      return `
        <span class="key"><i class="b-realizada"></i>realizada</span>
        <span class="key"><i class="b-emsessao"></i>em sessão</span>
        <span class="key"><i class="b-confirmada"></i>confirmada</span>
        <span class="key"><i class="b-agendada"></i>a confirmar</span>
        <span class="key"><i class="b-aregistrar"></i>registrar presença</span>`;
    },

    // Grade de horários. Cada coluna: { titulo, sub, data, profId, sessoes }.
    grade({ colunas, busca = "", mostrarProf = false }) {
      const horas = q.horas();
      const { almoco, inicio, fim, duracao } = App.db.clinica;
      const termo = App.semAcento(busca.trim());
      const agora = new Date();
      const hoje = d.hoje();
      const horaAgora = agora.getHours() + agora.getMinutes() / 60;

      let html = `<div class="grid" style="--colunas:${colunas.length};--dur:${duracao}"><div class="col-head"></div>`;
      html += colunas.map((c) => `<div class="col-head"><strong>${esc(c.titulo)}</strong>${esc(c.sub || "")}</div>`).join("");

      for (let h = inicio; h <= fim; h++) {
        html += `<div class="hour">${h}h</div>`;
        if (h === almoco) {
          html += `<div class="lunch">Almoço</div>`;
          continue;
        }
        if (!horas.includes(h)) continue;
        colunas.forEach((c, i) => {
          const naHora = c.sessoes.filter((s) => d.hora(s.hora) === h);
          const marca = c.data === hoje && horaAgora >= h && horaAgora < h + 1
            ? `<div class="now-mark${i === 0 ? " first" : ""}" style="top:${((horaAgora - h) * 100).toFixed(1)}%"></div>`
            : "";
          if (!naHora.length) {
            html += `<div class="cell">${marca}<button class="free" type="button" data-action="nova-sessao" data-data="${c.data}" data-hora="${d.pad(h)}:00" data-prof="${c.profId || ""}">Agendar às ${h}h</button></div>`;
            return;
          }
          html += `<div class="cell">${marca}${naHora.map((s) => ui.bloco(s, termo, mostrarProf)).join("")}</div>`;
        });
      }
      return html + `</div>`;
    },

    bloco(s, termo, mostrarProf) {
      const st = q.statusDe(s);
      const paciente = q.paciente(s.pacienteId);
      const nome = paciente ? paciente.nome : "Paciente removido";
      const combina = !termo || App.semAcento(nome).includes(termo);
      const partes = [];
      if (mostrarProf) partes.push(App.primeiroNome(q.prof(s.profissionalId)?.nome || ""));
      partes.push(s.modalidade);
      if (!["confirmada", "realizada"].includes(st)) partes.push(ROTULO[st]);
      return `<button class="session b-${st}${combina ? "" : " dim"}" type="button" data-action="abrir-sessao" data-id="${s.id}" title="${esc(nome)}, ${d.hh(s.hora)}, ${ROTULO[st]}">
        <strong>${esc(nome)}</strong><span>${esc(partes.join(", "))}</span>
      </button>`;
    }
  };

  App.ui = ui;
})(window.App);
