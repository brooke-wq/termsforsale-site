# Acquisitions repo migration — handoff package

**Status:** Migration prepared. Ready to push.
**Generated:** 2026-04-28
**Source:** `brooke-wq/termsforsale-site` branch `claude/setup-acquisition-system-YUtAb`,
HEAD `f4ade39`. Two commits extracted, paths rewritten to repo root, branch
renamed to `main`.

## Files in this package

- **`acquisitions.bundle`** (82 KB) — git bundle with full 2-commit history.
  Use this if you want the original commit messages + author attribution
  preserved in the new repo.
- **`acquisitions-source.tar.gz`** (62 KB) — file-only tarball, no git history.
  Use this for a cleaner "v1 starting point" with one fresh initial commit.

## Pre-step: create the empty repo on GitHub (~1 min)

1. Go to https://github.com/new
2. Owner: `brooke-wq`. Name: `acquisitions`. Visibility: **Private**.
3. Do NOT check "Initialize with README/license/.gitignore" — leave it empty.
4. Click **Create repository**.

## Path A — push the bundle (preserves history) — RECOMMENDED

From your laptop (or anywhere with `git` + GitHub auth):

```bash
# 1. Get the bundle file from the droplet/Claude session.
#    If running this on the droplet:  cp /tmp/acquisitions-handoff/acquisitions.bundle ~/
#    Or scp it:                       scp root@<droplet>:/tmp/acquisitions-handoff/acquisitions.bundle ./

# 2. Clone from the bundle into a working directory
git clone acquisitions.bundle acquisitions
cd acquisitions

# 3. Point origin at the new GitHub repo
git remote set-url origin https://github.com/brooke-wq/acquisitions.git

# 4. Push main
git push -u origin main
```

Done. Verify at https://github.com/brooke-wq/acquisitions — should see 2
commits, README.md at root, all 49 tracked files.

## Path B — fresh start from the tarball (one clean initial commit)

```bash
# 1. Create empty local clone of the new (empty) GitHub repo
git clone https://github.com/brooke-wq/acquisitions.git
cd acquisitions

# 2. Extract the source files into it
tar -xzf ../acquisitions-source.tar.gz
ls   # should see README.md, db/, docker-compose.yml, etc.

# 3. Initial commit
git add .
git commit -m "feat: initial commercial-stack-engine v1 scaffolding

Migrated from termsforsale-site/commercial-stack-engine on
branch claude/setup-acquisition-system-YUtAb. See README.md for
architecture, docs/SETUP.md for deploy walkthrough."

git push -u origin main
```

## After the push: clean up termsforsale-site (~2 min)

The `commercial-stack-engine/` directory is still on the
`claude/setup-acquisition-system-YUtAb` branch. Remove it so PR #160
becomes a clean delete:

```bash
cd ~/termsforsale-site   # your local clone
git fetch
git checkout claude/setup-acquisition-system-YUtAb
git pull
git rm -rf commercial-stack-engine/
git commit -m "chore: extract commercial-stack-engine to standalone acquisitions repo

Moved to https://github.com/brooke-wq/acquisitions — see that repo for
the active codebase. This commit removes the directory from
termsforsale-site to avoid duplicate maintenance."
git push origin claude/setup-acquisition-system-YUtAb
```

Then on GitHub: **close PR #160 without merging**. Add a comment:

> Migrated to https://github.com/brooke-wq/acquisitions. Closing this PR
> in favor of the standalone repo. The cleanup commit above removes the
> directory from this branch.

## After the migration: grant Claude Code access to the new repo

So future Claude sessions can read/write to `acquisitions`:

1. https://github.com/brooke-wq/acquisitions/settings/access
2. Add Claude Code as a collaborator (same as you did for termsforsale-site)
3. Update Claude Code repo allowlist to include `brooke-wq/acquisitions`

## Verification checklist

After pushing, the new repo should have:

- [ ] 49 files tracked at root (`.env.example`, `README.md`, `docker-compose.yml`, `db/`, `docs/`, `n8n-workflows/`, `prompts/`, `scraper-service/`, `tests/`)
- [ ] `README.md` at the very top of the repo (not under a subdirectory)
- [ ] If Path A: 2 commits with original messages
- [ ] If Path B: 1 clean initial commit
- [ ] No `commercial-stack-engine/` subdirectory anywhere
- [ ] `docker-compose config > /dev/null` validates without error (if Docker installed locally)

If any of those are off, ping me with the actual state and I'll fix it.
