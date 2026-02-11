const logger = require('../logger');

/**
 * Return user-friendly error to client, log full details.
 * Pass through provider errors and known user messages; hide internal details.
 */
function apiError(res, error, fallbackMsg = 'Възникна грешка. Моля, опитайте отново.') {
  logger.error(error.message, error.stack);
  const msg = error.message;
  if (msg.startsWith('GoCardless:') || msg.startsWith('Enable Banking:') ||
      msg.startsWith('Provider ') || msg.includes('not found') ||
      msg.includes('задължителн') || msg.includes('не е намерен')) {
    return res.status(error.status || 500).json({ error: msg });
  }
  return res.status(500).json({ error: fallbackMsg });
}

module.exports = { apiError };
