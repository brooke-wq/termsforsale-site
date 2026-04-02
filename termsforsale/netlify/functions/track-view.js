/**
 * Track Deal View — GET/POST /.netlify/functions/track-view
 *
 * Two modes:
 * 1. GET  ?c=CONTACT_ID&d=DEAL_ID&r=1  → logs view + redirects to deal page (for email links)
 * 2. POST {contactId, dealId, source}   → logs view silently (for frontend JS)
 *
 * Logs a note on the GHL contact and adds a "viewed:DEAL_ID" tag.
 */

const { getContact, postNote, addTags } = require('./_ghl');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return respond(500, { error: 'Server config error' });

  let contactId, dealId, source, redirect;

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    contactId = q.c;
    dealId = q.d;
    source = q.src || 'email';
    redirect = q.r === '1';
  } else if (event.httpMethod === 'POST') {
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

  if (!contactId || !dealId) {
    // If redirect requested but missing params, just send to deal page
    if (redirect && dealId) {
      return { statusCode: 302, headers: { Location: '/deal.html?id=' + encodeURIComponent(dealId) }, body: '' };
    }
    return respond(400, { error: 'Missing contactId or dealId' });
  }

  // Fire tracking in background — don't block the redirect
  const trackPromise = (async () => {
    try {
      // Verify contact exists
      const contact = await getContact(apiKey, contactId);
      if (contact.status >= 400) return;

      const contactName = contact.body && contact.body.contact
        ? (contact.body.contact.firstName || 'Unknown')
        : 'Unknown';

      // Add view tag + note in parallel
      const now = new Date().toISOString().split('T')[0];
      await Promise.all([
        addTags(apiKey, contactId, [
          'viewed:' + dealId.substring(0, 12),
          'Active Viewer',
          'Last View: ' + now
        ]),
        postNote(apiKey, contactId,
          '👁 DEAL VIEWED\n' +
          '─────────────────\n' +
          'Deal ID: ' + dealId + '\n' +
          'Source: ' + source + '\n' +
          'Date: ' + new Date().toISOString() + '\n' +
          'URL: https://deals.termsforsale.com/deal.html?id=' + dealId
        )
      ]);

      console.log('[track-view] ' + contactName + ' viewed ' + dealId + ' via ' + source);
    } catch (err) {
      console.error('[track-view] error:', err.message);
    }
  })();

  // For redirect mode (email links), redirect immediately and track in background
  if (redirect) {
    // We can't truly fire-and-forget in Lambda, so await but redirect fast
    await trackPromise;
    return {
      statusCode: 302,
      headers: { Location: '/deal.html?id=' + encodeURIComponent(dealId) },
      body: ''
    };
  }

  // For POST mode, await and respond
  await trackPromise;
  return respond(200, { ok: true });
};

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
