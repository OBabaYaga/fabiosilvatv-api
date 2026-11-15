// ===================================================================
// FS Manager — API (chega por /api/manager?acao=...)
// (vive dentro do /api/health porque o plano grátis do Vercel só deixa
//  ter 12 funções)
//
// Carreira (cada um no seu browser; aqui só se guarda uma cópia):
//   GET  acao=carreira                -> { mundo, ts }
//   POST acao=carreira-guardar        { mundo, ts }
//   POST acao=carreira-apagar         (recomeçar do zero)
// Desafios (com os clubes da Liga da Comunidade, que vivem aqui — sem batota):
//   GET  acao=desafios                -> o meu clube, adversários, histórico
//   POST acao=desafiar                { adversario }
// Ranking:
//   GET  acao=ranking
// Liga da Comunidade (o mundo vive aqui; as jornadas correm a horas certas):
//   GET  acao=liga                    -> joga as jornadas em atraso e devolve o mundo
//   POST acao=liga-entrar
//   POST acao=liga-acao               { acao, args }
//   POST acao=liga-admin              { op: criar|jogar|horas|pausa|retomar|apagar, horas }  (só o Fábio / ADMIN_LOGINS)
// Ligas privadas (cada utilizador cria a sua e convida amigos com o código):
//   todas as ações de liga aceitam "liga" (na query ou no corpo); sem ele é a Liga da Comunidade
//   GET  acao=minhas-ligas            -> ligas onde estou (e as que criei)
//   POST acao=liga-criar              { nome, paises, horas }
//   POST acao=liga-entrar             { liga: código }
//   POST acao=liga-sair               { liga }
//   POST acao=liga-admin              { liga, op: jogar|horas|pausa|retomar|apagar|expulsar, horas, alvo }  (só o dono)
// ===================================================================

const crypto = require('crypto');
const TM = require('./motor');
const { kv } = require('../store');
const { requireUser, requireAdmin, getAdminLogins } = require('../admin');
const { readBody } = require('../body');

const P = 'fstv:mg:';
const K_LIGA = P + 'liga';
const K_LOCK = P + 'liga:lock';
const K_ELO = P + 'elo'; // login -> { elo, v, e, d } dos Desafios
const K_HIST = P + 'des:hist';
const LIMITE_DESAFIOS = 15;
const OFICIAL = 'oficial';
const MAX_LIGAS_DONO = 2; // ligas privadas que cada pessoa pode criar
const MAX_LIGAS_MEMBRO = 8; // ligas privadas em que cada pessoa pode estar
const K_MINHAS = (login) => P + 'u:' + login + ':ligas';
function idLiga(v) {
  const id = String(v || OFICIAL).toLowerCase().trim();
  if (id === OFICIAL || /^[a-z0-9]{6}$/.test(id)) return id;
  const e = new Error('Código de liga inválido.');
  e.codigo = 400;
  throw e;
}
const chaveLiga = (id) => (id === OFICIAL ? K_LIGA : P + 'lg:' + id);
const chaveLock = (id) => (id === OFICIAL ? K_LOCK : P + 'lg:' + id + ':lock');
const chaveMeta = (id) => P + 'lg:' + id + ':meta';
const HORAS_PADRAO = [14, 21];
const MAX_BYTES = 900 * 1024;

function parse(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch (e) {
      return null;
    }
  }
  return v;
}
function semente() {
  return crypto.randomBytes(4).readUInt32LE(0) || 1;
}
function erro(res, codigo, msg) {
  res.status(codigo).json({ erro: msg });
}

// --------------------------- horas de Lisboa ---------------------------
function offsetLisboa(ts) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return comoUTC - Math.floor(ts / 1000) * 1000;
}
function dataLisboa(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
function lisboaParaTs(dataStr, hora) {
  const [y, m, d] = dataStr.split('-').map(Number);
  const palpite = Date.UTC(y, m - 1, d, hora, 0, 0);
  return palpite - offsetLisboa(palpite);
}
function proximaHora(depois, horas) {
  const hs = (horas && horas.length ? horas : HORAS_PADRAO).slice().sort((a, b) => a - b);
  for (let dia = 0; dia < 3; dia++) {
    const ds = dataLisboa(depois + dia * 86400000);
    for (const h of hs) {
      const t = lisboaParaTs(ds, h);
      if (t > depois) return t;
    }
  }
  return depois + 86400000;
}

// ------------------------------- lock -------------------------------
async function comLock(id, fn) {
  const tok = crypto.randomBytes(6).toString('hex');
  const K = chaveLock(id);
  for (let i = 0; i < 25; i++) {
    const ok = await kv.set(K, tok, { nx: true, px: 20000 });
    if (ok) {
      try {
        return await fn();
      } finally {
        const atual = await kv.get(K);
        if (atual === tok) await kv.del(K);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const e = new Error('A liga está ocupada a jogar uma jornada. Tenta daqui a uns segundos.');
  e.codigo = 409;
  throw e;
}

// ------------------------------- liga -------------------------------
async function lerLiga(id) {
  const L = parse(await kv.get(chaveLiga(id || OFICIAL)));
  if (L && L.mundo) TM.migrar(L.mundo);
  return L;
}
async function gravarLiga(id, L) {
  await kv.set(chaveLiga(id || OFICIAL), JSON.stringify(L));
  if (id && id !== OFICIAL) await gravarMeta(id, L);
}
// resumo pequeno de cada liga privada (para a lista "as minhas ligas")
async function gravarMeta(id, L) {
  const humanos = Object.values(L.mundo.clubes).filter((c) => c.hum).map((c) => c.hum);
  await kv.set(chaveMeta(id), JSON.stringify({ id, nome: L.nome, dono: L.dono, n: humanos.length, membros: humanos.slice(0, 60), paises: L.mundo.paises, horas: L.horas, ativa: !!L.ativa, proxima: L.ativa ? L.proxima : null, criada: L.criada }));
}
async function lerMinhas(login) {
  const v = parse(await kv.get(K_MINHAS(login)));
  return Array.isArray(v) ? v : [];
}
async function juntarMinhas(login, id) {
  const l = await lerMinhas(login);
  if (!l.includes(id)) l.push(id);
  await kv.set(K_MINHAS(login), JSON.stringify(l));
}
async function tirarMinhas(login, id) {
  const l = (await lerMinhas(login)).filter((x) => x !== id);
  await kv.set(K_MINHAS(login), JSON.stringify(l));
}
function infoDe(L, id) {
  return { id: id || OFICIAL, privada: !!L.privada, nome: L.privada ? L.nome : 'Liga da Comunidade', dono: L.dono || null, ativa: !!L.ativa, horas: L.horas, proxima: L.ativa ? L.proxima : null, ultimaEm: L.ultimaEm || null, criada: L.criada };
}
function erroCod(codigo, msg) {
  const e = new Error(msg);
  e.codigo = codigo;
  return e;
}
// dá ao treinador um clube livre da divisão mais baixa com vaga (Portugal primeiro)
function darClube(m, login) {
  const ordem = (m.paises.includes('PT') ? TM.divsDoPais(m, 'PT').reverse() : []).concat(...(m.paises || []).filter((p) => p !== 'PT').map((p) => TM.divsDoPais(m, p).reverse()));
  for (const d of ordem) {
    const livres = m.divs[d].filter((id) => !m.clubes[id].hum);
    if (livres.length) {
      const escolhido = livres[crypto.randomInt(livres.length)];
      TM.assumirClube(m, login, escolhido);
      return escolhido;
    }
  }
  throw erroCod(409, 'A liga está cheia: todos os clubes já têm treinador.');
}
function libertarClube(m, login) {
  const c = clubeDe(m, login);
  if (c) {
    c.hum = null;
    c.xi = null;
    c.banco = null;
  }
  delete m.treinadores[login];
}
// joga as jornadas que já deviam ter sido jogadas (no máximo 3 por pedido)
async function correrAtrasadas(id) {
  let L = await lerLiga(id);
  if (!L || !L.ativa || Date.now() < L.proxima) return L;
  return comLock(id, async () => {
    L = await lerLiga(id);
    let n = 0;
    while (L && L.ativa && Date.now() >= L.proxima && n < 3) {
      TM.jogarJornada(L.mundo);
      L.ultimaEm = L.proxima;
      L.proxima = proximaHora(L.proxima, L.horas);
      n++;
    }
    if (n) await gravarLiga(id, L);
    return L;
  });
}
function clubeDe(m, login) {
  return Object.values(m.clubes).find((c) => c.hum === login) || null;
}
function validarEscalacao(m, c, d) {
  const tat = d && d.tat ? d.tat : {};
  const t = {
    f: TM.FORMACOES[tat.f] ? tat.f : '4-4-2',
    e: TM.ESTILOS[tat.e] ? tat.e : 'eq',
    m: TM.MARCACOES[tat.m] ? tat.m : 'n',
    foco: TM.FOCOS[tat.foco] ? tat.foco : 'meio',
  };
  const meus = new Set(c.pl);
  const xi = (Array.isArray(d.xi) ? d.xi : []).slice(0, 11).map((x) => (typeof x === 'string' && meus.has(x) ? x : null));
  const banco = (Array.isArray(d.banco) ? d.banco : []).filter((x) => typeof x === 'string' && meus.has(x) && !xi.includes(x)).slice(0, 7);
  return { tat: t, xi, banco };
}
function acaoLiga(m, login, nome, args) {
  const c = clubeDe(m, login);
  const t = m.treinadores[login] || null;
  const a = Array.isArray(args) ? args : [];
  if (nome === 'assumir') {
    if (!t || !(t.ofertas || []).includes(a[0])) return { erro: 'Esse convite já não está disponível.' };
    return TM.assumirClube(m, login, a[0]);
  }
  if (nome === 'recusar') {
    if (t) t.ofertas = [];
    return { ok: true };
  }
  if (!c) return { erro: 'Não tens clube na liga.' };
  switch (nome) {
    case 'escalacao': {
      const e = validarEscalacao(m, c, a[0] || {});
      c.tat = e.tat;
      c.xi = e.xi;
      c.banco = e.banco;
      return { ok: true };
    }
    case 'licitar': return TM.licitar(m, c.id, String(a[0]), Number(a[1]));
    case 'leilao': {
      const j = m.jog[a[0]];
      if (!j || j.cl !== c.id) return { erro: 'Esse jogador não é teu.' };
      return TM.porLeilao(m, j.id, Number(a[1]), true);
    }
    case 'retirarLance': {
      const l = m.mercado.leiloes.find((x) => x.j === a[0]);
      if (l) delete l.lances[c.id];
      return { ok: true };
    }
    case 'comprar': return TM.comprarDireto(m, c.id, String(a[0]));
    case 'vender': return TM.venderJa(m, c.id, String(a[0]), TM.criarRng(semente()));
    case 'dispensar': return TM.dispensar(m, c.id, String(a[0]));
    case 'estadio': return TM.ampliarEstadio(m, c.id, Number(a[0]));
    case 'bilhete': return TM.definirBilhete(m, c.id, Number(a[0]));
    case 'emprestimo': return TM.emprestimo(m, c.id, Number(a[0]));
    default: return { erro: 'Ação desconhecida.' };
  }
}

// ----------------------------- desafios -----------------------------
// Os Desafios usam os clubes da Liga da Comunidade: vivem no servidor, por isso
// ninguém consegue mexer na equipa (a Carreira corre no browser).
function equipaDaLiga(m, c) {
  const e = TM.escalacaoHumana(m, c);
  const pack = (id) => {
    const j = m.jog[id];
    return j ? { n: j.n, p: j.p, f: j.f, i: j.i, nac: j.nac, c: j.c, cp: j.cp, ca: j.ca } : null;
  };
  return { nome: c.n, cor: c.cor, div: c.div, mor: c.mor, tat: e.tat, xi: e.xi.map(pack).filter(Boolean), banco: e.banco.map(pack).filter(Boolean) };
}
function forcaClube(m, c) {
  const top = c.pl.map((id) => m.jog[id].f).sort((a, b) => b - a).slice(0, 11);
  return Math.round(top.reduce((s, x) => s + x, 0) / Math.max(1, top.length));
}
async function lerElo(login) {
  return Object.assign({ elo: 1000, v: 0, e: 0, d: 0 }, parse(await kv.hget(K_ELO, login)) || {});
}

// ------------------------------ handler ------------------------------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const acao = String(q.acao || '');
  try {
    // ---------- ranking (público) ----------
    if (acao === 'ranking') {
      const [L, elos] = await Promise.all([lerLiga(OFICIAL), kv.hgetall(K_ELO)]);
      const m = L && L.mundo;
      const liga = m
        ? Object.entries(m.treinadores || {})
            .map(([login, t]) => {
              const c = clubeDe(m, login);
              return { login, pts: t.pts || 0, v: t.v || 0, e: t.e || 0, d: t.d || 0, titulos: (t.titulos || []).length, clube: c ? c.n : null };
            })
            .sort((a, b) => b.pts - a.pts)
            .slice(0, 50)
        : [];
      const desafios = Object.entries(elos || {})
        .map(([login, v]) => Object.assign({ login }, parse(v)))
        .filter((x) => (x.v || 0) + (x.e || 0) + (x.d || 0) > 0)
        .map((x) => {
          const c = m ? clubeDe(m, x.login) : null;
          return { login: x.login, nome: c ? c.n : '—', elo: x.elo || 1000, v: x.v || 0, e: x.e || 0, d: x.d || 0 };
        })
        .sort((a, b) => b.elo - a.elo)
        .slice(0, 50);
      res.status(200).json({ liga, desafios });
      return;
    }

    // ---------- liga: leitura (com ou sem login) ----------
    if (acao === 'liga' && req.method === 'GET') {
      const id = idLiga(q.liga);
      const user = await requireUser(req);
      const L = await correrAtrasadas(id);
      if (!L) {
        res.status(200).json({ mundo: null, info: null, login: user ? user.login : null, id, admin: !!(user && id === OFICIAL && getAdminLogins().includes(user.login)) });
        return;
      }
      res.status(200).json({ mundo: L.mundo, info: infoDe(L, id), login: user ? user.login : null, id, admin: !!(user && id === OFICIAL && getAdminLogins().includes(user.login)) });
      return;
    }

    const user = await requireUser(req);
    if (!user) return erro(res, 401, 'Entra com a Twitch.');
    const login = user.login;

    // ---------- carreira ----------
    if (acao === 'carreira' && req.method === 'GET') {
      const d = parse(await kv.get(P + 'car:' + login));
      res.status(200).json(d || { mundo: null, ts: 0 });
      return;
    }
    if (acao === 'minhas-ligas') {
      const ids = await lerMinhas(login);
      const metas = (await Promise.all(ids.map((id) => kv.get(chaveMeta(id))))).map(parse);
      const vivas = [];
      metas.forEach((mt, k) => {
        if (mt && (mt.dono === login || (mt.membros || []).includes(login))) vivas.push(Object.assign({}, mt, { souDono: mt.dono === login }));
      });
      if (vivas.length !== ids.length) await kv.set(K_MINHAS(login), JSON.stringify(vivas.map((x) => x.id)));
      res.status(200).json({ ligas: vivas, maxDono: MAX_LIGAS_DONO, maxMembro: MAX_LIGAS_MEMBRO });
      return;
    }
    if (req.method !== 'POST' && acao !== 'desafios') return erro(res, 405, 'Método não permitido.');
    const body = readBody(req);

    if (acao === 'carreira-apagar') {
      await kv.del(P + 'car:' + login);
      res.status(200).json({ ok: true });
      return;
    }
    if (acao === 'carreira-guardar') {
      const m = body.mundo;
      if (m && typeof m === 'object' && m.v === 1) TM.migrar(m);
      if (!m || typeof m !== 'object' || m.v !== TM.VERSAO || !m.clubes || !m.jog) return erro(res, 400, 'Carreira inválida.');
      const txt = JSON.stringify({ mundo: m, ts: Number(body.ts) || Date.now() });
      if (txt.length > MAX_BYTES) return erro(res, 413, 'A carreira é demasiado grande para guardar.');
      await kv.set(P + 'car:' + login, txt);
      res.status(200).json({ ok: true });
      return;
    }

    // ---------- desafios (com os clubes da Liga da Comunidade) ----------
    if (acao === 'desafios') {
      const [L, elos, hist, hoje] = await Promise.all([lerLiga(OFICIAL), kv.hgetall(K_ELO), kv.lrange(K_HIST, 0, 29), kv.get(P + 'des:dia:' + login + ':' + dataLisboa(Date.now()))]);
      const m = L && L.mundo;
      const eloDe = (l) => Object.assign({ elo: 1000, v: 0, e: 0, d: 0 }, parse((elos || {})[l]) || {});
      const meu = m ? clubeDe(m, login) : null;
      const lista = m
        ? Object.values(m.clubes)
            .filter((c) => c.hum && c.hum !== login)
            .map((c) => ({ login: c.hum, nomeT: c.hum, nome: c.n, div: c.div, dn: TM.nomeDiv(m, c.div), cor: c.cor, forca: forcaClube(m, c), elo: eloDe(c.hum).elo }))
            .sort((a, b) => b.elo - a.elo)
        : [];
      res.status(200).json({
        liga: !!m,
        eu: meu ? Object.assign({ nome: meu.n, cor: meu.cor, div: meu.div, dn: TM.nomeDiv(m, meu.div), forca: forcaClube(m, meu) }, eloDe(login)) : null,
        lista,
        historico: (hist || []).map(parse).filter(Boolean),
        hoje: Number(hoje) || 0,
        limite: LIMITE_DESAFIOS,
      });
      return;
    }
    if (acao === 'desafiar') {
      const adv = String(body.adversario || '').toLowerCase();
      if (!adv || adv === login) return erro(res, 400, 'Escolhe outro treinador.');
      const L = await lerLiga(OFICIAL);
      const m = L && L.mundo;
      const cEu = m && clubeDe(m, login);
      const cEle = m && clubeDe(m, adv);
      if (!cEu) return erro(res, 400, 'Para desafiar precisas de um clube na Liga da Comunidade.');
      if (!cEle) return erro(res, 404, 'Esse treinador já não tem clube na Liga da Comunidade.');
      const kDia = P + 'des:dia:' + login + ':' + dataLisboa(Date.now());
      const n = await kv.incr(kDia);
      if (n === 1) await kv.expire(kDia, 2 * 86400);
      if (n > LIMITE_DESAFIOS) return erro(res, 429, 'Já fizeste os ' + LIMITE_DESAFIOS + ' desafios de hoje. Volta amanhã!');
      const r = TM.jogoAmigavel(equipaDaLiga(m, cEu), equipaDaLiga(m, cEle), semente());
      const [eu, ele] = await Promise.all([lerElo(login), lerElo(adv)]);
      const regA = r.gh > r.ga ? 1 : r.gh < r.ga ? 0 : r.vencedor === 'a' ? 0.6 : 0.4;
      const ea = 1 / (1 + Math.pow(10, (ele.elo - eu.elo) / 400));
      const delta = Math.round(32 * (regA - ea));
      const eloAntes = eu.elo;
      eu.elo += delta;
      ele.elo -= delta;
      const empate = r.gh === r.ga;
      if (empate) {
        eu.e++;
        ele.e++;
      } else if (r.gh > r.ga) {
        eu.v++;
        ele.d++;
      } else {
        eu.d++;
        ele.v++;
      }
      await kv.hset(K_ELO, { [login]: JSON.stringify(eu), [adv]: JSON.stringify(ele) });
      const h = { ts: Date.now(), a: login + ' (' + cEu.n + ')', b: adv + ' (' + cEle.n + ')', ga: r.gh, gb: r.ga, pen: r.pen };
      await kv.lpush(K_HIST, JSON.stringify(h));
      await kv.ltrim(K_HIST, 0, 49);
      res.status(200).json(Object.assign({}, r, {
        a: { nome: cEu.n, cor: cEu.cor, login },
        b: { nome: cEle.n, cor: cEle.cor, login: adv },
        ganhou: r.vencedor === 'a',
        empate,
        eloAntes,
        eloDepois: eu.elo,
      }));
      return;
    }

    // ---------- liga: entrar e ações ----------
    if (acao === 'liga-criar') {
      const nome = String(body.nome || '').replace(/[<>]/g, '').trim().slice(0, 32);
      if (nome.length < 3) return erro(res, 400, 'Dá um nome à liga (pelo menos 3 letras).');
      const paises = ['PT'].concat(['ES', 'IT', 'EN'].filter((p) => Array.isArray(body.paises) && body.paises.includes(p)));
      const horas = [...new Set((Array.isArray(body.horas) ? body.horas : []).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
      const minhas = await lerMinhas(login);
      const metas = (await Promise.all(minhas.map((x) => kv.get(chaveMeta(x))))).map(parse).filter(Boolean);
      if (metas.filter((x) => x.dono === login).length >= MAX_LIGAS_DONO) return erro(res, 409, 'Só podes criar ' + MAX_LIGAS_DONO + ' ligas. Apaga uma para criares outra.');
      if (metas.length >= MAX_LIGAS_MEMBRO) return erro(res, 409, 'Já estás em ' + MAX_LIGAS_MEMBRO + ' ligas. Sai de uma primeiro.');
      let id = null;
      for (let i = 0; i < 8 && !id; i++) {
        const tent = Array.from(crypto.randomBytes(6), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
        if (!(await kv.get(chaveMeta(tent)))) id = tent;
      }
      if (!id) return erro(res, 500, 'Não consegui criar o código da liga. Tenta outra vez.');
      const hs = horas.length ? horas : [21];
      const L = { id, nome, dono: login, privada: true, mundo: TM.criarMundo(semente(), { multi: true, paises }), horas: hs, ativa: true, criada: Date.now(), ultimaEm: null };
      L.proxima = proximaHora(Date.now(), hs);
      darClube(L.mundo, login);
      await gravarLiga(id, L);
      await juntarMinhas(login, id);
      res.status(200).json({ mundo: L.mundo, info: infoDe(L, id), login, id });
      return;
    }
    if (acao === 'liga-entrar') {
      const id = idLiga(body.liga);
      if (id !== OFICIAL) {
        const minhas = await lerMinhas(login);
        if (!minhas.includes(id) && minhas.length >= MAX_LIGAS_MEMBRO) return erro(res, 409, 'Já estás em ' + MAX_LIGAS_MEMBRO + ' ligas. Sai de uma primeiro.');
      }
      const L = await comLock(id, async () => {
        const L2 = await lerLiga(id);
        if (!L2) throw erroCod(404, id === OFICIAL ? 'A liga ainda não foi criada.' : 'Não encontrei nenhuma liga com esse código.');
        const m = L2.mundo;
        if (!clubeDe(m, login)) {
          darClube(m, login);
          await gravarLiga(id, L2);
        }
        return L2;
      });
      if (id !== OFICIAL) await juntarMinhas(login, id);
      res.status(200).json({ mundo: L.mundo, info: infoDe(L, id), login, id });
      return;
    }
    if (acao === 'liga-sair') {
      const id = idLiga(body.liga);
      if (id === OFICIAL) return erro(res, 400, 'Na Liga da Comunidade não dá para sair.');
      await comLock(id, async () => {
        const L2 = await lerLiga(id);
        if (!L2) return;
        if (L2.dono === login) throw erroCod(400, 'És o dono desta liga: para saíres tens de a apagar.');
        libertarClube(L2.mundo, login);
        await gravarLiga(id, L2);
      });
      await tirarMinhas(login, id);
      res.status(200).json({ ok: true });
      return;
    }
    if (acao === 'liga-acao') {
      const id = idLiga(body.liga);
      let r;
      const L = await comLock(id, async () => {
        const L2 = await lerLiga(id);
        if (!L2) throw erroCod(404, 'Essa liga já não existe.');
        r = acaoLiga(L2.mundo, login, String(body.acao || ''), body.args);
        if (r && !r.erro) await gravarLiga(id, L2);
        return L2;
      });
      if (r && r.erro) return erro(res, 400, r.erro);
      res.status(200).json({ mundo: L.mundo, info: infoDe(L, id), login, r, id });
      return;
    }

    // ---------- liga: admin ----------
    if (acao === 'liga-admin') {
      const id = idLiga(body.liga);
      const op = String(body.op || '');
      if (id === OFICIAL) {
        const admin = await requireAdmin(req);
        if (!admin) return erro(res, 403, 'Só o Fábio pode gerir a Liga da Comunidade.');
      } else {
        const meta = parse(await kv.get(chaveMeta(id)));
        if (!meta) return erro(res, 404, 'Essa liga já não existe.');
        if (meta.dono !== login) return erro(res, 403, 'Só o dono da liga a pode gerir.');
        if (op === 'criar') return erro(res, 400, 'Operação desconhecida.');
      }
      const horas = (Array.isArray(body.horas) ? body.horas : [])
        .map(Number)
        .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
      const out = await comLock(id, async () => {
        let L = await lerLiga(id);
        if (op === 'criar') {
          const hs = horas.length ? [...new Set(horas)].sort((a, b) => a - b) : HORAS_PADRAO;
          L = { mundo: TM.criarMundo(semente(), { multi: true, paises: ['PT', 'ES', 'IT', 'EN'] }), horas: hs, ativa: true, criada: Date.now(), ultimaEm: null };
          L.proxima = proximaHora(Date.now(), hs);
          await gravarLiga(id, L);
          return L;
        }
        if (!L) {
          const e = new Error('Ainda não há liga. Cria uma primeiro.');
          e.codigo = 404;
          throw e;
        }
        if (op === 'jogar') {
          TM.jogarJornada(L.mundo);
          L.ultimaEm = Date.now();
        } else if (op === 'horas') {
          if (!horas.length) {
            const e = new Error('Escolhe pelo menos uma hora.');
            e.codigo = 400;
            throw e;
          }
          L.horas = [...new Set(horas)].sort((a, b) => a - b);
          L.proxima = proximaHora(Date.now(), L.horas);
        } else if (op === 'pausa') L.ativa = false;
        else if (op === 'retomar') {
          L.ativa = true;
          L.proxima = proximaHora(Date.now(), L.horas);
        } else if (op === 'apagar') {
          await kv.del(chaveLiga(id));
          if (id !== OFICIAL) {
            await kv.del(chaveMeta(id));
            await tirarMinhas(login, id);
          }
          return null;
        } else if (op === 'expulsar' && id !== OFICIAL) {
          const alvo = String(body.alvo || '').toLowerCase();
          if (!alvo || alvo === L.dono) throw erroCod(400, 'Escolhe um treinador para expulsar.');
          libertarClube(L.mundo, alvo);
        } else {
          const e = new Error('Operação desconhecida.');
          e.codigo = 400;
          throw e;
        }
        await gravarLiga(id, L);
        return L;
      });
      const m = out && out.mundo;
      res.status(200).json({
        ok: true,
        info: out ? infoDe(out, id) : null,
        mundo: id !== OFICIAL && out ? out.mundo : undefined,
        resumo: m ? { epoca: m.epoca, ano: m.ano, passo: m.passo, total: m.cal.length, humanos: Object.values(m.clubes).filter((c) => c.hum).map((c) => ({ login: c.hum, clube: c.n, div: c.div })) } : null,
      });
      return;
    }

    erro(res, 400, 'Ação desconhecida.');
  } catch (e) {
    if (e && e.codigo) return erro(res, e.codigo, e.message);
    console.error('[manager]', e);
    erro(res, 500, 'Erro no servidor do FS Manager.');
  }
};

module.exports.proximaHora = proximaHora;
