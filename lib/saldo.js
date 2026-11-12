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
//         saldo = pontos StreamElements − base + ajuste
//
//      "ajuste" é a soma de tudo o que aconteceu na loja (−preço em cada
//      compra, +preço se um pedido for recusado, ou ajustes manuais do
//      streamer). Guardado no Redis em fstv:saldo:ajuste.
//
//      "base" só existe depois de um RESET (botão na Gestão da loja):
//      são os pontos StreamElements que cada um tinha nesse momento, para
//      o saldo começar do zero sem mexer nos pontos da StreamElements.
//      Guardado em fstv:saldo:base (quem não está lá tinha 0).
// ===================================================================

const { kv, P, toInt } = require('./store');
const { getLoyaltyInfo, getLoyaltyPoints, getTodosPontos } = require('./streamelements');

const AJUSTE_KEY = P + 'saldo:ajuste';
const BASE_KEY = P + 'saldo:base';
const RESET_KEY = P + 'saldo:reset';

// ajuste − base (o que se soma aos pontos StreamElements)
async function getAjuste(login) {
  const [ajuste, base] = await Promise.all([kv.hget(AJUSTE_KEY, login), kv.hget(BASE_KEY, login)]);
  return toInt(ajuste) - toInt(base);
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
  const [pontos, base] = await Promise.all([getLoyaltyPoints(login), kv.hget(BASE_KEY, login)]);
  const novoAjuste = toInt(await kv.hincrby(AJUSTE_KEY, login, delta));
  const saldo = pontos - toInt(base) + novoAjuste;
  if (minimoZero && saldo < 0) {
    await kv.hincrby(AJUSTE_KEY, login, -delta);
    return null;
  }
  return { pontos, saldo: Math.max(0, saldo) };
}

// Põe o saldo da loja de TODA a gente a zero. Não mexe nos pontos da
// StreamElements nem nos pedidos já feitos: guarda os pontos atuais de
// cada um como "base" e apaga os ajustes. Daqui para a frente o saldo é
// só o que cada um ganhar a ver a live.
async function resetSaldos() {
  const todos = await getTodosPontos(); // se falhar, não muda nada
  await kv.del(BASE_KEY);
  await kv.del(AJUSTE_KEY);
  const logins = Object.keys(todos).filter((l) => todos[l] > 0);
  for (let i = 0; i < logins.length; i += 500) {
    const parte = {};
    logins.slice(i, i + 500).forEach((l) => (parte[l] = todos[l]));
    await kv.hset(BASE_KEY, parte);
  }
  const quando = Date.now();
  await kv.set(RESET_KEY, String(quando));
  return { pessoas: logins.length, quando };
}

module.exports = { getEstado, alterarSaldo, resetSaldos };
