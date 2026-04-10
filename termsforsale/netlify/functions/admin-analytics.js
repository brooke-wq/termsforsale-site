/**
 * Admin Analytics — GET /.netlify/functions/admin-analytics
 * (also reachable via /api/admin-analytics)
 *
 * Powers the Sales Tracking Dashboard at /admin/analytics.html.
 *
 * Combines two data sources into a single response:
 *   1. Notion deals DB — pipeline status, Date Assigned, Date Funded,
 *      Amount Funded → deal counts + revenue
 *   2. GHL tag counters — engagement signals written by notify-buyers,
 *      track-view, deal-view-tracker, buyer-alert, buyer-response-tag
 *      → sent/viewed/interested/offer funnel counts
 *
 * Response shape:
 *   {
 *     generatedAt,
 *     pipeline: {
 *       active, assigned, closed, funded, dead,
 *       byStatus: { [status]: count },
 *       byType:   { [dealType]: count }   // active only
 *     },
 *     revenue: {
 *       ytd:       { deals, revenue },
 *       mtd:       { deals, revenue },
 *       allTime:   { deals, revenue },
 *       avgDealSize,
 *       monthly:   [ { month: "2026-03", deals, revenue }, ... ]  // 12 mo
 *     },
 *     engagement: {
 *       totalSent,       // any buyer with new-deal-alert tag
 *       totalViewed,     // any buyer with Active Viewer tag
 *       totalInterested, // any buyer with buyer-interested tag
 *       totalPassed,     // any buyer with buyer-pass tag
 *       totalPaused,     // any buyer with alerts-paused tag
 *       conversionRate,  // interested / sent (percentage, rounded 0.1)
 *       viewRate         // viewed / sent
 *     },
 *     deals: [  // per-deal engagement for top active deals
 *       {
 *         id, dealCode, dealType, city, state, askingPrice,
 *         startedMarketing, daysOnMarket,
 *         sent, viewed, interested,
 *         viewRate, conversionRate
 *       }
 *     ],
 *     errors: [ ... ]    // non-fatal errors from downstream calls
 *   }
 *
 * Headers: X-Admin-Password
 */

const https = require('https');
const crypto = require('crypto');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// How many active deals get per-deal engagement lookups.
// Each one costs 3 GHL count queries (sent/viewed/interested).
const PER_DEAL_LIMIT = 10;

// ─── Auth ─────────────────────────────────────────────────────
function verifyAdmin(event) {
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD not configured' };
  var provided = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password']))
    || (event.queryStringParameters && event.queryStringParameters.password)
    || '';
  if (!provided) return { ok: false, reason: 'Password required' };
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return { ok: false, reason: 'Invalid password' };
  }
  try {
    var eq = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return eq ? { ok: true } : { ok: false, reason: 'Invalid password' };
  } catch (e) {
    return { ok: false, reason: 'Invalid password' };
  }
}

// ─── HTTPS helper ─────────────────────────────────────────────
function httpsRequest(opts, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── Notion ───────────────────────────────────────────────────
async function notionPaginate(dbId, token, filter) {
  var all = [];
  var cursor;
  var pages = 0;
  while (pages < 20) {
    var body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    var res = await httpsRequest({
      hostname: 'api.notion.com',
      path: '/v1/databases/' + dbId + '/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, body);
    if (res.status !== 200) return { error: res.body, pages: all };
    all = all.concat(res.body.results || []);
    if (!res.body.has_more) break;
    cursor = res.body.next_cursor;
    pages++;
  }
  return { pages: all };
}

function prop(page, name) {
  var p = page.properties && page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':      return (p.title || []).map(function (t) { return t.plain_text; }).join('');
    case 'rich_text':  return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
    case 'select':     return p.select ? p.select.name : '';
    case 'status':     return p.status ? p.status.name : '';
    case 'number':     return (p.number !== null && p.number !== undefined) ? p.number : '';
    case 'date':       return p.date ? p.date.start : '';
    case 'checkbox':   return p.checkbox ? 'Yes' : '';
    default:           return '';
  }
}

// ─── Slug helper ──────────────────────────────────────────────
// Must match notify-buyers.js slugifyAddress() exactly so the
// `sent:[slug]` tag we query here matches what was written.
function slugifyAddress(street, city, state) {
  var parts = [street, city, state].filter(Boolean).join(' ');
  return String(parts || '')
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Lowercase deal code for viewed-/alert- tag lookups (GHL lowercases
// tags on save, so we must query in lowercase to match).
function lowercaseCode(code) {
  return String(code || '').toLowerCase();
}

// ─── Date range filter helpers ────────────────────────────────
//
// Accepts either an explicit start/end pair OR a named preset
// ("7d" | "30d" | "90d" | "mtd" | "ytd" | "all"). Returns a
// { start, end, preset, label } object where start/end are Date
// instances or null (null = open-ended / all time).
function resolveDateRange(preset, startStr, endStr) {
  var now = new Date();
  var start = null;
  var end = null;
  var label = 'All Time';
  var presetOut = 'all';

  // Explicit dates take precedence over preset.
  if (startStr || endStr) {
    if (startStr) {
      var s = new Date(startStr);
      if (!isNaN(s)) start = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0);
    }
    if (endStr) {
      var e = new Date(endStr);
      if (!isNaN(e)) end = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59);
    }
    presetOut = 'custom';
    label = formatRangeLabel(start, end);
    return { start: start, end: end, preset: presetOut, label: label };
  }

  var p = (preset || '').toLowerCase();
  if (p === '7d') {
    start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
    end = now;
    label = 'Last 7 Days';
    presetOut = '7d';
  } else if (p === '30d') {
    start = new Date(now); start.setDate(now.getDate() - 30); start.setHours(0, 0, 0, 0);
    end = now;
    label = 'Last 30 Days';
    presetOut = '30d';
  } else if (p === '90d') {
    start = new Date(now); start.setDate(now.getDate() - 90); start.setHours(0, 0, 0, 0);
    end = now;
    label = 'Last 90 Days';
    presetOut = '90d';
  } else if (p === 'mtd') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    end = now;
    label = 'Month to Date';
    presetOut = 'mtd';
  } else if (p === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    end = now;
    label = 'Year to Date';
    presetOut = 'ytd';
  } else {
    // Default: all time
    label = 'All Time';
    presetOut = 'all';
  }
  return { start: start, end: end, preset: presetOut, label: label };
}

function formatRangeLabel(start, end) {
  var opts = { month: 'short', day: 'numeric', year: 'numeric' };
  if (start && end) {
    return start.toLocaleDateString('en-US', opts) + ' – ' + end.toLocaleDateString('en-US', opts);
  }
  if (start) return 'Since ' + start.toLocaleDateString('en-US', opts);
  if (end) return 'Through ' + end.toLocaleDateString('en-US', opts);
  return 'All Time';
}

// Is a YYYY-MM-DD date string inside the selected range?
// When the range is open-ended (both null), everything passes.
function isInRange(dateStr, range) {
  if (!range.start && !range.end) return true;
  if (!dateStr) return false;
  var d = new Date(dateStr);
  if (isNaN(d)) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

// ─── GHL ──────────────────────────────────────────────────────
/**
 * Count the number of GHL contacts matching a single tag filter.
 * Uses a page-1-limit-1 search just to read meta.total from the
 * response. Returns 0 on any error — never throws.
 */
function ghlTagCount(apiKey, locationId, tag) {
  return httpsRequest({
    hostname: GHL_HOST,
    path: '/contacts/search',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json'
    }
  }, {
    locationId: locationId,
    page: 1,
    pageLimit: 1,
    filters: [{
      group: 'AND',
      filters: [{ field: 'tags', operator: 'contains', value: [tag] }]
    }]
  }).then(function (res) {
    if (res.status < 200 || res.status >= 300) return 0;
    var meta = res.body && res.body.meta;
    var total = (meta && meta.total) || (res.body && res.body.total);
    if (typeof total === 'number') return total;
    // Fallback: length of returned page (only reliable if < pageLimit)
    var list = (res.body && (res.body.contacts || res.body.data)) || [];
    return list.length;
  }).catch(function () { return 0; });
}

// ─── Handler ──────────────────────────────────────────────────
exports.handler = async function (event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  var auth = verifyAdmin(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: headers, body: JSON.stringify({ error: auth.reason }) };
  }

  var notionToken = process.env.NOTION_TOKEN;
  var dbId = process.env.NOTION_DB_ID || process.env.NOTION_DATABASE_ID || 'a3c0a38fd9294d758dedabab2548ff29';
  var ghlKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID_TERMS || process.env.GHL_LOCATION_ID;

  // ─ Filter params ─
  var qs = event.queryStringParameters || {};
  var dateRange = resolveDateRange(qs.preset, qs.start, qs.end);
  var dealTypeFilter = String(qs.dealType || '').trim().toLowerCase();
  var stateFilter = String(qs.state || '').trim().toUpperCase();
  var hasDateFilter = !!(dateRange.start || dateRange.end);
  var hasAttrFilter = !!(dealTypeFilter || stateFilter);

  var out = {
    generatedAt: new Date().toISOString(),
    filters: {
      preset: dateRange.preset,
      start: dateRange.start ? dateRange.start.toISOString().slice(0, 10) : null,
      end: dateRange.end ? dateRange.end.toISOString().slice(0, 10) : null,
      label: dateRange.label,
      dealType: qs.dealType || '',
      state: qs.state || '',
      // Distinct values the frontend can use to populate dropdowns
      availableDealTypes: [],
      availableStates: []
    },
    pipeline: {
      active: 0, assigned: 0, closed: 0, funded: 0, dead: 0,
      byStatus: {},
      byType: {}
    },
    revenue: {
      range:   { deals: 0, revenue: 0, label: dateRange.label },
      ytd:     { deals: 0, revenue: 0 },
      mtd:     { deals: 0, revenue: 0 },
      allTime: { deals: 0, revenue: 0 },
      avgDealSize: 0,
      monthly: []
    },
    engagement: {
      totalSent: 0,
      totalViewed: 0,
      totalInterested: 0,
      totalPassed: 0,
      totalPaused: 0,
      conversionRate: 0,
      viewRate: 0
    },
    deals: [],
    errors: []
  };

  // ─ Notion: pull ALL deals in one paginated sweep, bucket client-side ─
  var allDeals = [];
  if (notionToken) {
    try {
      var res = await notionPaginate(dbId, notionToken);
      if (res.error) {
        out.errors.push('notion: ' + JSON.stringify(res.error).slice(0, 200));
      } else {
        allDeals = res.pages || [];
      }
    } catch (e) {
      out.errors.push('notion: ' + e.message);
    }
  } else {
    out.errors.push('notion: NOTION_TOKEN not set');
  }

  // ─ Bucket deals ─
  var now = new Date();
  var thisYear = now.getFullYear();
  var thisMonthKey = thisYear + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var monthlyMap = {};   // "YYYY-MM" → { deals, revenue }
  var rangeAmounts = []; // for avg calc — respects date + attr filters
  var activeDeals = [];
  var dealTypesSet = {};
  var statesSet = {};

  allDeals.forEach(function (page) {
    var status = prop(page, 'Deal Status') || 'Unknown';
    var dealType = prop(page, 'Deal Type') || 'Unknown';
    var dealState = prop(page, 'State') || '';
    var dateFunded = prop(page, 'Date Funded');
    var dateAssigned = prop(page, 'Date Assigned');
    var amountFundedRaw = prop(page, 'Amount Funded');
    var amountFunded = (amountFundedRaw !== '' && !isNaN(+amountFundedRaw)) ? +amountFundedRaw : 0;

    // Distinct-value dropdown options — compiled from the UNFILTERED set
    // so the frontend sees every possible option regardless of active filters.
    if (dealType && dealType !== 'Unknown') dealTypesSet[dealType] = true;
    if (dealState) statesSet[dealState] = true;

    // Attribute filter (deal type + state) — applies to every bucket.
    // A deal that fails this filter is invisible to the whole dashboard.
    if (dealTypeFilter && dealType.toLowerCase() !== dealTypeFilter) return;
    if (stateFilter && dealState.toUpperCase() !== stateFilter) return;

    // Status breakdown (raw — filtered)
    out.pipeline.byStatus[status] = (out.pipeline.byStatus[status] || 0) + 1;

    // Each high-level bucket is an INDEPENDENT check so a single deal can
    // contribute to multiple flow metrics at once:
    //   - "Deals Funded in range"   → has Date Funded within range
    //   - "Deals Assigned in range" → has Date Assigned within range
    //   - "Active"                  → currently marketing (state-of-world)
    //   - "Dead"                    → dead status (state-of-world)
    //
    // Active/dead are current-snapshot counts that only honor type/state
    // filters. Funded/assigned are flow-event counts that honor the date
    // range too. A deal that was assigned last month and funded this month
    // will count toward BOTH flow buckets when the range spans both events.
    var statusLower = status.toLowerCase();
    var isDead = /lost|cancel|dead|abandon|released|not accepted/.test(statusLower);
    var isActivelyMarketing = status === 'Actively Marketing';
    var statusSuggestsAssigned = /contract|assigned|escrow|under contract/.test(statusLower);
    var fundedInRange = dateFunded && isInRange(dateFunded, dateRange);
    var assignedInRange = dateAssigned && isInRange(dateAssigned, dateRange);

    // ─── All-time revenue + fixed YTD/MTD windows + monthly trend ───
    // These are never date-filtered — they provide context regardless of
    // the active preset.
    if (dateFunded) {
      out.revenue.allTime.deals++;
      out.revenue.allTime.revenue += amountFunded;

      if (dateFunded.slice(0, 4) === String(thisYear)) {
        out.revenue.ytd.deals++;
        out.revenue.ytd.revenue += amountFunded;
      }
      if (dateFunded.slice(0, 7) === thisMonthKey) {
        out.revenue.mtd.deals++;
        out.revenue.mtd.revenue += amountFunded;
      }
      var monthKey = dateFunded.slice(0, 7);
      if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { deals: 0, revenue: 0 };
      monthlyMap[monthKey].deals++;
      monthlyMap[monthKey].revenue += amountFunded;
    }

    // ─── Funded bucket (flow event, honors date range) ───
    if (fundedInRange) {
      out.pipeline.funded++;
      out.pipeline.closed++;  // funded deals are also closed
      out.revenue.range.deals++;
      out.revenue.range.revenue += amountFunded;
      if (amountFunded > 0) rangeAmounts.push(amountFunded);
    }

    // ─── Assigned bucket (flow event, honors date range) ───
    // Counted independently of funded status so a deal that moved all the
    // way through (assigned → funded) shows up in both metrics.
    if (dateAssigned) {
      if (assignedInRange) out.pipeline.assigned++;
    } else if (!hasDateFilter && statusSuggestsAssigned && !dateFunded) {
      // Legacy record: status says it's under contract but Date Assigned
      // isn't populated. Count it only in the default all-time view since
      // we don't know when the assignment happened.
      out.pipeline.assigned++;
    }

    // ─── Active bucket (current snapshot) ───
    if (isActivelyMarketing && !dateFunded) {
      out.pipeline.active++;
      out.pipeline.byType[dealType] = (out.pipeline.byType[dealType] || 0) + 1;
      activeDeals.push(page);
    }

    // ─── Dead bucket (current snapshot) ───
    if (isDead) {
      out.pipeline.dead++;
    }

    // ─── Legacy closed: status=Closed with no Date Funded ───
    // Only count in the default view. Anything with Date Funded already
    // hit the funded bucket above which also bumps closed.
    if (!hasDateFilter && !dateFunded && status === 'Closed') {
      out.pipeline.closed++;
    }
  });

  // Finalize dropdown options (sorted, case-stable)
  out.filters.availableDealTypes = Object.keys(dealTypesSet).sort();
  out.filters.availableStates = Object.keys(statesSet).sort();

  // Finalize revenue — avgDealSize reflects the active filter when set,
  // otherwise falls back to all-time so the default view keeps working.
  if (rangeAmounts.length) {
    var sum = rangeAmounts.reduce(function (a, b) { return a + b; }, 0);
    out.revenue.avgDealSize = Math.round(sum / rangeAmounts.length);
  } else if (!hasDateFilter && out.revenue.allTime.deals > 0) {
    out.revenue.avgDealSize = Math.round(out.revenue.allTime.revenue / out.revenue.allTime.deals);
  }

  // 12-month trend (fill in zero months so the chart is continuous)
  var months = [];
  for (var i = 11; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    months.push({
      month: key,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      deals: (monthlyMap[key] && monthlyMap[key].deals) || 0,
      revenue: (monthlyMap[key] && monthlyMap[key].revenue) || 0
    });
  }
  out.revenue.monthly = months;

  // Sort active deals newest-first (notify-buyers uses last_edited_time)
  activeDeals.sort(function (a, b) {
    return new Date(b.last_edited_time || 0) - new Date(a.last_edited_time || 0);
  });
  var topActive = activeDeals.slice(0, PER_DEAL_LIMIT);

  // ─ GHL: global engagement counters (parallel) ─
  var globalCountPromises = [];
  if (ghlKey && locationId) {
    globalCountPromises = [
      ghlTagCount(ghlKey, locationId, 'new-deal-alert'),
      ghlTagCount(ghlKey, locationId, 'Active Viewer'),
      ghlTagCount(ghlKey, locationId, 'buyer-interested'),
      ghlTagCount(ghlKey, locationId, 'buyer-pass'),
      ghlTagCount(ghlKey, locationId, 'alerts-paused')
    ];
  } else {
    out.errors.push('ghl: credentials missing');
  }

  // ─ GHL: per-deal engagement (parallel with global counters) ─
  var perDealPromises = topActive.map(function (page) {
    var dealCode = prop(page, 'Deal ID') || '';
    var street = prop(page, 'Street Address');
    var city = prop(page, 'City');
    var state = prop(page, 'State');
    var dealType = prop(page, 'Deal Type');
    var askingPrice = +prop(page, 'Asking Price') || 0;
    var startedMarketing = prop(page, 'Started Marketing') || '';
    var slug = slugifyAddress(street, city, state);
    var codeLower = lowercaseCode(dealCode);

    var daysOnMarket = null;
    if (startedMarketing) {
      var start = new Date(startedMarketing);
      if (!isNaN(start)) {
        daysOnMarket = Math.max(0, Math.floor((now - start) / (24 * 60 * 60 * 1000)));
      }
    }

    var meta = {
      id: page.id,
      dealCode: dealCode,
      dealType: dealType,
      city: city,
      state: state,
      askingPrice: askingPrice,
      startedMarketing: startedMarketing,
      daysOnMarket: daysOnMarket,
      slug: slug
    };

    if (!ghlKey || !locationId) {
      return Promise.resolve(Object.assign(meta, { sent: 0, viewed: 0, interested: 0 }));
    }

    // Three parallel count queries per deal.
    var sentP = slug ? ghlTagCount(ghlKey, locationId, 'sent:' + slug) : Promise.resolve(0);
    var viewedP = codeLower ? ghlTagCount(ghlKey, locationId, 'viewed-' + codeLower) : Promise.resolve(0);
    var interestedP = codeLower ? ghlTagCount(ghlKey, locationId, 'alert-' + codeLower) : Promise.resolve(0);

    return Promise.all([sentP, viewedP, interestedP]).then(function (vals) {
      return Object.assign(meta, { sent: vals[0], viewed: vals[1], interested: vals[2] });
    });
  });

  // Fire everything in parallel
  try {
    var all = await Promise.all([Promise.all(globalCountPromises), Promise.all(perDealPromises)]);
    var globals = all[0] || [];
    var dealEngagement = all[1] || [];

    if (globals.length === 5) {
      out.engagement.totalSent = globals[0];
      out.engagement.totalViewed = globals[1];
      out.engagement.totalInterested = globals[2];
      out.engagement.totalPassed = globals[3];
      out.engagement.totalPaused = globals[4];
    }

    // Funnel rates (guard against divide-by-zero)
    if (out.engagement.totalSent > 0) {
      out.engagement.viewRate = Math.round((out.engagement.totalViewed / out.engagement.totalSent) * 1000) / 10;
      out.engagement.conversionRate = Math.round((out.engagement.totalInterested / out.engagement.totalSent) * 1000) / 10;
    }

    // Per-deal funnel rates
    out.deals = dealEngagement.map(function (d) {
      var viewRate = d.sent > 0 ? Math.round((d.viewed / d.sent) * 1000) / 10 : 0;
      var conversionRate = d.sent > 0 ? Math.round((d.interested / d.sent) * 1000) / 10 : 0;
      return Object.assign(d, { viewRate: viewRate, conversionRate: conversionRate });
    });
  } catch (e) {
    out.errors.push('engagement: ' + e.message);
  }

  return { statusCode: 200, headers: headers, body: JSON.stringify(out) };
};
