# n8n Migration — Cloud → Paperclip Droplet

Migrate your 3 n8n workflows off the paid n8n Cloud trial onto your existing DigitalOcean "paperclip" Droplet. Eliminates the $20/mo subscription; gives you unlimited API access.

**Time: 30–45 min.** Done in one sitting. No downtime during active work hours if you do it off-hours.

---

## Before you start

Have these handy:
- **Droplet SSH**: `ssh root@64.23.204.220` / password `Paperclip2026!` (per `CLAUDE.md`)
- **n8n Cloud login** at `https://dealpros.app.n8n.cloud/`
- **A subdomain you control** for the self-hosted n8n (recommended: `n8n.termsforsale.com` or `n8n.dealpros.io` if you own it)
- **~30 min of focus** — don't pause mid-migration; state matters

---

## Phase 0 — Back up your Cloud workflows (5 min)

Save all 3 workflows to your local machine first — insurance in case something goes wrong.

1. Log into n8n Cloud
2. For each of these workflows:
   - **TFS — Buyer Match Engine (GHL + Notion)**
   - **TFS — Helper: Deal Counter Math**
   - **TFS — Notion Deal Inventory Bridge**

   Do this:
   - Open the workflow
   - Top-right ⋯ menu → **Download**
   - Save each as `backup-01-match-engine.json`, `backup-02-notion-bridge.json`, `backup-03-helper-increment.json` somewhere safe (e.g. `~/termsforsale-site/tfs-build/n8n/backups/`)

3. Also take screenshots of:
   - Each workflow canvas
   - The Credentials panel (names of each credential — you can't export secrets, just re-enter them after)

---

## Phase 1 — Install n8n on the Droplet (15 min)

SSH in:

```bash
ssh root@64.23.204.220
```

### 1.1 Install Docker (skip if already installed)

Check first:
```bash
docker --version
```

If Docker is missing:
```bash
apt update && apt install -y docker.io docker-compose
systemctl enable docker
systemctl start docker
```

### 1.2 Set up the n8n data directory

```bash
mkdir -p /root/n8n-data
chown -R 1000:1000 /root/n8n-data
```

### 1.3 Create a docker-compose.yml for n8n

Pick a subdomain. Replace `n8n.termsforsale.com` below with whatever you're using. For DNS: add an A record pointing the subdomain to `64.23.204.220` **before** continuing — SSL provisioning depends on it.

```bash
mkdir -p /root/n8n
cat > /root/n8n/docker-compose.yml <<'EOF'
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=n8n.termsforsale.com
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://n8n.termsforsale.com/
      - GENERIC_TIMEZONE=America/Phoenix
      - TZ=America/Phoenix
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=CHANGE_ME_STRONG_PASSWORD_HERE
      - N8N_ENCRYPTION_KEY=CHANGE_ME_RANDOM_STRING_32_CHARS
      - GHL_LOCATION_ID=7IyUgu1zpi38MDYpSDTs
      - NOTION_DEAL_INVENTORY_DB_ID=a3c0a38fd9294d758dedabab2548ff29
    volumes:
      - /root/n8n-data:/home/node/.n8n
    networks:
      - web

networks:
  web:
    external: false
EOF
```

**CRITICAL — replace two values before starting:**
1. `CHANGE_ME_STRONG_PASSWORD_HERE` → generate with `openssl rand -base64 24`
2. `CHANGE_ME_RANDOM_STRING_32_CHARS` → generate with `openssl rand -hex 16`

Save those two to a password manager — the encryption key specifically matters for credential decryption. If you lose it, all stored credentials in the n8n instance become unrecoverable.

### 1.4 Set up Nginx reverse proxy with HTTPS

If Nginx is already running on the Droplet (check with `nginx -v`), add this server block. Otherwise install:

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Add the Nginx config:

```bash
cat > /etc/nginx/sites-available/n8n <<'EOF'
server {
    listen 80;
    server_name n8n.termsforsale.com;

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF
ln -sf /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/n8n
nginx -t
systemctl restart nginx
```

Provision Let's Encrypt SSL:

```bash
certbot --nginx -d n8n.termsforsale.com --non-interactive --agree-tos -m info@termsforsale.com
```

### 1.5 Start n8n

```bash
cd /root/n8n
docker-compose up -d
```

Check logs:
```bash
docker-compose logs -f n8n
```

You should see `n8n ready on 0.0.0.0, port 5678`. Ctrl-C to exit the log view (container keeps running).

### 1.6 Verify it's reachable

Open in browser: `https://n8n.termsforsale.com/`

You should see the n8n login page, protected by the basic-auth credentials you set in the compose file. Log in.

First-time setup: n8n will ask you to create an initial owner account — use your real email. This is separate from the basic-auth gate; n8n has 2 layers.

---

## Phase 2 — Import workflows + credentials (15 min)

### 2.1 Re-create the 2 credentials

Left sidebar → **Credentials** → **Add Credential**:

**GHL Private Integration Token**
- Type: **HTTP Header Auth**
- Name: `GHL Private Integration Token`
- Header Name: `Authorization`
- Header Value: `Bearer pit-90ea9624-e782-47b0-b727-0c13382732c8`

**Notion TFS Integration**
- Type: **Notion API**
- Name: `Notion TFS Integration`
- API Key: `ntn_M2429973991b4YnRpZgrIWWLSEw2WZDnTRsD2WlcXt62cc`

### 2.2 Import the 3 workflows

For each of the 3 backup JSON files you saved in Phase 0:

1. Workflows → **Create Workflow** → blank canvas
2. Click empty canvas → **Cmd+V** (after copying the JSON contents)

Or use the ready-to-import files from the repo (they're already patched + inlined):

```bash
# on your local machine:
cat ~/termsforsale-site/tfs-build/n8n/ready-to-import/01_buyer_match_engine.json | pbcopy
```

Then paste into blank canvas. Repeat for 02_notion_bridge.json and 03_helper_increment.json.

### 2.3 Attach credentials to each node

Same drill as before:
- For every GHL HTTP node → select `GHL Private Integration Token`
- For every Notion node → select `Notion TFS Integration`

### 2.4 Publish each workflow

Top-right toggle → Active / Published. Do all 3.

### 2.5 Copy the new webhook URLs

- **Match Engine**: `https://n8n.termsforsale.com/webhook/new-deal-inventory`
- **Helper Increment**: `https://n8n.termsforsale.com/webhook/increment-deals`
- **Notion Bridge**: no public URL (scheduled cron)

---

## Phase 3 — Update downstream references (10 min)

### 3.1 Update GHL WF03 webhook URL

WF03 → Step 5 (the Custom Webhook action) → change URL from:
```
https://dealpros.app.n8n.cloud/webhook/increment-deals
```
to:
```
https://n8n.termsforsale.com/webhook/increment-deals
```

Save + re-publish WF03.

### 3.2 Update the Notion bridge's internal POST URL

On the Droplet (still SSH'd in — or via the n8n UI): the Notion bridge has a node **"POST to Match Engine"** that POSTs to `https://dealpros.app.n8n.cloud/webhook/new-deal-inventory`. Update it to `https://n8n.termsforsale.com/webhook/new-deal-inventory`.

In the n8n UI: open the Notion bridge workflow → click **"POST to Match Engine"** → change URL → save.

### 3.3 Update .env on your local machine

```bash
cd ~/termsforsale-site
sed -i '' 's|N8N_BASE_URL=.*|N8N_BASE_URL=https://n8n.termsforsale.com|' .env
```

### 3.4 Re-run the dry-run to verify

```bash
node scripts/dry-run-match-engine.js
```

Expected: `{"success":true,"matched_count":1}` (or however many active buyers match your test payload). Your test phone should get the SMS within ~1 min.

If it works — migration is complete.

---

## Phase 4 — Decommission n8n Cloud (2 min)

Once you've verified everything works on the self-hosted instance:

1. In n8n Cloud, **deactivate** (don't delete yet) all 3 workflows — toggle to Inactive
2. Wait 24 hours to make sure nothing's silently depending on the Cloud URLs
3. Log into your n8n Cloud billing portal
4. Cancel the subscription / let the trial expire

Don't delete the Cloud account for at least a week — safety buffer in case you need to roll back.

---

## Post-migration config — make it auto-start on reboot

The docker-compose service restarts automatically on Docker restart, but Docker itself needs to restart on boot:

```bash
systemctl enable docker
```

Already done in Phase 1 step 1.1, but double-check with `systemctl is-enabled docker` — should return `enabled`.

To verify n8n survives a reboot: `reboot`, wait 2 min, then try `https://n8n.termsforsale.com/`.

---

## Monitoring

The webhook-based workflows (Match Engine, Helper Increment) are stateless — if n8n goes down, incoming webhooks will 502 but no data is lost because n8n isn't the source of truth. GHL retries automatically.

The Notion bridge (cron-based) will just skip a tick if n8n is down — next 10-min run picks up any missed deals.

Add a health check to your watchdog cron (which already exists per `CLAUDE.md`):

```bash
# Add to /root/termsforsale-site/jobs/watchdog.js (or equivalent):
const N8N_URL = 'https://n8n.termsforsale.com/healthz';
const res = await fetch(N8N_URL);
if (!res.ok) await sendSmsToBrooke(`⚠️ n8n down on Paperclip Droplet`);
```

---

## Rollback (if needed)

If anything breaks in production and you need to revert to Cloud:

1. Re-activate all 3 workflows in n8n Cloud (they still exist, just inactive)
2. Change the 2 webhook URLs back in GHL WF03 + Notion bridge
3. Update `.env` `N8N_BASE_URL` back to `https://dealpros.app.n8n.cloud`

Full rollback: ~3 min.

---

## Ongoing cost

**$0 recurring** (Droplet is already paid for at $6/mo for Paperclip anyway). All n8n executions free on self-hosted.

Savings vs n8n Cloud Starter: **$20/mo = $240/year**.

---

## Questions / issues

If you hit any issue during migration, pause and ping me with:
- Which phase you're on
- Exact error message or screenshot
- Output of: `docker-compose logs n8n | tail -50` (if it's a Droplet issue)
