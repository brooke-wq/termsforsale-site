// Netlify function: notify-buyers
// Matches new deals to buyer criteria and triggers GHL alerts
// Runs on schedule (every 30 min) OR manually via /api/notify-test?deal_id=XXX
//
// ENV VARS REQUIRED:
//   NOTION_TOKEN, NOTION_DB_ID — Notion access
//   GHL_API_KEY — GoHighLevel API key
//   GHL_LOCATION_ID — GoHighLevel location/sub-account ID
//   DEAL_ALERTS_LIVE — set to "true" to actually send alerts (default: test mode)

const https = require('https');

// ─── HTTP HELPERS ────────────────────────────────────────────

function httpRequest(url, options, body) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = Object.assign({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, {});
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── NOTION: Get recently published deals ────────────────────

async function getRecentDeals(token, dbId, sinceMinutes) {
  var since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  var body = {
    filter: {
      and: [
        { property: 'Deal Status', status: { equals: 'Actively Marketing' } },
        { timestamp: 'last_edited_time', last_edited_time: { after: since } }
      ]
    },
    page_size: 20
  };
  var result = await httpRequest('https://api.notion.com/v1/databases/' + dbId + '/query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  }, body);

  if (result.status !== 200) {
    // Try with select instead of status
    body.filter.and[0] = { property: 'Deal Status', select: { equals: 'Actively Marketing' } };
    result = await httpRequest('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, body);
  }

  if (result.status !== 200) return [];
  return (result.body.results || []).map(parseDeal);
}

// Get a single deal by ID (for test endpoint)
async function getDealById(token, dbId, pageId) {
  var result = await httpRequest('https://api.notion.com/v1/pages/' + pageId, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28'
    }
  });
  if (result.status !== 200) return null;
  return parseDeal(result.body);
}

function prop(page, name) {
  var p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title': return (p.title || []).map(function(t) { return t.plain_text; }).join('');
    case 'rich_text': return (p.rich_text || []).map(function(t) { return t.plain_text; }).join('');
    case 'number': return p.number !== null && p.number !== undefined ? p.number : '';
    case 'select': return p.select ? p.select.name : '';
    case 'multi_select': return (p.multi_select || []).map(function(s) { return s.name; }).join(', ');
    case 'status': return p.status ? p.status.name : '';
    case 'url': return p.url || '';
    case 'date': return p.date ? p.date.start : '';
    case 'formula':
      if (p.formula.type === 'string') return p.formula.string || '';
      if (p.formula.type === 'number') return p.formula.number !== null ? p.formula.number : '';
      return '';
    default: return '';
  }
}

function parseDeal(page) {
  return {
    id: page.id,
    dealType: prop(page, 'Deal Type'),
    streetAddress: prop(page, 'Street Address'),
    city: prop(page, 'City'),
    state: prop(page, 'State'),
    zip: prop(page, 'ZIP'),
    nearestMetro: prop(page, 'Nearest Metro') || prop(page, 'Nearest Metro Area'),
    propertyType: prop(page, 'Property Type'),
    askingPrice: +prop(page, 'Asking Price') || 0,
    entryFee: +prop(page, 'Entry Fee') || 0,
    arv: +prop(page, 'ARV') || 0,
    rentFinal: +prop(page, 'LTR Market Rent') || 0,
    beds: prop(page, 'Beds'),
    baths: prop(page, 'Baths'),
    sqft: prop(page, 'Living Area') || prop(page, 'Sqft'),
    dealUrl: 'https://deals.termsforsale.com/deal.html?id=' + page.id,
    lastEdited: page.last_edited_time
  };
}

// ─── GHL: Search contacts by tags/criteria ───────────────────

// Map deal types to buyer tags
var DEAL_TAG_MAP = {
  'Cash': ['buy:cash'],
  'SubTo': ['buy:subto', 'buy:creative'],
  'Seller Finance': ['buy:seller-finance', 'buy:creative'],
  'Hybrid': ['buy:hybrid', 'buy:creative'],
  'Wrap': ['buy:creative'],
  'Morby Method': ['buy:creative'],
  'Lease Option': ['buy:creative'],
  'Novation': ['buy:creative']
};

async function findMatchingBuyers(apiKey, locationId, deal) {
  // Get tags that match this deal type
  var matchTags = DEAL_TAG_MAP[deal.dealType] || ['tfs buyer'];

  // Search GHL contacts with matching tags
  var allMatches = [];

  for (var i = 0; i < matchTags.length; i++) {
    var tag = matchTags[i];
    var searchUrl = 'https://services.leadconnectorhq.com/contacts/?locationId=' + locationId
      + '&query=' + encodeURIComponent(tag)
      + '&limit=100';

    var result = await httpRequest(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });

    if (result.status === 200 && result.body.contacts) {
      result.body.contacts.forEach(function(contact) {
        // Check if contact has the matching tag
        var contactTags = (contact.tags || []).map(function(t) { return t.toLowerCase(); });
        if (contactTags.indexOf(tag.toLowerCase()) > -1) {
          // Check state/market match if buyer has preferences
          var buyerState = (contact.customFields || []).find(function(f) {
            return f.id === 'target_zips' || f.key === 'target_zips';
          });
          var stateMatch = !buyerState || !buyerState.value ||
            buyerState.value.toLowerCase().includes(deal.state.toLowerCase()) ||
            buyerState.value.toLowerCase().includes('nationwide') ||
            buyerState.value.toLowerCase().includes('multiple');

          if (stateMatch) {
            // Deduplicate
            if (!allMatches.find(function(m) { return m.id === contact.id; })) {
              allMatches.push({
                id: contact.id,
                name: (contact.firstName || '') + ' ' + (contact.lastName || ''),
                email: contact.email || '',
                phone: contact.phone || '',
                tags: contact.tags || [],
                matchedTag: tag,
                matchReason: deal.dealType + ' deal in ' + deal.state + ' matched tag "' + tag + '"'
              });
            }
          }
        }
      });
    }
  }

  // Also find all "tfs buyer" tagged contacts (broad match for all deal alerts)
  var broadUrl = 'https://services.leadconnectorhq.com/contacts/?locationId=' + locationId
    + '&query=' + encodeURIComponent('tfs buyer')
    + '&limit=100';

  var broadResult = await httpRequest(broadUrl, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  });

  if (broadResult.status === 200 && broadResult.body.contacts) {
    broadResult.body.contacts.forEach(function(contact) {
      var contactTags = (contact.tags || []).map(function(t) { return t.toLowerCase(); });
      if (contactTags.indexOf('tfs buyer') > -1) {
        if (!allMatches.find(function(m) { return m.id === contact.id; })) {
          allMatches.push({
            id: contact.id,
            name: (contact.firstName || '') + ' ' + (contact.lastName || ''),
            email: contact.email || '',
            phone: contact.phone || '',
            tags: contact.tags || [],
            matchedTag: 'tfs buyer',
            matchReason: 'Broad match — subscribed to all deal alerts'
          });
        }
      }
    });
  }

  return allMatches;
}

// ─── GHL: Trigger workflow for a buyer ───────────────────────

async function triggerBuyerAlert(apiKey, contact, deal) {
  // Add a tag to the contact that triggers a GHL workflow
  var tagUrl = 'https://services.leadconnectorhq.com/contacts/' + contact.id + '/tags';
  var result = await httpRequest(tagUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  }, {
    tags: ['new-deal-alert']
  });

  // Also update custom fields with the deal info so the GHL workflow can use them
  var updateUrl = 'https://services.leadconnectorhq.com/contacts/' + contact.id;
  await httpRequest(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  }, {
    customFields: [
      { key: 'current_deal_interest', value: deal.dealType + ' — ' + deal.city + ', ' + deal.state },
      { key: 'lead_source_detail', value: 'Auto Deal Alert: ' + deal.streetAddress }
    ]
  });

  return result.status;
}

// ─── MAIN HANDLER ────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers, body: '' };

  var token = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  var isLive = process.env.DEAL_ALERTS_LIVE === 'true';

  if (!token || !apiKey || !locationId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({
      error: 'Missing env vars',
      hasNotion: !!token,
      hasGHL: !!apiKey,
      hasLocation: !!locationId
    })};
  }

  var params = event.queryStringParameters || {};
  var isTest = params.test === 'true' || params.deal_id;
  var deals = [];

  try {
    if (params.deal_id) {
      // Manual test: check a specific deal
      var deal = await getDealById(token, dbId, params.deal_id);
      if (deal) deals = [deal];
      else return { statusCode: 404, headers: headers, body: JSON.stringify({ error: 'Deal not found' }) };
    } else {
      // Scheduled run: check deals edited in last 35 minutes
      deals = await getRecentDeals(token, dbId, 35);
    }

    if (!deals.length) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({
        message: 'No new deals to process',
        mode: isLive ? 'LIVE' : 'TEST',
        checkedAt: new Date().toISOString()
      })};
    }

    var results = [];

    for (var i = 0; i < deals.length; i++) {
      var deal = deals[i];
      var buyers = await findMatchingBuyers(apiKey, locationId, deal);

      var dealResult = {
        deal: {
          id: deal.id,
          type: deal.dealType,
          address: deal.streetAddress + ', ' + deal.city + ', ' + deal.state,
          price: deal.askingPrice,
          entry: deal.entryFee,
          url: deal.dealUrl
        },
        matchedBuyers: buyers.length,
        buyers: buyers.map(function(b) {
          return {
            name: b.name,
            email: b.email,
            phone: b.phone ? b.phone.replace(/\d{4}$/, '****') : '', // mask phone in logs
            matchReason: b.matchReason
          };
        }),
        alerts: []
      };

      if (isLive && !isTest) {
        // LIVE MODE: Actually trigger GHL alerts
        for (var j = 0; j < buyers.length; j++) {
          var status = await triggerBuyerAlert(apiKey, buyers[j], deal);
          dealResult.alerts.push({
            buyer: buyers[j].name,
            status: status,
            sent: true
          });
        }
        console.log('LIVE: Sent ' + buyers.length + ' alerts for deal ' + deal.streetAddress);
      } else {
        // TEST MODE: Log what would happen
        dealResult.alerts = buyers.map(function(b) {
          return { buyer: b.name, status: 'TEST — would send', sent: false };
        });
        console.log('TEST: Would send ' + buyers.length + ' alerts for deal ' + deal.streetAddress);
      }

      results.push(dealResult);
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        mode: isLive && !isTest ? 'LIVE' : 'TEST',
        dealsProcessed: deals.length,
        totalAlerts: results.reduce(function(sum, r) { return sum + r.matchedBuyers; }, 0),
        results: results,
        timestamp: new Date().toISOString()
      }, null, 2)
    };

  } catch (err) {
    console.error('notify-buyers error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
