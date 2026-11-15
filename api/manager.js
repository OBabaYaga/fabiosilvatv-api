// ===================================================================
// /api/manager — FS Manager (jogo de manager de futebol do site)
// Toda a lógica está em lib/manager/api.js (ver as ações lá).
// ===================================================================
const { handlePreflight, applyCors } = require('../lib/cors');
const manager = require('../lib/manager/api');

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  return manager(req, res);
};
