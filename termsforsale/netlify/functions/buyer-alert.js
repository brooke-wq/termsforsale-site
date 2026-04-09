/**
 * Buyer Alert — POST /.netlify/functions/buyer-alert
 * (also reachable via /api/buyer-alert)
 *
 * Fires when a buyer replies to a deal blast with an interest keyword
 * (INTERESTED / YES / etc). GHL invokes this via an inbound SMS workflow
 * webhook. We read every `sent-[deal-id]` tag the contact has, promote
 * each to `alert-[deal-id]`, post a note per deal, and SMS Brooke.
 *
 * ─────────────────────────────────────────────────────────────
 * GHL WORKFLOW SETUP (one time, in Terms For Sale sub-account)
 * ─────────────────────────────────────────────────────────────
 *   Workflow name: "Buyer Interest Webhook"
 *   Trigger:       Customer Replied → Inbound SMS
 *                  Filter: Message contains any of:
 *                    INTERESTED, interested, YES, Yes, yes
 *   Action:        Webhook
 *                  URL:    https://deals.termsforsale.com/api/buyer-alert
 *                  Method: POST
 *                  Body:   Custom Data (default GHL contact payload — GHL
 *                          will send contact.id, contact.firstName,
 *                          contact.phone, contact.tags, etc.)
 *
 * REQUEST BODY (GHL webhook payload, loose shape):
 *   {
 *     "contact": {
 *       "id": "abc123",
 *       "firstName": "Jane",
 *       "phone": "+14805551234",
 *       "tags": ["sent-PHX-001", "sent-MSA-014", "buyer-active", ...]
 *     }
 *   }
 *   GHL also sometimes flattens these — we accept top-level fields too.
 *
 * BEHAVIOR:
 *   1. Extract contact id + current tags (supports nested and flat payloads)
 *   2. Find every tag matching /^sent-[A-Z]+-[0-9]+$/
 *   3. For each matching deal id:
 *        a. Add `alert-[deal-id]` tag
 *        b. Post a note: "Buyer expressed interest in deal [deal-id] on [date]"
 *   4. SMS Brooke (BROOKE_PHONE):
 *        "🔴 BUYER ALERT: [firstName] ([phone]) is INTERESTED in
 *         [deal-id, deal-id]. Check GHL."
 *   5. If NO sent- tags were found, post a fallback note + still SMS Brooke.
 *
 * ERROR HANDLING:
 *   - Missing contact id       → 200 with warning (never 500 on a webhook)
 *   - GHL write errors          → logged, webhook still returns 200
 *   - SMS lookup failure        → logged, webhook still returns 200
 *
 * ENV VARS:
 *   GHL_API_KEY              — GHL private integration API key
 *   GHL_LOCATION_ID_TERMS    — Terms For Sale sub-account location id
 *                              (falls back to GHL_LOCATION_ID)
 *   BROOKE_PHONE             — Brooke's cell, E.164 format (e.g. +15167120113)
 *
 * COST: ~$0 per call (3–5 GHL writes, no Claude/Notion).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
// Case-insensitive: GHL lowercases tags on save, so `sent-TEST-001` ends up
// stored as `sent-test-001`. The `/i` flag lets us match either and we
// uppercase the captured dealId for display.
const SENT_TAG_RE = /^sent-([a-z]+-[0-9]+)$/i;

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

async function addTag(apiKey, contactId, tag) {
  try {
    const res = await ghlFetch(`/contacts/${contactId}/tags`, apiKey, 'POST', { tags: [tag] });
    if (!res.ok) {
      console.warn(`[buyer-alert] add-tag failed status=${res.status} tag=${tag}`, res.body);
      return false;
    }
    console.log(`[buyer-alert] add-tag ok contact=${contactId} tag=${tag}`);
    return true;
  } catch (err) {
    console.error(`[buyer-alert] add-tag error tag=${tag}:`, err.message);
    return false;
  }
}

async function postNote(apiKey, contactId, noteBody) {
  try {
    const res = await ghlFetch(`/contacts/${contactId}/notes`, apiKey, 'POST', { body: noteBody });
    if (!res.ok) {
      console.warn(`[buyer-alert] post-note failed status=${res.status}`, res.body);
      return false;
    }
    console.log(`[buyer-alert] post-note ok contact=${contactId}`);
    return true;
  } catch (err) {
    console.error('[buyer-alert] post-note error:', err.message);
    return false;
  }
}

async function getContactTags(apiKey, contactId) {
  try {
    const res = await ghlFetch(`/contacts/${contactId}`, apiKey, 'GET');
    if (!res.ok) {
      console.warn(`[buyer-alert] get-contact failed status=${res.status}`);
      return null;
    }
    const contact = res.body && (res.body.contact || res.body);
    return contact || null;
  } catch (err) {
    console.error('[buyer-alert] get-contact error:', err.message);
    return null;
  }
}

/**
 * Send an SMS to Brooke via GHL. GHL's conversations/messages API needs a
 * contactId, so we look Brooke up by phone (one call, then we have the id).
 * All errors logged, never thrown.
 */
async function smsBrooke(apiKey, locationId, brookePhone, message) {
  if (!brookePhone) {
    console.warn('[buyer-alert] BROOKE_PHONE not configured — skipping Brooke SMS');
    return false;
  }
  if (!locationId) {
    console.warn('[buyer-alert] no locationId — skipping Brooke SMS');
    return false;
  }
  try {
    // 1. Look Brooke up (or upsert her) so we have a contactId
    const upsert = await ghlFetch('/contacts/upsert', apiKey, 'POST', {
      locationId,
      phone: brookePhone,
      firstName: 'Brooke',
      source: 'Buyer Alert Webhook',
    });
    if (!upsert.ok) {
      console.warn(`[buyer-alert] brooke upsert failed status=${upsert.status}`, upsert.body);
      return false;
    }
    const brookeId =
      (upsert.body && upsert.body.contact && upsert.body.contact.id) ||
      (upsert.body && upsert.body.id) ||
      null;
    if (!brookeId) {
      console.warn('[buyer-alert] no brooke contact id in upsert response');
      return false;
    }

    // 2. Send the SMS
    const sms = await ghlFetch('/conversations/messages', apiKey, 'POST', {
      type: 'SMS',
      locationId,
      contactId: brookeId,
      message,
    });
    if (!sms.ok) {
      console.warn(`[buyer-alert] brooke SMS failed status=${sms.status}`, sms.body);
      return false;
    }
    console.log('[buyer-alert] brooke SMS sent');
    return true;
  } catch (err) {
    console.error('[buyer-alert] brooke SMS error:', err.message);
    return false;
  }
}

/**
 * Pull the contact fields we care about from a GHL webhook payload.
 * GHL sends several variants — this handles both nested `contact` and flat.
 */
function extractContact(payload) {
  const c = (payload && payload.contact) || payload || {};
  return {
    id: c.id || c.contactId || c.contact_id || '',
    firstName: c.firstName || c.first_name || c.name || '',
    phone: c.phone || c.phoneNumber || '',
    tags: Array.isArray(c.tags) ? c.tags : [],
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;
  const brookePhone = process.env.BROOKE_PHONE;

  if (!apiKey) {
    console.error('[buyer-alert] GHL_API_KEY not configured');
    return respond(200, { success: false, warning: 'ghl_not_configured' });
  }

  // Parse webhook body
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.warn('[buyer-alert] invalid JSON body');
    return respond(200, { success: false, warning: 'invalid_json' });
  }

  const contact = extractContact(payload);
  if (!contact.id) {
    console.warn('[buyer-alert] no contact id in webhook payload');
    return respond(200, { success: false, warning: 'missing_contact_id' });
  }

  console.log(`[buyer-alert] received for contact=${contact.id} firstName="${contact.firstName}"`);

  // GHL webhook payloads don't always include tags — fetch them ourselves if missing.
  let tags = contact.tags;
  if (!tags || tags.length === 0) {
    console.log('[buyer-alert] no tags in payload — fetching contact from GHL');
    const fetched = await getContactTags(apiKey, contact.id);
    if (fetched) {
      tags = Array.isArray(fetched.tags) ? fetched.tags : [];
      if (!contact.firstName) contact.firstName = fetched.firstName || fetched.first_name || '';
      if (!contact.phone) contact.phone = fetched.phone || fetched.phoneNumber || '';
    } else {
      tags = [];
    }
  }

  // Find every sent-[DEAL-ID] tag. Uppercase the captured dealId for display
  // (GHL stores it lowercase so the raw match is lowercase).
  const dealIds = [];
  for (const t of tags) {
    const m = SENT_TAG_RE.exec(String(t || ''));
    if (!m) continue;
    const dealId = m[1].toUpperCase();
    if (dealIds.indexOf(dealId) === -1) dealIds.push(dealId);
  }
  console.log(`[buyer-alert] found ${dealIds.length} sent-tag(s): ${dealIds.join(', ') || '(none)'}`);

  const today = new Date().toISOString().split('T')[0];

  if (dealIds.length === 0) {
    // Fallback: no active sent- tags. Still log a note + alert Brooke.
    await postNote(apiKey, contact.id,
      `Buyer replied INTERESTED but no active deal tags found on ${today}. Check manually.`
    );
    const firstName = contact.firstName || 'A buyer';
    const phonePart = contact.phone ? ` (${contact.phone})` : '';
    await smsBrooke(apiKey, locationId, brookePhone,
      `🔴 BUYER ALERT: ${firstName}${phonePart} replied INTERESTED but no active sent- tags. Check GHL.`
    );
    return respond(200, { success: true, dealIds: [], fallback: true });
  }

  // Apply alert-[deal] tag + note for each deal
  for (const dealId of dealIds) {
    await addTag(apiKey, contact.id, `alert-${dealId}`);
    await postNote(apiKey, contact.id,
      `Buyer expressed interest in deal ${dealId} on ${today}`
    );
  }

  // SMS Brooke once with the full list
  const firstName = contact.firstName || 'A buyer';
  const phonePart = contact.phone ? ` (${contact.phone})` : '';
  const dealList = dealIds.join(', ');
  const smsMsg = `🔴 BUYER ALERT: ${firstName}${phonePart} is INTERESTED in ${dealList}. Check GHL.`;
  await smsBrooke(apiKey, locationId, brookePhone, smsMsg);

  console.log(`[buyer-alert] done — contact=${contact.id} deals=${dealList}`);
  return respond(200, { success: true, dealIds });
};
