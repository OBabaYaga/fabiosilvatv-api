// Testes do Rally: node test/mock-external.js & node test/rally-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
require('./fake-redis');
const assert = require('assert');
const api = require('../api/rally.js');
function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, { body, query, token } = {}) {
  const r = res(); const headers = { origin: 'https://fabiosilvatv.com' };
  if (token) headers.authorization = 'Bearer ' + token;
  await api({ method, body, query: query || {}, headers }, r); return r;
}
(async () => {
  let r = await call('GET', { query: { pista: 'douro' } });
  assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.lista, []);
  r = await call('POST', { body: { acao: 'tempo', pista: 'douro', ms: 60000 } });
  assert.strictEqual(r.s, 401);
  r = await call('POST', { token: 'token-fabio-valido', body: { acao: 'tempo', pista: 'douro', ms: 1000 } });
  assert.strictEqual(r.s, 400); // impossível
  r = await call('POST', { token: 'token-fabio-valido', body: { acao: 'tempo', pista: 'marte', ms: 60000 } });
  assert.strictEqual(r.s, 400);
  r = await call('POST', { token: 'token-fabio-valido', body: { acao: 'tempo', pista: 'douro', ms: 61234, nome: 'Fabio <b>' } });
  assert.strictEqual(r.s, 200); assert.ok(r.j.melhorou); assert.strictEqual(r.j.posicao, 1);
  r = await call('POST', { token: 'token-outrapessoa-valida', body: { acao: 'tempo', pista: 'douro', ms: 59000, nome: 'Outra' } });
  assert.strictEqual(r.j.posicao, 1);
  r = await call('POST', { token: 'token-fabio-valido', body: { acao: 'tempo', pista: 'douro', ms: 65000 } });
  assert.strictEqual(r.j.melhorou, false); assert.strictEqual(r.j.recorde, 61234); assert.strictEqual(r.j.posicao, 2);
  r = await call('GET', { query: { pista: 'douro' } });
  assert.deepStrictEqual(r.j.lista.map((x) => x.nome + ':' + x.ms), ['Outra:59000', 'Fabio b:61234'].map((s) => s.replace('Fabio b', r.j.lista[1].nome)));
  assert.ok(!/[<>]/.test(r.j.lista[1].nome));
  console.log('rally: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
