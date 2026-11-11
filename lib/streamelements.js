// ===================================================================
// StreamElements — pontos de fidelidade (só leitura)
// ===================================================================
// O site NUNCA gasta nem altera estes pontos: só os lê, para mostrar e
// para calcular o saldo da loja (ver lib/saldo.js).
//
// A leitura dos pontos de um viewer é pública na StreamElements, por
// isso não é preciso JWT. (Se um dia a StreamElements passar a exigir,
// basta definir SE_JWT no Vercel.)
// ===================================================================

const SE_API_BASE = process.env.SE_API_BASE || 'https://api.streamelements.com/kappa/v2/points';
// Account ID da StreamElements do canal fabiosilva_tv (o mesmo do site)
const SE_CHANNEL_ID = process.env.SE_CHANNEL_ID || '66d3ab3e543cc77f5efabde9';

/**
 * @returns {Promise<{ points: number, rank: number|null }>}
 */
async function getLoyaltyInfo(username) {
  const headers = process.env.SE_JWT ? { Authorization: 'Bearer ' + process.env.SE_JWT } : {};
  const res = await fetch(`${SE_API_BASE}/${encodeURIComponent(SE_CHANNEL_ID)}/${encodeURIComponent(username)}`, { headers });
  // Quem nunca apareceu no chat não existe na StreamElements = 0 pontos.
  if (res.status === 404) return { points: 0, rank: null };
  if (!res.ok) {
    const err = new Error(`StreamElements devolveu ${res.status} ao ler pontos de "${username}".`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return {
    points: typeof data.points === 'number' ? Math.floor(data.points) : 0,
    rank: typeof data.rank === 'number' ? data.rank : null,
  };
}

async function getLoyaltyPoints(username) {
  return (await getLoyaltyInfo(username)).points;
}

module.exports = { getLoyaltyInfo, getLoyaltyPoints };
