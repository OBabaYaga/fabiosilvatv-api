// ===================================================================
// Minijogos — modo RANKING (fichas acumuladas a ver a live)
// -------------------------------------------------------------------
// Fichas próprias dos minijogos, SEPARADAS do saldo da loja: não se
// compram, não se trocam por prémios e não saem daqui. Servem só para o
// ranking entre espectadores.
//
//   • Na primeira vez cada pessoa recebe FICHAS_INICIAIS.
//   • Depois ganha fichas a ver a live: cada ponto novo da StreamElements
//     (10 pontos a cada 5 min de live) dá FICHAS_POR_PONTO fichas.
//     Usa-se o total "desde sempre" da StreamElements, que só sobe — por
//     isso gastar pontos na loja não tira fichas, e vice-versa.
//   • Ficaste a 0? Vê a live e voltas a ter fichas.
//   • As fichas acumulam (não há reset); o ranking é o total de fichas.
//   • É o servidor que sorteia (lib/og-motor.js) — o browser só mostra.
//
// Chaves Redis (todas com "fstv:"):
//   fstv:fichas                  HASH login -> fichas
//   fstv:fichas:base             HASH login -> pontos SE já convertidos
//   fstv:fichas:rank             ZSET login (score = fichas)
//   fstv:fsync:<login>           espera entre leituras à StreamElements
//   fstv:jogo:<login>:<jogo>     JSON do jogo a decorrer (minas/blackjack)
//   fstv:jlock:<login>           trinco (uma jogada de cada vez)
//   fstv:jcont:<login>:<dia>     jogadas no dia (limite anti-abuso)
// ===================================================================

const crypto = require('crypto');
const { kv, P, parse, toInt } = require('./store');
const Motor = require('./og-motor');
const { getLoyaltyInfo } = require('./streamelements');

const FICHAS_INICIAIS = toInt(process.env.JOGOS_FICHAS_INICIAIS) || 1000;
const FICHAS_POR_PONTO = Number(process.env.JOGOS_FICHAS_POR_PONTO) > 0 ? Number(process.env.JOGOS_FICHAS_POR_PONTO) : 1;
const MAX_JOGADAS_DIA = toInt(process.env.JOGOS_MAX_JOGADAS_DIA) || 5000;
const SYNC_SEG = 120; // lê a StreamElements no máximo de 2 em 2 min por pessoa
const TOP = 20;

const K_FICHAS = `${P}fichas`;
const K_BASE = `${P}fichas:base`;
const K_RANK = `${P}fichas:rank`;
const kJogo = (login, jogo) => `${P}jogo:${login}:${jogo}`;

class ErroAPI extends Error {
  constructor(code, msg, status) {
    super(msg);
    this.code = code;
    this.status = status || 400;
  }
}

function dia(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(ms == null ? Date.now() : ms));
}

function rand() {
  return crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
}

// ---------- fichas ----------
async function getFichas(login) {
  const v = await kv.hget(K_FICHAS, login);
  if (v != null) return toInt(v);
  if (await kv.hsetnx(K_FICHAS, login, FICHAS_INICIAIS)) await kv.zadd(K_RANK, { score: FICHAS_INICIAIS, member: login });
  return toInt(await kv.hget(K_FICHAS, login));
}
async function mexer(login, delta) {
  const novo = toInt(await kv.hincrby(K_FICHAS, login, delta));
  await kv.zadd(K_RANK, { score: novo, member: login });
  return novo;
}

// Converte os pontos novos da StreamElements em fichas. Corre sempre
// dentro do trinco do jogador. Devolve as fichas ganhas agora.
async function sincronizar(login, forcar) {
  if (!forcar) {
    const pode = await kv.set(`${P}fsync:${login}`, '1', { nx: true, ex: SYNC_SEG });
    if (!pode) return 0;
  }
  let info;
  try {
    info = await getLoyaltyInfo(login);
  } catch (e) {
    return 0; // StreamElements em baixo: tenta-se na próxima
  }
  const total = info.alltime;
  const base = await kv.hget(K_BASE, login);
  if (base == null) {
    // primeira vez: só conta o que ganhar daqui para a frente
    await kv.hset(K_BASE, { [login]: total });
    return 0;
  }
  const delta = total - toInt(base);
  if (delta === 0) return 0;
  await kv.hset(K_BASE, { [login]: total });
  if (delta < 0) return 0; // pontos repostos na StreamElements: não tira fichas
  const ganho = Math.floor(delta * FICHAS_POR_PONTO);
  if (ganho > 0) await mexer(login, ganho);
  return ganho;
}

async function comTrinco(login, fn) {
  const chave = `${P}jlock:${login}`;
  const ok = await kv.set(chave, '1', { nx: true, px: 8000 });
  if (!ok) throw new ErroAPI('OCUPADO', 'Espera um instante — a jogada anterior ainda está a ser processada.', 409);
  try {
    return await fn();
  } finally {
    await kv.del(chave);
  }
}

async function lerJogo(login, jogo) {
  const j = parse(await kv.get(kJogo(login, jogo)));
  return j && j.estado ? j.estado : null;
}

// ---------- ações ----------
async function estado(login) {
  await getFichas(login);
  let ganhoAgora = 0;
  try {
    ganhoAgora = await comTrinco(login, () => sincronizar(login, false));
  } catch (e) {
    if (!(e instanceof ErroAPI)) throw e; // ocupado: sincroniza na próxima
  }
  const [fichas, pos, minas, bj] = await Promise.all([
    getFichas(login),
    kv.zrevrank(K_RANK, login),
    lerJogo(login, 'minas'),
    lerJogo(login, 'blackjack'),
  ]);
  const ativos = {};
  if (minas) ativos.minas = Motor.passo('minas', 'ver', {}, minas, rand).view;
  if (bj) ativos.blackjack = Motor.passo('blackjack', 'ver', {}, bj, rand).view;
  return { login, fichas, ganhoAgora, fichasPorPonto: FICHAS_POR_PONTO, posicao: pos == null ? null : pos + 1, ativos };
}

async function jogar(login, jogo, passo, params) {
  if (!Motor.JOGOS.includes(jogo)) throw new ErroAPI('INVALIDO', 'Jogo desconhecido.');
  passo = String(passo || 'iniciar');
  if (!/^[a-z]{2,12}$/.test(passo) || passo === 'ver') throw new ErroAPI('INVALIDO', 'Jogada inválida.');
  return comTrinco(login, async () => {
    const contKey = `${P}jcont:${login}:${dia()}`;
    const n = toInt(await kv.incr(contKey));
    if (n === 1) await kv.expire(contKey, 2 * 86400);
    if (n > MAX_JOGADAS_DIA) throw new ErroAPI('LIMITE', 'Chegaste ao limite de jogadas de hoje. Volta amanhã!', 429);

    const comEstado = jogo === 'minas' || jogo === 'blackjack';
    let anterior = null;
    if (comEstado) {
      anterior = await lerJogo(login, jogo);
      if (passo === 'iniciar' && anterior) throw new ErroAPI('A_DECORRER', 'Tens um jogo a decorrer — acaba-o primeiro.', 409);
      if (passo !== 'iniciar' && !anterior) throw new ErroAPI('SEM_JOGO', 'Este jogo já acabou.', 409);
    } else if (passo !== 'iniciar') {
      throw new ErroAPI('INVALIDO', 'Jogada inválida.');
    }

    let r;
    try {
      r = Motor.passo(jogo, passo, params || {}, anterior, rand, { manual: false });
    } catch (e) {
      if (e && e.jogo) throw new ErroAPI('INVALIDO', e.message);
      throw e;
    }

    let fichas = await getFichas(login);
    let ganhoAgora = 0;
    if (r.debito > 0) {
      ganhoAgora = await sincronizar(login, false);
      if (ganhoAgora) fichas = await getFichas(login);
    }
    if (r.debito > fichas) {
      throw new ErroAPI('SALDO', fichas <= 0 ? 'Ficaste sem fichas — vê a live para ganhares mais!' : 'Não tens fichas suficientes.');
    }
    const delta = r.credito - r.debito;
    const novo = delta ? await mexer(login, delta) : fichas;

    if (comEstado) {
      if (r.fim) await kv.del(kJogo(login, jogo));
      else await kv.set(kJogo(login, jogo), JSON.stringify({ estado: r.estado }), { ex: 7 * 86400 });
    }
    return { jogo, passo, fim: r.fim, debito: r.debito, credito: r.credito, view: r.view, fichas: novo, ganhoAgora };
  });
}

async function ranking() {
  const [lista, jogadores] = await Promise.all([kv.zrange(K_RANK, 0, TOP - 1, { rev: true, withScores: true }), kv.zcard(K_RANK)]);
  const top = [];
  for (let i = 0; i + 1 < (lista || []).length; i += 2) top.push({ login: String(lista[i]), fichas: toInt(lista[i + 1]) });
  return { inicial: FICHAS_INICIAIS, fichasPorPonto: FICHAS_POR_PONTO, jogadores: toInt(jogadores), top };
}

module.exports = { estado, jogar, ranking, dia, ErroAPI, FICHAS_INICIAIS, FICHAS_POR_PONTO };
