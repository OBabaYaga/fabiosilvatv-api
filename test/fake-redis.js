// Redis em memória, só para os testes locais (substitui @upstash/redis).
const Module = require('module');
const store = new Map();
class Redis {
  constructor() {}
  async get(k) { return store.has(k) ? store.get(k) : null; }
  async set(k, v, o) { if (o && o.nx && store.has(k)) return null; store.set(k, v); return 'OK'; }
  async exists(k) { const v = store.get(k); return v == null ? 0 : (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length ? 0 : 1); }
  async decr(k) { const n = (parseInt(store.get(k) || 0) - 1); store.set(k, String(n)); return n; }
  async hmget(k, ...fs) { const h = store.get(k) || {}; return fs.map(f => (f in h ? h[f] : null)); }
  async incr(k) { const n = (parseInt(store.get(k) || 0) + 1); store.set(k, String(n)); return n; }
  async del(...ks) { ks.forEach(k => store.delete(k)); return ks.length; }
  async scan(c, o) { const re = new RegExp('^' + o.match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return [0, [...store.keys()].filter(k => re.test(k))]; }
  h(k) { if (!store.has(k)) store.set(k, {}); return store.get(k); }
  async hget(k, f) { const h = store.get(k); return h && f in h ? h[f] : null; }
  async hdel(k, ...fs) { const h = store.get(k); if (h) fs.forEach(f => delete h[f]); return 1; }
  async hlen(k) { const h = store.get(k); return h ? Object.keys(h).length : 0; }
  async hgetall(k) { const h = store.get(k); return h && Object.keys(h).length ? { ...h } : null; }
  async hset(k, obj) { Object.assign(this.h(k), obj); return 1; }
  async hincrby(k, f, d) { const h = this.h(k); h[f] = (parseInt(h[f] || 0) + d); return h[f]; }
  z(k) { if (!store.has(k)) store.set(k, []); return store.get(k); }
  async zadd(k, { score, member }) { const z = this.z(k).filter(e => e.m !== member); z.push({ s: score, m: member }); store.set(k, z); return 1; }
  async zrange(k, a, b, o) { let z = [...this.z(k)].sort((x, y) => x.s - y.s); if (o && o.rev) z.reverse(); if (!(o && o.byScore)) z = z.slice(a, b < 0 ? undefined : b + 1); return o && o.withScores ? z.flatMap(e => [e.m, e.s]) : z.map(e => e.m); }
  async zrem(k, m) { store.set(k, this.z(k).filter(e => e.m !== m)); return 1; }
  async zremrangebyscore(k, a, b) { store.set(k, this.z(k).filter(e => !(e.s >= a && e.s <= b))); return 1; }
  async zcard(k) { return this.z(k).length; }
  async hsetnx(k, f, v) { const h = this.h(k); if (f in h) return 0; h[f] = v; return 1; }
  async zrevrank(k, m) { const z = [...this.z(k)].sort((x, y) => y.s - x.s); const i = z.findIndex(e => e.m === m); return i < 0 ? null : i; }
  async expire() { return 1; }
  async pfadd(k, ...ms) { if (!(store.get(k) instanceof Set)) store.set(k, new Set()); const st = store.get(k); const a = st.size; ms.forEach(m => st.add(m)); return st.size > a ? 1 : 0; }
  async pfcount(k) { const st = store.get(k); return st instanceof Set ? st.size : 0; }
}
const orig = Module._load;
Module._load = function (req, ...rest) { if (req === '@upstash/redis') return { Redis }; return orig.call(this, req, ...rest); };
module.exports = store;
