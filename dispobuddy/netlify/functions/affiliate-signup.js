/**
 * Dispo Buddy — Affiliate Program Signup
 * POST /.netlify/functions/affiliate-signup
 *
 * Registers a new affiliate in GHL, assigns a unique affiliate_id, tags the
 * contact as `db-affiliate`, stores counters in custom fields, and emails a
 * welcome message with the affiliate's personal referral link.
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY          — GHL private integration API key
 *   GHL_LOCATION_ID      — GHL Location ID
 *
 * Optional:
 *   INTERNAL_ALERT_PHONE — internal SMS alerts
 *   INTERNAL_ALERT_EMAIL — internal email alerts
 *   SITE_URL             — defaults to https://dispobuddy.netlify.app
 */

const GHL_BASE       = 'https://services.leadconnectorhq.com';
const SITE_URL       = process.env.SITE_URL || 'https://dispobuddy.netlify.app';

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID');
    return respond(500, { error: 'Server configuration error' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const full_name = (body.full_name || body.fullName || '').trim();
  const email     = (body.email || '').trim().toLowerCase();
  const phone     = (body.phone || '').trim();
  const payout_method  = (body.payout_method  || '').trim();
  const payout_details = (body.payout_details || '').trim();
  const audience  = (body.audience  || '').trim();
  const promo_plan = (body.promo_plan || '').trim();
  const website   = (body.website   || '').trim();
  const notes     = (body.notes     || '').trim();
  const consent   = !!body.consent;

  if (!full_name || !email || !phone || !payout_method) {
    return respond(400, { error: 'Missing required fields: full_name, email, phone, payout_method' });
  }
  if (!consent) {
    return respond(400, { error: 'You must accept the affiliate program terms to sign up.' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
  };

  try {
    const affiliate_id = generateAffiliateId(full_name);
    const referral_link = `${SITE_URL}/?ref=${affiliate_id}`;

    // ── 1. Upsert Contact with affiliate custom fields ─────────
    const contactPayload = buildAffiliateContactPayload({
      full_name, email, phone, audience, promo_plan, website, notes,
      payout_method, payout_details, affiliate_id, referral_link,
      utm_source:   body.utm_source || '',
      utm_medium:   body.utm_medium || '',
      utm_campaign: body.utm_campaign || '',
    }, locationId);

    const contactRes  = await ghlFetch(`${GHL_BASE}/contacts/upsert`, 'POST', contactPayload, headers);
    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      console.error('Affiliate contact upsert failed:', JSON.stringify(contactData));
      return respond(502, { error: 'Failed to create affiliate', detail: contactData });
    }

    const contactId = contactData.contact?.id || contactData.id;
    if (!contactId) return respond(502, { error: 'No contact ID returned' });

    // ── 2. Tags ────────────────────────────────────────────────
    const tags = ['dispo-buddy', 'db-affiliate', 'affiliate-active'];
    await ghlFetch(`${GHL_BASE}/contacts/${contactId}/tags`, 'POST', { tags }, headers);

    // ── 3. Notifications ───────────────────────────────────────
    const notifs = [];
    const first = full_name.split(' ')[0] || 'there';

    // Welcome SMS
    notifs.push(
      sendSMS(contactId, headers,
        `Hey ${first}! You're in the Dispo Buddy affiliate program.\n\n` +
        `Your unique link:\n${referral_link}\n\n` +
        `Track your clicks & earnings at ${SITE_URL}/affiliate-dashboard\n\n` +
        `Reply STOP to opt out.`
      ).catch(err => console.warn('Affiliate welcome SMS failed:', err.message))
    );

    // Welcome email
    notifs.push(
      sendEmail(contactId, headers, {
        subject: "You're a Dispo Buddy Affiliate — Here's Your Link",
        html: buildAffiliateWelcomeEmail({ first, full_name, affiliate_id, referral_link }),
      }).catch(err => console.warn('Affiliate welcome email failed:', err.message))
    );

    // Internal SMS alert
    const alertPhone = process.env.INTERNAL_ALERT_PHONE;
    if (alertPhone) {
      notifs.push(
        sendInternalSMS(alertPhone, headers, locationId,
          `🎯 NEW AFFILIATE\n` +
          `Name: ${full_name}\n` +
          `Email: ${email}\n` +
          `Phone: ${phone}\n` +
          `Audience: ${audience || 'N/A'}\n` +
          `ID: ${affiliate_id}`
        ).catch(err => console.warn('Internal SMS failed:', err.message))
      );
    }

    // Internal email alert
    const alertEmail = process.env.INTERNAL_ALERT_EMAIL;
    if (alertEmail) {
      notifs.push(
        sendInternalEmail(alertEmail, headers, locationId, {
          subject: `New Affiliate: ${full_name}`,
          html: buildInternalAffiliateEmail({
            full_name, email, phone, audience, promo_plan, website,
            payout_method, notes, affiliate_id, referral_link, contactId,
          }),
        }).catch(err => console.warn('Internal email failed:', err.message))
      );
    }

    // Note
    notifs.push(
      addNote(contactId, headers,
        `🎯 AFFILIATE SIGNUP\n` +
        `Affiliate ID: ${affiliate_id}\n` +
        `Referral Link: ${referral_link}\n` +
        `Payout: ${payout_method}${payout_details ? ' — ' + payout_details : ''}\n` +
        `Audience: ${audience || 'N/A'}\n` +
        `Promo plan: ${promo_plan || 'N/A'}\n` +
        `Website: ${website || 'N/A'}\n` +
        (notes ? `Notes: ${notes}` : '')
      ).catch(err => console.warn('Note failed:', err.message))
    );

    await Promise.race([
      Promise.allSettled(notifs),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);

    console.log('Affiliate signup:', JSON.stringify({
      contactId, affiliate_id, name: full_name, email,
    }));

    return respond(200, {
      success: true,
      affiliate_id,
      referral_link,
      dashboard_url: `${SITE_URL}/affiliate-dashboard?ref=${affiliate_id}`,
    });

  } catch (err) {
    console.error('Affiliate signup error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

// ─────────────────────────────────────────────────────────────
// UNIQUE AFFILIATE ID
// ─────────────────────────────────────────────────────────────
function generateAffiliateId(fullName) {
  const slug = (fullName || 'partner')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 24) || 'partner';
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug}-${rand}`;
}

// ─────────────────────────────────────────────────────────────
// CONTACT PAYLOAD
// ─────────────────────────────────────────────────────────────
function buildAffiliateContactPayload(d, locationId) {
  const customFields = [];
  function cf(key, val) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      customFields.push({ key, field_value: String(val).trim() });
    }
  }

  cf('jv_partner_name',              d.full_name);
  cf('affiliate_id',                 d.affiliate_id);
  cf('affiliate_referral_link',      d.referral_link);
  cf('affiliate_status',             'active');
  cf('affiliate_joined_at',          new Date().toISOString());
  cf('affiliate_payout_method',      d.payout_method);
  cf('affiliate_payout_details',     d.payout_details);
  cf('affiliate_audience',           d.audience);
  cf('affiliate_promo_plan',         d.promo_plan);
  cf('affiliate_website',            d.website);
  cf('affiliate_clicks',             '0');
  cf('affiliate_signups',            '0');
  cf('affiliate_deals_submitted',    '0');
  cf('affiliate_deals_closed',       '0');
  cf('affiliate_commission_earned',  '0');
  cf('affiliate_commission_paid',    '0');

  const detailParts = [];
  if (d.payout_method)  detailParts.push(`Payout: ${d.payout_method}`);
  if (d.audience)       detailParts.push(`Audience: ${d.audience}`);
  if (d.promo_plan)     detailParts.push(`Promo: ${d.promo_plan}`);
  if (d.website)        detailParts.push(`Website: ${d.website}`);
  if (d.notes)          detailParts.push(`Notes: ${d.notes}`);
  if (detailParts.length) cf('important_details', detailParts.join(' | '));

  const nameParts = (d.full_name || '').trim().split(' ');

  const payload = {
    locationId,
    firstName: nameParts[0] || '',
    lastName:  nameParts.slice(1).join(' ') || '',
    phone: d.phone,
    email: d.email,
    source: 'Dispo Buddy — Affiliate Signup',
    customFields,
  };

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
// EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────
function buildAffiliateWelcomeEmail({ first, full_name, affiliate_id, referral_link }) {
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0D1F3C">
      <div style="padding:32px 0;text-align:center;border-bottom:2px solid #29ABE2">
        <img src="${SITE_URL}/logo-dark.svg" alt="Dispo Buddy" style="height:48px;margin:0 auto">
      </div>
      <div style="padding:32px 24px">
        <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">You're an Affiliate, ${first}!</h1>
        <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
          Welcome to the Dispo Buddy Affiliate Program. Share your unique link and earn on every deal your referrals close with us.
        </p>

        <div style="background:#F4F6F9;border-left:4px solid #29ABE2;border-radius:0 8px 8px 0;padding:20px 24px;margin-bottom:24px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#718096;font-weight:700;margin-bottom:6px">Your Unique Referral Link</div>
          <div style="font-family:'SFMono-Regular',Consolas,monospace;font-size:14px;color:#0D1F3C;word-break:break-all">
            <a href="${referral_link}" style="color:#29ABE2">${referral_link}</a>
          </div>
          <div style="font-size:11px;color:#718096;margin-top:8px">Affiliate ID: <b style="color:#0D1F3C">${affiliate_id}</b></div>
        </div>

        <h2 style="font-size:16px;font-weight:700;margin-bottom:10px">Commission Structure</h2>
        <div style="background:#F4F6F9;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <p style="margin-bottom:10px"><strong style="color:#F7941D">$250</strong> — per qualified partner you refer who submits their first deal</p>
          <p style="margin-bottom:10px"><strong style="color:#F7941D">10%</strong> — of Dispo Buddy's net assignment fee on every deal your referrals close</p>
          <p><strong style="color:#F7941D">$100 bonus</strong> — for every 5 closed referrals in a rolling 90-day window</p>
        </div>

        <h2 style="font-size:16px;font-weight:700;margin-bottom:10px">How It Works</h2>
        <ol style="color:#4A6070;line-height:1.9;padding-left:20px;margin-bottom:24px">
          <li>Share your link anywhere — email, social, SMS, Facebook groups</li>
          <li>Visits, signups, and deal submissions are tracked automatically for 90 days</li>
          <li>You get paid when a referred deal closes through Dispo Buddy</li>
          <li>Payouts go out on the 15th of every month for the prior month's closes</li>
        </ol>

        <div style="text-align:center;margin:32px 0">
          <a href="${SITE_URL}/affiliate-dashboard?ref=${affiliate_id}" style="display:inline-block;padding:14px 32px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">View Your Dashboard →</a>
        </div>

        <p style="color:#4A6070;line-height:1.7;font-size:13px">
          Questions? Reply to this email or text <a href="tel:4808425332" style="color:#29ABE2">(480) 842-5332</a>.
        </p>
      </div>
      <div style="padding:24px;border-top:1px solid #E2E8F0;text-align:center;color:#718096;font-size:12px">
        Dispo Buddy — A Deal Pros LLC Brand<br>
        <a href="${SITE_URL}" style="color:#29ABE2">dispobuddy.com</a> · (480) 842-5332
      </div>
    </div>`;
}

function buildInternalAffiliateEmail(d) {
  const ghlLink = `https://app.gohighlevel.com/v2/location/7IyUgu1zpi38MDYpSDTs/contacts/detail/${d.contactId}`;
  return `
    <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:600px;color:#0D1F3C">
      <h2>New Affiliate Signup</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0;width:160px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.full_name}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Email</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.email}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.phone}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Audience</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.audience || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Promo Plan</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.promo_plan || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Website</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.website || 'N/A'}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Payout</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.payout_method}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Affiliate ID</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0"><code>${d.affiliate_id}</code></td></tr>
        <tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Referral Link</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0"><a href="${d.referral_link}" style="color:#29ABE2">${d.referral_link}</a></td></tr>
        ${d.notes ? `<tr><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #E2E8F0">Notes</td><td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${d.notes}</td></tr>` : ''}
      </table>
      <a href="${ghlLink}" style="display:inline-block;padding:12px 28px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">View in GHL</a>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// GHL HELPERS
// ─────────────────────────────────────────────────────────────
async function sendSMS(contactId, headers, message) {
  const res = await ghlFetch(`${GHL_BASE}/conversations/messages`, 'POST', {
    type: 'SMS', contactId, message,
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
