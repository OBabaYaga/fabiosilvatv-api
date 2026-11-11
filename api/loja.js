// ===================================================================
// /api/loja
// ===================================================================
// GET                                      -> prémios ativos + casinos
//
// Com sessão Twitch (Authorization: Bearer <token>):
// POST { acao: "estado" }                  -> pontos, saldo e os meus pedidos
// POST { acao: "comprar", produtoId, dados } -> compra um prémio
//
// Só streamer (ADMIN_LOGINS, por omissão "fabiosilva_tv"):
// POST { acao: "admin" }                   -> todos os prémios (inclui
//                                             inativos) + últimos pedidos
// POST { acao: "guardar-produto", produto } -> cria/edita (preço, stock…)
// POST { acao: "apagar-produto", id }
// POST { acao: "pedido", id, estado: "entregue"|"recusado", nota }
// POST { acao: "ajustar-saldo", username, quantidade }
// ===================================================================

const { handlePreflight, applyCors } = require('../lib/cors');
const { requireUser, getAdminLogins } = require('../lib/admin');
const { readBody } = require('../lib/body');
const loja = require('../lib/loja');
const saldo = require('../lib/saldo');

const ERROS_VIEWER = ['INVALIDO', 'ESGOTADO', 'LIMITE', 'SALDO', 'OCUPADO'];

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ produtos: await loja.listarProdutos(), casinos: loja.CASINOS });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido.' });
      return;
    }

    const user = await requireUser(req);
    if (!user) {
      res.status(401).json({ error: 'Entra com a Twitch para usar a loja.' });
      return;
    }
    const body = readBody(req);
    const ehAdmin = getAdminLogins().includes(user.login);

    if (body.acao === 'estado') {
      const [estado, pedidos] = await Promise.all([saldo.getEstado(user.login), loja.pedidosDoUtilizador(user.login)]);
      res.status(200).json(Object.assign({ admin: ehAdmin, pedidos }, estado));
      return;
    }

    if (body.acao === 'comprar') {
      const r = await loja.comprar(user.login, String(body.produtoId || ''), body.dados || {});
      res.status(200).json(r);
      return;
    }

    // --- só streamer ---
    if (!ehAdmin) {
      res.status(403).json({ error: 'Só o streamer pode fazer isto.' });
      return;
    }

    if (body.acao === 'admin') {
      const [produtos, pedidos] = await Promise.all([loja.listarProdutos({ incluirInativos: true }), loja.todosPedidos()]);
      res.status(200).json({ produtos, pedidos });
      return;
    }
    if (body.acao === 'guardar-produto') {
      res.status(200).json({ produto: await loja.guardarProduto(body.produto || {}) });
      return;
    }
    if (body.acao === 'apagar-produto') {
      await loja.apagarProduto(String(body.id || ''));
      res.status(200).json({ ok: true });
      return;
    }
    if (body.acao === 'pedido') {
      res.status(200).json({ pedido: await loja.atualizarPedido(String(body.id || ''), body.estado, body.nota) });
      return;
    }
    if (body.acao === 'ajustar-saldo') {
      const login = String(body.username || '').trim().toLowerCase().replace(/^@/, '');
      const q = Math.round(Number(body.quantidade));
      if (!/^[a-z0-9_]{2,25}$/.test(login) || !Number.isFinite(q) || q === 0 || Math.abs(q) > 10000000) {
        res.status(400).json({ error: 'Indica um utilizador da Twitch e uma quantidade válida.' });
        return;
      }
      const r = await saldo.alterarSaldo(login, q);
      res.status(200).json(Object.assign({ username: login }, r));
      return;
    }

    res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    if (ERROS_VIEWER.includes(e.code)) {
      res.status(409).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[loja]', e);
    res.status(502).json({ error: 'Algo correu mal. Tenta outra vez daqui a pouco.' });
  }
};
