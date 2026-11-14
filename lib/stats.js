// ===================================================================
// Estatísticas do site (sem cookies)
// ===================================================================
// O site manda dois tipos de evento para /api/stats:
//   visita: { t:"v", p:"/casinos.html", n:1, r:"https://www.twitch.tv/..." }
//   clique: { t:"c", m:"coldbet", s:"casinos:cartao", p:"/casinos.html" }
//
// Visitantes únicos: guarda-se só um código anónimo (sha256 de
// segredo + período + IP + browser) num HyperLogLog do Redis. O IP nunca
// é guardado e o código muda a cada dia/mês/ano, por isso não dá para
// seguir ninguém. Não há cookies.
//
// Chaves (todas com o prefixo "fstv:"):
//   st:u:d:AAAA-MM-DD | st:u:m:AAAA-MM | st:u:y:AAAA   visitantes (HLL)
//   st:v:d:… | st:v:m:… | st:v:y:…   visitas: _t = total, /pagina = por página
//   st:r:m:AAAA-MM | st:r:y:AAAA     de onde vêm (Twitch, Google…)
//   st:c:d:… | st:c:m:… | st:c:y:…   cliques: marca e "marca|sitio"
// ===================================================================

const crypto = require('crypto');
const { kv, P, toInt } = require('./store');

const MARCAS = ['coldbet', 'captainsbet', '22bit', 'betlabel', 'royalxo', 'safecasino', 'outro'];
const NOMES_MARCAS = {
  coldbet: 'Coldbet',
  captainsbet: 'CaptainsBet',
  '22bit': '22bit',
  betlabel: 'Betlabel',
  royalxo: 'Royal XO',
  safecasino: 'SafeCasino',
  outro: 'Outro',
};
const PAGINAS_CLIQUE = ['inicio', 'casinos', 'outra'];
const SITIOS = ['cartao', 'detalhes', 'termos', 'popup', 'outro'];

const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|discordbot|embedly|curl|wget|python|java\/|go-http|axios|node-fetch/i;

const DIA = 24 * 3600;
const TTL_DIA = 400 * DIA; // os dias guardam-se ~13 meses
const TTL_MES = 3 * 366 * DIA; // os meses 3 anos; os anos ficam para sempre

const SEGREDO = process.env.STATS_SALT || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'fstv';

// Data de hoje em Portugal (o dia muda à meia-noite de Lisboa)
function dataLisboa(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
function periodos(d) {
  const dia = dataLisboa(d);
  return { dia, mes: dia.slice(0, 7), ano: dia.slice(0, 4) };
}

function codigo(periodo, ip, ua) {
  return crypto.createHash('sha256').update(SEGREDO + '|' + periodo + '|' + ip + '|' + ua).digest('hex').slice(0, 24);
}

function ipDe(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim() || 'sem-ip';
}

function paginaValida(p) {
  let s = String(p || '').split(/[?#]/)[0].toLowerCase();
  if (s === '' || s === '/') s = '/index.html';
  if (!s.endsWith('.html')) s += '.html';
  return /^\/[a-z0-9_-]{1,40}\.html$/.test(s) ? s : null;
}

// De onde veio a pessoa (só na 1.ª página que abre)
function origem(ref) {
  const r = String(ref || '').trim();
  if (!r) return 'Direto';
  let host;
  try {
    host = new URL(r).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  } catch (e) {
    return 'Outro';
  }
  if (/(^|\.)fabiosilvatv\.com$/.test(host)) return null; // dentro do site
  const regras = [
    [/twitch\.tv$/, 'Twitch'],
    [/instagram\.com$|^l\.instagram\.com$/, 'Instagram'],
    [/(^|\.)google\./, 'Google'],
    [/bing\.com$|duckduckgo\.com$|yahoo\.|ecosia\.org$|brave\.com$/, 'Outras pesquisas'],
    [/discord(app)?\.com$|discord\.gg$/, 'Discord'],
    [/^t\.me$|telegram\.(org|me)$/, 'Telegram'],
    [/(^|\.)x\.com$|twitter\.com$|^t\.co$/, 'X / Twitter'],
    [/facebook\.com$|fb\.com$/, 'Facebook'],
    [/youtube\.com$|youtu\.be$/, 'YouTube'],
    [/tiktok\.com$/, 'TikTok'],
    [/kick\.com$/, 'Kick'],
    [/whatsapp\.com$|wa\.me$/, 'WhatsApp'],
    [/reddit\.com$/, 'Reddit'],
    [/beacons\.ai$|linktr\.ee$/, 'Link na bio'],
  ];
  for (const [re, nome] of regras) if (re.test(host)) return nome;
  return host.slice(0, 40);
}

async function registar(req, body) {
  const ua = String((req.headers || {})['user-agent'] || '');
  if (!ua || BOTS.test(ua)) return { ok: true, ignorado: 'bot' };
  const ip = ipDe(req);
  const { dia, mes, ano } = periodos();
  const k = (tipo, per, id) => P + 'st:' + tipo + ':' + per + ':' + id;

  // trava de abuso: no máximo 400 eventos por pessoa por dia
  const cod = codigo(dia, ip, ua);
  const lim = P + 'st:lim:' + cod;
  const n = await kv.incr(lim);
  if (n === 1) await kv.expire(lim, DIA);
  if (n > 400) return { ok: true, ignorado: 'limite' };

  if (body.t === 'v') {
    const pag = paginaValida(body.p);
    if (!pag) return { ok: false };
    const ops = [
      kv.pfadd(k('u', 'd', dia), cod),
      kv.pfadd(k('u', 'm', mes), codigo(mes, ip, ua)),
      kv.pfadd(k('u', 'y', ano), codigo(ano, ip, ua)),
      kv.hincrby(k('v', 'd', dia), '_t', 1),
      kv.hincrby(k('v', 'd', dia), pag, 1),
      kv.hincrby(k('v', 'm', mes), '_t', 1),
      kv.hincrby(k('v', 'm', mes), pag, 1),
      kv.hincrby(k('v', 'y', ano), '_t', 1),
      kv.hincrby(k('v', 'y', ano), pag, 1),
    ];
    if (Number(body.n) === 1) {
      const o = origem(body.r);
      if (o) {
        ops.push(kv.hincrby(k('r', 'm', mes), o, 1), kv.hincrby(k('r', 'y', ano), o, 1));
        ops.push(kv.expire(k('r', 'm', mes), TTL_MES));
      }
    }
    ops.push(
      kv.expire(k('u', 'd', dia), TTL_DIA),
      kv.expire(k('v', 'd', dia), TTL_DIA),
      kv.expire(k('u', 'm', mes), TTL_MES),
      kv.expire(k('v', 'm', mes), TTL_MES)
    );
    await Promise.all(ops);
    return { ok: true };
  }

  if (body.t === 'c') {
    const marca = MARCAS.includes(body.m) ? body.m : 'outro';
    const [pg, st] = String(body.s || '').split(':');
    const sitio = (PAGINAS_CLIQUE.includes(pg) ? pg : 'outra') + ':' + (SITIOS.includes(st) ? st : 'outro');
    const campo = marca + '|' + sitio;
    await Promise.all([
      kv.hincrby(k('c', 'd', dia), '_t', 1),
      kv.hincrby(k('c', 'd', dia), marca, 1),
      kv.hincrby(k('c', 'd', dia), campo, 1),
      kv.hincrby(k('c', 'm', mes), '_t', 1),
      kv.hincrby(k('c', 'm', mes), marca, 1),
      kv.hincrby(k('c', 'm', mes), campo, 1),
      kv.hincrby(k('c', 'y', ano), '_t', 1),
      kv.hincrby(k('c', 'y', ano), marca, 1),
      kv.hincrby(k('c', 'y', ano), campo, 1),
      kv.expire(k('c', 'd', dia), TTL_DIA),
      kv.expire(k('c', 'm', mes), TTL_MES),
    ]);
    return { ok: true };
  }
  return { ok: false };
}

// --------------------------- leitura (admin) ---------------------------

function hashNum(h) {
  const o = {};
  if (h) for (const [f, v] of Object.entries(h)) o[f] = toInt(v);
  return o;
}

// separa um hash de cliques em totais por marca e por "marca|sitio"
function cliquesDe(h) {
  const c = hashNum(h);
  const porMarca = {};
  const porSitio = {};
  for (const [f, v] of Object.entries(c)) {
    if (f === '_t') continue;
    if (f.includes('|')) {
      const [m, s] = f.split('|');
      (porSitio[m] = porSitio[m] || {})[s] = v;
    } else porMarca[f] = v;
  }
  return { total: c._t || 0, porMarca, porSitio };
}

function paginasDe(h) {
  const v = hashNum(h);
  const total = v._t || 0;
  delete v._t;
  return { total, paginas: v };
}

async function resumo(opts) {
  const nDias = Math.max(7, Math.min(90, toInt((opts && opts.dias) || 30) || 30));
  const agora = new Date();
  const { dia, mes, ano } = periodos(agora);
  const anoPedido = /^\d{4}$/.test(String((opts && opts.ano) || '')) ? String(opts.ano) : ano;
  const mesPedido = /^\d{4}-\d{2}$/.test(String((opts && opts.mes) || '')) ? String(opts.mes) : mes;

  // últimos N dias (hoje incluído), do mais antigo para o mais recente
  const dias = [];
  const vistos = new Set();
  for (let i = 0; dias.length < nDias && i < nDias + 3; i++) {
    const d = dataLisboa(new Date(agora.getTime() - i * DIA * 1000));
    if (!vistos.has(d)) {
      vistos.add(d);
      dias.unshift(d);
    }
  }
  const meses = [];
  for (let m = 1; m <= 12; m++) meses.push(anoPedido + '-' + String(m).padStart(2, '0'));

  const k = (tipo, per, id) => P + 'st:' + tipo + ':' + per + ':' + id;
  const [diasU, diasV, diasC, mesesU, mesesV, mesesC, mesU, mesV, mesC, mesR, anoU, anoV, anoC, anoR] = await Promise.all([
    Promise.all(dias.map((d) => kv.pfcount(k('u', 'd', d)))),
    Promise.all(dias.map((d) => kv.hget(k('v', 'd', d), '_t'))),
    Promise.all(dias.map((d) => kv.hgetall(k('c', 'd', d)))),
    Promise.all(meses.map((m) => kv.pfcount(k('u', 'm', m)))),
    Promise.all(meses.map((m) => kv.hget(k('v', 'm', m), '_t'))),
    Promise.all(meses.map((m) => kv.hget(k('c', 'm', m), '_t'))),
    kv.pfcount(k('u', 'm', mesPedido)),
    kv.hgetall(k('v', 'm', mesPedido)),
    kv.hgetall(k('c', 'm', mesPedido)),
    kv.hgetall(k('r', 'm', mesPedido)),
    kv.pfcount(k('u', 'y', anoPedido)),
    kv.hgetall(k('v', 'y', anoPedido)),
    kv.hgetall(k('c', 'y', anoPedido)),
    kv.hgetall(k('r', 'y', anoPedido)),
  ]);

  const serie = dias.map((d, i) => {
    const c = cliquesDe(diasC[i]);
    return { data: d, visitantes: toInt(diasU[i]), visitas: toInt(diasV[i]), cliques: c.total, porMarca: c.porMarca };
  });
  const hoje = serie[serie.length - 1] || { data: dia, visitantes: 0, visitas: 0, cliques: 0, porMarca: {} };
  const ontem = serie[serie.length - 2] || null;
  const mv = paginasDe(mesV);
  const mc = cliquesDe(mesC);
  const av = paginasDe(anoV);
  const ac = cliquesDe(anoC);

  return {
    marcas: NOMES_MARCAS,
    hoje,
    ontem,
    dias: serie,
    mes: {
      id: mesPedido,
      visitantes: toInt(mesU),
      visitas: mv.total,
      paginas: mv.paginas,
      cliques: mc.total,
      porMarca: mc.porMarca,
      porSitio: mc.porSitio,
      origens: hashNum(mesR),
    },
    ano: {
      id: anoPedido,
      visitantes: toInt(anoU),
      visitas: av.total,
      paginas: av.paginas,
      cliques: ac.total,
      porMarca: ac.porMarca,
      porSitio: ac.porSitio,
      origens: hashNum(anoR),
      meses: meses.map((m, i) => ({ id: m, visitantes: toInt(mesesU[i]), visitas: toInt(mesesV[i]), cliques: toInt(mesesC[i]) })),
    },
  };
}

module.exports = { registar, resumo, origem, paginaValida, dataLisboa, MARCAS };
