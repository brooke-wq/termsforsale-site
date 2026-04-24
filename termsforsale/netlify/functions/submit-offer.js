/**
 * Submit Offer — POST /.netlify/functions/submit-offer
 *
 * When a buyer submits an offer on a deal:
 * 1. Creates a GHL opportunity in the Buyer Inquiries pipeline
 * 2. Posts a note on the contact with offer details
 * 3. Tags the contact (Offer Submitted, Active Buyer)
 * 4. Sends SMS notification to the TFS main line (+14806373117)
 * 5. Sends internal notification email to offers@termsforsale.com
 * 6. Sends confirmation email to the buyer
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID, GHL_PIPELINE_ID_BUYER,
 *           GHL_STAGE_OFFER_RECEIVED, BROOKE_PHONE (optional override —
 *           defaults to the main TFS line)
 */

const { getContact, postNote, addTags, sendSMS, sendEmail, updateCustomFields } = require('./_ghl');

const GHL_BASE = 'https://services.leadconnectorhq.com';

// Team notification SMS target. MUST NOT equal CAMPAIGN_FROM_PHONE
// (+14806373117) — Twilio/GHL silently drop SMS sent from a number to
// itself. Kept as an env-var override (BROOKE_PHONE) for testing.
const DEFAULT_NOTIFICATION_PHONE = '+14807191175';

// Internal inbox that receives the offer notification email. We upsert
// a contact for this address on first use so we can route through the
// Conversations API.
const INTERNAL_NOTIFICATION_EMAIL = 'offers@termsforsale.com';

// 9 contact custom fields keyed exactly as they live in GHL → Settings →
// Custom Fields → Contact (Offer Submitted folder). Writing these populates
// the {{contact.<key>}} merge tags Brooke's "Offer Notification" workflow
// uses. The double-underscore prefix on several keys is intentional — that's
// how GHL stores them after the folder-prefix display rename.
//   asset_type is NOT in this list: in GHL's taxonomy that field is for
//   property type (SFH / MFH / etc.), which the offer form doesn't capture
//   today. type_of_deal covers Cash vs Creative.
const OFFER_CUSTOM_FIELD_KEYS = [
  'offer_amount',
  'type_of_deal',
  'close_date_target',
  'offer__entry_fee',
  'property_address',
  'offer__property_city',
  'offer__property_state',
  'offer_notes',
  'deal_id',
];

// In-memory caches (per container invocation).
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

// Resolve (upsert) an internal notification inbox into a GHL contact ID
// so we can send an email via the Conversations API. GHL's upsert is
// idempotent on email, so repeated calls just return the existing
// contact.
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
    console.warn('[submit-offer] internal contact upsert failed for ' + email + ':', e.message);
    return null;
  }
}

// Ensure a GHL contact exists with the given phone number so sendSMS can
// find it. sendSMS() searches /contacts/?query=<phone> and bails with
// 404 when no match — which silently drops every notification SMS if
// nobody has ever been created with that number. This upsert guarantees
// the lookup succeeds.
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
    console.warn('[submit-offer] notification-phone contact upsert failed for ' + phone + ':', e.message);
    return null;
  }
}

function buildInternalOfferEmailHtml(ctx) {
  function row(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return '<tr><td style="padding:8px 14px;font-size:13px;color:#718096;border-bottom:1px solid #E2E8F0;width:40%">' + label + '</td>'
      + '<td style="padding:8px 14px;font-size:14px;color:#0D1F3C;font-weight:700;border-bottom:1px solid #E2E8F0">' + value + '</td></tr>';
  }
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var rows = [
    row('Buyer',        esc(ctx.buyerName)),
    row('Phone',        esc(ctx.buyerPhone)),
    row('Email',        esc(ctx.buyerEmail)),
    row('Deal ID',      esc(ctx.dealId)),
    row('Property',     esc(ctx.fullAddress)),
    row('Asset Type',   esc(ctx.dealType)),
    row('Offer Amount', esc(ctx.amountFmt)),
    row('Type of Deal', esc(ctx.typeOfDeal)),
    row('Entry Fee',    esc(ctx.entryFeeFmt)),
    row('Target Close', esc(ctx.coe)),
  ].join('');
  var notesBlock = ctx.notes
    ? '<div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:14px 16px;margin-top:16px"><div style="font-size:12px;color:#92400E;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Proposed Terms / Notes</div><div style="font-size:14px;color:#1F2937;white-space:pre-wrap">' + esc(ctx.notes) + '</div></div>'
    : '';
  return '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px">'
    + '<h2 style="color:#0D1F3C;margin:0 0 8px">🔥 New Offer Received</h2>'
    + '<p style="color:#4A5568;font-size:13px;margin:0 0 16px">Submitted ' + new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }) + ' MST</p>'
    + '<table style="width:100%;border-collapse:collapse;background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden"><tbody>' + rows + '</tbody></table>'
    + notesBlock
    + (ctx.contactId ? '<p style="margin-top:20px"><a href="https://app.gohighlevel.com/v2/location/' + esc(process.env.GHL_LOCATION_ID || '') + '/contacts/detail/' + esc(ctx.contactId) + '" style="background:#0D1F3C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px">Open contact in GHL →</a></p>' : '')
    + '</div>';
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

  var diagnostic = {
    contactId: contactId,
    dealId: dealId,
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

  // 2. Post note + add tags in parallel, capture statuses
  try {
    var ntResults = await Promise.all([
      postNote(apiKey, contactId, noteLines),
      addTags(apiKey, contactId, ['Offer Submitted', 'Active Buyer', 'offer-' + dealId.substring(0, 8)])
    ]);
    diagnostic.noteStatus = ntResults[0].status;
    diagnostic.tagStatus  = ntResults[1].status;
    if (ntResults[0].status >= 400) diagnostic.errors.push('postNote -> ' + ntResults[0].status);
    if (ntResults[1].status >= 400) diagnostic.errors.push('addTags -> ' + ntResults[1].status);
  } catch (e) {
    console.warn('[submit-offer] note/tag failed:', e.message);
    diagnostic.errors.push('note/tag: ' + e.message);
  }

  // 2b. Write the 4 contact custom fields Brooke's templates expect
  // ({{contact.offer_amount}}, {{contact.type_of_deal}},
  // {{contact.close_date_target}}, {{contact.entry_fee}}). GHL requires
  // field UUIDs, so look them up on the location and PUT only the fields
  // we can resolve. Silently skipped fields are logged.
  try {
    var cfMap = await getLocationCustomFieldMap(apiKey, locationId);
    var values = {
      offer_amount:           amount != null ? String(amount) : '',
      type_of_deal:           typeOfDeal || '',       // Cash | Creative
      close_date_target:      coe        || '',
      offer__entry_fee:       entryFee   || '',
      property_address:       streetAddress || '',
      offer__property_city:   city          || '',
      offer__property_state:  state         || '',
      offer_notes:            notes         || '',
      deal_id:                dealId        || '',   // Notion Deal ID (e.g. PHX-001)
    };
    var cfPayload = [];
    OFFER_CUSTOM_FIELD_KEYS.forEach(function (k) {
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
        console.warn('[submit-offer] custom fields update -> ' + cfRes.status, JSON.stringify(cfRes.body));
        diagnostic.errors.push('updateCustomFields -> ' + cfRes.status);
      } else {
        console.log('[submit-offer] wrote ' + cfPayload.length + ' custom fields to contact=' + contactId);
      }
    }
    if (diagnostic.fieldsSkipped.length) {
      console.warn('[submit-offer] custom-field keys not found on location, skipped:', diagnostic.fieldsSkipped.join(', '));
    }
  } catch (e) {
    console.warn('[submit-offer] custom fields write failed:', e.message);
    diagnostic.errors.push('customFields: ' + e.message);
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
      diagnostic.opportunityStatus = oppRes.status;
      if (oppRes.status >= 400) {
        var errText = await oppRes.text();
        console.warn('[submit-offer] opportunity create -> ' + oppRes.status, errText);
        diagnostic.errors.push('opportunity -> ' + oppRes.status);
      } else {
        console.log('[submit-offer] opportunity created for ' + buyerName + ' amount=' + (amount || 'n/a'));
      }
    } catch (e) {
      console.warn('[submit-offer] opportunity creation failed:', e.message);
      diagnostic.errors.push('opportunity: ' + e.message);
    }
  }

  // 4. SMS notification to the team line
  var notifyPhone = process.env.BROOKE_PHONE || DEFAULT_NOTIFICATION_PHONE;
  diagnostic.notifyPhone = notifyPhone;
  if (notifyPhone && locationId) {
    var sms = 'New offer: ' + (buyerName || 'Buyer') + ' on ' + location;
    if (amount) sms += ' — ' + amountFmt;
    if (typeOfDeal) sms += ' [' + typeOfDeal + ']';
    if (entryFee) sms += ', entry ' + entryFeeFmt;
    if (coe) sms += ', close ' + coe;
    if (sms.length > 300) sms = sms.slice(0, 297) + '...';
    try {
      // Upsert a GHL contact with this phone first so sendSMS's lookup
      // doesn't 404. sendSMS does contacts/?query=<phone>; without an
      // existing contact it returns early and the SMS is silently dropped.
      await ensureNotificationPhoneContact(apiKey, locationId, notifyPhone);
      var smsRes = await sendSMS(apiKey, locationId, notifyPhone, sms);
      diagnostic.smsStatus = smsRes && smsRes.status ? smsRes.status : 'sent';
      if (smsRes && smsRes.status >= 400) {
        diagnostic.errors.push('notifySMS -> ' + smsRes.status + ' ' + (smsRes.body && (smsRes.body.error || JSON.stringify(smsRes.body)) || ''));
      }
    } catch (e) {
      console.warn('[submit-offer] notification SMS failed:', e.message);
      diagnostic.errors.push('notifySMS: ' + e.message);
    }
  }

  // 4b. Internal notification email to offers@termsforsale.com
  try {
    var internalId = await getInternalContactId(apiKey, locationId, INTERNAL_NOTIFICATION_EMAIL);
    if (internalId) {
      var subjectBits = ['🔥 New Offer — ' + (buyerName || 'Buyer')];
      if (location) subjectBits.push(' on ' + location);
      if (typeOfDeal) subjectBits.push(' (' + typeOfDeal + ')');
      if (amount) subjectBits.push(' — ' + amountFmt);
      var internalSubject = subjectBits.join('');
      var internalHtml = buildInternalOfferEmailHtml({
        buyerName: buyerName,
        buyerPhone: buyerPhone,
        buyerEmail: buyerEmail,
        dealId: dealId,
        fullAddress: fullAddress,
        dealType: dealType,
        amountFmt: amountFmt,
        typeOfDeal: typeOfDeal,
        entryFeeFmt: entryFeeFmt,
        coe: coe,
        notes: notes,
        contactId: contactId,
      });
      var internalRes = await sendEmail(apiKey, internalId, internalSubject, internalHtml);
      diagnostic.internalEmailStatus = internalRes.status;
      if (internalRes.status >= 400) {
        console.warn('[submit-offer] internal email -> ' + internalRes.status, JSON.stringify(internalRes.body));
        diagnostic.errors.push('internalEmail -> ' + internalRes.status);
      } else {
        console.log('[submit-offer] internal notification email sent to ' + INTERNAL_NOTIFICATION_EMAIL);
      }
    } else {
      diagnostic.internalEmailStatus = 'skipped-no-inbox-contact';
      diagnostic.errors.push('internalEmail: could not resolve inbox contactId');
    }
  } catch (e) {
    console.warn('[submit-offer] internal email failed:', e.message);
    diagnostic.errors.push('internalEmail: ' + e.message);
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
      diagnostic.emailStatus = emailRes.status;
      if (emailRes.status >= 400) {
        console.warn('[submit-offer] buyer email -> ' + emailRes.status, JSON.stringify(emailRes.body));
        diagnostic.errors.push('buyerEmail -> ' + emailRes.status);
      } else {
        console.log('[submit-offer] confirmation email sent to ' + buyerEmail);
      }
    } catch (e) {
      console.warn('[submit-offer] buyer email failed:', e.message);
      diagnostic.errors.push('buyerEmail: ' + e.message);
    }
  } else {
    console.warn('[submit-offer] no buyer email on contact — skipping confirmation send');
    diagnostic.emailStatus = 'skipped-no-email';
  }

  console.log('[submit-offer] contact=' + contactId + ' deal=' + dealId + ' amount=' + amount + ' type=' + typeOfDeal + ' entry=' + entryFee + ' coe=' + coe + ' diagnostic=' + JSON.stringify(diagnostic));

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
