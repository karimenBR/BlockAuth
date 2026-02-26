/**
 * BlockAuth — Agent Test Panel
 * Drop this file into your React project and navigate to it.
 * It lets you simulate every risk scenario without touching agent code.
 *
 * Usage:
 *   import BlockAuthTestPanel from './BlockAuthTestPanel'
 *   // Add a route or temporarily replace App.jsx content with <BlockAuthTestPanel />
 */

import { useState } from 'react'
import { BrowserProvider, getAddress } from 'ethers'
import { SiweMessage } from 'siwe'
import axios from 'axios'

const API_URL      = import.meta.env.VITE_API_URL      || 'http://localhost:3000'
const PLATFORM_KEY = import.meta.env.VITE_PLATFORM_KEY || 'test-platform-key-123'

// ── Test scenario definitions ──────────────────────────────────────────────
const SCENARIOS = [
  {
    id      : 'low',
    label   : '🟢 LOW Risk',
    sublabel: 'Score 0 — First login / clean slate',
    color   : '#00ff9d',
    bg      : 'rgba(0,255,157,0.08)',
    border  : 'rgba(0,255,157,0.3)',
    description: 'Flushes Redis history then logs in. Expect score=0, action=ALLOW, no OTP.',
    steps   : ['Flush wallet history via /test/flush', 'Login normally'],
    spoofIP : null,
    extraSignals: [],
  },
  {
    id      : 'medium',
    label   : '🟡 MEDIUM Risk',
    sublabel: 'Score ~45 — New country + new device',
    color   : '#ffd166',
    bg      : 'rgba(255,209,102,0.08)',
    border  : 'rgba(255,209,102,0.3)',
    description: 'Injects NEW_COUNTRY (25) + NEW_DEVICE (20) = 45. Expect OTP_REQUIRED.',
    steps   : ['Login with injected signals', 'Enter OTP from email/SMS'],
    spoofIP : '85.214.0.1',   // Germany
    extraSignals: [
      { type: 'NEW_COUNTRY', weight: 25, detail: 'Test: login from DE (usually TN)' },
      { type: 'NEW_DEVICE',  weight: 20, detail: 'Test: unrecognised browser/OS'    },
    ],
  },
  {
    id      : 'critical',
    label   : '🔴 CRITICAL Risk',
    sublabel: 'Score 90 — Impossible travel + new device',
    color   : '#ff4d6d',
    bg      : 'rgba(255,77,109,0.08)',
    border  : 'rgba(255,77,109,0.3)',
    description: 'Injects IMPOSSIBLE_TRAVEL (70) + NEW_DEVICE (20) = 90. Expect OTP_REQUIRED + alert email.',
    steps   : ['Login with injected signals', 'Check alert email', 'Enter OTP'],
    spoofIP : '8.8.8.8',      // USA
    extraSignals: [
      { type: 'IMPOSSIBLE_TRAVEL', weight: 70, detail: 'Test: TN → US in 3 minutes'  },
      { type: 'NEW_DEVICE',        weight: 20, detail: 'Test: unrecognised browser/OS' },
    ],
  },
  {
    id      : 'concurrent',
    label   : '🟠 Concurrent Session',
    sublabel: 'Score 35 — Active session from different IP',
    color   : '#ff9a3c',
    bg      : 'rgba(255,154,60,0.08)',
    border  : 'rgba(255,154,60,0.3)',
    description: 'Injects CONCURRENT_SESSION (35). Expect OTP_REQUIRED.',
    steps   : ['Login with injected concurrent signal', 'Enter OTP'],
    spoofIP : '41.226.11.1',
    extraSignals: [
      { type: 'CONCURRENT_SESSION', weight: 35, detail: 'Test: active session from 41.226.x.x' },
    ],
  },
  {
    id      : 'oddHours',
    label   : '🌙 Odd Hours Only',
    sublabel: 'Score 10 — Login at 2am local time',
    color   : '#a78bfa',
    bg      : 'rgba(167,139,250,0.08)',
    border  : 'rgba(167,139,250,0.3)',
    description: 'Injects ODD_HOURS (10) only. Score=10 → LOW, action=ALLOW.',
    steps   : ['Login with odd-hours signal injected', 'Expect ALLOW'],
    spoofIP : null,
    extraSignals: [
      { type: 'ODD_HOURS', weight: 10, detail: 'Test: login at 02:00 local time' },
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: API_URL,
  headers: { 'X-Platform-Key': PLATFORM_KEY },
})

function Log({ entries }) {
  return (
    <div style={styles.logBox}>
      {entries.length === 0
        ? <span style={{ color: '#555' }}>Waiting for activity…</span>
        : entries.map((e, i) => (
            <div key={i} style={{ ...styles.logLine, color: e.color || '#ccc' }}>
              <span style={styles.logTime}>{e.time}</span>
              <span>{e.msg}</span>
            </div>
          ))
      }
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function BlockAuthTestPanel() {
  const [wallet,       setWallet]       = useState(null)
  const [activeScene,  setActiveScene]  = useState(null)
  const [log,          setLog]          = useState([])
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState(null)
  const [otpState,     setOtpState]     = useState(null)   // { pendingToken, wallet }
  const [otpCode,      setOtpCode]      = useState('')
  const [email,        setEmail]        = useState('karimenbenromdhane55@gmail.com')
  const [phone,        setPhone]        = useState('+21693779503')

  
  const addLog = (msg, color = '#ccc') => {
    const time = new Date().toLocaleTimeString()
    setLog(prev => [{ msg, color, time }, ...prev])
  }

  // ── Connect Wallet ───────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) { addLog('❌ MetaMask not found', '#ff4d6d'); return }
    try {
      const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const checksummed = getAddress(addr)
      setWallet(checksummed)
      addLog(`✅ Wallet connected: ${checksummed.slice(0,8)}…${checksummed.slice(-6)}`, '#00ff9d')
    } catch (err) {
      addLog(`❌ ${err.message}`, '#ff4d6d')
    }
  }

  // ── Flush history (for LOW scenario) ────────────────────────────────────
  const flushHistory = async () => {
    if (!wallet) { addLog('❌ Connect wallet first', '#ff4d6d'); return }
    try {
      // Calls a test-only endpoint — add this to your backend (see instructions below)
      await api.post('/test/flush', { wallet })
      addLog('🗑️  Redis history flushed — wallet is now a fresh user', '#ffd166')
    } catch {
      addLog('⚠️  /test/flush not found — manually run: redis-cli DEL blockauth:history:<wallet_lowercase>', '#ffd166')
    }
  }

  // ── Run Scenario ─────────────────────────────────────────────────────────
  const runScenario = async (scene) => {
    if (!wallet) { addLog('❌ Connect wallet first', '#ff4d6d'); return }
    setActiveScene(scene.id)
    setResult(null)
    setOtpState(null)
    setOtpCode('')
    setLoading(true)

    addLog(`▶  Running scenario: ${scene.label}`, scene.color)

    try {
      // Step 1: Get nonce
      addLog('→ Fetching nonce…')
      const { data: nonceData } = await api.post('/auth/nonce', { address: wallet })
      addLog(`   Nonce: ${nonceData.nonce}`, '#888')

      // Step 2: Build SIWE message
      const siweMessage = new SiweMessage({
        domain   : window.location.host,
        address  : wallet,
        statement: 'Sign in to BlockAuth',
        uri      : window.location.origin,
        version  : '1',
        chainId  : 1,
        nonce    : nonceData.nonce,
        issuedAt : new Date().toISOString(),
      })
      const messageStr = siweMessage.prepareMessage()
      addLog('→ SIWE message built ✓')

      // Step 3: Sign
      addLog('→ Requesting MetaMask signature…', '#ffd166')
      const provider  = new BrowserProvider(window.ethereum)
      const signer    = await provider.getSigner()
      const signature = await signer.signMessage(messageStr)
      addLog('   Signature obtained ✓', '#888')

      // Step 4: Submit with injected test signals header
      addLog(`→ Submitting to /auth/login with signals: [${scene.extraSignals.map(s=>s.type).join(', ')||'none'}]`)

      const headers = {
        'X-Platform-Key'    : PLATFORM_KEY,
        'X-Test-Spoof-IP'   : scene.spoofIP   || '',
        'X-Test-Signals': scene.extraSignals.length
        ? btoa(unescape(encodeURIComponent(JSON.stringify(scene.extraSignals))))
        : '',
      }

      const { data: loginData } = await axios.post(
        `${API_URL}/auth/login`,
        { message: messageStr, signature, email, phone },
        { headers }
      )

      addLog(`← action=${loginData.action}  score=${loginData.riskScore}`, scene.color)

      if (loginData.action === 'ALLOW') {
        addLog('✅ Access granted — no OTP needed', '#00ff9d')
        setResult({ type: 'allow', data: loginData })
      } else if (loginData.action === 'OTP_REQUIRED') {
        addLog(`⚠️  OTP required — level=${loginData.riskLevel}  channels=${loginData.otpChannel?.join(', ')}`, '#ffd166')
        setOtpState({ pendingToken: loginData.pendingToken, wallet })
        setResult({ type: 'otp', data: loginData })
      }

    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Unknown error'
      addLog(`❌ Error: ${msg}`, '#ff4d6d')
      setResult({ type: 'error', msg })
    } finally {
      setLoading(false)
    }
  }

  // ── Verify OTP ───────────────────────────────────────────────────────────
  const verifyOtp = async () => {
  if (!otpState || !otpCode) return
  setLoading(true)
  addLog(`→ Verifying OTP: ${otpCode}`)
  try {
    const { data } = await api.post('/otp/verify', {
      wallet      : otpState.wallet,
      code        : otpCode,
      pendingToken: otpState.pendingToken,
    })
    if (data.success) {
      addLog('✅ OTP verified! Access token issued.', '#00ff9d')
      setResult({ type: 'allow', data })
      setOtpState(null)
    } else {
      addLog(`❌ ${data.message}  (${data.attemptsLeft} left)`, '#ff4d6d')
    }
  } catch (err) {
    // ← Handle 401/403 responses properly
    const data = err.response?.data
    if (data) {
      if (data.action === 'WRONG_CODE') {
        addLog(`❌ Wrong code — ${data.attemptsLeft} attempt(s) remaining`, '#ff4d6d')
        setResult({ type: 'otp', data: otpState })
      } else if (data.action === 'HARD_BLOCK') {
        addLog('🚫 Too many attempts — session blocked!', '#ff4d6d')
        setResult({ type: 'error', msg: data.message })
        setOtpState(null)
      } else if (data.action === 'INVALID_TOKEN') {
        addLog('⏰ Session expired — please login again', '#ff4d6d')
        setOtpState(null)
      } else {
        addLog(`❌ ${data.message || data.error}`, '#ff4d6d')
      }
    } else {
      addLog(`❌ ${err.message}`, '#ff4d6d')
    }
  } finally {
    setLoading(false)
  }
}

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>⬡</span>
          <div>
            <div style={styles.title}>BlockAuth</div>
            <div style={styles.subtitle}>Agent Test Panel</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          {wallet
            ? <div style={styles.walletBadge}>
                <span style={styles.dot} />
                {wallet.slice(0,6)}…{wallet.slice(-4)}
              </div>
            : <button style={styles.connectBtn} onClick={connectWallet}>
                Connect Wallet
              </button>
          }
        </div>
      </div>

      <div style={styles.body}>
        {/* Left — Scenarios */}
        <div style={styles.left}>
          <div style={styles.sectionLabel}>TEST SCENARIOS</div>

          {/* Email / Phone inputs */}
          <div style={styles.inputGroup}>
            <label style={styles.inputLabel}>Email</label>
            <input
              style={styles.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
            <label style={styles.inputLabel}>Phone</label>
            <input
              style={styles.input}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+21612345678"
            />
          </div>

          {/* Flush button */}
          <button style={styles.flushBtn} onClick={flushHistory} disabled={!wallet}>
            🗑 Flush Redis History (for LOW test)
          </button>

          {/* Scenario cards */}
          {SCENARIOS.map(scene => (
            <div
              key={scene.id}
              style={{
                ...styles.sceneCard,
                background: activeScene === scene.id ? scene.bg : 'rgba(255,255,255,0.02)',
                borderColor: activeScene === scene.id ? scene.border : 'rgba(255,255,255,0.06)',
              }}
            >
              <div style={styles.sceneTop}>
                <div>
                  <div style={{ ...styles.sceneLabel, color: scene.color }}>{scene.label}</div>
                  <div style={styles.sceneSub}>{scene.sublabel}</div>
                </div>
                <button
                  style={{ ...styles.runBtn, borderColor: scene.color, color: scene.color }}
                  onClick={() => runScenario(scene)}
                  disabled={loading || !wallet}
                >
                  {loading && activeScene === scene.id ? '…' : 'RUN'}
                </button>
              </div>
              <div style={styles.sceneDesc}>{scene.description}</div>
              {scene.spoofIP && (
                <div style={styles.spoofBadge}>Spoof IP: {scene.spoofIP}</div>
              )}
            </div>
          ))}
        </div>

        {/* Right — Output */}
        <div style={styles.right}>
          <div style={styles.sectionLabel}>LIVE LOG</div>
          <Log entries={log} />

          {/* OTP input */}
          {otpState && (
            <div style={styles.otpBox}>
              <div style={styles.otpTitle}>⚠️ OTP Required</div>
              <div style={styles.otpHint}>Check your email / SMS for the 6-digit code</div>
              <div style={styles.otpRow}>
                <input
                  style={styles.otpInput}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder="000000"
                  maxLength={6}
                />
                <button
                  style={styles.otpBtn}
                  onClick={verifyOtp}
                  disabled={otpCode.length !== 6 || loading}
                >
                  Verify
                </button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              ...styles.resultBox,
              borderColor: result.type === 'allow' ? '#00ff9d' : result.type === 'error' ? '#ff4d6d' : '#ffd166',
            }}>
              <div style={styles.resultLabel}>
                {result.type === 'allow' ? '✅ RESULT' : result.type === 'error' ? '❌ ERROR' : '⚠️ OTP PENDING'}
              </div>
              <pre style={styles.resultPre}>
                {result.type === 'error'
                  ? result.msg
                  : JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}

          {/* Backend setup note */}
          <div style={styles.noteBox}>
            <div style={styles.noteTitle}>⚙️ Backend Setup Required</div>
            <div style={styles.noteText}>
              The test panel sends <code>X-Test-Signals</code> and <code>X-Test-Spoof-IP</code> headers.
              Add this middleware to your Express app <strong>in development only</strong>:
            </div>
            <pre style={styles.notePre}>{BACKEND_SNIPPET}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Backend snippet shown in the UI ───────────────────────────────────────
const BACKEND_SNIPPET = `// In auth.js — add BEFORE agent1.detect() call (dev only!)
if (process.env.NODE_ENV !== 'production') {
  const spoofIP = req.headers['x-test-spoof-ip'];
  if (spoofIP) loginEvent.ip = spoofIP;

  const rawSignals = req.headers['x-test-signals'];
  if (rawSignals) {
    try {
      const injected = JSON.parse(rawSignals);
      const { signals, geo, device } = await agent1.detect(loginEvent);
      const allSignals = [...injected, ...signals];
      const riskResult = agent2.score(allSignals, { wallet });
      const actionResult = await agent3.execute(riskResult, {
        wallet, email, phone,
        ip: loginEvent.ip, geo, device, timestamp,
      });
      return res.json(actionResult);
    } catch {}
  }
}
// Normal flow continues below...`

// ── Styles ────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight  : '100vh',
    background : '#f8fafc',
    color      : '#1e293b',
    fontFamily : "'JetBrains Mono', 'Fira Code', monospace",
    fontSize   : '13px',
  },

  header: {
    display        : 'flex',
    alignItems     : 'center',
    justifyContent : 'space-between',
    padding        : '18px 32px',
    borderBottom   : '1px solid #e2e8f0',
    background     : '#ffffff',
  },

  headerLeft : { display: 'flex', alignItems: 'center', gap: 14 },
  headerRight: {},
  logo       : { fontSize: 28, color: '#10b981' },

  title    : { fontSize: 18, fontWeight: 700, letterSpacing: 2, color: '#0f172a' },
  subtitle : { fontSize: 11, color: '#94a3b8', letterSpacing: 3, textTransform: 'uppercase' },

  walletBadge: {
    display     : 'flex',
    alignItems  : 'center',
    gap         : 8,
    background  : '#ecfdf5',
    border      : '1px solid #a7f3d0',
    borderRadius: 6,
    padding     : '6px 14px',
    color       : '#059669',
    fontSize    : 12,
  },

  dot: {
    width       : 7,
    height      : 7,
    borderRadius: '50%',
    background  : '#10b981',
    display     : 'inline-block',
  },

  connectBtn: {
    background  : '#ffffff',
    border      : '1px solid #10b981',
    color       : '#059669',
    padding     : '8px 18px',
    borderRadius: 6,
    cursor      : 'pointer',
    fontFamily  : 'inherit',
    fontSize    : 12,
    letterSpacing: 1,
  },

  body: {
    display: 'flex',
    gap    : 0,
    height : 'calc(100vh - 65px)',
  },

  left: {
    width       : 360,
    minWidth    : 360,
    borderRight : '1px solid #e2e8f0',
    padding     : '24px 20px',
    overflowY   : 'auto',
    display     : 'flex',
    flexDirection: 'column',
    gap         : 10,
    background  : '#ffffff',
  },

  right: {
    flex     : 1,
    padding  : '24px 24px',
    overflowY: 'auto',
    display  : 'flex',
    flexDirection: 'column',
    gap      : 16,
    background: '#f8fafc',
  },

  sectionLabel: {
    fontSize     : 10,
    letterSpacing: 3,
    color        : '#94a3b8',
    marginBottom : 4,
  },

  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 },
  inputLabel: { fontSize: 10, color: '#94a3b8', letterSpacing: 2 },

  input: {
    background  : '#ffffff',
    border      : '1px solid #e2e8f0',
    borderRadius: 5,
    color       : '#1e293b',
    fontFamily  : 'inherit',
    fontSize    : 12,
    padding     : '7px 10px',
    outline     : 'none',
  },

  flushBtn: {
    background  : '#fff1f2',
    border      : '1px dashed #fda4af',
    color       : '#e11d48',
    borderRadius: 5,
    padding     : '8px 12px',
    cursor      : 'pointer',
    fontFamily  : 'inherit',
    fontSize    : 11,
    letterSpacing: 1,
    marginBottom: 4,
  },

  sceneCard: {
    border      : '1px solid #e2e8f0',
    borderRadius: 8,
    padding     : '14px 16px',
    cursor      : 'default',
    transition  : 'all 0.2s',
    background  : '#ffffff',
  },

  sceneTop: {
    display       : 'flex',
    justifyContent: 'space-between',
    alignItems    : 'center',
    marginBottom  : 8,
  },

  sceneLabel: { fontWeight: 700, fontSize: 13, marginBottom: 2 },
  sceneSub  : { fontSize: 11, color: '#94a3b8' },
  sceneDesc : { fontSize: 11, color: '#64748b', lineHeight: 1.6 },

  spoofBadge: {
    marginTop   : 8,
    display     : 'inline-block',
    background  : '#f1f5f9',
    border      : '1px solid #e2e8f0',
    borderRadius: 4,
    padding     : '2px 8px',
    fontSize    : 10,
    color       : '#64748b',
  },

  runBtn: {
    background  : '#ffffff',
    border      : '1px solid',
    borderRadius: 5,
    padding     : '6px 16px',
    cursor      : 'pointer',
    fontFamily  : 'inherit',
    fontSize    : 11,
    fontWeight  : 700,
    letterSpacing: 2,
  },

  logBox: {
    background  : '#ffffff',
    border      : '1px solid #e2e8f0',
    borderRadius: 8,
    padding     : '14px 16px',
    minHeight   : 180,
    maxHeight   : 280,
    overflowY   : 'auto',
    display     : 'flex',
    flexDirection: 'column',
    gap         : 4,
    fontFamily  : 'inherit',
    fontSize    : 12,
  },

  logLine: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  logTime: { color: '#94a3b8', minWidth: 70, fontSize: 11 },

  otpBox: {
    background  : '#fffbeb',
    border      : '1px solid #fde68a',
    borderRadius: 8,
    padding     : '16px 18px',
  },

  otpTitle: { fontWeight: 700, color: '#d97706', marginBottom: 4 },
  otpHint : { fontSize: 11, color: '#64748b', marginBottom: 12 },

  otpRow  : { display: 'flex', gap: 10 },

  otpInput: {
    background  : '#ffffff',
    border      : '1px solid #fbbf24',
    borderRadius: 5,
    color       : '#b45309',
    fontFamily  : 'inherit',
    fontSize    : 20,
    padding     : '8px 14px',
    letterSpacing: 8,
    width       : 140,
    outline     : 'none',
    textAlign   : 'center',
  },

  otpBtn: {
    background  : '#fef3c7',
    border      : '1px solid #f59e0b',
    color       : '#b45309',
    borderRadius: 5,
    padding     : '8px 20px',
    cursor      : 'pointer',
    fontFamily  : 'inherit',
    fontSize    : 12,
    fontWeight  : 700,
  },

  resultBox: {
    background  : '#ffffff',
    border      : '1px solid',
    borderRadius: 8,
    padding     : '14px 16px',
  },

  resultLabel: { fontSize: 10, letterSpacing: 3, color: '#94a3b8', marginBottom: 8 },

  resultPre: {
    margin    : 0,
    fontSize  : 11,
    color     : '#475569',
    whiteSpace: 'pre-wrap',
    wordBreak : 'break-all',
    maxHeight : 220,
    overflowY : 'auto',
  },

  noteBox: {
    background  : '#ffffff',
    border      : '1px solid #e2e8f0',
    borderRadius: 8,
    padding     : '16px 18px',
    marginTop   : 'auto',
  },

  noteTitle: { fontWeight: 700, color: '#64748b', marginBottom: 6, fontSize: 12 },

  noteText: { color: '#64748b', lineHeight: 1.7, marginBottom: 10, fontSize: 11 },

  notePre: {
    background  : '#f1f5f9',
    border      : '1px solid #e2e8f0',
    borderRadius: 5,
    padding     : '12px 14px',
    fontSize    : 11,
    color       : '#475569',
    whiteSpace  : 'pre-wrap',
    margin      : 0,
    lineHeight  : 1.6,
  },
}
