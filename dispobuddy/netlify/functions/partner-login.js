/**
 * Dispo Buddy — Partner Login (with OTP)
 * POST /.netlify/functions/partner-login
 *
 * Two flows:
 *
 * 1. Request OTP: { action: 'request', phone | email }
 *    → Generates 6-digit code, stores it on GHL contact, sends via SMS
 *    → Returns { success: true, maskedPhone }
 *
 * 2. Verify OTP: { action: 'verify', phone | email, code }
 *    → Checks code against stored value and expiry (15 min)
 *    → Returns { success: true, partner }
 *
 * Legacy (no action): looks up by phone/email only, no OTP. Kept for
 * backward compat if any clients still call without action.
 *
 * Required env vars: GHL_API_KEY, GHL_LOCATION_ID
 * Optional: NOTIFICATIONS_LIVE (must be 'true' to send real SMS codes)
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const OTP_FIELD_KEY = 'portal_otp_code';    // stores "123456:1712345678000"
const OTP_EXPIRY_MS = 15 * 60 * 1000;       // 15 minutes

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const action = body.action || 'legacy';

  try {
    if (action === 'request') {
      return await handleRequest(body, ghlHeaders, locationId, headers);
    }
    if (action === 'verify') {
      return await handleVerify(body, ghlHeaders, locationId, headers);
    }
    // Legacy fallback
    return await handleLegacy(body, ghlHeaders, locationId, headers);
  } catch (err) {
    console.error('Partner login error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ─────────────────────────────────────────────────────────────
// STEP 1: REQUEST OTP
// ─────────────────────────────────────────────────────────────
async function handleRequest(body, ghlHeaders, locationId, respHeaders) {
  const contact = await findPartner(body, ghlHeaders, locationId);
  if (!contact.ok) {
    return { statusCode: contact.status, headers: respHeaders, body: JSON.stringify({ error: contact.error }) };
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;
  const storedValue = `${code}:${expiresAt}`;

  // Store code on the contact
  const updateRes = await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, {
    method: 'PUT',
    headers: ghlHeaders,
    body: JSON.stringify({
      customFields: [{ key: OTP_FIELD_KEY, field_value: storedValue }],
    }),
  });
  if (!updateRes.ok) {
    const errData = await updateRes.json().catch(() => ({}));
    console.warn('OTP store failed:', updateRes.status, JSON.stringify(errData).substring(0, 200));
    // Non-fatal — try to continue. If field doesn't exist, admin needs to create portal_otp_code field.
  }

  // Send the code via SMS (if live)
  const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
  if (isLive && contact.partner.phone) {
    try {
      await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify({
          type: 'SMS',
          contactId: contact.partner.id,
          message: `Your Dispo Buddy login code: ${code}\n\nExpires in 15 minutes. Don't share this with anyone.`,
        }),
      });
    } catch (err) {
      console.warn('OTP SMS send failed:', err.message);
    }
  } else {
    console.log('OTP (test mode — not sent via SMS):', code, 'for', contact.partner.id);
  }

  // Mask phone for UI feedback
  const phone = contact.partner.phone || '';
  const masked = phone.length > 4 ? '•••-•••-' + phone.slice(-4) : 'your phone';

  return {
    statusCode: 200,
    headers: respHeaders,
    body: JSON.stringify({
      success: true,
      maskedPhone: masked,
      testMode: !isLive,
      // Only return the code in test mode so dev can actually log in
      devCode: !isLive ? code : undefined,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// STEP 2: VERIFY OTP
// ─────────────────────────────────────────────────────────────
async function handleVerify(body, ghlHeaders, locationId, respHeaders) {
  if (!body.code || !/^\d{6}$/.test(body.code)) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Enter the 6-digit code.' }) };
  }

  const contact = await findPartner(body, ghlHeaders, locationId);
  if (!contact.ok) {
    return { statusCode: contact.status, headers: respHeaders, body: JSON.stringify({ error: contact.error }) };
  }

  // Fetch the contact's custom fields to read the stored code
  const fullRes = await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, { headers: ghlHeaders });
  const fullData = await fullRes.json();
  const fullContact = fullData.contact || fullData;
  const cfArray = fullContact.customFields || [];

  let stored = '';
  for (const f of cfArray) {
    const k = f.fieldKey || f.key || f.name || '';
    if (k === OTP_FIELD_KEY && /^\d{6}:\d+$/.test(f.value || '')) {
      stored = f.value;
      break;
    }
  }

  if (!stored) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'No code on file. Request a new one.' }) };
  }

  const [storedCode, expiresAt] = stored.split(':');
  if (Date.now() > parseInt(expiresAt, 10)) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
  }
  if (storedCode !== body.code) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Incorrect code.' }) };
  }

  // Clear the code so it can't be reused
  try {
    await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, {
      method: 'PUT',
      headers: ghlHeaders,
      body: JSON.stringify({ customFields: [{ key: OTP_FIELD_KEY, field_value: '' }] }),
    });
  } catch (err) { /* non-fatal */ }

  return {
    statusCode: 200,
    headers: respHeaders,
    body: JSON.stringify({
      success: true,
      partner: contact.partner,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// LEGACY: direct lookup without OTP (backward compat)
// ─────────────────────────────────────────────────────────────
async function handleLegacy(body, ghlHeaders, locationId, respHeaders) {
  const contact = await findPartner(body, ghlHeaders, locationId);
  if (!contact.ok) {
    return { statusCode: contact.status, headers: respHeaders, body: JSON.stringify({ error: contact.error }) };
  }
  return {
    statusCode: 200,
    headers: respHeaders,
    body: JSON.stringify({ success: true, partner: contact.partner }),
  };
}

// ─────────────────────────────────────────────────────────────
// FIND PARTNER (shared by request + verify + legacy)
// ─────────────────────────────────────────────────────────────
async function findPartner(body, ghlHeaders, locationId) {
  const phone = (body.phone || '').replace(/\D/g, '');
  const email = (body.email || '').trim().toLowerCase();

  if (!phone && !email) {
    return { ok: false, status: 400, error: 'Phone or email required' };
  }

  let contact = null;
  let firstMatchFallback = null;

  function pickBest(contacts) {
    if (!contacts || contacts.length === 0) return null;
    return contacts.find(c => {
      const tags = c.tags || [];
      return tags.some(t => t === 'dispo-buddy' || t === 'jv-partner');
    }) || null;
  }

  if (phone) {
    const phoneVariants = [phone];
    if (phone.length === 10) phoneVariants.push('+1' + phone, '1' + phone);
    if (phone.length === 11 && phone.startsWith('1')) phoneVariants.push('+' + phone, phone.substring(1));

    for (const variant of phoneVariants) {
      if (contact) break;
      const res = await fetch(
        `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(variant)}&limit=20`,
        { headers: ghlHeaders }
      );
      const data = await res.json();
      const results = data.contacts || [];
      if (results.length > 0 && !firstMatchFallback) firstMatchFallback = results[0];
      const tagged = pickBest(results);
      if (tagged) contact = tagged;
    }
  }

  if (!contact && email) {
    const res = await fetch(
      `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=20`,
      { headers: ghlHeaders }
    );
    const data = await res.json();
    const results = data.contacts || [];
    if (results.length > 0 && !firstMatchFallback) firstMatchFallback = results[0];
    const tagged = pickBest(results);
    if (tagged) contact = tagged;
  }

  if (!contact) {
    if (firstMatchFallback) {
      return {
        ok: false, status: 403,
        error: 'We found an account with that info, but it is not registered as a Dispo Buddy partner. Submit a deal first to activate your account: dispobuddy.com/submit-deal',
      };
    }
    return {
      ok: false, status: 404,
      error: 'No partner found with that phone or email. Have you submitted a deal yet?',
    };
  }

  const nameParts = [contact.firstName, contact.lastName].filter(Boolean);
  const fullName = nameParts.join(' ') || 'Partner';

  return {
    ok: true,
    partner: {
      id: contact.id,
      name: fullName,
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      email: contact.email || '',
      phone: contact.phone || '',
      tags: contact.tags || [],
    },
  };
}
