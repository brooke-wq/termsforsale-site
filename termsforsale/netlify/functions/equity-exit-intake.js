// Netlify function: equity-exit-intake
// POST /api/equity-exit-intake
// Processes co-ownership inquiry intakes for the Equity Exit brand.
// Claude categorizes the situation and recommends next steps.
//
// ENV VARS: ANTHROPIC_API_KEY, GHL_API_KEY, GHL_LOCATION_ID, BROOKE_PHONE

const { complete } = require('./_claude');
const { postNote, swapTags, sendSMS, upsertContact } = require('./_ghl');

const INTAKE_SYSTEM = `You are the Equity Exit Intake Agent for Deal Pros LLC.

Equity Exit helps people in co-ownership disputes, inherited property situations, divorce property splits, and other complex equity situations where one or more parties want out.

SITUATION TYPES:
- co-ownership-dispute: Multiple owners, one wants to sell
- inherited-property: Death in family, heirs disagree or need cash
- divorce-split: Marital property needs resolution
- buyout-needed: One owner needs to buy out the other(s)
- partition-risk: Legal partition action threatened or filed
- tax-burden: Property taxes overwhelming one/all owners
- other: Anything else involving shared equity

URGENCY:
- high: Legal action pending, foreclosure risk, court deadlines
- medium: Motivated but no immediate deadline
- low: Exploring options, no pressure

CAN_HELP:
- true: This is a situation we can help with (most co-ownership/equity situations)
- false: Outside our scope (commercial disputes, non-real-estate, clearly legal-only)

Output valid JSON only.`;

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  var ghlKey       = process.env.GHL_API_KEY;
  var locationId   = process.env.GHL_LOCATION_ID;
  var brookePhone  = process.env.BROOKE_PHONE;

  if (!anthropicKey || !ghlKey) {
    return respond(500, { error: 'Missing required env vars' });
  }

  var body;
  try { body = JSON.parse(event.body); } catch(e) {
    return respond(400, { error: 'Invalid JSON' });
  }

  var contactId = body.contact_id || body.contactId || null;

  try {
    // Upsert contact if needed
    if (!contactId && locationId && (body.phone || body.email)) {
      var upsertRes = await upsertContact(ghlKey, locationId, {
        firstName: body.firstName || body.first_name || 'Equity Exit',
        lastName:  body.lastName || body.last_name || 'Inquiry',
        phone:     body.phone || undefined,
        email:     body.email || undefined,
        source:    'Equity Exit Intake'
      });
      if (upsertRes.body && (upsertRes.body.contact || upsertRes.body.id)) {
        contactId = (upsertRes.body.contact && upsertRes.body.contact.id) || upsertRes.body.id;
        console.log('[equity-exit-intake] upserted contact: ' + contactId);
      }
    }

    var inquiryData = [
      'Name: ' + (body.firstName || body.first_name || '') + ' ' + (body.lastName || body.last_name || ''),
      'Property Address: ' + (body.address || body.property_address || 'Not provided'),
      'City/State: ' + [body.city, body.state].filter(Boolean).join(', '),
      'Situation: ' + (body.situation || body.description || 'Not described'),
      'Number of Owners: ' + (body.num_owners || 'Unknown'),
      'Ownership Split: ' + (body.ownership_split || 'Unknown'),
      'Estimated Value: ' + (body.estimated_value || body.property_value || 'Unknown'),
      'Outstanding Mortgage: ' + (body.mortgage_balance || 'Unknown'),
      'Legal Action Pending: ' + (body.legal_action || 'Unknown'),
      'Desired Outcome: ' + (body.desired_outcome || 'Not specified'),
      'Timeline: ' + (body.timeline || 'Not specified'),
      'Additional Details: ' + (body.notes || body.additional_details || 'None')
    ].join('\n');

    var userPrompt = 'Process this co-ownership inquiry:\n\n' + inquiryData + '\n\n' +
      'Return JSON: { "situation_type": "...", "urgency": "high|medium|low", "can_help": true|false, "reason": "why we can/cannot help", "equity_note": "brief equity analysis if enough data", "recommended_next_step": "...", "contact_note": "detailed note for our records", "alert_brooke": true|false }';

    console.log('[equity-exit-intake] processing inquiry: ' + (body.address || contactId));
    var claudeRes = await complete(anthropicKey, {
      system: INTAKE_SYSTEM,
      user: userPrompt,
      maxTokens: 600,
      json: true
    });
    var result = claudeRes.text;

    console.log('[equity-exit-intake] type=' + result.situation_type +
      ' urgency=' + result.urgency + ' can_help=' + result.can_help +
      ' cost=$' + claudeRes.usage.cost.toFixed(6));

    // Post contact note
    if (contactId && ghlKey) {
      var noteBody = '--- EQUITY EXIT INTAKE ---\n' +
        'Situation: ' + (result.situation_type || 'Unknown') + '\n' +
        'Urgency: ' + (result.urgency || 'Unknown').toUpperCase() + '\n' +
        'Can Help: ' + (result.can_help ? 'YES' : 'NO') + '\n' +
        'Reason: ' + (result.reason || '') + '\n\n' +
        (result.equity_note ? 'Equity Analysis: ' + result.equity_note + '\n\n' : '') +
        'Next Step: ' + (result.recommended_next_step || '') + '\n\n' +
        (result.contact_note || '') + '\n\n' +
        '--- Equity Exit Intake / Deal Pros LLC ---';
      await postNote(ghlKey, contactId, noteBody);

      // Tag routing
      var tagsToAdd = [];
      var tagsToRemove = ['equity-exit-inquiry'];

      if (result.can_help) {
        tagsToAdd.push('equity-exit-qualified');
      } else {
        tagsToAdd.push('equity-exit-declined');
      }

      if (result.situation_type) {
        tagsToAdd.push('ee-' + result.situation_type);
      }

      await swapTags(ghlKey, contactId, tagsToRemove, tagsToAdd);
    }

    // Alert Brooke for high urgency or flagged cases
    if ((result.alert_brooke || result.urgency === 'high') && brookePhone && locationId) {
      var alertMsg = 'EQUITY EXIT: ' + (result.situation_type || 'inquiry') + ' — ' +
        (body.address || 'new inquiry') + ' | Urgency: ' + (result.urgency || '?').toUpperCase();
      if (alertMsg.length > 155) alertMsg = alertMsg.slice(0, 152) + '...';
      await sendSMS(ghlKey, locationId, brookePhone, alertMsg);
      console.log('[equity-exit-intake] alert SMS sent to Brooke');
    }

    return respond(200, {
      success: true,
      contactId: contactId,
      situation_type: result.situation_type,
      urgency: result.urgency,
      can_help: result.can_help,
      recommended_next_step: result.recommended_next_step,
      usage: claudeRes.usage
    });

  } catch (err) {
    console.error('[equity-exit-intake] error:', err.message);
    if (contactId && ghlKey) {
      try { await postNote(ghlKey, contactId, 'Equity Exit Intake ERROR: ' + err.message); } catch(e) {}
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
