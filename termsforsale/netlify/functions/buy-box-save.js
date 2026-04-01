// Netlify function: buy-box-save
// POST /api/buy-box-save
// Receives buy box data from frontend, upserts contact in GHL
// with properly mapped custom fields via the API (not webhook).
//
// ENV VARS: GHL_API_KEY, GHL_LOCATION_ID

const { upsertContact, addTags, updateCustomFields, postNote, sendSMS } = require('./_ghl');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  var ghlKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  var brookePhone = process.env.BROOKE_PHONE;

  if (!ghlKey || !locationId) return respond(500, { error: 'Missing env vars' });

  var body;
  try { body = JSON.parse(event.body); } catch(e) { return respond(400, { error: 'Invalid JSON' }); }

  if (!body.email && !body.phone) return respond(400, { error: 'email or phone required' });

  try {
    // 1. Upsert contact
    var upsertRes = await upsertContact(ghlKey, locationId, {
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      email: body.email || undefined,
      phone: body.phone || undefined,
      source: body.source || 'TFS Buy Box',
      tags: body.tags || ['tfs buyer', 'buy box complete', 'buyer-signup']
    });

    var contactId = null;
    if (upsertRes.body && (upsertRes.body.contact || upsertRes.body.id)) {
      contactId = (upsertRes.body.contact && upsertRes.body.contact.id) || upsertRes.body.id;
    }

    if (!contactId) {
      console.error('[buy-box-save] No contact ID from upsert:', JSON.stringify(upsertRes.body));
      return respond(502, { error: 'Failed to upsert contact' });
    }

    console.log('[buy-box-save] Contact: ' + contactId);

    // 2. Update custom fields using field keys
    var customFields = [
      { key: 'deal_structure', field_value: body.deal_structure || '' },
      { key: 'exits', field_value: body.exits || '' },
      { key: 'property_type_preference', field_value: body.property_type_preference || '' },
      { key: 'target_zips', field_value: body.target_zips || '' },
      { key: 'max_price', field_value: body.max_price || '' },
      { key: 'max_down', field_value: body.max_down || '' },
      { key: 'max_monthly', field_value: body.max_monthly || '' },
      { key: 'target_monthly_cashflow', field_value: body.target_monthly_cashflow || '' },
      { key: 'max_rate_', field_value: body.max_rate_ || '' },
      { key: 'arv', field_value: body.arv || '' },
      { key: 'bedrooms_min', field_value: body.bedrooms_min || '' },
      { key: 'baths_min', field_value: body.baths_min || '' },
      { key: 'min_sqft', field_value: body.min_sqft || '' },
      { key: 'min_year_build', field_value: body.min_year_build || '' },
      { key: 'remodel_level', field_value: body.remodel_level || '' },
      { key: 'hoa_tolerance', field_value: body.hoa_tolerance || '' },
      { key: 'pool', field_value: body.pool || '' },
      { key: 'purchase_timeline', field_value: body.purchase_timeline || '' },
      { key: 'buy_box', field_value: body.buy_box || '' },
      { key: 'buyer_type', field_value: body.buyer_type || 'Buyer' },
      { key: 'criteria_last_update', field_value: body.criteria_last_update || new Date().toISOString().split('T')[0] },
    ].filter(function(f) { return f.field_value; });

    var cfRes = await updateCustomFields(ghlKey, contactId, customFields);
    console.log('[buy-box-save] Custom fields updated: ' + cfRes.status);

    // 3. Add tags
    await addTags(ghlKey, contactId, body.tags || ['tfs buyer', 'buy box complete', 'buyer-signup']);

    // 4. Post buy box summary as note
    var noteLines = ['=== BUY BOX SAVED ==='];
    if (body.deal_structure) noteLines.push('Structures: ' + body.deal_structure);
    if (body.property_type_preference) noteLines.push('Property Types: ' + body.property_type_preference);
    if (body.exits) noteLines.push('Exit Strategies: ' + body.exits);
    if (body.target_zips) noteLines.push('Markets: ' + body.target_zips);
    if (body.max_price) noteLines.push('Max Price: $' + Number(body.max_price).toLocaleString());
    if (body.max_down) noteLines.push('Max Entry: $' + Number(body.max_down).toLocaleString());
    if (body.max_monthly) noteLines.push('Max PITI: $' + Number(body.max_monthly).toLocaleString());
    if (body.target_monthly_cashflow) noteLines.push('Min Cash Flow: $' + body.target_monthly_cashflow);
    if (body.max_rate_) noteLines.push('Max Rate: ' + body.max_rate_ + '%');
    if (body.arv) noteLines.push('Min ARV: $' + Number(body.arv).toLocaleString());
    if (body.bedrooms_min) noteLines.push('Min Beds: ' + body.bedrooms_min);
    if (body.baths_min) noteLines.push('Min Baths: ' + body.baths_min);
    if (body.remodel_level) noteLines.push('Condition: ' + body.remodel_level);
    if (body.purchase_timeline) noteLines.push('Timeline: ' + body.purchase_timeline);
    if (body.buy_box) noteLines.push('Notes: ' + body.buy_box);
    noteLines.push('\n--- Buy Box / Terms For Sale ---');

    await postNote(ghlKey, contactId, noteLines.join('\n'));

    // 5. Internal notification to Brooke
    if (brookePhone) {
      try {
        await sendSMS(ghlKey, locationId, brookePhone,
          'BUY BOX SAVED: ' + (body.firstName || '') + ' ' + (body.email || '') + ' — ' + (body.deal_structure || '') + ' | ' + (body.target_zips || '').slice(0, 60));
      } catch(e) {}
    }

    return respond(200, { success: true, contactId: contactId });

  } catch (err) {
    console.error('[buy-box-save] error:', err.message);
    return respond(500, { error: err.message });
  }
};

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
    body: JSON.stringify(body)
  };
}
