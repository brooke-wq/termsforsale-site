// Netlify function: commercial-deal
// Returns a single commercial deal by code. Public fields always,
// private fields (address, CIM URL, Data Room URL) only when a valid
// HMAC NDA token is presented via Authorization: Bearer <token>.
// Uses plain fetch against Notion REST API — no npm dependencies.

const crypto = require("crypto");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DEALS_DB_ID = process.env.NOTION_COMMERCIAL_DB_ID;
const HMAC_SECRET = process.env.NDA_HMAC_SECRET;
const NOTION_VERSION = "2022-06-28";

const ALLOWED_ORIGINS = [
  "https://termsforsale.com",
  "https://www.termsforsale.com",
  "https://deals.termsforsale.com",
];

function cors(event) {
  const origin = (event && event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const allowOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : "https://termsforsale.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };
}

function constantTimeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString();
}

function verifyToken(token) {
  if (!token || !HMAC_SECRET) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadStr, signature] = parts;
    const expected = crypto.createHmac("sha256", HMAC_SECRET).update(payloadStr).digest("hex");
    if (!constantTimeCompare(signature, expected)) return null;
    const payload = JSON.parse(b64urlDecode(payloadStr));
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function pickRichText(prop) {
  if (!prop) return "";
  if (prop.rich_text?.length) return prop.rich_text.map(t => t.plain_text).join("");
  if (prop.title?.length) return prop.title.map(t => t.plain_text).join("");
  return "";
}
function pickSelect(prop) { return prop?.select?.name || ""; }
function pickUrl(prop) { return prop?.url || null; }

async function queryDealByCode(code) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DEALS_DB_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: { property: "Deal Code", title: { equals: code } },
      page_size: 1,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Notion query failed:", res.status, errText);
    return null;
  }
  const data = await res.json();
  if (!data.results?.length) return null;
  return data.results[0];
}

function buildPublicDeal(page) {
  const p = page.properties || {};
  return {
    code: pickRichText(p["Deal Code"]),
    headline: pickRichText(p["Headline"]) || pickRichText(p["Metro"]) || "Commercial Deal",
    metro: pickRichText(p["Metro"]),
    submarket: pickRichText(p["Submarket"]),
    propertyType: pickSelect(p["Property Type"]) || pickRichText(p["Property Type"]),
    priceRange: pickRichText(p["Price Range"]),
    noiRange: pickRichText(p["NOI Range"]),
    capRate: pickRichText(p["Cap Rate"]) || pickRichText(p["Cap Rate Range"]),
    unitsOrSqft: pickRichText(p["Units or Sqft"]),
    vintageClass: pickRichText(p["Vintage / Class"]) || pickRichText(p["Vintage Class"]),
    dealStory: [
      pickRichText(p["Deal Story 1"]),
      pickRichText(p["Deal Story 2"]),
      pickRichText(p["Deal Story 3"]),
    ].filter(Boolean),
    structureSummary: pickRichText(p["Structure Summary"]),
  };
}

exports.handler = async (event) => {
  const CORS = cors(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "method not allowed" }) };
  }
  if (!NOTION_TOKEN || !DEALS_DB_ID) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "server not configured" }) };
  }

  try {
    const code = (event.queryStringParameters || {}).code;
    if (!code) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "code query parameter required" }) };
    }

    const page = await queryDealByCode(code);
    if (!page) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "deal not found" }) };
    }

    const deal = buildPublicDeal(page);

    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = tokenMatch ? tokenMatch[1] : null;
    const payload = token ? verifyToken(token) : null;
    const unlocked = !!payload;

    if (unlocked) {
      const p = page.properties || {};
      deal.address = pickRichText(p["Address PRIVATE"]) || pickRichText(p["Address (PRIVATE)"]);
      deal.cimUrl = pickUrl(p["CIM URL PRIVATE"]) || pickUrl(p["CIM URL (PRIVATE)"]);
      deal.dataRoomUrl = pickUrl(p["Data Room URL PRIVATE"]) || pickUrl(p["Data Room URL (PRIVATE)"]);
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ deal, unlocked }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
