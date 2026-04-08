/**
 * Terms For Sale — Buyer Contract Lifecycle Notify
 * POST /.netlify/functions/buyer-contract-lifecycle
 *
 * Called by a GHL workflow when a buyer's opportunity changes stage in
 * the "Buyer Inquiries" pipeline. Sends branded SMS + email to the buyer
 * for each stage in the contract → close lifecycle.
 *
 * Pipeline: JqPNGn6dao8hBfTzbLRG (Buyer Inquiries)
 *
 * Stages handled:
 *   Offer Submitted
 *   Contract Sent
 *   Contract Signed
 *   EMD Received
 *   Closed
 *   Lost
 *
 * GHL Workflow setup:
 *   Trigger: Opportunity Stage Changed (pipeline = Buyer Inquiries)
 *   Action:  Webhook POST to /.netlify/functions/buyer-contract-lifecycle
 *   Payload Type: Custom Data
 *   Body: { contactId, opportunityId, stageName, pipelineId }
 *
 * Required env vars: GHL_API_KEY, GHL_LOCATION_ID
 * Optional: INTERNAL_ALERT_PHONE (Brooke), INTERNAL_ALERT_EMAIL
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

  console.log('🔔 buyer-contract-lifecycle received:', JSON.stringify(body));

  // Handle GHL's inconsistent webhook field naming (same issue as partner webhook)
  const cd = body.customData || {};
  const contactId =
    body.contactId ||
    cd.contactId || cd['contact id'] ||
    body.contact_id ||
    body.contact?.id || null;
  const opportunityId =
    body.opportunityId ||
    cd.opportunityId || cd['opportunity id'] || cd['opportunity id '] ||
    body.id || null;
  const stageName =
    body.stageName ||
    cd.stageName || cd['stage name'] || cd['stage name '] ||
    body.pipleline_stage || body.pipeline_stage || null;

  if (!contactId || !stageName) {
    console.warn('Missing required fields — contactId:', contactId, 'stageName:', stageName);
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'contactId and stageName required' }) };
  }

  const normalizedStage = (stageName || '').trim();
  console.log('✓ Parsed contactId:', contactId, '| stage:', JSON.stringify(normalizedStage));

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
      } catch (err) { /* non-fatal */ }
    }

    // Extract custom fields
    const cfArray = contact.customFields || [];
    const cf = {};
    cfArray.forEach(f => {
      if (f.fieldKey) cf[f.fieldKey] = f.value;
      if (f.key) cf[f.key] = f.value;
      if (f.name) cf[f.name] = f.value;
    });

    const firstName = contact.firstName || 'there';
    // Offer property_address from contact, fall back to opportunity name
    const propertyAddress = cf.property_address || (opp && opp.name ? opp.name.split(' — ')[1] || opp.name : 'your deal');
    const offerAmount = opp ? opp.monetaryValue : 0;

    const template = getStageTemplate(normalizedStage, {
      firstName,
      propertyAddress,
      offerAmount,
      contractLink: cf.contract_signing_link || cf.assignment_contract_url || '',
      emdWireInstructions: cf.emd_wire_instructions || '',
      closingDate: cf.closing_date || '',
    });

    if (!template) {
      console.warn('⚠ No template for stage:', normalizedStage);
      return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: false, reason: 'no template', stageReceived: normalizedStage }) };
    }

    const isLive = process.env.NOTIFICATIONS_LIVE !== 'false'; // Default ON for TFS (buyer side has been live)
    if (!isLive) {
      console.log('NOTIFICATIONS_LIVE=false — skipping sends');
      return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: false, testMode: true }) };
    }

    console.log('✓ Template matched:', normalizedStage, '— SMS:', !!template.sms, 'email:', !!template.email);

    const notifs = [];
    if (template.sms) {
      notifs.push(sendSMS(contactId, ghlHeaders, template.sms).catch(e => console.warn('SMS failed:', e.message)));
    }
    if (template.email && contact.email) {
      notifs.push(sendEmail(contactId, ghlHeaders, template.email).catch(e => console.warn('Email failed:', e.message)));
    }
    if (template.internal) {
      const alertPhone = process.env.INTERNAL_ALERT_PHONE;
      if (alertPhone) {
        notifs.push(sendInternalSMS(alertPhone, ghlHeaders, locationId, template.internal).catch(e => console.warn('Internal SMS failed:', e.message)));
      }
    }

    const results = await Promise.allSettled(notifs);
    const sentCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;

    console.log('Buyer lifecycle done:', normalizedStage, '— sent:', sentCount, 'failed:', failedCount);
    return {
      statusCode: 200,
      headers: respHeaders,
      body: JSON.stringify({ success: true, sent: sentCount > 0, stage: normalizedStage, sentCount, failedCount }),
    };
  } catch (err) {
    console.error('Buyer lifecycle error:', err);
    return { statusCode: 500, headers: respHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

// ─────────────────────────────────────────────────────────────
// STAGE TEMPLATES
// ─────────────────────────────────────────────────────────────
function getStageTemplate(stage, ctx) {
  const { firstName, propertyAddress, offerAmount, contractLink, emdWireInstructions, closingDate } = ctx;
  const offerStr = offerAmount ? `$${Number(offerAmount).toLocaleString()}` : 'your offer';

  const templates = {
    'Offer Submitted': {
      sms: `Hey ${firstName}, we got your offer (${offerStr}) on ${propertyAddress}. Brooke is reviewing now. We'll get back to you within a few hours. — Terms For Sale`,
      email: {
        subject: `We got your offer on ${propertyAddress}`,
        html: buildOfferSubmittedEmail(firstName, propertyAddress, offerStr),
      },
      internal: `💰 NEW OFFER: ${offerStr} on ${propertyAddress}`,
    },
    'Contract Sent': {
      sms: `${firstName}, assignment contract for ${propertyAddress} is on the way. Check your email to sign. Need help? Reply here.`,
      email: {
        subject: `Assignment contract ready to sign — ${propertyAddress}`,
        html: buildContractSentEmail(firstName, propertyAddress, contractLink),
      },
    },
    'Contract Signed': {
      sms: `Thanks ${firstName}! Contract signed on ${propertyAddress}. Next step: EMD wire. Check your email for wiring instructions.`,
      email: {
        subject: `Next step: EMD wire instructions for ${propertyAddress}`,
        html: buildContractSignedEmail(firstName, propertyAddress, emdWireInstructions),
      },
      internal: `✍️ SIGNED: ${propertyAddress} — EMD next`,
    },
    'EMD Received': {
      sms: `${firstName}, EMD received on ${propertyAddress}. Locked and moving to close. We'll update you on timeline shortly. — Terms For Sale`,
      email: {
        subject: `EMD received — we're clear to close`,
        html: buildEmdReceivedEmail(firstName, propertyAddress, closingDate),
      },
      internal: `💵 EMD IN: ${propertyAddress}`,
    },
    'Closed': {
      sms: `🎉 ${firstName}, we closed on ${propertyAddress}! Congrats. Looking for your next deal? deals.termsforsale.com — Terms For Sale`,
      email: {
        subject: `🎉 Congrats — ${propertyAddress} closed!`,
        html: buildClosedEmail(firstName, propertyAddress),
      },
      internal: `✅ BUYER CLOSED: ${propertyAddress}`,
    },
    'Lost': {
      sms: `Hey ${firstName}, we weren't able to close ${propertyAddress} this time. New deals drop daily — keep an eye on deals.termsforsale.com. — Terms For Sale`,
      email: {
        subject: `Update on ${propertyAddress}`,
        html: buildLostEmail(firstName, propertyAddress),
      },
    },
  };

  // Exact match first, then case-insensitive, then fuzzy keyword
  if (templates[stage]) return templates[stage];
  const sLower = (stage || '').toLowerCase().trim();
  for (const key of Object.keys(templates)) {
    if (key.toLowerCase() === sLower) return templates[key];
  }
  if (sLower.indexOf('offer') !== -1 && sLower.indexOf('submitted') !== -1) return templates['Offer Submitted'];
  if (sLower.indexOf('contract sent') !== -1) return templates['Contract Sent'];
  if (sLower.indexOf('contract signed') !== -1 || sLower.indexOf('signed') !== -1) return templates['Contract Signed'];
  if (sLower.indexOf('emd') !== -1) return templates['EMD Received'];
  if (sLower.indexOf('closed') !== -1 || sLower.indexOf('won') !== -1) return templates['Closed'];
  if (sLower.indexOf('lost') !== -1 || sLower.indexOf('dead') !== -1) return templates['Lost'];
  return null;
}

// ─────────────────────────────────────────────────────────────
// EMAIL BUILDERS
// ─────────────────────────────────────────────────────────────
function emailShell(innerHtml) {
  return `
<div style="font-family:'Poppins',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0D1F3C">
  <div style="padding:32px 24px 16px;text-align:center">
    <div style="font-size:22px;font-weight:900;color:#0D1F3C;letter-spacing:-.5px">Terms <span style="color:#29ABE2">For Sale</span></div>
  </div>
  <div style="padding:0 24px 32px">
    ${innerHtml}
  </div>
  <div style="padding:24px;text-align:center;color:#718096;font-size:12px;border-top:1px solid #E2E8F0">
    Terms For Sale — A Deal Pros LLC Brand<br>
    <a href="https://deals.termsforsale.com" style="color:#29ABE2">deals.termsforsale.com</a> · (480) 637-3117
  </div>
</div>`;
}

function buildOfferSubmittedEmail(firstName, address, offerStr) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">We Got Your Offer 📬</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, thanks for your offer of <strong>${offerStr}</strong> on <strong>${address}</strong>.
    </p>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px">What happens next</h2>
      <ol style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li><strong>We review the offer</strong> — usually within a few hours</li>
        <li><strong>If it's a fit</strong> — we send the assignment contract for signature</li>
        <li><strong>Sign the contract</strong> — simple e-signature</li>
        <li><strong>Wire EMD to title</strong> — locks the deal</li>
        <li><strong>Close</strong> — coordinated with TC</li>
      </ol>
    </div>
    <p style="color:#4A6070;line-height:1.7">
      Questions? Reply here or text us at (480) 637-3117.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Terms For Sale Team</p>
  `);
}

function buildContractSentEmail(firstName, address, contractLink) {
  const ctaButton = contractLink
    ? `<div style="text-align:center;margin:32px 0">
         <a href="${contractLink}" style="display:inline-block;padding:14px 36px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px">
           Sign the Contract
         </a>
       </div>`
    : `<p style="color:#4A6070;line-height:1.7;margin-bottom:20px">You'll receive a separate email from our e-signature platform with the signing link.</p>`;

  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Your Contract Is Ready to Sign ✍️</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, your assignment contract for <strong>${address}</strong> is ready. Review and sign below.
    </p>
    ${ctaButton}
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px">After you sign</h2>
      <ol style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li>We'll countersign and send the fully executed contract</li>
        <li>You'll receive EMD wiring instructions to title</li>
        <li>Once EMD is wired, we coordinate the close</li>
      </ol>
    </div>
    <p style="color:#4A6070;line-height:1.7">
      Questions about the contract? Reply here or call (480) 637-3117.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Terms For Sale Team</p>
  `);
}

function buildContractSignedEmail(firstName, address, wireInstructions) {
  const wireBlock = wireInstructions
    ? `<div style="background:#EBF8FF;border-left:4px solid #29ABE2;padding:20px;border-radius:0 8px 8px 0;margin-bottom:24px">
         <strong style="color:#1a8bbf;font-size:13px;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:10px">EMD Wire Instructions</strong>
         <div style="color:#0D1F3C;line-height:1.7;white-space:pre-wrap;font-family:monospace;font-size:13px">${wireInstructions}</div>
       </div>`
    : `<div style="background:#FFF3E0;border-left:4px solid #F7941D;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
         <strong style="color:#c05621">Wire instructions coming shortly</strong><br>
         <span style="color:#7c2d12;font-size:13px">We'll send a separate email from our title company with wiring details.</span>
       </div>`;

  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Contract Signed ✓</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Thanks ${firstName} — contract for <strong>${address}</strong> is fully executed. Next step is the EMD wire.
    </p>
    ${wireBlock}
    <p style="color:#4A6070;line-height:1.7;margin-bottom:12px"><strong>Once EMD lands at title, we'll coordinate the closing timeline with you.</strong></p>
    <p style="color:#4A6070;line-height:1.7">
      Questions? Reply here or text (480) 637-3117.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Terms For Sale Team</p>
  `);
}

function buildEmdReceivedEmail(firstName, address, closingDate) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">EMD Received 💵</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      ${firstName}, your EMD landed at title on <strong>${address}</strong>. The deal is locked and we're moving toward close.
    </p>
    <div style="background:#E6F9F0;border-left:4px solid #10B981;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px">
      <strong style="color:#276749">You're clear to close</strong><br>
      <span style="color:#4A6070;font-size:14px">${closingDate ? 'Target close: ' + closingDate : "We'll confirm your closing date shortly."}</span>
    </div>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px">What to expect</h2>
      <ul style="color:#4A6070;line-height:1.8;padding-left:20px">
        <li>Our TC will reach out to coordinate with you and title</li>
        <li>We'll confirm the closing date and any last requirements</li>
        <li>You'll receive closing documents to review before signing day</li>
      </ul>
    </div>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Terms For Sale Team</p>
  `);
}

function buildClosedEmail(firstName, address) {
  return emailShell(`
    <h1 style="font-size:28px;font-weight:900;margin-bottom:16px">Deal Closed! 🎉</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Congrats ${firstName} — <strong>${address}</strong> officially closed. Thanks for trusting us with the transaction.
    </p>
    <div style="background:#E6F9F0;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
      <div style="font-size:14px;color:#276749;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Funded & Complete</div>
      <div style="font-size:13px;color:#4A6070">Title has disbursed. Deal is in your name.</div>
    </div>
    <div style="background:#F4F6F9;border-radius:12px;padding:24px;margin-bottom:24px">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:8px">Ready for the next one?</h2>
      <p style="color:#4A6070;line-height:1.7;font-size:14px;margin-bottom:16px">
        New deals drop daily. You're on our alert list — keep an eye on your inbox.
      </p>
      <div style="text-align:center">
        <a href="https://deals.termsforsale.com/deals.html" style="display:inline-block;padding:14px 36px;background:#F7941D;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px">
          Browse Active Deals
        </a>
      </div>
    </div>
    <p style="color:#4A6070;line-height:1.7">
      Want to give a testimonial? Reply and let us know how the deal went.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— Brooke and the Terms For Sale Team</p>
  `);
}

function buildLostEmail(firstName, address) {
  return emailShell(`
    <h1 style="font-size:24px;font-weight:800;margin-bottom:16px">Update on ${address}</h1>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      Hey ${firstName}, unfortunately we weren't able to get <strong>${address}</strong> to close this time. Could be title, financing, buyer backout, or something else.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-bottom:20px">
      <strong>Don't let it slow you down.</strong> We drop new deals every day and you're on our buyer alert list. The next one is always around the corner.
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="https://deals.termsforsale.com/deals.html" style="display:inline-block;padding:12px 28px;background:#29ABE2;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">
        See Active Deals
      </a>
    </div>
    <p style="color:#4A6070;line-height:1.7">
      Questions? Reply here or call (480) 637-3117.
    </p>
    <p style="color:#4A6070;line-height:1.7;margin-top:24px">— The Terms For Sale Team</p>
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
  if (!res.ok) console.error('❌ SMS send FAILED:', res.status, JSON.stringify(data).substring(0, 300));
  else console.log('✓ SMS sent, msgId:', data.messageId || data.id || 'unknown');
  return data;
}

async function sendEmail(contactId, headers, { subject, html }) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'Email', contactId, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('❌ Email send FAILED:', res.status, JSON.stringify(data).substring(0, 300));
  else console.log('✓ Email sent, msgId:', data.messageId || data.id || 'unknown');
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
      body: JSON.stringify({ locationId, phone, firstName: 'TFS', lastName: 'Alerts' }),
    });
    const upsertData = await upsertRes.json();
    id = upsertData.contact?.id || upsertData.id;
  }
  if (id) return sendSMS(id, headers, message);
}
