// ===================================================================
// Arena 4v4 — salas e sinalização WebRTC.
//
// O jogo corre no browser: o PC de quem cria a sala é o anfitrião e os
// outros ligam-se a ele por WebRTC. Esta API só serve para:
//   • criar a sala e dar-lhe um código (ex: K7P2M);
//   • entregar as mensagens de ligação (oferta/resposta/ICE) entre o
//     anfitrião e cada jogador, até o canal direto abrir;
//   • listar as salas abertas no site.
// O jogo em si (posições, tiros, rondas) nunca passa por aqui.
//
// Chaves Redis:
//   fstv:arena:sala:<COD>          JSON da sala (expira 3 h)
//   fstv:arena:salas               zset COD → última atividade
//   fstv:arena:cx:<COD>:<login>    lista de mensagens para esse login
//   fstv:arena:tok:<hash>          login do token (cache 10 min)
// ===================================================================

const crypto = require('crypto');
const { kv, P, parse } = require('./store');
const { validateTwitchToken } = require('./twitch');

const K = {
  sala: (c) => P + 'arena:sala:' + c,
  salas: P + 'arena:salas',
  cx: (c, l) => P + 'arena:cx:' + c + ':' + l,
  tok: (h) => P + 'arena:tok:' + h,
};

const VIDA_SALA = 3 * 60 * 60;      // segundos
const VIDA_CX = 10 * 60;
const MAX_JOG = 8;
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1

const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const codigoValido = (c) => (/^[A-Z2-9]{5}$/.test(String(c || '').toUpperCase()) ? String(c).toUpperCase() : null);
const loginValido = (l) => (/^[a-z0-9_]{1,25}$/.test(String(l || '')) ? String(l) : null);

// Validar o token na Twitch a cada pedido seria lento (e a sinalização
// faz vários por segundo). Guarda-se o login durante 10 minutos.
async function utilizador(token) {
  if (!token) return null;
  const h = crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
  const guardado = await kv.get(K.tok(h));
  if (guardado) return parse(guardado);
  const u = await validateTwitchToken(token);
  if (!u) return null;
  await kv.set(K.tok(h), JSON.stringify(u), { ex: 600 });
  return u;
}

async function lerSala(cod) {
  const s = parse(await kv.get(K.sala(cod)));
  return s && typeof s === 'object' ? s : null;
}
async function gravarSala(s) {
  await kv.set(K.sala(s.cod), JSON.stringify(s), { ex: VIDA_SALA });
  await kv.zadd(K.salas, { score: Date.now(), member: s.cod });
}

async function criar(user, body) {
  let cod = null;
  for (let i = 0; i < 8 && !cod; i++) {
    let c = '';
    for (let j = 0; j < 5; j++) c += LETRAS[crypto.randomInt(LETRAS.length)];
    if (!(await kv.get(K.sala(c)))) cod = c;
  }
  if (!cod) return { status: 503, json: { error: 'Tenta outra vez.' } };
  const sala = {
    cod,
    host: user.login,
    hostNome: txt(body.nome, 25) || user.login,
    nome: txt(body.titulo, 40) || 'Sala de ' + (txt(body.nome, 25) || user.login),
    jogo: body.jogo === 'bilhar' ? 'bilhar' : 'arena',
    mapa: txt(body.mapa, 20) || 'docas',
    publica: body.publica !== false,
    n: 1,
    estado: 'lobby',
    criada: Date.now(),
    vista: Date.now(),
  };
  await gravarSala(sala);
  return { status: 200, json: { sala } };
}

async function ver(cod) {
  cod = codigoValido(cod);
  if (!cod) return { status: 400, json: { error: 'Código inválido.' } };
  const s = await lerSala(cod);
  if (!s) return { status: 404, json: { error: 'Esta sala já não existe.' } };
  return { status: 200, json: { sala: s } };
}

// O anfitrião diz de vez em quando quantos jogadores tem e em que fase está.
async function estado(user, body) {
  const cod = codigoValido(body.cod);
  if (!cod) return { status: 400, json: { error: 'Código inválido.' } };
  const s = await lerSala(cod);
  if (!s) return { status: 404, json: { error: 'Esta sala já não existe.' } };
  if (s.host !== user.login) return { status: 403, json: { error: 'Só quem criou a sala.' } };
  s.n = Math.max(1, Math.min(MAX_JOG, parseInt(body.n, 10) || 1));
  s.estado = ['lobby', 'jogo', 'fim'].includes(body.estado) ? body.estado : s.estado;
  s.placar = txt(body.placar, 12);
  if (['docas', 'lisboa', 'casino', 'aldeia'].includes(body.mapa)) s.mapa = body.mapa;
  s.vista = Date.now();
  await gravarSala(s);
  return { status: 200, json: { ok: true } };
}

async function fechar(user, body) {
  const cod = codigoValido(body.cod);
  if (!cod) return { status: 400, json: { error: 'Código inválido.' } };
  const s = await lerSala(cod);
  if (s && s.host !== user.login) return { status: 403, json: { error: 'Só quem criou a sala.' } };
  await kv.del(K.sala(cod));
  await kv.zrem(K.salas, cod);
  return { status: 200, json: { ok: true } };
}

// Salas públicas com atividade nos últimos 2 minutos
async function lista(q = {}) {
  const jogo = q.jogo === 'bilhar' ? 'bilhar' : 'arena';
  const limite = Date.now() - 2 * 60 * 1000;
  await kv.zremrangebyscore(K.salas, 0, limite);
  const cods = await kv.zrange(K.salas, 0, 29, { rev: true });
  const salas = [];
  for (const c of cods) {
    const s = await lerSala(c);
    if (s && s.publica && (s.jogo || 'arena') === jogo) salas.push({ jogo, cod: s.cod, nome: s.nome, hostNome: s.hostNome, n: s.n, estado: s.estado, placar: s.placar || '', mapa: s.mapa });
  }
  return { status: 200, json: { salas } };
}

// Mensagem de ligação para outro jogador da mesma sala
async function sinal(user, body) {
  const cod = codigoValido(body.cod);
  const para = loginValido(String(body.para || '').toLowerCase());
  if (!cod || !para) return { status: 400, json: { error: 'Pedido inválido.' } };
  const tipo = ['ola', 'oferta', 'resposta', 'ice', 'recusa'].includes(body.tipo) ? body.tipo : null;
  if (!tipo) return { status: 400, json: { error: 'Tipo inválido.' } };
  const dados = body.dados == null ? null : body.dados;
  const bruto = JSON.stringify({ de: user.login, nome: txt(body.nome, 25) || user.login, tipo, dados, t: Date.now() });
  if (bruto.length > 20000) return { status: 413, json: { error: 'Mensagem grande demais.' } };
  const s = await lerSala(cod);
  if (!s) return { status: 404, json: { error: 'Esta sala já não existe.' } };
  // só se fala com o anfitrião, ou o anfitrião com os jogadores
  if (user.login !== s.host && para !== s.host) return { status: 403, json: { error: 'Só se fala com o anfitrião.' } };
  const k = K.cx(cod, para);
  await kv.lpush(k, bruto);
  await kv.ltrim(k, 0, 199);
  await kv.expire(k, VIDA_CX);
  return { status: 200, json: { ok: true } };
}

// Mensagens que estão à espera deste jogador (e apaga-as)
async function sinais(user, q) {
  const cod = codigoValido(q.cod);
  if (!cod) return { status: 400, json: { error: 'Código inválido.' } };
  const k = K.cx(cod, user.login);
  const l = await kv.lrange(k, 0, -1);
  if (l && l.length) await kv.del(k);
  const msgs = (l || []).map(parse).filter((m) => m && typeof m === 'object').reverse();
  return { status: 200, json: { msgs } };
}

module.exports = { utilizador, criar, ver, estado, fechar, lista, sinal, sinais, codigoValido, MAX_JOG };
