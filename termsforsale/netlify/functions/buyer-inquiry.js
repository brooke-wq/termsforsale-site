// buyer-inquiry.js — Receives InvestorLift inquiry and offer webhooks.
// Creates/updates a GHL opportunity in the "Inquiry Setter" pipeline.
//
// Inquiry: buyer is requesting more info / address reveal on a deal.
// Offer:   buyer is submitting a price offer on a deal.
//
// POST /api/buyer-inquiry

const { upsertContact, addTags, postNote } = require('./_ghl');

const GHL_API_KEY     = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// Pipeline / stage IDs — Brooke sets these in Netlify env vars.
// Fallback strings are placeholders that will cause a clear GHL error
// if the real IDs have not been configured yet.
const PIPELINE_ID_INQUIRY  = process.env.GHL_PIPELINE_ID_INQUIRY  || null;
const STAGE_NEW_INQUIRY    = process.env.GHL_STAGE_NEW_INQUIRY     || null;
const STAGE_OFFER_RECEIVED = process.env.GHL_STAGE_OFFER_RECEIVED  || null; // optional separate stage

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

      // Stage: use STAGE_OFFER_RECEIVED if configured, else STAGE_NEW_INQUIRY
      const stageId = STAGE_OFFER_RECEIVED || STAGE_NEW_INQUIRY;

      const oppBody = {
        pipelineId:      PIPELINE_ID_INQUIRY,
        pipelineStageId: stageId,
        locationId:      GHL_LOCATION_ID,
        name:            streetAddress || 'Offer from ' + contactName,
        status:          'open',
        notes:           offerNotes
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
        notes:           inquiryNotes,
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
