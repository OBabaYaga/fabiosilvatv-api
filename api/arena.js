// ===================================================================
// /api/arena — salas do jogo Arena 4v4 (ver lib/arena.js)
//
// GET  ?acao=lista[&jogo=bilhar]   salas públicas abertas (arena ou bilhar)
// GET  ?acao=ver&cod=XXXXX         uma sala
// GET  ?acao=sinais&cod=XXXXX      mensagens de ligação para mim (login)
// POST {acao:'criar', nome, titulo, publica}            (login)
// POST {acao:'estado', cod, n, estado, placar}          (anfitrião)
// POST {acao:'fechar', cod}                             (anfitrião)
// POST {acao:'sinal', cod, para, tipo, dados, nome}     (login)
// ===================================================================

const { handlePreflight, applyCors } = require('../lib/cors');
const { readBody } = require('../lib/body');
const arena = require('../lib/arena');

function token(req) {
  const a = (req.headers && req.headers.authorization) || '';
  return a.startsWith('Bearer ') ? a.slice(7) : null;
}

function enviar(res, r) {
  res.status(r.status).json(r.json);
}

const SEM_LOGIN = { status: 401, json: { error: 'Entra com a Twitch para jogar.' } };

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  try {
    const q = req.query || {};
    if (req.method === 'GET') {
      if (q.acao === 'lista') return enviar(res, await arena.lista(q));
      if (q.acao === 'ver') return enviar(res, await arena.ver(q.cod));
      if (q.acao === 'sinais') {
        const user = await arena.utilizador(token(req));
        if (!user) return enviar(res, SEM_LOGIN);
        return enviar(res, await arena.sinais(user, q));
      }
      return enviar(res, { status: 400, json: { error: 'Ação desconhecida.' } });
    }
    if (req.method === 'POST') {
      const body = readBody(req);
      const user = await arena.utilizador(token(req));
      if (!user) return enviar(res, SEM_LOGIN);
      if (body.acao === 'criar') return enviar(res, await arena.criar(user, body));
      if (body.acao === 'estado') return enviar(res, await arena.estado(user, body));
      if (body.acao === 'fechar') return enviar(res, await arena.fechar(user, body));
      if (body.acao === 'sinal') return enviar(res, await arena.sinal(user, body));
      return enviar(res, { status: 400, json: { error: 'Ação desconhecida.' } });
    }
    res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    console.error('[arena]', e);
    res.status(500).json({ error: 'Erro no servidor.' });
  }
};
