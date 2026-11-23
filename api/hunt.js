// ===================================================================
// /api/hunt — bonus hunt ao vivo, Guess the Balance e arquivo
// ===================================================================
// GET (público)
//   ?acao=atual              -> hunt a decorrer (ou a última) + estado do guess
//   ?acao=lista&pagina=0     -> arquivo de hunts, as mais recentes primeiro
//   ?acao=ver&id=...         -> uma hunt do arquivo, completa
// GET com sessão Twitch
//   ?acao=meu                -> o meu palpite na hunt atual
// GET do streamer
//   ?acao=palpites[&id=...]  -> todos os palpites (o servidor das overlays usa isto)
//
// POST { acao: "palpite", valor, nome }   sessão Twitch de qualquer pessoa
// POST { acao: "sync", id, hunt, stats, guess }   só o streamer
// POST { acao: "apagar", id }                      só o streamer
//
// "Só o streamer" = token Twitch de quem está em ADMIN_LOGINS, ou o
// cabeçalho X-Hunt-Key igual à variável HUNT_SYNC_KEY (para o servidor
// das overlays, se o token dele não for da conta do streamer).
// ===================================================================

const crypto = require('crypto');
const { handlePreflight, applyCors } = require('../lib/cors');
const { requireUser, requireAdmin, getAdminLogins } = require('../lib/admin');
const { readBody } = require('../lib/body');
const hunt = require('../lib/hunt');

function chaveValida(req) {
  const esperada = process.env.HUNT_SYNC_KEY || '';
  const dada = String((req.headers && (req.headers['x-hunt-key'] || req.headers['X-Hunt-Key'])) || '');
  if (!esperada || !dada || esperada.length !== dada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(dada));
}

async function ehStreamer(req) {
  if (chaveValida(req)) return true;
  return !!(await requireAdmin(req));
}

function enviar(res, r) {
  res.status(r.status).json(r.json);
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  // o servidor das overlays usa este cabeçalho
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hunt-Key');

  try {
    const q = req.query || {};
    if (req.method === 'GET') {
      const acao = q.acao || 'atual';
      if (acao === 'atual') return enviar(res, await hunt.atual());
      if (acao === 'lista') return enviar(res, await hunt.lista(q));
      if (acao === 'ver') return enviar(res, await hunt.ver(q.id));
      if (acao === 'meu') {
        const user = await requireUser(req);
        if (!user) return enviar(res, { status: 401, json: { error: 'Entra com a Twitch.' } });
        return enviar(res, await hunt.meuPalpite(user));
      }
      if (acao === 'palpites') {
        if (!(await ehStreamer(req))) return enviar(res, { status: 403, json: { error: 'Só o streamer.' } });
        return enviar(res, await hunt.palpitesAdmin(q.id));
      }
      return enviar(res, { status: 400, json: { error: 'Ação desconhecida.' } });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      if (body.acao === 'palpite') {
        const user = await requireUser(req);
        if (!user) return enviar(res, { status: 401, json: { error: 'Entra com a Twitch para dares o teu palpite.' } });
        return enviar(res, await hunt.palpite(user, body, getAdminLogins()));
      }
      if (body.acao === 'sync' || body.acao === 'apagar') {
        if (!(await ehStreamer(req))) return enviar(res, { status: 403, json: { error: 'Só o streamer.' } });
        return enviar(res, body.acao === 'sync' ? await hunt.sync(body) : await hunt.apagar(body.id));
      }
      return enviar(res, { status: 400, json: { error: 'Ação desconhecida.' } });
    }

    res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    console.error('[hunt]', e);
    res.status(500).json({ error: 'Erro na hunt. Tenta outra vez.' });
  }
};
