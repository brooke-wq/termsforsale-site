/**
 * Dispo Buddy — Affiliate Click / Conversion Tracker
 * POST /.netlify/functions/affiliate-track
 *
 * Logs an affiliate event (click, signup, deal_submitted, deal_closed) and
 * updates the affiliate contact's counters + note trail in GHL.
 *
 * Body shape:
 *   {
 *     affiliate_id:   "john-doe-a7x3",  // required
 *     event:          "click" | "signup" | "deal_submitted" | "deal_closed",
 *     landing_page:   "/join",
 *     referrer:       "https://...",
 *     utm_source:     "...",
 *     utm_medium:     "...",
 *     utm_campaign:   "...",
 *     user_agent:     "...",
 *     referred_name:  "Jane Doe",         // for signup/deal events
 *     referred_email: "jane@example.com", // for signup/deal events
 *     deal_value:     50000               // for deal_closed (commission calc)
 *   }
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY, GHL_LOCATION_ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

// Commission structure constants (tweak here to change program economics)
const COMMISSION = {
  SIGNUP_FLAT:        0,     // nothing on raw signup — only on qualified first deal close
  FIRST_DEAL_FLAT:    200,   // $200 when referred partner closes first deal within 6 months
  CLOSED_DEAL_RATE:   0.05,  // 5% of net dispo fee for 12 months
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const affiliate_id = normalizeId(body.affiliate_id);
  const eventType    = (body.event || 'click').toLowerCase();

  if (!affiliate_id) {
    return respond(400, { error: 'Missing affiliate_id' });
  }
  const allowedEvents = ['click', 'signup', 'deal_submitted', 'deal_closed'];
  if (!allowedEvents.includes(eventType)) {
    return respond(400, { error: 'Invalid event type' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
  };

  try {
    // ── 1. Find affiliate contact by affiliate_id custom field ──
    const affiliateContact = await findAffiliate(affiliate_id, headers, locationId);
    if (!affiliateContact) {
      console.warn(`Affiliate not found: ${affiliate_id}`);
      // Still return 200 so client beacons don't bloat error logs
      return respond(200, { ok: true, matched: false, affiliate_id });
    }

    const contactId = affiliateContact.id;
    const currentFields = parseAffiliateCounters(affiliateContact);

    // ── 2. Increment counters based on event type ──────────────
    const nextFields = { ...currentFields };
    let commissionDelta = 0;

    if (eventType === 'click') {
      nextFields.affiliate_clicks = String((parseInt(currentFields.affiliate_clicks, 10) || 0) + 1);
    } else if (eventType === 'signup') {
      nextFields.affiliate_signups = String((parseInt(currentFields.affiliate_signups, 10) || 0) + 1);
    } else if (eventType === 'deal_submitted') {
      nextFields.affiliate_deals_submitted = String((parseInt(currentFields.affiliate_deals_submitted, 10) || 0) + 1);
      // First-deal bonus: only pay once per referred lead
      if (body.first_deal === true || body.first_deal === 'Yes') {
        commissionDelta += COMMISSION.FIRST_DEAL_FLAT;
      }
    } else if (eventType === 'deal_closed') {
      nextFields.affiliate_deals_closed = String((parseInt(currentFields.affiliate_deals_closed, 10) || 0) + 1);
      const dealValue = parseFloat(body.deal_value || 0) || 0;
      commissionDelta += dealValue * COMMISSION.CLOSED_DEAL_RATE;
    }

    if (commissionDelta > 0) {
      const earned = parseFloat(currentFields.affiliate_commission_earned || 0) || 0;
      nextFields.affiliate_commission_earned = String(+(earned + commissionDelta).toFixed(2));
    }
    nextFields.affiliate_last_event    = `${eventType}@${new Date().toISOString()}`;

    // ── 3. Write updated counters back to GHL ──────────────────
    const updatePayload = {
      customFields: Object.entries(nextFields).map(([key, field_value]) => ({
        key,
        field_value: String(field_value),
      })),
    };
    const updateRes = await ghlFetch(
      `${GHL_BASE}/contacts/${contactId}`,
      'PUT',
      updatePayload,
      headers
    );
    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      console.warn('Affiliate counter update failed:', JSON.stringify(updateData));
    }

    // ── 4. Leave an audit note on high-value events only ───────
    if (eventType !== 'click') {
      const parts = [];
      parts.push(`📊 AFFILIATE EVENT: ${eventType}`);
      if (body.referred_name)  parts.push(`Referred: ${body.referred_name}`);
      if (body.referred_email) parts.push(`Email: ${body.referred_email}`);
      if (body.deal_value)     parts.push(`Deal value: $${body.deal_value}`);
      if (commissionDelta > 0) parts.push(`Commission +$${commissionDelta.toFixed(2)}`);
      if (body.landing_page)   parts.push(`Page: ${body.landing_page}`);
      await addNote(contactId, headers, parts.join('\n'))
        .catch(err => console.warn('Affiliate note failed:', err.message));
    }

    console.log('Affiliate event:', JSON.stringify({
      affiliate_id, event: eventType, contactId, commissionDelta,
    }));

    return respond(200, {
      ok: true,
      matched: true,
      affiliate_id,
      event: eventType,
      commission_delta: commissionDelta,
    });

  } catch (err) {
    console.error('Affiliate track error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function normalizeId(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

/**
 * Find an affiliate contact by scanning contacts for the `affiliate_id`
 * custom field match. Uses GHL search endpoint with the affiliate_id as a
 * query token (GHL searches custom field values by default).
 */
async function findAffiliate(affiliateId, headers, locationId) {
  const url = `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(affiliateId)}&limit=20`;
  const res = await ghlFetch(url, 'GET', null, headers);
  const data = await res.json();
  const contacts = data.contacts || [];
  for (const c of contacts) {
    const fields = c.customFields || c.customField || [];
    for (const f of fields) {
      const key = f.key || f.name || '';
      const val = f.field_value || f.value || '';
      if (key === 'affiliate_id' && String(val).trim().toLowerCase() === affiliateId) {
        return c;
      }
    }
  }
  return null;
}

function parseAffiliateCounters(contact) {
  const out = {};
  const fields = contact.customFields || contact.customField || [];
  for (const f of fields) {
    const key = f.key || f.name || '';
    const val = f.field_value || f.value || '';
    if (key && key.indexOf('affiliate_') === 0) out[key] = val;
  }
  return out;
}

async function addNote(contactId, headers, body) {
  const res = await ghlFetch(`${GHL_BASE}/contacts/${contactId}/notes`, 'POST', { body }, headers);
  return res.json();
}

async function ghlFetch(url, method, payload, headers) {
  const opts = { method, headers };
  if (payload && method !== 'GET') opts.body = JSON.stringify(payload);
  return fetch(url, opts);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}
