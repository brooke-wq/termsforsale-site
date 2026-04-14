// VIP Buyer QR funnel — creates/upserts contact in GHL with tags + custom fields
// POST /api/vip-buyer-submit

const { upsertContact, addTags, updateCustomFields, sendSMS, sendEmail, CF_IDS } = require('./_ghl');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Server config error' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { firstName, email, phone, buyType, priceRange, market, funding, source } = data;

  if (!firstName || !email || !phone) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // 1. Upsert contact
  const upsertRes = await upsertContact(apiKey, locationId, {
    firstName: firstName,
    email: email,
    phone: phone,
    source: source || 'Cowork QR Buyer',
    tags: ['Source: Cowork QR Buyer', 'VIP Buyer List', 'use:buyer', 'opt in']
  });

  if (upsertRes.status >= 400) {
    console.error('Upsert failed:', JSON.stringify(upsertRes.body));
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'GHL upsert failed' }) };
  }

  const contactId = upsertRes.body.contact
    ? upsertRes.body.contact.id
    : (upsertRes.body.id || null);

  if (!contactId) {
    console.error('No contactId in upsert response:', JSON.stringify(upsertRes.body));
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'No contact ID returned' }) };
  }

  // 2. Add tags (ensure they stick even if upsert didn't apply them)
  const tags = ['Source: Cowork QR Buyer', 'VIP Buyer List', 'use:buyer', 'buyer-signup', 'opt in'];
  if (buyType && buyType.length) {
    buyType.forEach(function(t) {
      if (t === 'Fix & Flip') tags.push('use:fix-flip');
      if (t === 'Rentals') tags.push('use:rental-buyer');
      if (t === 'Creative Finance') tags.push('use:creative-finance');
      if (t === 'Wholetail') tags.push('use:wholetail');
    });
  }
  await addTags(apiKey, contactId, tags);

  // 3. Update custom fields
  const customFields = [];

  if (buyType && buyType.length) {
    customFields.push({ id: CF_IDS.BUYER_TYPE, field_value: buyType.join(', ') });
    customFields.push({ id: CF_IDS.DEAL_STRUCTURES, field_value: buyType.join(', ') });
  }
  if (priceRange) {
    customFields.push({ id: CF_IDS.MAX_PRICE, field_value: priceRange });
  }
  if (market) {
    customFields.push({ id: CF_IDS.TARGET_MARKETS, field_value: market });
    customFields.push({ id: CF_IDS.TARGET_CITIES, field_value: market });
  }

  if (customFields.length) {
    await updateCustomFields(apiKey, contactId, customFields);
  }

  // Send confirmation SMS
  if (phone && contactId) {
    try {
      await sendSMS(apiKey, locationId, phone,
        'Welcome to the Terms For Sale VIP list, ' + firstName + '! You\'ll get first access to our best off-market deals. Browse now: https://termsforsale.com');
      console.log('[vip-buyer-submit] confirmation SMS sent to ' + phone);
    } catch (e) {
      console.warn('[vip-buyer-submit] SMS failed:', e.message);
    }
  }

  // Send welcome email
  if (email && contactId) {
    try {
      await sendEmail(apiKey, contactId,
        'You\'re on the VIP list, ' + firstName + '!',
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
        + '<div style="background:#0D1F3C;padding:24px 32px;border-radius:12px 12px 0 0"><img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:36px"></div>'
        + '<div style="padding:32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
        + '<h2 style="color:#0D1F3C;margin:0 0 12px">Welcome to the VIP List, ' + firstName + '!</h2>'
        + '<p style="color:#4A5568;line-height:1.6;margin:0 0 20px">You\'re now on our priority list for off-market deals. As a VIP buyer, you get:</p>'
        + '<ul style="color:#4A5568;line-height:1.8;margin:0 0 24px;padding-left:20px">'
        + '<li><strong>First access</strong> to new deals before the general list</li>'
        + '<li><strong>Deal alerts</strong> matched to your buy box via SMS + email</li>'
        + '<li><strong>Direct access</strong> to our acquisitions team</li>'
        + '</ul>'
        + '<a href="https://termsforsale.com" style="display:inline-block;padding:14px 28px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Browse Deals Now →</a>'
        + '<p style="color:#718096;font-size:13px;margin-top:24px">Reply to this email anytime — we\'re real people.</p>'
        + '</div></div>'
      );
      console.log('[vip-buyer-submit] welcome email sent to ' + email);
    } catch (e) {
      console.warn('[vip-buyer-submit] email failed:', e.message);
    }
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true, contactId: contactId })
  };
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}
