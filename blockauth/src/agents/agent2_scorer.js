'use strict';

/**
 * ══════════════════════════════════════════════════════════════
 *  AGENT 2 — RISK SCORER
 *
 *  Consumes the signal array from Agent 1 and produces:
 *    - A composite risk score (0–100)
 *    - A risk level: LOW | MEDIUM | CRITICAL
 *    - A human-readable reason list
 *
 *  Scoring is additive and capped at 100.
 *  Weights are defined per signal type below.
 * ══════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ── Thresholds (overrideable via env) ─────────────────────────
const LOW_MAX      = Number(process.env.RISK_LOW_MAX)    || 30;
const MEDIUM_MAX   = Number(process.env.RISK_MEDIUM_MAX) || 70;

// ── Signal weight table ───────────────────────────────────────
// If a signal type is not in this table it falls back to its
// own .weight property from Agent 1, then to 0.
const SIGNAL_WEIGHTS = {
  IMPOSSIBLE_TRAVEL  : 70,
  CONCURRENT_SESSION : 35,
  NEW_COUNTRY        : 25,
  NEW_DEVICE         : 20,
  ODD_HOURS          : 10,
  FIRST_LOGIN        : 0,
};

/**
 * Score a list of signals.
 *
 * @param {Array}  signals  - signal objects from Agent 1
 * @param {object} meta     - optional { wallet } for logging
 * @returns {object}        - { score, level, reasons }
 */
function score(signals, meta = {}) {
  let total   = 0;
  const reasons = [];

  for (const sig of signals) {
    const w = SIGNAL_WEIGHTS[sig.type] ?? sig.weight ?? 0;
    total += w;
    if (w > 0) {
      reasons.push({ signal: sig.type, weight: w, detail: sig.detail });
    }
  }

  // Cap at 100
  const finalScore = Math.min(total, 100);

  // Classify
  let level;
  if (finalScore <= LOW_MAX)    level = 'LOW';
  else if (finalScore <= MEDIUM_MAX) level = 'MEDIUM';
  else                           level = 'CRITICAL';

  logger.info(
    `[Agent2] wallet=${(meta.wallet || 'unknown').slice(0, 10)}… ` +
    `score=${finalScore}/100 level=${level}`
  );

  return { score: finalScore, level, reasons };
}

module.exports = { score };
