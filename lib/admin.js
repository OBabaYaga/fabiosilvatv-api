// ===================================================================
// Autenticação — valida o token Twitch que o site envia:
//   requireUser(req)  -> qualquer conta Twitch válida (para comprar)
//   requireAdmin(req) -> só quem estiver em ADMIN_LOGINS (por omissão
//                        "fabiosilva_tv") — gerir prémios e pedidos
// ===================================================================

const { validateTwitchToken } = require('./twitch');

function getAdminLogins() {
  return (process.env.ADMIN_LOGINS || 'fabiosilva_tv')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

/**
 * @returns {Promise<{ login: string, userId: string } | null>}
 */
async function requireUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  return validateTwitchToken(token);
}

/**
 * Igual a requireUser, mas devolve null também se o login validado não
 * estiver na lista ADMIN_LOGINS.
 * @returns {Promise<{ login: string, userId: string } | null>}
 */
async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!user) return null;
  const admins = getAdminLogins();
  if (!admins.includes(user.login)) return null;
  return user;
}

module.exports = { requireUser, requireAdmin, getAdminLogins };
