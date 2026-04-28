// scripts/fix-photos-bug.js
//
// One-shot cleanup for deals where the n8n "Deal Auto-Enrichment (Path 3)"
// workflow's "Assemble Deal Dict" node was writing the Street View GitHub URL
// to the `Photos` Notion property instead of `Cover photo`. (Bug fixed on
// 2026-04-28; this script repairs deals processed before the fix.)
//
// For each affected deal:
//   - If `Cover photo` is empty:
//       move the GitHub URL from Photos -> Cover photo, clear Photos
//   - If `Cover photo` is already populated:
//       just clear Photos (Cover photo already has the right URL)
//
// Original JV-partner Drive folder URLs that got overwritten are NOT
// recoverable from this script — they'd need to be restored from the
// JV partner's original submission (GHL contact custom field
// `link_to_photos` or the Dispo Buddy submission record).
//
// Usage on paperclip:
//   cd /root/termsforsale-site
//   git pull origin main
//   DRY_RUN=1 node scripts/fix-photos-bug.js   # preview
//   node scripts/fix-photos-bug.js             # apply

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_DB_ID = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN not set in environment.');
  process.exit(1);
}

function notionHeaders() {
  return {
    'Authorization': 'Bearer ' + NOTION_TOKEN,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

function urlPropValue(page, name) {
  const p = (page.properties || {})[name];
  if (!p) return null;
  if (p.type === 'url') return p.url || null;
  return null;
}

function titleOrAddress(page) {
  // Best-effort label for logging
  const props = page.properties || {};
  const titleProp = Object.values(props).find(p => p && p.type === 'title');
  const titleStr = titleProp && (titleProp.title || []).map(r => r.plain_text).join('') || '';
  const dealId = (() => {
    const p = props['Deal ID'];
    if (!p) return '';
    if (p.type === 'rich_text') return (p.rich_text || []).map(r => r.plain_text).join('');
    if (p.type === 'title') return (p.title || []).map(r => r.plain_text).join('');
    return '';
  })();
  return (dealId ? dealId + ' — ' : '') + (titleStr || page.id.slice(0, 8));
}

function isGithubStreetViewUrl(s) {
  if (!s || typeof s !== 'string') return false;
  return /raw\.githubusercontent\.com\/.+\/street-view\//i.test(s);
}

async function* iterAllPages() {
  let cursor = null;
  let pageCount = 0;
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
    for (const page of data.results || []) {
      pageCount++;
      yield page;
    }
    if (!data.has_more) {
      console.log('[scan] paginated through ' + pageCount + ' pages.');
      return;
    }
    cursor = data.next_cursor;
  }
}

async function patchPage(pageId, properties) {
  const res = await fetch(NOTION_BASE + '/pages/' + pageId, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({ properties })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('PATCH failed ' + res.status + ': ' + t.slice(0, 200));
  }
  return res.json();
}

async function main() {
  console.log('=== Photos Field Bug Cleanup ===');
  console.log('Mode: ' + (DRY_RUN ? 'DRY_RUN (no writes)' : 'LIVE (will patch Notion)'));
  console.log('DB: ' + NOTION_DB_ID);
  console.log('');

  const stats = {
    scanned: 0,
    affected: 0,
    moved: 0,         // moved URL to Cover photo, cleared Photos
    cleared: 0,       // cleared Photos (Cover photo already had URL)
    errors: 0,
    skipped: 0
  };

  for await (const page of iterAllPages()) {
    stats.scanned++;
    const photos = urlPropValue(page, 'Photos');
    const coverPhoto = urlPropValue(page, 'Cover photo') || urlPropValue(page, 'Cover Photo');

    if (!isGithubStreetViewUrl(photos)) {
      // Photos is empty, or has a Drive folder, or some other URL — leave alone
      continue;
    }

    stats.affected++;
    const label = titleOrAddress(page);

    if (!coverPhoto) {
      // Move URL from Photos to Cover photo
      console.log('[MOVE]    ' + label);
      console.log('          Photos -> Cover photo: ' + photos);
      if (!DRY_RUN) {
        try {
          await patchPage(page.id, {
            'Cover photo': { url: photos },
            'Photos': { url: null }
          });
          stats.moved++;
        } catch (e) {
          console.error('  ERROR: ' + e.message);
          stats.errors++;
        }
      } else {
        stats.moved++;
      }
    } else if (coverPhoto === photos || isGithubStreetViewUrl(coverPhoto)) {
      // Cover photo already has GitHub URL — just clear Photos
      console.log('[CLEAR]   ' + label);
      console.log('          Clearing Photos (Cover photo already set)');
      if (!DRY_RUN) {
        try {
          await patchPage(page.id, {
            'Photos': { url: null }
          });
          stats.cleared++;
        } catch (e) {
          console.error('  ERROR: ' + e.message);
          stats.errors++;
        }
      } else {
        stats.cleared++;
      }
    } else {
      // Cover photo has a non-GitHub URL — unusual, skip to be safe
      console.log('[SKIP]    ' + label);
      console.log('          Cover photo has non-GitHub URL: ' + coverPhoto);
      console.log('          Photos has GitHub URL: ' + photos);
      console.log('          (manual review)');
      stats.skipped++;
    }

    // Rate limit: ~3 patches/sec to stay under Notion's API limits
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 350));
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('Total deals scanned:    ' + stats.scanned);
  console.log('Affected (Photos=GitHub URL): ' + stats.affected);
  console.log('Moved to Cover photo:   ' + stats.moved);
  console.log('Photos cleared:         ' + stats.cleared);
  console.log('Manual review needed:   ' + stats.skipped);
  console.log('Errors:                 ' + stats.errors);
  if (DRY_RUN) {
    console.log('');
    console.log('DRY_RUN — no changes written. Re-run without DRY_RUN=1 to apply.');
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
