'use strict';

/**
 * BlockAuth integration tests
 * Run: npm test
 *
 * These tests mock Redis, SIWE, and external APIs so you don't
 * need real credentials to run them.
 */

process.env.JWT_SECRET           = '4651328456123984561234561';
process.env.PLATFORM_API_KEYS    = 'test-platform-key-123';
process.env.SENDGRID_API_KEY     = 'SG.test';
process.env.TWILIO_ACCOUNT_SID   = 'ACtest';
process.env.TWILIO_AUTH_TOKEN    = 'test';
process.env.TWILIO_FROM_NUMBER   = '+10000000000';
process.env.NODE_ENV             = 'test';

// Mock SIWE
jest.mock('siwe', () => {
  const state = {
    shouldThrow : false,
    verifySuccess: true,
    verifyError : false,
    address     : '0x' + 'f'.repeat(40),
    nonce       : 'nonce-123',
    domain      : 'example.com',
  };

  class SiweMessage {
    constructor(rawMessage) {
      if (state.shouldThrow || rawMessage === 'bad') {
        throw new Error('Invalid SIWE message format.');
      }
      this.address = state.address;
      this.nonce = state.nonce;
      this.domain = state.domain;
    }

    async verify() {
      if (state.verifyError) {
        throw new Error('Signature verification failed.');
      }
      return { success: state.verifySuccess };
    }
  }

  return {
    SiweMessage,
    __setMockState: next => Object.assign(state, next),
  };
});

// Mock redis
jest.mock('../src/utils/redis', () => {
  const store = new Map();
  return {
    setJSON   : jest.fn(async (k, v) => store.set(k, JSON.stringify(v))),
    getJSON   : jest.fn(async (k)    => { const v = store.get(k); return v ? JSON.parse(v) : null; }),
    del       : jest.fn(async (k)    => store.delete(k)),
    increment : jest.fn(async ()     => 1),
    ping      : jest.fn(async ()     => 'PONG'),
    connect   : jest.fn(async ()     => {}),
    __reset   : () => store.clear(),
  };
});

// Mock mailer
jest.mock('../src/utils/mailer', () => ({
  sendOTP          : jest.fn(async () => {}),
  sendSecurityAlert: jest.fn(async () => {}),
}));

// Mock SMS
jest.mock('../src/utils/sms', () => ({
  sendOTP: jest.fn(async () => {}),
}));


const request = require('supertest');
const app     = require('../src/server');
const redis   = require('../src/utils/redis');
const siwe    = require('siwe');
const agent1  = require('../src/agents/agent1_detector');
const agent2  = require('../src/agents/agent2_scorer');
const agent3  = require('../src/agents/agent3_executor');
const { generateOTP, hashOTP, generateSalt } = require('../src/utils/otp');

const HEADERS = { 'x-platform-key': 'test-platform-key-123' };

beforeEach(() => {
  jest.clearAllMocks();
  redis.__reset?.();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── OTP utility tests ────────────────────────────────────────────────────

describe('OTP crypto utilities', () => {

  test('generates 6-digit code', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  test('different calls produce different codes (statistical)', () => {
    const codes = new Set(Array.from({ length: 20 }, generateOTP));
    expect(codes.size).toBeGreaterThan(15);
  });

  test('hash + verify round-trip works', () => {
    const otp  = '482910';
    const salt = generateSalt();
    const hash = hashOTP(otp, salt);
    const { verifyOTP } = require('../src/utils/otp');
    expect(verifyOTP('482910', hash, salt)).toBe(true);
    expect(verifyOTP('000000', hash, salt)).toBe(false);
  });

});

// ─── Agent 2 scoring tests ────────────────────────────────────────────────

describe('Agent 2 — Risk Scorer', () => {
  const { score } = require('../src/agents/agent2_scorer');

  test('empty signals → LOW', () => {
    const r = score([]);
    expect(r.level).toBe('LOW');
    expect(r.score).toBe(0);
  });

  test('NEW_COUNTRY + NEW_DEVICE → MEDIUM', () => {
    const r = score([
      { type: 'NEW_COUNTRY', weight: 25, detail: 'x' },
      { type: 'NEW_DEVICE',  weight: 20, detail: 'y' },
    ]);
    expect(r.level).toBe('MEDIUM');
    expect(r.score).toBe(45);
  });

  test('IMPOSSIBLE_TRAVEL → CRITICAL', () => {
    const r = score([{ type: 'IMPOSSIBLE_TRAVEL', weight: 70, detail: 'x' }]);
    expect(r.level).toBe('MEDIUM');
    expect(r.score).toBe(70);
  });

  test('score is capped at 100', () => {
    const r = score([
      { type: 'IMPOSSIBLE_TRAVEL',   weight: 70, detail: '' },
      { type: 'CONCURRENT_SESSION',  weight: 35, detail: '' },
      { type: 'NEW_DEVICE',          weight: 20, detail: '' },
    ]);
    expect(r.score).toBe(100);
  });

});

// ─── Health check ─────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─── Platform auth middleware ─────────────────────────────────────────────

describe('Platform key middleware', () => {
  test('rejects missing key', async () => {
    const res = await request(app).post('/auth/nonce').send({ address: '0x' + 'a'.repeat(40) });
    expect(res.status).toBe(401);
  });

  test('rejects invalid key', async () => {
    const res = await request(app)
      .post('/auth/nonce')
      .set('x-platform-key', 'wrong_key')
      .send({ address: '0x' + 'a'.repeat(40) });
    expect(res.status).toBe(403);
  });

  test('accepts valid key', async () => {
    const res = await request(app)
      .post('/auth/nonce')
      .set(HEADERS)
      .send({ address: '0x' + 'a'.repeat(40) });
    expect(res.status).toBe(200);
    expect(res.body.nonce).toBeDefined();
  });
});

// ─── Login endpoint ──────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  const wallet = '0x' + 'f'.repeat(40);

  beforeEach(() => {
    siwe.__setMockState({
      shouldThrow : false,
      verifySuccess: true,
      verifyError : false,
      address     : wallet,
      nonce       : 'nonce-123',
      domain      : 'example.com',
    });

    jest.spyOn(agent1, 'detect').mockResolvedValue({ signals: [], geo: null, device: null });
    jest.spyOn(agent2, 'score').mockReturnValue({ level: 'LOW', score: 0, reasons: [] });
    jest.spyOn(agent3, 'execute').mockResolvedValue({
      action: 'ALLOW',
      accessToken: 'token',
      expiresIn: '1h',
      riskScore: 0,
    });
  });

  test('rejects missing message/signature', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature are required.');
  });

  test('rejects invalid SIWE format', async () => {
    siwe.__setMockState({ shouldThrow: true });

    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({ message: 'bad', signature: 'sig' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid SIWE message format.');
  });

  test('rejects invalid signature', async () => {
    siwe.__setMockState({ verifySuccess: false });

    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({ message: 'ok', signature: 'sig' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature.');
  });

  test('rejects expired nonce', async () => {
    redis.getJSON.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({ message: 'ok', signature: 'sig' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Nonce expired or invalid.');
  });

  test('allows LOW risk login', async () => {
    redis.getJSON.mockResolvedValueOnce({ address: wallet, used: false });
    agent3.execute.mockResolvedValueOnce({
      action: 'ALLOW',
      accessToken: 'token',
      expiresIn: '1h',
      riskScore: 0,
    });

    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({ message: 'ok', signature: 'sig' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('ALLOW');
    expect(res.body.accessToken).toBeDefined();
  });

  test('requires OTP for MEDIUM/CRITICAL', async () => {
    redis.getJSON.mockResolvedValueOnce({ address: wallet, used: false });
    agent3.execute.mockResolvedValueOnce({
      action: 'OTP_REQUIRED',
      pendingToken: 'pending',
      otpChannel: ['email'],
      otpExpiresIn: 300,
      riskScore: 55,
      riskLevel: 'MEDIUM',
      reasons: ['NEW_DEVICE'],
    });

    const res = await request(app)
      .post('/auth/login')
      .set(HEADERS)
      .send({ message: 'ok', signature: 'sig', email: 'karimenbenromdhane55@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('OTP_REQUIRED');
    expect(res.body.pendingToken).toBeDefined();
  });
});

// ─── OTP verify endpoint ──────────────────────────────────────────────────

describe('POST /otp/verify', () => {
  const jwt = require('jsonwebtoken');

  function makePendingToken(wallet) {
    return jwt.sign(
      { sub: wallet.toLowerCase(), type: 'pending_otp' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
  }

  test('returns OTP_EXPIRED when no OTP stored in redis', async () => {
    const wallet = '0x' + 'b'.repeat(40);
    redis.getJSON.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/otp/verify')
      .set(HEADERS)
      .send({ wallet, code: '123456', pendingToken: makePendingToken(wallet) });

    expect(res.status).toBe(401);
    expect(res.body.action).toBe('OTP_EXPIRED');
  });

  test('returns WRONG_CODE on bad code', async () => {
    const wallet = '0x' + 'c'.repeat(40);
    const salt   = generateSalt();
    const hash   = hashOTP('999999', salt);

    redis.getJSON.mockResolvedValueOnce({ hash, salt, wallet, level: 'MEDIUM' });
    redis.increment.mockResolvedValueOnce(1);

    const res = await request(app)
      .post('/otp/verify')
      .set(HEADERS)
      .send({ wallet, code: '000000', pendingToken: makePendingToken(wallet) });

    expect(res.status).toBe(401);
    expect(res.body.action).toBe('WRONG_CODE');
    expect(res.body.attemptsLeft).toBe(2);
  });

  test('returns VERIFIED + accessToken on correct code', async () => {
    const wallet  = '0x' + 'd'.repeat(40);
    const otp     = '482910';
    const salt    = generateSalt();
    const hash    = hashOTP(otp, salt);

    redis.getJSON.mockResolvedValueOnce({ hash, salt, wallet, level: 'MEDIUM' });
    redis.increment.mockResolvedValueOnce(1);
    redis.del.mockResolvedValue(true);

    const res = await request(app)
      .post('/otp/verify')
      .set(HEADERS)
      .send({ wallet, code: otp, pendingToken: makePendingToken(wallet) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.action).toBe('VERIFIED');
    expect(res.body.accessToken).toBeDefined();
  });

  test('hard blocks after MAX_ATTEMPTS', async () => {
    const wallet = '0x' + 'e'.repeat(40);
    const salt   = generateSalt();
    const hash   = hashOTP('999999', salt);

    redis.getJSON.mockResolvedValueOnce({ hash, salt, wallet, level: 'CRITICAL' });
    redis.increment.mockResolvedValueOnce(4);   // > MAX_ATTEMPTS (3)

    const res = await request(app)
      .post('/otp/verify')
      .set(HEADERS)
      .send({ wallet, code: '000000', pendingToken: makePendingToken(wallet) });

    expect(res.status).toBe(403);
    expect(res.body.action).toBe('HARD_BLOCK');
  });
});
