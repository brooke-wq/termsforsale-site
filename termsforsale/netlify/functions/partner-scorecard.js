// Netlify function: partner-scorecard
// Scheduled: 0 15 * * 5 (Friday 8am Arizona = 15:00 UTC)
// Generates partner performance scorecard from Notion deals + GHL bird dog contacts.
// Groups by Lead Source and JV Partner, calculates close rates, revenue, avg deal size.
// Uses Claude for analysis narrative.
//
// ENV VARS: ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_DB_ID,
//           GHL_API_KEY, GHL_LOCATION_ID

const { complete } = require('./_claude');
const { searchContacts } = require('./_ghl');

// Scheduled execution lives on the DigitalOcean Droplet (Fridays 15:00 UTC).
// This function still deploys so it can be invoked ad-hoc via HTTP.

// ─── Notion helpers ───────────────────────────────────────────

async function notionQuery(token, dbId, body) {
  var res = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  return { status: res.status, body: data };
}

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':       return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text':   return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'number':      return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select':      return p.select ? p.select.name : '';
    case 'status':      return p.status ? p.status.name : '';
    case 'multi_select': return (p.multi_select || []).map(function(s) { return s.name; }).join(', ');
    case 'checkbox':    return p.checkbox ? 'Yes' : 'No';
    case 'date':        return p.date ? p.date.start : '';
    case 'url':         return p.url || '';
    case 'formula':
      if (!p.formula) return '';
      if (p.formula.type === 'number') return p.formula.number !== null ? p.formula.number : '';
      if (p.formula.type === 'string') return p.formula.string || '';
      return '';
    default:            return '';
  }
}

async function getAllDeals(token, dbId) {
  var all = [];
  var cursor;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var result = await notionQuery(token, dbId, body);
    if (result.status !== 200) {
      console.error('partner-scorecard: Notion error', result.status, JSON.stringify(result.body));
      break;
    }
    all = all.concat(result.body.results || []);
    cursor = result.body.has_more ? result.body.next_cursor : null;
  } while (cursor);
  return all;
}

// ─── GHL bird dog helpers ─────────────────────────────────────

async function getBirdDogContacts(apiKey, locationId) {
  var approved = await searchContacts(apiKey, locationId, 'birddog-approved', 100);
  var reviewed = await searchContacts(apiKey, locationId, 'birddog-reviewed', 100);
  return {
    approved: (approved.body && approved.body.contacts) || [],
    reviewed: (reviewed.body && reviewed.body.contacts) || []
  };
}

// ─── Scorecard logic ──────────────────────────────────────────

function buildScorecard(deals) {
  var bySource = {};
  var byPartner = {};

  deals.forEach(function(page) {
    var source  = prop(page, 'Lead Source') || 'Unknown';
    var partner = prop(page, 'JV Partner') || '';
    var status  = prop(page, 'Deal Status') || '';
    var amount  = prop(page, 'Amount Funded');
    var daysToAssign = prop(page, 'Days to Assign');
    var isClosed = status === 'Closed';

    // Group by Lead Source
    if (!bySource[source]) {
      bySource[source] = { submitted: 0, closed: 0, revenue: 0, daysToAssign: [], amounts: [] };
    }
    bySource[source].submitted++;
    if (isClosed) {
      bySource[source].closed++;
      if (amount !== '' && !isNaN(+amount)) {
        bySource[source].revenue += +amount;
        bySource[source].amounts.push(+amount);
      }
    }
    if (daysToAssign !== '' && !isNaN(+daysToAssign)) {
      bySource[source].daysToAssign.push(+daysToAssign);
    }

    // Group by JV Partner (only if partner is set)
    if (partner) {
      if (!byPartner[partner]) {
        byPartner[partner] = { submitted: 0, closed: 0, revenue: 0, daysToAssign: [], amounts: [] };
      }
      byPartner[partner].submitted++;
      if (isClosed) {
        byPartner[partner].closed++;
        if (amount !== '' && !isNaN(+amount)) {
          byPartner[partner].revenue += +amount;
          byPartner[partner].amounts.push(+amount);
        }
      }
      if (daysToAssign !== '' && !isNaN(+daysToAssign)) {
        byPartner[partner].daysToAssign.push(+daysToAssign);
      }
    }
  });

  // Calculate derived metrics
  function finalize(map) {
    var result = {};
    Object.keys(map).forEach(function(key) {
      var d = map[key];
      var avgDeal = d.amounts.length ? Math.round(d.revenue / d.amounts.length) : 0;
      var avgDays = d.daysToAssign.length
        ? Math.round(d.daysToAssign.reduce(function(a, b) { return a + b; }, 0) / d.daysToAssign.length * 10) / 10
        : null;
      result[key] = {
        submitted: d.submitted,
        closed: d.closed,
        closeRate: d.submitted > 0 ? Math.round((d.closed / d.submitted) * 1000) / 10 : 0,
        totalRevenue: d.revenue,
        avgDealSize: avgDeal,
        avgDaysToAssign: avgDays
      };
    });
    return result;
  }

  return {
    bySource: finalize(bySource),
    byPartner: finalize(byPartner)
  };
}

// ─── Main handler ─────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var notionToken  = process.env.NOTION_TOKEN;
  var notionDbId   = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var ghlApiKey    = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID || '7IyUgu1zpi38MDYpSDTs';

  if (!anthropicKey || !notionToken || !ghlApiKey) {
    console.error('partner-scorecard: missing env vars', {
      anthropic: !!anthropicKey, notion: !!notionToken, ghl: !!ghlApiKey
    });
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // 1. Fetch all deals from Notion + bird dog contacts from GHL
    console.log('partner-scorecard: fetching data...');
    var [pages, birdDogs] = await Promise.all([
      getAllDeals(notionToken, notionDbId),
      getBirdDogContacts(ghlApiKey, locationId)
    ]);

    console.log('partner-scorecard: ' + pages.length + ' deals, ' +
      birdDogs.approved.length + ' approved bird dogs, ' +
      birdDogs.reviewed.length + ' reviewed bird dogs');

    // 2. Build scorecard
    var scorecard = buildScorecard(pages);

    // 3. Build summary for Claude
    var sourceLines = Object.keys(scorecard.bySource).sort(function(a, b) {
      return scorecard.bySource[b].totalRevenue - scorecard.bySource[a].totalRevenue;
    }).map(function(s) {
      var d = scorecard.bySource[s];
      return s + ': ' + d.submitted + ' submitted, ' + d.closed + ' closed (' + d.closeRate + '%), ' +
        '$' + d.totalRevenue.toLocaleString() + ' revenue, avg $' + d.avgDealSize.toLocaleString() +
        (d.avgDaysToAssign !== null ? ', avg ' + d.avgDaysToAssign + ' days to assign' : '');
    });

    var partnerLines = Object.keys(scorecard.byPartner).sort(function(a, b) {
      return scorecard.byPartner[b].totalRevenue - scorecard.byPartner[a].totalRevenue;
    }).map(function(s) {
      var d = scorecard.byPartner[s];
      return s + ': ' + d.submitted + ' submitted, ' + d.closed + ' closed (' + d.closeRate + '%), ' +
        '$' + d.totalRevenue.toLocaleString() + ' revenue, avg $' + d.avgDealSize.toLocaleString() +
        (d.avgDaysToAssign !== null ? ', avg ' + d.avgDaysToAssign + ' days to assign' : '');
    });

    var birdDogSummary = 'Approved bird dog students: ' + birdDogs.approved.length +
      ', Reviewed (pending): ' + birdDogs.reviewed.length;

    var systemPrompt = 'You are the operations analyst for Deal Pros LLC, a real estate wholesaling company. ' +
      'Analyze partner and lead source performance data. Be concise, data-driven, and actionable. ' +
      'Identify top performers, underperformers, trends, and specific recommendations.';

    var userPrompt = 'Generate a partner performance analysis based on this data:\n\n' +
      'LEAD SOURCES (sorted by revenue):\n' +
      (sourceLines.length ? sourceLines.join('\n') : 'No data') + '\n\n' +
      'JV PARTNERS (sorted by revenue):\n' +
      (partnerLines.length ? partnerLines.join('\n') : 'No JV partner data') + '\n\n' +
      'BIRD DOG PROGRAM:\n' + birdDogSummary + '\n\n' +
      'Total deals in pipeline: ' + pages.length + '\n\n' +
      'Provide:\n' +
      '1. TOP PERFORMERS — Which sources/partners are delivering the best results and why\n' +
      '2. UNDERPERFORMERS — Which need attention, coaching, or removal\n' +
      '3. TRENDS — Close rate patterns, revenue concentration risks\n' +
      '4. RECOMMENDATIONS — 3-5 specific actions to improve partner performance\n' +
      '5. BIRD DOG ASSESSMENT — Is the student pipeline healthy?';

    console.log('partner-scorecard: calling Claude...');
    var claudeRes = await complete(anthropicKey, {
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 800
    });

    console.log('partner-scorecard: analysis generated (' + claudeRes.text.length + ' chars)');

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        success: true,
        generatedAt: new Date().toISOString(),
        totalDeals: pages.length,
        bySource: scorecard.bySource,
        byPartner: scorecard.byPartner,
        birdDogProgram: {
          approved: birdDogs.approved.length,
          reviewed: birdDogs.reviewed.length
        },
        analysis: claudeRes.text,
        claudeUsage: claudeRes.usage
      })
    };

  } catch (err) {
    console.error('partner-scorecard error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
