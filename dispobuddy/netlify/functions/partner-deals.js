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

// Stage display config — use actual GHL stage names as keys, mapped to colors
// The dashboard uses the raw stage name (e.g. "Actively Marketing") to look up
// progress step + colors, so we return the real stage name from the pipeline API.
const STAGE_COLORS = {
  'New JV Lead':         '#718096',
  'Missing Information': '#ef4444',
  'Under Review':        '#8b5cf6',
  'Ready to Market':     '#29ABE2',
  'Actively Marketing':  '#F7941D',
  'Assignment Sent':     '#a855f7',
  'Assigned with EMD':   '#a855f7',
  'Closed':              '#22c55e',
  'Not Accepted':        '#94a3b8',
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
    // Fetch pipeline stages → build map of stageId → { name, color }
    let stageLabels = {};
    try {
      const pipelineRes = await fetch(
        `${GHL_BASE}/opportunities/pipelines/${JV_PIPELINE_ID}?locationId=${locationId}`,
        { headers: ghlHeaders }
      );
      if (pipelineRes.ok) {
        const pipelineData = await pipelineRes.json();
        const stages = pipelineData.pipeline?.stages || pipelineData.stages || [];
        for (const stage of stages) {
          stageLabels[stage.id] = {
            label: stage.name,
            color: STAGE_COLORS[stage.name] || '#718096',
            icon: 'circle',
          };
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

      // Try to find a partner status note in opportunity custom fields
      let partnerNote = '';
      if (opp.customFields && Array.isArray(opp.customFields)) {
        for (const f of opp.customFields) {
          const k = (f.fieldKey || f.key || f.name || '').toLowerCase();
          if (k === 'partner_status_note' || k === 'next_step' || k === 'partner_note') {
            partnerNote = f.fieldValue || f.value || '';
            break;
          }
        }
      }

      return {
        id: opp.id,
        name: opp.name,
        dealType,
        location,
        status: opp.status, // open, won, lost, abandoned
        stage: stageInfo.label,            // raw stage name (e.g. "Actively Marketing")
        stageLabel: stageInfo.label,       // alias kept for compatibility
        stageColor: stageInfo.color,
        stageIcon: stageInfo.icon,
        monetaryValue: opp.monetaryValue || 0,
        partnerNote: partnerNote,
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
