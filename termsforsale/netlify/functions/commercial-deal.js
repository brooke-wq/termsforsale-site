const { Client } = require("@notionhq/client");
const crypto = require("crypto");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const COMMERCIAL_DEALS_DB_ID = process.env.NOTION_COMMERCIAL_DEALS_DB_ID;
const HMAC_SECRET = process.env.NDA_HMAC_SECRET;

function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function verifyToken(token) {
  if (!token) return null;

  try {
    const [payloadStr, signature] = token.split(".");
    if (!payloadStr || !signature) return null;

    // Verify HMAC
    const expectedHmac = crypto
      .createHmac("sha256", HMAC_SECRET)
      .update(payloadStr)
      .digest("hex");

    if (!constantTimeCompare(signature, expectedHmac)) {
      return null;
    }

    // Decode and validate
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp <= now) {
      return null; // Expired
    }

    return payload;
  } catch (e) {
    return null;
  }
}

async function queryDealByCode(code) {
  try {
    const response = await notion.databases.query({
      database_id: COMMERCIAL_DEALS_DB_ID,
      filter: {
        property: "Deal Code",
        title: { equals: code },
      },
    });

    if (response.results.length === 0) return null;

    const page = response.results[0];
    const props = page.properties;

    // Extract public fields
    const deal = {
      code,
      headline:
        props["Metro"]?.rich_text?.[0]?.plain_text || "—",
      metro: props["Metro"]?.rich_text?.[0]?.plain_text || "—",
      type: props["Property Type"]?.select?.name || "—",
      priceRange: props["Price Range"]?.rich_text?.[0]?.plain_text || "—",
      noiRange: props["NOI Range"]?.rich_text?.[0]?.plain_text || "—",
      units: props["Units or Sqft"]?.rich_text?.[0]?.plain_text || "—",
      vintage: props["Vintage / Class"]?.rich_text?.[0]?.plain_text || "—",
      submarket: props["Submarket"]?.rich_text?.[0]?.plain_text || "—",
      notes:
        (props["Deal Story 1"]?.rich_text?.[0]?.plain_text || "") +
        (props["Deal Story 2"]?.rich_text?.[0]?.plain_text
          ? " " + props["Deal Story 2"]?.rich_text?.[0]?.plain_text
          : "") +
        (props["Deal Story 3"]?.rich_text?.[0]?.plain_text
          ? " " + props["Deal Story 3"]?.rich_text?.[0]?.plain_text
          : ""),
      structure: props["Structure Summary"]?.rich_text?.[0]?.plain_text || "—",
      photos: [], // TODO: pull from gallery property if available
    };

    return { page, deal };
  } catch (e) {
    console.error("Query error:", e);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://deals.termsforsale.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const queryParams = event.queryStringParameters || {};
    const code = queryParams.code;

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "code query parameter required" }),
      };
    }

    const result = await queryDealByCode(code);
    if (!result) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "deal not found" }),
      };
    }

    const { page, deal } = result;
    const props = page.properties;

    // Check for valid token
    const authHeader = event.headers.authorization || "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
    const token = tokenMatch ? tokenMatch[1] : null;
    const tokenPayload = token ? verifyToken(token) : null;
    const unlocked = !!tokenPayload;

    // Build response
    const response = {
      deal: { ...deal },
      unlocked,
    };

    // Add private fields if unlocked
    if (unlocked) {
      response.deal.address =
        props["Address (PRIVATE)"]?.rich_text?.[0]?.plain_text || "—";
      response.deal.cimUrl =
        props["CIM URL (PRIVATE)"]?.url || null;
      response.deal.dataRoomUrl =
        props["Data Room URL (PRIVATE)"]?.url || null;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
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
