/**
 * Shared deal-URL builder.
 *
 * Keeps every outbound deal link on the short, human-readable
 * `/d/{city}-{zip}-{code}` format so SMS/email links stay compact and
 * buyers (and search engines) see the city/zip right in the path.
 *
 * Example:
 *   legacy: https://termsforsale.com/deal.html?id=a1b2c3d4-e5f6-...
 *   new:    https://termsforsale.com/d/phoenix-85016-phx001
 *
 * Note: the site was migrated from `deals.termsforsale.com` to the
 * apex `termsforsale.com` on April 9 2026; the subdomain now 301s to
 * apex. Keep BASE_URL on the apex so every outbound link avoids the
 * redirect hop and lands directly on the canonical host.
 *
 * `deal.html` handles both formats — `/d/*` is rewritten to
 * `deal.html` by netlify.toml, and the page JS pulls the dealCode
 * off the last hyphen-separated segment of the path.
 */

var BASE_URL = 'https://termsforsale.com';

function slugifyPiece(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Derive a short, URL-safe deal code from the deal object.
// Prefers the Notion "Deal ID" (e.g. "PHX-001" → "phx001").
// Falls back to the first 8 chars of the Notion UUID when no code exists.
function shortCode(deal) {
  if (!deal) return '';
  var raw = deal.dealCode || deal.deal_code || deal.deal_id || '';
  if (raw) return slugifyPiece(raw).replace(/-/g, '');
  var id = deal.id || '';
  if (!id) return '';
  return String(id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
}

// Build the slug that goes after /d/, e.g. "phoenix-85016-phx001".
function buildDealSlug(deal) {
  if (!deal) return '';
  var city = slugifyPiece(deal.city);
  var zip = slugifyPiece(deal.zip);
  var code = shortCode(deal);
  var parts = [];
  if (city) parts.push(city);
  if (zip) parts.push(zip);
  if (code) parts.push(code);
  if (!parts.length) {
    return String(deal.id || '').toLowerCase();
  }
  return parts.join('-');
}

// Path portion only, e.g. "/d/phoenix-85016-phx001".
function buildDealPath(deal) {
  return '/d/' + buildDealSlug(deal);
}

// Full public URL, e.g. "https://termsforsale.com/d/phoenix-85016-phx001".
function buildDealUrl(deal) {
  return BASE_URL + buildDealPath(deal);
}

// Same as buildDealUrl, but appends ?c=CONTACT_ID so the deal page JS
// can log the view for the recipient of an SMS/email blast.
function buildTrackedDealUrl(deal, contactId) {
  var url = buildDealUrl(deal);
  if (contactId) url += '?c=' + encodeURIComponent(contactId);
  return url;
}

module.exports = {
  BASE_URL: BASE_URL,
  slugifyPiece: slugifyPiece,
  shortCode: shortCode,
  buildDealSlug: buildDealSlug,
  buildDealPath: buildDealPath,
  buildDealUrl: buildDealUrl,
  buildTrackedDealUrl: buildTrackedDealUrl
};
