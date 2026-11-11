// ===================================================================
// Ligação ao Redis (Upstash). Aceita as variáveis que o Vercel cria ao
// ligar uma base Upstash/KV ao projeto: KV_REST_API_URL + KV_REST_API_TOKEN
// ou UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
//
// Todas as chaves começam por "fstv:", por isso esta API pode partilhar
// a mesma base de dados Redis do ESTV sem se misturarem os dados.
// ===================================================================

const { Redis } = require('@upstash/redis');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.warn('[lib/store] Faltam as variáveis do Redis (KV_REST_API_URL/KV_REST_API_TOKEN). Ver README.');
}

const kv = new Redis({ url: REDIS_URL || 'http://redis-em-falta', token: REDIS_TOKEN || 'x' });

const P = 'fstv:';

// O Upstash converte sozinho JSON guardado em texto; isto aceita os dois.
function parse(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }
  return v;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { kv, P, parse, toInt };
