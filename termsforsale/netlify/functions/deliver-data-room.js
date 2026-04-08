// Mints a tokenized data room link, emails it to the buyer, advances the
// opportunity to "Package Delivered", and logs the access in Notion.
//
// Called by:
//   - nda-signed-webhook.js (auto-triggered after NDA signing)
//   - reissue-data-room-link.js (self-serve when expired)
//
// All callers must include x-internal-secret header matching INTERNAL_INVOKE_SECRET env var.

const {
  findContactByEmail,
  findOpportunityByContactAndDealCode,
  advanceOpportunityStage,
  sendTokenizedDataRoomEmail,
  isTest,
} = require('./_ghl');
const { mintDataRoomToken } = require('./_token');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function logAccessToNotion({ email, contactId, dealCode, expiresAt }) {
  if (isTest()) {
    console.log('[TEST_MODE] NOTION NDA Access Log →', { email, contactId, dealCode, expiresAt });
    return;
  }
  const dbId = process.env.NOTION_NDA_LOG_DB_ID;
  if (!dbId) { console.warn('NOTION_NDA_LOG_DB_ID not set — skipping audit log'); return; }
  await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        'Email': { title: [{ text: { content: email } }] },
        'Contact ID': { rich_text: [{ text: { content: contactId || '' } }] },
        'Deal Code': { rich_text: [{ text: { content: dealCode } }] },
        'Token Issued At': { date: { start: new Date().toISOString() } },
        'Expires At': { date: { start: new Date(expiresAt).toISOString() } },
      },
    }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Internal-only invoke check
  const internalSecret = event.headers['x-internal-secret'] || '';
  if (process.env.INTERNAL_INVOKE_SECRET && internalSecret !== process.env.INTERNAL_INVOKE_SECRET) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const { contactEmail, contactName = '', dealCode } = body;
  let { contactId } = body;
  if (!contactEmail || !dealCode) return json(400, { ok: false, error: 'Missing contactEmail or dealCode' });

  try {
    // Resolve contactId if not provided
    if (!contactId) {
      const c = await findContactByEmail(contactEmail);
      contactId = c?.id;
    }
    if (!contactId) return json(404, { ok: false, error: 'Contact not found' });

    // Mint token (7-day expiry)
    const { token, expiresAt } = mintDataRoomToken({ dealCode, contactId });
    const baseUrl = process.env.URL || `https://${event.headers.host}`;
    const tokenizedUrl = `${baseUrl}/data-room.html?token=${encodeURIComponent(token)}`;

    // Send the email
    await sendTokenizedDataRoomEmail({
      contactId,
      contactName,
      dealCode,
      tokenizedUrl,
      expiresAt,
    });

    // Advance opportunity to "Package Delivered"
    const pipelineId = process.env.GHL_COMMERCIAL_PIPELINE_ID;
    const opp = await findOpportunityByContactAndDealCode({ contactId, pipelineId, dealCode });
    if (opp?.id) {
      await advanceOpportunityStage({
        opportunityId: opp.id,
        pipelineId,
        stageName: 'Package Delivered',
      });
    }

    // Audit log to Notion
    await logAccessToNotion({ email: contactEmail, contactId, dealCode, expiresAt });

    return json(200, { ok: true, expiresAt, test: isTest() });
  } catch (e) {
    console.error('deliver-data-room error', e);
    return json(500, { ok: false, error: e.message });
  }
};
