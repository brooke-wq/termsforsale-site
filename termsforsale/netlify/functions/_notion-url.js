/**
 * Shared helper: write a deal's public short URL back to Notion.
 *
 * The deals DB has a `Website Link` URL property. We PATCH it with
 * the `/d/{city}-{zip}-{code}` URL produced by `_deal-url.js` so
 * Notion views show a clickable live link alongside the deal.
 *
 * Used by:
 *   - notify-buyers.js (writes the URL whenever a new/edited deal
 *     gets picked up by the cron — fires on real-time edits)
 *   - scripts/backfill-notion-website-links.js (one-shot sweep over
 *     all Actively Marketing deals — catches legacy pages that were
 *     created before notify-buyers started writing this field)
 */

const https = require('https');
const { buildDealUrl } = require('./_deal-url');

// Notion API: PATCH /v1/pages/{pageId} with a single "Website Link"
// url property. Returns { ok: boolean, status, body }.
// Never throws — the caller treats this as best-effort.
function patchWebsiteLink(token, pageId, url) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      properties: {
        'Website Link': { url: url }
      }
    });
    var opts = {
      hostname: 'api.notion.com',
      path: '/v1/pages/' + pageId,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function(err) {
      resolve({ ok: false, status: 0, body: { error: err.message } });
    });
    req.write(body);
    req.end();
  });
}

// Convenience wrapper that builds the URL from a parsed deal object
// and then patches the Notion page. Returns the raw patch result so
// callers can log/skip on failure.
async function setDealWebsiteLink(token, deal) {
  if (!token || !deal || !deal.id) return { ok: false, status: 0, body: { error: 'missing token or deal.id' } };
  var url = buildDealUrl(deal);
  return patchWebsiteLink(token, deal.id, url);
}

// PATCH the Notion page's "Description" rich_text property.
// Same pattern as patchWebsiteLink — never throws.
function patchDescription(token, pageId, text) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      properties: {
        'Description': {
          rich_text: [{ type: 'text', text: { content: String(text || '') } }]
        }
      }
    });
    var opts = {
      hostname: 'api.notion.com',
      path: '/v1/pages/' + pageId,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function(err) {
      resolve({ ok: false, status: 0, body: { error: err.message } });
    });
    req.write(body);
    req.end();
  });
}

module.exports = {
  patchWebsiteLink: patchWebsiteLink,
  setDealWebsiteLink: setDealWebsiteLink,
  patchDescription: patchDescription
};
