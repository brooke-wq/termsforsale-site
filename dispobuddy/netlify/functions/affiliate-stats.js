/**
 * Dispo Buddy — Affiliate Stats Lookup (for dashboard)
 * GET /.netlify/functions/affiliate-stats?ref=<affiliate_id>&email=<email>
 *
 * Lightweight MVP "auth": requires BOTH the affiliate_id AND the email on
 * file to return stats. Not bulletproof, but good enough until real auth
 * is added.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return respond(500, { error: 'Server configuration error' });
  }

  // Accept either query params or JSON body
  const params = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch {}
  }

  const affiliateId = normalizeId(body.ref || params.ref || body.affiliate_id || params.affiliate_id);
  const email       = String(body.email || params.email || '').trim().toLowerCase();

  if (!affiliateId || !email) {
    return respond(400, { error: 'Missing required: ref (affiliate id) and email' });
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
  };

  try {
    // Search by email first (single narrow query)
    const searchUrl = `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=20`;
    const res = await ghlFetch(searchUrl, 'GET', null, headers);
    const data = await res.json();
    const contacts = data.contacts || [];

    // Find the contact whose affiliate_id custom field matches AND whose
    // email matches exactly.
    let matched = null;
    for (const c of contacts) {
      const contactEmail = String(c.email || '').trim().toLowerCase();
      if (contactEmail !== email) continue;
      const fields = c.customFields || c.customField || [];
      for (const f of fields) {
        const key = f.key || f.name || '';
        const val = f.field_value || f.value || '';
        if (key === 'affiliate_id' && String(val).trim().toLowerCase() === affiliateId) {
          matched = c;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      return respond(404, { error: 'No affiliate found matching that ID + email combo.' });
    }

    // Pluck counters out of custom fields
    const counters = {};
    (matched.customFields || matched.customField || []).forEach(f => {
      const key = f.key || f.name || '';
      const val = f.field_value || f.value || '';
      if (key.indexOf('affiliate_') === 0) counters[key] = val;
    });

    const site = process.env.SITE_URL || 'https://dispobuddy.com';
    const referralLink = counters.affiliate_referral_link || `${site}/?ref=${affiliateId}`;

    return respond(200, {
      success: true,
      affiliate: {
        id: affiliateId,
        full_name: `${matched.firstName || ''} ${matched.lastName || ''}`.trim(),
        email:     matched.email || '',
        phone:     matched.phone || '',
        status:    counters.affiliate_status || 'active',
        joined_at: counters.affiliate_joined_at || '',
        payout_method:  counters.affiliate_payout_method || '',
        referral_link:  referralLink,
      },
      stats: {
        clicks:             toNum(counters.affiliate_clicks),
        signups:            toNum(counters.affiliate_signups),
        deals_submitted:    toNum(counters.affiliate_deals_submitted),
        deals_closed:       toNum(counters.affiliate_deals_closed),
        commission_earned:  toMoney(counters.affiliate_commission_earned),
        commission_paid:    toMoney(counters.affiliate_commission_paid),
        commission_pending: +(toMoney(counters.affiliate_commission_earned) - toMoney(counters.affiliate_commission_paid)).toFixed(2),
        last_event:         counters.affiliate_last_event || '',
      },
      share_links: {
        home:        `${site}/?ref=${affiliateId}`,
        join:        `${site}/join?ref=${affiliateId}`,
        submit_deal: `${site}/submit-deal?ref=${affiliateId}`,
      },
    });
  } catch (err) {
    console.error('Affiliate stats error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

function normalizeId(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}
function toNum(v)   { return parseInt(v, 10) || 0; }
function toMoney(v) { return parseFloat(v) || 0; }

async function ghlFetch(url, method, payload, headers) {
  const opts = { method, headers };
  if (payload && method !== 'GET') opts.body = JSON.stringify(payload);
  return fetch(url, opts);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}
