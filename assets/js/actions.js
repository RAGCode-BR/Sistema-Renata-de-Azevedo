// Ações disparadas por qualquer elemento com data-action="nome".
(function (App) {
  const { d, esc, q, ui } = App;
  const A = App.actions;

  function mudar(mensagem, desfazer) {
    App.store.salvar();
    App.refresh();
    if (mensagem) ui.toast(mensagem, desfazer);
  }

  // Guarda uma cópia da sessão para permitir "Desfazer".
  function comDesfazer(s, alterar, mensagem) {
    const antes = { ...s };
    alterar(s);
    mudar(mensagem, () => {
      Object.assign(s, antes);
      mudar();
    });
  }

  /* Sessões */

  A["abrir-sessao"] = ({ id }) => {
    const s = q.sessao(id);
    if (!s) return;
    const p = q.paciente(s.pacienteId);
    const prof = q.prof(s.profissionalId);
    const st = q.statusDe(s);
    const evolucao = q.evolucaoDaSessao(s.id);
    const futura = ["agendada", "confirmada"].includes(st);

    const pagamento = s.status !== "realizada"
      ? App.dinheiro(s.valor)
      : s.pago
        ? `${App.dinheiro(s.valor)}, <span class="st st-pago">pago em ${d.numerica(s.pagoEm)} (${esc(s.forma)})</span>`
        : `${App.dinheiro(s.valor)}, <span class="st st-aberto">em aberto</span>`;

    const botoes = [];
    if (st === "agendada") botoes.push(`<button class="button" type="button" data-op="confirmar">Confirmar</button>`);
    if (st === "emsessao" || st === "aregistrar") {
      botoes.push(`<button class="button" type="button" data-op="realizada">Marcar como realizada</button>`);
      botoes.push(`<button class="button ghost" type="button" data-op="falta">Faltou</button>`);
    }
    if (st === "realizada") {
      botoes.push(evolucao
        ? `<a class="button ghost" href="#/prontuarios/${s.pacienteId}" data-fechar>Ver evolução</a>`
        : `<button class="button" type="button" data-op="evolucao">Escrever evolução</button>`);
      if (!s.pago) botoes.push(`<button class="button ghost" type="button" data-op="pagar">Registrar pagamento</button>`);
    }
    if (futura || st === "cancelada" || st === "aregistrar") botoes.push(`<button class="button ghost" type="button" data-op="remarcar">${st === "cancelada" ? "Reagendar" : "Remarcar"}</button>`);

    const secundarios = [];
    if (futura && p?.telefone) secundarios.push(`<a class="link-btn" target="_blank" rel="noopener" href="${linkWhats(p, `Olá, ${App.primeiroNome(p.nome)}! Passando para lembrar da sua sessão ${d.relativa(s.data)} às ${d.hh(s.hora)}. Posso confirmar?`)}">Lembrar pelo WhatsApp</a>`);
    if (futura || st === "aregistrar") secundarios.push(`<button class="link-btn danger" type="button" data-op="cancelar">Cancelar sessão</button>`);
    if (["realizada", "falta"].includes(st)) secundarios.push(`<button class="link-btn" type="button" data-op="reabrir">Desfazer registro</button>`);

    ui.modal({
      titulo: esc(p?.nome || "Sessão"),
      corpo: `
        <p class="modal-lead">${d.longa(s.data)}, das ${d.hh(s.hora)} às ${d.hh(d.fim(s.hora, App.db.clinica.duracao))}</p>
        <dl class="facts">
          <dt>Situação</dt><dd>${ui.status(s)}</dd>
          <dt>Profissional</dt><dd>${esc(prof?.nome || "")}</dd>
          <dt>Modalidade</dt><dd>${esc(s.modalidade)}</dd>
          <dt>Valor</dt><dd>${pagamento}</dd>
        </dl>
        <p class="modal-links">
          <a class="link-btn" href="#/pacientes/${s.pacienteId}" data-fechar>Ficha do paciente</a>
          <a class="link-btn" href="#/prontuarios/${s.pacienteId}" data-fechar>Prontuário</a>
          ${secundarios.join("")}
        </p>`,
      rodape: botoes.join(""),
      montar(el, fechar) {
        el.querySelectorAll("[data-fechar]").forEach((a) => a.addEventListener("click", fechar));
        el.querySelectorAll("[data-op]").forEach((b) => {
          b.onclick = () => {
            const op = b.dataset.op;
            const nome = App.primeiroNome(p?.nome || "");
            if (op === "remarcar") return A["remarcar-sessao"]({ id });
            if (op === "evolucao") return A["nova-evolucao"]({ paciente: s.pacienteId, sessao: s.id });
            if (op === "pagar") return A["registrar-pagamento"]({ id });
            fechar();
            if (op === "confirmar") comDesfazer(s, (x) => (x.status = "confirmada"), `Sessão de ${nome} confirmada.`);
            if (op === "realizada") comDesfazer(s, (x) => (x.status = "realizada"), `Sessão de ${nome} registrada como realizada.`);
            if (op === "falta") comDesfazer(s, (x) => (x.status = "falta"), `Falta de ${nome} registrada.`);
            if (op === "cancelar") comDesfazer(s, (x) => (x.status = "cancelada"), `Sessão de ${nome} cancelada.`);
            if (op === "reabrir") comDesfazer(s, (x) => { x.status = "confirmada"; x.pago = false; x.pagoEm = null; x.forma = null; }, "Registro desfeito.");
          };
        });
      }
    });
  };

  A["confirmar-sessao"] = ({ id }) => {
    const s = q.sessao(id);
    if (!s) return;
    comDesfazer(s, (x) => (x.status = "confirmada"), `Sessão de ${App.primeiroNome(q.paciente(s.pacienteId)?.nome || "")} confirmada.`);
  };

  A["nova-sessao"] = (dados = {}) => {
    const pacientes = q.pacientesAtivos();
    if (!pacientes.length) {
      ui.confirmar({
        titulo: "Nenhum paciente ativo",
        texto: "Para agendar uma sessão, cadastre o paciente primeiro.",
        botao: "Cadastrar paciente",
        aoConfirmar: () => A["novo-paciente"]()
      });
      return;
    }
    const pacienteInicial = q.paciente(dados.paciente) || null;
    const profInicial = dados.prof || pacienteInicial?.profissionalId || q.profsAtivos()[0]?.id;
    const dataInicial = dados.data || d.diaUtil(d.hoje());
    const horaInicial = dados.hora || `${d.pad(q.horas()[0])}:00`;

    ui.modal({
      titulo: "Agendar sessão",
      corpo: `
        <form id="form-sessao" class="form-grid" novalidate>
          <label class="field full"><span>Paciente</span>
            <select class="input" name="pacienteId" required autofocus>
              <option value="">Escolha o paciente</option>
              ${ui.opcoes(pacientes.map((p) => [p.id, p.nome]), pacienteInicial?.id)}
            </select>
          </label>
          <label class="field"><span>Profissional</span><select class="input" name="profissionalId">${ui.opcoesProf(profInicial)}</select></label>
          <label class="field"><span>Modalidade</span><select class="input" name="modalidade">${ui.opcoes([["presencial", "Presencial"], ["on-line", "On-line"]], pacienteInicial?.modalidade || "presencial")}</select></label>
          <label class="field"><span>Data</span><input class="input" type="date" name="data" value="${dataInicial}" required></label>
          <label class="field"><span>Horário</span><select class="input" name="hora">${ui.opcoesHora(horaInicial)}</select></label>
          <label class="field"><span>Valor da sessão</span><input class="input" type="number" name="valor" min="0" step="10" value="${pacienteInicial?.valor || App.db.clinica.valorPadrao}"></label>
          <label class="field"><span>Repetir toda semana</span><select class="input" name="repetir">${ui.opcoes([["1", "Não repetir"], ["4", "Por 4 semanas"], ["8", "Por 8 semanas"], ["12", "Por 12 semanas"]], "1")}</select></label>
          <label class="check full"><input type="checkbox" name="confirmada"> Paciente já confirmou</label>
          <p class="erro full" id="erro-sessao" hidden></p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-sessao">Agendar</button>`,
      montar(el, fechar) {
        const form = el.querySelector("form");
        form.pacienteId.onchange = () => {
          const p = q.paciente(form.pacienteId.value);
          if (!p) return;
          if (p.profissionalId && q.prof(p.profissionalId)?.ativo && !dados.prof) form.profissionalId.value = p.profissionalId;
          form.modalidade.value = p.modalidade;
          form.valor.value = p.valor;
        };
        form.onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(form);
          const erro = el.querySelector("#erro-sessao");
          if (!f.pacienteId || !f.data) {
            erro.textContent = "Escolha o paciente e a data.";
            erro.hidden = false;
            return;
          }
          const criadas = [];
          const puladas = [];
          for (let i = 0; i < Number(f.repetir); i++) {
            const s = {
              id: App.uid() + i,
              pacienteId: f.pacienteId,
              profissionalId: f.profissionalId,
              data: d.somar(f.data, i * 7),
              hora: f.hora,
              modalidade: f.modalidade,
              valor: Number(f.valor) || 0,
              status: i === 0 && f.confirmada ? "confirmada" : "agendada",
              pago: false,
              pagoEm: null,
              forma: null
            };
            if (q.conflito(s)) puladas.push(s.data);
            else criadas.push(s);
          }
          if (!criadas.length) {
            erro.textContent = `${q.prof(f.profissionalId).nome} já tem sessão ${d.relativa(f.data)} às ${d.hh(f.hora)}. Escolha outro horário.`;
            erro.hidden = false;
            return;
          }
          App.db.sessoes.push(...criadas);
          fechar();
          const nome = App.primeiroNome(q.paciente(f.pacienteId).nome);
          const msg = criadas.length === 1
            ? `Sessão de ${nome} agendada para ${d.relativa(f.data)} às ${d.hh(f.hora)}.`
            : `${criadas.length} sessões de ${nome} agendadas.`;
          mudar(puladas.length ? `${msg} ${App.plural(puladas.length, "data já estava ocupada", "datas já estavam ocupadas")}.` : msg, () => {
            App.db.sessoes = App.db.sessoes.filter((s) => !criadas.includes(s));
            mudar();
          });
        };
      }
    });
  };

  A["remarcar-sessao"] = ({ id }) => {
    const s = q.sessao(id);
    const p = q.paciente(s.pacienteId);
    ui.modal({
      titulo: `Remarcar ${esc(App.primeiroNome(p?.nome || ""))}`,
      corpo: `
        <form id="form-remarcar" class="form-grid" novalidate>
          <label class="field"><span>Data</span><input class="input" type="date" name="data" value="${s.data}" required autofocus></label>
          <label class="field"><span>Horário</span><select class="input" name="hora">${ui.opcoesHora(s.hora)}</select></label>
          <label class="field"><span>Profissional</span><select class="input" name="profissionalId">${ui.opcoesProf(s.profissionalId)}</select></label>
          <label class="field"><span>Modalidade</span><select class="input" name="modalidade">${ui.opcoes([["presencial", "Presencial"], ["on-line", "On-line"]], s.modalidade)}</select></label>
          <p class="erro full" id="erro-remarcar" hidden></p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-remarcar">Salvar novo horário</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          const novo = { ...s, ...f, status: "agendada" };
          if (q.conflito(novo)) {
            const erro = el.querySelector("#erro-remarcar");
            erro.textContent = `${q.prof(f.profissionalId).nome} já tem sessão nesse horário.`;
            erro.hidden = false;
            return;
          }
          fechar();
          comDesfazer(s, (x) => Object.assign(x, f, { status: "agendada" }), `Sessão remarcada para ${d.relativa(f.data)} às ${d.hh(f.hora)}.`);
        };
      }
    });
  };

  A["registrar-pagamento"] = ({ id }) => {
    const s = q.sessao(id);
    const p = q.paciente(s.pacienteId);
    ui.modal({
      titulo: "Registrar pagamento",
      corpo: `
        <p class="modal-lead">${esc(p?.nome || "")}, sessão de ${d.curta(s.data)}</p>
        <form id="form-pagamento" class="form-grid" novalidate>
          <label class="field"><span>Valor recebido</span><input class="input" type="number" name="valor" min="0" step="10" value="${s.valor}" autofocus></label>
          <label class="field"><span>Forma</span><select class="input" name="forma">${ui.opcoes(["Pix", "Cartão", "Transferência", "Dinheiro"].map((f) => [f, f]), "Pix")}</select></label>
          <label class="field"><span>Data do pagamento</span><input class="input" type="date" name="pagoEm" value="${d.hoje()}"></label>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-pagamento">Registrar</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          fechar();
          comDesfazer(s, (x) => Object.assign(x, { pago: true, valor: Number(f.valor) || 0, forma: f.forma, pagoEm: f.pagoEm || d.hoje() }), `Pagamento de ${App.primeiroNome(p?.nome || "")} registrado.`);
        };
      }
    });
  };

  A["desfazer-pagamento"] = ({ id }) => {
    const s = q.sessao(id);
    comDesfazer(s, (x) => Object.assign(x, { pago: false, pagoEm: null, forma: null }), "Pagamento marcado como em aberto.");
  };

  function linkWhats(p, texto) {
    const numero = String(p.telefone || "").replace(/\D/g, "");
    return `https://wa.me/55${numero}?text=${encodeURIComponent(texto)}`;
  }
  A.linkWhats = linkWhats;

  /* Evoluções */

  A["nova-evolucao"] = ({ paciente, sessao, id }) => {
    const evolucao = id ? App.db.evolucoes.find((e) => e.id === id) : null;
    const pacienteId = evolucao?.pacienteId || paciente;
    const p = q.paciente(pacienteId);
    const comEvolucao = new Set(App.db.evolucoes.map((e) => e.sessaoId));
    const sessoes = q.sessoesPaciente(pacienteId)
      .filter((s) => s.status === "realizada" && (!comEvolucao.has(s.id) || s.id === evolucao?.sessaoId))
      .reverse();
    const sessaoInicial = evolucao ? evolucao.sessaoId || "" : sessao || sessoes[0]?.id || "";

    ui.modal({
      titulo: evolucao ? "Editar evolução" : "Escrever evolução",
      largura: 640,
      corpo: `
        <p class="modal-lead">${esc(p?.nome || "")}</p>
        <form id="form-evolucao" class="form-grid" novalidate>
          <label class="field full"><span>Sessão</span>
            <select class="input" name="sessaoId">
              ${ui.opcoes(sessoes.map((s) => [s.id, `${d.curta(s.data)} às ${d.hh(s.hora)}`]), sessaoInicial)}
              <option value=""${sessaoInicial === "" ? " selected" : ""}>Sem sessão (anotação avulsa)</option>
            </select>
          </label>
          <label class="field full"><span>Evolução</span>
            <textarea class="input" name="texto" rows="9" required autofocus placeholder="Como foi a sessão, temas trabalhados, combinados para a próxima.">${esc(evolucao?.texto || "")}</textarea>
          </label>
          <p class="erro full" id="erro-evolucao" hidden>Escreva a evolução antes de salvar.</p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-evolucao">Salvar evolução</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          if (!f.texto.trim()) {
            el.querySelector("#erro-evolucao").hidden = false;
            return;
          }
          const data = f.sessaoId ? q.sessao(f.sessaoId).data : evolucao?.data || d.hoje();
          if (evolucao) Object.assign(evolucao, { sessaoId: f.sessaoId || null, texto: f.texto.trim(), data });
          else App.db.evolucoes.push({ id: App.uid(), pacienteId, sessaoId: f.sessaoId || null, data, texto: f.texto.trim() });
          fechar();
          mudar("Evolução salva.");
        };
      }
    });
  };

  // Pelo botão de criar: escolhe o paciente e abre a evolução, sugerindo quem tem sessão sem evolução.
  A["escolher-evolucao"] = () => {
    const pendente = q.evolucoesPendentes().reverse()[0];
    const pacientes = q.pacientesAtivos();
    if (!pacientes.length) return ui.toast("Cadastre um paciente primeiro.");
    ui.modal({
      titulo: "Escrever evolução",
      corpo: `
        <form id="form-escolher" class="form-grid" novalidate>
          <label class="field full"><span>Paciente</span>
            <select class="input" name="paciente" autofocus>${ui.opcoes(pacientes.map((p) => [p.id, p.nome]), pendente?.pacienteId)}</select>
          </label>
          ${pendente ? `<p class="full muted small">${App.plural(q.evolucoesPendentes().length, "sessão realizada está", "sessões realizadas estão")} sem evolução. A mais recente já vem escolhida.</p>` : ""}
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-escolher">Continuar</button>`,
      montar(el) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const paciente = e.target.paciente.value;
          const sessao = q.evolucoesPendentes().reverse().find((s) => s.pacienteId === paciente);
          A["nova-evolucao"]({ paciente, sessao: sessao?.id });
        };
      }
    });
  };

  A["apagar-evolucao"] = ({ id }) => {
    ui.confirmar({
      titulo: "Apagar evolução?",
      texto: "O texto desta evolução será removido do prontuário.",
      botao: "Apagar",
      perigo: true,
      aoConfirmar() {
        const i = App.db.evolucoes.findIndex((e) => e.id === id);
        const [removida] = App.db.evolucoes.splice(i, 1);
        mudar("Evolução apagada.", () => {
          App.db.evolucoes.splice(i, 0, removida);
          mudar();
        });
      }
    });
  };

  /* Pacientes */

  A["novo-paciente"] = () => formPaciente();
  A["editar-paciente"] = ({ id }) => formPaciente(q.paciente(id));

  function formPaciente(p) {
    const novo = !p;
    p = p || { nome: "", telefone: "", email: "", nascimento: "", profissionalId: q.profsAtivos()[0]?.id, modalidade: "presencial", valor: App.db.clinica.valorPadrao, queixa: "", observacoes: "" };
    ui.modal({
      titulo: novo ? "Novo paciente" : "Editar dados",
      largura: 620,
      corpo: `
        <form id="form-paciente" class="form-grid" novalidate>
          <label class="field full"><span>Nome completo</span><input class="input" name="nome" value="${esc(p.nome)}" required autofocus></label>
          <label class="field"><span>Telefone (WhatsApp)</span><input class="input" name="telefone" value="${esc(p.telefone)}" placeholder="(11) 90000-0000"></label>
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" value="${esc(p.email)}"></label>
          <label class="field"><span>Data de nascimento</span><input class="input" type="date" name="nascimento" value="${esc(p.nascimento)}"></label>
          <label class="field"><span>Profissional responsável</span><select class="input" name="profissionalId">${ui.opcoesProf(p.profissionalId)}</select></label>
          <label class="field"><span>Modalidade</span><select class="input" name="modalidade">${ui.opcoes([["presencial", "Presencial"], ["on-line", "On-line"]], p.modalidade)}</select></label>
          <label class="field"><span>Valor da sessão</span><input class="input" type="number" name="valor" min="0" step="10" value="${p.valor}"></label>
          <label class="field full"><span>Motivo da procura</span><input class="input" name="queixa" value="${esc(p.queixa)}"></label>
          <label class="field full"><span>Observações</span><textarea class="input" name="observacoes" rows="3">${esc(p.observacoes)}</textarea></label>
          <p class="erro full" id="erro-paciente" hidden>Informe o nome do paciente.</p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-paciente">${novo ? "Cadastrar" : "Salvar"}</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          if (!f.nome.trim()) {
            el.querySelector("#erro-paciente").hidden = false;
            return;
          }
          f.nome = f.nome.trim();
          f.valor = Number(f.valor) || 0;
          fechar();
          if (novo) {
            const criado = { id: App.uid(), ...f, status: "ativo", desde: d.hoje() };
            App.db.pacientes.push(criado);
            App.store.salvar();
            location.hash = `#/pacientes/${criado.id}`;
            ui.toast(`${criado.nome} cadastrado.`);
          } else {
            Object.assign(p, f);
            mudar("Dados salvos.");
          }
        };
      }
    });
  }

  A["arquivar-paciente"] = ({ id }) => {
    const p = q.paciente(id);
    if (p.status === "inativo") {
      p.status = "ativo";
      return mudar(`${p.nome} voltou para os pacientes ativos.`);
    }
    const futuras = q.sessoesPaciente(id).filter((s) => ["agendada", "confirmada"].includes(q.statusDe(s)));
    ui.confirmar({
      titulo: `Encerrar acompanhamento de ${esc(App.primeiroNome(p.nome))}?`,
      texto: futuras.length
        ? `${App.plural(futuras.length, "sessão futura será cancelada", "sessões futuras serão canceladas")}. O histórico e o prontuário continuam guardados.`
        : "O histórico e o prontuário continuam guardados. Dá para reativar quando quiser.",
      botao: "Encerrar acompanhamento",
      aoConfirmar() {
        const antes = futuras.map((s) => s.status);
        p.status = "inativo";
        futuras.forEach((s) => (s.status = "cancelada"));
        mudar(`Acompanhamento de ${p.nome} encerrado.`, () => {
          p.status = "ativo";
          futuras.forEach((s, i) => (s.status = antes[i]));
          mudar();
        });
      }
    });
  };

  /* Profissionais */

  A["novo-profissional"] = () => formProfissional();
  A["editar-profissional"] = ({ id }) => formProfissional(q.prof(id));

  function formProfissional(p) {
    const novo = !p;
    p = p || { nome: "", especialidade: "", registro: "", email: "", telefone: "", ativo: true };
    ui.modal({
      titulo: novo ? "Nova profissional" : `Editar ${esc(App.primeiroNome(p.nome))}`,
      corpo: `
        <form id="form-prof" class="form-grid" novalidate>
          <label class="field full"><span>Nome</span><input class="input" name="nome" value="${esc(p.nome)}" required autofocus></label>
          <label class="field"><span>Especialidade</span><input class="input" name="especialidade" value="${esc(p.especialidade)}"></label>
          <label class="field"><span>Registro (CRP)</span><input class="input" name="registro" value="${esc(p.registro)}"></label>
          <label class="field"><span>E-mail</span><input class="input" type="email" name="email" value="${esc(p.email)}"></label>
          <label class="field"><span>Telefone</span><input class="input" name="telefone" value="${esc(p.telefone)}"></label>
          <label class="check full"><input type="checkbox" name="ativo"${p.ativo ? " checked" : ""}> Atendendo na clínica (aparece na agenda)</label>
          <p class="erro full" id="erro-prof" hidden>Informe o nome.</p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-prof">${novo ? "Adicionar" : "Salvar"}</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          if (!f.nome.trim()) {
            el.querySelector("#erro-prof").hidden = false;
            return;
          }
          const dados = { ...f, nome: f.nome.trim(), ativo: !!f.ativo };
          fechar();
          if (novo) App.db.profissionais.push({ id: App.uid(), ...dados });
          else Object.assign(p, dados);
          mudar(novo ? `${dados.nome} adicionada à equipe.` : "Dados salvos.");
        };
      }
    });
  }

  /* Despesas */

  A["nova-despesa"] = ({ id } = {}) => {
    const desp = id ? App.db.despesas.find((x) => x.id === id) : null;
    const v = desp || { descricao: "", valor: "", data: d.hoje(), pago: true };
    ui.modal({
      titulo: desp ? "Editar despesa" : "Lançar despesa",
      corpo: `
        <form id="form-despesa" class="form-grid" novalidate>
          <label class="field full"><span>Descrição</span><input class="input" name="descricao" value="${esc(v.descricao)}" placeholder="Aluguel, supervisão, material..." required autofocus></label>
          <label class="field"><span>Valor</span><input class="input" type="number" name="valor" min="0" step="0.01" value="${v.valor}"></label>
          <label class="field"><span>Data</span><input class="input" type="date" name="data" value="${v.data}"></label>
          <label class="check full"><input type="checkbox" name="pago"${v.pago ? " checked" : ""}> Já foi paga</label>
          <p class="erro full" id="erro-despesa" hidden>Informe a descrição e o valor.</p>
        </form>`,
      rodape: `<button class="button ghost" type="button" data-fechar>Voltar</button><button class="button" type="submit" form="form-despesa">Salvar</button>`,
      montar(el, fechar) {
        el.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const f = ui.dadosForm(e.target);
          if (!f.descricao.trim() || !Number(f.valor)) {
            el.querySelector("#erro-despesa").hidden = false;
            return;
          }
          const dados = { descricao: f.descricao.trim(), valor: Number(f.valor), data: f.data || d.hoje(), pago: !!f.pago };
          fechar();
          if (desp) Object.assign(desp, dados);
          else App.db.despesas.push({ id: App.uid(), ...dados });
          mudar("Despesa salva.");
        };
      }
    });
  };

  A["alternar-despesa"] = ({ id }) => {
    const desp = App.db.despesas.find((x) => x.id === id);
    desp.pago = !desp.pago;
    mudar(desp.pago ? "Despesa marcada como paga." : "Despesa marcada como a pagar.");
  };

  A["apagar-despesa"] = ({ id }) => {
    const i = App.db.despesas.findIndex((x) => x.id === id);
    const [removida] = App.db.despesas.splice(i, 1);
    mudar("Despesa apagada.", () => {
      App.db.despesas.splice(i, 0, removida);
      mudar();
    });
  };

  /* Conta */

  A.sair = () => {
    document.getElementById("bloqueio").hidden = false;
  };

  A.entrar = () => {
    document.getElementById("bloqueio").hidden = true;
  };

  App.mudar = mudar;

  document.addEventListener("click", (e) => {
    const alvo = e.target.closest("[data-action]");
    if (!alvo || !A[alvo.dataset.action]) return;
    e.preventDefault();
    A[alvo.dataset.action]({ ...alvo.dataset });
  });
})(window.App);
