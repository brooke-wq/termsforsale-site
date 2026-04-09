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
const OTP_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

// OTP is stored as "OTP:CODE:EXPIRY" — unique prefix avoids collision with TFS reset codes
function encodeOtp(code, expiresAt) { return `OTP:${code}:${expiresAt}`; }
function decodeOtp(val) {
  const m = /^OTP:(\d{6}):(\d+)$/.exec(val || '');
  return m ? { code: m[1], expiresAt: parseInt(m[2], 10) } : null;
}

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
  const storedValue = encodeOtp(code, expiresAt);

  // Get field map so we can use the field's actual ID (not just key name)
  const fieldMap = await getCustomFieldMap(locationId, ghlHeaders);
  let fieldId = findOtpFieldId(fieldMap);

  // If field doesn't exist yet, create it
  if (!fieldId) {
    console.log('[partner-login] portal_otp_code field not found — creating it');
    fieldId = await createOtpField(locationId, ghlHeaders);
    if (fieldId) console.log('[partner-login] Created portal_otp_code field:', fieldId);
  }

  // Build the custom field payload — prefer ID-based (reliable), fall back to key-based
  const cfPayload = fieldId
    ? [{ id: fieldId, value: storedValue }]
    : [{ key: 'portal_otp_code', field_value: storedValue }];

  console.log('[partner-login] Storing OTP on contact', contact.partner.id, '— fieldId:', fieldId || 'none (using key)');

  const updateRes = await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, {
    method: 'PUT',
    headers: ghlHeaders,
    body: JSON.stringify({ customFields: cfPayload }),
  });

  if (!updateRes.ok) {
    const errData = await updateRes.json().catch(() => ({}));
    console.error('[partner-login] OTP store FAILED:', updateRes.status, JSON.stringify(errData).substring(0, 300));

    // If ID-based failed, try key-based as fallback
    if (fieldId) {
      console.log('[partner-login] Retrying with key-based format...');
      const retryRes = await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, {
        method: 'PUT',
        headers: ghlHeaders,
        body: JSON.stringify({ customFields: [{ key: 'portal_otp_code', field_value: storedValue }] }),
      });
      const retryData = await retryRes.json().catch(() => ({}));
      console.log('[partner-login] Key retry result:', retryRes.status, JSON.stringify(retryData).substring(0, 200));
    }
  } else {
    const updateData = await updateRes.json().catch(() => ({}));
    console.log('[partner-login] OTP stored successfully. Status:', updateRes.status,
      '— contact customFields count:', (updateData.contact?.customFields || updateData.customFields || []).length);
  }

  // Send the code via SMS (if live)
  const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
  if (isLive && contact.partner.phone) {
    try {
      const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify({
          type: 'SMS',
          contactId: contact.partner.id,
          message: `Your Dispo Buddy login code: ${code}\n\nExpires in 15 minutes. Don't share this with anyone.`,
        }),
      });
      if (!smsRes.ok) {
        const smsErr = await smsRes.json().catch(() => ({}));
        console.warn('[partner-login] SMS send failed:', smsRes.status, JSON.stringify(smsErr).substring(0, 200));
      } else {
        console.log('[partner-login] OTP SMS sent to', contact.partner.phone);
      }
    } catch (err) {
      console.warn('[partner-login] OTP SMS error:', err.message);
    }
  } else {
    console.log('[partner-login] OTP (NOTIFICATIONS_LIVE is off — not sent via SMS):', code, 'for contact', contact.partner.id);
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

  // Fetch the contact's full data (including custom fields)
  const fullRes = await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, { headers: ghlHeaders });
  const fullData = await fullRes.json();
  const fullContact = fullData.contact || fullData;
  const cfArray = fullContact.customFields || [];

  console.log('[partner-login] Verify — contact', contact.partner.id, '— customFields count:', cfArray.length);

  // Log all custom field values to help debug
  for (const f of cfArray) {
    if (f.value) {
      console.log('[partner-login] CF:', f.id || '?', '|', f.fieldKey || f.key || f.name || '?', '=', String(f.value).substring(0, 30));
    }
  }

  // Find the OTP field — match by unique "OTP:" prefix in value (avoids key name issues)
  let stored = '';
  for (const f of cfArray) {
    const val = f.value || '';
    if (decodeOtp(val)) {
      stored = val;
      console.log('[partner-login] Found OTP value on field:', f.id || '?', f.fieldKey || f.key || f.name || '?');
      break;
    }
  }

  if (!stored) {
    console.warn('[partner-login] No OTP found in customFields. Field count:', cfArray.length,
      '— Fields with values:', cfArray.filter(f => f.value).length);
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'No code on file. Request a new one.' }) };
  }

  const parsed = decodeOtp(stored);
  if (!parsed) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Invalid code format. Request a new one.' }) };
  }

  if (Date.now() > parsed.expiresAt) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
  }

  if (parsed.code !== body.code) {
    console.log('[partner-login] Code mismatch. Entered:', body.code, '— Stored:', parsed.code);
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Incorrect code.' }) };
  }

  // Clear the code so it can't be reused
  try {
    const fieldMap = await getCustomFieldMap(locationId, ghlHeaders);
    const fieldId = findOtpFieldId(fieldMap);
    const clearPayload = fieldId
      ? [{ id: fieldId, value: '' }]
      : [{ key: 'portal_otp_code', field_value: '' }];
    await fetch(`${GHL_BASE}/contacts/${contact.partner.id}`, {
      method: 'PUT',
      headers: ghlHeaders,
      body: JSON.stringify({ customFields: clearPayload }),
    });
  } catch (err) { /* non-fatal */ }

  console.log('[partner-login] OTP verified for', contact.partner.name, '(', contact.partner.id, ')');

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

// ─────────────────────────────────────────────────────────────
// GHL CUSTOM FIELD HELPERS
// ─────────────────────────────────────────────────────────────

/** Fetch all location custom fields and return { key/name → id } map */
async function getCustomFieldMap(locationId, ghlHeaders) {
  const map = {};
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}/customFields`, { headers: ghlHeaders });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const fields = data.customFields || data.fields || [];
      for (const f of fields) {
        const key = f.fieldKey || f.key || f.name;
        const id  = f.id;
        if (key && id) map[key] = id;
        // Also store lowercase name for looser matching
        if (f.name && id) map[f.name.toLowerCase()] = id;
      }
      console.log('[partner-login] Custom field map: loaded', Object.keys(map).length, 'fields');
    } else {
      console.warn('[partner-login] Custom field lookup failed:', res.status);
    }
  } catch (err) {
    console.warn('[partner-login] Custom field lookup error:', err.message);
  }
  return map;
}

/** Find the OTP field ID from the field map, checking multiple possible key names */
function findOtpFieldId(fieldMap) {
  return fieldMap['portal_otp_code']
    || fieldMap['contact.portal_otp_code']
    || fieldMap['portal otp code']
    || fieldMap['portal_otp_code'.toLowerCase()]
    || null;
}

/** Create the portal_otp_code custom field in GHL if it doesn't exist */
async function createOtpField(locationId, ghlHeaders) {
  try {
    const res = await fetch(`${GHL_BASE}/locations/${locationId}/customFields`, {
      method: 'POST',
      headers: ghlHeaders,
      body: JSON.stringify({
        name: 'portal_otp_code',
        dataType: 'TEXT',
        model: 'contact',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const id = data.customField?.id || data.id;
      console.log('[partner-login] Created portal_otp_code field, id:', id);
      return id || null;
    } else {
      console.warn('[partner-login] Failed to create OTP field:', res.status, JSON.stringify(data).substring(0, 200));
      return null;
    }
  } catch (err) {
    console.warn('[partner-login] OTP field creation error:', err.message);
    return null;
  }
}
