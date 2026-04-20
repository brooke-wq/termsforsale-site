/**
 * Auth Signup — POST /.netlify/functions/auth-signup
 * Creates/upserts contact in GHL via API, returns verified user data.
 * Hashes password and stores on contact custom field for real auth.
 *
 * ENV VARS REQUIRED:
 *   GHL_API_KEY      — GoHighLevel API key
 *   GHL_LOCATION_ID  — GoHighLevel location/sub-account ID
 */

const crypto = require('crypto');
const GHL_BASE = 'https://services.leadconnectorhq.com';

function hashPassword(pw) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  var parts = stored.split(':');
  if (parts.length !== 2) return false;
  var hash = crypto.pbkdf2Sync(pw, parts[0], 10000, 64, 'sha512').toString('hex');
  return hash === parts[1];
}

// GHL v2 API rejects raw 10-digit US numbers — requires E.164 (+1XXXXXXXXXX).
// Strips non-digits, prefixes +1 for 10-digit US, prefixes + for 11-digit
// starting with 1. Returns original input if it can't confidently format.
function normalizePhone(raw) {
  if (!raw) return raw;
  var s = String(raw).trim();
  if (s.charAt(0) === '+') return s;
  var digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return s;
}

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

  const { firstName, lastName, email, password, deal_structure, deal_structures, max_entry_fee, source } = body;
  const rawPhone = body.phone;
  const phone = normalizePhone(rawPhone);

  if (!firstName || !email || !rawPhone || !password) {
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
      tags: ['TFS Buyer', 'Website Signup', 'buyer-signup', 'opt in'],
      customFields: [],
    };

    // CRITICAL: Set Contact Role = ['Buyer'] so notify-buyers.js picks them up
    // in its buyer scan. Without this, new website signups are INVISIBLE to the
    // deal blast matcher. Field id matches CF.CONTACT_ROLE in notify-buyers.js.
    contactPayload.customFields.push({
      id: 'agG4HMPB5wzsZXiRxfmR',
      field_value: ['Buyer'],
    });

    // Deal structures — multi-select from signup form or single from legacy
    var structureValue = deal_structures || deal_structure || '';
    if (structureValue) {
      contactPayload.customFields.push({
        key: 'deal_structure',
        field_value: structureValue,
      });
    }
    if (max_entry_fee) {
      contactPayload.customFields.push({
        key: 'max_entry_fee',
        field_value: max_entry_fee,
      });
    }

    // Hash password and store on contact
    var hashedPw = hashPassword(password);
    contactPayload.customFields.push({
      key: 'tfs_password_hash',
      field_value: hashedPw,
    });

    const res = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const data = await res.json();

    if (!res.ok) {
      console.error('Contact upsert failed:', res.status, JSON.stringify(data), 'payload:', JSON.stringify({
        email, phone, rawPhone, firstName, lastName,
      }));

      // Phone already on another contact — look them up and treat as existing.
      const phoneDup = await findContactByPhone(phone, locationId, headers);
      if (phoneDup) {
        return respond(200, {
          success: true,
          exists: true,
          user: {
            id: phoneDup.id,
            name: phoneDup.firstName || phoneDup.firstNameLowerCase || '',
            firstName: phoneDup.firstName || '',
            lastName: phoneDup.lastName || '',
            email: phoneDup.email || email,
            phone: phoneDup.phone || phone,
            initials: getInitials(phoneDup.firstName, phoneDup.lastName),
          },
        });
      }

      // Surface the real GHL message so the user has something actionable
      // ("Phone number is invalid", "Email already exists", etc.)
      var ghlMsg = (data && (data.message || data.error)) ||
        (Array.isArray(data && data.errors) ? data.errors.map(function(e) { return e.message || e; }).join(', ') : '');
      return respond(502, {
        error: ghlMsg || 'Failed to create account. Please try again or contact support.',
        ghlStatus: res.status,
      });
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
          deal_structure: structureValue || '',
          max_entry_fee: max_entry_fee || '',
          source: source || 'TFS Website - Signup',
          pipeline_name: 'Buyer Inquiries',
          pipeline_stage: 'New Lead',
          tags: ['TFS Buyer', 'Website Signup', 'opt in'],
        }),
      });
    } catch (e) {
      console.warn('Webhook fire failed (non-critical):', e.message);
    }

    // Send welcome SMS + email in parallel
    var smsStatus = 'skipped', emailStatus = 'skipped';

    var welcomeHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
      + '<div style="background:#0D1F3C;padding:24px 32px;border-radius:12px 12px 0 0"><img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:36px"></div>'
      + '<div style="padding:32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
      + '<h2 style="color:#0D1F3C;margin:0 0 12px">Welcome, ' + firstName + '!</h2>'
      + '<p style="color:#4A5568;line-height:1.6;margin:0 0 20px">You now have access to our exclusive off-market deal inventory.</p>'
      + '<ul style="color:#4A5568;line-height:1.8;margin:0 0 24px;padding-left:20px">'
      + '<li><strong>Browse deals</strong> updated daily</li>'
      + '<li><strong>Set your buy box</strong> for automatic matching</li>'
      + '<li><strong>Get SMS/email alerts</strong> when deals fit your criteria</li>'
      + '</ul>'
      + '<a href="https://termsforsale.com/deals.html" style="display:inline-block;padding:14px 28px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Browse Deals Now</a>'
      + '<p style="color:#4A5568;line-height:1.6;margin:20px 0 12px"><strong>Next step:</strong> <a href="https://termsforsale.com/buying-criteria.html" style="color:#29ABE2;font-weight:600">Set your buying criteria</a> so we can match you to the right deals automatically.</p>'
      + '<p style="color:#718096;font-size:13px;margin-top:24px">Questions? Reply to this email anytime.</p>'
      + '</div></div>';

    var sends = [];

    if (phone && contactId) {
      sends.push(
        ghlFetch(GHL_BASE + '/conversations/messages', 'POST', {
          type: 'SMS', contactId,
          message: 'Welcome to Terms For Sale, ' + firstName + '! Browse deals: https://termsforsale.com/deals.html — Set your buy box: https://termsforsale.com/buying-criteria.html'
        }, headers).then(function(r) { smsStatus = r.ok ? 'sent' : 'failed:' + r.status; return r; })
        .catch(function(e) { smsStatus = 'error:' + e.message; })
      );
    }

    if (email && contactId) {
      sends.push(
        ghlFetch(GHL_BASE + '/conversations/messages', 'POST', {
          type: 'Email', contactId,
          subject: 'Welcome to Terms For Sale, ' + firstName + '!',
          html: welcomeHtml,
          emailFrom: 'Terms For Sale <info@termsforsale.com>'
        }, headers).then(function(r) { emailStatus = r.ok ? 'sent' : 'failed:' + r.status; return r; })
        .catch(function(e) { emailStatus = 'error:' + e.message; })
      );
    }

    await Promise.all(sends);
    console.log('[auth-signup] SMS=' + smsStatus + ' Email=' + emailStatus + ' contact=' + contactId);

    return respond(200, {
      success: true,
      exists: false,
      smsStatus,
      emailStatus,
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

async function findContactByPhone(phone, locationId, headers) {
  if (!phone) return null;
  const url = `${GHL_BASE}/contacts/search/duplicate?locationId=${locationId}&number=${encodeURIComponent(phone)}`;
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
