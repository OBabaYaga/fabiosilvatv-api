// ===================================================================
// Loja — prémios, stock e pedidos
// ===================================================================
//
// Chaves no Redis:
//   fstv:produtos               HASH  id -> JSON do prémio
//   fstv:stock                  HASH  id -> unidades disponíveis (atómico)
//   fstv:pedidos                HASH  id -> JSON do pedido
//   fstv:pedidos:todos          ZSET  ids por data
//   fstv:pedidos:de:<login>     ZSET  ids dos pedidos dessa pessoa
//   fstv:limite:<id>:<login>:<AAAA-MM>  compras desse prémio no mês
//
// Uma compra:
//   1. tira 1 ao stock (se ficar < 0, desfaz → "esgotado");
//   2. conta para o limite mensal por pessoa (se passar, desfaz);
//   3. tira o preço ao saldo (se não chegar, desfaz tudo);
//   4. cria o pedido "pendente", que o streamer vê no painel.
// Recusar um pedido devolve o saldo, o stock e o limite.
// ===================================================================

const crypto = require('crypto');
const { kv, P, parse, toInt } = require('./store');
const { alterarSaldo } = require('./saldo');

const PRODUTOS_KEY = P + 'produtos';
const STOCK_KEY = P + 'stock';
const PEDIDOS_KEY = P + 'pedidos';
const PEDIDOS_TODOS = P + 'pedidos:todos';
const pedidosDe = (login) => `${P}pedidos:de:${login}`;

const CASINOS = ['SafeCasino', 'CaptainsBet', '22bit', 'Betlabel', 'Royal XO', 'Coldbet', 'Outro'];

const CAMPOS_DEPOSITO = [
  { id: 'casino', label: 'Casino', tipo: 'casino' },
  { id: 'conta', label: 'ID ou utilizador da tua conta no casino', tipo: 'texto' },
];
const CAMPOS_AMAZON = [{ id: 'email', label: 'Email para onde enviamos o voucher', tipo: 'email' }];

// Prémios iniciais. Começam SEM stock (ninguém consegue comprar) e com
// preços provisórios — o streamer define tudo no painel da loja.
const PRODUTOS_INICIAIS = [
  { id: 'deposito-10', imagem: 'assets/loja/deposito-10.jpg', nome: 'Depósito 10 €', descricao: 'Fazemos um depósito de 10 € na tua conta de casino.', icone: 'fa-coins', preco: 10000, campos: CAMPOS_DEPOSITO },
  { id: 'deposito-20', imagem: 'assets/loja/deposito-20.jpg', nome: 'Depósito 20 €', descricao: 'Fazemos um depósito de 20 € na tua conta de casino.', icone: 'fa-coins', preco: 20000, campos: CAMPOS_DEPOSITO },
  { id: 'deposito-50', imagem: 'assets/loja/deposito-50.jpg', nome: 'Depósito 50 €', descricao: 'Fazemos um depósito de 50 € na tua conta de casino.', icone: 'fa-sack-dollar', preco: 50000, campos: CAMPOS_DEPOSITO },
  { id: 'amazon-25', imagem: 'assets/loja/amazon-25.jpg', nome: 'Voucher Amazon 25 €', descricao: 'Cartão-presente Amazon de 25 €, enviado por email.', icone: 'fa-gift', preco: 25000, campos: CAMPOS_AMAZON },
  { id: 'amazon-50', imagem: 'assets/loja/amazon-50.jpg', nome: 'Voucher Amazon 50 €', descricao: 'Cartão-presente Amazon de 50 €, enviado por email.', icone: 'fa-gift', preco: 50000, campos: CAMPOS_AMAZON },
];

function erro(msg, code) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

function mesAtual() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit' }).format(new Date());
}

function limiteKey(produtoId, login) {
  return `${P}limite:${produtoId}:${login}:${mesAtual()}`;
}

// ---------------------------------------------------------------
// Prémios
// ---------------------------------------------------------------
async function garantirIniciais() {
  const existe = await kv.exists(PRODUTOS_KEY);
  if (existe) return;
  const trinco = await kv.set(P + 'produtos:iniciados', '1', { nx: true });
  if (!trinco) return;
  const dados = {};
  PRODUTOS_INICIAIS.forEach((p, i) => {
    dados[p.id] = JSON.stringify(Object.assign({ ativo: true, ordem: i, limitePorMes: 0 }, p));
  });
  await kv.hset(PRODUTOS_KEY, dados);
}

async function listarProdutos({ incluirInativos = false } = {}) {
  await garantirIniciais();
  const raw = (await kv.hgetall(PRODUTOS_KEY)) || {};
  const stock = (await kv.hgetall(STOCK_KEY)) || {};
  return Object.values(raw)
    .map(parse)
    .filter((p) => p && (incluirInativos || p.ativo))
    .map((p) => Object.assign({}, p, { stock: Math.max(0, toInt(stock[p.id])) }))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

async function getProduto(id) {
  return parse(await kv.hget(PRODUTOS_KEY, id));
}

function limparTexto(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

// Imagem do prémio: um ficheiro do site (ex: assets/loja/x.jpg) ou um
// endereço https. Qualquer outra coisa é ignorada.
function imagemValida(v) {
  const s = limparTexto(v, 300);
  if (/^assets\/[a-z0-9/_.-]+\.(jpe?g|png|webp|gif|svg)$/i.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  return '';
}

// Cria ou edita um prémio (só streamer). "stock" é o valor absoluto.
async function guardarProduto(dados) {
  await garantirIniciais();
  const id =
    limparTexto(dados.id, 40)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || 'premio-' + crypto.randomBytes(3).toString('hex');
  const atual = (await getProduto(id)) || { id, campos: [], ordem: Date.now() };
  const nome = limparTexto(dados.nome != null ? dados.nome : atual.nome, 80);
  if (!nome) throw erro('O prémio precisa de um nome.', 'INVALIDO');
  const preco = Math.round(Number(dados.preco != null ? dados.preco : atual.preco));
  if (!Number.isFinite(preco) || preco < 1 || preco > 100000000) throw erro('Preço inválido.', 'INVALIDO');

  const novo = Object.assign({}, atual, {
    id,
    nome,
    descricao: limparTexto(dados.descricao != null ? dados.descricao : atual.descricao, 300),
    icone: /^fa-[a-z0-9-]+$/.test(dados.icone || '') ? dados.icone : atual.icone || 'fa-gift',
    imagem: dados.imagem != null ? imagemValida(dados.imagem) : atual.imagem || '',
    preco,
    ativo: dados.ativo != null ? !!dados.ativo : atual.ativo !== false,
    limitePorMes: Math.max(0, Math.min(1000, toInt(dados.limitePorMes != null ? dados.limitePorMes : atual.limitePorMes))),
  });
  if (Array.isArray(dados.campos)) {
    novo.campos = dados.campos.slice(0, 5).map((c, i) => ({
      id: limparTexto(c.id, 20).replace(/[^a-z0-9]/gi, '') || 'campo' + i,
      label: limparTexto(c.label, 100) || 'Informação',
      tipo: ['texto', 'email', 'casino'].includes(c.tipo) ? c.tipo : 'texto',
    }));
  }
  await kv.hset(PRODUTOS_KEY, { [id]: JSON.stringify(novo) });
  if (dados.stock != null) {
    await kv.hset(STOCK_KEY, { [id]: Math.max(0, Math.min(100000, toInt(dados.stock))) });
  }
  return novo;
}

async function apagarProduto(id) {
  await kv.hdel(PRODUTOS_KEY, id);
  await kv.hdel(STOCK_KEY, id);
}

// ---------------------------------------------------------------
// Compras
// ---------------------------------------------------------------
function validarDados(produto, dados) {
  const out = {};
  for (const c of produto.campos || []) {
    const v = limparTexto(dados && dados[c.id], 200);
    if (!v) throw erro(`Preenche: ${c.label}.`, 'INVALIDO');
    if (c.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw erro('Email inválido.', 'INVALIDO');
    if (c.tipo === 'casino' && !CASINOS.includes(v)) throw erro('Escolhe o casino da lista.', 'INVALIDO');
    out[c.id] = v;
  }
  return out;
}

async function comprar(login, produtoId, dados) {
  const produto = await getProduto(produtoId);
  if (!produto || produto.ativo === false) throw erro('Este prémio já não existe.', 'INVALIDO');
  const info = validarDados(produto, dados);

  // 1. stock
  const restante = toInt(await kv.hincrby(STOCK_KEY, produtoId, -1));
  if (restante < 0) {
    await kv.hincrby(STOCK_KEY, produtoId, 1);
    throw erro('Esgotado — volta mais tarde.', 'ESGOTADO');
  }

  // 2. limite por pessoa por mês
  const lk = limiteKey(produtoId, login);
  let contouLimite = false;
  if (produto.limitePorMes > 0) {
    const n = toInt(await kv.incr(lk));
    contouLimite = true;
    if (n === 1) await kv.expire(lk, 40 * 24 * 3600);
    if (n > produto.limitePorMes) {
      await kv.decr(lk);
      await kv.hincrby(STOCK_KEY, produtoId, 1);
      throw erro(`Já atingiste o limite deste prémio este mês (${produto.limitePorMes}).`, 'LIMITE');
    }
  }

  // 3. saldo
  const gasto = await alterarSaldo(login, -produto.preco, { minimoZero: true });
  if (!gasto) {
    if (contouLimite) await kv.decr(lk);
    await kv.hincrby(STOCK_KEY, produtoId, 1);
    throw erro('Não tens saldo suficiente para este prémio.', 'SALDO');
  }

  // 4. pedido
  const agora = Date.now();
  const pedido = {
    id: agora.toString(36) + crypto.randomBytes(3).toString('hex'),
    login,
    produtoId,
    nome: produto.nome,
    preco: produto.preco,
    dados: info,
    campos: (produto.campos || []).map((c) => ({ id: c.id, label: c.label })),
    estado: 'pendente',
    mes: mesAtual(),
    limiteContado: contouLimite,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  await kv.hset(PEDIDOS_KEY, { [pedido.id]: JSON.stringify(pedido) });
  await kv.zadd(PEDIDOS_TODOS, { score: agora, member: pedido.id });
  await kv.zadd(pedidosDe(login), { score: agora, member: pedido.id });
  return { pedido, saldo: gasto.saldo, pontos: gasto.pontos };
}

async function lerPedidos(ids) {
  if (!ids.length) return [];
  const raw = await kv.hmget(PEDIDOS_KEY, ...ids);
  const lista = Array.isArray(raw) ? raw : ids.map((id) => raw && raw[id]);
  return lista.map(parse).filter(Boolean);
}

async function pedidosDoUtilizador(login) {
  const ids = (await kv.zrange(pedidosDe(login), 0, 49, { rev: true })) || [];
  return lerPedidos(ids.map(String));
}

async function todosPedidos() {
  const ids = (await kv.zrange(PEDIDOS_TODOS, 0, 299, { rev: true })) || [];
  return lerPedidos(ids.map(String));
}

// Streamer: marcar como entregue, ou recusar (devolve saldo/stock/limite).
async function atualizarPedido(id, estado, nota) {
  if (!['entregue', 'recusado'].includes(estado)) throw erro('Estado inválido.', 'INVALIDO');
  // Trinco para não devolver pontos duas vezes com dois cliques.
  const trinco = await kv.set(`${P}pedido:trinco:${id}`, '1', { nx: true, ex: 30 });
  if (!trinco) throw erro('Este pedido está a ser atualizado — tenta daqui a pouco.', 'OCUPADO');
  try {
    const pedido = parse(await kv.hget(PEDIDOS_KEY, id));
    if (!pedido) throw erro('Pedido não encontrado.', 'INVALIDO');
    if (pedido.estado !== 'pendente') throw erro('Este pedido já foi tratado.', 'INVALIDO');

    if (estado === 'recusado') {
      await alterarSaldo(pedido.login, pedido.preco);
      await kv.hincrby(STOCK_KEY, pedido.produtoId, 1);
      if (pedido.limiteContado) {
        await kv.decr(`${P}limite:${pedido.produtoId}:${pedido.login}:${pedido.mes}`);
      }
    }
    pedido.estado = estado;
    pedido.nota = limparTexto(nota, 300);
    pedido.atualizadoEm = Date.now();
    await kv.hset(PEDIDOS_KEY, { [id]: JSON.stringify(pedido) });
    return pedido;
  } finally {
    await kv.del(`${P}pedido:trinco:${id}`);
  }
}

module.exports = {
  CASINOS,
  listarProdutos,
  guardarProduto,
  apagarProduto,
  comprar,
  pedidosDoUtilizador,
  todosPedidos,
  atualizarPedido,
};
