# BlockAuth

> **Blockchain-native authentication with AI-powered security**

BlockAuth is a universal Web3 authentication service that combines Sign-In with Ethereum (SIWE) with intelligent risk detection. Four AI security agents analyze every login in real-time, applying adaptive multi-factor authentication only when needed.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/redis-%3E%3D6.0-red.svg)](https://redis.io/)

## ✨ Features

- **🔐 SIWE Standard** — Secure wallet-based authentication (EIP-4361)
- **🤖 4 AI Security Agents** — Real-time anomaly detection and risk scoring
- **🔑 Decentralized Identity** — Optional DID (did:ethr) support with verification
- **📧 Adaptive OTP** — Smart 2FA triggered only on suspicious logins
- **🌍 Geo-Velocity Detection** — Impossible travel and location anomaly checks
- **📱 Multi-Channel Delivery** — Email (SendGrid) + SMS (Twilio)
- **⚡ Zero-Knowledge** — No passwords stored, cryptographic verification only
- **🛡️ Rate Limiting** — Built-in protection against brute force attacks
- **📊 Session Tracking** — Redis-powered concurrent login detection
- **🎯 Platform-Agnostic** — REST API works with any frontend/backend

---

## 🏗️ Architecture

```
Client (Browser / App)
  │
  ├─ 1. GET  nonce (anti-replay)
  ├─ 2. Sign SIWE message with MetaMask/wallet
  ├─ 3. [Optional] Generate DID from wallet address
  └─ 4. POST /auth/login (with optional DID)
              │
              ▼
    ┌─────────────────────────────────────────────────────┐
    │                  BlockAuth Pipeline                  │
    │                                                     │
    │  DID Verification (if provided)                     │
    │    • Validate did:ethr format                       │
    │    • Extract address from DID                       │
    │    • Verify DID matches SIWE wallet                 │
    │               │                                     │
    │               ▼                                     │
    │  Agent 1 ──── Anomaly Detector                      │
    │    • Geo-velocity / impossible travel check         │
    │    • New country / device detection                 │
    │    • Concurrent session check                       │
    │    • Off-hours behavioural baseline                 │
    │               │                                     │
    │               ▼                                     │
    │  Agent 2 ──── Risk Scorer                          │
    │    • Weighted signal aggregation (0–100)            │
    │    • LOW (0–30) / MEDIUM (31–70) / CRITICAL (71+)  │
    │               │                                     │
    │               ▼                                     │
    │  Agent 3 ──── Action Executor                      │
    │    • LOW      → issue JWT with DID (if provided)    │
    │    • MEDIUM   → suspend session, call Agent 4       │
    │    • CRITICAL → suspend + alert email + call Agt 4  │
    │               │                                     │
    │               ▼  (only on MEDIUM/CRITICAL)          │
    │  Agent 4 ──── OTP Generator & Verifier             │
    │    • CSPRNG 6-digit code                            │
    │    • HMAC-SHA256 hash stored in Redis (TTL 5m)      │
    │    • Dispatch via SendGrid email + Twilio SMS       │
    │    • Platform shows code input to user              │
    │    • POST /otp/verify → DID re-verified → JWT       │
    └─────────────────────────────────────────────────────┘
             │
             ▼
       JWT with embedded DID (if provided)
       • wallet + did + mfa status + timestamps
       • DID verified on all subsequent /auth/me calls
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **Redis** ≥ 6.0 (local or cloud)
- **SendGrid API Key** (for email OTP)
- **Twilio Account** (for SMS OTP)

### Installation

```bash
# Clone the repository
git clone https://github.com/karimenBR/BlockAuth.git
cd BlockAuth/blockauth

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials (see Configuration section below)

# Start Redis (if using Docker)
docker run -d -p 6379:6379 redis:latest

# Start the server
npm run dev
```

The server will start on `http://localhost:3000`

### Frontend Setup

```bash
cd ../frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`

---

## ⚙️ Configuration

Create a `.env` file in the `blockauth` directory:

```bash
# === Core ===
NODE_ENV=development
PORT=3000
JWT_SECRET=your-secret-here  # Generate: openssl rand -hex 64
JWT_EXPIRES_IN=1h

# === Redis ===
REDIS_URL=redis://localhost:6379
# For cloud: rediss://:password@host:port

# === Email (SendGrid) ===
SENDGRID_API_KEY=SG.xxxxx
EMAIL_FROM=noreply@yourdomain.com

# === SMS (Twilio) ===
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_FROM_NUMBER=+1234567890

# === Security ===
PLATFORM_API_KEYS=test-platform-key-123,production-key-456
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com

# === Risk Thresholds ===
RISK_LOW_MAX=30           # 0-30: Low risk (allow)
RISK_MEDIUM_MAX=70        # 31-70: Medium risk (OTP required)
                          # 71+: Critical risk (OTP + alert email)
MAX_TRAVEL_SPEED_KPH=900  # Impossible travel threshold

# === OTP ===
OTP_TTL_SECONDS=300       # Code expires after 5 minutes
OTP_MAX_ATTEMPTS=3        # Hard block after 3 wrong attempts

# === SIWE ===
SIWE_DOMAIN=localhost     # Your frontend domain
```

---

## 📡 API Reference

All endpoints require the `X-Platform-Key` header.

### Authentication Flow

```
1. POST /auth/nonce       → Get nonce for SIWE message
2. [Client signs message with MetaMask]
3. POST /auth/login       → Submit signature + run security checks
4. If OTP required:
   - POST /otp/verify     → Submit OTP code
   - POST /otp/resend     → Request new code (optional)
5. GET /auth/me          → Validate token and get user info
```

---

### `POST /auth/nonce`

Get a one-time nonce for the SIWE message (prevents replay attacks).

**Request:**
```json
{
  "address": "0xYourWalletAddress"
}
```

**Response:**
```json
{
  "nonce": "a3f9c2e8b4d1..."
}
```

---

### `POST /auth/login`

Verify SIWE signature and run the 4-agent security pipeline.

**Request:**
```json
{
  "message": "<SIWE message string>",
  "signature": "0x...",
  "email": "user@example.com",      // Optional but required for OTP
  "phone": "+21612345678",          // Optional
  "did": "did:ethr:0xYourAddress"   // Optional: Decentralized Identity
}
```

**Response — LOW risk (immediate access):**
```json
{
  "action": "ALLOW",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "1h",
  "riskScore": 12,
  "message": "Authentication successful."
}
```

**Response — MEDIUM/CRITICAL risk (OTP required):**
```json
{
  "action": "OTP_REQUIRED",
  "pendingToken": "eyJhbGciOiJIUzI1NiIs...",
  "otpChannel": ["email", "sms"],
  "otpExpiresIn": 300,
  "riskScore": 74,
  "riskLevel": "CRITICAL",
  "reasons": [
    "Impossible travel: Tunis → Moscow in 2 hours",
    "New device detected"
  ],
  "message": "Suspicious login detected. A verification code has been sent."
}
```

**DID Verification:**
- If `did` is provided, it must match the wallet address
- Format: `did:ethr:0xAddress` or `did:ethr:network:0xAddress`
- The DID is embedded in the JWT and verified on all subsequent requests

---

### `POST /otp/verify`

Submit OTP code after receiving `OTP_REQUIRED` response.

**Request:**
```json
{
  "wallet": "0x...",
  "code": "482910",
  "pendingToken": "eyJhbGci..."
}
```

**Response — Success:**
```json
{
  "success": true,
  "action": "VERIFIED",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "1h",
  "message": "Identity verified. Access granted."
}
```

**Response — Wrong code:**
```json
{
  "success": false,
  "action": "WRONG_CODE",
  "attemptsLeft": 2,
  "message": "Incorrect code. 2 attempt(s) remaining."
}
```

**Response — Blocked:**
```json
{
  "success": false,
  "action": "HARD_BLOCK",
  "message": "Too many failed attempts. This session has been blocked."
}
```

---

### `POST /otp/resend`

Request a new OTP code (rate-limited: 3 per 10 minutes).

**Request:**
```json
{
  "wallet": "0x...",
  "pendingToken": "eyJhbGci...",
  "channel": "email"  // Optional: "email", "sms", or omit for both
}
```

**Response:**
```json
{
  "success": true,
  "channels": ["email"],
  "message": "New verification code sent."
}
```

---

### `GET /auth/me`

Validate access token and retrieve user information.

**Headers:**
```
Authorization: Bearer <accessToken>
X-Platform-Key: your-platform-key
```

**Response:**
```json
{
  "wallet": "0xc9288c8f...",
  "did": "did:ethr:0xc9288c8f...",  // If provided during login
  "didVerified": true,
  "mfaVerified": true,              // True if OTP was completed
  "issuedAt": "2026-02-26T14:32:00.000Z",
  "expiresAt": "2026-02-26T15:32:00.000Z"
}
```

---

## Frontend Integration

```html
<!-- Include ethers.js + SIWE (CDN) -->
<script src="https://cdn.ethers.io/lib/ethers-5.7.esm.min.js"></script>
<script src="https://unpkg.com/siwe/dist/siwe.js"></script>
<script src="blockauth-client.js"></script>

<script>
async function connectWallet() {
  try {
    // 1. Login (handles SIWE signing automatically)
    const result = await BlockAuth.login({
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
    });

    if (result.action === 'ALLOW') {
      // Store token and redirect
      localStorage.setItem('blockauth_token', result.accessToken);
      window.location.href = '/dashboard';
    }

    if (result.action === 'OTP_REQUIRED') {
      document.getElementById('otp-screen').style.display = 'block';
      document.getElementById('risk-level').textContent = result.riskLevel;
    }

  } catch (err) {
    console.error('Login error:', err.message);
  }
}

async function submitOTP() {
  const code   = document.getElementById('otp-input').value;
  const result = await BlockAuth.verify(code);

  if (result.success) {
    localStorage.setItem('blockauth_token', result.accessToken);
    window.location.href = '/dashboard';
  } else if (result.action === 'HARD_BLOCK') {
    alert('Account blocked. Please contact support.');
  } else {
    alert(`Wrong code. ${result.attemptsLeft} attempt(s) left.`);
  }
}
</script>
```

---

## 🆔 Decentralized Identity (DID) Integration

BlockAuth supports **did:ethr** (Ethereum DID Method) for enhanced identity verification. DIDs provide a standardized way to represent blockchain identities beyond just wallet addresses.

### What is DID?

A Decentralized Identifier (DID) is a W3C standard for self-sovereign digital identity. In BlockAuth:
- DIDs are cryptographically verifiable
- They link directly to Ethereum addresses
- They enable interoperability with other DID-aware systems

### DID Format

BlockAuth supports two did:ethr formats:

```
# Standard format (mainnet implied)
did:ethr:0xYourWalletAddress

# With explicit network
did:ethr:mainnet:0xYourWalletAddress
did:ethr:sepolia:0xYourWalletAddress
did:ethr:polygon:0xYourWalletAddress
```

### How to Use DID

#### 1. **Generate DID from Wallet**

Simply prepend `did:ethr:` to your Ethereum address:

```javascript
const wallet = "0xc9288C8f453308ddBE7F81A3D9256DF8da05C440";
const did = `did:ethr:${wallet}`;
// Result: did:ethr:0xc9288C8f453308ddBE7F81A3D9256DF8da05C440
```

#### 2. **Login with DID**

Include the DID in your login request:

```javascript
const loginResponse = await axios.post('/auth/login', {
  message: siweMessage,
  signature: signature,
  email: 'user@example.com',
  phone: '+1234567890',
  did: 'did:ethr:0xc9288C8f453308ddBE7F81A3D9256DF8da05C440'
}, {
  headers: { 'X-Platform-Key': 'your-key' }
});
```

#### 3. **DID Verification Process**

BlockAuth automatically verifies:
1. ✅ **Format validation** — Ensures DID matches `did:ethr` pattern
2. ✅ **Address extraction** — Extracts address from DID
3. ✅ **Address matching** — Verifies DID address matches SIWE wallet
4. ✅ **JWT embedding** — Embeds verified DID in access token
5. ✅ **Persistent verification** — Validates DID on all subsequent requests

**Security guarantee:** A DID cannot be used with a different wallet address. The DID is cryptographically locked to the signing wallet.

#### 4. **Retrieve DID from Token**

After successful authentication, query `/auth/me`:

```javascript
const response = await axios.get('/auth/me', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'X-Platform-Key': 'your-key'
  }
});

console.log(response.data);
// {
//   wallet: "0xc9288c8f...",
//   did: "did:ethr:0xc9288c8f...",
//   didVerified: true,
//   mfaVerified: true,
//   issuedAt: "2026-02-26T10:00:00Z",
//   expiresAt: "2026-02-26T11:00:00Z"
// }
```

### DID in OTP Flow

DIDs are preserved through the entire authentication flow:

```
1. Login with DID → pendingToken (contains DID)
2. OTP verification → DID is validated again
3. Final accessToken → DID embedded in JWT
```

**All OTP endpoints verify DID consistency**, preventing token reuse attacks.

### Benefits of Using DID

| Feature | Without DID | With DID |
|---------|-------------|----------|
| Identity format | Wallet address only | Standardized W3C DID |
| Interoperability | BlockAuth-specific | Works with other DID systems |
| Verifiable credentials | Not supported | Ready for future VC integration |
| Cross-chain identity | Single address | Can represent multi-chain identity |
| Privacy | Address exposed | Can use privacy-preserving DIDs |

### Example: Full Login Flow with DID

```javascript
// Step 1: Connect wallet
const provider = new ethers.BrowserProvider(window.ethereum);
const [address] = await provider.send('eth_requestAccounts', []);
const wallet = ethers.getAddress(address); // Checksummed

// Step 2: Generate DID
const did = `did:ethr:${wallet}`;

// Step 3: Get nonce
const { data: { nonce } } = await axios.post('/auth/nonce', 
  { address: wallet },
  { headers: { 'X-Platform-Key': 'your-key' } }
);

// Step 4: Create and sign SIWE message
const siweMessage = new SiweMessage({
  domain: window.location.host,
  address: wallet,
  statement: 'Sign in with Ethereum',
  uri: window.location.origin,
  version: '1',
  chainId: 1,
  nonce: nonce
});

const message = siweMessage.prepareMessage();
const signer = await provider.getSigner();
const signature = await signer.signMessage(message);

// Step 5: Login with DID
const { data } = await axios.post('/auth/login', {
  message,
  signature,
  email: 'user@example.com',
  phone: '+1234567890',
  did: did  // ← DID included here
}, {
  headers: { 'X-Platform-Key': 'your-key' }
});

if (data.action === 'ALLOW') {
  // Store token - it contains the verified DID
  localStorage.setItem('token', data.accessToken);
  console.log('Logged in with DID:', did);
}
```

### Future DID Features

BlockAuth's DID implementation is designed to support:

- **Verifiable Credentials (VCs)** — Coming soon
- **DID Document Resolution** — Resolve full DID documents
- **Multiple DID Methods** — Support for did:key, did:pkh, did:web
- **Cross-chain DIDs** — Link identities across multiple chains

### DID Resources

- [W3C DID Specification](https://www.w3.org/TR/did-core/)
- [ERC-1056: Ethereum DID Registry](https://eips.ethereum.org/EIPS/eip-1056)
- [did:ethr Method Specification](https://github.com/decentralized-identity/ethr-did-resolver)

---

## Deploying to Production

### With Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

```bash
docker build -t blockauth .
docker run -p 3000:3000 --env-file .env blockauth
```

### With Redis Cloud / Upstash

Set `REDIS_URL=rediss://:password@host:port` in `.env`.
### Runing Redis using docker
docker run -d -p 6379:6379 redis:latest

### Reverse proxy (nginx)

```nginx
location /blockauth/ {
  proxy_pass       http://localhost:3000/;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

---

## Risk Tuning

Edit `.env` to adjust thresholds:

```
RISK_LOW_MAX=30        # 0–30  → LOW  → allow
RISK_MEDIUM_MAX=70     # 31–70 → MEDIUM → OTP
                       # 71+   → CRITICAL → OTP + alert
OTP_TTL_SECONDS=300    # code expires after 5 min
OTP_MAX_ATTEMPTS=3     # hard block after 3 wrong codes
MAX_TRAVEL_SPEED_KPH=900   # impossible travel threshold
```

Signal weights are in `src/agents/agent2_scorer.js`:

```js
const SIGNAL_WEIGHTS = {
  IMPOSSIBLE_TRAVEL  : 70,
  CONCURRENT_SESSION : 35,
  NEW_COUNTRY        : 25,
  NEW_DEVICE         : 20,
  ODD_HOURS          : 10,
  FIRST_LOGIN        : 0,
};
```

---

## Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Runtime     | Node.js 20 + Express 4            |
| Blockchain  | SIWE (EIP-4361) + ethers.js 6     |
| Identity    | DID (did:ethr) with W3C compliance|
| Session     | Redis (ioredis)                   |
| OTP crypto  | Node.js `crypto` (CSPRNG + HMAC)  |
| Email       | SendGrid (@sendgrid/mail)         |
| SMS         | Twilio                            |
| Geo/IP      | geoip-lite (offline DB)           |
| Auth tokens | JSON Web Tokens (jsonwebtoken)    |
| Logging     | Winston                           |
| Tests       | Jest + Supertest                  |
