/**
 * Dispo Buddy — Partner Deals
 * GET /.netlify/functions/partner-deals?contactId=xxx
 *
 * Fetches all opportunities for a given contact from the JV Deals pipeline.
 * Returns deal status mapped from pipeline stage names.
 *
 * Required Netlify Environment Variables:
 *   GHL_API_KEY      — GHL private integration API key
 *   GHL_LOCATION_ID  — GHL Location ID
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const JV_PIPELINE_ID = 'XbZojO2rHmYtYa8C0yUP';

// Map GHL stage IDs to human-readable statuses
const STAGE_MAP = {
  'cf2388f0-fdbf-4fb1-b633-86569034fcce': { label: 'Submitted', color: '#29ABE2', icon: 'inbox' },
  // Add more stage mappings as pipeline evolves:
  // 'stage-id': { label: 'Under Review', color: '#F7941D', icon: 'search' },
  // 'stage-id': { label: 'JV Agreement Sent', color: '#8B5CF6', icon: 'file' },
  // 'stage-id': { label: 'Marketing', color: '#29ABE2', icon: 'megaphone' },
  // 'stage-id': { label: 'Offer Received', color: '#F7941D', icon: 'dollar' },
  // 'stage-id': { label: 'Under Contract', color: '#22c55e', icon: 'check' },
  // 'stage-id': { label: 'Closed', color: '#22c55e', icon: 'trophy' },
  // 'stage-id': { label: 'Declined', color: '#ef4444', icon: 'x' },
};

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
  if (!contactId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'contactId required' }) };
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Fetch pipeline stages for label mapping
    let stageLabels = { ...STAGE_MAP };
    try {
      const pipelineRes = await fetch(
        `${GHL_BASE}/opportunities/pipelines/${JV_PIPELINE_ID}?locationId=${locationId}`,
        { headers: ghlHeaders }
      );
      if (pipelineRes.ok) {
        const pipelineData = await pipelineRes.json();
        const stages = pipelineData.pipeline?.stages || pipelineData.stages || [];
        for (const stage of stages) {
          if (!stageLabels[stage.id]) {
            stageLabels[stage.id] = { label: stage.name, color: '#718096', icon: 'circle' };
          }
        }
      }
    } catch (err) {
      console.warn('Pipeline fetch failed (non-fatal):', err.message);
    }

    // Search opportunities for this contact in the JV pipeline
    const searchRes = await fetch(
      `${GHL_BASE}/opportunities/search?location_id=${locationId}&pipeline_id=${JV_PIPELINE_ID}&contact_id=${contactId}&limit=50`,
      { headers: ghlHeaders }
    );
    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      console.error('Opportunity search failed:', JSON.stringify(searchData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to fetch deals' }) };
    }

    const opportunities = searchData.opportunities || [];

    // Transform to dashboard-friendly format
    const deals = opportunities.map(opp => {
      const stageInfo = stageLabels[opp.pipelineStageId] || { label: 'Processing', color: '#718096', icon: 'circle' };
      const name = opp.name || '';

      // Parse deal type and location from opportunity name
      // Format: "DealType — City State — LastName"
      const parts = name.split(' — ');
      const dealType = parts[0] || '';
      const location = parts[1] || '';

      return {
        id: opp.id,
        name: opp.name,
        dealType,
        location,
        status: opp.status, // open, won, lost, abandoned
        stage: stageInfo.label,
        stageColor: stageInfo.color,
        stageIcon: stageInfo.icon,
        monetaryValue: opp.monetaryValue || 0,
        createdAt: opp.createdAt || opp.dateAdded,
        updatedAt: opp.updatedAt || opp.lastUpdated,
      };
    });

    // Sort by creation date, newest first
    deals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deals,
        total: deals.length,
      }),
    };
  } catch (err) {
    console.error('Partner deals error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
