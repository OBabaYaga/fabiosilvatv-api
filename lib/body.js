// Lê o corpo JSON do pedido, venha ele já convertido (Vercel) ou como
// texto — devolve sempre um objeto.
function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

module.exports = { readBody };
