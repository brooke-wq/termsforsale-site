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
        ),
        // NEW: increment buyer_views on the JV partner contact (Dispo Buddy)
        incrementJvPartnerViews(apiKey, dealId)
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

// ─────────────────────────────────────────────────────────────
// INCREMENT BUYER_VIEWS ON JV PARTNER CONTACT
// 1. Fetch Notion deal page
// 2. Read "JV Partner Contact ID" property
// 3. Fetch the matching GHL contact
// 4. Read current buyer_views, add 1, save back
// All non-fatal — track-view should never fail because of this
// ─────────────────────────────────────────────────────────────
async function incrementJvPartnerViews(apiKey, notionDealId) {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return; // Notion not configured, skip silently

  try {
    // 1. Fetch the Notion page
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${notionDealId}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!pageRes.ok) return;
    const page = await pageRes.json();
    const props = page.properties || {};

    // 2. Extract JV Partner Contact ID from rich_text property
    const partnerField = props['JV Partner Contact ID'];
    if (!partnerField || !partnerField.rich_text || partnerField.rich_text.length === 0) return;
    const jvContactId = (partnerField.rich_text[0].plain_text || '').trim();
    if (!jvContactId) return;

    // 3. Fetch the GHL contact to get current buyer_views
    const GHL_BASE = 'https://services.leadconnectorhq.com';
    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };
    const contactRes = await fetch(`${GHL_BASE}/contacts/${jvContactId}`, { headers: ghlHeaders });
    if (!contactRes.ok) return;
    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;
    const cfArray = contact.customFields || [];

    let currentViews = 0;
    for (const f of cfArray) {
      const k = f.fieldKey || f.key || f.name || '';
      if (k === 'buyer_views' || k === 'Buyer Views') {
        currentViews = parseInt(f.value, 10) || 0;
        break;
      }
    }

    // 4. Increment and save
    const newViews = currentViews + 1;
    await fetch(`${GHL_BASE}/contacts/${jvContactId}`, {
      method: 'PUT',
      headers: ghlHeaders,
      body: JSON.stringify({
        customFields: [{ key: 'buyer_views', field_value: String(newViews) }],
      }),
    });
    console.log('[track-view] incremented buyer_views to', newViews, 'on JV partner', jvContactId);
  } catch (err) {
    console.warn('[track-view] incrementJvPartnerViews failed:', err.message);
  }
}
