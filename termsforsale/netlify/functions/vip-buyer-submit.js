// VIP Buyer QR funnel — creates/upserts contact in GHL with tags + custom fields
// POST /api/vip-buyer-submit

const { upsertContact, addTags, updateCustomFields, CF_IDS } = require('./_ghl');

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
    tags: ['Source: Cowork QR Buyer', 'VIP Buyer List', 'use:buyer']
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
  const tags = ['Source: Cowork QR Buyer', 'VIP Buyer List', 'use:buyer', 'buyer-signup'];
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
