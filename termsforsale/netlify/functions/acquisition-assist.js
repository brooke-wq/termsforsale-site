/**
 * Acquisition Assist — Netlify Function
 * POST /.netlify/functions/acquisition-assist
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY        — Your GHL private integration API key (v2)
 *   GHL_LOCATION_ID    — Your GHL Location ID
 *   INTERNAL_SMS_NUMBER — Team phone number to receive internal alerts (e.g. +14806373117)
 *
 * GHL API v2 base: https://services.leadconnectorhq.com
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID env vars');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  // Basic required field guard
  if (!body.firstName || !body.phone) {
    return respond(400, { error: 'Missing required fields: firstName, phone' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // ── 1. Upsert Contact ───────────────────────────────────
    const contactPayload = buildContactPayload(body, locationId);
    const contactRes = await ghlPost(`${GHL_BASE}/contacts/upsert`, contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('GHL Contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create contact in CRM', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) {
      return respond(502, { error: 'Contact created but no ID returned' });
    }

    // ── 2. Apply Tags ───────────────────────────────────────
    const tags = buildTags(body);
    const tagsPayload = { tags };
    const tagsRes = await ghlPost(`${GHL_BASE}/contacts/${contactId}/tags`, tagsPayload, headers);
    if (!tagsRes.ok) {
      console.warn('Tag application failed (non-fatal):', await tagsRes.text());
    }

    // ── 3. Create Opportunity ────────────────────────────────
    const oppPayload = buildOpportunityPayload(body, contactId, locationId);
    const oppRes = await ghlPost(`${GHL_BASE}/opportunities/`, oppPayload, headers);
    const oppData = await oppRes.json();

    if (!oppRes.ok) {
      console.warn('Opportunity creation failed (non-fatal):', JSON.stringify(oppData));
    }

    // ── 4. Log for internal audit ────────────────────────────
    console.log('Acquisition Assist submission:', JSON.stringify({
      contactId,
      name: `${body.firstName} ${body.lastName}`,
      dealType: body.dealStructure,
      market: `${body.propertyCity}, ${body.propertyState}`,
      assetType: body.assetType,
      opportunityId: oppData?.id || 'not created',
      tags,
    }));

    return respond(200, {
      success: true,
      contactId,
      message: 'Deal submitted successfully',
    });

  } catch (err) {
    console.error('Acquisition Assist function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// BUILD GHL CONTACT PAYLOAD
// ─────────────────────────────────────────────────────────────
function buildContactPayload(d, locationId) {
  const customFields = [];

  // Helper — only add non-empty values
  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  // Property
  cf('property_address', d.propertyAddress);
  cf('property_city', d.propertyCity);
  cf('property_state', d.propertyState);
  cf('property_zip', d.propertyZip);
  cf('asset_type', d.assetType);
  cf('property_beds', d.propertyBeds);
  cf('property_baths', d.propertyBaths);
  cf('property_sqft', d.propertySqft);
  cf('property_year_built', d.propertyYearBuilt);
  cf('property_condition', d.propertyCondition);
  cf('property_occupancy', d.propertyOccupancy);
  cf('current_rent', d.currentRent);
  cf('has_solar', d.hasSolar);
  cf('has_hoa', d.hasHoa);
  cf('hoa_monthly', d.hoaMonthly);

  // Deal structure
  cf('deal_structure', d.dealStructure);
  cf('under_contract', d.underContract);
  cf('contract_exp_date', d.contractExpDate);

  // Cash
  cf('seller_asking_price', d.cashAskingPrice || d.sfAskingPrice);
  cf('estimated_arv', d.cashArv || d.subtoArv || d.sfArv);
  cf('estimated_repairs', d.cashRepairs);
  cf('assignment_fee', d.assignmentFee);
  cf('emd_amount', d.emdAmount);

  // SubTo
  cf('subto_loan_balance', d.subtoLoanBalance);
  cf('subto_rate', d.subtoRate);
  cf('subto_piti', d.subtoPiti);
  cf('subto_loan_status', d.subtoLoanStatus);
  cf('subto_payments_behind', d.subtoPaymentsBehind);
  cf('subto_lender_name', d.subtoLender);
  cf('subto_maturity_date', d.subtoMaturityDate);
  cf('subto_cash_to_seller', d.subtoCashToSeller);
  cf('subto_lender_contact', d.subtoLenderContact);
  cf('subto_has_balloon', d.subtoHasBalloon);
  cf('subto_balloon_detail', d.subtoBalloonDetail);

  // SF
  cf('is_free_and_clear', d.sfFreeAndClear);
  cf('sf_underlying_balance', d.sfUnderlyingBalance);
  cf('sf_down_payment', d.sfDownPayment);
  cf('sf_rate', d.sfRate);
  cf('sf_term', d.sfTerm);
  cf('sf_monthly_payment', d.sfPayment);
  cf('sf_has_balloon', d.sfHasBalloon);
  cf('sf_balloon_detail', d.sfBalloonDetail);
  cf('estimated_rent', d.sfRent);

  // Details
  cf('seller_motivation', d.sellerMotivation);
  cf('seller_timeline', d.sellerTimeline);
  cf('access_type', d.accessType);
  cf('seller_verified', d.sellerVerified);
  cf('known_repairs', d.knownRepairs);
  cf('photo_link', d.photoLink);
  cf('listing_link', d.listingLink);
  cf('comp_report_link', d.compReportLink);

  // JV
  cf('jv_compensation_type', d.jvCompType);
  cf('jv_fee_desired', d.jvFeeDesired);
  cf('open_to_jv_split', d.jvSplit);
  cf('fast_close_needed', d.fastCloseNeeded);
  cf('jv_notes', d.jvNotes);

  // Meta
  cf('deal_confidence', d.dealConfidence ? `${d.dealConfidence}/5` : '');
  cf('additional_notes', d.additionalNotes);
  cf('is_licensed_agent', d.isLicensedAgent);
  cf('wholesaler_markets', d.wholesalerMarkets);
  cf('referral_source', d.referralSource);
  cf('prop_description', d.propDescription);

  return {
    locationId,
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
    email: d.email || undefined,
    companyName: d.company || undefined,
    source: 'Acquisition Assist',
    customFields,
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD TAGS
// ─────────────────────────────────────────────────────────────
function buildTags(d) {
  const tags = ['acquisition-assist', 'jv-partner'];

  // Deal type tags
  const type = (d.dealStructure || '').toLowerCase();
  if (type.includes('cash')) tags.push('acq-cash');
  if (type.includes('subject-to') || type.includes('subto') || type.includes('wrap')) tags.push('acq-subto');
  if (type.includes('seller finance') || type.includes('free & clear')) tags.push('acq-seller-finance');
  if (type.includes('hybrid')) { tags.push('acq-hybrid'); if (!tags.includes('acq-subto')) tags.push('acq-subto'); if (!tags.includes('acq-seller-finance')) tags.push('acq-seller-finance'); }
  if (type.includes('morby') || type.includes('stack')) { tags.push('acq-morby'); if (!tags.includes('acq-subto')) tags.push('acq-subto'); if (!tags.includes('acq-seller-finance')) tags.push('acq-seller-finance'); }
  if (type.includes('wrap')) tags.push('acq-wrap');
  if (type.includes('novation')) tags.push('acq-novation');
  if (type.includes('lease option')) tags.push('acq-lease-option');
  if (type.includes('unknown') || type.includes('need help')) tags.push('acq-unknown-structure');

  // Asset type tags
  const asset = (d.assetType || '').toLowerCase();
  if (asset.includes('single family') || asset.includes('sfr')) tags.push('asset-sfr');
  if (asset.includes('duplex')) tags.push('asset-duplex');
  if (asset.includes('triplex')) tags.push('asset-triplex');
  if (asset.includes('quadplex') || asset.includes('4-unit')) tags.push('asset-quadplex');
  if (asset.includes('small mfr') || asset.includes('5–19')) tags.push('asset-small-mfr');
  if (asset.includes('large mfr') || asset.includes('20+')) tags.push('asset-large-mfr');
  if (asset.includes('commercial')) tags.push('asset-commercial');
  if (asset.includes('mobile') || asset.includes('manufactured')) tags.push('asset-mobile-home');
  if (asset.includes('mhp') || asset.includes('mobile home park')) tags.push('asset-mhp');
  if (asset.includes('rv park')) tags.push('asset-rv-park');
  if (asset.includes('vacant land') || asset.includes('lot')) tags.push('asset-land');
  if (asset.includes('mixed use')) tags.push('asset-mixed-use');

  // Status flags
  if (d.fastCloseNeeded === 'Yes') tags.push('acq-fast-close');
  if ((d.isLicensedAgent || '').toLowerCase().includes('yes')) tags.push('acq-agent');

  return [...new Set(tags)]; // dedupe
}

// ─────────────────────────────────────────────────────────────
// BUILD OPPORTUNITY PAYLOAD
// GHL pipeline stage ID must be looked up from your GHL account.
// See the README comments below on how to get these IDs.
// ─────────────────────────────────────────────────────────────
function buildOpportunityPayload(d, contactId, locationId) {
  const city = d.propertyCity || '';
  const state = d.propertyState || '';
  const lastName = d.lastName || '';
  const dealType = d.dealStructure || 'Deal';
  const shortType = dealType.split(' ')[0]; // e.g. "Cash", "Subject-To"

  const name = `${shortType} — ${city}${state ? ' ' + state : ''} — ${lastName}`;

  // Determine monetary value for the card
  const value = parseFloat(
    d.cashAskingPrice || d.sfAskingPrice || d.subtoBalance || 0
  ) || 0;

  return {
    locationId,
    name,
    contactId,
    // ─── IMPORTANT: Replace these IDs with yours from GHL ───
    // To find them: GHL → Settings → Pipelines → click pipeline
    // URL contains pipelineId; stage IDs visible in API or via GET /opportunities/pipelines
    pipelineId: process.env.GHL_PIPELINE_ID || 'YOUR_ACQUISITION_ASSIST_PIPELINE_ID',
    pipelineStageId: process.env.GHL_STAGE_NEW_SUBMISSION || 'YOUR_NEW_SUBMISSION_STAGE_ID',
    // ────────────────────────────────────────────────────────
    monetaryValue: value,
    status: 'open',
    source: 'Acquisition Assist Form',
    customFields: [
      { key: 'deal_structure', field_value: d.dealStructure || '' },
      { key: 'asset_type', field_value: d.assetType || '' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
async function ghlPost(url, payload, headers) {
  return fetch(url, {
    method: 'POST',
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
 * SETUP GUIDE
 * ─────────────────────────────────────────────────────────────
 *
 * STEP 1 — Add these environment variables in Netlify:
 *   Site → Site Configuration → Environment Variables → Add variable
 *
 *   GHL_API_KEY              Your GHL private integration API key
 *                            GHL → Settings → Integrations → API Keys → Create
 *                            Scopes needed: contacts.write, contacts.readonly,
 *                            opportunities.write, conversations/messages.write
 *
 *   GHL_LOCATION_ID          Your location (sub-account) ID
 *                            GHL → Settings → Business Info → Location ID
 *
 *   GHL_PIPELINE_ID          Acquisition Assist pipeline ID
 *   GHL_STAGE_NEW_SUBMISSION Stage ID for "New Submission"
 *
 *                            To find pipeline/stage IDs:
 *                            GET https://services.leadconnectorhq.com/opportunities/pipelines
 *                            Authorization: Bearer YOUR_KEY
 *                            Version: 2021-07-28
 *                            locationId: YOUR_LOCATION_ID
 *
 * STEP 2 — Custom Field Keys
 *   The keys in buildContactPayload() must match the "Field Key"
 *   (not display name) of your GHL custom fields exactly.
 *   GHL → Settings → Custom Fields → click field → copy "Field Key"
 *
 * STEP 3 — GHL Workflow Trigger
 *   In GHL, create a Traditional Workflow triggered by:
 *   "Contact Tag Added" → tag = "acquisition-assist"
 *   This fires every time a new Acquisition Assist deal comes in.
 *   From there, branch on tag value for deal type (acq-cash, acq-subto, etc.)
 *
 * STEP 4 — Test
 *   Submit a test deal through the form and check:
 *   ✓ Contact created in GHL with all custom fields populated
 *   ✓ Tags applied: acquisition-assist, jv-partner, acq-[type], asset-[type]
 *   ✓ Opportunity card created in Acquisition Assist pipeline, Stage 1
 *   ✓ GHL workflow fires
 *
 * ─────────────────────────────────────────────────────────────
 */
