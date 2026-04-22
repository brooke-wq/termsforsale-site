# Terms For Sale / Deal Pros — Weekly Production Health Audit

**Cadence:** Every Monday, 8:00 AM MST. ~5–10 minutes of SSH paste-and-inspect.
**Goal:** Catch duplicate schedulers, drift, zombie processes, and runaway rates BEFORE they become incidents.
**How to run:** SSH into the droplet. Paste each section. Paste the output into a Claude Cowork session and say *"audit my prod"*. I'll mark green / yellow / red and flag action items.

---

## Section 1 — Scheduler sanity (the #1 risk, per 2026-04-22 incident)

```bash
echo "=== USER CRONTAB ==="
crontab -l
echo ""
echo "=== /etc/cron.d/ DROP-INS ==="
ls -la /etc/cron.d/ 2>/dev/null
echo ""
echo "=== SYSTEM CRONTAB ==="
cat /etc/crontab 2>/dev/null
echo ""
echo "=== PM2 LIST ==="
pm2 list
echo ""
echo "=== DUPLICATE DETECTOR — any job name appearing 2+ times? ==="
{ crontab -l 2>/dev/null; cat /etc/crontab 2>/dev/null; ls /etc/cron.d/ 2>/dev/null | xargs -I {} cat /etc/cron.d/{} 2>/dev/null; } \
  | grep -oE "run-job\.js [a-z\-]+" | sort | uniq -c | sort -rn | awk '$1 > 1 {print}'
echo "--- any line above = DUPLICATE SCHEDULER BUG (re-read 2026-04-22 post-mortem) ---"
```

**Healthy:** each `run-job.js <name>` appears once in crontab. PM2 shows only daemons that should be online (deploy-hook, pdf-render-service, parsed-prefs-nightly, etc.). No PM2 `stopped` entries for pollers that have corresponding crontab lines (that's the incident pattern).

**Red flag:** any job name in the duplicate detector. Any `.DISABLED` file referenced in crontab. Any cron entry with a path that doesn't exist on disk.

---

## Section 2 — Single-canonical-sender rule

```bash
cd /root/termsforsale-site

echo "=== FILES THAT POST TO GHL /conversations/messages ==="
grep -rIn -E "/conversations/messages" termsforsale/netlify/functions/ 2>/dev/null \
  | grep -v node_modules \
  | grep -v ".DISABLED" \
  | awk -F: '{print $1}' | sort -u

echo ""
echo "=== BUYER-BROADCAST PATTERNS (should be 0 or 1 file) ==="
grep -rIl -E "New .*deal in|matchedBuyers|eligibleBuyers" termsforsale/netlify/functions/ 2>/dev/null \
  | grep -v node_modules | grep -v ".DISABLED"
```

**Healthy:** the "canonical" sender file (to be written: `buyer-deal-alerts.js`) + internal-only senders (`watchdog.js`, `booking-notify.js`, magic-link senders). These internal senders target Brooke's own phone, not buyers.

**Red flag:** two or more files that match `"New .*deal in"` — that's two competing buyer-broadcast senders (the 2026-04-22 incident pattern).

---

## Section 3 — Env key drift

```bash
echo "=== DROPLET GHL_API_KEY health ==="
source /etc/environment
curl -sS -o /dev/null -w "GHL droplet key -> HTTP %{http_code}\n" \
  -H "Authorization: Bearer $GHL_API_KEY" \
  -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/locations/7IyUgu1zpi38MDYpSDTs"
echo ""
echo "=== all env vars defined ==="
grep -oE '^[A-Z_]+=' /etc/environment | sort -u | head -30
echo "=== kill-switch flag state ==="
grep -E '^(NOTIFY_KILLSWITCH|HYBRID_ROUTER_LIVE|MARKETING_KILLSWITCH)' /etc/environment || echo "(no kill-switches set \u2014 senders live)"
```

**Healthy:** HTTP 200 on GHL call. `NOTIFY_KILLSWITCH` either absent (sender live) or `=1` (sender killed by Brooke). Never any other value.

**Red flag:** 401 response (key invalid — someone rotated GHL without updating droplet). Unexpected env var you don't recognize.

---

## Section 4 — Orphan & zombie processes

```bash
echo "=== Node processes running > 30 min ==="
ps -eo pid,etimes,user,cmd | awk 'NR==1 || $2 > 1800' | grep -E "node|Node"

echo ""
echo "=== any process has .DISABLED file loaded in memory? ==="
for pid in $(pgrep node); do
  if sudo grep -q "DISABLED" /proc/$pid/maps 2>/dev/null; then
    echo ">>> PID $pid has a .DISABLED file in memory:"
    ps -p $pid -o pid,etime,user,cmd
  fi
done
echo "=== (any PIDs listed above are bugs — kill them) ==="
```

**Healthy:** only deploy-hook, pdf-render-service, parsed-prefs-nightly, n8n, maybe backfill-parsed-prefs. Zero `.DISABLED`-in-memory hits.

**Red flag:** a Node process running > 30 min that isn't one of the known-good daemons. A Node process with a `.DISABLED` file in memory = someone is manually re-running a deprecated sender.

---

## Section 5 — Rate signals

```bash
echo "=== Total SMS/email events in paperclip.log last 24h ==="
grep -cE "SMS sent|Email sent|conversations/messages" /var/log/paperclip.log || echo "0"

echo ""
echo "=== per-job send counts last 500 log lines ==="
tail -500 /var/log/paperclip.log \
  | grep -E "SMS sent|Email sent" \
  | awk '{match($0, /\[([a-z\-]+)\]/, m); print m[1]}' \
  | sort | uniq -c | sort -rn | head -10
```

**Healthy:** daily volume ~matches your deal-alert cadence × buyer count. Only the canonical sender prefix appears.

**Red flag:** any log prefix you don't recognize. Daily count >> expected. Unexpected spike.

---

## Section 6 — Workflow state (GHL + n8n) — manual check

- **GHL:** https://app.gohighlevel.com → Automation → Workflows. Filter by "Published". Investigate anything not on the expected allow-list.
- **n8n:** https://n8n.termsforsale.com → project `fXsgUG742tPcu41s` → Workflows. Investigate any Active workflow not on the allow-list.

---

## Section 7 — Git drift

```bash
cd /root/termsforsale-site
echo "=== local HEAD ==="
git rev-parse HEAD
git log --oneline -5
echo ""
echo "=== vs origin/main ==="
git fetch origin main --quiet
git log --oneline origin/main -5
echo ""
echo "=== diff summary ==="
git status -sb
```

**Healthy:** droplet HEAD == origin/main HEAD. Only expected local changes (e.g., `jobs/sent-log.json` growth).

**Red flag:** local ahead of origin (uncommitted production changes). Origin ahead of local (droplet out of sync with deploys).

---

## How to use the output

1. Open a Cowork session.
2. Paste output of all 7 sections.
3. Type: *"audit my prod"*.
4. I'll respond with a color-coded summary and specific action items.

## Emergency stop procedure

```bash
# 1. Kill all scheduler triggers
crontab -r                                          # nuke user cron
pm2 stop all                                        # stop every PM2 daemon
# 2. Rotate GHL key in GHL UI to hard-fail any invoker
# 3. Kill running Node processes
pkill -9 -f "run-job.js"
pkill -9 -f "notify-buyers\|deal-follow-up"
# 4. Verify silence
tail -f /var/log/paperclip.log  # Ctrl-C after 2 min of no new lines
```

Restore PM2 + crontab after root cause is fixed and canonical sender is verified clean.
