/**
 * Dispo Buddy — Partner Stage Change Notify
 * POST /.netlify/functions/partner-stage-notify
 *
 * Called by a GHL workflow when an opportunity changes stage in the
 * "3. JV Deals" pipeline. Sends the appropriate branded SMS + email to
 * the partner based on the new stage.
 *
 * GHL Workflow setup:
 *   Trigger: Pipeline Stage Changed (pipeline = 3. JV Deals)
 *   Action: Webhook POST to /.netlify/functions/partner-stage-notify
 *   Body: { contactId, opportunityId, stageName, pipelineId }
 *
 * Required env vars:
 *   GHL_API_KEY
 *   GHL_LOCATION_ID
 *   NOTIFICATIONS_LIVE  (must be 'true' to send real SMS/email)
 * Optional:
 *   INTERNAL_ALERT_PHONE
 *   INTERNAL_ALERT_EMAIL
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  const respHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: respHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: respHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return { statusCode: 500, headers: respHeaders, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Log everything GHL sent so we can debug template mismatches
  console.log('🔔 partner-stage-notify received:', JSON.stringify(body));

  const { contactId, opportunityId, stageName } = body;
  if (!contactId || !stageName) {
    console.warn('Missing required fields — contactId:', contactId, 'stageName:', stageName);
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'contactId and stageName required' }) };
  }

  // Normalize stageName: strip whitespace, case-insensitive match later
  const normalizedStage = (stageName || '').trim();
  console.log('Normalized stage:', JSON.stringify(normalizedStage));

  const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
  if (!isLive) {
    console.log('NOTIFICATIONS_LIVE is not true — skipping stage notify for', stageName);
    return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: false, testMode: true }) };
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Fetch contact + opportunity context
    const contactRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders });
    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;

    let opp = null;
    if (opportunityId) {
      try {
        const oppRes = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, { headers: ghlHeaders });
        const oppJson = await oppRes.json();
        opp = oppJson.opportunity || oppJson;
      } catch (err) {
        console.warn('Opp fetch failed (non-fatal):', err.message);
      }
    }

    // Extract custom fields for merge variables
    const cfArray = contact.customFields || [];
    const cf = {};
    cfArray.forEach(f => {
      if (f.fieldKey) cf[f.fieldKey] = f.value;
      if (f.key) cf[f.key] = f.value;
      if (f.name) cf[f.name] = f.value;
    });

    const firstName = contact.firstName || 'there';
    const address = cf.property_address || 'your property';
    const dealType = cf.deal_type || 'deal';

    // Get the template for this stage (try normalized name, then fallback)
    const template = getStageTemplate(normalizedStage, {
      firstName,
      address,
      dealType,
      opp,
      cf,
    });

    if (!template) {
      console.warn('⚠ No template found for stage:', JSON.stringify(normalizedStage));
      console.warn('Available template keys: Missing Information, Ready to Market, Actively Marketing, Assignment Sent, Assigned with EMD, Closed, Not Accepted');
      return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: false, reason: 'no template', stageReceived: normalizedStage }) };
    }

    console.log('✓ Template matched for stage:', normalizedStage, '— SMS:', !!template.sms, 'email:', !!template.email, 'internal:', !!template.internal);

    const notifs = [];

    // Partner SMS
    if (template.sms) {
      notifs.push(sendSMS(contactId, ghlHeaders, template.sms).catch(e => console.warn('SMS failed:', e.message)));
    }
    // Partner email
    if (template.email && contact.email) {
      notifs.push(sendEmail(contactId, ghlHeaders, template.email).catch(e => console.warn('Email failed:', e.message)));
    }
    // Internal alert if it's a big milestone
    if (template.internal) {
      const alertPhone = process.env.INTERNAL_ALERT_PHONE;
      if (alertPhone) {
        notifs.push(sendInternalSMS(alertPhone, ghlHeaders, locationId, template.internal).catch(e => console.warn('Internal SMS failed:', e.message)));
      }
    }

    // Wait for ALL notifications to complete (no race timeout — let them finish)
    // Netlify functions have a 10s timeout anyway, so we have headroom
    const results = await Promise.allSettled(notifs);
    const sentCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;

    console.log('Stage notify done:', normalizedStage, 'for', contactId, '— sent:', sentCount, 'failed:', failedCount);
    return {
      statusCode: 200,
      headers: respHeaders,
      body: JSON.stringify({
        success: true,
        sent: sentCount > 0,
        stage: normalizedStage,
        sentCount,
        failedCount,
      }),
    };

  } catch (err) {
    console.error('Stage notify error:', err);
    return { statusCode: 500, headers: respHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

// ─────────────────────────────────────────────────────────────
// STAGE TEMPLATES
// ─────────────────────────────────────────────────────────────
function getStageTemplate(stage, ctx) {
  const { firstName, address, dealType, cf } = ctx;

  const templates = {
    'Missing Information': {
      sms: `Hey ${firstName}, we're reviewing your ${dealType} deal at ${address} but need a few more items before we can move forward:\n\n${cf.missing_info || 'Check your email for details'}\n\nReply here or text (480) 842-5332. — Dispo Buddy`,
      email: {
        subject: `Action needed — ${address}`,
        html: buildMissingInfoEmail(firstName, address, dealType, cf.missing_info || ''),
      },
    },
    'Ready to Market': {
      sms: `Great news ${firstName}! Your deal at ${address} has been accepted. JV agreement coming your way shortly. Track at dispobuddy.com/dashboard — Dispo Buddy`,
      email: {
        subject: 'Your deal was accepted',
        html: buildAcceptedEmail(firstName, address, dealType),
      },
    },
    'Actively Marketing': {
      sms: `🚀 ${firstName}, your deal at ${address} is now LIVE and being marketed to our 2,000+ buyer network. Track it: dispobuddy.com/dashboard`,
      email: {
        subject: 'Your deal is live on the market',
        html: buildMarketingEmail(firstName, address, dealType),
      },
    },
    'Assignment Sent': {
      sms: `🎯 Big news ${firstName} — we found a buyer for ${address}! Assignment contract is out for signature. We'll keep you updated.`,
      email: {
        subject: 'We found a buyer for your deal',
        html: buildAssignmentSentEmail(firstName, address),
      },
      internal: `💰 ASSIGNMENT SENT: ${address} | Partner: ${firstName} | Stage: ${stage}`,
    },
    'Assigned with EMD': {
      sms: `${firstName}, EMD is in! The buyer for ${address} has deposited earnest money. We're now working toward close. Your payout is locked in per the JV agreement.`,
      email: {
        subject: 'EMD received — we\'re closing soon',
        html: buildEmdEmail(firstName, address),
      },
    },
    'Closed': {
      sms: `🎉 ${firstName}, your deal at ${address} just CLOSED! Your payout is being disbursed through title. Thanks for partnering with Dispo Buddy. Got another deal? dispobuddy.com/submit-deal`,
      email: {
        subject: '🎉 Your deal closed — payment incoming',
        html: buildClosedEmail(firstName, address),
      },
      internal: `✅ CLOSED: ${address} | Partner: ${firstName}`,
    },
    'Not Accepted': {
      sms: `Hey ${firstName}, after reviewing your deal at ${address}, we couldn't make it work this time. Check your email for feedback. Keep finding deals — we'd love to see the next one. — Dispo Buddy`,
      email: {
        subject: 'Feedback on your deal submission',
        html: buildNotAcceptedEmail(firstName, address, cf.rejected_deal_feedback || ''),
      },
    },
  };

  // Try exact match first
  if (templates[stage]) return templates[stage];

  // Fallback: case-insensitive match
  const stageLower = (stage || '').toLowerCase().trim();
  for (const key of Object.keys(templates)) {
    if (key.toLowerCase() === stageLower) return templates[key];
  }

  // Fallback: fuzzy keyword match
  if (stageLower.indexOf('missing') !== -1) return templates['Missing Information'];
  if (stageLower.indexOf('ready') !== -1 || stageLower.indexOf('accepted') !== -1) return templates['Ready to Market'];
  if (stageLower.indexOf('actively') !== -1 || stageLower.indexOf('marketing') !== -1) return templates['Actively Marketing'];
  if (stageLower.indexOf('assignment sent') !== -1) return templates['Assignment Sent'];
  if (stageLower.indexOf('emd') !== -1) return templates['Assigned with EMD'];
  if (stageLower.indexOf('closed') !== -1) return templates['Closed'];
  if (stageLower.indexOf('not accepted') !== -1 || stageLower.indexOf('rejected') !== -1 || stageLower.indexOf('declined') !== -1) return templates['Not Accepted'];

  return null;
}

// ─────────────────────────────────────────────────────────────
// EMAIL BUILDERS
// ─────────────────────────────────────────────────────────────
function emailShell(innerHtml) {
  return `
<div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0D1F3C">
  <div style="padding:32px 24px 16px;text-align:center">
    <img src="https://dispobuddy.netlify.app/logo-email.png" alt="Dispo Buddy" style="height:60px;margin:0 auto;display:block">
  </div>
  <div style="padding:0 24px 32px">
    ${innerHtml}
  </div>
  <div style="padding:24px;text-align:center;color:#718096;font-size:12px;border-top:1px solid #E2E8F0">
    Dispo Buddy — A Deal Pros LLC Brand<br>
    <a href="https://dispobuddy.com" style="color:#29ABE2">dispobuddy.com</a> · (480) 842-5332
  </div>
</div>`;
}

function buildMissingInfoEmail(firstName, address, dealType, missingInfo) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">We need a few more details</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, thanks for submitting <strong>${address}</strong>. Before we can finalize underwriting on your ${dealType} deal, we need the following:
    </p>
    <div style="background:#FFF3E0;border-left:4px solid #F7941D;padding:20px;border-radius:0 8px 8px 0;margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#c05621;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">What we need:</div>
      <div style="color:#0D1F3C;line-height:1.7;white-space:pre-wrap">${missingInfo || 'Check with our team for specific items.'}</div>
    </div>
    <p style="color:#4A6070;line-height:1.7">The faster you send it, the faster we can get your deal to market. Reply here or text us at (480) 842-5332.</p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildAcceptedEmail(firstName, address, dealType) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Your Deal Was Accepted! 🎉</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, great news — your <strong>${dealType}</strong> submission for <strong>${address}</strong> made it through underwriting and we're moving forward.
    </p>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px">Next Steps</h2>
      <ol style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li><strong>Sign the JV Agreement</strong> — We'll send it shortly via GHL</li>
        <li><strong>We package the deal</strong> — Marketing materials, deal sheet, photos</li>
        <li><strong>We market to our buyer network</strong> — 2,000+ active investors</li>
        <li><strong>You get paid at close</strong> — Per your JV agreement terms</li>
      </ol>
    </div>
    <p style="color:#4A6070;line-height:1.7"><strong>Track your deal:</strong> <a href="https://dispobuddy.com/dashboard" style="color:#29ABE2">dispobuddy.com/dashboard</a></p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildMarketingEmail(firstName, address, dealType) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Your Deal Is Live 🚀</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      ${firstName}, we packaged your ${dealType} deal at <strong>${address}</strong> and pushed it live to our buyer network.
    </p>
    <div style="background:#EBF8FF;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px;color:#1a8bbf">What's happening now</h2>
      <ul style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li><strong>SMS + email blast</strong> — 2,000+ active investors notified</li>
        <li><strong>Buyer Q&A</strong> — We field questions and schedule showings</li>
        <li><strong>Offer negotiation</strong> — We secure the best price and terms</li>
      </ul>
    </div>
    <div style="text-align:center;margin:32px 0">
      <a href="https://dispobuddy.com/dashboard" style="display:inline-block;padding:14px 36px;background:#29ABE2;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Track Your Deal</a>
    </div>
    <p style="color:#4A6070;line-height:1.7">Typical timeline: 7–14 days to find a buyer. We'll keep you posted.</p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildAssignmentSentEmail(firstName, address) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">We Found a Buyer! 🎯</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      ${firstName}, we have a qualified buyer lined up for <strong>${address}</strong>. The assignment contract is out for signature.
    </p>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px">What happens next</h2>
      <ol style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li><strong>Buyer signs assignment</strong> — Typically 24-48 hours</li>
        <li><strong>EMD deposited</strong> — Earnest money hits title</li>
        <li><strong>TC introduction</strong> — Our transaction coordinator coordinates all parties to close</li>
        <li><strong>Close</strong> — You get paid through title</li>
      </ol>
    </div>
    <p style="color:#4A6070;line-height:1.7">We'll keep you posted at every step.</p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildEmdEmail(firstName, address) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">EMD Received 💰</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Great news ${firstName} — the buyer for <strong>${address}</strong> has deposited earnest money. We're now actively working toward close.
    </p>
    <div style="background:#E6F9F0;border-left:4px solid #10B981;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
      <strong style="color:#276749">Your payout is locked in</strong><br>
      <span style="color:#4A6070;font-size:14px">Payment disbursed by title at close per your JV agreement.</span>
    </div>
    <p style="color:#4A6070;line-height:1.7"><strong>Typical timeline:</strong> 14-21 days from EMD to close.</p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildClosedEmail(firstName, address) {
  return emailShell(`
    <h1 style="font-size:28px;font-weight:900;margin-bottom:16px">We Did It! 🎉</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      ${firstName}, your deal at <strong>${address}</strong> officially <strong>CLOSED</strong> today. Payment is being disbursed by the title company now.
    </p>
    <div style="background:#E6F9F0;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
      <div style="font-size:14px;color:#276749;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your Payout</div>
      <div style="font-size:13px;color:#4A6070">Disbursed directly from title per your JV agreement</div>
    </div>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">Thanks for trusting Dispo Buddy with your deal.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="https://dispobuddy.com/submit-deal" style="display:inline-block;padding:14px 36px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Submit Your Next Deal</a>
    </div>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

function buildNotAcceptedEmail(firstName, address, feedback) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Deal Feedback</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, thanks for submitting <strong>${address}</strong>. After reviewing the numbers and market data, we're going to pass on this one.
    </p>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:14px;font-weight:700;margin-bottom:10px;color:#4A6070;text-transform:uppercase;letter-spacing:.5px">Our Feedback</h2>
      <p style="color:#0D1F3C;line-height:1.7;font-size:14px;white-space:pre-wrap">${feedback || 'Contact us for specific feedback.'}</p>
    </div>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:16px">
      <strong>Don't stop bringing us deals.</strong> Passing on one doesn't mean we're done. Keep submitting.
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="https://dispobuddy.com/submit-deal" style="display:inline-block;padding:12px 28px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Submit Another Deal</a>
    </div>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Dispo Buddy Team</p>
  `);
}

// ─────────────────────────────────────────────────────────────
// GHL HELPERS
// ─────────────────────────────────────────────────────────────
async function sendSMS(contactId, headers, message) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'SMS', contactId, message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('❌ SMS send FAILED status:', res.status, 'response:', JSON.stringify(data).substring(0, 400));
  } else {
    console.log('✓ SMS sent, msgId:', data.messageId || data.id || 'unknown');
  }
  return data;
}

async function sendEmail(contactId, headers, { subject, html }) {
  // Try without emailFrom first (GHL falls back to account default)
  const payload = {
    type: 'Email',
    contactId,
    subject,
    html,
  };
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('❌ Email send FAILED status:', res.status, 'response:', JSON.stringify(data).substring(0, 400));
    console.error('Email payload was:', JSON.stringify({ type: 'Email', contactId, subject, htmlLen: (html || '').length }));
  } else {
    console.log('✓ Email sent, msgId:', data.messageId || data.id || 'unknown');
  }
  return data;
}

async function sendInternalSMS(phone, headers, locationId, message) {
  const searchRes = await fetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(phone)}&limit=1`,
    { headers }
  );
  const searchData = await searchRes.json();
  let id = searchData.contacts?.[0]?.id;
  if (!id) {
    const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ locationId, phone, firstName: 'Dispo Buddy', lastName: 'Alerts' }),
    });
    const upsertData = await upsertRes.json();
    id = upsertData.contact?.id || upsertData.id;
  }
  if (id) return sendSMS(id, headers, message);
}
