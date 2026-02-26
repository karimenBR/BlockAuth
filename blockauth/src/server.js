'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const logger     = require('./utils/logger');
const redis      = require('./utils/redis');
const authRoutes = require('./routes/auth');
const otpRoutes  = require('./routes/otp');
const { authenticatePlatform } = require('./middleware/platform');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: 'http://localhost:5173',
  allowedHeaders: [
    'Content-Type',
    'X-Platform-Key',
    'X-Test-Spoof-IP',      
    'X-Test-Signals',       
  ],
}));

// ─── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));

// ─── Global rate limiter ───────────────────────────────────────────────────
app.use(rateLimit({
  windowMs : 15 * 60 * 1000,   // 15 min
  max      : 100,
  message  : { error: 'Too many requests, slow down.' },
  standardHeaders: true,
  legacyHeaders  : false,
}));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Routes ────────────────────────────────────────────────────────────────
// All routes require a registered platform API key (X-Platform-Key header)
app.use('/auth', authenticatePlatform, authRoutes);
app.use('/otp',  authenticatePlatform, otpRoutes);

// ─── 404 / Error handlers ──────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  logger.error(err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Boot ──────────────────────────────────────────────────────────────────
async function start() {
  await redis.connect();
  await redis.ping();
  logger.info('✅ Redis connected');

  app.listen(PORT, () => {
    logger.info(`🚀 BlockAuth running on port ${PORT}`);
    logger.info(`   Mode: ${process.env.NODE_ENV}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  start().catch(err => {
    logger.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app; // for tests
