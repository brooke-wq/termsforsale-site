// buyer-inquiry.js — Receives InvestorLift inquiry and offer webhooks.
// Creates/updates a GHL opportunity in the "Inquiry Setter" pipeline.
//
// Inquiry: buyer is requesting more info / address reveal on a deal.
// Offer:   buyer is submitting a price offer on a deal.
//
// POST /api/buyer-inquiry

const {
  upsertContact, addTags, postNote, sendSMS, sendEmail,
  sendOfficeSms, sendOffersInboxEmail, sendInquiriesInboxEmail
} = require('./_ghl');

const GHL_API_KEY     = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// Pipeline / stage IDs — Brooke sets these in Netlify env vars.
// Fallback strings are placeholders that will cause a clear GHL error
// if the real IDs have not been configured yet.
const PIPELINE_ID_INQUIRY    = process.env.GHL_PIPELINE_ID_INQUIRY    || null; // 1. Inquiry Setter
const PIPELINE_ID_BUYER      = process.env.GHL_PIPELINE_ID_BUYER      || null; // 2. Buyer Inquiries
const STAGE_NEW_INQUIRY      = process.env.GHL_STAGE_NEW_INQUIRY       || null; // New Lead - Inquiry
const STAGE_BUYING_CRITERIA  = process.env.GHL_STAGE_BUYING_CRITERIA    || null; // New Buying Criteria Form
const STAGE_OFFER_RECEIVED   = process.env.GHL_STAGE_OFFER_RECEIVED    || null; // Offer Submitted (Buyer Inquiries)

const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function ghlHeaders() {
  return {
    'Authorization': 'Bearer ' + GHL_API_KEY,
    'Version': GHL_VERSION,
    'Content-Type': 'application/json'
  };
}

async function createOpportunity(body) {
  const res  = await fetch(GHL_BASE + '/opportunities/', {
    method:  'POST',
    headers: ghlHeaders(),
    body:    JSON.stringify(body)
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  if (res.status >= 400) {
    console.error('[buyer-inquiry] GHL opportunity create -> ' + res.status, JSON.stringify(parsed));
  }
  return { status: res.status, body: parsed };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Parse body
    let payload = {};
    if (event.body) {
      try { payload = JSON.parse(event.body); } catch (e) {
        console.error('[buyer-inquiry] Failed to parse body:', e.message);
      }
    }
    if (event.queryStringParameters) {
      Object.assign(payload, event.queryStringParameters);
    }

    // ── BUYING CRITERIA CONFIRMATION ────────────────────────────────────────
    if (payload.action === 'buying-criteria-confirm') {
      console.log('[buyer-inquiry] Buying criteria confirmation for ' + payload.email);

      // Find contact by email/phone
      var confirmContactId = null;
      if (payload.email || payload.phone) {
        var uRes = await upsertContact(GHL_API_KEY, GHL_LOCATION_ID, {
          firstName: payload.firstName || '',
          email: payload.email || '',
          phone: payload.phone || '',
          source: 'Buying Criteria Form'
        });
        if (uRes.status < 400) {
          confirmContactId = (uRes.body.contact && uRes.body.contact.id) || uRes.body.id;
        }
      }

      // Create opportunity in Inquiry Setter → New Buying Criteria Form
      if (confirmContactId && PIPELINE_ID_INQUIRY && STAGE_BUYING_CRITERIA) {
        try {
          var bcOpp = await createOpportunity({
            pipelineId: PIPELINE_ID_INQUIRY,
            pipelineStageId: STAGE_BUYING_CRITERIA,
            locationId: GHL_LOCATION_ID,
            contactId: confirmContactId,
            name: 'Buying Criteria — ' + (payload.firstName || '') + ' ' + (payload.email || ''),
            status: 'open'
          });
          console.log('[buyer-inquiry] Buying criteria opportunity created:', bcOpp.body?.id || bcOpp.body?.opportunity?.id);
        } catch(e) { console.warn('[buyer-inquiry] BC opportunity failed:', e.message); }
      }

      // Post criteria as contact note
      if (confirmContactId && payload.summary) {
        try {
          await postNote(GHL_API_KEY, confirmContactId, '=== BUYING CRITERIA SUBMITTED ===\n' + payload.summary);
        } catch(e) {}
      }

      var smsOk = false, emailOk = false;

      // Send confirmation SMS
      if (confirmContactId && payload.phone) {
        try {
          await sendSMS(GHL_API_KEY, GHL_LOCATION_ID, payload.phone,
            'Thanks ' + (payload.firstName || '') + '! Your buying criteria is saved. We\'ll match you to deals automatically. Browse: https://termsforsale.com');
          smsOk = true;
        } catch(e) { console.warn('[buyer-inquiry] SMS failed:', e.message); }
      }

      // Send recap email
      if (confirmContactId && payload.email) {
        try {
          var summary = (payload.summary || '').replace(/\n/g, '<br>');
          await sendEmail(GHL_API_KEY, confirmContactId,
            'Your Buying Criteria — Terms For Sale',
            '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
            + '<div style="background:#0D1F3C;padding:24px 32px;border-radius:12px 12px 0 0"><img src="https://assets.cdn.filesafe.space/7IyUgu1zpi38MDYpSDTs/media/697a3aee1fd827ffd863448d.svg" alt="Terms For Sale" style="height:36px"></div>'
            + '<div style="padding:32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
            + '<h2 style="color:#0D1F3C;margin:0 0 12px">Your Buying Criteria is Saved!</h2>'
            + '<p style="color:#4A5568;line-height:1.6;margin:0 0 20px">Here\'s a recap of what you submitted:</p>'
            + '<div style="background:#F4F6F9;border-radius:8px;padding:16px 20px;margin:0 0 24px;font-size:13px;line-height:1.8;color:#4A5568">' + summary + '</div>'
            + '<p style="color:#4A5568;line-height:1.6;margin:0 0 20px">We\'ll start matching you to deals that fit your criteria. You can update your buy box anytime at:</p>'
            + '<a href="https://termsforsale.com/buy-box.html" style="display:inline-block;padding:14px 28px;background:#29ABE2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Update My Buy Box</a>'
            + '<p style="color:#718096;font-size:13px;margin-top:24px">Questions? Reply to this email anytime.</p>'
            + '</div></div>'
          );
          emailOk = true;
        } catch(e) { console.warn('[buyer-inquiry] Email failed:', e.message); }
      }

      // Internal notification to the Terms For Sale office line
      try {
        await sendOfficeSms(GHL_API_KEY, GHL_LOCATION_ID,
          'NEW BUYER CRITERIA: ' + (payload.firstName || '') + ' ' + (payload.email || '') + ' — ' + (payload.summary || '').split('\n').slice(0, 3).join(' | ').slice(0, 120));
      } catch(e) { console.warn('[buyer-inquiry] office SMS (buying criteria) failed:', e.message); }

      // Internal alert email to info@termsforsale.com
      try {
        var bcSummaryHtml = (payload.summary || '(no summary provided)').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        var bcHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
          + '<div style="background:#0D1F3C;padding:20px 32px;border-radius:12px 12px 0 0">'
          + '<h2 style="color:#fff;margin:0;font-size:18px">New Buying Criteria Submitted</h2>'
          + '</div>'
          + '<div style="padding:24px 32px;background:#fff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">'
          + '<p style="color:#4A5568;margin:0 0 16px">A buyer just updated their buy box on the Terms For Sale website.</p>'
          + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px">'
          + '<tr><td style="padding:8px 0;color:#718096;font-weight:600">Name</td><td style="padding:8px 0;color:#0D1F3C;font-weight:700">' + ((payload.firstName || '') + ' ' + (payload.lastName || '')).trim() + '</td></tr>'
          + '<tr><td style="padding:8px 0;color:#718096;font-weight:600">Email</td><td style="padding:8px 0;color:#0D1F3C">' + (payload.email || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;color:#718096;font-weight:600">Phone</td><td style="padding:8px 0;color:#0D1F3C">' + (payload.phone || 'N/A') + '</td></tr>'
          + '</table>'
          + '<div style="background:#F4F6F9;border-radius:8px;padding:16px 20px;font-size:13px;line-height:1.8;color:#4A5568">' + bcSummaryHtml + '</div>'
          + '<p style="color:#718096;font-size:12px;margin-top:16px">Submitted ' + new Date().toISOString().split('T')[0] + ' · Terms For Sale website</p>'
          + '</div></div>';
        await sendInquiriesInboxEmail(GHL_API_KEY, GHL_LOCATION_ID,
          'New buying criteria: ' + (payload.firstName || payload.email || 'buyer'),
          bcHtml);
      } catch(e) { console.warn('[buyer-inquiry] inquiries inbox email (buying criteria) failed:', e.message); }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, type: 'buying-criteria-confirm', sms: smsOk, email: emailOk })
      };
    }

    // ── Detect payload type ──────────────────────────────────────────────────
    // "OFFER" if type === "OFFER" or a price field is present without a message
    const isOffer = (payload.type && payload.type.toUpperCase() === 'OFFER') ||
                    (payload.price !== undefined && payload.customerPhoneNumber !== undefined);

    if (!PIPELINE_ID_INQUIRY) {
      console.warn('[buyer-inquiry] GHL_PIPELINE_ID_INQUIRY env var not set — opportunity will fail until configured');
    }
    if (!STAGE_NEW_INQUIRY) {
      console.warn('[buyer-inquiry] GHL_STAGE_NEW_INQUIRY env var not set — opportunity will fail until configured');
    }

    // ── Build address string ─────────────────────────────────────────────────
    const streetAddress = payload.propertyStreetAddress || payload.address || '';
    const city          = payload.propertyCity          || payload.city    || '';
    const stateCode     = payload.propertyStateCode     || payload.state   || '';
    const zip           = payload.propertyZip           || payload.zip     || '';
    const fullAddress   = [streetAddress, city, stateCode, zip].filter(Boolean).join(', ');

    let contactId   = null;
    let contactName = '';

    // ── OFFER ────────────────────────────────────────────────────────────────
    if (isOffer) {
      const firstName = payload.customerFirstName || '';
      const lastName  = payload.customerLastName  || '';
      const phone     = payload.customerPhoneNumber || '';
      contactName     = [firstName, lastName].filter(Boolean).join(' ') || phone;

      console.log('[buyer-inquiry] New OFFER: $' + payload.price + ' for ' + streetAddress + ' from ' + contactName);

      // Upsert buyer contact
      const upsertRes = await upsertContact(GHL_API_KEY, GHL_LOCATION_ID, {
        firstName,
        lastName,
        phone,
        source: 'InvestorLift'
      });

      if (upsertRes.status >= 400) {
        throw new Error('GHL upsert failed: ' + JSON.stringify(upsertRes.body));
      }
      const contact = upsertRes.body.contact || upsertRes.body;
      contactId = contact.id;

      if (contactId) {
        await addTags(GHL_API_KEY, contactId, ['offer-received', 'source:investorlift']);
        console.log('[buyer-inquiry] Tagged contact ' + contactId + ' with offer-received');
      }

      // Build opportunity notes
      const offerNotes = [
        '=== InvestorLift OFFER Received ===',
        'Offer Amount: $' + (payload.price || 'N/A'),
        'Property: '      + (fullAddress   || 'N/A'),
        'Buyer: '         + contactName,
        'Phone: '         + (phone || 'N/A'),
        '',
        'Raw notes: ' + (payload.message || payload.notes || '')
      ].join('\n');

      // Offers go to Buyer Inquiries pipeline → Offer Submitted stage
      const offerPipeline = PIPELINE_ID_BUYER || PIPELINE_ID_INQUIRY;
      const offerStage = STAGE_OFFER_RECEIVED || STAGE_NEW_INQUIRY;

      const oppBody = {
        pipelineId:      offerPipeline,
        pipelineStageId: offerStage,
        locationId:      GHL_LOCATION_ID,
        name:            streetAddress || 'Offer from ' + contactName,
        status:          'open'
      };
      if (contactId) oppBody.contactId = contactId;

      // Include offer amount + property fields as custom fields
      oppBody.customFields = [
        { key: 'property_address', field_value: streetAddress },
        { key: 'deal_city',        field_value: city },
        { key: 'deal_state',       field_value: stateCode },
        { key: 'deal_zip',         field_value: zip },
        { key: 'offer_amount',     field_value: String(payload.price || '') }
      ].filter(f => f.field_value);

      const oppRes = await createOpportunity(oppBody);
      if (oppRes.status >= 400) {
        throw new Error('GHL opportunity create failed: ' + JSON.stringify(oppRes.body));
      }

      const oppId = (oppRes.body.opportunity && oppRes.body.opportunity.id) || (oppRes.body.id);
      console.log('[buyer-inquiry] Offer opportunity created: ' + oppId);

      // Post note to contact too
      if (contactId) {
        await postNote(GHL_API_KEY, contactId, offerNotes);
      }

      // Send internal notification email to offers@termsforsale.com
      try {
        await sendOffersInboxEmail(GHL_API_KEY, GHL_LOCATION_ID,
          'NEW OFFER: $' + (payload.price || '?') + ' — ' + (fullAddress || 'Unknown Property'),
          '<div style="font-family:Arial,sans-serif;max-width:600px">'
          + '<h2 style="color:#0D1F3C;margin:0 0 16px">New Offer Received</h2>'
          + '<table style="width:100%;border-collapse:collapse">'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Buyer</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-weight:700">' + contactName + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Phone</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (phone || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Offer Amount</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-weight:800;font-size:18px">$' + Number(payload.price||0).toLocaleString() + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Property</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (fullAddress || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Structure</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (payload.deal_structure || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Close</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (payload.close_date || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;color:#718096;font-weight:600">Notes</td><td style="padding:8px 0;color:#0D1F3C">' + (payload.message || 'None') + '</td></tr>'
          + '</table></div>'
        );
        console.log('[buyer-inquiry] Internal offer notification sent to offers inbox');
      } catch(e) { console.warn('[buyer-inquiry] offers inbox email failed:', e.message); }

      // SMS alert to the Terms For Sale office line
      try {
        await sendOfficeSms(GHL_API_KEY, GHL_LOCATION_ID,
          'NEW OFFER: $' + Number(payload.price||0).toLocaleString() + ' on ' + (fullAddress || 'property') + ' from ' + contactName);
      } catch(e) { console.warn('[buyer-inquiry] office SMS (offer) failed:', e.message); }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, type: 'offer', opportunityId: oppId, contactId })
      };

    // ── INQUIRY ──────────────────────────────────────────────────────────────
    } else {
      const message = payload.message || payload.notes || '';
      contactName   = payload.buyerName || payload.firstName || payload.email || 'Unknown Buyer';

      console.log('[buyer-inquiry] New inquiry for ' + (streetAddress || 'unknown address') + ' from ' + contactName);

      // Try to find existing contact by email or phone if provided
      if (payload.buyerEmail || payload.email || payload.buyerPhone || payload.phone) {
        const upsertRes = await upsertContact(GHL_API_KEY, GHL_LOCATION_ID, {
          firstName:   payload.firstName   || payload.buyerFirstName || '',
          lastName:    payload.lastName    || payload.buyerLastName  || '',
          email:       payload.buyerEmail  || payload.email          || '',
          phone:       payload.buyerPhone  || payload.phone          || '',
          source:      'InvestorLift'
        });
        if (upsertRes.status < 400) {
          const contact = upsertRes.body.contact || upsertRes.body;
          contactId = contact.id || null;
          if (contactId) {
            await addTags(GHL_API_KEY, contactId, ['inquiry-submitted', 'source:investorlift']);
          }
        }
      }

      const inquiryNotes = [
        '=== InvestorLift Inquiry ===',
        'Property: '  + (fullAddress || 'N/A'),
        'Buyer: '     + contactName,
        '',
        'Message: '   + (message || 'No message provided')
      ].join('\n');

      const oppBody = {
        pipelineId:      PIPELINE_ID_INQUIRY,
        pipelineStageId: STAGE_NEW_INQUIRY,
        locationId:      GHL_LOCATION_ID,
        name:            streetAddress || 'Inquiry from ' + contactName,
        status:          'open',
        customFields:    [
          { key: 'property_address', field_value: streetAddress },
          { key: 'deal_city',        field_value: city },
          { key: 'deal_state',       field_value: stateCode },
          { key: 'deal_zip',         field_value: zip }
        ].filter(f => f.field_value)
      };
      if (contactId) oppBody.contactId = contactId;

      const oppRes = await createOpportunity(oppBody);
      if (oppRes.status >= 400) {
        throw new Error('GHL opportunity create failed: ' + JSON.stringify(oppRes.body));
      }

      const oppId = (oppRes.body.opportunity && oppRes.body.opportunity.id) || (oppRes.body.id);
      console.log('[buyer-inquiry] Inquiry opportunity created: ' + oppId);

      if (contactId && inquiryNotes) {
        await postNote(GHL_API_KEY, contactId, inquiryNotes);
      }

      // Internal notification email to info@termsforsale.com
      try {
        await sendInquiriesInboxEmail(GHL_API_KEY, GHL_LOCATION_ID,
          'NEW INQUIRY: ' + contactName + ' — ' + (fullAddress || 'Deal Page'),
          '<div style="font-family:Arial,sans-serif;max-width:600px">'
          + '<h2 style="color:#0D1F3C;margin:0 0 16px">New Buyer Inquiry</h2>'
          + '<table style="width:100%;border-collapse:collapse">'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Buyer</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C;font-weight:700">' + contactName + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Phone</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (payload.phone || payload.buyerPhone || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Email</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (payload.email || payload.buyerEmail || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#718096;font-weight:600">Property</td><td style="padding:8px 0;border-bottom:1px solid #EDF2F7;color:#0D1F3C">' + (fullAddress || 'N/A') + '</td></tr>'
          + '<tr><td style="padding:8px 0;color:#718096;font-weight:600">Message</td><td style="padding:8px 0;color:#0D1F3C">' + (message || 'None') + '</td></tr>'
          + '</table></div>'
        );
      } catch(e) { console.warn('[buyer-inquiry] inquiries inbox email failed:', e.message); }

      // SMS alert to the Terms For Sale office line
      try {
        await sendOfficeSms(GHL_API_KEY, GHL_LOCATION_ID,
          'NEW INQUIRY: ' + contactName + ' asking about ' + (fullAddress || 'a deal') + '. ' + (message ? '"' + message.slice(0,60) + '"' : ''));
      } catch(e) { console.warn('[buyer-inquiry] office SMS (inquiry) failed:', e.message); }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, type: 'inquiry', opportunityId: oppId, contactId })
      };
    }

  } catch (err) {
    console.error('[buyer-inquiry] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
// deploy 1775077461
