// Netlify function: buyer-relations
// POST /api/buyer-relations
// Receives buyer contact data, applies full tag taxonomy, generates buyer profile.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID

const { complete } = require('./_claude');
const { getContact, postNote, addTags, removeTags, swapTags, upsertContact, updateCustomFields } = require('./_ghl');

const PROFILE_SYSTEM = `You are the Buyer Relations Agent for Deal Pros LLC (Terms For Sale brand).

Your job is to analyze new buyer signups and create a concise investor profile note. This note helps the disposition team quickly understand what this buyer wants and how to serve them.

Be specific about their buy box — markets, price range, strategies, experience level. If data is sparse, note what's missing and what we should ask on the first call.

Keep the profile to 150 words max. Professional, direct tone.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID;

  if (!anthropicKey || !ghlKey) {
    return respond(500, { error: 'Missing required env vars' });
  }

  var body;
  try { body = JSON.parse(event.body); } catch(e) {
    return respond(400, { error: 'Invalid JSON' });
  }

  var contactId = body.contact_id || body.contactId || null;

  if (!contactId && !body.email && !body.phone) {
    return respond(400, { error: 'contact_id, email, or phone required' });
  }

  try {
    // Upsert contact if no ID provided
    if (!contactId && locationId) {
      var upsertRes = await upsertContact(ghlKey, locationId, {
        firstName: body.firstName || body.first_name || 'Buyer',
        lastName:  body.lastName || body.last_name || '',
        phone:     body.phone || undefined,
        email:     body.email || undefined,
        source:    'Terms For Sale Buyer Signup'
      });
      if (upsertRes.body && (upsertRes.body.contact || upsertRes.body.id)) {
        contactId = (upsertRes.body.contact && upsertRes.body.contact.id) || upsertRes.body.id;
        console.log('[buyer-relations] upserted contact: ' + contactId);
      }
    }

    // Idempotency gate: if this contact has already been processed (has
    // `buyer-active` tag) OR is currently being processed by another run
    // (has `buyer-relations-processing`), skip. Both cron runs and GHL
    // workflow webhooks can fire this function for the same contact, and
    // without this check Claude generates two slightly-different profile
    // notes that both get posted.
    if (contactId) {
      try {
        var contactRes = await getContact(ghlKey, contactId);
        var existingTags = ((contactRes.body && contactRes.body.contact && contactRes.body.contact.tags) || []).map(function (t) {
          return String(t || '').toLowerCase().trim();
        });
        if (existingTags.indexOf('buyer-active') !== -1) {
          console.log('[buyer-relations] contact ' + contactId + ' already has buyer-active tag, skipping');
          return respond(200, { success: true, contactId: contactId, skipped: 'already-processed' });
        }
        if (existingTags.indexOf('buyer-relations-processing') !== -1) {
          console.log('[buyer-relations] contact ' + contactId + ' is currently being processed by another run, skipping');
          return respond(200, { success: true, contactId: contactId, skipped: 'concurrent-run' });
        }
        // Claim the contact: remove `buyer-signup` and add a processing
        // marker. Done BEFORE the slow Claude call so a concurrent run
        // can't pick up the same contact mid-flight.
        await addTags(ghlKey, contactId, ['buyer-relations-processing']);
        await removeTags(ghlKey, contactId, ['buyer-signup', 'buyer-new']);
      } catch (e) {
        console.warn('[buyer-relations] idempotency check failed (continuing):', e.message);
      }
    }

    // Build tag taxonomy
    var tags = buildBuyerTags(body);

    // Update custom fields for buy box
    var customFields = [];
    if (body.markets || body.buyer_markets) {
      customFields.push({ key: 'buyer_markets', field_value: body.markets || body.buyer_markets });
    }
    if (body.strategies || body.buyer_strategies) {
      customFields.push({ key: 'buyer_strategies', field_value: body.strategies || body.buyer_strategies });
    }
    if (body.price_min || body.buyer_price_min) {
      customFields.push({ key: 'buyer_price_min', field_value: String(body.price_min || body.buyer_price_min) });
    }
    if (body.price_max || body.buyer_price_max) {
      customFields.push({ key: 'buyer_price_max', field_value: String(body.price_max || body.buyer_price_max) });
    }
    if (body.proof_of_funds || body.buyer_proof_of_funds) {
      customFields.push({ key: 'buyer_proof_of_funds', field_value: body.proof_of_funds || body.buyer_proof_of_funds });
    }
    if (body.deals_closed || body.buyer_deals_closed) {
      customFields.push({ key: 'buyer_deals_closed', field_value: String(body.deals_closed || body.buyer_deals_closed) });
    }

    if (contactId && customFields.length) {
      await updateCustomFields(ghlKey, contactId, customFields);
    }

    // Generate buyer profile via Claude
    var buyerData = [
      'Name: ' + (body.firstName || body.first_name || '') + ' ' + (body.lastName || body.last_name || ''),
      'Email: ' + (body.email || 'Not provided'),
      'Phone: ' + (body.phone || 'Not provided'),
      'Markets: ' + (body.markets || body.buyer_markets || 'Not specified'),
      'Strategies: ' + (body.strategies || body.buyer_strategies || 'Not specified'),
      'Price Range: ' + formatRange(body.price_min || body.buyer_price_min, body.price_max || body.buyer_price_max),
      'Proof of Funds: ' + (body.proof_of_funds || body.buyer_proof_of_funds || 'Unknown'),
      'Deals Closed: ' + (body.deals_closed || body.buyer_deals_closed || 'Unknown'),
      'Buyer Type: ' + (body.buyer_type || 'Not specified'),
      'Exit Strategy: ' + (body.exit_strategy || 'Not specified'),
      'Notes: ' + (body.notes || 'None')
    ].join('\n');

    console.log('[buyer-relations] profiling buyer: ' + (body.email || contactId));
    var claudeRes = await complete(anthropicKey, {
      system: PROFILE_SYSTEM,
      user: 'Create a buyer profile note for this new signup:\n\n' + buyerData,
      maxTokens: 400
    });
    var profile = claudeRes.text;

    console.log('[buyer-relations] profile generated, cost=$' + claudeRes.usage.cost.toFixed(6));

    // Post profile note and apply tags. We already removed `buyer-signup`
    // and `buyer-new` at the start of the run (idempotency claim) — here
    // we clear the processing marker and stamp `buyer-active`.
    if (contactId && ghlKey) {
      var noteBody = '--- BUYER PROFILE ---\n' + profile + '\n\n' +
        'Tags Applied: ' + tags.join(', ') + '\n\n' +
        '--- Buyer Relations Agent / Deal Pros LLC ---';
      await postNote(ghlKey, contactId, noteBody);
      await swapTags(ghlKey, contactId, ['buyer-relations-processing'], ['buyer-active'].concat(tags));
    }

    return respond(200, {
      success: true,
      contactId: contactId,
      tags: tags,
      profile: profile,
      usage: claudeRes.usage
    });

  } catch (err) {
    console.error('[buyer-relations] error:', err.message);
    if (contactId && ghlKey) {
      try { await postNote(ghlKey, contactId, 'Buyer Relations ERROR: ' + err.message); } catch(e) {}
      // Clear the processing marker so the next cron run can retry.
      // Without this, a transient Claude/GHL failure would leave the
      // contact stuck in "processing" state forever.
      try { await removeTags(ghlKey, contactId, ['buyer-relations-processing']); } catch(e) {}
    }
    return respond(500, { error: err.message });
  }
};

function buildBuyerTags(d) {
  var tags = [];

  // Acquisition structure preferences
  var strats = ((d.strategies || d.buyer_strategies || '') + ' ' + (d.exit_strategy || '')).toLowerCase();
  if (strats.includes('cash'))            tags.push('acq:cash');
  if (strats.includes('sub') || strats.includes('subject')) tags.push('acq:subto');
  if (strats.includes('seller') || strats.includes('owner finance')) tags.push('acq:seller-finance');
  if (strats.includes('morby'))           tags.push('acq:morby');
  if (strats.includes('creative'))        tags.push('acq:creative-all');

  // Use type / exit strategy
  var use = (d.buyer_type || d.exit_strategy || '').toLowerCase();
  if (use.includes('flip'))               tags.push('use:flip');
  if (use.includes('rental') || use.includes('buy and hold') || use.includes('brrr')) tags.push('use:rental');
  if (use.includes('owner') || use.includes('primary')) tags.push('use:owner-occupant');
  if (use.includes('commercial'))         tags.push('use:commercial');
  if (use.includes('airbnb') || use.includes('str') || use.includes('short term')) tags.push('use:airbnb');

  // Market tags
  var markets = (d.markets || d.buyer_markets || '').toLowerCase();
  var marketMap = {
    'phoenix': 'mkt:phoenix-az', 'mesa': 'mkt:mesa-az', 'scottsdale': 'mkt:scottsdale-az',
    'dallas': 'mkt:dallas-tx', 'houston': 'mkt:houston-tx', 'tampa': 'mkt:tampa-fl',
    'san antonio': 'mkt:san-antonio-tx', 'austin': 'mkt:austin-tx',
    'tucson': 'mkt:tucson-az', 'gilbert': 'mkt:gilbert-az', 'chandler': 'mkt:chandler-az'
  };
  Object.keys(marketMap).forEach(function(city) {
    if (markets.includes(city)) tags.push(marketMap[city]);
  });

  // Status tags
  var pof = (d.proof_of_funds || d.buyer_proof_of_funds || '').toLowerCase();
  if (pof === 'yes' || pof === 'true' || pof.includes('verified')) {
    tags.push('status:verified-pof');
  }

  var deals = parseInt(d.deals_closed || d.buyer_deals_closed || '0');
  if (deals > 0) tags.push('status:closed-before');

  return tags;
}

function formatRange(min, max) {
  var fmt = function(n) { return n ? '$' + (+n).toLocaleString() : ''; };
  if (min && max) return fmt(min) + ' - ' + fmt(max);
  if (min) return fmt(min) + '+';
  if (max) return 'Up to ' + fmt(max);
  return 'Not specified';
}

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
