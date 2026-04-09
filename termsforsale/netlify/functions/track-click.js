// Click-tracking redirect. Logs the click to Notion, then 302s to the deal page.
//
// Usage in blasts:
//   https://deals.termsforsale.com/r/CMF-001?c={{contact.id}}&ch=sms
//
// Query params:
//   (path)  dealCode  — from /r/:dealCode
//   c       contactId — GHL contact ID (optional but recommended)
//   e       email     — fallback if no contactId
//   ch      channel   — 'sms' | 'email' | 'pandadoc' | 'social' (optional)
//
// Redirect target: https://deals.termsforsale.com/commercial-deal.html?code=DEALCODE

const DEFAULT_TARGET = 'https://deals.termsforsale.com/commercial-deal.html';

function redirect(url) {
  return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
}

async function logClickToNotion({ dealCode, contactId, email, channel, userAgent, ip }) {
  const dbId = process.env.NOTION_LINK_CLICKS_DB_ID;
  const apiKey = process.env.NOTION_API_KEY;
  if (!dbId || !apiKey) {
    console.warn('Notion env not set — click not logged');
    return;
  }
  const now = new Date().toISOString();
  const clickId = `${dealCode}-${contactId || email || 'anon'}-${Date.now()}`;
  try {
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          'Click ID':     { title:     [{ text: { content: clickId } }] },
          'Deal Code':    { rich_text: [{ text: { content: dealCode || '' } }] },
          'Contact ID':   { rich_text: [{ text: { content: contactId || '' } }] },
          'Contact Email':{ rich_text: [{ text: { content: email || '' } }] },
          'Channel':      { rich_text: [{ text: { content: channel || '' } }] },
          'User Agent':   { rich_text: [{ text: { content: (userAgent || '').slice(0, 300) } }] },
          'IP':           { rich_text: [{ text: { content: ip || '' } }] },
          'Clicked At':   { date: { start: now } },
        },
      }),
    });
  } catch (e) {
    console.error('Notion log click failed:', e.message);
  }
}

exports.handler = async (event) => {
  // Path comes in as /r/CMF-001 — extract the deal code
  const path = event.path || '';
  const match = path.match(/\/r\/([A-Za-z0-9-]+)/);
  const dealCode = (match?.[1] || '').toUpperCase();

  const q = event.queryStringParameters || {};
  const contactId = q.c || '';
  const email = q.e || '';
  const channel = q.ch || '';

  const userAgent = event.headers['user-agent'] || '';
  const ip = event.headers['x-forwarded-for']?.split(',')[0] || event.headers['client-ip'] || '';

  // Fire-and-forget log (don't block the redirect)
  logClickToNotion({ dealCode, contactId, email, channel, userAgent, ip }).catch(() => {});

  const target = dealCode
    ? `${DEFAULT_TARGET}?code=${encodeURIComponent(dealCode)}`
    : DEFAULT_TARGET;
  return redirect(target);
};
