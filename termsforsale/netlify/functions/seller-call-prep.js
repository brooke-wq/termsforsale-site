// Netlify function: seller-call-prep
// POST /api/seller-call-prep
// Generates Eddie's pre-call brief from completed underwriting report.
// Fetches the UW report from GHL notes, sends to Claude for call strategy.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY

const { complete } = require('./_claude');
const { getContact, postNote, swapTags } = require('./_ghl');

const CALL_PREP_SYSTEM = `You are the Acquisitions Director's call prep assistant for Deal Pros LLC.

Eddie is the acquisitions closer. He needs a concise, actionable call brief before every seller call. Your job is to read the underwriting report and seller data, then produce a sharp call strategy.

RULES:
- Be direct and tactical — Eddie has 2 minutes to read this before dialing
- Anchor price should be at or below MAO from the underwriting report
- Recommend the structure that benefits Deal Pros most while being fair to the seller
- Anticipate objections based on seller motivation and timeline
- The closing question should feel natural, not salesy
- Never reveal MAO or internal margins to the seller

OUTPUT: Valid JSON only.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;

  if (!anthropicKey || !ghlKey) {
    return respond(500, { error: 'Missing required env vars' });
  }

  var body;
  try { body = JSON.parse(event.body); } catch(e) {
    return respond(400, { error: 'Invalid JSON' });
  }

  var contactId = body.contact_id || body.contactId;
  if (!contactId) {
    return respond(400, { error: 'contact_id required' });
  }

  try {
    // 1. Fetch contact from GHL
    console.log('[seller-call-prep] fetching contact: ' + contactId);
    var contactRes = await getContact(ghlKey, contactId);
    if (contactRes.status >= 400 || !contactRes.body || !contactRes.body.contact) {
      return respond(404, { error: 'Contact not found: ' + contactId });
    }
    var contact = contactRes.body.contact;

    // 2. Fetch notes to find the underwriting report
    var notesRes = await fetchNotes(ghlKey, contactId);
    var uwReport = '';
    if (notesRes && notesRes.length) {
      for (var i = 0; i < notesRes.length; i++) {
        var noteBody = notesRes[i].body || '';
        if (noteBody.includes('UNDERWRITING REPORT') || noteBody.includes('underwriting report')) {
          uwReport = noteBody;
          break;
        }
      }
    }

    if (!uwReport) {
      console.warn('[seller-call-prep] no underwriting report found for ' + contactId);
      return respond(400, { error: 'No underwriting report found on this contact. Run underwriting first.' });
    }

    // 3. Extract seller info from contact custom fields
    var cf = {};
    (contact.customFields || []).forEach(function(f) {
      if (f.key) cf[f.key] = f.field_value || f.value || '';
      if (f.id)  cf[f.id] = f.value || '';
    });

    var sellerName = (contact.firstName || '') + ' ' + (contact.lastName || '');
    var address = cf.property_address || cf.propertyAddress || '';

    var userPrompt = 'Generate a call prep brief for Eddie.\n\n' +
      'SELLER: ' + sellerName.trim() + '\n' +
      'ADDRESS: ' + address + '\n' +
      'MOTIVATION: ' + (cf.seller_motivation || 'Unknown') + '\n' +
      'TIMELINE: ' + (cf.seller_timeline || 'Unknown') + '\n' +
      'EQUITY ESTIMATE: ' + (cf.seller_equity_estimate || 'Unknown') + '\n\n' +
      'UNDERWRITING REPORT:\n' + uwReport.slice(0, 3000) + '\n\n' +
      'Return JSON: { "pain_points": ["..."], "recommended_structure": "Cash|SubTo|Seller Finance|etc", "recommended_structure_reason": "1 sentence", "anchor_price": 123000, "objection_handlers": [{"objection": "...", "response": "..."}], "closing_question": "...", "key_risk": "..." }';

    console.log('[seller-call-prep] generating call brief for ' + address);
    var claudeRes = await complete(anthropicKey, {
      system: CALL_PREP_SYSTEM,
      user: userPrompt,
      maxTokens: 800,
      json: true
    });
    var result = claudeRes.text;

    console.log('[seller-call-prep] brief generated, cost=$' + claudeRes.usage.cost.toFixed(6));

    // 4. Post call prep note to GHL
    var noteBody = '--- CALL PREP BRIEF ---\n' +
      'Seller: ' + sellerName.trim() + '\n' +
      'Property: ' + address + '\n\n' +
      'PAIN POINTS:\n' + (result.pain_points || []).map(function(p) { return '  - ' + p; }).join('\n') + '\n\n' +
      'RECOMMENDED STRUCTURE: ' + (result.recommended_structure || 'TBD') + '\n' +
      'WHY: ' + (result.recommended_structure_reason || '') + '\n\n' +
      'ANCHOR PRICE: $' + (result.anchor_price ? (+result.anchor_price).toLocaleString() : 'TBD') + '\n\n' +
      'OBJECTION HANDLERS:\n' +
      (result.objection_handlers || []).map(function(o) {
        return '  Q: ' + o.objection + '\n  A: ' + o.response;
      }).join('\n\n') + '\n\n' +
      'CLOSING QUESTION: ' + (result.closing_question || '') + '\n\n' +
      'KEY RISK: ' + (result.key_risk || 'None identified') + '\n\n' +
      '--- Acquisitions Call Prep / Deal Pros LLC ---';

    await postNote(ghlKey, contactId, noteBody);

    // 5. Swap tags: add call-prepped, remove uw-complete
    await swapTags(ghlKey, contactId, ['uw-complete'], ['call-prepped']);

    return respond(200, {
      success: true,
      contactId: contactId,
      address: address,
      recommended_structure: result.recommended_structure,
      anchor_price: result.anchor_price,
      pain_points: result.pain_points,
      usage: claudeRes.usage
    });

  } catch (err) {
    console.error('[seller-call-prep] error:', err.message);
    if (contactId && ghlKey) {
      try { await postNote(ghlKey, contactId, 'Call Prep ERROR: ' + err.message); } catch(e) {}
    }
    return respond(500, { error: err.message });
  }
};

// Fetch notes for a contact (GHL API)
async function fetchNotes(apiKey, contactId) {
  var res = await fetch('https://services.leadconnectorhq.com/contacts/' + contactId + '/notes', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    console.warn('[seller-call-prep] failed to fetch notes:', res.status);
    return [];
  }
  var data = await res.json();
  return data.notes || [];
}

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
