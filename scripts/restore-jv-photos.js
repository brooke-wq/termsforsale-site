// scripts/restore-jv-photos.js
//
// Companion to scripts/fix-photos-bug.js. After we moved bogus GitHub URLs
// out of the `Photos` Notion property and into `Cover photo`, the JV partner's
// original Google Drive folder URL was lost from `Photos` (it had been
// overwritten by the buggy n8n workflow).
//
// The original Drive folder URL is still on the corresponding GHL contact's
// `link_to_photos` custom field (set when the JV partner submitted the deal
// via Dispo Buddy). This script walks every Notion deal where:
//   - `Photos` is empty
//   - `JV Partner Contact ID` is set
// fetches the GHL contact, reads `link_to_photos`, and patches the URL back
// into Notion's `Photos` property.
//
// Idempotent: safe to re-run. Skips deals that already have Photos populated.
//
// Usage on Mac or paperclip:
//   GHL_API_KEY=... NOTION_TOKEN=... DRY_RUN=1 node scripts/restore-jv-photos.js
//   GHL_API_KEY=... NOTION_TOKEN=... node scripts/restore-jv-photos.js
//
// On paperclip both env vars are already in /etc/environment, so:
//   set -a; . /etc/environment; set +a
//   DRY_RUN=1 node scripts/restore-jv-photos.js

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_DB_ID = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GHL_API_KEY = process.env.GHL_API_KEY;

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const LIMIT_DEAL_IDS = (process.env.DEAL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!NOTION_TOKEN) { console.error('ERROR: NOTION_TOKEN not set'); process.exit(1); }
if (!GHL_API_KEY)  { console.error('ERROR: GHL_API_KEY not set');  process.exit(1); }

function notionHeaders() {
  return {
    'Authorization': 'Bearer ' + NOTION_TOKEN,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

function ghlHeaders() {
  return {
    'Authorization': 'Bearer ' + GHL_API_KEY,
    'Version': '2021-07-28',
    'Content-Type': 'application/json'
  };
}

function urlPropValue(page, name) {
  const p = (page.properties || {})[name];
  if (p && p.type === 'url') return p.url || null;
  return null;
}

function richTextValue(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  if (p.type === 'rich_text') return (p.rich_text || []).map(r => r.plain_text).join('') || null;
  if (p.type === 'title')     return (p.title || []).map(r => r.plain_text).join('') || null;
  return null;
}

function dealLabel(page) {
  const dealId = richTextValue(page, 'Deal ID') || '';
  const title = (Object.values(page.properties || {}).find(p => p && p.type === 'title')) || {};
  const titleStr = (title.title || []).map(r => r.plain_text).join('') || '';
  return (dealId ? dealId + ' — ' : '') + (titleStr || page.id.slice(0, 8));
}

async function* iterAllPages() {
  let cursor = null;
  let count = 0;
  while (true) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(NOTION_BASE + '/databases/' + NOTION_DB_ID + '/query', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Notion query failed: ' + res.status + ' ' + t.slice(0, 200));
    }
    const data = await res.json();
    for (const page of data.results || []) { count++; yield page; }
    if (!data.has_more) { console.log('[scan] paginated through ' + count + ' deals'); return; }
    cursor = data.next_cursor;
  }
}

// In-memory cache so we only fetch each unique GHL contact once
const ghlContactCache = new Map();

async function fetchGhlContactLinkToPhotos(contactId) {
  if (ghlContactCache.has(contactId)) return ghlContactCache.get(contactId);
  const res = await fetch('https://services.leadconnectorhq.com/contacts/' + contactId, {
    headers: ghlHeaders()
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    ghlContactCache.set(contactId, null);
    throw new Error('GHL contact fetch failed ' + res.status + ': ' + t.slice(0, 200));
  }
  const data = await res.json();
  const customFields = (data && data.contact && data.contact.customFields) || [];
  // The `link_to_photos` field maps to a specific Custom Field id in this GHL location.
  // We look it up by field key (preferred) and fall back to common aliases.
  const candidateKeys = ['link_to_photos', 'photos_link', 'photos_url', 'photos', 'drive_photos_link'];
  let url = null;
  for (const cf of customFields) {
    const key = (cf.key || cf.fieldKey || '').toLowerCase();
    const val = cf.value || cf.fieldValue;
    if (typeof val !== 'string' || !val.startsWith('http')) continue;
    if (candidateKeys.includes(key)) { url = val; break; }
  }
  // Secondary: scan ALL custom fields for any Drive folder URL — heuristic fallback
  // only used when no field with a recognized key is found.
  if (!url) {
    for (const cf of customFields) {
      const val = cf.value || cf.fieldValue;
      if (typeof val !== 'string') continue;
      if (/drive\.google\.com\/(drive\/folders|file\/d)/i.test(val)) {
        url = val; break;
      }
    }
  }
  ghlContactCache.set(contactId, url);
  return url;
}

async function patchPage(pageId, properties) {
  const res = await fetch(NOTION_BASE + '/pages/' + pageId, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({ properties })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Notion PATCH failed ' + res.status + ': ' + t.slice(0, 200));
  }
  return res.json();
}

async function main() {
  console.log('=== JV Photos Restore ===');
  console.log('Mode: ' + (DRY_RUN ? 'DRY_RUN (no writes)' : 'LIVE (will patch Notion)'));
  if (LIMIT_DEAL_IDS.length) console.log('Filter: only deal IDs = ' + LIMIT_DEAL_IDS.join(','));
  console.log('');

  const stats = {
    scanned: 0,
    candidates: 0,        // Photos empty AND JV Partner Contact ID set
    restored: 0,          // successfully patched URL back into Photos
    noContact: 0,         // contact id missing
    noLink: 0,            // GHL contact has no link_to_photos
    errors: 0,
    skipped: 0
  };

  for await (const page of iterAllPages()) {
    stats.scanned++;
    const dealId = richTextValue(page, 'Deal ID') || '';
    if (LIMIT_DEAL_IDS.length && !LIMIT_DEAL_IDS.includes(dealId)) { stats.skipped++; continue; }

    const photos = urlPropValue(page, 'Photos');
    if (photos) { continue; } // Photos already populated, leave alone

    const contactId = richTextValue(page, 'JV Partner Contact ID');
    if (!contactId) {
      stats.noContact++;
      continue;
    }

    stats.candidates++;
    const label = dealLabel(page);

    let driveUrl = null;
    try {
      driveUrl = await fetchGhlContactLinkToPhotos(contactId);
    } catch (e) {
      console.error('[ERROR]   ' + label + ' — GHL fetch failed: ' + e.message);
      stats.errors++;
      continue;
    }

    if (!driveUrl) {
      console.log('[NO LINK] ' + label + ' (GHL contact has no link_to_photos)');
      stats.noLink++;
      continue;
    }

    console.log('[RESTORE] ' + label);
    console.log('          Photos <- ' + driveUrl);

    if (!DRY_RUN) {
      try {
        await patchPage(page.id, { 'Photos': { url: driveUrl } });
        stats.restored++;
      } catch (e) {
        console.error('  ERROR: ' + e.message);
        stats.errors++;
      }
    } else {
      stats.restored++;
    }

    // Rate limit: ~3 patches/sec to stay under Notion's API limits
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 350));
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('Total deals scanned:        ' + stats.scanned);
  console.log('Photos empty + JV ID:       ' + stats.candidates);
  console.log('Restored:                   ' + stats.restored);
  console.log('No JV contact (skipped):    ' + stats.noContact);
  console.log('GHL had no link_to_photos:  ' + stats.noLink);
  console.log('Errors:                     ' + stats.errors);
  if (DRY_RUN) {
    console.log('');
    console.log('DRY_RUN — no changes written. Re-run without DRY_RUN=1 to apply.');
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
