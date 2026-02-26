'use strict';

const logger = require('../utils/logger');

// In production: load platform keys from your database.
// Here we read from env as a comma-separated list.
function getAllowedKeys() {
  const raw = process.env.PLATFORM_API_KEYS || '';
  return new Set(raw.split(',').map(k => k.trim()).filter(Boolean));
}

/**
 * Middleware — validates the X-Platform-Key header.
 * Attach platform identifier to req.platform for downstream use.
 */
function authenticatePlatform(req, res, next) {
  const key = req.headers['x-platform-key'];

  if (!key) {
    return res.status(401).json({
      error: 'Missing X-Platform-Key header.',
      hint : 'Register your platform at https://blockauth.io/register',
    });
  }

  const allowed = getAllowedKeys();

  if (!allowed.has(key)) {
    logger.warn(`Rejected unknown platform key: ${key.slice(0, 8)}...`);
    return res.status(403).json({ error: 'Invalid platform API key.' });
  }

  // Attach a platform ID (in production, this would come from DB lookup)
  req.platform = { key, id: `platform_${key.slice(0, 8)}` };
  next();
}

module.exports = { authenticatePlatform };
