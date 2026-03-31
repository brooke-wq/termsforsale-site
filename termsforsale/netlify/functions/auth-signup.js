/**
 * Auth Signup — POST /.netlify/functions/auth-signup
 * Creates/upserts contact in GHL via API, returns verified user data.
 *
 * ENV VARS REQUIRED:
 *   GHL_API_KEY      — GoHighLevel API key
 *   GHL_LOCATION_ID  — GoHighLevel location/sub-account ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { firstName, lastName, email, phone, password, deal_structure, source } = body;

  if (!firstName || !email || !phone || !password) {
    return respond(400, { error: 'Missing required fields: firstName, email, phone, password' });
  }
  if (password.length < 6) {
    return respond(400, { error: 'Password must be at least 6 characters' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // 1. Check if contact already exists
    const existing = await findContactByEmail(email, locationId, headers);
    if (existing) {
      // Contact exists — return their data (treat as login)
      return respond(200, {
        success: true,
        exists: true,
        user: {
          id: existing.id,
          name: existing.firstName || existing.firstNameLowerCase || '',
          firstName: existing.firstName || '',
          lastName: existing.lastName || '',
          email: existing.email,
          phone: existing.phone || '',
          initials: getInitials(existing.firstName, existing.lastName),
        }
      });
    }

    // 2. Create contact via upsert
    const contactPayload = {
      locationId,
      firstName,
      lastName: lastName || '',
      email,
      phone,
      source: source || 'TFS Website - Signup',
      tags: ['TFS Buyer', 'Website Signup'],
      customFields: [],
    };

    if (deal_structure) {
      contactPayload.customFields.push({
        key: 'deal_structure',
        field_value: deal_structure,
      });
    }

    const res = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const data = await res.json();

    if (!res.ok) {
      console.error('Contact upsert failed:', JSON.stringify(data));
      return respond(502, { error: 'Failed to create account' });
    }

    const contactId = data.contact?.id || data.id;

    // 3. Also fire the signup webhook so GHL workflows trigger
    // (portal account creation, welcome email, etc.)
    const webhookUrl = 'https://services.leadconnectorhq.com/hooks/' + locationId + '/webhook-trigger/88c6d9de-eb76-45ef-ac83-db284b7da5ac';
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, lastName: lastName || '', email, phone, password,
          deal_structure: deal_structure || '',
          source: source || 'TFS Website - Signup',
          pipeline_name: 'Buyer Inquiries',
          pipeline_stage: 'New Lead',
          tags: ['TFS Buyer', 'Website Signup'],
        }),
      });
    } catch (e) {
      console.warn('Webhook fire failed (non-critical):', e.message);
    }

    return respond(200, {
      success: true,
      exists: false,
      user: {
        id: contactId,
        name: firstName,
        firstName,
        lastName: lastName || '',
        email,
        phone,
        initials: getInitials(firstName, lastName),
      }
    });

  } catch (err) {
    console.error('Signup error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

// ─── Find contact by email via GHL API ─────────────────────
async function findContactByEmail(email, locationId, headers) {
  const url = `${GHL_BASE}/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(email)}`;
  const res = await ghlFetch(url, 'GET', null, headers);
  if (!res.ok) return null;
  const data = await res.json();
  return data.contact || null;
}

// ─── Helpers ────────────────────────────────────────────────
function getInitials(first, last) {
  const f = (first || '')[0] || '';
  const l = (last || '')[0] || '';
  return (f + l).toUpperCase() || 'B';
}

async function ghlFetch(url, method, body, headers) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
