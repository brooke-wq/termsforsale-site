/**
 * Submit Offer — POST /.netlify/functions/submit-offer
 *
 * When a buyer submits an offer on a deal:
 * 1. Creates a GHL opportunity in the Buyer Inquiries pipeline
 * 2. Posts a note on the contact with offer details
 * 3. Tags the contact (Offer Submitted, Active Buyer)
 * 4. Sends SMS notification to Brooke
 * 5. Sends confirmation email to the buyer
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID_BUYER,
 *           GHL_STAGE_OFFER_RECEIVED, BROOKE_PHONE
 */

const { getContact, postNote, addTags, sendSMS, sendEmail, updateCustomFields } = require('./_ghl');

const GHL_BASE = 'https://services.leadconnectorhq.com';

// 10 contact custom fields required by Brooke's offer-notification templates.
// We write these to the contact so {{contact.<key>}} merge tags resolve in
// Workflow B's internal email (which fires on the "Offer Submitted" tag for
// both logged-in and logged-out paths).
const OFFER_CUSTOM_FIELD_KEYS = [
  'offer_amount', 'type_of_deal', 'close_date_target', 'entry_fee',
  'property_address', 'property_city', 'property_state',
  'asset_type', 'offer_notes', 'current_deal_interest',
];

// In-memory cache (per container invocation) of GHL location custom field map.
let CF_MAP_CACHE = null;

async function getLocationCustomFieldMap(apiKey, locationId) {
  if (CF_MAP_CACHE) return CF_MAP_CACHE;
  var map = {};
  try {
    var res = await fetch(GHL_BASE + '/locations/' + locationId + '/customFields', {
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Accept': 'application/json',
      },
    });
    if (res.status >= 400) {
      console.warn('[submit-offer] custom-field map fetch -> ' + res.status);
      return map;
    }
    var data = await res.json().catch(function () { return {}; });
    var fields = data.customFields || data.fields || [];
    fields.forEach(function (f) {
      var key = f.fieldKey || f.key || f.name;
      if (key && f.id) {
        // Some GHL responses return keys namespaced like "contact.offer_amount" —
        // normalize to the bare key so lookups match what callers pass.
        var bare = String(key).replace(/^contact\./, '');
        map[bare] = f.id;
        map[key] = f.id; // keep original too, just in case
      }
    });
    CF_MAP_CACHE = map;
  } catch (e) {
    console.warn('[submit-offer] custom-field map error:', e.message);
  }
  return map;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey) return respond(500, { error: 'Server config error' });

  var body;
  try { body = JSON.parse(event.body); }
  catch (e) { return respond(400, { error: 'Invalid JSON' }); }

  // Log received payload so we can debug missing fields in production
  console.log('[submit-offer] received body:', JSON.stringify(body));

  var contactId    = body.contactId;
  var dealId       = body.dealId;
  var city         = body.city || '';
  var state        = body.state || '';
  var dealType     = body.dealType || '';
  var streetAddress= body.streetAddress || '';
  var amount       = body.amount || '';
  var coe          = body.coe || '';
  var structure    = body.structure || body.funding || '';
  var notes        = body.notes || '';
  // New fields for Brooke's notification template
  var entryFee     = (body.entryFee != null ? String(body.entryFee) : '').trim();
  // type_of_deal is the auto-detected Cash/Creative category. Fall back to
  // inferring from the Notion dealType if the client didn't send it.
  var typeOfDeal   = (body.typeOfDeal || '').trim()
                     || (/^cash$/i.test(dealType.trim()) ? 'Cash' : (dealType ? 'Creative' : ''));
  // Form-level overrides for buyer contact (allow logged-in user to edit)
  var formName     = (body.name || '').trim();
  var formPhone    = (body.phone || '').trim();
  var formEmail    = (body.email || '').trim();

  if (!contactId || !dealId) {
    console.warn('[submit-offer] missing required fields:', { contactId: !!contactId, dealId: !!dealId });
    return respond(400, { error: 'Missing contactId or dealId' });
  }

  // Verify contact
  var contactRes = await getContact(apiKey, contactId);
  if (contactRes.status >= 400) return respond(401, { error: 'Invalid contact' });
  var contact = contactRes.body && contactRes.body.contact;
  var ghlName  = contact ? ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim() : '';
  var ghlEmail = contact ? contact.email : '';
  var ghlPhone = contact ? contact.phone : '';
  // Prefer what the user typed in the form, fall back to GHL record
  var buyerName  = formName  || ghlName;
  var buyerEmail = formEmail || ghlEmail;
  var buyerPhone = formPhone || ghlPhone;
  var buyerFirst = (contact && contact.firstName) || buyerName.split(' ')[0] || 'there';

  var location = city && state ? city + ', ' + state : 'Deal ' + dealId.substring(0, 8);
  var fullAddress = streetAddress ? streetAddress + ', ' + city + ', ' + state : location;
  var amountFmt = amount && !isNaN(+amount) ? '$' + Number(amount).toLocaleString() : amount;

  var entryFeeFmt = entryFee && !isNaN(+entryFee) ? '$' + Number(entryFee).toLocaleString() : entryFee;

  // 1. Build comprehensive note — include buyer contact info AND every submitted field
  var noteLines = [
    '📋 OFFER SUBMITTED',
    '─────────────────',
    'Buyer: ' + (buyerName || '(unknown)'),
    buyerPhone ? 'Phone: ' + buyerPhone : '',
    buyerEmail ? 'Email: ' + buyerEmail : '',
    '─────────────────',
    'Deal: ' + location + (dealType ? ' (' + dealType + ')' : ''),
    streetAddress ? 'Address: ' + fullAddress : '',
    'Deal ID: ' + dealId,
    typeOfDeal ? 'Type: ' + typeOfDeal : '',
    '─────────────────',
    amount     ? 'Offer Amount: ' + amountFmt : 'Offer Amount: (not provided)',
    entryFee   ? 'Entry Fee: ' + entryFeeFmt : '',
    structure  ? 'Funding Source: ' + structure : '',
    coe        ? 'Target Close: ' + coe : '',
    notes      ? 'Notes: ' + notes : '',
    '─────────────────',
    'Submitted: ' + new Date().toISOString().split('T')[0],
    'Source: Terms For Sale Website'
  ].filter(Boolean).join('\n');

  // 2. Post note + add tags in parallel
  await Promise.all([
    postNote(apiKey, contactId, noteLines),
    addTags(apiKey, contactId, ['Offer Submitted', 'Active Buyer', 'offer-' + dealId.substring(0, 8)])
  ]);

  // 2b. Write the 4 contact custom fields Brooke's templates expect
  // ({{contact.offer_amount}}, {{contact.type_of_deal}},
  // {{contact.close_date_target}}, {{contact.entry_fee}}). GHL requires
  // field UUIDs, so look them up on the location and PUT only the fields
  // we can resolve. Silently skipped fields are logged.
  try {
    var cfMap = await getLocationCustomFieldMap(apiKey, locationId);
    var values = {
      offer_amount:          amount    != null ? String(amount)    : '',
      type_of_deal:          typeOfDeal || '',
      close_date_target:     coe        || '',
      entry_fee:             entryFee   || '',
      property_address:      streetAddress || '',
      property_city:         city          || '',
      property_state:        state         || '',
      asset_type:            dealType      || '',   // Notion deal type (SubTo, Cash, SF, Hybrid, etc.)
      offer_notes:           notes         || '',
      current_deal_interest: dealId        || '',   // Notion Deal ID (e.g. PHX-001)
    };
    var cfPayload = [];
    var missing = [];
    OFFER_CUSTOM_FIELD_KEYS.forEach(function (k) {
      var id = cfMap[k];
      if (id) {
        cfPayload.push({ id: id, value: values[k] });
      } else if (values[k]) {
        missing.push(k);
      }
    });
    if (cfPayload.length) {
      var cfRes = await updateCustomFields(apiKey, contactId, cfPayload);
      if (cfRes.status >= 400) {
        console.warn('[submit-offer] custom fields update -> ' + cfRes.status, JSON.stringify(cfRes.body));
      } else {
        console.log('[submit-offer] wrote ' + cfPayload.length + ' custom fields to contact=' + contactId);
      }
    }
    if (missing.length) {
      console.warn('[submit-offer] custom-field keys not found on location, skipped:', missing.join(', '));
    }
  } catch (e) {
    console.warn('[submit-offer] custom fields write failed:', e.message);
  }

  // 3. Create GHL opportunity (if pipeline is configured)
  var pipelineId = process.env.GHL_PIPELINE_ID_BUYER;
  var stageId = process.env.GHL_STAGE_OFFER_RECEIVED;
  if (pipelineId && stageId) {
    try {
      var oppName = (dealType || 'Offer') + ' — ' + fullAddress + ' — ' + (buyerName || 'Buyer');
      if (amount) oppName += ' — ' + amountFmt;
      var oppBody = {
        pipelineId: pipelineId,
        pipelineStageId: stageId,
        locationId: locationId,
        contactId: contactId,
        name: oppName,
        status: 'open',
        monetaryValue: amount && !isNaN(+amount) ? +amount : 0,
        customFields: [
          { key: 'property_address', field_value: fullAddress }
        ],
      };
      var oppRes = await fetch(GHL_BASE + '/opportunities/', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(oppBody)
      });
      if (oppRes.status >= 400) {
        var errText = await oppRes.text();
        console.warn('[submit-offer] opportunity create -> ' + oppRes.status, errText);
      } else {
        console.log('[submit-offer] opportunity created for ' + buyerName + ' amount=' + (amount || 'n/a'));
      }
    } catch (e) {
      console.warn('[submit-offer] opportunity creation failed:', e.message);
    }
  }

  // 4. Notify Brooke via SMS — include buyer name, location, amount, funding
  var brookePhone = process.env.BROOKE_PHONE || '+15167120113';
  if (brookePhone && locationId) {
    var sms = 'New offer: ' + (buyerName || 'Buyer') + ' on ' + location;
    if (amount) sms += ' — ' + amountFmt;
    if (typeOfDeal) sms += ' [' + typeOfDeal + ']';
    if (entryFee) sms += ', entry ' + entryFeeFmt;
    if (coe) sms += ', close ' + coe;
    if (sms.length > 300) sms = sms.slice(0, 297) + '...';
    try {
      await sendSMS(apiKey, locationId, brookePhone, sms);
    } catch (e) {
      console.warn('[submit-offer] Brooke SMS failed:', e.message);
    }
  }

  // 5. Send buyer confirmation email — include EVERY submitted field
  if (buyerEmail && contactId) {
    try {
      var detailRows = '';
      if (amount)     detailRows += row('Offer amount', amountFmt);
      if (typeOfDeal) detailRows += row('Deal type', escapeHtml(typeOfDeal));
      if (entryFee)   detailRows += row('Entry fee', entryFeeFmt);
      if (coe)        detailRows += row('Target close', coe);
      if (notes)      detailRows += row('Your notes', escapeHtml(notes));

      var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
        + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
        + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
        + '</div>'
        + '<div style="padding:28px 32px">'
        + '<h2 style="color:#0D1F3C;margin:0 0 12px">Offer Received!</h2>'
        + '<p style="color:#4A5568;line-height:1.6">Thanks, ' + escapeHtml(buyerFirst) + '. We received your offer on the <strong>' + escapeHtml(location) + (dealType ? ' (' + escapeHtml(dealType) + ')' : '') + '</strong> deal.</p>'
        + (detailRows
            ? '<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">'
              + '<tbody>' + detailRows + '</tbody></table>'
            : '<p style="color:#C53030;font-size:13px">We didn\'t receive offer details — please reply to this email with your offer amount and timeline.</p>')
        + '<p style="color:#4A5568;line-height:1.6">Our team will review and get back to you within 24 hours. If your offer is accepted, we\'ll send you the assignment contract for e-signature.</p>'
        + '<p style="color:#4A5568;line-height:1.6"><strong>What happens next:</strong></p>'
        + '<ol style="color:#4A5568;line-height:1.8;padding-left:20px">'
        + '<li>We review your offer (24 hours)</li>'
        + '<li>If accepted, you\'ll receive the assignment contract</li>'
        + '<li>Sign + submit EMD to secure the deal</li>'
        + '<li>Your deal coordinator guides you to close</li>'
        + '</ol>'
        + '<div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin-top:20px;text-align:center">'
        + '<span style="font-size:12px;color:#718096">While you wait — </span>'
        + '<a href="https://dealpros.steadilypartner.com/" target="_blank" style="color:#29ABE2;font-size:12px;font-weight:700">Lock in your insurance rate &rarr;</a>'
        + '</div>'
        + '<p style="color:#718096;font-size:13px;margin-top:16px">Questions? Reply to this email or call (480) 637-3117.</p>'
        + '</div>'
        + '<div style="background:#F4F6F9;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center">'
        + '<p style="color:#718096;font-size:11px;margin:0">Terms For Sale &middot; Deal Pros LLC</p>'
        + '</div></div>';

      var emailRes = await sendEmail(apiKey, contactId, 'Offer received — ' + location, html);
      if (emailRes.status >= 400) {
        console.warn('[submit-offer] buyer email -> ' + emailRes.status, JSON.stringify(emailRes.body));
      } else {
        console.log('[submit-offer] confirmation email sent to ' + buyerEmail);
      }
    } catch (e) {
      console.warn('[submit-offer] buyer email failed:', e.message);
    }
  } else {
    console.warn('[submit-offer] no buyer email on contact — skipping confirmation send');
  }

  console.log('[submit-offer] contact=' + contactId + ' deal=' + dealId + ' amount=' + amount + ' type=' + typeOfDeal + ' entry=' + entryFee + ' coe=' + coe);

  return respond(200, { ok: true });
};

function row(label, value) {
  return '<tr>'
    + '<td style="padding:10px 14px;font-size:13px;color:#718096;border-bottom:1px solid #E2E8F0;width:40%">' + label + '</td>'
    + '<td style="padding:10px 14px;font-size:14px;color:#0D1F3C;font-weight:700;border-bottom:1px solid #E2E8F0">' + value + '</td>'
    + '</tr>';
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
