// ===================================================================
// FabioSilva_TV Originals — MOTOR dos minijogos
// -------------------------------------------------------------------
// Toda a matemática dos 7 jogos num só ficheiro, sem nada de ecrã.
// O mesmo ficheiro corre em dois sítios:
//   • no browser, no modo Treino (fichas guardadas só no teu browser);
//   • no servidor (fabiosilvatv-api/lib/og-motor.js), no modo Ranking,
//     onde é o servidor que sorteia — assim ninguém consegue fazer batota.
// Se mudares alguma coisa aqui, copia o ficheiro para a API também.
//
// Motor.passo(jogo, passo, params, estado, rand, opcoes) devolve:
//   { debito, credito, estado, fim, view }
//   debito  = fichas a tirar ao saldo neste passo (aposta, dobrar…)
//   credito = fichas a dar neste passo (prémio)
//   estado  = estado interno para o passo seguinte (null se acabou)
//   view    = o que o ecrã pode saber (nunca mostra cartas/minas escondidas)
// ===================================================================
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.OGMotor = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APOSTA_MAX = 1000000000;

  class ErroJogo extends Error {
    constructor(msg) {
      super(msg);
      this.jogo = true;
    }
  }
  const erro = (m) => {
    throw new ErroJogo(m);
  };

  function aposta(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > APOSTA_MAX) erro('Aposta inválida.');
    return n;
  }
  const randInt = (rand, n) => Math.floor(rand() * n);
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const fim = (debito, credito, view) => ({ debito, credito, estado: null, fim: true, view });

  // ================= DADOS (1% casa) =================
  function dados(params, rand) {
    const a = aposta(params.aposta);
    const alvo = Math.round(Number(params.alvo) * 100) / 100;
    const acima = !!params.acima;
    if (!Number.isFinite(alvo)) erro('Alvo inválido.');
    const prob = acima ? 100 - alvo : alvo;
    if (prob < 2 || prob > 98) erro('A probabilidade tem de estar entre 2% e 98%.');
    const mult = 99 / prob;
    const r = Math.floor(rand() * 10001) / 100;
    const ganhou = acima ? r > alvo : r < alvo;
    return fim(a, ganhou ? Math.floor(a * mult) : 0, { r, ganhou, mult, alvo, acima });
  }

  // ================= CRASH (3% casa) =================
  function sortearCrash(rand) {
    const r = rand();
    if (r < 0.03) return 1.0;
    return Math.max(1.0, Math.floor((0.97 / (1 - r)) * 100) / 100);
  }
  function crash(passo, params, estado, rand, opcoes) {
    if (passo === 'iniciar') {
      const a = aposta(params.aposta);
      const crashAt = sortearCrash(rand);
      const auto = params.auto == null || params.auto === '' ? null : Math.floor(Number(params.auto) * 100) / 100;
      if (auto != null) {
        if (!Number.isFinite(auto) || auto < 1.01 || auto > 1000000) erro('A recolha automática tem de ser pelo menos 1.01x.');
        const ok = auto <= crashAt;
        return fim(a, ok ? Math.floor(a * auto) : 0, { crashAt, recolheu: ok ? auto : 0 });
      }
      // Recolha manual só existe no modo Treino (no Ranking o servidor
      // teria de saber o tempo exato do clique — por isso exige-se a
      // recolha automática).
      if (!opcoes.manual) erro('No ranking tens de definir a recolha automática.');
      return { debito: a, credito: 0, estado: { aposta: a, crashAt }, fim: false, view: { crashAt } };
    }
    if (passo === 'recolher') {
      if (!estado) erro('Não há ronda a decorrer.');
      const m = Math.floor(Number(params.mult) * 100) / 100;
      const ok = Number.isFinite(m) && m >= 1 && m <= estado.crashAt;
      return fim(0, ok ? Math.floor(estado.aposta * m) : 0, { crashAt: estado.crashAt, recolheu: ok ? m : 0 });
    }
    erro('Passo inválido.');
  }

  // ================= PLINKO (~99%) =================
  const PLINKO = {
    8: { baixo: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medio: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], alto: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
    12: { baixo: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medio: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], alto: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
    16: { baixo: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medio: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], alto: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
  };
  function plinko(params, rand) {
    const a = aposta(params.aposta);
    const linhas = Number(params.linhas);
    const tabela = PLINKO[linhas] && PLINKO[linhas][params.risco];
    if (!tabela) erro('Linhas ou risco inválidos.');
    const passos = Array.from({ length: linhas }, () => (rand() < 0.5 ? 0 : 1));
    const balde = passos.reduce((s, p) => s + p, 0);
    const mult = tabela[balde];
    return fim(a, Math.floor(a * mult), { passos, balde, mult, linhas, risco: params.risco });
  }

  // ================= SLOT (~96%) =================
  const SIMBOLOS = [
    { id: 'cereja', w: 22, paga: [16, 42, 125] },
    { id: 'limao', w: 20, paga: [17, 47, 160] },
    { id: 'uvas', w: 17, paga: [23, 63, 230] },
    { id: 'melancia', w: 14, paga: [31, 94, 315] },
    { id: 'sino', w: 10, paga: [47, 157, 630] },
    { id: 'estrela', w: 8, paga: [78, 260, 1250] },
    { id: 'diamante', w: 5, paga: [157, 630, 3150] },
    { id: 'coroa', w: 3, paga: [315, 1570, 8400] },
  ];
  const LINHAS = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1],
  ];
  const PESO = SIMBOLOS.reduce((s, x) => s + x.w, 0);
  function simbolo(rand) {
    let r = rand() * PESO;
    for (const s of SIMBOLOS) if ((r -= s.w) < 0) return s;
    return SIMBOLOS[0];
  }
  function slots(params, rand) {
    const a = aposta(params.aposta);
    const grelha = Array.from({ length: 5 }, () => [simbolo(rand), simbolo(rand), simbolo(rand)]);
    const ganhos = [];
    LINHAS.forEach((L, li) => {
      const s = grelha[0][L[0]];
      let k = 1;
      while (k < 5 && grelha[k][L[k]].id === s.id) k++;
      // "paga" está em décimas da aposta total (ex.: 16 = 1.6x a aposta)
      if (k >= 3) ganhos.push({ li, k, id: s.id, mult: s.paga[k - 3] / 10 });
    });
    const mult = Math.round(ganhos.reduce((s, g) => s + g.mult, 0) * 10000) / 10000;
    return fim(a, Math.floor(a * mult), { grelha: grelha.map((c) => c.map((s) => s.id)), ganhos, mult });
  }

  // ================= ROLETA europeia =================
  const VERMELHOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const cor = (n) => (n === 0 ? 'verde' : VERMELHOS.has(n) ? 'vermelho' : 'preto');
  function cobre(chave) {
    const m = /^(n|duzia|coluna|cor|par|metade):(.+)$/.exec(chave);
    if (!m) return null;
    const [, tipo, v] = m;
    if (tipo === 'n' && !/^(\d|[12]\d|3[0-6])$/.test(v)) return null;
    if ((tipo === 'duzia' || tipo === 'coluna') && !/^[123]$/.test(v)) return null;
    if (tipo === 'cor' && v !== 'vermelho' && v !== 'preto') return null;
    if (tipo === 'par' && v !== 'par' && v !== 'impar') return null;
    if (tipo === 'metade' && v !== '1' && v !== '2') return null;
    const nums = [];
    if (tipo === 'n') nums.push(+v);
    else
      for (let n = 1; n <= 36; n++) {
        if (tipo === 'duzia' && Math.ceil(n / 12) === +v) nums.push(n);
        if (tipo === 'coluna' && ((n - 1) % 3) + 1 === +v) nums.push(n);
        if (tipo === 'cor' && cor(n) === v) nums.push(n);
        if (tipo === 'par' && (v === 'par' ? n % 2 === 0 : n % 2 === 1)) nums.push(n);
        if (tipo === 'metade' && (v === '1' ? n <= 18 : n >= 19)) nums.push(n);
      }
    const paga = tipo === 'n' ? 35 : tipo === 'duzia' || tipo === 'coluna' ? 2 : 1;
    return { nums, paga };
  }
  function roleta(params, rand) {
    const apostas = params.apostas;
    if (!apostas || typeof apostas !== 'object') erro('Sem apostas.');
    const chaves = Object.keys(apostas);
    if (!chaves.length || chaves.length > 60) erro('Apostas inválidas.');
    let total = 0;
    chaves.forEach((k) => {
      if (!cobre(k)) erro('Aposta inválida na mesa.');
      total += aposta(apostas[k]);
    });
    if (total > APOSTA_MAX) erro('Aposta demasiado alta.');
    const numero = randInt(rand, 37);
    let credito = 0;
    const vencedoras = [];
    chaves.forEach((k) => {
      const c = cobre(k);
      if (c.nums.includes(numero)) {
        credito += apostas[k] * (c.paga + 1);
        vencedoras.push(k);
      }
    });
    return fim(total, credito, { numero, cor: cor(numero), vencedoras });
  }

  // ================= MINAS (1% casa) =================
  const N_MINAS = 25;
  function multMinas(minas, gemas) {
    let m = 1;
    for (let i = 0; i < gemas; i++) m *= (N_MINAS - i) / (N_MINAS - minas - i);
    return gemas ? m * 0.99 : 1;
  }
  function viewMinas(e, revelar) {
    const v = { aposta: e.aposta, nMinas: e.minas.length, abertas: e.abertas.slice(), mult: multMinas(e.minas.length, e.abertas.length) };
    if (revelar) v.minas = e.minas.slice();
    return v;
  }
  function minas(passo, params, estado, rand) {
    if (passo === 'iniciar') {
      const a = aposta(params.aposta);
      const k = Number(params.minas);
      if (!Number.isInteger(k) || k < 1 || k > 24) erro('Número de minas inválido.');
      const set = new Set();
      while (set.size < k) set.add(randInt(rand, N_MINAS));
      const e = { aposta: a, minas: [...set], abertas: [] };
      return { debito: a, credito: 0, estado: e, fim: false, view: viewMinas(e) };
    }
    if (!estado) erro('Não há jogo a decorrer.');
    const e = copia(estado);
    if (passo === 'ver') return { debito: 0, credito: 0, estado: e, fim: false, view: viewMinas(e) };
    if (passo === 'abrir') {
      const i = Number(params.i);
      if (!Number.isInteger(i) || i < 0 || i >= N_MINAS || e.abertas.includes(i)) erro('Casa inválida.');
      if (e.minas.includes(i)) return fim(0, 0, { ...viewMinas(e, true), bomba: i, mult: 0 });
      e.abertas.push(i);
      if (e.abertas.length === N_MINAS - e.minas.length) {
        const m = multMinas(e.minas.length, e.abertas.length);
        return fim(0, Math.floor(e.aposta * m), { ...viewMinas(e, true), gema: i, recolheu: m });
      }
      return { debito: 0, credito: 0, estado: e, fim: false, view: { ...viewMinas(e), gema: i } };
    }
    if (passo === 'recolher') {
      if (!e.abertas.length) erro('Abre pelo menos uma casa.');
      const m = multMinas(e.minas.length, e.abertas.length);
      return fim(0, Math.floor(e.aposta * m), { ...viewMinas(e, true), recolheu: m });
    }
    erro('Passo inválido.');
  }

  // ================= BLACKJACK =================
  // 6 baralhos, dealer fica em todos os 17, BJ paga 3:2, dobrar nas duas
  // primeiras cartas, dividir uma vez (ases divididos só recebem 1 carta).
  const NAIPES = ['♠', '♥', '♦', '♣'];
  const VALORES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const valorCarta = (c) => (c.v === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(c.v) ? 10 : +c.v);
  function total(cartas) {
    let t = 0, ases = 0;
    cartas.forEach((c) => {
      t += valorCarta(c);
      if (c.v === 'A') ases++;
    });
    while (t > 21 && ases) {
      t -= 10;
      ases--;
    }
    return { t, mole: ases > 0 && t <= 21 };
  }
  const ehBJ = (cartas) => cartas.length === 2 && total(cartas).t === 21;

  function novoSapato(rand) {
    const s = [];
    for (let d = 0; d < 6; d++) for (const n of NAIPES) for (const v of VALORES) s.push({ v, n });
    for (let i = s.length - 1; i > 0; i--) {
      const j = randInt(rand, i + 1);
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s.slice(0, 60); // uma ronda nunca usa tantas cartas
  }
  function dar(e) {
    const c = e.sapato.shift();
    if (!c) erro('Sem cartas.');
    e.seq += 1;
    return { v: c.v, n: c.n, id: e.seq };
  }
  function viewBJ(e) {
    const dealer = e.dealer.map((c, i) => (i === 1 && !e.revelado ? { id: c.id, virada: true } : { v: c.v, n: c.n, id: c.id }));
    const v = {
      dealer,
      revelado: !!e.revelado,
      ativa: e.ativa,
      maos: e.maos.map((m) => ({ cartas: m.cartas, aposta: m.aposta, terminada: !!m.terminada, resultado: m.resultado || null })),
      fim: !!e.acabou,
    };
    if (!e.acabou) {
      const m = e.maos[e.ativa];
      v.podeDobrar = !!m && !m.terminada && m.cartas.length === 2;
      v.podeDividir = !!m && e.maos.length === 1 && m.cartas.length === 2 && valorCarta(m.cartas[0]) === valorCarta(m.cartas[1]);
    }
    if (e.acabou) {
      v.etiquetas = e.etiquetas;
      v.devolvido = e.devolvido;
      v.apostado = e.maos.reduce((s, m) => s + m.aposta, 0);
    }
    return v;
  }
  function terminarBJ(e) {
    e.revelado = true;
    const d = total(e.dealer).t;
    const dBJ = ehBJ(e.dealer);
    let devolvido = 0;
    const etiquetas = [];
    e.maos.forEach((m) => {
      const p = total(m.cartas).t;
      const pBJ = e.maos.length === 1 && ehBJ(m.cartas);
      let paga = 0;
      if (pBJ && !dBJ) { paga = m.aposta + Math.floor(m.aposta * 1.5); m.resultado = 'bj'; etiquetas.push('Blackjack!'); }
      else if (p > 21) { m.resultado = 'lose'; etiquetas.push(`Rebentaste (${p})`); }
      else if (dBJ && !pBJ) { m.resultado = 'lose'; etiquetas.push('Dealer tem Blackjack'); }
      else if (pBJ && dBJ) { paga = m.aposta; m.resultado = 'push'; etiquetas.push('Empate (BJ)'); }
      else if (d > 21 || p > d) { paga = m.aposta * 2; m.resultado = 'win'; etiquetas.push(d > 21 ? `Dealer rebentou (${d})` : `${p} contra ${d}`); }
      else if (p === d) { paga = m.aposta; m.resultado = 'push'; etiquetas.push(`Empate ${p}`); }
      else { m.resultado = 'lose'; etiquetas.push(`${p} contra ${d}`); }
      devolvido += paga;
    });
    e.acabou = true;
    e.etiquetas = etiquetas;
    e.devolvido = devolvido;
    return devolvido;
  }
  // avança para a próxima mão por jogar; se não houver, joga o dealer
  function proximaMao(e) {
    for (;;) {
      while (e.ativa < e.maos.length && e.maos[e.ativa].terminada) e.ativa++;
      if (e.ativa >= e.maos.length) {
        e.ativa = e.maos.length - 1;
        e.revelado = true;
        if (e.maos.some((m) => total(m.cartas).t <= 21)) while (total(e.dealer).t < 17) e.dealer.push(dar(e));
        return terminarBJ(e);
      }
      const m = e.maos[e.ativa];
      if (m.cartas.length === 1) {
        m.cartas.push(dar(e));
        if (m.deAses || total(m.cartas).t === 21) {
          m.terminada = true;
          continue;
        }
      }
      return 0;
    }
  }
  function resultadoBJ(e, debito, credito) {
    const v = viewBJ(e);
    return e.acabou ? fim(debito, credito, v) : { debito, credito, estado: e, fim: false, view: v };
  }
  function blackjack(passo, params, estado, rand) {
    if (passo === 'iniciar') {
      const a = aposta(params.aposta);
      const e = { sapato: novoSapato(rand), seq: 0, dealer: [], maos: [{ cartas: [], aposta: a }], ativa: 0 };
      e.maos[0].cartas.push(dar(e));
      e.dealer.push(dar(e));
      e.maos[0].cartas.push(dar(e));
      e.dealer.push(dar(e));
      const visivel = e.dealer[0];
      let credito = 0;
      if (ehBJ(e.maos[0].cartas) || ((visivel.v === 'A' || valorCarta(visivel) === 10) && ehBJ(e.dealer))) credito = terminarBJ(e);
      return resultadoBJ(e, a, credito);
    }
    if (!estado) erro('Não há mão a decorrer.');
    const e = copia(estado);
    const m = e.maos[e.ativa];
    if (passo === 'ver') return resultadoBJ(e, 0, 0);
    if (!m || m.terminada) erro('Jogada inválida.');
    let debito = 0, credito = 0;
    if (passo === 'pedir') {
      m.cartas.push(dar(e));
      if (total(m.cartas).t >= 21) {
        m.terminada = true;
        credito = proximaMao(e);
      }
    } else if (passo === 'ficar') {
      m.terminada = true;
      credito = proximaMao(e);
    } else if (passo === 'dobrar') {
      if (m.cartas.length !== 2) erro('Só podes dobrar com duas cartas.');
      debito = m.aposta;
      m.aposta *= 2;
      m.dobrou = true;
      m.cartas.push(dar(e));
      m.terminada = true;
      credito = proximaMao(e);
    } else if (passo === 'dividir') {
      if (e.maos.length !== 1 || m.cartas.length !== 2 || valorCarta(m.cartas[0]) !== valorCarta(m.cartas[1])) erro('Não podes dividir esta mão.');
      debito = m.aposta;
      const ases = m.cartas[0].v === 'A';
      e.maos = [
        { cartas: [m.cartas[0]], aposta: m.aposta, deAses: ases },
        { cartas: [m.cartas[1]], aposta: m.aposta, deAses: ases },
      ];
      e.ativa = 0;
      credito = proximaMao(e);
    } else erro('Passo inválido.');
    return resultadoBJ(e, debito, credito);
  }

  // ================= entrada única =================
  const JOGOS = ['dados', 'crash', 'plinko', 'slots', 'roleta', 'minas', 'blackjack'];
  const COM_ESTADO = { crash: true, minas: true, blackjack: true };

  function passo(jogo, nomePasso, params, estado, rand, opcoes) {
    params = params || {};
    opcoes = opcoes || {};
    switch (jogo) {
      case 'dados': return dados(params, rand);
      case 'plinko': return plinko(params, rand);
      case 'slots': return slots(params, rand);
      case 'roleta': return roleta(params, rand);
      case 'crash': return crash(nomePasso || 'iniciar', params, estado, rand, opcoes);
      case 'minas': return minas(nomePasso || 'iniciar', params, estado, rand);
      case 'blackjack': return blackjack(nomePasso || 'iniciar', params, estado, rand);
      default: erro('Jogo desconhecido.');
    }
  }

  return { passo, JOGOS, COM_ESTADO, ErroJogo, PLINKO, SIMBOLOS, LINHAS, multMinas, total, valorCarta, ehBJ, cobre, cor, sortearCrash };
});
