// GET /api/saldo?username=login -> { pontos, saldo, rank } (público, só leitura)
const { handlePreflight, applyCors } = require('../lib/cors');
const saldo = require('../lib/saldo');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  const login = String((req.query && req.query.username) || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,25}$/.test(login)) {
    res.status(400).json({ error: 'Falta o parâmetro "username".' });
    return;
  }
  try {
    res.status(200).json(await saldo.getEstado(login));
  } catch (e) {
    console.error('[saldo]', e);
    res.status(502).json({ error: 'Não foi possível ler os pontos.' });
  }
};
