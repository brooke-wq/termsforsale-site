/**
 * Submit Inquiry — POST /.netlify/functions/submit-inquiry
 *
 * When a logged-in buyer clicks "Request Info" on a deal page:
 * 1. Posts a note on the contact with the full inquiry details
 * 2. Tags the contact (Website Inquiry, Active Buyer, inquiry-[dealId])
 * 3. Sends SMS notification to the Terms For Sale office line
 * 4. Sends internal alert email to info@termsforsale.com
 * 5. Sends confirmation email to the buyer with every submitted field
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID
 *           (optional overrides: TFS_OFFICE_PHONE, TFS_INQUIRIES_EMAIL)
 */

const {
  getContact, postNote, addTags, sendEmail,
  sendOfficeSms, sendInquiriesInboxEmail
} = require('./_ghl');

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
  // Form-level buyer info overrides
  var firstName    = (body.firstName || '').trim();
  var lastName     = (body.lastName || '').trim();
  var phone        = (body.phone || '').trim();
  var email        = (body.email || '').trim();

  if (!contactId || !dealId) {
    console.warn('[submit-inquiry] missing required fields:', { contactId: !!contactId, dealId: !!dealId });
    return respond(400, { error: 'Missing contactId or dealId' });
  }

  // Verify contact + pull existing fields
  var contactRes = await getContact(apiKey, contactId);
  if (contactRes.status >= 400) return respond(401, { error: 'Invalid contact' });
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

  // 2. Post note + tag in parallel
  await Promise.all([
    postNote(apiKey, contactId, noteLines),
    addTags(apiKey, contactId, [
      'Website Inquiry',
      'Active Buyer',
      'TFS Buyer',
      'inquiry-' + String(dealId).substring(0, 8)
    ])
  ]);

  // 3. Notify the Terms For Sale office line via SMS
  if (locationId) {
    var sms = 'New inquiry: ' + buyerName + ' on ' + location;
    if (dealType) sms += ' (' + dealType + ')';
    if (notes) sms += ' — "' + notes.slice(0, 120) + '"';
    if (sms.length > 300) sms = sms.slice(0, 297) + '...';
    try {
      await sendOfficeSms(apiKey, locationId, sms);
    } catch (e) {
      console.warn('[submit-inquiry] office SMS failed:', e.message);
    }
  }

  // 4. Internal alert email to info@termsforsale.com
  if (locationId) {
    try {
      var internalRows = '';
      internalRows += row('Buyer',   escapeHtml(buyerName));
      if (buyerPhone) internalRows += row('Phone', escapeHtml(buyerPhone));
      if (buyerEmail) internalRows += row('Email', escapeHtml(buyerEmail));
      internalRows += row('Deal',    escapeHtml(location + (dealType ? ' (' + dealType + ')' : '')));
      if (streetAddress) internalRows += row('Address', escapeHtml(fullAddress));
      internalRows += row('Deal ID', escapeHtml(String(dealId)));
      internalRows += row('Question', notes ? escapeHtml(notes) : '<em>(none provided)</em>');

      var internalHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
        + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
        + '<h2 style="color:#fff;margin:0;font-size:18px">New Buyer Inquiry</h2>'
        + '</div>'
        + '<div style="padding:24px 32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
        + '<p style="color:#4A5568;margin:0 0 16px">A logged-in buyer just submitted a question on the Terms For Sale website.</p>'
        + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;background:#F7FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">'
        +   '<tbody>' + internalRows + '</tbody>'
        + '</table>'
        + '<p style="color:#718096;font-size:12px;margin:0">Submitted ' + new Date().toISOString().split('T')[0] + ' · Terms For Sale website</p>'
        + '</div></div>';

      var internalSubject = 'New inquiry: ' + buyerName + ' — ' + location;
      var internalRes = await sendInquiriesInboxEmail(apiKey, locationId, internalSubject, internalHtml);
      if (internalRes.status >= 400) {
        console.warn('[submit-inquiry] inquiries inbox email -> ' + internalRes.status, JSON.stringify(internalRes.body));
      } else {
        console.log('[submit-inquiry] inquiries inbox email sent');
      }
    } catch (e) {
      console.warn('[submit-inquiry] inquiries inbox email failed:', e.message);
    }
  }

  // 5. Send buyer confirmation email with every submitted field
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
      if (emailRes.status >= 400) {
        console.warn('[submit-inquiry] buyer email -> ' + emailRes.status, JSON.stringify(emailRes.body));
      } else {
        console.log('[submit-inquiry] confirmation email sent to ' + buyerEmail);
      }
    } catch (e) {
      console.warn('[submit-inquiry] buyer email failed:', e.message);
    }
  } else {
    console.warn('[submit-inquiry] no buyer email on contact — skipping confirmation send');
  }

  console.log('[submit-inquiry] contact=' + contactId + ' deal=' + dealId + ' notes.len=' + notes.length);

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
