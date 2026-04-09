/**
 * Netlify Scheduled Function: deal-package-poller
 * Runs automatically every 15 minutes.
 * Scans GHL for any contact tagged "pkg-requested",
 * runs Claude deal package generation on each one,
 * posts the package as a GHL note, then swaps the tag to "pkg-complete".
 *
 * Just tag a contact "pkg-requested" in GHL — this does the rest.
 *
 * Required Environment Variables:
 *   ANTHROPIC_API_KEY
 *   GHL_API_KEY
 *   GHL_LOCATION_ID
 */

const { complete } = require('./_claude');
const { cfMap, findByTag, getContact, postNote, swapTags } = require('./_ghl');

exports.config = {
  schedule: '*/15 * * * *',
};

const GHL_BASE = 'https://services.leadconnectorhq.com';

const PACKAGE_SYSTEM = `You are the marketing director for Terms For Sale, a real estate disposition company that connects motivated sellers with real estate investors.

Brand voice: Professional, investor-to-investor. Lead with numbers. No fluff, no hype. Investors respect deals that speak for themselves. Be specific — exact prices, exact cash flow, exact entry. Use "we" sparingly.

STRICT RULES:
- NEVER include the seller's name
- NEVER mention or hint at MAO (Maximum Allowable Offer) — it's internal only
- NEVER say "motivated seller" — say the deal type instead (SubTo, Seller Finance, etc.)
- Lead with location and deal structure
- Always end with the deal URL or a call to action`;

// ─── Main handler ─────────────────────────────────────────────

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghlKey       = process.env.GHL_API_KEY;
  const locationId   = process.env.GHL_LOCATION_ID;

  if (!anthropicKey || !ghlKey || !locationId) {
    console.error('[deal-package-poller] Missing env vars');
    return { statusCode: 500 };
  }

  console.log('[deal-package-poller] Starting scan for pkg-requested contacts...');

  try {
    const contacts = await findTaggedContacts(ghlKey, locationId, 'pkg-requested');

    if (!contacts.length) {
      console.log('[deal-package-poller] No contacts tagged pkg-requested — done.');
      return { statusCode: 200 };
    }

    console.log(`[deal-package-poller] Found ${contacts.length} contact(s) to process`);

    for (const contact of contacts) {
      try {
        await processContact(contact, anthropicKey, ghlKey, locationId);
      } catch (err) {
        console.error(`[deal-package-poller] Error processing contact ${contact.id}:`, err.message);
        await postNote(ghlKey, contact.id,
          `## DEAL PACKAGE ERROR\n\nAuto-package generation failed:\n${err.message}\n\nPlease run manually or re-tag pkg-requested.`
        );
      }
    }

    console.log(`[deal-package-poller] Done. Processed ${contacts.length} contact(s).`);
    return { statusCode: 200 };

  } catch (err) {
    console.error('[deal-package-poller] Fatal error:', err.message);
    return { statusCode: 500 };
  }
};

// ─── Process one contact ──────────────────────────────────────

async function processContact(contact, anthropicKey, ghlKey, locationId) {
  const id   = contact.id;
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || id;

  console.log(`[deal-package-poller] Processing: ${name} (${id})`);

  // Pull custom fields into a flat map
  const cf = cfMap(contact);

  const address   = cf.property_address || '';
  const city      = cf.property_city    || '';
  const state     = cf.property_state   || '';
  const zip       = cf.property_zip     || '';
  const dealType  = cf.deal_structure   || cf.deal_type || '';
  const asking    = cf.seller_asking_price || cf.contracted_price || cf.desired_asking_price || '';
  const entry     = cf.entry_fee        || '';
  const arv       = cf.estimated_arv    || cf.arv || '';
  const rent      = cf.rent             || cf.market_rent || '';
  const beds      = cf.property_beds    || '';
  const baths     = cf.property_baths   || '';
  const sqft      = cf.property_sqft    || '';
  const yearBuilt = cf.property_year_built || '';
  const propType  = cf.asset_type       || 'SFR';
  const loanBal   = cf.subto_loan_balance || '';
  const rate      = cf.interest_rate    || '';
  const piti      = cf.monthly_payment  || '';
  const dealUrl   = cf.deal_url         || 'https://termsforsale.com';

  const fmt = function(n) { return n ? '$' + (+n).toLocaleString() : ''; };

  const dealFacts = [
    'Location: ' + [address, city, state, zip].filter(Boolean).join(', '),
    'Deal Type: ' + (dealType || 'not specified'),
    'Property: ' + [propType, beds ? beds + 'bd' : '', baths ? baths + 'ba' : '', sqft ? sqft + ' sqft' : '', yearBuilt ? 'built ' + yearBuilt : ''].filter(Boolean).join(' '),
    'Asking Price: ' + (fmt(asking) || 'not provided'),
    'Entry Fee: ' + (fmt(entry) || 'not provided'),
    'ARV: ' + (fmt(arv) || 'not provided'),
    'Market Rent: ' + (fmt(rent) || 'not provided'),
    loanBal ? 'Existing Loan Balance: ' + fmt(loanBal) : '',
    rate    ? 'Rate: ' + rate + '%' : '',
    piti    ? 'PITI: ' + fmt(piti) : '',
    'Deal URL: ' + dealUrl
  ].filter(Boolean).join('\n');

  const userPrompt = `Create a complete marketing package for this deal:

${dealFacts}

Output valid JSON with exactly these keys:
{
  "sms": ["version1 under 160 chars", "version2 under 160 chars", "version3 under 160 chars"],
  "emailSubjects": ["subject option 1", "subject option 2"],
  "emailBody": "full email body — professional investor tone, 150-250 words, lead with numbers, close with deal URL",
  "socialHook": "1-2 sentence social media hook for FB/IG real estate investor groups"
}

SMS rules: Each version must be under 160 characters, include deal type + location + key number + deal URL. Three distinct angles: one price-focused, one cash-flow-focused, one structure-focused.`;

  console.log(`[deal-package-poller] Generating package for: ${address || name}`);
  const claudeRes = await complete(anthropicKey, {
    system: PACKAGE_SYSTEM,
    user: userPrompt,
    maxTokens: 1200,
    json: true
  });
  const result = claudeRes.text;

  console.log(`[deal-package-poller] Package generated for ${name} | cost=$${claudeRes.usage.cost.toFixed(6)}`);

  // Validate SMS lengths
  if (Array.isArray(result.sms)) {
    result.sms = result.sms.map(function(msg, i) {
      if (msg.length > 160) {
        console.warn(`[deal-package-poller] SMS[${i}] is ${msg.length} chars, truncating`);
        return msg.slice(0, 157) + '...';
      }
      return msg;
    });
  }

  // Post the package as a formatted GHL note
  const noteBody = '--- DEAL MARKETING PACKAGE ---\n' +
    'Property: ' + [address, city, state].filter(Boolean).join(', ') + '\n' +
    'Deal Type: ' + (dealType || 'N/A') + '\n\n' +
    'SMS VERSION 1:\n' + ((result.sms && result.sms[0]) || '') + '\n\n' +
    'SMS VERSION 2:\n' + ((result.sms && result.sms[1]) || '') + '\n\n' +
    'SMS VERSION 3:\n' + ((result.sms && result.sms[2]) || '') + '\n\n' +
    'EMAIL SUBJECT 1: ' + ((result.emailSubjects && result.emailSubjects[0]) || '') + '\n' +
    'EMAIL SUBJECT 2: ' + ((result.emailSubjects && result.emailSubjects[1]) || '') + '\n\n' +
    'EMAIL BODY:\n' + (result.emailBody || '') + '\n\n' +
    'SOCIAL HOOK:\n' + (result.socialHook || '') + '\n\n' +
    '--- Deal Package Agent / Deal Pros LLC ---';

  await postNote(ghlKey, id, noteBody);

  // Swap tags: remove pkg-requested, add pkg-complete
  await swapTags(ghlKey, id, ['pkg-requested'], ['pkg-complete']);

  console.log(`[deal-package-poller] Done: ${name} — package posted, tags updated`);
}

// ─── Find contacts by tag (search API + fallback) ─────────────

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
      console.warn(`[deal-package-poller] Contact search failed (${res.status}) — falling back to list scan`);
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
      const tags = contact.tags || [];
      if (tags.includes(tag)) tagged.push(contact);
    });

    if (!batch.length || checked >= 3000) break;
    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    const last = batch[batch.length - 1];
    startAfter = last.startAfter?.[0] || '';
    startAfterId = last.startAfter?.[1] || last.id;
    if (!startAfter) break;
  }

  console.log(`[deal-package-poller] Fallback scan: checked ${checked} contacts, found ${tagged.length} tagged`);
  return tagged;
}
