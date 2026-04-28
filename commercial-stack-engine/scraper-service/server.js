'use strict';

require('dotenv').config();

const express = require('express');
const { pool, withClient } = require('./lib/db');
const { runScraper, listScrapers } = require('./lib/runner');
const log = require('./lib/log');

const app = express();
app.use(express.json({ limit: '4mb' }));

// ---------- Auth middleware ----------
function requireAuth(req, res, next) {
  const token = req.get('X-Auth-Token');
  if (!process.env.SCRAPER_AUTH_TOKEN) {
    return res.status(500).json({ error: 'SCRAPER_AUTH_TOKEN not configured' });
  }
  if (token !== process.env.SCRAPER_AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ---------- /health (open) ----------
app.get('/health', async (_req, res) => {
  const out = {
    ok: true,
    service: 'cse-scraper-service',
    uptime: Math.floor(process.uptime()),
    scrapers: listScrapers(),
    proxyConfigured: Boolean(process.env.WEBSHARE_API_KEY),
    authTokenConfigured: Boolean(process.env.SCRAPER_AUTH_TOKEN),
    db: 'unknown'
  };
  try {
    await withClient(async (c) => {
      const r = await c.query('SELECT 1 AS ok');
      out.db = r.rows[0].ok === 1 ? 'ok' : 'unknown';
    });
  } catch (e) {
    out.db = 'error';
    out.dbError = e.message;
    out.ok = false;
  }
  res.status(out.ok ? 200 : 503).json(out);
});

// ---------- POST /scrape/run (auth) ----------
// Body: { source: 'crexi'|'loopnet'|..., dryRun?: bool, maxListings?: number, filters?: {...} }
app.post('/scrape/run', requireAuth, async (req, res) => {
  const { source, dryRun, maxListings, filters } = req.body || {};
  if (!source) return res.status(400).json({ error: 'source required' });
  try {
    const result = await runScraper(source, {
      dryRun: Boolean(dryRun),
      maxListings: Number(maxListings) || undefined,
      filters: filters || {}
    });
    res.json({ ok: true, source, ...result });
  } catch (e) {
    log.error('scrape/run failed', { source, error: e.message, stack: e.stack });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /listings/recent (auth) ----------
// Query: ?source=&assetClass=&limit=50&hours=24
app.get('/listings/recent', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
  const source = req.query.source || null;
  const assetClass = req.query.assetClass || null;

  try {
    const sql = `
      SELECT id, source, source_url, asset_class, state, county, city, zip,
             address, listing_price, units, year_built, scraped_at, last_seen_at, is_active
      FROM listings
      WHERE scraped_at >= NOW() - ($1 || ' hours')::INTERVAL
        AND ($2::TEXT IS NULL OR source = $2)
        AND ($3::TEXT IS NULL OR asset_class = $3)
      ORDER BY scraped_at DESC
      LIMIT $4
    `;
    const r = await pool.query(sql, [String(hours), source, assetClass, limit]);
    res.json({ ok: true, count: r.rowCount, listings: r.rows });
  } catch (e) {
    log.error('listings/recent failed', { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GET /listings/:id (auth) ----------
app.get('/listings/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const r = await pool.query('SELECT * FROM listings WHERE id=$1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, listing: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- 404 ----------
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// ---------- Boot ----------
const port = Number(process.env.PORT) || 3100;
app.listen(port, '0.0.0.0', () => {
  log.info(`scraper-service listening on :${port}`, {
    proxyConfigured: Boolean(process.env.WEBSHARE_API_KEY),
    scrapers: listScrapers()
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log.info('SIGTERM received, draining…');
  await pool.end().catch(() => {});
  process.exit(0);
});
