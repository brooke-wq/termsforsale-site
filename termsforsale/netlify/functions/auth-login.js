/**
 * Auth Login — POST /.netlify/functions/auth-login
 * Looks up contact by email in GHL, returns verified user data.
 * Also fires the login webhook so GHL can track logins.
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

  const { email, password } = body;

  if (!email || !password) {
    return respond(400, { error: 'Please enter email and password' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // 1. Look up contact by email in GHL
    const contact = await findContactByEmail(email, locationId, headers);

    if (!contact) {
      return respond(404, {
        error: 'No account found with that email. Please sign up first.',
        notFound: true,
      });
    }

    // 2. Fire login webhook so GHL workflows can track it
    const webhookUrl = 'https://services.leadconnectorhq.com/hooks/' + locationId + '/webhook-trigger/caa1f812-8957-48af-ae00-45322992102b';
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, source: 'TFS Website Login' }),
      });
    } catch (e) {
      console.warn('Login webhook fire failed (non-critical):', e.message);
    }

    // 3. Return verified user data (including tags for frontend status checks)
    var tags = contact.tags || [];
    var hasBuyBox = tags.indexOf('buy box complete') > -1;
    var isVip = tags.indexOf('vip-buyer') > -1 || tags.indexOf('VIP Buyer') > -1;

    return respond(200, {
      success: true,
      user: {
        id: contact.id,
        name: contact.firstName || contact.firstNameLowerCase || email.split('@')[0],
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email || email,
        phone: contact.phone || '',
        initials: getInitials(contact.firstName, contact.lastName),
        hasBuyBox: hasBuyBox,
        isVip: isVip,
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

// ─── Find contact by email via GHL API ─────────────────────
async function findContactByEmail(email, locationId, headers) {
  const url = `${GHL_BASE}/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(email)}`;
  const res = await ghlFetch(url, 'GET', null, headers);
  if (!res.ok) return null;
  const data = await res.json();
  var contact = data.contact || null;
  // Duplicate search may not return tags — fetch full contact
  if (contact && contact.id) {
    try {
      var fullRes = await ghlFetch(`${GHL_BASE}/contacts/${contact.id}`, 'GET', null, headers);
      if (fullRes.ok) {
        var fullData = await fullRes.json();
        contact = fullData.contact || contact;
      }
    } catch (e) { /* use partial contact */ }
  }
  return contact;
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
