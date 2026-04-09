// Receives "Document Signed/Completed" webhook from either PandaDoc or GHL,
// advances the buyer's opportunity from "NDA Requested" → "NDA Signed",
// and triggers data room delivery.
//
// === PandaDoc setup (preferred) ===
// PandaDoc → Settings → Integrations → Webhooks → Create Webhook
//   URL: https://termsforsale.com/.netlify/functions/nda-signed-webhook
//   Events: document_state_changed
//   Shared key: set it to GHL_WEBHOOK_SECRET (we validate via x-pandadoc-signature header)
// When creating an NDA send, tag the document with metadata:
//   { "dealCode": "CMF-001", "contactId": "<ghl_contact_id>" }
//
// === GHL fallback setup ===
// GHL Workflow → Document Signed → Custom Webhook
//   URL: same as above
//   Custom header x-ghl-signature = HMAC-SHA256(GHL_WEBHOOK_SECRET, rawBody)
//   Body must include contactEmail, contactId, dealCode

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

function validateSignature(rawBody, providedSig, source) {
  // PandaDoc uses its own shared key; GHL uses ours.
  const secret = source === 'pandadoc'
    ? process.env.PANDADOC_SHARED_KEY
    : process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(`${source} shared key not set — signature validation skipped (NOT for production)`);
    return true;
  }
  if (!providedSig) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(providedSig, 'hex')); }
  catch { return false; }
}

function extractDealCode(payload) {
  // PandaDoc: metadata lives at payload.data.metadata
  if (payload.data?.metadata?.dealCode) return payload.data.metadata.dealCode;
  // PandaDoc: parse from document name
  const pdName = payload.data?.name || '';
  // GHL: explicit customData
  if (payload.customData?.dealCode) return payload.customData.dealCode;
  // GHL: from template name
  const ghlName = payload.templateName || payload.documentName || '';
  const m = (pdName + ' ' + ghlName).match(/CMF-\d{3,}/i);
  return m ? m[0].toUpperCase() : null;
}

// PandaDoc webhooks arrive as an array of events; GHL as a single object.
// Normalize both into a single flat payload our handler can read.
function normalizePayload(body) {
  // PandaDoc sends an array like [{ event, data: {...} }]
  if (Array.isArray(body)) {
    const signedEvent = body.find(e =>
      e.event === 'document_state_changed' &&
      (e.data?.status === 'document.completed' || e.data?.status === 'document.signed')
    );
    if (!signedEvent) return null;
    const d = signedEvent.data || {};
    const signer = (d.recipients || []).find(r => r.has_completed) || (d.recipients || [])[0] || {};
    return {
      source: 'pandadoc',
      data: d,
      email: signer.email,
      contactName: [signer.first_name, signer.last_name].filter(Boolean).join(' '),
      contactId: d.metadata?.contactId || null,
    };
  }
  // GHL: single object
  return {
    source: 'ghl',
    email: body.contactEmail || body.email,
    contactId: body.contactId || null,
    contactName: body.contactName || '',
    customData: body.customData,
    templateName: body.templateName,
    documentName: body.documentName,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Validate signature. PandaDoc sends ?signature=XXX as a query param (HMAC-SHA256
  // of the raw body using the shared key). GHL sends x-ghl-signature as a header.
  const rawBody = event.body || '';
  const pdSig = event.queryStringParameters?.signature;
  const ghlSig = event.headers['x-ghl-signature'] || event.headers['x-webhook-signature'];
  const providedSig = pdSig || ghlSig || '';
  const sigSource = pdSig ? 'pandadoc' : 'ghl';
  console.log('NDA webhook hit', { source: sigSource, hasSig: !!providedSig, bodyLen: rawBody.length });
  if (!validateSignature(rawBody, providedSig, sigSource)) {
    console.warn('NDA webhook signature invalid', { source: sigSource });
    return json(401, { ok: false, error: 'Invalid signature' });
  }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const payload = normalizePayload(body);
  if (!payload) return json(200, { ok: true, ignored: 'not a signed event' });

  const email = payload.email;
  const dealCode = extractDealCode(body);
  if (!email || !dealCode) {
    return json(400, { ok: false, error: 'Missing email or dealCode', source: payload.source });
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
