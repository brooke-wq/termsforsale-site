// Netlify function: buy-box-save
// POST /api/buy-box-save
// Receives buy box data from frontend, upserts contact in GHL
// with properly mapped custom fields via the API (not webhook).
//
// ENV VARS: GHL_API_KEY, GHL_LOCATION_ID

const { upsertContact, addTags, updateCustomFields, postNote, sendSMS } = require('./_ghl');

// AI-parse the buy-box free text + tags into structured prefs
// (best effort — failures never block the form save)
var parsePreferencesModule;
try { parsePreferencesModule = require('./_parse-preferences'); } catch(e) { parsePreferencesModule = null; }

// Fetch all custom field IDs for a location, return { fieldKey: fieldId } map
async function getFieldIds(apiKey, locationId) {
  var res = await fetch('https://services.leadconnectorhq.com/locations/' + locationId + '/customFields', {
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28'
    }
  });
  if (!res.ok) {
    console.error('[buy-box-save] Failed to fetch custom fields:', res.status);
    return {};
  }
  var data = await res.json();
  var map = {};
  (data.customFields || []).forEach(function(f) {
    if (f.fieldKey && f.id) map[f.fieldKey] = f.id;
  });
  return map;
}

// Map old granular timeline values to the new standard buckets
function normalizeTimeline(val) {
  if (!val) return '';
  var v = val.trim();
  // Already a new-format value
  if (/^Immediate/i.test(v) || /^Short-Term/i.test(v) || /^Long-Term/i.test(v)) return v;
  // Map old granular values
  var lower = v.toLowerCase();
  if (lower === 'asap (7 days)' || lower === '10-14 days' || lower === '14-21 days' || lower === '21-30 days') {
    return 'Immediate — 0-30 days';
  }
  if (lower === '30-45 days' || lower === '45-60 days') {
    return 'Short-Term — 31-90 days';
  }
  if (lower === 'flexible') {
    return 'Long-Term — Beyond 90 days';
  }
  return v; // pass through unknown values as-is
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  var ghlKey = process.env.GHL_API_KEY;
  var locationId = process.env.GHL_LOCATION_ID;
  var brookePhone = process.env.BROOKE_PHONE;

  if (!ghlKey || !locationId) return respond(500, { error: 'Missing env vars' });

  var body;
  try { body = JSON.parse(event.body); } catch(e) { return respond(400, { error: 'Invalid JSON' }); }

  if (!body.email && !body.phone) return respond(400, { error: 'email or phone required' });

  try {
    // 1. Upsert contact
    var upsertRes = await upsertContact(ghlKey, locationId, {
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      email: body.email || undefined,
      phone: body.phone || undefined,
      source: body.source || 'TFS Buy Box',
      tags: body.tags || ['tfs buyer', 'buy box complete', 'buyer-signup', 'opt in']
    });

    var contactId = null;
    if (upsertRes.body && (upsertRes.body.contact || upsertRes.body.id)) {
      contactId = (upsertRes.body.contact && upsertRes.body.contact.id) || upsertRes.body.id;
    }

    if (!contactId) {
      console.error('[buy-box-save] No contact ID from upsert:', JSON.stringify(upsertRes.body));
      return respond(502, { error: 'Failed to upsert contact' });
    }

    console.log('[buy-box-save] Contact: ' + contactId);

    // 2. First, fetch custom field IDs for this location
    var fieldIds = await getFieldIds(ghlKey, locationId);
    console.log('[buy-box-save] Found ' + Object.keys(fieldIds).length + ' custom fields');

    // Map form data to GHL field IDs
    //
    // FIELD ALIGNMENT NOTES (2026-04-20 cleanup):
    //   - 'contact.property_type_new' is the canonical property-type field
    //     (fieldKey resolves to id HGC6xWLpSqoAQPZr0uwY, name "Property Type").
    //     Match engine reads this via CF.PROPERTY_TYPE. The old alias
    //     'contact.property_type_preference' was a phantom (NOT FOUND in GHL
    //     customFields registry) — data was silently dropped. Now aligned.
    //   - 'contact.states_buying_in' and 'contact.target_location' hold
    //     structured state + city market prefs (match engine reads these
    //     via CF.TARGET_STATES and CF.TARGET_CITIES). The form previously
    //     concatenated states into target_zips; now it can also send them
    //     structured. target_zips stays for backward-compat and free-text.
    //   - 'contact.buyer_profile_type' was removed — phantom fieldKey, no
    //     matching GHL field. If Cash/Creative profile categorization is
    //     needed, create the field in GHL Settings → Custom Fields first,
    //     then re-add the mapping here.
    //   - 'contact.deal_type' was duplicating the deal_structure value into
    //     a separate field. Deal Structure is the canonical field — removed
    //     the redundant deal_type write. (The GHL field 'contact.deal_type'
    //     with id 0thrOdoETTLlFA45oN8U is used by notify-buyers to hold
    //     per-alert deal type — NOT a buyer-profile field. Previously the
    //     form was overwriting that field with buyer's deal structure prefs,
    //     clobbering the last-alert deal type. Fix: don't write it here.)
    var fieldMap = {
      'contact.deal_structure': body.deal_structure || '',
      'contact.exits': body.exits || '',
      'contact.property_type_new': body.property_type_preference || body.property_type_new || '',
      'contact.target_zips': body.target_zips || '',
      'contact.states_buying_in': body.target_states || body.states_buying_in || '',
      'contact.target_location': body.target_cities || body.target_location || '',
      'contact.max_price': body.max_price || '',
      'contact.max_down': body.max_down || '',
      'contact.max_monthly': body.max_monthly || '',
      'contact.target_monthly_cashflow': body.target_monthly_cashflow || '',
      'contact.max_rate_': body.max_rate_ || '',
      'contact.arv': body.arv || '',
      'contact.bedrooms_min': body.bedrooms_min || '',
      'contact.baths_min': body.baths_min || '',
      'contact.min_sqft': body.min_sqft || '',
      'contact.min_year_build': body.min_year_build || '',
      'contact.remodel_level': body.remodel_level || '',
      'contact.hoa_tolerance': body.hoa_tolerance || '',
      'contact.pool': body.pool || '',
      'contact.purchase_timeline': normalizeTimeline(body.purchase_timeline) || '',
      'contact.buy_box': body.buy_box || '',
      'contact.buyer_type': body.buyer_type || 'Buyer',
      'contact.criteria_last_update': body.criteria_last_update || new Date().toISOString().split('T')[0],
      'contact.max_repair_budget': body.max_repair_budget || '',
      'contact.occupancy_preference': body.occupancy_preference || '',
    };

    var customFields = [];
    Object.keys(fieldMap).forEach(function(key) {
      if (fieldMap[key] && fieldIds[key]) {
        customFields.push({ id: fieldIds[key], value: fieldMap[key] });
      }
    });

    console.log('[buy-box-save] Mapped ' + customFields.length + ' fields with IDs');

    var cfRes = await updateCustomFields(ghlKey, contactId, customFields);
    console.log('[buy-box-save] Custom fields updated: ' + cfRes.status);

    // 3. Add tags
    await addTags(ghlKey, contactId, body.tags || ['tfs buyer', 'buy box complete', 'buyer-signup', 'opt in']);

    // 4. Post buy box summary as note
    var noteLines = ['=== BUY BOX SAVED ==='];
    if (body.deal_structure) noteLines.push('Structures: ' + body.deal_structure);
    if (body.property_type_preference) noteLines.push('Property Types: ' + body.property_type_preference);
    if (body.exits) noteLines.push('Exit Strategies: ' + body.exits);
    if (body.target_zips) noteLines.push('Markets: ' + body.target_zips);
    if (body.max_price) noteLines.push('Max Price: $' + Number(body.max_price).toLocaleString());
    if (body.max_down) noteLines.push('Max Entry: $' + Number(body.max_down).toLocaleString());
    if (body.max_monthly) noteLines.push('Max PITI: $' + Number(body.max_monthly).toLocaleString());
    if (body.target_monthly_cashflow) noteLines.push('Min Cash Flow: $' + body.target_monthly_cashflow);
    if (body.max_rate_) noteLines.push('Max Rate: ' + body.max_rate_ + '%');
    if (body.arv) noteLines.push('Min ARV: $' + Number(body.arv).toLocaleString());
    if (body.bedrooms_min) noteLines.push('Min Beds: ' + body.bedrooms_min);
    if (body.baths_min) noteLines.push('Min Baths: ' + body.baths_min);
    if (body.remodel_level) noteLines.push('Condition: ' + body.remodel_level);
    if (body.purchase_timeline) noteLines.push('Timeline: ' + body.purchase_timeline);
    if (body.buy_box) noteLines.push('Notes: ' + body.buy_box);
    noteLines.push('\n--- Buy Box / Terms For Sale ---');

    await postNote(ghlKey, contactId, noteLines.join('\n'));

    // 4b. AI parse of preferences (best effort — do NOT block on this)
    // Runs Haiku on the buy_box + tags + structured fields to produce a
    // structured JSON blob stored on contact.parsed_prefs. Matching reads
    // that blob instead of re-parsing free text on every deal blast.
    if (parsePreferencesModule && process.env.ANTHROPIC_API_KEY) {
      try {
        var parsed = await parsePreferencesModule.parsePreferences(
          process.env.ANTHROPIC_API_KEY,
          {
            buyBox: body.buy_box || '',
            notes: [],
            tags: body.tags || ['tfs buyer', 'buy box complete', 'buyer-signup', 'opt in'],
            structuredFields: {
              deal_structures:   body.deal_structure || '',
              property_types:    body.property_type_preference || body.property_type_new || '',
              target_states:     body.target_states || body.states_buying_in || '',
              target_cities:     body.target_cities || body.target_location || '',
              max_price:         body.max_price || '',
              max_entry_fee:     body.max_down || '',
              max_monthly_piti:  body.max_monthly || '',
              min_cashflow:      body.target_monthly_cashflow || '',
              max_interest_rate: body.max_rate_ || '',
              min_arv:           body.arv || '',
              min_beds:          body.bedrooms_min || '',
              min_baths:         body.baths_min || '',
              min_sqft:          body.min_sqft || '',
              min_year_built:    body.min_year_build || '',
              remodel_level:     body.remodel_level || '',
              hoa_tolerance:     body.hoa_tolerance || '',
              pool:              body.pool || '',
              max_repair_budget: body.max_repair_budget || '',
              occupancy_pref:    body.occupancy_preference || '',
              purchase_timeline: body.purchase_timeline || ''
            }
          }
        );
        if (parsed && fieldIds['contact.parsed_prefs']) {
          await updateCustomFields(ghlKey, contactId, [
            { id: fieldIds['contact.parsed_prefs'], value: JSON.stringify(parsed) }
          ]);
          console.log('[buy-box-save] parsed_prefs written (confidence=' + parsed.confidence + ')');
        } else if (parsed) {
          console.warn('[buy-box-save] parsed_prefs computed but contact.parsed_prefs field not in GHL schema yet — skipping write');
        }
      } catch (e) {
        console.warn('[buy-box-save] parse_preferences failed (non-fatal):', e.message);
      }
    }

    // 5. Internal notification to Brooke
    if (brookePhone) {
      try {
        await sendSMS(ghlKey, locationId, brookePhone,
          'BUY BOX SAVED: ' + (body.firstName || '') + ' ' + (body.email || '') + ' — ' + (body.deal_structure || '') + ' | ' + (body.target_zips || '').slice(0, 60));
      } catch(e) {}
    }

    return respond(200, { success: true, contactId: contactId });

  } catch (err) {
    console.error('[buy-box-save] error:', err.message);
    return respond(500, { error: err.message });
  }
};

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
    body: JSON.stringify(body)
  };
}
