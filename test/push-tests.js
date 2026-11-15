// node test/mock-external.js & node test/push-tests.js
process.env.TWITCH_VALIDATE_URL = 'http://localhost:4001/oauth2/validate';
process.env.KV_REST_API_URL = 'x'; process.env.KV_REST_API_TOKEN = 'x';
process.env.ADMIN_LOGINS = 'fabio_teste';
process.env.TWITCH_ID_BASE = 'http://localhost:4001';
process.env.TWITCH_API_BASE = 'http://localhost:4001';
process.env.TWITCH_CLIENT_SECRET = 'segredo-teste';
require('./fake-redis');
const assert = require('assert');
const crypto = require('crypto');
const webpush = require('web-push');
const ENVIADAS = [];
webpush.sendNotification = async (sub, corpo) => {
  if (sub.endpoint.includes('morta')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
  ENVIADAS.push({ endpoint: sub.endpoint, ...JSON.parse(corpo) });
};
const pushApi = require('../api/push.js');
function res() { return { setHeader() {}, status(c) { this.s = c; return this; }, json(o) { this.j = o; return this; }, end() { return this; } }; }
async function call(method, body, token) {
  const r = res();
  await pushApi({ method, body, query: {}, headers: token ? { authorization: 'Bearer ' + token } : {} }, r);
  return r;
}
(async () => {
  let r = await call('GET');
  assert.equal(r.s, 200); assert.ok(r.j.publicKey.length > 50);
  const sub = (n) => ({ endpoint: 'https://push.exemplo/' + n, keys: { p256dh: 'p' + n, auth: 'a' + n } });
  for (const n of ['a', 'b', 'morta']) { r = await call('POST', { acao: 'subscrever', subscription: sub(n) }); assert.equal(r.s, 200); }
  r = await call('POST', { acao: 'subscrever', subscription: { endpoint: 'javascript:x' } }); assert.equal(r.s, 400);
  r = await call('POST', { acao: 'testar' }, 'token-outrapessoa-valida'); assert.equal(r.s, 403);
  r = await call('POST', { acao: 'ligar-live' }, 'token-fabio-valido'); assert.equal(r.s, 200, JSON.stringify(r.j));
  r = await call('POST', { acao: 'estado' }, 'token-fabio-valido'); assert.equal(r.j.subscritores, 3); assert.equal(r.j.canal, 'fabiosilva_tv');
  r = await call('POST', { acao: 'testar' }, 'token-fabio-valido'); assert.equal(r.j.enviadas, 2); assert.equal(r.j.removidas, 1);
  assert.ok(ENVIADAS[0].texto.includes('Fábio'));
  ENVIADAS.length = 0;
  const twitchReq = async (tipo, corpo, assinar) => {
    const raw = JSON.stringify(corpo);
    const id = 'msg' + Math.random(), ts = new Date().toISOString();
    const segredo = crypto.createHash('sha256').update('fstv-eventsub:segredo-teste').digest('hex');
    const sig = 'sha256=' + crypto.createHmac('sha256', assinar ? segredo : 'errado').update(id + ts + raw).digest('hex');
    const rr = res(); let fim = null; rr.end = (x) => { fim = x; return rr; };
    await pushApi({ method: 'POST', body: corpo, query: {}, headers: { 'twitch-eventsub-message-type': tipo, 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': ts, 'twitch-eventsub-message-signature': sig } }, rr);
    return { s: rr.s, fim };
  };
  let t = await twitchReq('webhook_callback_verification', { challenge: 'abc123', subscription: {} }, true);
  assert.equal(t.fim, 'abc123');
  const aviso = { subscription: { type: 'stream.online' }, event: { id: 'live1', broadcaster_user_name: 'FabioSilva_TV' } };
  await fetch('http://localhost:4001/_twitch?live=', { method: 'POST' }).catch(() => {});
  t = await twitchReq('notification', aviso, false);
  assert.equal(ENVIADAS.length, 0, 'aviso falso não envia');
  t = await twitchReq('notification', aviso, true);
  t = await twitchReq('notification', aviso, true);
  assert.equal(ENVIADAS.length, 2); assert.ok(ENVIADAS[0].titulo.includes('em direto')); assert.ok(ENVIADAS[0].url.includes('fabiosilva_tv'));
  console.log('notificação:', ENVIADAS[0]);
  console.log('TODOS OS TESTES DE NOTIFICAÇÕES PASSARAM');
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
