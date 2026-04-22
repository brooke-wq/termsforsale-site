/**
 * Netlify Scheduled Function: underwriting-poller
 * Runs automatically every 15 minutes.
 * Scans GHL for any contact tagged "uw-requested",
 * runs Claude underwriting on each one, posts the report as a GHL note,
 * then swaps the tag to "uw-complete".
 *
 * Zero GHL workflow configuration needed.
 * Just tag a contact "uw-requested" in GHL — this does the rest.
 *
 * Required Netlify Environment Variables (same as underwriting.js):
 *   ANTHROPIC_API_KEY
 *   GHL_API_KEY
 *   GHL_LOCATION_ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

// ─── Scheduled trigger ────────────────────────────────────────
// Scheduled execution lives on the DigitalOcean Droplet (*/15 * * * *).
// This function still deploys so it can be invoked ad-hoc via HTTP.

// ─── SYSTEM PROMPT (same as underwriting.js) ─────────────────

const SYSTEM_PROMPT = `You are the Underwriting Analyst for Deal Pros LLC, part of the Deal Pros LLC AI operating system.

Your job is to produce a complete, accurate underwriting report for every deal submitted. Follow the protocol exactly.

CORE RULES:
- Never fabricate comps. If comp data is not provided, say so explicitly and flag it.
- Always use the CONSERVATIVE ARV for MAO calculations. Never use mid or aggressive for MAO.
- Run MAO for every viable structure — not just the one requested.
- Output the complete report in the exact markdown format below.
- Flag any Critical risk items at the very top before the full analysis.
- Minimum assignment fee: $5,000. Target: $10,000–$15,000. Premium: $20,000+
- Never proceed if Required inputs are missing — list what is missing instead.

MAO FORMULAS:
  Cash/Wholesale: MAO = (ARV_conservative × 0.70) − Rehab − Target_Fee
  Subject-To: Viable if monthly rent > PITI + $200/mo reserves AND equity ≥ 20% of ARV
  Seller Finance: Viable if buyer monthly payment ≤ market rent AND DSCR ≥ 1.2x
  Morby Method: Subto portion + seller carry second note. Viable if combined payment ≤ rent − $200
  Novation: No MAO. Negotiate near ARV. Deal Pros fee = 5–8% of sale price.

REHAB TIERS ($ per sqft):
  Excellent (move-in ready): $0–$5
  Good (cosmetic only): $5–$15
  Fair (kitchens/baths): $15–$30
  Poor (systems + cosmetic): $30–$50
  Needs Total Rehab: $50–$80
  Always use midpoint of tier unless condition notes justify high or low end.

PHOENIX/SCOTTSDALE MARKET BASELINES:
  Phoenix SFR: $150–$200/sqft mid | rent $1.00–$1.15/sqft
  Mesa SFR: $160–$210/sqft mid | rent $1.05–$1.20/sqft
  Scottsdale SFR: $280–$380/sqft mid | rent $1.40–$1.80/sqft
  Pool premium: $10,000–$18,000
  Target days on market: 7–21 days
  Assignment fee: $7,500 min | $12,000–$18,000 target | $25,000+ premium

RISK FLAGS (escalate to CEO + Brooke immediately):
  CRITICAL: Active bankruptcy, probate, lis pendens, minor heir on title — STOP the deal
  HIGH: IRS/tax lien, HOA lien, foundation concerns, FHA/VA loan (subto), mold/fire/flood
  MEDIUM: Tenant occupied, flood zone, out-of-state seller

OUTPUT FORMAT — use this exact structure every time:

---
## UNDERWRITING REPORT

**Property**: [Full address]
**Date**: [YYYY-MM-DD]
**Requested by**: Deal Pros Auto-Underwriting
**Report #**: UW-[YYYY]-[###]

### CRITICAL FLAGS
[List any critical flags here, or: "None identified."]

---

### Property Details
| Field | Value |
|---|---|
| Beds / Baths / Sqft | |
| Year Built | |
| Condition | |
| Property Type | |

---

### ARV Analysis
[Use provided comps or Phoenix/AZ market baselines with clear disclaimer if no comps provided]

**ARV Conservative**: $
**ARV Mid**: $
**ARV Aggressive**: $
**Working ARV (used for MAO)**: $ (conservative)

---

### Rehab Estimate
| Item | Basis | Cost |
|---|---|---|
| Condition tier | [tier] @ $[X]/sqft × [sqft] sqft | $ |
| **Total Rehab** | | **$** |

---

### MAO by Structure

#### Cash / Wholesale
[Full calculation table]

#### Subject-To
[VIABLE / NOT VIABLE — reason]

#### Seller Finance
[VIABLE / NOT VIABLE — reason]

#### Morby Method
[VIABLE / NOT VIABLE — reason]

#### Novation
[VIABLE / NOT VIABLE — reason]

---

### Recommended Structure
**[Structure]** — [1–2 sentence rationale]

### Recommended Assignment Fee
**$[X]** — [rationale]

---

### Risk Flags
[All flags by severity, or: "No critical or high-risk flags identified."]

---

### Notes for Acquisitions Director / Eddie
[Seller-facing framing and objections to expect]

---
*Underwriting Analyst · Deal Pros LLC · Auto-run*`;

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghlKey       = process.env.GHL_API_KEY;
  const locationId   = process.env.GHL_LOCATION_ID;

  if (!anthropicKey || !ghlKey || !locationId) {
    console.error('[underwriting-poller] Missing env vars');
    return { statusCode: 500 };
  }

  console.log('[underwriting-poller] Starting scan for uw-requested contacts...');

  try {
    // ── 1. Find all contacts tagged "uw-requested" ─────────
    const contacts = await findTaggedContacts(ghlKey, locationId, 'uw-requested');

    if (!contacts.length) {
      console.log('[underwriting-poller] No contacts tagged uw-requested — done.');
      return { statusCode: 200 };
    }

    console.log(`[underwriting-poller] Found ${contacts.length} contact(s) to process`);

    // ── 2. Process each contact ────────────────────────────
    for (const contact of contacts) {
      try {
        await processContact(contact, anthropicKey, ghlKey, locationId);
      } catch (err) {
        // Don't let one failure stop the rest
        console.error(`[underwriting-poller] Error processing contact ${contact.id}:`, err.message);
        await postGHLNote(ghlKey, contact.id,
          `## UNDERWRITING ERROR\n\nAuto-underwriting failed for this contact:\n\`\`\`\n${err.message}\n\`\`\`\nPlease run manually or contact Claude (software engineer).`
        );
      }
    }

    console.log(`[underwriting-poller] Done. Processed ${contacts.length} contact(s).`);
    return { statusCode: 200 };

  } catch (err) {
    console.error('[underwriting-poller] Fatal error:', err.message);
    return { statusCode: 500 };
  }
};

// ─────────────────────────────────────────────────────────────
// FIND CONTACTS TAGGED "uw-requested"
// Uses GHL contact search with tag filter
// ─────────────────────────────────────────────────────────────

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
        filters: [
          {
            group: 'AND',
            filters: [
              {
                field: 'tags',
                operator: 'contains',
                value: [tag],
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[underwriting-poller] Contact search failed (${res.status}) — falling back to list scan`);
      return findTaggedContactsFallback(apiKey, locationId, tag);
    }

    const data = await res.json();
    const batch = data.contacts || data.data || [];
    contacts.push(...batch);

    // Check if more pages
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

// Fallback: paginate all contacts and filter by tag client-side
// Used if the search endpoint doesn't support tag filters in this GHL version
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

    // Pagination
    if (!batch.length || checked >= 3000) break;
    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    const last = batch[batch.length - 1];
    startAfter = last.startAfter?.[0] || '';
    startAfterId = last.startAfter?.[1] || last.id;
    if (!startAfter) break;
  }

  console.log(`[underwriting-poller] Fallback scan: checked ${checked} contacts, found ${tagged.length} tagged`);
  return tagged;
}

// ─────────────────────────────────────────────────────────────
// PROCESS ONE CONTACT
// ─────────────────────────────────────────────────────────────

async function processContact(contact, anthropicKey, ghlKey, locationId) {
  const id   = contact.id;
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || id;

  console.log(`[underwriting-poller] Processing: ${name} (${id})`);

  // Pull custom fields into a flat map
  const cf = {};
  (contact.customFields || []).forEach(f => {
    cf[f.key] = f.value;
  });

  // Build deal object
  const address     = cf.property_address || '';
  const city        = cf.property_city    || '';
  const state       = cf.property_state   || '';
  const zip         = cf.property_zip     || '';
  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');

  const deal = {
    address:       fullAddress || `Contact: ${name}`,
    beds:          cf.property_beds      || '?',
    baths:         cf.property_baths     || '?',
    sqft:          cf.property_sqft      || '?',
    year_built:    cf.property_year_built || 'Unknown',
    condition:     cf.property_condition  || cf.deal_condition || 'Unknown',
    property_type: cf.asset_type         || 'SFR',
    asking_price:  cf.seller_asking_price || cf.contracted_price || cf.desired_asking_price || '',
    structure:     cf.deal_structure     || cf.deal_type || 'All',
    motivation:    cf.seller_motivation  || '',
    timeline:      cf.seller_timeline    || '',
    notes:         cf.important_details  || cf.additional_notes || cf.jv_notes || '',
    mortgage: (cf.subto_loan_balance || cf.deal_mortgage_balance) ? {
      balance:       cf.subto_loan_balance    || cf.deal_mortgage_balance || '',
      piti:          cf.monthly_payment       || cf.deal_monthly_payment  || '',
      rate:          cf.interest_rate         || cf.deal_interest_rate    || '',
      type:          cf.loan_type             || 'Unknown',
      months_behind: cf.subto_payments_behind || '0',
    } : null,
  };

  // Build Claude prompt
  const prompt = buildPrompt(deal);

  // Call Claude
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': anthropicKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    throw new Error(`Claude API error: ${claudeRes.status}`);
  }

  const claudeData = await claudeRes.json();
  const report     = claudeData.content?.[0]?.text || '';
  const { input_tokens, output_tokens } = claudeData.usage || {};
  const cost = (((input_tokens || 0) * 0.000003) + ((output_tokens || 0) * 0.000015)).toFixed(4);

  console.log(`[underwriting-poller] Report generated: ${name} | ${input_tokens}in/${output_tokens}out | ~$${cost}`);

  // Post report as GHL note
  await postGHLNote(ghlKey, id, report);

  // Swap tags: remove uw-requested, add uw-complete
  await swapTags(ghlKey, id, ['uw-complete'], ['uw-requested']);

  console.log(`[underwriting-poller] Done: ${name} — note posted, tags updated`);
}

// ─────────────────────────────────────────────────────────────
// BUILD PROMPT
// ─────────────────────────────────────────────────────────────

function buildPrompt(deal) {
  const mortgageSection = deal.mortgage
    ? `EXISTING MORTGAGE DATA:
  Balance: ${deal.mortgage.balance ? '$' + Number(deal.mortgage.balance).toLocaleString() : 'Unknown'}
  Monthly PITI: ${deal.mortgage.piti || 'Unknown'}
  Interest rate: ${deal.mortgage.rate || 'Unknown'}%
  Loan type: ${deal.mortgage.type}
  Months behind: ${deal.mortgage.months_behind || '0'}`
    : 'EXISTING MORTGAGE DATA: Not provided — Subject-To and Morby analyses will be marked N/A.';

  return `Run a complete underwriting report for this deal.

PROPERTY:
  Address: ${deal.address}
  Beds / Baths / Sqft: ${deal.beds} bd / ${deal.baths} ba / ${deal.sqft} sqft
  Year Built: ${deal.year_built}
  Condition: ${deal.condition}
  Property Type: ${deal.property_type}

DEAL:
  Seller Asking / Contract Price: ${deal.asking_price ? '$' + Number(deal.asking_price).toLocaleString() : 'Not specified'}
  Structure Requested: ${deal.structure}

SELLER:
  Motivation: ${deal.motivation || 'Not specified'}
  Timeline: ${deal.timeline || 'Not specified'}

${mortgageSection}

COMPARABLE SALES: Not provided via automation — use Phoenix/AZ market knowledge or flag for manual comp pull.

ADDITIONAL NOTES: ${deal.notes || 'None'}

REQUESTED BY: Deal Pros Auto-Underwriting (scheduled poller)
DATE: ${new Date().toISOString().split('T')[0]}

Output the full underwriting report now.`;
}

// ─────────────────────────────────────────────────────────────
// GHL HELPERS
// ─────────────────────────────────────────────────────────────

async function postGHLNote(apiKey, contactId, noteBody) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        userId: 'dealpros-underwriting',
        body: noteBody,
      }),
    });
    if (!res.ok) {
      console.warn(`[underwriting-poller] Note post failed for ${contactId}: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[underwriting-poller] Note post error: ${err.message}`);
  }
}

async function swapTags(apiKey, contactId, addTags, removeTags) {
  try {
    if (addTags?.length) {
      await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({ tags: addTags }),
      });
    }
    if (removeTags?.length) {
      await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({ tags: removeTags }),
      });
    }
  } catch (err) {
    console.warn(`[underwriting-poller] Tag swap error (non-fatal): ${err.message}`);
  }
}

/*
 * ─────────────────────────────────────────────────────────────
 * DEPLOY
 * ─────────────────────────────────────────────────────────────
 *
 * 1. Add this file to:
 *    termsforsale/netlify/functions/underwriting-poller.js
 *
 * 2. Push to GitHub — Netlify deploys automatically.
 *
 * 3. Verify in Netlify → Functions tab that
 *    "underwriting-poller" shows as a Scheduled Function.
 *
 * 4. That's it. No GHL workflow, no webhook setup.
 *
 * HOW TO USE:
 *   In GHL, open any deal contact and add the tag: uw-requested
 *   Within 15 minutes, the full underwriting report will appear
 *   as a contact Note. Tag automatically changes to uw-complete.
 *
 * MONITORING:
 *   Netlify → Functions → underwriting-poller → View logs
 *
 * ─────────────────────────────────────────────────────────────
 */
