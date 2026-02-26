'use strict';

require('dotenv').config();
const axios = require('axios');
const { SiweMessage } = require('siwe');
const { Wallet } = require('ethers');

const API = process.env.API_BASE_URL || 'http://localhost:3000';
const PLATFORM_KEY = process.env.PLATFORM_API_KEY || process.env.PLATFORM_API_KEYS?.split(',')[0];
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY ;

async function main() {
  if (!PRIVATE_KEY) throw new Error('Missing TEST_WALLET_PRIVATE_KEY');
  if (!PLATFORM_KEY) throw new Error('Missing PLATFORM_API_KEY');

  const wallet = new Wallet(PRIVATE_KEY);
  const address = await wallet.getAddress();

  const nonceRes = await axios.post(
    `${API}/auth/nonce`,
    { address },
    { headers: { 'x-platform-key': PLATFORM_KEY } }
  );

  const nonce = nonceRes.data.nonce;

  const message = new SiweMessage({
    domain: process.env.SIWE_DOMAIN || 'localhost',
    address,
    statement: 'Sign in to BlockAuth',
    uri: 'http://localhost:5173/',
    version: '1',
    chainId: 1,
    nonce,
  });

  const signature = await wallet.signMessage(message.prepareMessage());

  const loginRes = await axios.post(
    `${API}/auth/login`,
    {
      message: message.prepareMessage(),
      signature,
      email: process.env.TEST_EMAIL || null,
      phone: process.env.TEST_PHONE || null,
    },
    { headers: { 'x-platform-key': PLATFORM_KEY } }
  );

  console.log('Login response:', loginRes.data);
}

main().catch(err => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
