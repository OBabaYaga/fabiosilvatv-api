// ===================================================================
// /api/stats — estatísticas do site
// ===================================================================
// POST (qualquer visitante, sem login; o site usa navigator.sendBeacon)
//   { t:"v", p, n, r }      -> conta uma visita
//   { t:"c", m, s, p }      -> conta um clique num link de parceria
//
// GET ?dias=30&mes=AAAA-MM&ano=AAAA  (só streamer, token Twitch)
//   -> resumo: hoje, últimos N dias, o mês e o ano
// ===================================================================

const { handlePreflight, applyCors } = require('../lib/cors');
const { requireAdmin } = require('../lib/admin');
const { readBody } = require('../lib/body');
const stats = require('../lib/stats');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'POST') {
      const r = await stats.registar(req, readBody(req));
      res.status(200).json(r);
      return;
    }
    if (req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) {
        res.status(403).json({ error: 'Só o streamer pode ver as estatísticas.' });
        return;
      }
      res.status(200).json(await stats.resumo(req.query || {}));
      return;
    }
    res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    console.error('[stats]', e);
    // nunca partir o site por causa das estatísticas
    res.status(req.method === 'POST' ? 200 : 500).json({ ok: false, error: 'Erro nas estatísticas.' });
  }
};
