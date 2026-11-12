// Testes do modo Ranking dos minijogos (fichas ganhas a ver a live). Corre com:
//   node test/mock-external.js   (terminal 1)
//   node test/jogos-tests.js     (terminal 2)
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.SE_API_BASE = 'http://localhost:4001/kappa/v2/points';
process.env.SE_CHANNEL_ID = 'fake-channel-id';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
const store = require('./fake-redis');
const assert = require('assert');
const api = require('../api/jogos.js');
const Motor = require('../lib/og-motor');

function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, body, token) {
  const r = res(); await api({ method, body, query: {}, headers: Object.assign({ origin: 'https://fabiosilvatv.com' }, token ? { authorization: 'Bearer ' + token } : {}) }, r); return r;
}
const A = 'token-fabio-valido', B = 'token-outrapessoa-valida';
const jogar = (t, jogo, passo, params) => call('POST', { acao: 'jogar', jogo, passo, params }, t);

(async () => {
  let r = await call('POST', { acao: 'estado' });
  assert.equal(r.s, 401);
  r = await call('POST', { acao: 'estado' }, A);
  assert.equal(r.j.fichas, 1000); assert.equal(r.j.ganhoAgora, 0);
  // "vê a live": a StreamElements dá +500 pontos -> +500 fichas (depois da espera de 2 min)
  await fetch('http://localhost:4001/kappa/v2/points/fake-channel-id/fabio_teste/500', { method: 'PUT' });
  r = await call('POST', { acao: 'estado' }, A);
  assert.equal(r.j.fichas, 1000, 'ainda dentro da espera');
  store.delete('fstv:fsync:fabio_teste');
  r = await call('POST', { acao: 'estado' }, A);
  assert.equal(r.j.fichas, 1500); assert.equal(r.j.ganhoAgora, 500);
  // pontos gastos/repostos na StreamElements não tiram fichas
  await fetch('http://localhost:4001/kappa/v2/points/fake-channel-id/fabio_teste/-900', { method: 'PUT' });
  store.delete('fstv:fsync:fabio_teste');
  r = await call('POST', { acao: 'estado' }, A); assert.equal(r.j.fichas, 1500);

  // aposta maior do que o saldo
  r = await jogar(A, 'dados', 'iniciar', { aposta: 999999, alvo: 50, acima: true });
  assert.equal(r.j.code, 'SALDO');
  // parâmetros inválidos
  r = await jogar(A, 'dados', 'iniciar', { aposta: 10, alvo: 99.5, acima: true });
  assert.equal(r.j.code, 'INVALIDO');
  r = await jogar(A, 'dados', 'iniciar', { aposta: 1.5, alvo: 50, acima: true });
  assert.equal(r.j.code, 'INVALIDO');
  // crash sem recolha automática não é permitido no ranking
  r = await jogar(A, 'crash', 'iniciar', { aposta: 10 });
  assert.equal(r.j.code, 'INVALIDO');

  // contabilidade: fichas finais = 1500 - débitos + créditos
  let esperado = 1500;
  const jogadas = [
    ['dados', { aposta: 10, alvo: 50.5, acima: true }], ['crash', { aposta: 10, auto: 1.5 }], ['plinko', { aposta: 10, linhas: 16, risco: 'alto' }],
    ['slots', { aposta: 10 }], ['roleta', { apostas: { 'cor:vermelho': 5, 'n:17': 2 } }],
  ];
  for (let i = 0; i < 40; i++) {
    const [j, p] = jogadas[i % jogadas.length];
    r = await jogar(A, j, 'iniciar', p);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    esperado += r.j.credito - r.j.debito;
    assert.equal(r.j.fichas, esperado);
  }
  // o crash não revela nada antes; devolve crashAt já resolvido
  r = await jogar(A, 'crash', 'iniciar', { aposta: 10, auto: 2 }); esperado += r.j.credito - r.j.debito;
  assert.ok(r.j.view.crashAt >= 1 && r.j.fim);

  // minas: estado no servidor, não revela as minas até acabar
  r = await jogar(A, 'minas', 'iniciar', { aposta: 20, minas: 3 }); esperado -= 20;
  assert.equal(r.j.view.minas, undefined); assert.equal(r.j.fim, false);
  r = await jogar(A, 'minas', 'iniciar', { aposta: 20, minas: 3 });
  assert.equal(r.j.code, 'A_DECORRER');
  r = await call('POST', { acao: 'estado' }, A);
  assert.ok(r.j.ativos.minas && r.j.ativos.minas.minas === undefined);
  // descobre uma casa segura olhando para o "Redis" (só no teste)
  const est = JSON.parse(store.get('fstv:jogo:fabio_teste:minas')).estado;
  const segura = [...Array(25).keys()].find((i) => !est.minas.includes(i));
  r = await jogar(A, 'minas', 'abrir', { i: segura }); assert.equal(r.j.fim, false);
  r = await jogar(A, 'minas', 'abrir', { i: segura }); assert.equal(r.j.code, 'INVALIDO');
  r = await jogar(A, 'minas', 'recolher', {}); esperado += r.j.credito;
  assert.ok(r.j.fim && r.j.view.minas.length === 3); assert.equal(r.j.credito, Math.floor(20 * Motor.multMinas(3, 1)));
  r = await jogar(A, 'minas', 'recolher', {}); assert.equal(r.j.code, 'SEM_JOGO');

  // blackjack até ao fim, a carta virada do dealer nunca vem no view antes do fim
  for (let k = 0; k < 15; k++) {
    r = await jogar(A, 'blackjack', 'iniciar', { aposta: 10 }); esperado += r.j.credito - r.j.debito;
    while (!r.j.fim) {
      assert.equal(r.j.view.dealer[1].v, undefined);
      const m = r.j.view.maos[r.j.view.ativa];
      const passo = r.j.view.podeDividir ? 'dividir' : Motor.total(m.cartas).t < 12 && r.j.view.podeDobrar ? 'dobrar' : Motor.total(m.cartas).t < 17 ? 'pedir' : 'ficar';
      r = await jogar(A, 'blackjack', passo, {}); assert.equal(r.s, 200, JSON.stringify(r.j));
      esperado += r.j.credito - r.j.debito;
    }
    assert.ok(r.j.view.dealer[1].v);
    assert.equal(r.j.fichas, esperado);
  }

  // trinco: duas jogadas ao mesmo tempo -> uma é recusada
  const duas = await Promise.all([1, 2].map(() => jogar(A, 'dados', 'iniciar', { aposta: 1, alvo: 50, acima: true })));
  duas.forEach((x) => { if (x.s === 200) esperado += x.j.credito - x.j.debito; });
  console.log('em simultâneo:', duas.map((x) => x.s).join(', '));
  assert.ok(duas.some((x) => x.s === 200));

  // segundo jogador: perde tudo -> fica a 0 -> vê a live -> volta a jogar
  await call('POST', { acao: 'estado' }, B);
  r = await jogar(B, 'dados', 'iniciar', { aposta: 1000, alvo: 2, acima: false }); // 2% de ganhar
  let fb = r.j.fichas;
  while (fb > 0) { r = await jogar(B, 'dados', 'iniciar', { aposta: fb, alvo: 2, acima: false }); fb = r.j.fichas; }
  r = await jogar(B, 'dados', 'iniciar', { aposta: 1, alvo: 50, acima: true });
  assert.equal(r.j.code, 'SALDO'); console.log('a zero:', r.j.error);
  await fetch('http://localhost:4001/kappa/v2/points/fake-channel-id/outrapessoa/120', { method: 'PUT' });
  store.delete('fstv:fsync:outrapessoa');
  r = await jogar(B, 'dados', 'iniciar', { aposta: 10, alvo: 50, acima: true });
  assert.equal(r.s, 200); assert.equal(r.j.ganhoAgora, 120); assert.equal(r.j.fichas, 110 + r.j.credito);
  r = await call('GET');
  console.log('ranking:', r.j.top.map((t) => `${t.login} ${t.fichas}`).join(' | '), '| jogadores', r.j.jogadores);
  assert.equal(r.j.top.length, 2); assert.equal(r.j.top.find((t) => t.login === 'fabio_teste').fichas, esperado);
  r = await call('POST', { acao: 'estado' }, A);
  assert.ok(r.j.posicao >= 1); assert.equal(r.j.fichas, esperado);

  // nada disto tocou no saldo da loja
  assert.ok(![...store.keys()].some((k) => k.startsWith('fstv:saldo')));
  console.log('OK — todos os testes dos jogos passaram. Fichas finais:', esperado);
})().catch((e) => { console.error(e); process.exit(1); });
