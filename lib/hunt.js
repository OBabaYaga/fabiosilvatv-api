// ===================================================================
// Bonus hunt ao vivo + Guess the Balance + arquivo de hunts
// ===================================================================
// O servidor das overlays (no PC do streamer) envia a hunt que está a ser
// feita no bonus tracker sempre que ela muda ("sync"). O site mostra-a em
// direto em hunt.html, guarda-a no arquivo e recebe os palpites do Guess
// the Balance (com login da Twitch). O servidor lê os palpites daqui para
// a overlay, e é ele que resolve o vencedor e dá os pontos.
//
// Chaves (todas com o prefixo "fstv:"):
//   hunt:atual            id da hunt que está a decorrer (ou a última)
//   hunts                 zset: id -> quando a hunt apareceu (ms)
//   hunt:<id>             JSON da hunt (bónus, contas e estado do guess)
//   hunt:<id>:palpites    hash: login -> JSON { nome, valor, ts }
// ===================================================================

const { kv, P, parse } = require('./store');

const MAX_ITENS = 300;
const MAX_VALOR = 10000000;
const ESTADOS_GUESS = ['fechado', 'aberto', 'espera', 'resolvido'];

const K = {
  atual: P + 'hunt:atual',
  lista: P + 'hunts',
  hunt: (id) => P + 'hunt:' + id,
  palpites: (id) => P + 'hunt:' + id + ':palpites',
};

function txt(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max || 80);
}
function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function numOuNull(v) {
  if (v == null || v === '') return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}
function idValido(id) {
  const s = String(id || '');
  return /^[a-z0-9-]{1,48}$/.test(s) ? s : null;
}
function imgValida(v) {
  const s = String(v || '');
  return /^https:\/\/[a-z0-9.-]+\/[^\s"'<>]{1,300}$/i.test(s) ? s : '';
}
function moeda(v) {
  const s = String(v || '€');
  return ['€', '$', 'R$', '£'].includes(s) ? s : '€';
}

// Fica só com o que o site precisa de mostrar; nada vindo do PC entra
// em bruto na base de dados.
function limparHunt(h, st) {
  h = h && typeof h === 'object' ? h : {};
  st = st && typeof st === 'object' ? st : {};
  const itens = (Array.isArray(h.items) ? h.items : []).slice(0, MAX_ITENS).map((b) => ({
    n: txt(b && b.name, 60),
    p: txt(b && b.prov, 40),
    img: imgValida(b && b.img),
    bet: Math.max(0, num(b && b.bet)),
    pay: b && b.opened ? Math.max(0, num(b.payout)) : null,
    ab: !!(b && b.opened),
    sup: !!(b && b.sup),
    ext: !!(b && b.ext),
  }));
  const stats = {
    n: itens.length,
    abertos: itens.filter((b) => b.ab).length,
    apostado: Math.max(0, num(st.totalBet)),
    pago: Math.max(0, num(st.paid)),
    custo: Math.max(0, num(st.cost)),
    be: Math.max(0, num(st.be)),
    media: Math.max(0, num(st.avg)),
    precisa: numOuNull(st.need),
    pnl: num(st.pnl),
    melhor: numOuNull(st.best),
    pior: numOuNull(st.worst),
  };
  return {
    nome: txt(h.name, 60) || 'Bonus Hunt',
    fase: txt(h.phase, 30),
    num: txt(h.num, 10),
    cur: moeda(h.cur),
    itens,
    stats,
  };
}

function limparGuess(g, anterior) {
  g = g && typeof g === 'object' ? g : {};
  const a = anterior || {};
  const estado = ESTADOS_GUESS.includes(g.estado) ? g.estado : a.estado || 'fechado';
  const out = {
    estado,
    premio: Math.max(0, Math.round(num(g.premio != null ? g.premio : a.premio))),
    alvo: estado === 'resolvido' ? numOuNull(g.alvo) : null,
    vencedor: null,
    pago: estado === 'resolvido' ? !!g.pago : false,
  };
  if (estado === 'resolvido' && g.vencedor && typeof g.vencedor === 'object') {
    out.vencedor = {
      nome: txt(g.vencedor.user || g.vencedor.nome, 40),
      valor: num(g.vencedor.valor),
      dif: Math.abs(num(g.vencedor.dif)),
    };
  }
  return out;
}

async function lerHunt(id) {
  if (!id) return null;
  return parse(await kv.get(K.hunt(id)));
}

// ---------- sync (só o streamer / o servidor dele) ----------
async function sync(body) {
  const id = idValido(body.id);
  if (!id) return { status: 400, json: { error: 'id da hunt inválido' } };
  const agora = Date.now();
  const antiga = await lerHunt(id);
  const base = body.hunt ? limparHunt(body.hunt, body.stats) : antiga ? {
    nome: antiga.nome, fase: antiga.fase, num: antiga.num, cur: antiga.cur, itens: antiga.itens, stats: antiga.stats,
  } : limparHunt({}, {});
  const doc = Object.assign({ id, criada: (antiga && antiga.criada) || agora }, base, {
    atualizada: agora,
    guess: limparGuess(body.guess, antiga && antiga.guess),
  });
  // quando o guess fica resolvido, guarda o pódio com os palpites do site
  if (doc.guess.estado === 'resolvido' && doc.guess.alvo != null) {
    const pal = await palpitesOrdenados(id, doc.guess.alvo);
    doc.guess.podio = pal.slice(0, 10);
    doc.guess.n = pal.length;
  } else {
    doc.guess.n = await kv.hlen(K.palpites(id));
  }
  await kv.set(K.hunt(id), JSON.stringify(doc));
  if (!antiga) await kv.zadd(K.lista, { score: doc.criada, member: id });
  await kv.set(K.atual, id);
  return { status: 200, json: { ok: true, id, guess: doc.guess.estado, palpites: doc.guess.n } };
}

// ---------- palpites ----------
async function todosPalpites(id) {
  const h = (await kv.hgetall(K.palpites(id))) || {};
  return Object.keys(h).map((login) => {
    const p = parse(h[login]) || {};
    return { login, nome: txt(p.nome, 40) || login, valor: num(p.valor), ts: Number(p.ts) || 0 };
  });
}

async function palpitesOrdenados(id, alvo) {
  return (await todosPalpites(id))
    .map((p) => Object.assign(p, { dif: Math.abs(p.valor - alvo) }))
    .sort((a, b) => a.dif - b.dif || a.ts - b.ts);
}

async function palpite(user, body, admins) {
  const id = await kv.get(K.atual);
  const doc = await lerHunt(id);
  if (!doc || !doc.guess || doc.guess.estado !== 'aberto') {
    return { status: 409, json: { error: 'Os palpites não estão abertos agora.' } };
  }
  if ((admins || []).includes(user.login)) {
    return { status: 403, json: { error: 'O streamer não pode dar palpites.' } };
  }
  const valor = Math.round(num(body.valor) * 100) / 100;
  if (!(valor > 0) || valor > MAX_VALOR) {
    return { status: 400, json: { error: 'Escreve um valor maior do que 0.' } };
  }
  const anterior = parse(await kv.hget(K.palpites(id), user.login));
  const nome = txt(body.nome, 40) || (anterior && anterior.nome) || user.login;
  await kv.hset(K.palpites(id), {
    [user.login]: JSON.stringify({ nome, valor, ts: anterior && anterior.ts ? anterior.ts : Date.now(), editado: Date.now() }),
  });
  return { status: 200, json: { ok: true, id, valor, alterado: !!anterior } };
}

async function meuPalpite(user) {
  const id = await kv.get(K.atual);
  if (!id) return { status: 200, json: { palpite: null } };
  const p = parse(await kv.hget(K.palpites(id), user.login));
  return { status: 200, json: { id, palpite: p ? { valor: num(p.valor), ts: p.ts } : null } };
}

// ---------- leitura pública ----------
function publica(doc, extra) {
  if (!doc) return null;
  const g = doc.guess || {};
  return Object.assign({
    id: doc.id, nome: doc.nome, fase: doc.fase, num: doc.num, cur: doc.cur,
    criada: doc.criada, atualizada: doc.atualizada,
    itens: doc.itens, stats: doc.stats,
    guess: {
      estado: g.estado || 'fechado', premio: g.premio || 0, n: g.n || 0,
      alvo: g.alvo, vencedor: g.vencedor || null, podio: g.estado === 'resolvido' ? (g.podio || []).map((p) => ({ nome: p.nome, valor: p.valor, dif: p.dif })) : [],
    },
  }, extra || {});
}

async function atual() {
  const id = await kv.get(K.atual);
  const doc = await lerHunt(id);
  if (!doc) return { status: 200, json: { hunt: null } };
  // "ao vivo" = o servidor do streamer mandou alguma coisa nos últimos 15 minutos
  return { status: 200, json: { hunt: publica(doc, { aoVivo: Date.now() - (doc.atualizada || 0) < 15 * 60 * 1000 }) } };
}

async function ver(id) {
  id = idValido(id);
  const doc = await lerHunt(id);
  if (!doc) return { status: 404, json: { error: 'Hunt não encontrada.' } };
  return { status: 200, json: { hunt: publica(doc) } };
}

async function lista(q) {
  const pag = Math.max(0, parseInt(q.pagina, 10) || 0);
  const tam = 24;
  const ids = await kv.zrange(K.lista, pag * tam, pag * tam + tam - 1, { rev: true });
  const total = await kv.zcard(K.lista);
  const docs = await Promise.all(ids.map(lerHunt));
  const hunts = docs.filter(Boolean).map((d) => ({
    id: d.id, nome: d.nome, num: d.num, cur: d.cur, criada: d.criada,
    n: d.stats.n, abertos: d.stats.abertos, custo: d.stats.custo, pago: d.stats.pago,
    melhor: d.stats.melhor, img: (d.itens.find((b) => b.img) || {}).img || '',
    vencedor: d.guess && d.guess.vencedor ? d.guess.vencedor.nome : null,
  }));
  return { status: 200, json: { hunts, total, pagina: pag, paginas: Math.ceil(total / tam) } };
}

// ---------- streamer ----------
async function palpitesAdmin(id) {
  id = idValido(id) || (await kv.get(K.atual));
  const pal = (await todosPalpites(id)).sort((a, b) => b.ts - a.ts);
  return { status: 200, json: { id, palpites: pal } };
}

async function apagar(id) {
  id = idValido(id);
  if (!id) return { status: 400, json: { error: 'id inválido' } };
  await kv.del(K.hunt(id), K.palpites(id));
  await kv.zrem(K.lista, id);
  if ((await kv.get(K.atual)) === id) await kv.del(K.atual);
  return { status: 200, json: { ok: true } };
}

module.exports = { sync, palpite, meuPalpite, atual, ver, lista, palpitesAdmin, apagar, limparHunt, idValido };
