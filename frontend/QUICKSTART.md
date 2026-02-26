# BlockAuth Test Website - Quick Start

## What's Been Set Up

Your frontend is now a fully functional test website for the BlockAuth microservice! Here's what's included:

### 🎨 Features
- **Home Page**: Overview of BlockAuth and its 4 AI security agents
- **Login Page**: Full authentication flow with wallet connection and SIWE
- **API Page**: Complete API documentation for all endpoints
- **About Page**: Detailed information about the security stack
- **OTP Verification**: Test the 2FA flow for high-risk logins

### 📦 Dependencies Added
- `axios@^1.6.5` - HTTP client for API calls
- `ethers@^6.10.0` - Ethereum wallet integration
- `siwe@^2.1.4` - Sign-In with Ethereum standard

### 🎨 Professional Styling
- Modern gradient design (purple theme)
- Fully responsive layout
- Smooth animations and transitions
- Clean, intuitive user interface

## How to Run

### Option 1: Quick Start (Recommended)

```bash
# From the frontend directory
npm run dev
```

Then open http://localhost:5173 in your browser with MetaMask installed.

### Option 2: With Backend

```bash
# Terminal 1 - Start Backend
cd blockauth
npm start

# Terminal 2 - Start Frontend
cd frontend
npm run dev
```

## Configuration

The `.env` file has been created with default values:

```
VITE_API_URL=http://localhost:3000
VITE_PLATFORM_KEY=test-platform-key-123
```

**Important**: Update `VITE_PLATFORM_KEY` with your actual platform key from the backend!

## Testing the Microservice

### 1. Basic Login Flow
1. Navigate to the **Login** page
2. Click "Connect MetaMask Wallet"
3. Approve the connection in MetaMask
4. Click "Sign In with Ethereum"
5. Sign the SIWE message in MetaMask

**Expected Outcomes**:
- **Low Risk**: Instant access token
- **Medium/High Risk**: OTP verification required

### 2. OTP Flow (High Risk Login)
If OTP is required:
1. Check your email for the 6-digit code
2. Enter the code in the OTP input field
3. Click "Verify OTP"
4. Receive access token after verification

### 3. API Testing
- Go to the **API** page to see all available endpoints
- Review request/response formats
- Use the documentation to make custom API calls

### 4. Learn About Features
- **Home**: See the 4 AI security agents in action
- **About**: Learn about the technology stack
- View authentication flow diagrams

## What Each Page Does

### 🏠 Home Page
- Hero section with call-to-action
- 4 AI Security Agents showcase:
  - Agent 1: Anomaly Detector
  - Agent 2: Risk Scorer
  - Agent 3: Action Executor
  - Agent 4: OTP Generator & Verifier
- Authentication flow visualization

### 🔐 Login Page
- MetaMask wallet connection
- SIWE message generation and signing
- Risk score display
- OTP verification interface
- Access token display

### 📝 API Page
- Complete API documentation
- Request/response examples
- Authentication headers guide
- Code snippets for testing

### ℹ️ About Page
- Feature list
- Security stack details
- Technology overview

## Browser Requirements

- Modern browser (Chrome, Firefox, Edge, Safari)
- MetaMask extension installed
- JavaScript enabled

## Troubleshooting

### Port Already in Use
```bash
# Kill the process on port 5173
npx kill-port 5173
npm run dev
```

### MetaMask Not Detected
1. Install MetaMask from https://metamask.io
2. Refresh the page
3. Try reconnecting

### Backend Connection Issues
1. Verify backend is running on port 3000
2. Check CORS settings in backend
3. Verify `VITE_API_URL` in `.env`

### Invalid Platform Key
1. Check backend for registered platform keys
2. Update `VITE_PLATFORM_KEY` in `.env`
3. Restart the dev server (`npm run dev`)

## Next Steps

1. **Start the backend** (if not already running)
2. **Run `npm run dev`** in the frontend directory
3. **Open http://localhost:5173** in your browser
4. **Install MetaMask** if not already installed
5. **Test the login flow** with different scenarios

## Production Build

When ready to deploy:

```bash
npm run build
```

This creates optimized production files in the `dist/` folder.

## Need Help?

- Check the [README.md](./README.md) for detailed documentation
- Review the `.env.example` for configuration options
- Check browser console for any errors
- Verify backend logs for API issues

---

**Ready to test?** Run `npm run dev` and visit http://localhost:5173! 🚀
