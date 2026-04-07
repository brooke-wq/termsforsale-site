// Validates a tokenized data room link and returns the actual Google Drive URL.
//
// CRITICAL: The raw drive URL lives ONLY in Notion (private column data_room_url
// on the Commercial Deals DB). It is NEVER stored in client code, never returned
// in any other endpoint, and never logged in plain text.
//
// Flow:
//   GET /.netlify/functions/data-room-resolve?token=XXX
//   → verify token signature + expiry
//   → look up the deal in Notion by deal_code
//   → return { ok: true, url: "https://drive.google.com/..." }
//
// The data-room.html page calls this and immediately redirects on success.

const { verify } = require('./_token');
const { isTest } = require('./_ghl');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

async function fetchDealFromNotion(dealCode) {
  if (isTest()) {
    return { dataRoomUrl: 'https://drive.google.com/drive/folders/TEST_FOLDER_ID', cimUrl: '' };
  }
  const dbId = process.env.NOTION_COMMERCIAL_DB_ID;
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      filter: {
        property: 'Deal Code',
        rich_text: { equals: dealCode },
      },
    }),
  });
  const data = await res.json();
  const page = (data.results || [])[0];
  if (!page) return null;
  const props = page.properties || {};
  // Try multiple property name variants
  const dataRoomProp = props['Data Room URL (PRIVATE)'] || props['Data Room URL'] || props['data_room_url'];
  const cimProp = props['CIM URL (PRIVATE)'] || props['CIM URL'] || props['cim_url'];
  const extract = (p) => {
    if (!p) return '';
    if (p.url) return p.url;
    if (p.rich_text?.[0]?.plain_text) return p.rich_text[0].plain_text;
    return '';
  };
  return {
    dataRoomUrl: extract(dataRoomProp),
    cimUrl: extract(cimProp),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const token = event.queryStringParameters?.token;
  const result = verify(token);

  if (!result.valid) {
    return json(403, {
      ok: false,
      reason: result.reason,
      expired: result.reason === 'expired',
      // If expired, return the deal code so the page can offer self-serve reissue
      dealCode: result.data?.dc || null,
      contactId: result.data?.ci || null,
    });
  }

  const { dc: dealCode, ci: contactId } = result.data;
  try {
    const deal = await fetchDealFromNotion(dealCode);
    if (!deal || !deal.dataRoomUrl) {
      return json(404, { ok: false, error: 'Data room not configured for this deal' });
    }
    // Audit: log the access (best-effort, don't block on failure)
    console.log('DATA_ROOM_ACCESS', { dealCode, contactId, ts: new Date().toISOString() });

    return json(200, {
      ok: true,
      url: deal.dataRoomUrl,
      cimUrl: deal.cimUrl || null,
      dealCode,
    });
  } catch (e) {
    console.error('data-room-resolve error', e);
    return json(500, { ok: false, error: e.message });
  }
};
