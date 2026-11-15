// node test/mock-external.js & node test/manager-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
process.env.ADMIN_LOGINS = 'fabio_teste';
process.env.FRONTEND_URL = '*';
require('./fake-redis');
const assert = require('assert');
const fs = require('fs');
const manager = require('../api/manager.js');
const TM = require('../lib/manager/motor.js');
const { proximaHora } = require('../lib/manager/api.js');
function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(acao, body, token, method, extra) {
  const r = res();
  await manager({ method: method || (body ? 'POST' : 'GET'), body, query: Object.assign({ acao }, extra || {}), headers: token ? { authorization: 'Bearer ' + token } : {} }, r);
  return r;
}
const ADMIN = 'token-fabio-valido', VIEWER = 'token-outrapessoa-valida', AMIGO = 'token-amigo-valido';
(async () => {
  // o motor do site e o da API têm de ser iguais
  assert.equal(fs.readFileSync(__dirname + '/../lib/manager/motor.js', 'utf8'), fs.readFileSync(__dirname + '/../../fabiosilvatv/manager-motor.js', 'utf8'), 'motor diferente entre site e API');
  // próxima hora em Lisboa (inverno: UTC+0)
  const t = proximaHora(Date.UTC(2026, 10, 14, 15, 0), [14, 21]);
  assert.equal(new Date(t).toISOString(), '2026-11-14T21:00:00.000Z');
  const t2 = proximaHora(Date.UTC(2026, 6, 14, 22, 0), [14, 21]); // verão: UTC+1
  assert.equal(new Date(t2).toISOString(), '2026-07-15T13:00:00.000Z');

  let r = await call('liga');
  assert.equal(r.s, 200); assert.equal(r.j.mundo, null);
  r = await call('liga-admin', { op: 'criar', horas: [14, 21] }, VIEWER);
  assert.equal(r.s, 403);
  r = await call('liga-admin', { op: 'criar', horas: [21, 14] }, ADMIN);
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.deepEqual(r.j.info.horas, [14, 21]);
  r = await call('liga-entrar', {}, VIEWER);
  assert.equal(r.s, 200);
  const m = r.j.mundo; const meu = Object.values(m.clubes).find(c => c.hum === 'outrapessoa');
  assert.ok(meu && meu.div === 3 && meu.pais === 'PT', 'entra na 4.ª portuguesa'); assert.deepEqual(r.j.mundo.paises, ['PT','ES','IT','EN']);
  // escalação com ids de outro clube é limpa
  const outro = Object.values(m.clubes).find(c => !c.hum).pl[0];
  r = await call('liga-acao', { acao: 'escalacao', args: [{ tat: { f: '4-3-3', e: 'xx' }, xi: [meu.pl[0], outro], banco: [meu.pl[5]] }] }, VIEWER);
  assert.equal(r.s, 200);
  const c2 = r.j.mundo.clubes[meu.id];
  assert.equal(c2.tat.f, '4-3-3'); assert.equal(c2.tat.e, 'eq'); assert.equal(c2.xi[1], null);
  r = await call('liga-acao', { acao: 'bilhete', args: [9] }, VIEWER); assert.equal(r.j.mundo.clubes[meu.id].bil, 9);
  r = await call('liga-acao', { acao: 'emprestimo', args: [99999999] }, VIEWER); assert.equal(r.s, 400);
  r = await call('liga-acao', { acao: 'comprar', args: [outro] }, VIEWER); assert.ok(r.s === 200 || r.s === 400);
  // admin joga uma jornada agora
  r = await call('liga-admin', { op: 'jogar' }, ADMIN); assert.equal(r.j.resumo.passo, 1);
  r = await call('liga');
  assert.ok(r.j.mundo.ultimos && r.j.mundo.ultimos.jogos.length === 50);
  // carreira: só se guarda (sem equipa para desafios)
  const mc = TM.criarMundo(77); TM.assumirClube(mc, 'eu', 'ATL');
  r = await call('carreira-guardar', { mundo: mc, ts: 5 }, VIEWER); assert.equal(r.s, 200);
  r = await call('carreira', null, VIEWER); assert.equal(r.j.ts, 5); assert.ok(r.j.mundo.clubes.ATL.hum === 'eu');
  r = await call('carreira-apagar', {}, VIEWER); assert.equal(r.s, 200);
  r = await call('carreira', null, VIEWER); assert.equal(r.j.mundo, null);
  // desafios com os clubes da liga
  r = await call('desafios', null, VIEWER); assert.equal(r.j.lista.length, 0); assert.ok(r.j.eu && r.j.eu.elo === 1000);
  r = await call('desafiar', { adversario: 'fabio_teste' }, VIEWER); assert.equal(r.s, 404); // ainda não está na liga
  r = await call('liga-entrar', {}, ADMIN); assert.equal(r.s, 200);
  // batota no browser não serve de nada: a força vem do servidor
  r = await call('desafios', null, VIEWER); assert.equal(r.j.lista.length, 1); assert.equal(r.j.lista[0].login, 'fabio_teste');
  r = await call('desafiar', { adversario: 'fabio_teste' }, VIEWER); assert.equal(r.s, 200, JSON.stringify(r.j));
  console.log('desafio:', r.j.a.nome, r.j.gh, '-', r.j.ga, r.j.b.nome, 'elo', r.j.eloAntes, '->', r.j.eloDepois);
  r = await call('desafiar', { adversario: 'outrapessoa' }, VIEWER); assert.equal(r.s, 400);
  r = await call('ranking');
  assert.equal(r.j.desafios.length, 2); assert.ok(r.j.liga.find(x => x.login === 'outrapessoa')); assert.equal(r.j.carreiras, undefined);
  // apagar
  r = await call('liga-admin', { op: 'apagar' }, ADMIN); assert.equal(r.s, 200);
  r = await call('liga'); assert.equal(r.j.mundo, null);
  // ligas privadas
  r = await call('liga-criar', { nome: 'x' }, VIEWER); assert.equal(r.s, 400);
  r = await call('liga-criar', { nome: 'Liga dos Amigos', paises: ['ES', 'XX'], horas: [20, 99] }, VIEWER);
  assert.equal(r.s, 200, JSON.stringify(r.j)); const cod = r.j.id; assert.match(cod, /^[a-z0-9]{6}$/);
  assert.deepEqual(r.j.mundo.paises, ['PT', 'ES']); assert.deepEqual(r.j.info.horas, [20]); assert.equal(r.j.info.dono, 'outrapessoa');
  assert.ok(Object.values(r.j.mundo.clubes).find(c => c.hum === 'outrapessoa'));
  r = await call('liga', null, AMIGO, 'GET', { liga: cod }); assert.equal(r.s, 200); assert.equal(r.j.info.nome, 'Liga dos Amigos');
  r = await call('liga', null, AMIGO, 'GET', { liga: 'zzzzzz' }); assert.equal(r.j.mundo, null);
  r = await call('liga', null, AMIGO, 'GET', { liga: '../x' }); assert.equal(r.s, 400);
  r = await call('liga-entrar', { liga: 'zzzzzz' }, AMIGO); assert.equal(r.s, 404);
  r = await call('liga-entrar', { liga: cod.toUpperCase() }, AMIGO); assert.equal(r.s, 200);
  r = await call('minhas-ligas', null, AMIGO); assert.equal(r.j.ligas.length, 1); assert.equal(r.j.ligas[0].n, 2); assert.equal(r.j.ligas[0].souDono, false);
  r = await call('minhas-ligas', null, VIEWER); assert.equal(r.j.ligas[0].souDono, true);
  r = await call('liga-acao', { liga: cod, acao: 'bilhete', args: [12] }, AMIGO); assert.equal(r.s, 200);
  r = await call('liga-admin', { liga: cod, op: 'jogar' }, AMIGO); assert.equal(r.s, 403);
  r = await call('liga-admin', { liga: cod, op: 'jogar' }, VIEWER); assert.equal(r.s, 200); assert.equal(r.j.resumo.passo, 1);
  r = await call('liga-admin', { liga: cod, op: 'horas', horas: [13, 22] }, VIEWER); assert.deepEqual(r.j.info.horas, [13, 22]);
  r = await call('liga', null, null, 'GET'); // a oficial não mexe
  r = await call('liga-admin', { liga: cod, op: 'expulsar', alvo: 'amigo_teste' }, VIEWER); assert.equal(r.s, 200);
  r = await call('minhas-ligas', null, AMIGO); assert.equal(r.j.ligas.length, 0);
  r = await call('liga-entrar', { liga: cod }, AMIGO); assert.equal(r.s, 200);
  r = await call('liga-sair', { liga: cod }, VIEWER); assert.equal(r.s, 400); // o dono não sai
  r = await call('liga-sair', { liga: cod }, AMIGO); assert.equal(r.s, 200);
  r = await call('minhas-ligas', null, AMIGO); assert.equal(r.j.ligas.length, 0);
  r = await call('liga-criar', { nome: 'Segunda' }, VIEWER); assert.equal(r.s, 200);
  r = await call('liga-criar', { nome: 'Terceira' }, VIEWER); assert.equal(r.s, 409);
  r = await call('liga-admin', { liga: cod, op: 'apagar' }, VIEWER); assert.equal(r.s, 200);
  r = await call('minhas-ligas', null, VIEWER); assert.equal(r.j.ligas.length, 1);
  r = await call('liga', null, null, 'GET', { liga: cod }); assert.equal(r.j.mundo, null);
  console.log('TODOS OS TESTES DO FS MANAGER PASSARAM');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
