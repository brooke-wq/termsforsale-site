/**
 * Scheduled Job: deal-dog-poller
 * Runs every hour on DigitalOcean (0 * * * *)
 * Scans GHL for contacts tagged "birddog-submitted",
 * uses Claude to evaluate the lead quality and route accordingly.
 *
 * Bird dog students submit raw leads. This function:
 * 1. Evaluates lead quality via Claude
 * 2. If promising: routes to lead-intake pipeline (adds lead-new tag)
 * 3. If not promising: adds birddog-reviewed tag with feedback note
 * 4. Always posts a review note and removes birddog-submitted tag
 *
 * Required Environment Variables:
 *   ANTHROPIC_API_KEY
 *   GHL_API_KEY
 *   GHL_LOCATION_ID_ACQASSIST (or GHL_LOCATION_ID)
 */

const { complete } = require('./_claude');
const { cfMap, getContact, postNote, swapTags, sendSMS } = require('./_ghl');

const GHL_BASE = 'https://services.leadconnectorhq.com';

const REVIEW_SYSTEM = `You are the Bird Dog Lead Review Agent for Deal Pros LLC.

Bird dog students submit raw leads — addresses they've found driving for dollars, from online research, or from personal contacts. Your job is to quickly evaluate whether each lead is worth routing into the acquisition pipeline.

A lead is PROMISING if:
- There are visible signs of distress (vacancy, code violations, deferred maintenance)
- Owner situation suggests motivation (absentee, inherited, tax delinquent, pre-foreclosure)
- The area/market is in our coverage (AZ, TX, FL primarily)
- There's enough information to take action (at minimum: address + why it's a lead)

A lead is NOT PROMISING if:
- No clear distress indicators and no owner motivation
- Clearly retail/occupied/maintained property with no reason to sell
- Incomplete information (just an address with no context)
- Out of our markets with no compelling reason to pursue

Be encouraging to bird dog students — they're learning. Give constructive feedback even on rejected leads.

Output valid JSON only.`;

// Can be called as Netlify scheduled function OR standalone Node script
if (typeof exports !== 'undefined') {
  exports.config = { schedule: '0 * * * *' };

  exports.handler = async () => {
    return run();
  };
}

async function run() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghlKey       = process.env.GHL_API_KEY;
  const locationId   = process.env.GHL_LOCATION_ID_ACQASSIST || process.env.GHL_LOCATION_ID;

  if (!anthropicKey || !ghlKey || !locationId) {
    console.error('[deal-dog-poller] Missing env vars');
    return { statusCode: 500 };
  }

  console.log('[deal-dog-poller] Starting scan for birddog-submitted contacts...');

  try {
    const contacts = await findTaggedContacts(ghlKey, locationId, 'birddog-submitted');

    if (!contacts.length) {
      console.log('[deal-dog-poller] No contacts tagged birddog-submitted — done.');
      return { statusCode: 200 };
    }

    console.log(`[deal-dog-poller] Found ${contacts.length} contact(s) to review`);

    for (const contact of contacts) {
      try {
        await processContact(contact, anthropicKey, ghlKey, locationId);
      } catch (err) {
        console.error(`[deal-dog-poller] Error processing ${contact.id}:`, err.message);
        await postNote(ghlKey, contact.id,
          `## BIRD DOG REVIEW ERROR\n\nAuto-review failed:\n${err.message}`
        );
      }
    }

    console.log(`[deal-dog-poller] Done. Reviewed ${contacts.length} lead(s).`);
    return { statusCode: 200 };

  } catch (err) {
    console.error('[deal-dog-poller] Fatal error:', err.message);
    return { statusCode: 500 };
  }
}

async function processContact(contact, anthropicKey, ghlKey, locationId) {
  const id   = contact.id;
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || id;

  console.log(`[deal-dog-poller] Reviewing: ${name} (${id})`);

  const cf = cfMap(contact);

  const address     = cf.property_address || '';
  const city        = cf.property_city    || '';
  const state       = cf.property_state   || '';
  const notes       = cf.additional_notes || cf.jv_notes || cf.important_details || '';
  const condition   = cf.property_condition || '';
  const motivation  = cf.seller_motivation || '';
  const submittedBy = cf.birddog_name || cf.submitted_by || name;

  const leadData = [
    'Submitted By: ' + submittedBy,
    'Property Address: ' + [address, city, state].filter(Boolean).join(', '),
    'Condition: ' + (condition || 'Not specified'),
    'Why This Lead: ' + (motivation || notes || 'No reason provided'),
    'Additional Notes: ' + (notes || 'None')
  ].join('\n');

  const userPrompt = 'Review this bird dog lead submission:\n\n' + leadData + '\n\n' +
    'Return JSON: { "promising": true|false, "score": 1-10, "reason": "1-2 sentence reason", "feedback": "constructive feedback for the bird dog student", "route_to": "lead-intake|review-later|decline", "internal_note": "note for our acquisitions team" }';

  const claudeRes = await complete(anthropicKey, {
    system: REVIEW_SYSTEM,
    user: userPrompt,
    maxTokens: 500,
    json: true
  });
  const result = claudeRes.text;

  console.log(`[deal-dog-poller] ${name}: promising=${result.promising} score=${result.score} route=${result.route_to} cost=$${claudeRes.usage.cost.toFixed(6)}`);

  // Post review note
  const noteBody = '--- BIRD DOG LEAD REVIEW ---\n' +
    'Submitted By: ' + submittedBy + '\n' +
    'Property: ' + [address, city, state].filter(Boolean).join(', ') + '\n' +
    'Promising: ' + (result.promising ? 'YES' : 'NO') + '\n' +
    'Score: ' + (result.score || '?') + '/10\n' +
    'Reason: ' + (result.reason || '') + '\n\n' +
    'Student Feedback: ' + (result.feedback || '') + '\n\n' +
    (result.internal_note || '') + '\n\n' +
    '--- Bird Dog Review / Deal Pros LLC ---';
  await postNote(ghlKey, id, noteBody);

  // Route based on result
  if (result.promising && result.route_to === 'lead-intake') {
    await swapTags(ghlKey, id, ['birddog-submitted'], ['birddog-approved', 'lead-new']);
    console.log(`[deal-dog-poller] APPROVED — routing to lead intake`);
  } else {
    await swapTags(ghlKey, id, ['birddog-submitted'], ['birddog-reviewed']);
    console.log(`[deal-dog-poller] REVIEWED — not routing`);
  }
}

// ─── Find contacts by tag ─────────────────────────────────────

async function findTaggedContacts(apiKey, locationId, tag) {
  const contacts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        locationId,
        page,
        pageLimit: 100,
        filters: [{
          group: 'AND',
          filters: [{
            field: 'tags',
            operator: 'contains',
            value: [tag],
          }],
        }],
      }),
    });

    if (!res.ok) {
      console.warn(`[deal-dog-poller] Search failed (${res.status}) — falling back`);
      return findTaggedContactsFallback(apiKey, locationId, tag);
    }

    const data = await res.json();
    const batch = data.contacts || data.data || [];
    contacts.push(...batch);

    const meta = data.meta || {};
    const total = meta.total || batch.length;
    if (contacts.length >= total || !batch.length) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return contacts;
}

async function findTaggedContactsFallback(apiKey, locationId, tag) {
  const tagged = [];
  let startAfter = '';
  let startAfterId = '';
  let checked = 0;

  while (true) {
    let url = `${GHL_BASE}/contacts/?locationId=${locationId}&limit=100`;
    if (startAfter) url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
      },
    });

    if (!res.ok) break;
    const data = await res.json();
    const batch = data.contacts || [];
    checked += batch.length;

    batch.forEach(contact => {
      if ((contact.tags || []).includes(tag)) tagged.push(contact);
    });

    if (!batch.length || checked >= 3000) break;
    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    const last = batch[batch.length - 1];
    startAfter = last.startAfter?.[0] || '';
    startAfterId = last.startAfter?.[1] || last.id;
    if (!startAfter) break;
  }

  console.log(`[deal-dog-poller] Fallback: checked ${checked}, found ${tagged.length} tagged`);
  return tagged;
}

// Allow running as standalone script
if (require.main === module) {
  run().then(r => {
    console.log('[deal-dog-poller] Exit:', r.statusCode);
    process.exit(r.statusCode === 200 ? 0 : 1);
  }).catch(err => {
    console.error('[deal-dog-poller] Fatal:', err);
    process.exit(1);
  });
}
