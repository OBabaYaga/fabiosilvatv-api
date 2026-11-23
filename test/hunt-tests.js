// Testes da hunt ao vivo: node test/mock-external.js & node test/hunt-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
process.env.ADMIN_LOGINS = 'fabio_teste';
process.env.HUNT_SYNC_KEY = 'chave-secreta-de-teste';
require('./fake-redis');
const assert = require('assert');
const api = require('../api/hunt.js');

function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, { body, query, token, key } = {}) {
  const r = res();
  const headers = { origin: 'https://fabiosilvatv.com' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (key) headers['x-hunt-key'] = key;
  await api({ method, body, query: query || {}, headers }, r);
  return r;
}

const HUNT = {
  name: 'Hunt de terça', phase: 'OPENING', num: '12', cur: '€',
  items: [
    { name: 'Rotten', prov: 'Hacksaw', img: 'https://imgxcut.com/game/image/abc.png?_v=4', bet: 0.4, payout: '255.56', opened: true },
    { name: 'Joker <script>', prov: 'Bullshark', img: 'javascript:alert(1)', bet: 0.6, payout: '', opened: false, sup: true },
  ],
};
const STATS = { n: 2, opened: 1, totalBet: 1, paid: 255.56, cost: 500, be: 500, avg: 638.9, need: 407, pnl: -244.44, best: 638.9, worst: 638.9 };

(async () => {
  // sem hunt
  let r = await call('GET');
  assert.equal(r.s, 200); assert.equal(r.j.hunt, null);

  // sync sem autorização
  r = await call('POST', { body: { acao: 'sync', id: 'h12-20261124', hunt: HUNT, stats: STATS } });
  assert.equal(r.s, 403);
  r = await call('POST', { body: { acao: 'sync', id: 'h12-20261124', hunt: HUNT, stats: STATS }, token: 'token-outrapessoa-valida' });
  assert.equal(r.s, 403);
  r = await call('POST', { body: { acao: 'sync', id: 'h12-20261124', hunt: HUNT, stats: STATS }, key: 'errada-errada-errada-erradaa' });
  assert.equal(r.s, 403);

  // sync com a chave e com o token do streamer
  r = await call('POST', { body: { acao: 'sync', id: 'h12-20261124', hunt: HUNT, stats: STATS }, key: 'chave-secreta-de-teste' });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  r = await call('POST', { body: { acao: 'sync', id: 'h12-20261124', hunt: HUNT, stats: STATS, guess: { estado: 'aberto', premio: 500 } }, token: 'token-fabio-valido' });
  assert.equal(r.s, 200); assert.equal(r.j.guess, 'aberto');

  // id inválido
  r = await call('POST', { body: { acao: 'sync', id: '../x', hunt: HUNT }, key: 'chave-secreta-de-teste' });
  assert.equal(r.s, 400);

  // leitura pública: texto limpo, imagem perigosa fora, pagamento só nos abertos
  r = await call('GET');
  const h = r.j.hunt;
  assert.equal(h.nome, 'Hunt de terça');
  assert.equal(h.itens.length, 2);
  assert.equal(h.itens[1].n, 'Joker script');
  assert.equal(h.itens[1].img, '');
  assert.equal(h.itens[1].pay, null);
  assert.equal(h.itens[0].pay, 255.56);
  assert.equal(h.stats.custo, 500);
  assert.equal(h.guess.estado, 'aberto');
  assert.equal(h.aoVivo, true);

  // palpites
  r = await call('POST', { body: { acao: 'palpite', valor: 300 } });
  assert.equal(r.s, 401);
  r = await call('POST', { body: { acao: 'palpite', valor: '312,50', nome: 'OutraPessoa' }, token: 'token-outrapessoa-valida' });
  assert.equal(r.s, 200); assert.equal(r.j.valor, 312.5); assert.equal(r.j.alterado, false);
  r = await call('POST', { body: { acao: 'palpite', valor: 290 }, token: 'token-outrapessoa-valida' });
  assert.equal(r.j.alterado, true);
  r = await call('POST', { body: { acao: 'palpite', valor: 800 }, token: 'token-amigo-valido' });
  assert.equal(r.s, 200);
  r = await call('POST', { body: { acao: 'palpite', valor: 0 }, token: 'token-amigo-valido' });
  assert.equal(r.s, 400);
  r = await call('POST', { body: { acao: 'palpite', valor: 100 }, token: 'token-fabio-valido' });
  assert.equal(r.s, 403);

  r = await call('GET', { query: { acao: 'meu' }, token: 'token-outrapessoa-valida' });
  assert.equal(r.j.palpite.valor, 290);

  // o servidor lê os palpites
  r = await call('GET', { query: { acao: 'palpites' } });
  assert.equal(r.s, 403);
  r = await call('GET', { query: { acao: 'palpites' }, key: 'chave-secreta-de-teste' });
  assert.equal(r.j.palpites.length, 2);

  // fecha: deixa de aceitar
  await call('POST', { body: { acao: 'sync', id: 'h12-20261124', guess: { estado: 'espera' } }, key: 'chave-secreta-de-teste' });
  r = await call('POST', { body: { acao: 'palpite', valor: 1 }, token: 'token-amigo-valido' });
  assert.equal(r.s, 409);
  r = await call('GET');
  assert.equal(r.j.hunt.itens.length, 2, 'um sync só com o guess mantém os bónus');
  assert.equal(r.j.hunt.guess.premio, 500, 'o prémio mantém-se');

  // resolve: pódio calculado com os palpites do site
  await call('POST', { body: { acao: 'sync', id: 'h12-20261124', guess: { estado: 'resolvido', alvo: 300, vencedor: { user: 'OutraPessoa', valor: 290, dif: 10 }, pago: true } }, key: 'chave-secreta-de-teste' });
  r = await call('GET');
  assert.equal(r.j.hunt.guess.vencedor.nome, 'OutraPessoa');
  assert.equal(r.j.hunt.guess.podio[0].nome, 'OutraPessoa');
  assert.equal(r.j.hunt.guess.podio[1].dif, 500);

  // segunda hunt: a primeira fica no arquivo
  await call('POST', { body: { acao: 'sync', id: 'h13-20261125', hunt: Object.assign({}, HUNT, { num: '13', name: 'Hunt de quarta' }), stats: STATS }, key: 'chave-secreta-de-teste' });
  r = await call('GET');
  assert.equal(r.j.hunt.id, 'h13-20261125');
  assert.equal(r.j.hunt.guess.estado, 'fechado');
  r = await call('GET', { query: { acao: 'lista' } });
  assert.equal(r.j.total, 2);
  assert.equal(r.j.hunts[0].id, 'h13-20261125');
  assert.equal(r.j.hunts[1].vencedor, 'OutraPessoa');
  r = await call('GET', { query: { acao: 'ver', id: 'h12-20261124' } });
  assert.equal(r.j.hunt.nome, 'Hunt de terça');
  r = await call('GET', { query: { acao: 'ver', id: 'nao-existe' } });
  assert.equal(r.s, 404);

  // apagar uma hunt de teste
  r = await call('POST', { body: { acao: 'apagar', id: 'h12-20261124' }, key: 'chave-secreta-de-teste' });
  assert.equal(r.s, 200);
  r = await call('GET', { query: { acao: 'lista' } });
  assert.equal(r.j.total, 1);

  console.log('hunt: todos os testes passaram');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
