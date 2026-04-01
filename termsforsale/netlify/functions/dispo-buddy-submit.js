/**
 * Dispo Buddy — Submit Deal
 * POST /.netlify/functions/dispo-buddy-submit
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY          — GHL private integration API key (same one as Acquisition Assist)
 *   GHL_LOCATION_ID      — GHL Location ID (same as Acquisition Assist)
 *
 * Pipeline IDs (from your GHL account — already confirmed):
 *   Pipeline: "3. JV Deals"        → XbZojO2rHmYtYa8C0yUP
 *   Stage:    "New JV Lead"        → cf2388f0-fdbf-4fb1-b633-86569034fcce
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

// ── Pipeline IDs (hardcoded — from your confirmed GHL JSON) ──
const JV_PIPELINE_ID = 'XbZojO2rHmYtYa8C0yUP';
const JV_STAGE_NEW   = 'cf2388f0-fdbf-4fb1-b633-86569034fcce';

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey    = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  if (!body.jv_partner_name || !body.jv_phone_number) {
    return respond(400, { error: 'Missing required fields: jv_partner_name, jv_phone_number' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // ── 1. Upsert Contact ───────────────────────────────────
    const contactPayload = buildContactPayload(body, locationId);
    const contactRes  = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('Contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create contact', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) return respond(502, { error: 'No contact ID returned' });

    // ── 2. Apply Tags ───────────────────────────────────────
    const tags = buildTags(body);
    await ghlFetch(`${GHL_BASE}/contacts/${contactId}/tags`, 'POST', { tags }, headers);

    // ── 3. Create Opportunity in JV Deals Pipeline ──────────
    const oppPayload = buildOpportunityPayload(body, contactId, locationId);
    const oppRes  = await ghlFetch(`${GHL_BASE}/opportunities/`, 'POST', oppPayload, headers);
    const oppData = await oppRes.json();

    if (!oppRes.ok) {
      console.warn('Opportunity creation failed (non-fatal):', JSON.stringify(oppData));
    }

    console.log('Dispo Buddy submission:', JSON.stringify({
      contactId,
      name: body.jv_partner_name,
      dealType: body.deal_type,
      property: `${body.property_city}, ${body.property_state}`,
      tags,
      opportunityId: oppData?.id || 'not created',
    }));

    // Send confirmation SMS to the JV partner
    var partnerPhone = body.jv_partner_phone || body.phone || '';
    if (partnerPhone && contactId) {
      try {
        await ghlFetch(`${GHL_BASE}/conversations/messages`, 'POST', {
          type: 'SMS',
          contactId: contactId,
          message: 'Thanks for submitting your deal in ' + (body.property_city || '') + ', ' + (body.property_state || '') + '! Our team will review it within 24hrs. — Deal Pros LLC'
        }, headers);
        console.log('[dispo-buddy-submit] confirmation SMS sent to ' + partnerPhone);
      } catch (e) {
        console.warn('[dispo-buddy-submit] SMS failed:', e.message);
      }
    }

    return respond(200, { success: true, contactId, message: 'Deal submitted successfully' });

  } catch (err) {
    console.error('Dispo Buddy function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// BUILD CONTACT PAYLOAD
// Uses exact GHL custom field keys from your account
// ─────────────────────────────────────────────────────────────
function buildContactPayload(d, locationId) {
  const customFields = [];

  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  // JV Partner fields
  cf('jv_partner_name',                          d.jv_partner_name);
  cf('jv_phone_number',                          d.jv_phone_number);
  cf('jv_partner_email',                         d.jv_partner_email);
  cf('do_you_have_the_property_under_contract',  d.do_you_have_the_property_under_contract);
  cf('is_this_your_first_deal_with_dispo_buddy', d.is_this_your_first_deal_with_dispo_buddy);
  cf('how_did_you_hear_about_us',                d.how_did_you_hear_about_us);

  // Property
  cf('property_address',              `${d.property_address}, ${d.property_city}, ${d.property_state} ${d.property_zip}`);
  cf('coe',                           d.coe);
  cf('property_occupancy',            d.property_occupancy);
  cf('how_can_we_access_the_property', d.how_can_we_access_the_property);
  cf('link_to_photos',                d.link_to_photos);
  cf('link_to_supporting_documents',  d.link_to_supporting_documents);

  // Deal
  cf('deal_type',              d.deal_type);
  cf('contracted_price',       d.contracted_price);
  cf('desired_asking_price',   d.desired_asking_price);
  cf('arv_estimate',           d.arv_estimate);
  cf('what_is_the_buyer_entry_fee', d.what_is_the_buyer_entry_fee);
  cf('contracted_entry_fee',   d.contracted_entry_fee);
  cf('est_taxes__insurance',   d.est_taxes__insurance);

  // SubTo fields (exact keys)
  cf('subto_loan_balance',     d.subto_loan_balance);
  cf('interest_rate',          d.interest_rate);           // SubTo rate
  cf('monthly_payment',        d.monthly_payment);         // SubTo PITI
  cf('loan_maturity',          d.loan_maturity);
  cf('subto_balloon',          d.subto_balloon);

  // Seller Finance fields (exact keys)
  cf('seller_finance_loan_amount',    d.seller_finance_loan_amount);
  cf('sf_loan_payment',               d.sf_loan_payment);
  cf('interest_rate_seller_finance',  d.interest_rate_seller_finance);
  cf('loan_term',                     d.loan_term);
  cf('sf_balloon',                    d.sf_balloon);
  cf('dscr_loan_amount',              d.dscr_loan_amount);

  // Notes
  cf('important_details', d.important_details);

  // Parse name into first/last
  const nameParts = (d.jv_partner_name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  return {
    locationId,
    firstName,
    lastName,
    phone: d.jv_phone_number,
    email: d.jv_partner_email || undefined,
    source: 'Dispo Buddy — Submit Deal',
    customFields,
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD TAGS
// ─────────────────────────────────────────────────────────────
function buildTags(d) {
  const tags = ['dispo-buddy', 'jv-partner', 'jv-submitted'];

  const type = (d.deal_type || '').toLowerCase();
  if (type.includes('cash'))           tags.push('db-cash');
  if (type.includes('subto') || type.includes('subject')) tags.push('db-subto');
  if (type.includes('seller finance')) tags.push('db-seller-finance');
  if (type.includes('hybrid'))         { tags.push('db-hybrid'); tags.push('db-subto'); tags.push('db-seller-finance'); }
  if (type.includes('morby') || type.includes('stack')) { tags.push('db-morby'); tags.push('db-subto'); tags.push('db-seller-finance'); }

  if (d.is_this_your_first_deal_with_dispo_buddy === 'Yes') tags.push('db-first-deal');

  const contract = (d.do_you_have_the_property_under_contract || '').toLowerCase();
  if (contract.includes('direct to seller') || contract.includes('agent')) tags.push('db-direct-to-seller');
  if (contract.includes('jv agreement')) tags.push('db-jv-with-wholesaler');

  return [...new Set(tags)];
}

// ─────────────────────────────────────────────────────────────
// BUILD OPPORTUNITY
// Uses "3. JV Deals" pipeline — New JV Lead stage
// ─────────────────────────────────────────────────────────────
function buildOpportunityPayload(d, contactId, locationId) {
  const city     = d.property_city     || '';
  const state    = d.property_state    || '';
  const nameParts = (d.jv_partner_name || '').trim().split(' ');
  const lastName = nameParts.slice(1).join(' ') || nameParts[0] || '';
  const dealType = d.deal_type || 'Deal';

  const name = `${dealType} — ${city}${state ? ' ' + state : ''} — ${lastName}`;
  const value = parseFloat(d.desired_asking_price || d.contracted_price || 0) || 0;

  return {
    locationId,
    name,
    contactId,
    pipelineId:      JV_PIPELINE_ID,
    pipelineStageId: JV_STAGE_NEW,
    monetaryValue:   value,
    status: 'open',
    source: 'Dispo Buddy — Submit Deal Form',
    customFields: [
      { key: 'deal_type',  field_value: d.deal_type || '' },
      { key: 'arv_estimate', field_value: d.arv_estimate || '' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
async function ghlFetch(url, method, payload, headers) {
  return fetch(url, {
    method,
    headers,
    body: JSON.stringify(payload),
  });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

/*
 * ─────────────────────────────────────────────────────────────
 * SETUP — Dispo Buddy Netlify Site
 * ─────────────────────────────────────────────────────────────
 *
 * This is a NEW Netlify site (separate from termsforsale-site).
 * Create a new GitHub repo: e.g. brooke-wq/dispobuddy-site
 *
 * FOLDER STRUCTURE:
 *   dispobuddy/
 *   ├── submit-deal.html
 *   └── netlify/
 *       └── functions/
 *           └── dispo-buddy-submit.js
 *
 * netlify.toml (in repo root):
 *   [build]
 *     publish = "dispobuddy"
 *     functions = "dispobuddy/netlify/functions"
 *
 * ENVIRONMENT VARIABLES (Netlify → Site config → Env vars):
 *   GHL_API_KEY       — same key as Acquisition Assist (or create new)
 *   GHL_LOCATION_ID   — same location ID
 *
 * NOTE: Pipeline and stage IDs are hardcoded in this file
 * (confirmed from your GHL JSON):
 *   Pipeline: XbZojO2rHmYtYa8C0yUP  (3. JV Deals)
 *   Stage:    cf2388f0-...           (New JV Lead)
 *
 * GHL WORKFLOW TRIGGER:
 *   Trigger: Contact Tag Added → tag = "dispo-buddy"
 *   → Send internal SMS alert
 *   → Send confirmation SMS to JV partner
 *   → Branch on: db-cash / db-subto / db-seller-finance
 *     for deal-type-specific follow-up sequences
 *
 * ─────────────────────────────────────────────────────────────
 */
