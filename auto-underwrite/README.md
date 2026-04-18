# auto-underwrite — PDF / DOCX render service

Small Node.js service that takes a deal JSON payload, renders it into a
`.docx` using the `docx` npm package, and uploads the file to a Google
Drive folder via OAuth.

Runs on the **paperclip** Droplet at `/home/brooke/pdf-render-service/`
under pm2, listening on port `3001`. Callers (n8n, curl, other Netlify
functions) POST to `http://64.23.204.220:3001/render` with the
`X-Auth-Token` header.

## Files

| File | Purpose |
|---|---|
| `server.js` | Express app — `/health` + `POST /render` |
| `generate_pdf.js` | Builds the `.docx` from the deal JSON |
| `google_drive.js` | OAuth2 client + Drive upload (uses refresh token) |
| `get-refresh-token.js` | One-shot local helper to mint the refresh token |
| `ecosystem.config.js` | pm2 config |
| `deploy.sh` | rsync + pm2 reload |
| `.env.example` | Template for env vars |

## Env vars

Copy `.env.example` to `.env` on paperclip (`/home/brooke/pdf-render-service/.env`)
and fill in:

| Var | What |
|---|---|
| `PORT` | `3001` |
| `AUTH_TOKEN` | shared secret — any caller POSTing to `/render` must send it as `X-Auth-Token` |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | same |
| `GOOGLE_REFRESH_TOKEN` | minted by `node get-refresh-token.js` |
| `DRIVE_FOLDER_ID` | last path segment of the `/Deal Analyses/` folder URL in Drive |

Generate a good `AUTH_TOKEN`:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## One-time Google Cloud setup

Because org policy blocks service-account JSON keys, we use an **OAuth
refresh token** tied to your personal Google account (whoever owns the
`/Deal Analyses/` folder).

### 1. Publish the OAuth consent screen

1. Open https://console.cloud.google.com/ and make sure the project
   `deal-pros-automation` is selected in the top-left dropdown.
2. Left sidebar → **APIs & Services** → **OAuth consent screen**.
3. Choose **External** for User Type (unless you have a Google
   Workspace domain — in which case pick Internal and you can skip
   the "publish" step).
4. Fill required fields:
   - App name: `Deal Pros Auto-Underwrite`
   - User support email: your email
   - Developer contact: your email
5. **Scopes**: click **Add or Remove Scopes**, filter for
   `drive.file`, check `https://www.googleapis.com/auth/drive.file`,
   click Update. `drive.file` only lets the app touch files IT creates
   — safest scope. Do NOT pick the full `drive` scope.
6. **Test users**: add the Google account that owns `/Deal Analyses/`.
   While the app is in Testing mode, only these listed users can grant
   access.
7. Save and go back to the OAuth consent screen overview. If the app
   is in "Testing", refresh tokens expire after 7 days. For a real
   always-on service, click **Publish App** → "In production". You
   will NOT need to go through Google's verification review because
   `drive.file` is a non-sensitive scope.

### 2. Create the OAuth Client ID

1. Left sidebar → **APIs & Services** → **Credentials**.
2. **Create Credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `pdf-render-service`.
5. **Authorized redirect URIs**, add this one exactly:
   ```
   http://localhost:8765/oauth2callback
   ```
6. Create. A dialog shows **Client ID** and **Client secret**. Copy
   both into your local `.env` (not paperclip yet — we'll mint the
   token locally first).

### 3. Mint the refresh token

On your laptop, in this folder:

```
cp .env.example .env
# paste GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into .env
npm install
node get-refresh-token.js
```

The script prints a URL. Open it, sign in with the Google account that
owns `/Deal Analyses/`, approve the scope. Google redirects back to
`localhost:8765` and the script prints

```
GOOGLE_REFRESH_TOKEN=1//0gAbC...
```

Paste that line into your `.env`.

> **If `refresh_token` is empty** — Google only issues one the first
> time you consent. Revoke the existing grant at
> https://myaccount.google.com/permissions (find "Deal Pros
> Auto-Underwrite") then re-run the script.

### 4. Find the Drive folder ID

Open `/Deal Analyses/` in Drive. The URL looks like:

```
https://drive.google.com/drive/folders/1aBc2DeFGhIjKlMnOpQrStUvWxYz
```

`DRIVE_FOLDER_ID` is that last path segment. Paste into `.env`.

Also: **share the folder with the Google account used above** as Editor.
Technically the OAuth'd account owns the folder so this is already
true, but double-check if the folder is in a shared drive.

## Deploy to paperclip

```
# on your laptop
./deploy.sh                 # rsync code + pm2 reload
INSTALL_DEPS=1 ./deploy.sh  # first time, or after package.json changes
```

`deploy.sh` rsyncs everything except `.env`, `node_modules/`, `.git/`,
and `*.log` to `root@64.23.204.220:/home/brooke/pdf-render-service/`.

**Before the first deploy, on paperclip:**

```
ssh root@64.23.204.220
mkdir -p /home/brooke/pdf-render-service
# create /home/brooke/pdf-render-service/.env with real values
# (see .env.example)
# open firewall:
ufw allow 3001/tcp
# make sure pm2 starts on reboot
pm2 startup systemd -u root --hp /root
pm2 save
```

## Test

Health check (no auth):

```
curl -s http://64.23.204.220:3001/health | jq
```

Render + upload (replace `TOKEN` with your `AUTH_TOKEN`):

```
curl -sS -X POST http://64.23.204.220:3001/render \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: TOKEN" \
  -d '{
    "dealId": "TEST-001",
    "deal": {
      "streetAddress": "123 Main St",
      "city": "Phoenix",
      "state": "AZ",
      "zip": "85016",
      "dealType": "Subject To",
      "askingPrice": 385000,
      "arv": 450000,
      "entryFee": 15000,
      "estRent": 2400,
      "piti": 1850,
      "headline": "Test Deal — Phoenix SubTo",
      "hook": "Smoke test for the render service."
    }
  }' | jq
```

A successful response includes `driveFileId` and `driveWebViewLink`.
Click the link — the `.docx` should open in Drive.

## Troubleshooting

- **`401 invalid or missing X-Auth-Token`** — set `AUTH_TOKEN` in `.env`
  on paperclip and in your caller.
- **`GOOGLE_REFRESH_TOKEN` missing** — re-run `get-refresh-token.js`,
  revoking any existing grant first.
- **`invalid_grant` from Google** — refresh token was revoked. Mint a
  new one. If the OAuth consent screen is still in "Testing" mode,
  refresh tokens expire after 7 days — publish the app to fix
  permanently.
- **`File not found: DRIVE_FOLDER_ID`** — either the folder ID is wrong
  or the OAuth'd Google account doesn't have access to it.
- **Health check returns `driveFolderConfigured: false`** — `.env` on
  paperclip is missing `DRIVE_FOLDER_ID`.
- **pm2 not auto-starting after reboot** — run `pm2 save` after the
  service is up; run `pm2 startup` once to install the systemd unit.

## Next steps

- `/auto-underwrite/` is under version control. Any edits on your laptop
  should be committed to the `claude/setup-nodejs-oauth-service-fpTNc`
  branch and then `./deploy.sh` to roll them out.
- The `/render` endpoint is intentionally dumb — it just materializes
  whatever `deal` JSON you send. The real underwriting logic (Claude
  prompts, scoring, routing) happens upstream in n8n.
