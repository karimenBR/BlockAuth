'use strict';

const Redis  = require('ioredis');
const logger = require('./logger');

const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: false,
});

client.on('error',   err  => logger.error('Redis error:', err.message));
client.on('connect', ()   => logger.info('Redis connected'));

// ─── Thin wrappers ─────────────────────────────────────────────────────────

/**
 * Store a JSON value with optional TTL (seconds).
 */
async function setJSON(key, value, ttlSeconds = null) {
  const serialised = JSON.stringify(value);
  if (ttlSeconds) {
    await client.set(key, serialised, 'EX', ttlSeconds);
  } else {
    await client.set(key, serialised);
  }
}

/**
 * Retrieve and parse a JSON value. Returns null if missing.
 */
async function getJSON(key) {
  const raw = await client.get(key);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Atomically increment a counter. Returns new value.
 */
async function increment(key, ttlSeconds = null) {
  const val = await client.incr(key);
  if (ttlSeconds && val === 1) await client.expire(key, ttlSeconds);
  return val;
}

async function del(key) {
  return client.del(key);
}

async function ping() {
  return client.ping();
}

async function connect() {
  if (client.status === 'ready' || client.status === 'connecting') return;
  await client.connect();
}

module.exports = { client, setJSON, getJSON, increment, del, ping, connect };
