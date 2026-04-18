#!/usr/bin/env node
/*
 * One-shot helper to mint a Google OAuth refresh token for the PDF render service.
 *
 * Usage:
 *   1. Make sure .env has GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set.
 *   2. Run:  node get-refresh-token.js
 *   3. Open the printed URL in a browser, approve access for your Google account
 *      (the one that owns the /Deal Analyses/ Drive folder).
 *   4. Google redirects to http://localhost:8765/oauth2callback with ?code=...
 *   5. This script exchanges the code for tokens and prints GOOGLE_REFRESH_TOKEN=...
 *      Paste that into your .env and you're done.
 *
 * NOTE: when creating the OAuth Client ID in Google Cloud Console, add
 *       http://localhost:8765/oauth2callback  as an Authorized redirect URI.
 */
require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8765/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const PORT = 8765;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env before running this.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('\n========================================================');
console.log('1. Open this URL in your browser and approve access:');
console.log('\n   ' + authUrl + '\n');
console.log('2. After approval, Google will redirect to localhost.');
console.log('   This script is listening on port ' + PORT + '.');
console.log('========================================================\n');

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname !== '/oauth2callback') {
      res.writeHead(404).end('not found');
      return;
    }
    const code = u.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('missing ?code');
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success</h1><p>You can close this tab. Check your terminal for the refresh token.</p>');

    console.log('\n========================================================');
    console.log('SUCCESS. Paste the line below into your .env file:\n');
    if (tokens.refresh_token) {
      console.log('  GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    } else {
      console.log('  (no refresh_token returned — Google only issues one on first consent.');
      console.log('   Revoke access at https://myaccount.google.com/permissions and re-run.)');
    }
    console.log('\nAccess token (short-lived, for reference):', tokens.access_token);
    console.log('Scopes granted:', tokens.scope);
    console.log('========================================================\n');
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.writeHead(500).end('token exchange failed: ' + err.message);
    setTimeout(() => process.exit(1), 500);
  }
});

server.listen(PORT, () => {
  console.log(`[get-refresh-token] listening on http://localhost:${PORT}`);
});
