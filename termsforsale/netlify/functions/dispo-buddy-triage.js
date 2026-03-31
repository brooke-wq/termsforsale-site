// Netlify function: dispo-buddy-triage
// POST /api/dispo-buddy-triage
// Triages new JV deal submissions — Claude screens for viability,
// routes viable deals to underwriting, sends SMS to partner.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID_DISPO

const { complete } = require('./_claude');
const { postNote, swapTags, sendSMS, getContact } = require('./_ghl');

const TRIAGE_SYSTEM = `You are the Dispo Buddy Triage Agent for Deal Pros LLC.

JV partners submit deals through our Dispo Buddy program. Your job is a quick viability screen — not full underwriting. Determine if this deal is worth passing to the underwriting team.

A deal is VIABLE if:
- There's clear equity (asking price meaningfully below ARV or area comps)
- The deal structure makes sense (numbers work for at least one exit strategy)
- The market is in our coverage area (AZ, TX, FL primarily) or has enough spread for out-of-market
- No obvious red flags that would kill the deal

A deal is NOT VIABLE if:
- Negative equity or razor-thin margins (< $10K potential spread)
- Property condition requires more rehab than the spread supports
- Obvious title issues mentioned (active lawsuit, probate without resolution)
- Numbers don't add up or are clearly fabricated

Be encouraging to partners — they're learning. Even declines should include a brief reason and what would make the deal work.

Output valid JSON only.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID_DISPO || process.env.GHL_LOCATION_ID || '7IyUgu1zpi38MDYpSDTs';

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
    // Fetch contact details from GHL
    var contactRes = await getContact(ghlKey, contactId);
    var contact = (contactRes.body && contactRes.body.contact) || contactRes.body || {};
    var partnerPhone = contact.phone || body.phone || '';
    var partnerName = ((contact.firstName || body.firstName || '') + ' ' + (contact.lastName || body.lastName || '')).trim();

    // Build deal data from body or contact custom fields
    var cf = {};
    (contact.customFields || []).forEach(function(f) {
      if (f.key) cf[f.key] = f.field_value || f.value || '';
    });

    var address = body.address || cf.property_address || '';
    var city    = body.city || cf.property_city || '';
    var state   = body.state || cf.property_state || '';

    var dealData = [
      'Partner: ' + partnerName,
      'Property: ' + [address, city, state].filter(Boolean).join(', '),
      'Deal Type: ' + (body.deal_type || body.dealStructure || cf.deal_structure || 'Not specified'),
      'Asking Price: ' + (body.asking_price || cf.seller_asking_price || 'Not provided'),
      'ARV Estimate: ' + (body.arv || cf.estimated_arv || 'Not provided'),
      'Condition: ' + (body.condition || cf.property_condition || 'Not specified'),
      'Beds/Baths/Sqft: ' + [body.beds || cf.property_beds, body.baths || cf.property_baths, body.sqft || cf.property_sqft].filter(Boolean).join('/'),
      'Loan Balance: ' + (body.loan_balance || cf.subto_loan_balance || 'Not provided'),
      'Monthly Payment: ' + (body.monthly_payment || cf.monthly_payment || 'Not provided'),
      'Seller Motivation: ' + (body.motivation || cf.seller_motivation || 'Not provided'),
      'Partner Notes: ' + (body.notes || cf.additional_notes || cf.jv_notes || 'None')
    ].join('\n');

    var userPrompt = 'Screen this JV deal submission:\n\n' + dealData + '\n\n' +
      'Return JSON: { "viable": true|false, "reason": "1-2 sentence reason", "recommended_action": "underwrite|decline|need-info", "partner_message": "SMS message to partner (under 160 chars)", "internal_note": "detailed note for our team" }';

    console.log('[dispo-buddy-triage] screening: ' + address);
    var claudeRes = await complete(anthropicKey, {
      system: TRIAGE_SYSTEM,
      user: userPrompt,
      maxTokens: 600,
      json: true
    });
    var result = claudeRes.text;

    console.log('[dispo-buddy-triage] viable=' + result.viable +
      ' action=' + result.recommended_action +
      ' cost=$' + claudeRes.usage.cost.toFixed(6));

    // Post internal note
    var noteBody = '--- DISPO BUDDY TRIAGE ---\n' +
      'Partner: ' + partnerName + '\n' +
      'Property: ' + [address, city, state].filter(Boolean).join(', ') + '\n' +
      'Viable: ' + (result.viable ? 'YES' : 'NO') + '\n' +
      'Reason: ' + (result.reason || '') + '\n' +
      'Action: ' + (result.recommended_action || '') + '\n\n' +
      (result.internal_note || '') + '\n\n' +
      '--- Dispo Buddy Triage / Deal Pros LLC ---';
    await postNote(ghlKey, contactId, noteBody);

    // Route based on viability
    if (result.viable) {
      await swapTags(ghlKey, contactId, ['jv-submitted'], ['jv-viable', 'uw-requested']);
      console.log('[dispo-buddy-triage] VIABLE — routing to underwriting');

      // Send partner confirmation SMS
      if (partnerPhone && locationId) {
        var confirmMsg = result.partner_message || ('Your deal at ' + (address || 'the submitted property') + ' passed initial screening! Our team is reviewing it now.');
        if (confirmMsg.length > 160) confirmMsg = confirmMsg.slice(0, 157) + '...';
        await sendSMS(ghlKey, locationId, partnerPhone, confirmMsg);
      }
    } else {
      await swapTags(ghlKey, contactId, ['jv-submitted'], ['jv-declined']);
      console.log('[dispo-buddy-triage] NOT VIABLE — declined');

      // Send partner decline SMS
      if (partnerPhone && locationId) {
        var declineMsg = result.partner_message || ('Thanks for submitting ' + (address || 'your deal') + '. This one doesn\'t fit our current buy box, but keep them coming!');
        if (declineMsg.length > 160) declineMsg = declineMsg.slice(0, 157) + '...';
        await sendSMS(ghlKey, locationId, partnerPhone, declineMsg);
      }
    }

    return respond(200, {
      success: true,
      contactId: contactId,
      address: [address, city, state].filter(Boolean).join(', '),
      viable: result.viable,
      reason: result.reason,
      recommended_action: result.recommended_action,
      usage: claudeRes.usage
    });

  } catch (err) {
    console.error('[dispo-buddy-triage] error:', err.message);
    if (contactId && ghlKey) {
      try { await postNote(ghlKey, contactId, 'Dispo Buddy Triage ERROR: ' + err.message); } catch(e) {}
    }
    return respond(500, { error: err.message });
  }
};

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
