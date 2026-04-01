// Netlify function: weekly-synthesis
// Scheduled: 0 15 * * 1 (Monday 8am Arizona = 15:00 UTC)
// Pulls Notion deals changed in last 7 days, summarizes wins/issues via Claude,
// posts to GHL CEO Briefing contact, SMS to Brooke.
//
// ENV VARS: ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_DB_ID,
//           GHL_API_KEY, GHL_LOCATION_ID, BROOKE_PHONE

const { complete } = require('./_claude');
const { postNote, sendSMS, searchContacts } = require('./_ghl');

exports.config = { schedule: '0 15 * * 1' };

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
    default:            return '';
  }
}

// Get all deals edited in the last N days
async function getRecentDeals(token, dbId, days) {
  var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  var all = [];
  var cursor;

  do {
    var body = {
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { after: since }
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100
    };
    if (cursor) body.start_cursor = cursor;

    var result = await notionQuery(token, dbId, body);
    if (result.status !== 200) {
      console.error('weekly-synthesis: Notion error', result.status, JSON.stringify(result.body));
      break;
    }
    all = all.concat(result.body.results || []);
    cursor = result.body.has_more ? result.body.next_cursor : null;
  } while (cursor);

  return all;
}

// Also get full pipeline snapshot (all deals)
async function getAllDeals(token, dbId) {
  var all = [];
  var cursor;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var result = await notionQuery(token, dbId, body);
    if (result.status !== 200) break;
    all = all.concat(result.body.results || []);
    cursor = result.body.has_more ? result.body.next_cursor : null;
  } while (cursor);
  return all;
}

// ─── Main handler ─────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = { 'Content-Type': 'application/json' };

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var notionToken  = process.env.NOTION_TOKEN;
  var notionDbId   = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var ghlApiKey    = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID || '7IyUgu1zpi38MDYpSDTs';
  var brookePhone  = process.env.BROOKE_PHONE || '+15167120113';

  if (!anthropicKey || !notionToken || !ghlApiKey) {
    console.error('weekly-synthesis: missing env vars', {
      anthropic: !!anthropicKey, notion: !!notionToken, ghl: !!ghlApiKey
    });
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    console.log('weekly-synthesis: fetching deals...');
    var [recentDeals, allDeals] = await Promise.all([
      getRecentDeals(notionToken, notionDbId, 7),
      getAllDeals(notionToken, notionDbId)
    ]);

    console.log('weekly-synthesis: ' + recentDeals.length + ' recent, ' + allDeals.length + ' total');

    // Count full pipeline by status
    var pipelineByStatus = {};
    allDeals.forEach(function(page) {
      var status = prop(page, 'Deal Status') || 'Unknown';
      pipelineByStatus[status] = (pipelineByStatus[status] || 0) + 1;
    });

    // Analyze recently changed deals
    var changedDeals = recentDeals.map(function(page) {
      return {
        address: prop(page, 'Street Address') || 'Unknown',
        city:    prop(page, 'City'),
        state:   prop(page, 'State'),
        status:  prop(page, 'Deal Status') || 'Unknown',
        type:    prop(page, 'Deal Type'),
        price:   prop(page, 'Asking Price'),
        amountFunded: prop(page, 'Amount Funded'),
        dateFunded:   prop(page, 'Date Funded'),
        lastEdited: page.last_edited_time ? page.last_edited_time.slice(0, 10) : ''
      };
    });

    // Group changed deals by status
    var changedByStatus = {};
    changedDeals.forEach(function(d) {
      if (!changedByStatus[d.status]) changedByStatus[d.status] = [];
      changedByStatus[d.status].push(d.address + (d.city ? ', ' + d.city : '') + ', ' + d.state);
    });

    // Identify wins: deals with Date Funded in the last 7 days
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    var wins = allDeals.filter(function(page) {
      var dateFunded = prop(page, 'Date Funded');
      return dateFunded && dateFunded >= sevenDaysAgo;
    }).map(function(page) {
      var addr = prop(page, 'Street Address') || 'Unknown';
      var city = prop(page, 'City');
      var amount = prop(page, 'Amount Funded');
      var dateFunded = prop(page, 'Date Funded');
      return addr + (city ? ', ' + city : '') +
        (amount ? ' — $' + (+amount).toLocaleString() : '') +
        (dateFunded ? ' (funded ' + dateFunded + ')' : '');
    });

    // Build pipeline summary string
    var pipelineSummary = Object.keys(pipelineByStatus).map(function(s) {
      return s + ': ' + pipelineByStatus[s];
    }).join(' | ');

    // Build changed deals summary
    var changedSummary = Object.keys(changedByStatus).map(function(s) {
      return s + ' (' + changedByStatus[s].length + '): ' + changedByStatus[s].slice(0, 3).join('; ') +
        (changedByStatus[s].length > 3 ? ' +' + (changedByStatus[s].length - 3) + ' more' : '');
    }).join('\n');

    var weekRange = (function() {
      var end = new Date();
      var start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      var fmt = function(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Phoenix' }); };
      return fmt(start) + ' – ' + fmt(end);
    })();

    // Generate weekly report with Claude
    var systemPrompt = 'You are the operations analyst for Deal Pros LLC. Write concise weekly performance summaries for the CEO. Be direct, data-first, and actionable. No filler.';

    var userPrompt = `Generate a weekly synthesis report for ${weekRange}:

FULL PIPELINE:
${pipelineSummary}

ACTIVITY THIS WEEK (${recentDeals.length} deals updated):
${changedSummary || 'No deal activity this week.'}

WINS THIS WEEK:
${wins.length ? wins.join('\n') : 'None recorded.'}

Format the report as:
📅 WEEKLY SYNTHESIS — ${weekRange}

📈 PIPELINE HEALTH
[Total deals by status, 1 line each]

🏆 WINS THIS WEEK
[What closed, went under contract, or moved forward]

⚙️ DEAL ACTIVITY
[What changed and why it matters]

🚨 ISSUES / STALLED DEALS
[Anything that didn't move, concerns, red flags]

🎯 PRIORITIES FOR NEXT WEEK
[Top 2-3 actions Brooke should take]`;

    console.log('weekly-synthesis: calling Claude...');
    var claudeRes = await complete(anthropicKey, {
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 700
    });
    var report = claudeRes.text;

    console.log('weekly-synthesis: report generated (' + report.length + ' chars)');

    // Find CEO Briefing contact in GHL
    var contactId = null;
    var searchRes = await searchContacts(ghlApiKey, locationId, 'CEO Briefing', 5);
    var contacts = (searchRes.body && searchRes.body.contacts) || [];
    if (contacts.length) {
      contactId = contacts[0].id;
      console.log('weekly-synthesis: found CEO Briefing contact ' + contactId);
    } else {
      console.warn('weekly-synthesis: CEO Briefing contact not found in GHL — skipping note');
    }

    // Post to GHL
    var noteResult = null;
    if (contactId) {
      noteResult = await postNote(ghlApiKey, contactId, report);
      console.log('weekly-synthesis: note posted, status=' + noteResult.status);
    }

    // SMS to Brooke (abbreviated)
    var activeLine = pipelineByStatus['Actively Marketing']
      ? pipelineByStatus['Actively Marketing'] + ' active'
      : '';
    var closedLine = (pipelineByStatus['Closed'] || 0) + (pipelineByStatus['Sold'] || 0);
    var sms = '📅 Weekly Report ' + weekRange + ': ' +
      [activeLine, closedLine ? closedLine + ' closed' : ''].filter(Boolean).join(', ') +
      (wins.length ? ' | Wins: ' + wins.slice(0, 2).join(', ') : '');
    if (sms.length > 155) sms = sms.slice(0, 152) + '...';

    var smsResult = await sendSMS(ghlApiKey, locationId, brookePhone, sms);
    console.log('weekly-synthesis: SMS sent, status=' + smsResult.status);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        success: true,
        weekRange: weekRange,
        recentDealsCount: recentDeals.length,
        totalDeals: allDeals.length,
        pipelineSummary: pipelineSummary,
        wins: wins.length,
        notePosted: !!(noteResult && noteResult.status < 300),
        smsSent: smsResult.status < 300,
        report: report
      })
    };

  } catch (err) {
    console.error('weekly-synthesis error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
