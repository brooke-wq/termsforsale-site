/**
 * Saved Deals — GET/POST /.netlify/functions/saved-deals
 * GET  ?contactId=X  → returns saved deal IDs from GHL contact notes
 * POST {contactId, dealIds} → persists saved deal IDs to GHL contact note
 *
 * Uses a pinned note with prefix "SAVED_DEALS:" to store comma-separated IDs.
 */

const { getContact, postNote } = require('./_ghl');
const { buildDealUrl } = require('./_deal-url');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return respond(500, { error: 'Server config error' });
  }

  // GET — retrieve saved deals
  if (event.httpMethod === 'GET') {
    const contactId = event.queryStringParameters && event.queryStringParameters.contactId;
    if (!contactId) return respond(400, { error: 'Missing contactId' });

    // Verify contact exists
    const contact = await getContact(apiKey, contactId);
    if (contact.status >= 400) return respond(401, { error: 'Invalid contact' });

    // Read saved deals from contact's tags (using "saved:" prefix)
    const tags = (contact.body && contact.body.contact && contact.body.contact.tags) || [];
    const savedIds = tags
      .filter(function(t) { return t.startsWith('saved:'); })
      .map(function(t) { return t.replace('saved:', ''); });

    return respond(200, { ok: true, dealIds: savedIds });
  }

  // POST — save deal IDs
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return respond(400, { error: 'Invalid JSON' }); }

    const { contactId, dealIds, action, dealId } = body;
    if (!contactId) return respond(400, { error: 'Missing contactId' });

    // Verify contact exists
    const contact = await getContact(apiKey, contactId);
    if (contact.status >= 400) return respond(401, { error: 'Invalid contact' });

    // Use tags for saved deals — add or remove a single "saved:{dealId}" tag
    const { addTags, removeTags } = require('./_ghl');

    if (action === 'save' && dealId) {
      await addTags(apiKey, contactId, ['saved:' + dealId, 'Active Saver']);
      await postNote(apiKey, contactId,
        '❤️ DEAL SAVED\nDeal ID: ' + dealId + '\nURL: ' + buildDealUrl({ id: dealId }) + '\nDate: ' + new Date().toISOString().split('T')[0]
      );
      return respond(200, { ok: true, action: 'saved' });
    }

    if (action === 'unsave' && dealId) {
      await removeTags(apiKey, contactId, ['saved:' + dealId]);
      return respond(200, { ok: true, action: 'unsaved' });
    }

    // Bulk sync — replace all saved tags
    if (Array.isArray(dealIds)) {
      const currentTags = (contact.body.contact && contact.body.contact.tags) || [];
      const oldSaved = currentTags.filter(function(t) { return t.startsWith('saved:'); });
      const newSaved = dealIds.map(function(id) { return 'saved:' + id; });

      // Remove old, add new
      if (oldSaved.length) await removeTags(apiKey, contactId, oldSaved);
      if (newSaved.length) await addTags(apiKey, contactId, newSaved);

      return respond(200, { ok: true, synced: dealIds.length });
    }

    return respond(400, { error: 'Provide action+dealId or dealIds array' });
  }

  return respond(405, { error: 'Method not allowed' });
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
