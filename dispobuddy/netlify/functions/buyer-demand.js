// Netlify function: buyer-demand
// Returns anonymized, aggregated buyer demand data for map visualization
// GET /api/buyer-demand
//
// ENV VARS REQUIRED:
//   GHL_API_KEY       — GoHighLevel API key
//   GHL_LOCATION_ID   — GoHighLevel location/sub-account ID

const https = require('https');

// ─── HTTP HELPER ─────────────────────────────────────────────

function httpRequest(url, options, body) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
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

// ─── GHL CUSTOM FIELD IDS ────────────────────────────────────

var CF = {
  TARGET_STATES:    'aewzY7iEvZh12JhMVi7E',
  TARGET_CITIES:    'DbY7dHIXk8YowpaWrxYj',
  DEAL_STRUCTURES:  '0L0ycmmsEjy6OPDL0rgq',
  PROPERTY_TYPE:    'HGC6xWLpSqoAQPZr0uwY',
  MAX_PRICE:        'BcxuopmSK4wA3Z3NyanD',
  MAX_ENTRY:        'SZmNHA3BQva2AZg00ZNP',
  MIN_ARV:          'KKGEfgdaqu98yrZYkmoO',
  EXIT_STRATEGIES:  '98i8EKc3OWYSqS4Qb1nP',
  BUYER_TYPE:       '95PgdlIYfXYcMymnjsIv',
  CONTACT_ROLE:     'agG4HMPB5wzsZXiRxfmR',
  PURCHASE_TIMELINE: 'purchase_timeline',
  CLOSE_TIMELINE:    'close_timeline',
};

var TIMELINE_ORDER = [
  'Immediate — 0-30 days',
  'Short-Term — 31-90 days',
  'Long-Term — Beyond 90 days'
];

var TIMELINE_EXCLUDE = ['homerun only', 'just researching options'];

// ─── HELPERS ─────────────────────────────────────────────────

function getCF(contact, fieldId) {
  var cfs = contact.customFields || [];
  var field = cfs.find(function(f) { return f.id === fieldId || f.key === fieldId || f.fieldKey === fieldId; });
  if (!field) return null;
  return field.value;
}

function normalizeTimeline(val) {
  if (!val) return '';
  var v = val.trim();
  var lower = v.toLowerCase();
  if (/immediate|0.?30/i.test(v) || lower === 'asap (7 days)' || lower === '10-14 days' || lower === '14-21 days' || lower === '21-30 days') {
    return 'Immediate — 0-30 days';
  }
  if (/short.?term|31.?90/i.test(v) || lower === '30-45 days' || lower === '45-60 days') {
    return 'Short-Term — 31-90 days';
  }
  if (/long.?term|beyond/i.test(v) || lower === 'flexible') {
    return 'Long-Term — Beyond 90 days';
  }
  return v;
}

function getBuyerTimeline(contact) {
  var pt = getCF(contact, CF.PURCHASE_TIMELINE);
  if (pt) return normalizeTimeline(String(pt));
  var ct = getCF(contact, CF.CLOSE_TIMELINE);
  if (ct) return normalizeTimeline(String(ct));
  return '';
}

// ─── IN-MEMORY CACHE (10 min TTL) ───────────────────────────

var cache = {
  data: null,
  timestamp: 0,
  TTL: 10 * 60 * 1000 // 10 minutes
};

function isCacheValid() {
  return cache.data && (Date.now() - cache.timestamp < cache.TTL);
}

// ─── RESOLVE FIELD KEY → UUID ───────────────────────────────

async function resolveFieldId(apiKey, locationId, fieldKey) {
  try {
    var url = 'https://services.leadconnectorhq.com/locations/' + locationId + '/customFields';
    var result = await httpRequest(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });
    if (result.status === 200 && result.body) {
      var fields = result.body.customFields || result.body.fields || [];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var key = f.fieldKey || f.key || f.name || '';
        if (key === fieldKey || key === 'contact.' + fieldKey) {
          console.log('buyer-demand: Resolved ' + fieldKey + ' → ' + f.id);
          return f.id;
        }
      }
      console.log('buyer-demand: Field key "' + fieldKey + '" not found in ' + fields.length + ' custom fields');
    }
  } catch (err) {
    console.error('buyer-demand: resolveFieldId error:', err.message);
  }
  return null;
}

// ─── FETCH ALL BUYERS FROM GHL ──────────────────────────────

async function fetchAllBuyers(apiKey, locationId) {
  // Resolve timeline field keys → UUIDs if not already resolved
  if (CF.PURCHASE_TIMELINE && !/^[a-zA-Z0-9]{20}/.test(CF.PURCHASE_TIMELINE)) {
    var resolvedPt = await resolveFieldId(apiKey, locationId, CF.PURCHASE_TIMELINE);
    if (resolvedPt) {
      CF.PURCHASE_TIMELINE = resolvedPt;
    } else {
      console.log('buyer-demand: Could not resolve purchase_timeline field');
    }
  }
  if (CF.CLOSE_TIMELINE && !/^[a-zA-Z0-9]{20}/.test(CF.CLOSE_TIMELINE)) {
    var resolvedCt = await resolveFieldId(apiKey, locationId, CF.CLOSE_TIMELINE);
    if (resolvedCt) {
      CF.CLOSE_TIMELINE = resolvedCt;
    } else {
      console.log('buyer-demand: Could not resolve close_timeline field (ok if merged)');
    }
  }

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
      // Include anyone with Contact Role = Buyer OR any buy box data filled in
      var contactRole = getCF(contact, CF.CONTACT_ROLE);
      var isBuyer = false;
      if (contactRole) {
        if (Array.isArray(contactRole)) {
          isBuyer = contactRole.some(function(r) { return r.toLowerCase() === 'buyer'; });
        } else {
          isBuyer = String(contactRole).toLowerCase().includes('buyer');
        }
      }
      // Also capture anyone with buy box fields filled in
      if (!isBuyer) {
        var hasStates = getCF(contact, CF.TARGET_STATES);
        var hasCities = getCF(contact, CF.TARGET_CITIES);
        var hasStructures = getCF(contact, CF.DEAL_STRUCTURES);
        var hasPropertyType = getCF(contact, CF.PROPERTY_TYPE);
        var hasMaxPrice = getCF(contact, CF.MAX_PRICE);
        var hasExitStrat = getCF(contact, CF.EXIT_STRATEGIES);
        var hasTargetMarkets = getCF(contact, CF.TARGET_MARKETS);
        var hasBuyerType = getCF(contact, CF.BUYER_TYPE);
        if (hasStates || hasCities || hasStructures || hasPropertyType || hasMaxPrice || hasExitStrat || hasTargetMarkets || hasBuyerType) {
          isBuyer = true;
        }
      }
      if (isBuyer) {
        // Hard-filter: exclude buyers whose timeline matches TIMELINE_EXCLUDE
        var timelineStr = getBuyerTimeline(contact).toLowerCase();
        var excluded = TIMELINE_EXCLUDE.some(function(ex) { return timelineStr === ex.toLowerCase(); });
        if (!excluded) allBuyers.push(contact);
      }
    });

    if (result.body.meta && result.body.meta.nextPageUrl) {
      var lastContact = contacts[contacts.length - 1];
      startAfter = lastContact.startAfter ? lastContact.startAfter[0] : '';
      startAfterId = lastContact.startAfter ? lastContact.startAfter[1] : lastContact.id;
      if (!startAfter) hasMore = false;
    } else { hasMore = false; }

    if (checked >= 2000) hasMore = false;
  }

  console.log('buyer-demand: Fetched ' + checked + ' contacts, ' + allBuyers.length + ' are buyers');
  return allBuyers;
}

// ─── AGGREGATION ─────────────────────────────────────────────

function parseMonetary(val) {
  if (!val) return 0;
  var n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function incrementMap(map, key) {
  if (!key) return;
  var k = key.trim();
  if (!k) return;
  map[k] = (map[k] || 0) + 1;
}

function computeRange(values) {
  var filtered = values.filter(function(v) { return v > 0; });
  if (filtered.length === 0) return null;
  filtered.sort(function(a, b) { return a - b; });
  var sum = filtered.reduce(function(a, b) { return a + b; }, 0);
  return {
    min: filtered[0],
    max: filtered[filtered.length - 1],
    avg: Math.round(sum / filtered.length)
  };
}

function parseCityState(cityStr) {
  // Expected format: "Phoenix, AZ" or "Dallas, TX"
  var parts = cityStr.split(',');
  if (parts.length < 2) return null;
  var city = parts[0].trim();
  var state = parts[parts.length - 1].trim().toUpperCase();
  if (!city || !state) return null;
  return { city: city, state: state };
}

function aggregateBuyerData(buyers) {
  // Markets keyed by "City, ST"
  var markets = {};
  // State-only buyers (no city specified)
  var stateOnlyBuyers = {};
  var globalDealTypes = {};
  var globalPropertyTypes = {};
  var globalExitStrategies = {};
  var globalBuyerTypes = {};
  var globalTimelines = {};
  var totalBuyers = buyers.length;

  buyers.forEach(function(contact) {
    var targetCities = getCF(contact, CF.TARGET_CITIES);
    var targetStates = getCF(contact, CF.TARGET_STATES);
    var dealStructures = getCF(contact, CF.DEAL_STRUCTURES);
    var propertyTypes = getCF(contact, CF.PROPERTY_TYPE);
    var exitStrategies = getCF(contact, CF.EXIT_STRATEGIES);
    var maxPrice = parseMonetary(getCF(contact, CF.MAX_PRICE));
    var maxEntry = parseMonetary(getCF(contact, CF.MAX_ENTRY));
    var targetMarkets = getCF(contact, CF.TARGET_MARKETS);
    var buyerType = getCF(contact, CF.BUYER_TYPE);

    // Global aggregations
    if (dealStructures && Array.isArray(dealStructures)) {
      dealStructures.forEach(function(ds) { incrementMap(globalDealTypes, ds); });
    }
    if (propertyTypes && Array.isArray(propertyTypes)) {
      propertyTypes.forEach(function(pt) { incrementMap(globalPropertyTypes, pt); });
    }
    if (exitStrategies && Array.isArray(exitStrategies)) {
      exitStrategies.forEach(function(es) { incrementMap(globalExitStrategies, es); });
    }
    if (buyerType) {
      incrementMap(globalBuyerTypes, Array.isArray(buyerType) ? buyerType[0] : String(buyerType));
    }

    var timelineVal = getBuyerTimeline(contact);
    if (timelineVal) {
      incrementMap(globalTimelines, timelineVal);
    }

    // Parse TARGET_MARKETS (free text) into additional cities if no TARGET_CITIES
    var parsedMarketCities = [];
    if (targetMarkets && typeof targetMarkets === 'string' && targetMarkets.trim()) {
      // Try to parse comma/newline separated city-state pairs from free text
      var chunks = targetMarkets.split(/[,\n;]+/);
      chunks.forEach(function(chunk) {
        var trimmed = chunk.trim();
        // Try to match "City ST" or "City, ST" patterns
        var match = trimmed.match(/^([A-Za-z\s.'-]+)\s*,?\s*([A-Z]{2})$/);
        if (match) {
          parsedMarketCities.push(match[1].trim() + ', ' + match[2].trim());
        }
      });
    }

    var hasCities = targetCities && Array.isArray(targetCities) && targetCities.length > 0;
    var allCities = hasCities ? targetCities.slice() : [];
    // Merge in parsed free-text markets
    parsedMarketCities.forEach(function(c) {
      if (allCities.indexOf(c) === -1) allCities.push(c);
    });

    var hasAnyCities = allCities.length > 0;

    if (hasAnyCities) {
      // Add this buyer to each of their target city markets
      allCities.forEach(function(cityStr) {
        var parsed = parseCityState(cityStr);
        if (!parsed) return;

        var label = parsed.city + ', ' + parsed.state;
        if (!markets[label]) {
          markets[label] = {
            city: parsed.city,
            state: parsed.state,
            label: label,
            buyerCount: 0,
            dealTypes: {},
            propertyTypes: {},
            exitStrategies: {},
            timelines: {},
            prices: [],
            entries: []
          };
        }

        var m = markets[label];
        m.buyerCount++;

        if (dealStructures && Array.isArray(dealStructures)) {
          dealStructures.forEach(function(ds) { incrementMap(m.dealTypes, ds); });
        }
        if (propertyTypes && Array.isArray(propertyTypes)) {
          propertyTypes.forEach(function(pt) { incrementMap(m.propertyTypes, pt); });
        }
        if (exitStrategies && Array.isArray(exitStrategies)) {
          exitStrategies.forEach(function(es) { incrementMap(m.exitStrategies, es); });
        }
        if (timelineVal) {
          incrementMap(m.timelines, timelineVal);
        }
        if (maxPrice > 0) m.prices.push(maxPrice);
        if (maxEntry > 0) m.entries.push(maxEntry);
      });
    } else if (targetStates && Array.isArray(targetStates) && targetStates.length > 0) {
      // Buyer has states but no cities -- count in state-only bucket
      targetStates.forEach(function(st) {
        var state = st.trim().toUpperCase();
        if (!state) return;
        if (!stateOnlyBuyers[state]) {
          stateOnlyBuyers[state] = 0;
        }
        stateOnlyBuyers[state]++;
      });
    }
  });

  // Build markets array, filtering out markets with fewer than 2 buyers (privacy)
  var MIN_BUYERS_PER_MARKET = 2;
  var marketsArray = [];
  Object.keys(markets).forEach(function(label) {
    var m = markets[label];
    if (m.buyerCount < MIN_BUYERS_PER_MARKET) return;
    marketsArray.push({
      city: m.city,
      state: m.state,
      label: m.label,
      buyerCount: m.buyerCount,
      dealTypes: m.dealTypes,
      propertyTypes: m.propertyTypes,
      exitStrategies: m.exitStrategies,
      timelines: m.timelines,
      priceRange: computeRange(m.prices),
      entryRange: computeRange(m.entries)
    });
  });

  // Sort markets by buyer count descending
  marketsArray.sort(function(a, b) { return b.buyerCount - a.buyerCount; });

  // Build states summary: aggregate city-level + state-only buyers
  var stateBuckets = {};
  marketsArray.forEach(function(m) {
    if (!stateBuckets[m.state]) {
      stateBuckets[m.state] = { state: m.state, buyerCount: 0, cities: [] };
    }
    stateBuckets[m.state].buyerCount += m.buyerCount;
    if (stateBuckets[m.state].cities.indexOf(m.city) === -1) {
      stateBuckets[m.state].cities.push(m.city);
    }
  });

  // Add state-only buyers to state summary
  Object.keys(stateOnlyBuyers).forEach(function(state) {
    if (!stateBuckets[state]) {
      stateBuckets[state] = { state: state, buyerCount: 0, cities: [] };
    }
    stateBuckets[state].buyerCount += stateOnlyBuyers[state];
  });

  var statesSummary = Object.keys(stateBuckets).map(function(st) {
    return stateBuckets[st];
  });
  statesSummary.sort(function(a, b) { return b.buyerCount - a.buyerCount; });

  // Build timelinesSummary ordered by TIMELINE_ORDER, then any extras
  var timelinesSummary = {};
  TIMELINE_ORDER.forEach(function(tl) {
    if (globalTimelines[tl]) {
      timelinesSummary[tl] = globalTimelines[tl];
    }
  });
  Object.keys(globalTimelines).forEach(function(tl) {
    if (!timelinesSummary[tl]) {
      timelinesSummary[tl] = globalTimelines[tl];
    }
  });

  return {
    totalBuyers: totalBuyers,
    lastUpdated: new Date().toISOString(),
    markets: marketsArray,
    statesSummary: statesSummary,
    dealTypesSummary: globalDealTypes,
    propertyTypesSummary: globalPropertyTypes,
    exitStrategiesSummary: globalExitStrategies,
    buyerTypesSummary: globalBuyerTypes,
    timelinesSummary: timelinesSummary,
    totalMarkets: marketsArray.length
  };
}

// ─── MAIN HANDLER ────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=600'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: headers,
      body: JSON.stringify({ error: 'Method not allowed. Use GET.' })
    };
  }

  var apiKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: 'Missing required environment variables' })
    };
  }

  try {
    // Return cached data if still valid
    if (isCacheValid()) {
      console.log('buyer-demand: Returning cached data (' + Math.round((Date.now() - cache.timestamp) / 1000) + 's old)');
      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify(cache.data, null, 2)
      };
    }

    // Fetch fresh data
    console.log('buyer-demand: Cache miss, fetching fresh data from GHL');
    var buyers = await fetchAllBuyers(apiKey, locationId);
    var result = aggregateBuyerData(buyers);

    // Update cache
    cache.data = result;
    cache.timestamp = Date.now();

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify(result, null, 2)
    };

  } catch (err) {
    console.error('buyer-demand error:', err.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: 'Failed to fetch buyer demand data', detail: err.message })
    };
  }
};
