/**
 * Deal View Tracker — POST /.netlify/functions/deal-view-tracker
 * (also reachable via /api/deal-view-tracker)
 *
 * Tags a buyer as having viewed a specific deal. Called from the public deal
 * detail page on load whenever a ?cid= (contact id) query param is present.
 *
 * REQUEST BODY (JSON):
 *   {
 *     "contactId": "abc123",      // GHL contact ID (required)
 *     "dealId":    "PHX-001"      // Deal ID in format MKT-### (required)
 *   }
 *
 * BEHAVIOR:
 *   1. Validates both fields present
 *   2. Validates dealId matches /^[A-Z]+-[0-9]+$/
 *   3. Adds tag `viewed-[dealId]` to the GHL contact (Terms For Sale sub-account)
 *   4. Posts a GHL note: "Buyer viewed deal [dealId] on [YYYY-MM-DD]"
 *   5. Returns 200 { success: true }
 *
 * ERROR HANDLING:
 *   - Missing fields         → 400
 *   - Invalid dealId format  → 400
 *   - GHL errors             → logged, still returns 200 (never break the page load)
 *
 * TRIGGERED BY: deal-page-tracker.js snippet on deal detail pages
 *
 * ENV VARS:
 *   GHL_API_KEY              — GHL private integration API key
 *   GHL_LOCATION_ID_TERMS    — Terms For Sale sub-account location ID
 *                              (falls back to GHL_LOCATION_ID if not set)
 *
 * COST: ~$0 per call (2 GHL API writes, no Claude/Notion).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const DEAL_ID_RE = /^[A-Z]+-[0-9]+$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

async function ghlFetch(path, apiKey, method, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  // Parse body
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.warn('[deal-view-tracker] invalid JSON body');
    return respond(400, { error: 'Invalid JSON' });
  }

  const contactId = (payload.contactId || '').trim();
  const dealId = (payload.dealId || '').trim();

  if (!contactId || !dealId) {
    console.warn('[deal-view-tracker] missing fields:', { contactId: !!contactId, dealId: !!dealId });
    return respond(400, { error: 'contactId and dealId are required' });
  }
  if (!DEAL_ID_RE.test(dealId)) {
    console.warn('[deal-view-tracker] invalid dealId format:', dealId);
    return respond(400, { error: 'dealId must match format MKT-### (e.g. PHX-001)' });
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    console.error('[deal-view-tracker] GHL_API_KEY not configured');
    return respond(200, { success: true, warning: 'ghl_not_configured' });
  }

  const tag = `viewed-${dealId}`;
  const today = new Date().toISOString().split('T')[0];
  const note = `Buyer viewed deal ${dealId} on ${today}`;

  console.log(`[deal-view-tracker] contact=${contactId} deal=${dealId} tag=${tag}`);

  // 1. Add the viewed tag. Errors are logged, not thrown — never break the page load.
  try {
    const tagRes = await ghlFetch(`/contacts/${contactId}/tags`, apiKey, 'POST', { tags: [tag] });
    if (!tagRes.ok) {
      console.warn(`[deal-view-tracker] add-tag failed status=${tagRes.status}`, tagRes.body);
    } else {
      console.log(`[deal-view-tracker] add-tag ok contact=${contactId} tag=${tag}`);
    }
  } catch (err) {
    console.error('[deal-view-tracker] add-tag error:', err.message);
  }

  // 2. Post the note. Same no-throw policy.
  try {
    const noteRes = await ghlFetch(`/contacts/${contactId}/notes`, apiKey, 'POST', {
      body: note,
    });
    if (!noteRes.ok) {
      console.warn(`[deal-view-tracker] post-note failed status=${noteRes.status}`, noteRes.body);
    } else {
      console.log(`[deal-view-tracker] post-note ok contact=${contactId}`);
    }
  } catch (err) {
    console.error('[deal-view-tracker] post-note error:', err.message);
  }

  return respond(200, { success: true });
};
