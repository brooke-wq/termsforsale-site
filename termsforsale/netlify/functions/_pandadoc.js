// PandaDoc API helper — creates + sends a document from a template.
// Docs: https://developers.pandadoc.com/reference/new-document
//
// Env vars:
//   PANDADOC_API_KEY         — API key from PandaDoc Settings → Integrations → API
//   PANDADOC_NDA_TEMPLATE_ID — the NDA template UUID from the template URL
//
// TEST_MODE short-circuits all API calls and logs instead.

const { isTest } = require('./_ghl');

const PD_BASE = 'https://api.pandadoc.com/public/v1';

function authHeaders() {
  return {
    'Authorization': `API-Key ${process.env.PANDADOC_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Create a document from the NDA template, prefilled with buyer info + deal metadata.
// Returns { id, status }.
async function createNdaDocument({ buyer, dealCode, ghlContactId }) {
  if (isTest()) {
    console.log('[TEST_MODE] PandaDoc createNdaDocument', { buyer: buyer.email, dealCode, ghlContactId });
    return { id: 'test-pandadoc-doc-id', status: 'document.draft' };
  }

  const templateId = process.env.PANDADOC_NDA_TEMPLATE_ID;
  const payload = {
    name: `NDA — ${dealCode} — ${buyer.name}`,
    template_uuid: templateId,
    recipients: [{
      email: buyer.email,
      first_name: (buyer.name || '').split(' ')[0] || 'Buyer',
      last_name: (buyer.name || '').split(' ').slice(1).join(' ') || '',
      role: 'Client', // must match the recipient role name in your PandaDoc template
      signing_order: 1,
    }],
    // Metadata travels back in the webhook so we can resolve the deal + contact
    metadata: {
      dealCode,
      contactId: ghlContactId || '',
    },
    // Prefill merge fields (these names must exist in the template as tokens)
    tokens: [
      { name: 'Client.FirstName', value: (buyer.name || '').split(' ')[0] || '' },
      { name: 'Client.LastName', value: (buyer.name || '').split(' ').slice(1).join(' ') || '' },
      { name: 'Client.Email', value: buyer.email },
      { name: 'Deal.Code', value: dealCode },
    ],
    tags: ['commercial-nda', `deal-${dealCode.toLowerCase()}`],
  };

  const res = await fetch(`${PD_BASE}/documents`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PandaDoc create failed: ${res.status} ${JSON.stringify(data)}`);
  return { id: data.id, status: data.status };
}

// Send a draft document to the recipient for signing.
async function sendDocument({ documentId, subject, message }) {
  if (isTest()) {
    console.log('[TEST_MODE] PandaDoc sendDocument', { documentId, subject });
    return { ok: true, test: true };
  }
  // PandaDoc documents start in `document.uploaded` status and need time to process
  // before being sent. We poll briefly for `document.draft` status.
  for (let i = 0; i < 6; i++) {
    const statusRes = await fetch(`${PD_BASE}/documents/${documentId}`, { headers: authHeaders() });
    const statusData = await statusRes.json();
    if (statusData.status === 'document.draft') break;
    if (i === 5) throw new Error(`PandaDoc doc ${documentId} not ready after polling; status=${statusData.status}`);
    await new Promise(r => setTimeout(r, 1500));
  }
  const res = await fetch(`${PD_BASE}/documents/${documentId}/send`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      subject: subject || 'Please sign the NDA',
      message: message || 'Please review and sign the NDA to receive the full data room.',
      silent: false,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PandaDoc send failed: ${res.status} ${JSON.stringify(data)}`);
  return { ok: true, status: data.status };
}

// Convenience: create + send in one call.
async function createAndSendNda({ buyer, dealCode, ghlContactId }) {
  const doc = await createNdaDocument({ buyer, dealCode, ghlContactId });
  await sendDocument({
    documentId: doc.id,
    subject: `NDA for ${dealCode} — Please sign to access the data room`,
    message: `Hi ${(buyer.name || '').split(' ')[0] || 'there'},\n\nPlease review and sign the NDA for ${dealCode}. Once signed, you'll receive the full data room link automatically.\n\n— Brooke, Deal Pros`,
  });
  return doc;
}

module.exports = { createNdaDocument, sendDocument, createAndSendNda };
