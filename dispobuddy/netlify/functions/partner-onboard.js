/**
 * Dispo Buddy — Partner Onboarding & Contact Form
 * POST /.netlify/functions/partner-onboard
 *
 * Handles two form types:
 *   1. Partner onboarding (from /join page)
 *   2. Contact form messages (from /contact page, formType: 'contact')
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY          — GHL private integration API key
 *   GHL_LOCATION_ID      — GHL Location ID
 *
 * Pipeline IDs (from GHL account — already confirmed):
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
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  // ── Route by form type ──────────────────────────────────────
  if (body.formType === 'contact') {
    return handleContactForm(body, headers, locationId);
  }
  return handlePartnerOnboarding(body, headers, locationId);
};

// ─────────────────────────────────────────────────────────────
// PARTNER ONBOARDING HANDLER
// ─────────────────────────────────────────────────────────────
async function handlePartnerOnboarding(body, headers, locationId) {
  if (!body.full_name || !body.email || !body.phone || !body.partner_type) {
    return respond(400, {
      error: 'Missing required fields: full_name, email, phone, partner_type',
    });
  }

  try {
    // ── 1. Upsert Contact ───────────────────────────────────
    const contactPayload = buildOnboardingContactPayload(body, locationId);
    const contactRes  = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('Contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create contact', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) return respond(502, { error: 'No contact ID returned' });

    // ── 2. Apply Tags ───────────────────────────────────────
    const tags = buildOnboardingTags(body);
    await ghlFetch(`${GHL_BASE}/contacts/${contactId}/tags`, 'POST', { tags }, headers);

    // ── 3. Create Opportunity in JV Deals Pipeline ──────────
    const oppPayload = buildOnboardingOpportunityPayload(body, contactId, locationId);
    const oppRes  = await ghlFetch(`${GHL_BASE}/opportunities/`, 'POST', oppPayload, headers);
    const oppData = await oppRes.json();

    if (!oppRes.ok) {
      console.warn('Opportunity creation failed (non-fatal):', JSON.stringify(oppData));
    }

    console.log('Partner onboarding submission:', JSON.stringify({
      contactId,
      name: body.full_name,
      partnerType: body.partner_type,
      tags,
      opportunityId: oppData?.id || 'not created',
    }));

    return respond(200, { success: true, contactId });

  } catch (err) {
    console.error('Partner onboarding function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────
// CONTACT FORM HANDLER
// ─────────────────────────────────────────────────────────────
async function handleContactForm(body, headers, locationId) {
  if (!body.name || !body.email) {
    return respond(400, { error: 'Missing required fields: name, email' });
  }

  try {
    // ── 1. Upsert Contact ───────────────────────────────────
    const contactPayload = buildContactFormPayload(body, locationId);
    const contactRes  = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('Contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create contact', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) return respond(502, { error: 'No contact ID returned' });

    // ── 2. Apply Tags ───────────────────────────────────────
    const tags = ['dispo-buddy', 'db-contact-form'];
    await ghlFetch(`${GHL_BASE}/contacts/${contactId}/tags`, 'POST', { tags }, headers);

    // No opportunity for contact form messages

    console.log('Contact form submission:', JSON.stringify({
      contactId,
      name: body.name,
      subject: body.subject,
      tags,
    }));

    return respond(200, { success: true, contactId });

  } catch (err) {
    console.error('Contact form function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD CONTACT PAYLOAD — Partner Onboarding
// Uses exact GHL custom field keys from your account
// ─────────────────────────────────────────────────────────────
function buildOnboardingContactPayload(d, locationId) {
  const customFields = [];

  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  cf('jv_partner_name', d.full_name);
  cf('how_did_you_hear_about_us', d.referral_source);

  // Build summary for important_details
  const detailParts = [];
  if (d.partner_type)     detailParts.push(`Partner Type: ${d.partner_type}`);
  if (d.primary_markets)  detailParts.push(`Markets: ${d.primary_markets}`);
  if (d.deal_types)       detailParts.push(`Deal Types: ${d.deal_types}`);
  if (d.monthly_volume)   detailParts.push(`Monthly Volume: ${d.monthly_volume}`);
  if (d.deal_ready)       detailParts.push(`Deal Ready: ${d.deal_ready}`);
  if (d.company)          detailParts.push(`Company: ${d.company}`);
  if (d.notes)            detailParts.push(`Notes: ${d.notes}`);

  if (detailParts.length > 0) {
    cf('important_details', detailParts.join(' | '));
  }

  // Parse name into first/last
  const nameParts = (d.full_name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  const payload = {
    locationId,
    firstName,
    lastName,
    phone: d.phone,
    email: d.email,
    source: 'Dispo Buddy — Partner Onboarding',
    customFields,
  };

  // UTM tracking
  if (d.utm_source || d.utm_medium || d.utm_campaign) {
    payload.attributionSource = {
      utm_source:   d.utm_source   || '',
      utm_medium:   d.utm_medium   || '',
      utm_campaign: d.utm_campaign || '',
    };
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────
// BUILD CONTACT PAYLOAD — Contact Form
// ─────────────────────────────────────────────────────────────
function buildContactFormPayload(d, locationId) {
  const customFields = [];

  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  cf('jv_partner_name', d.name);
  cf('important_details', `Contact Form — Subject: ${d.subject || '(none)'}\n\n${d.message || ''}`);

  // Parse name into first/last
  const nameParts = (d.name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  return {
    locationId,
    firstName,
    lastName,
    phone: d.phone || undefined,
    email: d.email,
    source: 'Dispo Buddy — Contact Form',
    customFields,
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD TAGS — Partner Onboarding
// ─────────────────────────────────────────────────────────────
function buildOnboardingTags(d) {
  const tags = ['dispo-buddy', 'jv-partner', 'db-onboarding'];

  if (d.partner_type === 'Real Estate Agent') tags.push('db-agent');
  if (d.deal_ready === 'Yes')                 tags.push('db-deal-ready');

  return [...new Set(tags)];
}

// ─────────────────────────────────────────────────────────────
// BUILD OPPORTUNITY — Partner Onboarding
// Uses "3. JV Deals" pipeline — New JV Lead stage
// ─────────────────────────────────────────────────────────────
function buildOnboardingOpportunityPayload(d, contactId, locationId) {
  const nameParts   = (d.full_name || '').trim().split(' ');
  const lastName    = nameParts.slice(1).join(' ') || nameParts[0] || '';
  const partnerType = d.partner_type || 'Partner';

  return {
    locationId,
    name: `Onboarding — ${partnerType} — ${lastName}`,
    contactId,
    pipelineId:      JV_PIPELINE_ID,
    pipelineStageId: JV_STAGE_NEW,
    monetaryValue:   0,
    status: 'open',
    source: 'Dispo Buddy — Partner Onboarding Form',
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/*
 * ─────────────────────────────────────────────────────────────
 * SETUP — Dispo Buddy Partner Onboarding Function
 * ─────────────────────────────────────────────────────────────
 *
 * This function lives in the Dispo Buddy Netlify site
 * (same site as dispo-buddy-submit.js).
 *
 * FOLDER STRUCTURE:
 *   dispobuddy/
 *   ├── join.html           (partner onboarding form)
 *   ├── contact.html        (contact form)
 *   ├── submit-deal.html
 *   └── netlify/
 *       └── functions/
 *           ├── dispo-buddy-submit.js
 *           └── partner-onboard.js      ← this file
 *
 * ENVIRONMENT VARIABLES (same as dispo-buddy-submit.js):
 *   GHL_API_KEY       — GHL private integration API key
 *   GHL_LOCATION_ID   — GHL Location ID
 *
 * ENDPOINTS:
 *   POST /.netlify/functions/partner-onboard
 *     → Partner onboarding:  { full_name, email, phone, partner_type, ... }
 *     → Contact form:        { formType: 'contact', name, email, subject, message }
 *
 * PIPELINE (partner onboarding only):
 *   Pipeline: XbZojO2rHmYtYa8C0yUP  (3. JV Deals)
 *   Stage:    cf2388f0-...           (New JV Lead)
 *
 * TAGS APPLIED:
 *   Partner onboarding: dispo-buddy, jv-partner, db-onboarding
 *     + db-agent       (if partner_type = 'Real Estate Agent')
 *     + db-deal-ready  (if deal_ready = 'Yes')
 *   Contact form:       dispo-buddy, db-contact-form
 *
 * GHL WORKFLOW TRIGGERS:
 *   Tag "db-onboarding"   → Partner welcome sequence
 *   Tag "db-deal-ready"   → Fast-track outreach
 *   Tag "db-contact-form" → Route to support / internal notification
 *
 * ─────────────────────────────────────────────────────────────
 */
