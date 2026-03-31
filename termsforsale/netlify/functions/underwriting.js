/**
 * Netlify Function: underwriting
 * POST /api/underwriting
 *
 * Runs Claude underwriting analysis on a deal submission.
 * Can be triggered two ways:
 *
 *   1. GHL Webhook — when a deal contact is tagged "uw-requested"
 *      GHL sends contact data → Claude underwrites → report posted back as GHL note
 *
 *   2. Manual POST — paste deal details directly (for live calls with Eddie)
 *      Returns the full underwriting report in the JSON response
 *
 * Required Netlify Environment Variables:
 *   ANTHROPIC_API_KEY  — Claude API key (get from console.anthropic.com)
 *   GHL_API_KEY        — GoHighLevel private integration API key
 *   GHL_LOCATION_ID    — GHL sub-account location ID (Dispo Buddy or Acq Assist)
 *
 * Cost: ~$0.03–$0.08 per deal at 25 deals/mo ≈ $0.75–$2.00/mo total
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

// ─────────────────────────────────────────────────────────────
// CLAUDE UNDERWRITING SYSTEM PROMPT
// Implements the full 7-step Deal Pros underwriting skill protocol
// ─────────────────────────────────────────────────────────────

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
**Requested by**: [Agent/source]
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
| Comp | Address | Sqft | Sold Price | Date | $/Sqft | Adj Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

**ARV Conservative**: $
**ARV Mid**: $
**ARV Aggressive**: $
**Working ARV (used for MAO)**: $ (conservative)

---

### Rehab Estimate
| Item | Basis | Cost |
|---|---|---|
| Condition tier | [tier] @ $[X]/sqft × [sqft] sqft | $ |
| Contingency flags | [if any] | $ |
| **Total Rehab** | | **$** |

---

### MAO by Structure

#### Cash / Wholesale
| Calculation | Amount |
|---|---|
| ARV × 70% | $ |
| − Rehab | −$ |
| − Target fee | −$ |
| **MAO** | **$** |
| Seller asking | $ |
| **Deal works?** | [YES / NO — $X gap] |

#### Subject-To
[VIABLE / NOT VIABLE — reason]
[If viable: cash flow, equity position, due-on-sale risk level]

#### Seller Finance
[VIABLE / NOT VIABLE — reason]
[If viable: suggested price, terms, seller monthly income, buyer DSCR]

#### Morby Method
[VIABLE / NOT VIABLE — reason]
[If viable: subto portion, carry note, combined monthly, spread vs rent]

#### Novation
[VIABLE / NOT VIABLE — reason]
[If viable: suggested list price, estimated DOM, Deal Pros fee, net to seller]

---

### Recommended Structure
**[Structure]** — [1–2 sentence rationale]

### Recommended Assignment Fee
**$[X]** — [rationale]

---

### Risk Flags
[List all flags by severity, or: "No critical or high-risk flags identified."]

---

### Notes for Acquisitions Director / Eddie
[Seller-facing framing: how to present the offer, objections to expect, terms to lead with]

---
*Underwriting Analyst · Deal Pros LLC*`;

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghlKey       = process.env.GHL_API_KEY;
  const locationId   = process.env.GHL_LOCATION_ID;

  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY');
    return respond(500, { error: 'Server configuration error: missing ANTHROPIC_API_KEY' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  // ── Validate minimum required fields ───────────────────────
  const missing = [];
  if (!body.address && !body.property_address) missing.push('address');
  if (!body.condition && !body.property_condition) missing.push('condition');
  if (!body.sqft && !body.property_sqft) missing.push('sqft');

  if (missing.length > 0) {
    return respond(400, {
      error: 'Missing required fields',
      missing,
      hint: 'Required: address, condition, sqft. Optional but valuable: beds, baths, year_built, asking_price, comps, mortgage data.',
    });
  }

  // ── Build deal object from payload ─────────────────────────
  // Accepts both GHL webhook format (custom field keys) and direct POST format
  const deal = normalizeDeal(body);

  // ── Build Claude prompt ────────────────────────────────────
  const userPrompt = buildPrompt(deal);

  try {
    // ── Call Claude API ────────────────────────────────────
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
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Claude API error:', claudeRes.status, err);
      return respond(502, { error: 'Claude API error', detail: err });
    }

    const claudeData = await claudeRes.json();
    const report = claudeData.content?.[0]?.text || '';

    // ── Log token usage ────────────────────────────────────
    const { input_tokens, output_tokens } = claudeData.usage || {};
    const cost = (((input_tokens || 0) * 0.000003) + ((output_tokens || 0) * 0.000015)).toFixed(4);
    console.log(`Underwriting complete: ${deal.address} | ${input_tokens}in/${output_tokens}out | ~$${cost}`);

    // ── Post report to GHL as contact note (if contact_id provided) ──
    let notePosted = false;
    if (ghlKey && (body.contact_id || body.contactId)) {
      const contactId = body.contact_id || body.contactId;
      notePosted = await postGHLNote(ghlKey, contactId, report);

      // Remove uw-requested tag, add uw-complete tag
      if (notePosted) {
        await updateGHLTags(ghlKey, contactId, ['uw-complete'], ['uw-requested']);
      }
    }

    return respond(200, {
      success: true,
      report,
      address: deal.address,
      notePosted,
      usage: { input_tokens, output_tokens, estimated_cost: `$${cost}` },
    });

  } catch (err) {
    console.error('Underwriting function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// NORMALIZE DEAL
// Accepts both GHL webhook format and direct format
// ─────────────────────────────────────────────────────────────

function normalizeDeal(d) {
  // Helper: get value from either direct key or GHL custom field style key
  function get(direct, ghlKey) {
    return d[direct] || d[ghlKey] || '';
  }

  const address   = get('address', 'property_address') || get('propertyAddress', 'street_address');
  const city      = get('city', 'property_city') || get('propertyCity', 'deal_city') || '';
  const state     = get('state', 'property_state') || get('propertyState', 'deal_state') || '';
  const zip       = get('zip', 'property_zip') || get('propertyZip', 'deal_zip') || '';
  const fullAddr  = address + (city ? `, ${city}` : '') + (state ? `, ${state}` : '') + (zip ? ` ${zip}` : '');

  return {
    address:       fullAddr.trim(),
    beds:          get('beds', 'property_beds') || get('deal_beds', '') || '?',
    baths:         get('baths', 'property_baths') || get('deal_baths', '') || '?',
    sqft:          get('sqft', 'property_sqft') || get('deal_sqft', '') || '?',
    year_built:    get('year_built', 'property_year_built') || get('deal_year_built', '') || 'Unknown',
    condition:     get('condition', 'property_condition') || get('deal_condition', '') || 'Unknown',
    property_type: get('property_type', 'asset_type') || 'SFR',
    asking_price:  get('asking_price', 'seller_asking_price') || get('contracted_price', '') || '',
    structure:     get('structure', 'deal_structure') || get('deal_type', '') || 'All',
    motivation:    get('motivation', 'seller_motivation') || '',
    timeline:      get('timeline', 'seller_timeline') || '',
    notes:         get('notes', 'additional_notes') || get('important_details', '') || '',
    requested_by:  get('requested_by', 'source') || 'GHL Automation',
    // Mortgage data (for subto/morby)
    mortgage: hasAny(d, ['subto_loan_balance','deal_mortgage_balance','mortgage_balance']) ? {
      balance:       get('mortgage_balance', 'subto_loan_balance') || get('deal_mortgage_balance', ''),
      piti:          get('piti', 'monthly_payment') || get('deal_monthly_payment', '') || '',
      rate:          get('interest_rate', 'subto_rate') || get('deal_interest_rate', '') || '',
      type:          get('loan_type', 'subto_loan_type') || 'Unknown',
      months_behind: get('months_behind', 'subto_payments_behind') || '0',
    } : null,
    // Comps (optional array)
    comps: Array.isArray(d.comps) ? d.comps : [],
  };
}

function hasAny(obj, keys) {
  return keys.some(k => obj[k] && String(obj[k]).trim() !== '');
}

// ─────────────────────────────────────────────────────────────
// BUILD CLAUDE PROMPT
// ─────────────────────────────────────────────────────────────

function buildPrompt(deal) {
  const compsSection = deal.comps.length > 0
    ? `COMPARABLE SALES PROVIDED:\n${deal.comps.map((c, i) =>
        `  Comp ${i + 1}: ${c.address}, ${c.sqft} sqft, sold $${Number(c.price).toLocaleString()}, ${c.date}, condition: ${c.condition || 'unknown'}`
      ).join('\n')}`
    : 'COMPARABLE SALES: Not provided — use Phoenix/Scottsdale market knowledge or flag for Perplexity research if outside primary market.';

  const mortgageSection = deal.mortgage
    ? `EXISTING MORTGAGE DATA:
  Balance: ${deal.mortgage.balance ? '$' + Number(deal.mortgage.balance).toLocaleString() : 'Unknown'}
  Monthly PITI: ${deal.mortgage.piti ? '$' + Number(deal.mortgage.piti).toLocaleString() : 'Unknown'}
  Interest rate: ${deal.mortgage.rate || 'Unknown'}%
  Loan type: ${deal.mortgage.type || 'Unknown'}
  Months behind: ${deal.mortgage.months_behind || '0'}`
    : 'EXISTING MORTGAGE DATA: Not provided — Subject-To and Morby analyses will be marked N/A.';

  return `Run a complete underwriting report for this deal. Follow the 7-step protocol and output the full report in the exact markdown format.

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

${compsSection}

ADDITIONAL NOTES:
  ${deal.notes || 'None'}

REQUESTED BY: ${deal.requested_by}
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
      console.warn('GHL note post failed:', res.status, await res.text());
      return false;
    }
    console.log(`GHL note posted: contact ${contactId}`);
    return true;
  } catch (err) {
    console.warn('GHL note error:', err.message);
    return false;
  }
}

async function updateGHLTags(apiKey, contactId, addTags, removeTags) {
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
    console.warn('GHL tag update error (non-fatal):', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

/*
 * ─────────────────────────────────────────────────────────────
 * SETUP GUIDE
 * ─────────────────────────────────────────────────────────────
 *
 * STEP 1 — Add to netlify.toml:
 *
 *   [[redirects]]
 *   from = "/api/underwriting"
 *   to = "/.netlify/functions/underwriting"
 *   status = 200
 *
 * STEP 2 — Add environment variables in Netlify:
 *   Site → Site Configuration → Environment Variables → Add variable
 *
 *   ANTHROPIC_API_KEY  — Get from console.anthropic.com → API Keys
 *   GHL_API_KEY        — Already set (same key used by other functions)
 *   GHL_LOCATION_ID    — Already set (7IyUgu1zpi38MDYpSDTs for Dispo Buddy/Acq Assist)
 *
 * STEP 3 — Deploy:
 *   git add termsforsale/netlify/functions/underwriting.js
 *   git add netlify.toml
 *   git commit -m "Add Deal Pros underwriting function"
 *   git push
 *   Netlify auto-builds on push — live in ~60 seconds.
 *
 * STEP 4 — Build GHL Workflow (Dispo Buddy sub-account):
 *   Trigger: Contact Tag Added → "uw-requested"
 *   Action: Send Webhook → POST https://deals.termsforsale.com/api/underwriting
 *   Body (JSON):
 *     {
 *       "contact_id":         "{{contact.id}}",
 *       "address":            "{{contact.customField.property_address}}",
 *       "city":               "{{contact.customField.property_city}}",
 *       "state":              "{{contact.customField.property_state}}",
 *       "zip":                "{{contact.customField.property_zip}}",
 *       "beds":               "{{contact.customField.property_beds}}",
 *       "baths":              "{{contact.customField.property_baths}}",
 *       "sqft":               "{{contact.customField.property_sqft}}",
 *       "year_built":         "{{contact.customField.property_year_built}}",
 *       "condition":          "{{contact.customField.property_condition}}",
 *       "asking_price":       "{{contact.customField.seller_asking_price}}",
 *       "deal_type":          "{{contact.customField.deal_structure}}",
 *       "motivation":         "{{contact.customField.seller_motivation}}",
 *       "timeline":           "{{contact.customField.seller_timeline}}",
 *       "subto_loan_balance": "{{contact.customField.subto_loan_balance}}",
 *       "monthly_payment":    "{{contact.customField.monthly_payment}}",
 *       "interest_rate":      "{{contact.customField.interest_rate}}",
 *       "notes":              "{{contact.customField.important_details}}"
 *     }
 *
 * STEP 5 — Test manually:
 *   curl -X POST https://deals.termsforsale.com/api/underwriting \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "address": "4821 W McDowell Rd",
 *       "city": "Phoenix", "state": "AZ", "zip": "85035",
 *       "beds": 3, "baths": 2, "sqft": 1380,
 *       "year_built": 1978, "condition": "Fair",
 *       "asking_price": 195000,
 *       "motivation": "Inherited, out of state, wants quick close",
 *       "timeline": "30-45 days"
 *     }'
 *
 * HOW TO TRIGGER FROM GHL (manual, no workflow needed):
 *   In GHL, add the tag "uw-requested" to any deal contact.
 *   The workflow fires → webhook hits this function → report posts as a GHL note.
 *   Tag swaps to "uw-complete" automatically.
 *
 * ─────────────────────────────────────────────────────────────
 */
