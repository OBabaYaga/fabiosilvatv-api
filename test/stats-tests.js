// Testes das estatísticas: node test/mock-external.js & node test/stats-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
process.env.ADMIN_LOGINS = 'fabio_teste';
require('./fake-redis');
const assert = require('assert');
const api = require('../api/stats.js');
const st = require('../lib/stats.js');
function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, body, { token, ip = '1.1.1.1', ua = 'Mozilla/5.0 Chrome/130', query } = {}) {
  const r = res();
  await api({ method, body: typeof body === 'string' ? body : body, query: query || {}, headers: Object.assign({ origin: 'https://fabiosilvatv.com', 'x-forwarded-for': ip + ', 10.0.0.1', 'user-agent': ua }, token ? { authorization: 'Bearer ' + token } : {}) }, r);
  return r;
}
(async () => {
  assert.equal(st.origem('https://www.twitch.tv/fabiosilva_tv'), 'Twitch');
  assert.equal(st.origem('https://l.instagram.com/?u=x'), 'Instagram');
  assert.equal(st.origem('https://www.google.pt/'), 'Google');
  assert.equal(st.origem('https://fabiosilvatv.com/casinos.html'), null);
  assert.equal(st.origem(''), 'Direto');
  assert.equal(st.paginaValida('/'), '/index.html');
  assert.equal(st.paginaValida('/casinos.html?x=1'), '/casinos.html');
  assert.equal(st.paginaValida('/../../etc'), null);

  // pessoa A: 3 páginas; pessoa B: 1 página; um bot: ignorado
  await call('POST', JSON.stringify({ t: 'v', p: '/', n: 1, r: 'https://www.twitch.tv/fabiosilva_tv' }));
  await call('POST', { t: 'v', p: '/casinos.html', n: 2, r: 'https://fabiosilvatv.com/' });
  await call('POST', { t: 'v', p: '/casinos.html', n: 3 });
  await call('POST', { t: 'v', p: '/index.html', n: 1, r: '' }, { ip: '2.2.2.2' });
  let r = await call('POST', { t: 'v', p: '/', n: 1 }, { ua: 'Googlebot/2.1' });
  assert.equal(r.j.ignorado, 'bot');
  // cliques
  await call('POST', { t: 'c', m: 'coldbet', s: 'casinos:cartao' });
  await call('POST', { t: 'c', m: 'coldbet', s: 'inicio:popup' }, { ip: '2.2.2.2' });
  await call('POST', { t: 'c', m: 'royalxo', s: 'casinos:termos' });
  await call('POST', { t: 'c', m: 'hackers<script>', s: 'x:y' });

  r = await call('GET', null);
  assert.equal(r.s, 403);
  r = await call('GET', null, { token: 'token-outrapessoa-valida' });
  assert.equal(r.s, 403);
  r = await call('GET', null, { token: 'token-fabio-valido', query: { dias: '30' } });
  assert.equal(r.s, 200);
  const j = r.j;
  console.log('hoje:', j.hoje, '\nmês:', JSON.stringify(j.mes), '\nano meses:', j.ano.meses.filter(m => m.visitas).map(m => m.id + ' ' + m.visitantes + '/' + m.visitas));
  assert.equal(j.dias.length, 30);
  assert.equal(j.hoje.visitantes, 2);
  assert.equal(j.hoje.visitas, 4);
  assert.equal(j.hoje.cliques, 4);
  assert.equal(j.mes.visitantes, 2); assert.equal(j.ano.visitantes, 2);
  assert.equal(j.mes.paginas['/casinos.html'], 2); assert.equal(j.mes.paginas['/index.html'], 2);
  assert.deepEqual(j.mes.origens, { Twitch: 1, Direto: 1 });
  assert.equal(j.mes.porMarca.coldbet, 2); assert.equal(j.mes.porMarca.royalxo, 1); assert.equal(j.mes.porMarca.outro, 1);
  assert.equal(j.mes.porSitio.coldbet['inicio:popup'], 1);
  assert.equal(j.mes.porSitio.outro['outra:outro'], 1);
  assert.equal(j.ano.meses.find(m => m.id === j.mes.id).visitas, 4);
  console.log('\nTODOS OS TESTES DAS ESTATISTICAS PASSARAM');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
