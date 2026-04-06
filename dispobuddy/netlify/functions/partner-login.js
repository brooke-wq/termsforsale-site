/**
 * Dispo Buddy — Partner Login
 * POST /.netlify/functions/partner-login
 *
 * Looks up a partner by phone number in GHL contacts.
 * Returns contact info + verifies they have the 'dispo-buddy' tag.
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY      — GHL private integration API key
 *   GHL_LOCATION_ID  — GHL Location ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

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
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const phone = (body.phone || '').replace(/\D/g, '');
  const email = (body.email || '').trim().toLowerCase();

  if (!phone && !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone or email required' }) };
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Search GHL — try multiple phone formats and pick the contact tagged as a partner
    // (handles case where same phone exists on multiple contacts)
    let contact = null;
    let firstMatchFallback = null;

    function pickBestContact(contacts) {
      if (!contacts || contacts.length === 0) return null;
      // Prefer a contact tagged as dispo-buddy or jv-partner
      return contacts.find(c => {
        const tags = c.tags || [];
        return tags.some(t => t === 'dispo-buddy' || t === 'jv-partner');
      }) || null;
    }

    if (phone) {
      // GHL stores phones as +1XXXXXXXXXX — try with and without prefix
      const phoneVariants = [phone];
      if (phone.length === 10) phoneVariants.push('+1' + phone, '1' + phone);
      if (phone.length === 11 && phone.startsWith('1')) phoneVariants.push('+' + phone, phone.substring(1));

      for (const variant of phoneVariants) {
        if (contact) break;
        const searchRes = await fetch(
          `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(variant)}&limit=20`,
          { headers: ghlHeaders }
        );
        const searchData = await searchRes.json();
        const results = searchData.contacts || [];
        if (results.length > 0 && !firstMatchFallback) firstMatchFallback = results[0];
        const tagged = pickBestContact(results);
        if (tagged) contact = tagged;
      }
    }

    if (!contact && email) {
      const searchRes = await fetch(
        `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=20`,
        { headers: ghlHeaders }
      );
      const searchData = await searchRes.json();
      const results = searchData.contacts || [];
      if (results.length > 0 && !firstMatchFallback) firstMatchFallback = results[0];
      const tagged = pickBestContact(results);
      if (tagged) contact = tagged;
    }

    if (!contact) {
      // No tagged contact found, but we may have found contacts that aren't tagged
      if (firstMatchFallback) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'We found an account with that info, but it is not registered as a Dispo Buddy partner. Submit a deal first to activate your account: dispobuddy.com/submit-deal' }) };
      }
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No partner found with that phone or email. Have you submitted a deal yet?' }) };
    }

    // Tag check (redundant since pickBestContact already filtered, but kept for safety)
    const tags = contact.tags || [];
    const isPartner = tags.some(t => t === 'dispo-buddy' || t === 'jv-partner');

    if (!isPartner) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'This account is not registered as a Dispo Buddy partner.' }) };
    }

    const nameParts = [contact.firstName, contact.lastName].filter(Boolean);
    const fullName = nameParts.join(' ') || 'Partner';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        partner: {
          id: contact.id,
          name: fullName,
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          email: contact.email || '',
          phone: contact.phone || '',
          tags,
        },
      }),
    };
  } catch (err) {
    console.error('Partner login error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
