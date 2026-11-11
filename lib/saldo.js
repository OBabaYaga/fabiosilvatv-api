// ===================================================================
// Saldo da loja (igual ao ESTV)
// ===================================================================
//
// Cada viewer tem DUAS carteiras:
//
//   1. Pontos StreamElements — os pontos de ver a live. O site nunca os
//      gasta nem altera, só os lê.
//
//   2. Saldo da loja — é o que se gasta nos prémios. Ganha os mesmos
//      pontos de visualização, porque é calculado assim:
//
//         saldo = pontos StreamElements + ajuste
//
//      "ajuste" é a soma de tudo o que aconteceu na loja (−preço em cada
//      compra, +preço se um pedido for recusado, ou ajustes manuais do
//      streamer). Guardado no Redis em fstv:saldo:ajuste.
// ===================================================================

const { kv, P, toInt } = require('./store');
const { getLoyaltyInfo, getLoyaltyPoints } = require('./streamelements');

const AJUSTE_KEY = P + 'saldo:ajuste';

async function getAjuste(login) {
  return toInt(await kv.hget(AJUSTE_KEY, login));
}

async function getEstado(login) {
  const [info, ajuste] = await Promise.all([getLoyaltyInfo(login), getAjuste(login)]);
  return {
    username: login,
    pontos: info.points,
    rank: info.rank,
    saldo: Math.max(0, info.points + ajuste),
  };
}

// Soma (ou subtrai) ao saldo. Com minimoZero, se o saldo ficasse
// negativo desfaz e devolve null. O HINCRBY é atómico, por isso dois
// pedidos ao mesmo tempo (dois cliques, telemóvel + PC) nunca gastam o
// mesmo saldo duas vezes.
async function alterarSaldo(login, delta, { minimoZero = false } = {}) {
  const pontos = await getLoyaltyPoints(login);
  const novoAjuste = toInt(await kv.hincrby(AJUSTE_KEY, login, delta));
  const saldo = pontos + novoAjuste;
  if (minimoZero && saldo < 0) {
    await kv.hincrby(AJUSTE_KEY, login, -delta);
    return null;
  }
  return { pontos, saldo: Math.max(0, saldo) };
}

module.exports = { getEstado, alterarSaldo };
