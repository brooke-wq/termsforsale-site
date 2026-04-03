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
    // Search by phone first, then email
    let contact = null;

    if (phone) {
      const searchRes = await fetch(
        `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}&limit=1`,
        { headers: ghlHeaders }
      );
      const searchData = await searchRes.json();
      if (searchData.contacts && searchData.contacts.length > 0) {
        contact = searchData.contacts[0];
      }
    }

    if (!contact && email) {
      const searchRes = await fetch(
        `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`,
        { headers: ghlHeaders }
      );
      const searchData = await searchRes.json();
      if (searchData.contacts && searchData.contacts.length > 0) {
        contact = searchData.contacts[0];
      }
    }

    if (!contact) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No partner found with that phone or email. Have you submitted a deal yet?' }) };
    }

    // Check for dispo-buddy tag
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
