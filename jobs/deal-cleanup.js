#!/usr/bin/env node
/**
 * Deal Cleanup — Droplet cron job
 *
 * Runs weekly (Sundays 11pm Arizona time / Mondays 06:00 UTC).
 *
 * PURPOSE
 * -------
 * Once a deal closes (or is archived), we don't need the ephemeral engagement
 * tags (sent-/viewed-/alert-) cluttering every buyer contact anymore — but we
 * DO want a permanent record of who engaged with what. This job:
 *
 *   1. Scans Notion for deals where:
 *        Status = "Closed" OR "Archived"
 *        AND "Tags Cleaned" = false
 *   2. For each deal, finds every GHL contact that has any of:
 *        sent-[deal-id]   viewed-[deal-id]   alert-[deal-id]
 *   3. For each contact, appends an entry per tag they actually have to the
 *      `buyer_deal_history` custom field (comma-separated, deduped):
 *        PHX-001:sent:2026-04-01,PHX-001:viewed:2026-04-03,PHX-001:alerted:2026-04-03
 *   4. Removes the three tags from the contact.
 *   5. Marks the Notion deal page's "Tags Cleaned" checkbox = true.
 *      (Only if ALL contact updates for that deal succeeded.)
 *
 * ERROR HANDLING
 * --------------
 *   - If the initial Notion query fails: log and exit. Never process partial data.
 *   - If a single deal fails mid-processing: log and continue to the next deal.
 *   - If one contact update fails: log and continue to the next contact.
 *   - "Tags Cleaned" is ONLY set to true when every contact update succeeded
 *     for that deal.
 *
 * PM2 INSTALL (on the droplet)
 * ----------------------------
 *   # Assuming the repo is at /root/termsforsale-site (auto-pulled by deploy-hook):
 *   cd /root/termsforsale-site/jobs
 *   pm2 start deal-cleanup.js \
 *     --name deal-cleanup \
 *     --no-autorestart \
 *     --cron "0 6 * * 1"     # Mondays 06:00 UTC = Sunday 11pm AZ
 *   pm2 save
 *
 *   # (Optional) wire into ecosystem.config.js alongside the other jobs.
 *
 * DRY RUN / MANUAL TEST
 * ---------------------
 *   DRY_RUN=true node deal-cleanup.js     # logs everything, writes nothing
 *   node deal-cleanup.js                  # live run
 *
 * ENV VARS
 * --------
 *   GHL_API_KEY              — GHL private integration API key
 *   GHL_LOCATION_ID_TERMS    — Terms For Sale sub-account location ID
 *                              (falls back to GHL_LOCATION_ID)
 *   NOTION_API_KEY           — Notion integration secret
 *                              (falls back to NOTION_TOKEN for repo consistency)
 *   NOTION_DEALS_DB_ID       — Main deals database
 *                              (falls back to NOTION_DATABASE_ID, then NOTION_DB_ID)
 *   DRY_RUN                  — set to "true" to skip all writes (optional)
 *
 * COST: ~$0 per run (Notion free tier + GHL API included in subscription).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DEAL_ID_RE = /^[A-Z]+-[0-9]+$/;

const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const GHL_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
const NOTION_KEY = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const NOTION_DB_ID =
  process.env.NOTION_DEALS_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_ID;

// ─────────────────────────────────────────────────────────────
// Notion helpers
// ─────────────────────────────────────────────────────────────

async function notionFetch(path, method, body) {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${parsed.message || text.substring(0, 200)}`);
  }
  return parsed;
}

/**
 * Query the deals DB for pages where the deal is Closed/Archived AND the
 * "Tags Cleaned" checkbox is unchecked.
 *
 * Notion rejects any filter that references a property that doesn't exist,
 * so we introspect the DB schema first and only reference properties that
 * actually live on the database. This makes the job resilient to schema
 * differences across environments.
 */
async function queryClosedUnclenedDeals() {
  const closedValues = ['Closed', 'Archived'];

  // 1. Introspect the DB schema to find the real property names + types
  let statusPropName = null;
  let statusPropType = null; // 'status' or 'select'
  let hasTagsCleaned = false;

  try {
    const schema = await notionFetch(`/databases/${NOTION_DB_ID}`, 'GET');
    const props = schema.properties || {};
    for (const [name, def] of Object.entries(props)) {
      const lower = name.toLowerCase();
      // Prefer "Deal Status" over a plain "Status" — but accept either.
      if ((lower === 'deal status' || lower === 'status') &&
          (def.type === 'status' || def.type === 'select')) {
        if (!statusPropName || lower === 'deal status') {
          statusPropName = name;
          statusPropType = def.type;
        }
      }
      if (lower === 'tags cleaned' && def.type === 'checkbox') {
        hasTagsCleaned = true;
      }
    }
  } catch (err) {
    console.warn('[deal-cleanup] failed to introspect DB schema:', err.message);
  }

  console.log(`[deal-cleanup] schema: statusProp=${statusPropName ? `"${statusPropName}" (${statusPropType})` : 'MISSING'}, hasTagsCleaned=${hasTagsCleaned}`);

  if (!statusPropName) {
    console.warn('[deal-cleanup] no Status / Deal Status property on the database — cannot filter closed deals');
    return [];
  }
  if (!hasTagsCleaned) {
    console.warn('[deal-cleanup] no "Tags Cleaned" checkbox property on the database — add one so we can track which deals have been cleaned');
  }

  // 2. Build a filter that only references properties that exist
  const andClauses = [];

  const statusOr = closedValues.map((val) => ({
    property: statusPropName,
    [statusPropType]: { equals: val },
  }));
  andClauses.push(statusOr.length === 1 ? statusOr[0] : { or: statusOr });

  if (hasTagsCleaned) {
    andClauses.push({ property: 'Tags Cleaned', checkbox: { equals: false } });
  }

  const filter = andClauses.length === 1 ? andClauses[0] : { and: andClauses };

  // 3. Paginate results (no fallback needed — we built the filter from the schema)
  const all = [];
  let startCursor;
  do {
    const res = await notionFetch(`/databases/${NOTION_DB_ID}/query`, 'POST', {
      filter,
      page_size: 100,
      start_cursor: startCursor,
    });
    all.push(...(res.results || []));
    startCursor = res.has_more ? res.next_cursor : undefined;
  } while (startCursor);

  return all;
}

function readSelect(prop) {
  if (!prop) return '';
  if (prop.select && prop.select.name) return prop.select.name;
  if (prop.status && prop.status.name) return prop.status.name;
  return '';
}

function readCheckbox(prop) {
  if (!prop) return false;
  return !!prop.checkbox;
}

function readRichText(prop) {
  if (!prop) return '';
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map(t => t.plain_text).join('').trim();
  if (Array.isArray(prop.title)) return prop.title.map(t => t.plain_text).join('').trim();
  return '';
}

function extractDealId(page) {
  const p = page.properties || {};
  // Try the most common property names
  const candidates = ['Deal ID', 'Deal Id', 'Deal Code', 'deal_id', 'DealID'];
  for (const name of candidates) {
    const val = readRichText(p[name]);
    if (val) return val;
  }
  return '';
}

async function markDealCleaned(pageId) {
  if (DRY_RUN) {
    console.log(`[deal-cleanup] [DRY_RUN] would set Tags Cleaned=true on page ${pageId}`);
    return true;
  }
  try {
    await notionFetch(`/pages/${pageId}`, 'PATCH', {
      properties: { 'Tags Cleaned': { checkbox: true } },
    });
    return true;
  } catch (err) {
    console.error(`[deal-cleanup] failed to mark Tags Cleaned on page ${pageId}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GHL helpers
// ─────────────────────────────────────────────────────────────

async function ghlFetch(path, method, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GHL_KEY}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text }; }
  if (!res.ok) {
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${parsed.message || text.substring(0, 200)}`);
  }
  return parsed;
}

/**
 * Find all contacts that carry a given tag in the Terms For Sale sub-account.
 * Uses POST /contacts/search with a tags=contains filter. Paginates up to 500.
 */
async function searchContactsByTag(tag) {
  const all = [];
  let page = 1;
  const pageLimit = 100;

  while (all.length < 500) {
    let res;
    try {
      res = await ghlFetch('/contacts/search', 'POST', {
        locationId: GHL_LOCATION,
        page,
        pageLimit,
        filters: [{
          group: 'AND',
          filters: [{ field: 'tags', operator: 'contains', value: [tag] }],
        }],
      });
    } catch (err) {
      console.warn(`[deal-cleanup] search by tag=${tag} page=${page} failed:`, err.message);
      break;
    }
    const batch = res.contacts || res.data || [];
    all.push(...batch);
    const total = (res.meta && res.meta.total) || all.length;
    if (batch.length === 0 || all.length >= total) break;
    page++;
  }
  return all;
}

async function getContact(contactId) {
  try {
    const res = await ghlFetch(`/contacts/${contactId}`, 'GET');
    return res.contact || res || null;
  } catch (err) {
    console.warn(`[deal-cleanup] get-contact failed id=${contactId}:`, err.message);
    return null;
  }
}

/**
 * Read the current value of buyer_deal_history from a GHL contact.
 * The value lives on the customFields array. We accept several key shapes
 * (fieldKey, key, name) to stay tolerant of GHL's schema drift.
 */
function readBuyerDealHistory(contact) {
  const cfs = (contact && contact.customFields) || [];
  for (const f of cfs) {
    const k = (f.fieldKey || f.key || f.name || '').toString().toLowerCase();
    if (k === 'buyer_deal_history' || k === 'buyer deal history') {
      return String(f.value || f.field_value || '').trim();
    }
  }
  return '';
}

async function updateBuyerDealHistory(contactId, newValue) {
  if (DRY_RUN) {
    console.log(`[deal-cleanup] [DRY_RUN] would set buyer_deal_history on ${contactId} → ${newValue}`);
    return true;
  }
  try {
    await ghlFetch(`/contacts/${contactId}`, 'PUT', {
      customFields: [{ key: 'buyer_deal_history', field_value: newValue }],
    });
    return true;
  } catch (err) {
    console.error(`[deal-cleanup] update buyer_deal_history failed for ${contactId}:`, err.message);
    return false;
  }
}

async function removeTags(contactId, tags) {
  if (!tags || tags.length === 0) return true;
  if (DRY_RUN) {
    console.log(`[deal-cleanup] [DRY_RUN] would remove tags from ${contactId}:`, tags);
    return true;
  }
  try {
    await ghlFetch(`/contacts/${contactId}/tags`, 'DELETE', { tags });
    return true;
  } catch (err) {
    console.error(`[deal-cleanup] remove-tags failed for ${contactId}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Core cleanup logic
// ─────────────────────────────────────────────────────────────

/**
 * Merge a list of new "history entries" into an existing comma-separated
 * buyer_deal_history string, deduplicated.
 */
function mergeHistory(existing, additions) {
  const seen = new Set();
  const out = [];
  const push = (entry) => {
    const e = String(entry || '').trim();
    if (!e) return;
    if (seen.has(e)) return;
    seen.add(e);
    out.push(e);
  };
  if (existing) existing.split(',').forEach(push);
  additions.forEach(push);
  return out.join(',');
}

/**
 * Process one deal end-to-end.
 * Returns { contactsProcessed, allSucceeded }.
 */
async function processDeal(dealId, dealPageId) {
  const today = new Date().toISOString().split('T')[0];
  const sentTag   = `sent-${dealId}`;
  const viewedTag = `viewed-${dealId}`;
  const alertTag  = `alert-${dealId}`;

  console.log(`[deal-cleanup] ── processing ${dealId} (page ${dealPageId})`);

  // 1. Find contacts with any of the three tags and dedupe by id
  const contactMap = new Map(); // id → contact object
  for (const tag of [sentTag, viewedTag, alertTag]) {
    const found = await searchContactsByTag(tag);
    console.log(`[deal-cleanup] ${dealId}: found ${found.length} contact(s) with tag=${tag}`);
    for (const c of found) {
      if (c && c.id && !contactMap.has(c.id)) contactMap.set(c.id, c);
    }
  }

  if (contactMap.size === 0) {
    console.log(`[deal-cleanup] ${dealId}: no tagged contacts — safe to mark cleaned`);
    return { contactsProcessed: 0, allSucceeded: true };
  }

  // 2. For each contact: compute history delta, append, remove tags
  let processed = 0;
  let allSucceeded = true;

  for (const [contactId, listContact] of contactMap) {
    try {
      // The search result sometimes lacks customFields — fetch the full contact
      // so we can read buyer_deal_history accurately.
      const full = await getContact(contactId);
      if (!full) {
        allSucceeded = false;
        continue;
      }
      const tags = Array.isArray(full.tags) ? full.tags : (listContact.tags || []);
      const hasSent   = tags.indexOf(sentTag) !== -1;
      const hasViewed = tags.indexOf(viewedTag) !== -1;
      const hasAlert  = tags.indexOf(alertTag) !== -1;

      const additions = [];
      if (hasSent)   additions.push(`${dealId}:sent:${today}`);
      if (hasViewed) additions.push(`${dealId}:viewed:${today}`);
      if (hasAlert)  additions.push(`${dealId}:alerted:${today}`);

      if (additions.length === 0) {
        // Contact was in the search but no longer carries any of the 3 tags.
        // Nothing to record, nothing to remove.
        processed++;
        continue;
      }

      const existingHistory = readBuyerDealHistory(full);
      const merged = mergeHistory(existingHistory, additions);

      const historyOk = await updateBuyerDealHistory(contactId, merged);
      if (!historyOk) { allSucceeded = false; continue; }

      const tagsToRemove = [];
      if (hasSent)   tagsToRemove.push(sentTag);
      if (hasViewed) tagsToRemove.push(viewedTag);
      if (hasAlert)  tagsToRemove.push(alertTag);
      const tagsOk = await removeTags(contactId, tagsToRemove);
      if (!tagsOk) { allSucceeded = false; continue; }

      processed++;
      console.log(`[deal-cleanup] ${dealId}: contact ${contactId} updated (${additions.length} entries)`);
    } catch (err) {
      console.error(`[deal-cleanup] ${dealId}: contact ${contactId} failed:`, err.message);
      allSucceeded = false;
    }
  }

  console.log(`[deal-cleanup] ${dealId}: cleanup complete — ${processed}/${contactMap.size} contacts processed, allSucceeded=${allSucceeded}`);
  return { contactsProcessed: processed, allSucceeded };
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`[deal-cleanup] starting — DRY_RUN=${DRY_RUN}`);

  if (!GHL_KEY) { console.error('[deal-cleanup] GHL_API_KEY not set — aborting'); process.exit(1); }
  if (!GHL_LOCATION) { console.error('[deal-cleanup] GHL_LOCATION_ID_TERMS not set — aborting'); process.exit(1); }
  if (!NOTION_KEY) { console.error('[deal-cleanup] NOTION_API_KEY not set — aborting'); process.exit(1); }
  if (!NOTION_DB_ID) { console.error('[deal-cleanup] NOTION_DEALS_DB_ID not set — aborting'); process.exit(1); }

  let deals;
  try {
    deals = await queryClosedUnclenedDeals();
  } catch (err) {
    console.error('[deal-cleanup] Notion query failed — aborting without partial processing:', err.message);
    process.exit(1);
  }

  console.log(`[deal-cleanup] found ${deals.length} closed/archived uncleaned deal(s)`);

  let dealsCleaned = 0;
  let contactsUpdated = 0;
  let skippedNoDealId = 0;
  let skippedBadFormat = 0;

  for (const page of deals) {
    const dealId = extractDealId(page);
    if (!dealId) {
      skippedNoDealId++;
      continue;
    }
    if (!DEAL_ID_RE.test(dealId)) {
      skippedBadFormat++;
      if (skippedBadFormat <= 5) {
        console.warn(`[deal-cleanup] skipping page ${page.id} — Deal ID "${dealId}" does not match MKT-### format`);
      }
      continue;
    }

    try {
      const { contactsProcessed, allSucceeded } = await processDeal(dealId, page.id);
      contactsUpdated += contactsProcessed;

      if (allSucceeded) {
        const marked = await markDealCleaned(page.id);
        if (marked) {
          dealsCleaned++;
          console.log(`[deal-cleanup] ${dealId}: marked Tags Cleaned=true`);
        }
      } else {
        console.warn(`[deal-cleanup] ${dealId}: NOT marking Tags Cleaned — some contact updates failed`);
      }
    } catch (err) {
      console.error(`[deal-cleanup] deal ${dealId} failed, continuing:`, err.message);
    }
  }

  if (skippedNoDealId > 0) {
    console.log(`[deal-cleanup] skipped ${skippedNoDealId} deal(s) with no Deal ID field (legacy / pre-tag-system)`);
  }
  if (skippedBadFormat > 5) {
    console.log(`[deal-cleanup] skipped ${skippedBadFormat - 5} additional deal(s) with malformed Deal ID (suppressed)`);
  }
  console.log(`[deal-cleanup] complete — ${dealsCleaned} deal(s) cleaned, ${contactsUpdated} contact(s) updated`);
}

main().catch((err) => {
  console.error('[deal-cleanup] fatal error:', err.stack || err.message);
  process.exit(1);
});
