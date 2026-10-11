// Núcleo: namespace, datas e formatação usados por todas as telas.
window.App = { views: {}, actions: {} };

(function (App) {
  const pad = (n) => String(n).padStart(2, "0");

  const d = {
    pad,
    iso(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },
    parse(iso) {
      return new Date(iso + "T12:00:00");
    },
    hoje() {
      return d.iso(new Date());
    },
    somar(iso, dias) {
      const date = d.parse(iso);
      date.setDate(date.getDate() + dias);
      return d.iso(date);
    },
    segunda(iso) {
      const date = d.parse(iso);
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return d.iso(date);
    },
    semana(iso) {
      const seg = d.segunda(iso);
      return [0, 1, 2, 3, 4].map((i) => d.somar(seg, i));
    },
    // Próximo dia útil a partir de iso (o próprio dia, se for útil).
    diaUtil(iso) {
      let dia = iso;
      while ([0, 6].includes(d.parse(dia).getDay())) dia = d.somar(dia, 1);
      return dia;
    },
    somarMes(ym, n) {
      const [a, m] = ym.split("-").map(Number);
      const date = new Date(a, m - 1 + n, 1);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    },
    hora(hhmm) {
      return Number(hhmm.slice(0, 2));
    },
    hh(hhmm) {
      const [h, m] = hhmm.split(":");
      return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
    },
    fim(hhmm, minutos) {
      const total = d.hora(hhmm) * 60 + Number(hhmm.slice(3)) + minutos;
      return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    },
    inicio(sessao) {
      return new Date(`${sessao.data}T${sessao.hora}:00`);
    },
    longa(iso) {
      const t = d.parse(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).replace("-feira", "");
      return t.charAt(0).toUpperCase() + t.slice(1);
    },
    curta(iso) {
      const date = d.parse(iso);
      const dia = date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      return `${dia}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
    },
    numerica(iso) {
      if (!iso) return "";
      const [a, m, dia] = iso.split("-");
      return `${dia}/${m}/${a}`;
    },
    // "hoje", "amanhã", "ontem" ou "seg, 19/10".
    relativa(iso) {
      const hoje = d.hoje();
      if (iso === hoje) return "hoje";
      if (iso === d.somar(hoje, 1)) return "amanhã";
      if (iso === d.somar(hoje, -1)) return "ontem";
      return d.curta(iso);
    },
    nomeMes(ym) {
      const t = new Date(ym + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      return t.charAt(0).toUpperCase() + t.slice(1);
    },
    mesCurto(ym) {
      return new Date(ym + "-15T12:00:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    },
    idade(nascimento) {
      if (!nascimento) return null;
      const n = d.parse(nascimento);
      const hoje = new Date();
      let anos = hoje.getFullYear() - n.getFullYear();
      if (hoje.getMonth() < n.getMonth() || (hoje.getMonth() === n.getMonth() && hoje.getDate() < n.getDate())) anos--;
      return anos;
    }
  };

  App.d = d;

  App.esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  App.dinheiro = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  App.plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  App.semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  App.primeiroNome = (nome) => String(nome).split(" ")[0];
  App.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
})(window.App);
