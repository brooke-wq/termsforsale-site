// Processes NDA requests from /commercial-deal.html?code=CMF-XXX
// - Upserts GHL contact (tagged buyer-commercial + nda-requested)
// - Creates/updates opportunity at "NDA Requested" stage
// - Sends confirmation email + SMS to Brooke
const { upsertContact, createOpportunity, sendSmsToBrooke, sendEmailToContact, isTest, getStageIdByName } = require('./_ghl');
const { createAndSendNda } = require('./_pandadoc');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let d;
  try { d = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const required = ['name','email','phone','entity_name','role','deal_code'];
  for (const k of required) if (!d[k]) return json(400, { ok: false, error: `Missing: ${k}` });
  if (!d.nda_ack) return json(400, { ok: false, error: 'NDA acknowledgement required' });

  try {
    const contactId = await upsertContact({
      email: d.email,
      phone: d.phone,
      name: d.name,
      tags: ['buyer-commercial', 'nda-requested', `deal-${d.deal_code.toLowerCase()}`],
      customFields: {
        entity_name: d.entity_name,
        role: d.role,
        last_deal_code: d.deal_code,
      },
      source: `NDA Request ${d.deal_code}`,
    });

    const pipelineId = process.env.GHL_COMMERCIAL_PIPELINE_ID;
    const stageId = await getStageIdByName(pipelineId, 'NDA Requested');
    const oppId = await createOpportunity({
      contactId,
      pipelineId,
      stageId,
      name: `${d.deal_code} — ${d.entity_name || d.name}`,
      customFields: {
        deal_code: d.deal_code,
        deal_type: d.asset_type || '',
        price_range: d.price_range || '',
      },
    });

    // Send the NDA via PandaDoc (non-blocking on failure — we still create the opp)
    let pandaDocId = null;
    try {
      const doc = await createAndSendNda({
        buyer: { name: d.name, email: d.email },
        dealCode: d.deal_code,
        ghlContactId: contactId,
      });
      pandaDocId = doc.id;
    } catch (pdErr) {
      console.error('PandaDoc send failed (opp still created):', pdErr.message);
    }

    await sendSmsToBrooke(`New NDA request from ${d.name} (${d.entity_name}) for ${d.deal_code}${pandaDocId ? ' (PandaDoc sent)' : ' (PandaDoc FAILED — check logs)'}`);

    return json(200, { ok: true, contactId, oppId, pandaDocId, test: isTest() });
  } catch (e) {
    console.error('commercial-nda-request error', e);
    return json(500, { ok: false, error: e.message });
  }
};
