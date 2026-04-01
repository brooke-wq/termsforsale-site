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
      tags: ['TFS Buyer', 'Website Signup', 'buyer-signup'],
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

    // Send welcome SMS
    if (phone && contactId) {
      try {
        await fetch(GHL_BASE + '/conversations/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'SMS',
            contactId,
            message: 'Welcome to Terms For Sale, ' + firstName + '! Browse off-market deals: https://deals.termsforsale.com — Reply STOP to opt out.'
          })
        });
        console.log('[auth-signup] welcome SMS sent to ' + phone);
      } catch (e) {
        console.warn('[auth-signup] SMS failed:', e.message);
      }
    }

    // Send welcome email
    if (email && contactId) {
      try {
        await fetch(GHL_BASE + '/conversations/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'Email',
            contactId,
            subject: 'Welcome to Terms For Sale, ' + firstName + '!',
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
              + '<div style="background:#0D1F3C;padding:24px 32px;border-radius:12px 12px 0 0"><img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:36px"></div>'
              + '<div style="padding:32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
              + '<h2 style="color:#0D1F3C;margin:0 0 12px">Welcome, ' + firstName + '!</h2>'
              + '<p style="color:#4A5568;line-height:1.6;margin:0 0 20px">You now have access to our exclusive off-market deal inventory. Here\'s what you can do:</p>'
              + '<ul style="color:#4A5568;line-height:1.8;margin:0 0 24px;padding-left:20px">'
              + '<li><strong>Browse deals</strong> updated daily from our acquisition pipeline</li>'
              + '<li><strong>Set your buy box</strong> so we match you to the right deals automatically</li>'
              + '<li><strong>Get SMS/email alerts</strong> the moment a deal fits your criteria</li>'
              + '</ul>'
              + '<a href="https://deals.termsforsale.com" style="display:inline-block;padding:14px 28px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Browse Deals Now →</a>'
              + '<p style="color:#718096;font-size:13px;margin-top:24px">Questions? Reply to this email or text us anytime.</p>'
              + '</div></div>',
            emailFrom: 'Brooke Froehlich <brooke@mydealpros.com>'
          })
        });
        console.log('[auth-signup] welcome email sent to ' + email);
      } catch (e) {
        console.warn('[auth-signup] email failed:', e.message);
      }
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
