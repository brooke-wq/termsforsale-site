// Netlify function: revenue-tracker
// Scheduled: 0 14 1 * * (1st of each month, 7am Arizona = 14:00 UTC)
// Generates monthly P&L summary from Notion deals with Date Funded set.
// Groups by month, calculates revenue, deal counts, comparisons, YTD.
// Uses Claude for narrative analysis.
//
// ENV VARS: ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_DB_ID

const { complete } = require('./_claude');

exports.config = { schedule: '0 14 1 * *' };

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

async function getFundedDeals(token, dbId) {
  var all = [];
  var cursor;
  do {
    var body = {
      filter: {
        property: 'Date Funded',
        date: { is_not_empty: true }
      },
      page_size: 100
    };
    if (cursor) body.start_cursor = cursor;
    var result = await notionQuery(token, dbId, body);
    if (result.status !== 200) {
      console.error('revenue-tracker: Notion error', result.status, JSON.stringify(result.body));
      break;
    }
    all = all.concat(result.body.results || []);
    cursor = result.body.has_more ? result.body.next_cursor : null;
  } while (cursor);
  return all;
}

// ─── Grouping + calculations ──────────────────────────────────

function buildMonthlyData(deals) {
  var byMonth = {};

  deals.forEach(function(page) {
    var dateFunded = prop(page, 'Date Funded');
    var amount     = prop(page, 'Amount Funded');
    var dealType   = prop(page, 'Deal Type') || 'Unknown';
    var source     = prop(page, 'Lead Source') || 'Unknown';

    if (!dateFunded) return;

    // Extract YYYY-MM key
    var monthKey = dateFunded.slice(0, 7);
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { deals: 0, revenue: 0, amounts: [], dealTypes: {}, sources: {} };
    }

    var m = byMonth[monthKey];
    m.deals++;

    if (amount !== '' && !isNaN(+amount)) {
      m.revenue += +amount;
      m.amounts.push(+amount);
    }

    m.dealTypes[dealType] = (m.dealTypes[dealType] || 0) + 1;
    m.sources[source] = (m.sources[source] || 0) + 1;
  });

  // Finalize each month
  var months = Object.keys(byMonth).sort();
  var result = {};

  months.forEach(function(key) {
    var m = byMonth[key];
    var avgDeal = m.amounts.length ? Math.round(m.revenue / m.amounts.length) : 0;

    // Top sources sorted by count
    var topSources = Object.keys(m.sources).sort(function(a, b) {
      return m.sources[b] - m.sources[a];
    }).slice(0, 5).map(function(s) {
      return { source: s, count: m.sources[s] };
    });

    result[key] = {
      deals: m.deals,
      revenue: m.revenue,
      avgDealSize: avgDeal,
      dealTypes: m.dealTypes,
      topSources: topSources
    };
  });

  return result;
}

function calculateComparisons(monthlyData) {
  var months = Object.keys(monthlyData).sort();
  var now = new Date();
  var currentMonthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var prevMonthKey = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  var current = monthlyData[currentMonthKey] || { deals: 0, revenue: 0, avgDealSize: 0 };
  var previous = monthlyData[prevMonthKey] || { deals: 0, revenue: 0, avgDealSize: 0 };

  // Month-over-month change
  var revenueChange = previous.revenue > 0
    ? Math.round(((current.revenue - previous.revenue) / previous.revenue) * 1000) / 10
    : null;
  var dealsChange = previous.deals > 0
    ? Math.round(((current.deals - previous.deals) / previous.deals) * 1000) / 10
    : null;

  // Year-to-date
  var yearPrefix = String(now.getFullYear());
  var ytdDeals = 0;
  var ytdRevenue = 0;
  months.forEach(function(key) {
    if (key.startsWith(yearPrefix)) {
      ytdDeals += monthlyData[key].deals;
      ytdRevenue += monthlyData[key].revenue;
    }
  });

  // Running 3-month average
  var last3 = months.filter(function(key) {
    return key <= currentMonthKey;
  }).slice(-3);

  var avg3Deals = 0;
  var avg3Revenue = 0;
  last3.forEach(function(key) {
    avg3Deals += monthlyData[key].deals;
    avg3Revenue += monthlyData[key].revenue;
  });
  var monthCount = last3.length || 1;

  return {
    currentMonth: { key: currentMonthKey, data: current },
    previousMonth: { key: prevMonthKey, data: previous },
    monthOverMonth: {
      revenueChangePct: revenueChange,
      dealsChangePct: dealsChange
    },
    yearToDate: {
      year: now.getFullYear(),
      deals: ytdDeals,
      revenue: ytdRevenue,
      avgDealSize: ytdDeals > 0 ? Math.round(ytdRevenue / ytdDeals) : 0
    },
    rolling3MonthAvg: {
      months: last3,
      avgDeals: Math.round(avg3Deals / monthCount * 10) / 10,
      avgRevenue: Math.round(avg3Revenue / monthCount)
    }
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

  if (!anthropicKey || !notionToken) {
    console.error('revenue-tracker: missing env vars', {
      anthropic: !!anthropicKey, notion: !!notionToken
    });
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // 1. Fetch all funded deals from Notion
    console.log('revenue-tracker: fetching funded deals from Notion...');
    var deals = await getFundedDeals(notionToken, notionDbId);
    console.log('revenue-tracker: ' + deals.length + ' funded deals');

    // 2. Build monthly data
    var monthlyData = buildMonthlyData(deals);
    var comparisons = calculateComparisons(monthlyData);

    // 3. Build summary for Claude
    var months = Object.keys(monthlyData).sort();
    var recentMonths = months.slice(-6);

    var monthLines = recentMonths.map(function(key) {
      var m = monthlyData[key];
      var typeStr = Object.keys(m.dealTypes).map(function(t) {
        return t + ': ' + m.dealTypes[t];
      }).join(', ');
      var sourceStr = m.topSources.map(function(s) {
        return s.source + ' (' + s.count + ')';
      }).join(', ');
      return key + ': ' + m.deals + ' deals, $' + m.revenue.toLocaleString() + ' revenue, ' +
        'avg $' + m.avgDealSize.toLocaleString() + ' | Types: ' + typeStr + ' | Sources: ' + sourceStr;
    });

    var ytd = comparisons.yearToDate;
    var mom = comparisons.monthOverMonth;
    var r3 = comparisons.rolling3MonthAvg;

    var comparisonText = 'MONTH-OVER-MONTH: Revenue ' +
      (mom.revenueChangePct !== null ? (mom.revenueChangePct >= 0 ? '+' : '') + mom.revenueChangePct + '%' : 'N/A') +
      ', Deals ' +
      (mom.dealsChangePct !== null ? (mom.dealsChangePct >= 0 ? '+' : '') + mom.dealsChangePct + '%' : 'N/A') +
      '\nYEAR-TO-DATE (' + ytd.year + '): ' + ytd.deals + ' deals, $' + ytd.revenue.toLocaleString() +
      ' revenue, avg $' + ytd.avgDealSize.toLocaleString() +
      '\nROLLING 3-MONTH AVG: ' + r3.avgDeals + ' deals/mo, $' + r3.avgRevenue.toLocaleString() + '/mo';

    var systemPrompt = 'You are the financial analyst for Deal Pros LLC, a real estate wholesaling company. ' +
      'Generate concise P&L narratives. Be data-driven, highlight wins and concerns, and project forward. ' +
      'Keep it brief and actionable for the CEO.';

    var userPrompt = 'Generate a P&L narrative for Deal Pros LLC based on this revenue data:\n\n' +
      'MONTHLY BREAKDOWN (last 6 months):\n' +
      (monthLines.length ? monthLines.join('\n') : 'No funded deals yet.') + '\n\n' +
      'COMPARISONS:\n' + comparisonText + '\n\n' +
      'Total funded deals all-time: ' + deals.length + '\n\n' +
      'Provide a brief narrative covering:\n' +
      '1. WINS — What is working, revenue highlights\n' +
      '2. CONCERNS — Declining metrics, concentration risks, gaps\n' +
      '3. PROJECTIONS — Based on the 3-month trend, what to expect next month\n' +
      '4. ACTIONS — 2-3 specific recommendations to grow revenue';

    console.log('revenue-tracker: calling Claude...');
    var claudeRes = await complete(anthropicKey, {
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 700
    });

    console.log('revenue-tracker: narrative generated (' + claudeRes.text.length + ' chars)');

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        success: true,
        generatedAt: new Date().toISOString(),
        totalFundedDeals: deals.length,
        monthlyData: monthlyData,
        comparisons: comparisons,
        narrative: claudeRes.text,
        claudeUsage: claudeRes.usage
      })
    };

  } catch (err) {
    console.error('revenue-tracker error:', err.message);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
