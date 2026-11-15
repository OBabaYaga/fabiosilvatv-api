// ===================================================================
// /api/push — notificações da app FabioSilva_TV
// ===================================================================
//
// GET                                   -> { publicKey, subscritores }
// POST { acao: "subscrever", subscription } -> guarda este telemóvel/PC
// POST { acao: "cancelar", endpoint }   -> deixa de enviar para ele
//
// Só streamer (ADMIN_LOGINS):
// POST { acao: "ligar-live" }   -> pede à Twitch para nos avisar quando
//                                  o canal entrar em direto
// POST { acao: "estado" }       -> estado desse aviso + nº de subscritores
// POST { acao: "testar" }       -> envia uma notificação de teste a todos
//
// Twitch (EventSub): a Twitch chama esta mesma rota quando o canal entra
// em direto (reconhecido pelos cabeçalhos "Twitch-Eventsub-*").
//
// (Tudo numa só rota porque o plano grátis do Vercel só aceita 12.)
// ===================================================================

const { handlePreflight, applyCors } = require('../lib/cors');
const { requireAdmin } = require('../lib/admin');
const { readBody } = require('../lib/body');
const push = require('../lib/push');

async function tratarTwitch(req, res) {
  const tipo = req.headers['twitch-eventsub-message-type'];
  const body = readBody(req);
  const corpoBruto = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(body);
  const confiavel = push.assinaturaValida(req.headers, corpoBruto);

  // Passo de confirmação quando a subscrição é criada.
  if (tipo === 'webhook_callback_verification') {
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).end(String(body.challenge || ''));
    return;
  }

  if (tipo === 'notification' && body.subscription && body.subscription.type === 'stream.online') {
    try {
      const ev = body.event || {};
      const r =
        confiavel && ev.id
          ? await push.avisarLive(ev.id, ev.broadcaster_user_name)
          : await push.avisarSeEmDireto();
      console.log('[push][twitch]', confiavel ? 'assinado' : 'não assinado', JSON.stringify(r));
    } catch (e) {
      console.error('[push][twitch]', e);
    }
  }
  // revocation / outros tipos: só confirmamos a receção
  res.status(204).end();
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.headers['twitch-eventsub-message-type']) return tratarTwitch(req, res);

  try {
    if (req.method === 'GET') {
      const vapid = await push.getVapid();
      res.status(200).json({ publicKey: vapid.publicKey, subscritores: await push.contarSubs() });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido.' });
      return;
    }

    const body = readBody(req);

    if (body.acao === 'subscrever') {
      const ok = await push.guardarSub(body.subscription);
      res.status(ok ? 200 : 400).json(ok ? { ok: true } : { error: 'Subscrição inválida.' });
      return;
    }

    if (body.acao === 'cancelar') {
      await push.removerSub(body.endpoint);
      res.status(200).json({ ok: true });
      return;
    }

    // --- daqui para baixo, só o streamer ---
    const admin = await requireAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'Só o streamer pode fazer isto.' });
      return;
    }

    if (body.acao === 'estado') {
      let live;
      try {
        live = await push.estadoAvisoLive();
      } catch (e) {
        live = { estado: 'erro', erro: e.message };
      }
      res.status(200).json({ subscritores: await push.contarSubs(), live, canal: push.CANAL });
      return;
    }

    if (body.acao === 'ligar-live') {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const r = await push.ligarAvisoLive(`https://${host}/api/push`);
      res.status(200).json(r);
      return;
    }

    if (body.acao === 'testar') {
      const r = await push.enviarATodos({
        titulo: '🔔 Notificação de teste',
        texto: 'Se estás a ver isto, vais ser avisado quando o Fábio entrar em direto!',
        url: 'https://fabiosilvatv.com/',
        tag: 'teste',
      });
      res.status(200).json(r);
      return;
    }

    res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[push]', e);
    const msg = e.code === 'SEM_SECRET' || e.code === 'TWITCH_AUTH' ? e.message : 'Não foi possível concluir o pedido.';
    res.status(e.code === 'SEM_SECRET' ? 409 : 502).json({ error: msg });
  }
};
