// Self-serve reissue: when a buyer hits an expired data room link, the page
// calls this endpoint with their (expired but signature-valid) token. We
// verify they have a SIGNED NDA on file for this deal, then mint a new token
// and email it.
//
// Why this is safe:
//   - Token signature must verify (proves the original was issued by us)
//   - We re-check that the contact's GHL opportunity is at "NDA Signed" or
//     beyond — if NDA was revoked or never signed, no reissue.
//   - All reissues logged in Notion NDA Access Log.

const { verify } = require('./_token');
const { findOpportunityByContactAndDealCode, isTest } = require('./_ghl');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const NDA_SIGNED_OR_BEYOND = ['NDA Signed', 'Package Delivered', 'LOI Submitted', 'Under Contract', 'Closed Won'];

async function getStageNameForOpp(opp, pipelineId) {
  if (isTest()) return 'NDA Signed';
  // Fetch the pipeline to map stage ID → name
  const res = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${process.env.GHL_LOCATION_ID}`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  });
  const j = await res.json();
  const pipeline = (j.pipelines || []).find(p => p.id === pipelineId);
  const stage = pipeline?.stages?.find(s => s.id === opp.pipelineStageId);
  return stage?.name || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const { token } = body;
  if (!token) return json(400, { ok: false, error: 'Missing token' });

  const result = verify(token);
  // Reissue rule: signature MUST be valid; expiry can be expired (that's the whole point)
  if (!result.data || (result.reason && result.reason !== 'expired')) {
    return json(403, { ok: false, error: 'Invalid token' });
  }

  const { dc: dealCode, ci: contactId } = result.data;
  if (!dealCode || !contactId) return json(400, { ok: false, error: 'Token missing fields' });

  try {
    // Verify NDA is still signed for this contact + deal
    const pipelineId = process.env.GHL_COMMERCIAL_PIPELINE_ID;
    const opp = await findOpportunityByContactAndDealCode({ contactId, pipelineId, dealCode });
    if (!opp?.id) return json(404, { ok: false, error: 'No opportunity on file for this deal' });

    const stageName = await getStageNameForOpp(opp, pipelineId);
    if (!NDA_SIGNED_OR_BEYOND.includes(stageName)) {
      return json(403, { ok: false, error: 'NDA not on file — please complete the NDA process again' });
    }

    // We need the contact's email to call deliver-data-room. Pull from opp or contact.
    // Easiest: invoke deliver-data-room with contactId only — let it lookup email there.
    // But deliver-data-room currently requires contactEmail. Quick path: fetch contact.
    const contactRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    const contactJson = await contactRes.json();
    const email = contactJson?.contact?.email;
    const name = `${contactJson?.contact?.firstName || ''} ${contactJson?.contact?.lastName || ''}`.trim();
    if (!email) return json(404, { ok: false, error: 'Contact email not found' });

    // Invoke deliver-data-room
    const baseUrl = process.env.URL || `https://${event.headers.host}`;
    const deliverRes = await fetch(`${baseUrl}/.netlify/functions/deliver-data-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_INVOKE_SECRET || '',
      },
      body: JSON.stringify({ contactId, contactEmail: email, contactName: name, dealCode }),
    });
    const deliverJson = await deliverRes.json().catch(() => ({}));
    if (!deliverJson.ok) return json(500, { ok: false, error: deliverJson.error || 'Reissue failed' });

    return json(200, { ok: true, message: 'New link sent to your email' });
  } catch (e) {
    console.error('reissue-data-room-link error', e);
    return json(500, { ok: false, error: e.message });
  }
};
