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
    yearBuilt: prop(page, 'Year Built') || prop(page, 'Year Build'),
    highlight1: prop(page, 'Highlight 1'),
    highlight2: prop(page, 'Highlight 2'),
    highlight3: prop(page, 'Highlight 3'),
    dealUrl: 'https://deals.termsforsale.com/deal.html?id=' + page.id,
    lastEdited: page.last_edited_time
  };
}

// ─── GHL: Search contacts by tags/criteria ───────────────────

// ─── GHL Custom Field IDs for Buy Box matching ──────────────
var CF = {
  TARGET_STATES:    'aewzY7iEvZh12JhMVi7E',  // Multi-select: ['AZ','TX']
  TARGET_CITIES:    'DbY7dHIXk8YowpaWrxYj',  // Multi-select: ['Phoenix, AZ','Dallas, TX']
  DEAL_STRUCTURES:  '0L0ycmmsEjy6OPDL0rgq',  // Multi-select: ['Cash','Subject To']
  PROPERTY_TYPE:    'HGC6xWLpSqoAQPZr0uwY',  // Multi-select: ['Single Family']
  MAX_PRICE:        'BcxuopmSK4wA3Z3NyanD',  // Monetary
  MAX_ENTRY:        'SZmNHA3BQva2AZg00ZNP',  // Monetary
  MIN_ARV:          'KKGEfgdaqu98yrZYkmoO',  // Monetary
  MIN_BEDS:         'RRuCraVtRUlEMvdFXngv',  // Number
  EXIT_STRATEGIES:  '98i8EKc3OWYSqS4Qb1nP',  // Multi-select
  TARGET_MARKETS:   'XjXqGv6Y82iTP659pO4t',  // Large text
  BUYER_TYPE:       '95PgdlIYfXYcMymnjsIv',  // Single select
  CONTACT_ROLE:     'agG4HMPB5wzsZXiRxfmR',  // Multi-select: ['Buyer']
};

// Matching thresholds
var MIN_BUYERS_TARGET = 50;  // If fewer than this, expand matching
var TIER1_MIN_SCORE = 2;     // Strict: state + structure + more
var TIER2_MIN_SCORE = 1;     // Relaxed: at least state OR structure match
// Tier 3: Same state buyers with Contact Role=Buyer (no buy box required)

// Map deal types to structure values in GHL custom fields
var DEAL_STRUCTURE_MAP = {
  'Cash': ['Cash'],
  'SubTo': ['Subject To','Sub-To','SubTo'],
  'Seller Finance': ['Seller Finance','Seller Financing','Owner Finance'],
  'Hybrid': ['Hybrid','Subject To','Seller Finance'],
  'Wrap': ['Wrap','Wrap Around'],
  'Morby Method': ['Morby Method','Subject To'],
  'Lease Option': ['Lease Option'],
  'Novation': ['Novation']
};

function getCF(contact, fieldId) {
  var cfs = contact.customFields || [];
  var field = cfs.find(function(f) { return f.id === fieldId; });
  if (!field) return null;
  return field.value;
}

function matchesBuyBox(contact, deal, minScore) {
  var reasons = [];
  var fails = [];
  var reqScore = minScore || TIER1_MIN_SCORE;

  // 1. Target States — must include deal state (if buyer has preferences)
  var targetStates = getCF(contact, CF.TARGET_STATES);
  if (targetStates && Array.isArray(targetStates) && targetStates.length > 0) {
    var dealState = (deal.state || '').trim().toUpperCase();
    var stateMatch = targetStates.some(function(s) {
      return s.trim().toUpperCase() === dealState;
    });
    if (stateMatch) reasons.push('State: ' + dealState);
    else { fails.push('State mismatch (wants ' + targetStates.join(',') + ', deal is ' + dealState + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // 2. Target Cities — check if deal city/metro matches (if buyer has preferences)
  var targetCities = getCF(contact, CF.TARGET_CITIES);
  if (targetCities && Array.isArray(targetCities) && targetCities.length > 0) {
    var dealCity = (deal.city || '').toLowerCase();
    var dealMetro = (deal.nearestMetro || '').toLowerCase();
    var cityMatch = targetCities.some(function(c) {
      var cl = c.toLowerCase();
      return cl.includes(dealCity) || dealCity.includes(cl.split(',')[0].trim()) || cl.includes(dealMetro) || dealMetro.includes(cl.split(',')[0].trim());
    });
    if (cityMatch) reasons.push('City: ' + deal.city);
    // City is soft match — don't reject if no match, just don't add reason
  }

  // 3. Deal Structure — must accept this deal type (if buyer has preferences)
  var dealStructures = getCF(contact, CF.DEAL_STRUCTURES);
  var structureNames = DEAL_STRUCTURE_MAP[deal.dealType] || [deal.dealType];
  if (dealStructures && Array.isArray(dealStructures) && dealStructures.length > 0) {
    var structMatch = structureNames.some(function(s) {
      return dealStructures.some(function(ds) {
        return ds.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(ds.toLowerCase());
      });
    });
    if (structMatch) reasons.push('Structure: ' + deal.dealType);
    else { fails.push('Structure mismatch (wants ' + dealStructures.join(',') + ', deal is ' + deal.dealType + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // 4. Max Purchase Price — deal must be at or under (if buyer has preference)
  var maxPrice = getCF(contact, CF.MAX_PRICE);
  if (maxPrice && +maxPrice > 0 && deal.askingPrice > 0) {
    if (deal.askingPrice <= +maxPrice) reasons.push('Price: $' + deal.askingPrice.toLocaleString() + ' <= $' + (+maxPrice).toLocaleString());
    else { fails.push('Over budget ($' + deal.askingPrice + ' > $' + maxPrice + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // 5. Max Entry Fee — deal entry must be at or under (if buyer has preference)
  var maxEntry = getCF(contact, CF.MAX_ENTRY);
  if (maxEntry && +maxEntry > 0 && deal.entryFee > 0) {
    if (deal.entryFee <= +maxEntry) reasons.push('Entry: $' + deal.entryFee.toLocaleString() + ' <= $' + (+maxEntry).toLocaleString());
    else { fails.push('Entry too high ($' + deal.entryFee + ' > $' + maxEntry + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // 6. Min ARV — deal ARV must be at or above (if buyer has preference)
  var minArv = getCF(contact, CF.MIN_ARV);
  if (minArv && +minArv > 0 && deal.arv > 0) {
    if (deal.arv >= +minArv) reasons.push('ARV: $' + deal.arv.toLocaleString() + ' >= $' + (+minArv).toLocaleString());
    else { fails.push('ARV too low ($' + deal.arv + ' < $' + minArv + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // 7. Min Beds
  var minBeds = getCF(contact, CF.MIN_BEDS);
  if (minBeds && +minBeds > 0 && deal.beds) {
    if (+deal.beds >= +minBeds) reasons.push('Beds: ' + deal.beds + ' >= ' + minBeds);
    else { fails.push('Not enough beds (' + deal.beds + ' < ' + minBeds + ')'); return { match: false, reasons: reasons, fails: fails }; }
  }

  // Must meet minimum match score for this tier
  if (reasons.length < reqScore) {
    fails.push('Only ' + reasons.length + ' criteria matched (need ' + reqScore + '+)');
    return { match: false, reasons: reasons, fails: fails, score: reasons.length };
  }

  return { match: true, reasons: reasons, fails: fails, score: reasons.length };
}

async function fetchAllBuyers(apiKey, locationId) {
  var allBuyers = [];
  var hasMore = true;
  var startAfter = '';
  var startAfterId = '';
  var checked = 0;

  while (hasMore) {
    var searchUrl = 'https://services.leadconnectorhq.com/contacts/?locationId=' + locationId
      + '&limit=100'
      + (startAfter ? '&startAfter=' + startAfter + '&startAfterId=' + startAfterId : '');

    var result = await httpRequest(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });

    if (result.status !== 200 || !result.body.contacts || !result.body.contacts.length) break;

    var contacts = result.body.contacts;
    checked += contacts.length;

    contacts.forEach(function(contact) {
      var contactRole = getCF(contact, CF.CONTACT_ROLE);
      var isBuyer = false;
      if (contactRole) {
        if (Array.isArray(contactRole)) {
          isBuyer = contactRole.some(function(r) { return r.toLowerCase() === 'buyer'; });
        } else {
          isBuyer = String(contactRole).toLowerCase() === 'buyer';
        }
      }
      if (isBuyer) allBuyers.push(contact);
    });

    if (result.body.meta && result.body.meta.nextPageUrl) {
      var lastContact = contacts[contacts.length - 1];
      startAfter = lastContact.startAfter ? lastContact.startAfter[0] : '';
      startAfterId = lastContact.startAfter ? lastContact.startAfter[1] : lastContact.id;
      if (!startAfter) hasMore = false;
    } else { hasMore = false; }

    if (checked >= 2000) hasMore = false;
  }

  console.log('Fetched ' + checked + ' contacts, ' + allBuyers.length + ' are buyers');
  return allBuyers;
}

async function findMatchingBuyers(apiKey, locationId, deal) {
  var buyers = await fetchAllBuyers(apiKey, locationId);
  var tier1 = [], tier2 = [], tier3 = [];
  var tier1Ids = {}, tier2Ids = {};

  // TIER 1: Strict — minimum 2 buy box criteria match
  buyers.forEach(function(contact) {
    var r = matchesBuyBox(contact, deal, TIER1_MIN_SCORE);
    if (r.match) {
      tier1Ids[contact.id] = true;
      tier1.push({
        id: contact.id,
        name: (contact.firstName || '') + ' ' + (contact.lastName || ''),
        email: contact.email || '',
        phone: contact.phone || '',
        score: r.score,
        tier: 1,
        matchReasons: r.reasons,
        matchReason: r.reasons.join(' | ')
      });
    }
  });

  // TIER 2: Relaxed — only if tier 1 < 50. Requires 1 matching criterion.
  if (tier1.length < MIN_BUYERS_TARGET) {
    buyers.forEach(function(contact) {
      if (tier1Ids[contact.id]) return;
      var r = matchesBuyBox(contact, deal, TIER2_MIN_SCORE);
      if (r.match) {
        tier2Ids[contact.id] = true;
        tier2.push({
          id: contact.id,
          name: (contact.firstName || '') + ' ' + (contact.lastName || ''),
          email: contact.email || '',
          phone: contact.phone || '',
          score: r.score,
          tier: 2,
          matchReasons: r.reasons,
          matchReason: '(Expanded) ' + r.reasons.join(' | ')
        });
      }
    });
  }

  // TIER 3: State-only — only if tier 1 + tier 2 < 50. Any buyer in the same state.
  if (tier1.length + tier2.length < MIN_BUYERS_TARGET) {
    var dealState = (deal.state || '').trim().toUpperCase();
    buyers.forEach(function(contact) {
      if (tier1Ids[contact.id] || tier2Ids[contact.id]) return;
      // Check contact's own state field or target states
      var contactState = (contact.state || '').trim().toUpperCase();
      var targetStates = getCF(contact, CF.TARGET_STATES);
      var stateMatch = contactState === dealState;
      if (!stateMatch && targetStates && Array.isArray(targetStates)) {
        stateMatch = targetStates.some(function(s) { return s.trim().toUpperCase() === dealState; });
      }
      if (stateMatch) {
        tier3.push({
          id: contact.id,
          name: (contact.firstName || '') + ' ' + (contact.lastName || ''),
          email: contact.email || '',
          phone: contact.phone || '',
          score: 0,
          tier: 3,
          matchReasons: ['Same state: ' + dealState],
          matchReason: '(State fallback) Same state: ' + dealState
        });
      }
    });
  }

  // Combine: tier 1 first, then tier 2, then tier 3 (up to target)
  var combined = tier1.concat(tier2).concat(tier3);
  combined.sort(function(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.score - a.score;
  });

  console.log('Matching results — Tier 1: ' + tier1.length + ', Tier 2: ' + tier2.length + ', Tier 3: ' + tier3.length + ', Total: ' + combined.length);
  return combined;
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

  // Update GHL custom fields with deal info for the email/SMS template
  var price = deal.askingPrice ? '$' + deal.askingPrice.toLocaleString() : '';
  var entry = deal.entryFee ? '$' + deal.entryFee.toLocaleString() + ' + CC/TC' : '';
  var highlights = [deal.highlight1, deal.highlight2, deal.highlight3].filter(Boolean).join('\n');
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
      // Location fields
      { id: 'TerjqctukTW67rB21ugC', field_value: deal.streetAddress + ', ' + deal.city + ', ' + deal.state + ' ' + (deal.zip || '') },
      { id: 'KuaUFXhbQB6kKvBSKfoI', field_value: deal.city },
      { id: 'ltmVcWUpbwZ0S3dBid3U', field_value: deal.state },
      { id: 'UqJl4Dq6T8wfNb70EMrL', field_value: deal.zip || '' },
      // Deal info
      { id: '0thrOdoETTLlFA45oN8U', field_value: deal.dealType },
      { id: '5eEVPcp8nERlR6GpjZUn', field_value: deal.dealUrl },
      { id: 'YjoPoDPv7Joo1izePpDx', field_value: deal.dealType + ' | ' + deal.city + ', ' + deal.state + ' | ' + price + (entry ? ' | ' + entry : '') },
      // Alert fields for email template
      { id: 'iur6TZsfKotwO3gZb8yk', field_value: price },                    // Alert Asking Price
      { id: 'DH4Ekmyw2dvzrE74JSzs', field_value: entry },                    // Alert Entry Fee
      { id: 'DJFMav5mPvWBzsPdhAqy', field_value: deal.propertyType || '' },   // Alert Property Type
      { id: '2iVO7pRpi0f0ABb6nYka', field_value: deal.beds || '0' },          // Alert Beds
      { id: 'rkzCcjHJMFJP3GcwnNx6', field_value: deal.baths || '0' },        // Alert Baths
      { id: 'nNMHvkPbjGYRbOB1v7vQ', field_value: deal.yearBuilt || '' },      // Alert Year Built
      { id: 'MgNeVZgMdTcdatcTTHue', field_value: deal.sqft ? deal.sqft.toLocaleString() : '' },  // Alert Sqft
      { id: 'eke6ZGnex77y5aUCNgly', field_value: highlights }                 // Alert Highlights
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
        tiers: {
          tier1_strict: buyers.filter(function(b){return b.tier===1;}).length,
          tier2_relaxed: buyers.filter(function(b){return b.tier===2;}).length,
          tier3_state: buyers.filter(function(b){return b.tier===3;}).length
        },
        buyers: buyers.map(function(b) {
          return {
            name: b.name,
            email: b.email,
            phone: b.phone ? b.phone.replace(/\d{4}$/, '****') : '',
            tier: b.tier,
            score: b.score,
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
