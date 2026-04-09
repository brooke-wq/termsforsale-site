/**
 * Dispo Buddy — Partner Onboarding & Contact Form + Automated Notifications
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
 * Optional (for internal alerts):
 *   INTERNAL_ALERT_PHONE — Brooke's phone for internal SMS alerts
 *   INTERNAL_ALERT_EMAIL — Brooke's email for internal alerts
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
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

    // ── 4. AUTOMATED NOTIFICATIONS ──────────────────────────
    const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
    const notifs = [];
    const first = (body.full_name || '').trim().split(' ')[0] || 'there';

    if (!isLive) {
      console.log('NOTIFICATIONS_LIVE is not true — skipping SMS/email');
    }

    // 4a. Welcome SMS to partner
    if (isLive) notifs.push(
      sendSMS(contactId, headers,
        `Hey ${first}! You're in the Dispo Buddy partner network. ` +
        `When you have a deal ready, submit it here: dispobuddy.com/submit-deal\n\n` +
        `We'll keep you posted on what our buyers are looking for. — Dispo Buddy\n\nReply STOP to opt out.`
      ).catch(err => console.warn('Partner welcome SMS failed:', err.message))
    );

    // 4b. Welcome email to partner
    if (isLive) notifs.push(
      sendEmail(contactId, headers, {
        subject: "You're in the Dispo Buddy Network",
        html: buildOnboardingWelcomeEmail(body),
      }).catch(err => console.warn('Partner welcome email failed:', err.message))
    );

    // 4c. Internal SMS alert
    const alertPhone = process.env.INTERNAL_ALERT_PHONE;
    if (isLive && alertPhone) {
      notifs.push(
        sendInternalSMS(alertPhone, headers, locationId,
          `👤 NEW PARTNER\n` +
          `Name: ${body.full_name}\n` +
          `Type: ${body.partner_type}\n` +
          `Markets: ${body.primary_markets || 'N/A'}\n` +
          `Volume: ${body.monthly_volume || 'N/A'}\n` +
          `Deal Ready: ${body.deal_ready || 'N/A'}\n` +
          `Phone: ${body.phone}`
        ).catch(err => console.warn('Internal SMS failed:', err.message))
      );
    }

    // 4d. Internal email alert
    const alertEmail = process.env.INTERNAL_ALERT_EMAIL;
    if (isLive && alertEmail) {
      notifs.push(
        sendInternalEmail(alertEmail, headers, locationId, {
          subject: `New Partner: ${body.partner_type} — ${body.full_name}`,
          html: buildInternalOnboardingEmail(body, contactId),
        }).catch(err => console.warn('Internal email failed:', err.message))
      );
    }

    // 4e. If deal-ready, send follow-up nudge
    if (isLive && body.deal_ready === 'Yes') {
      notifs.push(
        sendSMS(contactId, headers,
          `Sounds like you have a deal ready to go, ${first}! ` +
          `Submit it now and we'll review within 24-48 hours: dispobuddy.com/submit-deal`
        ).catch(err => console.warn('Deal-ready nudge failed:', err.message))
      );
    }

    // 4f. Add note
    notifs.push(
      addNote(contactId, headers,
        `👤 PARTNER ONBOARDING via Dispo Buddy\n` +
        `Type: ${body.partner_type}\n` +
        `Markets: ${body.primary_markets || 'N/A'}\n` +
        `Deal Types: ${body.deal_types || 'N/A'}\n` +
        `Monthly Volume: ${body.monthly_volume || 'N/A'}\n` +
        `Deal Ready: ${body.deal_ready || 'N/A'}\n` +
        `Source: ${body.referral_source || 'N/A'}\n` +
        (body.notes ? `Notes: ${body.notes}` : '')
      ).catch(err => console.warn('Note failed:', err.message))
    );

    await Promise.race([
      Promise.allSettled(notifs),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);

    console.log('Partner onboarding:', JSON.stringify({
      contactId, name: body.full_name, partnerType: body.partner_type, tags,
    }));

    return respond(200, { success: true, contactId });

  } catch (err) {
    console.error('Partner onboarding error:', err);
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
    const contactPayload = buildContactFormPayload(body, locationId);
    const contactRes  = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('Contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create contact', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) return respond(502, { error: 'No contact ID returned' });

    const tags = ['dispo-buddy', 'db-contact-form'];
    await ghlFetch(`${GHL_BASE}/contacts/${contactId}/tags`, 'POST', { tags }, headers);

    // ── NOTIFICATIONS ───────────────────────────────────────
    const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
    const notifs = [];
    const first = (body.name || '').trim().split(' ')[0] || 'there';

    if (!isLive) console.log('NOTIFICATIONS_LIVE is not true — skipping SMS/email');

    // Auto-reply email
    if (isLive) notifs.push(
      sendEmail(contactId, headers, {
        subject: 'Got your message — Dispo Buddy',
        html: `
          <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:500px;color:#0D1F3C">
            <div style="background:#0a1828;padding:24px;text-align:center;border-radius:12px 12px 0 0">
              <img src="https://dispobuddy.com/logo-email.png" alt="Dispo Buddy" style="height:40px;margin:0 auto">
            </div>
            <div style="padding:24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">
            <p>Hey ${first},</p>
            <p style="color:#4A6070;line-height:1.7">Thanks for reaching out. We got your message and will get back to you within 24 hours.</p>
            <p style="color:#4A6070;line-height:1.7">In the meantime:</p>
            <ul style="color:#4A6070;line-height:2;padding-left:20px">
              <li><a href="https://dispobuddy.com/submit-deal" style="color:#29ABE2">Submit a deal</a></li>
              <li><a href="https://dispobuddy.com/faq" style="color:#29ABE2">Check our FAQ</a></li>
              <li><a href="https://dispobuddy.com/process" style="color:#29ABE2">See how it works</a></li>
            </ul>
            <p style="color:#4A6070">— The Dispo Buddy Team</p>
            <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E2E8F0;color:#718096;font-size:12px">
              Dispo Buddy — A Deal Pros LLC Brand · (480) 842-5332
            </div>
            </div>
          </div>`,
      }).catch(err => console.warn('Auto-reply email failed:', err.message))
    );

    // Internal alert
    const alertPhone = process.env.INTERNAL_ALERT_PHONE;
    if (isLive && alertPhone) {
      notifs.push(
        sendInternalSMS(alertPhone, headers, locationId,
          `📩 CONTACT FORM\n` +
          `From: ${body.name}\n` +
          `Subject: ${body.subject || 'N/A'}\n` +
          `Message: ${(body.message || '').substring(0, 200)}\n` +
          `Email: ${body.email}${body.phone ? '\nPhone: ' + body.phone : ''}`
        ).catch(err => console.warn('Internal SMS failed:', err.message))
      );
    }

    const alertEmail = process.env.INTERNAL_ALERT_EMAIL;
    if (isLive && alertEmail) {
      notifs.push(
        sendInternalEmail(alertEmail, headers, locationId, {
          subject: `Contact Form: ${body.subject || 'General'} — ${body.name}`,
          html: `
            <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;color:#0D1F3C">
              <h2>Contact Form Message</h2>
              <p><strong>From:</strong> ${body.name} · ${body.email}${body.phone ? ' · ' + body.phone : ''}</p>
              <p><strong>Subject:</strong> ${body.subject || 'N/A'}</p>
              <div style="background:#F4F6F9;padding:20px;border-radius:8px;margin:16px 0;white-space:pre-wrap">${body.message || '(no message)'}</div>
              <a href="https://app.gohighlevel.com/v2/location/7IyUgu1zpi38MDYpSDTs/contacts/detail/${contactId}" style="display:inline-block;padding:10px 24px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">View in GHL</a>
            </div>`,
        }).catch(err => console.warn('Internal email failed:', err.message))
      );
    }

    // Note on contact
    notifs.push(
      addNote(contactId, headers,
        `📩 CONTACT FORM\nSubject: ${body.subject || 'N/A'}\n\n${body.message || '(no message)'}`
      ).catch(err => console.warn('Note failed:', err.message))
    );

    await Promise.race([
      Promise.allSettled(notifs),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);

    console.log('Contact form:', JSON.stringify({ contactId, name: body.name, subject: body.subject }));
    return respond(200, { success: true, contactId });

  } catch (err) {
    console.error('Contact form error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────
// EMAIL BUILDERS
// ─────────────────────────────────────────────────────────────

function buildOnboardingWelcomeEmail(d) {
  const first = (d.full_name || '').trim().split(' ')[0] || 'there';
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0D1F3C">
      <div style="background:#0a1828;padding:28px 24px;text-align:center;border-radius:12px 12px 0 0">
        <img src="https://dispobuddy.com/logo-email.png" alt="Dispo Buddy" style="height:48px;margin:0 auto">
      </div>
      <div style="padding:32px 24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px">
        <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Welcome to the Network, ${first}!</h1>
        <p style="color:#4A6070;line-height:1.7;margin-bottom:24px">
          You're now a Dispo Buddy partner. Here's what that means:
        </p>
        <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
          <p style="margin-bottom:12px"><strong style="color:#29ABE2">✓</strong> <strong>Submit deals anytime</strong> — your info is saved</p>
          <p style="margin-bottom:12px"><strong style="color:#29ABE2">✓</strong> <strong>24-48 hour review</strong> on every submission</p>
          <p style="margin-bottom:12px"><strong style="color:#29ABE2">✓</strong> <strong>50/50 split</strong> at close — bumps to 30/70 after $25k funded or 3 deals closed/quarter</p>
          <p style="margin-bottom:12px"><strong style="color:#29ABE2">✓</strong> <strong>Non-exclusive</strong> — no lock-in, no commitment</p>
          <p><strong style="color:#29ABE2">✓</strong> <strong>Market updates</strong> on what our buyers want</p>
        </div>
        ${d.deal_ready === 'Yes' ? `
          <div style="background:#FEF3C7;border-left:4px solid #F7941D;border-radius:0 8px 8px 0;padding:16px;margin-bottom:24px">
            <strong>You mentioned you have a deal ready.</strong><br>
            <span style="color:#4A6070">Submit it now and we'll review within 24-48 hours:</span><br>
            <a href="https://dispobuddy.com/submit-deal" style="color:#F7941D;font-weight:700">Submit Your Deal →</a>
          </div>` : ''}
        <p style="color:#4A6070;line-height:1.7;margin-bottom:24px">
          When you're ready to submit a deal, head here:<br>
          <a href="https://dispobuddy.com/submit-deal" style="color:#29ABE2;font-weight:600">dispobuddy.com/submit-deal</a>
        </p>
        <p style="color:#4A6070;line-height:1.7">
          Want to see where our buyers are active?<br>
          <a href="https://dispobuddy.com/buyers-map" style="color:#29ABE2;font-weight:600">View the Active Buyers Map</a>
        </p>
      </div>
      <div style="padding:24px;border-top:1px solid #E2E8F0;text-align:center;color:#718096;font-size:12px">
        Dispo Buddy — A Deal Pros LLC Brand<br>
        <a href="https://dispobuddy.com" style="color:#29ABE2">dispobuddy.com</a> · (480) 842-5332
      </div>
    </div>`;
}

function buildInternalOnboardingEmail(d, contactId) {
  const ghlLink = `https://app.gohighlevel.com/v2/location/7IyUgu1zpi38MDYpSDTs/contacts/detail/${contactId}`;
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:600px;color:#0D1F3C">
      <h2>New Partner Joined</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0;width:140px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.full_name}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Type</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.partner_type}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.phone}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Email</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.email}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Company</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.company || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Markets</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.primary_markets || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Deal Types</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.deal_types || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Volume</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.monthly_volume || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Deal Ready?</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.deal_ready || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Source</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.referral_source || 'N/A'}</td></tr>
        ${d.notes ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Notes</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.notes}</td></tr>` : ''}
      </table>
      <a href="${ghlLink}" style="display:inline-block;padding:12px 28px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">View in GHL</a>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// BUILD CONTACT PAYLOADS
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

  const detailParts = [];
  if (d.partner_type)     detailParts.push(`Partner Type: ${d.partner_type}`);
  if (d.primary_markets)  detailParts.push(`Markets: ${d.primary_markets}`);
  if (d.deal_types)       detailParts.push(`Deal Types: ${d.deal_types}`);
  if (d.monthly_volume)   detailParts.push(`Monthly Volume: ${d.monthly_volume}`);
  if (d.deal_ready)       detailParts.push(`Deal Ready: ${d.deal_ready}`);
  if (d.company)          detailParts.push(`Company: ${d.company}`);
  if (d.notes)            detailParts.push(`Notes: ${d.notes}`);
  if (detailParts.length > 0) cf('important_details', detailParts.join(' | '));

  const nameParts = (d.full_name || '').trim().split(' ');

  const payload = {
    locationId,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    phone: d.phone,
    email: d.email,
    source: 'Dispo Buddy — Partner Onboarding',
    customFields,
  };

  if (d.utm_source || d.utm_medium || d.utm_campaign) {
    payload.attributionSource = {
      utm_source: d.utm_source || '',
      utm_medium: d.utm_medium || '',
      utm_campaign: d.utm_campaign || '',
    };
  }

  return payload;
}

function buildContactFormPayload(d, locationId) {
  const customFields = [];
  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  cf('jv_partner_name', d.name);
  cf('important_details', `Contact Form — Subject: ${d.subject || '(none)'}\n\n${d.message || ''}`);

  const nameParts = (d.name || '').trim().split(' ');

  return {
    locationId,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    phone: d.phone || undefined,
    email: d.email,
    source: 'Dispo Buddy — Contact Form',
    customFields,
  };
}

// ─────────────────────────────────────────────────────────────
// BUILD TAGS
// ─────────────────────────────────────────────────────────────

function buildOnboardingTags(d) {
  const tags = ['dispo-buddy', 'jv-partner', 'db-onboarding'];
  if (d.partner_type === 'Real Estate Agent') tags.push('db-agent');
  if (d.deal_ready === 'Yes') tags.push('db-deal-ready');
  return [...new Set(tags)];
}

function buildOnboardingOpportunityPayload(d, contactId, locationId) {
  const nameParts   = (d.full_name || '').trim().split(' ');
  const lastName    = nameParts.slice(1).join(' ') || nameParts[0] || '';

  return {
    locationId,
    name: `Onboarding — ${d.partner_type || 'Partner'} — ${lastName}`,
    contactId,
    pipelineId: JV_PIPELINE_ID,
    pipelineStageId: JV_STAGE_NEW,
    monetaryValue: 0,
    status: 'open',
    source: 'Dispo Buddy — Partner Onboarding Form',
  };
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
  if (!res.ok) console.warn('SMS response:', JSON.stringify(data));
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
  if (!res.ok) console.warn('Email response:', JSON.stringify(data));
  return data;
}

async function sendInternalSMS(phone, headers, locationId, message) {
  const searchRes = await ghlFetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}&limit=1`,
    'GET', null, headers
  );
  const searchData = await searchRes.json();
  let internalId = searchData.contacts?.[0]?.id;

  if (!internalId) {
    const upsertRes = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', {
      locationId, phone, firstName: 'Dispo Buddy', lastName: 'Alerts',
      source: 'Internal — Dispo Buddy Alerts',
    }, headers);
    const upsertData = await upsertRes.json();
    internalId = upsertData.contact?.id || upsertData.id;
  }

  if (internalId) return sendSMS(internalId, headers, message);
}

async function sendInternalEmail(email, headers, locationId, { subject, html }) {
  const searchRes = await ghlFetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`,
    'GET', null, headers
  );
  const searchData = await searchRes.json();
  let internalId = searchData.contacts?.[0]?.id;

  if (!internalId) {
    const upsertRes = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', {
      locationId, email, firstName: 'Dispo Buddy', lastName: 'Alerts',
      source: 'Internal — Dispo Buddy Alerts',
    }, headers);
    const upsertData = await upsertRes.json();
    internalId = upsertData.contact?.id || upsertData.id;
  }

  if (internalId) return sendEmail(internalId, headers, { subject, html });
}

async function addNote(contactId, headers, body) {
  const res = await ghlFetch(`${GHL_BASE}/contacts/${contactId}/notes`, 'POST', { body }, headers);
  const data = await res.json();
  if (!res.ok) console.warn('Note response:', JSON.stringify(data));
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}
