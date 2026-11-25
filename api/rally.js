// ===================================================================
// /api/rally — melhores voltas do Rally (ver lib/rally.js)
// GET  ?pista=douro                         top 10
// POST {acao:'tempo', pista, ms, nome}      (login Twitch)
// ===================================================================
const { handlePreflight, applyCors } = require('../lib/cors');
const { readBody } = require('../lib/body');
const { requireUser } = require('../lib/admin');
const rally = require('../lib/rally');

const enviar = (res, r) => res.status(r.status).json(r.json);

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return enviar(res, await rally.top(String((req.query || {}).pista || '')));
    if (req.method === 'POST') {
      const body = readBody(req);
      if (body.acao !== 'tempo') return enviar(res, { status: 400, json: { error: 'Ação desconhecida.' } });
      const user = await requireUser(req);
      if (!user) return enviar(res, { status: 401, json: { error: 'Entra com a Twitch para guardar o tempo.' } });
      return enviar(res, await rally.registar(user, body));
    }
    res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    console.error('[rally]', e);
    res.status(500).json({ error: 'Erro no servidor.' });
  }
};
