// ===================================================================
// Notificações (Web Push) + aviso automático de live na Twitch
// ===================================================================
//
// Como funciona:
//   1. Quem ativa as notificações no site (ou na app instalada) envia-nos
//      a sua "subscrição" de push, que guardamos no Redis.
//   2. A Twitch avisa-nos (EventSub, evento "stream.online") quando o
//      canal entra em direto, chamando POST /api/push.
//   3. Antes de enviar seja o que for, confirmamos na própria API da
//      Twitch que o canal está mesmo em direto — assim um pedido falso a
//      fingir ser da Twitch nunca consegue mandar notificações.
//   4. Enviamos a notificação a todas as subscrições guardadas (só uma
//      vez por live, mesmo que a Twitch repita o aviso).
//
// Variáveis de ambiente (Vercel):
//   TWITCH_CLIENT_SECRET  — gerado em dev.twitch.tv/console/apps (obrigatório)
//   TWITCH_CLIENT_ID      — opcional, por omissão usa o mesmo do site
//   TWITCH_CANAL          — opcional, por omissão "fabiosilva_tv"
//
// As chaves VAPID (que identificam o nosso servidor perante os serviços
// de push da Google/Apple/Mozilla) são geradas sozinhas na primeira vez
// e guardadas no Redis — não precisas de configurar nada para isso.
// ===================================================================

const crypto = require('crypto');
const webpush = require('web-push');
const { kv, P } = require('./store');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '34eu7t2r5xt7dev6v1x8cimr2ajhxk';
const CANAL = (process.env.TWITCH_CANAL || 'fabiosilva_tv').toLowerCase();
const TWITCH_ID_BASE = process.env.TWITCH_ID_BASE || 'https://id.twitch.tv';
const TWITCH_API_BASE = process.env.TWITCH_API_BASE || 'https://api.twitch.tv';

const SUBS_KEY = P + 'push:subs';
const VAPID_KEY = P + 'push:vapid';
const ULTIMA_LIVE_KEY = P + 'push:ultima-live';
const CONTACTO = 'mailto:parceriasobabayaga@gmail.com';

function parse(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }
  return v;
}

// ---------------------------------------------------------------
// Chaves VAPID
// ---------------------------------------------------------------
async function getVapid() {
  let vapid = parse(await kv.get(VAPID_KEY));
  if (!vapid || !vapid.publicKey) {
    const novas = webpush.generateVAPIDKeys();
    // NX: se dois pedidos gerarem ao mesmo tempo, fica só a primeira
    await kv.set(VAPID_KEY, JSON.stringify(novas), { nx: true });
    vapid = parse(await kv.get(VAPID_KEY));
  }
  return vapid;
}

// ---------------------------------------------------------------
// Subscrições
// ---------------------------------------------------------------
function idSub(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

function subValida(sub) {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.endpoint.length < 1000 &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

async function guardarSub(sub) {
  if (!subValida(sub)) return false;
  const limpa = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  await kv.hset(SUBS_KEY, { [idSub(sub.endpoint)]: JSON.stringify(limpa) });
  return true;
}

async function removerSub(endpoint) {
  if (typeof endpoint !== 'string') return;
  await kv.hdel(SUBS_KEY, idSub(endpoint));
}

async function contarSubs() {
  return Number(await kv.hlen(SUBS_KEY)) || 0;
}

// Envia a mesma notificação a toda a gente. Subscrições que já não
// existem (a pessoa desinstalou a app / bloqueou notificações) são
// apagadas automaticamente.
async function enviarATodos(notificacao) {
  const vapid = await getVapid();
  webpush.setVapidDetails(CONTACTO, vapid.publicKey, vapid.privateKey);

  const todas = (await kv.hgetall(SUBS_KEY)) || {};
  const entradas = Object.entries(todas);
  const corpo = JSON.stringify(notificacao);
  let enviadas = 0;
  const mortas = [];

  for (let i = 0; i < entradas.length; i += 50) {
    const lote = entradas.slice(i, i + 50);
    await Promise.all(
      lote.map(async ([id, raw]) => {
        const sub = parse(raw);
        try {
          await webpush.sendNotification(sub, corpo, { TTL: 60 * 60, urgency: 'high' });
          enviadas++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) mortas.push(id);
          else console.warn('[push] falhou envio', e.statusCode || e.message);
        }
      })
    );
  }
  if (mortas.length) await kv.hdel(SUBS_KEY, ...mortas);
  return { enviadas, removidas: mortas.length, total: entradas.length };
}

// ---------------------------------------------------------------
// Twitch
// ---------------------------------------------------------------
function precisaSecret() {
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!secret) {
    const err = new Error('Falta configurar TWITCH_CLIENT_SECRET no Vercel.');
    err.code = 'SEM_SECRET';
    throw err;
  }
  return secret;
}

// Segredo partilhado com a Twitch para a subscrição EventSub (10–100
// caracteres). Derivado do Client Secret para não ser preciso mais uma
// variável de ambiente.
function segredoEventSub() {
  return crypto.createHash('sha256').update('fstv-eventsub:' + precisaSecret()).digest('hex');
}

async function appToken() {
  const guardado = await kv.get(P + 'twitch:app-token');
  if (guardado) return String(guardado);
  const res = await fetch(`${TWITCH_ID_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: precisaSecret(), grant_type: 'client_credentials' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error('A Twitch recusou o Client ID/Secret (' + (data.message || res.status) + ').');
    err.code = 'TWITCH_AUTH';
    throw err;
  }
  const validade = Math.max(60, Math.min(Number(data.expires_in) || 3600, 30 * 24 * 3600) - 300);
  await kv.set(P + 'twitch:app-token', data.access_token, { ex: validade });
  return data.access_token;
}

async function helix(method, path, body) {
  const token = await appToken();
  const res = await fetch(TWITCH_API_BASE + '/helix' + path, {
    method,
    headers: Object.assign(
      { 'Client-Id': CLIENT_ID, Authorization: 'Bearer ' + token },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) await kv.del(P + 'twitch:app-token');
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twitch ${method} ${path} devolveu ${res.status}: ${data.message || ''}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function idDoCanal() {
  const guardado = await kv.get(P + 'twitch:canal-id:' + CANAL);
  if (guardado) return String(guardado);
  const data = await helix('GET', '/users?login=' + encodeURIComponent(CANAL));
  const user = data.data && data.data[0];
  if (!user) throw new Error(`Canal "${CANAL}" não encontrado na Twitch.`);
  await kv.set(P + 'twitch:canal-id:' + CANAL, user.id);
  return user.id;
}

// Cria (ou recria) a subscrição EventSub "stream.online" a apontar para
// este servidor. Chamado pelo botão no Painel de Controlo.
async function ligarAvisoLive(callbackUrl) {
  const canalId = await idDoCanal();
  const existentes = await helix('GET', '/eventsub/subscriptions?type=stream.online');
  for (const s of existentes.data || []) {
    if (s.condition && s.condition.broadcaster_user_id === canalId) {
      await helix('DELETE', '/eventsub/subscriptions?id=' + encodeURIComponent(s.id));
    }
  }
  const criada = await helix('POST', '/eventsub/subscriptions', {
    type: 'stream.online',
    version: '1',
    condition: { broadcaster_user_id: canalId },
    transport: { method: 'webhook', callback: callbackUrl, secret: segredoEventSub() },
  });
  const sub = criada.data && criada.data[0];
  return { estado: sub ? sub.status : 'desconhecido', callback: callbackUrl };
}

async function estadoAvisoLive() {
  if (!process.env.TWITCH_CLIENT_SECRET) return { estado: 'sem_secret' };
  const canalId = await idDoCanal();
  const existentes = await helix('GET', '/eventsub/subscriptions?type=stream.online');
  const s = (existentes.data || []).find((x) => x.condition && x.condition.broadcaster_user_id === canalId);
  return s ? { estado: s.status, callback: s.transport && s.transport.callback } : { estado: 'desligado' };
}

// Verifica a assinatura HMAC que a Twitch põe em cada aviso EventSub.
// Se bater certo, o aviso é mesmo da Twitch e podemos confiar nele.
function assinaturaValida(headers, corpo) {
  try {
    const id = headers['twitch-eventsub-message-id'];
    const ts = headers['twitch-eventsub-message-timestamp'];
    const sig = headers['twitch-eventsub-message-signature'];
    if (!id || !ts || !sig || !process.env.TWITCH_CLIENT_SECRET) return false;
    if (Math.abs(Date.now() - Date.parse(ts)) > 10 * 60 * 1000) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', segredoEventSub()).update(id + ts + corpo).digest('hex');
    const a = Buffer.from(esperado);
    const b = Buffer.from(String(sig));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// Envia o aviso de live (só uma vez por live — a Twitch pode repetir o
// aviso, e o NX garante isto mesmo que cheguem dois ao mesmo tempo).
async function avisarLive(streamId, nomeCanal) {
  const reservado = await kv.set(`${ULTIMA_LIVE_KEY}:${streamId}`, '1', { nx: true, ex: 24 * 3600 });
  if (!reservado) return { enviado: false, motivo: 'já avisado para esta live' };

  let titulo = '';
  let jogo = '';
  let nome = nomeCanal || CANAL;
  try {
    const canalId = await idDoCanal();
    const info = await helix('GET', '/channels?broadcaster_id=' + encodeURIComponent(canalId));
    const c = info.data && info.data[0];
    if (c) {
      titulo = c.title || '';
      jogo = c.game_name || '';
      nome = c.broadcaster_name || nome;
    }
  } catch (e) {
    console.warn('[push] sem título da live:', e.message);
  }

  const r = await enviarATodos({
    titulo: `🔴 ${nome} está em direto!`,
    texto: [titulo, jogo].filter(Boolean).join(' · ') || 'Entra já na live!',
    url: 'https://www.twitch.tv/' + CANAL,
    tag: 'live-' + streamId,
  });
  return Object.assign({ enviado: true, live: streamId }, r);
}

// Para avisos sem assinatura válida: só avisa se a Twitch confirmar que
// o canal está mesmo em direto (um pedido falso não consegue nada).
async function avisarSeEmDireto() {
  const canalId = await idDoCanal();
  // A lista de lives da Twitch às vezes demora uns segundos a atualizar.
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const data = await helix('GET', '/streams?user_id=' + encodeURIComponent(canalId));
    const live = data.data && data.data[0];
    if (live) return avisarLive(live.id, live.user_name);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { enviado: false, motivo: 'canal não está em direto' };
}

module.exports = {
  CANAL,
  getVapid,
  guardarSub,
  removerSub,
  contarSubs,
  enviarATodos,
  ligarAvisoLive,
  estadoAvisoLive,
  assinaturaValida,
  avisarLive,
  avisarSeEmDireto,
};
