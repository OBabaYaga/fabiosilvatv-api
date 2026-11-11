// ===================================================================
// CORS — só o site fabiosilvatv.com pode chamar esta API a partir de
// um browser. (FRONTEND_URL aceita vários endereços separados por
// vírgulas; por omissão: https://fabiosilvatv.com e o www.)
// Chamadas diretas (curl, outro servidor) não são travadas pelo CORS,
// mas tudo o que mexe em pontos exige um token Twitch válido.
// ===================================================================

function origensPermitidas() {
  return (process.env.FRONTEND_URL || 'https://fabiosilvatv.com,https://www.fabiosilvatv.com')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function applyCors(req, res) {
  const origem = (req.headers && req.headers.origin) || '';
  const permitidas = origensPermitidas();
  const permitir = permitidas.includes('*') ? '*' : permitidas.includes(origem) ? origem : permitidas[0];
  res.setHeader('Access-Control-Allow-Origin', permitir);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function handlePreflight(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors, handlePreflight };
