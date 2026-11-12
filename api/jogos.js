// ===================================================================
// /api/jogos — minijogos em modo Ranking (fichas sem valor, ganhas a ver a live)
// ===================================================================
// GET                                        -> ranking (público)
//
// Com sessão Twitch (Authorization: Bearer <token>):
// POST { acao: "estado" }                    -> as minhas fichas (junta as
//                                               ganhas a ver a live), posição
//                                               e jogos a decorrer
// POST { acao: "jogar", jogo, passo, params } -> uma jogada (o servidor sorteia)
// ===================================================================

const crypto = require('crypto');
const { handlePreflight, applyCors } = require('../lib/cors');
const { readBody } = require('../lib/body');
const { validateTwitchToken } = require('../lib/twitch');
const { kv, P } = require('../lib/store');
const jogos = require('../lib/jogos');

// Guarda a validação do token 10 min (poupa uma chamada à Twitch por jogada)
async function utilizador(req) {
  const h = (req.headers && req.headers.authorization) || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const chave = `${P}tok:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 40)}`;
  const guardado = await kv.get(chave);
  if (guardado) return String(guardado);
  const u = await validateTwitchToken(token);
  if (!u) return null;
  await kv.set(chave, u.login, { ex: 600 });
  return u.login;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      res.status(200).json(await jogos.ranking());
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido.' });
      return;
    }
    const login = await utilizador(req);
    if (!login) {
      res.status(401).json({ code: 'SESSAO', error: 'Entra com a Twitch para jogar no ranking.' });
      return;
    }
    const body = readBody(req);
    if (body.acao === 'estado') return void res.status(200).json(await jogos.estado(login));
    if (body.acao === 'jogar') return void res.status(200).json(await jogos.jogar(login, String(body.jogo || ''), body.passo, body.params));
    res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    if (e instanceof jogos.ErroAPI) {
      res.status(e.status).json({ code: e.code, error: e.message });
      return;
    }
    console.error('[jogos]', e);
    res.status(500).json({ error: 'Erro no servidor. Tenta outra vez.' });
  }
};
