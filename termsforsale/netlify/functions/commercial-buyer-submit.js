// Processes the commercial/multifamily buyer profile form.
// - Upserts GHL contact with "buyer-commercial" tag
// - A/B/C scoring
// - Creates opportunity at "Profile Completed"
// - Sends welcome email + SMS to Brooke
const { upsertContact, createOpportunity, sendSmsToBrooke, sendEmailToContact, isTest, getStageIdByName } = require('./_ghl');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function scoreTier(d) {
  const min = Number(d.typical_deal_size_min || 0);
  const speed = Number(d.decision_speed_days || 999);
  const hasProof = !!(d.proof_type && d.proof_type.trim());
  if (min >= 5_000_000 && speed <= 7 && hasProof) return 'A';
  if (min >= 3_000_000 && speed <= 14) return 'B';
  return 'C';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let d;
  try { d = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const required = ['name','email','phone','role','typical_deal_size_min','typical_deal_size_max','strategy','capital_source','decision_speed_days'];
  for (const k of required) if (!d[k]) return json(400, { ok: false, error: `Missing: ${k}` });

  const tier = scoreTier(d);
  const markets = Array.isArray(d.preferred_markets) ? d.preferred_markets : (d.preferred_markets ? [d.preferred_markets] : []);

  try {
    const contactId = await upsertContact({
      email: d.email,
      phone: d.phone,
      name: d.name,
      tags: ['buyer-commercial', `tier-${tier.toLowerCase()}`, ...markets.map(m => `market-${m.toLowerCase()}`)],
      customFields: {
        entity_name: d.entity_name,
        role: d.role,
        website: d.website,
        linkedin: d.linkedin,
        typical_deal_size_min: d.typical_deal_size_min,
        typical_deal_size_max: d.typical_deal_size_max,
        preferred_markets: markets,
        strategy: d.strategy,
        capital_source: d.capital_source,
        proof_type: d.proof_type,
        decision_speed_days: d.decision_speed_days,
        buyer_tier: tier,
        notes: d.notes,
      },
      source: 'Commercial Buyer Profile',
    });

    const pipelineId = process.env.GHL_COMMERCIAL_PIPELINE_ID;
    const stageId = await getStageIdByName(pipelineId, 'Profile Completed');
    const oppId = await createOpportunity({
      contactId,
      pipelineId,
      stageId,
      name: `${d.name} — ${d.entity_name || 'Buyer Profile'} (Tier ${tier})`,
      monetaryValue: Number(d.typical_deal_size_min) || 0,
      customFields: { buyer_tier: tier },
    });

    await sendEmailToContact({
      contactId,
      subject: 'Welcome to Deal Pros — Commercial Buyer Network',
      html: `
        <p>Hi ${d.name.split(' ')[0]},</p>
        <p>Thanks for completing your commercial buyer profile. You're in.</p>
        <p><b>What happens next:</b></p>
        <ul>
          <li>We match your buy box against active and incoming deals.</li>
          <li>You'll receive blind teasers as soon as something fits.</li>
          <li>Click through, sign an NDA, and get the full package.</li>
        </ul>
        <p>Questions? Just reply to this email.</p>
        <p>— Brooke<br/>Deal Pros</p>
      `,
    });

    await sendSmsToBrooke(`🏢 New commercial buyer profile (Tier ${tier}): ${d.name} — ${d.entity_name || 'no entity'} — $${Number(d.typical_deal_size_min).toLocaleString()}+`);

    return json(200, { ok: true, tier, contactId, oppId, test: isTest() });
  } catch (e) {
    console.error('commercial-buyer-submit error', e);
    return json(500, { ok: false, error: e.message });
  }
};
