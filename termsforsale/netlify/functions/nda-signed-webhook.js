// Receives GHL "Document Signed" webhook, advances the buyer's opportunity
// from "NDA Requested" → "NDA Signed", and triggers data room delivery.
//
// Configure in GHL: Settings → Webhooks → Add webhook
//   URL: https://deals.termsforsale.com/.netlify/functions/nda-signed-webhook
//   Event: Document Signed (or use a Workflow with HTTP Request action)
//   Auth: signed payload (we validate via shared secret env var GHL_WEBHOOK_SECRET)
//
// Expected payload (GHL Document Signed event — fields vary by event source):
//   {
//     event: 'document.signed',
//     contactId: '...',
//     contactEmail: '...',
//     contactName: '...',
//     documentId: '...',
//     templateName: 'Commercial NDA — CMF-001',   // we parse deal code from here
//     customData: { dealCode: 'CMF-001' }         // OR set this in the workflow
//   }

const crypto = require('crypto');
const {
  findContactByEmail,
  findOpportunityByContactAndDealCode,
  advanceOpportunityStage,
  isTest,
} = require('./_ghl');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function validateSignature(rawBody, providedSig) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('GHL_WEBHOOK_SECRET not set — signature validation skipped (NOT for production)');
    return true;
  }
  if (!providedSig) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Constant-time compare
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(providedSig, 'hex')); }
  catch { return false; }
}

function extractDealCode(payload) {
  // Prefer explicit customData; fall back to parsing the template name
  if (payload.customData?.dealCode) return payload.customData.dealCode;
  const templateName = payload.templateName || payload.documentName || '';
  const m = templateName.match(/CMF-\d{3,}/i);
  return m ? m[0].toUpperCase() : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Validate signature against the raw body
  const rawBody = event.body || '';
  const providedSig = event.headers['x-ghl-signature'] || event.headers['x-webhook-signature'] || '';
  if (!validateSignature(rawBody, providedSig)) {
    return json(401, { ok: false, error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const email = payload.contactEmail || payload.email;
  const dealCode = extractDealCode(payload);
  if (!email || !dealCode) {
    return json(400, { ok: false, error: 'Missing email or dealCode' });
  }

  try {
    // 1. Resolve contact
    let contactId = payload.contactId;
    if (!contactId) {
      const contact = await findContactByEmail(email);
      contactId = contact?.id;
    }
    if (!contactId) return json(404, { ok: false, error: 'Contact not found in GHL' });

    // 2. Find the buyer's opportunity for this deal
    const pipelineId = process.env.GHL_COMMERCIAL_PIPELINE_ID;
    const opp = await findOpportunityByContactAndDealCode({ contactId, pipelineId, dealCode });
    if (!opp?.id) return json(404, { ok: false, error: 'Opportunity not found' });

    // 3. Advance to "NDA Signed"
    await advanceOpportunityStage({
      opportunityId: opp.id,
      pipelineId,
      stageName: 'NDA Signed',
    });

    // 4. Trigger data room delivery (in-process invoke of the sibling function)
    const baseUrl = process.env.URL || `https://${event.headers.host}`;
    const deliverRes = await fetch(`${baseUrl}/.netlify/functions/deliver-data-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_INVOKE_SECRET || '',
      },
      body: JSON.stringify({
        contactId,
        contactName: payload.contactName || '',
        contactEmail: email,
        dealCode,
      }),
    });
    const deliverJson = await deliverRes.json().catch(() => ({}));

    return json(200, {
      ok: true,
      contactId,
      opportunityId: opp.id,
      delivered: deliverJson.ok === true,
      test: isTest(),
    });
  } catch (e) {
    console.error('nda-signed-webhook error', e);
    return json(500, { ok: false, error: e.message });
  }
};
