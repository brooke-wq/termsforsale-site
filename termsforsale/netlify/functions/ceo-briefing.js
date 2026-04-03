// Netlify function: ceo-briefing
// Scheduled: 0 14 * * * (7am Arizona = 14:00 UTC)
// Queries Notion for all deals, generates a CEO briefing via Claude,
// posts as GHL note on CEO Briefing contact, and SMS to Brooke.
//
// ENV VARS: ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_DB_ID,
//           GHL_API_KEY, GHL_LOCATION_ID, BROOKE_PHONE

const { complete } = require('./_claude');
const { postNote, sendSMS, searchContacts } = require('./_ghl');

// File-based dedup (Droplet only)
var sentLog;
try { sentLog = require('../../../jobs/sent-log'); } catch(e) { sentLog = null; }

exports.config = { schedule: '0 14 * * *' };

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
    console.error('ceo-briefing: missing env vars', {
      anthropic: !!anthropicKey, notion: !!notionToken, ghl: !!ghlApiKey
    });
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // 1. Pull all deals from Notion
    console.log('ceo-briefing: fetching deals from Notion...');
    var pages = await getAllDeals(notionToken, notionDbId);
    console.log('ceo-briefing: ' + pages.length + ' total deals');

    // 2. Group deals by status
    var byStatus = {};
    var actionItems = [];
    var now = Date.now();
    var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    pages.forEach(function(page) {
      var status  = prop(page, 'Deal Status') || 'Unknown';
      var address = prop(page, 'Street Address') || 'Unknown';
      var city    = prop(page, 'City');
      var state   = prop(page, 'State');
      var type    = prop(page, 'Deal Type');
      var price   = prop(page, 'Asking Price');
      var amountFunded = prop(page, 'Amount Funded');
      var dateFunded   = prop(page, 'Date Funded');
      var lastEdit = page.last_edited_time;
      var staleMs  = now - new Date(lastEdit).getTime();
      var fundedMs = dateFunded ? now - new Date(dateFunded).getTime() : Infinity;

      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push({
        address: address + (city ? ', ' + city : '') + (state ? ', ' + state : ''),
        type: type,
        price: price ? '$' + (+price).toLocaleString() : '',
        amountFunded: amountFunded ? '$' + (+amountFunded).toLocaleString() : '',
        dateFunded: dateFunded || '',
        fundedDaysAgo: dateFunded ? Math.floor(fundedMs / (24 * 60 * 60 * 1000)) : null,
        staleDays: Math.floor(staleMs / (24 * 60 * 60 * 1000))
      });

      // Flag stale active deals as action items
      if (status === 'Actively Marketing' && staleMs > sevenDaysMs) {
        actionItems.push(address + (city ? ', ' + city : '') + ' — not updated in ' + Math.floor(staleMs / sevenDaysMs) + ' weeks');
      }
    });

    // 3. Build summary object for Claude
    var statusSummary = Object.keys(byStatus).map(function(s) {
      return s + ': ' + byStatus[s].length + ' deal(s)';
    }).join(', ');

    var activeDeals = (byStatus['Actively Marketing'] || []).map(function(d) {
      return d.address + (d.type ? ' [' + d.type + ']' : '') + (d.price ? ' ' + d.price : '');
    });

    // Use Date Funded (not last_edited_time) to identify recently closed deals
    var recentlyClosed = (byStatus['Closed'] || []).filter(function(d) {
      return d.fundedDaysAgo !== null && d.fundedDaysAgo <= 14;
    }).map(function(d) {
      return d.address + (d.amountFunded ? ' — ' + d.amountFunded : '') + (d.dateFunded ? ' (funded ' + d.dateFunded + ')' : '');
    });

    // 4. Generate briefing with Claude
    var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Phoenix' });

    var systemPrompt = 'You are the operations assistant for Deal Pros LLC, a real estate investment and wholesaling company. Generate concise, actionable CEO briefings. Use exact numbers from the data provided. Be direct — Brooke reads this every morning.';

    var userPrompt = 'Generate a CEO briefing for ' + today + ' using this data:\n\n' +
      'PIPELINE SUMMARY: ' + statusSummary + '\n\n' +
      'ACTIVELY MARKETING (' + (byStatus['Actively Marketing'] || []).length + '):\n' +
      (activeDeals.length ? activeDeals.join('\n') : 'None') + '\n\n' +
      'RECENTLY CLOSED (last 14 days):\n' +
      (recentlyClosed.length ? recentlyClosed.join('\n') : 'None') + '\n\n' +
      'STALE DEALS (needs attention):\n' +
      (actionItems.length ? actionItems.join('\n') : 'None') + '\n\n' +
      'Format exactly like this:\n' +
      '📊 CEO BRIEFING — [DATE]\n' +
      '🟢 WINS: [What closed, what\'s working]\n' +
      '🟡 PIPELINE: [Active deals and their stage — be specific]\n' +
      '🔴 ACTION NEEDED: [What Brooke needs to decide today]\n' +
      '📥 FUNNEL: [X active | X closed | X total in pipeline]';

    console.log('ceo-briefing: calling Claude...');
    var claudeRes = await complete(anthropicKey, {
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 600
    });
    var briefing = claudeRes.text;

    console.log('ceo-briefing: briefing generated (' + briefing.length + ' chars)');

    // 5. Find CEO Briefing contact in GHL
    var contactId = null;
    var searchRes = await searchContacts(ghlApiKey, locationId, 'CEO Briefing', 5);
    var contacts = (searchRes.body && searchRes.body.contacts) || [];
    if (contacts.length) {
      contactId = contacts[0].id;
      console.log('ceo-briefing: found CEO Briefing contact ' + contactId);
    } else {
      console.warn('ceo-briefing: CEO Briefing contact not found in GHL — skipping note');
    }

    // 6. Post briefing as GHL note
    var noteResult = null;
    if (contactId) {
      noteResult = await postNote(ghlApiKey, contactId, briefing);
      console.log('ceo-briefing: note posted, status=' + noteResult.status);
    }

    // 7. Send abbreviated SMS to Brooke (under 160 chars) — with daily dedup
    var today = new Date().toISOString().split('T')[0];
    var smsResult = { status: 'skipped-dedup' };

    if (sentLog && sentLog.isDroplet() && sentLog.wasSent('brooke', 'ceo-briefing', today)) {
      console.log('ceo-briefing: SMS already sent today, skipping');
    } else {
      var lines = briefing.split('\n').filter(function(l) { return l.trim(); });
      var winLine    = lines.find(function(l) { return l.startsWith('🟢'); }) || '';
      var actionLine = lines.find(function(l) { return l.startsWith('🔴'); }) || '';
      var funnel     = lines.find(function(l) { return l.startsWith('📥'); }) || '';

      var sms = [winLine, actionLine, funnel].filter(Boolean).join(' | ');
      if (sms.length > 155) sms = sms.slice(0, 152) + '...';
      if (!sms) sms = 'CEO Briefing ready — ' + statusSummary.slice(0, 130);

      smsResult = await sendSMS(ghlApiKey, locationId, brookePhone, sms);
      console.log('ceo-briefing: SMS sent, status=' + smsResult.status);
      if (sentLog && sentLog.isDroplet()) sentLog.markSent('brooke', 'ceo-briefing', today);
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        success: true,
        date: today,
        dealsTotal: pages.length,
        statusBreakdown: statusSummary,
        briefingLength: briefing.length,
        notePosted: !!noteResult && noteResult.status < 300,
        smsSent: smsResult.status < 300,
        briefing: briefing
      })
    };

  } catch (err) {
    console.error('ceo-briefing error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
