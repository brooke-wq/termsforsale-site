/**
 * Tag Buyer Response — POST /.netlify/functions/tag-buyer-response
 *
 * When a buyer responds to a deal blast, update their response status
 * tag on their GHL contact. Also adds responded:[deal-slug] so we can
 * see per-deal response history.
 *
 * Request body:
 *   {
 *     "contactId": "abc123",
 *     "dealAddress": "123 Main St Mesa AZ",
 *     "response": "interested" | "hot" | "passed" | "no-response"
 *   }
 *
 * Logic:
 *   1. Remove all existing deal:* status tags (only one is valid at a time)
 *   2. Add the new deal:[response] tag
 *   3. Add responded:[deal-slug] to mark per-deal response
 *   4. Return updated contact tag list
 *
 * ENV VARS: GHL_API_KEY, GHL_LOCATION_ID_TERMS (or GHL_LOCATION_ID)
 */

const https = require('https');

const GHL_HOST = 'services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// All possible deal response status tags — we wipe these before adding the new one
// so a contact only ever has ONE current status at a time.
const ALL_DEAL_STATUS_TAGS = [
  'deal:interested',
  'deal:hot',
  'deal:passed',
  'deal:no-response'
];

const VALID_RESPONSES = ['interested', 'hot', 'passed', 'no-response'];

// ─── Helpers ───────────────────────────────────────────────────

function slugifyAddress(addr) {
  return String(addr || '')
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function ghlRequest(method, path, apiKey, body) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: GHL_HOST,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Version': GHL_VERSION,
        'Content-Type': 'application/json'
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Fetch a single contact from GHL (used to return the updated tag list). */
async function getContact(apiKey, contactId) {
  return ghlRequest('GET', '/contacts/' + contactId, apiKey, null);
}

/** Remove tags from a contact. DELETE /contacts/{id}/tags with body {tags:[...]}. */
async function removeTagsFromContact(apiKey, contactId, tagsToRemove) {
  return ghlRequest('DELETE', '/contacts/' + contactId + '/tags', apiKey, {
    tags: tagsToRemove
  });
}

/** Add tags to a contact. POST /contacts/{id}/tags appends without removing. */
async function addTagsToContact(apiKey, contactId, tagsToAdd) {
  return ghlRequest('POST', '/contacts/' + contactId + '/tags', apiKey, {
    tags: tagsToAdd
  });
}

// ─── Handler ───────────────────────────────────────────────────

exports.handler = async function(event) {
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  var apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'GHL_API_KEY not configured' }) };
  }

  // Parse body
  var body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  var contactId = body.contactId;
  var dealAddress = body.dealAddress || '';
  var response = (body.response || '').toLowerCase();

  // Validate inputs
  if (!contactId) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'contactId is required' }) };
  }
  if (!dealAddress) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'dealAddress is required' }) };
  }
  if (VALID_RESPONSES.indexOf(response) === -1) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'response must be one of: ' + VALID_RESPONSES.join(', ') }) };
  }

  var slug = slugifyAddress(dealAddress);
  var newStatusTag = 'deal:' + response;       // e.g. "deal:interested"
  var perDealTag = 'responded:' + slug;        // e.g. "responded:123-main-st-mesa-az"

  try {
    // Step 1: Remove any existing deal:* status tags so only the new one is active.
    // It's safe to send all 4 — GHL just ignores tags that aren't present.
    var removeRes = await removeTagsFromContact(apiKey, contactId, ALL_DEAL_STATUS_TAGS);
    console.log('[tag-buyer-response] removed old status tags — status=' + removeRes.status);

    // Step 2 + 3: Add the new status tag plus the per-deal responded marker in one call
    var addRes = await addTagsToContact(apiKey, contactId, [newStatusTag, perDealTag]);
    console.log('[tag-buyer-response] added ' + newStatusTag + ' + ' + perDealTag + ' — status=' + addRes.status);

    if (addRes.status < 200 || addRes.status >= 300) {
      return {
        statusCode: 502,
        headers: headers,
        body: JSON.stringify({
          error: 'Failed to add tags',
          status: addRes.status,
          detail: (addRes.body && addRes.body.message) || ''
        })
      };
    }

    // Step 4: Return the updated tag list so the caller can confirm state.
    var contactRes = await getContact(apiKey, contactId);
    var tags = [];
    if (contactRes.status >= 200 && contactRes.status < 300 && contactRes.body && contactRes.body.contact) {
      tags = contactRes.body.contact.tags || [];
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        ok: true,
        contactId: contactId,
        response: response,
        newStatusTag: newStatusTag,
        perDealTag: perDealTag,
        tags: tags
      })
    };

  } catch (err) {
    console.error('[tag-buyer-response] error:', err.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
