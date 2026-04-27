/**
 * Submit Inquiry — POST /.netlify/functions/submit-inquiry
 *
 * When a logged-in buyer clicks "Request Info" on a deal page:
 * 1. Writes deal context (deal_id, property address/city/state) to the
 *    contact as custom fields so Brooke's GHL notification template can
 *    render them via {{contact.*}} merge tags.
 * 2. Posts a note on the contact with the full inquiry details
 * 3. Tags the contact (Website Inquiry, Active Buyer, TFS Buyer,
 *    inquiry-[dealId])
 * 4. Creates a GHL opportunity in the "New Engaged Lead" stage of the
 *    Buyer Inquiries pipeline (mirrors submit-offer.js behavior).
 * 5. Sends SMS notification to the team line (+14807191175)
 * 6. Sends internal notification email to info@termsforsale.com
 * 7. Sends confirmation email to the buyer with every submitted field
 *
 * The response body includes a `diagnostic` block summarising what
 * actually happened so callers (browser Network tab, Netlify logs) can
 * see which steps succeeded and which were skipped.
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID_BUYER,
 *           GHL_STAGE_NEW_ENGAGED_LEAD (optional — if unset, looked up
 *           by name from the pipeline at runtime),
 *           INQUIRY_NOTIFICATION_PHONE (optional override — defaults to the
 *           team line +14807191175). Inquiry/offer alerts deliberately do
 *           NOT use BROOKE_PHONE so the team line stays the recipient even
 *           if BROOKE_PHONE is set to her personal cell elsewhere.
 */

const { getContact, postNote, addTags, sendSMS, sendEmail, updateCustomFields, getStageIdByName } = require('./_ghl');

const GHL_BASE = 'https://services.leadconnectorhq.com';

// Team notification SMS target. MUST NOT equal CAMPAIGN_FROM_PHONE
// (+14806373117) — Twilio/GHL silently drop SMS sent from a number to
// itself.
const DEFAULT_NOTIFICATION_PHONE = '+14807191175';

// Internal inbox that receives the inquiry notification email.
const INTERNAL_NOTIFICATION_EMAIL = 'info@termsforsale.com';

// Inquiry-relevant contact custom fields. Keys match the live GHL schema
// (Settings → Custom Fields → Contact). Offer-specific keys (offer_amount,
// type_of_deal, close_date_target, offer__entry_fee, offer_notes) are NOT
// written here — inquiries shouldn't clobber offer data if the same buyer
// submits an offer later.
const INQUIRY_CUSTOM_FIELD_KEYS = [
  'property_address',
  'offer__property_city',
  'offer__property_state',
  'deal_id',
];

let CF_MAP_CACHE = null;
let INTERNAL_CONTACT_CACHE = {};

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
      console.warn('[submit-inquiry] custom-field map fetch -> ' + res.status);
      return map;
    }
    var data = await res.json().catch(function () { return {}; });
    var fields = data.customFields || data.fields || [];
    fields.forEach(function (f) {
      var key = f.fieldKey || f.key || f.name;
      if (key && f.id) {
        var bare = String(key).replace(/^contact\./, '');
        map[bare] = f.id;
        map[key] = f.id;
      }
    });
    CF_MAP_CACHE = map;
  } catch (e) {
    console.warn('[submit-inquiry] custom-field map error:', e.message);
  }
  return map;
}

// Resolve (upsert) an internal notification inbox into a GHL contact ID
// so we can send an email via the Conversations API.
async function getInternalContactId(apiKey, locationId, email) {
  if (INTERNAL_CONTACT_CACHE[email]) return INTERNAL_CONTACT_CACHE[email];
  try {
    var res = await fetch(GHL_BASE + '/contacts/upsert', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        locationId: locationId,
        email: email,
        firstName: 'TFS',
        lastName: 'Notifications',
        tags: ['Internal Notification Inbox'],
      }),
    });
    var data = await res.json().catch(function () { return {}; });
    var id = (data.contact && data.contact.id) || data.id || null;
    if (id) INTERNAL_CONTACT_CACHE[email] = id;
    return id;
  } catch (e) {
    console.warn('[submit-inquiry] internal contact upsert failed for ' + email + ':', e.message);
    return null;
  }
}

// Ensure a GHL contact exists with the given phone number so sendSMS can
// find it. Mirrors the email upsert pattern — without an existing contact,
// sendSMS returns 404 and the SMS is silently dropped.
async function ensureNotificationPhoneContact(apiKey, locationId, phone) {
  var key = 'phone:' + phone;
  if (INTERNAL_CONTACT_CACHE[key]) return INTERNAL_CONTACT_CACHE[key];
  try {
    var res = await fetch(GHL_BASE + '/contacts/upsert', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        locationId: locationId,
        phone: phone,
        firstName: 'TFS',
        lastName: 'Alerts',
        tags: ['Internal Notification Inbox'],
      }),
    });
    var data = await res.json().catch(function () { return {}; });
    var id = (data.contact && data.contact.id) || data.id || null;
    if (id) INTERNAL_CONTACT_CACHE[key] = id;
    return id;
  } catch (e) {
    console.warn('[submit-inquiry] notification-phone contact upsert failed for ' + phone + ':', e.message);
    return null;
  }
}

// Plain-text-leaning notification body. Keeping styling minimal because
// the From and To addresses share a domain (info@termsforsale.com), which
// already strains spam filters — adding heavy marketing-style HTML on top
// of that pushes Gmail/Proton to classify the message as promotional.
function buildInternalInquiryEmailHtml(ctx) {
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  function line(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return '<p style="margin:4px 0;font-size:14px;color:#1F2937"><strong>' + label + ':</strong> ' + value + '</p>';
  }
  var rows = [
    line('Buyer',      esc(ctx.buyerName)),
    line('Phone',      esc(ctx.buyerPhone)),
    line('Email',      esc(ctx.buyerEmail)),
    line('Deal ID',    esc(ctx.dealId)),
    line('Property',   esc(ctx.fullAddress)),
    line('Asset Type', esc(ctx.dealType)),
  ].join('');
  var questionBlock = ctx.notes
    ? '<p style="margin:12px 0 4px;font-size:14px;color:#1F2937"><strong>Question:</strong></p><p style="margin:0;font-size:14px;color:#1F2937;white-space:pre-wrap">' + esc(ctx.notes) + '</p>'
    : '<p style="margin:12px 0;font-size:14px;color:#6B7280"><em>No question submitted.</em></p>';
  var ghlLink = ctx.contactId
    ? '<p style="margin:16px 0 0;font-size:13px"><a href="https://app.gohighlevel.com/v2/location/' + esc(process.env.GHL_LOCATION_ID || '') + '/contacts/detail/' + esc(ctx.contactId) + '">Open contact in GHL</a></p>'
    : '';
  return '<div style="font-family:Arial,sans-serif;max-width:640px;font-size:14px;color:#1F2937">'
    + '<p style="margin:0 0 12px;font-size:14px;color:#6B7280">New buyer inquiry received via Terms For Sale website.</p>'
    + rows
    + questionBlock
    + ghlLink
    + '</div>';
}

function buildInternalInquiryEmailText(ctx) {
  var lines = [
    'New buyer inquiry received via Terms For Sale website.',
    '',
    'Buyer: ' + (ctx.buyerName || ''),
    'Phone: ' + (ctx.buyerPhone || ''),
    'Email: ' + (ctx.buyerEmail || ''),
    'Deal ID: ' + (ctx.dealId || ''),
    'Property: ' + (ctx.fullAddress || ''),
    'Asset Type: ' + (ctx.dealType || ''),
    '',
    'Question:',
    ctx.notes || '(none submitted)',
  ];
  return lines.filter(function (l) { return l !== null && l !== undefined; }).join('\n');
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

  console.log('[submit-inquiry] received body:', JSON.stringify(body));

  var contactId    = body.contactId;
  var dealId       = body.dealId;
  var city         = body.city || '';
  var state        = body.state || '';
  var dealType     = body.dealType || '';
  var streetAddress= body.streetAddress || '';
  var notes        = body.notes || '';
  var firstName    = (body.firstName || '').trim();
  var lastName     = (body.lastName || '').trim();
  var phone        = (body.phone || '').trim();
  var email        = (body.email || '').trim();

  var diagnostic = {
    contactId: contactId || null,
    dealId: dealId || null,
    notifyPhone: null,
    inboxEmail: INTERNAL_NOTIFICATION_EMAIL,
    noteStatus: null,
    tagStatus: null,
    fieldsWritten: [],
    fieldsSkipped: [],
    customFieldsStatus: null,
    opportunityStatus: null,
    smsStatus: null,
    internalEmailStatus: null,
    emailStatus: null,
    errors: [],
  };

  if (!contactId || !dealId) {
    console.warn('[submit-inquiry] missing required fields:', { contactId: !!contactId, dealId: !!dealId });
    diagnostic.errors.push('Missing contactId or dealId');
    return respond(400, { error: 'Missing contactId or dealId', diagnostic: diagnostic });
  }

  // Verify contact + pull existing fields
  var contactRes = await getContact(apiKey, contactId);
  if (contactRes.status >= 400) {
    diagnostic.errors.push('getContact -> ' + contactRes.status);
    return respond(401, { error: 'Invalid contact', diagnostic: diagnostic });
  }
  var contact = contactRes.body && contactRes.body.contact;
  var ghlFirst = contact ? (contact.firstName || '') : '';
  var ghlLast  = contact ? (contact.lastName  || '') : '';
  var ghlEmail = contact ? contact.email : '';
  var ghlPhone = contact ? contact.phone : '';

  var buyerFirst = firstName || ghlFirst || 'there';
  var buyerLast  = lastName  || ghlLast  || '';
  var buyerName  = (buyerFirst + ' ' + buyerLast).trim() || 'Buyer';
  var buyerEmail = email || ghlEmail || '';
  var buyerPhone = phone || ghlPhone || '';

  var location    = city && state ? city + ', ' + state : 'Deal ' + String(dealId).substring(0, 8);
  var fullAddress = streetAddress ? streetAddress + ', ' + city + ', ' + state : location;

  // 1. Build note
  var noteLines = [
    '💬 INQUIRY RECEIVED',
    '─────────────────',
    'Buyer: ' + buyerName,
    buyerPhone ? 'Phone: ' + buyerPhone : '',
    buyerEmail ? 'Email: ' + buyerEmail : '',
    '─────────────────',
    'Deal: ' + location + (dealType ? ' (' + dealType + ')' : ''),
    streetAddress ? 'Address: ' + fullAddress : '',
    'Deal ID: ' + dealId,
    '─────────────────',
    notes ? 'Question: ' + notes : 'Question: (none provided)',
    '─────────────────',
    'Submitted: ' + new Date().toISOString().split('T')[0],
    'Source: Terms For Sale Website'
  ].filter(Boolean).join('\n');

  // 2. Post note + tag in parallel, capture status of each
  try {
    var results = await Promise.all([
      postNote(apiKey, contactId, noteLines),
      addTags(apiKey, contactId, [
        'Website Inquiry',
        'Active Buyer',
        'TFS Buyer',
        'inquiry-' + String(dealId).substring(0, 8)
      ]),
    ]);
    diagnostic.noteStatus = results[0].status;
    diagnostic.tagStatus  = results[1].status;
    if (results[0].status >= 400) diagnostic.errors.push('postNote -> ' + results[0].status);
    if (results[1].status >= 400) diagnostic.errors.push('addTags -> ' + results[1].status);
  } catch (e) {
    console.warn('[submit-inquiry] note/tag failed:', e.message);
    diagnostic.errors.push('note/tag: ' + e.message);
  }

  // 2b. Write the contact custom fields Brooke's inquiry-notification
  // template merges. We only write the fields that apply to both
  // inquiries and offers so inquiry submissions don't overwrite
  // offer-specific data (offer_amount / type_of_deal / etc.).
  try {
    var cfMap = await getLocationCustomFieldMap(apiKey, locationId);
    var values = {
      property_address:       streetAddress || '',
      offer__property_city:   city          || '',
      offer__property_state:  state         || '',
      deal_id:                dealId        || '',
    };
    var cfPayload = [];
    INQUIRY_CUSTOM_FIELD_KEYS.forEach(function (k) {
      var id = cfMap[k];
      if (id) {
        cfPayload.push({ id: id, value: values[k] });
        diagnostic.fieldsWritten.push(k);
      } else if (values[k]) {
        diagnostic.fieldsSkipped.push(k);
      }
    });
    if (cfPayload.length) {
      var cfRes = await updateCustomFields(apiKey, contactId, cfPayload);
      diagnostic.customFieldsStatus = cfRes.status;
      if (cfRes.status >= 400) {
        console.warn('[submit-inquiry] custom fields update -> ' + cfRes.status, JSON.stringify(cfRes.body));
        diagnostic.errors.push('updateCustomFields -> ' + cfRes.status);
      } else {
        console.log('[submit-inquiry] wrote ' + cfPayload.length + ' custom fields to contact=' + contactId);
      }
    }
    if (diagnostic.fieldsSkipped.length) {
      console.warn('[submit-inquiry] custom-field keys not found on location, skipped:', diagnostic.fieldsSkipped.join(', '));
    }
  } catch (e) {
    console.warn('[submit-inquiry] custom fields write failed:', e.message);
    diagnostic.errors.push('customFields: ' + e.message);
  }

  // 2c. Create GHL opportunity in the Buyer Inquiries pipeline at the
  // "New Engaged Lead" stage. Mirrors submit-offer.js behavior. Stage
  // ID can be provided via GHL_STAGE_NEW_ENGAGED_LEAD env var; if
  // unset we look it up by name at runtime via getStageIdByName.
  var pipelineId = process.env.GHL_PIPELINE_ID_BUYER;
  if (pipelineId) {
    try {
      var stageId = process.env.GHL_STAGE_NEW_ENGAGED_LEAD;
      if (!stageId) {
        try {
          stageId = await getStageIdByName(pipelineId, 'New Engaged Lead');
        } catch (e) {
          console.warn('[submit-inquiry] stage lookup failed:', e.message);
          diagnostic.errors.push('stageLookup: ' + e.message);
        }
      }
      if (stageId) {
        var oppName = 'Inquiry — ' + fullAddress + ' — ' + buyerName;
        if (dealType) oppName += ' (' + dealType + ')';
        var oppBody = {
          pipelineId: pipelineId,
          pipelineStageId: stageId,
          locationId: locationId,
          contactId: contactId,
          name: oppName,
          status: 'open',
          monetaryValue: 0,
        };
        var oppRes = await fetch(GHL_BASE + '/opportunities/', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(oppBody),
        });
        diagnostic.opportunityStatus = oppRes.status;
        if (oppRes.status >= 400) {
          var errText = await oppRes.text();
          console.warn('[submit-inquiry] opportunity create -> ' + oppRes.status, errText);
          diagnostic.errors.push('opportunity -> ' + oppRes.status);
        } else {
          console.log('[submit-inquiry] opportunity created for ' + buyerName + ' deal=' + dealId);
        }
      }
    } catch (e) {
      console.warn('[submit-inquiry] opportunity creation failed:', e.message);
      diagnostic.errors.push('opportunity: ' + e.message);
    }
  }

  // 3. SMS notification to the team line. Use INQUIRY_NOTIFICATION_PHONE
  // override if set; otherwise default to the team line. We deliberately
  // do NOT fall back to BROOKE_PHONE — that env var is set to her personal
  // cell and inquiry alerts should land on the team line instead.
  var notifyPhone = process.env.INQUIRY_NOTIFICATION_PHONE || DEFAULT_NOTIFICATION_PHONE;
  diagnostic.notifyPhone = notifyPhone;
  if (notifyPhone && locationId) {
    var sms = 'New inquiry: ' + buyerName + ' on ' + location;
    if (dealType) sms += ' (' + dealType + ')';
    if (notes) sms += ' — "' + notes.slice(0, 120) + '"';
    if (sms.length > 300) sms = sms.slice(0, 297) + '...';
    try {
      await ensureNotificationPhoneContact(apiKey, locationId, notifyPhone);
      var smsRes = await sendSMS(apiKey, locationId, notifyPhone, sms);
      diagnostic.smsStatus = smsRes && smsRes.status ? smsRes.status : 'sent';
      if (smsRes && smsRes.status >= 400) {
        diagnostic.errors.push('notifySMS -> ' + smsRes.status + ' ' + (smsRes.body && (smsRes.body.error || JSON.stringify(smsRes.body)) || ''));
      }
    } catch (e) {
      console.warn('[submit-inquiry] notification SMS failed:', e.message);
      diagnostic.errors.push('notifySMS: ' + e.message);
    }
  }

  // 3b. Internal notification email to info@termsforsale.com.
  // Subject + body are deliberately plain (no emoji, simple HTML, plain-text
  // sibling, replyTo set to the buyer) so Gmail/Proton stop classifying the
  // notification as promotional. From/To both being on info@termsforsale.com
  // already strains spam filters; everything else stays minimal.
  try {
    var internalId = await getInternalContactId(apiKey, locationId, INTERNAL_NOTIFICATION_EMAIL);
    if (internalId) {
      var internalSubject = 'New inquiry: ' + buyerName + ' on ' + location + (dealType ? ' (' + dealType + ')' : '');
      var emailCtx = {
        buyerName: buyerName,
        buyerPhone: buyerPhone,
        buyerEmail: buyerEmail,
        dealId: dealId,
        fullAddress: fullAddress,
        dealType: dealType,
        notes: notes,
        contactId: contactId,
      };
      var internalHtml = buildInternalInquiryEmailHtml(emailCtx);
      var internalText = buildInternalInquiryEmailText(emailCtx);
      var internalRes = await fetch(GHL_BASE + '/conversations/messages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          type: 'Email',
          contactId: internalId,
          subject: internalSubject,
          html: internalHtml,
          text: internalText,
          emailFrom: 'Terms For Sale <info@termsforsale.com>',
          replyTo: buyerEmail || undefined,
        }),
      });
      diagnostic.internalEmailStatus = internalRes.status;
      if (internalRes.status >= 400) {
        var errBody = await internalRes.text().catch(function () { return ''; });
        console.warn('[submit-inquiry] internal email -> ' + internalRes.status, errBody);
        diagnostic.errors.push('internalEmail -> ' + internalRes.status);
      } else {
        console.log('[submit-inquiry] internal notification email sent to ' + INTERNAL_NOTIFICATION_EMAIL);
      }
    } else {
      diagnostic.internalEmailStatus = 'skipped-no-inbox-contact';
      diagnostic.errors.push('internalEmail: could not resolve inbox contactId');
    }
  } catch (e) {
    console.warn('[submit-inquiry] internal email failed:', e.message);
    diagnostic.errors.push('internalEmail: ' + e.message);
  }

  // 4. Send buyer confirmation email with every submitted field
  if (buyerEmail && contactId) {
    try {
      var detailRows = '';
      detailRows += row('Deal',     escapeHtml(location + (dealType ? ' (' + dealType + ')' : '')));
      if (buyerPhone) detailRows += row('Your phone', escapeHtml(buyerPhone));
      if (buyerEmail) detailRows += row('Your email', escapeHtml(buyerEmail));
      if (notes)      detailRows += row('Your question', escapeHtml(notes));

      var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
        + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
        + '<img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:32px">'
        + '</div>'
        + '<div style="padding:28px 32px">'
        + '<h2 style="color:#0D1F3C;margin:0 0 12px">Inquiry Received!</h2>'
        + '<p style="color:#4A5568;line-height:1.6">Thanks, ' + escapeHtml(buyerFirst) + '. We got your question about the <strong>' + escapeHtml(location) + '</strong> deal and a team member will reach out within 24 hours.</p>'
        + '<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">'
        +   '<tbody>' + detailRows + '</tbody>'
        + '</table>'
        + '<p style="color:#4A5568;line-height:1.6"><strong>While you wait:</strong> review the deal terms, run the numbers in the calculator, and if it fits your buy box — go ahead and submit an offer.</p>'
        + '<div style="background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin-top:20px;text-align:center">'
        + '<span style="font-size:12px;color:#718096">Thinking about insurance? </span>'
        + '<a href="https://dealpros.steadilypartner.com/" target="_blank" style="color:#29ABE2;font-size:12px;font-weight:700">Lock in your rate &rarr;</a>'
        + '</div>'
        + '<p style="color:#718096;font-size:13px;margin-top:16px">Questions? Reply to this email or call (480) 637-3117.</p>'
        + '</div>'
        + '<div style="background:#F4F6F9;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center">'
        + '<p style="color:#718096;font-size:11px;margin:0">Terms For Sale &middot; Deal Pros LLC</p>'
        + '</div></div>';

      var emailRes = await sendEmail(apiKey, contactId, 'Inquiry received — ' + location, html);
      diagnostic.emailStatus = emailRes.status;
      if (emailRes.status >= 400) {
        console.warn('[submit-inquiry] buyer email -> ' + emailRes.status, JSON.stringify(emailRes.body));
        diagnostic.errors.push('buyerEmail -> ' + emailRes.status);
      } else {
        console.log('[submit-inquiry] confirmation email sent to ' + buyerEmail);
      }
    } catch (e) {
      console.warn('[submit-inquiry] buyer email failed:', e.message);
      diagnostic.errors.push('buyerEmail: ' + e.message);
    }
  } else {
    console.warn('[submit-inquiry] no buyer email on contact — skipping confirmation send');
    diagnostic.emailStatus = 'skipped-no-email';
  }

  console.log('[submit-inquiry] contact=' + contactId + ' deal=' + dealId + ' notes.len=' + notes.length + ' diagnostic=' + JSON.stringify(diagnostic));

  return respond(200, { ok: diagnostic.errors.length === 0, diagnostic: diagnostic });
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
