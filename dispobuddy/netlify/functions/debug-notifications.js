/**
 * Debug endpoint — tests GHL SMS + Email sending
 * GET /api/debug-notifications?contactId=xxx
 *
 * Returns the raw GHL API responses so we can see exactly what's failing.
 * DELETE THIS FUNCTION after debugging.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'GET only' });
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const contactId  = (event.queryStringParameters || {}).contactId;

  if (!apiKey || !locationId) {
    return respond(500, { error: 'Missing env vars' });
  }

  if (!contactId) {
    return respond(400, { error: 'Pass ?contactId=xxx (use a test contact ID from GHL)' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const results = {};

  // 1. Check the contact exists
  try {
    const contactRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers });
    const contactData = await contactRes.json();
    results.contact = {
      status: contactRes.status,
      name: contactData.contact?.firstName + ' ' + contactData.contact?.lastName,
      email: contactData.contact?.email,
      phone: contactData.contact?.phone,
    };
  } catch (err) {
    results.contact = { error: err.message };
  }

  // 2. Test SMS
  try {
    const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'SMS',
        contactId,
        message: 'Dispo Buddy test SMS — if you see this, SMS is working! You can ignore this.',
      }),
    });
    const smsData = await smsRes.json();
    results.sms = { status: smsRes.status, response: smsData };
  } catch (err) {
    results.sms = { error: err.message };
  }

  // 3. Test Email (try multiple payload formats)

  // Format A: with emailFrom
  try {
    const emailRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'Email',
        contactId,
        subject: 'Dispo Buddy Test Email',
        html: '<p>If you see this, email sending is working. You can ignore this test.</p>',
        emailFrom: 'Dispo Buddy <info@dispobuddy.com>',
      }),
    });
    const emailData = await emailRes.json();
    results.email_formatA = { status: emailRes.status, response: emailData };
  } catch (err) {
    results.email_formatA = { error: err.message };
  }

  // Format B: without emailFrom
  try {
    const emailRes2 = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'Email',
        contactId,
        subject: 'Dispo Buddy Test Email (Format B)',
        html: '<p>Test email format B — no emailFrom field.</p>',
      }),
    });
    const emailData2 = await emailRes2.json();
    results.email_formatB = { status: emailRes2.status, response: emailData2 };
  } catch (err) {
    results.email_formatB = { error: err.message };
  }

  // Format C: using message field instead of html
  try {
    const emailRes3 = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'Email',
        contactId,
        subject: 'Dispo Buddy Test Email (Format C)',
        message: 'Test email format C — using message field instead of html.',
      }),
    });
    const emailData3 = await emailRes3.json();
    results.email_formatC = { status: emailRes3.status, response: emailData3 };
  } catch (err) {
    results.email_formatC = { error: err.message };
  }

  // 4. Test creating a note
  try {
    const noteRes = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: 'Debug test note — notifications debug endpoint' }),
    });
    const noteData = await noteRes.json();
    results.note = { status: noteRes.status, response: noteData };
  } catch (err) {
    results.note = { error: err.message };
  }

  return respond(200, results);
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body, null, 2),
  };
}
