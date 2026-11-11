// GET /api/health — confirma que a API está no ar e o que está configurado.
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    servico: 'fabiosilvatv-api',
    redis: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
    admins: (process.env.ADMIN_LOGINS || 'fabiosilva_tv').split(',').map((s) => s.trim()),
  });
};
