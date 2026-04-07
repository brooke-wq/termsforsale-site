/**
 * Dispo Buddy — Partner Deal Detail
 * GET /.netlify/functions/partner-deal-detail?contactId=xxx&dealId=yyy
 *
 * Returns full deal data for a single opportunity, including:
 * - Property snapshot from contact custom fields
 * - Stage info
 * - Action needed (from opportunity custom field)
 * - Photos and docs links
 * - Projected fee based on partner tier
 *
 * Required env vars: GHL_API_KEY, GHL_LOCATION_ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const JV_PIPELINE_ID = 'XbZojO2rHmYtYa8C0yUP';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const contactId = event.queryStringParameters?.contactId;
  const dealId    = event.queryStringParameters?.dealId;
  if (!contactId || !dealId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'contactId and dealId required' }) };
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Fetch the opportunity
    const oppRes = await fetch(`${GHL_BASE}/opportunities/${dealId}`, { headers: ghlHeaders });
    const oppData = await oppRes.json();
    if (!oppRes.ok) {
      console.error('Opportunity fetch failed:', oppRes.status, JSON.stringify(oppData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not load deal' }) };
    }
    const opp = oppData.opportunity || oppData;

    // Authorization: ensure this opportunity belongs to the requesting contact
    if (opp.contactId !== contactId && opp.contact?.id !== contactId) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not authorized to view this deal' }) };
    }

    // Fetch the contact to get custom fields
    const contactRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders });
    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;
    const cfArray = contact.customFields || [];
    const cf = {};
    cfArray.forEach(f => {
      if (f.id) cf[f.id] = f.value;
      if (f.fieldKey) cf[f.fieldKey] = f.value;
      if (f.key) cf[f.key] = f.value;
      if (f.name) cf[f.name] = f.value;
    });

    // Fetch pipeline stage info to get stage name from id
    let stageName = '';
    try {
      const pipelineRes = await fetch(
        `${GHL_BASE}/opportunities/pipelines/${JV_PIPELINE_ID}?locationId=${locationId}`,
        { headers: ghlHeaders }
      );
      if (pipelineRes.ok) {
        const pipelineData = await pipelineRes.json();
        const stages = pipelineData.pipeline?.stages || pipelineData.stages || [];
        const found = stages.find(s => s.id === opp.pipelineStageId);
        if (found) stageName = found.name;
      }
    } catch (err) {
      console.warn('Pipeline fetch failed (non-fatal):', err.message);
    }

    // Determine partner tier
    const tags = contact.tags || [];
    const isProven = tags.indexOf('db-proven-partner') !== -1;
    const split = isProven ? 0.7 : 0.5;

    // Calculate days since submit
    const created = opp.createdAt || opp.dateAdded;
    const daysSinceSubmit = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86400000) : 0;

    // Build address from contact fields
    const address = cf.property_address || '';

    // Action needed (from opportunity custom field)
    const actionNeeded = cf.missing_info || cf.what_we_need || '';

    // Buyer interest metrics (from custom fields or defaults)
    // These fields can be populated by the team or by an automation that
    // tallies deal page views / inquiries from Terms For Sale tracking.
    const metrics = {
      views: parseInt(cf.buyer_views || cf.deal_views || 0, 10) || 0,
      inquiries: parseInt(cf.buyer_inquiries || 0, 10) || 0,
      showings: parseInt(cf.buyer_showings || 0, 10) || 0,
      offers: parseInt(cf.buyer_offers || 0, 10) || 0,
    };
    // Only show metrics if deal is in marketing or later stages
    const marketingStages = ['Actively Marketing', 'Assignment Sent', 'Assigned with EMD', 'Closed'];
    const showMetrics = marketingStages.indexOf(stageName) !== -1;

    // Projected fee = monetary value × split
    const monetary = parseFloat(opp.monetaryValue) || 0;
    const projectedFee = monetary * split;

    const deal = {
      id: opp.id,
      name: opp.name,
      address: address,
      location: opp.name ? opp.name.split(' — ').slice(1).join(' — ') : '',
      dealType: cf.deal_type || '',
      stage: stageName,
      status: opp.status,
      monetaryValue: monetary,
      contractedPrice: parseFloat(cf.contracted_price) || null,
      askingPrice: parseFloat(cf.desired_asking_price) || null,
      arv: parseFloat(cf.arv_estimate) || null,
      entryFee: parseFloat(cf.what_is_the_buyer_entry_fee) || null,
      occupancy: cf.property_occupancy || '',
      photoLink: cf.link_to_photos || '',
      docsLink: cf.link_to_supporting_documents || '',
      actionNeeded: stageName === 'Missing Information' ? actionNeeded : '',
      projectedFee: projectedFee,
      split: split,
      daysSinceSubmit: daysSinceSubmit,
      metrics: showMetrics ? metrics : null,
      createdAt: created,
      updatedAt: opp.updatedAt || opp.lastUpdated,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, deal }),
    };
  } catch (err) {
    console.error('Partner deal detail error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
