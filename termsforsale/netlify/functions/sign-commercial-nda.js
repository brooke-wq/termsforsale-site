const { Client } = require("@notionhq/client");
const crypto = require("crypto");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NDA_DB_ID = process.env.NOTION_COMMERCIAL_NDA_DB_ID;
const HMAC_SECRET = process.env.NDA_HMAC_SECRET;

function captureIP(event) {
  return (
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown"
  );
}

function createHMACToken(email, expiresAt, jti) {
  const payload = {
    email,
    exp: Math.floor(expiresAt.getTime() / 1000),
    jti,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(payloadStr)
    .digest("hex");
  return `${payloadStr}.${hmac}`;
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "https://deals.termsforsale.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { name, email, firm, capital_source, buy_box, signature_name, agreed } = body;

    // Validation
    if (!name || !email || !signature_name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "name, email, signature_name required" }),
      };
    }

    if (agreed !== true) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "must agree to NDA" }),
      };
    }

    if (signature_name !== name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "signature_name must match name" }),
      };
    }

    // Generate JTI and expiry (12 months)
    const jti = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const signedAt = now;

    // Capture IP and User-Agent
    const ip = captureIP(event);
    const userAgent = event.headers["user-agent"] || "unknown";

    // Create Notion page in Commercial NDAs DB
    const notionPage = await notion.pages.create({
      parent: { database_id: NDA_DB_ID },
      properties: {
        "Signer Name": { title: [{ text: { content: name } }] },
        Email: { email },
        Firm: firm ? { rich_text: [{ text: { content: firm } }] } : undefined,
        "Capital Source": capital_source
          ? { select: { name: capital_source } }
          : undefined,
        "Buy Box": buy_box
          ? { rich_text: [{ text: { content: buy_box } }] }
          : undefined,
        "Signed At": {
          date: { start: signedAt.toISOString().split("T")[0] },
        },
        "Expires At": {
          date: { start: expiresAt.toISOString().split("T")[0] },
        },
        IP: { rich_text: [{ text: { content: ip } }] },
        "User Agent": { rich_text: [{ text: { content: userAgent } }] },
        "Token JTI": { rich_text: [{ text: { content: jti } }] },
      },
    });

    // Create HMAC token
    const token = createHMACToken(email, expiresAt, jti);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token,
        expires_at: expiresAt.toISOString(),
      }),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
