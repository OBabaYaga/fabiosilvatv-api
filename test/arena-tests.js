// Testes da Arena 4v4: node test/mock-external.js & node test/arena-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
require('./fake-redis');
const assert = require('assert');
const api = require('../api/arena.js');

function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, { body, query, token } = {}) {
  const r = res();
  const headers = { origin: 'https://fabiosilvatv.com' };
  if (token) headers.authorization = 'Bearer ' + token;
  await api({ method, body, query: query || {}, headers }, r);
  return r;
}
const FABIO = 'token-fabio-valido', OUTRA = 'token-outrapessoa-valida', AMIGO = 'token-amigo-valido';

(async () => {
  let r = await call('POST', { body: { acao: 'criar' } });
  assert.strictEqual(r.s, 401);

  r = await call('POST', { token: FABIO, body: { acao: 'criar', nome: 'Fabio', titulo: 'Sala <b>top</b>' } });
  assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  const cod = r.j.sala.cod;
  assert.match(cod, /^[A-Z2-9]{5}$/);
  assert.strictEqual(r.j.sala.host, 'fabio_teste');
  assert.ok(!/[<>]/.test(r.j.sala.nome));

  r = await call('GET', { query: { acao: 'ver', cod: cod.toLowerCase() } });
  assert.strictEqual(r.s, 200); assert.strictEqual(r.j.sala.cod, cod);
  r = await call('GET', { query: { acao: 'ver', cod: 'ZZZZZ' } });
  assert.strictEqual(r.s, 404);

  r = await call('GET', { query: { acao: 'lista' } });
  assert.strictEqual(r.j.salas.length, 1);

  // jogador -> anfitrião
  r = await call('POST', { token: OUTRA, body: { acao: 'sinal', cod, para: 'fabio_teste', tipo: 'oferta', dados: { sdp: 'x' }, nome: 'Outra' } });
  assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  // jogador -> jogador (proibido)
  r = await call('POST', { token: OUTRA, body: { acao: 'sinal', cod, para: 'amigo_teste', tipo: 'oferta', dados: {} } });
  assert.strictEqual(r.s, 403);
  // tipo inválido
  r = await call('POST', { token: OUTRA, body: { acao: 'sinal', cod, para: 'fabio_teste', tipo: 'hack', dados: {} } });
  assert.strictEqual(r.s, 400);
  // grande demais
  r = await call('POST', { token: OUTRA, body: { acao: 'sinal', cod, para: 'fabio_teste', tipo: 'ice', dados: 'x'.repeat(30000) } });
  assert.strictEqual(r.s, 413);
  await call('POST', { token: OUTRA, body: { acao: 'sinal', cod, para: 'fabio_teste', tipo: 'ice', dados: { c: 1 } } });

  r = await call('GET', { token: FABIO, query: { acao: 'sinais', cod } });
  assert.strictEqual(r.j.msgs.length, 2);
  assert.strictEqual(r.j.msgs[0].tipo, 'oferta'); // pela ordem de chegada
  assert.strictEqual(r.j.msgs[0].de, 'outrapessoa');
  r = await call('GET', { token: FABIO, query: { acao: 'sinais', cod } });
  assert.strictEqual(r.j.msgs.length, 0);

  // anfitrião -> jogador
  await call('POST', { token: FABIO, body: { acao: 'sinal', cod, para: 'outrapessoa', tipo: 'resposta', dados: { sdp: 'y' } } });
  r = await call('GET', { token: OUTRA, query: { acao: 'sinais', cod } });
  assert.strictEqual(r.j.msgs[0].tipo, 'resposta');

  // estado: só o anfitrião
  r = await call('POST', { token: OUTRA, body: { acao: 'estado', cod, n: 5 } });
  assert.strictEqual(r.s, 403);
  r = await call('POST', { token: FABIO, body: { acao: 'estado', cod, n: 5, estado: 'jogo', placar: '3-2', mapa: 'casino' } });
  assert.strictEqual(r.s, 200);
  r = await call('GET', { query: { acao: 'lista' } });
  assert.strictEqual(r.j.salas[0].n, 5); assert.strictEqual(r.j.salas[0].placar, '3-2'); assert.strictEqual(r.j.salas[0].mapa, 'casino');

  // sala privada não aparece na lista
  r = await call('POST', { token: AMIGO, body: { acao: 'criar', publica: false } });
  const priv = r.j.sala.cod;
  r = await call('GET', { query: { acao: 'lista' } });
  assert.ok(!r.j.salas.some((s) => s.cod === priv));

  // fechar
  r = await call('POST', { token: OUTRA, body: { acao: 'fechar', cod } });
  assert.strictEqual(r.s, 403);
  r = await call('POST', { token: FABIO, body: { acao: 'fechar', cod } });
  assert.strictEqual(r.s, 200);
  r = await call('GET', { query: { acao: 'ver', cod } });
  assert.strictEqual(r.s, 404);
  console.log('arena: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
