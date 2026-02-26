/**
 * ══════════════════════════════════════════════════════════════
 *  BlockAuth Client SDK — drop-in browser integration
 *
 *  Usage:
 *    1. Add to your page:
 *       <script src="blockauth-client.js"></script>
 *
 *    2. Trigger login:
 *       const result = await BlockAuth.login({ email: 'user@example.com', phone: '+1234567890' });
 *       if (result.action === 'ALLOW')        → store result.accessToken
 *       if (result.action === 'OTP_REQUIRED') → show OTP input, call BlockAuth.verify(code)
 *
 *  Requires: ethers.js or MetaMask's window.ethereum
 * ══════════════════════════════════════════════════════════════
 */



const BlockAuth = (() => {

  const BASE_URL       = 'http://localhost:3000';  
  const PLATFORM_KEY   = 'test-platform-key-123';              

  let _pendingToken = null;
  let _wallet       = null;

  // ── Internal helpers ──────────────────────────────────────

  async function apiFetch(path, body) {
  let res, data;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method : 'POST',
      headers: {
        'Content-Type'   : 'application/json',
        'X-Platform-Key' : PLATFORM_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }

  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

  async function getProvider() {
    if (!window.ethereum) throw new Error('MetaMask not installed.');
    const { ethers } = window;
    if (!ethers) throw new Error('ethers.js not loaded.');
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    return provider;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Full login flow:
   *   1. Get wallet address from MetaMask
   *   2. Fetch nonce from BlockAuth server
   *   3. Build SIWE message, request signature
   *   4. Submit to /auth/login
   *   5. Return result (ALLOW or OTP_REQUIRED)
   *
   * @param {object} opts - { email, phone }
   * @returns {object}    - auth result
   */
  async function login({ email = null, phone = null } = {}) {
    const provider = await getProvider();
    const signer   = await provider.getSigner();
    _wallet        = ethers.getAddress(await signer.getAddress());               
    // 1. Get nonce (server accepts any case, but we send checksummed for consistency)
    const { nonce } = await apiFetch('/auth/nonce', { address: _wallet });

    // 2. Build SIWE message
    const domain  = window.location.host;
    const origin  = window.location.origin;
    const chainId = (await provider.getNetwork()).chainId;

    let messageString;
    if (window.SiweMessage) {
      const siwe = new window.SiweMessage({
        domain,
        address       : _wallet,          // ← MUST be checksummed here
        statement     : 'Sign in to BlockAuth',
        uri           : origin,
        version       : '1',
        chainId       : Number(chainId),
        nonce,
        issuedAt      : new Date().toISOString(),
      });
      messageString = siwe.prepareMessage();
    } else {
      // Fallback manual construction — use checksummed address
     messageString =
      `${domain} wants you to sign in with your Ethereum account:\n` +
      `${_wallet}\n\n` +
      `Sign in to BlockAuth\n\n` +
      `URI: ${origin}\n` +
      `Version: 1\n` +
      `Chain ID: ${Number(chainId)}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${new Date().toISOString()}`;

    }  

    // 3. Request signature
    const signature = await signer.signMessage(messageString);

    // 4. Submit to BlockAuth
    const result = await apiFetch('/auth/login', {
      message  : messageString,
      signature,
      email,
      phone,
    });

    // 5. Store pending token if OTP required
    if (result.action === 'OTP_REQUIRED') {
      _pendingToken = result.pendingToken;
    }

    return result;
  }
  
  /**
   * Verify OTP code after an OTP_REQUIRED response.
   *
   * @param {string} code - 6-digit code from email/SMS
   * @returns {object}    - { success, accessToken?, attemptsLeft?, message }
   */
  async function verify(code) {
    if (!_pendingToken || !_wallet) {
      throw new Error('No pending OTP session. Call login() first.');
    }

    const result = await apiFetch('/otp/verify', {
      wallet      : _wallet,
      code        : String(code).trim(),
      pendingToken: _pendingToken,
    });

    if (result.success) {
      _pendingToken = null;  // clear pending state
    }

    return result;
  }

  /**
   * Request a new OTP code (e.g. user didn't receive it).
   * @param {string} channel - 'email' | 'sms' | undefined (both)
   */
  async function resend(channel) {
    if (!_pendingToken || !_wallet) {
      throw new Error('No pending OTP session. Call login() first.');
    }
    return apiFetch('/otp/resend', {
      wallet      : _wallet,
      pendingToken: _pendingToken,
      channel,
    });
  }

  /**
   * Validate an access token against /auth/me.
   * Use this on your backend to verify the user after login.
   */
  async function getMe(accessToken) {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: {
        'Authorization' : `Bearer ${accessToken}`,
        'X-Platform-Key': PLATFORM_KEY,
      },
    });
    if (!res.ok) throw new Error('Token validation failed.');
    return res.json();
  }

  return { login, verify, resend, getMe };

})();

// CommonJS export (for Node / bundlers)
if (typeof module !== 'undefined') module.exports = BlockAuth;
