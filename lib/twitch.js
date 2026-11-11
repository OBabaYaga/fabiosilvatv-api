// ===================================================================
// Twitch — validação de tokens de utilizador
// ===================================================================
//
// O site (frontend) faz o login com a Twitch sozinho, diretamente do
// browser (Implicit Grant Flow — não precisa de Client Secret nem de
// servidor para isso). Antes de qualquer compra, este backend confirma
// junto da Twitch que o token apresentado é válido e de quem é — assim
// ninguém consegue gastar o saldo de outra pessoa.
//
// TWITCH_VALIDATE_URL só existe para nos permitir testar este código
// localmente contra um servidor Twitch "de mentira" — em produção nunca
// precisas de definir esta variável, o valor por omissão já é o certo.
// ===================================================================

const VALIDATE_URL = process.env.TWITCH_VALIDATE_URL || 'https://id.twitch.tv/oauth2/validate';

/**
 * Valida um token de acesso da Twitch (obtido pelo frontend via
 * Implicit Grant Flow) e devolve o login associado.
 * @param {string} token
 * @returns {Promise<{ login: string, userId: string } | null>}
 */
async function validateTwitchToken(token) {
  if (!token) return null;
  try {
    const res = await fetch(VALIDATE_URL, {
      headers: { Authorization: 'OAuth ' + token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.login) return null;
    return { login: String(data.login).toLowerCase(), userId: data.user_id || null };
  } catch (e) {
    return null;
  }
}

module.exports = { validateTwitchToken };
