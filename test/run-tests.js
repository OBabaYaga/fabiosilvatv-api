// ===================================================================
// Testes da API da loja contra um StreamElements/Twitch de mentira e um
// Redis em memória. Corre com:
//   node test/mock-external.js      (terminal 1)
//   node test/run-tests.js          (terminal 2)
// ===================================================================
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.SE_API_BASE = 'http://localhost:4001/kappa/v2/points';
process.env.SE_CHANNEL_ID = 'fake-channel-id';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
process.env.ADMIN_LOGINS = 'fabio_teste';
require('./fake-redis');
const assert = require('assert');
const lojaApi = require('../api/loja.js');
const saldoApi = require('../api/saldo.js');

function res() { return { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(h, method, body, token, query) {
  const r = res(); await h({ method, body, query: query || {}, headers: Object.assign({ origin: 'https://fabiosilvatv.com' }, token ? { authorization: 'Bearer ' + token } : {}) }, r); return r;
}
const ADMIN = 'token-fabio-valido';      // fabio_teste — 500 pontos SE
const VIEWER = 'token-outrapessoa-valida'; // outrapessoa — 20 pontos SE

(async () => {
  let r = await call(lojaApi, 'GET');
  console.log('prémios:', r.j.produtos.map((p) => `${p.nome} (${p.preco}, stock ${p.stock})`).join(' | '));
  assert.equal(r.j.produtos.length, 5); assert.ok(r.j.produtos.every((p) => p.stock === 0));
  assert.equal(r.j.produtos.find((p) => p.id === 'amazon-25').imagem, 'assets/loja/amazon-25.jpg');
  assert.equal(r.h['Access-Control-Allow-Origin'], 'https://fabiosilvatv.com');

  // sem stock -> esgotado
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-25', dados: { email: 'a@b.pt' } }, ADMIN);
  assert.equal(r.j.code, 'ESGOTADO');

  // viewer não pode gerir
  r = await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'amazon-25', stock: 99 } }, VIEWER);
  assert.equal(r.s, 403);

  // admin define preço 100, stock 2, limite 1/mês
  r = await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'amazon-25', preco: 100, stock: 2, limitePorMes: 1 } }, ADMIN);
  assert.equal(r.s, 200); assert.equal(r.j.produto.preco, 100);

  // dados em falta / email errado
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-25', dados: { email: 'nao-e-email' } }, ADMIN);
  assert.equal(r.j.code, 'INVALIDO');

  // compra OK
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-25', dados: { email: 'fabio@exemplo.pt' } }, ADMIN);
  console.log('compra:', r.s, r.j.pedido && r.j.pedido.estado, 'saldo', r.j.saldo, 'pontos SE', r.j.pontos);
  assert.equal(r.j.saldo, 400); assert.equal(r.j.pontos, 500);
  const pedidoId = r.j.pedido.id;

  // limite mensal
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-25', dados: { email: 'fabio@exemplo.pt' } }, ADMIN);
  assert.equal(r.j.code, 'LIMITE');

  // viewer sem saldo (20 < 100) -> stock devolvido
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-25', dados: { email: 'x@y.pt' } }, VIEWER);
  assert.equal(r.j.code, 'SALDO');
  r = await call(lojaApi, 'GET'); assert.equal(r.j.produtos.find((p) => p.id === 'amazon-25').stock, 1);

  // admin dá 200 de saldo ao viewer; viewer compra a última unidade
  r = await call(lojaApi, 'POST', { acao: 'ajustar-saldo', username: '@OutraPessoa', quantidade: 200 }, ADMIN);
  assert.equal(r.j.saldo, 220);
  // casino tem de vir da lista
  await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'deposito-10', preco: 50, stock: 5 } }, ADMIN);
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'deposito-10', dados: { casino: 'Inventado', conta: 'abc' } }, VIEWER);
  assert.equal(r.j.code, 'INVALIDO');
  // duas compras ao mesmo tempo com saldo para 4 -> stock 5, ambas passam; depois saldo = 120
  const duas = await Promise.all([1, 2].map(() => call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'deposito-10', dados: { casino: 'SafeCasino', conta: 'user123' } }, VIEWER)));
  assert.deepEqual(duas.map((x) => x.s), [200, 200]);
  r = await call(lojaApi, 'POST', { acao: 'estado' }, VIEWER);
  console.log('viewer:', r.j.pontos, 'pontos SE /', r.j.saldo, 'saldo /', r.j.pedidos.length, 'pedidos');
  assert.equal(r.j.saldo, 120); assert.equal(r.j.pontos, 20); assert.equal(r.j.admin, false);

  // admin vê pedidos, recusa um (devolve 50 + stock), entrega outro
  r = await call(lojaApi, 'POST', { acao: 'admin' }, ADMIN);
  assert.equal(r.j.pedidos.length, 3);
  const doViewer = r.j.pedidos.filter((p) => p.login === 'outrapessoa');
  r = await call(lojaApi, 'POST', { acao: 'pedido', id: doViewer[0].id, estado: 'recusado', nota: 'Conta não encontrada' }, ADMIN);
  assert.equal(r.j.pedido.estado, 'recusado');
  r = await call(lojaApi, 'POST', { acao: 'pedido', id: doViewer[0].id, estado: 'recusado' }, ADMIN);
  assert.equal(r.s, 409); // não devolve duas vezes
  r = await call(lojaApi, 'POST', { acao: 'pedido', id: pedidoId, estado: 'entregue' }, ADMIN);
  assert.equal(r.j.pedido.estado, 'entregue');
  r = await call(saldoApi, 'GET', null, null, { username: 'outrapessoa' });
  assert.equal(r.j.saldo, 170); assert.equal(r.j.pontos, 20);
  r = await call(lojaApi, 'GET'); assert.equal(r.j.produtos.find((p) => p.id === 'deposito-10').stock, 4);

  // imagem: só ficheiros do site ou https
  r = await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'deposito-20', imagem: 'javascript:alert(1)' } }, ADMIN);
  assert.equal(r.j.produto.imagem, '');
  r = await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'deposito-20', imagem: 'assets/loja/deposito-20.jpg' } }, ADMIN);
  assert.equal(r.j.produto.imagem, 'assets/loja/deposito-20.jpg');

  // produto novo + desativar
  r = await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { nome: 'Shoutout', preco: 10, stock: 3, campos: [] } }, ADMIN);
  const novoId = r.j.produto.id;
  await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: novoId, ativo: false } }, ADMIN);
  r = await call(lojaApi, 'GET'); assert.ok(!r.j.produtos.find((p) => p.id === novoId));
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: novoId, dados: {} }, VIEWER); assert.equal(r.j.code, 'INVALIDO');

  r = await call(lojaApi, 'POST', { acao: 'estado' });
  assert.equal(r.s, 401);

  // ---------- RESET ----------
  const jogosApi = require('../api/jogos.js');
  await call(jogosApi, 'POST', { acao: 'jogar', jogo: 'dados', passo: 'iniciar', params: { aposta: 100, alvo: 50, acima: true } }, VIEWER);
  await call(jogosApi, 'POST', { acao: 'jogar', jogo: 'minas', passo: 'iniciar', params: { aposta: 10, minas: 3 } }, VIEWER);
  r = await call(lojaApi, 'POST', { acao: 'reset', saldos: true, fichas: true }, VIEWER); assert.equal(r.s, 403);
  r = await call(lojaApi, 'POST', { acao: 'reset', saldos: true, fichas: true, confirmar: 'sim' }, ADMIN); assert.equal(r.s, 400);
  r = await call(lojaApi, 'POST', { acao: 'estado' }, VIEWER); const antes = r.j;
  r = await call(lojaApi, 'POST', { acao: 'reset', saldos: true, fichas: true, confirmar: 'RESET' }, ADMIN);
  console.log('reset:', JSON.stringify(r.j), '| saldo do viewer antes', antes.saldo);
  assert.equal(r.s, 200); assert.equal(r.j.saldos.pessoas, 2);
  r = await call(lojaApi, 'POST', { acao: 'estado' }, VIEWER);
  assert.equal(r.j.saldo, 0); assert.equal(r.j.pontos, antes.pontos, 'pontos SE intactos'); assert.equal(r.j.pedidos.length, antes.pedidos.length);
  r = await call(lojaApi, 'POST', { acao: 'estado' }, ADMIN); assert.equal(r.j.saldo, 0);
  // depois do reset: ver a live volta a dar saldo
  await fetch('http://localhost:4001/kappa/v2/points/fake-channel-id/outrapessoa/75', { method: 'PUT' });
  r = await call(lojaApi, 'POST', { acao: 'estado' }, VIEWER); assert.equal(r.j.saldo, 75);
  // e comprar desconta normalmente
  await call(lojaApi, 'POST', { acao: 'guardar-produto', produto: { id: 'amazon-50', preco: 70, stock: 1 } }, ADMIN);
  r = await call(lojaApi, 'POST', { acao: 'comprar', produtoId: 'amazon-50', dados: { email: 'x@y.pt' } }, VIEWER);
  assert.equal(r.j.saldo, 5);
  // fichas: ranking vazio, jogo a meio apagado, volta às 1000
  r = await call(jogosApi, 'GET'); assert.equal(r.j.top.length, 0);
  r = await call(jogosApi, 'POST', { acao: 'estado' }, VIEWER);
  assert.equal(r.j.fichas, 1000); assert.ok(!r.j.ativos.minas);
  console.log('TODOS OS TESTES PASSARAM');
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
