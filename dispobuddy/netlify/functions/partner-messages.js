/**
 * Dispo Buddy — Partner Messages
 * GET  /.netlify/functions/partner-messages?contactId=xxx
 *   Returns recent SMS + email conversation with the contact
 * POST /.netlify/functions/partner-messages
 *   { contactId, message } — sends SMS to contact (gated by NOTIFICATIONS_LIVE)
 *
 * Required env vars: GHL_API_KEY, GHL_LOCATION_ID
 * Optional: NOTIFICATIONS_LIVE (must be 'true' to actually send outbound)
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }
  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    if (event.httpMethod === 'GET') {
      const contactId = event.queryStringParameters?.contactId;
      if (!contactId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'contactId required' }) };
      }
      return await handleGet(contactId, ghlHeaders, locationId, headers);
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body); }
      catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
      if (!body.contactId || !body.message) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'contactId and message required' }) };
      }
      return await handlePost(body.contactId, body.message, ghlHeaders, headers);
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('Partner messages error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function handleGet(contactId, ghlHeaders, locationId, respHeaders) {
  // Fetch conversations for this contact
  const convRes = await fetch(
    `${GHL_BASE}/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=5`,
    { headers: ghlHeaders }
  );
  const convData = await convRes.json();
  if (!convRes.ok) {
    console.warn('Conversations search failed:', convRes.status, JSON.stringify(convData).substring(0, 300));
    return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, messages: [] }) };
  }

  const conversations = convData.conversations || [];
  if (conversations.length === 0) {
    return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, messages: [] }) };
  }

  // Use the most recent conversation
  const convId = conversations[0].id;
  const msgRes = await fetch(
    `${GHL_BASE}/conversations/${convId}/messages?limit=50`,
    { headers: ghlHeaders }
  );
  const msgData = await msgRes.json();
  const rawMessages = msgData.messages?.messages || msgData.messages || [];

  // Transform to friendly format
  const messages = rawMessages.map(m => ({
    id: m.id,
    type: m.type || m.messageType || 'SMS',
    direction: m.direction || (m.type === 1 || m.messageType === 'SMS' ? 'outbound' : 'inbound'),
    body: m.body || m.message || '',
    subject: m.subject || '',
    status: m.status || '',
    createdAt: m.dateAdded || m.createdAt,
    fromMe: false, // partner doesn't send anything directly through here in v1
  })).filter(m => m.body || m.subject);

  // Sort oldest → newest
  messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return {
    statusCode: 200,
    headers: respHeaders,
    body: JSON.stringify({ success: true, messages, conversationId: convId }),
  };
}

async function handlePost(contactId, message, ghlHeaders, respHeaders) {
  const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
  if (!isLive) {
    console.log('NOTIFICATIONS_LIVE is not true — message not sent (dry run):', message.substring(0, 100));
    // Fire a note to the contact so the team sees it even in test mode
    try {
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify({ body: '[Partner Portal message - test mode]\n' + message }),
      });
    } catch(e) { /* non-fatal */ }
    return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: false, testMode: true }) };
  }

  // Live: send as SMS to contact
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders,
    body: JSON.stringify({
      type: 'SMS',
      contactId,
      message: '[Portal] ' + message,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('SMS send failed:', res.status, JSON.stringify(data));
    return { statusCode: 502, headers: respHeaders, body: JSON.stringify({ error: 'Failed to send message' }) };
  }
  return { statusCode: 200, headers: respHeaders, body: JSON.stringify({ success: true, sent: true }) };
}
