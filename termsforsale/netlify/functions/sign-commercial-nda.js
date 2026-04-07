// Netlify function: sign-commercial-nda
// Captures NDA signature, writes to Notion "Commercial NDAs" DB via REST,
// returns an HMAC token valid for 12 months. No npm dependencies.

const crypto = require("crypto");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NDA_DB_ID = process.env.NOTION_COMMERCIAL_NDA_DB_ID;
const HMAC_SECRET = process.env.NDA_HMAC_SECRET;
const NOTION_VERSION = "2022-06-28";

const CORS = {
  "Access-Control-Allow-Origin": "https://deals.termsforsale.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function captureIP(event) {
  const xff = event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"];
  if (xff) return String(xff).split(",")[0].trim();
  return event.headers["client-ip"] || "unknown";
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createHMACToken(email, expiresAt, jti) {
  const payload = { email, exp: Math.floor(expiresAt.getTime() / 1000), jti };
  const payloadStr = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(payloadStr).digest("hex");
  return `${payloadStr}.${sig}`;
}

function rt(text) { return { rich_text: [{ text: { content: String(text || "") } }] }; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "method not allowed" }) };
  }

  if (!NOTION_TOKEN || !NDA_DB_ID || !HMAC_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "server not configured" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { name, email, firm, capital_source, buy_box, signature_name, agreed } = body;

    if (!name || !email || !signature_name) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "name, email, signature_name required" }) };
    }
    if (agreed !== true) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "must agree to NDA" }) };
    }
    if (String(signature_name).trim().toLowerCase() !== String(name).trim().toLowerCase()) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "signature_name must match name" }) };
    }

    const jti = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const ip = captureIP(event);
    const userAgent = event.headers["user-agent"] || event.headers["User-Agent"] || "unknown";

    const properties = {
      "Signer Name": { title: [{ text: { content: name } }] },
      "Email": { email: email },
      "Signed At": { date: { start: now.toISOString() } },
      "Expires At": { date: { start: expiresAt.toISOString() } },
      "IP": rt(ip),
      "User Agent": rt(userAgent),
      "Token JTI": rt(jti),
    };
    if (firm) properties["Firm"] = rt(firm);
    if (buy_box) properties["Buy Box"] = rt(buy_box);
    if (capital_source) properties["Capital Source"] = { select: { name: capital_source } };

    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parent: { database_id: NDA_DB_ID }, properties }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Notion create page failed:", res.status, errText);
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "signature storage failed" }) };
    }

    const token = createHMACToken(email, expiresAt, jti);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ token, expires_at: expiresAt.toISOString() }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
