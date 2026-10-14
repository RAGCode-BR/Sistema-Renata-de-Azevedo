// Estrutura fixa da tela: trilho de módulos, submenu, busca, pendências, conta, botão de criar,
// dicas ao passar o mouse e o cartão de detalhes das sessões.
(function (App) {
  const { d, esc, q } = App;
  const $ = (id) => document.getElementById(id);
  const temMouse = window.matchMedia("(hover: hover) and (pointer: fine)");

  const MODULOS = [
    {
      id: "atendimento", titulo: "Atendimento", icone: "i-calendar",
      paginas: [
        { rota: "hoje", nome: "Hoje", conta: () => q.sessoesDia(d.hoje()).length },
        { rota: "agenda", nome: "Agenda", conta: () => q.aRegistrar().length, alerta: true }
      ]
    },
    {
      id: "pacientes", titulo: "Pacientes", icone: "i-users",
      paginas: [
        { rota: "pacientes", nome: "Pacientes", conta: () => q.pacientesAtivos().length },
        { rota: "prontuarios", nome: "Prontuários", conta: () => q.evolucoesPendentes().length, alerta: true }
      ]
    },
    {
      id: "equipe", titulo: "Equipe", icone: "i-team",
      paginas: [{ rota: "profissionais", nome: "Profissionais", conta: () => q.profsAtivos().length }]
    },
    {
      id: "financeiro", titulo: "Financeiro", icone: "i-wallet",
      paginas: [
        { rota: "financeiro", nome: "Financeiro", conta: () => q.emAberto().length, alerta: true },
        { rota: "relatorios", nome: "Relatórios" }
      ]
    },
    {
      id: "ajustes", titulo: "Ajustes", icone: "i-sliders", rodape: true,
      paginas: [{ rota: "configuracoes", nome: "Configurações" }, { rota: "ajuda", nome: "Ajuda" }]
    }
  ];

  const moduloDe = (rota) => MODULOS.find((m) => m.paginas.some((p) => p.rota === rota)) || MODULOS[0];

  function ler(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }

  function gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* preferência só desta visita */ }
  }

  /* Trilho e submenu */

  function linkModulo(m, ativo) {
    return `<a class="rail-link${ativo ? " active" : ""}" href="#/${m.paginas[0].rota}" data-tip="${m.titulo}" aria-label="${m.titulo}"${ativo ? ' aria-current="true"' : ""}>
      <svg class="icon"><use href="#${m.icone}"/></svg><span>${m.titulo}</span>
    </a>`;
  }

  function atualizar(rota) {
    const atual = moduloDe(rota);
    $("trilho").innerHTML =
      MODULOS.filter((m) => !m.rodape).map((m) => linkModulo(m, m === atual)).join("") +
      `<div class="rail-bottom">${MODULOS.filter((m) => m.rodape).map((m) => linkModulo(m, m === atual)).join("")}</div>`;

    const proxima = q.proximas()[0];
    $("subnav-inner").innerHTML = `
      <h2>${atual.titulo}</h2>
      <div class="subnav-list">
        ${atual.paginas.map((p) => {
          const n = p.conta ? p.conta() : 0;
          const ativo = p.rota === rota;
          return `<a class="sub-link${ativo ? " active" : ""}" href="#/${p.rota}"${ativo ? ' aria-current="page"' : ""}>
            ${p.nome}${n ? `<span class="sub-count${p.alerta ? " alerta" : ""}">${n}</span>` : ""}
          </a>`;
        }).join("")}
      </div>
      ${proxima ? `<div class="subnav-foot">Próxima sessão<strong>${esc(q.paciente(proxima.pacienteId)?.nome || "")}</strong>${d.relativa(proxima.data)} às ${d.hh(proxima.hora)}</div>` : ""}`;

    atualizarSino();
  }

  function alternarSubmenu(aberto) {
    $("app").classList.toggle("sem-submenu", !aberto);
    $("menu-toggle").setAttribute("aria-expanded", String(aberto));
    $("menu-toggle").setAttribute("aria-label", aberto ? "Recolher menu" : "Abrir menu");
    gravar("rda-submenu", aberto ? "aberto" : "fechado");
  }

  $("menu-toggle").onclick = () => alternarSubmenu($("app").classList.contains("sem-submenu"));
  if (ler("rda-submenu") === "fechado") alternarSubmenu(false);

  /* Menus flutuantes: um aberto por vez, fecham com Esc ou clique fora */

  let aberto = null;

  function abrir(pop, gatilho) {
    if (aberto && aberto.pop !== pop) fechar();
    pop.hidden = false;
    gatilho?.setAttribute("aria-expanded", "true");
    aberto = { pop, gatilho };
  }

  function fechar() {
    if (!aberto) return;
    aberto.pop.hidden = true;
    aberto.gatilho?.setAttribute("aria-expanded", "false");
    aberto = null;
  }

  function alternar(pop, gatilho) {
    if (aberto && aberto.pop === pop) fechar();
    else abrir(pop, gatilho);
  }

  document.addEventListener("click", (e) => {
    if (!aberto) return;
    if (aberto.pop.contains(e.target) && e.target.closest("a, button[data-action], [data-paciente-id]")) {
      fechar();
      return;
    }
    if (!aberto.pop.contains(e.target) && !aberto.gatilho?.contains(e.target)) fechar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aberto) {
      const gatilho = aberto.gatilho;
      fechar();
      gatilho?.focus();
    }
    if (e.key === "/" && !e.target.closest("input, textarea, select") && !$("modal").open) {
      e.preventDefault();
      abrirBusca();
    }
  });

  $("conta").onclick = () => alternar($("conta-menu"), $("conta"));
  $("criar").onclick = () => alternar($("criar-menu"), $("criar"));
  $("sino").onclick = () => {
    atualizarSino();
    alternar($("sino-menu"), $("sino"));
  };

  /* Pendências no sino */

  function pendencias() {
    const hoje = d.hoje();
    const amanha = d.diaUtil(d.somar(hoje, 1));
    const aberto = q.emAberto();
    return [
      { n: q.proximas().filter((s) => s.status === "agendada" && (s.data === hoje || s.data === amanha)).length, um: "sessão para confirmar", varios: "sessões para confirmar", rota: "hoje", icone: "i-check", urgente: true },
      { n: q.aRegistrar().length, um: "presença para registrar", varios: "presenças para registrar", rota: "agenda", icone: "i-calendar", urgente: true },
      { n: q.evolucoesPendentes().length, um: "evolução para escrever", varios: "evoluções para escrever", rota: "prontuarios", icone: "i-pen" },
      { n: aberto.length, um: "pagamento em aberto", varios: "pagamentos em aberto", rota: "financeiro", icone: "i-wallet", extra: App.dinheiro(aberto.reduce((t, s) => t + s.valor, 0)) }
    ].filter((p) => p.n);
  }

  function atualizarSino() {
    const lista = pendencias();
    // O número no sino conta só o que pede ação logo: confirmar e registrar presença.
    const total = lista.filter((p) => p.urgente).reduce((t, p) => t + p.n, 0);
    const badge = $("sino-total");
    badge.hidden = !total;
    badge.textContent = total > 99 ? "99+" : total;
    $("sino").setAttribute("aria-label", total ? `Pendências: ${total}` : "Pendências");
    $("sino-menu").innerHTML = `<div class="pop-title">Pendências</div>` + (lista.length
      ? lista.map((p) => `<a class="pop-item" href="#/${p.rota}"><svg class="icon"><use href="#${p.icone}"/></svg>
          <span>${App.plural(p.n, p.um, p.varios)}${p.extra ? `<small>${p.extra} a receber</small>` : ""}</span></a>`).join("")
      : `<p class="pop-empty">Nada pendente. Tudo em dia.</p>`);
  }

  /* Busca de pacientes */

  const busca = $("busca-global");
  const resultados = $("busca-resultados");
  let marcado = -1;

  function abrirBusca() {
    $("top-search").classList.add("open");
    busca.focus();
  }

  $("abrir-busca").onclick = abrirBusca;

  function buscar() {
    const termo = App.semAcento(busca.value.trim());
    if (!termo) {
      fecharBusca(false);
      return;
    }
    const achados = App.db.pacientes
      .filter((p) => App.semAcento(`${p.nome} ${p.telefone} ${p.email}`).includes(termo))
      .sort((a, b) => (a.status === b.status ? a.nome.localeCompare(b.nome) : a.status === "ativo" ? -1 : 1))
      .slice(0, 7);
    marcado = achados.length ? 0 : -1;
    resultados.innerHTML = achados.length
      ? achados.map((p, i) => {
          const prox = q.proximas().find((s) => s.pacienteId === p.id);
          const info = p.status === "inativo" ? "acompanhamento encerrado" : prox ? `próxima sessão ${d.relativa(prox.data)} às ${d.hh(prox.hora)}` : "sem sessão marcada";
          return `<a class="pop-item${i === 0 ? " on" : ""}" role="option" href="#/pacientes/${p.id}" data-paciente-id="${p.id}">
            <svg class="icon"><use href="#i-person"/></svg><span>${esc(p.nome)}<small>${info}</small></span></a>`;
        }).join("")
      : `<p class="pop-empty">Nenhum paciente com “${esc(busca.value.trim())}”.</p>`;
    abrir(resultados, null);
    busca.setAttribute("aria-expanded", "true");
  }

  function fecharBusca(limpar) {
    if (aberto?.pop === resultados) fechar();
    busca.setAttribute("aria-expanded", "false");
    if (limpar) {
      busca.value = "";
      $("top-search").classList.remove("open");
    }
  }

  busca.addEventListener("input", buscar);
  busca.addEventListener("focus", () => busca.value.trim() && buscar());
  busca.addEventListener("blur", () => setTimeout(() => {
    if (!resultados.contains(document.activeElement)) $("top-search").classList.remove("open");
  }, 150));

  busca.addEventListener("keydown", (e) => {
    const itens = [...resultados.querySelectorAll(".pop-item")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!itens.length) return;
      marcado = (marcado + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens.forEach((el, i) => el.classList.toggle("on", i === marcado));
    }
    if (e.key === "Enter" && itens[marcado]) {
      e.preventDefault();
      location.hash = itens[marcado].getAttribute("href");
      fecharBusca(true);
      busca.blur();
    }
    if (e.key === "Escape") {
      fecharBusca(true);
      busca.blur();
    }
  });

  resultados.addEventListener("click", () => fecharBusca(true));

  /* Dicas ao passar o mouse: espera na primeira, imediata nas seguintes */

  const tip = $("tip");
  let timerTip;
  let ultimaTip = 0;

  document.addEventListener("mouseover", (e) => {
    if (!temMouse.matches) return;
    const alvo = e.target.closest("[data-tip]");
    if (!alvo || alvo.contains(e.relatedTarget)) return;
    if (alvo.closest(".rail") && window.innerWidth <= 860) return;
    clearTimeout(timerTip);
    const imediata = Date.now() - ultimaTip < 500;
    timerTip = setTimeout(() => {
      const r = alvo.getBoundingClientRect();
      tip.textContent = alvo.dataset.tip;
      tip.classList.toggle("instant", imediata);
      if (alvo.closest(".rail")) {
        tip.style.left = `${r.right + 10}px`;
        tip.style.top = `${r.top + r.height / 2 - 15}px`;
      } else {
        tip.style.left = `${Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, window.innerWidth - tip.offsetWidth - 8)}px`;
        tip.style.top = `${r.bottom + 8}px`;
      }
      tip.classList.add("show");
    }, imediata ? 0 : 380);
  });

  document.addEventListener("mouseout", (e) => {
    const alvo = e.target.closest("[data-tip]");
    if (!alvo || alvo.contains(e.relatedTarget)) return;
    clearTimeout(timerTip);
    if (tip.classList.contains("show")) ultimaTip = Date.now();
    tip.classList.remove("show");
  });

  /* Cartão de detalhes de uma sessão da grade */

  const peek = $("peek");
  let timerPeek;
  let ultimoPeek = 0;

  function mostrarPeek(bloco) {
    const s = q.sessao(bloco.dataset.id);
    if (!s) return;
    const p = q.paciente(s.pacienteId);
    const st = q.statusDe(s);
    const pagamento = s.status === "realizada" ? (s.pago ? `pago, ${esc(s.forma || "")}` : "em aberto") : "";
    peek.innerHTML = `
      <div class="peek-when">${d.relativa(s.data)}, ${d.hh(s.hora)} às ${d.hh(d.fim(s.hora, App.db.clinica.duracao))}</div>
      <h3>${esc(p?.nome || "Paciente removido")}</h3>
      <dl>
        <dt>Situação</dt><dd><span class="st st-${st}">${App.ui.ROTULO[st]}</span></dd>
        <dt>Profissional</dt><dd>${esc(q.prof(s.profissionalId)?.nome || "")}</dd>
        <dt>Modalidade</dt><dd>${esc(s.modalidade)}</dd>
        <dt>Valor</dt><dd>${App.dinheiro(s.valor)}${pagamento ? `, ${pagamento}` : ""}</dd>
        ${p?.telefone ? `<dt>Telefone</dt><dd>${esc(p.telefone)}</dd>` : ""}
      </dl>
      <p class="peek-hint">Clique para confirmar, remarcar ou registrar.</p>`;

    const r = bloco.getBoundingClientRect();
    const largura = 284;
    const cabeDireita = r.right + 12 + largura < window.innerWidth;
    const x = cabeDireita ? r.right + 12 : r.left - 12 - largura;
    const y = Math.max(76, Math.min(r.top - 8, window.innerHeight - peek.offsetHeight - 16));
    peek.style.left = `${Math.max(8, x)}px`;
    peek.style.top = `${y}px`;
    peek.style.setProperty("--origem", cabeDireita ? "left top" : "right top");
    peek.classList.toggle("instant", Date.now() - ultimoPeek < 450);
    peek.classList.add("show");
  }

  function esconderPeek() {
    clearTimeout(timerPeek);
    if (peek.classList.contains("show")) ultimoPeek = Date.now();
    peek.classList.remove("show");
  }

  document.addEventListener("mouseover", (e) => {
    if (!temMouse.matches) return;
    const bloco = e.target.closest(".session");
    if (!bloco || bloco.contains(e.relatedTarget)) return;
    clearTimeout(timerPeek);
    const rapido = Date.now() - ultimoPeek < 450;
    timerPeek = setTimeout(() => mostrarPeek(bloco), rapido ? 0 : 320);
  });

  document.addEventListener("mouseout", (e) => {
    const bloco = e.target.closest(".session");
    if (bloco && !bloco.contains(e.relatedTarget)) esconderPeek();
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".session")) esconderPeek();
  }, true);
  window.addEventListener("scroll", esconderPeek, { passive: true });

  window.addEventListener("hashchange", () => {
    fechar();
    esconderPeek();
    tip.classList.remove("show");
  });

  App.shell = { atualizar, fechar };
})(window.App);
