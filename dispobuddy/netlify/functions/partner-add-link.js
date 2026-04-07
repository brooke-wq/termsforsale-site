/**
 * Dispo Buddy — Partner Add Link (files/docs/photos)
 * POST /.netlify/functions/partner-add-link
 *
 * Partners paste a Google Drive / Dropbox / etc. link to add more
 * photos or docs to a deal after submission. Rather than handling
 * raw file uploads (which would need S3/R2), we accept a link and:
 *   1. Add a note to the contact with the link + context
 *   2. Update the contact's link_to_photos or link_to_supporting_documents
 *      field if empty
 *   3. Notify the team internally (optional)
 *
 * Body: { contactId, opportunityId, linkType, url, description? }
 * linkType: 'photos' | 'documents' | 'other'
 *
 * Required env vars: GHL_API_KEY, GHL_LOCATION_ID
 * Optional: NOTIFICATIONS_LIVE, INTERNAL_ALERT_PHONE
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async (event) => {
  const respHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: respHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: respHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return { statusCode: 500, headers: respHeaders, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { contactId, opportunityId, linkType, url, description } = body;
  if (!contactId || !url || !linkType) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'contactId, linkType, and url required' }) };
  }

  // Basic URL validation
  if (!/^https?:\/\/.+\..+/.test(url)) {
    return { statusCode: 400, headers: respHeaders, body: JSON.stringify({ error: 'Not a valid URL' }) };
  }

  const ghlHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    // Add a note to the contact
    const noteBody = `📎 PARTNER ADDED LINK (${linkType})\n` +
      `${description ? 'Note: ' + description + '\n' : ''}` +
      `${url}\n` +
      `${opportunityId ? 'Opportunity: ' + opportunityId : ''}`;

    await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: ghlHeaders,
      body: JSON.stringify({ body: noteBody }),
    });

    // Update the matching custom field if it's empty
    try {
      const contactRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: ghlHeaders });
      const contactData = await contactRes.json();
      const contact = contactData.contact || contactData;
      const cfArray = contact.customFields || [];

      const fieldKeyMap = {
        'photos': 'link_to_photos',
        'documents': 'link_to_supporting_documents',
      };
      const targetKey = fieldKeyMap[linkType];

      if (targetKey) {
        const existing = cfArray.find(f => (f.fieldKey || f.key || f.name) === targetKey);
        const existingValue = existing ? (existing.value || '') : '';
        if (!existingValue) {
          // Empty — set it
          await fetch(`${GHL_BASE}/contacts/${contactId}`, {
            method: 'PUT',
            headers: ghlHeaders,
            body: JSON.stringify({
              customFields: [{ key: targetKey, field_value: url }],
            }),
          });
        }
      }
    } catch (err) {
      console.warn('Custom field update failed (non-fatal):', err.message);
    }

    // Internal alert (if live)
    const isLive = process.env.NOTIFICATIONS_LIVE === 'true';
    const alertPhone = process.env.INTERNAL_ALERT_PHONE;
    if (isLive && alertPhone) {
      try {
        // Find internal contact
        const searchRes = await fetch(
          `${GHL_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(alertPhone)}&limit=1`,
          { headers: ghlHeaders }
        );
        const searchData = await searchRes.json();
        const internalId = searchData.contacts?.[0]?.id;
        if (internalId) {
          await fetch(`${GHL_BASE}/conversations/messages`, {
            method: 'POST',
            headers: ghlHeaders,
            body: JSON.stringify({
              type: 'SMS',
              contactId: internalId,
              message: `📎 Partner added ${linkType} link on deal ${opportunityId || contactId}: ${url}`,
            }),
          });
        }
      } catch (err) {
        console.warn('Internal alert failed:', err.message);
      }
    }

    return {
      statusCode: 200,
      headers: respHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Partner add link error:', err);
    return { statusCode: 500, headers: respHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
