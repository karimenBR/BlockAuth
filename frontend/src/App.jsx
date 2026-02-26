import { useState, useEffect } from 'react'
import { generateNonce, SiweMessage } from 'siwe'
import { BrowserProvider, getAddress } from 'ethers' 
 
import axios from 'axios'
import './App.css'
import BlockAuthTestPanel from './BlockAuthTestPanel'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const PLATFORM_KEY = import.meta.env.VITE_PLATFORM_KEY || 'test-platform-key-123'

const formatError = (err) => {
  if (axios.isAxiosError?.(err)) {
    const status = err.response?.status
    const data = err.response?.data
    const detail = data?.error || data?.message || err.message || 'Unknown error'
    return status ? `${detail} (HTTP ${status})` : detail
  }

  return err?.message || String(err) || 'Unknown error'
}

function App() {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [pendingToken, setPendingToken] = useState(null)
  const [riskScore, setRiskScore] = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [riskLevel, setRiskLevel] = useState(null)
  const [showPage, setShowPage] = useState('home') // home, about, api, login



  const connectWallet = async () => {
    if (!window.ethereum) {
      setMessage('MetaMask not found')
      return
    }
    try {
      const [addr] = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })
      const checksummed = getAddress(addr)  // ← add this
      setAccount(checksummed)               // ← use checksummed
      setMessage(`Connected: ${checksummed.slice(0, 6)}...${checksummed.slice(-4)}`)
    } catch (err) {
      setMessage(`Error: ${err.message}`)
    }
  }
  // Login with SIWE
  const login = async () => {
    if (!account) {
      setMessage('Please connect wallet first')
      return
    }

    setLoading(true)
    try {
      // Step 1: Get nonce
      const nonceRes = await axios.post(
        `${API_URL}/auth/nonce`,
        { address: account },
        { headers: { 'X-Platform-Key': PLATFORM_KEY } }
      )
      const nonce = nonceRes.data.nonce

      // Step 2: Create SIWE message
      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address: account,
        statement: 'Sign in with Ethereum',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce: nonce
      })

      // Step 3: Sign message
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const message = siweMessage.prepareMessage()
      const signature = await signer.signMessage(message)

      // Step 4: Submit to BlockAuth
      const loginRes = await axios.post(
        `${API_URL}/auth/login`,
        {
          message,
          signature,
          email: 'karimenbenromdhane55@gmail.com',
          phone: '+21693779503'
        },
        { headers: { 'X-Platform-Key': PLATFORM_KEY } }
      )

      if (loginRes.data.action === 'ALLOW') {
        setAccessToken(loginRes.data.accessToken)
        setRiskScore(loginRes.data.riskScore)
        setMessage(`✅ Login successful! Risk score: ${loginRes.data.riskScore}`)
      } else if (loginRes.data.action === 'OTP_REQUIRED') {
        setPendingToken(loginRes.data.pendingToken)
        setRiskScore(loginRes.data.riskScore)
        setRiskLevel(loginRes.data.riskLevel)
        setOtpRequired(true)
        setMessage(`⚠️  OTP required. Risk level: ${loginRes.data.riskLevel}`)
      }
    } catch (err) {
      console.error('Login failed', err)
      setMessage(`Login failed: ${formatError(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // Verify OTP
  const verifyOtp = async () => {
    if (!otpCode || !pendingToken) {
      setMessage('Enter OTP code')
      return
    }

    setLoading(true)
    try {
      const res = await axios.post(
        `${API_URL}/otp/verify`,
        {
          wallet: account,
          code: otpCode,
          pendingToken
        },
        { headers: { 'X-Platform-Key': PLATFORM_KEY } }
      )

      if (res.data.success) {
        setAccessToken(res.data.accessToken)
        setOtpRequired(false)
        setMessage('✅ OTP verified! Access granted.')
      } else {
        setMessage(`❌ ${res.data.message}`)
      }
    } catch (err) {
      console.error('OTP verify failed', err)
      setMessage(`Error: ${formatError(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      {/* Navigation */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-brand">
            <h2>🔐 BlockAuth</h2>
          </div>
          <ul className="nav-links">
            <li><button className={`nav-btn ${showPage === 'home' ? 'active' : ''}`} onClick={() => { setShowPage('home'); setAccessToken(null); setAccount(null) }}>Home</button></li>
            <li><button className={`nav-btn ${showPage === 'about' ? 'active' : ''}`} onClick={() => setShowPage('about')}>About</button></li>
            <li><button className={`nav-btn ${showPage === 'api' ? 'active' : ''}`} onClick={() => setShowPage('api')}>API</button></li>
            <li><button className={`nav-btn ${showPage === 'test' ? 'active' : ''}`} onClick={() => setShowPage('test')}>Test</button></li>
            <li><button className={`nav-btn ${showPage === 'login' ? 'active' : ''}`} onClick={() => setShowPage('login')}>Login</button></li>
          </ul>
        </div>
      </nav>

      {/* Home Page */}
      {showPage === 'home' && (
        <div className="page">
          <section className="hero">
            <div className="hero-content">
              <h1>Blockchain-native Authentication</h1>
              <p>Universal Web3 auth with 4 AI security agents protecting every login</p>
              <button className="cta-btn" onClick={() => setShowPage('login')}>Get Started</button>
            </div>
          </section>

          <section className="features">
            <h2>4 AI Security Agents</h2>
            <div className="agents-grid">
              <div className="agent-card">
                <div className="agent-number">1</div>
                <h3>Anomaly Detector</h3>
                <p>Geo-velocity checks, impossible travel detection, device fingerprinting, behavioral baseline analysis</p>
              </div>
              <div className="agent-card">
                <div className="agent-number">2</div>
                <h3>Risk Scorer</h3>
                <p>Weighted signal aggregation: LOW (0–30), MEDIUM (31–70), CRITICAL (71+)</p>
              </div>
              <div className="agent-card">
                <div className="agent-number">3</div>
                <h3>Action Executor</h3>
                <p>Conditional logic: LOW allows access, MEDIUM/CRITICAL triggers OTP verification</p>
              </div>
              <div className="agent-card">
                <div className="agent-number">4</div>
                <h3>OTP Generator & Verifier</h3>
                <p>CSPRNG 6-digit codes, HMAC-SHA256 hashed, dispatched via email & SMS</p>
              </div>
            </div>
          </section>

          <section className="flow-section">
            <h2>Authentication Flow</h2>
            <div className="flow-diagram">
              <div className="flow-step">1. Connect Wallet</div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">2. Sign SIWE Message</div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">3. Run Security Agents</div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">4. Get Access Token</div>
            </div>
          </section>
        </div>
      )}

      {/* About Page */}
      {showPage === 'about' && (
        <div className="page">
          <section className="content-section">
            <h1>About BlockAuth</h1>
            <p>BlockAuth is a next-generation Web3 authentication platform that combines blockchain security with artificial intelligence.</p>
            
            <h2>Key Features</h2>
            <ul className="features-list">
              <li>✅ Sign in with Ethereum (SIWE) standard</li>
              <li>✅ Real-time anomaly detection</li>
              <li>✅ Adaptive risk-based authentication</li>
              <li>✅ Two-factor OTP when needed</li>
              <li>✅ Email & SMS notifications</li>
              <li>✅ Geographic velocity checks</li>
              <li>✅ Device fingerprinting</li>
              <li>✅ Zero-knowledge security</li>
            </ul>

            <h2>Security Stack</h2>
            <ul className="tech-list">
              <li>SIWE (Sign-in with Ethereum)</li>
              <li>JWT tokens with configurable TTL</li>
              <li>Redis for OTP session management</li>
              <li>SendGrid for email delivery</li>
              <li>Twilio for SMS delivery</li>
              <li>GeoIP for location tracking</li>
              <li>HMAC-SHA256 for code hashing</li>
            </ul>
          </section>
        </div>
      )}

      {/* API Page */}
      {showPage === 'api' && (
        <div className="page">
          <section className="content-section">
            <h1>API Documentation</h1>
            
            <div className="api-endpoint">
              <h3>POST /auth/nonce</h3>
              <p>Get a one-time nonce for SIWE message</p>
              <pre>{'{ "address": "0x..." }'}</pre>
            </div>

            <div className="api-endpoint">
              <h3>POST /auth/login</h3>
              <p>Verify SIWE signature and run security pipeline</p>
              <pre>{`{
  "message": "<SIWE message>",
  "signature": "0x...",
  "email": "user@example.com",
  "phone": "+1234567890"
}`}</pre>
            </div>

            <div className="api-endpoint">
              <h3>POST /otp/verify</h3>
              <p>Verify the OTP code and issue access token</p>
              <pre>{`{
  "wallet": "0x...",
  "code": "482910",
  "pendingToken": "eyJ..."
}`}</pre>
            </div>

            <div className="api-endpoint">
              <h3>Headers</h3>
              <p>All endpoints require:</p>
              <pre>X-Platform-Key: your-platform-key</pre>
            </div>
          </section>
        </div>
      )}
      {/* Test Page */}
      {showPage === 'test' && (
        <BlockAuthTestPanel></BlockAuthTestPanel>
      )}

      {/* Login Page */}
      {showPage === 'login' && (
        <div className="page login-page">
          <div className="login-card">
            <h1>🔐 Sign In</h1>
            <p>Secure Web3 authentication</p>

            {!account ? (
              <button className="primary-btn" onClick={connectWallet}>Connect MetaMask Wallet</button>
            ) : (
              <>
                <div className="account-info">
                  <strong>Connected:</strong> {account.slice(0, 6)}...{account.slice(-4)}
                </div>

                {!accessToken && !otpRequired && (
                  <button className="primary-btn" onClick={login} disabled={loading}>
                    {loading ? '⏳ Signing in...' : '✍️ Sign In with Ethereum'}
                  </button>
                )}

                {otpRequired && (
                  <div className="otp-section">
                    <h3>⚠️ Verify Your Identity</h3>
                    <p className={`risk-level ${riskLevel?.toLowerCase()}`}>Risk Level: {riskLevel}</p>
                    <input
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength="6"
                      className="otp-input"
                    />
                    <button className="primary-btn" onClick={verifyOtp} disabled={loading}>
                      {loading ? '⏳ Verifying...' : '✅ Verify OTP'}
                    </button>
                  </div>
                )}

                {accessToken && (
                  <div className="success-box">
                    <h3>✅ Authenticated!</h3>
                    <p>Risk Score: <strong>{riskScore}</strong></p>
                    <textarea
                      readOnly
                      value={`Access Token:\n${accessToken}`}
                      rows="4"
                      className="token-display"
                    />
                  </div>
                )}
              </>
            )}

            {message && (
              <div className={`alert ${message.includes('✅') ? 'success' : message.includes('⚠️') ? 'warning' : 'error'}`}>
                {message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>&copy; 2026 BlockAuth. Secure Web3 Authentication with AI Security Agents.</p>
      </footer>
    </div>
  )
}

export default App
