const { validateInput } = require('./util');
function handleLogin(creds) {
  if (!validateInput(creds.user)) throw new Error('bad user');
  return { ok: true };
}
module.exports = { handleLogin };
