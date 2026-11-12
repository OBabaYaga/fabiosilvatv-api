// ===================================================================
// Minijogos — modo RANKING SEMANAL
// -------------------------------------------------------------------
// Fichas próprias dos minijogos, SEPARADAS do saldo da loja: não se
// compram, não se trocam por prémios e não saem daqui. Servem só para o
// ranking da semana.
//
//   • Cada semana (segunda 00:00, hora de Lisboa) toda a gente começa
//     com FICHAS_INICIAIS.
//   • Bónus diário igual para todos (BONUS_DIARIO, 1× por dia).
//   • É o servidor que sorteia (lib/og-motor.js) — o browser só mostra.
//
// Chaves Redis (todas com "fstv:"):
//   fstv:fichas:<semana>         HASH login -> fichas
//   fstv:rank:<semana>           ZSET login (score = fichas)
//   fstv:jogo:<login>:<jogo>     JSON do jogo a decorrer (minas/blackjack)
//   fstv:jlock:<login>           trinco (uma jogada de cada vez)
//   fstv:jbonus:<login>:<dia>    bónus diário já recebido
//   fstv:jcont:<login>:<dia>     jogadas no dia (limite anti-abuso)
// ===================================================================

const crypto = require('crypto');
const { kv, P, parse, toInt } = require('./store');
const Motor = require('./og-motor');

const FICHAS_INICIAIS = toInt(process.env.JOGOS_FICHAS_INICIAIS) || 1000;
const BONUS_DIARIO = toInt(process.env.JOGOS_BONUS_DIARIO) || 500;
const MAX_JOGADAS_DIA = toInt(process.env.JOGOS_MAX_JOGADAS_DIA) || 5000;
const TOP = 20;
const GUARDAR_DIAS = 60;

class ErroAPI extends Error {
  constructor(code, msg, status) {
    super(msg);
    this.code = code;
    this.status = status || 400;
  }
}

// ---------- datas (Lisboa) ----------
function partesLisboa(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = f.format(new Date(ms)).split('-').map(Number);
  return { y, m, d };
}
function dia(ms) {
  const { y, m, d } = partesLisboa(ms == null ? Date.now() : ms);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Semana ISO (ex.: "2026-W46") do dia de Lisboa
function semana(ms) {
  const { y, m, d } = partesLisboa(ms == null ? Date.now() : ms);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow);
  const ano = dt.getUTCFullYear();
  const sem = Math.ceil(((dt - Date.UTC(ano, 0, 1)) / 86400000 + 1) / 7);
  return `${ano}-W${String(sem).padStart(2, '0')}`;
}
function semanaAnterior(ms) {
  return semana((ms == null ? Date.now() : ms) - 7 * 86400000);
}
// Próxima segunda-feira 00:00 em Lisboa (para o contador do ecrã)
function fimDaSemana(ms) {
  const agora = ms == null ? Date.now() : ms;
  const atual = semana(agora);
  // avança de hora a hora até mudar de semana (no máximo 7 dias)
  let t = agora - (agora % 3600000) + 3600000;
  for (let i = 0; i < 24 * 8 && semana(t) === atual; i++) t += 3600000;
  return t;
}

// ---------- aleatório do servidor ----------
function rand() {
  return crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
}

// ---------- fichas ----------
const kFichas = (s) => `${P}fichas:${s}`;
const kRank = (s) => `${P}rank:${s}`;
const kJogo = (login, jogo) => `${P}jogo:${login}:${jogo}`;

async function getFichas(login, s) {
  s = s || semana();
  const v = await kv.hget(kFichas(s), login);
  if (v != null) return toInt(v);
  await kv.hsetnx(kFichas(s), login, FICHAS_INICIAIS);
  await kv.expire(kFichas(s), GUARDAR_DIAS * 86400);
  return toInt(await kv.hget(kFichas(s), login));
}
async function mexer(login, s, delta) {
  const novo = toInt(await kv.hincrby(kFichas(s), login, delta));
  await kv.zadd(kRank(s), { score: novo, member: login });
  return novo;
}

async function comTrinco(login, fn) {
  const chave = `${P}jlock:${login}`;
  const ok = await kv.set(chave, '1', { nx: true, px: 5000 });
  if (!ok) throw new ErroAPI('OCUPADO', 'Espera um instante — a jogada anterior ainda está a ser processada.', 409);
  try {
    return await fn();
  } finally {
    await kv.del(chave);
  }
}

async function lerJogo(login, jogo, s) {
  const j = parse(await kv.get(kJogo(login, jogo)));
  if (!j || j.semana !== s) return null; // jogo de outra semana: já não conta
  return j.estado;
}

// ---------- ações ----------
async function estado(login) {
  const s = semana();
  const [fichas, bonus, pos, minas, bj] = await Promise.all([
    getFichas(login, s),
    kv.get(`${P}jbonus:${login}:${dia()}`),
    kv.zrevrank(kRank(s), login),
    lerJogo(login, 'minas', s),
    lerJogo(login, 'blackjack', s),
  ]);
  const ativos = {};
  if (minas) ativos.minas = Motor.passo('minas', 'ver', {}, minas, rand).view;
  if (bj) ativos.blackjack = Motor.passo('blackjack', 'ver', {}, bj, rand).view;
  return {
    login,
    semana: s,
    fimSemana: fimDaSemana(),
    fichas,
    bonusDisponivel: !bonus,
    bonus: BONUS_DIARIO,
    posicao: pos == null ? null : pos + 1,
    ativos,
  };
}

async function receberBonus(login) {
  return comTrinco(login, async () => {
    const s = semana();
    await getFichas(login, s);
    const ok = await kv.set(`${P}jbonus:${login}:${dia()}`, '1', { nx: true, ex: 2 * 86400 });
    if (!ok) throw new ErroAPI('JA_RECEBIDO', 'Já recebeste o bónus de hoje. Volta amanhã!');
    const fichas = await mexer(login, s, BONUS_DIARIO);
    return { fichas, bonus: BONUS_DIARIO };
  });
}

async function jogar(login, jogo, passo, params) {
  if (!Motor.JOGOS.includes(jogo)) throw new ErroAPI('INVALIDO', 'Jogo desconhecido.');
  passo = String(passo || 'iniciar');
  if (!/^[a-z]{2,12}$/.test(passo) || passo === 'ver') throw new ErroAPI('INVALIDO', 'Jogada inválida.');
  return comTrinco(login, async () => {
    const s = semana();
    const contKey = `${P}jcont:${login}:${dia()}`;
    const n = toInt(await kv.incr(contKey));
    if (n === 1) await kv.expire(contKey, 2 * 86400);
    if (n > MAX_JOGADAS_DIA) throw new ErroAPI('LIMITE', 'Chegaste ao limite de jogadas de hoje. Volta amanhã!', 429);

    const comEstado = jogo === 'minas' || jogo === 'blackjack';
    let anterior = null;
    if (comEstado) {
      anterior = await lerJogo(login, jogo, s);
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

    const fichas = await getFichas(login, s);
    if (r.debito > fichas) throw new ErroAPI('SALDO', 'Não tens fichas suficientes.');
    const delta = r.credito - r.debito;
    const novo = delta || passo === 'iniciar' ? await mexer(login, s, delta) : fichas;

    if (comEstado) {
      if (r.fim) await kv.del(kJogo(login, jogo));
      else await kv.set(kJogo(login, jogo), JSON.stringify({ semana: s, estado: r.estado }), { ex: 86400 });
    }
    return { jogo, passo, fim: r.fim, debito: r.debito, credito: r.credito, view: r.view, fichas: novo };
  });
}

async function ranking() {
  const s = semana();
  const ant = semanaAnterior();
  const [lista, anterior] = await Promise.all([
    kv.zrange(kRank(s), 0, TOP - 1, { rev: true, withScores: true }),
    kv.zrange(kRank(ant), 0, 2, { rev: true, withScores: true }),
  ]);
  const pares = (l) => {
    const out = [];
    for (let i = 0; i + 1 < (l || []).length; i += 2) out.push({ login: String(l[i]), fichas: toInt(l[i + 1]) });
    return out;
  };
  return { semana: s, fimSemana: fimDaSemana(), inicial: FICHAS_INICIAIS, top: pares(lista), anterior: { semana: ant, top: pares(anterior) } };
}

module.exports = { estado, receberBonus, jogar, ranking, semana, dia, fimDaSemana, ErroAPI, FICHAS_INICIAIS, BONUS_DIARIO };
