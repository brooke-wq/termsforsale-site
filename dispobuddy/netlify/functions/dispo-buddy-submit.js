/**
 * Dispo Buddy — Submit Deal + Automated Notifications
 * POST /.netlify/functions/dispo-buddy-submit
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY          — GHL private integration API key
 *   GHL_LOCATION_ID      — GHL Location ID
 *
 * Optional (for internal alerts):
 *   INTERNAL_ALERT_PHONE — Brooke's phone for internal SMS alerts (e.g. +14808425332)
 *   INTERNAL_ALERT_EMAIL — Brooke's email for internal alerts (e.g. brooke@mydealpros.com)
 *
 * Pipeline IDs (hardcoded — confirmed from GHL):
 *   Pipeline: "3. JV Deals"   → XbZojO2rHmYtYa8C0yUP
 *   Stage:    "New JV Lead"   → cf2388f0-fdbf-4fb1-b633-86569034fcce
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const JV_PIPELINE_ID = 'XbZojO2rHmYtYa8C0yUP';
const JV_STAGE_NEW   = 'cf2388f0-fdbf-4fb1-b633-86569034fcce';

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
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

    // ── 4. Create Notion Page (New Submission) ────────────
    const notionToken = process.env.NOTION_TOKEN;
    const notionDbId  = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
    if (notionToken) {
      try {
        const notionRes = await createNotionDeal(notionToken, notionDbId, body);
        console.log('Notion page created:', notionRes?.id || 'unknown');
      } catch (err) {
        console.warn('Notion creation failed (non-fatal):', err.message);
      }
    }

    // ── 5. AUTOMATED NOTIFICATIONS ──────────────────────────
    // Fire-and-forget — don't block the response on these
    const notificationPromises = [];

    // 4a. Confirmation SMS to partner
    notificationPromises.push(
      sendSMS(contactId, headers, buildPartnerConfirmationSMS(body))
        .catch(err => console.warn('Partner SMS failed:', err.message))
    );

    // 4b. Confirmation email to partner
    if (body.jv_partner_email) {
      notificationPromises.push(
        sendEmail(contactId, headers, {
          subject: 'Deal Received — Dispo Buddy',
          html: buildPartnerConfirmationEmail(body),
        })
        .catch(err => console.warn('Partner email failed:', err.message))
      );
    }

    // 4c. Internal SMS alert to Brooke
    const internalPhone = process.env.INTERNAL_ALERT_PHONE;
    if (internalPhone) {
      notificationPromises.push(
        sendInternalSMS(internalPhone, headers, locationId, buildInternalAlertSMS(body))
          .catch(err => console.warn('Internal SMS failed:', err.message))
      );
    }

    // 4d. Internal email alert to Brooke
    const internalEmail = process.env.INTERNAL_ALERT_EMAIL;
    if (internalEmail) {
      notificationPromises.push(
        sendInternalEmail(internalEmail, headers, locationId, {
          subject: `New JV Deal: ${body.deal_type || 'Deal'} — ${body.property_city || ''}, ${body.property_state || ''}`,
          html: buildInternalAlertEmail(body, contactId),
        })
        .catch(err => console.warn('Internal email failed:', err.message))
      );
    }

    // 4e. Add a note to the contact for CRM visibility
    notificationPromises.push(
      addNote(contactId, headers, buildContactNote(body))
        .catch(err => console.warn('Note failed:', err.message))
    );

    // 4f. First-deal welcome (extra messaging)
    if (body.is_this_your_first_deal_with_dispo_buddy === 'Yes') {
      notificationPromises.push(
        sendSMS(contactId, headers,
          `Welcome to the Dispo Buddy network, ${firstName(body)}! Since this is your first deal with us, here's what to expect:\n\n` +
          `1. We review your deal within 24-48 hrs\n` +
          `2. If accepted, we send a simple JV agreement\n` +
          `3. We handle packaging, marketing & buyer outreach\n` +
          `4. 50/50 split paid at close through title\n\n` +
          `Questions? Text us anytime.`
        )
        .catch(err => console.warn('First-deal SMS failed:', err.message))
      );
    }

    // Wait for all notifications (with 5s timeout so we don't hang)
    await Promise.race([
      Promise.allSettled(notificationPromises),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);

    console.log('Dispo Buddy submission:', JSON.stringify({
      contactId,
      name: body.jv_partner_name,
      dealType: body.deal_type,
      property: `${body.property_city}, ${body.property_state}`,
      tags,
      opportunityId: oppData?.id || 'not created',
      notifications: notificationPromises.length,
    }));

    return respond(200, { success: true, contactId, message: 'Deal submitted successfully' });

  } catch (err) {
    console.error('Dispo Buddy function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// NOTIFICATION BUILDERS
// ─────────────────────────────────────────────────────────────

function firstName(d) {
  return (d.jv_partner_name || '').trim().split(' ')[0] || 'there';
}

function fmtPrice(val) {
  const n = parseFloat(val);
  return isNaN(n) ? '' : '$' + n.toLocaleString('en-US');
}

function buildPartnerConfirmationSMS(d) {
  return `Hey ${firstName(d)}, we got your ${d.deal_type || 'deal'} submission for ${d.property_city || 'your property'}, ${d.property_state || ''}! ` +
    `Our team reviews within 24-48 hours. We'll reach out if we need anything. ` +
    `— Dispo Buddy\n\nReply STOP to opt out.`;
}

function buildPartnerConfirmationEmail(d) {
  const addr = [d.property_address, d.property_city, d.property_state, d.property_zip].filter(Boolean).join(', ');
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0D1F3C">
      <div style="padding:32px 0;text-align:center;border-bottom:2px solid #29ABE2">
        <img src="https://dispobuddy.netlify.app/logo-dark.svg" alt="Dispo Buddy" style="height:48px;margin:0 auto">
      </div>
      <div style="padding:32px 24px">
        <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Deal Received!</h1>
        <p style="color:#4A6070;line-height:1.7;margin-bottom:24px">
          Hey ${firstName(d)}, we've received your <strong>${d.deal_type || 'deal'}</strong> submission${addr ? ' for <strong>' + addr + '</strong>' : ''}. Here's what happens next:
        </p>
        <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
          <div style="margin-bottom:16px"><strong style="color:#F7941D;font-size:20px">01</strong><br><strong>We review & underwrite</strong><br><span style="color:#4A6070;font-size:14px">Our team reviews within 24-48 hours. We check numbers, comps, and marketability.</span></div>
          <div style="margin-bottom:16px"><strong style="color:#F7941D;font-size:20px">02</strong><br><strong>JV agreement</strong><br><span style="color:#4A6070;font-size:14px">If it's a fit, we send a simple, non-exclusive JV agreement.</span></div>
          <div style="margin-bottom:16px"><strong style="color:#F7941D;font-size:20px">03</strong><br><strong>We package & market</strong><br><span style="color:#4A6070;font-size:14px">Professional deal presentation to our national buyer network.</span></div>
          <div><strong style="color:#F7941D;font-size:20px">04</strong><br><strong>You get paid</strong><br><span style="color:#4A6070;font-size:14px">50/50 split of the net assignment fee, paid at close through title.</span></div>
        </div>
        ${d.deal_type ? `<p style="color:#4A6070;font-size:14px;margin-bottom:8px"><strong>Deal Type:</strong> ${d.deal_type}</p>` : ''}
        ${d.desired_asking_price ? `<p style="color:#4A6070;font-size:14px;margin-bottom:8px"><strong>Asking Price:</strong> ${fmtPrice(d.desired_asking_price)}</p>` : ''}
        ${d.arv_estimate ? `<p style="color:#4A6070;font-size:14px;margin-bottom:24px"><strong>ARV:</strong> ${fmtPrice(d.arv_estimate)}</p>` : ''}
        <p style="color:#4A6070;line-height:1.7;margin-bottom:24px">
          If we need more info, we'll reach out by text or email. You don't need to do anything else right now.
        </p>
        <p style="color:#4A6070;line-height:1.7">
          Got another deal? <a href="https://dispobuddy.netlify.app/submit-deal" style="color:#29ABE2;font-weight:600">Submit it here</a> — your info is saved.
        </p>
      </div>
      <div style="padding:24px;border-top:1px solid #E2E8F0;text-align:center;color:#718096;font-size:12px">
        Dispo Buddy — A Deal Pros LLC Brand<br>
        <a href="https://dispobuddy.netlify.app" style="color:#29ABE2">dispobuddy.com</a> · (480) 842-5332
      </div>
    </div>`;
}

function buildInternalAlertSMS(d) {
  const addr = [d.property_address, d.property_city, d.property_state].filter(Boolean).join(', ');
  return `🏠 NEW JV DEAL\n` +
    `Partner: ${d.jv_partner_name}\n` +
    `Type: ${d.deal_type || 'N/A'}\n` +
    `Property: ${addr || 'N/A'}\n` +
    `Ask: ${fmtPrice(d.desired_asking_price) || 'N/A'}\n` +
    `ARV: ${fmtPrice(d.arv_estimate) || 'N/A'}\n` +
    `Entry: ${fmtPrice(d.what_is_the_buyer_entry_fee) || 'N/A'}\n` +
    (d.is_this_your_first_deal_with_dispo_buddy === 'Yes' ? '⭐ FIRST DEAL\n' : '') +
    `Phone: ${d.jv_phone_number}`;
}

function buildInternalAlertEmail(d, contactId) {
  const addr = [d.property_address, d.property_city, d.property_state, d.property_zip].filter(Boolean).join(', ');
  const ghlLink = `https://app.gohighlevel.com/v2/location/7IyUgu1zpi38MDYpSDTs/contacts/detail/${contactId}`;
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:600px;color:#0D1F3C">
      <h2 style="margin-bottom:16px">New JV Deal Submitted</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0;width:140px">Partner</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.jv_partner_name} · ${d.jv_phone_number}${d.jv_partner_email ? ' · ' + d.jv_partner_email : ''}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Deal Type</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.deal_type || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Property</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${addr || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Contract Price</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.contracted_price) || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Asking Price</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.desired_asking_price) || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">ARV</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.arv_estimate) || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Entry Fee</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.what_is_the_buyer_entry_fee) || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">COE</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.coe || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Occupancy</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.property_occupancy || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Under Contract</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.do_you_have_the_property_under_contract || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">First Deal?</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.is_this_your_first_deal_with_dispo_buddy || 'N/A'}</td></tr>
        ${d.subto_loan_balance ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">SubTo Balance</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.subto_loan_balance)}</td></tr>` : ''}
        ${d.interest_rate ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">SubTo Rate</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.interest_rate}</td></tr>` : ''}
        ${d.monthly_payment ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">SubTo PITI</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.monthly_payment)}</td></tr>` : ''}
        ${d.seller_finance_loan_amount ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">SF Amount</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${fmtPrice(d.seller_finance_loan_amount)}</td></tr>` : ''}
        ${d.interest_rate_seller_finance ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">SF Rate</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.interest_rate_seller_finance}</td></tr>` : ''}
        ${d.link_to_photos ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Photos</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0"><a href="${d.link_to_photos}" style="color:#29ABE2">View Photos</a></td></tr>` : ''}
        ${d.link_to_supporting_documents ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Docs</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0"><a href="${d.link_to_supporting_documents}" style="color:#29ABE2">View Docs</a></td></tr>` : ''}
        ${d.important_details ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Notes</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.important_details}</td></tr>` : ''}
      </table>
      <a href="${ghlLink}" style="display:inline-block;padding:12px 28px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;margin-bottom:16px">View in GHL</a>
      <p style="color:#718096;font-size:12px;margin-top:16px">Source: ${d.how_did_you_hear_about_us || 'N/A'} · Referral: ${d.referral_source || 'N/A'}</p>
    </div>`;
}

function buildContactNote(d) {
  const addr = [d.property_address, d.property_city, d.property_state, d.property_zip].filter(Boolean).join(', ');
  const lines = [
    `📋 DEAL SUBMITTED via Dispo Buddy`,
    `Type: ${d.deal_type || 'N/A'}`,
    `Property: ${addr || 'N/A'}`,
    `Contract: ${fmtPrice(d.contracted_price) || 'N/A'} | Ask: ${fmtPrice(d.desired_asking_price) || 'N/A'} | ARV: ${fmtPrice(d.arv_estimate) || 'N/A'}`,
    `Entry Fee: ${fmtPrice(d.what_is_the_buyer_entry_fee) || 'N/A'}`,
    `COE: ${d.coe || 'N/A'} | Occupancy: ${d.property_occupancy || 'N/A'}`,
    `Under Contract: ${d.do_you_have_the_property_under_contract || 'N/A'}`,
    `First Deal: ${d.is_this_your_first_deal_with_dispo_buddy || 'N/A'}`,
  ];
  if (d.subto_loan_balance) lines.push(`SubTo: ${fmtPrice(d.subto_loan_balance)} @ ${d.interest_rate || '?'}% | PITI: ${fmtPrice(d.monthly_payment) || '?'}`);
  if (d.seller_finance_loan_amount) lines.push(`SF: ${fmtPrice(d.seller_finance_loan_amount)} @ ${d.interest_rate_seller_finance || '?'}% | Payment: ${fmtPrice(d.sf_loan_payment) || '?'}`);
  if (d.link_to_photos) lines.push(`Photos: ${d.link_to_photos}`);
  if (d.link_to_supporting_documents) lines.push(`Docs: ${d.link_to_supporting_documents}`);
  if (d.important_details) lines.push(`Notes: ${d.important_details}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// GHL MESSAGING FUNCTIONS
// ─────────────────────────────────────────────────────────────

async function sendSMS(contactId, headers, message) {
  const res = await ghlFetch(`${GHL_BASE}/conversations/messages`, 'POST', {
    type: 'SMS',
    contactId,
    message,
  }, headers);
  const data = await res.json();
  if (!res.ok) console.warn('SMS send response:', JSON.stringify(data));
  return data;
}

async function sendEmail(contactId, headers, { subject, html }) {
  const res = await ghlFetch(`${GHL_BASE}/conversations/messages`, 'POST', {
    type: 'Email',
    contactId,
    subject,
    html,
    emailFrom: 'Dispo Buddy <info@dispobuddy.com>',
  }, headers);
  const data = await res.json();
  if (!res.ok) console.warn('Email send response:', JSON.stringify(data));
  return data;
}

async function sendInternalSMS(phone, headers, locationId, message) {
  // Find or create internal contact, then send SMS
  const searchRes = await ghlFetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}&limit=1`,
    'GET', null, headers
  );
  const searchData = await searchRes.json();
  let internalId = searchData.contacts?.[0]?.id;

  if (!internalId) {
    // Upsert a contact for internal alerts
    const upsertRes = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', {
      locationId,
      phone,
      firstName: 'Dispo Buddy',
      lastName: 'Alerts',
      source: 'Internal — Dispo Buddy Alerts',
    }, headers);
    const upsertData = await upsertRes.json();
    internalId = upsertData.contact?.id || upsertData.id;
  }

  if (internalId) {
    return sendSMS(internalId, headers, message);
  }
}

async function sendInternalEmail(email, headers, locationId, { subject, html }) {
  // Find or create internal contact, then send email
  const searchRes = await ghlFetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`,
    'GET', null, headers
  );
  const searchData = await searchRes.json();
  let internalId = searchData.contacts?.[0]?.id;

  if (!internalId) {
    const upsertRes = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', {
      locationId,
      email,
      firstName: 'Dispo Buddy',
      lastName: 'Alerts',
      source: 'Internal — Dispo Buddy Alerts',
    }, headers);
    const upsertData = await upsertRes.json();
    internalId = upsertData.contact?.id || upsertData.id;
  }

  if (internalId) {
    return sendEmail(internalId, headers, { subject, html });
  }
}

async function addNote(contactId, headers, body) {
  const res = await ghlFetch(`${GHL_BASE}/contacts/${contactId}/notes`, 'POST', { body }, headers);
  const data = await res.json();
  if (!res.ok) console.warn('Note add response:', JSON.stringify(data));
  return data;
}

// ─────────────────────────────────────────────────────────────
// BUILD CONTACT PAYLOAD
// ─────────────────────────────────────────────────────────────
function buildContactPayload(d, locationId) {
  const customFields = [];

  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  cf('jv_partner_name',                          d.jv_partner_name);
  cf('jv_phone_number',                          d.jv_phone_number);
  cf('jv_partner_email',                         d.jv_partner_email);
  cf('do_you_have_the_property_under_contract',  d.do_you_have_the_property_under_contract);
  cf('is_this_your_first_deal_with_dispo_buddy', d.is_this_your_first_deal_with_dispo_buddy);
  cf('how_did_you_hear_about_us',                d.how_did_you_hear_about_us);
  cf('property_address',              `${d.property_address}, ${d.property_city}, ${d.property_state} ${d.property_zip}`);
  cf('coe',                           d.coe);
  cf('property_occupancy',            d.property_occupancy);
  cf('how_can_we_access_the_property', d.how_can_we_access_the_property);
  cf('link_to_photos',                d.link_to_photos);
  cf('link_to_supporting_documents',  d.link_to_supporting_documents);
  cf('deal_type',              d.deal_type);
  cf('contracted_price',       d.contracted_price);
  cf('desired_asking_price',   d.desired_asking_price);
  cf('arv_estimate',           d.arv_estimate);
  cf('what_is_the_buyer_entry_fee', d.what_is_the_buyer_entry_fee);
  cf('contracted_entry_fee',   d.contracted_entry_fee);
  cf('est_taxes__insurance',   d.est_taxes__insurance);
  cf('subto_loan_balance',     d.subto_loan_balance);
  cf('interest_rate',          d.interest_rate);
  cf('monthly_payment',        d.monthly_payment);
  cf('loan_maturity',          d.loan_maturity);
  cf('subto_balloon',          d.subto_balloon);
  cf('seller_finance_loan_amount',    d.seller_finance_loan_amount);
  cf('sf_loan_payment',               d.sf_loan_payment);
  cf('interest_rate_seller_finance',  d.interest_rate_seller_finance);
  cf('loan_term',                     d.loan_term);
  cf('sf_balloon',                    d.sf_balloon);
  cf('dscr_loan_amount',              d.dscr_loan_amount);
  cf('important_details', d.important_details);

  const nameParts = (d.jv_partner_name || '').trim().split(' ');
  const first = nameParts[0] || '';
  const last  = nameParts.slice(1).join(' ') || '';

  return {
    locationId,
    firstName: first,
    lastName: last,
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
  const tags = ['dispo-buddy', 'jv-partner'];

  const type = (d.deal_type || '').toLowerCase();
  if (type.includes('cash'))           tags.push('db-cash');
  if (type.includes('subto') || type.includes('subject')) tags.push('db-subto');
  if (type.includes('seller finance')) tags.push('db-seller-finance');
  if (type.includes('hybrid'))         { tags.push('db-hybrid'); tags.push('db-subto'); tags.push('db-seller-finance'); }
  if (type.includes('morby') || type.includes('stack')) { tags.push('db-morby'); tags.push('db-subto'); tags.push('db-seller-finance'); }
  if (type.includes('lease'))          tags.push('db-lease-option');
  if (type.includes('novation'))       tags.push('db-novation');

  if (d.is_this_your_first_deal_with_dispo_buddy === 'Yes') tags.push('db-first-deal');

  const contract = (d.do_you_have_the_property_under_contract || '').toLowerCase();
  if (contract.includes('direct to seller') || contract.includes('agent')) tags.push('db-direct-to-seller');
  if (contract.includes('jv agreement')) tags.push('db-jv-with-wholesaler');

  return [...new Set(tags)];
}

// ─────────────────────────────────────────────────────────────
// BUILD OPPORTUNITY
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
// NOTION — Create deal page as "New Submission"
// Maps form fields to existing Notion database properties
// ─────────────────────────────────────────────────────────────
async function createNotionDeal(token, dbId, d) {
  const props = {};

  // Helper: set property by type
  function title(name, val)    { if (val) props[name] = { title: [{ text: { content: String(val) } }] }; }
  function text(name, val)     { if (val) props[name] = { rich_text: [{ text: { content: String(val) } }] }; }
  function num(name, val)      { const n = parseFloat(val); if (!isNaN(n) && n > 0) props[name] = { number: n }; }
  function sel(name, val)      { if (val) props[name] = { select: { name: String(val) } }; }
  function stat(name, val)     { if (val) props[name] = { status: { name: String(val) } }; }
  function url(name, val)      { if (val) props[name] = { url: String(val) }; }
  function date(name, val)     { if (val) props[name] = { date: { start: String(val) } }; }

  // Map deal type from form to Notion select values
  const dealTypeMap = {
    'Cash': 'Cash',
    'Subto': 'SubTo',
    'Seller Finance': 'Seller Finance',
    'Hybrid': 'Hybrid',
    'Morby/Stack Method': 'Morby Method',
    'Lease Option': 'Lease Option',
    'Novation': 'Novation',
  };

  const addr = [d.property_address, d.property_city, d.property_state, d.property_zip].filter(Boolean).join(', ');

  // Title — use address as the page title (standard for deal databases)
  title('Street Address', d.property_address || addr);

  // Deal Status — "New Submission"
  // Try status type first, fall back to select
  try { stat('Deal Status', 'New Submission'); } catch(e) {}

  // Location
  text('City', d.property_city);
  text('State', d.property_state);
  text('ZIP', d.property_zip);

  // Deal info
  sel('Deal Type', dealTypeMap[d.deal_type] || d.deal_type);
  num('Asking Price', d.desired_asking_price);
  num('Entry Fee', d.what_is_the_buyer_entry_fee);
  num('ARV', d.arv_estimate);
  sel('Occupancy', d.property_occupancy);
  text('Access', d.how_can_we_access_the_property);
  date('COE', d.coe);
  url('Photos', d.link_to_photos);

  // SubTo fields
  num('SubTo Loan Balance', d.subto_loan_balance);
  text('SubTo Rate (%)', d.interest_rate);
  num('PITI', d.monthly_payment);
  text('SubTo Loan Maturity', d.loan_maturity);
  text('SubTo Balloon', d.subto_balloon);

  // Seller Finance fields
  num('SF Loan Amount', d.seller_finance_loan_amount);
  num('SF Payment', d.sf_loan_payment);
  text('SF Rate', d.interest_rate_seller_finance);
  text('SF Term', d.loan_term);
  text('SF Balloon', d.sf_balloon);

  // Details — combine partner info + notes
  const detailLines = [
    `JV Partner: ${d.jv_partner_name} | ${d.jv_phone_number}${d.jv_partner_email ? ' | ' + d.jv_partner_email : ''}`,
    `Contract: ${d.contracted_price ? '$' + parseFloat(d.contracted_price).toLocaleString() : 'N/A'}`,
    `Under Contract: ${d.do_you_have_the_property_under_contract || 'N/A'}`,
    `First Deal: ${d.is_this_your_first_deal_with_dispo_buddy || 'N/A'}`,
    `Source: ${d.how_did_you_hear_about_us || 'N/A'}`,
  ];
  if (d.important_details) detailLines.push(`Notes: ${d.important_details}`);
  if (d.link_to_supporting_documents) detailLines.push(`Docs: ${d.link_to_supporting_documents}`);
  text('Details', detailLines.join('\n'));

  // Create page
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: props,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.warn('Notion create failed:', JSON.stringify(data));
    // If status field failed (wrong type), retry without it using select instead
    if (data.message && data.message.includes('Deal Status')) {
      delete props['Deal Status'];
      sel('Deal Status', 'New Submission');
      const retry = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: props,
        }),
      });
      const retryData = await retry.json();
      if (!retry.ok) console.warn('Notion retry also failed:', JSON.stringify(retryData));
      return retryData;
    }
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
async function ghlFetch(url, method, payload, headers) {
  const opts = { method, headers };
  if (payload && method !== 'GET') opts.body = JSON.stringify(payload);
  return fetch(url, opts);
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
