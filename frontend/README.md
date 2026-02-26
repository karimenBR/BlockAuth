# BlockAuth Test Website

A comprehensive test interface for the BlockAuth microservice API. This frontend allows you to test all authentication flows including wallet connection, SIWE signing, and OTP verification.

## Features

- 🔐 **Wallet Authentication**: Connect MetaMask and sign SIWE messages
- 🤖 **AI Security Testing**: Test all 4 security agents in action
- 📧 **OTP Verification**: Test email/SMS OTP flow for high-risk logins
- 📊 **Risk Score Display**: See real-time risk scores and security levels
- 📝 **API Documentation**: Built-in API reference
- 🎨 **Modern UI**: Clean, responsive design with gradient effects

## Prerequisites

- Node.js 18+ and npm
- MetaMask browser extension
- BlockAuth backend running (default: http://localhost:3000)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and update settings:

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_API_URL=http://localhost:3000
VITE_PLATFORM_KEY=your-platform-key-here
```

### 3. Start Development Server

```bash
npm run dev
```

The app will be available at http://localhost:5173

## Usage Guide

### Home Page
- Learn about BlockAuth's 4 AI security agents
- View authentication flow diagram
- Quick navigation to all features

### Login Page
1. **Connect Wallet**: Click "Connect MetaMask Wallet"
2. **Sign In**: Click "Sign In with Ethereum" to generate and sign SIWE message
3. **Handle Response**:
   - **Low Risk**: Get access token immediately
   - **Medium/High Risk**: Enter OTP code sent to your email/SMS
4. **View Token**: See your JWT access token and risk score

### API Page
- View all available API endpoints
- See request/response examples
- Copy sample requests for testing

### About Page
- Learn about BlockAuth features
- View security stack details
- Understand the AI agent pipeline

## API Endpoints Tested

This frontend tests the following BlockAuth API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/nonce` | POST | Generate SIWE nonce |
| `/auth/login` | POST | Authenticate with SIWE signature |
| `/otp/verify` | POST | Verify OTP code |
| `/otp/resend` | POST | Resend OTP code (optional) |

## Testing Scenarios

### Scenario 1: Normal Login (Low Risk)
- Connect wallet from usual location
- Expected: Direct access token, no OTP required

### Scenario 2: Suspicious Login (Medium/High Risk)
- Connect from VPN or unusual location
- Change device/browser
- Expected: OTP required via email/SMS

### Scenario 3: OTP Verification
- After receiving OTP_REQUIRED response
- Enter 6-digit code from email
- Expected: Access token after successful verification

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx       # Main application component
│   ├── App.css       # Comprehensive styling
│   ├── main.jsx      # Entry point
│   └── index.css     # Global styles
├── .env              # Environment configuration
├── .env.example      # Environment template
├── package.json      # Dependencies
└── vite.config.js    # Vite configuration
```

## Dependencies

- **React 19**: UI framework
- **ethers.js 6**: Ethereum wallet interaction
- **siwe**: Sign-In with Ethereum standard
- **axios**: HTTP client for API calls
- **Vite**: Build tool and dev server

## Development

### Build for Production

```bash
npm run build
```

Output will be in the `dist/` folder.

### Preview Production Build

```bash
npm run preview
```

### Linting

```bash
npm run lint
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | BlockAuth backend URL | `http://localhost:3000` |
| `VITE_PLATFORM_KEY` | Platform API key for authentication | Required |

## Troubleshooting

### MetaMask Not Detected
- Install MetaMask browser extension
- Refresh the page after installation

### Connection Refused
- Ensure backend is running on `http://localhost:3000`
- Check `VITE_API_URL` in `.env` file
- Verify CORS settings in backend

### Invalid Platform Key
- Check `VITE_PLATFORM_KEY` in `.env`
- Verify the key is registered in backend
- Check backend logs for authentication errors

### OTP Not Received
- Verify email/phone in backend configuration
- Check backend environment variables (SendGrid, Twilio keys)
- Check spam folder for email OTP

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support (requires MetaMask)
- Mobile: ⚠️ Use MetaMask mobile browser

## Security Notes

- This is a **test interface** for development/demo purposes
- Never expose production API keys in frontend code
- Use environment variables for all sensitive configuration
- Implement proper key rotation in production

## License

MIT License - See main repository for details

