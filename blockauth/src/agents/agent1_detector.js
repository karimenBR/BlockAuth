'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  AGENT 1 — ANOMALY DETECTOR
 *
 *  Analyses a login event against the user's history and produces
 *  a structured list of anomaly signals. It does NOT score —
 *  that is Agent 2's job. It only detects and labels.
 * ══════════════════════════════════════════════════════════════
 */

const { lookupIP, isImpossibleTravel } = require('../utils/geo');
const redis  = require('../utils/redis');
const logger = require('../utils/logger');

const HISTORY_TTL = 30 * 24 * 60 * 60;   // keep 30 days of history per user
const HISTORY_KEY = (wallet) => `blockauth:history:${wallet.toLowerCase()}`;

/**
 * Run anomaly detection on a new login event.
 *
 * @param {object} event  - { wallet, ip, userAgent, timestamp }
 * @returns {object}      - { signals, geo, deviceHash, history }
 */
async function detect(event) {
  const { wallet, ip, userAgent, timestamp } = event;

  // ── 1. Geo-locate current IP ───────────────────────────────
  const geo = lookupIP(ip);

  // ── 2. Parse device info from User-Agent ──────────────────
  const device = parseDevice(userAgent);

  // ── 3. Load user's recent login history ───────────────────
  const historyKey = HISTORY_KEY(wallet);
  const history    = (await redis.getJSON(historyKey)) || [];

  // ── 4. Build device fingerprint ───────────────────────────
  const deviceHash = buildDeviceHash(device, ip);

  // ── 5. Run signal checks ───────────────────────────────────
  const signals = [];

  const lastEvent = history[0] || null;   // most recent previous login

  // Signal: impossible travel
  if (lastEvent && geo) {
    const prevEvent = { geo: lastEvent.geo, timestamp: lastEvent.timestamp };
    const currEvent = { geo, timestamp };
    if (isImpossibleTravel(prevEvent, currEvent)) {
      signals.push({
        type   : 'IMPOSSIBLE_TRAVEL',
        weight : 70,
        detail : `${lastEvent.geo?.city ?? '?'}, ${lastEvent.geo?.country ?? '?'} → ` +
                 `${geo.city}, ${geo.country} — ` +
                 `${msSince(lastEvent.timestamp, timestamp)} since last login`,
      });
    }
  }

  // Signal: new country
  if (lastEvent?.geo?.country && geo?.country &&
      lastEvent.geo.country !== geo.country) {
    signals.push({
      type   : 'NEW_COUNTRY',
      weight : 25,
      detail : `First login from ${geo.country} (usually ${lastEvent.geo.country})`,
    });
  }

  // Signal: new device
  const knownDevices = [...new Set(history.map(h => h.deviceHash).filter(Boolean))];
  if (knownDevices.length > 0 && !knownDevices.includes(deviceHash)) {
    signals.push({
      type   : 'NEW_DEVICE',
      weight : 20,
      detail : `Unrecognised device: ${device.browser} / ${device.os}`,
    });
  }

  // Signal: off-hours login (local time 01:00–05:00)
  if (geo?.timezone) {
    const hour = getLocalHour(timestamp, geo.timezone);
    if (hour >= 1 && hour < 5) {
      signals.push({
        type   : 'ODD_HOURS',
        weight : 10,
        detail : `Login at ${hour}:xx local time (${geo.timezone})`,
      });
    }
  }

  // Signal: concurrent session from different location
  const activeSessions = await getActiveSessions(wallet);
  if (activeSessions.some(s => s.ip !== ip)) {
    signals.push({
      type   : 'CONCURRENT_SESSION',
      weight : 35,
      detail : `Active session already exists from a different IP`,
    });
  }

  // Signal: first ever login (no history)
  if (history.length === 0) {
    signals.push({
      type  : 'FIRST_LOGIN',
      weight: 0,         // neutral — not risky on its own
      detail: 'First recorded login for this wallet',
    });
  }

  // ── 6. Save this event to history ─────────────────────────
  const newRecord = { ip, geo, deviceHash, device, timestamp, signals: signals.map(s => s.type) };
  history.unshift(newRecord);
  if (history.length > 50) history.splice(50);   // keep last 50 events
  await redis.setJSON(historyKey, history, HISTORY_TTL);

  logger.info(`[Agent1] wallet=${wallet.slice(0,10)}… signals=[${signals.map(s=>s.type).join(', ')||'none'}]`);

  return { signals, geo, device, deviceHash, history: history.slice(0, 5) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseDevice(ua) {
  try {
    const UAParser = require('ua-parser-js');
    const p = new UAParser(ua);
    return {
      browser: `${p.getBrowser().name || 'Unknown'} ${p.getBrowser().version || ''}`.trim(),
      os     : `${p.getOS().name || 'Unknown'} ${p.getOS().version || ''}`.trim(),
      device : p.getDevice().type || 'desktop',
    };
  } catch {
    return { browser: 'Unknown', os: 'Unknown', device: 'unknown' };
  }
}

function buildDeviceHash(device, ip) {
  const crypto = require('crypto');
  // Hash browser+OS (not IP — IPs change on mobile). Good enough for fingerprinting.
  return crypto
    .createHash('sha256')
    .update(`${device.browser}::${device.os}`)
    .digest('hex')
    .slice(0, 16);
}

function getLocalHour(timestamp, timezone) {
  try {
    const d = new Date(timestamp);
    return parseInt(d.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }), 10);
  } catch {
    return new Date(timestamp).getUTCHours();
  }
}

function msSince(tsA, tsB) {
  const mins = Math.round(Math.abs(tsB - tsA) / 60_000);
  return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
}

async function getActiveSessions(wallet) {
  const key = `blockauth:sessions:${wallet.toLowerCase()}`;
  return (await redis.getJSON(key)) || [];
}

module.exports = { detect };
