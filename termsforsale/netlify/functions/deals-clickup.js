// Netlify function: deals-clickup (SPIKE — parallel to deals.js)
//
// Reads the deal pipeline from ClickUp instead of Notion and returns
// the SAME response shape as /api/deals. Lets us A/B the two backends
// without touching any frontend code.
//
// To A/B:
//   curl https://termsforsale.com/api/deals          -> { source: "notion", ... }
//   curl https://termsforsale.com/api/deals-clickup  -> { source: "clickup", ... }
//
// If we decide to cut over, the plan is:
//   1. Rename this file to deals.js (after feature-flagging)
//   2. Keep the old one as deals-notion.js for rollback
//
// Env vars required (set in Netlify dashboard):
//   CLICKUP_API_TOKEN      — workspace-level personal API token
//   CLICKUP_DEALS_LIST_ID  — List ID of the "Deals" List in ClickUp

const {
  listTasks,
  extractField,
  extractStatus,
  extractTitle
} = require('./_clickup');

// Match the Notion endpoint exactly so the frontend keeps working.
var PUBLIC_STATUSES = ['Actively Marketing', 'Assignment Sent', 'Assigned with EMD', 'Closed'];

// Normalize state names to 2-letter abbreviations — lifted byte-for-byte
// from deals.js so the two endpoints produce identical output.
var STATE_ABBREVS = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
  'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO',
  'montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH',
  'oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY'
};

function normalizeState(s) {
  if (!s) return '';
  var trimmed = String(s).trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return STATE_ABBREVS[trimmed.toLowerCase()] || trimmed;
}

// Helper: shorthand for extractField(task, name)
function f(task, name) { return extractField(task, name); }

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=10, stale-while-revalidate=30'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  var token = process.env.CLICKUP_API_TOKEN;
  var listId = process.env.CLICKUP_DEALS_LIST_ID;

  if (!token) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'CLICKUP_API_TOKEN not configured' }) };
  }
  if (!listId) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'CLICKUP_DEALS_LIST_ID not configured' }) };
  }

  try {
    // ClickUp supports server-side status filtering via statuses[]= params.
    // Include closed tasks explicitly — "Closed" is part of PUBLIC_STATUSES
    // and ClickUp hides closed tasks from lists by default.
    var result = await listTasks(token, listId, {
      statuses: PUBLIC_STATUSES,
      includeClosed: true,
      subtasks: false
    });

    if (!result.ok) {
      var err = result.lastError || {};
      console.error('ClickUp API error:', err.status, JSON.stringify(err.body));
      return {
        statusCode: err.status || 500,
        headers: headers,
        body: JSON.stringify({
          error: 'ClickUp API error',
          status: err.status,
          detail: (err.body && err.body.err) || (err.body && err.body.error) || ''
        })
      };
    }

    var tasks = result.tasks || [];

    // Client-side safety filter in case ClickUp's statuses[] query ignored
    // a status name we asked for (case sensitivity varies by workspace).
    var publicLower = PUBLIC_STATUSES.map(function(s) { return s.toLowerCase(); });
    tasks = tasks.filter(function(t) {
      var st = extractStatus(t).toLowerCase().trim();
      return publicLower.indexOf(st) !== -1;
    });

    // Map ClickUp tasks to the SAME deal shape the frontend already
    // consumes. Field names must match the ClickUp custom-field names
    // set up in the workspace — recommend using the same names as the
    // Notion properties so this mapping reads naturally and a backfill
    // script can round-trip cleanly.
    var deals = tasks.map(function(task) {
      var rent = f(task, 'LTR Market Rent');
      return {
        id: task.id,
        dealCode: f(task, 'Deal ID') || task.custom_id || '',
        dealType: f(task, 'Deal Type'),
        dealStatus: extractStatus(task),
        streetAddress: extractTitle(task),           // task title = street address (like Notion)
        city: f(task, 'City'),
        state: normalizeState(f(task, 'State')),
        zip: f(task, 'ZIP'),
        county: f(task, 'County'),
        nearestMetro: f(task, 'Nearest Metro') || f(task, 'Nearest Metro Area'),
        propertyType: f(task, 'Property Type'),
        askingPrice: +f(task, 'Asking Price') || 0,
        entryFee: +f(task, 'Entry Fee') || 0,
        compsArv: +f(task, 'ARV') || +f(task, 'Comps ARV') || 0,
        loanType: f(task, 'Loan Type'),
        subtoLoanBalance: +f(task, 'SubTo Loan Balance') || '',
        subtoRate: +f(task, 'SubTo Rate (%)') || '',
        piti: +f(task, 'PITI') || +f(task, 'PITI ') || '',
        subtoLoanMaturity: f(task, 'SubTo Loan Maturity'),
        subToBalloon: f(task, 'SubTo Balloon'),
        sfLoanAmount: +f(task, 'SF Loan Amount') || '',
        sfRate: f(task, 'SF Rate'),
        sfTerm: f(task, 'SF Term'),
        sfPayment: +f(task, 'SF Payment') || '',
        sfBalloon: f(task, 'SF Balloon'),
        rentFinal: +rent || '',
        rentLow: '',
        rentMid: '',
        rentHigh: '',
        occupancy: f(task, 'Occupancy'),
        hoa: f(task, 'HOA'),
        solar: f(task, 'Solar'),
        beds: f(task, 'Beds'),
        baths: f(task, 'Baths'),
        sqft: f(task, 'Living Area') || f(task, 'Sqft'),
        yearBuilt: f(task, 'Year Built') || f(task, 'Year Build'),
        access: f(task, 'Access'),
        coe: f(task, 'COE'),
        photos: f(task, 'Photos'),
        coverPhoto: f(task, 'Cover Photo') || f(task, 'Cover photo'),
        highlight1: f(task, 'Highlight 1'),
        highlight2: f(task, 'Highlight 2'),
        highlight3: f(task, 'Highlight 3'),
        details: f(task, 'Details') || f(task, 'Details '),
        description: task.description || f(task, 'Description') || f(task, 'Property Description') || f(task, 'Summary') || '',
        entryBreakdown: f(task, 'Entry Breakdown'),
        parking: f(task, 'Parking'),
        dateFunded: f(task, 'Date Funded'),
        dateAssigned: f(task, 'Date Assigned'),
        amountFunded: +f(task, 'Amount Funded') || 0,
        lastEdited: task.date_updated ? new Date(+task.date_updated).toISOString() : ''
      };
    });

    // Sort newest-first (matches Notion's last_edited_time DESC sort)
    deals.sort(function(a, b) {
      return (b.lastEdited || '').localeCompare(a.lastEdited || '');
    });

    console.log('ClickUp API success: ' + deals.length + ' public deals across ' + result.pages + ' page(s)');

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ deals: deals, count: deals.length, source: 'clickup' })
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
