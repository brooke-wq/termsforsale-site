# Repo migration: termsforsale-site/commercial-stack-engine → standalone `acquisitions` repo

The Commercial Stack Engine should live in its own repo
(`brooke-wq/acquisitions`) for operational hygiene. This guide walks
through the migration. **Estimated time: 15 minutes.**

---

## Why migrate

- Different infrastructure: Postgres + Docker + n8n + paid scraping
  proxy, vs `termsforsale-site` which is pure Netlify Functions
- CI churn: every PR to `termsforsale-site` runs 6 Netlify checks for
  files that don't affect either site
- Access control: easier to grant collaborators access to one without
  the other
- Different docs audience: ops/infra engineer vs marketing site team

---

## Pre-migration state

Currently:
- Branch: `claude/setup-acquisition-system-YUtAb`
- PR: `brooke-wq/termsforsale-site#160` (open, not merged)
- Files: `commercial-stack-engine/**` (48 files, 1 commit, 4806 insertions)

---

## Migration steps

### Step 1 — Create the new repo (Brooke, in GitHub UI, ~2 min)

1. https://github.com/new
2. Owner: `brooke-wq`
3. Repository name: `acquisitions`
4. Description: `Commercial Real Estate Acquisition Engine — sourcing, enrichment, Stack Method scoring, GHL routing`
5. Visibility: **Private** (contains scraping logic + API keys reference)
6. Do NOT initialize with README/license/.gitignore — we'll seed from
   the existing files
7. Click **Create repository**
8. Grant Claude Code access to this repo (Settings → Collaborators)

### Step 2 — Extract the directory + history (one-time, on your laptop or droplet, ~5 min)

```bash
# Clone the source repo if you don't already have it locally
cd ~
git clone https://github.com/brooke-wq/termsforsale-site.git
cd termsforsale-site
git checkout claude/setup-acquisition-system-YUtAb

# Use git filter-repo to extract just commercial-stack-engine/ with history.
# (filter-repo is faster + safer than the deprecated `git filter-branch`.)
# Install if needed:  brew install git-filter-repo  (or pip install git-filter-repo)

# Make a working copy for the extraction
cd ~
cp -R termsforsale-site termsforsale-site-extract
cd termsforsale-site-extract

# Extract only commercial-stack-engine/ and rewrite paths to repo root
git filter-repo \
  --path commercial-stack-engine \
  --path-rename commercial-stack-engine/:

# Now this directory contains ONLY commercial-stack-engine files at root,
# with the full commit history preserved.
ls -la   # should see README.md, db/, docker-compose.yml, etc. at root

# Push to the new acquisitions repo
git remote add origin https://github.com/brooke-wq/acquisitions.git
git branch -M main
git push -u origin main
```

### Step 3 — Clean up termsforsale-site (~3 min)

After confirming the new repo has all 48 files + the commit:

```bash
cd ~/termsforsale-site
git checkout claude/setup-acquisition-system-YUtAb
git rm -rf commercial-stack-engine/
git commit -m "chore: extract commercial-stack-engine to standalone acquisitions repo

Moved to https://github.com/brooke-wq/acquisitions — see that repo
for the active codebase. This commit removes the directory from
termsforsale-site to avoid confusion."
git push origin claude/setup-acquisition-system-YUtAb
```

PR #160 will update with the deletion. **Close PR #160 without
merging** with a comment pointing at the new repo:

> Migrated to `brooke-wq/acquisitions` — see that repo for ongoing
> work. Closing this PR; the directory has been deleted from this
> branch in the cleanup commit above.

### Step 4 — Update Claude's repo allowlist

In your Claude Code settings (or `.claude/settings.json`), add
`brooke-wq/acquisitions` to the GitHub MCP allowed repos so future
Claude sessions can read/write to it.

### Step 5 — Verify

```bash
# Clone the new repo fresh and verify it works standalone
cd /tmp
git clone https://github.com/brooke-wq/acquisitions.git
cd acquisitions
ls   # should see all the files at root
# Optional: docker-compose config dry-run
docker-compose config > /dev/null && echo "compose file valid"
```

---

## Alternative: simpler "fresh start" migration

If `git filter-repo` is overkill (only 1 commit so far, no important
history), this also works:

```bash
# 1. Create the new repo (step 1 above)

# 2. Copy files into a fresh checkout
cd /tmp
git clone https://github.com/brooke-wq/acquisitions.git
cd acquisitions
cp -R ~/termsforsale-site/commercial-stack-engine/. .
git add .
git commit -m "feat: initial commercial-stack-engine v1 scaffolding

Migrated from termsforsale-site/commercial-stack-engine on
branch claude/setup-acquisition-system-YUtAb. See README.md for
architecture, SETUP.md for deploy walkthrough."
git push -u origin main

# 3. Then do step 3 (cleanup) above
```

This loses the original commit message but is simpler. Either approach works.

---

## After migration: redirect SETUP.md path

`docs/SETUP.md` step 4 references:
```
git clone https://github.com/brooke-wq/termsforsale-site.git
cd termsforsale-site/commercial-stack-engine
```

After migration, update that step to:
```
git clone https://github.com/brooke-wq/acquisitions.git
cd acquisitions
```

I'll do this in the first PR to the new repo.

---

## Things that DON'T change after migration

- `.env` values (still uses droplet `/etc/environment` or
  `acquisitions/.env`)
- Database (still Postgres in docker-compose, schema unchanged)
- n8n workflows (import the same JSON files from the new repo)
- Stack Method prompt (unchanged)
- GHL pipeline + tag scheme (unchanged)
