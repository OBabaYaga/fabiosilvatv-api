// Servidor local para testar a API sem o Vercel:
//   node -r ./test/fake-redis.js test/dev-server.js   (porta 4003)
const http = require('http');
const rotas = { '/api/loja': require('../api/loja.js'), '/api/saldo': require('../api/saldo.js'), '/api/health': require('../api/health.js'), '/api/jogos': require('../api/jogos.js') };
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const h = rotas[url.pathname];
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      req.query = Object.fromEntries(url.searchParams);
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      if (!h) return res.status(404).json({ error: 'not found' });
      await h(req, res);
    });
  })
  .listen(Number(process.env.PORT) || 4003, () => console.log('API local em http://localhost:' + (process.env.PORT || 4003)));
