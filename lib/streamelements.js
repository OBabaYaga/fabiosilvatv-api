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
 * @returns {Promise<{ points: number, alltime: number, rank: number|null }>}
 */
async function getLoyaltyInfo(username) {
  const headers = process.env.SE_JWT ? { Authorization: 'Bearer ' + process.env.SE_JWT } : {};
  const res = await fetch(`${SE_API_BASE}/${encodeURIComponent(SE_CHANNEL_ID)}/${encodeURIComponent(username)}`, { headers });
  // Quem nunca apareceu no chat não existe na StreamElements = 0 pontos.
  if (res.status === 404) return { points: 0, alltime: 0, rank: null };
  if (!res.ok) {
    const err = new Error(`StreamElements devolveu ${res.status} ao ler pontos de "${username}".`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const points = typeof data.points === 'number' ? Math.floor(data.points) : 0;
  return {
    points,
    // total ganho desde sempre (só sobe, mesmo que os pontos sejam gastos)
    alltime: typeof data.pointsAlltime === 'number' ? Math.floor(data.pointsAlltime) : points,
    rank: typeof data.rank === 'number' ? data.rank : null,
  };
}

async function getLoyaltyPoints(username) {
  return (await getLoyaltyInfo(username)).points;
}

// Lê os pontos de TODA a gente (leaderboard, de 1000 em 1000).
// Devolve { login: pontos }. Lança erro se a StreamElements falhar.
async function getTodosPontos() {
  const headers = process.env.SE_JWT ? { Authorization: 'Bearer ' + process.env.SE_JWT } : {};
  const LIM = 1000;
  const todos = {};
  for (let offset = 0, pagina = 0; pagina < 100; pagina++, offset += LIM) {
    const res = await fetch(`${SE_API_BASE}/${encodeURIComponent(SE_CHANNEL_ID)}/top?limit=${LIM}&offset=${offset}`, { headers });
    if (!res.ok) {
      const err = new Error(`StreamElements devolveu ${res.status} ao ler o leaderboard.`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const lista = Array.isArray(data) ? data : data.users || data.top || [];
    let novos = 0;
    lista.forEach((u) => {
      const login = String(u.username || '').toLowerCase();
      if (login && !(login in todos)) {
        todos[login] = Math.floor(Number(u.points) || 0);
        novos++;
      }
    });
    const total = Number(data && data._total);
    // acaba quando a página vem incompleta, repetida, ou já temos todos
    if (lista.length < LIM || !novos || (total && Object.keys(todos).length >= total)) break;
  }
  return todos;
}

module.exports = { getLoyaltyInfo, getLoyaltyPoints, getTodosPontos };
