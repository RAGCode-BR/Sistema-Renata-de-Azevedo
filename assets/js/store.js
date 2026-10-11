// Dados do sistema. Por enquanto ficam no localStorage deste navegador;
// quando houver servidor, só este arquivo precisa mudar.
(function (App) {
  const CHAVE = "rda-clinica-v1";
  const { d } = App;

  const CLINICA_PADRAO = {
    nome: "Renata de Azevedo Psicologia & Coaching",
    inicio: 8,
    fim: 18,
    almoco: 12,
    duracao: 50,
    salas: 3,
    valorPadrao: 200
  };

  const NOMES = [
    "Mariana Costa", "Pedro Almeida", "Juliana Santos", "Lucas Ferreira", "Ana Beatriz Lima", "Rafael Oliveira",
    "Sofia Martins", "Bruno Rodrigues", "Carla Mendes", "Gustavo Nunes", "Helena Prado", "Marcos Vieira",
    "Isabela Cunha", "Thiago Ramos", "Paula Teixeira", "Diego Barros", "Larissa Fontes", "Fernanda Lopes",
    "Renato Dias", "Beatriz Moura", "Camila Duarte", "Vinícius Rocha", "André Pires", "Natália Freitas",
    "Aline Castro", "Priscila Gomes", "Eduardo Lima", "Sérgio Matos", "Débora Reis", "Letícia Araújo",
    "Felipe Santana", "Mônica Ribeiro", "Caio Martins", "Gabriela Souza", "Henrique Alves", "Tatiana Moreira",
    "Rodrigo Campos", "Luana Pacheco", "Otávio Brandão", "Clara Nogueira", "Patrícia Lacerda", "Fábio Siqueira",
    "Rebeca Toledo", "Leonardo Paiva"
  ];

  const QUEIXAS = [
    "Ansiedade relacionada ao trabalho",
    "Luto recente",
    "Transição de carreira",
    "Dificuldades no relacionamento",
    "Autoestima e autoconfiança",
    "Estresse e esgotamento",
    "Organização pessoal e metas (coaching)",
    "Insônia e preocupação constante",
    "Conflitos familiares",
    "Adaptação após mudança de cidade"
  ];

  const EVOLUCOES = [
    "Relatou uma semana mais estável. Retomamos as estratégias combinadas no último encontro.",
    "Trabalhamos situações de gatilho no trabalho. Combinado registro diário até a próxima sessão.",
    "Sessão focada no vínculo familiar. Trouxe lembranças da infância com bastante emoção.",
    "Revisão das metas do mês: duas concluídas, uma reformulada.",
    "Relatou dificuldade para dormir. Exploramos a rotina noturna e os pensamentos recorrentes.",
    "Boa adesão às tarefas. Percebe mudança na forma de responder a conflitos.",
    "Sessão mais silenciosa, chegou cansado. Acolhimento e escuta.",
    "Retomamos o tema da autoestima a partir de um episódio do fim de semana."
  ];

  const FORMAS = ["Pix", "Cartão", "Transferência", "Dinheiro"];

  function aleatorio(semente) {
    return function () {
      semente = (semente + 0x6d2b79f5) | 0;
      let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function horasDe(clinica) {
    const horas = [];
    for (let h = clinica.inicio; h <= clinica.fim; h++) if (h !== clinica.almoco) horas.push(h);
    return horas;
  }

  // Gera uma clínica de demonstração em torno da semana atual.
  function demonstracao() {
    const r = aleatorio(19);
    const pick = (lista) => lista[Math.floor(r() * lista.length)];
    const hoje = d.hoje();
    const agora = new Date();
    const segAtual = d.segunda(d.diaUtil(hoje));
    const clinica = { ...CLINICA_PADRAO };

    const profissionais = [
      { id: "p1", nome: "Renata de Azevedo", especialidade: "Psicóloga clínica e coach", registro: "CRP 06/123456", email: "renata@renatadeazevedo.com.br", telefone: "(11) 98888-1001", ativo: true },
      { id: "p2", nome: "Camila Rocha", especialidade: "Psicóloga clínica", registro: "CRP 06/654321", email: "camila@renatadeazevedo.com.br", telefone: "(11) 98888-1002", ativo: true }
    ];

    const vagas = [];
    for (let dia = 0; dia < 5; dia++) {
      horasDe(clinica).forEach((h) => profissionais.forEach((p) => vagas.push({ dia, hora: `${d.pad(h)}:00`, prof: p.id })));
    }
    for (let i = vagas.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [vagas[i], vagas[j]] = [vagas[j], vagas[i]];
    }

    const pacientes = [];
    const sessoes = [];
    const evolucoes = [];
    const limiteHistorico = d.somar(segAtual, -7 * 26);

    NOMES.forEach((nome, i) => {
      const vaga = vagas[i];
      const inativo = i >= 40;
      const desde = d.somar(segAtual, -7 * (2 + Math.floor(r() * 30)));
      const ultimaSemana = inativo ? d.somar(segAtual, -7 * (1 + Math.floor(r() * 4))) : d.somar(segAtual, 21);
      const usuario = App.semAcento(nome).replace(/\s+/g, ".");
      const paciente = {
        id: "pc" + (i + 1),
        nome,
        telefone: `(11) 9${8000 + Math.floor(r() * 1999)}-${1000 + Math.floor(r() * 8999)}`,
        email: `${usuario}@email.com`,
        nascimento: `${1968 + Math.floor(r() * 38)}-${d.pad(1 + Math.floor(r() * 12))}-${d.pad(1 + Math.floor(r() * 28))}`,
        profissionalId: vaga.prof,
        modalidade: r() < 0.6 ? "presencial" : "on-line",
        valor: pick([180, 200, 220, 250]),
        status: inativo ? "inativo" : "ativo",
        desde,
        queixa: pick(QUEIXAS),
        observacoes: ""
      };
      pacientes.push(paciente);

      for (let seg = desde < limiteHistorico ? limiteHistorico : d.segunda(desde); seg <= ultimaSemana; seg = d.somar(seg, 7)) {
        const data = d.somar(seg, vaga.dia);
        if (data < desde) continue;
        const sessao = {
          id: App.uid() + sessoes.length,
          pacienteId: paciente.id,
          profissionalId: vaga.prof,
          data,
          hora: vaga.hora,
          modalidade: paciente.modalidade,
          valor: paciente.valor,
          status: "agendada",
          pago: false,
          pagoEm: null,
          forma: null
        };
        const diasAtras = (agora - d.inicio(sessao)) / 864e5;

        if (diasAtras > 0) {
          const x = r();
          sessao.status = x < 0.06 ? "falta" : x < 0.11 ? "cancelada" : "realizada";
          // Algumas sessões recentes ainda sem presença registrada.
          if (diasAtras < 4 && r() < 0.25) sessao.status = "confirmada";
          if (sessao.status === "realizada") {
            if (!(diasAtras < 14 && r() < 0.35)) {
              sessao.pago = true;
              sessao.pagoEm = data;
              sessao.forma = pick(FORMAS);
            }
            if (!(diasAtras < 6 && r() < 0.5)) {
              evolucoes.push({ id: App.uid() + evolucoes.length, pacienteId: paciente.id, sessaoId: sessao.id, data, texto: pick(EVOLUCOES) });
            }
          }
        } else if (data < d.somar(segAtual, 14)) {
          sessao.status = r() < 0.72 ? "confirmada" : "agendada";
        }
        sessoes.push(sessao);
      }
    });

    const despesas = [];
    const mesAtual = hoje.slice(0, 7);
    [-6, -5, -4, -3, -2, -1, 0].forEach((n) => {
      const ym = d.somarMes(mesAtual, n);
      [
        ["Aluguel do consultório", 3200, "05"],
        ["Supervisão clínica", 600, "10"],
        ["Internet e telefone", 180, "15"],
        ["Material de escritório", 90 + Math.floor(r() * 80), "20"]
      ].forEach(([descricao, valor, dia]) => {
        const data = `${ym}-${dia}`;
        despesas.push({ id: App.uid() + despesas.length, descricao, valor, data, pago: data <= hoje });
      });
    });

    return { versao: 1, clinica, profissionais, pacientes, sessoes, evolucoes, despesas };
  }

  function vazio() {
    return {
      versao: 1,
      clinica: { ...CLINICA_PADRAO },
      profissionais: [{ id: "p1", nome: "Renata de Azevedo", especialidade: "Psicóloga clínica e coach", registro: "", email: "", telefone: "", ativo: true }],
      pacientes: [],
      sessoes: [],
      evolucoes: [],
      despesas: []
    };
  }

  function valido(db) {
    return db && db.versao === 1 && ["profissionais", "pacientes", "sessoes", "evolucoes", "despesas"].every((k) => Array.isArray(db[k])) && db.clinica;
  }

  function carregar() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE));
      if (valido(salvo)) return salvo;
    } catch (e) { /* segue para a demonstração */ }
    const db = demonstracao();
    gravar(db);
    return db;
  }

  function gravar(db) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
    }
  }

  App.db = carregar();

  App.store = {
    salvar() {
      if (!gravar(App.db)) App.ui.toast("Não foi possível salvar neste navegador.");
    },
    restaurarDemonstracao() {
      App.db = demonstracao();
      App.store.salvar();
    },
    apagarTudo() {
      App.db = vazio();
      App.store.salvar();
    },
    exportar() {
      return JSON.stringify(App.db, null, 2);
    },
    importar(texto) {
      const db = JSON.parse(texto);
      if (!valido(db)) throw new Error("O arquivo não é uma cópia de dados deste sistema.");
      App.db = db;
      App.store.salvar();
    }
  };

  // Consultas usadas pelas telas.
  const q = {
    horas: () => horasDe(App.db.clinica),
    prof: (id) => App.db.profissionais.find((p) => p.id === id),
    paciente: (id) => App.db.pacientes.find((p) => p.id === id),
    sessao: (id) => App.db.sessoes.find((s) => s.id === id),
    profsAtivos: () => App.db.profissionais.filter((p) => p.ativo),
    pacientesAtivos: () => App.db.pacientes.filter((p) => p.status === "ativo").sort((a, b) => a.nome.localeCompare(b.nome)),

    ordenar: (lista) => lista.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)),

    sessoesDia(iso) {
      return q.ordenar(App.db.sessoes.filter((s) => s.data === iso && s.status !== "cancelada"));
    },

    sessoesPaciente(id) {
      return q.ordenar(App.db.sessoes.filter((s) => s.pacienteId === id));
    },

    // Status visto pela equipe: considera o horário atual.
    statusDe(s, agora = new Date()) {
      if (["cancelada", "falta", "realizada"].includes(s.status)) return s.status;
      const ini = d.inicio(s);
      const fim = new Date(ini.getTime() + App.db.clinica.duracao * 60000);
      if (agora >= ini && agora < fim) return "emsessao";
      if (agora >= fim) return "aregistrar";
      return s.status;
    },

    proximas(agora = new Date()) {
      return q.ordenar(App.db.sessoes.filter((s) => ["agendada", "confirmada"].includes(q.statusDe(s, agora))));
    },

    aRegistrar() {
      return q.ordenar(App.db.sessoes.filter((s) => q.statusDe(s) === "aregistrar"));
    },

    evolucaoDaSessao: (id) => App.db.evolucoes.find((e) => e.sessaoId === id),

    // Sessões realizadas nos últimos 30 dias que ainda não têm evolução escrita.
    evolucoesPendentes() {
      const limite = d.somar(d.hoje(), -30);
      const comEvolucao = new Set(App.db.evolucoes.map((e) => e.sessaoId));
      return q.ordenar(App.db.sessoes.filter((s) => s.status === "realizada" && s.data >= limite && !comEvolucao.has(s.id)));
    },

    emAberto() {
      return q.ordenar(App.db.sessoes.filter((s) => s.status === "realizada" && !s.pago));
    },

    conflito(s) {
      return App.db.sessoes.find((o) => o.id !== s.id && o.status !== "cancelada" && o.profissionalId === s.profissionalId && o.data === s.data && o.hora === s.hora);
    },

    vagasSemana() {
      return q.profsAtivos().length * q.horas().length * 5;
    }
  };

  App.q = q;
})(window.App);
