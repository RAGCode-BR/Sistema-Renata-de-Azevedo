(function (App) {
  const { d, esc, ui } = App;

  function render(el) {
    const c = App.db.clinica;
    const horas = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => [de + i, `${de + i}h`]);

    el.innerHTML = `
      <section class="heading">
        <div>
          <h1>Configurações</h1>
          <p class="lead">Horários da clínica e cópia dos dados.</p>
        </div>
      </section>

      <div class="content">
        <form class="panel" id="form-clinica">
          <div class="panel-head"><h2>Clínica</h2></div>
          <div class="panel-body">
            <div class="form-grid">
              <label class="field full"><span>Nome da clínica</span><input class="input" name="nome" value="${esc(c.nome)}"></label>
              <label class="field"><span>Primeiro horário</span><select class="input" name="inicio">${ui.opcoes(horas(6, 12), c.inicio)}</select></label>
              <label class="field"><span>Último horário</span><select class="input" name="fim">${ui.opcoes(horas(14, 21), c.fim)}</select></label>
              <label class="field"><span>Almoço</span><select class="input" name="almoco">${ui.opcoes([["0", "Sem intervalo"], ...horas(11, 14)], c.almoco)}</select></label>
              <label class="field"><span>Duração da sessão</span><select class="input" name="duracao">${ui.opcoes([[30, "30 minutos"], [40, "40 minutos"], [45, "45 minutos"], [50, "50 minutos"], [60, "60 minutos"]], c.duracao)}</select></label>
              <label class="field"><span>Valor padrão da sessão</span><input class="input" type="number" name="valorPadrao" min="0" step="10" value="${c.valorPadrao}"></label>
              <label class="field"><span>Salas</span><input class="input" type="number" name="salas" min="1" max="20" value="${c.salas}"></label>
            </div>
            <p class="erro" id="erro-clinica" hidden></p>
            <div class="form-actions"><button class="button" type="submit">Salvar</button></div>
          </div>
        </form>

        <aside class="side">
          <section class="panel">
            <div class="panel-head"><h2>Seus dados</h2></div>
            <div class="panel-body stack">
              <p class="small muted">Por enquanto os dados ficam guardados só neste navegador. Baixe uma cópia com frequência, e antes de limpar o histórico ou trocar de computador.</p>
              <button class="button light" type="button" id="baixar">Baixar cópia dos dados</button>
              <label class="button light file-btn">Restaurar de uma cópia<input type="file" id="importar" accept="application/json,.json" hidden></label>
              <hr>
              <button class="link-btn" type="button" id="demo">Recarregar dados de demonstração</button>
              <button class="link-btn danger" type="button" id="apagar">Apagar todos os dados</button>
            </div>
          </section>
        </aside>
      </div>`;

    el.querySelector("#form-clinica").onsubmit = (e) => {
      e.preventDefault();
      const f = ui.dadosForm(e.target);
      const novo = {
        nome: f.nome.trim() || c.nome,
        inicio: Number(f.inicio),
        fim: Number(f.fim),
        almoco: Number(f.almoco),
        duracao: Number(f.duracao),
        valorPadrao: Number(f.valorPadrao) || 0,
        salas: Number(f.salas) || 1
      };
      if (novo.almoco && (novo.almoco <= novo.inicio || novo.almoco >= novo.fim)) {
        const erro = el.querySelector("#erro-clinica");
        erro.textContent = "O almoço precisa ficar entre o primeiro e o último horário.";
        erro.hidden = false;
        return;
      }
      Object.assign(c, novo);
      App.mudar("Configurações salvas.");
    };

    el.querySelector("#baixar").onclick = () => {
      ui.baixar(`clinica-dados-${d.hoje()}.json`, App.store.exportar(), "application/json");
      ui.toast("Cópia baixada.");
    };

    el.querySelector("#importar").onchange = async (e) => {
      const arquivo = e.target.files[0];
      if (!arquivo) return;
      try {
        App.store.importar(await arquivo.text());
        App.mudar("Dados restaurados da cópia.");
      } catch (erro) {
        ui.toast(erro.message.startsWith("O arquivo") ? erro.message : "Não foi possível ler esse arquivo.");
      }
    };

    el.querySelector("#demo").onclick = () => ui.confirmar({
      titulo: "Recarregar demonstração?",
      texto: "Tudo o que foi cadastrado será substituído pelos dados de exemplo.",
      botao: "Recarregar",
      perigo: true,
      aoConfirmar() {
        App.store.restaurarDemonstracao();
        App.mudar("Dados de demonstração carregados.");
      }
    });

    el.querySelector("#apagar").onclick = () => ui.confirmar({
      titulo: "Apagar todos os dados?",
      texto: "Pacientes, sessões, prontuários e lançamentos serão apagados deste navegador. Baixe uma cópia antes, se precisar.",
      botao: "Apagar tudo",
      perigo: true,
      aoConfirmar() {
        App.store.apagarTudo();
        App.mudar("Todos os dados foram apagados.");
      }
    });
  }

  App.views.configuracoes = { titulo: "Configurações", render };
})(window.App);
