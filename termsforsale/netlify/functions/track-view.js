/**
 * Track Deal View — GET/POST /.netlify/functions/track-view
 *
 * Two modes:
 * 1. GET  ?c=CONTACT_ID&d=DEAL_ID[&r=1]  → logs view + 302s to the deal page
 *    (r=1 is legacy; GET always redirects now so SMS clients that strip
 *    the trailing param still land users on the deal page.)
 * 2. POST {contactId, dealId, source}    → logs view silently (frontend JS)
 *
 * IMPORTANT: In GET/redirect mode the tracking work is time-boxed to
 * TRACK_TIMEOUT_MS so a slow GHL/Notion call can never stall the redirect.
 * Netlify functions have a 10s hard limit — blocking the redirect on
 * multiple serial API hops caused every track-view link to hang for users.
 */

const { postNote, addTags } = require('./_ghl');

// Cap how long we'll wait for tracking writes before firing the 302.
// Must stay well below Netlify's 10s function timeout.
const TRACK_TIMEOUT_MS = 1500;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const apiKey = process.env.GHL_API_KEY;

  let contactId, dealId, source, isGet;

  if (event.httpMethod === 'GET') {
    isGet = true;
    const q = event.queryStringParameters || {};
    contactId = q.c;
    dealId = q.d;
    source = q.src || 'email';
  } else if (event.httpMethod === 'POST') {
    isGet = false;
    try {
      const body = JSON.parse(event.body);
      contactId = body.contactId;
      dealId = body.dealId;
      source = body.source || 'website';
    } catch (e) {
      return respond(400, { error: 'Invalid JSON' });
    }
  } else {
    return respond(405, { error: 'Method not allowed' });
  }

  // GET mode ALWAYS redirects — even if params are missing or GHL is down.
  // The tracking is best-effort; the redirect is the contract with the user.
  if (isGet) {
    // If we got a dealId, always redirect to that deal (even if contactId or
    // apiKey is missing — those only affect tracking, not navigation).
    const location = dealId
      ? '/deal.html?id=' + encodeURIComponent(dealId)
      : '/deals.html';

    // Fire tracking in the background, capped at TRACK_TIMEOUT_MS.
    if (apiKey && contactId && dealId) {
      await raceWithTimeout(
        trackView(apiKey, contactId, dealId, source),
        TRACK_TIMEOUT_MS
      );
    }

    return {
      statusCode: 302,
      headers: {
        Location: location,
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  }

  // POST mode — await full tracking and return JSON.
  if (!apiKey) return respond(500, { error: 'Server config error' });
  if (!contactId || !dealId) return respond(400, { error: 'Missing contactId or dealId' });

  try {
    await trackView(apiKey, contactId, dealId, source);
    return respond(200, { ok: true });
  } catch (err) {
    console.error('[track-view] POST error:', err.message);
    return respond(500, { error: err.message });
  }
};

// Write the tag + note to GHL. Never throws — errors are logged.
async function trackView(apiKey, contactId, dealId, source) {
  try {
    const now = new Date().toISOString().split('T')[0];
    await Promise.all([
      addTags(apiKey, contactId, [
        'viewed:' + dealId.substring(0, 12),
        'Active Viewer',
        'Last View: ' + now,
      ]),
      postNote(apiKey, contactId,
        '👁 DEAL VIEWED\n' +
        '─────────────────\n' +
        'Deal ID: ' + dealId + '\n' +
        'Source: ' + source + '\n' +
        'Date: ' + new Date().toISOString() + '\n' +
        'URL: https://deals.termsforsale.com/deal.html?id=' + dealId
      ),
    ]);
    console.log('[track-view] tracked ' + contactId + ' → ' + dealId + ' (' + source + ')');
  } catch (err) {
    console.error('[track-view] tracking error:', err.message);
  }
}

// Resolve when p resolves OR after ms milliseconds — whichever comes first.
// Never rejects. Used so the redirect is never blocked by a hanging API call.
function raceWithTimeout(p, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, ms);
    Promise.resolve(p)
      .catch((err) => console.error('[track-view] background error:', err.message))
      .finally(() => { clearTimeout(timer); finish(); });
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
