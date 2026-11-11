// ===================================================================
// Servidor "de mentira" que finge ser a Twitch + o StreamElements, só
// para testarmos a lógica do nosso backend sem precisar de credenciais
// reais. NÃO faz parte do backend entregue — é só uma ferramenta de
// desenvolvimento/teste.
// ===================================================================
const http = require('http');

const VALID_TOKENS = {
  'token-fabio-valido': { login: 'fabio_teste', user_id: '111' },
  'token-outrapessoa-valida': { login: 'outrapessoa', user_id: '222' },
};

// saldo de pontos "na base de dados" fake do StreamElements
const POINTS_DB = {
  fabio_teste: 500,
  outrapessoa: 20,
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const API_FOOTBALL_CALLS = { n: 0 };
const TWITCH_STATE = { live: null, subs: [] };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // --- Twitch: GET /oauth2/validate ---
  if (url.pathname === '/oauth2/validate') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('OAuth ') ? auth.slice(6) : null;
    const user = token && VALID_TOKENS[token];
    if (!user) return send(res, 401, { message: 'invalid access token' });
    return send(res, 200, { client_id: 'fake', login: user.login, user_id: user.user_id, scopes: [] });
  }

  // --- StreamElements: GET /kappa/v2/points/:channel/top ---
  // (tem de ser verificado ANTES da rota genérica :username abaixo,
  // senão "top" seria interpretado como um nome de utilizador)
  const topMatch = url.pathname.match(/^\/kappa\/v2\/points\/([^/]+)\/top$/);
  if (topMatch && req.method === 'GET') {
    const list = Object.entries(POINTS_DB)
      .map(([username, points]) => ({ username, points }))
      .sort((a, b) => b.points - a.points);
    return send(res, 200, list);
  }

  // --- StreamElements: GET/PUT /kappa/v2/points/:channel/:username[/:amount] ---
  const pointsMatch = url.pathname.match(/^\/kappa\/v2\/points\/([^/]+)\/([^/]+)(?:\/(-?\d+))?$/);
  if (pointsMatch) {
    const [, channel, username, amountStr] = pointsMatch;
    if (channel !== 'fake-channel-id') return send(res, 404, { message: 'channel not found' });

    if (req.method === 'GET' && amountStr === undefined) {
      const points = POINTS_DB[username] != null ? POINTS_DB[username] : 0;
      return send(res, 200, { channel, username, points, rank: 1 });
    }

    if (req.method === 'PUT' && amountStr !== undefined) {
      const amount = parseInt(amountStr, 10);
      POINTS_DB[username] = Math.max(0, (POINTS_DB[username] || 0) + amount);
      return send(res, 200, { channel, username, newAmount: POINTS_DB[username] });
    }
  }

  // --- Twitch (app token + Helix) para as notificações de live ---
  if (url.pathname === '/oauth2/token' && req.method === 'POST') {
    return send(res, 200, { access_token: 'app-token-teste', expires_in: 3600 });
  }
  if (url.pathname.startsWith('/helix/')) {
    if (req.headers.authorization !== 'Bearer app-token-teste') return send(res, 401, { message: 'invalid token' });
    if (url.pathname === '/helix/users') return send(res, 200, { data: [{ id: '999', login: 'edu___silva' }] });
    if (url.pathname === '/helix/streams') return send(res, 200, { data: TWITCH_STATE.live ? [{ id: TWITCH_STATE.live, user_name: 'Edu___Silva', title: 'Jornada!', game_name: 'EA FC' }] : [] });
    if (url.pathname === '/helix/channels') return send(res, 200, { data: [{ broadcaster_name: 'Edu___Silva', title: 'Live de teste', game_name: 'EA FC' }] });
    if (url.pathname === '/helix/eventsub/subscriptions') {
      if (req.method === 'GET') return send(res, 200, { data: TWITCH_STATE.subs });
      if (req.method === 'DELETE') { TWITCH_STATE.subs = TWITCH_STATE.subs.filter((s) => s.id !== url.searchParams.get('id')); res.writeHead(204); return res.end(); }
      if (req.method === 'POST') {
        let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
          const b = JSON.parse(raw);
          const sub = { id: 'sub' + Date.now(), status: 'webhook_callback_verification_pending', type: b.type, condition: b.condition, transport: { method: 'webhook', callback: b.transport.callback } };
          TWITCH_STATE.subs.push(sub);
          send(res, 202, { data: [sub] });
        });
        return;
      }
    }
  }
  if (url.pathname === '/_twitch' && req.method === 'POST') {
    TWITCH_STATE.live = url.searchParams.get('live') || null;
    return send(res, 200, TWITCH_STATE);
  }

  if (url.pathname === '/apifootball/_calls') return send(res, 200, API_FOOTBALL_CALLS);

  // --- API-Football: GET /apifootball/fixtures?date=... | ?ids=a-b ---
  if (url.pathname === '/apifootball/fixtures') {
    API_FOOTBALL_CALLS.n++;
    if (req.headers['x-apisports-key'] !== 'chave-teste') {
      return send(res, 200, { errors: { token: 'Error/Missing application key.' }, response: [] });
    }
    const jogo = (id, liga, short, gh, ga, events) => ({
      fixture: { id, date: new Date().toISOString(), status: { short, elapsed: short === '2H' ? 67 : 90 }, venue: { name: 'Estádio' } },
      league: { id: liga, name: 'Liga ' + liga, country: 'X', logo: '', round: 'Regular Season - 11' },
      teams: { home: { id: 1, name: 'Casa', logo: '', winner: null }, away: { id: 2, name: 'Fora', logo: '', winner: null } },
      goals: { home: gh, away: ga },
      events: events || [],
    });
    const ev = [{ time: { elapsed: 10, extra: null }, team: { id: 1 }, player: { name: 'Marcador' }, type: 'Goal', detail: 'Normal Goal' }, { time: { elapsed: 20 }, team: { id: 2 }, player: { name: 'Sub' }, type: 'subst', detail: 'Substitution 1' }];
    const todos = [jogo(501, 94, '2H', 1, 0), jogo(502, 39, 'FT', 2, 2), jogo(503, 999, 'FT', 0, 0), jogo(504, 140, 'NS', null, null)];
    if (url.searchParams.get('ids')) {
      const ids = url.searchParams.get('ids').split('-').map(Number);
      return send(res, 200, { errors: [], response: todos.filter((j) => ids.includes(j.fixture.id)).map((j) => Object.assign(j, { events: ev })) });
    }
    return send(res, 200, { errors: [], response: todos });
  }

  send(res, 404, { message: 'not found in mock' });
});

const PORT = process.env.MOCK_PORT || 4001;
server.listen(PORT, () => {
  console.log(`[mock] a correr em http://localhost:${PORT}`);
});
