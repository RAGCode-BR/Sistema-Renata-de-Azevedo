// Navegação entre telas pelo endereço (#/agenda, #/pacientes/id...).
(function (App) {
  const main = document.getElementById("view");

  function rotaAtual() {
    const [, nome = "hoje", id] = (location.hash || "#/hoje").split("/");
    return { nome: App.views[nome] ? nome : "hoje", id: id ? decodeURIComponent(id) : undefined };
  }

  function render(rolarParaTopo) {
    const { nome, id } = rotaAtual();
    const view = App.views[nome];
    const rolagem = window.scrollY;
    view.render(main, id);
    document.title = `${view.titulo} | Renata de Azevedo`;
    document.querySelectorAll(".nav-item").forEach((a) => {
      const ativo = a.getAttribute("href") === `#/${nome}`;
      a.classList.toggle("active", ativo);
      if (ativo) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, rolarParaTopo ? 0 : rolagem);
  }

  // Redesenha a tela atual depois de uma mudança nos dados.
  App.refresh = () => render(false);

  window.addEventListener("hashchange", () => {
    const dialog = document.getElementById("modal");
    if (dialog.open) dialog.close();
    render(true);
  });

  // Linhas de tabela que levam a outra tela.
  main.addEventListener("click", (e) => {
    const linha = e.target.closest("tr[data-href]");
    if (!linha || e.target.closest("a, button")) return;
    location.hash = linha.dataset.href;
  });

  // Fecha a janela ao clicar fora dela.
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // Atualiza a linha do "agora" e os status a cada minuto.
  setInterval(() => {
    if (!document.getElementById("modal").open && rotaAtual().nome === "hoje" && !document.activeElement?.matches("input")) App.refresh();
  }, 60000);

  render(true);
})(window.App);
