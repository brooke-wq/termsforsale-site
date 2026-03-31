// buyer-import.js — Receives buyer webhooks from InvestorLift and InvestorBase,
// upserts the contact into GHL (Terms For Sale sub-account), and triggers the
// Buyer Relations Agent via the buyer-signup tag.
//
// POST /api/buyer-import?source=investorlift|investorbase

const { upsertContact, addTags, postNote, CF_IDS } = require('./_ghl');

const GHL_API_KEY     = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Parse body — support both JSON body and query-param-only GET pings
    let payload = {};
    if (event.body) {
      try { payload = JSON.parse(event.body); } catch (e) {
        console.error('[buyer-import] Failed to parse body:', e.message);
      }
    }

    // Merge query params into payload (some webhooks send fields as query params)
    if (event.queryStringParameters) {
      Object.assign(payload, event.queryStringParameters);
    }

    // Determine source
    const sourceParam = (event.queryStringParameters && event.queryStringParameters.source) || '';
    let source = sourceParam.toLowerCase();

    if (!source) {
      // Detect from payload structure
      if (payload.defaultPhone || payload.isVIP !== undefined || payload.score !== undefined) {
        source = 'investorlift';
      } else if (payload.postalCode !== undefined || payload.fullName !== undefined) {
        source = 'investorbase';
      } else {
        source = 'unknown';
      }
    }

    let contactData = {};
    let buyBoxNote  = '';
    let extraTags   = [];

    // ─── InvestorBase ────────────────────────────────────────────────────────
    if (source === 'investorbase') {
      // Name handling — fullName fallback
      let firstName = payload.firstName || '';
      let lastName  = payload.lastName  || '';
      if ((!firstName || !lastName) && payload.fullName) {
        const parts = payload.fullName.trim().split(/\s+/);
        firstName = firstName || parts[0] || '';
        lastName  = lastName  || parts.slice(1).join(' ') || '';
      }

      contactData = {
        firstName,
        lastName,
        name:        [firstName, lastName].filter(Boolean).join(' '),
        phone:       payload.phone    || '',
        email:       payload.email    || '',
        address1:    payload.address1 || '',
        city:        payload.city     || '',
        state:       payload.state    || '',
        postalCode:  payload.postalCode || '',
        companyName: payload.companyName || '',
        source:      'InvestorBase',
        customFields: [
          { id: CF_IDS.TARGET_MARKETS, value: payload.buyer_markets || '' }
        ]
      };

      // Parse InvestorBase tags (comma-delimited string)
      if (payload.tags && typeof payload.tags === 'string') {
        const parsed = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
        if (parsed.length) extraTags = extraTags.concat(parsed);
      } else if (Array.isArray(payload.tags)) {
        extraTags = extraTags.concat(payload.tags.filter(Boolean));
      }

      // Notes
      const noteLines = ['=== InvestorBase Buyer Profile ==='];
      if (payload.buyer_markets)   noteLines.push('Target Markets: ' + payload.buyer_markets);
      if (payload.buy_box_notes)   noteLines.push('Buy Box Notes: '  + payload.buy_box_notes);
      if (payload.notes)           noteLines.push('Notes: '          + payload.notes);
      if (payload.companyName)     noteLines.push('Company: '        + payload.companyName);
      buyBoxNote = noteLines.join('\n');

    // ─── InvestorLift ─────────────────────────────────────────────────────────
    } else if (source === 'investorlift') {
      contactData = {
        firstName:   payload.firstName   || '',
        lastName:    payload.lastName    || '',
        name:        [payload.firstName, payload.lastName].filter(Boolean).join(' '),
        phone:       payload.defaultPhone || payload.phone || '',
        email:       payload.email        || '',
        companyName: payload.companyName  || '',
        source:      'InvestorLift',
        customFields: []
      };

      // VIP / Vetted tags
      if (payload.isVIP)     extraTags.push('investorlift-vip');
      if (payload.isVetted)  extraTags.push('investorlift-vetted');

      // Buyer profile note
      const noteLines = ['=== InvestorLift Buyer Profile ==='];
      if (payload.score !== undefined) noteLines.push('Score: ' + payload.score);
      if (payload.isVIP)               noteLines.push('VIP: Yes');
      if (payload.isVetted)            noteLines.push('Vetted: Yes');

      // Buy box fields
      const buyBoxFields = [
        ['Min Beds',              payload.minBeds],
        ['Min Baths',             payload.minBaths],
        ['Min Sq Ft',             payload.minSquareFootage],
        ['Min Year Built',        payload.minYearBuilt],
        ['Min Lot Size',          payload.minLotSize],
        ['Min Gross Margin',      payload.minGrossMargin],
        ['CoC Return',            payload.cocReturn],
        ['Max Purchase Price',    payload.maxPurchasePrice],
        ['% of ARV',              payload.percentOfARV],
        ['Minimum ARV',           payload.minimumARV],
        ['Property Address',      payload.propertyAddress]
      ];
      const buyBoxLines = buyBoxFields
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => k + ': ' + v);
      if (buyBoxLines.length) {
        noteLines.push('', '--- Buy Box ---');
        noteLines.push(...buyBoxLines);
      }

      // All phones
      if (payload.allPhones && Array.isArray(payload.allPhones) && payload.allPhones.length) {
        noteLines.push('', 'All Phones: ' + payload.allPhones.join(', '));
      }

      buyBoxNote = noteLines.join('\n');

    // ─── Unknown source ───────────────────────────────────────────────────────
    } else {
      console.warn('[buyer-import] Unknown source, attempting generic upsert');
      contactData = {
        firstName:   payload.firstName || payload.first_name || '',
        lastName:    payload.lastName  || payload.last_name  || '',
        phone:       payload.phone     || payload.defaultPhone || '',
        email:       payload.email     || '',
        source:      'Unknown'
      };
      buyBoxNote = '=== Unknown Source Buyer Payload ===\n' + JSON.stringify(payload, null, 2);
    }

    // Upsert contact
    const upsertRes = await upsertContact(GHL_API_KEY, GHL_LOCATION_ID, contactData);
    if (upsertRes.status >= 400) {
      throw new Error('GHL upsert failed: ' + JSON.stringify(upsertRes.body));
    }

    const contact = upsertRes.body.contact || upsertRes.body;
    const contactId = contact.id;
    if (!contactId) {
      throw new Error('No contactId returned from GHL upsert: ' + JSON.stringify(upsertRes.body));
    }

    const contactName = [contactData.firstName, contactData.lastName].filter(Boolean).join(' ') || contactId;
    const sourceLabel = source === 'investorlift' ? 'InvestorLift' : source === 'investorbase' ? 'InvestorBase' : 'Unknown';
    console.log('[buyer-import] Created/updated contact: ' + contactName + ' from ' + sourceLabel + ' (id: ' + contactId + ')');

    // Tags: buyer-signup + source tag
    const tagsToAdd = ['buyer-signup', 'source:' + source, ...extraTags];
    await addTags(GHL_API_KEY, contactId, tagsToAdd);
    console.log('[buyer-import] Added tags: ' + tagsToAdd.join(', '));

    // Post buyer profile note
    if (buyBoxNote) {
      await postNote(GHL_API_KEY, contactId, buyBoxNote);
      console.log('[buyer-import] Posted buyer profile note to contact ' + contactId);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, contactId, source })
    };

  } catch (err) {
    console.error('[buyer-import] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
