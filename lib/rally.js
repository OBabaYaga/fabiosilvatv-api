// ===================================================================
// Rally — melhores voltas por pista (uma por pessoa, a mais rápida).
//   fstv:rally:<pista>        zset login -> ms (menos é melhor)
//   fstv:rally:nomes          hash login -> nome a mostrar
// ===================================================================
const { kv, P } = require('./store');

const PISTAS = { douro: 30000, sintra: 34000, estrela: 30000, algarve: 28000 }; // volta mínima possível (ms)
const K = { pista: (p) => P + 'rally:' + p, nomes: P + 'rally:nomes' };
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

async function top(pista, n = 10) {
  if (!PISTAS[pista]) return { status: 400, json: { error: 'Pista desconhecida.' } };
  const l = await kv.zrange(K.pista(pista), 0, n - 1, { withScores: true });
  const linhas = [];
  for (let i = 0; i < l.length; i += 2) linhas.push({ login: String(l[i]), ms: Number(l[i + 1]) });
  const nomes = linhas.length ? await kv.hmget(K.nomes, ...linhas.map((x) => x.login)) : [];
  const lista = linhas.map((x, i) => ({ nome: (nomes && (Array.isArray(nomes) ? nomes[i] : nomes[x.login])) || x.login, ms: x.ms }));
  return { status: 200, json: { pista, lista } };
}

async function registar(user, body) {
  const pista = String(body.pista || '');
  const ms = Math.round(Number(body.ms));
  if (!PISTAS[pista]) return { status: 400, json: { error: 'Pista desconhecida.' } };
  if (!Number.isFinite(ms) || ms < PISTAS[pista] || ms > 15 * 60 * 1000) return { status: 400, json: { error: 'Tempo inválido.' } };
  const antes = await kv.zscore(K.pista(pista), user.login);
  await kv.hset(K.nomes, { [user.login]: txt(body.nome, 25) || user.login });
  const melhorou = antes == null || ms < Number(antes);
  if (melhorou) await kv.zadd(K.pista(pista), { score: ms, member: user.login });
  const rank = await kv.zrank(K.pista(pista), user.login);
  return { status: 200, json: { melhorou, recorde: melhorou ? ms : Number(antes), posicao: rank == null ? null : rank + 1 } };
}

module.exports = { top, registar, PISTAS };
