// Click-tracking redirect. Logs the click to Notion, then 302s to the deal page.
//
// Usage in blasts:
//   https://termsforsale.com/r/CMF-001?c={{contact.id}}&ch=sms
//
// Query params:
//   (path)  dealCode  — from /r/:dealCode
//   c       contactId — GHL contact ID (optional but recommended)
//   e       email     — fallback if no contactId
//   ch      channel   — 'sms' | 'email' | 'pandadoc' | 'social' (optional)
//
// Redirect target: https://termsforsale.com/commercial-deal.html?code=DEALCODE

const DEFAULT_TARGET = 'https://termsforsale.com/commercial-deal.html';

function redirect(url) {
  return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
}

async function logClickToNotion({ dealCode, contactId, email, channel, userAgent, ip }) {
  const dbId = process.env.NOTION_LINK_CLICKS_DB_ID;
  const apiKey = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (!dbId || !apiKey) {
    console.warn('Notion env not set — click not logged');
    return;
  }
  const now = new Date().toISOString();
  const clickId = `${dealCode}-${contactId || email || 'anon'}-${Date.now()}`;
  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
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
    const json = await res.json();
    console.log('Notion response:', res.status, JSON.stringify(json).slice(0, 500));
  } catch (e) {
    console.error('Notion log click failed:', e.message);
  }
}

exports.handler = async (event) => {
  // Deal code comes from the ?d= query param (Netlify rewrite maps /r/:dealCode → ?d=:dealCode)

  const q = event.queryStringParameters || {};
  const pathMatch = (event.rawUrl || event.path || '').match(/\/r\/([^/?]+)/i);
  const dealCode = (pathMatch ? pathMatch[1] : q.d || '').toUpperCase();
  const contactId = q.c || '';
  const email = q.e || '';
  const channel = q.ch || '';

  // Fire-and-forget log (don't block the redirect)
  const userAgent = (event.headers && event.headers['user-agent']) || '';
  const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || '';
  logClickToNotion({ dealCode, contactId, email, channel, userAgent, ip }).catch((e) => { console.error('Click log error:', e.message); });

  const target = dealCode
    ? `${DEFAULT_TARGET}?code=${encodeURIComponent(dealCode)}`
    : DEFAULT_TARGET;
  return redirect(target);
};
