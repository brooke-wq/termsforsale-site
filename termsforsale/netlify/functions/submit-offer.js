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

const { getContact, postNote, addTags, sendSMS } = require('./_ghl');

const GHL_BASE = 'https://services.leadconnectorhq.com';

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

  var contactId = body.contactId;
  var dealId = body.dealId;
  var city = body.city || '';
  var state = body.state || '';
  var dealType = body.dealType || '';
  var streetAddress = body.streetAddress || '';
  var amount = body.amount || '';
  var coe = body.coe || '';
  var notes = body.notes || '';

  if (!contactId || !dealId) {
    return respond(400, { error: 'Missing contactId or dealId' });
  }

  // Verify contact
  var contactRes = await getContact(apiKey, contactId);
  if (contactRes.status >= 400) return respond(401, { error: 'Invalid contact' });
  var contact = contactRes.body && contactRes.body.contact;
  var buyerName = contact ? (contact.firstName || '') + ' ' + (contact.lastName || '') : '';
  var buyerEmail = contact ? contact.email : '';
  var buyerPhone = contact ? contact.phone : '';

  var location = city && state ? city + ', ' + state : 'Deal ' + dealId.substring(0, 8);
  var fullAddress = streetAddress ? streetAddress + ', ' + city + ', ' + state : location;

  // 1. Build note
  var noteLines = [
    '📋 OFFER SUBMITTED',
    '─────────────────',
    'Deal: ' + location + (dealType ? ' (' + dealType + ')' : ''),
    'Deal ID: ' + dealId,
    amount ? 'Offer Amount: $' + Number(amount).toLocaleString() : '',
    coe ? 'Target Close: ' + coe : '',
    notes ? 'Notes: ' + notes : '',
    '─────────────────',
    'Submitted: ' + new Date().toISOString().split('T')[0],
    'Source: Terms For Sale Website'
  ].filter(Boolean).join('\n');

  // 2. Post note + add tags in parallel
  await Promise.all([
    postNote(apiKey, contactId, noteLines),
    addTags(apiKey, contactId, ['Offer Submitted', 'Active Buyer', 'offer-' + dealId.substring(0, 8)])
  ]);

  // 3. Create GHL opportunity (if pipeline is configured)
  var pipelineId = process.env.GHL_PIPELINE_ID_BUYER;
  var stageId = process.env.GHL_STAGE_OFFER_RECEIVED;
  if (pipelineId && stageId) {
    try {
      var oppBody = {
        pipelineId: pipelineId,
        pipelineStageId: stageId,
        locationId: locationId,
        contactId: contactId,
        name: (dealType || 'Offer') + ' — ' + fullAddress + ' — ' + buyerName.trim(),
        status: 'open',
        monetaryValue: amount ? +amount : 0,
        customFields: [
          { key: 'property_address', field_value: fullAddress }
        ],
      };
      await fetch(GHL_BASE + '/opportunities/', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(oppBody)
      });
      console.log('[submit-offer] opportunity created for ' + buyerName.trim());
    } catch (e) {
      console.warn('[submit-offer] opportunity creation failed:', e.message);
    }
  }

  // 4. Notify Brooke via SMS
  var brookePhone = process.env.BROOKE_PHONE || '+15167120113';
  if (brookePhone && locationId) {
    var sms = 'New offer: ' + buyerName.trim() + ' on ' + location;
    if (amount) sms += ' — $' + Number(amount).toLocaleString();
    if (sms.length > 160) sms = sms.slice(0, 157) + '...';
    try {
      await sendSMS(apiKey, locationId, brookePhone, sms);
    } catch (e) {
      console.warn('[submit-offer] Brooke SMS failed:', e.message);
    }
  }

  // 5. Send buyer confirmation email
  if (buyerEmail && contactId) {
    try {
      await fetch(GHL_BASE + '/conversations/messages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'Email',
          contactId: contactId,
          subject: 'Offer received — ' + location,
          html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
            + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
            + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
            + '</div>'
            + '<div style="padding:28px 32px">'
            + '<h2 style="color:#0D1F3C;margin:0 0 12px">Offer Received!</h2>'
            + '<p style="color:#4A5568;line-height:1.6">Thanks, ' + (contact.firstName || 'there') + '. We received your offer on the <strong>' + location + '</strong> deal.</p>'
            + (amount ? '<p style="color:#4A5568"><strong>Offer amount:</strong> $' + Number(amount).toLocaleString() + '</p>' : '')
            + (coe ? '<p style="color:#4A5568"><strong>Target close:</strong> ' + coe + '</p>' : '')
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
            + '</div></div>',
          emailFrom: 'Brooke Froehlich <brooke@mydealpros.com>'
        })
      });
      console.log('[submit-offer] confirmation email sent to ' + buyerEmail);
    } catch (e) {
      console.warn('[submit-offer] buyer email failed:', e.message);
    }
  }

  console.log('[submit-offer] contact=' + contactId + ' deal=' + dealId + ' amount=' + amount);

  return respond(200, { ok: true });
};

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
