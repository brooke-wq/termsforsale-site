/**
 * Weekly Digest data gathering helper.
 *
 * Pulls from 4 sources:
 *   1. CLAUDE.md "Completed" sections from the last N days
 *   2. Git log (last N days, main branch only)
 *   3. Notion deals DB (closed/funded/active counts + new deals)
 *   4. GHL tag counts (alerts sent, buyer responses, new signups)
 *
 * Designed to be cheap: NO AI calls in this file. Pure data extraction.
 * (The weekly-digest.js function does ONE Claude Haiku call to write the
 * TL;DR — keeps total cost ≈ $0.001/run.)
 *
 * Used by: weekly-digest.js (Netlify function) and
 *          jobs/weekly-digest-cron.js (Droplet cron wrapper)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLAUDE_MD_PATH = path.join(REPO_ROOT, 'CLAUDE.md');

// Month name -> 0-indexed month number
const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11
};

// ─── 1. CLAUDE.md "Completed" section extractor ──────────────────

/**
 * Parse CLAUDE.md for ## Completed sections newer than `sinceDate`.
 * Header format examples we recognize:
 *   ## Completed — April 22 2026 Foo Bar
 *   ## Completed — April 22, 2026 (Foo Bar)
 * Returns an array of { date, dateISO, title, body } sorted newest first.
 */
function getRecentCompletedSections(sinceDate) {
  let text;
  try {
    text = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
  } catch (err) {
    console.warn('[digest] CLAUDE.md not readable:', err.message);
    return [];
  }

  // Match every "## Completed —" header line (em-dash or hyphen variants)
  const headerRe = /^##\s+Completed\s*[—\-–]+\s*([A-Za-z]+)\s+(\d{1,2})[,]?\s+(\d{4})\b\s*(.*)$/gm;
  const matches = [];
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    const monthName = m[1].toLowerCase().slice(0, 3);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const tail = (m[4] || '').trim();
    if (!(monthName in MONTHS)) continue;
    const d = new Date(Date.UTC(year, MONTHS[monthName], day));
    if (isNaN(d.getTime())) continue;
    matches.push({
      date: d,
      dateISO: d.toISOString().slice(0, 10),
      title: tail || 'Update',
      headerStart: m.index,
      headerEnd: m.index + m[0].length
    });
  }

  // Filter by sinceDate, then extract bodies
  const recent = matches
    .filter(s => s.date.getTime() >= sinceDate.getTime())
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  // Extract the body — text from end-of-header to start of next ## or ---
  return recent.map(s => {
    // Find next ## heading after this header
    const after = text.slice(s.headerEnd);
    const nextHeader = after.search(/^##\s|^---\s*$/m);
    const body = (nextHeader === -1 ? after : after.slice(0, nextHeader)).trim();
    return {
      dateISO: s.dateISO,
      title: s.title,
      body: body
    };
  });
}

// ─── 2. Git log (last N days) ────────────────────────────────────

/**
 * Returns { commits: [{hash, author, date, subject}], error?: string }
 * Best-effort: returns empty array if git isn't available or repo is
 * shallow (which is the case on Netlify build environment).
 */
function getRecentCommits(days) {
  try {
    const out = execSync(
      `git log --since="${days} days ago" --pretty=format:"%h|%an|%ai|%s" --no-merges`,
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    const lines = out.split('\n').filter(Boolean);
    const commits = lines.map(line => {
      const [hash, author, date, ...subjectParts] = line.split('|');
      return {
        hash: (hash || '').trim(),
        author: (author || '').trim(),
        date: (date || '').slice(0, 10),
        subject: subjectParts.join('|').trim()
      };
    });
    return { commits };
  } catch (err) {
    return { commits: [], error: err.message };
  }
}

// ─── 3. Notion deal stats (last N days) ──────────────────────────

async function notionQuery(token, dbId, body) {
  const res = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, body: data };
}

function prop(page, name) {
  const p = page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':       return (p.title || []).map(t => t.plain_text).join('');
    case 'rich_text':   return (p.rich_text || []).map(t => t.plain_text).join('');
    case 'number':      return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select':      return p.select ? p.select.name : '';
    case 'status':      return p.status ? p.status.name : '';
    case 'multi_select': return (p.multi_select || []).map(s => s.name).join(', ');
    case 'date':        return p.date ? p.date.start : '';
    default:            return '';
  }
}

async function getNotionDealStats(token, dbId, days) {
  if (!token || !dbId) {
    return { error: 'Notion credentials missing', stats: null };
  }

  const sinceISO = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Pull all deals (paginate)
  let all = [];
  let cursor;
  try {
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await notionQuery(token, dbId, body);
      if (r.status !== 200) {
        return { error: 'Notion ' + r.status, stats: null };
      }
      all = all.concat(r.body.results || []);
      cursor = r.body.has_more ? r.body.next_cursor : null;
      if (all.length >= 2000) break; // safety cap
    } while (cursor);
  } catch (err) {
    return { error: err.message, stats: null };
  }

  const stats = {
    totalDeals: all.length,
    activeMarketing: 0,
    closedThisWeek: [],
    fundedThisWeek: [],
    totalFundedThisWeek: 0,
    newDealsThisWeek: [],
    byStatus: {},
    byType: {}
  };

  for (const page of all) {
    const status = prop(page, 'Deal Status') || 'Unknown';
    const type = prop(page, 'Deal Type') || 'Unknown';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    if (status === 'Actively Marketing') {
      stats.activeMarketing += 1;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }

    const dateFunded = prop(page, 'Date Funded');
    const amountFunded = prop(page, 'Amount Funded');
    const dateAssigned = prop(page, 'Date Assigned');
    const startedMarketing = prop(page, 'Started Marketing');
    const street = prop(page, 'Street Address') || '';
    const city = prop(page, 'City') || '';
    const state = prop(page, 'State') || '';
    const loc = [street, city, state].filter(Boolean).join(', ');

    if (dateFunded && dateFunded >= sinceISO) {
      stats.fundedThisWeek.push({ loc, amount: amountFunded || 0, date: dateFunded });
      if (typeof amountFunded === 'number') stats.totalFundedThisWeek += amountFunded;
    }

    if (status === 'Closed' && dateFunded && dateFunded >= sinceISO) {
      stats.closedThisWeek.push({ loc, amount: amountFunded || 0, date: dateFunded });
    }

    if (startedMarketing && startedMarketing >= sinceISO) {
      stats.newDealsThisWeek.push({ loc, type, date: startedMarketing });
    }
  }

  return { stats };
}

// ─── 4. GHL engagement tag counts ────────────────────────────────

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

async function ghlTagCount(apiKey, locationId, tag) {
  if (!apiKey || !locationId) return 0;
  try {
    const res = await fetch(GHL_BASE + '/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': GHL_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        locationId,
        page: 1,
        pageLimit: 1,
        filters: [{
          group: 'AND',
          filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
        }]
      })
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const total = (data.meta && data.meta.total) || data.total;
    return typeof total === 'number' ? total : ((data.contacts || data.data || []).length);
  } catch (err) {
    return 0;
  }
}

/**
 * Returns running totals for engagement tags.
 * Note: GHL's free-tier search returns LIFETIME totals, not week-only,
 * so we report cumulative + flag it clearly. For week-over-week deltas
 * we'd need a snapshot table — out of scope for v1.
 */
async function getGhlEngagement(apiKey, locationId) {
  if (!apiKey || !locationId) {
    return { error: 'GHL credentials missing', engagement: null };
  }

  try {
    const [
      buyerSignups,
      vipSignups,
      newDealAlerts,
      activeViewers,
      buyerInterested,
      buyerPass,
      alertsPaused,
      buyersTotal
    ] = await Promise.all([
      ghlTagCount(apiKey, locationId, 'buyer-signup'),
      ghlTagCount(apiKey, locationId, 'VIP Buyer List'),
      ghlTagCount(apiKey, locationId, 'new-deal-alert'),
      ghlTagCount(apiKey, locationId, 'Active Viewer'),
      ghlTagCount(apiKey, locationId, 'buyer-interested'),
      ghlTagCount(apiKey, locationId, 'buyer-pass'),
      ghlTagCount(apiKey, locationId, 'alerts-paused'),
      ghlTagCount(apiKey, locationId, 'opt in')
    ]);

    return {
      engagement: {
        buyerSignups,
        vipSignups,
        newDealAlerts,
        activeViewers,
        buyerInterested,
        buyerPass,
        alertsPaused,
        buyersTotal,
        note: 'Counts are cumulative (lifetime). Week-over-week deltas require a snapshot table — coming in v2.'
      }
    };
  } catch (err) {
    return { error: err.message, engagement: null };
  }
}

// ─── 5. Composite gather function ────────────────────────────────

/**
 * One-shot gather of all 4 data sources.
 * Returns { window, completed, commits, notion, ghl, errors[] }
 */
async function gatherWeeklyData(opts) {
  opts = opts || {};
  const days = opts.days || 7;
  const since = new Date(Date.now() - days * 86400000);
  const errors = [];

  const completed = getRecentCompletedSections(since);
  const gitResult = getRecentCommits(days);
  if (gitResult.error) errors.push('git: ' + gitResult.error);

  const [notionResult, ghlResult] = await Promise.all([
    getNotionDealStats(
      opts.notionToken || process.env.NOTION_TOKEN,
      opts.notionDbId || process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29',
      days
    ),
    getGhlEngagement(
      opts.ghlApiKey || process.env.GHL_API_KEY,
      opts.ghlLocationId || process.env.GHL_LOCATION_ID || '7IyUgu1zpi38MDYpSDTs'
    )
  ]);
  if (notionResult.error) errors.push('notion: ' + notionResult.error);
  if (ghlResult.error) errors.push('ghl: ' + ghlResult.error);

  // Format week range string for display
  const end = new Date();
  const fmt = (d) => d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Phoenix'
  });
  const window = {
    days,
    since: since.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: fmt(since) + ' – ' + fmt(end)
  };

  return {
    window,
    completed,
    commits: gitResult.commits,
    notion: notionResult.stats,
    ghl: ghlResult.engagement,
    errors
  };
}

module.exports = {
  gatherWeeklyData,
  getRecentCompletedSections,
  getRecentCommits,
  getNotionDealStats,
  getGhlEngagement
};
